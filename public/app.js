// The Gospel Banker: single-page client (no build step).
import { renderVideos, pendingVideosHtml, videoShelfHtml } from './videos.js';
import { renderStores, pendingStoresHtml, storeShelf } from './stores.js';
const $ = (sel, el = document) => el.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const initials = (name) => (name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const when = (iso) => {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
export const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

const VERSES = [
  ['Fear thou not; for I am with thee: be not dismayed; for I am thy God.', 'Isaiah 41:10'],
  ['Remember the sabbath day, to keep it holy.', 'Exodus 20:8'],
  ['Beloved, I wish above all things that thou mayest prosper and be in health.', '3 John 1:2'],
  ['Let the words of my mouth, and the meditation of my heart, be acceptable in thy sight.', 'Psalm 19:14'],
  ['Let no corrupt communication proceed out of your mouth, but that which is good to the use of edifying.', 'Ephesians 4:29'],
  ['Here is the patience of the saints: here are they that keep the commandments of God, and the faith of Jesus.', 'Revelation 14:12'],
  ['Come unto me, all ye that labour and are heavy laden, and I will give you rest.', 'Matthew 11:28'],
];

export const state = { token: localStorage.getItem('gb_token'), user: null, sections: [], online: new Set(), convs: [], activeConv: null, aiModeration: false };
let socket = null;

export function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ''), 3500);
}

export async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(state.token ? { authorization: 'Bearer ' + state.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(); throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------------- auth ----------------
function renderAuth(mode = 'login') {
  const reg = mode === 'register';
  $('#app').innerHTML = `
  <div class="auth"><form class="card" id="authForm">
    <div class="brand"><img src="/icon.svg" alt=""><h2>The Gospel Banker</h2>
      <div class="muted small">Chat, share and grow together in faith</div></div>
    ${reg ? `<label class="field"><span>Full name</span><input type="text" name="display_name" required></label>` : ''}
    <label class="field"><span>Username</span><input type="text" name="username" autocomplete="username" required></label>
    <label class="field"><span>Password</span><input type="password" name="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="${reg ? 8 : 1}"></label>
    ${reg ? `<label class="field"><span>Home church (optional)</span><input type="text" name="church"></label>
             <label class="field"><span>Headline (optional), e.g. "Teacher · Pathfinder leader"</span><input type="text" name="headline"></label>` : ''}
    <button class="btn gold" style="width:100%">${reg ? 'Create account' : 'Sign in'}</button>
    <div class="switch">${reg ? 'Already have an account?' : 'New here?'} <button type="button" id="switchMode">${reg ? 'Sign in' : 'Create an account'}</button></div>
  </form></div>`;
  $('#switchMode').onclick = () => renderAuth(reg ? 'login' : 'register');
  $('#authForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const { token, user } = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body });
      state.token = token; state.user = user;
      localStorage.setItem('gb_token', token);
      boot();
    } catch (err) { toast(err.message, true); }
  };
}

function logout() {
  localStorage.removeItem('gb_token'); localStorage.removeItem('gb_user');
  state.token = null; state.user = null;
  socket?.disconnect(); socket = null;
  location.hash = '';
  renderAuth();
}

// ---------------- shell ----------------
const TABS = [
  ['feed', '🏠', 'Home'], ['videos', '🎬', 'Videos'], ['stores', '🛍️', 'Stores'], ['chats', '💬', 'Chats'], ['library', '📚', 'Library'], ['profile', '👤', 'Profile'],
];

function renderShell() {
  const staff = ['admin', 'moderator'].includes(state.user.role);
  const tabs = staff ? [...TABS, ['admin', '🛡️', 'Moderate']] : TABS;
  $('#app').innerHTML = `
  <div class="shell">
    <nav class="tabs">${tabs.map(([k, i, l]) => `<a href="#/${k}" data-tab="${k}"><span class="ico">${i}</span>${l}${k === 'chats' ? '<span class="badge" id="unreadBadge" hidden></span>' : ''}</a>`).join('')}</nav>
    <div class="content-col">
      <header class="topbar"><img class="logo" src="/icon.svg" alt=""><h1>The Gospel <span>Banker</span></h1>
        <button class="iconbtn" id="themeBtn" title="Switch light/dark">🌓</button></header>
      <main id="view"></main>
    </div>
  </div>`;
  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('gb_theme', next);
  };
}

function updateUnread() {
  drawLauncher(); drawChatPreview();
  const n = state.convs.reduce((a, c) => a + (c.unread || 0), 0);
  const b = $('#unreadBadge');
  if (b) { b.hidden = !n; b.textContent = n; }
}

async function route() {
  if (!state.user) return;
  const [, rawTab = 'feed', ...rest] = location.hash.split('/');
  const tab = rawTab.split('?')[0];
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const view = $('#view');
  view.scrollTop = 0;
  try {
    if (tab === 'feed') await renderFeed(view, rest[0]);
    else if (tab === 'videos') await renderVideos(view, rest.map((r) => r.split('?')[0]));
    else if (tab === 'stores') await renderStores(view, rest.map((r) => r.split('?')[0]));
    else if (tab === 'chats') await renderChats(view, rest[0]);
    else if (tab === 'library') await (rest[0] ? renderSection(view, rest[0]) : renderLibrary(view));
    else if (tab === 'profile') await renderProfile(view, rest[0]);
    else if (tab === 'admin') await renderAdmin(view);
    else location.hash = '#/feed';
  } catch (err) {
    const offline = err instanceof TypeError || !navigator.onLine;
    view.innerHTML = offline
      ? `<div class="empty"><div style="font-size:2.4rem">📴</div><b>You're offline</b><p>Connect to the internet to see the latest. Your downloaded videos still work.</p><a class="btn gold" href="#/videos/downloads" style="text-decoration:none">⬇️ Watch downloads</a></div>`
      : `<div class="empty">${esc(err.message)}</div>`;
  }
}

// ---------------- feed ----------------
const KIND_LABEL = { post: 'Post', prayer: 'Prayer request', testimony: 'Testimony' };

function greeting() {
  const now = new Date();
  const first = esc((state.user.display_name || state.user.username || '').split(/\s+/)[0]);
  const day = now.getDay(), h = now.getHours();
  // Sabbath runs from Friday evening to Saturday evening.
  if (day === 6 || (day === 5 && h >= 18)) return { hello: `Happy Sabbath, ${first}`, note: '🕯️ Rest and rejoice in the Lord today' };
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const days = 5 - day;
  const note = days === 0 ? '🕯️ Sabbath begins this evening at sunset' : `🕯️ Sabbath begins in ${days} day${days === 1 ? '' : 's'}, Friday at sunset`;
  return { hello: `${part}, ${first}`, note };
}

const QUICK = [
  ['prayer', '🙏', 'Ask for prayer'], ['testimony', '🙌', 'Share a testimony'], ['#/videos/upload', '⬆️', 'Upload to channel'], ['#/chats', '💬', 'Message someone'],
];
// Library sections previewed as shelves on the home screen, in this order.
const PREVIEW_SECTIONS = ['sermons', 'jobs', 'egw', 'events', 'devotionals', 'health', 'music', 'bible-study', 'news', 'mission'];
const SHELF_SIZE = 6;

async function renderFeed(view, kind) {
  const [verse, ref] = VERSES[new Date().getDate() % VERSES.length];
  const g = greeting();
  view.innerHTML = `<div class="page home">
    <section class="home-hero">
      <div class="hello">${g.hello}</div>
      <div class="sabbath">${g.note}</div>
      <figure class="verse-card">
        <div class="eyebrow">Verse of the day</div>
        <blockquote>“${esc(verse)}”</blockquote>
        <figcaption><span>${esc(ref)}</span><button class="verse-share" id="shareVerse" type="button">Share ↗</button></figcaption>
      </figure>
    </section>
    <nav class="quick">${QUICK.map(([k, i, l]) => k.startsWith('#')
      ? `<a href="${k}"><span class="qi">${i}</span>${l}</a>`
      : `<button type="button" data-kind="${k}"><span class="qi">${i}</span>${l}</button>`).join('')}</nav>
    <section class="home-sec">
      <div class="sec-head"><h2>Everything in one place</h2></div>
      <div class="launcher" id="launcher"></div>
    </section>
    <section class="home-sec" id="homeChats" hidden>
      <div class="sec-head"><h2>Recent chats</h2><a href="#/chats">All chats ›</a></div>
      <div class="card mini-chats" id="chatPreview"></div>
    </section>
    <section class="home-sec" id="homeVideos" hidden>
      <div class="sec-head"><h2>New videos</h2><a href="#/videos">See all ›</a></div>
      <div class="shelf" id="videoShelf"></div>
    </section>
    <section class="home-sec" id="homeStores" hidden>
      <div class="sec-head"><h2>🛍️ Member stores</h2><a href="#/stores">All stores ›</a></div>
      <div class="shelf" id="storeShelf"></div>
    </section>
    <div id="previews"></div>
    <section class="home-sec">
      <div class="sec-head"><h2>Community</h2></div>
      <form class="card composer-card" id="composer">
        <div class="row" style="align-items:flex-start;gap:12px">
          <div class="avatar">${esc(initials(state.user.display_name))}</div>
          <textarea name="body" rows="1" placeholder="What's on your heart, ${esc((state.user.display_name || '').split(/\s+/)[0])}?" required></textarea>
        </div>
        <div class="composer-more">
          <div class="kind-pills" role="radiogroup">${[['post', '✏️ Post'], ['prayer', '🙏 Prayer request'], ['testimony', '🙌 Testimony']].map(([v, l], i) =>
            `<label><input type="radio" name="kind" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <button class="btn gold">Share</button>
        </div>
      </form>
      <div class="seg">${[['', 'All'], ['prayer', '🙏 Prayer'], ['testimony', '🙌 Testimonies'], ['post', '✏️ Posts']].map(([k, l]) => `<a class="${(kind || '') === k ? 'active' : ''}" href="#/feed${k ? '/' + k : ''}">${l}</a>`).join('')}</div>
      <div id="posts"></div>
    </section></div>`;
  const form = $('#composer');
  const ta = $('textarea', form);
  const open = () => form.classList.add('open');
  ta.onfocus = open;
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 240) + 'px'; };
  view.querySelectorAll('.quick button').forEach((b) => (b.onclick = () => {
    $(`input[value="${b.dataset.kind}"]`, form).checked = true;
    open(); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus({ preventScroll: true });
  }));
  $('#shareVerse').onclick = async () => {
    const text = `“${verse}” (${ref}). Shared from The Gospel Banker`;
    try {
      if (navigator.share) await navigator.share({ text, url: location.origin });
      else { await navigator.clipboard.writeText(text); toast('Verse copied. Paste it anywhere to share.'); }
    } catch { /* cancelled */ }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('/posts', { method: 'POST', body });
      if (r.notice) toast(r.notice);
      e.target.reset(); ta.style.height = ''; form.classList.remove('open'); loadPosts(kind);
    } catch (err) { toast(err.message, true); }
  };
  loadHomeExtras();
  await loadPosts(kind);
}

function drawLauncher() {
  const el = $('#launcher');
  if (!el) return;
  const unread = state.convs.reduce((n, c) => n + (c.unread || 0), 0);
  const fixed = [['#/videos', '🎬', 'Videos'], ['#/videos/channels', '📺', 'Channels'], ['#/videos/preachers', '🎤', 'Preachers & authors'],
    ['#/stores', '🛍️', 'Member stores'], ['#/videos/downloads', '⬇️', 'Downloads'], ['#/chats', '💬', 'Chats', unread]];
  const secs = state.sections.map((s) => [`#/library/${s.key}`, s.icon, s.label, 0, s.count]);
  el.innerHTML = [...fixed, ...secs].map(([href, icon, label, badge]) =>
    `<a href="${href}"><span class="li">${icon}${badge ? `<span class="badge">${badge}</span>` : ''}</span><span class="ll">${esc(label)}</span></a>`).join('');
}

function drawChatPreview() {
  const box = $('#homeChats');
  if (!box) return;
  const list = state.convs.slice(0, 3);
  box.hidden = !list.length;
  $('#chatPreview').innerHTML = list.map((c) => `<a class="chat-item" href="#/chats/${c.id}">${convAvatar(c)}
    <div class="meta"><div class="row"><b style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</b><span class="muted small">${c.last_at ? when(c.last_at) : ''}</span></div>
    <div class="row"><div class="last" style="flex:1">${esc(c.last_body || 'No messages yet')}</div>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}</div></div></a>`).join('');
}

function previewCard(it) {
  const m = it.meta || {};
  const extra = m.location || m.deadline || m.type || '';
  return `<a class="pcard" href="#/library/${it.section}">
    <span class="pt">${esc(it.title)}</span>
    ${it.summary ? `<span class="ps">${esc(it.summary)}</span>` : ''}
    <span class="pm">${esc(it.source || '')}${extra ? `${it.source ? ' · ' : ''}${m.location ? '📍 ' : '📅 '}${esc(extra)}` : ''}</span></a>`;
}

async function loadHomeExtras() {
  try {
    if (!state.sections.length) state.sections = await api('/sections');
    drawLauncher();
  } catch { /* library unavailable */ }
  drawChatPreview();
  const [vids, items, stores] = await Promise.all([api('/videos?limit=8').catch(() => []), api('/content').catch(() => []), storeShelf()]);
  const box = $('#homeVideos');
  if (box && vids.length) { $('#videoShelf').innerHTML = await videoShelfHtml(vids); box.hidden = false; }
  if ($('#homeStores') && stores) { $('#storeShelf').innerHTML = stores; $('#homeStores').hidden = false; }
  const el = $('#previews');
  if (!el) return;
  el.innerHTML = PREVIEW_SECTIONS.map((key) => {
    const sec = state.sections.find((s) => s.key === key);
    const list = items.filter((it) => it.section === key).slice(0, SHELF_SIZE);
    if (!sec || !list.length) return '';
    return `<section class="home-sec"><div class="sec-head"><h2>${sec.icon} ${esc(sec.label)}</h2><a href="#/library/${key}">See all ›</a></div>
      <div class="shelf">${list.map(previewCard).join('')}</div></section>`;
  }).join('');
}

async function loadPosts(kind) {
  const el = $('#posts');
  if (!el) return;
  const posts = await api('/posts' + (kind ? '?kind=' + kind : ''));
  el.innerHTML = posts.length ? posts.map(postHtml).join('') : '<div class="empty">Nothing here yet. Be the first to share!</div>';
  el.onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-post]'); const id = card.dataset.post;
    try {
      if (btn.dataset.act === 'like') {
        const r = await api(`/posts/${id}/like`, { method: 'POST' });
        btn.classList.toggle('on', r.liked); btn.innerHTML = `${r.liked ? '❤️' : '🤍'} ${r.likes || ''} ${card.dataset.kind === 'prayer' ? 'Praying' : 'Amen'}`;
      } else if (btn.dataset.act === 'comments') {
        const box = $('.comments', card);
        if (!box.hidden) { box.hidden = true; return; }
        box.hidden = false; await loadComments(id, box);
      } else if (btn.dataset.act === 'delete' && confirm('Delete this post?')) {
        await api('/posts/' + id, { method: 'DELETE' }); card.remove();
      } else if (btn.dataset.act === 'message') {
        openDirect(Number(card.dataset.author));
      }
    } catch (err) { toast(err.message, true); }
  };
}

function postHtml(p) {
  const mine = p.author_id === state.user.id;
  const staff = ['admin', 'moderator'].includes(state.user.role);
  return `<article class="card post k-${p.kind}" data-post="${p.id}" data-kind="${p.kind}" data-author="${p.author_id}">
    <div class="post-head"><a class="avatar ${state.online.has(p.author_id) ? 'online' : ''}" href="#/profile/${p.author_id}" style="text-decoration:none">${esc(initials(p.author_name))}</a>
      <div style="flex:1;min-width:0"><a class="name" href="#/profile/${p.author_id}" style="color:inherit;text-decoration:none">${esc(p.author_name)}</a>
        <div class="muted small">${esc(p.author_headline || '')}${p.author_headline ? ' · ' : ''}${when(p.created_at)}</div></div>
      ${p.kind !== 'post' ? `<span class="tag">${KIND_LABEL[p.kind]}</span>` : ''}
      ${mine || staff ? '<button class="iconbtn" data-act="delete" title="Delete">🗑️</button>' : ''}</div>
    <div class="post-body">${linkify(p.body)}</div>
    <div class="post-actions">
      <button data-act="like" class="${p.liked ? 'on' : ''}">${p.liked ? '❤️' : '🤍'} ${p.likes || ''} ${p.kind === 'prayer' ? 'Praying' : 'Amen'}</button>
      <button data-act="comments">💬 ${p.comment_count || ''} Comment</button>
      ${mine ? '' : '<button data-act="message">✉️ Message</button>'}
    </div>
    <div class="comments" hidden></div></article>`;
}

async function loadComments(postId, box) {
  const comments = await api(`/posts/${postId}/comments`);
  box.innerHTML = comments.map((c) => `<div class="comment"><b>${esc(c.author_name)}</b> ${linkify(c.body)}</div>`).join('') +
    `<form class="row" style="margin-top:6px"><input type="text" name="body" placeholder="Write a kind comment…" required><button class="btn small">Send</button></form>`;
  $('form', box).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/posts/${postId}/comments`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      if (r.notice) toast(r.notice);
      loadComments(postId, box);
    } catch (err) { toast(err.message, true); }
  };
}

// ---------------- chats ----------------
async function loadConvs() {
  state.convs = await api('/conversations');
  updateUnread();
  return state.convs;
}

async function renderChats(view, convId) {
  view.innerHTML = `<div class="chat-layout ${convId ? 'open' : ''}" style="height:100%">
    <div class="chat-list"><div class="row" style="padding:12px 16px;border-bottom:1px solid var(--line)"><b style="flex:1">Chats</b>
      <button class="btn small gold" id="newChat">+ New chat</button></div><div id="convList"></div></div>
    <section class="chat-pane" id="chatPane">${convId ? '' : '<div class="empty" style="margin:auto">Select a chat or start a new one.</div>'}</section></div>`;
  $('#newChat').onclick = newChatDialog;
  await loadConvs();
  drawConvList(convId);
  if (convId) await openConversation(Number(convId));
  else state.activeConv = null;
}

function convAvatar(c) {
  if (c.is_group) return `<div class="avatar">👥</div>`;
  const other = c.members.find((m) => m.id !== state.user.id);
  return `<div class="avatar ${other && state.online.has(other.id) ? 'online' : ''}">${esc(initials(c.title))}</div>`;
}

function drawConvList(activeId) {
  const el = $('#convList');
  if (!el) return;
  el.innerHTML = state.convs.length ? state.convs.map((c) => `
    <a class="chat-item ${Number(activeId) === c.id ? 'active' : ''}" href="#/chats/${c.id}">${convAvatar(c)}
      <div class="meta"><div class="row"><b style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</b><span class="muted small">${c.last_at ? when(c.last_at) : ''}</span></div>
      <div class="row"><div class="last" style="flex:1">${esc(c.last_body || 'No messages yet')}</div>${c.unread && Number(activeId) !== c.id ? `<span class="badge">${c.unread}</span>` : ''}</div></div></a>`).join('')
    : '<div class="empty">No chats yet. Tap "New chat" to message someone.</div>';
}

function bubbleHtml(m, isGroup) {
  const me = m.sender_id === state.user.id;
  const quote = m.reply_to ? `<button type="button" class="quote" data-jump="${m.reply_to}"><b>${esc(m.reply_name || 'Message')}</b><span>${esc(m.reply_body ?? 'Original message not loaded')}</span></button>` : '';
  return `<div class="bubble ${me ? 'me' : ''} ${m.flagged ? 'flagged' : ''}" data-id="${m.id}" data-name="${esc(m.sender_name)}"><span class="swipe-ico" aria-hidden="true">↩</span>${isGroup && !me ? `<div class="who">${esc(m.sender_name)}</div>` : ''}${quote}<div class="text">${linkify(m.body)}</div><div class="time">${when(m.created_at)}<button type="button" class="reply-btn" title="Reply">↩</button></div></div>`;
}

// Swipe a message left or right (or tap ↩ on a computer) to reply to it.
function enableSwipeReply(box, onReply) {
  let start = null;
  const reset = (b) => { b.style.transform = ''; b.classList.remove('swiping', 'armed'); };
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.bubble');
    if (!b || e.button > 0 || e.target.closest('a, .quote, .reply-btn')) return;
    start = { b, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
  });
  box.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.active) {
      if (Math.abs(dy) > 12) { start = null; return; } // scrolling
      if (Math.abs(dx) < 12) return;
      start.active = true; start.b.classList.add('swiping');
      try { start.b.setPointerCapture(e.pointerId); } catch {}
    }
    start.dx = Math.max(-90, Math.min(90, dx));
    start.b.style.transform = `translateX(${start.dx}px)`;
    start.b.classList.toggle('armed', Math.abs(start.dx) > 55);
    start.b.classList.toggle('left', start.dx < 0);
  });
  const end = () => {
    if (!start) return;
    const { b, dx, active } = start; start = null;
    if (!active) return;
    b.style.transition = 'transform .18s'; reset(b);
    setTimeout(() => (b.style.transition = ''), 200);
    if (Math.abs(dx) > 55) { navigator.vibrate?.(15); onReply(b); }
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('click', (e) => {
    const rb = e.target.closest('.reply-btn');
    if (rb) return onReply(rb.closest('.bubble'));
    const q = e.target.closest('.quote');
    if (q) {
      const target = box.querySelector(`.bubble[data-id="${q.dataset.jump}"]`);
      if (!target) return toast('That message is further up in the chat.');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
    }
  });
}

async function openConversation(id) {
  const c = state.convs.find((x) => x.id === id);
  const pane = $('#chatPane');
  if (!c) { pane.innerHTML = '<div class="empty">Chat not found.</div>'; return; }
  state.activeConv = c;
  const sub = c.is_group ? c.members.map((m) => m.display_name.split(' ')[0]).join(', ')
    : (state.online.has(c.members.find((m) => m.id !== state.user.id)?.id) ? 'online' : c.members.find((m) => m.id !== state.user.id)?.headline || '');
  pane.innerHTML = `<div class="chat-header"><a class="iconbtn" href="#/chats" style="text-decoration:none">←</a>${convAvatar(c)}
      <div style="min-width:0;flex:1"><b>${esc(c.title)}</b><div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sub)}</div></div>
      ${c.store_id ? `<a class="btn small ghost" href="#/stores/${c.store_id}" style="text-decoration:none;white-space:nowrap">🛍️ Store</a>` : ''}</div>
    <div class="messages" id="msgs"></div><div class="typing" id="typing"></div>
    <div class="reply-bar" id="replyBar" hidden><div class="rb-text"><b id="replyName"></b><span id="replyText"></span></div><button type="button" class="iconbtn" id="replyCancel" title="Cancel reply">✕</button></div>
    <form class="composer" id="sendForm"><textarea name="body" rows="1" placeholder="Message" required></textarea><button class="btn" title="Send">➤</button></form>`;
  const msgs = await api(`/conversations/${id}/messages`);
  const box = $('#msgs');
  box.innerHTML = msgs.map((m) => bubbleHtml(m, c.is_group)).join('');
  box.scrollTop = box.scrollHeight;
  c.unread = 0; updateUnread(); drawConvList(id);
  socket?.emit('conversation:join', id);

  const form = $('#sendForm'); const ta = $('textarea', form);
  let replyTo = null;
  const setReply = (b) => {
    replyTo = b ? Number(b.dataset.id) : null;
    $('#replyBar').hidden = !b;
    if (b) {
      $('#replyName').textContent = b.classList.contains('me') ? 'You' : b.dataset.name;
      $('#replyText').textContent = $('.text', b).textContent;
      ta.focus();
    }
  };
  enableSwipeReply(box, setReply);
  $('#replyCancel').onclick = () => setReply(null);
  // A message started elsewhere, e.g. "Is this product available?" from a store.
  const draft = sessionStorage.getItem('gb_draft_' + id);
  if (draft) { sessionStorage.removeItem('gb_draft_' + id); ta.value = draft; ta.focus(); }
  let lastTyping = 0;
  ta.oninput = () => {
    ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px';
    if (Date.now() - lastTyping > 2000) { socket?.emit('typing', { conversationId: id }); lastTyping = Date.now(); }
  };
  ta.onkeydown = (e) => { if (e.key === 'Escape') setReply(null); if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); } };
  form.onsubmit = (e) => {
    e.preventDefault();
    const body = ta.value.trim();
    if (!body) return;
    ta.value = ''; ta.style.height = 'auto';
    const quoted = replyTo; setReply(null);
    socket.emit('message:send', { conversationId: id, body, replyTo: quoted }, (r) => {
      if (r.error) { toast(r.error, true); ta.value = body; }
      else if (r.notice) toast(r.notice);
    });
  };
}

async function newChatDialog() {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog" id="ncForm"><h3>New chat</h3>
    <input type="search" id="userSearch" placeholder="Search by name, username or church">
    <div id="userResults" style="max-height:300px;overflow:auto;margin:10px 0"></div>
    <label class="field"><span>Group name (only for groups of 3 or more)</span><input type="text" name="name" placeholder="e.g. Choir, Pathfinders, Family"></label>
    <div class="row"><span class="spacer"></span><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok" id="ncGo">Start chat</button></div></form>`;
  document.body.append(dlg); dlg.showModal();
  const picked = new Set();
  const search = async () => {
    const users = await api('/users?q=' + encodeURIComponent($('#userSearch', dlg).value));
    $('#userResults', dlg).innerHTML = users.map((u) => `<label class="pick"><input type="checkbox" value="${u.id}" ${picked.has(u.id) ? 'checked' : ''}>
      <div class="avatar sm">${esc(initials(u.display_name))}</div><div><b>${esc(u.display_name)}</b> <span class="muted small">@${esc(u.username)}</span><div class="muted small">${esc([u.headline, u.church].filter(Boolean).join(' · '))}</div></div></label>`).join('') || '<div class="muted">No one found.</div>';
  };
  $('#userResults', dlg).onchange = (e) => { const id = Number(e.target.value); e.target.checked ? picked.add(id) : picked.delete(id); };
  let t; $('#userSearch', dlg).oninput = () => { clearTimeout(t); t = setTimeout(search, 250); };
  search();
  dlg.onclose = async () => {
    const name = new FormData($('#ncForm', dlg)).get('name');
    dlg.remove();
    if (dlg.returnValue !== 'ok' || !picked.size) return;
    try {
      const { id } = await api('/conversations', { method: 'POST', body: { user_ids: [...picked], name: picked.size > 1 ? name : undefined } });
      location.hash = '#/chats/' + id;
    } catch (err) { toast(err.message, true); }
  };
}

async function openDirect(userId) {
  try {
    const { id } = await api('/conversations', { method: 'POST', body: { user_ids: [userId] } });
    location.hash = '#/chats/' + id;
  } catch (err) { toast(err.message, true); }
}

// ---------------- library ----------------
async function renderLibrary(view) {
  state.sections = await api('/sections');
  view.innerHTML = `<div class="page">
    <h2>Library</h2><p class="muted">Adventist music, preaching, health, study and service, all in one place.</p>
    <form id="libSearch" class="row" style="margin-bottom:16px"><input type="search" name="q" placeholder="Search everything…"><button class="btn">Search</button></form>
    <div id="libResults"></div>
    <div class="grid">${state.sections.map((s) => `<a class="tile" href="#/library/${s.key}"><span class="ico">${s.icon}</span><span class="label">${esc(s.label)}</span><span class="muted small">${s.count} item${s.count === 1 ? '' : 's'}</span></a>`).join('')}</div></div>`;
  $('#libSearch').onsubmit = async (e) => {
    e.preventDefault();
    const term = new FormData(e.target).get('q').trim();
    const el = $('#libResults');
    if (!term) { el.innerHTML = ''; return; }
    const items = await api('/content?q=' + encodeURIComponent(term));
    el.innerHTML = items.length ? items.map(itemHtml).join('') : '<div class="empty">No matches.</div>';
  };
}

function youtubeId(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m && m[1];
}

const VIDEO_LINK = { 'music-videos': 'music', music: 'music', sermons: 'sermons', health: 'health', podcasts: 'podcasts', mission: 'mission', testimonies: 'testimonies', 'bible-study': 'bible-study', events: 'events' };

function itemHtml(it) {
  const sec = state.sections.find((s) => s.key === it.section);
  const yt = youtubeId(it.url);
  const m = it.meta || {};
  return `<article class="card">
    <div class="row"><span class="tag">${esc(sec?.label || it.section)}</span><span class="spacer"></span><span class="muted small">${esc(it.source)}</span></div>
    <div class="item-title" style="margin-top:6px">${esc(it.title)}</div>
    ${it.summary ? `<div class="muted">${esc(it.summary)}</div>` : ''}
    ${yt ? `<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" loading="lazy" allowfullscreen title="${esc(it.title)}"></iframe></div>` : ''}
    ${m.location || m.type || m.deadline || m.price ? `<div class="kv">${m.location ? `<span>📍 ${esc(m.location)}</span>` : ''}${m.type ? `<span>🕒 ${esc(m.type)}</span>` : ''}${m.deadline ? `<span>📅 ${it.section === 'events' ? 'Date' : 'Apply by'} ${esc(m.deadline)}</span>` : ''}${m.price ? `<span>💲 ${esc(m.price)}</span>` : ''}</div>` : ''}
    ${it.url && !yt ? `<div style="margin-top:10px"><a class="btn small ghost" style="text-decoration:none" href="${esc(it.url)}" target="_blank" rel="noopener">${it.section === 'jobs' ? 'Apply / details' : 'Open'} ↗</a></div>` : ''}
  </article>`;
}

async function renderSection(view, key) {
  if (!state.sections.length) state.sections = await api('/sections');
  const sec = state.sections.find((s) => s.key === key);
  if (!sec) { location.hash = '#/library'; return; }
  const items = await api('/content?section=' + key);
  const staff = ['admin', 'moderator'].includes(state.user.role);
  const extra = key === 'egw' ? `<form class="card" id="egwSearch"><b>Search Ellen G. White's writings</b>
      <div class="row" style="margin-top:8px"><input type="search" name="q" placeholder="e.g. Steps to Christ, health reform"><button class="btn">Search</button></div>
      <div class="muted small" style="margin-top:6px">Opens the official EGW Writings site.</div></form>`
    : VIDEO_LINK[key] ? `<a class="card row" style="text-decoration:none;color:inherit" href="#/videos/c/${VIDEO_LINK[key]}"><span style="font-size:1.6rem">▶️</span><div style="flex:1"><b>Watch ${esc(sec.label)} videos</b><div class="muted small">Uploaded by the community, right here in the app</div></div><span>›</span></a>` + (key === 'testimonies' ? `<div class="card">Have a written testimony? <a href="#/feed/testimony">Share it on the Feed</a>.</div>` : '')
    : key === 'stores' ? `<a class="card row" style="text-decoration:none;color:inherit" href="#/stores"><span style="font-size:1.6rem">🛍️</span><div style="flex:1"><b>Member stores</b><div class="muted small">Books, health foods, crafts and services sold by members. Open your own store too.</div></div><span>›</span></a>`
    : key === 'testimonies' ? `<div class="card">Have a testimony? <a href="#/feed/testimony">Share it on the Feed</a> and choose "Testimony".</div>` : '';
  view.innerHTML = `<div class="page">
    <a href="#/library" class="muted small" style="text-decoration:none">← Library</a>
    <div class="row" style="margin:6px 0 4px"><h2 style="flex:1;margin:0">${sec.icon} ${esc(sec.label)}</h2><button class="btn small gold" id="submitBtn">${staff ? '+ Add' : '+ Suggest'}</button></div>
    <p class="muted">${esc(sec.blurb)}</p>${extra}
    ${items.length ? items.map(itemHtml).join('') : '<div class="empty">Nothing here yet.</div>'}</div>`;
  $('#submitBtn').onclick = () => submitDialog(sec, staff);
  const egw = $('#egwSearch');
  if (egw) egw.onsubmit = (e) => {
    e.preventDefault();
    const term = new FormData(egw).get('q').trim();
    window.open('https://egwwritings.org/search?query=' + encodeURIComponent(term), '_blank', 'noopener');
  };
}

function submitDialog(sec, staff) {
  const listing = sec.kind === 'job';
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog"><h3>${staff ? 'Add to' : 'Suggest for'} ${esc(sec.label)}</h3>
    ${staff ? '' : '<p class="muted small">A moderator reviews suggestions before they appear, to keep content Adventist and family-friendly.</p>'}
    <label class="field"><span>Title</span><input type="text" name="title" required></label>
    <label class="field"><span>Link (YouTube links play inside the app)</span><input type="url" name="url" placeholder="https://"></label>
    <label class="field"><span>${listing ? 'Institution / organiser' : 'Ministry, artist or author'}</span><input type="text" name="source"></label>
    <label class="field"><span>Short description</span><textarea name="summary"></textarea></label>
    ${listing ? `<div class="row"><label class="field" style="flex:1"><span>Location</span><input type="text" name="location"></label>
      <label class="field" style="flex:1"><span>${sec.key === 'events' ? 'Date' : 'Apply by'}</span><input type="date" name="deadline"></label></div>
      <label class="field"><span>Type</span><input type="text" name="type" placeholder="${sec.key === 'events' ? 'Camp meeting, crusade…' : 'Full-time, contract, volunteer…'}"></label>` : ''}
    ${sec.kind === 'store' ? '<label class="field"><span>Price range (optional)</span><input type="text" name="price"></label>' : ''}
    <div class="row"><span class="spacer"></span><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">${staff ? 'Publish' : 'Submit'}</button></div></form>`;
  document.body.append(dlg); dlg.showModal();
  dlg.onclose = async () => {
    const f = Object.fromEntries(new FormData($('form', dlg)));
    dlg.remove();
    if (dlg.returnValue !== 'ok') return;
    const { title, url, source, summary, location: loc, deadline, type, price } = f;
    try {
      const r = await api('/content', { method: 'POST', body: { section: sec.key, title, url, source, summary, meta: { location: loc, deadline, type, price } } });
      toast(r.message); route();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------------- profile ----------------
async function renderProfile(view, userId) {
  if (userId && Number(userId) !== state.user.id) {
    const u = await api('/users/' + userId);
    view.innerHTML = `<div class="page"><div class="card" style="text-align:center">
      <div class="avatar ${state.online.has(u.id) ? 'online' : ''}" style="width:80px;height:80px;font-size:1.6rem;margin:0 auto 10px">${esc(initials(u.display_name))}</div>
      <h2>${esc(u.display_name)}</h2><div class="muted">@${esc(u.username)}${u.role !== 'member' ? ` · <span class="tag">${u.role}</span>` : ''}</div>
      ${u.headline ? `<p><b>${esc(u.headline)}</b></p>` : ''}${u.church ? `<p class="muted">⛪ ${esc(u.church)}</p>` : ''}
      ${u.bio ? `<p>${esc(u.bio)}</p>` : ''}<p class="muted small">${u.posts} posts</p>
      <div class="row" style="justify-content:center"><button class="btn gold" id="msgBtn">✉️ Message</button><a class="btn ghost" href="#/videos/channel/${u.id}" style="text-decoration:none">🎬 Channel & stores</a></div></div></div>`;
    $('#msgBtn').onclick = () => openDirect(u.id);
    return;
  }
  const u = state.user;
  view.innerHTML = `<div class="page"><form class="card" id="profileForm"><h2>Your profile</h2>
    <p class="muted small">@${esc(u.username)}${u.role !== 'member' ? ` · ${u.role}` : ''}</p>
    <label class="field"><span>Name</span><input type="text" name="display_name" value="${esc(u.display_name)}" required></label>
    <label class="field"><span>Headline (profession or ministry)</span><input type="text" name="headline" value="${esc(u.headline)}"></label>
    <label class="field"><span>Home church</span><input type="text" name="church" value="${esc(u.church)}"></label>
    <label class="field"><span>About you</span><textarea name="bio">${esc(u.bio)}</textarea></label>
    <div class="row"><button class="btn">Save</button><a class="btn ghost" href="#/videos/channel/${u.id}" style="text-decoration:none">🎬 My channel</a><a class="btn ghost" href="#/stores/mine" style="text-decoration:none">🛍️ My stores</a><span class="spacer"></span><button type="button" class="btn ghost" id="logoutBtn">Sign out</button></div></form>
    <div class="card small muted">🛡️ To keep this a safe place, messages, posts and comments are checked for abusive language${state.aiModeration ? ' by an AI filter' : ''}. Mild words are hidden; threats and harassment are blocked, and repeat offenders are muted.</div></div>`;
  $('#logoutBtn').onclick = logout;
  $('#profileForm').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); state.user = r.user; toast('Profile saved'); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------------- moderation ----------------
async function renderAdmin(view) {
  const [pending, log] = await Promise.all([api('/admin/pending'), api('/admin/moderation-log')]);
  if (!state.sections.length) state.sections = await api('/sections');
  const [videosBlock, storesBlock] = await Promise.all([pendingVideosHtml(), pendingStoresHtml()]);
  view.innerHTML = `<div class="page"><h2>Moderation</h2>${videosBlock}${storesBlock}
    <h3 style="margin-top:24px">Library suggestions waiting for review (${pending.length})</h3>
    ${pending.length ? pending.map((it) => `<div data-id="${it.id}">${itemHtml(it)}<div class="row" style="margin:-6px 0 14px"><span class="muted small" style="flex:1">Suggested by ${esc(it.submitted_by_name || 'unknown')}</span>
      <button class="btn small danger" data-s="rejected">Reject</button><button class="btn small" data-s="approved">Approve</button></div></div>`).join('') : '<div class="empty">All caught up.</div>'}
    <h3 style="margin-top:24px">Filtered language log</h3>
    ${log.length ? `<div class="card" style="padding:0;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.88rem">
      <tr style="text-align:left"><th style="padding:8px">When</th><th>User</th><th>Where</th><th>Action</th><th>Text</th></tr>
      ${log.map((l) => `<tr style="border-top:1px solid var(--line)"><td style="padding:8px;white-space:nowrap">${when(l.created_at)}</td><td>${esc(l.display_name)} <span class="muted">(${l.strikes} strikes)</span></td><td>${l.context}</td><td>${l.verdict}</td><td>${esc(l.original)}</td></tr>`).join('')}
    </table></div>` : '<div class="empty">No filtered messages.</div>'}</div>`;
  view.onclick = async (e) => {
    const vb = e.target.closest('button[data-vs]');
    if (vb) {
      const card = vb.closest('[data-vid]');
      await api('/admin/videos/' + card.dataset.vid, { method: 'POST', body: { status: vb.dataset.vs } });
      card.remove(); toast(vb.dataset.vs === 'approved' ? 'Published' : 'Rejected');
      return;
    }
    const sb = e.target.closest('button[data-ss]');
    if (sb) {
      const card = sb.closest('[data-sid]');
      await api('/admin/stores/' + card.dataset.sid, { method: 'POST', body: { status: sb.dataset.ss } });
      card.remove(); toast(sb.dataset.ss === 'approved' ? 'Store approved' : 'Store rejected');
      return;
    }
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    const wrap = b.closest('[data-id]');
    await api('/admin/content/' + wrap.dataset.id, { method: 'POST', body: { status: b.dataset.s } });
    wrap.remove(); toast(b.dataset.s === 'approved' ? 'Published' : 'Rejected');
  };
}

// ---------------- realtime ----------------
function connectSocket() {
  if (typeof io !== 'function') return; // offline: the chat server is out of reach
  socket = io({ auth: { token: state.token } });
  socket.on('presence', ({ online }) => { state.online = new Set(online); });
  socket.on('message:new', (m) => {
    const c = state.convs.find((x) => x.id === m.conversation_id);
    if (c) { c.last_body = m.body; c.last_at = m.created_at; }
    if (state.activeConv?.id === m.conversation_id && $('#msgs')) {
      const box = $('#msgs');
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      box.insertAdjacentHTML('beforeend', bubbleHtml(m, state.activeConv.is_group));
      if (nearBottom || m.sender_id === state.user.id) box.scrollTop = box.scrollHeight;
      socket.emit('message:read', { conversationId: m.conversation_id, messageId: m.id });
      $('#typing').textContent = '';
    } else if (c && m.sender_id !== state.user.id) {
      c.unread = (c.unread || 0) + 1;
      if (document.hidden && Notification?.permission === 'granted') new Notification(m.sender_name, { body: m.body, icon: '/icon.svg' });
    }
    if (!c) loadConvs().then(() => drawConvList(state.activeConv?.id));
    state.convs.sort((a, b) => (b.last_at || '').localeCompare(a.last_at || ''));
    updateUnread(); drawConvList(state.activeConv?.id);
  });
  socket.on('conversation:new', () => loadConvs().then(() => drawConvList(state.activeConv?.id)));
  socket.on('typing', ({ conversationId, name }) => {
    if (state.activeConv?.id !== conversationId || !$('#typing')) return;
    $('#typing').textContent = `${name} is typing…`;
    clearTimeout(connectSocket.t);
    connectSocket.t = setTimeout(() => { if ($('#typing')) $('#typing').textContent = ''; }, 3000);
  });
}

// ---------------- boot ----------------
async function boot() {
  const theme = localStorage.getItem('gb_theme');
  if (theme) document.documentElement.dataset.theme = theme;
  if (!state.token) return renderAuth();
  try {
    const me = await api('/me');
    state.user = me.user; state.aiModeration = me.aiModeration;
    localStorage.setItem('gb_user', JSON.stringify(me.user));
  } catch (err) {
    // No internet: open the app with the saved account so downloads can be watched.
    const saved = JSON.parse(localStorage.getItem('gb_user') || 'null');
    if (!(err instanceof TypeError) || !state.token || !saved) return renderAuth();
    state.user = saved;
  }
  renderShell();
  connectSocket();
  loadConvs().catch(() => {});
  if ('Notification' in window && Notification.permission === 'default') setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
  window.onhashchange = route;
  route();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
