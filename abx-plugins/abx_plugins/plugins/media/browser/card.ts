import type {ViewContext} from '@/src/archive/views';
import {createYtdlpCardPreview} from '@/src/ui/YtdlpPreview';
export default async function({archive}:ViewContext){return createYtdlpCardPreview({archive}).outerHTML}
