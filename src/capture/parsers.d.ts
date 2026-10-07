declare module 'linkedom/worker' { export {DOMParser,parseHTML} from 'linkedom'; }
declare module 'm3u8-parser' {
  export class Parser { constructor(options?:{url?:string;mainDefinitions?:Record<string,string>}); push(source:string):void; end():void; manifest:any; }
}
declare module 'mpd-parser' { export function parse(source:string,options:{manifestUri:string;eventHandler?:(event:{type:string;message:string})=>void}):any; }
