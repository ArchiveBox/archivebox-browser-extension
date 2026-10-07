import { archiveFileHandle } from '../archive/storage';
import { SWReplay, ArchiveDB, SingleRecordWARCLoader, getTSMillis, type RemoteResourceEntry } from '@webrecorder/wabac/swlib';
import { warcRanges } from '../archive/warc-ranges';
import {readCaptureMetadata,type PluginFile} from '../archive/metadata';
import {imageSize} from 'image-size';

// Public operations on the MultiWACZ store supplied by SWCollections. No second
// CDX parser, WARC parser, revisit resolver, or resource persistence layer.
type IndexBlock = { waczname: string; prefix: string; filename: string; offset: number; length: number; loaded: boolean };
interface PluginWACZStore extends ArchiveDB {
  waczfiles: Record<string, unknown>;
  waczNameForHash: Record<string, string>;
  loadIndex(name: string): Promise<unknown>;
  doCDXLoad(key: string, block: IndexBlock, name: string): Promise<void>;
  loadFileFromNamedWACZ(name: string, filename: string, options: { offset?: number; length?: number }): Promise<{ reader: { readFully(): Promise<Uint8Array> } }>;
}

/** Extend Webrecorder replay with read-only plugin evidence queries. */
export class PluginReplay extends SWReplay {
  private mounting = new Map<string, Promise<PluginWACZStore>>();
  private indexed = new Map<string, Promise<void>>();
  private nativeFiles = new Map<string,Promise<(PluginFile&{wacz:string})[]>>();

  private files(id:string,store:PluginWACZStore){
    let files=this.nativeFiles.get(id);
    if(!files){files=(async()=>{
      const result:(PluginFile&{wacz:string})[]=[];
      for(const wacz of Object.keys(store.waczfiles)){
        const {reader}=await store.loadFileFromNamedWACZ(wacz,'datapackage.json',{});
        const data=JSON.parse(new TextDecoder().decode(await reader.readFully()));
        const metadata=await readCaptureMetadata(data,async path=>{
          const {reader}=await store.loadFileFromNamedWACZ(wacz,path,{});return reader.readFully();
        });
        for(const file of metadata?.files||[]){
          if(!String(file.url).startsWith('urn:'))throw Error('Generated file index must retain its original evidence URN');
          if(file.path&&(file.path.startsWith('/')||file.path.split('/').some((part:string)=>!part||part==='.'||part==='..')))throw Error('Invalid plugin file path');
          if(!file.path&&!file.record)throw Error('Plugin file is missing its stored body reference');
          result.push({...file,wacz});
        }
      }
      return result;
    })();this.nativeFiles.set(id,files);files.catch(()=>this.nativeFiles.delete(id))}
    return files;
  }

  async mount(id: string, sourceUrl?: string): Promise<PluginWACZStore> {
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(id)) throw Error('Invalid capture ID');
    await this.collections.inited;
    if (!this.mounting.has(id)) this.mounting.set(id, (async () => {
      let collection = await this.collections.getColl(id);
      if (!collection) {
        let file;
        if (sourceUrl) {
          const source = new URL(sourceUrl);
          if (!/^https?:$/.test(source.protocol)) throw Error('A remote WACZ requires HTTP or HTTPS');
          file = { sourceUrl: source.href, name: source.pathname.split('/').at(-1) || `${id}.wacz`, noCache: true };
        } else {
          const fileHandle = await archiveFileHandle(id);
          const blob = await fileHandle.getFile();
          file = { sourceUrl: `file:///${id}.wacz`, name: blob.name, size: blob.size, extra: { fileHandle }, noCache: true };
        }
        const result = await this.collections.addCollection({ name: id,
          file,
          extraConfig: { liveRedirectOnNotFound: false },
        }, () => {});
        if (!result) throw Error('Unable to mount WACZ replay');
        collection = await this.collections.getColl(id);
      }
      if (!collection) throw Error('Replay collection unavailable');
      const store = collection.store as PluginWACZStore;
      await store.initing;
      return store;
    })().catch(error => { this.mounting.delete(id); throw error; }));
    return this.mounting.get(id)!;
  }

  async command(message: { type: string; id: string; sourceUrl?: string; url?: string; ts?: number }) {
    switch (message.type) {
      case 'unmount-wacz': await this.unmount(message.id); return { ok: true };
      case 'inspect-wacz': await this.mount(message.id, message.sourceUrl); return this.inspect(message.id);
      case 'wacz-record': return this.metadata(message.id, message.url!, message.ts!);
      case 'mount-wacz': { const store = await this.mount(message.id, message.sourceUrl); return { ok: true, hash: Object.keys(store.waczNameForHash)[0] }; }
      default: throw Error('Unknown replay operation');
    }
  }

  async unmount(id: string) {
    await this.collections.inited;
    await this.collections.deleteColl(id);
    this.mounting.delete(id); this.indexed.delete(id);this.nativeFiles.delete(id);
  }

  private async loadPluginIndex(id: string, store: PluginWACZStore) {
    if (!this.indexed.has(id)) this.indexed.set(id, (async () => {
      for (const name of Object.keys(store.waczfiles)) await store.loadIndex(name);
      // Full reports ask for every indexed record. Ordinary replay retains upstream
      // lazy block lookup. Use the upstream IDX loader for compressed index members.
      const db = store.db!;
      if (db.objectStoreNames.contains('ziplines' as never)) {
        const blocks = await db.getAll('ziplines' as never) as IndexBlock[];
        for (const block of blocks) if (!block.loaded) await store.doCDXLoad(`${block.waczname}:${block.filename}:${block.offset}`, block, block.waczname);
      }
    })().catch(error => { this.indexed.delete(id); throw error; }));
    await this.indexed.get(id);
  }

  async inspect(id: string) {
    const store = await this.mount(id); await this.loadPluginIndex(id, store);
    const resources = await store.db!.getAll('resources');
    const native=await this.files(id,store);
    return { ok: true, hash: Object.keys(store.waczNameForHash)[0], pages: await store.getAllPages(), entries: [...resources.filter(entry=>entry.source).map(entry => ({
      url: entry.url, ts: entry.ts, timestamp: getTSMillis(new Date(entry.ts).toISOString()),
      mime: entry.mime || '', status: entry.status || 0, digest: entry.digest || '', method: entry.method || 'GET',
      filename: entry.source?.path || '', offset: entry.source?.start || 0, length: entry.source?.length || 0,
    })),...native.map(file=>({url:file.url,ts:file.ts,timestamp:getTSMillis(new Date(file.ts).toISOString()),mime:file.mime,status:file.status,digest:file.hash,method:'GET',filename:file.path||'',offset:0,length:file.bytes,native:true,path:file.path}))] };
  }

  private async record(id: string, url: string, ts: number) {
    const store = await this.mount(id); await this.loadPluginIndex(id, store);
    // Plugin references already contain the exact CDX identity. Replay's URL
    // normalization can decode/truncate POST query keys; it is inappropriate
    // when inspecting the original exchange, including literal trailing '%'.
    const entry = await store.db!.get('resources', IDBKeyRange.only([url, ts]));
    if (!entry?.source || entry.url !== url || entry.ts !== ts) throw Error(`No exact archived record: ${url} @ ${ts}`);
    return { store, entry: entry as RemoteResourceEntry };
  }

  async metadata(id: string, url: string, ts: number) {
    const mounted=await this.mount(id),file=(await this.files(id,mounted)).find(file=>file.url===url&&file.ts===ts);
    if(file)return {ok:true,url:file.url,headers:file.headers,extraOpts:file.metadata};
    const { store, entry } = await this.record(id, url, ts);
    const { start, length, path, wacz } = entry.source;
    const source = warcRanges((offset, length) => store.loadFileFromNamedWACZ(wacz!, `archive/${path}`, { offset, length }), start, length);
    const remote = await new SingleRecordWARCLoader(source).load();
    if (!remote) throw Error('Archived record could not be read');
    // A small response's compressed member has already been read for its
    // headers. Keep its original bytes with that read instead of seeking and
    // inflating the same member again when an extractor requests the body.
    // Large responses and revisits retain upstream streaming/resolution.
    const declared=new Headers(remote.respHeaders||{}).get('content-length');
    let body:number[]|undefined;
    if(!remote.origURL&&length<=64*1024&&declared!==null&&/^\d+$/.test(declared)&&Number(declared)<=64*1024){
      const payload=remote.payload||await remote.reader?.readFully();
      if(payload&&payload.byteLength<=64*1024)body=Array.from(payload);
    }
    let image: {width:number;height:number}|undefined;
    if(!remote.origURL&&/^image\//i.test(remote.mime||'')&&!new Headers(remote.respHeaders||{}).has('content-encoding')){
      // Inspect only the first payload chunk already reached by the header
      // parser. No pixel decoding or full-image read for card availability.
      let prefix=body?new Uint8Array(body):remote.payload;
      if(!prefix&&remote.reader)for await(const chunk of remote.reader){prefix=chunk;break}
      if(prefix)try{const {width,height}=imageSize(prefix);image={width,height}}catch{/* Incomplete/unsupported image header: keep eligibility unknown. */}
    }
    return { ok: true, url: remote.url, headers: remote.respHeaders || {}, extraOpts: remote.extraOpts || {},body,image };
  }

  override async handleFetch(event: Parameters<SWReplay['handleFetch']>[0]): Promise<Response> {
    const prefix = new URL('plugin-record/', this.prefix).href;
    if (!event.request.url.startsWith(prefix)) {
      let response=await super.handleFetch(event);
      const replayPrefix=new URL('w/',this.prefix).href;
      // Chromium refuses extension-scheme HTTP redirects. Resolve their recorded
      // destinations through the same upstream collection, without a network
      // fetch or changing the archived exchange shown by the Responses viewer.
      if(this.prefix.startsWith('chrome-extension:')&&event.request.url.startsWith(replayPrefix)&&event.request.redirect==='follow'&&['GET','HEAD'].includes(event.request.method)){
        const collectionPrefix=event.request.url.slice(0,event.request.url.indexOf('/',replayPrefix.length)+1);
        let request=event.request;const visited=new Set([request.url]);
        while([301,302,303,307,308].includes(response.status)&&response.headers.has('location')){
          const target=new URL(response.headers.get('location')!,request.url).href;
          if(!target.startsWith(collectionPrefix))break;
          await response.body?.cancel();
          if(visited.has(target)||visited.size>20)return new Response('Archived redirect cycle or limit exceeded',{status:502,headers:{'Cache-Control':'no-store'}});
          visited.add(target);request=new Request(target,request);
          response=await super.getResponseFor(request,event);
        }
      }
      // Replay URLs contain the collection, WACZ hash and capture timestamp.
      // Original server freshness rules do not describe these immutable bytes.
      if(response.ok&&event.request.url.startsWith(replayPrefix)&&/\/:\w+\/\d+[a-z]+_\//.test(event.request.url)){
        const headers=new Headers(response.headers);
        headers.set('Cache-Control','private, max-age=31536000, immutable');
        headers.delete('Expires');headers.delete('Pragma');
        return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
      }
      return response;
    }
    try {
      const [id, ts, ...url] = event.request.url.slice(prefix.length).split('/');
      if (!id || !ts) return new Response('Missing record reference', { status: 400 });
      const mounted=await this.mount(id),target=decodeURIComponent(url.join('/'));
      const file=(await this.files(id,mounted)).find(file=>file.url===target&&file.ts===Number(ts));
      if(file){
        let payload:Uint8Array;
        if(file.path){const {reader}=await mounted.loadFileFromNamedWACZ(file.wacz,file.path,{});payload=await reader.readFully()}
        else {const {store,entry}=await this.record(id,file.record!.url,file.record!.ts),body=await store.loadPayload(entry,{});if(!body)throw Error('Referenced evidence body is unavailable');payload=body instanceof Uint8Array?body:await body.readFully()}
        return new Response(payload as BodyInit,{headers:{'Content-Type':file.mime,'Content-Length':String(payload.byteLength),'Cache-Control':'private, max-age=31536000, immutable','ETag':`"${file.hash}"`,'Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"}});
      }
      const { store, entry } = await this.record(id, decodeURIComponent(url.join('/')), Number(ts));
      const payload = await store.loadPayload(entry, {});
      if (!payload) throw Error(`Archived payload could not be loaded: ${entry.url}`);
      const body = payload instanceof Uint8Array ? payload : payload.getReadableStream();
      // A raw evidence endpoint: redirect/error status remains in metadata, while
      // these bytes are delivered without replay decoding or content rewriting.
      return new Response(body as BodyInit | null, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable',...(entry.digest?{'ETag':`"${entry.digest}"`}:{}) } });
    } catch (error) { return new Response(String(error), { status: 404,headers:{'Cache-Control':'no-store'} }); }
  }
}
