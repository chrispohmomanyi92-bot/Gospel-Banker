import express from 'express';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { db, seedIfEmpty, SECTIONS } from './db.js';
import { moderate, aiEnabled } from './moderation.js';
import { registerVideoRoutes, addColumn } from './videos.js';
import { registerStoreRoutes } from './stores.js';
import { registerDonateRoutes } from './donate.js';

const JWT_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET not set: using a random secret, logins reset on restart.');
const STRIKES_BEFORE_MUTE = 3;
const MUTE_MINUTES = 60;

seedIfEmpty();

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

// ---------- helpers ----------
const q = (sql) => db.prepare(sql);
const publicUser = (u) => u && ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, headline: u.headline, church: u.church, bio: u.bio });
const sign = (u) => jwt.sign({ uid: u.id }, JWT_SECRET, { expiresIn: '30d' });
const userById = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
const isStaff = (u) => u.role === 'admin' || u.role === 'moderator';

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const { uid } = jwt.verify(token, JWT_SECRET);
    req.user = userById(uid);
    if (!req.user) throw new Error('no user');
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in.' });
  }
}
const staffOnly = (req, res, next) => (isStaff(req.user) ? next() : res.status(403).json({ error: 'Moderators only.' }));

// Runs the filter, records strikes, and mutes repeat offenders.
async function screen(user, text, context) {
  if (user.muted_until && new Date(user.muted_until + 'Z') > new Date()) {
    return { allowed: false, reason: `You are muted until ${user.muted_until} UTC for repeated abusive language.` };
  }
  const result = await moderate(text);
  if (result.flagged) {
    q('INSERT INTO moderation_log (user_id, context, original, verdict, reason) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, context, text, result.allowed ? 'masked' : 'blocked', result.reason);
    if (!result.allowed) {
      const { strikes } = q('UPDATE users SET strikes = strikes + 1 WHERE id = ? RETURNING strikes').get(user.id);
      if (strikes % STRIKES_BEFORE_MUTE === 0) {
        q(`UPDATE users SET muted_until = datetime('now', '+${MUTE_MINUTES} minutes') WHERE id = ?`).run(user.id);
        result.reason += ` You have been muted for ${MUTE_MINUTES} minutes.`;
      }
    }
  }
  return result;
}

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: 'Something went wrong.' });
});

// ---------- auth & profiles ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { username, password, display_name, church = '', headline = '' } = req.body || {};
  if (!/^[a-zA-Z0-9_.]{3,24}$/.test(username || '')) return res.status(400).json({ error: 'Username: 3-24 letters, numbers, _ or .' });
  if ((password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!display_name?.trim()) return res.status(400).json({ error: 'Please enter your name.' });
  const nameCheck = await moderate(`${username} ${display_name} ${headline}`);
  if (nameCheck.flagged) return res.status(400).json({ error: 'Please choose a respectful name.' });
  if (q('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'That username is taken.' });
  const id = q('INSERT INTO users (username, display_name, password_hash, church, headline) VALUES (?, ?, ?, ?, ?)')
    .run(username, display_name.trim(), bcrypt.hashSync(password, 10), church.trim(), headline.trim()).lastInsertRowid;
  const user = userById(id);
  res.json({ token: sign(user), user: publicUser(user) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = q('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ token: sign(user), user: publicUser(user) });
}));

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user), aiModeration: aiEnabled() }));

app.patch('/api/me', auth, wrap(async (req, res) => {
  const { display_name, headline, church, bio } = req.body || {};
  const check = await moderate([display_name, headline, church, bio].filter(Boolean).join(' '));
  if (check.flagged) return res.status(400).json({ error: 'Please keep your profile respectful.' });
  q('UPDATE users SET display_name = COALESCE(?, display_name), headline = COALESCE(?, headline), church = COALESCE(?, church), bio = COALESCE(?, bio) WHERE id = ?')
    .run(display_name ?? null, headline ?? null, church ?? null, bio ?? null, req.user.id);
  res.json({ user: publicUser(userById(req.user.id)) });
}));

app.get('/api/users', auth, (req, res) => {
  const term = `%${(req.query.q || '').trim()}%`;
  const rows = q('SELECT * FROM users WHERE id != ? AND (username LIKE ? OR display_name LIKE ? OR church LIKE ?) ORDER BY display_name LIMIT 30')
    .all(req.user.id, term, term, term);
  res.json(rows.map(publicUser));
});

app.get('/api/users/:id', auth, (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const posts = q('SELECT COUNT(*) AS n FROM posts WHERE author_id = ?').get(u.id).n;
  res.json({ ...publicUser(u), posts });
});

// ---------- chat ----------
const memberOf = (cid, uid) => q('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(cid, uid);

function conversationsFor(uid) {
  const convs = q(`
    SELECT c.*, cm.last_read_id,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_body,
      (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.id > cm.last_read_id AND m.sender_id != ?) AS unread
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
    ORDER BY COALESCE(last_at, c.created_at) DESC`).all(uid, uid);
  const membersStmt = q('SELECT u.* FROM users u JOIN conversation_members cm ON cm.user_id = u.id WHERE cm.conversation_id = ?');
  return convs.map((c) => {
    const members = membersStmt.all(c.id).map(publicUser);
    const other = members.find((m) => m.id !== uid);
    return { ...c, members, title: c.is_group ? c.name : other?.display_name || 'Just me' };
  });
}

app.get('/api/conversations', auth, (req, res) => res.json(conversationsFor(req.user.id)));

app.post('/api/conversations', auth, wrap(async (req, res) => {
  const { user_ids = [], name } = req.body || {};
  const ids = [...new Set(user_ids.map(Number).filter((id) => id && id !== req.user.id && userById(id)))];
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one person.' });
  const isGroup = ids.length > 1 || Boolean(name);
  if (!isGroup) {
    const existing = q(`SELECT c.id FROM conversations c
      JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
      JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
      WHERE c.is_group = 0`).get(req.user.id, ids[0]);
    if (existing) return res.json({ id: existing.id });
  } else if (name && (await moderate(name)).flagged) {
    return res.status(400).json({ error: 'Please choose a respectful group name.' });
  }
  const cid = q('INSERT INTO conversations (name, is_group, created_by) VALUES (?, ?, ?)')
    .run(isGroup ? (name?.trim() || 'New group') : null, isGroup ? 1 : 0, req.user.id).lastInsertRowid;
  for (const id of [req.user.id, ...ids]) q('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(cid, id);
  for (const id of ids) io.to(`user:${id}`).emit('conversation:new', { id: Number(cid) });
  res.json({ id: Number(cid) });
}));

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  const cid = Number(req.params.id);
  if (!memberOf(cid, req.user.id)) return res.status(403).json({ error: 'Not in this chat.' });
  const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
  const rows = q(`SELECT m.*, u.display_name AS sender_name, r.body AS reply_body, ru.display_name AS reply_name
    FROM messages m JOIN users u ON u.id = m.sender_id
    LEFT JOIN messages r ON r.id = m.reply_to LEFT JOIN users ru ON ru.id = r.sender_id
    WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT 50`).all(cid, before).reverse();
  if (rows.length) markRead(cid, req.user.id, rows.at(-1).id);
  // Read ticks: a message is read once every other member has opened the chat past it.
  const reads = readMap(cid);
  for (const m of rows) m.read = Object.entries(reads).every(([u, last]) => Number(u) === m.sender_id || last >= m.id);
  res.json(rows);
});

// Read receipts: how far each member has read, and telling the chat when that moves.
const readMap = (cid) => Object.fromEntries(q('SELECT user_id, last_read_id FROM conversation_members WHERE conversation_id = ?').all(cid).map((r) => [r.user_id, r.last_read_id]));
function markRead(cid, uid, messageId) {
  const r = q('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ? AND last_read_id < ?').run(messageId, cid, uid, messageId);
  if (r.changes) io.to(`conv:${cid}`).emit('conversation:read', { conversationId: cid, reads: readMap(cid) });
}

// Swipe-to-reply: a message can quote an earlier message from the same chat.
addColumn('messages', 'reply_to', 'INTEGER');

async function sendMessage(user, cid, body, replyTo) {
  if (!memberOf(cid, user.id)) return { error: 'Not in this chat.' };
  const text = String(body || '').trim().slice(0, 4000);
  if (!text) return { error: 'Empty message.' };
  const verdict = await screen(userById(user.id), text, 'message');
  if (!verdict.allowed) return { error: verdict.reason, blocked: true };
  const quoted = replyTo ? q(`SELECT m.id, m.body, u.display_name FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.id = ? AND m.conversation_id = ?`).get(Number(replyTo), cid) : null;
  const msg = q(`INSERT INTO messages (conversation_id, sender_id, body, flagged, reply_to) VALUES (?, ?, ?, ?, ?) RETURNING *`)
    .get(cid, user.id, verdict.text, verdict.flagged ? 1 : 0, quoted?.id ?? null);
  msg.sender_name = user.display_name;
  if (quoted) { msg.reply_body = quoted.body; msg.reply_name = quoted.display_name; }
  q('UPDATE conversation_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ? AND last_read_id < ?').run(msg.id, cid, user.id, msg.id);
  msg.read = false;
  io.to(`conv:${cid}`).emit('message:new', msg);
  const members = q('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(cid);
  for (const m of members) io.to(`user:${m.user_id}`).emit('conversation:activity', { id: cid });
  return { message: msg, notice: verdict.flagged ? verdict.reason : null };
}

app.post('/api/conversations/:id/messages', auth, wrap(async (req, res) => {
  const r = await sendMessage(req.user, Number(req.params.id), req.body?.body, req.body?.reply_to);
  res.status(r.error ? (r.blocked ? 422 : 400) : 200).json(r);
}));

// ---------- feed ----------
app.get('/api/posts', auth, (req, res) => {
  const kind = req.query.kind;
  const rows = q(`SELECT p.*, u.display_name AS author_name, u.headline AS author_headline,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
    FROM posts p JOIN users u ON u.id = p.author_id
    ${kind ? 'WHERE p.kind = ?' : ''}
    ORDER BY p.id DESC LIMIT 100`).all(...(kind ? [req.user.id, kind] : [req.user.id]));
  res.json(rows);
});

app.post('/api/posts', auth, wrap(async (req, res) => {
  const body = String(req.body?.body || '').trim().slice(0, 5000);
  const kind = ['post', 'prayer', 'testimony'].includes(req.body?.kind) ? req.body.kind : 'post';
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  const v = await screen(req.user, body, 'post');
  if (!v.allowed) return res.status(422).json({ error: v.reason });
  const post = q('INSERT INTO posts (author_id, body, kind) VALUES (?, ?, ?) RETURNING *').get(req.user.id, v.text, kind);
  io.emit('post:new', { id: post.id });
  res.json({ post, notice: v.flagged ? v.reason : null });
}));

app.delete('/api/posts/:id', auth, (req, res) => {
  const post = q('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (post.author_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  q('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  const pid = Number(req.params.id);
  const had = q('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(pid, req.user.id).changes;
  if (!had) q('INSERT OR IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)').run(pid, req.user.id);
  res.json({ liked: !had, likes: q('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?').get(pid).n });
});

app.get('/api/posts/:id/comments', auth, (req, res) => {
  res.json(q(`SELECT c.*, u.display_name AS author_name FROM comments c JOIN users u ON u.id = c.author_id WHERE post_id = ? ORDER BY c.id`).all(req.params.id));
});

app.post('/api/posts/:id/comments', auth, wrap(async (req, res) => {
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Write something first.' });
  if (!q('SELECT 1 FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Post not found' });
  const v = await screen(req.user, body, 'comment');
  if (!v.allowed) return res.status(422).json({ error: v.reason });
  const c = q('INSERT INTO comments (post_id, author_id, body) VALUES (?, ?, ?) RETURNING *').get(req.params.id, req.user.id, v.text);
  res.json({ comment: { ...c, author_name: req.user.display_name }, notice: v.flagged ? v.reason : null });
}));

// ---------- content library ----------
app.get('/api/sections', (req, res) => {
  const counts = Object.fromEntries(q(`SELECT section, COUNT(*) AS n FROM content WHERE status = 'approved' GROUP BY section`).all().map((r) => [r.section, r.n]));
  res.json(SECTIONS.map((s) => ({ ...s, count: counts[s.key] || 0 })));
});

const parseContent = (r) => ({ ...r, meta: JSON.parse(r.meta || '{}') });

app.get('/api/content', auth, (req, res) => {
  const { section, q: term } = req.query;
  const where = ["status = 'approved'"];
  const args = [];
  if (section) { where.push('section = ?'); args.push(section); }
  if (term) { where.push('(title LIKE ? OR summary LIKE ? OR source LIKE ?)'); args.push(`%${term}%`, `%${term}%`, `%${term}%`); }
  res.json(q(`SELECT * FROM content WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args).map(parseContent));
});

app.post('/api/content', auth, wrap(async (req, res) => {
  const { section, title, summary = '', url = '', source = '', meta = {} } = req.body || {};
  if (!SECTIONS.some((s) => s.key === section)) return res.status(400).json({ error: 'Unknown section.' });
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
  if (url && !/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'Link must start with http:// or https://' });
  const v = await screen(req.user, `${title} ${summary} ${source}`, 'content');
  if (!v.allowed) return res.status(422).json({ error: v.reason });
  if (v.flagged) return res.status(422).json({ error: 'Please keep submissions respectful.' });
  const status = isStaff(req.user) ? 'approved' : 'pending';
  const row = q('INSERT INTO content (section, title, summary, url, source, meta, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .get(section, title.trim(), summary.trim(), url.trim(), source.trim(), JSON.stringify(meta || {}), status, req.user.id);
  res.json({ item: parseContent(row), message: status === 'pending' ? 'Thanks! A moderator will review it before it appears.' : 'Published.' });
}));

// ---------- moderation (staff) ----------
app.get('/api/admin/pending', auth, staffOnly, (req, res) => {
  res.json(q(`SELECT c.*, u.display_name AS submitted_by_name FROM content c LEFT JOIN users u ON u.id = c.submitted_by WHERE status = 'pending' ORDER BY c.id`).all().map(parseContent));
});
app.post('/api/admin/content/:id', auth, staffOnly, (req, res) => {
  const status = req.body?.status;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  q('UPDATE content SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/content/:id', auth, staffOnly, (req, res) => {
  q('DELETE FROM content WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/moderation-log', auth, staffOnly, (req, res) => {
  res.json(q(`SELECT l.*, u.display_name, u.username, u.strikes FROM moderation_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 200`).all());
});
app.post('/api/admin/users/:id/role', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  if (!['member', 'moderator', 'admin'].includes(req.body?.role)) return res.status(400).json({ error: 'Bad role' });
  q('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, req.params.id);
  res.json({ ok: true });
});

registerVideoRoutes(app, { auth, staffOnly, screen, isStaff, publicUser, userById });
registerStoreRoutes(app, { auth, staffOnly, screen, isStaff });
registerDonateRoutes(app, { auth });

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get(/^\/(?!api|socket\.io|media).*/, (req, res) => res.sendFile(fileURLToPath(new URL('../public/index.html', import.meta.url))));

// ---------- realtime ----------
const server = http.createServer(app);
const io = new Server(server);

io.use((socket, next) => {
  try {
    const { uid } = jwt.verify(socket.handshake.auth?.token, JWT_SECRET);
    socket.user = userById(uid);
    return socket.user ? next() : next(new Error('unauthorised'));
  } catch {
    next(new Error('unauthorised'));
  }
});

const online = new Map(); // uid -> socket count
io.on('connection', (socket) => {
  const uid = socket.user.id;
  socket.join(`user:${uid}`);
  for (const { conversation_id } of q('SELECT conversation_id FROM conversation_members WHERE user_id = ?').all(uid)) socket.join(`conv:${conversation_id}`);
  online.set(uid, (online.get(uid) || 0) + 1);
  io.emit('presence', { online: [...online.keys()] });

  socket.on('conversation:join', (cid) => { if (memberOf(cid, uid)) socket.join(`conv:${cid}`); });
  socket.on('message:send', async ({ conversationId, body, replyTo } = {}, ack) => {
    const r = await sendMessage(userById(uid), Number(conversationId), body, replyTo);
    if (typeof ack === 'function') ack(r);
  });
  socket.on('message:read', ({ conversationId, messageId } = {}) => {
    const cid = Number(conversationId);
    if (memberOf(cid, uid)) markRead(cid, uid, Number(messageId) || 0);
  });
  socket.on('typing', ({ conversationId } = {}) => {
    if (memberOf(conversationId, uid)) socket.to(`conv:${conversationId}`).emit('typing', { conversationId, name: socket.user.display_name });
  });
  socket.on('disconnect', () => {
    const n = (online.get(uid) || 1) - 1;
    if (n <= 0) online.delete(uid); else online.set(uid, n);
    io.emit('presence', { online: [...online.keys()] });
  });
});

const PORT = Number(process.env.PORT || 3000);
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(`The Gospel Banker is running on http://localhost:${PORT}  (AI moderation: ${aiEnabled() ? 'on' : 'off, local filter only'})`));
}
export { app, server, io };
