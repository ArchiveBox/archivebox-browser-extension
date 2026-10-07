export class Downloader {
  constructor(options: any);
  db: import('@webrecorder/wabac/swlib').ArchiveDB;
  firstResources: any[];
  fileStats: {filename:string;size:number;hash?:string}[];
  iterResources(resources:any[]): AsyncGenerator<any>;
  addFile(zip:any[],filename:string,generator:AsyncIterable<Uint8Array|string>,sizeCallback?:((size:number)=>void)|null):void;
  addExtraFiles(zip:any[],sizeCallback?:((size:number)=>void)|null):Promise<void>;
  shouldExportWARCResource(resource:any):boolean;
  getDataPackageMetadata(): Record<string, unknown>;
  download(sizeCallback?: (size: number) => void): Promise<Response>;
}
