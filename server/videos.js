// In-app media platform: videos, audio and files uploaded to members' channels,
// browsed by topic, preacher/author or channel, with views, likes and comments.
import express from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { db } from './db.js';
import { isCountry } from '../public/countries.js';

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

// Columns added after the first release. Existing databases get them on start-up.
export function addColumn(table, column, definition) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('videos', 'kind', "TEXT NOT NULL DEFAULT 'video'");   // video | audio | file
addColumn('videos', 'speaker', "TEXT NOT NULL DEFAULT ''");     // preacher, author or artist
addColumn('videos', 'original_name', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'channel_name', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'channel_about', "TEXT NOT NULL DEFAULT ''");
addColumn('users', 'channel_country', "TEXT NOT NULL DEFAULT ''"); // two-letter code, e.g. KE
db.exec(`CREATE INDEX IF NOT EXISTS idx_videos_speaker ON videos(status, speaker COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_videos_uploader ON videos(uploader_id, status);`);

const MEDIA_DIR = resolve(process.env.MEDIA_DIR || './data/media');
const VIDEO_DIR = join(MEDIA_DIR, 'videos');
const THUMB_DIR = join(MEDIA_DIR, 'thumbs');
const AUDIO_DIR = join(MEDIA_DIR, 'audio');
const FILE_DIR = join(MEDIA_DIR, 'files');
for (const d of [VIDEO_DIR, THUMB_DIR, AUDIO_DIR, FILE_DIR]) mkdirSync(d, { recursive: true });
const MAX_MB = Number(process.env.MAX_VIDEO_MB || 500);
const DIRS = { video: VIDEO_DIR, audio: AUDIO_DIR, file: FILE_DIR };
const URL_DIR = { video: 'videos', audio: 'audio', file: 'files' };

// Allowed uploads by kind: mime type -> extension. Extensions are the fallback
// because some phones and Windows browsers send an empty or generic type.
const TYPES = {
  video: { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v', 'video/3gpp': '.3gp' },
  audio: {
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg',
    'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/webm': '.weba', 'audio/flac': '.flac', 'audio/amr': '.amr', 'audio/3gpp': '.3ga',
  },
  file: {
    'application/pdf': '.pdf', 'application/epub+zip': '.epub', 'text/plain': '.txt', 'application/rtf': '.rtf',
    'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.oasis.opendocument.text': '.odt', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  },
};
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const EXT_KIND = Object.fromEntries(Object.entries(TYPES).flatMap(([kind, m]) => Object.values(m).map((ext) => [ext, kind])));
Object.assign(EXT_KIND, { '.jpeg': 'file', '.mpeg': 'audio', '.opus': 'audio' });

// Which kind of upload a file is, with the extension to store it under, or null if not allowed.
export function classifyUpload(mimetype, originalname) {
  const ext = extname(originalname || '').toLowerCase();
  for (const [kind, m] of Object.entries(TYPES)) if (m[mimetype]) return { kind, ext: m[mimetype] };
  if (EXT_KIND[ext]) return { kind: EXT_KIND[ext], ext };
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, file.fieldname === 'thumb' ? THUMB_DIR : DIRS[classifyUpload(file.mimetype, file.originalname).kind]),
    filename: (req, file, cb) => {
      const ext = file.fieldname === 'thumb' ? IMAGE_TYPES[file.mimetype] : classifyUpload(file.mimetype, file.originalname).ext;
      cb(null, randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 2 },
  defParamCharset: 'utf8', // keep accented file names such as "Wimbo – Kwaya.mp3"
  fileFilter: (req, file, cb) => {
    const ok = file.fieldname === 'thumb' ? IMAGE_TYPES[file.mimetype] : ['media', 'video'].includes(file.fieldname) && classifyUpload(file.mimetype, file.originalname);
    cb(ok ? null : new Error(file.fieldname === 'thumb' ? 'The cover picture must be JPG, PNG or WebP.' : 'That kind of file is not supported. Upload a video (MP4, MOV), audio (MP3, M4A, WAV) or a document (PDF, Word, PowerPoint, EPUB).'), Boolean(ok));
  },
}).fields([{ name: 'media', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);

const removeFiles = (...paths) => paths.filter(Boolean).forEach((p) => { try { unlinkSync(p); } catch {} });

export function registerVideoRoutes(app, { auth, staffOnly, screen, isStaff, publicUser, userById }) {
  const q = (sql) => db.prepare(sql);
  app.use('/media', express.static(MEDIA_DIR, {
    maxAge: '7d', fallthrough: false,
    setHeaders: (res, path) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Documents download instead of opening inside the app's own address (PDFs and pictures may open).
      if (path.startsWith(FILE_DIR) && !/\.(pdf|jpe?g|png|webp)$/i.test(path)) res.setHeader('Content-Disposition', 'attachment');
    },
  }));

  const CHANNEL_NAME = `COALESCE(NULLIF(u.channel_name, ''), u.display_name)`;
  const SELECT = `SELECT v.*, ${CHANNEL_NAME} AS channel_name, u.username AS channel_username,
      (SELECT COUNT(*) FROM video_likes l WHERE l.video_id = v.id) AS likes,
      (SELECT COUNT(*) FROM video_comments c WHERE c.video_id = v.id) AS comment_count
    FROM videos v JOIN users u ON u.id = v.uploader_id`;
  const shape = (v) => v && ({
    ...v,
    kind: v.kind || 'video',
    src: `/media/${URL_DIR[v.kind] || 'videos'}/${v.file}`,
    thumb_url: v.thumb ? `/media/thumbs/${v.thumb}` : null,
    category_label: VIDEO_CATEGORIES.find((c) => c.key === v.category)?.label || v.category,
  });
  const canSee = (v, user) => v && (v.status === 'approved' || v.uploader_id === user.id || isStaff(user));

  app.get('/api/videos/categories', (req, res) => {
    const counts = Object.fromEntries(q(`SELECT category, COUNT(*) AS n FROM videos WHERE status = 'approved' GROUP BY category`).all().map((r) => [r.category, r.n]));
    res.json(VIDEO_CATEGORIES.map((c) => ({ ...c, count: counts[c.key] || 0 })));
  });

  app.get('/api/videos', auth, (req, res) => {
    const { category, q: term, sort, channel, exclude, kind, speaker } = req.query;
    const where = [];
    const args = [];
    if (channel) {
      where.push('v.uploader_id = ?'); args.push(Number(channel));
      if (Number(channel) !== req.user.id && !isStaff(req.user)) where.push(`v.status = 'approved'`);
    } else where.push(`v.status = 'approved'`);
    if (category && CAT_KEYS.has(category)) { where.push('v.category = ?'); args.push(category); }
    if (kind && DIRS[kind]) { where.push('v.kind = ?'); args.push(kind); }
    if (speaker) { where.push('v.speaker = ? COLLATE NOCASE'); args.push(String(speaker).trim()); }
    if (term) { where.push(`(v.title LIKE ? OR v.description LIKE ? OR v.speaker LIKE ? OR ${CHANNEL_NAME} LIKE ?)`); args.push(...Array(4).fill(`%${term}%`)); }
    if (exclude) { where.push('v.id != ?'); args.push(Number(exclude)); }
    const order = sort === 'popular' ? 'v.views DESC, v.id DESC' : 'v.id DESC';
    const limit = Math.min(Number(req.query.limit) || 60, 100);
    res.json(q(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`).all(...args).map(shape));
  });

  // Preachers, authors and artists, with how many approved uploads each has.
  app.get('/api/videos/speakers', auth, (req, res) => {
    const term = String(req.query.q || '').trim();
    res.json(q(`SELECT MIN(speaker) AS name, COUNT(*) AS count,
        SUM(kind = 'video') AS videos, SUM(kind = 'audio') AS audio, SUM(kind = 'file') AS files,
        (SELECT thumb FROM videos t WHERE t.status = 'approved' AND t.speaker = v.speaker COLLATE NOCASE AND t.thumb IS NOT NULL ORDER BY t.id DESC LIMIT 1) AS thumb
      FROM videos v WHERE status = 'approved' AND speaker != '' ${term ? 'AND speaker LIKE ?' : ''}
      GROUP BY speaker COLLATE NOCASE ORDER BY count DESC, name LIMIT 200`).all(...(term ? [`%${term}%`] : []))
      .map((s) => ({ ...s, thumb_url: s.thumb ? `/media/thumbs/${s.thumb}` : null })));
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
      const vfile = req.files?.media?.[0] || req.files?.video?.[0];
      const tfile = req.files?.thumb?.[0];
      const fail = (status, error) => { removeFiles(vfile?.path, tfile?.path); res.status(status).json({ error }); };
      if (err) return fail(400, err.code === 'LIMIT_FILE_SIZE' ? `Uploads can be up to ${MAX_MB} MB.` : err.message);
      if (!vfile) return fail(400, 'Please choose a video, audio or file.');
      const { kind } = classifyUpload(vfile.mimetype, vfile.originalname);
      const title = String(req.body.title || '').trim().slice(0, 120);
      const description = String(req.body.description || '').trim().slice(0, 5000);
      const speaker = String(req.body.speaker || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const category = req.body.category;
      if (!title) return fail(400, 'Please add a title.');
      if (!CAT_KEYS.has(category)) return fail(400, 'Please pick a topic.');
      try {
        const v = await screen(req.user, `${title}\n${speaker}\n${description}`, 'video');
        if (!v.allowed) return fail(422, v.reason);
        if (v.flagged) return fail(422, 'Please keep titles and descriptions respectful.');
        const status = isStaff(req.user) ? 'approved' : 'pending';
        const mime = TYPES[kind][vfile.mimetype] ? vfile.mimetype : null;
        const row = q(`INSERT INTO videos (uploader_id, title, description, category, file, thumb, mime, size, duration, status, kind, speaker, original_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
          .get(req.user.id, title, description, category, vfile.filename, tfile?.filename || null, mime, vfile.size,
            kind === 'file' ? 0 : Number(req.body.duration) || 0, status, kind, speaker, vfile.originalname.slice(0, 200));
        const what = { video: 'video', audio: 'audio', file: 'file' }[kind];
        res.json({ video: shape(row), message: status === 'pending' ? `Uploaded! A moderator will review your ${what} before it goes public.` : 'Published.' });
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
    removeFiles(join(DIRS[v.kind] || VIDEO_DIR, v.file), v.thumb && join(THUMB_DIR, v.thumb));
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

  // Channels: every member has one. They show up in the list once they have
  // something public or have named their channel.
  const LISTED = `(u.channel_name != '' OR EXISTS (SELECT 1 FROM videos v WHERE v.uploader_id = u.id AND v.status = 'approved'))`;
  // Countries that have channels, for the country filter.
  app.get('/api/channels/countries', auth, (req, res) => {
    res.json(q(`SELECT u.channel_country AS code, COUNT(*) AS count FROM users u WHERE u.channel_country != '' AND ${LISTED} GROUP BY u.channel_country ORDER BY count DESC`).all());
  });

  app.get('/api/channels', auth, (req, res) => {
    const term = String(req.query.q || '').trim();
    const country = isCountry(req.query.country) ? req.query.country : '';
    const args = [...(country ? [country] : []), ...(term ? Array(4).fill(`%${term}%`) : [])];
    const rows = q(`SELECT u.id, u.username, u.display_name, u.headline, u.church, u.channel_about, u.channel_country, ${CHANNEL_NAME} AS channel_name,
        (SELECT COUNT(*) FROM videos v WHERE v.uploader_id = u.id AND v.status = 'approved') AS uploads,
        (SELECT COUNT(*) FROM subscriptions s WHERE s.channel_id = u.id) AS subscribers,
        (SELECT thumb FROM videos v WHERE v.uploader_id = u.id AND v.status = 'approved' AND v.thumb IS NOT NULL ORDER BY v.id DESC LIMIT 1) AS thumb
      FROM users u WHERE ${LISTED} ${country ? 'AND u.channel_country = ?' : ''}
      ${term ? `AND (${CHANNEL_NAME} LIKE ? OR u.display_name LIKE ? OR u.channel_about LIKE ? OR u.church LIKE ?)` : ''}
      ORDER BY subscribers DESC, uploads DESC, channel_name LIMIT 200`).all(...args);
    res.json(rows.map((r) => ({ ...r, thumb_url: r.thumb ? `/media/thumbs/${r.thumb}` : null })));
  });

  // Name and describe your own channel.
  app.patch('/api/channels/me', auth, async (req, res) => {
    const name = String(req.body?.channel_name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const about = String(req.body?.channel_about ?? '').trim().slice(0, 1000);
    const country = String(req.body?.channel_country ?? '').toUpperCase();
    if (!isCountry(country)) return res.status(400).json({ error: 'Please choose your country.' });
    const v = await screen(req.user, `${name}\n${about}`, 'channel');
    if (!v.allowed || v.flagged) return res.status(422).json({ error: v.reason || 'Please keep your channel respectful.' });
    q('UPDATE users SET channel_name = ?, channel_about = ?, channel_country = ? WHERE id = ?').run(name, about, country, req.user.id);
    res.json({ channel_name: name || req.user.display_name, channel_about: about, channel_country: country });
  });

  app.get('/api/channels/:id', auth, (req, res) => {
    const u = userById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Channel not found.' });
    const subscribers = q('SELECT COUNT(*) AS n FROM subscriptions WHERE channel_id = ?').get(u.id).n;
    const subscribed = Boolean(q('SELECT 1 FROM subscriptions WHERE channel_id = ? AND subscriber_id = ?').get(u.id, req.user.id));
    res.json({ ...publicUser(u), channel_name: u.channel_name || u.display_name, channel_about: u.channel_about || '', channel_country: u.channel_country || '', has_custom_name: Boolean(u.channel_name), subscribers, subscribed });
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
