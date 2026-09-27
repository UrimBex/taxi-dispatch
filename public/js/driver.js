/* Driver mobile app: go online, 15 s job offers, turn-by-turn navigation, status toggles, SOS, VoIP.
   Which vehicle this login controls comes from the server (RO.session.driverId, resolved at sign-in from the
   account's DriverSlot binding — see server/routes/auth.js) rather than a hardcoded id. */
(function (RO) {
  'use strict';
  const C = RO.City, U = RO.util, V = RO.VEH, E = RO.E, bus = RO.bus, MV = RO.MapView;
  const root = U.$('#drv'), st = () => RO.state;
  const me = () => RO.session && RO.session.driverId ? E.drv(RO.session.driverId) : null;
  const dv = { key: '', map: null, summary: null, cancelOpen: false };

  function viewKey(d) {
    if (!d) return 'unassigned';
    if (dv.summary) return 'summary';
    if (!d.online) return 'offline';
    if (d.status === 'offered') return 'offer:' + d.offerBookingId + ':' + (E.bk(d.offerBookingId) || {}).offer;
    if (d.bookingId) return 'job:' + d.bookingId + ':' + (E.bk(d.bookingId) || {}).status + ':' + dv.cancelOpen;
    return 'idle';
  }
  const STEPS = ['En route', 'Arrived', 'On trip', 'Completed'];
  function stepper(status) {
    const i = { enroute: 0, arrived: 1, ontrip: 2, completed: 3 }[status] || 0;
    return `<div class="stepper">${STEPS.map((s, k) => `<span class="${k < i ? 'done' : k === i ? 'cur' : ''}">${s}</span>`).join('')}</div>`;
  }
  const head = d => `<div class="d-top"><div class="av">${U.initials(d.name)}</div><div><b>${U.esc(d.name)}</b><small>${d.model} · ${d.plate} · ★ ${d.rating}</small></div>
    <label class="switch"><input type="checkbox" data-act="online" ${d.online ? 'checked' : ''}><i></i></label></div>`;

  function render(d) {
    // dv.summary can go stale (e.g. after a company reset wipes the booking it pointed to) — fall through to a
    // normal view instead of crashing on a lookup that comes back empty.
    if (dv.summary && !dv.summary.bid) dv.summary = null;
    dv.key = viewKey(d); dv.map = null;
    let body = '';
    if (dv.key === 'unassigned') {
      body = `<div class="d-sum"><div class="logo">🚕</div><h2>No vehicle assigned</h2><small>Your driver login isn't bound to a fleet seat yet — ask ops or the platform admin to add one for you.</small></div>`;
      root.innerHTML = `<div class="d-wrap"><div class="d-top"><div><b>${U.esc((RO.session || {}).name || '')}</b></div></div><div class="d-main">${body}</div></div><div id="d-ovl"></div>`;
      return;
    }
    if (dv.key === 'summary') {
      const s = dv.summary;
      body = `<div class="d-sum"><div class="logo">✅</div><h2>Trip completed</h2><div class="big">+ ${U.money((s.fare || 0) * .8)}</div><small>Fare ${U.money(s.fare || 0)} · your share 80% · ${RO.PAY[s.payment] || ''}</small>
        <button class="btn primary" data-act="cont">Continue</button></div>`;
    } else if (dv.key === 'offline') {
      body = `<div class="d-sum"><div class="logo">😴</div><h2>You're offline</h2><small>Go online to start receiving trip requests.</small><button class="btn primary" data-act="goon">Go online</button></div>`;
    } else if (dv.key === 'idle') {
      body = `<div class="c-map grow" id="d-map"></div><div class="c-card" id="d-idle"></div>`;
    } else if (dv.key.startsWith('offer')) {
      const b = E.bk(d.offerBookingId), o = b.offer;
      body = `<div class="c-map short" id="d-map"></div><div class="offer">
        <div class="ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" class="bg"/><circle cx="22" cy="22" r="19" class="fg" id="d-ring"/></svg><span id="d-count">15</span></div>
        <h3>New trip request</h3>
        <div class="rt"><span>📍 ${U.esc(b.pickup.label)}<small>${o.km.toFixed(1)} km · ${Math.max(1, Math.round(o.etaMin))} min to pickup</small></span><span>🏁 ${U.esc(b.dropoff.label)}<small>${b.est.km.toFixed(1)} km · ~${Math.round(b.est.min)} min</small></span></div>
        <div class="fare"><b>${U.money(b.est.fare)}</b><span>${V[b.vehicle].label} · ${RO.PAY[b.payment]}</span></div>
        <div class="tags">${b.tags.map(t => `<span class="chip on">${RO.TAGS[t]}</span>`).join('')}</div>
        <div class="two"><button class="btn ghost danger" data-act="decline">Decline</button><button class="btn primary" data-act="accept">Accept</button></div></div>`;
    } else {
      const b = E.bk(d.bookingId);
      body = `<div class="nav" id="d-nav"></div><div class="c-map grow" id="d-map"></div><div class="c-card" id="d-job">
        ${stepper(b.status)}<div class="rt"><span>📍 ${U.esc(b.pickup.label)}</span><span>🏁 ${U.esc(b.dropoff.label)}</span></div>
        <div class="meta"><b>${U.esc(b.name)}</b> · ${V[b.vehicle].label} · ${U.money(b.est.fare)} est. ${b.forced ? '· <em>assigned by ops</em>' : ''}${b.tags.map(t => ` <span class="chip on">${RO.TAGS[t]}</span>`).join('')}</div>
        <button class="btn primary big" id="d-status" data-act="status"></button>
        <div class="row4"><button class="btn sm" data-act="callrider">📞 Rider</button><button class="btn sm" data-act="callops">🎧 Ops</button><button class="btn sm" data-act="cancelopen">✖ Cancel</button><button class="btn sm sos" data-act="sos">🆘 SOS</button></div>
        ${dv.cancelOpen ? `<div class="cancel-box"><b>Why are you cancelling?</b>${['Vehicle problem', 'Rider not at pickup', 'Personal emergency'].map(r => `<button class="btn sm" data-reason="${r}">${r}</button>`).join('')}<button class="btn sm ghost" data-act="cancelclose">Keep the job</button></div>` : ''}</div>`;
    }
    root.innerHTML = `<div class="d-wrap">${head(d)}<div class="d-main">${body}</div></div><div id="d-ovl"></div>`;
    const m = U.$('#d-map', root); if (m) dv.map = new MV(m, { labels: false, zoom: false, slot: 'drv' });
    update(d);
  }

  function update(d) {
    const s = st(); if (!d || (!dv.map && !U.$('#d-ring', root))) return;
    if (dv.key === 'idle') {
      const waiting = s.bookings.filter(b => b.status === 'pending').length, mine = d;
      U.setHTML(U.$('#d-idle', root), `<div class="stat ok"><b>You're online</b><small>Waiting for trip requests… ${waiting ? waiting + ' rider' + (waiting > 1 ? 's' : '') + ' waiting in the city' : ''}</small></div>
        <div class="kv"><div><b>${mine.trips}</b><small>trips</small></div><div><b>${U.money(mine.earnings)}</b><small>earned</small></div><div><b>${mine.rating}</b><small>rating</small></div></div>`);
      let over = MV.car(d, { s: 1.8, me: true }); s.bookings.filter(b => b.status === 'pending').forEach(b => { over += MV.pin(b.pickup, { color: '#f59e0b', s: 1.2 }); });
      dv.map.draw('', over); dv.map.centerOn(d.pos, 520);
    } else if (dv.key.startsWith('offer')) {
      const b = E.bk(d.offerBookingId); if (!b || !b.offer) return;
      const left = Math.max(0, (b.offer.expiresAt - Date.now()) / 1000), total = s.settings.offerSec;
      U.setText(U.$('#d-count', root), String(Math.ceil(left)));
      const r = U.$('#d-ring', root); if (r) r.style.strokeDashoffset = String(119.4 * (1 - left / total));
      dv.map.draw(MV.line(C.route(b.pickup, b.dropoff), 'm-route dim'), MV.car(d, { s: 1.8, me: true }) + MV.pin(b.pickup, { color: '#22c55e', s: 1.5 }) + MV.pin(b.dropoff, { color: '#ef4444', s: 1.5 }));
      dv.map.fit([d.pos, b.pickup, b.dropoff], { minW: 500, pad: 90 });
    } else if (dv.key.startsWith('job')) {
      const b = E.bk(d.bookingId); if (!b) return;
      const pts = [d.pos].concat(d.path), toPickup = b.status === 'enroute', target = toPickup ? b.pickup : b.dropoff;
      const steps = C.instructions(pts), s0 = steps[0], s1 = steps[1];
      let icon = '⬆', text = 'You have arrived';
      if (b.status === 'arrived') { icon = '⏳'; text = 'Waiting for the rider at pickup'; }
      else if (s0) {
        if (s1) { icon = s1.turn === 'left' ? '⬅' : s1.turn === 'right' ? '➡' : s1.turn === 'around' ? '⤾' : '⬆'; text = `In ${U.km(s0.km)} ${s1.turn === 'straight' ? 'continue on' : 'turn ' + s1.turn + ' onto'} ${s1.street}`; }
        else text = `Continue on ${s0.street} for ${U.km(s0.km)}`;
      } else if (b.status === 'ontrip') text = 'Arrived at the destination';
      const inf = C.polyInfo(pts);
      U.setHTML(U.$('#d-nav', root), `<span class="ic">${icon}</span><div><b>${text}</b><small>${U.esc(target.label)} · ${inf.km.toFixed(1)} km · ${Math.max(0, Math.round(inf.etaSec / 60))} min</small></div>`);
      const btn = U.$('#d-status', root); let label, off = false;
      if (b.status === 'enroute') { off = !d.atTarget; label = d.atTarget ? '✔ Arrived at Pickup' : `En Route to Pickup · ${inf.km.toFixed(1)} km`; }
      else if (b.status === 'arrived') label = '▶ Start Trip';
      else { off = !d.atTarget; label = d.atTarget ? '✔ Trip Completed' : `Driving to drop-off · ${inf.km.toFixed(1)} km`; }
      U.setText(btn, label); btn.disabled = off;
      let over = MV.car(d, { s: 1.8, me: true }) + MV.pin(target, { color: toPickup ? '#22c55e' : '#ef4444', s: 1.5 });
      dv.map.draw(MV.line(pts, 'm-route'), over); dv.map.centerOn(d.pos, 460);
    }
  }
  function toast(text, actions) {
    const o = U.$('#d-ovl', root); if (!o) return;
    U.setHTML(o, text ? `<div class="d-toast"><span>${text}</span>${actions || ''}</div>` : '');
  }
  function voipView() {
    const d = me(), v = st().voip; if (!d || !v || v.driverId !== d.id) return toast('');
    if (v.state === 'ringing' && v.from === 'ops') toast('🎧 Incoming call from Ops Room', '<button class="btn sm primary" data-act="vans">Answer</button><button class="btn sm ghost" data-act="vend">Decline</button>');
    else if (v.state === 'ringing') toast('📞 Calling Ops Room…', '<button class="btn sm ghost" data-act="vend">Cancel</button>');
    else toast(`📞 Connected to Ops Room · ${U.mmss((Date.now() - v.t1) / 1000)}`, '<button class="btn sm danger" data-act="vend">Hang up</button>');
  }

  root.addEventListener('click', async e => {
    const t = e.target.closest('button,input'); if (!t) return; const a = t.dataset.act, d = me(); if (!d) return;
    if (t.dataset.reason) { dv.cancelOpen = false; await E.driverCancel(d, t.dataset.reason); return; }
    if (a === 'online') return E.setOnline(t.checked);
    if (a === 'goon') return E.setOnline(true);
    if (a === 'accept') return E.acceptOffer();
    if (a === 'decline') return E.declineOffer();
    if (a === 'status') { const b = E.bk(d.bookingId); if (!b) return; if (b.status === 'enroute') return E.arrived(); if (b.status === 'arrived') return E.startTrip(); return E.completeTrip(); }
    if (a === 'cont') { dv.summary = null; refresh(); return; }
    if (a === 'cancelopen') { dv.cancelOpen = true; refresh(); return; }
    if (a === 'cancelclose') { dv.cancelOpen = false; refresh(); return; }
    if (a === 'sos') { if (confirm('Send an emergency SOS to the operations room?')) { await E.sos(); toast('🆘 SOS sent. Ops room has been alerted.'); } return; }
    if (a === 'callrider') return E.logEvent(`📞 Masked call: driver ${d.id} → rider`);
    if (a === 'callops') return E.voipStart();
    if (a === 'vans') return E.voipAnswer();
    if (a === 'vend') return E.voipEnd();
  });

  function refresh() {
    if (!root.offsetParent) return; const d = me();
    if (viewKey(d) !== dv.key) render(d); else update(d);
    voipView();
  }
  let lt = 0; bus.on('tick', () => { const t = performance.now(); if (t - lt > 250) { lt = t; refresh(); } });
  bus.on('change', refresh); bus.on('voip', refresh);
  bus.on('completed', m => { const d = me(); if (d && m.driverId === d.id) { dv.summary = { bid: m.bid, fare: m.fare, payment: m.payment }; refresh(); } });
  bus.on('driver-msg', t => { toast('📣 ' + U.esc(t)); setTimeout(() => { if (!st().voip) toast(''); }, 5000); });
  bus.on('devshow', id => { if (id === 'driver') { dv.key = ''; refresh(); } });
  render(me());
})(window.RO);
