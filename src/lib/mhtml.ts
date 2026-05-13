import { t } from './i18n';

type MimeHeaders = Record<string, string>;

type MhtmlPart = {
  headers: MimeHeaders;
  body: string;
};

type DecodedMhtmlPart = MhtmlPart & {
  bytes: Uint8Array;
  contentId: string;
  location: string;
  mimeType: string;
  text: string;
};

export type RenderedMhtml = {
  html: string;
  partCount: number;
  title?: string;
};

function splitHeaderAndBody(value: string): { headerText: string; body: string } {
  const normalized = value.replace(/\r\n/g, '\n');
  const boundary = normalized.indexOf('\n\n');
  if (boundary === -1) {
    return { headerText: '', body: normalized };
  }
  return {
    headerText: normalized.slice(0, boundary),
    body: normalized.slice(boundary + 2),
  };
}

function parseMimeHeaders(headerText: string): MimeHeaders {
  const unfolded: string[] = [];
  for (const line of headerText.split('\n')) {
    if (/^\s/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }

  return unfolded.reduce<MimeHeaders>((headers, line) => {
    const separator = line.indexOf(':');
    if (separator <= 0) return headers;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    return headers;
  }, {});
}

function mimeType(contentType = ''): string {
  const [type = ''] = contentType.split(';', 1);
  return type.trim().toLowerCase();
}

function mimeParameter(value: string | undefined, name: string): string {
  if (!value) return '';
  const matcher = new RegExp(`${name}\\s*=\\s*(?:"([^"]+)"|([^;\\s]+))`, 'i');
  const match = value.match(matcher);
  return match?.[1] || match?.[2] || '';
}

function parseMhtmlParts(rawMhtml: string): { headers: MimeHeaders; parts: MhtmlPart[] } {
  const top = splitHeaderAndBody(rawMhtml);
  const headers = parseMimeHeaders(top.headerText);
  const boundary = mimeParameter(headers['content-type'], 'boundary');
  if (!boundary) {
    throw new Error(t('MHTML file is missing a multipart boundary'));
  }

  const delimiter = `--${boundary}`;
  const parts = top.body
    .split(delimiter)
    .slice(1)
    .map((part) => part.replace(/^\n/, '').replace(/\n$/, ''))
    .filter((part) => part.trim() && part.trim() !== '--')
    .map((part) => {
      const cleaned = part.replace(/\n--$/, '');
      const section = splitHeaderAndBody(cleaned);
      return {
        headers: parseMimeHeaders(section.headerText),
        body: section.body,
      };
    });

  if (!parts.length) {
    throw new Error(t('MHTML file does not contain any parts'));
  }

  return { headers, parts };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function quotedPrintableToBytes(value: string): Uint8Array {
  const normalized = value.replace(/=\n/g, '');
  const bytes: number[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const hex = normalized.slice(index + 1, index + 3);
    if (char === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      index += 2;
      continue;
    }

    const codePoint = normalized.charCodeAt(index);
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else {
      bytes.push(...new TextEncoder().encode(char));
    }
  }

  return new Uint8Array(bytes);
}

function decodeMhtmlPart(part: MhtmlPart): DecodedMhtmlPart {
  const transferEncoding = (part.headers['content-transfer-encoding'] || '').trim().toLowerCase();
  const bytes = transferEncoding === 'base64'
    ? base64ToBytes(part.body)
    : transferEncoding === 'quoted-printable'
      ? quotedPrintableToBytes(part.body)
      : new TextEncoder().encode(part.body);

  return {
    ...part,
    bytes,
    contentId: (part.headers['content-id'] || '').trim().replace(/^<|>$/g, ''),
    location: (part.headers['content-location'] || '').trim(),
    mimeType: mimeType(part.headers['content-type']),
    text: new TextDecoder('utf-8').decode(bytes),
  };
}

function makeDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

function addResourceAlias(resources: Map<string, string>, alias: string, dataUrl: string, baseUrl: string) {
  if (!alias) return;
  resources.set(alias, dataUrl);

  try {
    resources.set(new URL(alias, baseUrl).href, dataUrl);
  } catch {
    // Some MHTML locations are cid: URLs or browser-internal pseudo URLs.
  }

  try {
    resources.set(decodeURI(alias), dataUrl);
  } catch {
    // Keep the encoded alias when it is not valid URI text.
  }
}

function addResourceAliases(resources: Map<string, string>, part: DecodedMhtmlPart, dataUrl: string, baseUrl: string) {
  addResourceAlias(resources, part.location, dataUrl, baseUrl);
  addResourceAlias(resources, part.contentId, dataUrl, baseUrl);
  if (part.contentId) addResourceAlias(resources, `cid:${part.contentId}`, dataUrl, baseUrl);
}

function lookupResource(resources: Map<string, string>, value: string, baseUrl: string): string | null {
  if (!value || /^(?:data|blob|javascript):/i.test(value)) return null;

  const candidates = new Set([value]);
  try {
    candidates.add(new URL(value, baseUrl).href);
  } catch {
    // Relative pseudo URLs may not parse; exact lookup still applies.
  }

  try {
    candidates.add(decodeURI(value));
  } catch {
    // Keep the encoded value only.
  }

  for (const candidate of candidates) {
    const direct = resources.get(candidate);
    if (direct) return direct;

    const withoutHash = candidate.replace(/#.*$/, '');
    const hashless = resources.get(withoutHash);
    if (hashless) return hashless;
  }

  return null;
}

function rewriteCssUrls(css: string, baseUrl: string, resources: Map<string, string>): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote: string, url: string) => {
    const replacement = lookupResource(resources, url.trim(), baseUrl);
    return replacement ? `url("${replacement}")` : match;
  });
}

function rewriteSrcset(value: string, baseUrl: string, resources: Map<string, string>): string {
  return value.split(',').map((candidate) => {
    const tokens = candidate.trim().split(/\s+/);
    const url = tokens.shift();
    if (!url) return candidate;
    const replacement = lookupResource(resources, url, baseUrl);
    return [replacement || url, ...tokens].join(' ');
  }).join(', ');
}

function rewriteHtml(html: string, baseUrl: string, resources: Map<string, string>): { html: string; title?: string } {
  const document = new DOMParser().parseFromString(html, 'text/html');

  for (const element of [...document.querySelectorAll<HTMLElement>('[src]')]) {
    const value = element.getAttribute('src') || '';
    const replacement = lookupResource(resources, value, baseUrl);
    if (replacement) element.setAttribute('src', replacement);
  }

  for (const element of [...document.querySelectorAll<HTMLElement>('[href]')]) {
    const value = element.getAttribute('href') || '';
    const replacement = lookupResource(resources, value, baseUrl);
    if (replacement) {
      element.setAttribute('href', replacement);
    } else if (element.tagName.toLowerCase() === 'a') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noreferrer');
    }
  }

  for (const element of [...document.querySelectorAll<HTMLElement>('[poster]')]) {
    const value = element.getAttribute('poster') || '';
    const replacement = lookupResource(resources, value, baseUrl);
    if (replacement) element.setAttribute('poster', replacement);
  }

  for (const element of [...document.querySelectorAll<HTMLElement>('[srcset]')]) {
    const value = element.getAttribute('srcset') || '';
    element.setAttribute('srcset', rewriteSrcset(value, baseUrl, resources));
  }

  for (const element of [...document.querySelectorAll<HTMLElement>('[style]')]) {
    const value = element.getAttribute('style') || '';
    element.setAttribute('style', rewriteCssUrls(value, baseUrl, resources));
  }

  for (const style of [...document.querySelectorAll<HTMLStyleElement>('style')]) {
    style.textContent = rewriteCssUrls(style.textContent || '', baseUrl, resources);
  }

  if (!document.querySelector('base')) {
    const base = document.createElement('base');
    base.href = baseUrl;
    base.target = '_blank';
    document.head.prepend(base);
  }

  return {
    html: `<!doctype html>\n${document.documentElement.outerHTML}`,
    title: document.title || undefined,
  };
}

function htmlDataUrl(html: string): string {
  return makeDataUrl('text/html;charset=utf-8', new TextEncoder().encode(html));
}

function buildHtmlPartRenderer(
  htmlParts: DecodedMhtmlPart[],
  resourceUrls: Map<string, string>,
  sourceUrl: string,
) {
  const renderedHtmlUrls = new Map<DecodedMhtmlPart, string>();

  function renderHtmlPart(part: DecodedMhtmlPart, stack: Set<DecodedMhtmlPart>): string {
    const cached = renderedHtmlUrls.get(part);
    if (cached) return cached;

    if (stack.has(part)) {
      return htmlDataUrl(part.text);
    }

    stack.add(part);
    const baseUrl = part.location || sourceUrl;
    const resources = new Map(resourceUrls);
    for (const otherPart of htmlParts) {
      if (otherPart === part) continue;
      addResourceAliases(resources, otherPart, renderHtmlPart(otherPart, stack), baseUrl);
    }
    const rendered = rewriteHtml(part.text, baseUrl, resources);
    const dataUrl = htmlDataUrl(rendered.html);
    renderedHtmlUrls.set(part, dataUrl);
    stack.delete(part);
    return dataUrl;
  }

  return (part: DecodedMhtmlPart) => renderHtmlPart(part, new Set());
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function findRootHtmlPart(parts: DecodedMhtmlPart[], sourceUrl: string): DecodedMhtmlPart {
  const htmlParts = parts.filter((part) => part.mimeType === 'text/html');
  const fallback = htmlParts[0] || parts[0];
  if (!fallback) throw new Error(t('MHTML file does not contain any readable parts'));
  const sourceHref = (() => {
    try {
      return new URL(sourceUrl).href;
    } catch {
      return sourceUrl;
    }
  })();

  return htmlParts.find((part) => {
    try {
      return new URL(part.location || sourceUrl, sourceUrl).href === sourceHref;
    } catch {
      return part.location === sourceUrl;
    }
  }) || fallback;
}

export function renderMhtmlToHtml(rawMhtml: string, sourceUrl: string): RenderedMhtml {
  const { parts } = parseMhtmlParts(rawMhtml);
  const decodedParts = parts.map(decodeMhtmlPart);
  const rootPart = findRootHtmlPart(decodedParts, sourceUrl);
  const baseUrl = rootPart.location || sourceUrl;
  const resources = new Map<string, string>();
  const htmlParts = decodedParts.filter((part) => part.mimeType === 'text/html');

  for (const part of decodedParts) {
    if (part === rootPart || part.mimeType === 'text/html') continue;
    addResourceAliases(resources, part, makeDataUrl(part.mimeType, part.bytes), baseUrl);
  }

  for (const part of decodedParts) {
    if (part === rootPart || part.mimeType !== 'text/css') continue;
    const rewrittenCss = rewriteCssUrls(part.text, baseUrl, resources);
    addResourceAliases(resources, part, makeDataUrl('text/css', new TextEncoder().encode(rewrittenCss)), baseUrl);
  }

  const renderHtmlPart = buildHtmlPartRenderer(htmlParts, resources, sourceUrl);
  for (const part of htmlParts) {
    if (part === rootPart) continue;
    addResourceAliases(resources, part, renderHtmlPart(part), baseUrl);
  }

  const rendered = rootPart.mimeType === 'text/html'
    ? rewriteHtml(rootPart.text, baseUrl, resources)
    : {
      html: `<!doctype html><html><head><title>${escapeHtml(t('MHTML Snapshot'))}</title></head><body><pre>${escapeHtml(rootPart.text)}</pre></body></html>`,
      title: t('MHTML Snapshot'),
    };

  return {
    ...rendered,
    partCount: decodedParts.length,
  };
}
