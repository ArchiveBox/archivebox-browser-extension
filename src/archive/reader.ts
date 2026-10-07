import { ZipRangeReader, createLoader } from '@webrecorder/wabac';
import { createSHA256 } from 'hash-wasm';
import { WARCParser } from 'warcio';
import { warcRanges } from './warc-ranges';
import {integrityTree} from './integrity';
import { playerURL, replayCommand } from '../replay/client';
import {readCaptureMetadata,type CaptureMetadata} from './metadata';
export type ArchiveEntry = {
  url: string; timestamp: string; ts: number; mime: string; status: number; method?: string;
  digest: string; filename: string; offset: number; length: number;
  native?:boolean;path?:string;
};
export type ArchivedResource = { entry: ArchiveEntry; body: Uint8Array; headers: Record<string, string>; warcHeaders: Record<string, string> };
export type IntegrityResult = { path: string; expected: string; actual: string; valid: boolean };
export type ArchivedExchange = {url:string;method:string;statusLine:string;requestHeaders:Record<string,string>|null;responseHeaders:Record<string,string>;requestBody:Uint8Array|null;metadata:Record<string,any>};
const decoder = new TextDecoder();
export class ArchiveReader {
  readonly entries: ArchiveEntry[] = [];
  readonly pages: any[] = [];
  manifest: any;
  metadata?:CaptureMetadata;
  replayHash?: string;
  size = 0;
  private zip: ZipRangeReader;
  private headerReads=new Map<string,ReturnType<ArchiveReader['readHeaders']>>();
  private exchangeReads=new Map<string,Promise<ArchivedExchange>>();
  private smallBodies=new Map<string,Uint8Array>();
  private smallBodyBytes=0;
  private constructor(readonly file: Blob | undefined, readonly captureId?: string, readonly sourceUrl?: string, loader?: Awaited<ReturnType<typeof createLoader>>) {
    if (loader) { this.zip = new ZipRangeReader(loader); return; }
    if (!file) throw Error('Archive requires a file or range loader');
    this.size = file.size;
    // Native Blob slicing keeps large archived media out of memory until requested.
    const getRange = async (offset: number, length: number, streaming = false) => {
      const slice = file.slice(offset, offset + length);
      return streaming ? slice.stream() : new Uint8Array(await slice.arrayBuffer());
    };
    this.zip = new ZipRangeReader({
      canLoadOnDemand: true, canDoNegativeRange: true, headers: {}, length: file.size, isValid: true,
      getLength: async () => file.size, getRange,
      getRangeFromEnd: (length: number, streaming: boolean) => getRange(Math.max(0, file.size - length), Math.min(length, file.size), streaming),
      getFullBuffer: () => null,
      doInitialFetch: async (head: boolean) => ({ response: new Response(head ? null : file.stream()), abort: null }),
    });
  }
  private async member(name: string) {
    const { reader } = await this.zip.loadFile(name);
    return reader.readFully();
  }
  static async from(file: Blob, captureId?: string) {
    const archive = new ArchiveReader(file, captureId);
    return archive.initialize();
  }
  static async fromURL(source: string) {
    const url = new URL(source, document.baseURI);
    if (!/^https?:$/.test(url.protocol)) throw Error('Use an HTTP or HTTPS WACZ URL');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url.href)))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
    const loader = await createLoader({url: url.href});
    const size = await loader.getLength();
    const archive = new ArchiveReader(undefined, id, url.href, loader);
    archive.size = size;
    return archive.initialize();
  }
  private async initialize() {
    const archive = this;
    const files = await archive.zip.load();
    if (!files['datapackage.json']) throw Error('Missing WACZ datapackage.json');
    archive.manifest = JSON.parse(decoder.decode(await archive.member('datapackage.json')));
    archive.metadata = await readCaptureMetadata(archive.manifest,name=>archive.member(name));
    // Package-only inspection is available before import. Resource discovery and
    // replay both use the same mounted upstream MultiWACZ collection.
    if (archive.captureId) {
      const result = await replayCommand({ type: 'inspect-wacz', id: archive.captureId, sourceUrl: archive.sourceUrl }) as {
        ok?: boolean; error?: string; hash?: string; entries?: ArchiveEntry[]; pages?: any[];
      };
      if (!result?.ok) throw Error(result?.error || 'Unable to inspect the replay collection');
      archive.replayHash = result.hash;
      archive.entries.push(...result.entries || []);
      archive.pages.push(...(result.pages || []).map(page => ({ ...page,
        ts: typeof page.ts === 'number' ? new Date(page.ts).toISOString() : page.ts || page.date || page.datetime,
      })));
      if (!archive.entries.length) throw Error('Archive has no indexed records');
    }
    return archive;
  }
  find(url: string, ts?: number) {
    // HTTP fragments identify locations within a response, while evidence URNs
    // retain their complete target as an exact record identity.
    const target = /^https?:/i.test(url) ? url.split('#')[0] : url;
    const entries = this.entries.filter(entry => entry.url === target);
    return ts === undefined ? entries.at(-1) : entries.find(entry => entry.ts === ts);
  }
  artifact(kind: string) { return this.entries.filter(entry => entry.url.startsWith(`urn:${kind}:`)).sort((a,b) => a.ts-b.ts).at(-1); }
  exchange(entry:ArchiveEntry):Promise<ArchivedExchange> {
    const key=`${entry.filename}:${entry.offset}`;
    let result=this.exchangeReads.get(key);
    if(!result){result=this.readExchange(entry);this.exchangeReads.set(key,result);result.catch(()=>this.exchangeReads.delete(key))}
    return result;
  }
  private async readExchange(entry:ArchiveEntry):Promise<ArchivedExchange> {
    // CDX points to the response member. The exporter puts its original request
    // immediately after it; verify WARC identity before associating the pair.
    const filename=entry.filename.startsWith('archive/')?entry.filename:`archive/${entry.filename}`;
    const load=(offset:number,length:number)=>this.zip.loadFile(filename,{offset,length});
    const response=await new WARCParser(warcRanges(load,entry.offset,entry.length)).parse();
    if(!response||!['response','revisit'].includes(response.warcType||''))throw Error('No HTTP response at indexed WARC location');
    const result:ArchivedExchange={url:response.warcTargetURI||entry.url,method:entry.method||'GET',statusLine:response.httpHeaders?.statusline||String(entry.status),requestHeaders:null,responseHeaders:Object.fromEntries(response.httpHeaders?.headers||[]),requestBody:null,metadata:JSON.parse(response.warcHeader('WARC-JSON-Metadata')||'{}')};
    const offset=entry.offset+entry.length;
    const next=this.entries.filter(item=>item.filename===entry.filename&&item.offset>=offset).sort((a,b)=>a.offset-b.offset)[0];
    const files=await this.zip.load();
    const end=next?.offset??files[filename]?.uncompressedSize;
    if(end===undefined||end<=offset)return result;
    const request=await new WARCParser(warcRanges(load,offset,end-offset)).parse();
    if(request?.warcType==='request'&&request.warcTargetURI===response.warcTargetURI&&request.warcDate===response.warcDate&&request.warcHeader('WARC-Concurrent-To')===response.warcHeader('WARC-Record-ID')){
      result.method=request.httpHeaders?.method||result.method;
      result.requestHeaders=Object.fromEntries(request.httpHeaders?.headers||[]);
      result.requestBody=await request.readFully();
    }
    return result;
  }
  headers(entry:ArchiveEntry) {
    const key=entry.native?`${entry.url}:${entry.ts}`:`${entry.filename}:${entry.offset}`;
    let result=this.headerReads.get(key);
    if(!result){result=this.readHeaders(entry);this.headerReads.set(key,result);result.catch(()=>this.headerReads.delete(key))}
    return result;
  }
  private async readHeaders(entry: ArchiveEntry) {
    if (!this.captureId) throw Error('Resource access requires a mounted WACZ');
    const result = await replayCommand({ type: 'wacz-record', id: this.captureId,
      url: entry.url, ts: entry.ts,
    }) as { ok?: boolean; error?: string; url?: string; headers?: Record<string, string>; extraOpts?: Record<string, unknown>;body?:number[];image?:{width:number;height:number} };
    if (!result?.ok) throw Error(result?.error || 'Unable to read archived response headers');
    if(result.body){
      const key=`${entry.filename}:${entry.offset}`,body=new Uint8Array(result.body);
      this.smallBodies.set(key,body);this.smallBodyBytes+=body.byteLength;
      while(this.smallBodyBytes>8*1024*1024||this.smallBodies.size>1024){const [old,bytes]=this.smallBodies.entries().next().value!;this.smallBodies.delete(old);this.smallBodyBytes-=bytes.byteLength}
    }
    // Upstream preserves WARC-JSON-Metadata as extraOpts. Retain this legacy
    // plugin-facing field without independently parsing or inventing WARC headers.
    const warcHeaders: Record<string, string> = {};
    if (result.extraOpts) warcHeaders['WARC-JSON-Metadata'] = JSON.stringify(result.extraOpts);
    return { url: result.url || entry.url, headers: Object.fromEntries(Object.entries(result.headers || {}).map(([key, value]) => [key.toLowerCase(), value])), warcHeaders, image:result.image };
  }
  async read(entry: ArchiveEntry): Promise<ArchivedResource> {
    if (!this.captureId) throw Error('Resource access requires a mounted WACZ');
    const metadata = await this.headers(entry);
    const body=this.smallBodies.get(`${entry.filename}:${entry.offset}`);
    if(body)return {entry,body,...metadata};
    const response = await fetch(playerURL(`plugin-record/${this.captureId}/${entry.ts}/${encodeURIComponent(entry.url)}`));
    if (!response.ok) throw Error(`Unable to read archived response: ${response.status} ${await response.text()}`);
    return { entry, body: new Uint8Array(await response.arrayBuffer()), ...metadata };
  }
  async text(entry: ArchiveEntry) { return decoder.decode((await this.read(entry)).body); }
  async json<T = any>(entry: ArchiveEntry): Promise<T> { return JSON.parse(await this.text(entry)); }
  documentEntry() {
    // pages.jsonl identifies the browser document, including its exact response
    // timestamp. Supplemental extractors may fetch different HTML at the same
    // URL, and a final history URL need not have been a browser navigation.
    for(const page of [...this.pages].sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts))){
      const entry=this.find(page.url,Date.parse(page.ts));
      if(entry&&/^https?:/.test(entry.url)&&/html/i.test(entry.mime))return entry;
    }
    const pageUrl = this.metadata?.url;
    const entry=pageUrl?this.find(pageUrl):undefined;
    return entry&&/^https?:/.test(entry.url)&&/html/i.test(entry.mime)?entry:this.entries.find(item=>/^https?:/.test(item.url)&&/^(text\/html|application\/xhtml\+xml)/i.test(item.mime));
  }
  async sourceDOM(): Promise<Document> {
    const entry = this.documentEntry();
    if (!entry) throw Error('This capture has no HTML document');
    const record = await this.read(entry);
    const document = new DOMParser().parseFromString(decoder.decode(record.body), 'text/html');
    let baseURI = entry.url;
    const metadata = record.warcHeaders['WARC-JSON-Metadata'] || record.warcHeaders['warc-json-metadata'];
    if (metadata) { const evidence = JSON.parse(metadata); baseURI = evidence.baseURI || evidence.sourceUrl || baseURI; }
    const base = document.querySelector('base') || document.createElement('base');
    base.setAttribute('href', new URL(base.getAttribute('href') || baseURI, baseURI).href);
    document.head.prepend(base);
    return document;
  }
  async dom(): Promise<Document> {
    const {renderedDOM}=await import('./rendered-dom');
    return renderedDOM(this);
  }
  integrityTree(options?:{includeRecords?:boolean}){return integrityTree(this,options)}
  async verifyPackage(): Promise<IntegrityResult[]> {
    const checks: IntegrityResult[] = [];
    const digest = JSON.parse(decoder.decode(await this.member('datapackage-digest.json')));
    for (const resource of [...this.manifest.resources, { path: 'datapackage.json', hash: digest.hash }]) {
      const hasher = await createSHA256(); hasher.init();
      const { reader } = await this.zip.loadFile(resource.path);
      for await (const chunk of reader) hasher.update(chunk);
      const actual = `sha256:${hasher.digest('hex')}`;
      checks.push({ path: resource.path, expected: resource.hash, actual, valid: actual === resource.hash.replace('sha-256:', 'sha256:') });
    }
    return checks;
  }
}
