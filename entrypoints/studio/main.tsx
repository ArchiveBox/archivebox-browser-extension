import React from 'react';
import {createRoot} from 'react-dom/client';
import {CaptureEngine} from '@/src/capture/engine';
import {plugins} from '@/src/capture/registry';
import {listCaptures,readArchive,deleteCapture} from '@/src/archive/storage';
import {ArchiveReader} from '@/src/archive/reader';
import {SnapshotDetail,CaptureActivity} from '@/src/ui/SnapshotDetail';
import {EmbeddedOutput} from '@/src/ui/EmbeddedOutput';
import {getSnapshots,mutateSnapshots} from '@/src/lib/storage';
import {createSnapshot} from '@/src/lib/snapshots';
import type {Capture} from '@/src/capture/types';
import './style.css';

const params = new URLSearchParams(location.search);
function App() {
  const [capture,setCapture] = React.useState<Capture>();
  const [archive,setArchive] = React.useState<ArchiveReader>();
  const [captures,setCaptures] = React.useState<Capture[]>([]);
  const [error,setError] = React.useState('');
  const [running,setRunning] = React.useState(false);
  const engine = React.useRef<CaptureEngine | undefined>(undefined);
  const started = React.useRef(false);
  async function open(value:Capture) {
    setCapture(value); setArchive(undefined);
    if(value.state === 'complete' && value.file) setArchive(await ArchiveReader.from(await readArchive(value.id),value.id));
  }
  React.useEffect(() => {
    if(started.current)return; started.current=true;
    void (async () => {
      const id=params.get('id');
      const snapshot=(await getSnapshots()).find(item=>item.id===id);
      if(!snapshot)throw Error('Saved snapshot not found');
      if(params.has('capture') && !snapshot.wacz) {
        setRunning(true);
        await navigator.locks.request(`archivebox-artifacts:${snapshot.id}`,async()=>{
          const target=await chrome.tabs.get(Number(params.get('tab')));
          if(target.url!==snapshot.url)throw Error('The tab navigated before capture.');
          const instance=new CaptureEngine(target.id!,snapshot.url,Object.keys(plugins),value=>setCapture(structuredClone(value)),{},snapshot.id);
          engine.current=instance;
          const value=await instance.run();
          await open(value);
        });
      } else if(snapshot.wacz) await open(snapshot.wacz);
      else throw Error('This URL has no local WACZ. Open its page and archive it from the toolbar.');
      setCaptures(await listCaptures());
    })().catch(err=>setError(String(err))).finally(()=>setRunning(false));
  },[]);
  async function download() {
    if(!capture?.file || capture.state!=='complete')return;
    const blob=await readArchive(capture.id),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`${capture.id}.wacz`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function retry() {
    if(!capture)return;
    const original=(await getSnapshots()).find(item=>item.id===capture.id);
    const fresh=createSnapshot(capture.url,original?.tags||[],capture.title,original?.favIconUrl);
    await mutateSnapshots(entries=>[...entries,fresh]);
    const tab=await chrome.tabs.create({url:capture.url,active:false});
    // The recorder owns navigation; an about:blank tab is also a valid target for a fresh URL.
    location.href=chrome.runtime.getURL(`studio.html?id=${fresh.id}&tab=${tab.id}&capture=1`);
  }
  return <main className="workspace">
    <header className="topbar"><div><h1>ArchiveBox</h1><p>{capture?.url||'Archiving page…'}</p></div><a href="options.html">Saved URLs</a></header>
    {(error||capture?.error)&&<div role="alert" className="error">{error||capture?.error}</div>}
    {capture&&<>
      {archive?<SnapshotDetail archive={archive} capture={capture} captures={captures.filter(item=>item.state==='complete')} onSelectCapture={open} onDownload={download} onIndex={()=>{location.href='options.html'}}/>:<CaptureActivity capture={capture}/>}
      <div className="archive-toolbar">
        {running?<button onClick={()=>void engine.current?.runner.abort()}>Stop capture</button>:<>
          {capture.state==='complete'&&capture.file&&<button onClick={()=>void download()}>Download WACZ</button>}
          <button onClick={()=>void retry().catch(err=>setError(String(err)))}>Archive again</button>
          <button onClick={()=>void deleteCapture(capture.id).then(()=>{location.href='options.html'}).catch(err=>setError(String(err)))}>Delete capture</button>
        </>}
      </div>
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(params.has('embed')?<EmbeddedOutput/>:<App/>);
