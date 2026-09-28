// Manual smoke test for real GPS tracking (not part of the app). Usage: node tools/gps-smoke-test.js [http://127.0.0.1:4010]
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
function connectWs(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie } });
    ws.once('open', () => resolve(ws)); ws.once('error', reject);
  });
}
function waitFor(ws, pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs || 5000);
    ws.on('message', raw => { const msg = JSON.parse(raw); if (pred(msg)) { clearTimeout(t); resolve(msg); } });
  });
}
function rpc(ws, name, args) {
  const id = Math.floor(Math.random() * 1e9);
  ws.send(JSON.stringify({ type: 'action', id, name, args: args || {} }));
  return waitFor(ws, m => m.type === 'result' && m.id === id);
}

async function main() {
  // Creates its own dedicated test driver via the admin API (on the first free seat) rather than guessing at
  // whatever login already exists on the roster — self-contained and repeatable regardless of roster state.
  let r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'superadmin', password: 'super-admin-pass' }) });
  const superCookie = r.cookie;
  r = await jsonFetch('/api/admin/companies', {}, superCookie);
  const company = r.body[0];
  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet`, {}, superCookie);
  const freeSlot = r.body.find(s => !s.username);
  if (!freeSlot) throw new Error('Every seat already has a driver login — free one up first.');
  const username = 'gps-test-' + Date.now(), password = 'gps-test-pass-123';
  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet/${freeSlot.slot}/driver`, { method: 'PUT', body: JSON.stringify({ name: 'GPS Test Driver', username, password }) }, superCookie);
  console.log('driver login created on seat', freeSlot.slot, ':', r.status, r.body);
  r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  console.log('driver login:', r.status, r.body);
  if (r.status !== 200) throw new Error(`Could not log in as "${username}".`);
  const myDriverId = r.body.driverId, cookie = r.cookie;

  const ws = await connectWs(cookie);
  await waitFor(ws, m => m.type === 'hello', 3000);
  await waitFor(ws, m => m.type === 'state', 3000);

  console.log('\n== Go online ==');
  let res = await rpc(ws, 'setOnline', { online: true });
  console.log(res);

  console.log('\n== GPS fix WAY outside the service area (London) ==');
  res = await rpc(ws, 'updateLocation', { lat: 51.5074, lng: -0.1278 });
  console.log(res);

  console.log('\n== GPS fix at a real in-bounds point (Skanderbeg Square area) ==');
  res = await rpc(ws, 'updateLocation', { lat: 42.66294, lng: 21.16734 });
  console.log(res);

  await new Promise(r2 => setTimeout(r2, 400));
  const state1 = await waitFor(ws, m => m.type === 'state', 3000);
  const me1 = state1.state.drivers.find(d => d.id === myDriverId);
  console.log('driver after GPS fix — gpsTracked:', me1 && me1.gpsTracked, 'pos:', me1 && me1.pos, 'online:', me1 && me1.online);

  console.log('\n== Now create+force-assign a booking to this driver, then feed a GPS fix right at the pickup, expect atTarget/arrived proximity logic ==');
  // (uses the ops login seeded earlier)
  r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'ops', password: 'ops-demo-pass' }) });
  const opsCookie = r.cookie;
  const opsWs = await connectWs(opsCookie);
  await waitFor(opsWs, m => m.type === 'hello', 3000);
  const created = await rpc(opsWs, 'createBooking', { pickup: { x: me1.pos.x, y: me1.pos.y }, dropoff: { x: 300, y: 700 }, vehicle: 'standard', payment: 'card', phone: '+38349000111', name: 'GPS Test Rider' });
  console.log('booking created:', created.value.id, created.value.pickup.label);
  const assignRes = await rpc(opsWs, 'assign', { bookingId: created.value.id, driverId: me1.id });
  console.log('force-assigned:', assignRes.value);

  await new Promise(r2 => setTimeout(r2, 500));
  // feed a GPS fix at the exact pickup location — should flip status toward "arrived" via proximity, not path length
  console.log('\nsending GPS fix AT the pickup point...');
  res = await rpc(ws, 'updateLocation', { lat: 42.66294, lng: 21.16734 }); // same coord as pickup we set via me1.pos
  console.log(res);
  await new Promise(r2 => setTimeout(r2, 500));
  const state2 = await waitFor(ws, m => m.type === 'state', 3000);
  const b2 = state2.state.bookings.find(b => b.id === created.value.id);
  const d2 = state2.state.drivers.find(d => d.id === me1.id);
  console.log('booking status:', b2.status, '| driver atTarget:', d2.atTarget, '| driver path length:', d2.path.length);

  ws.close(); opsWs.close();
  console.log('\nAll checks ran.');
}
main().catch(err => { console.error('GPS SMOKE TEST FAILED:', err); process.exit(1); });
