/* Rider app: map pins, fare estimates, booking, live tracking, trips, saved places. Sign-in itself (phone + code)
   lives in main.js against the real server now; this module starts already signed in — see RO.client.signIn. */
(function (RO) {
  'use strict';
  const C = RO.City, U = RO.util, V = RO.VEH, E = RO.E, bus = RO.bus, MV = RO.MapView;
  const root = U.$('#cust'), st = () => RO.state;
  const me = {
    phone: null, name: '', tab: 'book', pu: { key: 'gps' }, dr: { key: '' }, pin: 'dropoff',
    vehicle: 'standard', payment: 'card', when: 0, tags: [], bid: null, needsBidPickup: false,
    gps: { x: 100 * U.ri(3, 8), y: 100 * U.ri(2, 6) }, map: null, shown: ''
  };
  // Falls back to a minimal stand-in for the brief moment between signing in and the first server snapshot
  // arriving — st().customers[me.phone] only exists once that push lands.
  const cust = () => st().customers[me.phone] || { phone: me.phone, name: me.name, favorites: [], trips: [] };
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
    if (!me.phone) { root.innerHTML = ''; return; }
    const showTrack = me.tab === 'book' && !!booking();
    root.innerHTML = `<div class="c-top"><div><small>Hello,</small><b>${U.esc(cust().name)}</b></div><button class="ghost" data-act="logout" title="Sign out">⎋</button></div>` +
      `<div class="c-body">${me.tab === 'book' ? (showTrack ? trackShell() : bookShell()) : me.tab === 'trips' ? tripsHTML() : placesHTML()}</div>` +
      `<nav class="c-nav">${[['book', '🚕', 'Ride'], ['trips', '🕒', 'Trips'], ['places', '⭐', 'Places']].map(([k, i, l]) => `<button class="${me.tab === k ? 'on' : ''}" data-tab="${k}"><span>${i}</span>${l}</button>`).join('')}</nav>` +
      `<div id="c-ovl"></div>`;
    me.shown = me.tab === 'book' ? (showTrack ? 'track' : 'book') : me.tab;
    if (me.shown === 'book') syncSelects();
    if (me.shown === 'book' || me.shown === 'track') me.map = new MV(U.$('#c-map', root), { labels: false, zoom: false, slot: 'cust', onTap: me.shown === 'book' ? onTap : null });
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
  root.addEventListener('click', async e => {
    const t = e.target.closest('button,a'); if (!t) return; const d = t.dataset;
    if (t.tagName === 'A') e.preventDefault();
    if (d.act === 'logout') return RO.auth.logout();
    if (d.tab) { me.tab = d.tab; return render(); }
    if (d.pin) { me.pin = d.pin; return refresh(true); }
    if (d.veh) { me.vehicle = d.veh; if (d.veh === 'access' && !me.tags.includes('wheelchair')) me.tags.push('wheelchair'); if (d.veh !== 'access') me.tags = me.tags.filter(x => x !== 'wheelchair'); return refresh(true); }
    if (d.tag) { const i = me.tags.indexOf(d.tag); i < 0 ? me.tags.push(d.tag) : me.tags.splice(i, 1); if (d.tag === 'wheelchair') me.vehicle = i < 0 ? 'access' : 'standard'; return refresh(true); }
    if (d.act === 'book') {
      const pu = resolve(me.pu), dr = resolve(me.dr); if (!pu || !dr) return;
      const b = await E.createBooking({ pickup: pu, dropoff: dr, vehicle: me.vehicle, payment: me.payment, whenMin: me.when, tags: me.tags });
      me.bid = b.id; me.tags = []; return render();
    }
    if (d.act === 'cancel') { await E.cancelBooking(me.bid); return refresh(true); }
    if (d.act === 'done') { me.bid = null; me.dr = { key: '' }; me.vehicle = 'standard'; return render(); }
    if (d.rate) { const b = booking(); if (b) { await E.rateTrip(b.id, +d.rate); refresh(true); } return; }
    if (d.rebook != null) { const x = cust().trips[+d.rebook]; me.pu = { key: 'pin', pt: { ...x.pickup } }; me.dr = { key: 'pin', pt: { ...x.dropoff } }; me.vehicle = x.vehicle; me.tab = 'book'; return render(); }
    if (d.delfav != null) { const list = cust().favorites.slice(); list.splice(+d.delfav, 1); await E.saveFavorites(list); return render(); }
    if (d.act === 'addfav') {
      const name = U.$('#c-favname', root).value.trim(), sel = U.$('#c-favsrc', root).value === 'pu' ? me.pu : me.dr, p = resolve(sel);
      if (name && p) { await E.saveFavorites(cust().favorites.concat([{ name, x: p.x, y: p.y }])); render(); }
      return;
    }
    if (d.act === 'callDriver') { const b = booking(); if (!b || !b.driverId) return; rtcNote = ''; RO.RTC.startAsCaller(b.driverId, 'client'); return E.voipStart(); }
    if (d.act === 'vans') { const v = st().voip; rtcNote = ''; if (v) RO.RTC.startAsCallee(v.driverId); return E.voipAnswer(); }
    if (d.act === 'vend') { RO.RTC.hangup(); return E.voipEnd(); }
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
  let rtcNote = '';
  bus.on('rtc-error', msg => { rtcNote = ` · ⚠️ ${msg}`; voipView(); });
  bus.on('rtc-state', s => { rtcNote = s === 'connected' ? ' · 🔊 audio live' : s === 'connecting' ? ' · connecting audio…' : ''; voipView(); });
  function toast(text, actions) {
    const o = U.$('#c-ovl', root); if (!o) return;
    U.setHTML(o, text ? `<div class="d-toast"><span>${text}</span>${actions || ''}</div>` : '');
  }
  // Real driver<->rider voice (see public/js/rtc.js) — piggybacks on the same ringing/active state machine as
  // driver<->ops, distinguished by peer:'client'. Only reacts to a call for the driver on THIS rider's own
  // current trip — st().voip is one shared slot company-wide, and other riders'/ops's calls aren't this rider's.
  function voipView() {
    const b = booking(), v = st().voip; if (!b || !v || v.peer !== 'client' || v.driverId !== b.driverId) return toast('');
    const d = E.drv(v.driverId), name = d ? U.esc(d.name) : 'your driver';
    if (v.state === 'ringing' && v.from === 'driver') toast(`📞 Incoming call from ${name}` + rtcNote, '<button class="btn sm primary" data-act="vans">Answer</button><button class="btn sm ghost" data-act="vend">Decline</button>');
    else if (v.state === 'ringing') toast(`📞 Calling ${name}…` + rtcNote, '<button class="btn sm ghost" data-act="vend">Cancel</button>');
    else toast(`📞 Connected to ${name} · ${U.mmss((Date.now() - v.t1) / 1000)}${rtcNote}`, '<button class="btn sm danger" data-act="vend">Hang up</button>');
  }
  function refresh(force) {
    if (!me.phone || !root.offsetParent) return;
    voipView();
    if (me.shown === 'book' && booking()) return render();
    if (me.shown === 'book') {
      const pu = resolve(me.pu), dr = resolve(me.dr);
      U.$$('#c-pin button', root).forEach(b => b.classList.toggle('on', b.dataset.pin === me.pin));
      U.setHTML(U.$('#c-tags', root), Object.entries(RO.TAGS).map(([k, l]) => `<button class="chip ${me.tags.includes(k) ? 'on' : ''}" data-tag="${k}">${l}</button>`).join(''));
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
      if (['enroute', 'arrived', 'ontrip'].includes(b.status) && d) under = MV.line([d.pos].concat(d.path), 'm-route');
      else under = MV.line(C.route(b.pickup, b.dropoff), 'm-route dim');
      if (b.status !== 'ontrip') over += MV.pin(b.pickup, { color: '#22c55e', s: 1.5 }); over += MV.pin(b.dropoff, { color: '#ef4444', s: 1.5 });
      if (d && ['enroute', 'arrived', 'ontrip'].includes(b.status)) over += MV.car(d, { s: 1.7 });
      me.map.draw(under, over);
      me.map.fit([b.pickup, b.dropoff].concat(d ? [d.pos] : []), { minW: 500, pad: 100 });
    }
  }
  let lt = 0;
  bus.on('tick', () => {
    if (me.needsBidPickup && me.phone) { // resolved on the first real snapshot after signing in, not at sign-in time — see RO.client.signIn
      me.needsBidPickup = false;
      const b = st().bookings.slice().reverse().find(x => x.phone === me.phone && !['completed', 'cancelled'].includes(x.status));
      me.bid = b ? b.id : null; render(); return;
    }
    const t = performance.now(); if (t - lt > 250) { lt = t; refresh(); }
  });
  bus.on('change', () => refresh(false));
  bus.on('sms', m => {
    if (m.to !== me.phone) return;
    const n = document.createElement('div'); n.className = 'sms-toast'; n.innerHTML = `<b>💬 Messages · Taxi Ardi</b><span>${U.esc(m.text)}</span>`;
    U.$('#dev-customer').appendChild(n); setTimeout(() => n.remove(), 7000);
  });
  bus.on('devshow', id => { if (id === 'customer') { me.shown = ''; render(); } });
  /* used by the role sign-in (main.js): the client account arrives already signed in as the rider it belongs to */
  RO.client = {
    signIn(phone, name) {
      Object.assign(me, { phone, name: name || '', tab: 'book', pu: { key: 'gps' }, dr: { key: '' }, vehicle: 'standard', payment: 'card', when: 0, tags: [], bid: null, needsBidPickup: true });
      render();
    },
    signOut() { Object.assign(me, { phone: null, name: '', bid: null, needsBidPickup: false, pu: { key: 'gps' }, dr: { key: '' } }); render(); }
  };
  render();
})(window.RO);
