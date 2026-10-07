import type { HookContext, HookModule } from './types';
const modules = import.meta.glob('../../abx-plugins/abx_plugins/plugins/*/browser/on_*.ts');
const controller = new AbortController();
let next = 0;
const calls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const listeners = new Map<string, Set<(value: any) => void>>();
const stop = new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
function rpc(method: string, ...args: unknown[]): Promise<any> {
  return new Promise((resolve, reject) => { const id = ++next; calls.set(id, { resolve, reject }); postMessage({ type: 'rpc', id, method, args }); });
}
self.onmessage = async ({ data }) => {
  if (data.type === 'stop') { controller.abort(); return; }
  if (data.type === 'event') { listeners.get(data.method)?.forEach(fn => fn(data.params)); return; }
  if (data.type === 'reply') { const call = calls.get(data.id); calls.delete(data.id); data.error ? call?.reject(new Error(data.error)) : call?.resolve(data.value); return; }
  if (data.type !== 'run') return;
  const ctx: HookContext = {
    ...data.context, signal: controller.signal,
    solveYtdlpChallenge: source => rpc("solveYtdlpChallenge", source),
    parseDocument: ref => rpc('parseDocument',ref),
    ready: () => postMessage({ type: 'ready' }),
    log: message => postMessage({ type: 'log', message }),
    untilStopped: () => stop,
    sleep: ms => new Promise((resolve, reject) => {
      controller.signal.throwIfAborted();
      const abort = () => { clearTimeout(timer); reject(controller.signal.reason); };
      const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
      controller.signal.addEventListener('abort', abort, { once: true });
    }),
    page: {
      waitForIdle: options => rpc('waitForIdle', options),
      evaluate: expression => rpc('evaluate', expression),
      command: (method, params) => rpc('command', method, params),
      on: async (method, handler) => {
        const list = listeners.get(method) || new Set(); list.add(handler); listeners.set(method, list);
        await rpc('subscribe', method);
        return () => { list.delete(handler); };
      },
    },
    archive: { beginDownloads:()=>rpc('beginDownloads'), finishDownloads:(token,timeoutMs)=>rpc('finishDownloads',token,timeoutMs), cancelDownloads:token=>rpc('cancelDownloads',token), addResource: input => rpc('addResource', input), fetch: (url,options) => rpc('fetch', url,options), read: ref => rpc('read', ref), entries: () => rpc('entries') },
  };
  try {
    const load = modules[data.key]; if (!load) throw new Error(`Missing bundled hook ${data.key}`);
    const module = await load() as HookModule;
    const result = await module.default(ctx);
    postMessage({ type: 'done', result: result || { status: 'succeeded' } });
  } catch (error) { postMessage({ type: 'done', result: { status: 'failed', summary: String(error) } }); }
};
