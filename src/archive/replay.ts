import { ArchiveRequest, ArchiveResponse, Rewriter } from '@webrecorder/wabac';
import DOMPurify from 'dompurify';
import type { ArchiveReader, ArchiveEntry } from './reader';
import { playerURL, replayCommand } from '../replay/client';

/** Derived documents are also consumed by article parsers that create their own
 * document base. Keep upstream rewriting, but make its local replay URLs
 * absolute so a parser cannot resolve /w/... against the original server. */
class DerivedDocumentRewriter extends Rewriter {
  override rewriteUrl(url:string,forceAbs=true){
    const rewritten=super.rewriteUrl(url,forceAbs),prefix=new URL(this.prefix);
    if(rewritten.startsWith(prefix.pathname))return `${prefix.protocol}//${prefix.host}${rewritten}`;
    if(rewritten.startsWith(`//${prefix.host}/`))return prefix.protocol+rewritten;
    return rewritten;
  }
}

export async function mountReplay(archive: ArchiveReader) {
  if (!archive.captureId) throw Error('Replay requires a saved WACZ');
  // initialize() inspected this same collection and already mounted it.
  if(archive.replayHash)return archive.captureId;
  const result = await replayCommand({ type: 'mount-wacz', id: archive.captureId, sourceUrl: archive.sourceUrl });
  if (result?.error) throw Error(result.error);
  if (!result?.ok) throw Error('Replay service worker did not mount the archive');
  archive.replayHash = result.hash;
  await navigator.serviceWorker.ready;
  return archive.captureId;
}

export function replayURL(archive: ArchiveReader, url: string, timestamp = '', mod = 'mp_') {
  if (!archive.captureId) throw Error('Replay requires a saved WACZ');
  const hash = archive.replayHash ? `:${archive.replayHash}/` : '';
  return playerURL(`w/${archive.captureId}/${hash}${timestamp}${mod}/${url}`);
}

export function recordURL(archive: ArchiveReader, entry: ArchiveEntry, mod = 'id_') {
  if(entry.native)return playerURL(`plugin-record/${archive.captureId}/${entry.ts}/${encodeURIComponent(entry.url)}`);
  return replayURL(archive, entry.url, entry.timestamp, mod);
}

/** Restore navigation links when exporting a standalone derived document. */
export function originalURL(archive:ArchiveReader,value:string){
  const prefix=playerURL(`w/${archive.captureId}/`);
  return value.startsWith(prefix)?value.slice(prefix.length).replace(/^(?::[^/]+\/)?\d*[a-z]+_\//,''):value;
}

/** Derive markup only; Webrecorder resolves every referenced response from the WACZ. */
export async function replayHTML(archive: ArchiveReader, html: string, url: string, {preserveForms=false}:{preserveForms?:boolean}={}) {
  await mountReplay(archive);
  // A derivation can consume markup that Webrecorder already rewrote (Mercury
  // materializes images while parsing). Keep only this archive's replay URLs,
  // alongside DOMPurify's standard URI policy; never arbitrary extension URLs.
  const collectionPrefix = playerURL(`w/${archive.captureId}/`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const allowedURI = new RegExp(`^(?:${collectionPrefix}(?::[a-f0-9]+/)?\\d{0,17}[a-z]+_/https?://|(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`, 'i');
  // DOMPurify already parsed the whole document. Use that sanitized tree
  // directly instead of serializing and parsing every node a second time.
  const cleaned = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, RETURN_DOM: true, ALLOWED_URI_REGEXP: allowedURI, ADD_TAGS: ['style', 'link', 'base'], ADD_ATTR: ['rel'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed',...(preserveForms?[]:['form'])] });
  const doc = cleaned.ownerDocument!;
  const base = doc.querySelector('base') || doc.createElement('base');
  base.href = new URL(base.getAttribute('href') || url, url).href;
  doc.head.prepend(base);
  doc.querySelectorAll('meta[http-equiv]').forEach(node => node.remove());
  if(!preserveForms)for (const control of doc.querySelectorAll('input,button,select,textarea')) control.setAttribute('disabled', '');
  const timestamp = archive.find(url)?.timestamp || '';
  const prefix = replayURL(archive, '', timestamp);
  const response = new ArchiveResponse({ payload: new TextEncoder().encode('<!doctype html>' + doc.documentElement.outerHTML), status: 200, headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }), url, date: new Date() });
  // This is a document derivation, not an AJAX response (which wabac leaves unrewritten).
  const request = new ArchiveRequest(`mp_/${url}`, new Request(url, { mode: 'same-origin' }));
  const rewritten = await new DerivedDocumentRewriter({ baseUrl: url, prefix, decode: false }).rewrite(response, request);
  return rewritten.makeResponse().text();
}
