import type {ViewContext} from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/gdrive/full.html?raw';
import {cloudView} from './view-model';
export default async(context:ViewContext)=>cloudView(context,'gdrive',template);
