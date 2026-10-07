// Full capture and outbound delivery through real extension UI and an ArchiveBox server.
// Run against a disposable server with no archive workers:
// ARCHIVEBOX_TEST_SERVER=http://127.0.0.1:5899 ARCHIVEBOX_TEST_KEY_FILE=/path/to/key node scripts/test-wacz-delivery-live.mjs
import {expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {launchExtension} from '../tests/helpers/extension.ts';

const server=process.env.ARCHIVEBOX_TEST_SERVER;
const keyFile=process.env.ARCHIVEBOX_TEST_KEY_FILE;
if(!server||!keyFile)throw Error('Set ARCHIVEBOX_TEST_SERVER and ARCHIVEBOX_TEST_KEY_FILE for a disposable real server.');
const key=(await readFile(keyFile,'utf8')).trim();
const source=createServer((_request,response)=>{
  response.setHeader('Content-Type','text/html');
  response.end('<!doctype html><title>WACZ delivery</title><h1>Complete outbound archive</h1><p>This document and every plugin result travel in one WACZ.</p>');
});
await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));
// Use a different hostname: the extension deliberately excludes its server's domain.
const sourceURL=`http://localhost:${source.address().port}/`;
const extension=await launchExtension();
async function api(path){
  const response=await fetch(server+path,{headers:{Authorization:`Bearer ${key}`}});
  expect(response.ok,`${path}: ${response.status}`).toBe(true);
  return response.json();
}
try{
  const options=await extension.context.newPage();
  await options.goto(`chrome-extension://${extension.id}/options.html`);
  await options.getByRole('button',{name:'Configuration',exact:true}).click();
  const serverInput=options.getByPlaceholder('http://localhost:5797 or https://archivebox.example.com');
  await serverInput.fill(server);await serverInput.blur();
  const tokenInput=options.getByPlaceholder('... abcexamplekey1234 ...');
  await tokenInput.fill(key);await tokenInput.blur();
  await expect.poll(()=>options.evaluate(async()=>{
    const registry=(await chrome.storage.local.get('server_registry')).server_registry;
    return Boolean(registry?.servers.find(item=>item.id===registry.active_server_id)?.token);
  })).toBe(true);
  for(const order of ['concurrent','submitted-first']){
    const url=`${sourceURL}?order=${order}`;
    if(order==='submitted-first'){
      // Exercise the other ordering through real bookmark import and URL-only Sync.
      // Capture later must deliver to this existing receipt without resubmitting the URL.
      await options.getByRole('button',{name:'Bulk Import URLs',exact:true}).click();
      await options.getByText('Import a Safari export',{exact:true}).click();
      await options.getByLabel('Safari data to import').selectOption('bookmarks');
      await options.getByLabel('Import Safari Export').setInputFiles({name:'Bookmarks.html',mimeType:'text/html',buffer:Buffer.from(`<!DOCTYPE NETSCAPE-Bookmark-file-1><TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><p><DT><A HREF="${url}">Outbound delivery bookmark</A></DL><p>`)});
      await options.getByLabel('Select all visible import URLs').check();
      await options.getByRole('button',{name:'Import Selected (1)',exact:true}).click();
      await options.getByRole('button',{name:'Saved URLs',exact:true}).click();
      await options.locator('.saved-url-table tbody tr').filter({hasText:url}).getByRole('checkbox').check();
      await options.getByRole('button',{name:'Sync',exact:true}).click();
      await expect.poll(()=>options.evaluate(async url=>Object.values((await chrome.storage.local.get('entries')).entries.find(item=>item.url===url)?.remote_copies||{}).some(copy=>copy.status==='complete'),url),{timeout:30_000}).toBe(true);
    }
    const target=await extension.context.newPage();await target.goto(url);
    const popup=await extension.context.newPage();await popup.goto(`chrome-extension://${extension.id}/popup.html`);
    // The popup submits the URL while the full engine is still recording.
    await expect.poll(()=>options.evaluate(async url=>{
      const snapshot=(await chrome.storage.local.get('entries')).entries?.find(item=>item.url===url);
      return Object.values(snapshot?.remote_copies||{}).some(copy=>copy.snapshot_id);
    },url),{timeout:30_000}).toBe(true);
    // An existing receipt is immediately visible; let the popup actually launch
    // its independent capture tab before closing the UI that starts it.
    await expect.poll(()=>extension.context.pages().some(page=>page.url().includes('/studio.html'))).toBe(true);
    await popup.close();
    await expect.poll(()=>options.evaluate(async url=>{
      const snapshot=(await chrome.storage.local.get('entries')).entries?.find(item=>item.url===url);
      if(snapshot?.wacz?.state==='failed')throw Error(snapshot.wacz.error);
      return snapshot?.wacz?.state;
    },url),{timeout:240_000}).toBe('complete');
    const local=await options.evaluate(async url=>(await chrome.storage.local.get('entries')).entries.find(item=>item.url===url),url);
    const remoteId=Object.values(local.remote_copies)[0].snapshot_id;
    let remote;
    await expect.poll(async()=>{
      remote=await api(`/api/v1/core/snapshot/${remoteId}`);
      return remote.archiveresults.find(result=>result.plugin==='wacz')?.status;
    },{timeout:30_000}).toBe('succeeded');
    const result=remote.archiveresults.find(result=>result.plugin==='wacz');
    expect(Object.keys(result.output_files)).toEqual(['capture.wacz']);
    expect(result.output_files['capture.wacz'].mimetype).toBe('application/wacz');
    expect(result.output_json.snapshot_id).toBe(local.id);
    const response=await fetch(`${server}/${remote.archive_path}/wacz/capture.wacz`,{headers:{Authorization:`Bearer ${key}`}});
    expect(response.ok).toBe(true);
    const uploaded=Buffer.from(await response.arrayBuffer());
    expect(uploaded.length).toBe(result.output_files['capture.wacz'].size);
    const studio=extension.context.pages().find(page=>page.url().includes(`/studio.html?id=${local.id}`));
    await studio.bringToFront();
    const downloading=studio.waitForEvent('download');
    await studio.getByRole('button',{name:'Download WACZ',exact:true}).first().click();
    const download=await downloading;
    const exported=await readFile(await download.path());
    expect(uploaded.equals(exported)).toBe(true);
    const zip=unzipSync(uploaded);
    const records=new TextDecoder().decode(zip['index.jsonl']).trim().split('\n').map(line=>JSON.parse(line));
    expect(records[0].id).toBe(local.id);
    expect(records.filter(record=>record.type==='ArchiveResult')).toHaveLength(local.wacz.hooks.length);
    expect(remote.archiveresults.filter(result=>result.plugin==='wacz')).toHaveLength(1);
    await expect.poll(()=>options.evaluate(async url=>Object.values((await chrome.storage.local.get('entries')).entries.find(item=>item.url===url)?.remote_copies||{}).every(copy=>copy.status==='complete'&&!copy.delivery_error),url)).toBe(true);
    console.log(JSON.stringify({event:'wacz-delivery-verified',order,bytes:uploaded.length,results:local.wacz.hooks.length}));
    await studio.close();await target.close();
  }
}finally{
  await extension.close();
  await new Promise(resolve=>source.close(resolve));
}
