import type {ArchiveEntry} from '../archive/reader';
import type {DocumentSource} from '../../abx-plugins/abx_plugins/plugins/liteparse/browser/view';
export function initializeLiteParse(document:Document,sources:DocumentSource[],options:{url:string;openFiles:()=>void;resourceURL:(entry:ArchiveEntry)=>string;originalPDF:(source:DocumentSource)=>Promise<string>}):()=>void;
