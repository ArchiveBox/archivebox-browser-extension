import { PluginReplay } from '../replay/PluginReplay';
import { removeClosedTabHeaderRules } from './request-headers';
import { getSnapshots, mutateSnapshots } from '../lib/storage';
import { supportsWaczCapture } from '../lib/browserCapabilities';
import { deleteSnapshotOpfs } from '../lib/screenshotStorage';
import { deleteAcquisitionDatabase } from '../archive/storage';

export async function openCapture(snapshotId: string, tabId?: number): Promise<void> {
  if (!supportsWaczCapture) throw Error('Full local archiving requires Chrome or Edge.');
  await navigator.locks.request(`archivebox-open-capture:${snapshotId}`, async () => {
    const snapshot = (await getSnapshots()).find(item => item.id === snapshotId);
    if (!snapshot) throw Error('Saved snapshot not found');
    const address = browser.runtime.getURL(`/studio.html?id=${encodeURIComponent(snapshotId)}`);
    const existing = (await browser.tabs.query({})).find(tab => tab.url?.startsWith(address));
    if (existing?.id) { await browser.tabs.update(existing.id, {active:true}); return; }
    if (!snapshot.wacz) {
      if (tabId === undefined) throw Error('Open the source page to start capture');
      const target = await browser.tabs.get(tabId);
      if (target.url !== snapshot.url) throw Error('The tab navigated before capture.');
    }
    await browser.tabs.create({url: snapshot.wacz ? address : `${address}&tab=${tabId}&capture=1`, active:false});
  });
}

export function configureCaptureRuntime(): void {
  if (!supportsWaczCapture) return;
  // Wabac installs a global fetch listener. Leave live acquisition and ordinary
  // extension assets to the browser; only archived replay belongs to that listener.
  self.addEventListener('fetch', event => {
    const url = new URL((event as Event & {request: Request}).request.url);
    if (url.origin !== new URL(chrome.runtime.getURL('/')).origin || !/^\/(w\/|static\/|plugin-record\/)/.test(url.pathname)) event.stopImmediatePropagation();
  });
  const replay = new PluginReplay();
  const ownPage = (url?: string, pages = ['/studio.html']) => Boolean(url && new URL(url).origin === new URL(chrome.runtime.getURL('/')).origin && pages.includes(new URL(url).pathname));
  async function discardInterrupted(id: string) {
    const snapshot = (await getSnapshots()).find(item => item.id === id);
    if (!snapshot || snapshot.wacz?.state !== 'capturing') return;
    await replay.command({type:'unmount-wacz',id});
    await deleteSnapshotOpfs(snapshot);
    await deleteAcquisitionDatabase(id);
    await mutateSnapshots(entries => entries.map(item => item.id === id && item.wacz ? {...item,wacz:{...item.wacz,state:'failed',file:undefined,error:'Capture interrupted. Archive the URL again.'}} : item));
  }
  // A browser restart has no surviving owner port. Active studios hold this
  // whole-Snapshot lock; abandoned attempts are discarded, never recovered.
  void getSnapshots().then(snapshots => Promise.all(snapshots.filter(item => item.wacz?.state === 'capturing').map(item =>
    navigator.locks.request(`archivebox-artifacts:${item.id}`, {ifAvailable:true}, lock => lock ? discardInterrupted(item.id) : undefined),
  ))).catch(console.error);
  chrome.tabs.onRemoved.addListener(tabId => { void removeClosedTabHeaderRules(tabId).catch(console.error); });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!ownPage(sender.url, message.type === 'unmount-wacz' ? ['/studio.html','/popup.html','/options.html'] : undefined) || !['mount-wacz','unmount-wacz','inspect-wacz','wacz-record'].includes(message.type)) return;
    void replay.command(message).then(reply, error => reply({error:String(error)})); return true;
  });
  const owners = new Map<number, {port:chrome.runtime.Port;id:string}>();
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'wacz-capture-lifetime' || !ownPage(port.sender?.url)) return;
    let tabId: number | undefined;
    port.onMessage.addListener(message => {
      if (message.type === 'claim' && Number.isInteger(message.tabId) && typeof message.id === 'string') {
        tabId = message.tabId;
        owners.set(tabId!, {port,id:message.id}); port.postMessage({type:'claimed'});
      }
      if (message.type === 'release' && tabId !== undefined && owners.get(tabId)?.port === port) owners.delete(tabId);
    });
    port.onDisconnect.addListener(() => {
      if (tabId === undefined || owners.get(tabId)?.port !== port) return;
      const {id} = owners.get(tabId)!; owners.delete(tabId);
      void (async () => {
        await chrome.debugger.detach({tabId:tabId!}).catch(() => {});
        await navigator.locks.request(`archivebox-artifacts:${id}`, async () => {
          await discardInterrupted(id);
        });
      })().catch(console.error);
    });
  });
}
