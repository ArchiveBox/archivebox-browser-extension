export type {ResourceRef as RecordRef} from '../../abx-plugins/shared/records';
import type {ResourceRef as RecordRef} from '../../abx-plugins/shared/records';
export type BrowserDownload={filename:string;ref:RecordRef};
export type CapturedEntry = RecordRef & {mime:string;status:number;method?:string;digest?:string};
export type FetchMethod = 'GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE'|'OPTIONS';
export type FetchOptions = {maxBytes?:number;method?:FetchMethod;body?:Uint8Array;headers?:Record<string,string>;timeoutMs?:number;force?:boolean;browserSession?:boolean};
export type StoredResponse = { body: Uint8Array; mime: string; status: number; headers: Record<string, string>; metadata:Record<string,unknown> };
export type ResourceInput = { kind: string; mime: string; body: string | Uint8Array; sourceUrl?: string; metadata?: Record<string, unknown> };
export type HookStatus = 'running' | 'succeeded' | 'noresults' | 'skipped' | 'failed' | 'killed';
export type HookResult = { status?: Exclude<HookStatus, 'running'>; summary?: string; records?: RecordRef[]; data?: unknown };
export type HookAttempt = Omit<HookResult, 'status'> & { id?:string; plugin: string; hook: string; status: HookStatus; started: number; ended?: number; ready?: number; logs: string[] };
export type PluginConfig = {
  title: string; description: string; category?: string; default_enabled?: boolean;
  timeout?: number; shutdown_grace?: number; required_plugins?: string[];
  wait_for_plugins?: string[]; wait_for_background_cleanup?: boolean;
  properties?: Record<string, { default?: unknown; type?: string; description?: string; minimum?: number; maximum?: number; 'x-sensitive'?:boolean }>;
};
export type HookDefinition = { key: string; plugin: string; name: string; event: string; order: number; background: boolean; config: PluginConfig };
export type NetworkIdleOptions = {quietMs?:number;maxWaitMs?:number;maxActiveRequests?:number};
export type NetworkIdleState = {
  idle:boolean;waitedMs:number;pending:number;
  requests:{url:string;method:string;type:string;status:number;awaitingPayload:boolean}[];
  archivePending:{commits:number;writes:number;fetches:number;queuedFetches:number};
};
export interface HookContext {
  url: string; captureId: string; plugin: string; config: Record<string, unknown>; signal: AbortSignal;
  solveYtdlpChallenge(source:string): Promise<string>;
  parseDocument(ref:RecordRef): Promise<unknown>;
  ready(): void;
  log(message: string): void;
  sleep(ms: number): Promise<void>;
  untilStopped(): Promise<void>;
  page: {
    waitForIdle(options?: NetworkIdleOptions): Promise<NetworkIdleState>;
    evaluate<T = unknown>(expression: string): Promise<T>;
    command<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
    on(method: string, handler: (params: any) => void): Promise<() => void>;
  };
  archive: {
    addResource(input: ResourceInput): Promise<RecordRef>;
    fetch(url: string, options?:FetchOptions): Promise<RecordRef>;
    read(ref: RecordRef): Promise<StoredResponse>;
    entries(): Promise<CapturedEntry[]>;
    beginDownloads(): Promise<string>;
    finishDownloads(token:string,timeoutMs:number): Promise<BrowserDownload[]>;
    cancelDownloads(token:string): Promise<void>;
  };
}
export type HookModule = { default: (ctx: HookContext) => Promise<HookResult | void> };
export type Capture = {
  id: string; url: string; finalUrl?: string; title: string; created: number;
  depth?: number; tags?: string[];
  state: 'capturing' | 'complete' | 'failed';
  file?: string; size?: number; resourceCount?: number; error?: string;
  hooks: HookAttempt[]; plugins: string[];
  pluginConfig?: Record<string, Record<string, unknown>>;
};
