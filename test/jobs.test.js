import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.MEDIA_DIR = (await import('node:os')).tmpdir() + '/gb-test-media';
const { server, io } = await import('../server/index.js');
const { db } = await import('../server/db.js');

let base;
before(async () => { await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => { io.close(); server.close(); });

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
const login = async (username, password) => (await call('/auth/login', { method: 'POST', body: { username, password } })).data.token;
const register = async (username) => (await call('/auth/register', { method: 'POST', body: { username, password: 'password123', display_name: 'Test ' + username } })).data.token;

const profile = {
  full_name: 'Mary Achieng', title: 'Registered Nurse', phone: '+254 712 345 678', email: 'mary@example.com', location: 'Kisumu, Kenya',
  education: [{ qualification: 'Diploma in Nursing', school: 'Kendu Adventist School of Nursing', years: '2015 – 2018' }, {}],
  experience: [{ role: 'Nurse', employer: 'Kendu Adventist Hospital', years: '2019 – now', duties: 'Ward care' }],
  skills: 'Patient care, First aid', referees: [{ name: 'Pr. Otieno', position: 'Pastor', contact: '+254 700 111 222' }], bogus: 'dropped',
};

test('a new account saves applicant details and applies once', async () => {
  const admin = await login('admin', 'changeme123');
  const job = db.prepare(`SELECT id FROM content WHERE section = 'jobs' ORDER BY id LIMIT 1`).get();
  const t = await register('mary');

  let r = await call('/applicant', { token: t });
  assert.equal(r.data.saved, false);
  assert.equal(r.data.profile.full_name, 'Test mary');

  r = await call('/applicant', { token: t, method: 'PUT', body: { full_name: 'Mary' } });
  assert.equal(r.status, 400, 'needs a phone or email');

  r = await call('/applicant', { token: t, method: 'PUT', body: profile });
  assert.equal(r.status, 200);
  assert.equal(r.data.profile.education.length, 1, 'empty entries are dropped');
  assert.equal(r.data.profile.bogus, undefined);

  r = await call(`/jobs/${job.id}/apply`, { token: t, method: 'POST', body: { profile, cover_letter: 'I would love to serve.' } });
  assert.equal(r.status, 200);
  const appId = r.data.application.id;
  r = await call(`/jobs/${job.id}/apply`, { token: t, method: 'POST', body: { profile } });
  assert.equal(r.status, 409);

  r = await call('/jobs/summary', { token: t });
  assert.equal(r.data.applied[job.id].status, 'submitted');
  assert.deepEqual(r.data.review, {});

  // Other members cannot see applications; the poster (admin here) can.
  const other = await register('peter');
  assert.equal((await call(`/jobs/${job.id}/applications`, { token: other })).status, 404);
  r = await call(`/jobs/${job.id}/applications`, { token: admin });
  assert.equal(r.data.applications.length, 1);
  assert.equal(r.data.applications[0].profile.full_name, 'Mary Achieng');
  assert.equal(r.data.applications[0].cover_letter, 'I would love to serve.');

  assert.equal((await call(`/applications/${appId}/status`, { token: other, method: 'POST', body: { status: 'shortlisted' } })).status, 403);
  r = await call(`/applications/${appId}/status`, { token: admin, method: 'POST', body: { status: 'shortlisted' } });
  assert.equal(r.data.status_label, 'Shortlisted');
  r = await call('/applications/mine', { token: t });
  assert.equal(r.data[0].status, 'shortlisted');
});

test('applications close after the deadline', async () => {
  const t = await register('late');
  const id = db.prepare(`INSERT INTO content (section, title, meta) VALUES ('jobs', 'Old job', '{"deadline":"2020-01-01"}')`).run().lastInsertRowid;
  const r = await call(`/jobs/${id}/apply`, { token: t, method: 'POST', body: { profile } });
  assert.equal(r.status, 400);
});
