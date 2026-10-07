import type {ForumRecord} from '../../abx-plugins/abx_plugins/plugins/forumdl/browser/view';
export function initializeForum(document:Document,records:ForumRecord[],options:{url:string;downloadURL:string;rawURL:string;openFiles:()=>void;resourceURL:(value:string|null,base:string)=>string|undefined}):void;
