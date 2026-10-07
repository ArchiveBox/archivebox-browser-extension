import React from 'react';
import type {ArchiveEntry,ArchiveReader} from '../archive/reader';
import {mountReplay} from '../archive/replay';
import template from '../../vendor/archivebox/plugins/papersdl/full.html?raw';

/** Native PDF downloads bypass service workers. A transient URL of the actual
 * archived bytes keeps the canonical viewer's toolbar working offline. */
export function PaperPreview({archive,entry,markup=template}:{archive:ArchiveReader;entry?:ArchiveEntry;markup?:string}){
  const [html,setHTML]=React.useState(''),[error,setError]=React.useState('');
  React.useEffect(()=>{let current=true,source:string|undefined;setHTML('');setError('');
    if(entry)void mountReplay(archive).then(()=>archive.read(entry)).then(({body})=>{
      if(!current)return;
      source=URL.createObjectURL(new Blob([body as BlobPart],{type:'application/pdf'}));
      setHTML(markup.replace('{{ output_path }}',source));
    }).catch(reason=>{if(current)setError(String(reason))});
    return()=>{current=false;if(source)URL.revokeObjectURL(source)};
  },[archive,entry,markup]);
  if(error)return <p className="error">{error}</p>;
  return <div dangerouslySetInnerHTML={{__html:html}}/>;
}
