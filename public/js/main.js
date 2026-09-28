/* Sign-in (three roles, backed by the real server — see server/routes/auth.js), per-role workspace, top bar
   controls, and opening the live WebSocket connection (public/js/net.js) once signed in. Loaded before the UI
   modules; RO.start() runs last.
   Client: phone number + a text-message code. Driver / ops / superuser: username + password. A session cookie
   (set by the server) is what actually persists across a reload — GET /api/auth/me restores it, not localStorage. */
(function (RO) {
  'use strict';
  const U = RO.util, bus = RO.bus;
  const ROLE = { client: { icon: '📱', label: 'Client' }, driver: { icon: '🚗', label: 'Driver' }, ops: { icon: '🎧', label: 'Ops room' } };
  const HINTS = {
    customer: 'Rider view: pick a destination (dropdown or tap the map), book, and watch your driver arrive. This is shared live with the ops room and driver app on any device — try opening ops in another tab.',
    ivr: 'Caller view: press 1 for status, 2 to rebook your last trip, 3 for an operator (the ops user answers it under Calls).',
    driver: "Driver view: you get real 15 s job offers when dispatch picks your vehicle. Try SOS or Cancel to trigger ops exceptions."
  };
  RO.session = null;

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }, opts));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Request failed.');
    return body;
  }

  function showDev(k) {
    U.$$('.device').forEach(d => d.style.display = d.id === 'dev-' + k ? '' : 'none');
    U.$$('#dev-tabs button').forEach(b => b.classList.toggle('on', b.dataset.dev === k));
    U.$('#dev-hint').textContent = HINTS[k] || '';
    bus.emit('devshow', k);
  }
  U.$('#dev-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showDev(b.dataset.dev); });

  /* ---------- session ---------- */
  function enter(role, who) { // who: {name, phone?, driverId?}
    // The main app has no superuser workspace (no ROLE entry, no CSS for it) — that's what /admin.html is for.
    if (role === 'superuser') { location.href = '/admin.html'; return; }
    RO.session = { role, name: who.name, phone: who.phone || null, driverId: who.driverId || null };
    document.body.dataset.role = role;
    U.setText(U.$('#who'), `${ROLE[role].icon} ${who.name} · ${ROLE[role].label}`);
    U.$('#login').style.display = 'none'; U.$('#lg-toast').innerHTML = '';
    RO.live.connect();
    if (role === 'client') { RO.client.signIn(who.phone, who.name); showDev('customer'); }
    else if (role === 'driver') showDev('driver');
    else bus.emit('devshow', 'ops');
    window.scrollTo(0, 0);
  }
  async function logout() {
    RO.live.disconnect();
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { }
    RO.session = null;
    delete document.body.dataset.role;
    if (RO.client) RO.client.signOut();
    showLogin();
  }
  function sessionReplaced() {
    RO.live.disconnect();
    RO.session = null;
    delete document.body.dataset.role;
    if (RO.client) RO.client.signOut();
    showLogin('Signed out — this browser was used to sign in as someone else in another tab.');
  }
  RO.auth = { logout, sessionReplaced };

  /* ---------- sign-in screen ---------- */
  let lgTab = 'client';
  function setTab(t) {
    lgTab = t;
    U.$$('#lg-tabs button').forEach(b => b.classList.toggle('on', b.dataset.r === t));
    U.$('#lg-client').style.display = t === 'client' ? '' : 'none';
    U.$('#login-form').style.display = t === 'client' ? 'none' : '';
    U.$('#demo-accts').innerHTML = t === 'driver' ? '<button type="button" class="acct" data-u="driver" data-p="driver-demo-pass"><span>🚗</span><div><b>Driver</b><small>Demo login (the seeded driver, Ben Krasniqi)</small></div><code>driver / driver-demo-pass</code></button>'
      : t === 'ops' ? '<button type="button" class="acct" data-u="ops" data-p="ops-demo-pass"><span>🎧</span><div><b>Ops room</b><small>Demo login</small></div><code>ops / ops-demo-pass</code></button>' : '';
    U.$('#lg-user').value = ''; U.$('#lg-pass').value = ''; U.setText(U.$('#lg-err'), '');
  }
  function showLogin(msg) {
    U.$('#login').style.display = 'flex'; U.$('#lg-toast').innerHTML = '';
    U.$('#lg-f1').style.display = ''; U.$('#lg-f2').style.display = 'none';
    U.$('#lg-phone').value = ''; U.setText(U.$('#lg-perr'), msg || ''); U.setText(U.$('#lg-oerr'), '');
    setTab('client');
    U.$('#lg-phone').focus();
  }
  U.$('#lg-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.r); });

  // client: phone number -> text-message code
  U.$('#lg-demo').addEventListener('click', e => { e.preventDefault(); U.$('#lg-phone').value = '+383 44 111 222'; });
  let pendingPhone = null;
  U.$('#lg-f1').addEventListener('submit', async e => {
    e.preventDefault();
    const phone = U.$('#lg-phone').value; U.setText(U.$('#lg-perr'), '');
    let resp;
    try { resp = await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ phone }) }); }
    catch (err) { return U.setText(U.$('#lg-perr'), err.message); }
    pendingPhone = phone;
    U.setText(U.$('#lg-sentto'), U.fmtPhone(U.normPhone(phone))); U.$('#lg-otp').value = ''; U.setText(U.$('#lg-oerr'), '');
    U.$('#lg-f1').style.display = 'none'; U.$('#lg-f2').style.display = ''; U.$('#lg-otp').focus();
    if (resp.devCode) U.$('#lg-toast').innerHTML = `<div class="sms-toast"><b>💬 Messages · RideOps (demo mode)</b><span>Your verification code is ${U.esc(resp.devCode)}.</span></div>`;
  });
  U.$('#lg-f2').addEventListener('submit', async e => {
    e.preventDefault();
    let resp;
    try { resp = await api('/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ phone: pendingPhone, code: U.$('#lg-otp').value.trim() }) }); }
    catch (err) { return U.setText(U.$('#lg-oerr'), err.message); }
    enter('client', { phone: resp.phone, name: resp.name });
  });
  U.$('#lg-back').addEventListener('click', e => { e.preventDefault(); U.$('#lg-toast').innerHTML = ''; U.$('#lg-f2').style.display = 'none'; U.$('#lg-f1').style.display = ''; U.$('#lg-phone').focus(); });

  // driver / ops: username + password
  U.$('#demo-accts').addEventListener('click', e => {
    const b = e.target.closest('.acct'); if (!b) return;
    U.$('#lg-user').value = b.dataset.u; U.$('#lg-pass').value = b.dataset.p; U.setText(U.$('#lg-err'), ''); U.$('#lg-pass').focus();
  });
  U.$('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    let resp;
    try { resp = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: U.$('#lg-user').value, password: U.$('#lg-pass').value }) }); }
    catch (err) { return U.setText(U.$('#lg-err'), err.message); }
    enter(resp.role, { name: resp.name, driverId: resp.driverId });
  });
  U.$('#logout').addEventListener('click', logout);

  /* ---------- ops-only sim controls (RPCs now — the clock/fleet are shared, not local) ---------- */
  U.$('#speed').addEventListener('change', e => RO.E.setSpeed(+e.target.value));
  U.$('#pause').addEventListener('click', () => RO.E.setPaused(!RO.state.paused));
  U.$('#demand').addEventListener('change', e => RO.E.updateSettings({ demandOn: e.target.checked }));
  U.$('#reset').addEventListener('click', () => { if (confirm("Reset this company's simulation (drivers, bookings, calls)? Rider accounts are kept.")) RO.E.reset(); });
  bus.on('tick', () => { U.setText(U.$('#clock'), U.clock(RO.state.simSec)); U.$('#pause').textContent = RO.state.paused ? '▶ Resume' : '⏸ Pause'; U.$('#speed').value = RO.state.speed; U.$('#demand').checked = RO.state.settings.demandOn; });
  bus.on('live', up => { const b = document.body; b.classList.toggle('offline', !up); });

  RO.start = async function () {
    showLogin();
    try {
      const me = await api('/api/auth/me');
      enter(me.role, { name: me.name, phone: me.phone, driverId: me.driverId });
    } catch (e) { /* not signed in — stay on the login screen */ }
  };
})(window.RO);
