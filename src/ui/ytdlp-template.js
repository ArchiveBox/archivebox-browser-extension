// Source-ported from the canonical ytdlp full.html; only file I/O and stream transport differ.
export async function initializeYtdlp(document, files, options) {
    const $ = id => document.getElementById(id);
    const el = (tag, text, cls) => {const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node;};
    const icon = name => {
        const paths = {person:'M20 21v-2a7 7 0 0 0-14 0v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16',play:'M9 5l11 7-11 7z',clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8',comment:'M21 4H3v14h5l4 4v-4h9z',music:'M9 18V5l12-2v13 M9 8l12-2 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',disc:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',file:'M14 2H4v20h16V8z M14 2v6h6',check:'M5 12l4 4L19 6',repeat:'M4 8h15l-3-3 M20 16H5l3 3',captions:'M3 5h18v14H3z M10 10H7v4h3 M17 10h-3v4h3'};
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');
        const path = document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name] || paths.file);svg.append(path);return svg;
    };
    const number = value => Number(value).toLocaleString();
    const date = value => {if (!value) return '';const match = String(value).match(/^(\d{4})(\d{2})(\d{2})$/);const d = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`) : new Date(Number(value)*1000);return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});};
    const safeLink = (url,label) => {const node = el('a',label);try {const parsed = new URL(url);if (['https:','http:'].includes(parsed.protocol)) {node.href=parsed.href;node.target='_blank';node.rel='noopener noreferrer';}} catch {}return node;};
    const output = {href: options.selectedURL || ''};
    const raw = url => url;
    $('files').href = '#';$('files').onclick = event => {event.preventDefault();options.files();};
    for (const id of ['header-download','download','subtitle-download']) $(id).onclick = event => {event.preventDefault();options.download($(id).href);};
    for (const id of ['raw','json-link']) {$(id).target='_blank';$(id).rel='noopener';}
    const isMedia = f => f.stream || /\.(mp4|webm|mkv|avi|mov|flv|wmv|m4v|mp3|m4a|ogg|oga|wav|flac|aac|opus)$/i.test(f.path);
    const stem = path => path.replace(/\.(info\.json|[^.]+)$/i, '');
    const time = seconds => {const n = Math.max(0, Math.floor(Number(seconds) || 0));return n >= 3600 ? `${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}` : `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;};
    const read = file => options.read(file);
    const infos = await Promise.all(files.filter(f => /\.info\.json$/i.test(f.path)).map(async file => {
        try {return {file, data:JSON.parse(await read(file)) || {}};} catch {return {file, data:{},failed:true};}
    }));
    const media = files.filter(isMedia);
    const entries = media.map(file => ({file, info:infos.find(info => stem(info.file.path) === stem(file.path))}));
    // Keep metadata-only captures visible when a download was unavailable.
    for (const info of infos) if (!entries.some(entry => entry.info === info) && !['playlist','multi_video'].includes(info.data._type)) entries.push({info});
    const related = entry => {
        const base = stem(entry.info ? entry.info.file.path : entry.file.path);
        return files.filter(file => file.path.startsWith(base + '.') && !entries.some(other => other !== entry && stem(other.info ? other.info.file.path : other.file.path).length > base.length && file.path.startsWith(stem(other.info ? other.info.file.path : other.file.path) + '.')));
    };
    const artwork = entry => related(entry).find(f => /\.(jpe?g|png|webp|avif)$/i.test(f.path));
    const name = entry => entry.info?.data.title || entry.file?.path.split('/').pop() || stem(entry.info.file.path).split('/').pop();
    entries.sort((a,b) => (Number(a.info?.data.playlist_index) || Infinity) - (Number(b.info?.data.playlist_index) || Infinity));
    const playlist = infos.find(info => ['playlist','multi_video'].includes(info.data._type));
    $('playlist-name').textContent = playlist?.data.title || entries.find(e => e.info?.data.playlist_title)?.info.data.playlist_title || 'In this archive';
    const totalDuration = entries.reduce((total,entry) => total + (Number(entry.info?.data.duration) || 0),0);
    const expected = playlist?.data.playlist_count || entries.find(e => e.info?.data.playlist_count)?.info.data.playlist_count;
    $('count').textContent = `${entries.length}${expected > entries.length ? ' of '+expected : ''} item${entries.length === 1 ? '' : 's'} · ${entries.filter(e => e.file).length} playable${totalDuration ? ' · '+time(totalDuration) : ''}`;
    $('queue-kicker').textContent = playlist ? 'Saved playlist' : 'In this archive';
    const curator = playlist?.data.uploader || entries.find(e => e.info?.data.playlist_uploader)?.info.data.playlist_uploader;
    if (curator) $('playlist-owner').append('Curated by ',safeLink(playlist?.data.uploader_url,curator));
    $('queue-controls').hidden = entries.length < 2;
    $('queue').classList.toggle('audio-list',entries.every(e => !e.file || /\.(mp3|m4a|ogg|oga|wav|flac|aac|opus)$/i.test(e.file.path)));
    let stopStream, player, version = 0, subtitleVersion = 0, trackURL, cues = [];
    const buttons = [];
    function seek(seconds) {if (player) player.currentTime = seconds;}
    function description(text) {
        const node = $('description');node.replaceChildren();node.classList.add('collapsed');
        // Build links and seek controls as text nodes; archived descriptions are never HTML.
        for (const part of String(text || 'No description saved.').split(/(https?:\/\/[^\s<>]+|\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g)) {
            if (/^https?:\/\//.test(part)) node.append(safeLink(part,part));
            else if (/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(part) && player) {const button=el('button',part,'text-button');button.onclick=()=>seek(part.split(':').reduce((n,v)=>n*60+Number(v),0));node.append(button);}
            else node.append(document.createTextNode(part));
        }
        const toggle=$('description-toggle');toggle.hidden=String(text||'').length<240 && !String(text||'').includes('\n');toggle.textContent='Show more';toggle.setAttribute('aria-expanded','false');
        toggle.onclick=()=>{const collapsed=node.classList.toggle('collapsed');toggle.textContent=collapsed?'Show more':'Show less';toggle.setAttribute('aria-expanded',String(!collapsed));};
    }
    function metadata(data,entry,audio) {
        const owner=data.channel || data.uploader || data.artist || 'Unknown creator';
        const avatar=el('span',owner.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase(),'avatar');avatar.setAttribute('aria-hidden','true');
        const body=el('div'),channel=safeLink(data.channel_url || data.uploader_url,owner);channel.className='channel-name';
        if (data.channel_is_verified) {const badge=icon('check');badge.setAttribute('aria-label','Verified channel');badge.removeAttribute('aria-hidden');channel.append(badge);}
        body.append(channel);const channelDetails=[data.uploader_id?.startsWith('@')?data.uploader_id:null,data.channel_follower_count!=null?number(data.channel_follower_count)+' followers':null].filter(Boolean);
        if(channelDetails.length)body.append(el('div',channelDetails.join(' · '),'channel-detail'));$('byline').replaceChildren(avatar,body);
        const platform=data.extractor_key || data.extractor || '';$('eyebrow').replaceChildren(icon(audio?'music':'play'),document.createTextNode([platform,audio?'Audio':'Video'].filter(Boolean).join(' · ')));
        $('stats').replaceChildren();
        for(const [key,label,type] of [['like_count','likes','heart'],['comment_count','comments','comment'],['repost_count','reposts','repeat']]) if(data[key]!=null){const item=el('span',null,'stat');item.append(icon(type),document.createTextNode(number(data[key])+' '+label));item.title='Saved at capture';$('stats').append(item);}
        $('facts').replaceChildren();
        for(const [type,value] of [['play',data.view_count!=null?number(data.view_count)+(audio?' plays':' views'):null],['calendar',date(data.release_date||data.upload_date||data.timestamp)],['clock',data.duration!=null?time(data.duration):null]]) if(value){const item=el('span');item.append(icon(type),document.createTextNode(value));$('facts').append(item);}
        description(data.description);
        $('tags').replaceChildren();for(const tag of [...new Set([data.genre,...(Array.isArray(data.categories)?data.categories:[]),...(Array.isArray(data.tags)?data.tags:[])].filter(Boolean))].slice(0,12)) $('tags').append(el('span',tag,'tag'));
        const fields=(id,rows)=>{const list=$(id);list.replaceChildren();for(const [label,value,type] of rows){if(value==null || value==='' || value==='none')continue;const group=el('div'),dt=el('dt');dt.append(icon(type),document.createTextNode(label));group.append(dt,el('dd',value));list.append(group);}$(id+'-panel').hidden=!list.children.length;};
        fields('credits',[['Artist',data.artist || (Array.isArray(data.artists)?data.artists.join(', '):null),'person'],['Track',data.track,'music'],['Album',data.album,'disc'],['Genre',data.genre,'music'],['Released',date(data.release_date),'calendar'],['License',data.license,'file'],['Copyright',data.copyright,'file']]);
        const size=Number(entry.file?.size || data.filesize);
        fields('details',[['Quality',data.resolution || (data.width&&data.height?`${data.width} × ${data.height}`:null),'play'],['File',entry.file ? entry.file.path.split('.').pop().toUpperCase()+(size?' · '+(size/1048576).toFixed(1)+' MB':'') : 'Metadata only','file'],['Video codec',data.vcodec,'play'],['Audio codec',data.acodec,'music'],['Audio bitrate',data.abr?Math.round(data.abr)+' kbps':null,'music'],['Sample rate',data.asr?number(data.asr)+' Hz':null,'music'],['Frame rate',data.fps?data.fps+' fps':null,'play'],['Language',data.language,'captions']]);
    }
    function parseSubtitles(text) {
        const stamp = value => value.replace(',', '.').split(':').reduce((total, part) => total * 60 + Number(part), 0);
        return text.replace(/\r/g, '').split(/\n\s*\n/).flatMap(block => {
            const lines = block.split('\n'), index = lines.findIndex(line => /\d+:\d.*-->/.test(line));
            if (index < 0) return [];
            const match = lines[index].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
            if (!match) return [];
            const start = stamp(match[1]), end = stamp(match[2]);
            const doc = new DOMParser().parseFromString(lines.slice(index+1).join('\n').replace(/<[^>]*>/g, ''), 'text/html');
            return Number.isFinite(start) && end > start ? [{start,end,text:doc.body.textContent}] : [];
        });
    }
    async function subtitles(file, selectedVersion) {
        const request = ++subtitleVersion;
        cues = []; $('transcript').replaceChildren(el('p', file ? 'Loading subtitles…' : 'No subtitles saved.', 'muted'));
        if (trackURL) {URL.revokeObjectURL(trackURL);trackURL = null;}
        if (player) player.querySelectorAll('track').forEach(track => track.remove());
        $('subtitle-download').hidden = !file;
        if (!file) return;
        $('subtitle-download').href = raw(file.url);
        try {
            const text = await read(file);
            if (version !== selectedVersion || request !== subtitleVersion) return;
            cues = parseSubtitles(text);
            $('transcript').replaceChildren();
            if (!cues.length) {$('transcript').append(el('p','This subtitle format is available to download.', 'muted'));return;}
            for (const cue of cues) {const button = el('button', null, 'cue');button.append(el('time',time(cue.start)),el('span',cue.text));button.disabled = !player;button.onclick = () => seek(cue.start);cue.button = button;$('transcript').append(button);}
            if (player) {
                const vttTime = n => {const ms = Math.round(n*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;};
                trackURL = URL.createObjectURL(new Blob(['WEBVTT\n\n' + cues.map(c => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}\n`).join('\n')], {type:'text/vtt'}));
                const track = el('track');track.kind = 'subtitles';track.label = $('language').selectedOptions[0].textContent;track.src = trackURL;track.default = true;player.append(track);
            }
        } catch {if (version === selectedVersion && request === subtitleVersion) $('transcript').replaceChildren(el('p','Could not load subtitles. Use the download link to open the saved file.', 'muted'));}
    }
    async function select(entry, index) {
        const current = ++version;
        if (player) player.pause();
        if (stopStream) {stopStream();stopStream=null;}
        player = null; $('stage').replaceChildren();$('notice').textContent = '';
        buttons.forEach((button,i) => button.setAttribute('aria-current', String(i === index)));
        $('position').textContent = `${index+1} / ${entries.length} · ${entry.file ? 'Now selected' : 'Media unavailable'}`;
        $('previous').disabled=index===0;$('next').disabled=index===entries.length-1;
        $('previous').onclick=()=>select(entries[index-1],index-1);$('next').onclick=()=>select(entries[index+1],index+1);
        const data = entry.info?.data || {}, image = artwork(entry), audio = entry.file && /\.(mp3|m4a|ogg|oga|wav|flac|aac|opus)$/i.test(entry.file.path);
        $('stage').classList.toggle('audio', !!audio);
        if (audio || !entry.file) {
            if (image) {const img = el('img');img.src = raw(image.url);img.alt = name(entry);img.style.maxHeight = '75%';img.style.maxWidth = '100%';$('stage').append(img);}
            else $('stage').append(el('div','♫','placeholder'));
        }
        if (entry.file) {
            const source = await options.resolve(entry.file,message=>{if(current===version)$('notice').textContent=message;});
            if(current!==version)return;
            $('notice').textContent='';
            player = el(audio ? 'audio' : 'video');player.controls = true;player.preload = 'metadata';if (!entry.file.stream) player.src = raw(source);
            if (!audio) {player.playsInline = true;if (image) player.poster = raw(image.url);}
            player.addEventListener('error', () => {$('notice').textContent = 'Your browser could not play this file. Download it to play with a compatible media player.';});
            player.addEventListener('timeupdate', () => {for (const cue of cues) cue.button.classList.toggle('active',player.currentTime >= cue.start && player.currentTime < cue.end);});
            player.addEventListener('ended',async()=>{if($('autoplay').checked && index+1<entries.length){await select(entries[index+1],index+1);if(player)player.play().catch(()=>{});}});
            $('stage').append(player);
            if (entry.file.stream) stopStream=await options.stream(player,entry.file,message=>{$('notice').textContent=message;});
        } else $('notice').textContent = 'Metadata was saved, but no media file is available.';
        $('title').textContent = name(entry);document.title = name(entry) + ' · ArchiveBox';
        metadata(data,entry,audio);
        $('download').hidden = !entry.file;if (entry.file) $('download').href = raw(entry.file.url);
        const selectedURL = entry.file?.url || entry.info.file.url;
        $('header-download').href = raw(selectedURL);$('raw').href = raw(selectedURL);
        $('json-link').hidden = !entry.info;if (entry.info) $('json-link').href = raw(entry.info.file.url);
        $('source').hidden = true;
        try {const source = new URL(data.webpage_url || data.original_url);if (['https:','http:'].includes(source.protocol)) {$('source').href = source.href;$('source').hidden = false;}} catch {}
        $('json').textContent = entry.info ? (entry.info.failed ? 'Could not load JSON metadata. Use the JSON metadata link to open the saved file.' : JSON.stringify(data,null,2)) : 'No JSON metadata saved.';
        $('chapters').replaceChildren();
        for (const chapter of Array.isArray(data.chapters) ? data.chapters : []) {if (!Number.isFinite(chapter.start_time)) continue;const button = el('button',time(chapter.start_time) + ' ' + (chapter.title || 'Chapter'));button.disabled = !player;button.onclick = () => seek(chapter.start_time);$('chapters').append(button);}
        const subs = related(entry).filter(f => f.subtitle || /\.(vtt|srt|ass|lrc)$/i.test(f.path));
        $('language').replaceChildren();$('language').hidden = !subs.length;
        for (const [i,file] of subs.entries()) {const option = el('option',file.path.slice(stem(entry.info ? entry.info.file.path : entry.file.path).length+1));option.value = i;$('language').append(option);}
        $('language').onchange = () => subtitles(subs[Number($('language').value)],current);
        subtitles(subs[0],current);
        const descriptionFile = related(entry).find(f => /\.description$/i.test(f.path));
        if (!data.description && descriptionFile) {try {const text = await read(descriptionFile);if (version === current) description(text);} catch {}}
    }
    entries.forEach((entry,index) => {
        const button = el('button',null,'item'), image = artwork(entry);button.append(el('span',String(index+1),'item-index'));
        if (image) {const img = el('img',null,'thumb');img.src = raw(image.url);img.alt = '';img.loading = 'lazy';button.append(img);} else button.append(el('span',entry.file && /\.(mp3|m4a|ogg|wav|flac|aac|opus)$/i.test(entry.file.path) ? '♫' : '▶','thumb'));
        const copy = el('span',null,'item-copy');copy.append(el('span',name(entry),'item-title'),el('span',[entry.info?.data.channel || entry.info?.data.uploader,entry.info?.data.duration != null ? time(entry.info.data.duration) : null,!entry.file ? 'Metadata only' : null].filter(Boolean).join(' · '),'item-detail'));button.append(copy);button.onclick = () => select(entry,index);buttons.push(button);$('queue').append(button);
    });
    if (entries.length) {const index = Math.max(0,entries.findIndex(e => e.file?.url === output.href));await select(entries[index],index);}
    else {$('stage').replaceChildren(el('p','No archived video or audio files found.','empty'));$('notice').textContent = 'Browse files to see the available capture output.';}
    return () => {version++;subtitleVersion++;if(player){player.pause();player.removeAttribute('src');player.load();}if(stopStream)stopStream();if(trackURL)URL.revokeObjectURL(trackURL);};
}
