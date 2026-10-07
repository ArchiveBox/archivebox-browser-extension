export function initializeOutputStacks(root, activateCardPreview) {
    const setPreviewResourcePriority = (card, selected) => card.querySelectorAll("iframe").forEach(frame => { frame.loading = selected ? "eager" : "lazy"; });
    const grid = root.querySelector('.thumb-grid');
    const data = root.querySelector('#snapshot-output-groups');
    if (!grid || !data) return;
    const cards = [...grid.children];
    const groups = JSON.parse(data.textContent).map(group => ({...group, cards: []}));
    for (const card of cards) {
        (groups.find(group => group.id === card.dataset.outputGroup) || groups.find(group => group.id === 'other')).cards.push(card);
    }
    const name = card => card.dataset.pluginName || 'Files';
    const formatStackSize = bytes => {
        if (!bytes || bytes <= 0) return '';
        const kb = 1024;
        const mb = kb * 1024;
        const gb = mb * 1024;
        if (bytes < mb) return `${Math.max(1, Math.ceil(bytes / kb))} KB`;
        if (bytes < gb) return `${Math.ceil(bytes / mb)} MB`;
        return `${(Math.ceil(bytes / gb * 10) / 10).toFixed(1)} GB`;
    };
    const groupSize = group => group.cards.reduce((sum, card) => {
        const cardSize = Number.parseInt(card.dataset.outputSize, 10) || 0;
        const looseSize = [...card.querySelectorAll('.loose-items a[data-output-size]')]
            .reduce((total, link) => total + (Number.parseInt(link.dataset.outputSize, 10) || 0), 0);
        return sum + cardSize + looseSize;
    }, 0);
    const updateGroupSize = group => {
        const size = buttons.get(group.id)?.querySelector('.stack-size');
        if (!size) return;
        size.textContent = formatStackSize(groupSize(group));
        size.hidden = !size.textContent;
    };
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const panel = el('section', 'stack-browser');
    panel.setAttribute('aria-label', 'Snapshot output groups');
    const shelf = el('div', 'stack-shelf');
    shelf.style.setProperty('--stack-columns', groups.filter(group => group.id !== 'other' || group.cards.length).length);
    const tray = el('section', 'stack-tray');
    tray.id = 'stack-tray';
    tray.hidden = true;
    const close = el('button', 'stack-close', '⌃');
    close.title = 'Collapse stack';
    close.setAttribute('aria-label', 'Collapse stack');
    close.type = 'button';
    const trayCards = el('div', 'stack-tray-cards');
    tray.append(close, trayCards);
    const parked = el('div', 'stack-parked');
    parked.hidden = true;
    function movePreviewNode(node, parent, before = null) {
        if (parent.moveBefore && node.isConnected && parent.isConnected) parent.moveBefore(node, before);
        else parent.insertBefore(node, before);
    }
    let active = null;
    const buttons = new Map();
    function collapse() {
        if (!active) return;
        active.cards.forEach(card => movePreviewNode(card, parked));
        const button = buttons.get(active.id);
        button.setAttribute('aria-expanded', 'false');
        tray.hidden = true;
        active = null;
    }
    function expand(group) {
        if (active === group) { collapse(); return; }
        collapse();
        active = group;
        buttons.get(group.id).setAttribute('aria-expanded', 'true');
        trayCards.replaceChildren();
        if (!group.cards.length) {
            const empty = el('div', 'stack-empty', 'No captures');
            trayCards.append(empty);
        }
        for (const card of group.cards) {
            movePreviewNode(card, trayCards);
        }
        tray.setAttribute('aria-label', group.label);
        tray.hidden = false;

    }
    for (const group of groups) {
        if (group.id === 'other' && !group.cards.length) continue;
        const button = el('button', `output-stack output-stack-${group.id}`);
        button.type = 'button';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', tray.id);
        button.setAttribute('aria-label', `${group.label}, ${group.cards.length} outputs, expand stack`);
        const heading = el('span', 'stack-heading');
        const headingLabel = el('span', 'stack-heading-label');
        headingLabel.append(el('strong', '', group.label));
        const size = el('span', 'stack-size', formatStackSize(groupSize(group)));
        size.hidden = !size.textContent;
        headingLabel.append(size);
        const headingRight = el('span', 'stack-heading-right');
        const chevron = el('span', 'stack-chevron');
        chevron.setAttribute('aria-hidden', 'true');
        headingRight.append(el('span', 'stack-count', String(group.cards.length)), chevron);
        heading.append(headingLabel, headingRight);
        const pile = el('span', 'stack-pile');
        pile.setAttribute('aria-hidden', 'true');
        const top = group.cards[0];
        const availableLayers = Math.min(3, group.cards.length);
        for (let index = availableLayers - 1; index >= 0; index--) {
            const layer = el('span', `stack-sheet stack-sheet-${index}`);
            if (index === 0) {
                const cover = el('div', 'stack-cover');
                const card = top.cloneNode(true);
                card.classList.remove('selected-card');
                card.inert = true;
                for (const key of Object.keys(card.dataset)) delete card.dataset[key];
                card.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
                // Covers stay visible, but native lazy loading defers offscreen
                // iframe work. The expanded tray has its own copy of this card.
                setPreviewResourcePriority(card, false);
                cover.append(card);
                layer.append(cover);
            } else {
                layer.append(el('span', 'stack-sheet-label', name(group.cards[index])));
            }
            pile.append(layer);
        }
        if (!top) pile.append(el('span', 'stack-no-output', 'No captures'));
        button.append(heading, pile);
        button.addEventListener('click', () => {
            const opening = active !== group;
            expand(group);
            const first = group.cards[0];
            if (opening && first) {
                activateCardPreview(first, first.querySelector('a[target=preview]') || first.querySelector('a'));
            }
        });
        buttons.set(group.id, button);
        shelf.append(button);

    }

    function syncSelection() {
        const selected = cards.find(card => card.classList.contains('selected-card'));
        for (const group of groups) buttons.get(group.id)?.classList.toggle('has-selection', group.cards.includes(selected));
    }
    const onSelected = event => {
        const {card, revealStack} = event.detail;
        if (!revealStack) return;
        const group = groups.find(group => group.cards.includes(card));
        if (!group || !buttons.has(group.id)) return;
        if (active !== group) expand(group);

    };
    root.addEventListener('snapshot-preview-selected', onSelected);
    close.addEventListener('click', () => {
        const button = buttons.get(active?.id);
        collapse();
        button?.focus();
    });
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape' && active) { close.click(); event.preventDefault(); }
    });
    // Existing card event handlers continue to drive the real snapshot viewer and URL hash.
    const observer = new MutationObserver(syncSelection);
    cards.forEach(card => observer.observe(card, {attributes: true, attributeFilter: ['class']}));
    panel.append(shelf, tray, parked);
    grid.before(panel);
    cards.forEach(card => movePreviewNode(card, parked));
    grid.hidden = true;
    root.classList.add('snapshot-stacks');
    syncSelection();
    return () => { observer.disconnect(); root.removeEventListener('snapshot-preview-selected', onSelected); panel.remove(); }; 
}
