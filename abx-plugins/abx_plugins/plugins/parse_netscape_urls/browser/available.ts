import type {ViewContext} from '@/src/archive/views';
import {bookmarkSources} from './sources';
export default (context:ViewContext)=>bookmarkSources(context).then(sources=>sources.length>0);
