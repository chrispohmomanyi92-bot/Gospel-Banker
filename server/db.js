import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import bcrypt from 'bcryptjs';
import { SECTIONS, SEED_CONTENT } from './seed.js';

const DB_PATH = process.env.DB_PATH || './data/gospel-banker.db';
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',          -- member | moderator | admin
  headline TEXT DEFAULT '',                      -- e.g. "Nurse at Adventist Hospital"
  church TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  strikes INTEGER NOT NULL DEFAULT 0,
  muted_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,                                     -- null for direct chats
  is_group INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'post',             -- post | prayer | testimony
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS post_likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  url TEXT DEFAULT '',
  source TEXT DEFAULT '',                        -- ministry / author / institution
  meta TEXT DEFAULT '{}',                        -- JSON: location, deadline, duration, price...
  status TEXT NOT NULL DEFAULT 'approved',       -- pending | approved | rejected
  submitted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_content_section ON content(section, status);
CREATE TABLE IF NOT EXISTS moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  context TEXT NOT NULL,                         -- message | post | comment | content
  original TEXT NOT NULL,
  verdict TEXT NOT NULL,                         -- blocked | masked
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export { SECTIONS };

export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return false;

  const hash = (p) => bcrypt.hashSync(p, 10);
  const addUser = db.prepare(
    'INSERT INTO users (username, display_name, password_hash, role, headline, church) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const adminPass = process.env.ADMIN_PASSWORD || 'changeme123';
  const admin = addUser.run('admin', 'Gospel Banker Admin', hash(adminPass), 'admin', 'App administrator', '').lastInsertRowid;
  const addPost = db.prepare('INSERT INTO posts (author_id, body, kind) VALUES (?, ?, ?)');
  const addContent = db.prepare(
    'INSERT INTO content (section, title, summary, url, source, meta, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const c of SEED_CONTENT) {
    addContent.run(c.section, c.title, c.summary || '', c.url || '', c.source || '', JSON.stringify(c.meta || {}), admin);
  }
  addPost.run(admin, 'Welcome to The Gospel Banker! Share testimonies, prayer requests and encouragement. Please keep every word kind: messages are filtered for abusive language.', 'post');

  // Demo members and conversations for local testing. Production installs set SEED_DEMO=false.
  if (process.env.SEED_DEMO === 'false') return true;
  const grace = addUser.run('grace', 'Grace Wanjiru', hash('password123'), 'member', 'Nurse · Health ministries leader', 'Nairobi Central SDA').lastInsertRowid;
  const daniel = addUser.run('daniel', 'Daniel Otieno', hash('password123'), 'member', 'Youth leader · Software developer', 'Kisumu Milimani SDA').lastInsertRowid;

  const addConv = db.prepare('INSERT INTO conversations (name, is_group, created_by) VALUES (?, ?, ?)');
  const addMember = db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)');
  const addMsg = db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)');
  const group = addConv.run('Youth Bible Study', 1, admin).lastInsertRowid;
  for (const u of [admin, grace, daniel]) addMember.run(group, u);
  addMsg.run(group, daniel, 'Happy Sabbath everyone! This week we are in Daniel 2.');
  addMsg.run(group, grace, 'Amen! I will bring the study guide printouts.');
  addPost.run(grace, 'Our church is hosting a free health expo next Sunday: blood pressure checks, cooking demos and a talk on the 8 laws of health. All are welcome!', 'post');
  addPost.run(daniel, 'Please pray for our youth team travelling for a week of evangelism.', 'prayer');
  return true;
}
