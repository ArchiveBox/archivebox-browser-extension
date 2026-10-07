// Source-port of vendor/archivebox/plugins/consolelog/full.html; only archived data loading is replaced.
export function initializeConsole(document, data) {
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (cls) node.className = cls; return node; };;
  const content = document.getElementById('content');
  const normalizeLevel = row => {
    const type = String(row.type || '').toLowerCase();
    if (['error','assert','pageerror','request_failed'].includes(type)) return 'error';
    if (['warning','warn'].includes(type)) return 'warn';
    if (['log','info','debug','dir','table','trace','clear','count','startgroup','endgroup'].includes(type)) return 'info';
    return 'other';
  };
  const iconFor = level => level === 'error' ? '✕' : level === 'warn' ? '⚠' : level === 'info' ? '›' : '·';
  const formatTime = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString([], {hour12:false});
  };
  const formatValue = value => {
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'undefined') return 'undefined';
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const appendValue = (parent, value) => {
    if (value && typeof value === 'object') {
      const details = document.createElement('details'); details.className = 'arg';
      details.append(el('summary', formatValue(value).slice(0, 160)));
      const pre = el('pre', '');
      try { pre.textContent = JSON.stringify(value, null, 2); } catch { pre.textContent = String(value); }
      details.append(pre); parent.append(details);
    } else parent.append(el('code', formatValue(value), 'arg'));
  };
  const sourceText = row => {
    const loc = row.location && typeof row.location === 'object' ? row.location : {};
    const source = loc.url || row.url || '';
    if (!source) return '';
    const line = loc.lineNumber == null ? '' : ':' + (Number(loc.lineNumber) + 1);
    const column = loc.columnNumber == null ? '' : ':' + (Number(loc.columnNumber) + 1);
    return source + line + column;
  };
  const counts = rows => rows.reduce((out, row) => { const level = normalizeLevel(row); out[level] = (out[level] || 0) + 1; return out; }, {});
  {
    const rows = data;
    const tally = counts(rows);

    const toolbar = el('div', null, 'toolbar');
    const filter = el('input'); filter.className = 'filter'; filter.type = 'search'; filter.placeholder = 'Filter messages, URLs, or stacks…'; filter.setAttribute('aria-label', 'Filter console messages');
    const levelFilter = el('select'); levelFilter.className = 'level-filter'; levelFilter.setAttribute('aria-label', 'Filter console level');
    [['all','All levels'],['error','Errors'],['warn','Warnings'],['info','Info'],['other','Other']].forEach(([value,label]) => { const option = el('option', label); option.value = value; levelFilter.append(option); });
    toolbar.append(filter, levelFilter);
    const stats = el('div', null, 'stats');
    [['error','✕ '],['warn','⚠ '],['info','› '],['other','· ']].forEach(([level, icon]) => { if (tally[level]) stats.append(el('span', icon + tally[level] + ' ' + level, 'badge ' + level)); });
    content.append(toolbar, stats, el('div', null, 'logs'));
    const logs = content.querySelector('.logs');
    const render = () => {
      const needle = filter.value.trim().toLowerCase();
      const wanted = levelFilter.value;
      logs.replaceChildren();
      let shown = 0;
      rows.forEach(row => {
        const level = normalizeLevel(row);
        if (wanted !== 'all' && wanted !== level) return;
        if (needle && !JSON.stringify(row).toLowerCase().includes(needle)) return;
        const line = el('article', null, 'log-row ' + level);
        line.append(el('div', iconFor(level), 'icon'), el('div', formatTime(row.timestamp), 'time'));
        const body = el('div');
        body.append(el('div', row.text || row.message || row.error || '(empty)', 'message'));
        const meta = el('div', null, 'meta');
        if (row.type) meta.append(el('span', String(row.type), 'badge ' + level));
        const source = sourceText(row); if (source) meta.append(el('span', source, 'source'));
        if (row.error && row.text) meta.append(el('span', row.error, 'badge error'));
        if (meta.childElementCount) body.append(meta);
        if (Array.isArray(row.args) && row.args.length) { const args = el('div', null, 'args'); row.args.forEach(value => appendValue(args, value)); body.append(args); }
        if (row.stack) { const details = document.createElement('details'); details.className = 'stack'; details.append(el('summary', '↳ Stack trace')); details.append(el('pre', row.stack)); body.append(details); }
        line.append(body); logs.append(line); shown += 1;
      });
      if (!shown) logs.append(el('div', 'No matching console messages', 'empty'));
    };
    filter.addEventListener('input', render); levelFilter.addEventListener('change', render); render();
  }
}
