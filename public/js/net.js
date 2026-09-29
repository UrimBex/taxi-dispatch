/* Live connection to the server: mirrors RO.state from the server's push and turns every mutating RO.E.* call into
   a WebSocket round trip. Loaded after engine.js — it monkey-patches only the MUTATING methods on RO.E (createBooking,
   acceptOffer, ...) into thin RPC wrappers; the read-only ones (estimate, driverEta, candidates, canServe,
   assignable, drv, bk, S) are left as engine.js's own local implementations, computed instantly against the
   mirrored RO.state, so the UI never waits on the network just to show a fare quote.
   Argument shapes intentionally match the OLD synchronous engine.js calls the UI already makes (an ignored leading
   driver-object arg for driver actions, etc.) so call sites mostly only need `await` added, not rewritten — see
   AGENTS.md. Most calls are fire-and-forget from the caller's point of view (the resulting state push does the
   rest); a few return a value the UI still reads (createBooking, answerCall, assign). */
(function (RO) {
  'use strict';
  const bus = RO.bus;
  let ws = null, seq = 1, reconnectMs = 1000;
  const pending = new Map();

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }
  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(wsUrl());
    ws.onopen = () => { reconnectMs = 1000; bus.emit('live', true); };
    ws.onclose = () => { bus.emit('live', false); if (RO.session) setTimeout(connect, Math.min(reconnectMs *= 1.5, 10000)); };
    ws.onerror = () => {};
    ws.onmessage = e => {
      let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === 'hello') {
        const s = RO.session;
        // Purely a friendly signal, not a security check — the server already enforces who can do what on every
        // action regardless of what this comparison decides. Compares whatever distinguishes an account for its
        // role (phone for a rider, which vehicle for a driver, display name otherwise, since staff logins carry
        // no phone number).
        const changed = s && (s.role !== msg.role || (s.role === 'client' ? s.phone !== msg.phone : s.role === 'driver' ? s.driverId !== msg.driverId : s.name !== msg.name));
        if (changed) { RO.auth.sessionReplaced(); return; }
      }
      else if (msg.type === 'state') { RO.state = msg.state; bus.emit('change'); bus.emit('tick'); }
      else if (msg.type === 'sms') bus.emit('sms', { to: msg.to, text: msg.text });
      else if (msg.type === 'driver-msg') bus.emit('driver-msg', msg.text);
      else if (msg.type === 'completed') bus.emit('completed', { driverId: msg.driverId, bid: msg.bid, fare: msg.fare, payment: msg.payment });
      else if (msg.type === 'rtc') bus.emit('rtc', { driverId: msg.driverId, kind: msg.kind, payload: msg.payload, from: msg.from });
      else if (msg.type === 'result') { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); msg.ok ? p.resolve(msg.value) : p.reject(new Error(msg.error || 'Action failed')); } }
    };
  }
  // One-way WebRTC signaling (SDP offer/answer, ICE candidates) — no response expected, so this bypasses the
  // request/response rpc() plumbing above. See public/js/rtc.js for what sends/receives these. `peer` only
  // matters for a driver sender (ops vs rider) — the server infers it for OPS/CLIENT senders regardless of
  // what's passed, so other callers can just omit it.
  function sendRtc(driverId, kind, payload, peer) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'rtc', driverId, kind, payload, peer })); }
  function disconnect() { if (ws) { ws.onclose = null; ws.close(); ws = null; } pending.forEach(p => p.reject(new Error('disconnected'))); pending.clear(); }

  function rpc(name, args) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('Not connected'));
      const id = seq++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ type: 'action', id, name, args: args || {} }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Timed out')); } }, 12000);
    });
  }

  // driver.js passes its own driver object/reason as the first arg(s), exactly like the old local engine call —
  // the server resolves "which vehicle" from the session, so most of these ignore everything but named payloads.
  const MUTATIONS = {
    createBooking: o => rpc('createBooking', o),
    acceptOffer: () => rpc('acceptOffer', {}),
    declineOffer: () => rpc('declineOffer', {}),
    arrived: () => rpc('arrived', {}),
    startTrip: () => rpc('startTrip', {}),
    completeTrip: () => rpc('completeTrip', {}),
    retryPayment: id => rpc('retryPayment', { id }),
    cancelBooking: id => rpc('cancelBooking', { id }),
    driverCancel: (d, reason) => rpc('driverCancel', { reason }),
    assign: (bid, did) => rpc('assign', { bookingId: bid, driverId: did }),
    dispatchNow: id => rpc('dispatchNow', { id }),
    sos: () => rpc('sos', {}),
    ackAlert: (id, resolve) => rpc('ackAlert', { id, resolve }),
    newCall: (phone, extra) => rpc('ivrDial', { phone, extra }),
    queueCall: (call, why) => rpc('ivrQueue', { callId: call && call.id, why }),
    endCall: id => rpc(RO.session && RO.session.role === 'ops' ? 'endCall' : 'ivrEndCall', { id }),
    answerCall: id => rpc('answerCall', { id }),
    voipStart: driverId => rpc('voipStart', { driverId }),
    voipStartRider: () => rpc('voipStartRider', {}),
    voipAnswer: () => rpc('voipAnswer', {}),
    voipEnd: () => rpc('voipEnd', {}),
    addJam: () => rpc('addJam', {}),
    reset: () => rpc('reset', {}),
    // new: not present in the old client-only engine — used by ops.js's Rules tab, which used to mutate
    // RO.state.settings directly (that would now just get overwritten by the next push).
    setOnline: online => rpc('setOnline', { online }),
    updateLocation: (lat, lng) => rpc('updateLocation', { lat, lng }),
    updateSettings: patch => rpc('updateSettings', { patch }),
    ivrRebook: o => rpc('ivrRebook', o),
    saveFavorites: favorites => rpc('saveFavorites', { favorites }),
    rateTrip: (id, rating) => rpc('rateTrip', { id, rating }),
    logEvent: text => rpc('logEvent', { text }).catch(() => {}) // decorative activity-log lines; never worth surfacing an error for
  };
  Object.assign(RO.E, MUTATIONS);

  RO.live = { connect, disconnect, sendRtc };
})(window.RO);
