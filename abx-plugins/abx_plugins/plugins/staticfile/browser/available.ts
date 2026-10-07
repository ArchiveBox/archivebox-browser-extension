import type {ViewContext} from '@/src/archive/views';
import {originalFile} from './source';
export default (context:ViewContext)=>originalFile(context).then(Boolean);
