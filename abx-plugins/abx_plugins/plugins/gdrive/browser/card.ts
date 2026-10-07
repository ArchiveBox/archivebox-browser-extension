import type {ViewContext} from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/gdrive/card.html?raw';
import {cloudCard} from './view-model';
export default async(context:ViewContext)=>cloudCard(context,'gdrive',template);
