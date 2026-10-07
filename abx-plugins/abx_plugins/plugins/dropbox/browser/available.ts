import type {ViewContext} from '@/src/archive/views';
import {cloudEvidence} from '../../gdrive/browser/downloads';
export default(context:ViewContext)=>!!cloudEvidence(context,'dropbox')?.files.length;
