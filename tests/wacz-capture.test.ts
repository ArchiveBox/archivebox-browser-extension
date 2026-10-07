import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {unzipSync} from 'fflate';
import {createHash} from 'node:crypto';
import {PDFDocument,Font} from 'mupdf';
import {launchExtension} from './helpers/extension';
import {openSnapshotOutput} from './helpers/snapshot-controls';

test('toolbar runs all plugins, stores one verified WACZ in OPFS, replays and deletes it',async({},info)=>{
  test.setTimeout(300_000);
  const document=new PDFDocument(),font=new Font('Helvetica');
  document.insertPage(-1,document.addPage([0,0,300,200],0,{Font:{F1:document.addSimpleFont(font)}},'BT /F1 16 Tf 20 150 Td (WASM document evidence) Tj ET'));
  const buffer=document.saveToBuffer('compress'),pdf=buffer.asUint8Array().slice();buffer.destroy();font.destroy();document.destroy();
  const server=createServer((req,res)=>{
    if(req.url==='/evidence.pdf'){res.setHeader('Content-Type','application/pdf');res.end(pdf);return}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><title>ArchiveBox capture integration</title></head><body><h1>Durable archived evidence</h1><p>A real page captured by every configured plugin.</p><script>fetch("/evidence.pdf").then(response=>response.arrayBuffer())</script></body></html>')});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
  const extension=await launchExtension();
  try {
    const target=await extension.context.newPage();await target.goto(url);
    const popup=await extension.context.newPage();await popup.goto(`chrome-extension://${extension.id}/popup.html`);
    await expect(popup.locator('.archivebox-overlay')).toBeVisible();
    await expect(popup.getByRole('button',{name:'Screenshot',exact:true})).toHaveCount(0);
    await expect(popup.getByRole('button',{name:'Open archive',exact:true})).toBeVisible({timeout:240_000});
    const snapshot=await popup.evaluate(async()=>((await chrome.storage.local.get('entries')).entries as any[]).find(item=>item.url.startsWith('http://127.0.0.1:')));
    expect(snapshot.wacz.state).toBe('complete');expect(snapshot.wacz.file).toMatch(/archivebox_js\/capture.wacz$/);
    const pluginNames=(await readdir('abx-plugins/abx_plugins/plugins',{withFileTypes:true})).filter(item=>item.isDirectory()).map(item=>item.name).sort();
    expect([...snapshot.wacz.plugins].sort()).toEqual(pluginNames);
    expect(snapshot.wacz.hooks).toHaveLength(27);
    expect(snapshot.wacz.hooks.find((hook:any)=>hook.plugin==='screenshot')?.status).toBe('succeeded');
    expect(snapshot.wacz.hooks.find((hook:any)=>hook.plugin==='liteparse')?.status).toBe('succeeded');
    expect(snapshot.wacz.hooks.every((hook:any)=>hook.ended && hook.status!=='running')).toBe(true);
    expect(snapshot.screenshot).toBeUndefined();expect(snapshot.mhtml).toBeUndefined();expect(snapshot.singlefile).toBeUndefined();
    await popup.getByRole('button',{name:'Open archive',exact:true}).click();
    const studio=extension.context.pages().find(page=>page.url().includes('/studio.html'))!;
    await studio.bringToFront();
    await expect(studio.getByRole('button',{name:'Download WACZ',exact:true}).first()).toBeVisible();
    const downloading=studio.waitForEvent('download');await studio.getByRole('button',{name:'Download WACZ',exact:true}).first().click();
    const download=await downloading;const zip=unzipSync(await readFile((await download.path())!));
    const records=new TextDecoder().decode(zip['index.jsonl']).trim().split('\n').map(line=>JSON.parse(line));
    expect(records[0].id).toBe(snapshot.id);expect(records[0].capture_state).toBe('complete');
    expect(records[0].created_at).toBe(snapshot.timestamp);expect(records[0].tags).toEqual(snapshot.tags);
    expect(records.filter(record=>record.type==='ArchiveResult')).toHaveLength(snapshot.wacz.hooks.length);
    const parsed=records.find(record=>record.type==='ArchiveResult'&&record.plugin==='liteparse');
    expect(parsed.output_files).toHaveLength(1);
    expect(new TextDecoder().decode(zip[`liteparse/${parsed.output_files[0].path}`])).toContain('WASM document evidence');
    const manifest=JSON.parse(new TextDecoder().decode(zip['datapackage.json']));
    for(const resource of manifest.resources){expect(zip[resource.path],resource.path).toBeTruthy();expect(`sha256:${createHash('sha256').update(zip[resource.path]!).digest('hex')}`).toBe(resource.hash)}
    await popup.close();await target.close();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await studio.reload();
    await expect(studio.locator('.stack-shelf')).toBeVisible();
    const singlefile=await openSnapshotOutput(studio,'singlefile');
    await expect(singlefile.frameLocator('iframe[title="Offline document"]').getByRole('heading',{name:'Durable archived evidence'})).toBeVisible();
    await studio.screenshot({path:info.outputPath('offline-singlefile.png'),fullPage:true});
    await studio.getByRole('link',{name:'Saved URLs',exact:true}).click();
    await studio.getByRole('checkbox',{name:'Select all visible URLs'}).check();
    studio.once('dialog',dialog=>dialog.accept());
    await studio.getByRole('button',{name:'Delete',exact:true}).click();
    await expect(studio).toHaveURL(/options.html/);
    await expect.poll(()=>studio.evaluate(async(id:string)=>((await chrome.storage.local.get('entries')).entries as any[]).some(item=>item.id===id),snapshot.id)).toBe(false);
    const remains=await studio.evaluate(async(path:string)=>{try{let dir=await navigator.storage.getDirectory();const parts=path.split('/');const name=parts.pop()!;for(const part of parts)dir=await dir.getDirectoryHandle(part);await dir.getFileHandle(name);return true}catch(error){if((error as DOMException).name==='NotFoundError')return false;throw error}},snapshot.wacz.file);
    expect(remains).toBe(false);
  }finally{await extension.close();server.close()}
});

test('interrupted capture has no WACZ and Archive again starts a new snapshot',async()=>{
  test.setTimeout(180_000);
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Interrupt capture</title><h1>Start this URL again</h1>')});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
  const extension=await launchExtension();
  try {
    const page=await extension.context.newPage();await page.goto(url);
    const popup=await extension.context.newPage();await popup.goto(`chrome-extension://${extension.id}/popup.html`);
    await expect.poll(()=>extension.context.pages().some(page=>page.url().includes('/studio.html'))).toBe(true);
    let studio=extension.context.pages().find(page=>page.url().includes('/studio.html'))!;
    await expect(studio.getByRole('button',{name:'Stop capture',exact:true})).toBeVisible();
    const original=await popup.evaluate(async()=>((await chrome.storage.local.get('entries')).entries as any[])[0]);
    await expect.poll(()=>popup.evaluate(async(id:string)=>((await chrome.storage.local.get('entries')).entries as any[]).find(item=>item.id===id)?.wacz?.state,original.id)).toBe('capturing');
    await studio.close(); // An actual lost capture page, not a simulated hook failure.
    await expect.poll(()=>popup.evaluate(async(id:string)=>((await chrome.storage.local.get('entries')).entries as any[]).find(item=>item.id===id)?.wacz?.state,original.id)).toBe('failed');
    await popup.getByRole('button',{name:'Capture failed — open details',exact:true}).click();
    await expect.poll(()=>extension.context.pages().some(page=>page.url().includes('/studio.html'))).toBe(true);
    studio=extension.context.pages().find(page=>page.url().includes('/studio.html'))!;
    await expect(studio.getByRole('button',{name:'Download WACZ',exact:true})).toHaveCount(0);
    await studio.getByRole('button',{name:'Archive again',exact:true}).click();
    await expect(studio.getByRole('button',{name:'Download WACZ',exact:true}).first()).toBeVisible({timeout:120_000});
    const entries=await studio.evaluate(async()=>((await chrome.storage.local.get('entries')).entries as any[]));
    expect(entries).toHaveLength(2);
    expect(entries.find(item=>item.id===original.id)?.wacz.file).toBeUndefined();
    const fresh=entries.find(item=>item.id!==original.id)!;
    expect(fresh.url).toBe(original.url);expect(fresh.wacz.state).toBe('complete');expect(fresh.wacz.id).toBe(fresh.id);
    expect(await studio.evaluate(async(id:string)=>(await indexedDB.databases()).some(db=>db.name===`capture-${id}`),original.id)).toBe(false);
    await studio.getByRole('button',{name:'Delete capture',exact:true}).click();
    await expect(studio).toHaveURL(/options.html/);
    expect(await studio.evaluate(async(id:string)=>((await chrome.storage.local.get('entries')).entries as any[]).some(item=>item.id===id),fresh.id)).toBe(false);
  }finally{await extension.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
});
