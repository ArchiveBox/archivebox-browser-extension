import type { CaptureKind, Snapshot } from './types';

export const capturePlugins = {
  viewport_screenshot: 'chrome_extension_viewport',
  screenshot: 'chrome_extension_screenshot',
  mhtml: 'chrome_extension_mhtml',
  singlefile: 'chrome_extension_singlefile',
} as const;

export type CaptureDeliveryState = 'uploaded' | 'local' | 'missing' | 'failed' | 'unknown' | 'remote';

export function captureDeliveryState(snapshot: Snapshot, serverId: string, kind: CaptureKind): CaptureDeliveryState {
  const capture = snapshot[kind];
  const copy = snapshot.remote_copies?.[serverId];
  const receipt = copy?.artifacts?.[kind];
  if (receipt) {
    // A server lookup can recover older uploads, but cannot prove that they
    // contain the current local capture without its original version receipt.
    if (!receipt.captured_at && receipt.status === 'uploaded') return 'remote';
    if (!capture || (receipt.captured_at === capture.capturedAt && receipt.path === capture.path)) return receipt.status;
  }
  if (!capture) return 'missing';
  if (copy && copy.artifacts === undefined) return 'unknown';
  return 'local';
}
