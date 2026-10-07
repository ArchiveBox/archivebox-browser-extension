import type {ViewContext} from '@/src/archive/views';
import template from '@/vendor/archivebox/plugins/dropbox/card.html?raw';
import {cloudCard} from '../../gdrive/browser/view-model';
export default async(context:ViewContext)=>cloudCard(context,'dropbox',template);
