// Applying for jobs: every member keeps one "CV" (applicant details) that is
// reused for each application, can download it as a ready-made CV, or download
// a blank CV template. Whoever posted a job (or a moderator) sees its applicants.
import { api, esc, toast, state } from './app.js';

const $ = (sel, el = document) => el.querySelector(sel);
const when = (iso) => new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const isStaff = () => ['admin', 'moderator'].includes(state.user?.role);
const closed = (job) => /^\d{4}-\d{2}-\d{2}$/.test(job.meta?.deadline || '') && job.meta.deadline < new Date().toISOString().slice(0, 10);

// The repeatable parts of a CV, and the fields each entry has.
const GROUPS = {
  education: { label: 'Education', add: '+ Add school or college', fields: [['qualification', 'Qualification, e.g. KCSE, Diploma in Nursing'], ['school', 'School, college or university'], ['years', 'Years, e.g. 2016 – 2019']] },
  experience: { label: 'Work experience', add: '+ Add a job', fields: [['role', 'Job title'], ['employer', 'Employer'], ['years', 'Years, e.g. 2020 – now'], ['duties', 'What you did and achieved', 'textarea']] },
  referees: { label: 'Referees', add: '+ Add a referee', fields: [['name', 'Name'], ['position', 'Position, e.g. Pastor, Kisii SDA Church'], ['contact', 'Phone or email']] },
};

// ---------- Jobs page: Apply / Applications buttons on each listing ----------
export async function decorateJobCards(view) {
  let info;
  try { info = await api('/jobs/summary'); } catch { return; }
  view.querySelectorAll('article[data-job]').forEach((card) => {
    const id = card.dataset.job;
    const mine = info.applied[id];
    const review = info.review[id];
    const bar = document.createElement('div');
    bar.className = 'job-actions';
    bar.innerHTML = (mine && mine.status !== 'withdrawn'
      ? `<a class="btn small ghost" href="#/jobs/apply/${id}">✓ Applied · ${esc(mine.label)}</a>`
      : `<a class="btn small gold" href="#/jobs/apply/${id}">Apply now</a>`)
      + (review ? `<a class="btn small ghost" href="#/jobs/applications/${id}">📋 Applications (${review.count})${review.new ? ` <span class="pill-new">${review.new} new</span>` : ''}</a>` : '');
    card.append(bar);
  });
  const head = document.createElement('a');
  head.className = 'card row cv-banner';
  head.href = '#/jobs/cv';
  head.innerHTML = `<span style="font-size:1.6rem">📄</span><div style="flex:1"><b>My CV & applications</b><div class="muted small">Save your details once, apply in a tap, and download your CV or a blank CV template.</div></div><span>›</span>`;
  view.querySelector('.page > p.muted')?.after(head);
}

// ---------- routes: #/jobs/apply/:id, #/jobs/cv, #/jobs/cv/preview, #/jobs/applications/:id ----------
export async function renderJobs(view, [sub, arg] = []) {
  if (sub === 'apply') return renderApply(view, arg);
  if (sub === 'applications') return renderApplications(view, arg);
  if (sub === 'cv' && arg === 'preview') return renderPreview(view);
  return renderMyCv(view);
}

// ---------- the CV form (shared by "My CV" and "Apply") ----------
function entryHtml(group, e = {}) {
  const g = GROUPS[group];
  return `<div class="cv-entry" data-group="${group}">
    ${g.fields.map(([k, label, type]) => type === 'textarea'
      ? `<label class="field"><span>${label}</span><textarea data-k="${k}" rows="3">${esc(e[k])}</textarea></label>`
      : `<label class="field"><span>${label}</span><input type="text" data-k="${k}" value="${esc(e[k])}"></label>`).join('')}
    <button type="button" class="link-btn danger-text" data-remove>Remove</button></div>`;
}

function cvFormHtml(p) {
  const f = (name, label, value, attrs = '') => `<label class="field"><span>${label}</span><input ${attrs.includes('type=') ? '' : 'type="text" '}name="${name}" value="${esc(value)}" ${attrs}></label>`;
  const group = (key) => `<fieldset class="cv-group"><legend>${GROUPS[key].label}</legend>
      <div data-list="${key}">${(p[key]?.length ? p[key] : key === 'referees' ? [] : [{}]).map((e) => entryHtml(key, e)).join('')}</div>
      <button type="button" class="btn small ghost" data-add="${key}">${GROUPS[key].add}</button></fieldset>`;
  return `<fieldset class="cv-group"><legend>About you</legend>
      ${f('full_name', 'Full name', p.full_name, 'required autocomplete="name"')}
      ${f('title', 'Profession or the job you do, e.g. Registered Nurse', p.title)}
      <div class="two">${f('phone', 'Phone', p.phone, 'type="tel" autocomplete="tel" placeholder="+254 7…"')}${f('email', 'Email', p.email, 'type="email" autocomplete="email"')}</div>
      <div class="two">${f('location', 'Where you live', p.location, 'placeholder="Town, Country"')}${f('date_of_birth', 'Date of birth (optional)', p.date_of_birth, 'type="date"')}</div>
      ${f('church', 'Home church (optional)', p.church)}
      <label class="field"><span>Short profile: who you are and what you are good at</span><textarea name="summary" rows="4">${esc(p.summary)}</textarea></label>
    </fieldset>
    ${group('education')}${group('experience')}
    <fieldset class="cv-group"><legend>Skills & more</legend>
      <label class="field"><span>Skills (separate with commas)</span><textarea name="skills" rows="2" placeholder="Patient care, Microsoft Excel, Teaching, Driving…">${esc(p.skills)}</textarea></label>
      ${f('languages', 'Languages', p.languages, 'placeholder="English, Kiswahili"')}
      <label class="field"><span>Certificates, licences and awards (optional)</span><textarea name="certifications" rows="2">${esc(p.certifications)}</textarea></label>
    </fieldset>
    ${group('referees')}`;
}

function wireCvForm(form) {
  form.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const listEl = form.querySelector(`[data-list="${add.dataset.add}"]`);
      if (listEl.children.length >= (add.dataset.add === 'referees' ? 4 : 8)) return toast('That is the most you can add here.', true);
      listEl.insertAdjacentHTML('beforeend', entryHtml(add.dataset.add));
      listEl.lastElementChild.querySelector('input,textarea')?.focus();
    }
    if (e.target.closest('[data-remove]')) e.target.closest('.cv-entry').remove();
  });
}

function readCvForm(form) {
  const p = Object.fromEntries([...form.querySelectorAll('[name]')].filter((el) => el.closest('.cv-group') && el.name !== 'cover_letter').map((el) => [el.name, el.value.trim()]));
  for (const key of Object.keys(GROUPS)) {
    p[key] = [...form.querySelectorAll(`[data-list="${key}"] .cv-entry`)]
      .map((row) => Object.fromEntries([...row.querySelectorAll('[data-k]')].map((el) => [el.dataset.k, el.value.trim()])))
      .filter((e) => Object.values(e).some(Boolean));
  }
  return p;
}

const downloadsHtml = (saved) => `<div class="cv-downloads">
    <button type="button" class="btn small ghost" data-dl="mine" ${saved ? '' : 'disabled title="Save your details first"'}>⬇️ My CV (Word)</button>
    <a class="btn small ghost" href="#/jobs/cv/preview" ${saved ? '' : 'hidden'}>👁️ View / print PDF</a>
    <button type="button" class="btn small ghost" data-dl="blank">📝 Blank CV template</button></div>`;

function wireDownloads(root, getProfile) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dl]');
    if (!b) return;
    if (b.dataset.dl === 'blank') downloadCv(null);
    else downloadCv(getProfile());
  });
}

// ---------- My CV ----------
async function renderMyCv(view) {
  const [{ profile, saved }, apps] = await Promise.all([api('/applicant'), api('/applications/mine')]);
  let current = profile;
  view.innerHTML = `<div class="page narrow">
    <a href="#/library/jobs" class="muted small" style="text-decoration:none">← Jobs</a>
    <h2 style="margin-top:6px">📄 My CV</h2>
    <p class="muted">Fill this in once. It is saved to your account and used every time you apply for a job here.${profile.updated_at ? ` Last saved ${when(profile.updated_at)}.` : ''}</p>
    <div class="card"><b>Download</b><p class="muted small" style="margin:4px 0 10px">Your CV opens in Word, WPS or Google Docs, where you can still edit it. The blank template has example headings to fill in yourself.</p>${downloadsHtml(saved)}</div>
    <form class="card cv-form" id="cvForm">${cvFormHtml(profile)}
      <button class="btn gold" style="width:100%;padding:12px">Save my details</button></form>
    <h3 style="margin-top:20px">My applications (${apps.length})</h3>
    ${apps.length ? apps.map((a) => `<a class="card row app-row" href="#/jobs/apply/${a.job_id}"><div style="flex:1;min-width:0"><b>${esc(a.title)}</b>
        <div class="muted small">${esc(a.source)}${a.meta.location ? ' · ' + esc(a.meta.location) : ''} · Applied ${when(a.created_at)}</div></div>
        <span class="status s-${a.status}">${esc(a.status_label)}</span></a>`).join('')
      : '<div class="empty" style="padding:20px">No applications yet. <a href="#/library/jobs">Browse jobs</a></div>'}</div>`;
  const form = $('#cvForm', view);
  wireCvForm(form);
  wireDownloads(view, () => current);
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/applicant', { method: 'PUT', body: readCvForm(form) });
      current = r.profile;
      toast('Your details are saved');
      view.querySelector('.cv-downloads').outerHTML = downloadsHtml(true);
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- Apply ----------
function jobHeadHtml(job) {
  const m = job.meta || {};
  return `<div class="card job-head"><span class="tag">Job</span><h2 style="margin:8px 0 2px">${esc(job.title)}</h2>
    <div class="muted">${esc(job.source)}</div>
    <div class="kv">${m.location ? `<span>📍 ${esc(m.location)}</span>` : ''}${m.type ? `<span>🕒 ${esc(m.type)}</span>` : ''}${m.deadline ? `<span>📅 Apply by ${esc(m.deadline)}</span>` : ''}</div>
    ${job.summary ? `<p style="margin:10px 0 0">${esc(job.summary)}</p>` : ''}
    ${job.url ? `<a class="small" href="${esc(job.url)}" target="_blank" rel="noopener">Full job details ↗</a>` : ''}</div>`;
}

async function renderApply(view, jobId) {
  const [job, { profile, saved }] = await Promise.all([api('/jobs/' + jobId), api('/applicant')]);
  const mine = job.my_application;
  const back = `<a href="#/library/jobs" class="muted small" style="text-decoration:none">← Jobs</a>`;
  if (mine && mine.status !== 'withdrawn') {
    view.innerHTML = `<div class="page narrow">${back}${jobHeadHtml(job)}
      <div class="card applied-box"><div style="font-size:2rem">✅</div><h3>You applied on ${when(mine.created_at)}</h3>
        <p>Status: <span class="status s-${mine.status}">${esc(mine.status_label)}</span></p>
        <p class="muted small">The employer has your details and will contact you by ${esc([mine.profile.phone, mine.profile.email].filter(Boolean).join(' or '))}. You will also get a message here in the app when they reply.</p>
        <div class="cv-downloads"><button type="button" class="btn small ghost" data-dl="mine">⬇️ The CV I sent (Word)</button>
        ${mine.status === 'submitted' ? '<button type="button" class="btn small ghost danger-text" id="withdrawBtn">Withdraw application</button>' : ''}</div></div>
      ${job.can_review ? `<a class="btn ghost" href="#/jobs/applications/${job.id}" style="text-decoration:none">📋 See applications for this job</a>` : ''}</div>`;
    wireDownloads(view, () => mine.profile);
    const w = $('#withdrawBtn', view);
    if (w) w.onclick = async () => {
      if (!confirm('Withdraw your application for this job?')) return;
      try { await api(`/applications/${mine.id}/status`, { method: 'POST', body: { status: 'withdrawn' } }); toast('Application withdrawn'); renderApply(view, jobId); }
      catch (err) { toast(err.message, true); }
    };
    return;
  }
  if (closed(job)) {
    view.innerHTML = `<div class="page narrow">${back}${jobHeadHtml(job)}<div class="empty">Applications for this job closed on ${esc(job.meta.deadline)}.</div></div>`;
    return;
  }
  view.innerHTML = `<div class="page narrow">${back}${jobHeadHtml(job)}
    <form id="applyForm">
      <div class="steps"><span class="on">1 · Your details</span><span>2 · Cover letter</span><span>3 · Send</span></div>
      <div class="card">${saved
        ? `<div class="row"><span style="font-size:1.4rem">💾</span><div style="flex:1"><b>Using your saved details</b><div class="muted small">Check them below. Any changes are saved to your CV for next time.</div></div></div>`
        : `<div class="row"><span style="font-size:1.4rem">👋</span><div style="flex:1"><b>First application? Fill in your CV once</b><div class="muted small">It is saved to your account, so the next job takes one tap.</div></div></div>`}
        <div style="margin-top:10px">${downloadsHtml(saved)}</div></div>
      <div class="card cv-form">${cvFormHtml(profile)}</div>
      <div class="card"><fieldset class="cv-group"><legend>Cover letter (optional)</legend>
        <label class="field"><span>Why you are a good fit for this job</span><textarea name="cover_letter" rows="6" maxlength="3000" placeholder="Dear Sir/Madam, I am applying for…"></textarea></label></fieldset></div>
      <button class="btn gold" style="width:100%;padding:14px;font-size:1.05rem">Send application</button>
      <p class="muted small" style="text-align:center">Your details go to ${esc(job.source || 'the employer')} and the app's moderators only.</p>
    </form></div>`;
  const form = $('#applyForm', view);
  wireCvForm(form);
  wireDownloads(view, () => readCvForm(form));
  // Highlight the step the person is on as they scroll down the form.
  form.addEventListener('focusin', (e) => {
    const step = e.target.name === 'cover_letter' ? 1 : 0;
    form.querySelectorAll('.steps span').forEach((s, i) => s.classList.toggle('on', i <= step));
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button.gold');
    btn.disabled = true;
    form.querySelectorAll('.steps span').forEach((s) => s.classList.add('on'));
    try {
      await api(`/jobs/${job.id}/apply`, { method: 'POST', body: { profile: readCvForm(form), cover_letter: form.cover_letter.value } });
      toast('Application sent. God bless!');
      renderApply(view, jobId);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

// ---------- applications for a job (poster or moderators) ----------
async function renderApplications(view, jobId) {
  const { job, applications } = await api(`/jobs/${jobId}/applications`);
  const byId = new Map(applications.map((a) => [a.id, a]));
  view.innerHTML = `<div class="page narrow"><a href="#/library/jobs" class="muted small" style="text-decoration:none">← Jobs</a>
    <h2 style="margin-top:6px">📋 Applications</h2><p class="muted" style="margin-top:-4px">${esc(job.title)} · ${esc(job.source)}</p>
    ${!isStaff() ? '' : '<p class="muted small">You can see these because you are a moderator.</p>'}
    ${applications.length ? applications.map(applicantCard).join('') : '<div class="empty">No applications yet. They will appear here, and you will get a message in Chats for each one.</div>'}</div>`;
  view.onclick = async (e) => {
    const card = e.target.closest('[data-app]');
    if (!card) return;
    const a = byId.get(Number(card.dataset.app));
    if (e.target.closest('[data-dl]')) return downloadCv(a.profile, a.cover_letter);
    if (e.target.closest('[data-toggle]')) { card.classList.toggle('open'); return; }
    const b = e.target.closest('[data-status]');
    if (!b) return;
    try {
      const r = await api(`/applications/${a.id}/status`, { method: 'POST', body: { status: b.dataset.status } });
      a.status = r.status; a.status_label = r.status_label;
      card.outerHTML = applicantCard(a);
      toast(r.status === 'shortlisted' ? 'Shortlisted. They have been sent a message.' : r.status === 'declined' ? 'Marked not selected. They have been told kindly.' : 'Updated');
    } catch (err) { toast(err.message, true); }
  };
}

function applicantCard(a) {
  const p = a.profile;
  const latest = p.experience?.[0];
  return `<article class="card applicant" data-app="${a.id}">
    <div class="row" data-toggle style="cursor:pointer"><div class="avatar">${esc((p.full_name || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase())}</div>
      <div style="flex:1;min-width:0"><b>${esc(p.full_name)}</b><div class="muted small">${esc(p.title || (latest ? `${latest.role} · ${latest.employer}` : ''))}</div>
      <div class="muted small">Applied ${when(a.created_at)}</div></div><span class="status s-${a.status}">${esc(a.status_label)}</span></div>
    <div class="applicant-body">
      <div class="kv">${p.phone ? `<span>📞 <a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a></span>` : ''}${p.email ? `<span>✉️ <a href="mailto:${esc(p.email)}">${esc(p.email)}</a></span>` : ''}${p.location ? `<span>📍 ${esc(p.location)}</span>` : ''}</div>
      ${a.cover_letter ? `<div class="eyebrow">Cover letter</div><p class="pre">${esc(a.cover_letter)}</p>` : ''}
      ${p.summary ? `<div class="eyebrow">Profile</div><p class="pre">${esc(p.summary)}</p>` : ''}
      ${p.experience?.length ? `<div class="eyebrow">Experience</div>${p.experience.map((x) => `<p><b>${esc(x.role)}</b>${x.employer ? ', ' + esc(x.employer) : ''} <span class="muted small">${esc(x.years)}</span>${x.duties ? `<br><span class="muted small">${esc(x.duties)}</span>` : ''}</p>`).join('')}` : ''}
      ${p.education?.length ? `<div class="eyebrow">Education</div>${p.education.map((x) => `<p><b>${esc(x.qualification)}</b>${x.school ? ', ' + esc(x.school) : ''} <span class="muted small">${esc(x.years)}</span></p>`).join('')}` : ''}
      ${p.skills ? `<div class="eyebrow">Skills</div><p>${esc(p.skills)}</p>` : ''}
      <div class="cv-downloads"><button type="button" class="btn small ghost" data-dl>⬇️ Download CV</button><a class="btn small ghost" href="#/profile/${a.applicant_id}">✉️ Message</a>
        ${a.status !== 'shortlisted' ? '<button type="button" class="btn small" data-status="shortlisted">⭐ Shortlist</button>' : ''}
        ${a.status !== 'declined' ? '<button type="button" class="btn small ghost danger-text" data-status="declined">Not selected</button>' : ''}</div>
    </div></article>`;
}

// ---------- the CV document ----------
const BLANK = {
  full_name: 'YOUR FULL NAME', title: 'Profession, e.g. Registered Nurse', phone: '+254 700 000 000', email: 'yourname@email.com', location: 'Town, Country',
  date_of_birth: 'DD/MM/YYYY', church: 'Home church (optional)',
  summary: 'Two or three sentences about who you are, your main strengths and the kind of work you are looking for.',
  experience: [{ role: 'Job title', employer: 'Employer name, Town', years: 'Start year – End year', duties: '• What you were responsible for\n• Something you achieved, with a number if you can' },
    { role: 'Job title', employer: 'Employer name, Town', years: 'Start year – End year', duties: '• Main duties\n• Achievements' }],
  education: [{ qualification: 'Degree / Diploma / Certificate', school: 'University or college', years: 'Start – End' }, { qualification: 'KCSE / O-Level / A-Level (grade)', school: 'Secondary school', years: 'Start – End' }],
  skills: 'Skill one, Skill two, Skill three, Computer skills', languages: 'English, Kiswahili', certifications: 'Licences, certificates or awards, with the year',
  referees: [{ name: 'Referee name', position: 'Position and organisation', contact: 'Phone · email' }, { name: 'Referee name', position: 'Pastor / Elder, Church name', contact: 'Phone · email' }],
};

// A clean, Word-friendly CV. Simple tables and inline styles so it looks the same in Word, WPS and Google Docs.
export function cvHtml(p, { coverLetter = '' } = {}) {
  const e = (s) => esc(s).replace(/\n/g, '<br>');
  const navy = '#14284b', gold = '#c8962c';
  const h = (t) => `<h2 style="font-family:Georgia,serif;font-size:13pt;color:${navy};border-bottom:2px solid ${gold};padding-bottom:3px;margin:18px 0 8px;text-transform:uppercase;letter-spacing:1px">${t}</h2>`;
  const rows = (items, fn) => `<table style="width:100%;border-collapse:collapse">${items.map(fn).join('')}</table>`;
  const contact = [p.phone, p.email, p.location].filter(Boolean).map(e).join(' &nbsp;|&nbsp; ');
  const personal = [p.date_of_birth && `<b>Date of birth:</b> ${e(p.date_of_birth)}`, p.church && `<b>Church:</b> ${e(p.church)}`, p.languages && `<b>Languages:</b> ${e(p.languages)}`].filter(Boolean);
  return `<div class="cv-doc" style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222;line-height:1.4">
    <div style="text-align:center;border-bottom:3px solid ${navy};padding-bottom:10px">
      <h1 style="font-family:Georgia,serif;font-size:24pt;color:${navy};margin:0;letter-spacing:1px">${e(p.full_name)}</h1>
      ${p.title ? `<div style="font-size:12pt;color:${gold};font-weight:bold;margin-top:2px">${e(p.title)}</div>` : ''}
      ${contact ? `<div style="font-size:10pt;margin-top:6px">${contact}</div>` : ''}</div>
    ${p.summary ? `${h('Profile')}<p style="margin:0">${e(p.summary)}</p>` : ''}
    ${p.experience?.length ? h('Work experience') + rows(p.experience, (x) => `<tr><td style="vertical-align:top;padding:4px 10px 8px 0"><b>${e(x.role)}</b>${x.employer ? `<br><i>${e(x.employer)}</i>` : ''}${x.duties ? `<div style="margin-top:3px">${e(x.duties)}</div>` : ''}</td><td style="vertical-align:top;text-align:right;white-space:nowrap;padding:4px 0;color:#555;width:28%">${e(x.years)}</td></tr>`) : ''}
    ${p.education?.length ? h('Education') + rows(p.education, (x) => `<tr><td style="vertical-align:top;padding:4px 10px 6px 0"><b>${e(x.qualification)}</b>${x.school ? `<br><i>${e(x.school)}</i>` : ''}</td><td style="vertical-align:top;text-align:right;white-space:nowrap;padding:4px 0;color:#555;width:28%">${e(x.years)}</td></tr>`) : ''}
    ${p.skills ? `${h('Skills')}<p style="margin:0">${p.skills.split(/\s*[,\n]\s*/).filter(Boolean).map(e).join(' &nbsp;•&nbsp; ')}</p>` : ''}
    ${p.certifications ? `${h('Certificates & awards')}<p style="margin:0">${e(p.certifications)}</p>` : ''}
    ${personal.length ? `${h('Personal details')}<p style="margin:0">${personal.join('<br>')}</p>` : ''}
    ${h('Referees')}${p.referees?.length ? rows([p.referees.slice(0, 2), p.referees.slice(2)].filter((r) => r.length), (pair) => `<tr>${pair.map((r) => `<td style="vertical-align:top;width:50%;padding:4px 10px 8px 0"><b>${e(r.name)}</b>${r.position ? `<br>${e(r.position)}` : ''}${r.contact ? `<br>${e(r.contact)}` : ''}</td>`).join('')}</tr>`) : '<p style="margin:0">Available on request.</p>'}
    ${coverLetter ? `<br style="page-break-before:always">${h('Cover letter')}<p>${e(coverLetter)}</p>` : ''}
  </div>`;
}

function downloadCv(profile, coverLetter = '') {
  const blank = !profile;
  const p = profile || BLANK;
  if (!blank && !p.full_name) return toast('Add your name first.', true);
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>CV</title>
    <style>@page { size: A4; margin: 2cm 2cm 2cm 2cm; } body { margin: 0; }</style></head><body>${cvHtml(p, { coverLetter })}</body></html>`;
  const blob = new Blob(['﻿', doc], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = blank ? 'CV-template.doc' : `CV-${p.full_name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}.doc`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(blank ? 'Blank CV template downloaded' : 'CV downloaded');
}

// ---------- preview: the CV on screen, ready to print or save as PDF ----------
async function renderPreview(view) {
  const { profile, saved } = await api('/applicant');
  if (!saved) { location.hash = '#/jobs/cv'; return; }
  view.innerHTML = `<div class="page narrow"><div class="no-print"><a href="#/jobs/cv" class="muted small" style="text-decoration:none">← My CV</a>
      <div class="cv-downloads" style="margin:10px 0"><button type="button" class="btn small gold" id="printBtn">🖨️ Print / Save as PDF</button><button type="button" class="btn small ghost" data-dl="mine">⬇️ Word</button><a class="btn small ghost" href="#/jobs/cv">✏️ Edit</a></div></div>
    <div class="cv-paper">${cvHtml(profile)}</div></div>`;
  wireDownloads(view, () => profile);
  $('#printBtn', view).onclick = () => window.print();
}
