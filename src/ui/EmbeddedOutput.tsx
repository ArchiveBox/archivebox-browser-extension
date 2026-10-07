import React from 'react';
import { ArchiveReader } from '../archive/reader';
import { readArchive } from '../archive/storage';
import { captureInfo } from '../archive/capture-info';
import { PluginOutput } from './SnapshotDetail';

/** Standalone full output, opened by a card’s new-tab action. */
export function EmbeddedOutput() {
  const [archive,setArchive]=React.useState<ArchiveReader>();const [error,setError]=React.useState('');
  const params=new URLSearchParams(location.search);const id=params.get('capture')||'';const initial=()=>new URLSearchParams(location.hash.slice(1)).get('view')||params.get('view')||'dom';
  const [name,setName]=React.useState(initial);const source=params.get('source');
  React.useEffect(()=>{const changed=()=>setName(initial());addEventListener('hashchange',changed);return()=>removeEventListener('hashchange',changed)},[]);
  React.useEffect(()=>{document.body.classList.add('plugin-embed');let active=true;
    void (source?ArchiveReader.fromURL(source):readArchive(id).then(file=>ArchiveReader.from(file,id))).then(reader=>{if(active)setArchive(reader)}).catch(reason=>{if(active)setError(String(reason))});
    return()=>{active=false};
  },[id,source]);
  const capture=React.useMemo(()=>archive?captureInfo(archive):undefined,[archive]);
  return error?<p className="error" role="alert">{error}</p>:archive&&capture?<PluginOutput archive={archive} capture={capture} name={name}/>:<p>Loading…</p>;
}
