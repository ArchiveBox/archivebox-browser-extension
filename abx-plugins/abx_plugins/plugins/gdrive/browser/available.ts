import type {ViewContext} from '@/src/archive/views';
import {cloudEvidence} from './downloads';
export default(context:ViewContext)=>!!cloudEvidence(context,'gdrive')?.files.length;
