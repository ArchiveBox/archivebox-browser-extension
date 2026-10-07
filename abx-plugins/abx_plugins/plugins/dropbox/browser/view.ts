import type {ViewContext} from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/dropbox/full.html?raw';
import {cloudView} from '../../gdrive/browser/view-model';
export default async(context:ViewContext)=>cloudView(context,'dropbox',template);
