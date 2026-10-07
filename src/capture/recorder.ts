import {extractorHeader,fetchWithExtractorHeaders} from './request-headers';
import {matchesRecordedHeaders} from './request-match';
import { ArchiveDB } from '@webrecorder/wabac/swlib';
import { postToGetUrl } from 'warcio';
import { Recorder } from '../../vendor/archivewebpage/recorder';
import type { ResourceInput, RecordRef, StoredResponse, CapturedEntry, FetchOptions, NetworkIdleOptions, NetworkIdleState, BrowserDownload } from './types';

export class CaptureRecorder extends Recorder {
  readonly db: ArchiveDB;
  readonly writes = new Set<Promise<unknown>>();
  readonly events = new Map<string, Set<(params: any) => void>>();
  readonly errors: string[] = [];
  resourceCount = 0;
  private downloads?:{token:string;plugin:string;items:BrowserDownload[];pending:number;updated:number;error?:unknown;cleanup:()=>void};
  private attached = false;
  private nativePDFUrl: string | undefined;
  private eventTasks = new Set<Promise<unknown>>();
  private commits = new Set<Promise<unknown>>();
  private pendingFetches = new Set<Promise<RecordRef>>();
  private fetchAbort = new AbortController();
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(readonly tabId: number, readonly captureId: string, readonly url: string) {
    super();
    this.flatMode = true;
    this.db = new ArchiveDB(`capture-${captureId}`, { minDedupSize: 0 });
    this.behaviorInitStr = JSON.stringify({ autofetch: false, autoplay: false, autoscroll: false, siteSpecific: false, log: '__bx_log' });
    this.defaultFetchOpts = { redirect: 'manual', signal: this.fetchAbort.signal };
  }
  async initOpts() { /* All acquisition is selected through our plugin registry. */ }
  async loaded() {
    // The Chrome hook owns page readiness. AWP's autorun gate has one resolver
    // shared by all Page.loadEventFired events; concurrent Google editor frames
    // overwrite it and leave earlier event handlers unresolved at finalization.
    // Recording/flush still completes through the normal commit and drain APIs.
  }
  private onEvent = (source: chrome.debugger.Debuggee & { sessionId?: string }, method: string, params?: object) => {
    if (source.tabId !== this.tabId) return;
    if (method === 'Page.frameNavigated' && !source.sessionId) {
      const frame = (params as any)?.frame;
      if (frame && !frame.parentId) this.nativePDFUrl = frame.mimeType === 'application/pdf' ? frame.url : undefined;
    }
    this.events.get(method)?.forEach(handler => handler(params));
    const task = this.processMessage(method, params || {}, source.sessionId ? [source.sessionId] : [])
      .catch(error => { this.errors.push(`${method}: ${error}`); })
      .finally(() => {this.eventTasks.delete(task)});
    this.eventTasks.add(task);
  };
  private onDetach = (source: chrome.debugger.Debuggee, reason: string) => {
    if (source.tabId !== this.tabId || !this.attached) return;
    this.attached = false;
    if (reason === 'target_closed' && this.nativePDFUrl) {
      // Chrome detaches extension debuggers while its privileged PDF viewer
      // opens. The original PDF was received on the main document session.
      // Wait for Chrome's actual tab completion before restoring page access.
      const task = this.resumeNativePDF(this.nativePDFUrl)
        .catch(error => { this.errors.push(`Native PDF readiness failed: ${error}`); })
        .finally(() => this.eventTasks.delete(task));
      this.eventTasks.add(task);
    } else this.errors.push(`Debugger disconnected: ${reason}`);
  };
  private async resumeNativePDF(url: string) {
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed);
        this.fetchAbort.signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const check = (tab: chrome.tabs.Tab) => {
        if (tab.url && tab.url !== url) done(Error(`PDF tab navigated to ${tab.url}`));
        else if (tab.status === 'complete') done();
      };
      const updated = (id: number, _info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => { if (id === this.tabId) check(tab); };
      const removed = (id: number) => { if (id === this.tabId) done(Error('PDF tab closed before completion')); };
      const aborted = () => done(Error('PDF capture stopped before completion'));
      chrome.tabs.onUpdated.addListener(updated); chrome.tabs.onRemoved.addListener(removed);
      this.fetchAbort.signal.addEventListener('abort', aborted, {once:true});
      chrome.tabs.get(this.tabId).then(check, error => done(error));
    });
    this.fetchAbort.signal.throwIfAborted();
    await chrome.debugger.attach({tabId:this.tabId}, '1.3'); this.attached = true;
    await this.send('Page.enable');
    await this.send('DOMSnapshot.enable');
    const state = await this.evaluate('({url:location.href,type:document.contentType,ready:document.readyState})');
    if (state.url !== url || state.type !== 'application/pdf' || state.ready !== 'complete') throw Error(`Unexpected PDF document state: ${JSON.stringify(state)}`);
    this.events.get('ArchiveBox.nativePDFLoaded')?.forEach(handler => handler({url}));
  }
  async _doAttach() {
    await this.db.initing;
    await chrome.debugger.attach({ tabId: this.tabId }, '1.3'); this.attached = true;
    chrome.debugger.onEvent.addListener(this.onEvent); chrome.debugger.onDetach.addListener(this.onDetach);
    await this.start();
  }
  beginDownloads(plugin:string,signal:AbortSignal){
    signal.throwIfAborted();if(this.downloads)throw Error('Another plugin is collecting browser downloads');
    const token=crypto.randomUUID();
    const abort=()=>{if(this.downloads?.token===token){this.downloads.cleanup();this.downloads=undefined}};
    signal.addEventListener('abort',abort,{once:true});
    this.downloads={token,plugin,items:[],pending:0,updated:Date.now(),cleanup:()=>signal.removeEventListener('abort',abort)};
    return token;
  }
  cancelDownloads(token:string){if(this.downloads?.token===token){this.downloads.cleanup();this.downloads=undefined}}
  async finishDownloads(token:string,timeoutMs:number,signal:AbortSignal){
    const batch=this.downloads;if(!batch||batch.token!==token)throw Error('Unknown browser download batch');
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Download preparation timeout exceeded');
    const deadline=Date.now()+timeoutMs;
    try{
      while(Date.now()<deadline){
        signal.throwIfAborted();if(batch.error)throw batch.error;
        if(batch.items.length&&!batch.pending&&Date.now()-batch.updated>=1000)return batch.items;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error('Provider download did not complete before timeout');
    }finally{this.cancelDownloads(token)}
  }
  async handlePaused(params:any,sessions:string[]){
    const batch=this.downloads;
    const disposition=(params.responseHeaders||[]).find((header:any)=>header.name.toLowerCase()==='content-disposition')?.value||'';
    // Content-Disposition on XHR/fetch does not start a browser download (e.g.
    // Dropbox adds attachment to JSON analytics). Keep those requests intact.
    const navigation=params.resourceType==='Document'||new Headers(params.request.headers||{}).get('sec-fetch-mode')==='navigate';
    if(!batch||!navigation||!/^attachment(?:;|$)/i.test(disposition)||!(params.responseStatusCode>=200&&params.responseStatusCode<300))return super.handlePaused(params,sessions);
    batch.pending++;batch.updated=Date.now();
    const id=params.networkId||params.requestId;
    try{
      // The existing AWP Fetch response path reads the actual provider body.
      // Prevent native file saving only after that same response is durable.
      const reqresp=await this.handleFetchResponse(params,sessions);
      if(!reqresp?.payload)throw Error('Provider download response body is unavailable');
      const extended=disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
      const quoted=disposition.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/i)?.[1];
      const bare=disposition.match(/filename\s*=\s*([^;]+)/i)?.[1];
      const filename=(extended?decodeURIComponent(extended):quoted?.replace(/\\(.)/g,'$1')||bare?.trim()||new URL(params.request.url).pathname.split('/').pop()||'download').replaceAll('\\','/').split('/').pop()!;
      const data=reqresp.toDBRecord(reqresp.payload,this.pageInfo,this.archiveCookies);
      if(!data)throw Error('Provider download could not be recorded');
      data.extraOpts={...data.extraOpts,download:{filename,plugin:batch.plugin}};
      await this.commitResource(data);
      batch.items.push({filename,ref:{captureId:this.captureId,url:data.url,ts:data.ts}});
    }catch(error){batch.error=error;this.errors.push('Browser download failed: '+String(error))}
    finally{
      this.removeReqResp(id);batch.pending--;batch.updated=Date.now();
      await this.send('Fetch.failRequest',{requestId:params.requestId,errorReason:'Aborted'},sessions).catch(error=>{batch.error=error});
    }
  }
  override fullCommit(reqresp: any, sessions: string[]) {
    const commit = super.fullCommit(reqresp, sessions).catch(error => { this.errors.push(`Response commit failed: ${error}`); })
      .finally(() => this.commits.delete(commit));
    this.commits.add(commit); return commit;
  }
  reportError(message: string) { this.errors.push(message); }
  async _doDetach() {
    if (this.attached) {
      try { await this.sessionClose([]); }
      catch (error) { this.errors.push(`Unable to close recording session: ${error}`); }
      finally {
        this.attached = false;
        await chrome.debugger.detach({ tabId: this.tabId }).catch(error => this.errors.push(`Unable to detach debugger: ${error}`));
      }
    }
  }
  _doStop() {
    chrome.debugger.onEvent.removeListener(this.onEvent); chrome.debugger.onDetach.removeListener(this.onDetach);
  }
  _doSendCommand(method: string, params: any, promise: Promise<any> | null) {
    const result = chrome.debugger.sendCommand({ tabId: this.tabId }, method, params || {});
    return promise ? result.then(() => promise) : result;
  }
  _doSendCommandFlat(method: string, params: any, sessionId: string) {
    return chrome.debugger.sendCommand({ tabId: this.tabId, sessionId }, method, params || {});
  }
  _doAddResource(data: any) {
    // IDB's [url, ts] key must retain distinct exchanges even within one millisecond.
    const write = this.writeQueue.then(async () => {
      await this.db.initing;
      while (await this.db.db!.get('resources', [data.url, data.ts])) data.ts += 1;
      const fresh = await this.db.addResource(data);
      this.resourceCount++;
      return fresh ? (data.payload?.length || 0) : 0;
    });
    this.writeQueue = write.catch(error => { this.errors.push(`Archive write failed: ${error}`); });
    this.writes.add(write); void write.finally(() => this.writes.delete(write)).catch(() => {});
    return write;
  }
  _doAddPage(page: any) {
    const { text: _derivedText, ...metadata } = page;
    const write=this.db.addPage(metadata);
    this.writes.add(write);
    void write.catch(error=>{this.errors.push(`Archive page write failed: ${error}`);}).finally(()=>this.writes.delete(write));
    return write;
  }
  _doIncSizes() { return Promise.resolve(); }
  doUpdateStatus() {}
  async getFullText() { return null; } // DOM evidence is owned by the DOM hook; text is derived when viewed.
  loadFavIcon(url: string) { this.pageInfo.favIconUrl = url; }
  getExternalInjectURL(path: string) { return chrome.runtime.getURL(path); }
  async getFavIcon() { return (await chrome.tabs.get(this.tabId)).favIconUrl || ''; }
  async addResource(input: ResourceInput, plugin: string, resultId:string): Promise<RecordRef> {
    const payload = typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
    const sourceUrl = input.sourceUrl || (/^https?:/.test(this.pageInfo.url || '') ? this.pageInfo.url : this.url);
    // Evidence has its own identity. A page URL fragment is not part of a WARC
    // resource identifier; preserve the full source URL in metadata instead.
    const url = `urn:${input.kind}:${this.captureId}:${crypto.randomUUID()}`;
    const data = {
      url, ts: Date.now(), status: 200, statusText: 'OK', pageId: this.pageInfo.id,
      mime: input.mime, respHeaders: { 'Content-Type': input.mime, 'Content-Length': String(payload.length) }, reqHeaders: {}, payload,
      extraOpts: { ...input.metadata, resource: true, plugin, captureId: this.captureId, sourceUrl, archive_result_id:resultId },
    };
    await this._doAddResource(data);
    return { captureId: this.captureId, url, ts: data.ts };
  }
  async fetchResource(rawUrl: string, signal?: AbortSignal, options:FetchOptions={}): Promise<RecordRef> {
    for(const key of Object.keys(options))if(!['maxBytes','method','body','headers','timeoutMs','force','browserSession'].includes(key))throw Error(`Unsupported supplemental fetch option: ${key}`);
    const target = new URL(rawUrl, this.pageInfo.url || this.url); target.hash = '';
    const url = target.href;
    if (!/^https?:/.test(url)) throw new Error('Only HTTP(S) resources can be fetched');
    const method=options.method || 'GET';
    if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method))throw Error(`Unsupported supplemental HTTP method: ${method}`);
    if(options.body && ['GET','HEAD'].includes(method))throw Error(`${method} requests cannot have a body`);
    if(options.browserSession&&(method!=='GET'||options.body||Object.keys(options.headers||{}).length))throw Error('Browser-session downloads support GET with browser-managed headers');
    const requestHeaders=Object.fromEntries(new Headers(options.headers || {}));
    for(const name of Object.keys(requestHeaders))if(!extractorHeader.test(name) && /^(?:accept-charset|accept-encoding|access-control-request-.*|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|user-agent|via|proxy-.*|sec-.*)$/i.test(name))throw Error(`Browser-managed request header cannot be overridden: ${name}`);
    const timeout=options.timeoutMs ?? 20000;
    if(!Number.isFinite(timeout) || timeout<0)throw Error('timeoutMs must be a finite nonnegative number');
    const bodyDigest=options.body?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',options.body as BufferSource)),byte=>byte.toString(16).padStart(2,'0')).join(''):'';
    const key=JSON.stringify([url,method,Object.entries(requestHeaders).sort(([a],[b])=>a.localeCompare(b)),bodyDigest]);
    const identity={url,method,headers:new Headers(requestHeaders),postData:options.body||new Uint8Array()};
    if(method!=='GET')postToGetUrl(identity);
    const activeSignal=AbortSignal.any([this.fetchAbort.signal,...(timeout?[AbortSignal.timeout(timeout)]:[]),...(signal?[signal]:[])]);
    // Serializing lookup + acquisition closes the race between plugins with
    // different default headers asking for the same response simultaneously.
    const task=Promise.resolve(navigator.locks.request(`archivebox-response:${this.captureId}:${method}:${url}`,{signal:activeSignal},async()=>{
    await this.db.initing;
    if(!options.force && ['GET','HEAD'].includes(method)) {
      // A media request may keep streaming while its complete response has
      // already arrived through AWP's full-resource acquisition. Check reusable
      // bytes first and throughout the wait, rather than waiting for playback.
      while(true){
      activeSignal.throwIfAborted();
      const candidates=await this.db.db!.getAll('resources',IDBKeyRange.bound([identity.url,0],[identity.url,Number.MAX_SAFE_INTEGER]));
      const existing=candidates.reverse().find(record=>{
        return (record.status || 0)>=200&&(record.status||0)<400&&record.status!==304&&(record.status!==206||!!requestHeaders.range)&&(record.method||'GET')===method&&
          matchesRecordedHeaders(new Headers(requestHeaders),new Headers(record.reqHeaders||{}),new Headers(record.respHeaders||{}));
      });
      if(existing){
        const response={captureId:this.captureId,url:existing.url,ts:existing.ts};
        return response;
      }
      if(this.commits.size||this.writes.size){await Promise.allSettled([...this.commits,...this.writes]);continue}
      if(!Object.values(this.pendingRequests).some((request:any)=>request.url?.split('#')[0]===url&&(request.method||'GET')===method))break;
      await new Promise(resolve=>setTimeout(resolve,25));
      }
    }
      const response = options.browserSession?await this.fetchBrowserResource(url,activeSignal):await fetchWithExtractorHeaders(url, { method, body:options.body as BodyInit|undefined, headers:requestHeaders, credentials: 'include', signal:activeSignal },requestHeaders);
      const chunks:Uint8Array[]=[];let size=0;
      const limit=options.maxBytes??Infinity;
      if (!(limit>0)) { await response.body?.cancel(); throw Error('Response byte budget exhausted'); }
      const reader=response.body?.getReader();
      try {
        if(reader)while(true) {
          const chunk=await reader.read();if(chunk.done)break;
          size+=chunk.value.byteLength;
          if(size>limit)throw Error(`Response exceeds byte budget (${limit} bytes): ${url}`);
          chunks.push(chunk.value);
        }
      } catch(error) { await reader?.cancel(); throw error; }
      const payload=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){payload.set(chunk,offset);offset+=chunk.byteLength;}
      const headers = Object.fromEntries(response.headers);
      if(method!=='HEAD'){delete headers['content-encoding'];delete headers['transfer-encoding'];headers['content-length']=String(payload.length);}
      const finalUrl=response.url || url;
      // Match ArchiveWeb.page's request indexing, including POST body identity.
      const converted={url:finalUrl,method,headers:new Headers(requestHeaders),postData:options.body || new Uint8Array()};
      if(method!=='GET')postToGetUrl(converted);
      const data = { url: converted.url, ts: Date.now(), status: response.status, statusText: response.statusText,
        pageId: this.pageInfo.id, mime: (response.headers.get('content-type') || '').split(';')[0],
        respHeaders: headers, reqHeaders: requestHeaders, method, requestUrl:finalUrl, requestBody:options.body || new Uint8Array(), payload,
        extraOpts: { captureId: this.captureId, requestedUrl: url, finalUrl, requestMethod:method, requestBodyDigest:bodyDigest, acquisition: options.browserSession?'browser-session':'extension-fetch',fetchKey:key } };
      await this._doAddResource(data);
      return { captureId: this.captureId, url: data.url, ts: data.ts };
    }));
    this.pendingFetches.add(task);
    void task.finally(()=>this.pendingFetches.delete(task)).catch(()=>{});
    return task;
  }
  /** Chrome's own document session preserves partitioned/HttpOnly credentials
   * and cache semantics. Plugins still receive the same archived response API. */
  private async fetchBrowserResource(url:string,signal:AbortSignal):Promise<Response>{
    signal.throwIfAborted();
    const {frameTree}=await this.send('Page.getFrameTree');
    const pending=this.send('Network.loadNetworkResource',{frameId:frameTree.frame.id,url,options:{disableCache:false,includeCredentials:true}});
    const loaded=await new Promise<any>((resolve,reject)=>{
      const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
      pending.then(value=>{
        signal.removeEventListener('abort',abort);
        if(signal.aborted){if(value.resource?.stream)void this.send('IO.close',{handle:value.resource.stream}).catch(()=>{});return}
        resolve(value);
      },error=>{signal.removeEventListener('abort',abort);reject(error)});
    });
    const {resource}=loaded;
    if(!resource.httpStatusCode){if(resource.stream)await this.send('IO.close',{handle:resource.stream});throw Error(`Browser resource download failed: ${resource.netErrorName||'no HTTP response'}`)}
    const handle=resource.stream;
    // CDP joins repeated fields with newlines. Fetch's Headers requires them
    // appended separately (notably Google's multiple CSP policies).
    const headers=new Headers();
    try {
      for(const [name,value] of Object.entries(resource.headers||{}))for(const part of String(value).split(/\r?\n/))headers.append(name,part);
    } catch(error) {
      if(handle)await this.send('IO.close',{handle}).catch(()=>{});
      throw error;
    }
    if(!handle)return new Response(null,{status:resource.httpStatusCode,headers});
    let closed=false;
    const close=async()=>{if(closed)return;closed=true;signal.removeEventListener('abort',abort);await this.send('IO.close',{handle})};
    const abort=()=>{void close().catch(()=>{})};signal.addEventListener('abort',abort,{once:true});
    const body=new ReadableStream<Uint8Array>({
      pull:async controller=>{
        try{
          signal.throwIfAborted();
          const chunk=await this.send('IO.read',{handle,size:256*1024});
          signal.throwIfAborted();
          if(chunk.data)controller.enqueue(chunk.base64Encoded?Uint8Array.from(atob(chunk.data),char=>char.charCodeAt(0)):new TextEncoder().encode(chunk.data));
          if(chunk.eof){await close();controller.close()}
        }catch(error){await close().catch(()=>{});controller.error(error)}
      },cancel:close,
    });
    try{return new Response(body,{status:resource.httpStatusCode,headers})}
    catch(error){await close();throw error}
  }
  async readResource(ref: RecordRef): Promise<StoredResponse> {
    if (ref.captureId !== this.captureId) throw Error('Resource belongs to another capture');
    await this.db.initing;
    const record = await this.db.db!.get('resources', IDBKeyRange.only([ref.url, ref.ts]));
    if (!record) throw Error('Captured resource not found');
    const payload = await this.db.loadPayload(record, {});
    if (!payload) throw Error('Captured resource payload is unavailable');
    const body = payload instanceof Uint8Array ? payload : await payload.readFully();
    return { body, mime: record.mime || '', status: record.status || 0,
      headers: Object.fromEntries(new Headers(record.respHeaders || {})), metadata:record.extraOpts||{} };
  }
  async listResources(): Promise<CapturedEntry[]> {
    await this.db.initing;
    const result:CapturedEntry[]=[];
    let cursor=await this.db.db!.transaction('resources').store.openCursor();
    while(cursor) {
      const record=cursor.value;
      result.push({captureId:this.captureId,url:record.url,ts:Number(record.ts),mime:record.mime||'',status:record.status||0,method:record.method||'GET',digest:record.digest||undefined});
      cursor=await cursor.continue();
    }
    return result;
  }
  subscribe(method: string, callback: (params: unknown) => void) {
    const listeners = this.events.get(method) || new Set(); listeners.add(callback); this.events.set(method, listeners);
    return () => { listeners.delete(callback); };
  }
  async evaluate(expression: string) {
    const value = await this.pageEval('__archivebox_hook__', expression, [], true);
    if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result?.value;
  }
  async interrupt() { await this.send('Runtime.terminateExecution').catch(error => { this.errors.push(`Unable to terminate page execution: ${error}`); }); }
  /** Browsertrix page readiness is advisory and independent of durable recorder writes.
   * Final AWP detach/flush + drain() remains the authoritative capture boundary. */
  async waitForIdle({quietMs=500,maxWaitMs=2000,maxActiveRequests=1}:NetworkIdleOptions={},signal?:AbortSignal):Promise<NetworkIdleState>{
    if(![quietMs,maxWaitMs,maxActiveRequests].every(value=>Number.isFinite(value)&&value>=0)||!Number.isInteger(maxActiveRequests))throw Error('Invalid network idle options');
    const start=Date.now();let quietSince=start;
    const state=(idle:boolean):NetworkIdleState=>{
      const requests=Object.values(this.pendingRequests).map((request:any)=>({url:request.url||'',method:request.method||'',type:request.resourceType||'',status:request.status||0,awaitingPayload:!!request.awaitingPayload}));
      return {idle,waitedMs:Date.now()-start,pending:requests.length,requests,
        archivePending:{commits:this.commits.size,writes:this.writes.size,fetches:this._fetchPending.size+this.pendingFetches.size,queuedFetches:this._fetchQueue.length}};
    };
    do{
      signal?.throwIfAborted();
      if(Object.keys(this.pendingRequests).length>maxActiveRequests)quietSince=Date.now();
      else if(Date.now()-quietSince>=quietMs)return state(true);
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()-start<maxWaitMs);
    signal?.throwIfAborted();
    return state(false);
  }
  async drain() {
    await Promise.allSettled([...this.pendingFetches]);
    while (this.eventTasks.size || this.commits.size || this.writes.size || this._fetchPending.size) await Promise.allSettled([...this.eventTasks, ...this.commits, ...this.writes, ...this._fetchPending.values()]);
  }
  async close() {
    if (this._fetchQueue.length || this._fetchPending.size) this.errors.push('Capture ended with unfinished supplemental requests');
    this._fetchQueue.length = 0;
    this.fetchAbort.abort();
    try {
      await Promise.allSettled([...this.commits, ...this.writes]);
      if (this.running) await this.detach(); else await this._doDetach();
      this.updateStatus();
      // Includes writes started by upstream flushPending(), page commits and late event tasks.
      // Failures are retained in errors; the engine inspects them only after close returns.
      await this.drain();
    }
    finally { this._doStop(); this.fetchAbort.abort(); }
  }
}
