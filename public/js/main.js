/* Sign-in (three roles, backed by the real server — see server/routes/auth.js), per-role workspace, top bar
   controls, and opening the live WebSocket connection (public/js/net.js) once signed in. Loaded before the UI
   modules; RO.start() runs last.
   Client: phone number + a text-message code. Driver / ops / superuser: username + password. A session cookie
   (set by the server) is what actually persists across a reload — GET /api/auth/me restores it, not localStorage. */
(function (RO) {
  'use strict';
  const U = RO.util, bus = RO.bus, I = RO.i18n, t = I.t;
  const ROLE = { client: { icon: '📱', label: () => t('role.client') }, driver: { icon: '🚗', label: () => t('role.driver') }, ops: { icon: '🎧', label: () => t('role.ops') } };
  let curDev = 'customer';
  RO.session = null;
  RO.config = { dispatchPhones: [] };

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' }, opts));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(I.err(body.error || 'Request failed.'));
    return body;
  }

  function renderWho() { if (RO.session) U.setText(U.$('#who'), `${ROLE[RO.session.role].icon} ${RO.session.name} · ${ROLE[RO.session.role].label()}`); }
  function showDev(k) {
    U.$$('.device').forEach(d => d.style.display = d.id === 'dev-' + k ? '' : 'none');
    U.$$('#dev-tabs button').forEach(b => b.classList.toggle('on', b.dataset.dev === k));
    curDev = k; U.$('#dev-hint').textContent = t('hint.' + k);
    bus.emit('devshow', k);
  }
  U.$('#dev-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showDev(b.dataset.dev); });

  /* ---------- session ---------- */
  function enter(role, who) { // who: {name, phone?, driverId?}
    // The main app has no superuser workspace (no ROLE entry, no CSS for it) — that's what /admin.html is for.
    if (role === 'superuser') { location.href = '/admin.html'; return; }
    RO.session = { role, name: who.name, phone: who.phone || null, driverId: who.driverId || null };
    document.body.dataset.role = role;
    I.setContext(role); // after RO.session is set: the language on offer (and the translated UI) depends on the role
    renderWho();
    U.$('#login').style.display = 'none'; U.$('#lg-toast').innerHTML = '';
    RO.live.connect();
    if (role === 'client') { RO.client.signIn(who.phone, who.name); showDev('ivr'); } // riders land on "Call dispatch"; the booking app is one tap away
    else if (role === 'driver') showDev('driver');
    else bus.emit('devshow', 'ops');
    window.scrollTo(0, 0);
  }
  async function logout() {
    RO.live.disconnect();
    if (RO.driverGPS) RO.driverGPS.stop();
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { }
    RO.session = null;
    delete document.body.dataset.role;
    if (RO.client) RO.client.signOut();
    showLogin();
  }
  function sessionReplaced() {
    RO.live.disconnect();
    if (RO.driverGPS) RO.driverGPS.stop();
    RO.session = null;
    delete document.body.dataset.role;
    if (RO.client) RO.client.signOut();
    showLogin(t('lg.replaced'));
  }
  RO.auth = { logout, sessionReplaced };

  /* ---------- sign-in screen ---------- */
  let lgTab = 'client';
  function setTab(t_) {
    lgTab = t_;
    I.setContext(t_, true);
    U.$$('#lg-tabs button').forEach(b => b.classList.toggle('on', b.dataset.r === t_));
    U.$('#lg-client').style.display = t_ === 'client' ? '' : 'none';
    U.$('#login-form').style.display = t_ === 'client' ? 'none' : '';
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
  let pendingPhone = null;
  U.$('#lg-f1').addEventListener('submit', async e => {
    e.preventDefault();
    const phone = U.$('#lg-phone').value; U.setText(U.$('#lg-perr'), '');
    let resp;
    try { resp = await api('/api/auth/request-code', { method: 'POST', body: JSON.stringify({ phone, lang: I.lang() }) }); }
    catch (err) { return U.setText(U.$('#lg-perr'), err.message); }
    pendingPhone = phone;
    U.setText(U.$('#lg-sentto'), U.fmtPhone(U.normPhone(phone))); U.$('#lg-otp').value = ''; U.setText(U.$('#lg-oerr'), '');
    U.$('#lg-f1').style.display = 'none'; U.$('#lg-f2').style.display = ''; U.$('#lg-otp').focus();
    if (resp.devCode) U.$('#lg-toast').innerHTML = `<div class="sms-toast"><b>${U.esc(t('lg.demo'))}</b><span>${U.esc(t('lg.demoCode', { code: resp.devCode }))}</span></div>`;
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
  U.$('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    let resp;
    try { resp = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: U.$('#lg-user').value, password: U.$('#lg-pass').value }) }); }
    catch (err) { return U.setText(U.$('#lg-err'), err.message); }
    enter(resp.role, { name: resp.name, driverId: resp.driverId });
  });
  U.$('#logout').addEventListener('click', logout);

  /* ---------- ops-only controls (RPCs — the clock/fleet are shared, not local) ---------- */
  U.$('#reset').addEventListener('click', () => { if (confirm(t('hdr.resetConfirm'))) RO.E.reset(); });
  bus.on('tick', () => { U.setText(U.$('#clock'), U.clock(RO.state.simSec)); });
  bus.on('live', up => { const b = document.body; b.classList.toggle('offline', !up); });
  I.onChange(() => { renderWho(); if (RO.session && RO.session.role !== 'ops') U.$('#dev-hint').textContent = t('hint.' + curDev); });

  RO.start = async function () {
    I.apply();
    showLogin();
    api('/api/config').then(c => { RO.config = c; bus.emit('config'); }).catch(() => { }); // optional extras; the app works without them
    try {
      const me = await api('/api/auth/me');
      enter(me.role, { name: me.name, phone: me.phone, driverId: me.driverId });
    } catch (e) { /* not signed in — stay on the login screen */ }
  };
})(window.RO);
