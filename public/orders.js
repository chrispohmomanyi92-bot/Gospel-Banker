// Shopping from member stores, the way a shop counter works: add products to
// your order, choose pickup or delivery, leave your details, and the shop
// confirms. Buyers and sellers then follow the order on its own page.
import { api, esc, toast, state } from './app.js';
import { fmtMoney, dialOptions, dialFor, fullPhone } from './countries.js';

const $ = (sel, el = document) => el.querySelector(sel);
const plural = (n, word) => `${n} ${n === 1 ? word : word + 's'}`;
const when = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------- the order being put together (kept on this device, one per store) ----------
const CART_KEY = 'gb_cart';
const readCarts = () => { try { return JSON.parse(localStorage.getItem(CART_KEY) || '{}'); } catch { return {}; } };
const writeCarts = (c) => { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch {} };
export const getCart = (storeId) => readCarts()[storeId] || {};
export function setQty(storeId, pid, qty) {
  const all = readCarts();
  const cart = all[storeId] || {};
  if (qty > 0) cart[pid] = Math.min(qty, 99); else delete cart[pid];
  if (Object.keys(cart).length) all[storeId] = cart; else delete all[storeId];
  writeCarts(all);
}
const clearCart = (storeId) => { const all = readCarts(); delete all[storeId]; writeCarts(all); };

// Order lines joined with the store's current products (gone or sold-out products drop out).
function cartLines(s) {
  const cart = getCart(s.id);
  return s.products.filter((p) => cart[p.id] && p.amount != null && p.in_stock).map((p) => ({ ...p, qty: cart[p.id] }));
}
const totalOf = (lines) => lines.reduce((n, l) => n + l.amount * l.qty, 0);
const countOf = (lines) => lines.reduce((n, l) => n + l.qty, 0);
export const perUnit = (p) => (p.unit ? ` per ${p.unit}` : '');

// Delivery fee for this order (same rule as the server).
const feeFor = (s, subtotal) => (s.free_delivery_from != null && subtotal >= s.free_delivery_from ? 0 : s.delivery_fee || 0);
const pickupPlace = (s) => s.pickup_info || s.location || "the seller's place";
function deliveryHint(s, cur) {
  if (!s.delivery_fee) return 'Free';
  const fee = fmtMoney(s.delivery_fee, cur);
  return s.free_delivery_from != null ? `${fee} · Free ≥ ${fmtMoney(s.free_delivery_from, cur)}` : fee;
}

// "3 · KSh 3,000   [View order]" along the bottom of the store page.
export function orderBarHtml(s) {
  const lines = cartLines(s);
  if (!lines.length) return '<div class="cart-bar" hidden></div>';
  return `<div class="cart-bar"><span><b>${countOf(lines)}</b> · ${esc(fmtMoney(totalOf(lines), lines[0].currency))}</span><button type="button" class="go" data-view-order>View order</button></div>`;
}

// ---------- the order sheet: "Your order", then "Your details" ----------
const BUYER_KEY = 'gb_buyer';
const savedBuyer = () => { try { return JSON.parse(localStorage.getItem(BUYER_KEY) || '{}'); } catch { return {}; } };

// onChange runs whenever quantities change, so the store page can redraw its buttons.
export function openOrderSheet(s, onChange = () => {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  document.body.append(dlg);
  const buyer = savedBuyer();
  const ways = [s.offers_pickup && 'pickup', s.offers_delivery && 'delivery'].filter(Boolean);
  const form = { fulfilment: buyer.fulfilment && ways.includes(buyer.fulfilment) ? buyer.fulfilment : ways[0],
    buyer_name: buyer.name || state.user.display_name || '', dial: buyer.dial || (dialFor(s.country) ? s.country : 'KE'),
    phone: buyer.phone || '', address: buyer.address || '', note: '' };

  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  const sums = (lines) => {
    const cur = lines[0]?.currency || s.currency;
    const items = totalOf(lines);
    const fee = form.fulfilment === 'delivery' ? feeFor(s, items) : 0;
    return { cur, items, fee, total: items + fee };
  };
  const totalsHtml = (lines) => {
    const t = sums(lines);
    return `<div class="sum-row"><span>Items</span><span>${esc(fmtMoney(t.items, t.cur))}</span></div>
      <div class="sum-row"><span>${form.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</span><span>${form.fulfilment === 'pickup' ? '—' : t.fee ? esc(fmtMoney(t.fee, t.cur)) : 'Free'}</span></div>
      <div class="sum-row total"><span>Total</span><b>${esc(fmtMoney(t.total, t.cur))}</b></div>`;
  };
  const head = (title) => `<div class="sheet-head"><h3>${title}</h3><button type="button" class="iconbtn" data-close aria-label="Close">✕</button></div>`;

  const drawOrder = () => {
    const lines = cartLines(s);
    if (!lines.length) { close(); return; }
    const t = sums(lines);
    const more = form.fulfilment === 'delivery' && t.fee && s.free_delivery_from != null ? s.free_delivery_from - t.items : 0;
    dlg.innerHTML = `${head('Your order')}
      <div class="eyebrow">How do you want to receive it?</div>
      <div class="ways">${ways.map((w) => `<label class="way ${form.fulfilment === w ? 'on' : ''}"><input type="radio" name="fulfilment" value="${w}" ${form.fulfilment === w ? 'checked' : ''}>
        <span class="way-ico">${w === 'pickup' ? '🏪' : '🚚'}</span><span><b>${w === 'pickup' ? 'Pickup' : 'Delivery'}</b>
        <span class="muted small">${w === 'pickup' ? 'Collect at ' + esc(pickupPlace(s)) : 'We bring it to you · ' + esc(deliveryHint(s, t.cur))}</span></span></label>`).join('')}</div>
      ${form.fulfilment === 'delivery' && s.delivery_info ? `<p class="muted small" style="margin:-4px 0 8px">🚚 ${esc(s.delivery_info)}</p>` : ''}
      <div class="sheet-lines">${lines.map((l) => `<div class="cart-line" data-pid="${l.id}">
          <div class="pimg sm">${l.image_url ? `<img src="${esc(l.image_url)}" alt="">` : '🛍️'}</div>
          <div style="flex:1;min-width:0"><b class="clamp2">${esc(l.name)}</b><div class="muted small">${esc(fmtMoney(l.amount, l.currency))}${esc(perUnit(l))}</div>
            <div class="stepper"><button type="button" data-d="-1" aria-label="One less">−</button><span>${l.qty}</span><button type="button" data-d="1" aria-label="One more">+</button>
              <button type="button" class="remove" data-d="x">Remove</button></div></div>
          <b class="nowrap">${esc(fmtMoney(l.amount * l.qty, l.currency))}</b></div>`).join('')}</div>
      <div class="sums">${totalsHtml(lines)}</div>
      ${more > 0 ? `<p class="muted small" style="margin:6px 0 0">Add ${esc(fmtMoney(more, t.cur))} more for free delivery.</p>` : ''}
      <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Continue shopping</button><button type="button" class="btn gold" id="toDetails">Continue</button></div>`;
    dlg.querySelectorAll('input[name=fulfilment]').forEach((r) => (r.onchange = () => { form.fulfilment = r.value; drawOrder(); }));
    $('.sheet-lines', dlg).onclick = (e) => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      const pid = Number(b.closest('[data-pid]').dataset.pid);
      const l = lines.find((x) => x.id === pid);
      setQty(s.id, pid, b.dataset.d === 'x' ? 0 : l.qty + Number(b.dataset.d));
      onChange();
      drawOrder();
    };
    $('#toDetails', dlg).onclick = () => drawDetails();
  };

  const drawDetails = () => {
    const lines = cartLines(s);
    if (!lines.length) { close(); return; }
    const t = sums(lines);
    const delivery = form.fulfilment === 'delivery';
    dlg.innerHTML = `${head('Your details')}
      <form id="detailsForm">
        <label class="field"><span>Your name *</span><input type="text" name="buyer_name" maxlength="80" required value="${esc(form.buyer_name)}" autocomplete="name"></label>
        <div class="field"><span>Phone number *</span><div class="phone-row"><select name="dial" aria-label="Country code">${dialOptions(form.dial)}</select>
          <input type="tel" name="phone" maxlength="20" required value="${esc(form.phone)}" placeholder="712 345 678" autocomplete="tel-national" aria-label="Phone number"></div></div>
        ${delivery ? `<label class="field"><span>Delivery address *</span><textarea name="address" maxlength="300" required placeholder="Town, estate, street, landmark…">${esc(form.address)}</textarea></label>` : ''}
        <label class="field"><span>Note for the shop (optional)</span><textarea name="note" maxlength="500" rows="2" placeholder="Sizes, colour, best time to call…">${esc(form.note)}</textarea></label>
        <div class="check-box"><div class="eyebrow">Check your order · ${delivery ? 'Delivery' : 'Pickup'}</div>
          ${lines.map((l) => `<div class="sum-row"><span>${esc(l.name)} × ${l.qty}</span><span>${esc(fmtMoney(l.amount * l.qty, l.currency))}</span></div>`).join('')}
          <div class="muted small" style="margin:4px 0 8px">Quantity: ${countOf(lines)}${delivery ? '' : ` · Collect at ${esc(pickupPlace(s))}`}</div>
          ${totalsHtml(lines)}</div>
        <div class="sheet-actions"><button type="button" class="btn ghost" id="backBtn">Back</button><button class="btn gold">Continue to pay</button></div>
      </form>`;
    const f = $('#detailsForm', dlg);
    const keep = () => Object.assign(form, { buyer_name: f.buyer_name.value, dial: f.dial.value, phone: f.phone.value, note: f.note.value, ...(f.address ? { address: f.address.value } : {}) });
    $('#backBtn', dlg).onclick = () => { keep(); drawOrder(); };
    f.onsubmit = (e) => { e.preventDefault(); keep(); drawPay(); };
  };

  // Last step: pay by mobile money now (with the confirmation code), or on delivery / pickup.
  const drawPay = () => {
    const lines = cartLines(s);
    if (!lines.length) { close(); return; }
    const t = sums(lines);
    const delivery = form.fulfilment === 'delivery';
    const total = esc(fmtMoney(t.total, t.cur));
    const methods = [['mobile', '📱', 'M-Pesa / mobile money', 'Pay now and enter the confirmation code']];
    if (s.pay_on_delivery) methods.push(['on_delivery', '💵', `Pay on ${delivery ? 'delivery' : 'pickup'}`, `Pay when you ${delivery ? 'receive it' : 'collect it'}`]);
    if (!methods.some((m) => m[0] === form.payment_method)) form.payment_method = methods[0][0];
    const mobile = form.payment_method === 'mobile';
    dlg.innerHTML = `${head('Pay')}
      <form id="payForm">
        <div class="pay-total"><span class="muted small">Amount to pay</span><b>${total}</b><span class="muted small">${plural(countOf(lines), 'item')} · ${delivery ? 'Delivery' : 'Pickup'}</span></div>
        <div class="eyebrow">How do you want to pay?</div>
        <div class="ways">${methods.map(([v, ico, label, hint]) => `<label class="way ${form.payment_method === v ? 'on' : ''}"><input type="radio" name="payment_method" value="${v}" ${form.payment_method === v ? 'checked' : ''}>
          <span class="way-ico">${ico}</span><span><b>${label}</b><span class="muted small">${hint}</span></span></label>`).join('')}</div>
        ${mobile ? `<div class="pay-box">
            ${s.payment_info ? `<div>1. Send <b>${total}</b> to:</div><div class="pay-to">${esc(s.payment_info)}</div>
              <div style="margin-top:8px">2. Enter the confirmation code from your payment message:</div>`
              : `<div>${esc(s.name)} will send you their payment number in chat. You can add the confirmation code on your order page.</div>`}
            <input type="text" name="payment_ref" maxlength="40" ${s.payment_info ? 'required' : ''} placeholder="e.g. SJK3H7XQ2P" value="${esc(form.payment_ref || '')}" style="text-transform:uppercase;margin-top:8px" aria-label="Confirmation code"></div>`
          : `<p class="muted small">Have <b>${total}</b> ready when you ${delivery ? 'receive your order' : 'collect your order'}.</p>`}
        <div class="sheet-actions"><button type="button" class="btn ghost" id="backBtn">Back</button><button class="btn gold" id="submitBtn">${mobile && s.payment_info ? 'Pay' : 'Submit order'} · ${total}</button></div>
      </form>`;
    const f = $('#payForm', dlg);
    const keep = () => { form.payment_ref = f.payment_ref ? f.payment_ref.value.trim() : form.payment_ref; };
    dlg.querySelectorAll('input[name=payment_method]').forEach((r) => (r.onchange = () => { keep(); form.payment_method = r.value; drawPay(); }));
    $('#backBtn', dlg).onclick = () => { keep(); drawDetails(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      keep();
      const btn = $('#submitBtn', dlg); btn.disabled = true;
      const body = { fulfilment: form.fulfilment, buyer_name: form.buyer_name, phone: fullPhone(form.dial, form.phone), address: delivery ? form.address : '',
        note: form.note, payment_method: form.payment_method, payment_ref: form.payment_method === 'mobile' ? form.payment_ref : '',
        items: lines.map((l) => ({ product_id: l.id, qty: l.qty })) };
      try {
        const { order } = await api(`/stores/${s.id}/orders`, { method: 'POST', body });
        try { localStorage.setItem(BUYER_KEY, JSON.stringify({ name: form.buyer_name, dial: form.dial, phone: form.phone, address: form.address, fulfilment: form.fulfilment })); } catch {}
        clearCart(s.id);
        close();
        toast(`Order sent to ${s.name}`);
        location.hash = '#/orders/' + order.id;
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    };
  };

  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  drawOrder();
  dlg.showModal();
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
        <div style="flex:1;min-width:0"><b class="clamp2">${esc(i.name)}</b><div class="muted small">${i.qty} × ${esc(i.unit_text)}${i.unit ? ' per ' + esc(i.unit) : ''}</div></div><b class="nowrap">${esc(i.line_text)}</b></div>`).join('')}
      <div class="sums"><div class="sum-row"><span>Items</span><span>${esc(o.subtotal_text)}</span></div>
        <div class="sum-row"><span>${o.fulfilment === 'pickup' ? 'Pickup' : 'Delivery'}</span><span>${o.fulfilment === 'pickup' ? '—' : o.delivery_fee ? esc(o.delivery_fee_text) : 'Free'}</span></div>
        <div class="sum-row total"><span>Total</span><b>${esc(o.total_text)}</b></div></div></div>
    <div class="card"><h3>${o.fulfilment === 'pickup' ? '🏪 Pickup' : '🚚 Delivery'}</h3>
      <div><b>${esc(o.buyer_name)}</b> · <a href="tel:${esc(o.phone.replace(/[\s-]/g, ''))}">${esc(o.phone)}</a></div>
      ${o.fulfilment === 'delivery' ? `<div style="white-space:pre-wrap">${esc(o.address)}</div>` : `<div>Collect at <b>${esc(o.pickup_info || o.store_location || "the seller's place")}</b></div>`}
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
