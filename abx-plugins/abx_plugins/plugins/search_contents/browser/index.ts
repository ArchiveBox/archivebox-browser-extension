import type MiniSearch from 'minisearch';
import type {RecordRef} from '@/src/capture/types';
export type SearchDocument={id:number;url:string;title:string;mime:string;ref:RecordRef;ocr?:RecordRef};
export type SearchIndex={version:1;engine:'MiniSearch 7.2.0';documents:SearchDocument[];index:ReturnType<MiniSearch['toJSON']>};
export const searchOptions={fields:['title','text'],searchOptions:{combineWith:'AND' as const,prefix:true,boost:{title:2}}};
