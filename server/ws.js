// WebSocket hub. One connection per open app tab; each is authenticated off
// the same session cookie used for REST (read during the HTTP upgrade,
// before the socket is accepted — see server/index.js), then attached to
// its company's World. From then on:
//   - the server pushes a full state snapshot to every socket in that
//     company whenever the world changes (see World._scheduleBroadcast),
//     which is what makes a rider's booking show up on the ops dashboard
//     and the driver's phone live, on separate devices;
//   - the client sends `{type:'action', id, name, args}` for anything that
//     changes shared state (accepting an offer, creating a booking...) —
//     handled here against an explicit per-role allow-list (ACTIONS below)
//     rather than exposing the engine's methods directly, so a client can
//     only ever do what its role is meant to and, for driver actions, only
//     ever to the one vehicle their login is bound to.
// Read-only calculations the UI needs instantly (fare estimates, ETAs)
// are NOT part of this protocol — the browser keeps its own copy of
// public/js/city.js + the read-only half of engine.js and computes those
// locally from the mirrored state, so typing in the booking form doesn't
// wait on a round trip.
'use strict';
const { WebSocketServer } = require('ws');
const { getWorld } = require('./world');
const { prisma } = require('./lib/db');

// name -> (ctx, args) => result. `ctx` carries the caller's resolved
// identity (role, name, phone/driver/company) — never trust an id the
// client sent for "which driver/booking is this" where ownership matters.
const CLIENT_ACTIONS = {
  createBooking: (ctx, a) => ctx.E.createBooking({ pickup: a.pickup, dropoff: a.dropoff, vehicle: a.vehicle, payment: a.payment, whenMin: a.whenMin, tags: a.tags, source: 'app', phone: ctx.phone, name: ctx.name }),
  cancelBooking: (ctx, a) => {
    const b = ctx.E.bk(a.id);
    if (!b || b.phone !== ctx.phone) return false;
    ctx.E.cancelBooking(a.id, 'rider'); return true;
  },
  // IVR simulator: an explicit demo of the phone line, not a security
  // boundary — the caller number is whatever the panel is dialling as.
  ivrDial: (ctx, a) => ctx.E.newCall(a.phone, a.extra),
  ivrQueue: (ctx, a) => { const c = ctx.state.calls.find(x => x.id === a.callId); if (c) ctx.E.queueCall(c, a.why); },
  ivrEndCall: (ctx, a) => ctx.E.endCall(a.id),
  ivrRebook: (ctx, a) => ctx.E.createBooking({ pickup: a.pickup, dropoff: a.dropoff, vehicle: a.vehicle, payment: 'card', source: 'ivr', phone: a.phone, name: a.name, callId: a.callId }),
  logEvent: (ctx, a) => ctx.E.log(String(a.text || '').slice(0, 300), 'ops'),
  // Saved places persist to the account (so they survive a restart and follow the rider to any device), not just
  // the in-memory world — kept in sync there too so this session's own UI sees the change immediately.
  // Cosmetic (dispatch never reads it) but has to be a real mutation on the shared world, not a client-side-only
  // flourish — the next snapshot push (every tick) would otherwise immediately overwrite a local-only change.
  rateTrip: (ctx, a) => {
    const b = ctx.E.bk(a.id); if (!b || b.phone !== ctx.phone || b.status !== 'completed') return false;
    b.rating = Math.max(1, Math.min(5, Number(a.rating) || 0));
    ctx.emitChange(); return true;
  },
  saveFavorites: async (ctx, a) => {
    const list = Array.isArray(a.favorites) ? a.favorites.slice(0, 20).map(f => ({ name: String(f.name || '').slice(0, 24), x: Number(f.x) || 0, y: Number(f.y) || 0 })) : [];
    await prisma.user.update({ where: { id: ctx.userId }, data: { favorites: JSON.stringify(list) } }).catch(() => {});
    const c = ctx.state.customers[ctx.phone]; if (c) c.favorites = list;
    ctx.emitChange();
  }
};

const DRIVER_ACTIONS = {
  setOnline: (ctx, a) => {
    const d = ctx.driver; if (!d) return;
    d.online = !!a.online;
    if (!d.online && d.bookingId) ctx.E.driverCancel(d, 'Went offline');
    if (!d.online) { d.status = 'available'; d.path = d.path.slice(0, 1); d.gpsTracked = false; } // stop trusting a GPS fix from before they went offline
    ctx.E.log(`${d.id} ${d.online ? 'went online' : 'went offline'}`);
    ctx.emitChange();
  },
  // A real GPS fix from the driver's phone (see public/js/driver.js) — replaces this vehicle's simulated
  // position with where it actually is, snapped onto the nearest real road (see nearestOnRoad in city.js).
  // Silently ignored (not an error) when the fix isn't near any mapped road at all — e.g. testing from outside
  // the service area, or before a fix arrives — so the caller falls back to simulated movement instead.
  updateLocation: (ctx, a) => {
    const d = ctx.driver; if (!d || !d.online) return { applied: false, reason: 'offline' };
    const lat = Number(a.lat), lng = Number(a.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { applied: false, reason: 'invalid' };
    const hit = ctx.C.nearestOnRoad(lat, lng);
    if (!hit || hit.distKm > 5) return { applied: false, reason: 'outside-service-area', distKm: hit ? +hit.distKm.toFixed(1) : null };

    d.pos = { x: hit.x, y: hit.y };
    d.gpsTracked = true; d.gpsAt = Date.now(); d.gpsAccuracyKm = +hit.distKm.toFixed(3);

    const b = ctx.E.bk(d.bookingId);
    if (b && (b.status === 'enroute' || b.status === 'ontrip')) {
      const target = b.status === 'enroute' ? b.pickup : b.dropoff;
      // "arrived" is decided by real proximity now (within ~80m), not by a simulated path running out.
      if (ctx.C.distKm(d.pos, target) < 0.08) { d.path = []; d.atTarget = true; }
      else { d.path = ctx.C.route(d.pos, target); d.atTarget = false; }
    } else { d.path = []; d.atTarget = false; }
    ctx.emitChange();
    return { applied: true };
  },
  acceptOffer: ctx => ctx.driver && ctx.E.acceptOffer(ctx.driver),
  declineOffer: ctx => ctx.driver && ctx.E.declineOffer(ctx.driver, 'declined'),
  arrived: ctx => ctx.driver && ctx.E.arrived(ctx.driver),
  startTrip: ctx => ctx.driver && ctx.E.startTrip(ctx.driver),
  completeTrip: ctx => ctx.driver && ctx.E.completeTrip(ctx.driver),
  driverCancel: (ctx, a) => ctx.driver && ctx.E.driverCancel(ctx.driver, a.reason || 'Cancelled'),
  sos: ctx => ctx.driver && ctx.E.sos(ctx.driver),
  voipStart: ctx => ctx.driver && ctx.E.voipStart(ctx.driver.id, 'driver'),
  voipAnswer: ctx => ctx.E.voipAnswer(),
  voipEnd: ctx => ctx.E.voipEnd(),
  logEvent: (ctx, a) => ctx.E.log(String(a.text || '').slice(0, 300), 'ops')
};

const OPS_ACTIONS = {
  createBooking: (ctx, a) => ctx.E.createBooking({ pickup: a.pickup, dropoff: a.dropoff, vehicle: a.vehicle, payment: a.payment, whenMin: a.whenMin, tags: a.tags, note: a.note, source: 'ops', phone: a.phone, name: a.name, operator: ctx.name, callId: a.callId }),
  assign: (ctx, a) => ctx.E.assign(a.bookingId, a.driverId, ctx.name),
  cancelBooking: (ctx, a) => ctx.E.cancelBooking(a.id, 'operator'),
  dispatchNow: (ctx, a) => ctx.E.dispatchNow(a.id),
  retryPayment: (ctx, a) => ctx.E.retryPayment(a.id),
  ackAlert: (ctx, a) => ctx.E.ackAlert(a.id, a.resolve),
  answerCall: (ctx, a) => ctx.E.answerCall(a.id, ctx.name),
  endCall: (ctx, a) => ctx.E.endCall(a.id),
  simInboundCall: ctx => ctx.E.simInboundCall(),
  voipStart: (ctx, a) => ctx.E.voipStart(a.driverId, 'ops'),
  voipAnswer: ctx => ctx.E.voipAnswer(),
  voipEnd: ctx => ctx.E.voipEnd(),
  addJam: ctx => ctx.E.addJam(),
  spawnDemand: ctx => ctx.E.spawnDemand(),
  setPaused: (ctx, a) => ctx.E.setPaused(!!a.paused),
  setSpeed: (ctx, a) => { ctx.state.speed = Number(a.speed) || ctx.state.speed; ctx.emitChange(); },
  updateSettings: (ctx, a) => { Object.assign(ctx.state.settings, a.patch || {}); ctx.emitChange(); },
  reset: ctx => ctx.E.reset(),
  logEvent: (ctx, a) => ctx.E.log(String(a.text || '').slice(0, 300), 'ops')
};

const ACTIONS_BY_ROLE = { CLIENT: CLIENT_ACTIONS, DRIVER: DRIVER_ACTIONS, OPS: OPS_ACTIONS, SUPERUSER: {} };

function attach(server, { onUpgradeAuth }) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/ws')) return;
    onUpgradeAuth(req).then(user => {
      if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, user));
    }).catch(() => { socket.destroy(); });
  });

  wss.on('connection', async (ws, req, user) => {
    if (!user.companyId) { ws.close(4001, 'No company'); return; }
    const world = await getWorld(user.companyId);
    if (!world) { ws.close(4004, 'Unknown company'); return; }

    const actions = ACTIONS_BY_ROLE[user.role] || {};
    const ctx = {
      role: user.role, name: user.name, phone: user.phone, userId: user.id,
      state: world.state, E: world.E, C: world.RO.City,
      get driver() { return world.driverForUser(user.id); },
      emitChange: () => world.RO.bus.emit('change')
    };

    const sendSnapshot = () => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'state', state: world.state })); };
    // Sent once, right away: lets the client confirm the identity this connection actually authenticated as
    // matches what it believes it signed in as. Matters when a browser reconnects (e.g. after a network blip) —
    // the reconnect re-reads whatever cookie is current, which, if a *different* account signed in on another tab
    // of the same browser since, is no longer this one. Two different people on two different devices (the normal
    // case) never share a cookie jar, so this never fires for them.
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'hello', role: user.role.toLowerCase(), name: user.name, phone: user.phone, driverId: ctx.driver ? ctx.driver.id : null }));
    const onSms = m => { if (user.role === 'CLIENT' && m.to === user.phone) safeSend({ type: 'sms', to: m.to, text: m.text }); };
    const onMsg = text => { if (user.role === 'DRIVER' && ctx.driver) safeSend({ type: 'driver-msg', text }); };
    // Carries fare/payment directly rather than making the client re-look-up the booking from its own mirrored
    // state: that snapshot is only refreshed a few times a second, so right after this fires it can still be one
    // tick stale (fare not set yet) — this message is already the freshest read there is.
    const onCompleted = m => {
      if (user.role !== 'DRIVER' || !ctx.driver || m.driverId !== ctx.driver.id) return;
      const b = world.E.bk(m.bid);
      safeSend({ type: 'completed', driverId: m.driverId, bid: m.bid, fare: b ? b.fare : null, payment: b ? b.payment : null });
    };
    function safeSend(obj) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }

    world.listeners.add(sendSnapshot);
    world.smsListeners.add(onSms);
    world.msgListeners.add(onMsg);
    world.completedListeners.add(onCompleted);
    sendSnapshot();

    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.type !== 'action') return;
      const fn = actions[msg.name];
      if (!fn) { safeSend({ type: 'result', id: msg.id, ok: false, value: null, error: 'Not allowed for this role.' }); return; }
      // Actions may be sync or async (saveFavorites hits the database) — always go through Promise.resolve so
      // either shape is awaited the same way, and a rejected promise is caught exactly like a thrown error.
      Promise.resolve().then(() => fn(ctx, msg.args || {}))
        .then(value => safeSend({ type: 'result', id: msg.id, ok: true, value: value === undefined ? null : value, error: null }))
        .catch(err => {
          const error = err && err.message ? err.message : String(err);
          console.error('[ws] action failed:', msg.name, err);
          safeSend({ type: 'result', id: msg.id, ok: false, value: null, error });
        });
    });

    ws.on('close', () => { world.listeners.delete(sendSnapshot); world.smsListeners.delete(onSms); world.msgListeners.delete(onMsg); world.completedListeners.delete(onCompleted); });
    ws.on('error', () => {});
  });

  return wss;
}

module.exports = { attach };
