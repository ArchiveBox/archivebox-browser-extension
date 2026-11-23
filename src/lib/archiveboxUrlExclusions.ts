const commonSecondLevelTlds = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

function isIpAddressOrLocalhost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.includes(':')
    || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function registrableDomain(hostname: string): string {
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length <= 2 || isIpAddressOrLocalhost(hostname)) return hostname;

  const tld = labels[labels.length - 1] as string;
  const secondLevel = labels[labels.length - 2] as string;
  if (tld.length === 2 && commonSecondLevelTlds.has(secondLevel) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

// Pages the extension should archive: only real http(s) web pages. Everything
// else (file://, about:blank, chrome://, chrome-extension://, devtools://,
// data:, view-source:, the new tab page, etc.) is either local/private or not
// capturable, so trying to archive it only produces "Cannot find the tab"/"Don't
// have permissions" errors and saves junk snapshots.
export function isArchiveablePageUrl(targetUrl: string): boolean {
  if (!targetUrl) return false;
  try {
    const { protocol } = new URL(targetUrl);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function archiveableTabPage(tab: { url?: string; title?: string; favIconUrl?: string; discarded?: boolean }) {
  if (!tab.url) return null;
  const { url, title = '', discarded = false } = tab;
  if (isArchiveablePageUrl(url)) return { url, title, favIconUrl: tab.favIconUrl || null, suspended: discarded };

  let placeholder: URL;
  try {
    placeholder = new URL(url);
  } catch {
    return null;
  }
  if (!['chrome-extension:', 'moz-extension:'].includes(placeholder.protocol)
    || !/\/(?:suspend(?:ed)?|park(?:ed)?|sleep(?:ing)?|discarded)\.html$/i.test(placeholder.pathname)) return null;

  const hash = placeholder.hash.slice(1);
  const query = placeholder.search.slice(1);
  for (const encoded of [hash, query]) {
    // Great Suspender and Marvellous append a raw URI last. Its query and
    // fragment belong to the original page, including any literal '&' or '+'.
    const raw = /(?:^|&)uri=(https?:\/\/.*)$/i.exec(encoded);
    const params = new URLSearchParams(raw ? encoded.slice(0, raw.index) : encoded);
    const original = raw?.[1] ?? params.get('uri') ?? params.get('url') ?? params.get('u') ?? params.get('originalUrl');
    if (original && /^https?:\/\//i.test(original) && isArchiveablePageUrl(original)) {
      const originalTitle = params.get('ttl') || params.get('title') || params.get('t');
      return { url: original, title: originalTitle || title, favIconUrl: null, suspended: true };
    }
  }
  return null;
}

export function archiveBoxServerUrlMatches(serverUrl: string, targetUrl: string): boolean {
  if (!serverUrl || !targetUrl) return false;

  try {
    const server = new URL(serverUrl);
    const target = new URL(targetUrl);
    const serverHostname = normalizeHostname(server.hostname);
    const targetHostname = normalizeHostname(target.hostname);
    if (!serverHostname || !targetHostname) return false;

    const domains = new Set([
      serverHostname,
      registrableDomain(serverHostname),
    ]);
    return [...domains].some((domain) => hostnameMatchesDomain(targetHostname, domain));
  } catch {
    return false;
  }
}
