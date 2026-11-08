// Floating "Give" button and the donation sheet it opens.
import { api, esc, toast } from './app.js';

const $ = (sel, el = document) => el.querySelector(sel);

// Pages where the button would cover something important (typing a message, uploading).
const HIDE_ON = [/^#\/chats\/\d+/, /^#\/videos\/upload/, /^#\/admin/];

export function mountDonateButton() {
  if ($('#giveFab')) return;
  document.body.insertAdjacentHTML('beforeend',
    `<button id="giveFab" class="give-fab" title="Give / Donate" aria-label="Give or donate"><span class="gi">♥</span><span class="gl">Give</span></button>`);
  const fab = $('#giveFab');
  fab.onclick = openDonate;
  const sync = () => { fab.hidden = HIDE_ON.some((r) => r.test(location.hash)); };
  window.addEventListener('hashchange', sync);
  sync();
}

const copyRow = (label, value) => value ? `<div class="give-row"><div><div class="muted small">${label}</div><b>${esc(value)}</b></div>
  <button type="button" class="btn small ghost" data-copy="${esc(value)}">Copy</button></div>` : '';

async function openDonate() {
  let d;
  try { d = await api('/donate'); } catch (err) { return toast(err.message, true); }
  const dlg = document.createElement('dialog');
  dlg.className = 'give-sheet';
  const view = () => {
    const mpesa = d.mpesa_paybill || d.mpesa_till;
    dlg.innerHTML = `<div class="give-head"><span class="give-heart">♥</span><div><h2>${esc(d.title)}</h2></div>
        <button type="button" class="iconbtn" data-close aria-label="Close">✕</button></div>
      <p class="muted">${esc(d.message)}</p>
      ${!d.ready ? `<div class="card small">Donation details are coming soon.${d.canEdit ? ' Tap <b>Set up giving</b> to add PayPal, card, M-Pesa or bank details.' : ''}</div>` : ''}
      ${d.paypal_url || d.card_url ? `<div class="give-online">
        ${d.paypal_url ? `<a class="give-pay paypal" href="${esc(d.paypal_url)}" target="_blank" rel="noopener"><span class="pp">Pay<i>Pal</i></span><small>Give with PayPal</small></a>` : ''}
        ${d.card_url ? `<a class="give-pay card" href="${esc(d.card_url)}" target="_blank" rel="noopener"><span>💳 Credit / debit card</span><small>Visa · Mastercard</small></a>` : ''}
      </div>` : ''}
      ${mpesa ? `<section class="give-box"><div class="give-box-h">📱 M-Pesa</div>
        ${d.mpesa_paybill ? `<ol class="give-steps small"><li>M-Pesa › <b>Lipa na M-Pesa</b> › <b>Pay Bill</b></li><li>Enter the business number and account below</li><li>Enter the amount and your PIN</li></ol>` : `<ol class="give-steps small"><li>M-Pesa › <b>Lipa na M-Pesa</b> › <b>Buy Goods and Services</b></li><li>Enter the till number below, the amount and your PIN</li></ol>`}
        ${copyRow('Paybill (business number)', d.mpesa_paybill)}${copyRow('Account number', d.mpesa_account)}${copyRow('Till number', d.mpesa_till)}</section>` : ''}
      ${d.bank ? `<section class="give-box"><div class="give-box-h">🏦 Bank transfer</div><div class="give-bank">${esc(d.bank)}</div>
        <button type="button" class="btn small ghost" data-copy="${esc(d.bank)}" style="margin-top:8px">Copy bank details</button></section>` : ''}
      <p class="muted small give-thanks">Thank you, and God bless you! 🙏</p>
      ${d.canEdit ? `<button type="button" class="btn ghost small" data-edit style="width:100%">✏️ ${d.ready ? 'Edit giving details' : 'Set up giving'}</button>` : ''}`;
  };
  const edit = () => {
    const f = (name, label, ph = '', type = 'text') => `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(d[name])}" placeholder="${esc(ph)}"></label>`;
    dlg.innerHTML = `<div class="give-head"><h2 style="flex:1">Giving details</h2><button type="button" class="iconbtn" data-close aria-label="Close">✕</button></div>
      <form id="giveForm">
        ${f('title', 'Heading')}
        <label class="field"><span>Message</span><textarea name="message" rows="3">${esc(d.message)}</textarea></label>
        <p class="small muted" style="margin:4px 0 8px">Fill in only what you use. Leave the rest empty.</p>
        ${f('paypal_url', 'PayPal link', 'e.g. paypal.me/yourname')}
        ${f('card_url', 'Credit card payment link', 'e.g. a Stripe, Flutterwave or Paystack payment link')}
        ${f('mpesa_paybill', 'M-Pesa Paybill number', 'e.g. 123456')}
        ${f('mpesa_account', 'Paybill account number', 'e.g. GOSPEL or your phone number')}
        ${f('mpesa_till', 'M-Pesa Till number (Buy Goods)', 'e.g. 987654')}
        <label class="field"><span>Bank details</span><textarea name="bank" rows="3" placeholder="Bank, branch, account name and number">${esc(d.bank)}</textarea></label>
        <div class="row"><button class="btn">Save</button><button type="button" class="btn ghost" data-back>Cancel</button></div>
      </form>`;
    $('#giveForm', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try { d = await api('/donate', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); toast('Giving details saved'); view(); }
      catch (err) { toast(err.message, true); }
    };
  };
  dlg.onclick = async (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    if (e.target.closest('[data-edit]')) return edit();
    if (e.target.closest('[data-back]')) return view();
    const c = e.target.closest('[data-copy]');
    if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); toast('Copied'); } catch { toast('Could not copy. Please write it down.', true); } }
  };
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  view();
  dlg.showModal();
}
