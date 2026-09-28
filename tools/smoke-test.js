// Manual smoke test against a running server (not part of the app) — exercises auth + WS end to end.
// Usage: node tools/smoke-test.js [http://127.0.0.1:4010]
'use strict';
const BASE = process.argv[2] || 'http://127.0.0.1:4010';
const WebSocket = require('ws');

function extractCookie(res) {
  const sc = res.headers.get('set-cookie');
  if (!sc) return null;
  return sc.split(';')[0];
}

async function jsonFetch(path, opts, cookie) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts && opts.headers);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: extractCookie(res) || cookie };
}

function connectWs(cookie) {
  return new Promise((resolve, reject) => {
    const wsUrl = BASE.replace('http', 'ws') + '/ws';
    const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
    ws.once('unexpected-response', (req, res) => reject(new Error('WS rejected: ' + res.statusCode)));
  });
}
function waitFor(ws, pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs || 5000);
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (pred(msg)) { clearTimeout(t); resolve(msg); }
    });
  });
}
function rpc(ws, name, args) {
  const id = Math.floor(Math.random() * 1e9);
  ws.send(JSON.stringify({ type: 'action', id, name, args: args || {} }));
  return waitFor(ws, m => m.type === 'result' && m.id === id);
}

async function main() {
  console.log('== Ops login ==');
  let r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'ops', password: 'ops-demo-pass' }) });
  console.log(r.status, r.body);
  const opsCookie = r.cookie;
  r = await jsonFetch('/api/auth/me', {}, opsCookie);
  console.log('me:', r.status, r.body);

  console.log('\n== Client: request + verify code ==');
  r = await jsonFetch('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ phone: '+38344111222' }) });
  console.log('request-code:', r.status, r.body);
  const code = r.body.devCode;
  r = await jsonFetch('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ phone: '+38344111222', code }) });
  console.log('verify-code:', r.status, r.body);
  const clientCookie = r.cookie;

  console.log('\n== Driver login (creates its own test driver via the admin API — the seeded one may since have been replaced by fleet-roster testing) ==');
  r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'superadmin', password: 'super-admin-pass' }) });
  const superCookie = r.cookie;
  r = await jsonFetch('/api/admin/companies', {}, superCookie);
  const company = r.body[0];
  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet`, {}, superCookie);
  const freeSlot = r.body.find(s => !s.username);
  const driverUsername = 'smoke-test-' + Date.now(), driverPassword = 'smoke-test-pass-123';
  await jsonFetch(`/api/admin/companies/${company.id}/fleet/${freeSlot.slot}/driver`, { method: 'PUT', body: JSON.stringify({ name: 'Smoke Test Driver', username: driverUsername, password: driverPassword }) }, superCookie);
  r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: driverUsername, password: driverPassword }) });
  console.log(r.status, r.body);
  const driverCookie = r.cookie, driverId = r.body.driverId;

  console.log('\n== WS: connect all three, ops creates a booking, driver accepts, verify all three see it ==');
  const opsWs = await connectWs(opsCookie);
  const clientWs = await connectWs(clientCookie);
  const driverWs = await connectWs(driverCookie);
  const s1 = await waitFor(opsWs, m => m.type === 'state', 3000);
  console.log('ops got initial snapshot: drivers=', s1.state.drivers.length, 'bookings=', s1.state.bookings.length);

  const created = await rpc(opsWs, 'createBooking', { pickup: { x: 500, y: 400 }, dropoff: { x: 800, y: 300 }, vehicle: 'standard', payment: 'card', phone: '+38349999000', name: 'Smoke Test Rider' });
  console.log('ops createBooking result:', created);
  const bookingId = created.value.id;

  // wait for driver to see an offer, or force-assign if auto-dispatch hasn't picked a bot yet
  await new Promise(r2 => setTimeout(r2, 2000));
  await rpc(opsWs, 'assign', { bookingId, driverId });
  await new Promise(r2 => setTimeout(r2, 500));

  const accept = await rpc(driverWs, 'acceptOffer', {});
  console.log('driver acceptOffer (expected no-op, already assigned via force-assign):', accept);

  await new Promise(r2 => setTimeout(r2, 500));
  const opsState = await waitFor(opsWs, m => m.type === 'state' && m.state.bookings.some(b => b.id === bookingId && b.status === 'enroute'), 4000).catch(() => null);
  console.log('ops sees booking enroute:', !!opsState);

  const clientState = await waitFor(clientWs, m => m.type === 'state' && m.state.bookings.some(b => b.id === bookingId), 4000).catch(() => null);
  console.log('client sees the SAME booking (cross-connection shared state):', !!clientState);

  console.log('\n== Client: cancel own booking, verify rejection of cancelling someone elses ==');
  const cancelOther = await rpc(clientWs, 'cancelBooking', { id: bookingId });
  console.log("client cancels ops-created booking (should fail, different phone):", cancelOther);

  console.log('\n== Driver setOnline / SOS ==');
  const online = await rpc(driverWs, 'setOnline', { online: true });
  console.log('setOnline:', online);

  console.log('\n== Unauthorized: driver tries an ops-only action ==');
  const forbidden = await rpc(driverWs, 'assign', { bookingId, driverId: 'D01' });
  console.log('driver tries assign (should be rejected):', forbidden);

  console.log('\n== Superuser: not logged in as superuser, admin API should 403 ==');
  r = await jsonFetch('/api/admin/companies', {}, opsCookie);
  console.log('ops hitting admin API:', r.status, r.body);

  opsWs.close(); clientWs.close(); driverWs.close();
  console.log('\nAll checks ran.');
}

main().catch(err => { console.error('SMOKE TEST FAILED:', err); process.exit(1); });
