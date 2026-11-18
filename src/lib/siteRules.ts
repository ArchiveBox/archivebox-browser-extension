export function siteHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.hostname.toLowerCase().replace(/\.$/, '') : null;
  } catch { return null; }
}

export function siteUrlPattern(host: string): string {
  return `^https?://${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?(?::[0-9]+)?(?:/|$)`;
}

export function siteRulePatch(match: string, exclude: string, enabled: boolean, host: string, allow: boolean) {
  // Validate existing user expressions before composing them, never turn an
  // invalid or inactive broad rule into an accidentally global subscription.
  if (match.trim()) new RegExp(match);
  if (exclude.trim()) new RegExp(exclude);
  const site = siteUrlPattern(host);
  if (!allow) return { exclude_urls: exclude.trim() ? `(?:${exclude})|(?:${site})` : site };
  return {
    enable_auto_archive: true,
    match_urls: enabled && match.trim() ? `(?:${match})|(?:${site})` : site,
    exclude_urls: exclude.trim() ? `^(?!${site.slice(1)})[\\s\\S]*(?:${exclude})` : '',
  };
}

// Extension navigation carries only a validated site/path, never page tokens.
export function siteCookieSource(url: string): string | null {
  if (!siteHostname(url)) return null;
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}
