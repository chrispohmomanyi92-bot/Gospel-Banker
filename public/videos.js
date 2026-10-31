// YouTube-style video section: browse by category, watch, upload, channels.
import { api, esc, initials, toast, linkify, state } from './app.js';

const $ = (sel, el = document) => el.querySelector(sel);
let categories = [];

export const fmtDuration = (s) => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const fmtViews = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n)) + (n === 1 ? ' view' : ' views');
const ago = (iso) => {
  const s = (Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 1000;
  for (const [u, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (s >= n) { const k = Math.floor(s / n); return `${k} ${u}${k > 1 ? 's' : ''} ago`; }
  }
  return 'just now';
};

async function loadCategories() {
  categories = await api('/videos/categories');
  return categories;
}
const catIcon = (key) => categories.find((c) => c.key === key)?.icon || '🎬';

function thumbHtml(v) {
  return `<div class="vthumb">${v.thumb_url ? `<img src="${esc(v.thumb_url)}" alt="" loading="lazy">` : `<div class="vthumb-ph">${catIcon(v.category)}</div>`}
    ${v.duration ? `<span class="vdur">${fmtDuration(v.duration)}</span>` : ''}${v.status !== 'approved' ? `<span class="vstatus">${v.status === 'pending' ? 'Awaiting review' : 'Rejected'}</span>` : ''}</div>`;
}

function cardHtml(v, { compact = false, showChannel = true } = {}) {
  return `<a class="vcard ${compact ? 'compact' : ''}" href="#/videos/watch/${v.id}">${thumbHtml(v)}
    <div class="vmeta">${compact || !showChannel ? '' : `<div class="avatar sm">${esc(initials(v.channel_name))}</div>`}
      <div style="min-width:0"><div class="vtitle">${esc(v.title)}</div>
      <div class="muted small">${showChannel ? esc(v.channel_name) + '<br>' : ''}${fmtViews(v.views)} · ${ago(v.created_at)}</div></div></div></a>`;
}

const gridHtml = (vids, empty = 'No videos here yet. Be the first to upload one!') =>
  vids.length ? `<div class="vgrid">${vids.map((v) => cardHtml(v)).join('')}</div>` : `<div class="empty">${empty}</div>`;

export async function renderVideos(view, [sub, arg] = []) {
  if (!categories.length) await loadCategories();
  if (sub === 'watch') return renderWatch(view, Number(arg));
  if (sub === 'upload') return renderUpload(view);
  if (sub === 'channel') return renderChannel(view, Number(arg));
  return renderBrowse(view, sub, arg);
}

async function renderBrowse(view, sub, arg) {
  const cat = sub === 'c' ? arg : '';
  const mode = sub === 'subs' ? 'subs' : sub === 'popular' ? 'popular' : '';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const term = params.get('q') || '';
  view.innerHTML = `<div class="page wide">
    <form class="row" id="vSearch" style="margin-bottom:12px"><input type="search" name="q" value="${esc(term)}" placeholder="Search videos and channels">
      <button class="btn">Search</button><a class="btn gold" href="#/videos/upload" style="text-decoration:none;white-space:nowrap">⬆ Upload</a></form>
    <div class="chips">
      <a class="chip ${!cat && !mode && !term ? 'active' : ''}" href="#/videos">All</a>
      <a class="chip ${mode === 'popular' ? 'active' : ''}" href="#/videos/popular">🔥 Popular</a>
      <a class="chip ${mode === 'subs' ? 'active' : ''}" href="#/videos/subs">⭐ Subscriptions</a>
      ${categories.map((c) => `<a class="chip ${cat === c.key ? 'active' : ''}" href="#/videos/c/${c.key}">${c.icon} ${esc(c.label)}</a>`).join('')}
    </div><div id="vBody"><div class="empty">Loading…</div></div></div>`;
  $('#vSearch').onsubmit = (e) => {
    e.preventDefault();
    const t = new FormData(e.target).get('q').trim();
    location.hash = t ? '#/videos/search?q=' + encodeURIComponent(t) : '#/videos';
  };
  const body = $('#vBody');
  if (term) {
    body.innerHTML = `<h3>Results for "${esc(term)}"</h3>` + gridHtml(await api('/videos?q=' + encodeURIComponent(term)), 'No videos match your search.');
  } else if (mode === 'subs') {
    body.innerHTML = gridHtml(await api('/videos-feed/subscriptions'), 'Subscribe to channels and their new videos will appear here.');
  } else if (mode === 'popular') {
    body.innerHTML = gridHtml(await api('/videos?sort=popular'));
  } else if (cat) {
    const c = categories.find((x) => x.key === cat);
    body.innerHTML = `<h2>${c?.icon || ''} ${esc(c?.label || cat)}</h2>` + gridHtml(await api('/videos?category=' + cat));
  } else {
    // Home: a shelf per category that has videos, YouTube-style.
    const latest = await api('/videos?limit=100');
    if (!latest.length) { body.innerHTML = gridHtml([]); return; }
    const shelves = categories.filter((c) => latest.some((v) => v.category === c.key));
    body.innerHTML = `<h3>Latest</h3>${gridHtml(latest.slice(0, 8))}` + shelves.map((c) => {
      const vids = latest.filter((v) => v.category === c.key).slice(0, 4);
      return `<div class="row" style="margin-top:24px"><h3 style="flex:1;margin:0">${c.icon} ${esc(c.label)}</h3><a href="#/videos/c/${c.key}" class="small">See all ${c.count} ›</a></div>${gridHtml(vids)}`;
    }).join('');
  }
}

async function renderWatch(view, id) {
  const v = await api('/videos/' + id);
  const mine = v.uploader_id === state.user.id;
  const staff = ['admin', 'moderator'].includes(state.user.role);
  view.innerHTML = `<div class="page wide watch">
    <div class="watch-main">
      <div class="player"><video id="player" src="${esc(v.src)}" controls playsinline preload="metadata" ${v.thumb_url ? `poster="${esc(v.thumb_url)}"` : ''}></video></div>
      ${v.status !== 'approved' ? `<div class="card small" style="margin-top:10px">⏳ ${v.status === 'pending' ? 'This video is waiting for a moderator. Only you and moderators can see it.' : 'This video was not approved.'}</div>` : ''}
      <h2 style="margin-top:12px">${esc(v.title)}</h2>
      <div class="row wrap" style="gap:12px">
        <a class="row" href="#/videos/channel/${v.uploader_id}" style="text-decoration:none;color:inherit;gap:10px"><div class="avatar">${esc(initials(v.channel_name))}</div>
          <div><b>${esc(v.channel_name)}</b><div class="muted small" id="subCount">${v.subscribers} subscriber${v.subscribers === 1 ? '' : 's'}</div></div></a>
        ${mine ? '' : `<button class="btn small ${v.subscribed ? 'ghost' : ''}" id="subBtn">${v.subscribed ? 'Subscribed ✓' : 'Subscribe'}</button>`}
        <span class="spacer"></span>
        <button class="btn small ghost" id="likeBtn">${v.liked ? '❤️' : '🤍'} <span>${v.likes}</span> Amen</button>
        <button class="btn small ghost" id="shareBtn">↗ Share</button>
        ${mine ? '' : `<button class="btn small ghost" id="dmBtn">✉️ Message</button>`}
        ${mine || staff ? `<button class="btn small ghost" id="delBtn">🗑️</button>` : ''}
      </div>
      <div class="card" style="margin-top:12px"><div class="small"><b id="viewCount">${fmtViews(v.views)}</b> · ${ago(v.created_at)} · <a href="#/videos/c/${v.category}">${esc(v.category_label)}</a></div>
        ${v.description ? `<div class="post-body" style="margin-top:6px">${linkify(v.description)}</div>` : ''}</div>
      <h3 style="margin-top:16px">Comments</h3>
      <form class="row" id="vComment"><input type="text" name="body" placeholder="Add a kind comment…" required><button class="btn small">Post</button></form>
      <div id="vComments" style="margin-top:10px"></div>
    </div>
    <aside class="watch-side"><h3>More ${esc(v.category_label)}</h3><div id="related"></div></aside></div>`;

  const player = $('#player');
  let counted = false;
  player.addEventListener('timeupdate', async () => {
    if (counted || player.currentTime < Math.min(10, (player.duration || 30) / 3)) return;
    counted = true;
    const r = await api(`/videos/${id}/view`, { method: 'POST' }).catch(() => null);
    if (r && $('#viewCount')) $('#viewCount').textContent = fmtViews(r.views);
  });

  $('#likeBtn').onclick = async () => {
    const r = await api(`/videos/${id}/like`, { method: 'POST' });
    $('#likeBtn').innerHTML = `${r.liked ? '❤️' : '🤍'} <span>${r.likes}</span> Amen`;
  };
  const sb = $('#subBtn');
  if (sb) sb.onclick = async () => {
    const r = await api(`/channels/${v.uploader_id}/subscribe`, { method: 'POST' });
    sb.textContent = r.subscribed ? 'Subscribed ✓' : 'Subscribe'; sb.classList.toggle('ghost', r.subscribed);
    $('#subCount').textContent = `${r.subscribers} subscriber${r.subscribers === 1 ? '' : 's'}`;
  };
  $('#shareBtn').onclick = async () => {
    const url = location.href;
    try { if (navigator.share) await navigator.share({ title: v.title, url }); else { await navigator.clipboard.writeText(url); toast('Link copied'); } } catch {}
  };
  const dm = $('#dmBtn');
  if (dm) dm.onclick = async () => {
    const { id: cid } = await api('/conversations', { method: 'POST', body: { user_ids: [v.uploader_id] } });
    location.hash = '#/chats/' + cid;
  };
  const del = $('#delBtn');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this video permanently?')) return;
    await api('/videos/' + id, { method: 'DELETE' }); toast('Video deleted'); location.hash = '#/videos';
  };

  const loadComments = async () => {
    const list = await api(`/videos/${id}/comments`);
    $('#vComments').innerHTML = list.length ? list.map((c) => `<div class="row" style="align-items:flex-start;margin-bottom:12px"><div class="avatar sm">${esc(initials(c.author_name))}</div>
      <div><b class="small">${esc(c.author_name)}</b> <span class="muted small">${ago(c.created_at)}</span><div>${linkify(c.body)}</div></div></div>`).join('') : '<div class="muted small">No comments yet.</div>';
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
  const related = await api(`/videos?category=${v.category}&exclude=${id}&limit=12`);
  $('#related').innerHTML = related.length ? related.map((r) => cardHtml(r, { compact: true })).join('') : '<div class="muted small">No other videos in this category yet.</div>';
}

async function renderChannel(view, uid) {
  const [ch, vids] = await Promise.all([api('/channels/' + uid), api('/videos?channel=' + uid + '&limit=100')]);
  const mine = uid === state.user.id;
  view.innerHTML = `<div class="page wide">
    <div class="channel-banner"><div class="avatar" style="width:72px;height:72px;font-size:1.5rem">${esc(initials(ch.display_name))}</div>
      <div style="flex:1;min-width:0"><h2 style="margin:0">${esc(ch.display_name)}</h2>
        <div class="small" style="opacity:.85">@${esc(ch.username)} · <span id="subCount">${ch.subscribers} subscriber${ch.subscribers === 1 ? '' : 's'}</span> · ${vids.length} video${vids.length === 1 ? '' : 's'}</div>
        ${ch.headline ? `<div class="small" style="opacity:.85">${esc(ch.headline)}${ch.church ? ' · ' + esc(ch.church) : ''}</div>` : ''}</div>
      ${mine ? `<a class="btn gold" href="#/videos/upload" style="text-decoration:none">⬆ Upload</a>` : `<button class="btn gold" id="subBtn">${ch.subscribed ? 'Subscribed ✓' : 'Subscribe'}</button>`}</div>
    ${gridHtml(vids, mine ? 'You have not uploaded any videos yet.' : 'No videos yet.')}</div>`;
  const sb = $('#subBtn');
  if (sb) sb.onclick = async () => {
    const r = await api(`/channels/${uid}/subscribe`, { method: 'POST' });
    sb.textContent = r.subscribed ? 'Subscribed ✓' : 'Subscribe';
    $('#subCount').textContent = `${r.subscribers} subscriber${r.subscribers === 1 ? '' : 's'}`;
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

function renderUpload(view) {
  const staff = ['admin', 'moderator'].includes(state.user.role);
  view.innerHTML = `<div class="page"><a href="#/videos" class="muted small" style="text-decoration:none">← Videos</a>
    <h2 style="margin-top:6px">Upload a video</h2>
    ${staff ? '' : '<p class="muted small">Videos are reviewed by a moderator before they go public, to keep the platform Adventist and family-friendly.</p>'}
    <form class="card" id="upForm">
      <label class="dropzone" id="drop"><input type="file" name="video" accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/3gpp" required hidden>
        <div id="dropText">📁 Tap to choose a video<br><span class="muted small">MP4, WebM or MOV</span></div></label>
      <div id="preview" hidden style="margin:12px 0"><div class="row" style="align-items:flex-start;gap:12px">
        <img id="thumbPrev" alt="Thumbnail" style="width:160px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:#000">
        <div class="small"><div id="fileInfo"></div><label class="btn small ghost" style="margin-top:6px;display:inline-block">Change thumbnail<input type="file" id="thumbPick" accept="image/jpeg,image/png,image/webp" hidden></label></div></div></div>
      <label class="field"><span>Title</span><input type="text" name="title" maxlength="120" required></label>
      <label class="field"><span>Category</span><select name="category" required><option value="">Choose a category…</option>
        ${categories.map((c) => `<option value="${c.key}">${c.icon} ${esc(c.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Description</span><textarea name="description" placeholder="What is this video about? Speaker, church, Bible texts…"></textarea></label>
      <div id="progress" hidden style="margin-bottom:12px"><div class="bar"><div id="barFill"></div></div><div class="muted small" id="pctText"></div></div>
      <button class="btn gold" id="upBtn" style="width:100%">${staff ? 'Publish' : 'Upload for review'}</button></form></div>`;
  let thumbBlob = null, duration = 0;
  const fileInput = $('input[name=video]');
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    if (!f) return;
    $('#dropText').innerHTML = `🎬 ${esc(f.name)}<br><span class="muted small">Tap to choose a different video</span>`;
    const title = $('input[name=title]');
    if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    const r = await captureThumb(f);
    thumbBlob = r.blob; duration = r.duration;
    $('#preview').hidden = false;
    if (thumbBlob) $('#thumbPrev').src = URL.createObjectURL(thumbBlob);
    $('#fileInfo').textContent = `${(f.size / 1048576).toFixed(1)} MB${duration ? ' · ' + fmtDuration(duration) : ''}`;
  };
  $('#thumbPick').onchange = (e) => {
    const f = e.target.files[0];
    if (f) { thumbBlob = f; $('#thumbPrev').src = URL.createObjectURL(f); }
  };
  $('#upForm').onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData();
    const form = e.target;
    fd.append('title', form.title.value);
    fd.append('category', form.category.value);
    fd.append('description', form.description.value);
    fd.append('duration', String(duration || 0));
    if (thumbBlob) fd.append('thumb', thumbBlob, 'thumb.jpg');
    fd.append('video', fileInput.files[0]);
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
  return `<h3 style="margin-top:16px">Videos waiting for review (${vids.length})</h3>` + (vids.length
    ? vids.map((v) => `<div class="card" data-vid="${v.id}"><video src="${esc(v.src)}" controls preload="metadata" style="width:100%;max-height:320px;background:#000;border-radius:8px"></video>
      <div class="item-title" style="margin-top:8px">${esc(v.title)}</div><div class="muted small">${esc(v.category_label)} · by ${esc(v.channel_name)} · ${ago(v.created_at)}</div>
      ${v.description ? `<div class="small" style="margin-top:4px">${esc(v.description)}</div>` : ''}
      <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn small danger" data-vs="rejected">Reject</button><button class="btn small" data-vs="approved">Approve</button></div></div>`).join('')
    : '<div class="empty">No videos waiting.</div>');
}
