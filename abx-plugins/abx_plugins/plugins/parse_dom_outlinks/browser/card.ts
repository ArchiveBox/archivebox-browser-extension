import type {ViewContext} from '@/src/archive/views';
import {canonicalCard} from '@/src/archive/cards';
import view from './view';
export default (context:ViewContext)=>canonicalCard(view,context);
