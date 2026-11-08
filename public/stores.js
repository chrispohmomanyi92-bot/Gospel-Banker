// Member stores: browse by what they sell, open your own store, list products,
// and run a store group where shoppers hear about new products.
import { api, esc, toast, linkify, state } from './app.js';

const $ = (sel, el = document) => el.querySelector(sel);
let categories = [];
const loadCategories = async () => (categories = await api('/stores/categories'));
const plural = (n, word) => `${n} ${n === 1 ? word : word + 's'}`;

// Multipart request (for pictures), with the same errors as api().
async function sendForm(path, method, fd) {
  const res = await fetch('/api' + path, { method, body: fd, headers: { authorization: 'Bearer ' + state.token } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const logoHtml = (s, big = false) => `<div class="slogo ${big ? 'big' : ''}">${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : s.category_icon || '🛍️'}</div>`;

export function storeCardHtml(s) {
  return `<a class="scard" href="#/stores/${s.id}">${logoHtml(s)}
    <div style="min-width:0;flex:1"><div class="vtitle">${esc(s.name)}</div>
      <div class="muted small">${s.category_icon} ${esc(s.category_label)}</div>
      <div class="muted small clamp1">${s.location ? '📍 ' + esc(s.location) + ' · ' : ''}${plural(s.product_count, 'product')}</div>
      ${s.status !== 'approved' ? `<span class="tag" style="margin-top:4px">${s.status === 'pending' ? 'Awaiting review' : 'Not approved'}</span>` : ''}</div></a>`;
}

export async function renderStores(view, [sub, arg] = []) {
  if (!categories.length) await loadCategories();
  if (sub === 'new') return renderStoreForm(view, null);
  if (sub === 'mine') return renderMine(view);
  if (sub && /^\d+$/.test(sub)) return arg === 'edit' ? renderStoreForm(view, await api('/stores/' + sub)) : renderStore(view, Number(sub));
  return renderBrowse(view, sub === 'c' ? arg : '');
}

async function renderBrowse(view, cat) {
  const term = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  view.innerHTML = `<div class="page wide">
    <h2 style="margin:0 0 4px">🛍️ Member stores</h2>
    <p class="muted small" style="margin-top:0">Buy from Adventist brothers and sisters: books, health foods, crafts, farm produce and services.</p>
    <div class="row" style="margin-bottom:12px"><a class="btn small gold" href="#/stores/new" style="text-decoration:none">+ Open your store</a>
      <a class="btn small ghost" href="#/stores/mine" style="text-decoration:none">My stores</a></div>
    <form class="row" id="sSearch" style="margin-bottom:12px"><input type="search" name="q" value="${esc(term)}" placeholder="Search stores and products"><button class="btn">Search</button></form>
    <div class="chips"><a class="chip ${!cat && !term ? 'active' : ''}" href="#/stores">All</a>
      ${categories.map((c) => `<a class="chip ${cat === c.key ? 'active' : ''}" href="#/stores/c/${c.key}">${c.icon} ${esc(c.label)}${c.count ? ` <span class="muted">${c.count}</span>` : ''}</a>`).join('')}</div>
    <div id="sBody"><div class="empty">Loading…</div></div></div>`;
  $('#sSearch').onsubmit = (e) => {
    e.preventDefault();
    const t = new FormData(e.target).get('q').trim();
    location.hash = t ? '#/stores/search?q=' + encodeURIComponent(t) : '#/stores';
  };
  const qs = term ? '?q=' + encodeURIComponent(term) : cat ? '?category=' + cat : '';
  const list = await api('/stores' + qs);
  const c = categories.find((x) => x.key === cat);
  const head = term ? `<h3>Results for "${esc(term)}"</h3>` : c ? `<h3>${c.icon} ${esc(c.label)}</h3>` : '';
  if (list.length) { $('#sBody').innerHTML = head + `<div class="sgrid">${list.map(storeCardHtml).join('')}</div>`; return; }
  $('#sBody').innerHTML = head + `<div class="empty">${term ? 'No stores or products match.' : 'No stores here yet.'}<br><br><a class="btn gold" href="#/stores/new" style="text-decoration:none">+ Open the first one</a></div>`;
  if (!term && !cat) {
    // Empty market: show what kinds of stores members can open.
    $('#sBody').innerHTML = `<div class="empty" style="padding-bottom:16px">No member stores yet. Be the first to open one!</div>
      <div class="grid">${categories.map((x) => `<a class="tile" href="#/stores/new?category=${x.key}"><span class="ico">${x.icon}</span><span class="label">${esc(x.label)}</span><span class="muted small">Open a store</span></a>`).join('')}</div>`;
  }
}

async function renderMine(view) {
  const list = await api('/stores?owner=' + state.user.id);
  view.innerHTML = `<div class="page wide"><a href="#/stores" class="muted small" style="text-decoration:none">← Stores</a>
    <div class="row" style="margin:6px 0 12px"><h2 style="flex:1;margin:0">My stores</h2><a class="btn small gold" href="#/stores/new" style="text-decoration:none">+ Open a store</a></div>
    ${list.length ? `<div class="sgrid">${list.map(storeCardHtml).join('')}</div>` : '<div class="empty">You have not opened a store yet.</div>'}</div>`;
}

function renderStoreForm(view, s) {
  const editing = Boolean(s);
  const preset = new URLSearchParams(location.hash.split('?')[1] || '').get('category');
  const staff = ['admin', 'moderator'].includes(state.user.role);
  view.innerHTML = `<div class="page"><a href="${editing ? '#/stores/' + s.id : '#/stores'}" class="muted small" style="text-decoration:none">← ${editing ? esc(s.name) : 'Stores'}</a>
    <h2 style="margin-top:6px">${editing ? 'Edit your store' : 'Open your store'}</h2>
    ${editing || staff ? '' : '<p class="muted small">Anyone in the community can open a store. A moderator reviews new stores before shoppers can see them. You get a store group too, where you can tell shoppers about new products.</p>'}
    <form class="card" id="storeForm">
      <div class="row" style="gap:14px;margin-bottom:12px"><div id="logoPrev">${logoHtml(s || { category_icon: '🛍️' }, true)}</div>
        <label class="btn small ghost">📷 ${s?.logo_url ? 'Change logo' : 'Add a logo or photo'}<input type="file" name="logo" accept="image/jpeg,image/png,image/webp" hidden></label></div>
      <label class="field"><span>Store name</span><input type="text" name="name" maxlength="80" required value="${esc(s?.name || '')}" placeholder="e.g. Grace Health Foods"></label>
      <label class="field"><span>What do you sell?</span><select name="category" required><option value="">Choose a category…</option>
        ${categories.map((c) => `<option value="${c.key}" ${(s?.category || preset) === c.key ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('')}</select></label>
      <label class="field"><span>About your store</span><textarea name="description" maxlength="3000" placeholder="What you sell, delivery, opening days (closed on Sabbath)…">${esc(s?.description || '')}</textarea></label>
      <div class="row wrap"><label class="field" style="flex:1;min-width:200px"><span>Location</span><input type="text" name="location" maxlength="120" value="${esc(s?.location || '')}" placeholder="Town or church"></label>
        <label class="field" style="flex:1;min-width:200px"><span>How to buy (phone, WhatsApp, M-Pesa till)</span><input type="text" name="contact" maxlength="160" value="${esc(s?.contact || '')}"></label></div>
      <button class="btn gold" style="width:100%">${editing ? 'Save changes' : 'Open my store'}</button></form></div>`;
  const form = $('#storeForm');
  form.logo.onchange = () => {
    const f = form.logo.files[0];
    if (f) $('#logoPrev').innerHTML = `<div class="slogo big"><img src="${URL.createObjectURL(f)}" alt=""></div>`;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (!form.logo.files[0]) fd.delete('logo');
    const btn = $('button.gold', form); btn.disabled = true;
    try {
      const r = await sendForm(editing ? '/stores/' + s.id : '/stores', editing ? 'PATCH' : 'POST', fd);
      toast(r.message || 'Saved');
      location.hash = '#/stores/' + r.store.id;
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

const contactHtml = (c) => esc(c).replace(/(\+?\d[\d\s-]{7,}\d)/g, (m) => `<a href="tel:${m.replace(/[\s-]/g, '')}">${m}</a>`);

async function renderStore(view, id) {
  const s = await api('/stores/' + id);
  const mine = s.owner_id === state.user.id;
  view.innerHTML = `<div class="page wide"><a href="#/stores" class="muted small" style="text-decoration:none">← Stores</a>
    <div class="channel-banner store-banner" style="margin-top:6px">${logoHtml(s, true)}
      <div style="flex:1;min-width:0"><h2 style="margin:0">${esc(s.name)}</h2>
        <div class="small" style="opacity:.9"><a class="on-dark" href="#/stores/c/${s.category}">${s.category_icon} ${esc(s.category_label)}</a>${s.location ? ' · 📍 ' + esc(s.location) : ''}</div>
        <div class="small" style="opacity:.85">by <a class="on-dark" href="#/videos/channel/${s.owner_id}">${esc(s.owner_name)}</a> · ${plural(s.group_members, 'member')} in the store group</div></div>
      <div class="row wrap">
        <button class="btn gold" id="groupBtn">${s.in_group ? '💬 Open store group' : '👥 Join store group'}</button>
        ${mine ? `<a class="btn ghost on-dark" href="#/stores/${s.id}/edit" style="text-decoration:none">✏️ Edit</a>` : `<button class="btn ghost on-dark" id="dmBtn">✉️ Message seller</button>`}
        <button class="btn ghost on-dark" id="shareBtn" title="Share">↗</button></div></div>
    ${s.status !== 'approved' ? `<div class="card small">⏳ ${s.status === 'pending' ? 'This store is waiting for a moderator. Only you and moderators can see it for now, but you can already add products.' : 'This store was not approved. Edit it or contact a moderator.'}</div>` : ''}
    ${s.description || s.contact ? `<div class="card">${s.description ? `<div class="post-body">${linkify(s.description)}</div>` : ''}${s.contact ? `<div class="small" style="margin-top:8px">📞 <b>How to buy:</b> ${contactHtml(s.contact)}</div>` : ''}</div>` : ''}
    <div class="row" style="margin:16px 0 8px"><h3 style="flex:1;margin:0">Products (${s.products.length})</h3>${s.can_edit ? '<button class="btn small gold" id="addProd">+ Add product</button>' : ''}</div>
    ${s.products.length ? `<div class="pgrid">${s.products.map((p) => `<div class="product" data-pid="${p.id}">
        <div class="pimg">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : s.category_icon}</div>
        <div class="pbody"><b class="clamp2">${esc(p.name)}</b>${p.price ? `<div class="price">${esc(p.price)}</div>` : ''}
          ${p.description ? `<div class="muted small clamp2">${esc(p.description)}</div>` : ''}
          <div class="row" style="margin-top:auto;padding-top:6px">${mine ? '' : '<button class="btn small" data-act="ask">✉️ Ask / order</button>'}${s.can_edit ? '<button class="btn small ghost" data-act="del" title="Remove">🗑️</button>' : ''}</div></div></div>`).join('')}</div>`
      : `<div class="empty">${s.can_edit ? 'Add your first product so shoppers can see what you sell.' : 'No products listed yet. Message the seller to ask what is available.'}</div>`}
    ${s.can_edit ? '<div style="margin-top:24px"><button class="btn small danger" id="delStore">Close this store</button></div>' : ''}</div>`;

  const ask = async (text) => {
    const { id: cid } = await api('/conversations', { method: 'POST', body: { user_ids: [s.owner_id] } });
    if (text) sessionStorage.setItem('gb_draft_' + cid, text);
    location.hash = '#/chats/' + cid;
  };
  $('#groupBtn').onclick = async () => {
    try {
      const r = await api(`/stores/${id}/group`, { method: 'POST', body: {} });
      if (!s.in_group) toast('You joined the store group');
      location.hash = '#/chats/' + r.conversation_id;
    } catch (err) { toast(err.message, true); }
  };
  const dm = $('#dmBtn');
  if (dm) dm.onclick = () => ask(`Hello! I found ${s.name} on The Gospel Banker.`).catch((e) => toast(e.message, true));
  $('#shareBtn').onclick = async () => {
    try { if (navigator.share) await navigator.share({ title: s.name, url: location.href }); else { await navigator.clipboard.writeText(location.href); toast('Link copied'); } } catch {}
  };
  view.querySelector('.pgrid')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = s.products.find((x) => x.id === Number(b.closest('[data-pid]').dataset.pid));
    if (b.dataset.act === 'ask') ask(`Hello! Is "${p.name}"${p.price ? ` (${p.price})` : ''} available?`).catch((err) => toast(err.message, true));
    else if (b.dataset.act === 'del' && confirm(`Remove "${p.name}"?`)) {
      await api(`/stores/${id}/products/${p.id}`, { method: 'DELETE' }); toast('Removed'); renderStore(view, id);
    }
  });
  const add = $('#addProd');
  if (add) add.onclick = () => productDialog(s, () => renderStore(view, id));
  const del = $('#delStore');
  if (del) del.onclick = async () => {
    if (!confirm('Close this store? Its products and store group will be deleted.')) return;
    await api('/stores/' + id, { method: 'DELETE' }); toast('Store closed'); location.hash = '#/stores';
  };
}

function productDialog(s, done) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog" id="pForm"><h3>Add a product</h3>
    <label class="dropzone" style="padding:16px"><input type="file" name="image" accept="image/jpeg,image/png,image/webp" hidden>
      <div id="pImg">📷 Add a photo (optional)</div></label>
    <label class="field" style="margin-top:12px"><span>Name</span><input type="text" name="name" maxlength="100" required placeholder="e.g. Steps to Christ (paperback)"></label>
    <label class="field"><span>Price</span><input type="text" name="price" maxlength="40" placeholder="e.g. KSh 450"></label>
    <label class="field"><span>Description</span><textarea name="description" maxlength="2000"></textarea></label>
    <label class="pick" style="padding:0 0 12px"><input type="checkbox" name="announce" checked> Tell the store group about it</label>
    <div class="row"><span class="spacer"></span><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Add</button></div></form>`;
  document.body.append(dlg); dlg.showModal();
  const form = $('#pForm', dlg);
  form.image.onchange = () => {
    const f = form.image.files[0];
    if (f) $('#pImg', dlg).innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" style="max-height:140px;border-radius:8px">`;
  };
  dlg.onclose = async () => {
    const fd = new FormData(form);
    const announce = fd.get('announce');
    fd.delete('announce');
    if (!form.image.files[0]) fd.delete('image');
    dlg.remove();
    if (dlg.returnValue !== 'ok') return;
    try {
      const { product: p } = await sendForm(`/stores/${s.id}/products`, 'POST', fd);
      toast('Product added');
      if (announce && s.group_id && s.status === 'approved') {
        await api(`/conversations/${s.group_id}/messages`, { method: 'POST', body: { body: `🆕 New at ${s.name}: ${p.name}${p.price ? ' · ' + p.price : ''}${p.description ? '\n' + p.description : ''}\n${location.origin}/#/stores/${s.id}` } }).catch(() => {});
      }
      done();
    } catch (err) { toast(err.message, true); }
  };
}

// Small cards for the home screen shelf.
export async function storeShelf() {
  const list = await api('/stores?limit=10').catch(() => []);
  return list.map(storeCardHtml).join('');
}

export async function pendingStoresHtml() {
  const list = await api('/admin/stores/pending').catch(() => []);
  return `<h3 style="margin-top:24px">Stores waiting for review (${list.length})</h3>` + (list.length
    ? list.map((s) => `<div class="card" data-sid="${s.id}"><div class="row" style="align-items:flex-start;gap:12px">${logoHtml(s)}
        <div style="flex:1;min-width:0"><a class="item-title" href="#/stores/${s.id}">${esc(s.name)}</a><div class="muted small">${s.category_icon} ${esc(s.category_label)} · by ${esc(s.owner_name)}${s.location ? ' · ' + esc(s.location) : ''} · ${plural(s.product_count, 'product')}</div>
        ${s.description ? `<div class="small" style="margin-top:4px">${esc(s.description)}</div>` : ''}</div></div>
        <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn small danger" data-ss="rejected">Reject</button><button class="btn small" data-ss="approved">Approve</button></div></div>`).join('')
    : '<div class="empty">No stores waiting.</div>');
}

