// Donations: where members can give. The admin fills in the details from the
// app (M-Pesa, bank, or a giving link); nothing is processed by this server.
import { db } from './db.js';

db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

const FIELDS = ['title', 'message', 'paypal_url', 'card_url', 'mpesa_paybill', 'mpesa_account', 'mpesa_till', 'bank'];
const LINKS = ['paypal_url', 'card_url'];
const DEFAULTS = { title: 'Support The Gospel Banker', message: 'Your gift keeps this app running and helps spread the gospel. God loves a cheerful giver (2 Corinthians 9:7).' };

const read = () => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'donate'`).get();
  const saved = row ? JSON.parse(row.value) : {};
  return Object.fromEntries(FIELDS.map((f) => [f, saved[f] ?? DEFAULTS[f] ?? '']));
};
const ready = (d) => Boolean(d.paypal_url || d.card_url || d.mpesa_paybill || d.mpesa_till || d.bank);

export function registerDonateRoutes(app, { auth }) {
  app.get('/api/donate', auth, (req, res) => {
    const d = read();
    res.json({ ...d, ready: ready(d), canEdit: req.user.role === 'admin' });
  });

  app.put('/api/donate', auth, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the admin can change donation details.' });
    const body = req.body || {};
    const d = Object.fromEntries(FIELDS.map((f) => [f, String(body[f] ?? '').trim().slice(0, f === 'message' || f === 'bank' ? 600 : 200)]));
    for (const f of LINKS) {
      if (d[f] && !/^https?:\/\//i.test(d[f])) d[f] = 'https://' + d[f]; // paypal.me/name -> https://paypal.me/name
      if (d[f] && !/^https:\/\/[^\s]+$/i.test(d[f])) return res.status(400).json({ error: 'Links must be web addresses starting with https://' });
    }
    db.prepare(`INSERT INTO settings (key, value) VALUES ('donate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(d));
    res.json({ ...read(), ready: ready(d), canEdit: true });
  });
}
