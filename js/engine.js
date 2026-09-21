/* Dispatch engine (CAD): rule-based matching, offers, exceptions, overrides, payments, calls, simulation. */
(function (RO) {
  'use strict';
  const C = RO.City, U = RO.util, V = RO.VEH, bus = RO.bus;
  const S = () => RO.state, now = () => Date.now();
  const drv = id => S().drivers.find(d => d.id === id);
  const bk = id => S().bookings.find(b => b.id === id);
  const SRC = { app: 'Mobile app', ivr: 'IVR phone line', ops: 'Operator', sim: 'Mobile app' };

  function log(text, kind) { const s = S(); s.log.unshift({ t: s.simSec, text, kind: kind || 'info' }); if (s.log.length > 250) s.log.pop(); bus.emit('log'); }
  function sms(to, text) { const s = S(); s.sms.unshift({ t: s.simSec, to, text }); if (s.sms.length > 60) s.sms.pop(); bus.emit('sms', { to, text }); }
  const stamp = (b, text) => b.timeline.push({ t: S().simSec, text });
  function raise(type, sev, text, extra) {
    const a = Object.assign({ id: U.uid('A'), type, sev, text, t: S().simSec, ack: false, resolved: false }, extra);
    S().alerts.unshift(a); if (S().alerts.length > 80) S().alerts.pop();
    log(text, sev === 'crit' ? 'crit' : 'warn'); bus.emit('alert', a); return a;
  }
  const pt = p => { const n = C.snap(p); return { x: n.x, y: n.y, label: p.label || C.label(n) }; };

  /* ---------- matching / rule engine ---------- */
  const RANK = { standard: 1, comfort: 2, xl: 3 };
  function canServe(d, b) {
    if (b.vehicle === 'access' || (b.tags || []).includes('wheelchair')) return d.vehicle === 'access';
    return d.vehicle !== 'access' && RANK[d.vehicle] >= RANK[b.vehicle];
  }
  function planPath(d, target) {
    const first = d.path[0], from = first || C.snap(d.pos), r = C.route(from, target);
    return first ? [first].concat(r.slice(1)) : r.slice(1);
  }
  function etaTo(d, target) {
    const info = C.polyInfo([d.pos].concat(planPath(d, target)));
    return { etaMin: info.etaSec / 60, km: info.km, avgDensity: info.avgDensity };
  }
  function candidates(b) {
    const st = S().settings, out = [];
    for (const d of S().drivers) {
      if (!d.online || d.status !== 'available' || (b.declinedBy || []).includes(d.id) || !canServe(d, b)) continue;
      const i = etaTo(d, b.pickup);
      if (i.etaMin > st.maxEtaMin) continue;
      const score = st.wETA * i.etaMin + st.wTraffic * i.avgDensity * 10 + st.wRating * (5 - d.rating) * 4 - (d.human && st.favorHuman ? 6 : 0);
      out.push(Object.assign({ d, score }, i));
    }
    return out.sort((a, b) => a.score - b.score);
  }
  function estimate(pu, dof, veh) {
    const inf = C.polyInfo(C.route(pu, dof)), v = V[veh], min = inf.etaSec / 60;
    const c = candidates({ pickup: pu, vehicle: veh, tags: veh === 'access' ? ['wheelchair'] : [], declinedBy: [] })[0];
    return { km: inf.km, min, fare: v.base + v.perKm * inf.km + v.perMin * min, pickupEta: c ? c.etaMin : null };
  }
  function driverEta(b) {
    const d = drv(b.driverId); if (!d) return null;
    return C.polyInfo([d.pos].concat(d.path)).etaSec / 60;
  }
  function assignable(b) {
    return S().drivers.filter(d => d.online && (d.status === 'available' || d.status === 'offered') && canServe(d, b) && d.id !== b.driverId)
      .map(d => Object.assign({ d }, etaTo(d, b.pickup))).sort((a, c) => a.etaMin - c.etaMin);
  }

  /* ---------- bookings ---------- */
  function createBooking(o) {
    const s = S(), pickup = pt(o.pickup), dropoff = pt(o.dropoff), veh = o.vehicle || 'standard', when = o.whenMin || 0;
    const b = {
      id: 'RB-' + (s.seq++), source: o.source || 'app', phone: o.phone || '', name: o.name || 'Guest', pickup, dropoff, vehicle: veh,
      payment: o.payment || 'card', tags: (o.tags || []).slice(), note: o.note || '', status: when > 0 ? 'scheduled' : 'pending',
      createdSim: s.simSec, scheduledSim: when > 0 ? s.simSec + when * 60 : null, pendingSince: now(), driverId: null, offer: null,
      declinedBy: [], est: estimate(pickup, dropoff, veh), fare: null, pay: { state: 'none' }, timeline: [], alerted: false, sos: false,
      rating: null, operator: o.operator || null, callId: o.callId || null
    };
    stamp(b, `Booked via ${SRC[b.source] || b.source}${b.operator ? ' by ' + b.operator : ''}`);
    s.bookings.push(b);
    log(`${b.id} ${b.source === 'ops' ? '🎧' : b.source === 'ivr' ? '☎️' : '📱'} ${pickup.label} → ${dropoff.label} (${V[veh].label}${when ? ', in ' + when + ' min' : ''})`);
    if (b.phone) sms(b.phone, `RideOps: booking ${b.id} confirmed. ${when ? 'Pickup at ' + U.clock(b.scheduledSim) : 'Finding your driver now'}. Est. ${U.money(b.est.fare)}.`);
    bus.emit('change'); return b;
  }
  function releaseDriver(d) {
    d.bookingId = null; d.offerBookingId = null; d.atTarget = false; d.botAt = 0; d.willCancelAt = 0;
    d.path = d.path.slice(0, 1); d.status = 'available';
  }
  function makeOffer(b, c) {
    const d = c.d, t = now();
    b.offer = { driverId: d.id, expiresAt: t + S().settings.offerSec * 1000, etaMin: c.etaMin, km: c.km };
    if (!d.human) {
      const r = Math.random(), at = t + U.rnd(2, 8) * 1000;
      b.offer.bot = { action: r < .78 ? 'accept' : r < .9 ? 'decline' : 'ignore', at: r < .9 ? at : Infinity };
    }
    b.status = 'offered'; d.status = 'offered'; d.offerBookingId = b.id;
    stamp(b, `Offered to ${d.name} (${d.id}), ${c.etaMin.toFixed(1)} min away`); bus.emit('change');
  }
  function acceptOffer(d) {
    const b = bk(d.offerBookingId); if (!b || b.status !== 'offered') return;
    b.offer = null; b.driverId = d.id; b.status = 'enroute'; d.status = 'enroute'; d.bookingId = b.id; d.offerBookingId = null;
    d.path = planPath(d, b.pickup); d.atTarget = false;
    if (!d.human && Math.random() < S().settings.botCancelPct / 100) d.willCancelAt = now() + U.rnd(4, 10) * 1000;
    stamp(b, `${d.name} accepted`); b.acceptedSim = S().simSec;
    if (b.phone) sms(b.phone, `RideOps: ${d.name} (${d.model}, ${d.plate}) is on the way, ETA ${Math.max(1, Math.round(driverEta(b)))} min.`);
    bus.emit('change');
  }
  function declineOffer(d, why) {
    const b = bk(d.offerBookingId); d.status = 'available'; d.offerBookingId = null;
    if (!b) return;
    b.declinedBy.push(d.id); b.offer = null; b.status = 'pending';
    stamp(b, `${d.name} ${why === 'timeout' ? 'did not respond (timeout)' : 'declined'}`);
    log(`${d.id} ${why === 'timeout' ? 'missed offer' : 'declined'} ${b.id}`); bus.emit('change');
  }
  function arrived(d) {
    const b = bk(d.bookingId); if (!b || b.status !== 'enroute') return;
    b.status = 'arrived'; d.status = 'arrived'; d.atTarget = false; b.arrivedSim = S().simSec; stamp(b, 'Driver arrived at pickup');
    if (b.acceptedSim != null) { S().stats.waitSum += (b.arrivedSim - b.createdSim) / 60; S().stats.waitN++; }
    if (b.phone) sms(b.phone, `RideOps: your driver has arrived (${d.plate}).`);
    bus.emit('change');
  }
  function startTrip(d) {
    const b = bk(d.bookingId); if (!b || b.status !== 'arrived') return;
    b.status = 'ontrip'; d.status = 'ontrip'; b.startSim = S().simSec; stamp(b, 'Trip started');
    const r = C.route(b.pickup, b.dropoff); b.tripKm = C.polyInfo(r).km; d.path = r.slice(1); d.atTarget = false; d.botAt = 0;
    bus.emit('change');
  }
  function completeTrip(d) {
    const b = bk(d.bookingId); if (!b || b.status !== 'ontrip') return;
    const s = S(), v = V[b.vehicle]; b.endSim = s.simSec;
    b.fare = +(v.base + v.perKm * b.tripKm + v.perMin * (b.endSim - b.startSim) / 60).toFixed(2);
    b.status = 'completed'; stamp(b, 'Trip completed, fare ' + U.money(b.fare));
    b.pay = b.payment === 'corp' ? { state: 'invoiced' } : b.payment === 'cash' ? { state: 'cash' } : { state: 'processing', at: now() + 2500 };
    d.earnings += b.fare * .8; d.trips++; releaseDriver(d); d.path = [];
    s.stats.done++; s.stats.revenue += b.fare;
    const c = s.customers[b.phone];
    if (c) { c.trips.unshift({ id: b.id, at: s.simSec, pickup: b.pickup, dropoff: b.dropoff, fare: b.fare, vehicle: b.vehicle }); c.trips.length = Math.min(c.trips.length, 20); RO.save(); }
    if (b.phone) sms(b.phone, `RideOps receipt ${b.id}: ${U.money(b.fare)} (${RO.PAY[b.payment]}). Thanks for riding!`);
    bus.emit('completed', { driverId: d.id, bid: b.id }); bus.emit('change');
  }
  function retryPayment(id) { const b = bk(id); if (b && b.pay.state === 'failed') { b.pay = { state: 'processing', at: now() + 1500, noFail: true }; stamp(b, 'Payment retried by ops'); bus.emit('change'); } }
  function cancelBooking(id, by) {
    const b = bk(id); if (!b || ['completed', 'cancelled'].includes(b.status)) return;
    const d = drv(b.driverId) || (b.offer && drv(b.offer.driverId));
    if (d) { const wasHuman = d.human; releaseDriver(d); if (wasHuman) bus.emit('driver-msg', `${b.id} was cancelled by ${by}.`); }
    b.status = 'cancelled'; b.offer = null; stamp(b, 'Cancelled by ' + by); log(`${b.id} cancelled by ${by}`);
    S().alerts.forEach(a => { if (a.bookingId === id && !a.resolved) a.resolved = true; });
    bus.emit('change');
  }
  function driverCancel(d, reason) {
    const b = bk(d.bookingId); if (!b || !['enroute', 'arrived'].includes(b.status)) return;
    b.declinedBy.push(d.id); b.driverId = null; b.status = 'pending'; b.pendingSince = now(); b.alerted = false; releaseDriver(d);
    stamp(b, `${d.name} cancelled: ${reason}`);
    raise('driver_cancel', 'high', `${d.name} (${d.id}) cancelled ${b.id}: ${reason}. ${S().settings.autoDispatch ? 'Re-dispatching automatically.' : 'Needs manual dispatch.'}`, { bookingId: b.id, driverId: d.id });
    if (b.phone) sms(b.phone, `RideOps: your driver had to cancel. We're finding you another one.`);
    bus.emit('change');
  }
  /* Manual override: ops force-assigns a driver, replacing whatever was in progress. */
  function assign(bid, did, by) {
    const b = bk(bid), d = drv(did);
    if (!b || !d || !d.online || ['ontrip', 'completed', 'cancelled'].includes(b.status)) return false;
    if (!['available', 'offered'].includes(d.status)) return false;
    const prev = drv(b.driverId) || (b.offer && drv(b.offer.driverId));
    if (prev && prev !== d) { releaseDriver(prev); if (prev.human) bus.emit('driver-msg', `${b.id} was reassigned to another driver.`); }
    if (d.status === 'offered') { const ob = bk(d.offerBookingId); if (ob && ob !== b) { ob.offer = null; ob.status = 'pending'; } }
    b.offer = null; b.driverId = d.id; b.status = 'enroute'; b.forced = true; b.acceptedSim = S().simSec;
    d.status = 'enroute'; d.bookingId = b.id; d.offerBookingId = null; d.path = planPath(d, b.pickup); d.atTarget = false; d.willCancelAt = 0;
    stamp(b, `Manually assigned to ${d.name} by ${by || 'ops'}`); log(`${b.id} manually assigned to ${d.id} by ${by || 'ops'}`, 'ops');
    S().alerts.forEach(a => { if (a.bookingId === bid && !a.resolved && a.type !== 'sos') a.resolved = true; });
    if (d.human) bus.emit('driver-msg', `Ops assigned you ${b.id}. Head to pickup.`);
    if (b.phone) sms(b.phone, `RideOps: ${d.name} (${d.model}, ${d.plate}) is on the way.`);
    bus.emit('change'); return true;
  }
  function dispatchNow(id) { const b = bk(id); if (b && b.status === 'scheduled') { b.status = 'pending'; b.pendingSince = now(); stamp(b, 'Dispatched early by ops'); bus.emit('change'); } }
  function sos(d) {
    const b = bk(d.bookingId); if (b) { b.sos = true; stamp(b, '🆘 SOS from driver'); }
    raise('sos', 'crit', `🆘 EMERGENCY: ${d.name} (${d.id}) pressed SOS near ${C.label(C.snap(d.pos))}${b ? ' during ' + b.id : ''}`, { bookingId: b && b.id, driverId: d.id });
  }
  function ackAlert(id, resolve) { const a = S().alerts.find(x => x.id === id); if (a) { a.ack = true; if (resolve) a.resolved = true; bus.emit('alert'); } }

  /* ---------- calls / IVR / CTI / VoIP ---------- */
  function newCall(phone, extra) {
    const c = Object.assign({ id: U.uid('C'), phone, name: (S().customers[phone] || {}).name || null, state: 'ivr', t0: now(), tq: 0 }, extra);
    S().calls.push(c); bus.emit('change'); return c;
  }
  function queueCall(c, why) { c.state = 'queued'; c.tq = now(); c.why = why; log(`☎️ ${U.fmtPhone(c.phone)} waiting for an operator (${why})`, 'ops'); bus.emit('change'); }
  function answerCall(id, op) { const c = S().calls.find(x => x.id === id); if (c && c.state === 'queued') { c.state = 'active'; c.operator = op || 'Dana'; c.tAns = now(); bus.emit('change'); } return c; }
  function endCall(id) { const c = S().calls.find(x => x.id === id); if (c && c.state !== 'ended') { c.state = 'ended'; c.tEnd = now(); bus.emit('change'); } }
  /* random trip ends; ~1 in 8 trips is to or from the airport */
  function tripEnds() {
    let from = C.randomNode(), to = C.randomNode();
    for (let i = 0; i < 6 && Math.abs(to.x - from.x) + Math.abs(to.y - from.y) < 300; i++) to = C.randomNode();
    const ap = C.LM.find(l => l.id === 'airport');
    if (ap && Math.random() < .125) { if (Math.random() < .5) from = { x: ap.x, y: ap.y }; else to = { x: ap.x, y: ap.y }; }
    return { from, to };
  }
  function simInboundCall() {
    const { from, to } = tripEnds();
    const wheel = Math.random() < .2, name = U.pick(RO.SIM_NAMES);
    const c = newCall('+3834' + U.ri(4, 9) + U.ri(100000, 999999), {
      sim: true, name, request: { pickup: from, dropoff: to, vehicle: wheel ? 'access' : 'standard', tags: wheel ? ['wheelchair'] : [] },
      notes: `${name} wants a taxi from ${C.label(from)} to ${C.label(to)}${wheel ? ' — needs wheelchair access' : ''}.`
    });
    queueCall(c, 'direct dial');
  }
  function voipStart(did, from) {
    const d = drv(did); if (!d) return;
    S().voip = { driverId: did, from: from || 'ops', t0: now(), state: 'ringing', answerAt: (from === 'driver' || d.human) ? 0 : now() + 1500 };
    bus.emit('voip');
  }
  function voipAnswer() { const v = S().voip; if (v && v.state === 'ringing') { v.state = 'active'; v.t1 = now(); bus.emit('voip'); } }
  function voipEnd() { if (S().voip) { log(`📞 VoIP call with ${S().voip.driverId} ended`, 'ops'); S().voip = null; bus.emit('voip'); } }

  /* ---------- simulation ---------- */
  function moveDrivers(dtSim) {
    for (const d of S().drivers) {
      if (!d.online) continue;
      if (d.path.length) {
        let km = C.speedKmh(d.pos.x, d.pos.y) * d.speedMul / 3600 * dtSim; // real km to travel this tick
        while (km > 0 && d.path.length) {
          const t = d.path[0], dx = t.x - d.pos.x, dy = t.y - d.pos.y, len = Math.abs(dx) + Math.abs(dy);
          if (len) d.heading = dx > 0 ? 0 : dx < 0 ? 180 : dy > 0 ? 90 : 270;
          const kph = C.kmPerHundred(d.pos, t), need = len / 100 * kph; // real road length of the remaining part of this edge
          if (need <= km) { d.pos = { x: t.x, y: t.y }; d.path.shift(); km -= need; }
          else { const u = km / kph * 100; d.pos = { x: d.pos.x + Math.sign(dx) * u, y: d.pos.y + Math.sign(dy) * u }; km = 0; }
        }
      }
      if (!d.path.length && (d.status === 'enroute' || d.status === 'ontrip')) d.atTarget = true;
    }
  }
  function botStep(d) {
    if (d.human || !d.online) return; const t = now();
    if (d.status === 'enroute' && d.willCancelAt && t > d.willCancelAt) { driverCancel(d, U.pick(['Vehicle problem', 'Flat tyre', 'Personal emergency'])); return; }
    const step = fn => { if (!d.botAt) d.botAt = t + 800; else if (t >= d.botAt) { d.botAt = 0; fn(d); } };
    if (d.status === 'enroute' && d.atTarget) step(arrived);
    else if (d.status === 'arrived') { if (!d.botAt) d.botAt = t + U.rnd(3, 7) * 1000; else if (t >= d.botAt) { d.botAt = 0; startTrip(d); } }
    else if (d.status === 'ontrip' && d.atTarget) step(completeTrip);
    else if (d.status === 'available' && !d.path.length && Math.random() < .03) {
      const n = C.snap({ x: d.pos.x + U.ri(-3, 3) * 100, y: d.pos.y + U.ri(-3, 3) * 100 });
      d.path = C.route(d.pos, n).slice(1);
    }
  }
  function dispatchStep() {
    const s = S(), t = now();
    for (const b of s.bookings) {
      if (b.status === 'scheduled' && s.simSec >= b.scheduledSim - s.settings.leadMin * 60) { b.status = 'pending'; b.pendingSince = t; stamp(b, 'Scheduled ride released to dispatch'); log(`${b.id} released to dispatch`); }
      if (b.status === 'offered' && b.offer) {
        const d = drv(b.offer.driverId), bot = b.offer.bot;
        if (bot && t >= bot.at) bot.action === 'accept' ? acceptOffer(d) : declineOffer(d, 'declined');
        else if (t >= b.offer.expiresAt) declineOffer(d, 'timeout');
      }
    }
    if (s.settings.autoDispatch) for (const b of s.bookings) if (b.status === 'pending') { const c = candidates(b); if (c.length) makeOffer(b, c[0]); }
  }
  function spawnDemand() {
    const { from, to } = tripEnds();
    const r = Math.random(), veh = r < .8 ? 'standard' : r < .92 ? 'comfort' : r < .97 ? 'xl' : 'access', src = U.pick(['app', 'app', 'app', 'ivr', 'ops']);
    createBooking({
      source: src, phone: '+3834' + U.ri(4, 9) + U.ri(100000, 999999), name: U.pick(RO.SIM_NAMES), pickup: from, dropoff: to, vehicle: veh,
      tags: veh === 'access' ? ['wheelchair'] : [], payment: U.pick(['card', 'card', 'wallet', 'corp', 'cash']), whenMin: Math.random() < .1 ? 20 : 0, operator: src === 'ops' ? 'Dana' : null
    });
  }
  function slowStep() {
    const s = S(), t = now();
    for (const b of s.bookings) {
      if (['pending', 'offered'].includes(b.status) && !b.alerted && t - b.pendingSince > s.settings.unassignedSec * 1000) {
        b.alerted = true; raise('unassigned', 'high', `${b.id} unassigned for ${s.settings.unassignedSec}s (${b.pickup.label} → ${b.dropoff.label}, ${V[b.vehicle].label})`, { bookingId: b.id });
      }
      if (b.pay.state === 'processing' && t >= b.pay.at) {
        if (!b.pay.noFail && Math.random() < .06) { b.pay = { state: 'failed' }; raise('payment', 'med', `Payment failed for ${b.id} (${RO.PAY[b.payment]}, ${U.money(b.fare)})`, { bookingId: b.id }); }
        else { b.pay = { state: 'paid' }; stamp(b, 'Payment captured ' + U.money(b.fare)); }
      }
    }
    if (s.settings.demandOn && t >= s.demandNext) { spawnDemand(); s.demandNext = t + s.settings.demandEvery * 1000 * U.rnd(.6, 1.4); }
    if (s.settings.demandOn && t >= s.callNext) { if (s.calls.filter(c => c.state === 'queued').length < 3) simInboundCall(); s.callNext = t + U.rnd(50, 90) * 1000; }
    for (const c of s.calls) if (c.sim && c.state === 'queued' && t - c.tq > 150000) { c.state = 'ended'; c.abandoned = true; c.tEnd = t; log(`☎️ ${U.fmtPhone(c.phone)} abandoned the queue`, 'warn'); }
    if (s.calls.length > 30) s.calls = s.calls.filter(c => c.state !== 'ended').concat(s.calls.filter(c => c.state === 'ended').slice(-8));
    if (s.voip && s.voip.state === 'ringing' && s.voip.answerAt && t >= s.voip.answerAt) voipAnswer();
  }
  function tick(dt) {
    const s = S(); if (s.paused) return;
    s.simSec += dt * s.speed; C.updateTraffic(s.simSec, dt);
    moveDrivers(dt * s.speed); s.drivers.forEach(botStep); dispatchStep();
    s._acc = (s._acc || 0) + dt; if (s._acc >= 1) { s._acc = 0; slowStep(); }
    bus.emit('tick');
  }
  function setPaused(p) {
    const s = S(); if (p === s.paused) return;
    if (p) s._pausedAt = now();
    else { const dl = now() - s._pausedAt; s.bookings.forEach(b => { b.pendingSince += dl; if (b.offer) { b.offer.expiresAt += dl; if (b.offer.bot && isFinite(b.offer.bot.at)) b.offer.bot.at += dl; } }); s.drivers.forEach(d => { if (d.botAt) d.botAt += dl; if (d.willCancelAt) d.willCancelAt += dl; }); }
    s.paused = p; bus.emit('change');
  }
  function addJam() { const z = C.addJam(); log(`🚧 Major incident: heavy congestion building near ${C.label({ x: z.zx * 200 + 100, y: z.zy * 200 + 100 })}`, 'warn'); }
  function reset() { RO.state = RO.newState(); bus.emit('reset'); bus.emit('change'); log('Simulation reset'); }

  RO.E = { S, drv, bk, log, sms, raise, candidates, canServe, estimate, driverEta, assignable, createBooking, acceptOffer, declineOffer, arrived, startTrip, completeTrip, retryPayment, cancelBooking, driverCancel, assign, dispatchNow, sos, ackAlert, newCall, queueCall, answerCall, endCall, simInboundCall, voipStart, voipAnswer, voipEnd, tick, setPaused, addJam, reset, spawnDemand };
})(window.RO);
