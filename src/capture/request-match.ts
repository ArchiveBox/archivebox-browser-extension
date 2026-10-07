const explicitHeaders=new Set(['authorization','cookie','range','content-type','user-agent']);
export type HeaderMatch = {name:string;requested:string|null;recorded:string|null;result:'matched'|'different'|'ignored'|'blocked';reason:string};
/** The capture reuse policy, with the same decisions available to the inspector. */
export function explainRecordedHeaders(requested:Headers,recorded:Headers,response:Headers){
  const vary=(response.get('vary')||'').toLowerCase().split(',').map(name=>name.trim()).filter(Boolean);
  const explicit=explicitHeaders;
  const names=new Set([...requested.keys(),...recorded.keys(),...vary]);
  const headers:HeaderMatch[]=[...names].sort().map(name=>{
    const wanted=requested.get(name),actual=recorded.get(name);
    const row={name,requested:wanted,recorded:actual};
    if(name==='*'&&vary.includes('*'))return {...row,result:'blocked',reason:'Vary: *'};
    if(name.startsWith('if-')&&requested.has(name))return {...row,result:'blocked',reason:'Conditional request'};
    if(explicit.has(name)&&requested.has(name))return {...row,result:wanted===actual?'matched':'different',reason:'Explicit request header'};
    if(name==='accept-encoding')return {...row,result:'ignored',reason:'Decoded payload; transport encoding'};
    if(!requested.has(name))return {...row,result:'ignored',reason:'Not explicitly requested; browser default'};
    if(vary.includes(name)){
      if(name==='accept'&&wanted==='*/*')return {...row,result:'ignored',reason:'Accept wildcard'};
      return {...row,result:wanted===actual?'matched':'different',reason:'Response Vary'};
    }
    return {...row,result:'ignored',reason:'Not part of the reuse header policy'};
  });
  return {matches:headers.every(row=>row.result!=='different'&&row.result!=='blocked'),headers};
}
/** HEAD, range and conditional requests are never synthesized from a GET. */
export function matchesRecordedHeaders(requested:Headers,recorded:Headers,response:Headers){
  return explainRecordedHeaders(requested,recorded,response).matches;
}

/** Explain which incoming headers select this preserved response. No incoming
 * request or past reuse event is assumed by this view of the matching policy. */
export function describeRecordedHeaders(recorded:Headers,response:Headers){
  const vary=new Set((response.get('vary')||'').toLowerCase().split(',').map(name=>name.trim()).filter(Boolean));
  const names=new Set([...recorded.keys(),...explicitHeaders,...vary,'accept-encoding']);
  return [...names].sort().map(name=>{
    const value=recorded.get(name);
    if(name==='*')return {name,value,role:'Blocks reuse',rule:'Vary: * requires a new response'};
    if(name.startsWith('if-'))return {name,value,role:'Conditional',rule:'An incoming conditional header requires a new response'};
    if(explicitHeaders.has(name))return {name,value,role:'Explicit',rule:'Must equal the recorded value when explicitly supplied'};
    if(name==='accept-encoding')return {name,value,role:'Ignored',rule:'Transport encoding; the preserved payload is decoded'};
    if(vary.has(name))return {name,value,role:'Vary',rule:name==='accept'?'Must match when supplied; */* accepts any recorded value':'Must equal the recorded value when explicitly supplied'};
    return {name,value,role:'Ignored',rule:'Not selected by Vary or the explicit-header policy'};
  });
}
