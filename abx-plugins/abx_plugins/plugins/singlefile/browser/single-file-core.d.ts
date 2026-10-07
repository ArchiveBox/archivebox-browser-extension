declare module 'single-file-core/single-file.js' {
 export function getPageData(options:Record<string,unknown>,initOptions:{fetch:(url:string,options?:RequestInit)=>Promise<Response>},document:Document,window:Window):Promise<{content:string;title:string;filename:string}>;
}
