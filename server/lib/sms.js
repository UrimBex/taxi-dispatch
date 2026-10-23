// Outbound text messages (currently just the sign-in verification code). Provider is chosen by
// NOTIFICATION_PROVIDER in .env:
//   mock   — nothing is sent; the code is logged and returned to the browser so a demo works with no account.
//            NEVER use this on a real install: anyone can then sign in as any rider by typing their number.
//   twilio — real SMS through Twilio's REST API (plain HTTPS, no SDK). Needs TWILIO_ACCOUNT_SID,
//            TWILIO_AUTH_TOKEN and either TWILIO_FROM (a number/alphanumeric sender) or
//            TWILIO_MESSAGING_SERVICE_SID. Check Twilio's price and sender rules for +383 numbers first.
// Another provider is a small addition here — sendSms() is the only thing the rest of the app calls.
'use strict';

const provider = () => String(process.env.NOTIFICATION_PROVIDER || 'mock').toLowerCase();
const isMock = () => provider() === 'mock';

const LANGS = ['sq', 'en', 'sr'];
const OTP_TEXT = {
  sq: c => `Kodi juaj i verifikimit për Taxi Ardi: ${c}. Vlen 5 minuta.`,
  en: c => `Your Taxi Ardi verification code: ${c}. Valid for 5 minutes.`,
  sr: c => `Vaš verifikacioni kod za Taxi Ardi: ${c}. Važi 5 minuta.`
};
const otpText = (code, lang) => (OTP_TEXT[LANGS.includes(lang) ? lang : 'sq'])(code);

/** Throws at startup (not on the first rider's sign-in) if the chosen provider isn't fully configured. */
function assertConfigured() {
  const p = provider();
  if (p === 'mock') return;
  if (p !== 'twilio') throw new Error(`NOTIFICATION_PROVIDER="${p}" is not supported (use "mock" or "twilio").`);
  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'].filter(k => !process.env[k]);
  if (!process.env.TWILIO_FROM && !process.env.TWILIO_MESSAGING_SERVICE_SID) missing.push('TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID)');
  if (missing.length) throw new Error(`NOTIFICATION_PROVIDER="twilio" but these are not set in .env: ${missing.join(', ')}`);
}

async function sendSms(to, body) {
  if (isMock()) { console.log(`[sms mock] to ${to}: ${body}`); return; }
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  const form = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', process.env.TWILIO_FROM);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Twilio responded ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

module.exports = { isMock, otpText, assertConfigured, sendSms, LANGS };
