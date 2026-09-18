import { readFile, writeFile, mkdir, cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = fileURLToPath(new URL('../../', import.meta.url));
const siteRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const site = path.join(root, 'docs/site');
const output = path.join(site, '_site');
const baseIndex = process.argv.indexOf('--baseurl');
const base = `/${(baseIndex < 0 ? '' : process.argv[baseIndex + 1] ?? '').replace(/^\/+|\/+$/g, '')}`.replace(/\/$/, '') + '/';
const repo = 'https://github.com/ArchiveBox/archivebox-browser-extension';
const siteHeader = (await readFile(path.join(site, 'header.html'), 'utf8')).replaceAll('__BASE__', base);
const footerTemplate = await readFile(path.join(site, 'footer.html'), 'utf8');
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const manifest = JSON.parse(await readFile(path.join(site, 'screenshots/manifest.json'), 'utf8'));
if (!manifest.version || !/^[a-f0-9]{40}$/.test(manifest.revision) || !Number.isFinite(Date.parse(manifest.generatedAt)) || !manifest.screenshots?.length) throw new Error('Screenshot manifest must include version, full revision, generatedAt, and screenshots');
const profiles = ['desktop', 'tablet', 'mobile'];
const ids = new Set();
for (const capture of manifest.screenshots) {
  if (!capture.id || ids.has(capture.id) || !capture.title || !capture.url || (!capture.source && !/^https:\/\//.test(capture.url))) throw new Error('Screenshot entries need unique IDs, titles, URLs, and source paths');
  ids.add(capture.id);
  if (capture.images?.length !== profiles.length) throw new Error(`Incomplete screenshot profiles: ${capture.id}`);
  for (const profile of profiles) {
    const image = capture.images.find((entry) => entry.name === profile);
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || !/^[\w./-]+\.png$/.test(image.file) || image.file.split('/').includes('..')) throw new Error(`Invalid screenshot: ${capture.id}/${profile}`);
    if (!Number.isInteger(image.imageWidth) || !Number.isInteger(image.imageHeight) || image.imageWidth <= 0 || image.imageHeight <= 0) throw new Error(`Missing image dimensions: ${image.file}`);
    if (!(await stat(path.join(site, 'screenshots', image.file))).isFile()) throw new Error(`Missing screenshot: ${image.file}`);
  }
}

const expected = ['chrome-web-store', 'firefox-add-ons', 'popup', 'popup-crawl-menu', 'saved-urls', 'export-menu', 'edit-tags', 'configuration', 'cookies', 'import-bookmarks', 'import-history', 'snapshot-viewer', 'screenshot-viewer'];
for (const id of expected) if (!ids.has(id)) throw new Error(`Missing required screenshot view: ${id}`);

manifest.screenshots.sort((a, b) => (expected.indexOf(a.id) < 0 ? expected.length : expected.indexOf(a.id)) - (expected.indexOf(b.id) < 0 ? expected.length : expected.indexOf(b.id)));

const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const headings = [];
const slugs = new Map();
const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth }) {
  const html = this.parser.parseInline(tokens);
  const title = html.replace(/<[^>]*>/g, '');
  const slug = title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
  const n = slugs.get(slug) ?? 0;
  slugs.set(slug, n + 1);
  const id = n ? `${slug}-${n}` : slug;
  if (depth === 2) headings.push({ title, id });
  return `<h${depth} id="${escape(id)}">${html}</h${depth}>\n`;
};
const assets = new Set();
function rewrite(url, image = false) {
  const canonical = 'https://archivebox.github.io/archivebox-browser-extension/';
  if (url.startsWith(canonical)) return base + url.slice(canonical.length) + (image ? `?v=${manifest.revision}` : '');
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return url;
  const local = url.replace(/^\.\//, '').replace(/^\//, '');
  if (/^README\.md(?:#|$)/i.test(local)) return base + local.slice(9);
  if (/^screenshots\/?(?:#.*)?$/.test(local)) return base + local;
  if (local.startsWith('docs/site/screenshots/')) return base + local.slice('docs/site/'.length);
  if (image) { assets.add(local); return base + local; }
  return `${repo}/blob/${siteRevision}/${local}`;
}
const markdown = marked.parse(readme, { renderer, gfm: true }).replace(/\b(href|src)=(['"])(.*?)\2/g, (_, attribute, quote, url) => `${attribute}=${quote}${escape(rewrite(url, attribute === 'src'))}${quote}`);
const navigation = headings.map(({ title, id }) => `<a href="${base}#${escape(id)}">${title}</a>`).join('');
function page(title, body, gallery = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#9b2854"><title>${escape(title)}</title><link rel="icon" href="${base}icon.png"><link rel="stylesheet" href="${base}style.css?v=${siteRevision}"></head><body><a class="skip-link" href="#content">Skip to content</a>${siteHeader}<div class="page-layout"><aside><details class="contents"><summary>On this page</summary><nav aria-label="README sections">${navigation}</nav></details></aside><main id="content" class="${gallery ? 'gallery' : 'markdown-body'}">${body}</main></div>${footerTemplate.replaceAll('__BASE__', base).replaceAll('__REVISION__', siteRevision)}<script src="${base}site.js?v=${siteRevision}" defer></script></body></html>`;
}
const gallery = `<h1>Screenshots</h1><p class="provenance">Version ${escape(manifest.version)} · <a href="${repo}/commit/${manifest.revision}">${manifest.revision.slice(0, 12)}</a> · <time datetime="${escape(manifest.generatedAt)}">${escape(manifest.generatedAt)}</time></p><div class="profile-switch" role="group" aria-label="Screenshot viewport">${profiles.map((profile) => `<button type="button" data-profile="${profile}" aria-pressed="${profile === 'desktop'}">${profile[0].toUpperCase() + profile.slice(1)}</button>`).join('')}</div>${manifest.screenshots.map((capture) => `<article class="capture" id="${escape(capture.id)}"><h2>${escape(capture.title)}</h2><p class="capture-meta"><code>${escape(capture.url)}</code> · <a href="${capture.source ? `${repo}/blob/${manifest.revision}/${escape(capture.source)}` : escape(capture.url)}">${capture.source ? 'View source' : 'View page'}</a></p>${capture.images.map((image) => `<figure data-viewport="${image.name}"><a class="screenshot-frame" href="${base}screenshots/${escape(image.file)}?v=${manifest.revision}"><img src="${base}screenshots/${escape(image.file)}?v=${manifest.revision}" alt="${escape(capture.title)} — ${image.name}" width="${image.imageWidth}" height="${image.imageHeight}" loading="lazy"></a><figcaption>${image.name} · ${image.width} × ${image.height} viewport · <a href="${base}screenshots/${escape(image.file)}?v=${manifest.revision}">Full image</a></figcaption></figure>`).join('')}</article>`).join('')}`;
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(path.join(output, 'screenshots'), { recursive: true });
await cp(path.join(site, 'screenshots/manifest.json'), path.join(output, 'screenshots/manifest.json'));
for (const capture of manifest.screenshots) for (const image of capture.images) {
  await mkdir(path.dirname(path.join(output, 'screenshots', image.file)), { recursive: true });
  await cp(path.join(site, 'screenshots', image.file), path.join(output, 'screenshots', image.file));
}
await cp(path.join(root, 'public/icon/128.png'), path.join(output, 'icon.png'));
for (const asset of assets) {
  const resolved = path.resolve(root, asset);
  if (!resolved.startsWith(root)) throw new Error(`Asset outside repository: ${asset}`);
  await mkdir(path.dirname(path.join(output, asset)), { recursive: true });
  await cp(resolved, path.join(output, asset));
}
for (const file of ['style.css', 'site.js']) await cp(path.join(site, file), path.join(output, file));
await writeFile(path.join(output, 'index.html'), page('ArchiveBox Browser Extension', markdown));
await writeFile(path.join(output, 'screenshots/index.html'), page('Screenshots · ArchiveBox Browser Extension', gallery, true));
await writeFile(path.join(output, '.nojekyll'), '');
console.log(`Built README and ${manifest.screenshots.length} screenshot views at ${output} (${base})`);
