import type {YtdlpFile} from '../../abx-plugins/abx_plugins/plugins/ytdlp/browser/view';
export type RenderedMediaFile=YtdlpFile&{url:string};
export function initializeYtdlp(document:Document,files:RenderedMediaFile[],options:{selectedURL?:string;files:()=>void;download:(url:string)=>void;resolve:(file:RenderedMediaFile,onProgress:(message:string)=>void)=>Promise<string>;read:(file:RenderedMediaFile)=>Promise<string>;stream:(video:HTMLVideoElement,file:RenderedMediaFile,onError:(message:string)=>void)=>Promise<()=>void>}):Promise<()=>void>;
