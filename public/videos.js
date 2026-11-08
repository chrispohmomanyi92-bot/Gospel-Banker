// YouTube-style media section: videos, audio and files on members' channels.
// Browse by topic, by preacher/author, or by channel; watch, listen, upload.
import { api, esc, initials, toast, linkify, state } from './app.js';
import { offlineSupported, listDownloads, isDownloaded, downloading, downloadVideo, removeDownload, offlineUrl, fmtSize } from './offline.js';
import { storeCardHtml } from './stores.js';
import { countryOptions, countryLabel, flag } from './countries.js';

const $ = (sel, el = document) => el.querySelector(sel);
let categories = [];

export const KINDS = [
  { key: 'video', label: 'Videos', one: 'video', icon: '🎬' },
  { key: 'audio', label: 'Audio', one: 'audio', icon: '🎧' },
  { key: 'file', label: 'Files', one: 'file', icon: '📄' },
];
const kindOf = (key) => KINDS.find((k) => k.key === key) || KINDS[0];
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

export const fmtDuration = (s) => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const fmtViews = (n, kind = 'video') => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n))
  + (kind === 'file' ? (n === 1 ? ' download' : ' downloads') : kind === 'audio' ? (n === 1 ? ' listen' : ' listens') : (n === 1 ? ' view' : ' views'));
export const ago = (iso) => {
  const s = (Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 1000;
  for (const [u, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (s >= n) { const k = Math.floor(s / n); return `${k} ${u}${k > 1 ? 's' : ''} ago`; }
  }
  return 'just now';
};
const fileExt = (v) => ((v.original_name || v.file || '').match(/\.([a-z0-9]{1,5})$/i)?.[1] || 'file').toUpperCase();
const speakerHref = (name) => '#/videos/preacher/' + encodeURIComponent(name);

async function loadCategories() {
  categories = await api('/videos/categories');
  return categories;
}
const catIcon = (key) => categories.find((c) => c.key === key)?.icon || '🎬';

function thumbHtml(v) {
  const kind = v.kind || 'video';
  const ph = kind === 'audio' ? '🎧' : kind === 'file' ? '📄' : catIcon(v.category);
  return `<div class="vthumb k-${kind}">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" alt="" loading="lazy">` : `<div class="vthumb-ph">${ph}${kind === 'file' ? `<span class="ext">${esc(fileExt(v))}</span>` : ''}</div>`}
    ${kind !== 'video' ? `<span class="vkind">${kind === 'audio' ? '🎧 Audio' : '📄 ' + esc(fileExt(v))}</span>` : ''}
    ${v.duration && kind !== 'file' ? `<span class="vdur">${fmtDuration(v.duration)}</span>` : ''}${v.status !== 'approved' ? `<span class="vstatus">${v.status === 'pending' ? 'Awaiting review' : 'Rejected'}</span>` : ''}</div>`;
}

function cardHtml(v, { compact = false, showChannel = true } = {}) {
  return `<a class="vcard ${compact ? 'compact' : ''}" href="#/videos/watch/${v.id}">${thumbHtml(v)}
    <div class="vmeta">${compact || !showChannel ? '' : `<div class="avatar sm">${esc(initials(v.channel_name))}</div>`}
      <div style="min-width:0"><div class="vtitle">${esc(v.title)}</div>
      <div class="muted small">${v.speaker ? `🎤 ${esc(v.speaker)}<br>` : ''}${showChannel ? esc(v.channel_name) + '<br>' : ''}${fmtViews(v.views, v.kind)} · ${ago(v.created_at)}</div></div></div></a>`;
}

async function renderDownloads(view, playId) {
  const list = listDownloads();
  const total = list.reduce((n, d) => n + (d.size || 0), 0);
  view.innerHTML = `<div class="page wide">
    <a href="#/videos" class="muted small" style="text-decoration:none">← Videos</a>
    <h2 style="margin-top:6px">⬇️ Downloads</h2>
    <p class="muted small" style="margin-top:0">Videos and audio saved on this device. They play without internet.${list.length ? ` Using ${fmtSize(total)}.` : ''}</p>
    ${offlineSupported() ? '' : '<div class="card">This browser cannot save videos for offline watching. Try Chrome or Safari.</div>'}
    <div id="dlPlayer"></div>
    ${list.length ? `<div class="dl-list">${list.map((d) => `<div class="dl-item" data-id="${d.id}">
      <button class="dl-thumb" data-act="play" title="Play"><span class="vthumb">${d.thumb_url ? `<img data-thumb="${esc(d.thumb_url)}" alt="">` : `<span class="vthumb-ph">${d.kind === 'audio' ? '🎧' : '🎬'}</span>`}
        ${d.duration ? `<span class="vdur">${fmtDuration(d.duration)}</span>` : ''}</span></button>
      <div style="min-width:0;flex:1"><div class="vtitle">${esc(d.title)}</div>
        <div class="muted small">${esc(d.channel_name || '')}${d.size ? ' · ' + fmtSize(d.size) : ''}</div>
        <div class="row" style="margin-top:6px;gap:6px"><button class="btn small" data-act="play">▶ Play</button>
          <button class="btn small ghost" data-act="file" title="Save a copy to your phone's files">💾 Save file</button>
          <button class="btn small ghost" data-act="remove" title="Remove">🗑️</button></div></div></div>`).join('')}</div>`
      : `<div class="empty">No downloads yet. Open any video or audio and tap <b>⬇️ Download</b> to play it later without internet.</div>`}
  </div>`;
  // Thumbnails come from the saved copies too.
  view.querySelectorAll('img[data-thumb]').forEach(async (img) => { img.src = (await offlineUrl(img.dataset.thumb).catch(() => null)) || img.dataset.thumb; });
  const play = async (d) => {
    const url = await offlineUrl(d.src);
    if (!url) return toast('This download is missing. Please download it again.', true);
    $('#dlPlayer').innerHTML = d.kind === 'audio'
      ? `<div class="card" style="margin-bottom:10px"><h3>🎧 ${esc(d.title)}</h3><audio src="${url}" controls autoplay style="width:100%"></audio></div>`
      : `<div class="player" style="margin-bottom:10px"><video src="${url}" controls autoplay playsinline></video></div><h3>${esc(d.title)}</h3>`;
    $('#dlPlayer').scrollIntoView({ behavior: 'smooth' });
  };
  view.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = list.find((x) => x.id === Number(b.closest('[data-id]').dataset.id));
    if (b.dataset.act === 'play') play(d);
    else if (b.dataset.act === 'file') {
      const url = await offlineUrl(d.src);
      if (!url) return;
      const ext = d.src.match(/\.[a-z0-9]+$/i)?.[0] || '.mp4';
      const a = Object.assign(document.createElement('a'), { href: url, download: `${d.title.replace(/[^\w\- ]+/g, '').trim() || 'download'}${ext}` });
      document.body.append(a); a.click(); a.remove();
    } else if (b.dataset.act === 'remove' && confirm('Remove this from your downloads?')) {
      await removeDownload(d.id); toast('Removed'); renderDownloads(view);
    }
  };
  const first = list.find((d) => d.id === playId);
  if (first) play(first);
}

// Small video cards for the home screen shelf.
export async function videoShelfHtml(vids) {
  if (!categories.length) await loadCategories().catch(() => {});
  return vids.map((v) => cardHtml(v)).join('');
}

const gridHtml = (vids, empty = 'Nothing here yet. Be the first to upload!') =>
  vids.length ? `<div class="vgrid">${vids.map((v) => cardHtml(v)).join('')}</div>` : `<div class="empty">${empty}</div>`;

const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

export async function renderVideos(view, [sub, arg] = []) {
  if (sub === 'downloads') return renderDownloads(view, Number(arg) || 0);
  if (!categories.length) await loadCategories();
  if (sub === 'watch') return renderWatch(view, Number(arg));
  if (sub === 'upload') return renderUpload(view);
  if (sub === 'channel') return renderChannel(view, Number(arg));
  if (sub === 'channels') return renderChannels(view);
  if (sub === 'topics') return renderTopics(view);
  if (sub === 'preachers') return renderPreachers(view);
  if (sub === 'preacher') return renderPreacher(view, decodeURIComponent(arg || ''));
  return renderBrowse(view, sub, arg);
}

// Search box and the "browse by" bar shared by the browse pages.
function browseHead(active, term = '') {
  const nav = [['', '🏠 Home', '#/videos'], ['topics', '🗂️ Topics', '#/videos/topics'], ['preachers', '🎤 Preachers & authors', '#/videos/preachers'],
    ['channels', '📺 Channels', '#/videos/channels'], ['subs', '⭐ Subscriptions', '#/videos/subs'], ['downloads', '⬇️ Downloads', '#/videos/downloads']];
  return `<form class="row" id="vSearch" style="margin-bottom:12px"><input type="search" name="q" value="${esc(term)}" placeholder="Search videos, audio, files, preachers">
      <button class="btn">Search</button><a class="btn gold" href="#/videos/upload" style="text-decoration:none;white-space:nowrap">⬆ Upload</a></form>
    <nav class="seg vnav">${nav.map(([k, l, h]) => `<a class="${active === k ? 'active' : ''}" href="${h}">${l}${k === 'downloads' && listDownloads().length ? ` (${listDownloads().length})` : ''}</a>`).join('')}</nav>`;
}
function wireSearch() {
  $('#vSearch').onsubmit = (e) => {
    e.preventDefault();
    const t = new FormData(e.target).get('q').trim();
    location.hash = t ? '#/videos/search?q=' + encodeURIComponent(t) : '#/videos';
  };
}
// "All / Videos / Audio / Files" filter that keeps the current page.
function kindChips(kind) {
  const base = location.hash.split('?')[0] || '#/videos';
  const p = hashParams();
  const link = (k) => { const q = new URLSearchParams(p); k ? q.set('kind', k) : q.delete('kind'); const s = q.toString(); return base + (s ? '?' + s : ''); };
  return `<a class="chip ${!kind ? 'active' : ''}" href="${link('')}">All types</a>` +
    KINDS.map((k) => `<a class="chip ${kind === k.key ? 'active' : ''}" href="${link(k.key)}">${k.icon} ${k.label}</a>`).join('');
}
const withKind = (path, kind) => path + (kind ? (path.includes('?') ? '&' : '?') + 'kind=' + kind : '');

async function renderBrowse(view, sub, arg) {
  const cat = sub === 'c' ? arg : '';
  const mode = sub === 'subs' ? 'subs' : sub === 'popular' ? 'popular' : '';
  const params = hashParams();
  const term = params.get('q') || '';
  const kind = KINDS.some((k) => k.key === params.get('kind')) ? params.get('kind') : '';
  const kq = kind ? '&kind=' + kind : '';
  view.innerHTML = `<div class="page wide">${browseHead(mode === 'subs' ? 'subs' : cat ? 'topics' : term || mode ? '-' : '', term)}
    <div class="chips">${kindChips(kind)}<span class="chip-sep"></span>
      <a class="chip ${mode === 'popular' ? 'active' : ''}" href="${withKind('#/videos/popular', kind)}">🔥 Popular</a>
      ${categories.map((c) => `<a class="chip ${cat === c.key ? 'active' : ''}" href="${withKind('#/videos/c/' + c.key, kind)}">${c.icon} ${esc(c.label)}</a>`).join('')}
    </div><div id="vBody"><div class="empty">Loading…</div></div></div>`;
  wireSearch();
  const body = $('#vBody');
  if (term) {
    const [vids, speakers] = await Promise.all([api('/videos?q=' + encodeURIComponent(term) + kq), api('/videos/speakers?q=' + encodeURIComponent(term)).catch(() => [])]);
    body.innerHTML = (speakers.length ? `<div class="chips" style="margin-top:4px">${speakers.slice(0, 8).map((s) => `<a class="chip" href="${speakerHref(s.name)}">🎤 ${esc(s.name)} (${s.count})</a>`).join('')}</div>` : '')
      + `<h3>Results for "${esc(term)}"</h3>` + gridHtml(vids, 'Nothing matches your search.');
  } else if (mode === 'subs') {
    body.innerHTML = gridHtml(await api('/videos-feed/subscriptions'), 'Subscribe to channels and their new uploads will appear here.');
  } else if (mode === 'popular') {
    body.innerHTML = gridHtml(await api('/videos?sort=popular' + kq));
  } else if (cat) {
    const c = categories.find((x) => x.key === cat);
    body.innerHTML = `<h2>${c?.icon || ''} ${esc(c?.label || cat)}</h2>` + gridHtml(await api('/videos?category=' + cat + kq));
  } else {
    // Home: a shelf per topic that has uploads, YouTube-style.
    const latest = await api('/videos?limit=100' + kq);
    if (!latest.length) { body.innerHTML = gridHtml([]); return; }
    const shelves = categories.filter((c) => latest.some((v) => v.category === c.key));
    body.innerHTML = `<h3>Latest</h3>${gridHtml(latest.slice(0, 8))}` + shelves.map((c) => {
      const vids = latest.filter((v) => v.category === c.key).slice(0, 4);
      return `<div class="row" style="margin-top:24px"><h3 style="flex:1;margin:0">${c.icon} ${esc(c.label)}</h3><a href="${withKind('#/videos/c/' + c.key, kind)}" class="small">See all ›</a></div>${gridHtml(vids)}`;
    }).join('');
  }
}

async function renderTopics(view) {
  categories = await loadCategories();
  view.innerHTML = `<div class="page wide">${browseHead('topics')}
    <h2>Browse by topic</h2>
    <div class="grid">${categories.map((c) => `<a class="tile" href="#/videos/c/${c.key}"><span class="ico">${c.icon}</span><span class="label">${esc(c.label)}</span><span class="muted small">${plural(c.count, 'upload')}</span></a>`).join('')}</div></div>`;
  wireSearch();
}

async function renderPreachers(view) {
  view.innerHTML = `<div class="page wide">${browseHead('preachers')}
    <div class="row" style="margin-bottom:8px"><h2 style="flex:1;margin:0">Preachers, authors & artists</h2></div>
    <input type="search" id="spFilter" placeholder="Find a preacher, author or choir" style="margin-bottom:12px">
    <div id="spList"><div class="empty">Loading…</div></div></div>`;
  wireSearch();
  const list = await api('/videos/speakers');
  const draw = (term = '') => {
    const t = term.toLowerCase();
    const rows = list.filter((s) => s.name.toLowerCase().includes(t));
    $('#spList').innerHTML = rows.length ? `<div class="people">${rows.map((s) => `<a class="person" href="${speakerHref(s.name)}">
        <div class="avatar">${s.thumb_url ? `<img src="${esc(s.thumb_url)}" alt="">` : esc(initials(s.name))}</div>
        <div style="min-width:0"><b>${esc(s.name)}</b><div class="muted small">${[s.videos && plural(s.videos, 'video'), s.audio && plural(s.audio, 'audio', 'audio'), s.files && plural(s.files, 'file')].filter(Boolean).join(' · ')}</div></div></a>`).join('')}</div>`
      : `<div class="empty">${list.length ? 'No one matches.' : 'No preachers or authors yet. When you upload, fill in "Preacher, author or artist" and they will be listed here.'}</div>`;
  };
  $('#spFilter').oninput = (e) => draw(e.target.value);
  draw();
}

async function renderPreacher(view, name) {
  const kind = KINDS.some((k) => k.key === hashParams().get('kind')) ? hashParams().get('kind') : '';
  const vids = await api('/videos?limit=100&speaker=' + encodeURIComponent(name) + (kind ? '&kind=' + kind : ''));
  view.innerHTML = `<div class="page wide">${browseHead('preachers')}
    <div class="channel-banner"><div class="avatar" style="width:72px;height:72px;font-size:1.5rem">${esc(initials(name))}</div>
      <div style="flex:1;min-width:0"><div class="small" style="opacity:.8">🎤 Preacher · author · artist</div><h2 style="margin:0">${esc(vids[0]?.speaker || name)}</h2>
      <div class="small" style="opacity:.85">${plural(vids.length, 'upload')}${kind ? ' · ' + kindOf(kind).label : ''}</div></div></div>
    <div class="chips">${kindChips(kind)}</div>
    ${gridHtml(vids, 'Nothing here yet.')}</div>`;
  wireSearch();
}

async function renderChannels(view) {
  view.innerHTML = `<div class="page wide">${browseHead('channels')}
    <div class="row" style="margin-bottom:8px"><h2 style="flex:1;margin:0">Channels</h2><a class="btn small ghost" href="#/videos/channel/${state.user.id}" style="text-decoration:none">📺 My channel</a></div>
    <form class="row" id="chSearch" style="margin-bottom:10px"><input type="search" name="q" placeholder="Find a channel, church or ministry"><button class="btn small">Find</button></form>
    <label class="country-filter"><span>Country</span><select id="chCountry"><option value="">🌍 All countries</option></select></label>
    <div id="chList"><div class="empty">Loading…</div></div></div>`;
  wireSearch();
  let term = '';
  let country = hashParams().get('country') || '';
  const countries = await api('/channels/countries').catch(() => []);
  if (country && !countries.some((c) => c.code === country)) countries.unshift({ code: country, count: 0 });
  $('#chCountry').insertAdjacentHTML('beforeend', countries.map((c) => `<option value="${c.code}" ${c.code === country ? 'selected' : ''}>${countryLabel(c.code)}${c.count ? ` (${c.count})` : ''}</option>`).join(''));
  $('#chCountry').onchange = (e) => {
    country = e.target.value;
    history.replaceState(null, '', '#/videos/channels' + (country ? '?country=' + country : ''));
    draw();
  };
  const draw = async () => {
    const qs = new URLSearchParams();
    if (term) qs.set('q', term);
    if (country) qs.set('country', country);
    const list = await api('/channels?' + qs);
    $('#chList').innerHTML = list.length ? `<div class="people">${list.map((c) => `<a class="person" href="#/videos/channel/${c.id}">
        <div class="avatar">${esc(initials(c.channel_name))}</div>
        <div style="min-width:0"><b>${esc(c.channel_name)}</b><div class="muted small">${c.channel_country ? flag(c.channel_country) + ' · ' : ''}${plural(c.subscribers, 'subscriber')} · ${plural(c.uploads, 'upload')}</div>
        ${c.channel_about || c.church ? `<div class="muted small clamp1">${esc(c.channel_about || c.church)}</div>` : ''}</div></a>`).join('')}</div>`
      : `<div class="empty">${term ? 'No channels match.' : country ? 'No channels in this country yet.' : 'No channels yet.'}</div>`;
  };
  $('#chSearch').onsubmit = (e) => { e.preventDefault(); term = new FormData(e.target).get('q').trim(); draw(); };
  draw();
}

function mediaPlayerHtml(v) {
  if (v.kind === 'audio') {
    return `<div class="player audio-player">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" alt="">` : `<div class="art">🎧</div>`}
      <div class="ap-body"><div class="small" style="opacity:.8">${v.speaker ? '🎤 ' + esc(v.speaker) : esc(v.category_label)}</div>
      <audio id="player" src="${esc(v.src)}" controls preload="metadata"></audio></div></div>`;
  }
  if (v.kind === 'file') {
    const inline = /^(PDF|JPG|JPEG|PNG|WEBP)$/.test(fileExt(v));
    return `<div class="file-view">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" alt="">` : `<div class="art">📄<span class="ext">${esc(fileExt(v))}</span></div>`}
      <div style="min-width:0"><b class="clamp1">${esc(v.original_name || v.title)}</b><div class="muted small">${esc(fileExt(v))} file${v.size ? ' · ' + fmtSize(v.size) : ''}</div>
      <div class="row wrap" style="margin-top:10px">${inline ? `<a class="btn small" id="openFile" href="${esc(v.src)}" target="_blank" rel="noopener" style="text-decoration:none">📖 Open</a>` : ''}
        <a class="btn small gold" id="getFile" href="${esc(v.src)}" download="${esc(v.original_name || v.title)}" style="text-decoration:none">⬇️ Download</a></div></div></div>`;
  }
  return `<div class="player"><video id="player" src="${esc(v.src)}" controls playsinline preload="metadata" ${v.thumb_url ? `poster="${esc(v.thumb_url)}"` : ''}></video></div>`;
}

async function renderWatch(view, id) {
  const v = await api('/videos/' + id);
  const mine = v.uploader_id === state.user.id;
  const staff = ['admin', 'moderator'].includes(state.user.role);
  const what = kindOf(v.kind).one;
  view.innerHTML = `<div class="page wide watch">
    <div class="watch-main">
      ${mediaPlayerHtml(v)}
      ${v.status !== 'approved' ? `<div class="card small" style="margin-top:10px">⏳ ${v.status === 'pending' ? `This ${what} is waiting for a moderator. Only you and moderators can see it.` : `This ${what} was not approved.`}</div>` : ''}
      <h2 style="margin-top:12px">${esc(v.title)}</h2>
      ${v.speaker ? `<a class="speaker-link" href="${speakerHref(v.speaker)}">🎤 ${esc(v.speaker)} <span class="muted small">· more from them ›</span></a>` : ''}
      <div class="row wrap" style="gap:12px">
        <a class="row" href="#/videos/channel/${v.uploader_id}" style="text-decoration:none;color:inherit;gap:10px"><div class="avatar">${esc(initials(v.channel_name))}</div>
          <div><b>${esc(v.channel_name)}</b><div class="muted small" id="subCount">${plural(v.subscribers, 'subscriber')}</div></div></a>
        ${mine ? '' : `<button class="btn small ${v.subscribed ? 'ghost' : ''}" id="subBtn">${v.subscribed ? 'Subscribed ✓' : 'Subscribe'}</button>`}
        <span class="spacer"></span>
        <button class="btn small ghost" id="likeBtn">${v.liked ? '❤️' : '🤍'} <span>${v.likes}</span> Amen</button>
        <button class="btn small ghost" id="shareBtn">↗ Share</button>
        ${offlineSupported() && v.status === 'approved' && v.kind !== 'file' ? `<button class="btn small ghost" id="dlBtn"></button>` : ''}
        ${mine ? '' : `<button class="btn small ghost" id="dmBtn">✉️ Message</button>`}
        ${mine || staff ? `<button class="btn small ghost" id="delBtn">🗑️</button>` : ''}
      </div>
      <div class="card" style="margin-top:12px"><div class="small"><b id="viewCount">${fmtViews(v.views, v.kind)}</b> · ${ago(v.created_at)} · <a href="#/videos/c/${v.category}">${esc(v.category_label)}</a></div>
        ${v.description ? `<div class="post-body" style="margin-top:6px">${linkify(v.description)}</div>` : ''}</div>
      <h3 style="margin-top:16px">Comments</h3>
      <form class="row" id="vComment"><input type="text" name="body" placeholder="Add a kind comment…" required><button class="btn small">Post</button></form>
      <div id="vComments" style="margin-top:10px"></div>
    </div>
    <aside class="watch-side"><h3 id="relTitle">More ${esc(v.category_label)}</h3><div id="related"></div></aside></div>`;

  let counted = false;
  const countView = async () => {
    if (counted) return;
    counted = true;
    const r = await api(`/videos/${id}/view`, { method: 'POST' }).catch(() => null);
    if (r && $('#viewCount')) $('#viewCount').textContent = fmtViews(r.views, v.kind);
  };
  const player = $('#player');
  if (player) player.addEventListener('timeupdate', () => {
    if (player.currentTime >= Math.min(10, (player.duration || 30) / 3)) countView();
  });
  ['#openFile', '#getFile'].forEach((s) => { const a = $(s); if (a) a.addEventListener('click', countView); });

  $('#likeBtn').onclick = async () => {
    const r = await api(`/videos/${id}/like`, { method: 'POST' });
    $('#likeBtn').innerHTML = `${r.liked ? '❤️' : '🤍'} <span>${r.likes}</span> Amen`;
  };
  const sb = $('#subBtn');
  if (sb) sb.onclick = async () => {
    const r = await api(`/channels/${v.uploader_id}/subscribe`, { method: 'POST' });
    sb.textContent = r.subscribed ? 'Subscribed ✓' : 'Subscribe'; sb.classList.toggle('ghost', r.subscribed);
    $('#subCount').textContent = plural(r.subscribers, 'subscriber');
  };
  $('#shareBtn').onclick = async () => {
    const url = location.href;
    try { if (navigator.share) await navigator.share({ title: v.title, url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch {}
  };
  const dl = $('#dlBtn');
  if (dl) {
    const paint = (txt) => { dl.textContent = txt || (isDownloaded(id) ? '✓ Downloaded' : '⬇️ Download'); };
    paint(downloading(id) ? '⬇️ Downloading…' : '');
    // Play the saved copy when there is one, so it works without internet.
    if (isDownloaded(id) && player) offlineUrl(v.src).then((u) => { if (u && player.paused && !player.currentTime) player.src = u; }).catch(() => {});
    dl.onclick = async () => {
      if (downloading(id)) return;
      if (isDownloaded(id)) {
        if (!confirm('Remove this from your downloads?')) return;
        await removeDownload(id); paint(); toast('Removed from downloads'); return;
      }
      paint('⬇️ 0%');
      try {
        await downloadVideo(v, (f) => { if (dl.isConnected) paint(f == null ? '⬇️ Downloading…' : `⬇️ ${Math.round(f * 100)}%`); });
        paint(); toast('Saved! Play it any time from Videos › Downloads, even offline.');
      } catch (err) {
        paint(); toast(/quota/i.test(err.name + err.message) ? 'Not enough space on this device to save it.' : err.message, true);
      }
    };
  }
  const dm = $('#dmBtn');
  if (dm) dm.onclick = async () => {
    const { id: cid } = await api('/conversations', { method: 'POST', body: { user_ids: [v.uploader_id] } });
    location.hash = '#/chats/' + cid;
  };
  const del = $('#delBtn');
  if (del) del.onclick = async () => {
    if (!confirm(`Delete this ${what} permanently?`)) return;
    await api('/videos/' + id, { method: 'DELETE' }); toast('Deleted'); location.hash = '#/videos';
  };

  const loadComments = async () => {
    const list = await api(`/videos/${id}/comments`);
    $('#vComments').innerHTML = list.length ? list.map((c) => `<div class="row" style="align-items:flex-start;margin-bottom:12px"><div class="avatar sm">${esc(initials(c.author_name))}</div>
      <div><b class="small">${esc(c.author_name)}</b> <span class="muted small">${ago(c.created_at)}</span><div>${linkify(c.body)}</div></div></div>`).join('') : '<div class="muted small">No comments yet. Be the first to encourage them.</div>';
  };
  $('#vComment').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/videos/${id}/comments`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      if (r.notice) toast(r.notice);
      e.target.reset(); loadComments();
    } catch (err) { toast(err.message, true); }
  };
  loadComments();
  // Side list: more from the same preacher first, otherwise the same topic.
  let related = v.speaker ? await api(`/videos?speaker=${encodeURIComponent(v.speaker)}&exclude=${id}&limit=12`) : [];
  if (related.length) $('#relTitle').textContent = `More from ${v.speaker}`;
  else related = await api(`/videos?category=${v.category}&exclude=${id}&limit=12`);
  $('#related').innerHTML = related.length ? related.map((r) => cardHtml(r, { compact: true })).join('') : '<div class="muted small">Nothing else in this topic yet.</div>';
}

async function renderChannel(view, uid) {
  const [ch, vids, stores] = await Promise.all([api('/channels/' + uid), api('/videos?channel=' + uid + '&limit=100'), api('/stores?owner=' + uid).catch(() => [])]);
  const mine = uid === state.user.id;
  const counts = Object.fromEntries(KINDS.map((k) => [k.key, vids.filter((x) => x.kind === k.key).length]));
  view.innerHTML = `<div class="page wide">
    <div class="channel-banner"><div class="avatar" style="width:72px;height:72px;font-size:1.5rem">${esc(initials(ch.channel_name))}</div>
      <div style="flex:1;min-width:0"><h2 style="margin:0">${esc(ch.channel_name)}</h2>
        <div class="small" style="opacity:.85">${ch.has_custom_name ? `by ${esc(ch.display_name)} · ` : ''}@${esc(ch.username)} · ${ch.channel_country ? countryLabel(ch.channel_country) + ' · ' : ''}<span id="subCount">${plural(ch.subscribers, 'subscriber')}</span> · ${plural(vids.length, 'upload')}</div>
        ${ch.channel_about ? `<div class="small" style="opacity:.9;margin-top:4px;white-space:pre-wrap">${esc(ch.channel_about)}</div>` : ch.headline ? `<div class="small" style="opacity:.85">${esc(ch.headline)}${ch.church ? ' · ' + esc(ch.church) : ''}</div>` : ''}
        ${mine && !ch.channel_country ? '<div class="small" style="margin-top:6px"><a class="on-dark" href="#" id="addCountry">📍 Add your country</a> so people near you can find your channel.</div>' : ''}</div>
      ${mine ? `<div class="row wrap"><button class="btn ghost on-dark" id="editCh">✏️ Edit channel</button><a class="btn gold" href="#/videos/upload" style="text-decoration:none">⬆ Upload</a></div>`
        : `<div class="row wrap"><button class="btn gold" id="subBtn">${ch.subscribed ? 'Subscribed ✓' : 'Subscribe'}</button><button class="btn ghost on-dark" id="dmCh">✉️ Message</button></div>`}</div>
    ${stores.length || mine ? `<div class="sec-head"><h3 style="margin:0">🛍️ ${mine ? 'My stores' : 'Stores'}</h3>${mine ? '<a href="#/stores/new">+ Open a store</a>' : ''}</div>
      ${stores.length ? `<div class="shelf" style="margin-bottom:12px">${stores.map(storeCardHtml).join('')}</div>` : '<p class="muted small">Sell books, health foods, crafts or services to the community. <a href="#/stores/new">Open your store</a>.</p>'}` : ''}
    <nav class="seg" id="chTabs" style="max-width:520px">${[['', 'All', vids.length], ...KINDS.map((k) => [k.key, `${k.icon} ${k.label}`, counts[k.key]])].map(([k, l, n]) =>
      `<a href="#" data-k="${k}" class="${k ? '' : 'active'}">${l} <span class="muted">${n}</span></a>`).join('')}</nav>
    <div id="chGrid">${gridHtml(vids, mine ? 'You have not uploaded anything yet. Share a sermon, a song, a study guide…' : 'Nothing uploaded yet.')}</div></div>`;
  $('#chTabs').onclick = (e) => {
    const a = e.target.closest('[data-k]');
    if (!a) return;
    e.preventDefault();
    view.querySelectorAll('#chTabs a').forEach((x) => x.classList.toggle('active', x === a));
    const list = a.dataset.k ? vids.filter((x) => x.kind === a.dataset.k) : vids;
    $('#chGrid').innerHTML = gridHtml(list, 'Nothing here yet.');
  };
  const sb = $('#subBtn');
  if (sb) sb.onclick = async () => {
    const r = await api(`/channels/${uid}/subscribe`, { method: 'POST' });
    sb.textContent = r.subscribed ? 'Subscribed ✓' : 'Subscribe';
    $('#subCount').textContent = plural(r.subscribers, 'subscriber');
  };
  const dm = $('#dmCh');
  if (dm) dm.onclick = async () => {
    const { id: cid } = await api('/conversations', { method: 'POST', body: { user_ids: [uid] } });
    location.hash = '#/chats/' + cid;
  };
  const ed = $('#editCh');
  const addC = $('#addCountry');
  if (addC) addC.onclick = (e) => { e.preventDefault(); ed.click(); };
  if (ed) ed.onclick = () => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `<form method="dialog"><h3>Your channel</h3>
      <label class="field"><span>Channel name (leave empty to use your own name)</span><input type="text" name="channel_name" maxlength="60" value="${esc(ch.has_custom_name ? ch.channel_name : '')}" placeholder="${esc(ch.display_name)}"></label>
      <label class="field"><span>Country</span><select name="channel_country" required><option value="">Choose your country…</option>${countryOptions(ch.channel_country)}</select></label>
      <label class="field"><span>About the channel</span><textarea name="channel_about" maxlength="1000" placeholder="What you share: sermons, music, health talks… Your church or ministry.">${esc(ch.channel_about)}</textarea></label>
      <div class="row"><span class="spacer"></span><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Save</button></div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.onclose = async () => {
      const body = Object.fromEntries(new FormData($('form', dlg)));
      dlg.remove();
      if (dlg.returnValue !== 'ok') return;
      try { await api('/channels/me', { method: 'PATCH', body }); toast('Channel saved'); renderChannel(view, uid); }
      catch (err) { toast(err.message, true); }
    };
  };
}

// Grab a frame from the chosen video to use as its thumbnail.
function captureThumb(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.src = url;
    const done = (blob, duration = 0) => { URL.revokeObjectURL(url); resolve({ blob, duration }); };
    const timer = setTimeout(() => done(null, vid.duration || 0), 8000);
    vid.onloadedmetadata = () => { vid.currentTime = Math.min(2, (vid.duration || 0) / 3); };
    vid.onseeked = () => {
      const w = 640, h = Math.round(w * (vid.videoHeight / vid.videoWidth || 9 / 16));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(vid, 0, 0, w, h);
      c.toBlob((b) => { clearTimeout(timer); done(b, vid.duration); }, 'image/jpeg', 0.82);
    };
    vid.onerror = () => { clearTimeout(timer); done(null, 0); };
  });
}
function audioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    const timer = setTimeout(() => done(0), 6000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { clearTimeout(timer); done(a.duration); };
    a.onerror = () => { clearTimeout(timer); done(0); };
    a.src = url;
  });
}
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|weba|flac|amr|3ga|mpeg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|3gp)$/i;
const detectKind = (f) => (f.type.startsWith('video/') || (!f.type.startsWith('audio/') && VIDEO_EXT.test(f.name)) ? 'video'
  : f.type.startsWith('audio/') || AUDIO_EXT.test(f.name) ? 'audio' : 'file');
const ACCEPT = 'video/*,audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac,.amr,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.epub,.txt,.rtf,.jpg,.jpeg,.png,.webp';

async function renderUpload(view) {
  const staff = ['admin', 'moderator'].includes(state.user.role);
  const speakers = await api('/videos/speakers').catch(() => []);
  view.innerHTML = `<div class="page"><a href="#/videos" class="muted small" style="text-decoration:none">← Videos</a>
    <h2 style="margin-top:6px">Upload to your channel</h2>
    <p class="muted small">Share a video, an audio (sermon, song, podcast) or a file (study guide, book, poster). ${staff ? '' : 'A moderator reviews uploads before they go public, to keep the platform Adventist and family-friendly.'}</p>
    <form class="card" id="upForm">
      <label class="dropzone" id="drop"><input type="file" name="media" accept="${ACCEPT}" required hidden>
        <div id="dropText">📁 Tap to choose a file<br><span class="muted small">🎬 Video (MP4, MOV) · 🎧 Audio (MP3, M4A, WAV) · 📄 PDF, Word, PowerPoint, EPUB</span></div></label>
      <div id="preview" hidden style="margin:12px 0"><div class="row" style="align-items:flex-start;gap:12px">
        <div id="thumbBox" style="width:160px;aspect-ratio:16/9;border-radius:8px;background:var(--brand);display:grid;place-items:center;font-size:2rem;overflow:hidden;flex:none"></div>
        <div class="small"><div id="fileInfo"></div><label class="btn small ghost" style="margin-top:6px;display:inline-block"><span id="thumbLabel">Change thumbnail</span><input type="file" id="thumbPick" accept="image/jpeg,image/png,image/webp" hidden></label></div></div></div>
      <label class="field"><span>Title</span><input type="text" name="title" maxlength="120" required></label>
      <label class="field"><span>Preacher, author or artist (optional)</span><input type="text" name="speaker" maxlength="80" list="speakerList" placeholder="e.g. Pr. Mark Finley, Heritage Singers, Ellen G. White">
        <datalist id="speakerList">${speakers.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist></label>
      <label class="field"><span>Topic</span><select name="category" required><option value="">Choose a topic…</option>
        ${categories.map((c) => `<option value="${c.key}">${c.icon} ${esc(c.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Description</span><textarea name="description" placeholder="What is it about? Church, event, Bible texts…"></textarea></label>
      <div id="progress" hidden style="margin-bottom:12px"><div class="bar"><div id="barFill"></div></div><div class="muted small" id="pctText"></div></div>
      <button class="btn gold" id="upBtn" style="width:100%">${staff ? 'Publish' : 'Upload for review'}</button></form></div>`;
  let thumbBlob = null, duration = 0, kind = 'video';
  const fileInput = $('input[name=media]');
  const showThumb = (blob) => { $('#thumbBox').innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Thumbnail" style="width:100%;height:100%;object-fit:cover">`; };
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    kind = detectKind(f);
    thumbBlob = null; duration = 0;
    $('#dropText').innerHTML = `${kindOf(kind).icon} ${esc(f.name)}<br><span class="muted small">Tap to choose a different file</span>`;
    const title = $('input[name=title]');
    if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    $('#preview').hidden = false;
    $('#thumbBox').textContent = kind === 'audio' ? '🎧' : kind === 'file' ? '📄' : '⏳';
    $('#thumbLabel').textContent = kind === 'video' ? 'Change thumbnail' : 'Add a cover picture';
    if (kind === 'video') { const r = await captureThumb(f); thumbBlob = r.blob; duration = r.duration; if (thumbBlob) showThumb(thumbBlob); else $('#thumbBox').textContent = '🎬'; }
    else if (kind === 'audio') duration = await audioDuration(f);
    $('#fileInfo').textContent = `${kindOf(kind).one[0].toUpperCase() + kindOf(kind).one.slice(1)} · ${(f.size / 1048576).toFixed(1)} MB${duration ? ' · ' + fmtDuration(duration) : ''}`;
    $('#upBtn').textContent = `${staff ? 'Publish' : 'Upload for review'} ${kindOf(kind).one}`;
  };
  $('#thumbPick').onchange = (e) => {
    const f = e.target.files[0];
    if (f) { thumbBlob = f; showThumb(f); }
  };
  $('#upForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData();
    const form = e.target;
    for (const k of ['title', 'speaker', 'category', 'description']) fd.append(k, form[k].value);
    fd.append('duration', String(duration || 0));
    if (thumbBlob) fd.append('thumb', thumbBlob, 'thumb.jpg');
    fd.append('media', fileInput.files[0]);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos');
    xhr.setRequestHeader('authorization', 'Bearer ' + state.token);
    $('#progress').hidden = false; $('#upBtn').disabled = true;
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      $('#barFill').style.width = pct + '%'; $('#pctText').textContent = pct < 100 ? `Uploading… ${pct}%` : 'Processing…';
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) { toast(data.message); location.hash = '#/videos/watch/' + data.video.id; }
      else { toast(data.error || 'Upload failed', true); $('#upBtn').disabled = false; $('#progress').hidden = true; }
    };
    xhr.onerror = () => { toast('Upload failed. Check your connection.', true); $('#upBtn').disabled = false; };
    xhr.send(fd);
  };
}

export async function pendingVideosHtml() {
  const vids = await api('/admin/videos/pending');
  const preview = (v) => v.kind === 'audio' ? `<audio src="${esc(v.src)}" controls preload="metadata" style="width:100%"></audio>`
    : v.kind === 'file' ? `<a class="btn small ghost" href="${esc(v.src)}" target="_blank" rel="noopener" style="text-decoration:none">📄 Open ${esc(v.original_name || 'file')}</a>`
    : `<video src="${esc(v.src)}" controls preload="metadata" style="width:100%;max-height:320px;background:#000;border-radius:8px"></video>`;
  return `<h3 style="margin-top:16px">Uploads waiting for review (${vids.length})</h3>` + (vids.length
    ? vids.map((v) => `<div class="card" data-vid="${v.id}">${preview(v)}
      <div class="item-title" style="margin-top:8px">${kindOf(v.kind).icon} ${esc(v.title)}</div><div class="muted small">${esc(v.category_label)}${v.speaker ? ' · 🎤 ' + esc(v.speaker) : ''} · by ${esc(v.channel_name)} · ${ago(v.created_at)}</div>
      ${v.description ? `<div class="small" style="margin-top:4px">${esc(v.description)}</div>` : ''}
      <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn small danger" data-vs="rejected">Reject</button><button class="btn small" data-vs="approved">Approve</button></div></div>`).join('')
    : '<div class="empty">Nothing waiting.</div>');
}
