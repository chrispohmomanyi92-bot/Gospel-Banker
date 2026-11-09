// Ordering from member stores: a cart becomes an order, the seller confirms it,
// sends it and marks it delivered, and both sides follow it on a tracking page.
// Buyer and seller are told about every step in their chat.
import { db } from './db.js';
import { fmtMoney } from '../public/countries.js';
import { addColumn } from './videos.js';

export const STATUS_LABEL = {
  placed: 'Order placed', confirmed: 'Confirmed by seller', on_the_way: 'On the way', ready: 'Ready for pickup',
  delivered: 'Delivered', picked_up: 'Picked up', cancelled: 'Cancelled', paid: 'Payment received', unpaid: 'Marked as not paid',
};
const MAX_ITEMS = 50;
const MAX_QTY = 99;

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'placed',          -- placed | confirmed | on_the_way | ready | delivered | picked_up | cancelled
  fulfilment TEXT NOT NULL DEFAULT 'delivery',    -- delivery | pickup
  payment_method TEXT NOT NULL DEFAULT 'mobile',  -- mobile (M-Pesa etc., paid now) | on_delivery
  payment_ref TEXT NOT NULL DEFAULT '',           -- e.g. the M-Pesa confirmation code
  paid INTEGER NOT NULL DEFAULT 0,                -- set by the seller once the money is received
  buyer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, id);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES store_products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  image TEXT,
  unit_price REAL NOT NULL,
  qty INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  by_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
addColumn('orders', 'delivery_fee', 'REAL NOT NULL DEFAULT 0');
addColumn('order_items', 'unit', "TEXT NOT NULL DEFAULT ''");

// Delivery fee for an order of this size (free from the store's threshold).
export const deliveryFee = (s, subtotal) => (s.free_delivery_from != null && subtotal >= s.free_delivery_from ? 0 : s.delivery_fee || 0);

// What each side may move an order to, from each status.
const SELLER_NEXT = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['on_the_way', 'ready', 'cancelled'],
  on_the_way: ['delivered'],
  ready: ['picked_up'],
};
const BUYER_NEXT = { placed: ['cancelled'], on_the_way: ['delivered'], ready: ['picked_up'] };

export function registerOrderRoutes(app, { auth, isStaff, screen, directMessage }) {
  const q = (sql) => db.prepare(sql);
  const SELECT = `SELECT o.*, s.name AS store_name, s.owner_id, s.logo AS store_logo, s.payment_info, s.delivery_info, s.pickup_info, s.location AS store_location, s.pay_on_delivery AS store_pay_on_delivery,
      u.display_name AS buyer_display_name,
      (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id) AS item_count
    FROM orders o JOIN stores s ON s.id = o.store_id JOIN users u ON u.id = o.buyer_id`;
  const shape = (o) => o && ({ ...o, status_label: STATUS_LABEL[o.status] || o.status, total_text: fmtMoney(o.total, o.currency), store_logo_url: o.store_logo ? `/media/stores/${o.store_logo}` : null });
  const getOrder = (id) => q(`${SELECT} WHERE o.id = ?`).get(Number(id));
  const roleIn = (o, user) => (o.buyer_id === user.id ? 'buyer' : o.owner_id === user.id ? 'seller' : isStaff(user) ? 'staff' : null);
  // Full address of an order page, so it shows as a link in chat.
  const base = (req) => process.env.PUBLIC_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
  const link = (req, id) => `${base(req)}/#/orders/${id}`;
  const itemsText = (items, currency) => items.map((i) => `• ${i.qty} × ${i.name} (${fmtMoney(i.amount * i.qty, currency)})`).join('\n');
  const tell = (from, toId, text) => directMessage(from, toId, text).catch((e) => console.error('order message failed', e));

  app.post('/api/stores/:id/orders', auth, async (req, res) => {
    const s = q('SELECT * FROM stores WHERE id = ?').get(Number(req.params.id));
    if (!s || s.status !== 'approved') return res.status(404).json({ error: 'This store is not open for orders.' });
    if (s.owner_id === req.user.id) return res.status(400).json({ error: "You can't order from your own store." });
    const b = req.body || {};
    const wanted = Array.isArray(b.items) ? b.items.slice(0, MAX_ITEMS) : [];
    const items = [];
    for (const w of wanted) {
      const qty = Math.floor(Number(w.qty));
      if (!(qty >= 1 && qty <= MAX_QTY)) return res.status(400).json({ error: `Quantities must be between 1 and ${MAX_QTY}.` });
      const p = q('SELECT * FROM store_products WHERE id = ? AND store_id = ?').get(Number(w.product_id), s.id);
      if (!p) return res.status(400).json({ error: 'A product in your cart is no longer sold. Please check your cart.' });
      if (p.amount == null) return res.status(400).json({ error: `"${p.name}" has no price yet. Message the seller about it.` });
      if (!p.in_stock) return res.status(400).json({ error: `"${p.name}" is sold out. Please remove it from your cart.` });
      items.push({ ...p, qty });
    }
    if (!items.length) return res.status(400).json({ error: 'Your cart is empty.' });
    const currency = items[0].currency;
    if (items.some((i) => i.currency !== currency)) return res.status(400).json({ error: 'These products are priced in different currencies. Please order them separately.' });

    const fulfilment = b.fulfilment === 'pickup' ? 'pickup' : 'delivery';
    if (fulfilment === 'delivery' && !s.offers_delivery) return res.status(400).json({ error: 'This store only offers pickup.' });
    if (fulfilment === 'pickup' && !s.offers_pickup) return res.status(400).json({ error: 'This store only delivers.' });
    // Paid last at checkout: mobile money (with the confirmation code) or on delivery / pickup.
    const payment = b.payment_method === 'on_delivery' && s.pay_on_delivery ? 'on_delivery' : 'mobile';
    const name = clean(b.buyer_name, 80);
    const phone = clean(b.phone, 30);
    const address = clean(b.address, 300);
    const note = clean(b.note, 500);
    const ref = clean(b.payment_ref, 40).toUpperCase();
    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (!/^\+?[\d\s-]{7,20}$/.test(phone)) return res.status(400).json({ error: 'Please enter a phone number the seller can call.' });
    if (fulfilment === 'delivery' && !address) return res.status(400).json({ error: 'Please enter where to deliver.' });
    const v = await screen(req.user, `${name}\n${address}\n${note}`, 'order');
    if (!v.allowed || v.flagged) return res.status(422).json({ error: v.reason || 'Please keep your order details respectful.' });

    const subtotal = items.reduce((n, i) => n + i.amount * i.qty, 0);
    const fee = fulfilment === 'delivery' ? deliveryFee(s, subtotal) : 0;
    const total = subtotal + fee;
    const order = q(`INSERT INTO orders (store_id, buyer_id, fulfilment, payment_method, payment_ref, buyer_name, phone, address, note, total, currency, delivery_fee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(s.id, req.user.id, fulfilment, payment, ref, name, phone, address, note, total, currency, fee);
    const addItem = q('INSERT INTO order_items (order_id, product_id, name, image, unit_price, qty, unit) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const i of items) addItem.run(order.id, i.id, i.name, i.image, i.amount, i.qty, i.unit || '');
    q('INSERT INTO order_events (order_id, status, by_id) VALUES (?, ?, ?)').run(order.id, 'placed', req.user.id);

    tell(req.user, s.owner_id, `🧾 New order #${order.id} for ${s.name}\n${itemsText(items, currency)}\n${fee ? 'Delivery: ' + fmtMoney(fee, currency) + '\n' : ''}Total: ${fmtMoney(total, currency)}\n`
      + `${fulfilment === 'pickup' ? '🏪 Pickup' : '🚚 Deliver to: ' + address}\n📞 ${name}, ${phone}\n`
      + `💳 ${payment === 'on_delivery' ? 'Pays on ' + (fulfilment === 'pickup' ? 'pickup' : 'delivery') : ref ? 'Paid by mobile money, code ' + ref : 'Not paid yet'}`
      + `${note ? '\n📝 ' + note : ''}\nConfirm it here: ${link(req, order.id)}`);
    res.json({ order: shape(getOrder(order.id)) });
  });

  app.get('/api/orders', auth, (req, res) => {
    const seller = req.query.role === 'seller';
    const rows = q(`${SELECT} WHERE ${seller ? 's.owner_id = ?' : 'o.buyer_id = ?'} ${req.query.store ? 'AND o.store_id = ?' : ''} ORDER BY o.id DESC LIMIT 200`)
      .all(req.user.id, ...(req.query.store ? [Number(req.query.store)] : []));
    res.json(rows.map(shape));
  });

  // How many orders are waiting for the seller, for badges.
  app.get('/api/orders/summary', auth, (req, res) => {
    const r = q(`SELECT
        (SELECT COUNT(*) FROM orders o JOIN stores s ON s.id = o.store_id WHERE s.owner_id = ? AND o.status = 'placed') AS new_for_seller,
        (SELECT COUNT(*) FROM orders o JOIN stores s ON s.id = o.store_id WHERE s.owner_id = ? AND o.status IN ('placed','confirmed','on_the_way','ready')) AS open_for_seller,
        (SELECT COUNT(*) FROM orders WHERE buyer_id = ? AND status IN ('placed','confirmed','on_the_way','ready')) AS open_for_buyer,
        (SELECT COUNT(*) FROM stores WHERE owner_id = ?) AS stores`).get(req.user.id, req.user.id, req.user.id, req.user.id);
    res.json(r);
  });

  app.get('/api/orders/:id', auth, (req, res) => {
    const o = getOrder(req.params.id);
    const role = o && roleIn(o, req.user);
    if (!role) return res.status(404).json({ error: 'Order not found.' });
    const items = q('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(o.id)
      .map((i) => ({ ...i, image_url: i.image ? `/media/stores/${i.image}` : null, line_text: fmtMoney(i.unit_price * i.qty, o.currency), unit_text: fmtMoney(i.unit_price, o.currency) }));
    const events = q(`SELECT e.*, u.display_name AS by_name FROM order_events e LEFT JOIN users u ON u.id = e.by_id WHERE order_id = ? ORDER BY e.id`).all(o.id)
      .map((e) => ({ ...e, label: STATUS_LABEL[e.status] || e.status }));
    const next = (role === 'seller' ? SELLER_NEXT : role === 'buyer' ? BUYER_NEXT : {})[o.status] || [];
    const allowed = next.filter((st) => (o.fulfilment === 'pickup' ? st !== 'on_the_way' : st !== 'ready'));
    res.json({ ...shape(o), role, items, events, pay_on_delivery: Boolean(o.store_pay_on_delivery), delivery_fee_text: o.delivery_fee ? fmtMoney(o.delivery_fee, o.currency) : '',
      subtotal_text: fmtMoney(o.total - (o.delivery_fee || 0), o.currency), next: allowed.map((st) => ({ status: st, label: STATUS_LABEL[st] })) });
  });

  app.post('/api/orders/:id/status', auth, (req, res) => {
    const o = getOrder(req.params.id);
    const role = o && roleIn(o, req.user);
    if (!role) return res.status(404).json({ error: 'Order not found.' });
    const status = req.body?.status;
    const note = clean(req.body?.note, 300);
    const allowed = ((role === 'seller' ? SELLER_NEXT : role === 'buyer' ? BUYER_NEXT : {})[o.status] || [])
      .filter((st) => (o.fulfilment === 'pickup' ? st !== 'on_the_way' : st !== 'ready'));
    if (!allowed.includes(status)) return res.status(400).json({ error: 'That step is not possible for this order now.' });
    q(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, o.id);
    q('INSERT INTO order_events (order_id, status, by_id, note) VALUES (?, ?, ?, ?)').run(o.id, status, req.user.id, note);
    const icon = { confirmed: '✅', on_the_way: '🚚', ready: '🏪', delivered: '📦', picked_up: '📦', cancelled: '❌' }[status] || '🧾';
    const other = role === 'seller' ? o.buyer_id : o.owner_id;
    tell(req.user, other, `${icon} Order #${o.id} from ${o.store_name}: ${STATUS_LABEL[status]}${note ? '\n' + note : ''}\n${link(req, o.id)}`);
    res.json({ ok: true });
  });

  // Buyer adds the mobile money code; seller confirms the money arrived.
  app.post('/api/orders/:id/payment', auth, (req, res) => {
    const o = getOrder(req.params.id);
    const role = o && roleIn(o, req.user);
    if (!role) return res.status(404).json({ error: 'Order not found.' });
    if (role === 'buyer') {
      const ref = clean(req.body?.payment_ref, 40).toUpperCase();
      if (!ref) return res.status(400).json({ error: 'Enter the confirmation code from your payment message.' });
      q(`UPDATE orders SET payment_ref = ?, payment_method = 'mobile', updated_at = datetime('now') WHERE id = ?`).run(ref, o.id);
      tell(req.user, o.owner_id, `💳 Payment sent for order #${o.id}: code ${ref}. Please check and mark it paid.\n${link(req, o.id)}`);
      return res.json({ ok: true });
    }
    if (role !== 'seller') return res.status(403).json({ error: 'Not allowed.' });
    const paid = req.body?.paid ? 1 : 0;
    q(`UPDATE orders SET paid = ?, updated_at = datetime('now') WHERE id = ?`).run(paid, o.id);
    q('INSERT INTO order_events (order_id, status, by_id) VALUES (?, ?, ?)').run(o.id, paid ? 'paid' : 'unpaid', req.user.id);
    if (paid) tell(req.user, o.buyer_id, `💰 Payment received for order #${o.id} from ${o.store_name}. Thank you!\n${link(req, o.id)}`);
    res.json({ ok: true });
  });
}
