import metadata from '../../vendor/archivebox/presentation.json';
import { plugins } from '../capture/registry';
const cards = import.meta.glob('../../vendor/archivebox/plugins/*/card.html', {eager:true,query:'?raw',import:'default'}) as Record<string,string>;
export function cardTemplate(name:string){return cards[`../../vendor/archivebox/plugins/${name}/card.html`];}
const icons = import.meta.glob('../../vendor/archivebox/plugins/*/icon.html', {eager:true,query:'?raw',import:'default'}) as Record<string,string>;
export const outputGroups = [
  {id:'html',label:'HTML'}, {id:'raster',label:'Raster'}, {id:'article_text',label:'Article text'},
  {id:'embedded_media',label:'Embedded media'}, {id:'metadata',label:'Metadata'}, {id:'other',label:'Other files'},
];
type Presentation = {title?:string;snapshot_display_name?:string;snapshot_output_group?:string;snapshot_output_order?:number;card_hidden?:boolean;snapshot_primary_preview?:boolean};
export function presentation(name:string) { return (metadata as Record<string,Presentation>)[name] || {}; }
export function pluginName(name:string) {const config=presentation(name);return config.snapshot_display_name || config.title || plugins[name]?.title || name.replaceAll('_',' ');}
export function pluginIcon(name:string) {return icons[`../../vendor/archivebox/plugins/${name}/icon.html`] || '📄';}
export function orderedPlugins(names:string[]) {
  return names.filter(name=>!presentation(name).card_hidden).sort((a,b)=>{
    const aa=presentation(a),bb=presentation(b);
    const ga=outputGroups.findIndex(g=>g.id===(aa.snapshot_output_group||'other'));
    const gb=outputGroups.findIndex(g=>g.id===(bb.snapshot_output_group||'other'));
    return ga-gb || (aa.snapshot_output_order??Infinity)-(bb.snapshot_output_order??Infinity) || a.localeCompare(b);
  });
}
