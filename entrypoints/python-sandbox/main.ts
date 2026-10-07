// A manifest sandbox has an opaque origin and no extension APIs. Its blob
// worker inherits this page's CSP, including connect-src for packaged assets
// only. Neither imported Python expressions nor native dependencies can fetch
// an original site; all legitimate reads cross the recorded-response bridge.
let worker:Worker|undefined,session:string|undefined;
addEventListener('message',event=>{
  if(event.source!==parent)return;
  const data=event.data;
  if(data?.type==='python-sandbox-start'&&!worker){
    session=data.session;
    const source=`self.addEventListener('securitypolicyviolation',event=>self.postMessage({type:'log',message:'Python sandbox blocked '+event.violatedDirective+': '+event.blockedURI})); import(${JSON.stringify(data.workerURL)}).then(()=>self.postMessage({type:'sandbox-bootstrap-ready'})).catch(error=>self.postMessage({type:'sandbox-bootstrap-error',error:String(error)}));`;
    const script=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    // Chromium rejects a top-level module worker from an opaque sandbox. A
    // same-origin blob classic bootstrap can import the bundled ESM engine.
    try{worker=new Worker(script);}catch(error){parent.postMessage({type:'python-sandbox-error',session,error:String(error)},'*');return;}
    worker.onmessage=event=>{if(event.data?.type==='sandbox-bootstrap-ready')parent.postMessage({type:'python-sandbox-started',session},'*');else if(event.data?.type==='sandbox-bootstrap-error')parent.postMessage({type:'python-sandbox-error',session,error:event.data.error},'*');else parent.postMessage({type:'python-sandbox-message',session,message:event.data},'*');};
    worker.onerror=event=>parent.postMessage({type:'python-sandbox-error',session,error:event.message||'Isolated worker failed before its module initialized'},'*');
    worker.onmessageerror=()=>parent.postMessage({type:'python-sandbox-error',session,error:'Unreadable isolated Python worker message'},'*');
  }else if(data?.type==='python-sandbox-message'&&data.session===session){
    worker?.postMessage(data.message);
  }
});
parent.postMessage({type:'python-sandbox-ready'},'*');
