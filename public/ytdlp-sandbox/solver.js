// This page has an opaque sandbox origin, no extension privileges and no network.
addEventListener('message', event => {
  if(event.source !== parent || event.data?.type !== 'ytdlp-solve')return;
  const {id,source}=event.data;
  try {
    let output='';
    const solverConsole=Object.freeze({log:value=>{output+=String(value)+'\n';},warn:()=>{},error:()=>{}});
    new Function('console',source)(solverConsole);
    parent.postMessage({type:'ytdlp-result',id,output},'*');
  }catch(error){parent.postMessage({type:'ytdlp-result',id,error:String(error)},'*');}
});
