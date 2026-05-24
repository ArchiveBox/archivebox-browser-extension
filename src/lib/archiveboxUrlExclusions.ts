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
