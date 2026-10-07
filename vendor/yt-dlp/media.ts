/** Use upstream extractor output directly; no site parsing or format selection
 * lives here. DASH extractors can enumerate fragment paths without a playlist. */
export function mediaMime(ext:string){
 return ({webm:'video/webm',mp4:'video/mp4',m4v:'video/mp4',m4a:'audio/mp4',mkv:'video/x-matroska',mp3:'audio/mpeg',aac:'audio/aac',ogg:'audio/ogg',oga:'audio/ogg',opus:'audio/ogg',wav:'audio/wav',flac:'audio/flac'} as Record<string,string>)[ext]||'application/octet-stream';
}
export function formatResources(format:any):{url:string;headers:Record<string,string>}[]{
 if(format.has_drm)throw Error('DRM-protected media cannot be acquired');
 const headers=format.http_headers||{};
 if(format.fragments?.length)return format.fragments.map((fragment:any)=>{
  if(fragment.range||fragment.byte_range)throw Error('Byte-ranged extractor fragments require their upstream downloader');
  const url=fragment.url||(fragment.path&&new URL(fragment.path,format.fragment_base_url||format.url).href);
  if(!url||!/^https?:/.test(url))throw Error('Fragment has no original HTTP URL');
  return {url,headers};
 });
 if(!format.url||!/^https?:/.test(format.url))throw Error(`Unsupported media transport: ${format.protocol||format.url||'unknown'}`);
 return [{url:format.url,headers}];
}
