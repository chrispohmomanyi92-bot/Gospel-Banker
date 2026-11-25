// Job applications: members keep one applicant profile (their CV details),
// reuse it to apply for openings on the Jobs page, and whoever posted the job
// (or a moderator) reviews the applications.
import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS applicant_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  applicant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile TEXT NOT NULL,                         -- copy of the applicant's details when they applied
  cover_letter TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted',      -- submitted | shortlisted | declined | withdrawn
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, applicant_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_job ON job_applications(job_id);
`);

export const STATUS_LABEL = { submitted: 'Received', shortlisted: 'Shortlisted', declined: 'Not selected', withdrawn: 'Withdrawn' };

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const list = (v, max, fields) => (Array.isArray(v) ? v : []).slice(0, max)
  .map((e) => Object.fromEntries(Object.entries(fields).map(([k, n]) => [k, str(e?.[k], n)])))
  .filter((e) => Object.values(e).some(Boolean));

// Keeps only known fields, trimmed to sensible sizes.
export function cleanProfile(p = {}) {
  return {
    full_name: str(p.full_name, 80),
    title: str(p.title, 100),                    // e.g. "Registered Nurse"
    email: str(p.email, 120),
    phone: str(p.phone, 30),
    location: str(p.location, 100),
    date_of_birth: str(p.date_of_birth, 20),
    church: str(p.church, 100),
    summary: str(p.summary, 1500),
    education: list(p.education, 8, { school: 100, qualification: 120, years: 30 }),
    experience: list(p.experience, 10, { employer: 100, role: 100, years: 30, duties: 800 }),
    skills: str(p.skills, 800),
    languages: str(p.languages, 200),
    certifications: str(p.certifications, 800),
    referees: list(p.referees, 4, { name: 80, position: 120, contact: 120 }),
  };
}

export function profileProblem(p) {
  if (!p.full_name) return 'Please enter your full name.';
  if (!p.phone && !p.email) return 'Please add a phone number or email so the employer can reach you.';
  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return 'That email address does not look right.';
  if (p.phone && !/^\+?[\d\s()-]{7,20}$/.test(p.phone)) return 'That phone number does not look right.';
  return null;
}

const profileText = (p) => [p.full_name, p.title, p.location, p.church, p.summary, p.skills, p.languages, p.certifications,
  ...p.education.flatMap(Object.values), ...p.experience.flatMap(Object.values), ...p.referees.flatMap(Object.values)].filter(Boolean).join('\n');

export function registerJobRoutes(app, { auth, isStaff, screen, directMessage }) {
  const q = (sql) => db.prepare(sql);
  const getJob = (id) => q(`SELECT * FROM content WHERE id = ? AND section = 'jobs'`).get(Number(id));
  const canReview = (job, user) => job.submitted_by === user.id || isStaff(user);
  const readProfile = (uid) => {
    const row = q('SELECT data, updated_at FROM applicant_profiles WHERE user_id = ?').get(uid);
    return row ? { ...cleanProfile(JSON.parse(row.data)), updated_at: row.updated_at } : null;
  };
  const saveProfile = (uid, p) => q(`INSERT INTO applicant_profiles (user_id, data) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`).run(uid, JSON.stringify(p));
  const base = (req) => process.env.PUBLIC_URL || `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
  const tell = (from, toId, text) => (from.id === toId ? null : directMessage(from, toId, text).catch((e) => console.error('job message failed', e)));
  const shapeApp = (a) => a && ({ ...a, profile: JSON.parse(a.profile), status_label: STATUS_LABEL[a.status] || a.status });

  // Checks the CV text and cover letter with the same language filter as posts.
  async function check(user, p, extra = '') {
    const v = await screen(user, `${profileText(p)}\n${extra}`.slice(0, 8000), 'application');
    return !v.allowed || v.flagged ? (v.reason || 'Please keep your details respectful.') : null;
  }

  app.get('/api/applicant', auth, (req, res) => {
    const saved = readProfile(req.user.id);
    res.json({ saved: Boolean(saved), profile: saved || { ...cleanProfile({ full_name: req.user.display_name, title: req.user.headline, church: req.user.church, summary: req.user.bio }), updated_at: null } });
  });

  app.put('/api/applicant', auth, async (req, res) => {
    const p = cleanProfile(req.body || {});
    const problem = profileProblem(p) || (await check(req.user, p));
    if (problem) return res.status(400).json({ error: problem });
    saveProfile(req.user.id, p);
    res.json({ saved: true, profile: readProfile(req.user.id) });
  });

  // For the Jobs page: which jobs I applied to, and how many applications wait on jobs I can review.
  app.get('/api/jobs/summary', auth, (req, res) => {
    const mine = q('SELECT job_id, status FROM job_applications WHERE applicant_id = ?').all(req.user.id);
    const reviewable = q(`SELECT c.id, COUNT(a.id) AS n, SUM(a.status = 'submitted') AS new_count FROM content c
      LEFT JOIN job_applications a ON a.job_id = c.id AND a.status != 'withdrawn'
      WHERE c.section = 'jobs' AND (c.submitted_by = ? OR ?) GROUP BY c.id`).all(req.user.id, isStaff(req.user) ? 1 : 0);
    res.json({
      applied: Object.fromEntries(mine.map((a) => [a.job_id, { status: a.status, label: STATUS_LABEL[a.status] }])),
      review: Object.fromEntries(reviewable.map((r) => [r.id, { count: r.n, new: r.new_count || 0 }])),
    });
  });

  app.get('/api/jobs/:id', auth, (req, res) => {
    const job = getJob(req.params.id);
    if (!job || (job.status !== 'approved' && !canReview(job, req.user))) return res.status(404).json({ error: 'Job not found.' });
    const mine = q('SELECT * FROM job_applications WHERE job_id = ? AND applicant_id = ?').get(job.id, req.user.id);
    res.json({ ...job, meta: JSON.parse(job.meta || '{}'), can_review: canReview(job, req.user), my_application: shapeApp(mine) || null });
  });

  app.post('/api/jobs/:id/apply', auth, async (req, res) => {
    const job = getJob(req.params.id);
    if (!job || job.status !== 'approved') return res.status(404).json({ error: 'This job is not open.' });
    const deadline = JSON.parse(job.meta || '{}').deadline;
    if (deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) && deadline < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'Applications for this job have closed.' });
    }
    const p = cleanProfile(req.body?.profile || {});
    const letter = str(req.body?.cover_letter, 3000);
    const problem = profileProblem(p) || (await check(req.user, p, letter));
    if (problem) return res.status(400).json({ error: problem });
    saveProfile(req.user.id, p); // so the details are ready for the next application
    const existing = q('SELECT * FROM job_applications WHERE job_id = ? AND applicant_id = ?').get(job.id, req.user.id);
    if (existing && existing.status !== 'withdrawn') return res.status(409).json({ error: 'You have already applied for this job.' });
    const a = existing
      ? q(`UPDATE job_applications SET profile = ?, cover_letter = ?, status = 'submitted', created_at = datetime('now'), updated_at = datetime('now') WHERE id = ? RETURNING *`).get(JSON.stringify(p), letter, existing.id)
      : q('INSERT INTO job_applications (job_id, applicant_id, profile, cover_letter) VALUES (?, ?, ?, ?) RETURNING *').get(job.id, req.user.id, JSON.stringify(p), letter);
    if (job.submitted_by) {
      tell(req.user, job.submitted_by, `💼 New application for "${job.title}" from ${p.full_name}${p.title ? ' (' + p.title + ')' : ''}.\nSee it here: ${base(req)}/#/jobs/applications/${job.id}`);
    }
    res.json({ application: shapeApp(a) });
  });

  app.get('/api/applications/mine', auth, (req, res) => {
    res.json(q(`SELECT a.id, a.job_id, a.status, a.created_at, c.title, c.source, c.meta FROM job_applications a JOIN content c ON c.id = a.job_id
      WHERE a.applicant_id = ? ORDER BY a.id DESC`).all(req.user.id).map((a) => ({ ...a, meta: JSON.parse(a.meta || '{}'), status_label: STATUS_LABEL[a.status] })));
  });

  app.get('/api/jobs/:id/applications', auth, (req, res) => {
    const job = getJob(req.params.id);
    if (!job || !canReview(job, req.user)) return res.status(404).json({ error: 'Only the person who posted this job, or a moderator, can see its applications.' });
    const rows = q(`SELECT a.*, u.username, u.display_name FROM job_applications a JOIN users u ON u.id = a.applicant_id
      WHERE a.job_id = ? AND a.status != 'withdrawn' ORDER BY a.id DESC`).all(job.id);
    res.json({ job: { ...job, meta: JSON.parse(job.meta || '{}') }, applications: rows.map(shapeApp) });
  });

  app.post('/api/applications/:id/status', auth, (req, res) => {
    const a = q('SELECT * FROM job_applications WHERE id = ?').get(Number(req.params.id));
    const job = a && getJob(a.job_id);
    if (!a || !job) return res.status(404).json({ error: 'Application not found.' });
    const status = req.body?.status;
    const own = a.applicant_id === req.user.id;
    if (own ? status !== 'withdrawn' : !canReview(job, req.user) || !['submitted', 'shortlisted', 'declined'].includes(status)) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    q(`UPDATE job_applications SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, a.id);
    if (!own && status !== 'submitted') {
      const text = status === 'shortlisted'
        ? `🎉 Good news: your application for "${job.title}" has been shortlisted. We will be in touch about the next step.`
        : `Thank you for applying for "${job.title}". We have chosen to go ahead with other candidates this time. God bless you in your search.`;
      tell(req.user, a.applicant_id, text);
    }
    res.json({ ok: true, status, status_label: STATUS_LABEL[status] });
  });
}
