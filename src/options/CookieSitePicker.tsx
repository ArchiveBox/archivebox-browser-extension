import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Check, ChevronDown, Copy, Cookie, Globe2, Search, X } from 'lucide-react';
import { groupCookieSites, type CookieSite } from '../lib/cookieSites';
import { t } from '../lib/i18n';
import type { StoredCookie } from '../lib/types';

export function SiteIcon({ site, cached }: { site: CookieSite; cached?: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const google = site.public ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site.domain)}&sz=64` : '';
  const src = [cached, google].find(url => url && !failed.includes(url));
  return <span className="site-icon" aria-hidden="true">{src
    ? <img src={src} alt="" width="20" height="20" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(current => [...current, src])} />
    : <Globe2 size={19} />}</span>;
}

function SelectionCheckbox({ selected, total, label, onChange }: { selected: number; total: number; label: string; onChange: (checked: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (input.current) input.current.indeterminate = selected > 0 && selected < total; }, [selected, total]);
  return <input ref={input} type="checkbox" aria-label={label} checked={total > 0 && selected === total} onChange={event => onChange(event.currentTarget.checked)} />;
}

export function CookieSitePicker({ cookies, selected, setSelected, cachedIcons, savedDomains, loaded, onCopy, onRemove }: {
  cookies: Record<string, StoredCookie[]>;
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  cachedIcons: Record<string, string>;
  savedDomains: Set<string>;
  loaded: boolean;
  onCopy: (domain: string, cookies: StoredCookie[]) => void;
  onRemove: (domain: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sites = useMemo(() => groupCookieSites(cookies), [cookies]);
  const visible = sites.filter(site => (filter !== 'saved' || site.domains.some(([domain]) => savedDomains.has(domain)))
    && (filter !== 'selected' || site.domains.some(([domain]) => selected.has(domain)))
    && `${site.name} ${site.domains.map(([domain]) => domain).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const domains = visible.flatMap(site => site.domains.map(([domain]) => domain));
  const select = (domains: string[], checked: boolean) => setSelected(current => {
    const next = new Set(current);
    domains.forEach(domain => checked ? next.add(domain) : next.delete(domain));
    return next;
  });
  return <div className="cookie-picker">
    <div className="cookie-picker-tools">
      <label className="search-field"><Search size={16} aria-hidden="true" />
        <input type="search" aria-label={t('Search sites or domains')} placeholder={t('Search sites or domains…')} value={query} onChange={event => setQuery(event.currentTarget.value)} />
      </label>
      <div className="cookie-filters" role="group" aria-label={t('Filter sites')}>
        {[['all', t('All sites'), Globe2], ['saved', t('In profile'), Check], ['selected', t('Selected'), Check]].map(([value, label, Icon]) => {
          const FilterIcon = Icon as typeof Globe2;
          return <button key={String(value)} aria-pressed={filter === value} onClick={() => setFilter(String(value))}><FilterIcon size={13} aria-hidden="true" />{String(label)}</button>;
        })}
      </div>
    </div>
    {sites.length > 0 && <div className="cookie-picker-meta">
      <label><SelectionCheckbox selected={domains.filter(domain => selected.has(domain)).length} total={domains.length}
        label={t('Select all visible cookie domains')} onChange={checked => select(domains, checked)} />{t('Select visible')}</label>
      <span>{visible.length === 1 ? t('1 site') : t('$1 sites', visible.length)}</span>
    </div>}
    <div className="cookie-site-grid">
      {visible.map(site => {
        const siteDomains = site.domains.map(([domain]) => domain);
        const selectedCount = siteDomains.filter(domain => selected.has(domain)).length;
        const savedCount = siteDomains.filter(domain => savedDomains.has(domain)).length;
        const open = expanded.has(site.domain);
        return <article className={`cookie-site${selectedCount ? ' is-selected' : ''}`} key={site.domain} data-site={site.domain}>
          <div className="cookie-site-main">
            <label className="cookie-site-select">
              <SelectionCheckbox selected={selectedCount} total={siteDomains.length} label={t('Select $1', site.name)} onChange={checked => select(siteDomains, checked)} />
              <SiteIcon site={site} cached={cachedIcons[site.domain]} />
              <span className="cookie-site-label" title={site.domain}><strong>{site.name}</strong></span>
            </label>
            {savedCount > 0 && <span className="cookie-saved" title={t('$1 domains in profile', savedCount)} aria-label={t('$1 domains in profile', savedCount)}><Check size={12} aria-hidden="true" /></span>}
            <button className="cookie-site-expand" aria-label={t('$1 domains for $2', open ? 'Hide' : 'Show', site.name)} aria-expanded={open}
              aria-controls={`cookie-domains-${site.domain}`} onClick={() => setExpanded(current => {
                const next = new Set(current); if (open) next.delete(site.domain); else next.add(site.domain); return next;
              })}>
              <span title={t('$1 cookies', site.cookieCount)} aria-label={t('$1 cookies', site.cookieCount)}>{site.cookieCount}</span><ChevronDown size={12} aria-hidden="true" />
            </button>
          </div>
          {open && <div id={`cookie-domains-${site.domain}`} className="cookie-domains">{site.domains.map(([domain, domainCookies]) => <div key={domain}>
            <label><input type="checkbox" aria-label={t('Select $1', domain)} checked={selected.has(domain)} onChange={event => select([domain], event.currentTarget.checked)} /><span title={domain}>{domain}</span><small>{domainCookies.length}</small></label>
            <button className="cookie-icon-button" aria-label={t('Copy cookies for $1', domain)} title={t('Copy cookies.txt')} onClick={() => onCopy(domain, domainCookies)}><Copy size={13} aria-hidden="true" /></button>
            {savedDomains.has(domain) && <button className="cookie-icon-button" aria-label={t('Remove $1', domain)} title={t('Remove $1 from profile', domain)} onClick={() => onRemove(domain)}><X size={13} aria-hidden="true" /></button>}
          </div>)}</div>}
        </article>;
      })}
    </div>
    {visible.length === 0 && <div className="cookie-empty">
      {sites.length ? <Search size={25} aria-hidden="true" /> : <Cookie size={28} aria-hidden="true" />}
      <strong>{sites.length ? t('No matching sites') : loaded ? t('No browser cookies found') : t('Bring your logins along')}</strong>
      <p>{sites.length ? t('Try another search or filter.') : loaded ? t('Sign in to a website, then refresh this list.') : t('Load browser cookies, choose your sites, and add them to a profile.')}</p>
      {sites.length > 0 && <button onClick={() => { setQuery(''); setFilter('all'); }}>{t('Clear search')}</button>}
    </div>}
    {selected.size > 0 && <button className="cookie-clear-selection" onClick={() => setSelected(new Set())}><X size={13} aria-hidden="true" />{t('Clear selection')}</button>}
  </div>;
}
