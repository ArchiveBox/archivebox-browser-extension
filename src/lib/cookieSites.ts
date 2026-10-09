import { parse } from 'tldts';
import type { StoredCookie } from './types';

// A curated convenience order, not a traffic ranking. Only sites with cookies appear.
const commonSites = [
  ['facebook.com', 'Facebook'], ['instagram.com', 'Instagram'], ['google.com', 'Google'],
  ['youtube.com', 'YouTube'], ['reddit.com', 'Reddit'], ['x.com', 'X'],
  ['twitter.com', 'Twitter'], ['tiktok.com', 'TikTok'], ['linkedin.com', 'LinkedIn'],
  ['whatsapp.com', 'WhatsApp'], ['messenger.com', 'Messenger'], ['threads.net', 'Threads'],
  ['pinterest.com', 'Pinterest'], ['snapchat.com', 'Snapchat'], ['discord.com', 'Discord'],
  ['twitch.tv', 'Twitch'], ['tumblr.com', 'Tumblr'], ['bluesky.app', 'Bluesky'],
  ['bsky.app', 'Bluesky'], ['mastodon.social', 'Mastodon'], ['telegram.org', 'Telegram'],
  ['github.com', 'GitHub'], ['gitlab.com', 'GitLab'], ['stackoverflow.com', 'Stack Overflow'],
  ['stackexchange.com', 'Stack Exchange'], ['ycombinator.com', 'Hacker News'],
  ['wikipedia.org', 'Wikipedia'], ['archive.org', 'Internet Archive'], ['medium.com', 'Medium'],
  ['substack.com', 'Substack'], ['quora.com', 'Quora'], ['patreon.com', 'Patreon'],
  ['amazon.com', 'Amazon'], ['ebay.com', 'eBay'], ['etsy.com', 'Etsy'],
  ['walmart.com', 'Walmart'], ['target.com', 'Target'], ['costco.com', 'Costco'],
  ['aliexpress.com', 'AliExpress'], ['alibaba.com', 'Alibaba'], ['shopify.com', 'Shopify'],
  ['bestbuy.com', 'Best Buy'], ['homedepot.com', 'Home Depot'], ['ikea.com', 'IKEA'],
  ['craigslist.org', 'Craigslist'], ['offerup.com', 'OfferUp'], ['paypal.com', 'PayPal'],
  ['stripe.com', 'Stripe'], ['netflix.com', 'Netflix'], ['spotify.com', 'Spotify'],
  ['hulu.com', 'Hulu'], ['disneyplus.com', 'Disney+'], ['max.com', 'Max'],
  ['primevideo.com', 'Prime Video'], ['soundcloud.com', 'SoundCloud'], ['bandcamp.com', 'Bandcamp'],
  ['vimeo.com', 'Vimeo'], ['dailymotion.com', 'Dailymotion'], ['imdb.com', 'IMDb'],
  ['goodreads.com', 'Goodreads'], ['nytimes.com', 'The New York Times'], ['washingtonpost.com', 'The Washington Post'],
  ['theguardian.com', 'The Guardian'], ['bbc.com', 'BBC'], ['bbc.co.uk', 'BBC'],
  ['cnn.com', 'CNN'], ['reuters.com', 'Reuters'], ['bloomberg.com', 'Bloomberg'],
  ['wsj.com', 'The Wall Street Journal'], ['ft.com', 'Financial Times'], ['economist.com', 'The Economist'],
  ['apnews.com', 'AP News'], ['npr.org', 'NPR'], ['arstechnica.com', 'Ars Technica'],
  ['theverge.com', 'The Verge'], ['wired.com', 'WIRED'], ['microsoft.com', 'Microsoft'],
  ['live.com', 'Microsoft Live'], ['outlook.com', 'Outlook'], ['office.com', 'Microsoft 365'],
  ['apple.com', 'Apple'], ['icloud.com', 'iCloud'], ['yahoo.com', 'Yahoo'],
  ['proton.me', 'Proton'], ['dropbox.com', 'Dropbox'], ['notion.so', 'Notion'],
  ['slack.com', 'Slack'], ['figma.com', 'Figma'], ['canva.com', 'Canva'],
  ['trello.com', 'Trello'], ['atlassian.com', 'Atlassian'], ['zoom.us', 'Zoom'],
  ['openai.com', 'OpenAI'], ['chatgpt.com', 'ChatGPT'], ['claude.ai', 'Claude'],
  ['perplexity.ai', 'Perplexity'], ['airbnb.com', 'Airbnb'], ['booking.com', 'Booking.com'],
  ['tripadvisor.com', 'Tripadvisor'], ['steampowered.com', 'Steam'],
] as const;
const commonSiteIndex = new Map<string, { name: string; rank: number }>(commonSites.map(([domain, name], rank) => [domain, { name, rank }]));

export type CookieSite = {
  domain: string;
  name: string;
  rank: number;
  public: boolean;
  domains: Array<[string, StoredCookie[]]>;
  cookieCount: number;
};

export function cookieSiteDomain(hostname: string): string {
  const host = hostname.replace(/^\./, '').toLowerCase();
  const parsed = parse(host, { allowPrivateDomains: true });
  // Keep local hostnames/IPs and separate tenants (e.g. alice.github.io) apart.
  return (parsed.isIcann || parsed.isPrivate) && parsed.domain ? parsed.domain : host;
}

export function groupCookieSites(cookies: Record<string, StoredCookie[]>): CookieSite[] {
  const groups = new Map<string, CookieSite>();
  for (const [host, values] of Object.entries(cookies)) {
    const domain = cookieSiteDomain(host);
    let group = groups.get(domain);
    if (!group) {
      const known = commonSiteIndex.get(domain);
      const parsed = parse(domain, { allowPrivateDomains: true });
      group = { domain, name: known?.name || domain, rank: known?.rank ?? Infinity,
        public: Boolean(parsed.isIcann || parsed.isPrivate) && !!parsed.domain && !domain.endsWith('.onion'),
        domains: [], cookieCount: 0 };
      groups.set(domain, group);
    }
    group.domains.push([host, values]);
    group.cookieCount += values.length;
  }
  return [...groups.values()].map(group => ({ ...group, domains: group.domains.sort(([a], [b]) => a.localeCompare(b)) }))
    // Keep only a handful of familiar sites at the top; the long tail, including
    // the rest of the curated list, stays together alphabetically.
    .sort((a, b) => (Math.min(a.rank, 4) - Math.min(b.rank, 4)) || a.domain.localeCompare(b.domain));
}
