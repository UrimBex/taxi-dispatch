/* Operations room: master dispatch dashboard, exceptions, call queue + operator booking form, manual override, rules, VoIP.
   Shared live with every other ops user in the same company (and the rider/driver apps) — see public/js/net.js. */
(function (RO) {
  'use strict';
  const C = RO.City, U = RO.util, V = RO.VEH, E = RO.E, bus = RO.bus, MV = RO.MapView;
  const root = U.$('#ops'), st = () => RO.state;
  const O = { sel: null, tab: 'bookings', filter: 'active', pick: null, dkey: '', map: null };
  const F = { callId: null, phone: '', name: '', pu: { key: '' }, dr: { key: '' }, vehicle: 'standard', payment: 'card', when: 0, tags: [], note: '' };
  const STL = { scheduled: 'Scheduled', pending: 'Searching', offered: 'Offered', enroute: 'En route', arrived: 'Arrived', ontrip: 'On trip', completed: 'Done', cancelled: 'Cancelled' };
  const SRC = { app: '📱', sim: '📱', ivr: '☎️', ops: '🎧' };
  const DST = { available: 'Available', offered: 'Offered', enroute: 'To pickup', arrived: 'At pickup', ontrip: 'On trip' };
  const pane = () => U.$('#ops-pane', root);
  const openAlerts = () => st().alerts.filter(a => !a.ack && !a.resolved);
  const selBooking = () => O.sel && O.sel.kind === 'booking' ? E.bk(O.sel.id) : null;
  const selDriver = () => O.sel && O.sel.kind === 'driver' ? E.drv(O.sel.id) : null;

  /* ---------- KPIs ---------- */
  function kpis() {
    const s = st(), B = s.bookings, on = s.drivers.filter(d => d.online).length;
    const active = B.filter(b => ['enroute', 'arrived', 'ontrip'].includes(b.status)).length, pend = B.filter(b => ['pending', 'offered'].includes(b.status)).length;
    const al = openAlerts().length, cw = s.calls.filter(c => c.state === 'queued').length, avg = s.stats.waitN ? s.stats.waitSum / s.stats.waitN : 0;
    const traf = C.zones.reduce((a, z) => a + z.v, 0) / C.zones.length;
    const tile = (v, l, c) => `<div class="kpi ${c || ''}"><b>${v}</b><small>${l}</small></div>`;
    U.setHTML(U.$('#kpis', root), tile(`${on}<i>/${s.drivers.length}</i>`, 'Drivers online') + tile(active, 'Active trips') + tile(pend, 'Searching', pend > 3 ? 'warn' : '') + tile(al, 'Open alerts', al ? 'bad' : '') +
      tile(cw, 'Calls waiting', cw ? 'warn' : '') + tile(avg ? avg.toFixed(1) + '<i> min</i>' : '—', 'Avg. wait to arrival') + tile(s.stats.done, 'Completed') + tile(U.money(s.stats.revenue), 'Revenue') +
      tile(Math.round(traf * 100) + '<i>%</i>', 'Traffic load', traf > .6 ? 'warn' : ''));
  }

  /* ---------- panes ---------- */
  function bookingsHTML() {
    const f = O.filter, B = st().bookings.filter(b => f === 'all' || (f === 'active' && ['enroute', 'arrived', 'ontrip'].includes(b.status)) || (f === 'pending' && ['pending', 'offered'].includes(b.status)) || (f === 'scheduled' && b.status === 'scheduled') || (f === 'done' && ['completed', 'cancelled'].includes(b.status))).slice().reverse().slice(0, 60);
    const chips = [['active', 'Active'], ['pending', 'Searching'], ['scheduled', 'Scheduled'], ['done', 'History'], ['all', 'All']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('');
    const rows = B.map(b => {
      const d = E.drv(b.driverId); let info = '';
      if (['pending', 'offered'].includes(b.status)) info = U.mmss((Date.now() - b.pendingSince) / 1000); else if (['enroute', 'ontrip'].includes(b.status)) info = Math.max(1, Math.round(E.driverEta(b) || 0)) + ' min'; else if (b.status === 'scheduled') info = U.clock(b.scheduledSim);
      const late = ['pending', 'offered'].includes(b.status) && Date.now() - b.pendingSince > st().settings.unassignedSec * 1000;
      return `<div class="row ${O.sel && O.sel.id === b.id ? 'sel' : ''}" data-bk="${b.id}"><span class="src">${SRC[b.source]}</span><div class="main"><b>${b.id}</b> ${U.esc(b.pickup.label)} → ${U.esc(b.dropoff.label)}<small>${U.esc(b.name)} · ${V[b.vehicle].label}${d ? ' · ' + d.id + ' ' + d.name : ''}${b.sos ? ' · 🆘' : ''}</small></div><span class="chip st-${b.status}">${STL[b.status]}</span><span class="age ${late ? 'bad' : ''}">${info}</span></div>`;
    }).join('') || '<p class="empty">No bookings in this view.</p>';
    return `<div class="chips">${chips}</div><div class="list">${rows}</div>`;
  }
  function alertsHTML() {
    const rows = st().alerts.slice(0, 40).map(a => `<div class="alert sev-${a.sev} ${a.ack || a.resolved ? 'done' : ''}"><div><b>${U.clock(a.t)}</b> ${U.esc(a.text)}</div><div class="acts">${a.bookingId || a.driverId ? `<button class="btn sm" data-goto="${a.id}">View</button>` : ''}${a.type === 'payment' && !a.resolved ? `<button class="btn sm" data-retry="${a.bookingId}">Retry payment</button>` : ''}${!a.ack && !a.resolved ? `<button class="btn sm primary" data-ackid="${a.id}">Acknowledge</button>` : `<small>${a.resolved ? 'resolved' : 'acknowledged'}</small>`}</div></div>`).join('');
    return rows || '<p class="empty">No alerts. Unassigned bookings, driver cancellations, payment failures and SOS signals appear here.</p>';
  }
  function driversHTML() {
    // Seats nobody has customised yet are still running the built-in demo roster's placeholder name/vehicle —
    // not a real driver, and nobody can ever sign in to move one, so there's nothing for ops to dispatch here.
    return '<div class="list">' + st().drivers.filter(d => d.human).map(d => {
      const b = E.bk(d.bookingId || d.offerBookingId);
      return `<div class="row ${O.sel && O.sel.id === d.id ? 'sel' : ''}" data-drv="${d.id}"><span class="dot" style="background:${d.online ? MV.STATUS_COL[d.status] : MV.STATUS_COL.offline}"></span><div class="main"><b>${d.id}</b> ${U.esc(d.name)}${d.human ? ' <em>(driver app)</em>' : ''}<small>${V[d.vehicle].label} · ★${d.rating} · ${d.trips} trips · ${U.money(d.earnings)}${b ? ' · ' + b.id : ''}</small></div><span class="chip ds-${d.online ? d.status : 'offline'}">${d.online ? DST[d.status] : 'Offline'}</span></div>`;
    }).join('') + '</div>';
  }
  function logHTML() { return '<div class="list logl">' + st().log.slice(0, 80).map(l => `<div class="lg ${l.kind}"><b>${U.clock(l.t)}</b> ${U.esc(l.text)}</div>`).join('') + '</div>'; }
  function rulesHTML() {
    const s = st().settings, sl = (k, l, min, max, step, unit) => `<label class="sl"><span>${l} <b id="v-${k}">${s[k]}${unit || ''}</b></span><input type="range" data-rule="${k}" min="${min}" max="${max}" step="${step}" value="${s[k]}"></label>`;
    const ck = (k, l) => `<label class="chk"><input type="checkbox" data-rulec="${k}" ${s[k] ? 'checked' : ''}> ${l}</label>`;
    return `<div class="rules"><h4>Automation rule engine</h4><p class="mut">Score = ETA × w<sub>eta</sub> + traffic × w<sub>traffic</sub> + (5 − rating) × w<sub>rating</sub>. Lowest score gets the offer.</p>
      ${sl('wETA', 'Weight: pickup ETA', 0, 3, .1)}${sl('wTraffic', 'Weight: traffic on route', 0, 3, .1)}${sl('wRating', 'Weight: driver rating', 0, 3, .1)}${sl('maxEtaMin', 'Max pickup ETA', 5, 40, 1, ' min')}
      <h4>Timers</h4>${sl('offerSec', 'Driver offer countdown', 5, 30, 1, ' s')}${sl('unassignedSec', 'Unassigned alert after', 20, 180, 5, ' s')}${sl('leadMin', 'Release scheduled rides', 2, 30, 1, ' min before')}
      <h4>Modes</h4>${ck('autoDispatch', 'Auto-dispatch (off = operators assign manually)')}
      <div class="btns"><button class="btn" data-act="jam">🚧 Trigger traffic incident</button></div>
      <p class="mut">Changes here apply to every ops user watching this company, immediately.</p></div>`;
  }
  function callsShell() {
    return `<div class="sec"><div class="sec-h"><b>Call queue</b></div><div id="call-queue"></div></div>
    <div class="sec"><div class="sec-h"><b id="op-ctx">Operator dashboard · new booking</b><button class="btn sm ghost" data-act="clear">Clear</button></div>
      <div id="op-caller" class="cti"></div>
      <div class="two"><label>Phone<input id="f-phone" type="tel" placeholder="+383 …"></label><label>Name<input id="f-name" placeholder="Caller name"></label></div>
      <label>Pickup<div class="pk"><select id="f-pu"></select><button class="btn sm" data-act="pickpu" title="Pick on map">📍</button></div></label>
      <label>Drop-off<div class="pk"><select id="f-dr"></select><button class="btn sm" data-act="pickdr" title="Pick on map">📍</button></div></label>
      <div class="two3"><label>Vehicle<select id="f-veh">${Object.keys(V).map(k => `<option value="${k}">${V[k].label}</option>`).join('')}</select></label>
      <label>Payment<select id="f-pay">${Object.entries(RO.PAY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>When<select id="f-when">${[[0, 'Now'], [10, 'In 10 min'], [30, 'In 30 min'], [60, 'In 1 hour']].map(([m, l]) => `<option value="${m}">${l}</option>`).join('')}</select></label></div>
      <div class="chips" id="f-tags"></div><label>Special requests / notes<input id="f-note" placeholder="e.g. ring the bell, 2 suitcases"></label>
      <div class="btns"><button class="btn primary" data-act="create">Create booking</button><button class="btn danger" data-act="endcall" id="f-end" style="display:none">End call</button></div><div id="f-msg" class="mut"></div></div>`;
  }
  function fPlaces() {
    const out = [], c = st().customers[U.normPhone(F.phone)];
    if (c) c.favorites.forEach((f, i) => out.push({ key: 'fav' + i, g: 'Caller saved places', name: '⭐ ' + f.name, label: f.name, x: f.x, y: f.y }));
    C.LM.forEach(l => out.push({ key: 'lm:' + l.id, g: 'Places', name: l.icon + ' ' + l.name, label: l.name, x: l.x, y: l.y })); return out;
  }
  function fOpts(sel, ph) {
    let h = `<option value="">${ph}</option>`, g = ''; fPlaces().forEach(p => { if (p.g !== g) { if (g) h += '</optgroup>'; h += `<optgroup label="${p.g}">`; g = p.g; } h += `<option value="${p.key}" ${sel.key === p.key ? 'selected' : ''}>${U.esc(p.name)}</option>`; });
    h += '</optgroup>'; if (sel.key === 'pin') h += `<option value="pin" selected>📌 ${U.esc(sel.pt.label)}</option>`; return h;
  }
  const fRes = sel => { if (!sel.key) return null; if (sel.key === 'pin') return sel.pt; const p = fPlaces().find(x => x.key === sel.key); return p && { x: p.x, y: p.y, label: p.label }; };
  function fillForm() {
    const q = id => U.$(id, root); if (!q('#f-phone')) return;
    q('#f-phone').value = F.phone; q('#f-name').value = F.name; q('#f-pu').innerHTML = fOpts(F.pu, 'Pickup location'); q('#f-dr').innerHTML = fOpts(F.dr, 'Drop-off location');
    q('#f-veh').value = F.vehicle; q('#f-pay').value = F.payment; q('#f-when').value = F.when; q('#f-note').value = F.note;
    U.setHTML(q('#f-tags'), Object.entries(RO.TAGS).map(([k, l]) => `<button class="chip ${F.tags.includes(k) ? 'on' : ''}" data-ftag="${k}">${l}</button>`).join(''));
    caller();
  }
  function caller() {
    const c = F.callId && st().calls.find(x => x.id === F.callId), cu = st().customers[U.normPhone(F.phone)], el = U.$('#op-caller', root); if (!el) return;
    let h = ''; if (c) h += `<div class="pop">☎️ <b>${U.esc(U.fmtPhone(c.phone))}</b> · connected ${U.mmss((Date.now() - c.tAns) / 1000)}${c.notes ? `<br>📝 ${U.esc(c.notes)}` : ''}${c.bookingId ? `<br>✅ Booked ${c.bookingId}` : ''}</div>`;
    if (cu) { const lt = cu.trips[0]; h += `<div class="pop">👤 <b>${U.esc(cu.name)}</b> — repeat caller · ${cu.trips.length} trips${lt ? `<br>Last: ${U.esc(lt.pickup.label)} → ${U.esc(lt.dropoff.label)} <button class="btn sm" data-act="uselast">Use</button>` : ''}</div>`; }
    U.setHTML(el, h);
    U.setText(U.$('#op-ctx', root), c ? `Operator dashboard · on call with ${U.fmtPhone(c.phone)}` : 'Operator dashboard · new booking');
    const end = U.$('#f-end', root); if (end) end.style.display = c ? '' : 'none';
  }
  function queueHTML() {
    const q = st().calls.filter(c => ['queued', 'active'].includes(c.state));
    return q.map(c => `<div class="row call ${c.state}"><span class="src">${c.state === 'active' ? '🎧' : '☎️'}</span><div class="main"><b>${U.esc(c.name || 'Unknown caller')}</b> ${U.esc(U.fmtPhone(c.phone))}<small>${c.state === 'queued' ? 'Waiting ' + U.mmss((Date.now() - c.tq) / 1000) + ' · ' + U.esc(c.why || '') : 'On call ' + U.mmss((Date.now() - c.tAns) / 1000)}</small></div>${c.state === 'queued' ? `<button class="btn sm primary" data-answer="${c.id}">Answer</button>` : `<button class="btn sm danger" data-endcall="${c.id}">End</button>`}</div>`).join('') || '<p class="empty">No calls waiting. Callers who press 3 in the IVR, or unknown numbers, appear here.</p>';
  }

  /* ---------- detail card ---------- */
  function timeline(b) { return '<div class="tl">' + b.timeline.slice(-5).map(t => `<div><b>${U.clock(t.t)}</b> ${U.esc(t.text)}</div>`).join('') + '</div>'; }
  function detailHTML() {
    const b = selBooking(), d = selDriver();
    if (b) {
      const dr = E.drv(b.driverId), can = ['pending', 'offered', 'scheduled', 'enroute', 'arrived'].includes(b.status), cand = can ? E.assignable(b) : [];
      return `<div class="dt-h"><b>${b.id}</b><span class="chip st-${b.status}">${STL[b.status]}</span><span>${SRC[b.source]} ${{ app: 'App', sim: 'App', ivr: 'IVR', ops: 'Operator' }[b.source]}</span><button class="x" data-act="close">✕</button></div>
        <div class="dt-r">📍 ${U.esc(b.pickup.label)} → 🏁 ${U.esc(b.dropoff.label)}</div>
        <div class="dt-g"><span>Rider</span><b>${U.esc(b.name)} ${U.esc(U.fmtPhone(b.phone))}</b><span>Vehicle</span><b>${V[b.vehicle].label}${b.tags.map(t => ' ' + RO.TAGS[t]).join('')}</b><span>Fare</span><b>${b.fare ? U.money(b.fare) : '~' + U.money(b.est.fare)} · ${RO.PAY[b.payment]} · ${b.pay.state}</b><span>Driver</span><b>${dr ? dr.id + ' ' + U.esc(dr.name) + ' · ' + dr.plate : '—'}</b></div>
        <div id="dt-live" class="live"></div>${timeline(b)}
        <div class="dt-a">${can ? (cand.length ? `<select id="dt-drv">${cand.map(c => `<option value="${c.d.id}">${c.d.id} ${U.esc(c.d.name)} · ${Math.max(1, Math.round(c.etaMin))} min · ★${c.d.rating}${c.d.status === 'offered' ? ' (has offer)' : ''}</option>`).join('')}</select><button class="btn sm primary" data-act="assign">${dr ? 'Reassign' : 'Assign'}</button>` : '<small>No eligible driver available</small>') : ''}
        ${b.status === 'scheduled' ? '<button class="btn sm" data-act="dispatch">Dispatch now</button>' : ''}${dr && can ? '<button class="btn sm" data-act="calldrv">📞 Call driver</button>' : ''}${b.pay.state === 'failed' ? `<button class="btn sm" data-retry="${b.id}">Retry payment</button>` : ''}${!['completed', 'cancelled'].includes(b.status) ? '<button class="btn sm danger" data-act="cancel">Cancel booking</button>' : ''}</div>`;
    }
    if (d) {
      const b2 = E.bk(d.bookingId || d.offerBookingId);
      return `<div class="dt-h"><b>${d.id} ${U.esc(d.name)}</b><span class="chip ds-${d.online ? d.status : 'offline'}">${d.online ? DST[d.status] : 'Offline'}</span><button class="x" data-act="close">✕</button></div>
        <div class="dt-g"><span>Vehicle</span><b>${d.model} · ${V[d.vehicle].label} · ${d.plate}</b><span>Stats</span><b>★${d.rating} · ${d.trips} trips · ${U.money(d.earnings)}</b><span>Location</span><b>${U.esc(C.label(C.snap(d.pos)))} ${d.gpsTracked ? '· <span class="chip on" style="font-size:10px">📍 live GPS</span>' : ''}</b><span>Job</span><b>${b2 ? b2.id + ' ' + U.esc(b2.pickup.label) + ' → ' + U.esc(b2.dropoff.label) : 'none'}</b></div>
        <div class="dt-a">${d.online ? '<button class="btn sm primary" data-act="calldrv">📞 VoIP call</button>' : ''}${b2 ? `<button class="btn sm" data-bk="${b2.id}">Open ${b2.id}</button>` : ''}</div>`;
    }
    return '';
  }
  function detailKey() { const b = selBooking(), d = selDriver(); return b ? [b.id, b.status, b.driverId, b.pay.state, b.offer && b.offer.driverId].join('|') : d ? [d.id, d.online, d.status, d.bookingId].join('|') : ''; }
  function detail() {
    const el = U.$('#ops-detail', root), k = detailKey();
    if (k !== O.dkey) { O.dkey = k; el.style.display = k ? '' : 'none'; el.innerHTML = detailHTML(); }
    const live = U.$('#dt-live', root), b = selBooking();
    if (live && b) {
      const eta = E.driverEta(b); let t = '';
      if (['pending', 'offered'].includes(b.status)) t = `⏱ Searching for ${U.mmss((Date.now() - b.pendingSince) / 1000)}${b.offer ? ' · offer to ' + b.offer.driverId + ' expires in ' + Math.max(0, Math.ceil((b.offer.expiresAt - Date.now()) / 1000)) + 's' : ''}${b.declinedBy.length ? ' · declined by ' + b.declinedBy.join(', ') : ''}`;
      else if (b.status === 'enroute') t = `🚕 Driver ETA to pickup ${Math.max(1, Math.round(eta))} min`; else if (b.status === 'ontrip') t = `🚕 ${Math.max(1, Math.round(eta))} min to drop-off`; else if (b.status === 'scheduled') t = `🗓 Pickup at ${U.clock(b.scheduledSim)}`;
      U.setText(live, t);
    }
  }

  /* ---------- map ---------- */
  function drawMap() {
    const s = st(), sb = selBooking(), sd = selDriver(); let under = '', over = '';
    const sosD = new Set(openAlerts().filter(a => a.type === 'sos').map(a => a.driverId));
    if (sb) { under += MV.line(C.route(sb.pickup, sb.dropoff), 'm-route dim'); const d = E.drv(sb.driverId); if (d) under += MV.line([d.pos].concat(d.path), 'm-route'); }
    if (sd) under += MV.line([sd.pos].concat(sd.path), 'm-route');
    for (const b of s.bookings) {
      if (['pending', 'offered'].includes(b.status)) over += MV.pin(b.pickup, { color: '#f59e0b', id: b.id, label: b.id, cls: 'pulse', s: 1.35 });
      else if (['enroute', 'arrived'].includes(b.status)) over += MV.pin(b.pickup, { color: '#22c55e', id: b.id, s: 1 });
      else if (b.status === 'scheduled') over += MV.pin(b.pickup, { color: '#94a3b8', id: b.id, s: .9 });
    }
    if (sb) over += MV.pin(sb.dropoff, { color: '#ef4444', s: 1.2 });
    for (const d of s.drivers) if (d.online || (sd && sd.id === d.id)) over += MV.car(d, { s: 1.3, tag: true, me: d.human, sos: sosD.has(d.id), sel: (sd && sd.id === d.id) || (sb && sb.driverId === d.id) });
    O.map.draw(under, over); O.map.updateHeat();
  }

  /* ---------- panes ---------- */
  function tabs() {
    const al = openAlerts().length, cw = st().calls.filter(c => c.state === 'queued').length;
    const badge = n => n ? `<i class="badge">${n}</i>` : '';
    U.setHTML(U.$('#ops-tabs', root), [['bookings', 'Bookings'], ['alerts', 'Alerts' + badge(al)], ['calls', 'Calls' + badge(cw)], ['drivers', 'Drivers'], ['rules', 'Rules'], ['log', 'Log']].map(([k, l]) => `<button class="${O.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join(''));
  }
  function renderPane() {
    const p = pane(); p._h = null;
    if (O.tab === 'calls') { p.innerHTML = callsShell(); fillForm(); }
    else if (O.tab === 'rules') p.innerHTML = rulesHTML(); else refreshPane();
  }
  // Note: 'rules' isn't refreshed here on every tick/change (only when its tab is (re)opened, via renderPane
  // above) — its inputs hold direct DOM state (mid-drag slider position) that a live re-render would fight with;
  // other ops viewers still get the change the moment they switch to Rules themselves.
  function refreshPane() {
    const p = pane();
    if (O.tab === 'bookings') U.setHTML(p, bookingsHTML()); else if (O.tab === 'alerts') U.setHTML(p, alertsHTML()); else if (O.tab === 'drivers') U.setHTML(p, driversHTML()); else if (O.tab === 'log') U.setHTML(p, logHTML());
    else if (O.tab === 'calls') { U.setHTML(U.$('#call-queue', root), queueHTML()); caller(); }
  }
  let rtcNote = '';
  bus.on('rtc-error', msg => { rtcNote = ` · ⚠️ ${msg}`; refresh(); });
  bus.on('rtc-state', s => { rtcNote = s === 'connected' ? ' · 🔊 audio live' : s === 'connecting' ? ' · connecting audio…' : ''; refresh(); });
  function banner() {
    const sos = openAlerts().filter(a => a.type === 'sos'), el = U.$('#sos-banner', root);
    el.style.display = sos.length ? '' : 'none';
    U.setHTML(el, sos.map(a => `<div class="sos-row"><b>${U.esc(a.text)}</b><span><button class="btn sm" data-goto="${a.id}">Locate</button><button class="btn sm" data-sosdrv="${a.driverId}">📞 Call driver</button><button class="btn sm primary" data-ackid="${a.id}">Acknowledge</button></span></div>`).join(''));
    // A call between a driver and their rider (peer:'client') is none of ops's business — don't show or react
    // to it here, that's driver.js's/customer.js's own toast to handle.
    const vAll = st().voip, v = vAll && (vAll.peer || 'ops') === 'ops' ? vAll : null, m = U.$('#voip-modal', root); m.style.display = v ? '' : 'none';
    if (v) { const d = E.drv(v.driverId); if (d) U.setHTML(m, `<div class="voip"><div class="av">${U.initials(d.name)}</div><div><b>${v.state === 'ringing' ? (v.from === 'driver' ? '📞 Incoming: ' : '📞 Calling ') : '🎧 Connected: '}${d.id} ${U.esc(d.name)}</b><small>${(v.state === 'active' ? 'VoIP headset · ' + U.mmss((Date.now() - v.t1) / 1000) : v.from === 'driver' ? 'Driver is calling the ops room' : 'Ringing…') + rtcNote}</small></div>${v.state === 'ringing' && v.from === 'driver' ? '<button class="btn sm primary" data-act="voipans">Answer</button>' : ''}<button class="btn sm danger" data-act="voipend">${v.state === 'active' ? 'Hang up' : 'Cancel'}</button></div>`); }
  }
  function refresh() {
    if (!root.offsetParent) return; // ops room is not the active workspace
    kpis(); tabs(); refreshPane(); detail(); drawMap(); banner();
    root.classList.toggle('picking', !!O.pick);
    U.setText(U.$('#pick-hint', root), O.pick ? `Click the map to set the ${O.pick === 'pu' ? 'pickup' : 'drop-off'} location` : '');
  }

  /* ---------- interaction ---------- */
  function select(kind, id) { O.sel = { kind, id }; O.dkey = ''; refresh(); }
  function flash(t) { const m = U.$('#f-msg', root); if (m) { m.textContent = t; setTimeout(() => { if (m.textContent === t) m.textContent = ''; }, 3500); } }
  function prefill(req) {
    if (!req) return;
    F.pu = { key: 'pin', pt: { x: req.pickup.x, y: req.pickup.y, label: req.pickup.label || C.label(req.pickup) } }; F.dr = { key: 'pin', pt: { x: req.dropoff.x, y: req.dropoff.y, label: req.dropoff.label || C.label(req.dropoff) } };
    F.vehicle = req.vehicle || 'standard'; F.tags = (req.tags || []).slice();
  }
  function clearForm(keepCall) { Object.assign(F, { phone: keepCall ? F.phone : '', name: keepCall ? F.name : '', pu: { key: '' }, dr: { key: '' }, vehicle: 'standard', payment: 'card', when: 0, tags: [], note: '' }); if (!keepCall) F.callId = null; }
  root.addEventListener('click', async e => {
    const t = e.target.closest('button,[data-bk],[data-drv]'); if (!t) return; const d = t.dataset;
    if (d.tab) { O.tab = d.tab; renderPane(); refresh(); return; }
    if (d.filter) { O.filter = d.filter; refresh(); return; }
    if (d.bk && !d.act) { select('booking', d.bk); if (t.tagName === 'BUTTON') { O.tab = 'bookings'; renderPane(); } return; }
    if (d.drv) return select('driver', d.drv);
    if (d.goto) { const a = st().alerts.find(x => x.id === d.goto); if (a) select(a.bookingId ? 'booking' : 'driver', a.bookingId || a.driverId); return; }
    if (d.ackid) return E.ackAlert(d.ackid);
    if (d.retry) return E.retryPayment(d.retry);
    if (d.sosdrv) { rtcNote = ''; RO.RTC.startAsCaller(d.sosdrv); return E.voipStart(d.sosdrv); }
    if (d.answer) { const c = await E.answerCall(d.answer); if (!c) return; F.callId = c.id; F.phone = c.phone; F.name = c.name || ''; prefill(c.request); O.tab = 'calls'; renderPane(); refresh(); return; }
    if (d.endcall) { await E.endCall(d.endcall); if (F.callId === d.endcall) F.callId = null; return; }
    if (d.ftag) { const i = F.tags.indexOf(d.ftag); i < 0 ? F.tags.push(d.ftag) : F.tags.splice(i, 1); if (d.ftag === 'wheelchair') { F.vehicle = i < 0 ? 'access' : 'standard'; U.$('#f-veh', root).value = F.vehicle; } t.classList.toggle('on'); return; }
    const b = selBooking(), dr = selDriver();
    switch (d.act) {
      case 'close': O.sel = null; O.dkey = ''; return refresh();
      case 'assign': { const id = U.$('#dt-drv', root).value; if (b) await E.assign(b.id, id); return; }
      case 'cancel': if (b) await E.cancelBooking(b.id); return;
      case 'dispatch': if (b) await E.dispatchNow(b.id); return;
      case 'calldrv': { const did = (b && b.driverId) || (dr && dr.id); rtcNote = ''; RO.RTC.startAsCaller(did); return E.voipStart(did); }
      case 'voipend': RO.RTC.hangup(); return E.voipEnd();
      case 'voipans': { const v = st().voip; rtcNote = ''; if (v) RO.RTC.startAsCallee(v.driverId); return E.voipAnswer(); }
      case 'jam': return E.addJam();
      case 'pickpu': O.pick = O.pick === 'pu' ? null : 'pu'; return refresh(); case 'pickdr': O.pick = O.pick === 'dr' ? null : 'dr'; return refresh();
      case 'clear': clearForm(false); return fillForm();
      case 'uselast': { const cu = st().customers[U.normPhone(F.phone)], lt = cu && cu.trips[0]; if (lt) { prefill({ pickup: lt.pickup, dropoff: lt.dropoff, vehicle: lt.vehicle }); fillForm(); } return; }
      case 'endcall': if (F.callId) { const id = F.callId; F.callId = null; await E.endCall(id); clearForm(false); fillForm(); } return;
      case 'create': {
        const pu = fRes(F.pu), dof = fRes(F.dr); if (!pu || !dof) return flash('Choose pickup and drop-off first.');
        const nb = await E.createBooking({ phone: U.normPhone(F.phone), name: F.name || 'Caller', pickup: pu, dropoff: dof, vehicle: F.vehicle, payment: F.payment, whenMin: F.when, tags: F.tags, note: F.note, callId: F.callId });
        clearForm(true); fillForm(); flash(`Created ${nb.id}`); select('booking', nb.id); return;
      }
    }
  });
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.rule) { const v = +t.value; E.updateSettings({ [t.dataset.rule]: v }); const l = U.$('#v-' + t.dataset.rule, root); l.textContent = l.textContent.replace(/^[\d.]+/, v); }
    else if (t.id === 'f-phone') { F.phone = t.value; const cu = st().customers[U.normPhone(t.value)]; if (cu && !F.name) { F.name = cu.name; U.$('#f-name', root).value = cu.name; } U.$('#f-pu', root).innerHTML = fOpts(F.pu, 'Pickup location'); U.$('#f-dr', root).innerHTML = fOpts(F.dr, 'Drop-off location'); caller(); }
    else if (t.id === 'f-name') F.name = t.value; else if (t.id === 'f-note') F.note = t.value;
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.rulec) E.updateSettings({ [t.dataset.rulec]: t.checked });
    else if (t.id === 'f-pu') { F.pu = { key: t.value }; } else if (t.id === 'f-dr') { F.dr = { key: t.value }; }
    else if (t.id === 'f-veh') { F.vehicle = t.value; const i = F.tags.indexOf('wheelchair'); if (t.value === 'access' && i < 0) F.tags.push('wheelchair'); if (t.value !== 'access' && i >= 0) F.tags.splice(i, 1); fillForm(); }
    else if (t.id === 'f-pay') F.payment = t.value; else if (t.id === 'f-when') F.when = +t.value;
    else if (t.id === 'ops-heat') O.map.showHeat(t.checked); else if (t.id === 'ops-labels') root.classList.toggle('nolabels', !t.checked);
  });

  O.map = new MV(U.$('#ops-map', root), {
    labels: true, heat: true, slot: 'ops',
    onSelect: (k, id) => select(k, id),
    onTap: p => {
      if (!O.pick) return; const sel = { key: 'pin', pt: { x: p.x, y: p.y, label: C.label(p) } };
      if (O.pick === 'pu') F.pu = sel; else F.dr = sel; O.pick = null; O.tab = 'calls'; renderPane(); refresh();
    }
  });
  U.$('#ops-fit').addEventListener('click', () => O.map.fullView());
  let lt = 0; bus.on('tick', () => { const t = performance.now(); if (t - lt > 250) { lt = t; refresh(); } });
  bus.on('change', () => { if (O.tab === 'calls') refreshPane(); else refresh(); });
  bus.on('devshow', id => { if (id === 'ops') { renderPane(); refresh(); } });
  renderPane(); refresh();
})(window.RO);
