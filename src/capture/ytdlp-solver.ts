/** Evaluate upstream EJS only in an opaque, network-disabled extension sandbox. */
export async function solveYtdlpChallenge(source:string,signal:AbortSignal):Promise<string>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const frame=document.createElement('iframe');frame.hidden=true;
    frame.src=chrome.runtime.getURL('/ytdlp-sandbox/index.html');
    const id=crypto.randomUUID();
    const finish=(error?:Error,output?:string)=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);frame.remove();error?reject(error):resolve(output!);};
    const abort=()=>finish(new Error('yt-dlp solver aborted'));
    const receive=(event:MessageEvent)=>{if(event.source!==frame.contentWindow||event.data?.type!=='ytdlp-result'||event.data.id!==id)return;finish(event.data.error?new Error(event.data.error):undefined,event.data.output);};
    const timer=setTimeout(()=>finish(new Error('yt-dlp JavaScript solver exceeded 30 seconds')),30000);
    window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});
    frame.onload=()=>frame.contentWindow!.postMessage({type:'ytdlp-solve',id,source},'*');
    document.body.append(frame);
  });
}
