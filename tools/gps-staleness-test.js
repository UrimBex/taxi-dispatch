// Verifies the 30s GPS staleness fallback actually fires. Usage: node tools/gps-staleness-test.js [base]
'use strict';
const BASE = process.argv[2] || 'http://127.0.0.1:4010';
const WebSocket = require('ws');
function extractCookie(res) { const sc = res.headers.get('set-cookie'); return sc ? sc.split(';')[0] : null; }
async function jsonFetch(path, opts, cookie) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts && opts.headers);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: extractCookie(res) || cookie };
}
function connectWs(cookie) { return new Promise((resolve, reject) => { const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie } }); ws.once('open', () => resolve(ws)); ws.once('error', reject); }); }
function waitFor(ws, pred, timeoutMs) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), timeoutMs || 5000); ws.on('message', raw => { const m = JSON.parse(raw); if (pred(m)) { clearTimeout(t); resolve(m); } }); }); }
function rpc(ws, name, args) { const id = Math.floor(Math.random() * 1e9); ws.send(JSON.stringify({ type: 'action', id, name, args: args || {} })); return waitFor(ws, m => m.type === 'result' && m.id === id); }

async function main() {
  let r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'superadmin', password: 'super-admin-pass' }) });
  const superCookie = r.cookie;
  r = await jsonFetch('/api/admin/companies', {}, superCookie);
  const company = r.body[0];
  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet`, {}, superCookie);
  const freeSlot = r.body.find(s => !s.username);
  const username = 'stale-test-' + Date.now(), password = 'stale-test-pass-123';
  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet/${freeSlot.slot}/driver`, { method: 'PUT', body: JSON.stringify({ name: 'Staleness Test Driver', username, password }) }, superCookie);
  r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  const myDriverId = r.body.driverId, cookie = r.cookie;

  const ws = await connectWs(cookie);
  await waitFor(ws, m => m.type === 'hello', 3000);
  await waitFor(ws, m => m.type === 'state', 3000);
  await rpc(ws, 'setOnline', { online: true });
  await rpc(ws, 'updateLocation', { lat: 42.66294, lng: 21.16734 });
  await new Promise(res => setTimeout(res, 500));
  let state = await waitFor(ws, m => m.type === 'state', 3000);
  console.log('immediately after GPS fix, gpsTracked =', state.state.drivers.find(d => d.id === myDriverId).gpsTracked);

  console.log('waiting 32s with no further GPS updates (checking every ~5s)...');
  for (let i = 0; i < 7; i++) {
    await new Promise(res => setTimeout(res, 5000));
    state = await waitFor(ws, m => m.type === 'state', 4000);
    const d = state.state.drivers.find(x => x.id === myDriverId);
    console.log(`  t+${(i + 1) * 5}s: gpsTracked =`, d.gpsTracked);
    if (!d.gpsTracked) { console.log('\nStaleness fallback fired correctly.'); ws.close(); return; }
  }
  console.log('\nFAILED: gpsTracked never reverted to false after 35s.');
  ws.close(); process.exitCode = 1;
}
main().catch(err => { console.error('STALENESS TEST FAILED:', err); process.exit(1); });
