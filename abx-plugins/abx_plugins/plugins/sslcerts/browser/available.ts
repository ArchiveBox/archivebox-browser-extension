import type {ViewContext} from '@/src/archive/views';
export default ({archive}:ViewContext)=>!!archive.artifact('sslcerts');
