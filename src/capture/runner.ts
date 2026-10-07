import { hooks } from './registry';
import type { Capture, HookAttempt, HookDefinition, HookResult } from './types';

export interface HookHost {
  finishAcquisition(): Promise<void>;
  invoke(method: string, args: any[], plugin: string, signal: AbortSignal, resultId:string): Promise<unknown>;
  subscribe(method: string, callback: (params: unknown) => void): () => void;
  interrupt(): Promise<void>;
}
type Task = {
  definition: HookDefinition; attempt: HookAttempt; worker: Worker;
  ready: Promise<void>; done: Promise<void>; stop: (reason?: string) => Promise<void>;
};

export class HookRunner {
  private tasks: Task[] = [];
  private aborted = false;
  constructor(readonly capture: Capture, readonly host: HookHost, readonly changed: () => void) {}

  async abort() { this.aborted = true; await this.cleanup('Capture stopped'); }
  get stopped() { return this.aborted; }

  async run() {
    try {
      for (const hook of hooks.filter(h => h.event === 'Snapshot' && this.capture.plugins.includes(h.plugin))) {
        if (this.aborted) break;
        if (hook.config.wait_for_background_cleanup) { await this.cleanup(); await this.host.finishAcquisition(); }
        const waits = hook.config.wait_for_plugins || [];
        await Promise.all(this.tasks.filter(t => waits.includes(t.definition.plugin)).map(t => t.done));
        if (this.aborted) break;
        const task = this.start(hook); this.tasks.push(task);
        await (hook.background ? task.ready : task.done);
        if (hook.background && !task.attempt.ready) throw Error(`Background hook did not become ready: ${hook.name}: ${task.attempt.summary || task.attempt.status}`);
        if (hook.plugin === 'chrome' && ['failed', 'killed'].includes(task.attempt.status)) throw Error(task.attempt.summary);
      }
    } finally { await this.cleanup(); }
  }

  async cleanup(reason?: string) {
    await Promise.all(this.tasks.filter(t => t.attempt.status === 'running').map(t => t.stop(reason)));
  }

  private start(definition: HookDefinition): Task {
    const worker = new Worker(new URL('./hook-worker.ts', import.meta.url), { type: 'module' });
    const attempt: HookAttempt = { id:crypto.randomUUID(), plugin: definition.plugin, hook: definition.name, status: 'running', started: Date.now(), logs: [] };
    this.capture.hooks.push(attempt); this.changed();
    let readyResolve!: () => void, doneResolve!: () => void;
    const ready = new Promise<void>(resolve => { readyResolve = resolve; });
    const done = new Promise<void>(resolve => { doneResolve = resolve; });
    const subscriptions: (() => void)[] = [];
    const controller = new AbortController();
    const pending = new Set<Promise<unknown>>();
    let stopping: Promise<void> | undefined;
    let stoppedReason: string | undefined;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: HookResult) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(killTimer);
      subscriptions.forEach(unsubscribe => unsubscribe()); worker.terminate();
      Object.assign(attempt, result, { status: stoppedReason === 'Hook timeout exceeded' && result.status !== 'killed' ? 'failed' : result.status || 'succeeded', ended: Date.now() });
      if (stoppedReason) attempt.summary = stoppedReason + (result.summary ? `: ${result.summary}` : '');
      readyResolve(); doneResolve(); this.changed();
    };
    const stop = (reason?: string) => {
      if (stopping) return stopping;
      if (settled) return done;
      stoppedReason = reason;
      controller.abort(reason);
      worker.postMessage({ type: 'stop' });
      stopping = new Promise<void>(resolve => {
        killTimer = setTimeout(() => {
          worker.terminate();
          void (pending.size ? this.host.interrupt() : Promise.resolve()).finally(() => {
            finish({ status: 'killed', summary: reason || 'Hook exceeded shutdown grace period' });
          });
        }, (definition.config.shutdown_grace ?? 5) * 1000);
        void done.then(resolve);
      });
      return stopping;
    };
    const configuredTimeout = Number(this.capture.pluginConfig?.[definition.plugin]?.HOOK_TIMEOUT ?? definition.config.timeout ?? 60);
    const timer = setTimeout(() => { void stop('Hook timeout exceeded'); }, Math.max(1, Math.min(3600, Number.isFinite(configuredTimeout) ? configuredTimeout : 60)) * 1000);
    worker.onerror = event => finish({ status: 'failed', summary: event.message });
    worker.onmessage = ({ data }) => {
      if (settled) return;
      if (data.type === 'ready') { attempt.ready = Date.now(); readyResolve(); this.changed(); }
      if (data.type === 'log') { attempt.logs.push(String(data.message)); if (attempt.logs.length > 200) attempt.logs.shift(); this.changed(); }
      if (data.type === 'done') {
        // Finish persistence RPCs already issued before acknowledging hook completion.
        void Promise.allSettled([...pending]).then(() => finish(data.result));
      }
      if (data.type === 'rpc') {
        const call = (async () => {
          if (data.method === 'subscribe') {
            subscriptions.push(this.host.subscribe(data.args[0], params => {
              if (!settled) worker.postMessage({ type: 'event', method: data.args[0], params });
            }));
            return true;
          }
          return this.host.invoke(data.method, data.args, definition.plugin, controller.signal, attempt.id!);
        })();
        pending.add(call);
        void call.then(value => { if (!settled) worker.postMessage({ type: 'reply', id: data.id, value }); },
          error => { if (!settled) worker.postMessage({ type: 'reply', id: data.id, error: String(error) }); })
          .finally(() => pending.delete(call));
      }
    };
    worker.postMessage({ type: 'run', key: definition.key, context: {
      url: this.capture.url, captureId: this.capture.id, plugin: definition.plugin,
      // Named settings are shared across hooks, like the canonical hook
      // environment; per-hook overrides (including HOOK_TIMEOUT) remain local.
      config: Object.assign({}, ...Object.values(this.capture.pluginConfig || {}).map(({HOOK_TIMEOUT,...config})=>config), this.capture.pluginConfig?.[definition.plugin] || {}),
    } });
    return { definition, attempt, worker, ready, done, stop };
  }
}
