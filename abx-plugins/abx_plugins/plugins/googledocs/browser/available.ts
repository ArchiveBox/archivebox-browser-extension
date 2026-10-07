import type {ViewContext} from '@/src/archive/views';
import {exportEvidence} from './model';
export default (context:ViewContext)=>!!exportEvidence(context)?.exports.length;
