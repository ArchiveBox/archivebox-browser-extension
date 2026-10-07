import type {CanonicalOptions} from '../archive/views';
/** Original SEO full.html script. WACZ resource lookup replaces the Django
 * response/favicon filesystem lists; the shared wrapper supplies JSON/actions. */
export function initializeSEO(document:Document,data:Record<string,string>,options:CanonicalOptions,faviconURL?:string){
  const el = <T extends keyof HTMLElementTagNameMap>(tag:T, text?:unknown, cls?:string) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (cls) node.className = cls; return node; };
  const safeLink = (value:string, label?:string) => { const a = el('a', label || value); try { const u = new URL(value); if (['https:', 'http:'].includes(u.protocol)) { a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; } } catch {} return a; };;
  const content = document.getElementById('content')!;


    const badges = el('div', null, 'badges');
    for (const [key, icon] of [['language','🌐'],['author','✍'],['robots','◉'],['theme-color','●']] as const) {
      if (!data[key]) continue;
      const badge = el('span', icon + ' ' + data[key], 'badge');
      if (key === 'theme-color' && CSS.supports('color', data[key])) badge.style.borderLeft = '12px solid ' + data[key];
      badges.append(badge);
    }
    // Use archived images so previews also work offline and under the snapshot security policy.
    const localImage = (imageURL:string|undefined, alt?:string) => {
      if (!imageURL) return null;
      try {
        const original = new URL(imageURL, data.url);
        if (!['https:', 'http:'].includes(original.protocol)) return null;
        const resolved = options.resourceURL(original.href);
        if (!resolved) return null;
        const img = el('img');
        img.alt = alt || '';
        img.referrerPolicy = 'no-referrer';
        img.src = resolved;
        img.addEventListener('error', () => img.remove(), {once:true});
        return img;
      } catch { return null; }
    };
    const hostname = (value:string) => {
      try { return new URL(value, data.url).hostname.replace(/^www\./, ''); }
      catch { return value || ''; }
    };
    const rawURL = data['og:url'] || data.canonical || data.url;
    let url = '';
    try { url = new URL(rawURL!, data.url).href; } catch {}
    const title = data['og:title'] || data.title;
    const description = data['og:description'] || data.description;
    const site = data['og:site_name'] || hostname(url);
    const card = el('article', null, 'social');
    const top = el('div', null, 'social-top');
    let icon = localImage(data['og:icon'] || data.icon || data.favicon, site);
    if (!icon) {
      const favicon = faviconURL ? options.resourceURL(faviconURL) : undefined;
      if (favicon) {
        icon = el('img'); icon.alt = site || '';
        icon.src = favicon;
        icon.addEventListener('error', () => icon!.remove(), {once:true});
      }
    }
    if (!icon) {
      try { icon = localImage(new URL('/favicon.ico', url).href, site); } catch {}
    }
    if (icon) { icon.className = 'site-icon'; top.append(icon); }
    else top.append(el('span', '🌐', 'site-icon site-placeholder'));
    const identity = el('div', null, 'identity');
    identity.append(el('strong', site || title));
    if (url && site !== hostname(url)) identity.append(el('span', hostname(url)));
    top.append(identity); card.append(top);
    const preview = url ? safeLink(url, '') : el('div');
    preview.textContent = ''; preview.className = 'link-preview';
    const imageURLs = [data['og:image:secure_url'], data['og:image'], data['og:image:url'], data['twitter:image'], data['twitter:image:src'], data.image];
    let image:HTMLImageElement|null|undefined;
    for (const imageURL of imageURLs) {
        image = localImage(imageURL, data['og:image:alt'] || data['twitter:image:alt']);
        if (image) break;
    }
    if (image) preview.append(image);
    const linkCopy = el('div', null, 'link-copy');
    if (title) linkCopy.append(el('h2', title));
    if (description) linkCopy.append(el('p', description));
    preview.append(linkCopy); card.append(preview);
    const actionBar = el('div', null, 'social-actions');
    const icons = [
      ['Like', 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'],
      ['Comment', 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.5a9 9 0 0 1-.9-4A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z'],
      ['Share', 'M12 16V3m-5 5 5-5 5 5M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7'],
    ] as const;
    for (const [label, path] of icons) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
      const shape = document.createElementNS(svg.namespaceURI, 'path'); shape.setAttribute('d', path);
      svg.append(shape); actionBar.append(svg);
    }
    card.append(actionBar); content.append(card, badges);
    const panel=el('details',null,'metadata'); panel.open=true; panel.append(el('summary','Metadata'));
    const fields=el('dl');
    for(const [key,value] of Object.entries(data)){ fields.append(el('dt',key),el('dd',value)); }
    panel.append(fields); content.append(panel);
}
