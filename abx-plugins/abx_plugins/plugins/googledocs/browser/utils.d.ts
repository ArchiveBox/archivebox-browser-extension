export type GoogleDocument = {kind:'document'|'spreadsheets'|'presentation'|'drawings';id:string;base:string;authuser?:string|null;resourcekey?:string|null;gid?:string|null};
export type Sheet = {id:string;name:string};
export const FORMATS: Record<GoogleDocument['kind'],string[]>;
export function parseDocumentUrl(value:string):GoogleDocument|null;
export function exportUrl(doc:GoogleDocument,format:string):string;
export function discoverSheets(page:{evaluate:(fn:()=>unknown)=>Promise<unknown>}):Promise<Sheet[]>;
export function validateExport(body:Uint8Array,format:string,mimeType:string):void;
