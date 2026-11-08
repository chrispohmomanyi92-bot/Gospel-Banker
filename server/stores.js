// Member stores: any member can open a store, list products, and run a
// promotion group (a group chat that shoppers can join).
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { db } from './db.js';
import { addColumn } from './videos.js';
import { isCountry } from '../public/countries.js';

export const STORE_CATEGORIES = [
  { key: 'books', label: 'Books & Bibles', icon: '📚' },
  { key: 'health-foods', label: 'Health Foods', icon: '🥗' },
  { key: 'bakery', label: 'Bakery & Vegetarian Meals', icon: '🍞' },
  { key: 'farm', label: 'Farm Produce', icon: '🌽' },
  { key: 'remedies', label: 'Natural Remedies', icon: '🌿' },
  { key: 'clothing', label: 'Modest Clothing', icon: '👗' },
  { key: 'music', label: 'Music & Media', icon: '🎵' },
  { key: 'crafts', label: 'Crafts & Gifts', icon: '🎁' },
  { key: 'pathfinders', label: 'Pathfinder & Children', icon: '⛺' },
  { key: 'education', label: 'Education & Tutoring', icon: '🎓' },
  { key: 'services', label: 'Services', icon: '🛠️' },
  { key: 'other', label: 'Other', icon: '🛍️' },
];
const CAT_KEYS = new Set(STORE_CATEGORIES.map((c) => c.key));
const MAX_STORES_PER_MEMBER = 3;
const MAX_PRODUCTS = 200;

db.exec(`
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',             -- phone, WhatsApp, M-Pesa till, email
  logo TEXT,
  group_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stores_cat ON stores(status, category, id);
CREATE TABLE IF NOT EXISTS store_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  image TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_store ON store_products(store_id, id);
`);
// Lets a chat show which store its group belongs to.
addColumn('conversations', 'store_id', 'INTEGER');
addColumn('stores', 'country', "TEXT NOT NULL DEFAULT ''"); // two-letter code, e.g. KE

const STORE_DIR = join(resolve(process.env.MEDIA_DIR || './data/media'), 'stores');
mkdirSync(STORE_DIR, { recursive: true });
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const imageUpload = (field) => multer({
  storage: multer.diskStorage({
    destination: STORE_DIR,
    filename: (req, file, cb) => cb(null, randomBytes(16).toString('hex') + IMAGE_TYPES[file.mimetype]),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    const ok = file.fieldname === field && IMAGE_TYPES[file.mimetype];
    cb(ok ? null : new Error('Pictures must be JPG, PNG or WebP.'), Boolean(ok));
  },
}).single(field);
const removeImage = (name) => { if (name) try { unlinkSync(join(STORE_DIR, name)); } catch {} };
const clean = (v, max) => String(v ?? '').trim().slice(0, max);

export function registerStoreRoutes(app, { auth, staffOnly, screen, isStaff }) {
  const q = (sql) => db.prepare(sql);
  const SELECT = `SELECT s.*, u.display_name AS owner_name, u.username AS owner_username,
      (SELECT COUNT(*) FROM store_products p WHERE p.store_id = s.id) AS product_count,
      (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = s.group_id) AS group_members
    FROM stores s JOIN users u ON u.id = s.owner_id`;
  const catOf = (key) => STORE_CATEGORIES.find((c) => c.key === key);
  const shape = (s) => s && ({ ...s, logo_url: s.logo ? `/media/stores/${s.logo}` : null, category_label: catOf(s.category)?.label || s.category, category_icon: catOf(s.category)?.icon || '🛍️' });
  const shapeProduct = (p) => ({ ...p, image_url: p.image ? `/media/stores/${p.image}` : null });
  const canEdit = (s, user) => s.owner_id === user.id || isStaff(user);
  const canSee = (s, user) => s && (s.status === 'approved' || canEdit(s, user));
  const getStore = (id) => q(`${SELECT} WHERE s.id = ?`).get(Number(id));
  // Runs the upload, then the handler; removes the picture if the handler fails.
  const withImage = (field, handler) => (req, res) => imageUpload(field)(req, res, async (err) => {
    const fail = (status, error) => { removeImage(req.file?.filename); res.status(status).json({ error }); };
    if (err) return fail(400, err.code === 'LIMIT_FILE_SIZE' ? 'Pictures can be up to 8 MB.' : err.message);
    try { await handler(req, res, fail); } catch (e) { console.error(e); fail(500, 'Something went wrong.'); }
  });
  const checkText = async (user, text, fail) => {
    const v = await screen(user, text, 'store');
    if (!v.allowed || v.flagged) { fail(422, v.reason || 'Please keep your store respectful.'); return false; }
    return true;
  };
  const storeFields = (body) => ({
    name: clean(body.name, 80), category: body.category, description: clean(body.description, 3000),
    location: clean(body.location, 120), contact: clean(body.contact, 160), country: String(body.country || '').toUpperCase(),
  });

  app.get('/api/stores/categories', (req, res) => {
    const counts = Object.fromEntries(q(`SELECT category, COUNT(*) AS n FROM stores WHERE status = 'approved' GROUP BY category`).all().map((r) => [r.category, r.n]));
    res.json(STORE_CATEGORIES.map((c) => ({ ...c, count: counts[c.key] || 0 })));
  });

  // Countries that have stores, for the country filter.
  app.get('/api/stores/countries', auth, (req, res) => {
    res.json(q(`SELECT country AS code, COUNT(*) AS count FROM stores WHERE status = 'approved' AND country != '' GROUP BY country ORDER BY count DESC`).all());
  });

  app.get('/api/stores', auth, (req, res) => {
    const { category, q: term, owner, country } = req.query;
    const where = [];
    const args = [];
    if (owner) {
      where.push('s.owner_id = ?'); args.push(Number(owner));
      if (Number(owner) !== req.user.id && !isStaff(req.user)) where.push(`s.status = 'approved'`);
    } else where.push(`s.status = 'approved'`);
    if (category && CAT_KEYS.has(category)) { where.push('s.category = ?'); args.push(category); }
    if (country && isCountry(country)) { where.push('s.country = ?'); args.push(country); }
    if (term) {
      where.push(`(s.name LIKE ? OR s.description LIKE ? OR s.location LIKE ? OR EXISTS (SELECT 1 FROM store_products p WHERE p.store_id = s.id AND (p.name LIKE ? OR p.description LIKE ?)))`);
      args.push(...Array(5).fill(`%${term}%`));
    }
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    res.json(q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ${limit}`).all(...args).map(shape));
  });

  app.get('/api/stores/:id', auth, (req, res) => {
    const s = getStore(req.params.id);
    if (!canSee(s, req.user)) return res.status(404).json({ error: 'Store not found.' });
    const products = q('SELECT * FROM store_products WHERE store_id = ? ORDER BY id DESC').all(s.id).map(shapeProduct);
    const in_group = Boolean(s.group_id && q('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(s.group_id, req.user.id));
    res.json({ ...shape(s), products, in_group, can_edit: canEdit(s, req.user) });
  });

  app.post('/api/stores', auth, withImage('logo', async (req, res, fail) => {
    const f = storeFields(req.body);
    if (!f.name) return fail(400, 'Please give your store a name.');
    if (!CAT_KEYS.has(f.category)) return fail(400, 'Please pick what your store sells.');
    if (!isCountry(f.country)) return fail(400, 'Please choose the country your store is in.');
    const { n } = q('SELECT COUNT(*) AS n FROM stores WHERE owner_id = ?').get(req.user.id);
    if (n >= MAX_STORES_PER_MEMBER && !isStaff(req.user)) return fail(400, `You can have up to ${MAX_STORES_PER_MEMBER} stores.`);
    if (!(await checkText(req.user, `${f.name}\n${f.description}\n${f.location}\n${f.contact}`, fail))) return;
    const status = isStaff(req.user) ? 'approved' : 'pending';
    const store = q(`INSERT INTO stores (owner_id, name, category, description, location, contact, country, logo, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(req.user.id, f.name, f.category, f.description, f.location, f.contact, f.country, req.file?.filename || null, status);
    // The store's promotion group: the owner starts in it, shoppers join from the store page.
    const gid = q('INSERT INTO conversations (name, is_group, created_by, store_id) VALUES (?, 1, ?, ?)').run(`🛍️ ${f.name}`, req.user.id, store.id).lastInsertRowid;
    q('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(gid, req.user.id);
    q('UPDATE stores SET group_id = ? WHERE id = ?').run(gid, store.id);
    res.json({ store: shape(getStore(store.id)), message: status === 'pending' ? 'Your store is ready! A moderator will review it before shoppers can see it. You can add products now.' : 'Your store is open.' });
  }));

  app.patch('/api/stores/:id', auth, withImage('logo', async (req, res, fail) => {
    const s = getStore(req.params.id);
    if (!s) return fail(404, 'Store not found.');
    if (!canEdit(s, req.user)) return fail(403, 'Only the store owner can change it.');
    const f = storeFields(req.body);
    if (!f.name) return fail(400, 'Please give your store a name.');
    if (!CAT_KEYS.has(f.category)) return fail(400, 'Please pick what your store sells.');
    if (!isCountry(f.country)) return fail(400, 'Please choose the country your store is in.');
    if (!(await checkText(req.user, `${f.name}\n${f.description}\n${f.location}\n${f.contact}`, fail))) return;
    const logo = req.file?.filename || (req.body.remove_logo === '1' ? null : s.logo);
    q('UPDATE stores SET name = ?, category = ?, description = ?, location = ?, contact = ?, country = ?, logo = ? WHERE id = ?')
      .run(f.name, f.category, f.description, f.location, f.contact, f.country, logo, s.id);
    if (logo !== s.logo) removeImage(s.logo);
    if (f.name !== s.name && s.group_id) q('UPDATE conversations SET name = ? WHERE id = ?').run(`🛍️ ${f.name}`, s.group_id);
    res.json({ store: shape(getStore(s.id)) });
  }));

  app.delete('/api/stores/:id', auth, (req, res) => {
    const s = getStore(req.params.id);
    if (!s) return res.status(404).json({ error: 'Store not found.' });
    if (!canEdit(s, req.user)) return res.status(403).json({ error: 'Not allowed.' });
    const images = q('SELECT image FROM store_products WHERE store_id = ?').all(s.id).map((p) => p.image);
    q('DELETE FROM stores WHERE id = ?').run(s.id);
    if (s.group_id) q('DELETE FROM conversations WHERE id = ?').run(s.group_id);
    [s.logo, ...images].forEach(removeImage);
    res.json({ ok: true });
  });

  app.post('/api/stores/:id/products', auth, withImage('image', async (req, res, fail) => {
    const s = getStore(req.params.id);
    if (!s) return fail(404, 'Store not found.');
    if (!canEdit(s, req.user)) return fail(403, 'Only the store owner can add products.');
    if (s.product_count >= MAX_PRODUCTS) return fail(400, `A store can list up to ${MAX_PRODUCTS} products.`);
    const name = clean(req.body.name, 100);
    const description = clean(req.body.description, 2000);
    const price = clean(req.body.price, 40);
    if (!name) return fail(400, 'Please name the product.');
    if (!(await checkText(req.user, `${name}\n${description}\n${price}`, fail))) return;
    const p = q('INSERT INTO store_products (store_id, name, description, price, image) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .get(s.id, name, description, price, req.file?.filename || null);
    res.json({ product: shapeProduct(p) });
  }));

  app.delete('/api/stores/:id/products/:pid', auth, (req, res) => {
    const s = getStore(req.params.id);
    if (!s || !canEdit(s, req.user)) return res.status(403).json({ error: 'Not allowed.' });
    const p = q('SELECT * FROM store_products WHERE id = ? AND store_id = ?').get(Number(req.params.pid), s.id);
    if (!p) return res.status(404).json({ error: 'Product not found.' });
    q('DELETE FROM store_products WHERE id = ?').run(p.id);
    removeImage(p.image);
    res.json({ ok: true });
  });

  // Join or leave a store's promotion group.
  app.post('/api/stores/:id/group', auth, (req, res) => {
    const s = getStore(req.params.id);
    if (!canSee(s, req.user) || !s.group_id) return res.status(404).json({ error: 'Store not found.' });
    if (req.body?.leave) {
      if (s.owner_id === req.user.id) return res.status(400).json({ error: 'The owner stays in the store group.' });
      q('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(s.group_id, req.user.id);
      return res.json({ in_group: false });
    }
    if (s.status !== 'approved' && !canEdit(s, req.user)) return res.status(400).json({ error: 'This store is waiting for review.' });
    q('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, last_read_id) VALUES (?, ?, 0)').run(s.group_id, req.user.id);
    res.json({ in_group: true, conversation_id: s.group_id });
  });

  app.get('/api/admin/stores/pending', auth, staffOnly, (req, res) => {
    res.json(q(`${SELECT} WHERE s.status = 'pending' ORDER BY s.id`).all().map(shape));
  });
  app.post('/api/admin/stores/:id', auth, staffOnly, (req, res) => {
    if (!['approved', 'rejected'].includes(req.body?.status)) return res.status(400).json({ error: 'Bad status' });
    q('UPDATE stores SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
    res.json({ ok: true });
  });
}
