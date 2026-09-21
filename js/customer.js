/* Customer mobile app: SMS-OTP login, map pins, fare estimates, booking, live tracking, trips, saved places. */
(function (RO) {
  'use strict';
  const C = RO.City, U = RO.util, V = RO.VEH, E = RO.E, bus = RO.bus, MV = RO.MapView;
  const root = U.$('#cust'), st = () => RO.state;
  const me = {
    phone: null, screen: 'login', tab: 'book', otp: null, phoneDraft: '+383 44 111 222', err: '', pu: { key: 'gps' }, dr: { key: '' }, pin: 'dropoff',
    vehicle: 'standard', payment: 'card', when: 0, tags: [], bid: null, gps: { x: 100 * U.ri(3, 8), y: 100 * U.ri(2, 6) }, map: null, shown: ''
  };
  const cust = () => st().customers[me.phone];
  const booking = () => me.bid && E.bk(me.bid);

  function places() {
    const c = cust(), out = [{ key: 'gps', group: 'Here', name: '📍 Current location', label: C.label(me.gps), ...me.gps }];
    (c ? c.favorites : []).forEach((f, i) => out.push({ key: 'fav' + i, group: 'Saved', name: '⭐ ' + f.name, label: f.name, x: f.x, y: f.y }));
    C.LM.forEach(l => out.push({ key: 'lm:' + l.id, group: 'Places', name: l.icon + ' ' + l.name, label: l.name, x: l.x, y: l.y }));
    return out;
  }
  function resolve(sel) {
    if (!sel.key) return null; if (sel.key === 'pin') return sel.pt;
    const p = places().find(x => x.key === sel.key); return p ? { x: p.x, y: p.y, label: p.label } : null;
  }
  function options(sel, placeholder) {
    let h = `<option value="">${placeholder}</option>`, g = '';
    places().forEach(p => { if (p.group !== g) { if (g) h += '</optgroup>'; h += `<optgroup label="${p.group}">`; g = p.group; } h += `<option value="${p.key}" ${sel.key === p.key ? 'selected' : ''}>${U.esc(p.name)}</option>`; });
    h += '</optgroup>';
    if (sel.key === 'pin') h += `<option value="pin" selected>📌 Pinned: ${U.esc(sel.pt.label)}</option>`;
    return h;
  }

  /* ---------- shells ---------- */
  function render() {
    me.map = null; me.shown = '';
    if (me.screen === 'login') {
      root.innerHTML = `<div class="c-login"><div class="logo">🚕</div><h2>RideOps</h2><p>Get a taxi in minutes.<br>Sign in with your phone number.</p>
        <input id="c-phone" type="tel" value="${U.esc(me.phoneDraft)}" placeholder="+383 44 000 000"><div class="err">${U.esc(me.err)}</div>
        <button class="btn primary" data-act="send">Send code</button>
        <small>Demo: <a href="#" data-act="demo">+383 44 111 222</a> is a returning rider with saved places. Any other number registers a new rider.</small></div>`;
    } else if (me.screen === 'otp') {
      root.innerHTML = `<div class="c-login"><div class="logo">💬</div><h2>Enter the code</h2><p>We sent a 6-digit code to<br><b>${U.esc(U.fmtPhone(me.phone))}</b></p>
        <input id="c-otp" inputmode="numeric" maxlength="6" placeholder="••••••" style="text-align:center;letter-spacing:.4em;font-size:22px"><div class="err">${U.esc(me.err)}</div>
        <button class="btn primary" data-act="verify">Verify</button><small><a href="#" data-act="back">Use a different number</a></small></div>`;
    } else {
      const showTrack = me.tab === 'book' && booking() && !['done'].includes(me.tabState);
      root.innerHTML = `<div class="c-top"><div><small>Hello,</small><b>${U.esc(cust().name)}</b></div><button class="ghost" data-act="logout" title="Sign out">⎋</button></div>` +
        `<div class="c-body">${me.tab === 'book' ? (showTrack ? trackShell() : bookShell()) : me.tab === 'trips' ? tripsHTML() : placesHTML()}</div>` +
        `<nav class="c-nav">${[['book', '🚕', 'Ride'], ['trips', '🕒', 'Trips'], ['places', '⭐', 'Places']].map(([k, i, l]) => `<button class="${me.tab === k ? 'on' : ''}" data-tab="${k}"><span>${i}</span>${l}</button>`).join('')}</nav>`;
      me.shown = me.tab === 'book' ? (showTrack ? 'track' : 'book') : me.tab;
      if (me.shown === 'book') { syncSelects(); }
      if (me.shown === 'book' || me.shown === 'track') me.map = new MV(U.$('#c-map', root), { labels: false, zoom: false, slot: 'cust', onTap: me.shown === 'book' ? onTap : null });
    }
    refresh(true);
  }
  function bookShell() {
    return `<div class="c-map" id="c-map"></div><div class="c-sheet">
      <div class="seg" id="c-pin"><button data-pin="pickup">📍 Tap map: pickup</button><button data-pin="dropoff">🏁 Tap map: drop-off</button></div>
      <label>Pickup<select id="c-pu"></select></label><label>Drop-off<select id="c-do"></select></label>
      <div class="veh-row" id="c-veh"></div>
      <div class="two"><label>Payment<select id="c-pay">${Object.entries(RO.PAY).map(([k, v]) => `<option value="${k}" ${me.payment === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>When<select id="c-when">${[[0, 'Now'], [10, 'In 10 min'], [30, 'In 30 min'], [60, 'In 1 hour'], [120, 'In 2 hours']].map(([m, l]) => `<option value="${m}" ${me.when === m ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="chips" id="c-tags"></div><button class="btn primary" id="c-book" data-act="book">Choose a destination</button></div>`;
  }
  const trackShell = () => `<div class="c-map short" id="c-map"></div><div class="c-card" id="c-track"></div>`;
  function syncSelects() {
    const pu = U.$('#c-pu', root), dr = U.$('#c-do', root); if (!pu) return;
    pu.innerHTML = options(me.pu, 'Choose pickup'); dr.innerHTML = options(me.dr, 'Where to?');
  }
  function tripsHTML() {
    const t = cust().trips;
    return `<div class="c-list"><h3>Your trips</h3>${t.length ? t.map((x, i) => `<div class="li"><div><b>${U.esc(x.pickup.label)}</b> → <b>${U.esc(x.dropoff.label)}</b><small>${V[x.vehicle].label} · ${U.money(x.fare)}${x.at ? ' · ' + x.id : ''}</small></div><button class="btn sm" data-rebook="${i}">Rebook</button></div>`).join('') : '<p class="mut">No trips yet.</p>'}</div>`;
  }
  function placesHTML() {
    const f = cust().favorites;
    return `<div class="c-list"><h3>Saved places</h3>${f.length ? f.map((x, i) => `<div class="li"><div><b>⭐ ${U.esc(x.name)}</b><small>${U.esc(C.label(x))}</small></div><button class="btn sm ghost" data-delfav="${i}">Remove</button></div>`).join('') : '<p class="mut">Nothing saved yet.</p>'}
      <h3>Save a place</h3><div class="two"><input id="c-favname" placeholder="Name (e.g. Gym)" maxlength="16"><select id="c-favsrc"><option value="pu">current pickup</option><option value="dr">current drop-off</option></select></div>
      <button class="btn" data-act="addfav">Save place</button></div>`;
  }

  /* ---------- events ---------- */
  function onTap(p) {
    const sel = me.pin === 'pickup' ? me.pu : me.dr; sel.key = 'pin'; sel.pt = { x: p.x, y: p.y, label: C.label(p) };
    if (me.pin === 'pickup') me.pin = 'dropoff'; syncSelects(); refresh(true);
  }
  root.addEventListener('click', e => {
    const t = e.target.closest('button,a'); if (!t) return; const d = t.dataset;
    if (t.tagName === 'A') e.preventDefault();
    if (d.act === 'demo') { U.$('#c-phone', root).value = '+383 44 111 222'; return; }
    if (d.act === 'send') {
      const p = U.normPhone(U.$('#c-phone', root).value); me.phoneDraft = U.$('#c-phone', root).value;
      if (p.length < 9) { me.err = 'Enter a valid phone number'; return render(); }
      me.phone = p; me.otp = String(U.ri(100000, 999999)); me.err = ''; me.screen = 'otp'; render();
      setTimeout(() => E.sms(p, `RideOps: your verification code is ${me.otp}. Do not share it.`), 700);
    } else if (d.act === 'back') { me.screen = 'login'; render(); }
    else if (d.act === 'verify') {
      if (U.$('#c-otp', root).value.trim() !== me.otp) { me.err = 'Wrong code, try again'; return render(); }
      const s = st(); if (!s.customers[me.phone]) { s.customers[me.phone] = { phone: me.phone, name: 'Rider ' + me.phone.slice(-3), favorites: [], trips: [] }; RO.save(); }
      me.screen = 'main'; me.err = ''; render();
    } else if (d.act === 'logout') { me.screen = 'login'; me.phone = null; me.bid = null; me.pu = { key: 'gps' }; me.dr = { key: '' }; render(); }
    else if (d.tab) { me.tab = d.tab; render(); }
    else if (d.pin) { me.pin = d.pin; refresh(true); }
    else if (d.veh) { me.vehicle = d.veh; if (d.veh === 'access' && !me.tags.includes('wheelchair')) me.tags.push('wheelchair'); if (d.veh !== 'access') me.tags = me.tags.filter(x => x !== 'wheelchair'); refresh(true); }
    else if (d.tag) { const i = me.tags.indexOf(d.tag); i < 0 ? me.tags.push(d.tag) : me.tags.splice(i, 1); if (d.tag === 'wheelchair') me.vehicle = i < 0 ? 'access' : 'standard'; refresh(true); }
    else if (d.act === 'book') {
      const pu = resolve(me.pu), dr = resolve(me.dr); if (!pu || !dr) return;
      const b = E.createBooking({ source: 'app', phone: me.phone, name: cust().name, pickup: pu, dropoff: dr, vehicle: me.vehicle, payment: me.payment, whenMin: me.when, tags: me.tags });
      me.bid = b.id; me.tabState = ''; me.tags = []; render();
    } else if (d.act === 'cancel') { E.cancelBooking(me.bid, 'rider'); refresh(true); }
    else if (d.act === 'done') { me.bid = null; me.dr = { key: '' }; me.vehicle = 'standard'; render(); }
    else if (d.rate) { const b = booking(); if (b) { b.rating = +d.rate; refresh(true); } }
    else if (d.rebook != null) { const x = cust().trips[+d.rebook]; me.pu = { key: 'pin', pt: { ...x.pickup } }; me.dr = { key: 'pin', pt: { ...x.dropoff } }; me.vehicle = x.vehicle; me.tab = 'book'; render(); }
    else if (d.delfav != null) { cust().favorites.splice(+d.delfav, 1); RO.save(); render(); }
    else if (d.act === 'addfav') {
      const name = U.$('#c-favname', root).value.trim(), sel = U.$('#c-favsrc', root).value === 'pu' ? me.pu : me.dr, p = resolve(sel);
      if (name && p) { cust().favorites.push({ name, x: p.x, y: p.y }); RO.save(); render(); }
    } else if (d.act === 'callDriver') E.log(`📞 Masked call: rider ${U.fmtPhone(me.phone)} → driver (${me.bid})`, 'ops');
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'c-pu' || t.id === 'c-do') { const sel = t.id === 'c-pu' ? me.pu : me.dr; if (t.value !== 'pin') { sel.key = t.value; delete sel.pt; } refresh(true); }
    else if (t.id === 'c-pay') me.payment = t.value;
    else if (t.id === 'c-when') { me.when = +t.value; refresh(true); }
  });

  /* ---------- live refresh ---------- */
  let lastEst = 0;
  function trackHTML(b) {
    const d = E.drv(b.driverId), eta = E.driverEta(b), when = U.clock(b.scheduledSim || 0);
    const drvCard = d ? `<div class="drv"><div class="av">${U.initials(d.name)}</div><div><b>${U.esc(d.name)}</b> <span class="star">★ ${d.rating}</span><small>${d.model} · ${d.plate}</small></div><button class="btn sm" data-act="callDriver">📞</button></div>` : '';
    const route = `<div class="rt"><span>📍 ${U.esc(b.pickup.label)}</span><span>🏁 ${U.esc(b.dropoff.label)}</span></div>`;
    const cancel = `<button class="btn ghost danger" data-act="cancel">Cancel ride</button>`;
    const min = m => Math.max(1, Math.round(m));
    switch (b.status) {
      case 'scheduled': return `<div class="stat"><b>🗓 Scheduled for ${when}</b><small>We assign your driver ${st().settings.leadMin} min before pickup.</small></div>${route}${cancel}`;
      case 'pending': return `<div class="stat"><div class="spin"></div><b>Finding your driver…</b><small>Waiting ${U.mmss((Date.now() - b.pendingSince) / 1000)}${b.alerted ? ' · our ops team has been alerted and is on it' : ''}</small></div>${route}${cancel}`;
      case 'offered': return `<div class="stat"><div class="spin"></div><b>Contacting a nearby driver…</b><small>Request sent, waiting for confirmation</small></div>${route}${cancel}`;
      case 'enroute': return `<div class="stat ok"><b>Driver on the way · ${min(eta)} min</b><small>${b.forced ? 'Assigned by our dispatcher' : 'Confirmed'}</small></div>${drvCard}${route}${cancel}`;
      case 'arrived': return `<div class="stat ok"><b>🚕 Your driver has arrived</b><small>Look for plate ${d ? d.plate : ''}</small></div>${drvCard}${route}`;
      case 'ontrip': return `<div class="stat"><b>On trip · ${min(eta)} min to destination</b><small>Est. fare ${U.money(b.est.fare)}</small></div>${drvCard}${route}<button class="btn ghost" data-act="sos-info" disabled>🛡 Trip shared with ops room</button>`;
      case 'completed': return `<div class="stat ok"><b>Trip complete · ${U.money(b.fare)}</b><small>${RO.PAY[b.payment]} — ${{ processing: 'processing…', paid: 'paid ✓', failed: 'payment failed, our team will retry', invoiced: 'billed to corporate account', cash: 'pay driver in cash', none: '' }[b.pay.state]}</small></div>
        <div class="rate">${b.rating ? `Thanks for rating ${'★'.repeat(b.rating)}` : 'Rate your driver: ' + [1, 2, 3, 4, 5].map(n => `<button data-rate="${n}">★</button>`).join('')}</div><button class="btn primary" data-act="done">Done</button>`;
      case 'cancelled': return `<div class="stat"><b>Ride cancelled</b></div><button class="btn primary" data-act="done">Book again</button>`;
    }
    return '';
  }
  function refresh(force) {
    if (me.screen !== 'main' || !root.offsetParent) return;
    if (me.shown === 'book' && booking()) return render();
    if (me.shown === 'book') {
      const pu = resolve(me.pu), dr = resolve(me.dr);
      U.$$('#c-pin button', root).forEach(b => b.classList.toggle('on', b.dataset.pin === me.pin));
      U.$$('#c-tags', root); U.setHTML(U.$('#c-tags', root), Object.entries(RO.TAGS).map(([k, l]) => `<button class="chip ${me.tags.includes(k) ? 'on' : ''}" data-tag="${k}">${l}</button>`).join(''));
      const t = Date.now();
      if (force || t - lastEst > 900) {
        lastEst = t; const ests = {};
        if (pu && dr) Object.keys(V).forEach(k => ests[k] = E.estimate(pu, dr, k));
        U.setHTML(U.$('#c-veh', root), Object.keys(V).map(k => {
          const e = ests[k];
          return `<button class="veh ${me.vehicle === k ? 'on' : ''}" data-veh="${k}"><span>${V[k].icon}</span><b>${V[k].label.replace(' (6 seats)', '')}</b><small>${e ? (e.pickupEta == null ? 'no car nearby' : Math.max(1, Math.round(e.pickupEta)) + ' min away') : '—'}</small><em>${e ? U.money(e.fare) : ''}</em></button>`;
        }).join(''));
        const btn = U.$('#c-book', root), e = ests[me.vehicle];
        btn.disabled = !(pu && dr); btn.textContent = pu && dr ? `Book ${V[me.vehicle].label.replace(' (6 seats)', '')} · ${U.money(e.fare)}${me.when ? ' · scheduled' : ''}` : 'Choose a destination';
      }
      const under = pu && dr ? MV.line(C.route(pu, dr), 'm-route') : '';
      let over = ''; st().drivers.filter(d => d.online && d.status === 'available').forEach(d => { over += MV.car(d, { s: 1.5 }); });
      if (pu) over += MV.pin(pu, { color: '#22c55e', s: 1.5 }); if (dr) over += MV.pin(dr, { color: '#ef4444', s: 1.5 });
      me.map.draw(under, over);
      const pts = [pu, dr].filter(Boolean); if (!pts.length) pts.push(me.gps);
      const key = JSON.stringify(pts) + me.pu.key + me.dr.key; if (me.viewKey !== key) { me.viewKey = key; me.map.fit(pts, { minW: 500, pad: 110 }); }
    }
    if (me.shown === 'track') {
      const b = booking(); if (!b) return;
      U.setHTML(U.$('#c-track', root), trackHTML(b));
      const d = E.drv(b.driverId); let under = '', over = '';
      if (['enroute', 'arrived'].includes(b.status) && d) under = MV.line([d.pos].concat(d.path), 'm-route');
      else if (b.status === 'ontrip' && d) under = MV.line([d.pos].concat(d.path), 'm-route');
      else under = MV.line(C.route(b.pickup, b.dropoff), 'm-route dim');
      if (b.status !== 'ontrip') over += MV.pin(b.pickup, { color: '#22c55e', s: 1.5 }); over += MV.pin(b.dropoff, { color: '#ef4444', s: 1.5 });
      if (d && ['enroute', 'arrived', 'ontrip'].includes(b.status)) over += MV.car(d, { s: 1.7 });
      me.map.draw(under, over);
      me.map.fit([b.pickup, b.dropoff].concat(d ? [d.pos] : []), { minW: 500, pad: 100 });
    }
  }
  let lt = 0; bus.on('tick', () => { const t = performance.now(); if (t - lt > 250) { lt = t; refresh(); } });
  bus.on('change', () => refresh(false));
  bus.on('reset', () => { me.bid = null; if (me.screen === 'main') render(); });
  bus.on('sms', m => {
    if (m.to !== me.phone) return;
    const n = document.createElement('div'); n.className = 'sms-toast'; n.innerHTML = `<b>💬 Messages · RideOps</b><span>${U.esc(m.text)}</span>`;
    U.$('#dev-customer').appendChild(n); setTimeout(() => n.remove(), 7000);
  });
  bus.on('devshow', id => { if (id === 'customer') { me.shown = ''; render(); } });
  render();
})(window.RO);
