import type { HookContext, HookResult } from '@/src/capture/types';

type Observation = { url: string; timestamp: number; securityState?: string; securityDetails: Record<string, unknown> };
type Certificate = { origin: string; observedAt: number; tableNames?: string[]; error?: string };
export default async function(ctx: HookContext): Promise<HookResult> {
  const connections: Observation[] = [];
  const certificates = new Map<string, Certificate>();
  const securityEvents: { method: string; params: unknown }[] = [];
  const securityDomain: { available: boolean; error?: string } = { available: false };
  const pending = new Set<Promise<void>>();
  const seen = new Set<string>();
  const unsubscribers: (() => void)[] = [];
  unsubscribers.push(await ctx.page.on('Network.responseReceived', event => {
    const response = event.response;
    if (!response?.securityDetails) return;
    const origin = new URL(response.url).origin;
    const key = origin + JSON.stringify(response.securityDetails);
    if (!seen.has(key)) {
      seen.add(key);
      connections.push({ url: response.url, timestamp: event.timestamp, securityState: response.securityState, securityDetails: response.securityDetails });
    }
    if (certificates.has(origin)) return;
    const certificate: Certificate = { origin, observedAt: Date.now() };
    certificates.set(origin, certificate);
    const task = ctx.page.command<{ tableNames: string[] }>('Network.getCertificate', { origin })
      .then(result => { certificate.tableNames = result.tableNames; })
      .catch(error => { certificate.error = String(error); });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }));
  for (const method of ['Security.visibleSecurityStateChanged', 'Security.certificateError']) {
    unsubscribers.push(await ctx.page.on(method, params => { securityEvents.push({ method, params }); }));
  }
  try {
    await ctx.page.command('Security.enable');
    securityDomain.available = true;
  } catch (error) {
    securityDomain.error = String(error);
    ctx.log('Security event domain unavailable: ' + securityDomain.error);
  }
  ctx.ready();
  await ctx.untilStopped();
  unsubscribers.forEach(unsubscribe => unsubscribe());
  await Promise.all(pending);
  if (!connections.length) return { status: 'noresults', summary: 'No browser TLS connection details observed (HTTP or cached responses may have none).' };
  const body = JSON.stringify({ connections, certificates: [...certificates.values()], securityEvents, securityDomain });
  const record = await ctx.archive.addResource({ kind: 'sslcerts', mime: 'application/json', body, metadata: { certificateEncoding: 'base64 DER', source: 'Chrome DevTools Protocol' } });
  const count = [...certificates.values()].filter(item => item.tableNames?.length).length;
  return { records: [record], summary: connections.length + ' TLS connections; certificate chains for ' + count + ' origins' };
}
