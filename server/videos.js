// In-app video platform: uploads, categories, channels, views, likes, comments.
import express from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { db } from './db.js';

export const VIDEO_CATEGORIES = [
  { key: 'music', label: 'Music Videos', icon: '🎵' },
  { key: 'choirs', label: 'Choirs & Quartets', icon: '🎶' },
  { key: 'sermons', label: 'Sermons', icon: '📖' },
  { key: 'bible-study', label: 'Bible Study', icon: '📚' },
  { key: 'prophecy', label: 'Prophecy', icon: '🕊️' },
  { key: 'health', label: 'Health Talks', icon: '🥗' },
  { key: 'cooking', label: 'Healthy Cooking', icon: '🍲' },
  { key: 'mission', label: 'Mission Stories', icon: '🌍' },
  { key: 'testimonies', label: 'Testimonies', icon: '🙌' },
  { key: 'children', label: 'Children', icon: '🧒' },
  { key: 'youth', label: 'Youth & Pathfinders', icon: '⛺' },
  { key: 'family', label: 'Family & Marriage', icon: '👨‍👩‍👧' },
  { key: 'documentaries', label: 'Documentaries', icon: '🎞️' },
  { key: 'podcasts', label: 'Video Podcasts', icon: '🎙️' },
  { key: 'events', label: 'Camp Meetings & Events', icon: '⛪' },
];
const CAT_KEYS = new Set(VIDEO_CATEGORIES.map((c) => c.key));

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  file TEXT NOT NULL,
  thumb TEXT,
  mime TEXT,
  size INTEGER,
  duration REAL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_cat ON videos(status, category, id);
CREATE TABLE IF NOT EXISTS video_likes (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, user_id)
);
CREATE TABLE IF NOT EXISTS video_views (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (video_id, user_id)
);
CREATE TABLE IF NOT EXISTS video_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  channel_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscriber_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, subscriber_id)
);
`);

const MEDIA_DIR = resolve(process.env.MEDIA_DIR || './data/media');
const VIDEO_DIR = join(MEDIA_DIR, 'videos');
const THUMB_DIR = join(MEDIA_DIR, 'thumbs');
mkdirSync(VIDEO_DIR, { recursive: true });
mkdirSync(THUMB_DIR, { recursive: true });
const MAX_MB = Number(process.env.MAX_VIDEO_MB || 500);

const VIDEO_TYPES = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v', 'video/3gpp': '.3gp' };
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'thumb' ? THUMB_DIR : VIDEO_DIR),
    filename: (req, file, cb) => {
      const ext = (file.fieldname === 'thumb' ? IMAGE_TYPES : VIDEO_TYPES)[file.mimetype] || extname(file.originalname).toLowerCase();
      cb(null, randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => {
    const ok = file.fieldname === 'thumb' ? IMAGE_TYPES[file.mimetype] : file.fieldname === 'video' && VIDEO_TYPES[file.mimetype];
    cb(ok ? null : new Error(file.fieldname === 'thumb' ? 'Thumbnail must be JPG, PNG or WebP.' : 'Please upload an MP4, WebM or MOV video.'), Boolean(ok));
  },
}).fields([{ name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);

const removeFiles = (...paths) => paths.filter(Boolean).forEach((p) => { try { unlinkSync(p); } catch {} });

export function registerVideoRoutes(app, { auth, staffOnly, screen, isStaff, publicUser, userById }) {
  const q = (sql) => db.prepare(sql);
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '7d', fallthrough: false }));

  const SELECT = `SELECT v.*, u.display_name AS channel_name, u.username AS channel_username,
      (SELECT COUNT(*) FROM video_likes l WHERE l.video_id = v.id) AS likes
    FROM videos v JOIN users u ON u.id = v.uploader_id`;
  const shape = (v) => v && ({
    ...v,
    src: `/media/videos/${v.file}`,
    thumb_url: v.thumb ? `/media/thumbs/${v.thumb}` : null,
    category_label: VIDEO_CATEGORIES.find((c) => c.key === v.category)?.label || v.category,
  });
  const canSee = (v, user) => v && (v.status === 'approved' || v.uploader_id === user.id || isStaff(user));

  app.get('/api/videos/categories', (req, res) => {
    const counts = Object.fromEntries(q(`SELECT category, COUNT(*) AS n FROM videos WHERE status = 'approved' GROUP BY category`).all().map((r) => [r.category, r.n]));
    res.json(VIDEO_CATEGORIES.map((c) => ({ ...c, count: counts[c.key] || 0 })));
  });

  app.get('/api/videos', auth, (req, res) => {
    const { category, q: term, sort, channel, exclude } = req.query;
    const where = [];
    const args = [];
    if (channel) {
      where.push('v.uploader_id = ?'); args.push(Number(channel));
      if (Number(channel) !== req.user.id && !isStaff(req.user)) where.push(`v.status = 'approved'`);
    } else where.push(`v.status = 'approved'`);
    if (category && CAT_KEYS.has(category)) { where.push('v.category = ?'); args.push(category); }
    if (term) { where.push('(v.title LIKE ? OR v.description LIKE ? OR u.display_name LIKE ?)'); args.push(...Array(3).fill(`%${term}%`)); }
    if (exclude) { where.push('v.id != ?'); args.push(Number(exclude)); }
    const order = sort === 'popular' ? 'v.views DESC, v.id DESC' : 'v.id DESC';
    const limit = Math.min(Number(req.query.limit) || 60, 100);
    res.json(q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`).all(...args).map(shape));
  });

  app.get('/api/videos/:id', auth, (req, res) => {
    const v = q(`${SELECT} WHERE v.id = ?`).get(req.params.id);
    if (!canSee(v, req.user)) return res.status(404).json({ error: 'Video not found.' });
    const liked = Boolean(q('SELECT 1 FROM video_likes WHERE video_id = ? AND user_id = ?').get(v.id, req.user.id));
    const subscribers = q('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?').get(v.uploader_id).n;
    const subscribed = Boolean(q('SELECT 1 FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?').get(v.uploader_id, req.user.id));
    res.json({ ...shape(v), liked, subscribers, subscribed });
  });

  app.post('/api/videos', auth, (req, res) => {
    upload(req, res, async (err) => {
      const vfile = req.files?.video?.[0];
      const tfile = req.files?.thumb?.[0];
      const fail = (status, error) => { removeFiles(vfile?.path, tfile?.path); res.status(status).json({ error }); };
      if (err) return fail(400, err.code === 'LIMIT_FILE_SIZE' ? `Videos can be up to ${MAX_MB} MB.` : err.message);
      if (!vfile) return fail(400, 'Please choose a video.');
      const title = String(req.body.title || '').trim().slice(0, 120);
      const description = String(req.body.description || '').trim().slice(0, 5000);
      const category = req.body.category;
      if (!title) return fail(400, 'Please add a title.');
      if (!CAT_KEYS.has(category)) return fail(400, 'Please pick a category.');
      try {
        const v = await screen(req.user, `${title}\n${description}`, 'video');
        if (!v.allowed) return fail(422, v.reason);
        if (v.flagged) return fail(422, 'Please keep titles and descriptions respectful.');
        const status = isStaff(req.user) ? 'approved' : 'pending';
        const row = q(`INSERT INTO videos (uploader_id, title, description, category, file, thumb, mime, size, duration, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
          .get(req.user.id, title, description, category, vfile.filename, tfile?.filename || null, vfile.mimetype, vfile.size, Number(req.body.duration) || 0, status);
        res.json({ video: shape(row), message: status === 'pending' ? 'Uploaded! A moderator will review your video before it goes public.' : 'Published.' });
      } catch (e) {
        console.error(e); fail(500, 'Upload failed.');
      }
    });
  });

  app.delete('/api/videos/:id', auth, (req, res) => {
    const v = q('SELECT * FROM videos WHERE id = ?').get(req.params.id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    if (v.uploader_id !== req.user.id && !isStaff(req.user)) return res.status(403).json({ error: 'Not allowed.' });
    q('DELETE FROM videos WHERE id = ?').run(v.id);
    removeFiles(join(VIDEO_DIR, v.file), v.thumb && join(THUMB_DIR, v.thumb));
    res.json({ ok: true });
  });

  // One view per signed-in person per video.
  app.post('/api/videos/:id/view', auth, (req, res) => {
    const vid = Number(req.params.id);
    if (q('INSERT OR IGNORE INTO video_views (video_id, user_id) VALUES (?, ?)').run(vid, req.user.id).changes) {
      q('UPDATE videos SET views = views + 1 WHERE id = ?').run(vid);
    }
    res.json({ views: q('SELECT views FROM videos WHERE id = ?').get(vid)?.views || 0 });
  });

  app.post('/api/videos/:id/like', auth, (req, res) => {
    const vid = Number(req.params.id);
    const had = q('DELETE FROM video_likes WHERE video_id = ? AND user_id = ?').run(vid, req.user.id).changes;
    if (!had) q('INSERT OR IGNORE INTO video_likes (video_id, user_id) VALUES (?, ?)').run(vid, req.user.id);
    res.json({ liked: !had, likes: q('SELECT COUNT(*) AS n FROM video_likes WHERE video_id = ?').get(vid).n });
  });

  app.get('/api/videos/:id/comments', auth, (req, res) => {
    res.json(q(`SELECT c.*, u.display_name AS author_name FROM video_comments c JOIN users u ON u.id = c.author_id WHERE video_id = ? ORDER BY c.id DESC`).all(req.params.id));
  });

  app.post('/api/videos/:id/comments', auth, async (req, res) => {
    const body = String(req.body?.body || '').trim().slice(0, 2000);
    if (!body) return res.status(400).json({ error: 'Write something first.' });
    const vid = q('SELECT * FROM videos WHERE id = ?').get(req.params.id);
    if (!canSee(vid, req.user)) return res.status(404).json({ error: 'Video not found.' });
    const v = await screen(req.user, body, 'comment');
    if (!v.allowed) return res.status(422).json({ error: v.reason });
    const c = q('INSERT INTO video_comments (video_id, author_id, body) VALUES (?, ?, ?) RETURNING *').get(vid.id, req.user.id, v.text);
    res.json({ comment: { ...c, author_name: req.user.display_name }, notice: v.flagged ? v.reason : null });
  });

  // Channels: every member has one.
  app.get('/api/channels/:id', auth, (req, res) => {
    const u = userById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Channel not found.' });
    const subscribers = q('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?').get(u.id).n;
    const subscribed = Boolean(q('SELECT 1 FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?').get(u.id, req.user.id));
    res.json({ ...publicUser(u), subscribers, subscribed });
  });

  app.post('/api/channels/:id/subscribe', auth, (req, res) => {
    const cid = Number(req.params.id);
    if (cid === req.user.id) return res.status(400).json({ error: "You can't subscribe to yourself." });
    const had = q('DELETE FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?').run(cid, req.user.id).changes;
    if (!had) q('INSERT OR IGNORE INTO subscriptions (channel_id, subscriber_id) VALUES (?, ?)').run(cid, req.user.id);
    res.json({ subscribed: !had, subscribers: q('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?').get(cid).n });
  });

  app.get('/api/videos-feed/subscriptions', auth, (req, res) => {
    res.json(q(`${SELECT} WHERE v.status = 'approved' AND v.uploader_id IN (SELECT channel_id FROM subscriptions WHERE subscriber_id = ?) ORDER BY v.id DESC LIMIT 60`).all(req.user.id).map(shape));
  });

  app.get('/api/admin/videos/pending', auth, staffOnly, (req, res) => {
    res.json(q(`${SELECT} WHERE v.status = 'pending' ORDER BY v.id`).all().map(shape));
  });
  app.post('/api/admin/videos/:id', auth, staffOnly, (req, res) => {
    if (!['approved', 'rejected'].includes(req.body?.status)) return res.status(400).json({ error: 'Bad status' });
    q('UPDATE videos SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
    res.json({ ok: true });
  });
}
