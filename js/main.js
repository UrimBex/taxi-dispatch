/* Sign-in (three roles), per-role workspace, top bar controls, simulation loop. Loaded before the UI modules; RO.start() runs last.
   Client: phone number + SMS code (any number registers a rider). Driver and ops: demo username + password. */
(function (RO) {
  'use strict';
  const U = RO.util, E = RO.E, bus = RO.bus;

  /* Demo staff accounts. Plain-text passwords are fine here only because there is no backend and no real data. */
  const STAFF = {
    driver: { pass: 'driver123', role: 'driver', name: 'Ben Krasniqi', icon: '🚗', title: 'Driver', desc: 'Driver app (vehicle D07)' },
    ops: { pass: 'ops123', role: 'ops', name: 'Dana', icon: '🎧', title: 'Ops room', desc: 'Dispatch dashboard & operator desk' }
  };
  const ROLE = { client: { icon: '📱', label: 'Client' }, driver: { icon: '🚗', label: 'Driver' }, ops: { icon: '🎧', label: 'Ops room' } };
  const HINTS = {
    customer: 'Rider view: pick a destination (dropdown or tap the map), book, and watch your driver arrive. Sign out and sign in as ops or driver to see the other side of the same trip.',
    ivr: 'Caller view: press 1 for status, 2 to rebook your last trip, 3 for an operator (the ops user answers it under Calls).',
    driver: 'Driver view (D07 Ben): you get real 15 s job offers when dispatch picks you. Try SOS or Cancel to trigger ops exceptions.'
  };
  RO.session = null;
  const lg = { tab: 'client', otp: null, phone: null };

  function showDev(k) {
    U.$$('.device').forEach(d => d.style.display = d.id === 'dev-' + k ? '' : 'none');
    U.$$('#dev-tabs button').forEach(b => b.classList.toggle('on', b.dataset.dev === k));
    U.$('#dev-hint').textContent = HINTS[k] || '';
    bus.emit('devshow', k);
  }
  U.$('#dev-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showDev(b.dataset.dev); });

  /* ---------- session ---------- */
  function enter(role, who) { // who: {name, phone?, user?}
    RO.session = { role, name: who.name, phone: who.phone || null, user: who.user || null };
    try { localStorage.setItem('ro.session', JSON.stringify({ role, phone: who.phone || null, user: who.user || null })); } catch (e) { }
    document.body.dataset.role = role;
    U.setText(U.$('#who'), `${ROLE[role].icon} ${who.name} · ${ROLE[role].label}`);
    U.$('#login').style.display = 'none'; U.$('#lg-toast').innerHTML = '';
    if (role === 'client') { RO.client.signIn(who.phone); showDev('customer'); }
    else if (role === 'driver') showDev('driver');
    else bus.emit('devshow', 'ops');
    window.scrollTo(0, 0);
  }
  function logout() {
    RO.session = null; try { localStorage.removeItem('ro.session'); } catch (e) { }
    delete document.body.dataset.role;
    if (RO.client) RO.client.signOut();
    showLogin();
  }
  RO.auth = { logout };

  /* ---------- sign-in screen ---------- */
  function setTab(t) {
    lg.tab = t;
    U.$$('#lg-tabs button').forEach(b => b.classList.toggle('on', b.dataset.r === t));
    U.$('#lg-client').style.display = t === 'client' ? '' : 'none';
    U.$('#login-form').style.display = t === 'client' ? 'none' : '';
    const a = STAFF[t];
    U.$('#demo-accts').innerHTML = a ? `<button type="button" class="acct" data-u="${t}"><span>${a.icon}</span><div><b>${a.title}</b><small>${a.desc}</small></div><code>${t} / ${a.pass}</code></button>` : '';
    U.$('#lg-user').value = ''; U.$('#lg-pass').value = ''; U.setText(U.$('#lg-err'), '');
  }
  function showLogin() {
    lg.otp = null; lg.phone = null;
    U.$('#login').style.display = 'flex'; U.$('#lg-toast').innerHTML = '';
    U.$('#lg-f1').style.display = ''; U.$('#lg-f2').style.display = 'none';
    U.$('#lg-phone').value = ''; U.setText(U.$('#lg-perr'), ''); U.setText(U.$('#lg-oerr'), '');
    setTab('client');
    U.$('#lg-phone').focus();
  }
  U.$('#lg-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.r); });

  // client: phone number -> SMS code
  U.$('#lg-demo').addEventListener('click', e => { e.preventDefault(); U.$('#lg-phone').value = '+383 44 111 222'; });
  U.$('#lg-f1').addEventListener('submit', e => {
    e.preventDefault();
    const p = U.normPhone(U.$('#lg-phone').value);
    if (p.length < 9) return U.setText(U.$('#lg-perr'), 'Enter a valid phone number');
    lg.phone = p; lg.otp = String(U.ri(100000, 999999)); U.setText(U.$('#lg-perr'), '');
    U.setText(U.$('#lg-sentto'), U.fmtPhone(p)); U.$('#lg-otp').value = ''; U.setText(U.$('#lg-oerr'), '');
    U.$('#lg-f1').style.display = 'none'; U.$('#lg-f2').style.display = ''; U.$('#lg-otp').focus();
    setTimeout(() => E.sms(p, `RideOps: your verification code is ${lg.otp}. Do not share it.`), 700);
  });
  U.$('#lg-f2').addEventListener('submit', e => {
    e.preventDefault();
    if (U.$('#lg-otp').value.trim() !== lg.otp) return U.setText(U.$('#lg-oerr'), 'Wrong code, try again');
    const s = RO.state; if (!s.customers[lg.phone]) { s.customers[lg.phone] = { phone: lg.phone, name: 'Rider ' + lg.phone.slice(-3), favorites: [], trips: [] }; RO.save(); }
    enter('client', { phone: lg.phone, name: s.customers[lg.phone].name });
  });
  U.$('#lg-back').addEventListener('click', e => { e.preventDefault(); lg.otp = null; U.$('#lg-toast').innerHTML = ''; U.$('#lg-f2').style.display = 'none'; U.$('#lg-f1').style.display = ''; U.$('#lg-phone').focus(); });
  bus.on('sms', m => { // the text message arrives while the sign-in screen is up
    if (U.$('#login').style.display === 'none' || m.to !== lg.phone) return;
    U.$('#lg-toast').innerHTML = `<div class="sms-toast"><b>💬 Messages · RideOps</b><span>${U.esc(m.text)}</span></div>`;
    setTimeout(() => { U.$('#lg-toast').innerHTML = ''; }, 12000);
  });

  // driver / ops: username + password, and the account must match the selected tab
  U.$('#demo-accts').addEventListener('click', e => {
    const b = e.target.closest('.acct'); if (!b) return;
    U.$('#lg-user').value = b.dataset.u; U.$('#lg-pass').value = STAFF[b.dataset.u].pass; U.setText(U.$('#lg-err'), ''); U.$('#lg-pass').focus();
  });
  U.$('#login-form').addEventListener('submit', e => {
    e.preventDefault();
    const u = U.$('#lg-user').value.trim().toLowerCase(), a = STAFF[u];
    if (!a || a.pass !== U.$('#lg-pass').value) return U.setText(U.$('#lg-err'), 'Wrong username or password');
    if (a.role !== lg.tab) return U.setText(U.$('#lg-err'), `That account belongs on the ${ROLE[a.role].label} tab.`);
    enter(a.role, { name: a.name, user: u });
  });
  U.$('#logout').addEventListener('click', logout);

  /* ---------- ops-only sim controls ---------- */
  U.$('#speed').addEventListener('change', e => { RO.state.speed = +e.target.value; });
  U.$('#pause').addEventListener('click', () => { E.setPaused(!RO.state.paused); U.$('#pause').textContent = RO.state.paused ? '▶ Resume' : '⏸ Pause'; });
  U.$('#demand').addEventListener('change', e => { RO.state.settings.demandOn = e.target.checked; RO.save(); });
  U.$('#reset').addEventListener('click', () => { if (confirm('Reset the simulation (drivers, bookings, calls)? Rider accounts are kept.')) { E.reset(); U.$('#speed').value = RO.state.speed; U.$('#pause').textContent = '⏸ Pause'; } });
  bus.on('tick', () => U.setText(U.$('#clock'), U.clock(RO.state.simSec)));

  RO.start = function () {
    U.$('#demand').checked = RO.state.settings.demandOn;
    let last = performance.now();
    setInterval(() => { const t = performance.now(), dt = Math.min(1, (t - last) / 1000); last = t; E.tick(dt); }, 200);
    E.log('Ops room online. Dispatch engine running.');
    let s = null; try { s = JSON.parse(localStorage.getItem('ro.session')); } catch (e) { }
    if (s && s.role === 'client' && s.phone && RO.state.customers[s.phone]) enter('client', { phone: s.phone, name: RO.state.customers[s.phone].name });
    else if (s && STAFF[s.user] && STAFF[s.user].role === s.role) enter(s.role, { name: STAFF[s.user].name, user: s.user });
    else showLogin();
  };
})(window.RO);
