/** Chrome owns these headers in Fetch; DNR applies exact extractor values on the wire. */
export const extractorHeader=/^(?:accept-encoding|user-agent|origin|referer|cookie|sec-fetch-(?:mode|dest|site|user))$/i;
const firstRuleId=1000000000;
export async function fetchWithExtractorHeaders(url:string,init:RequestInit,headers:Record<string,string>):Promise<Response>{
  const managed=Object.entries(headers).filter(([name])=>extractorHeader.test(name));
  const tab=await chrome.tabs.getCurrent();
  if(tab?.id===undefined)throw Error('Supplemental acquisition requires its studio tab');
  // Every supplemental request joins this lock, including ones with no override.
  // Extension Fetch may be attributed to TAB_ID_NONE; serialize across studios too.
  // The explicit owner tab remains in the rule for cleanup after abrupt close.
  return navigator.locks.request(`archivebox-http:${init.method||'GET'}:${url}`,{signal:init.signal||undefined},async()=>{
    if(!managed.length)return fetch(url,init);
    let id:number;
    await navigator.locks.request('archivebox-header-rule-allocation',async()=>{
      const rules=await chrome.declarativeNetRequest.getSessionRules();
      id=Math.max(firstRuleId-1,...rules.map(rule=>rule.id))+1;
      await chrome.declarativeNetRequest.updateSessionRules({addRules:[{
        id,priority:1,action:{type:'modifyHeaders',requestHeaders:managed.map(([header,value])=>({header,operation:'set',value}))},
        condition:{regexFilter:'^'+url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',isUrlFilterCaseSensitive:true,
          initiatorDomains:[chrome.runtime.id],tabIds:[tab.id!,chrome.tabs.TAB_ID_NONE],requestMethods:[(init.method||'GET').toLowerCase() as chrome.declarativeNetRequest.RequestMethod],resourceTypes:['xmlhttprequest']},
      }]});
    });
    try{return await fetch(url,{...init,headers:Object.fromEntries(Object.entries(headers).filter(([name])=>!extractorHeader.test(name)))});}
    finally{await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[id!]});}
  });
}
/** Studio termination may interrupt finally; tab-scoped rules can then be removed safely. */
export async function removeClosedTabHeaderRules(tabId:number){
  const rules=await chrome.declarativeNetRequest.getSessionRules();
  const ids=rules.filter(rule=>rule.id>=firstRuleId&&rule.condition.tabIds?.includes(tabId)).map(rule=>rule.id);
  if(ids.length)await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:ids});
}
