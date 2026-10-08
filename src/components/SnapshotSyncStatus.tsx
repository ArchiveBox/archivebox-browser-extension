import { useId, useRef } from 'react';
import { t } from '../lib/i18n';
import { captureDeliveryState, type CaptureDeliveryState } from '../lib/captureStatus';
import type { CaptureKind, Snapshot } from '../lib/types';

// Same SVG geometry as abx-plugins' chrome_mhtml, screenshot, and singlefile
// templates/icon.html, used by the ArchiveBox admin list. Extension aliases
// intentionally share the plugin's icon.
function OutputIcon({ kind }: { kind: CaptureKind | 'url' }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'mhtml' ? <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5z" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" /></>
      : kind === 'viewport_screenshot' || kind === 'screenshot' ? <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M8 6l1.5-2h5L16 6" /></>
        : kind === 'singlefile' ? <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M9 14l2 2 4-4" /></>
          : <><path d="M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>}
  </svg>;
}

type DeliveryItem = { kind: CaptureKind | 'url'; name: string; state: CaptureDeliveryState; detail: string };

function DeliveryPile({ items, serverName }: { items: DeliveryItem[]; serverName: string }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const first = items[0]!;
  const uploaded = items.every(item => item.state === 'uploaded');
  const uncertain = items.some(item => ['failed', 'unknown', 'remote'].includes(item.state))
    || (items.some(item => item.state === 'uploaded') && !uploaded);
  const state = uploaded ? 'uploaded' : uncertain ? 'warning' : 'local';
  const description = items.map(item => `${item.name}: ${item.detail}`).join('\n');
  return <span className={`files-icon-pile files-icon-pile--${state}`}>
    <button className="files-icon-pile-top" type="button" popoverTarget={id} title={description} aria-label={description}
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (panel.current) {
          panel.current.style.left = `${Math.max(8, Math.min(rect.right - 260, window.innerWidth - 268))}px`;
          panel.current.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - (items.length * 48 + 56)))}px`;
        }
      }}>
      <OutputIcon kind={first.kind} />
      <span className="files-icon-pile-mark" aria-hidden="true">{uploaded ? '✓' : uncertain ? '!' : '−'}</span>
    </button>
    <div id={id} ref={panel} popover="auto" className="files-icon-pile-popup">
      <strong>{t('Server delivery')}{serverName ? ` · ${serverName}` : ''}</strong>
      {items.map(item => <div className="file-delivery" data-sync-kind={item.kind} data-state={item.state} key={item.kind}>
        <OutputIcon kind={item.kind} />
        <div><b>{item.name}</b><span>{item.detail}</span></div>
      </div>)}
    </div>
  </span>;
}

export function SnapshotSyncStatus({ snapshot, serverId, serverName, urlStatus }: {
  snapshot: Snapshot; serverId: string; serverName: string;
  urlStatus: { kind: 'idle' | 'success' | 'error' | 'warning'; text: string };
}) {
  const copy = snapshot.remote_copies?.[serverId];
  const item = (kind: CaptureKind): DeliveryItem => {
    const state = captureDeliveryState(snapshot, serverId, kind);
    const name = kind === 'mhtml' ? 'MHTML' : kind === 'viewport_screenshot' ? t('Viewport screenshot')
      : kind === 'screenshot' ? t('Full-page screenshot') : t('SingleFile HTML');
    const detail = state === 'uploaded' ? t('Uploaded') : state === 'local' ? t('Saved locally; not uploaded')
      : state === 'missing' ? t('Not captured') : state === 'failed' ? t('Upload failed: $1', copy?.artifacts?.[kind]?.error || '')
        : state === 'remote' ? t('On server; local version unverified') : t('Upload not yet verified');
    return { kind, name, state, detail };
  };
  const html = [item('mhtml')];
  if (snapshot.singlefile || copy?.artifacts?.singlefile) html.push(item('singlefile'));
  const screenshots = [item('viewport_screenshot')];
  if (snapshot.screenshot || copy?.artifacts?.screenshot) screenshots.push(item('screenshot'));
  const url: DeliveryItem = { kind: 'url', name: 'URL', state: copy ? 'uploaded' : urlStatus.kind === 'error' ? 'failed' : 'local',
    detail: urlStatus.text };
  return <div className="files-icons" role="group" aria-label={t('Server delivery')}>
    {[ [url], html, screenshots ].map(items => <DeliveryPile key={items[0]!.kind} items={items} serverName={serverName} />)}
  </div>;
}
