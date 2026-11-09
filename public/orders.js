// Shopping from member stores: cart, checkout, and order tracking for
// buyers and sellers.
import { api, esc, toast, state } from './app.js';
import { fmtMoney } from './countries.js';

const $ = (sel, el = document) => el.querySelector(sel);
const plural = (n, word) => `${n} ${n === 1 ? word : word + 's'}`;
const when = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------- cart (kept on this device, one cart per store) ----------
const CART_KEY = 'gb_cart';
const readCarts = () => { try { return JSON.parse(localStorage.getItem(CART_KEY) || '{}'); } catch { return {}; } };
const writeCarts = (c) => { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch {} };
export const getCart = (storeId) => readCarts()[storeId] || {};
function setQty(storeId, pid, qty) {
  const all = readCarts();
  const cart = all[storeId] || {};
  if (qty > 0) cart[pid] = Math.min(qty, 99); else delete cart[pid];
  if (Object.keys(cart).length) all[storeId] = cart; else delete all[storeId];
  writeCarts(all);
}
export const addToCart = (storeId, pid) => setQty(storeId, pid, (getCart(storeId)[pid] || 0) + 1);
const clearCart = (storeId) => { const all = readCarts(); delete all[storeId]; writeCarts(all); };

// Cart lines joined with the store's current products (gone or sold-out products drop out).
function cartLines(s) {
  const cart = getCart(s.id);
  return s.products.filter((p) => cart[p.id] && p.amount != null && p.in_stock).map((p) => ({ ...p, qty: cart[p.id] }));
}
const totalOf = (lines) => lines.reduce((n, l) => n + l.amount * l.qty, 0);

export function cartBarHtml(s) {
  const lines = cartLines(s);
  if (!lines.length) return '<div class="cart-bar" hidden></div>';
  const n = lines.reduce((a, l) => a + l.qty, 0);
  return `<a class="cart-bar" href="#/stores/${s.id}/checkout"><span>🛒 <b>${plural(n, 'item')}</b> · ${esc(fmtMoney(totalOf(lines), lines[0].currency))}</span><span class="go">Checkout ›</span></a>`;
}
export function wireCartBar() { /* the bar is a plain link */ }

// ---------- checkout ----------
const BUYER_KEY = 'gb_buyer';
const savedBuyer = () => { try { return JSON.parse(localStorage.getItem(BUYER_KEY) || '{}'); } catch { return {}; } };

export async function renderCheckout(view, storeId) {
  const s = await api('/stores/' + storeId);
  const draw = () => {
    const lines = cartLines(s);
    const cur = lines[0]?.currency || s.currency;
    const buyer = savedBuyer();
    const fulfil = [s.offers_delivery && ['delivery', '🚚 Deliver to me'], s.offers_pickup && ['pickup', '🏪 I will pick it up']].filter(Boolean);
    const pays = [['mobile', `📱 Pay now by M-Pesa / mobile money`], s.pay_on_delivery && ['on_delivery', '💵 Pay on delivery or pickup']].filter(Boolean);
    view.innerHTML = `<div class="page"><a href="#/stores/${s.id}" class="muted small" style="text-decoration:none">← ${esc(s.name)}</a>
      <h2 style="margin-top:6px">🛒 Your cart</h2>
      ${lines.length ? `<div class="card cart-lines">${lines.map((l) => `<div class="cart-line" data-pid="${l.id}">
          <div class="pimg sm">${l.image_url ? `<img src="${esc(l.image_url)}" alt="">` : '🛍️'}</div>
          <div style="flex:1;min-width:0"><b class="clamp2">${esc(l.name)}</b><div class="muted small">${esc(fmtMoney(l.amount, l.currency))} each</div>
            <div class="stepper"><button type="button" data-d="-1" aria-label="One less">−</button><span>${l.qty}</span><button type="button" data-d="1" aria-label="One more">+</button>
              <button type="button" class="linkish" data-d="x">Remove</button></div></div>
          <b class="nowrap">${esc(fmtMoney(l.amount * l.qty, l.currency))}</b></div>`).join('')}
        <div class="cart-total"><span>Total</span><b>${esc(fmtMoney(totalOf(lines), cur))}</b></div></div>
      <form class="card" id="coForm">
        <h3>How do you want it?</h3>
        <div class="choice">${fulfil.map(([v, l], i) => `<label><input type="radio" name="fulfilment" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        ${s.delivery_info ? `<p class="muted small" id="delInfo">🚚 ${esc(s.delivery_info)}</p>` : ''}
        <label class="field"><span>Your name</span><input type="text" name="buyer_name" maxlength="80" required value="${esc(buyer.name || state.user.display_name || '')}"></label>
        <label class="field"><span>Phone number</span><input type="tel" name="phone" maxlength="30" required value="${esc(buyer.phone || '')}" placeholder="e.g. 0712 345 678"></label>
        <label class="field" id="addrField"><span>Delivery address</span><textarea name="address" maxlength="300" placeholder="Town, estate, street, landmark…">${esc(buyer.address || '')}</textarea></label>
        <h3 style="margin-top:8px">Payment</h3>
        <div class="choice">${pays.map(([v, l], i) => `<label><input type="radio" name="payment_method" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <div id="payNow" class="pay-box">
          ${s.payment_info ? `<div>Send <b>${esc(fmtMoney(totalOf(lines), cur))}</b> to:<div class="pay-to">${esc(s.payment_info)}</div></div>` : '<div>The seller will send you payment details in chat after you order.</div>'}
          <label class="field" style="margin:10px 0 0"><span>Confirmation code from your payment message (you can also add it later)</span><input type="text" name="payment_ref" maxlength="40" placeholder="e.g. SJK3H7XQ2P" style="text-transform:uppercase"></label></div>
        <label class="field" style="margin-top:12px"><span>Note for the seller (optional)</span><input type="text" name="note" maxlength="500" placeholder="e.g. Please call when you arrive"></label>
        <button class="btn gold" style="width:100%" id="placeBtn">Place order · ${esc(fmtMoney(totalOf(lines), cur))}</button>
        <p class="muted small" style="margin-bottom:0">The seller confirms your order and you can follow it under 🧾 Orders. You'll also get updates in your chats.</p>
      </form>`
      : `<div class="empty">Your cart is empty.<br><br><a class="btn gold" href="#/stores/${s.id}" style="text-decoration:none">Browse ${esc(s.name)}</a></div>`}</div>`;
    if (!lines.length) return;
    $('.cart-lines', view).onclick = (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      const pid = Number(b.closest('[data-pid]').dataset.pid);
      const l = lines.find((x) => x.id === pid);
      setQty(s.id, pid, b.dataset.d === 'x' ? 0 : l.qty + Number(b.dataset.d));
      draw();
    };
    const form = $('#coForm');
    const sync = () => {
      $('#addrField').hidden = form.fulfilment.value !== 'delivery';
      if ($('#delInfo')) $('#delInfo').hidden = form.fulfilment.value !== 'delivery';
      form.address.required = form.fulfilment.value === 'delivery';
      $('#payNow').hidden = form.payment_method.value !== 'mobile';
    };
    form.onchange = sync; sync();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      body.items = lines.map((l) => ({ product_id: l.id, qty: l.qty }));
      const btn = $('#placeBtn'); btn.disabled = true;
      try {
        const { order } = await api(`/stores/${s.id}/orders`, { method: 'POST', body });
        try { localStorage.setItem(BUYER_KEY, JSON.stringify({ name: body.buyer_name, phone: body.phone, address: body.address || savedBuyer().address || '' })); } catch {}
        clearCart(s.id);
        toast('Order placed! The seller has been told.');
        location.hash = '#/orders/' + order.id;
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    };
  };
  draw();
}

// ---------- order lists ----------
const STATUS_CLASS = { placed: 'new', confirmed: 'ok', on_the_way: 'go', ready: 'go', delivered: 'done', picked_up: 'done', cancelled: 'bad' };
const statusPill = (o) => `<span class="ostatus ${STATUS_CLASS[o.status] || ''}">${esc(o.status_label)}</span>`;

function orderRow(o, seller) {
  return `<a class="order-row" href="#/orders/${o.id}">
    <div class="slogo">${o.store_logo_url ? `<img src="${esc(o.store_logo_url)}" alt="">` : '🛍️'}</div>
    <div style="flex:1;min-width:0"><div class="row" style="gap:6px"><b class="clamp1" style="flex:1">${seller ? esc(o.buyer_name) : esc(o.store_name)}</b>${statusPill(o)}</div>
      <div class="muted small">#${o.id} · ${plural(o.item_count, 'item')} · <b>${esc(o.total_text)}</b>${seller ? ' · ' + esc(o.store_name) : ''}</div>
      <div class="muted small">${when(o.created_at)} · ${o.fulfilment === 'pickup' ? '🏪 Pickup' : '🚚 Delivery'} · ${o.paid ? '✅ Paid' : o.payment_method === 'on_delivery' ? '💵 Pay on ' + (o.fulfilment === 'pickup' ? 'pickup' : 'delivery') : o.payment_ref ? '📱 Code sent' : '📱 Not paid yet'}</div></div></a>`;
}

export async function renderOrders(view, [sub] = []) {
  if (sub && /^\d+$/.test(sub)) return renderOrder(view, Number(sub));
  const seller = sub === 'seller';
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const store = params.get('store');
  const [summary, list] = await Promise.all([api('/orders/summary'), api(`/orders?role=${seller ? 'seller' : 'buyer'}${store ? '&store=' + store : ''}`)]);
  const open = list.filter((o) => !['delivered', 'picked_up', 'cancelled'].includes(o.status));
  const done = list.filter((o) => ['delivered', 'picked_up', 'cancelled'].includes(o.status));
  view.innerHTML = `<div class="page"><a href="#/stores" class="muted small" style="text-decoration:none">← Stores</a>
    <h2 style="margin-top:6px">🧾 Orders</h2>
    ${summary.stores ? `<nav class="seg"><a href="#/orders" class="${seller ? '' : 'active'}">🛍️ What I bought</a><a href="#/orders/seller" class="${seller ? 'active' : ''}">🧾 My store orders${summary.new_for_seller ? ` <span class="badge">${summary.new_for_seller}</span>` : ''}</a></nav>` : ''}
    ${store && list[0] ? `<p class="muted small">Showing orders for ${esc(list[0].store_name)}. <a href="#/orders/seller">Show all my stores</a></p>` : ''}
    ${list.length ? `${open.length ? `<h3>Open (${open.length})</h3><div class="card order-list">${open.map((o) => orderRow(o, seller)).join('')}</div>` : ''}
      ${done.length ? `<h3>Finished</h3><div class="card order-list">${done.map((o) => orderRow(o, seller)).join('')}</div>` : ''}`
      : `<div class="empty">${seller ? 'No orders yet. Share your store link so people can find it.' : 'You have not ordered anything yet.'}<br><br><a class="btn gold" href="${seller ? '#/stores/mine' : '#/stores'}" style="text-decoration:none">${seller ? 'My stores' : 'Browse stores'}</a></div>`}</div>`;
}

// ---------- one order ----------
function trackerHtml(o) {
  const steps = o.fulfilment === 'pickup' ? ['placed', 'confirmed', 'ready', 'picked_up'] : ['placed', 'confirmed', 'on_the_way', 'delivered'];
  const labels = { placed: 'Placed', confirmed: 'Confirmed', on_the_way: 'On the way', ready: 'Ready', delivered: 'Delivered', picked_up: 'Picked up' };
  if (o.status === 'cancelled') return '<div class="tracker cancelled">❌ This order was cancelled.</div>';
  const at = steps.indexOf(o.status);
  return `<ol class="tracker">${steps.map((st, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><span class="dot">${i <= at ? '✓' : i + 1}</span><span class="lbl">${labels[st]}</span></li>`).join('')}</ol>`;
}

async function renderOrder(view, id) {
  const o = await api('/orders/' + id);
  const seller = o.role === 'seller' || o.role === 'staff';
  const otherId = o.role === 'buyer' ? o.owner_id : o.buyer_id;
  const payLine = o.paid ? '✅ Paid' : o.payment_method === 'on_delivery' ? `💵 Pays on ${o.fulfilment === 'pickup' ? 'pickup' : 'delivery'}` : o.payment_ref ? `📱 Mobile money, code <b>${esc(o.payment_ref)}</b> (waiting for the seller to check)` : '📱 Mobile money, not paid yet';
  view.innerHTML = `<div class="page"><a href="${seller ? '#/orders/seller' : '#/orders'}" class="muted small" style="text-decoration:none">← Orders</a>
    <div class="row" style="margin:6px 0 4px"><h2 style="flex:1;margin:0">Order #${o.id}</h2>${statusPill(o)}</div>
    <p class="muted small" style="margin-top:0">${seller ? `From <b>${esc(o.buyer_name)}</b>` : `From <a href="#/stores/${o.store_id}">${esc(o.store_name)}</a>`} · ${when(o.created_at)}</p>
    ${trackerHtml(o)}
    ${o.next.length ? `<div class="row wrap" style="margin:12px 0">${o.next.map((n) => `<button class="btn ${n.status === 'cancelled' ? 'ghost' : 'gold'}" data-status="${n.status}">${n.status === 'cancelled' ? (seller ? 'Decline / cancel' : 'Cancel order') : seller ? '→ ' + esc(n.label) : '✓ ' + esc(n.label)}</button>`).join('')}</div>` : ''}
    <div class="card"><h3>Items</h3>${o.items.map((i) => `<div class="cart-line"><div class="pimg sm">${i.image_url ? `<img src="${esc(i.image_url)}" alt="">` : '🛍️'}</div>
        <div style="flex:1;min-width:0"><b class="clamp2">${esc(i.name)}</b><div class="muted small">${i.qty} × ${esc(i.unit_text)}</div></div><b class="nowrap">${esc(i.line_text)}</b></div>`).join('')}
      <div class="cart-total"><span>Total</span><b>${esc(o.total_text)}</b></div></div>
    <div class="card"><h3>${o.fulfilment === 'pickup' ? '🏪 Pickup' : '🚚 Delivery'}</h3>
      <div><b>${esc(o.buyer_name)}</b> · <a href="tel:${esc(o.phone.replace(/[\s-]/g, ''))}">${esc(o.phone)}</a></div>
      ${o.fulfilment === 'delivery' ? `<div style="white-space:pre-wrap">${esc(o.address)}</div>` : ''}
      ${o.note ? `<div class="muted small" style="margin-top:6px">📝 ${esc(o.note)}</div>` : ''}
      ${o.delivery_info && o.fulfilment === 'delivery' ? `<div class="muted small" style="margin-top:6px">${esc(o.delivery_info)}</div>` : ''}</div>
    <div class="card"><h3>💳 Payment</h3><div>${payLine}</div>
      ${o.role === 'buyer' && !o.paid && o.status !== 'cancelled' ? `
        ${o.payment_info ? `<div class="pay-box" style="margin-top:10px">Send <b>${esc(o.total_text)}</b> to:<div class="pay-to">${esc(o.payment_info)}</div></div>` : ''}
        <form class="row" id="refForm" style="margin-top:10px"><input type="text" name="payment_ref" maxlength="40" placeholder="Payment confirmation code" style="text-transform:uppercase" value="${esc(o.payment_ref)}"><button class="btn small">${o.payment_ref ? 'Update' : 'Send code'}</button></form>` : ''}
      ${seller && o.status !== 'cancelled' ? `<div style="margin-top:10px"><button class="btn small ${o.paid ? 'ghost' : ''}" id="paidBtn" data-paid="${o.paid ? 0 : 1}">${o.paid ? 'Mark as not paid' : '💰 I received the money'}</button></div>` : ''}</div>
    <button class="btn ghost" id="chatBtn" style="width:100%">✉️ Message the ${o.role === 'buyer' ? 'seller' : 'buyer'}</button>
    <h3 style="margin-top:20px">History</h3>
    <ul class="timeline">${o.events.map((e) => `<li><b>${esc(e.label)}</b> <span class="muted small">· ${when(e.created_at)}${e.by_name ? ' · ' + esc(e.by_name) : ''}</span>${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}</li>`).join('')}</ul></div>`;

  view.querySelectorAll('[data-status]').forEach((b) => (b.onclick = async () => {
    let note = '';
    if (b.dataset.status === 'cancelled') {
      note = prompt(seller ? 'Why are you declining this order? The buyer will see this.' : 'Why are you cancelling? (optional)');
      if (note === null) return;
    }
    try { await api(`/orders/${id}/status`, { method: 'POST', body: { status: b.dataset.status, note } }); toast('Updated. They have been told in chat.'); renderOrder(view, id); }
    catch (err) { toast(err.message, true); }
  }));
  const rf = $('#refForm');
  if (rf) rf.onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/orders/${id}/payment`, { method: 'POST', body: Object.fromEntries(new FormData(rf)) }); toast('Code sent to the seller'); renderOrder(view, id); }
    catch (err) { toast(err.message, true); }
  };
  const pb = $('#paidBtn');
  if (pb) pb.onclick = async () => {
    await api(`/orders/${id}/payment`, { method: 'POST', body: { paid: pb.dataset.paid === '1' } }); toast('Saved'); renderOrder(view, id);
  };
  $('#chatBtn').onclick = async () => {
    const { id: cid } = await api('/conversations', { method: 'POST', body: { user_ids: [otherId] } });
    location.hash = '#/chats/' + cid;
  };
}
