import React from 'react';
import type {ArchiveReader} from '../archive/reader';
import {printPDF} from '../archive/print';

/** Opening the full output starts rendering. Only the transient PDF is shown;
 * the source archive and its output folders are never modified. */
export function LazyPDFPreview({archive,url,landscape}:{archive:ArchiveReader;url:string;landscape:boolean}){
  const [pdf,setPDF]=React.useState(''),[error,setError]=React.useState(''),[loaded,setLoaded]=React.useState(false);
  React.useEffect(()=>{
    const controller=new AbortController();let objectURL='';setError('');setPDF('');setLoaded(false);
    void printPDF(archive,url,landscape,controller.signal).then(bytes=>{controller.signal.throwIfAborted();
      objectURL=URL.createObjectURL(new Blob([bytes as BlobPart],{type:'application/pdf'}));setPDF(objectURL);
    }).catch(reason=>{if(!controller.signal.aborted)setError(String(reason))});
    return()=>{controller.abort();if(objectURL)URL.revokeObjectURL(objectURL)};
  },[archive,url,landscape]);
  return <div className="lazy-pdf-preview">{error?<p role="alert">{error}</p>:!loaded&&<progress aria-label="Rendering PDF"/>}{pdf&&<iframe title="Archived PDF" className="extractor-fullscreen pdf-fullscreen" src={`${pdf}#toolbar=1&navpanes=1&view=FitH`} onLoad={()=>setLoaded(true)}/>}</div>;
}
