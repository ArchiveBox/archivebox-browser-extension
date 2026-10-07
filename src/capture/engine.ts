import {solveYtdlpChallenge} from './ytdlp-solver';
import { CaptureRecorder } from './recorder';
import { HookRunner } from './runner';
import { plugins, selectPlugins } from './registry';
import { saveCapture, removeArchive } from '../archive/storage';
import { exportCapture } from '../archive/export';
import type { Capture } from './types';
import { getSnapshots } from '../lib/storage';

export class CaptureEngine {
  readonly capture: Capture;
  readonly recorder: CaptureRecorder;
  readonly runner: HookRunner;
  private acquisitionFinished?:Promise<void>;
  constructor(tabId: number, url: string, selected: string[], readonly changed: (capture: Capture) => void,
    settings: Record<string, Record<string, unknown>> = {}, id: string = crypto.randomUUID()) {
    this.capture = { id, url, title: url, created: Date.now(), state: 'capturing', hooks: [], plugins: selectPlugins(['chrome', ...selected]) };
    this.capture.pluginConfig = Object.fromEntries(this.capture.plugins.map(name => [name, {
      ...Object.fromEntries(Object.entries(plugins[name]?.properties || {}).map(([key, value]) => [key, value.default])),
      ...settings[name],
    }]));
    this.recorder = new CaptureRecorder(tabId, id, url);
    this.runner = new HookRunner(this.capture, {
      finishAcquisition:()=>this.finishAcquisition(),
      invoke: async (method, args, plugin, signal, resultId) => {
        switch (method) {
          case 'solveYtdlpChallenge': if(plugin!=='ytdlp')throw Error('Only yt-dlp may request its solver');return solveYtdlpChallenge(args[0],signal);
          case 'parseDocument': {
            if(plugin!=='liteparse')throw Error('Document parsing belongs to the LiteParse hook');
            let resource=await this.recorder.readResource(args[0]);
            if(args[0].member?.length){const {readZipMember}=await import('../archive/zip-members');resource={...resource,...await readZipMember(resource.body,args[0].member,signal)}}
            const mime=new TextDecoder().decode(resource.body.subarray(0,5))==='%PDF-'?'application/pdf':resource.mime;
            const {parseDocument}=await import('../../abx-plugins/abx_plugins/plugins/liteparse/browser/parse');
            return parseDocument(async()=>resource.body,mime,this.capture.pluginConfig?.liteparse||{},signal,()=>{});
          }
          case 'evaluate': return this.recorder.evaluate(args[0]);
          case 'waitForIdle': return this.recorder.waitForIdle(args[0], signal);
          case 'command': {
            const result=await this.recorder.send(args[0],args[1]);
            if(args[0]==='Page.navigate'&&result.isDownload)await this.recorder.drain();
            return result;
          }
          case 'beginDownloads': if(this.acquisitionFinished)throw Error('Network acquisition has finished');return this.recorder.beginDownloads(plugin,signal);
          case 'finishDownloads': return this.recorder.finishDownloads(args[0],args[1],signal);
          case 'cancelDownloads': return this.recorder.cancelDownloads(args[0]);
          case 'fetch': if(this.acquisitionFinished)throw Error('Network acquisition has finished');return this.recorder.fetchResource(args[0], signal, args[1]);
          case 'read': return this.recorder.readResource(args[0]);
          case 'entries': return this.recorder.listResources();
          case 'addResource': return this.recorder.addResource(args[0], plugin, resultId);
          default: throw Error(`Unknown hook operation: ${method}`);
        }
      },
      subscribe: (method, callback) => this.recorder.subscribe(method, callback),
      interrupt: () => this.recorder.interrupt(),
    }, () => { this.changed(this.capture); void saveCapture(this.capture).catch(error => this.recorder.reportError(`Unable to persist progress: ${error}`)); });
  }
  private finishAcquisition():Promise<void> {
    return this.acquisitionFinished ||= (async()=>{
      const navigation=this.capture.hooks.find(hook=>hook.plugin==='chrome'&&hook.status==='succeeded')?.data as {download?:{ref:{url:string};name:string}}|undefined;
      this.capture.title=navigation?.download?.name||await this.recorder.evaluate('document.title').catch(()=>this.capture.url);
      this.capture.finalUrl=navigation?.download?.ref.url||await this.recorder.evaluate('location.href').catch(()=>this.capture.url);
      await this.recorder.close();
    })();
  }
  async run(): Promise<Capture> {
    return await navigator.locks.request(`archivebox-wacz-tab-${this.recorder.tabId}`, { ifAvailable: true }, async lock => {
      if (!lock) throw Error('This tab already has a capture running in another studio');
      const port = chrome.runtime.connect({ name: 'wacz-capture-lifetime' });
      try {
        await new Promise<void>((resolve, reject) => {
          const disconnected = () => reject(Error('Capture lifecycle host disconnected'));
          port.onDisconnect.addListener(disconnected);
          port.onMessage.addListener(message => { if (message.type === 'claimed') { port.onDisconnect.removeListener(disconnected); resolve(); } });
          port.postMessage({ type: 'claim', tabId: this.recorder.tabId, id: this.capture.id });
        });
        return await navigator.locks.request(`archivebox-wacz-capture-${this.capture.id}`, () => this.acquire());
      } finally { port.postMessage({ type: 'release' }); port.disconnect(); }
    });
  }
  private async acquire(): Promise<Capture> {
    const capture = this.capture;
    await saveCapture(capture); this.changed(capture);
    try {
      await this.recorder.attach();
      await this.runner.run();
    } catch (error) { capture.error = String(error); }
    finally {
      await this.runner.cleanup();
      await this.finishAcquisition().catch(error => { capture.error = String(error); });
    }
    try {
      if (!this.recorder.resourceCount) throw Error(capture.error || 'No resources were recorded');
      if (this.recorder.errors.length) capture.error = [capture.error, ...this.recorder.errors].filter(Boolean).join('\n');
      if (this.runner.stopped || capture.error) throw Error(capture.error || 'Capture stopped. Archive this URL again to start from scratch.');
      await this.recorder.drain();
      const snapshot = (await getSnapshots()).find(item => item.id === capture.id);
      if (!snapshot) throw Error('Saved snapshot no longer exists');
      Object.assign(capture, {created:Date.parse(snapshot.timestamp),tags:snapshot.tags,depth:snapshot.depth??0});
      await exportCapture(capture, this.recorder.db, this.recorder.resourceCount);
      if (this.runner.stopped) throw Error('Capture stopped. Archive this URL again to start from scratch.');
    } catch (error) {
      capture.state = 'failed'; capture.error = String(error); delete capture.file;
      await removeArchive(capture.id);
      await this.recorder.db.delete();
    }
    finally { this.recorder.db.db?.close(); }
    await saveCapture(capture); this.changed(capture); return capture;
  }
}
