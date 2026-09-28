// Manual smoke test for fleet-roster management (not part of the app).
// Usage: node tools/fleet-smoke-test.js [http://127.0.0.1:4010]
'use strict';
const BASE = process.argv[2] || 'http://127.0.0.1:4010';

function extractCookie(res) { const sc = res.headers.get('set-cookie'); return sc ? sc.split(';')[0] : null; }
async function jsonFetch(path, opts, cookie) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts && opts.headers);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: extractCookie(res) || cookie };
}

async function main() {
  let r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'superadmin', password: 'super-admin-pass' }) });
  console.log('superadmin login:', r.status);
  const cookie = r.cookie;

  r = await jsonFetch('/api/admin/companies', {}, cookie);
  const company = r.body[0];
  console.log('company:', company.name, company.id);

  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet`, {}, cookie);
  console.log('fleet before (first 3):', r.body.slice(0, 3));
  console.log('total seats:', r.body.length, 'online count:', r.body.filter(s => s.online).length);

  console.log('\n== Bulk replace with 3 new drivers ==');
  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet/bulk`, { method: 'POST', body: JSON.stringify({
    drivers: [
      { name: 'Fitim Krasniqi', username: 'fitim-test', password: 'fitim-pass-123', vehicleType: 'standard' },
      { name: 'Vlora Berisha', vehicleType: 'comfort' }, // no login yet, still real name
      { name: 'Dren Gashi', username: 'dren-test', password: 'dren-pass-123', vehicleType: 'access' }
    ]
  }) }, cookie);
  console.log(r.status, r.body);

  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet`, {}, cookie);
  console.log('\nfleet after replace:');
  console.log('  online:', r.body.filter(s => s.online).map(s => `${s.slot}:${s.name}(${s.vehicleType})${s.username ? '@' + s.username : ''}`));
  console.log('  offline count:', r.body.filter(s => !s.online).length, '/ total', r.body.length);

  console.log('\n== Old demo driver login should be gone ==');
  r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'driver', password: 'driver-demo-pass' }) });
  console.log('old "driver" login attempt:', r.status, r.body);

  console.log('\n== New driver can log in and is bound to the right seat ==');
  r = await jsonFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'fitim-test', password: 'fitim-pass-123' }) });
  console.log('fitim-test login:', r.status, r.body);

  console.log('\n== Remove one login ==');
  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet/2/driver`, { method: 'DELETE' }, cookie);
  console.log('remove seat 2 login:', r.status, r.body);
  r = await jsonFetch(`/api/admin/companies/${company.id}/fleet`, {}, cookie);
  console.log('seat 2 now:', r.body[2]);

  console.log('\nAll checks ran.');
}
main().catch(err => { console.error('FLEET SMOKE TEST FAILED:', err); process.exit(1); });
