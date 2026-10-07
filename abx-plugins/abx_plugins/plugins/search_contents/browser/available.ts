import type {ViewContext} from '@/src/archive/views';
export default function({archive}:ViewContext){return !!archive.artifact('index')}
