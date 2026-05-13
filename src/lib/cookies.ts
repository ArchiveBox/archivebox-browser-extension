import type { StoredCookie } from './types';

export function normalizeCookie(cookie: Browser.cookies.Cookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
  };
}

export function formatCookiesForExport(cookies: Record<string, StoredCookie[]>): string {
  return Object.entries(cookies)
    .map(([domain, domainCookies]) => {
      const cookieLines = domainCookies
        .map((cookie) => `${cookie.name}=${cookie.value}; domain=${cookie.domain}; path=${cookie.path}`)
        .join('\n');
      return `# ${domain}\n${cookieLines}`;
    })
    .join('\n\n');
}

export async function getCookiesByDomain(): Promise<Record<string, StoredCookie[]>> {
  const allCookies = await browser.cookies.getAll({});
  return allCookies.reduce<Record<string, StoredCookie[]>>((acc, cookie) => {
    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    acc[domain] ||= [];
    acc[domain].push(normalizeCookie(cookie));
    return acc;
  }, {});
}
