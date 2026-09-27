/* IVR phone simulator: recognises repeat callers by number, DTMF menu, status, quick rebooking, hand-off to operator queue. */
(function (RO) {
  'use strict';
  const C = RO.City, U = RO.util, E = RO.E, bus = RO.bus;
  const root = U.$('#ivr'), st = () => RO.state;
  const iv = { callId: null, phone: '', step: 'idle', lines: [], tts: false, sel: '+38344111222', custom: '', seen: '', bookedSeen: null, t0: 0 };

  const say = (who, text) => {
    iv.lines.push({ who, text });
    if (who === 'ivr' && iv.tts && window.speechSynthesis) { try { speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) { } }
    draw(true);
  };
  const cust = () => st().customers[iv.phone];
  const lastTrip = () => { const c = cust(); return c && c.trips[0]; };
  const call = () => st().calls.find(c => c.id === iv.callId);

  function menuText() {
    const c = cust(), lt = lastTrip();
    let t = c ? `Welcome back, ${c.name.split(' ')[0]}. ` : 'Welcome to RideOps. We do not recognise this number. ';
    t += 'Press 1 for the status of your current booking. ';
    if (lt) t += `Press 2 to rebook your last trip from ${lt.pickup.label} to ${lt.dropoff.label}. `;
    t += 'Press 3 or 0 to speak to an operator. Press 9 to hear this menu again.';
    return t;
  }
  function statusText() {
    const b = st().bookings.filter(x => x.phone === iv.phone && !['completed', 'cancelled'].includes(x.status)).pop();
    if (!b) return 'You have no active booking.';
    const d = E.drv(b.driverId), eta = E.driverEta(b);
    const m = { scheduled: `Booking ${b.id} is scheduled for ${U.clock(b.scheduledSim)}.`, pending: `Booking ${b.id} is confirmed and we are finding your driver.`, offered: `Booking ${b.id}: we are contacting a nearby driver.`,
      enroute: d ? `Booking ${b.id}: ${d.name} in a ${d.model}, plate ${d.plate}, is on the way and arrives in about ${Math.max(1, Math.round(eta))} minutes.` : '', arrived: `Your driver ${d ? d.name : ''} has arrived at the pickup point.`, ontrip: 'You are currently on a trip.' };
    return m[b.status] || 'Status unavailable.';
  }
  async function dial(phone) {
    const c = await E.newCall(phone); Object.assign(iv, { callId: c.id, phone, step: 'menu', lines: [], t0: Date.now(), seen: 'ivr', bookedSeen: null });
    say('sys', `Dialling 0800-RIDEOPS from ${U.fmtPhone(phone)}…`); setTimeout(() => { if (iv.step === 'menu') say('ivr', menuText()); }, 500);
  }
  async function hangup(msg) {
    if (iv.callId) await E.endCall(iv.callId);
    iv.step = 'ended'; say('sys', msg || 'Call ended.');
  }
  async function press(k) {
    if (['idle', 'ended', 'queued', 'operator'].includes(iv.step)) return;
    say('you', 'Pressed ' + k);
    if (k === '*') return hangup('You hung up.');
    if (iv.step === 'confirm') {
      if (k === '1') {
        const lt = lastTrip(), b = await E.ivrRebook({ pickup: lt.pickup, dropoff: lt.dropoff, vehicle: lt.vehicle || 'standard', phone: iv.phone, name: cust().name, callId: iv.callId });
        iv.step = 'menu'; return say('ivr', `Done. Booking ${b.id} is confirmed and we are finding your driver. You will receive a text message. Press 1 to check the status, or star to hang up.`);
      }
      iv.step = 'menu'; return say('ivr', menuText());
    }
    if (k === '1') say('ivr', statusText());
    else if (k === '2') {
      const lt = lastTrip();
      if (!lt) return say('ivr', 'Quick rebooking is only available to registered riders with a previous trip. Press 3 to speak to an operator.');
      iv.step = 'confirm'; say('ivr', `Book a taxi from ${lt.pickup.label} to ${lt.dropoff.label}? Press 1 to confirm, or 2 to go back.`);
    } else if (k === '3' || k === '0') {
      iv.step = 'queued'; await E.queueCall(call(), cust() ? 'caller requested operator' : 'unknown caller'); say('ivr', 'Please hold while we connect you to the next available operator.');
    } else if (k === '9') say('ivr', menuText());
    else say('ivr', 'Sorry, that option is not available. ' + menuText());
  }

  function ui() {
    const known = Object.values(st().customers).map(c => `<option value="${c.phone}">${U.esc(c.name)} — ${U.fmtPhone(c.phone)} (repeat caller)</option>`).join('');
    root.innerHTML = `<div class="ivr-wrap" id="ivr-wrap"><div class="ivr-idle" id="ivr-idle"><div class="logo">☎️</div><h2>Call 0800-RIDEOPS</h2><p>Simulate a customer ringing the taxi line. The IVR recognises repeat callers by number and hands complex calls to the operators.</p>
      <label>Calling from<select id="iv-sel">${known}<option value="+38349555010">Unknown caller — +383 49 555 010</option><option value="custom">Custom number…</option></select></label>
      <input id="iv-custom" type="tel" placeholder="+383 4x xxx xxx" style="display:none">
      <label class="chk"><input type="checkbox" id="iv-tts"> Read IVR prompts aloud</label><button class="btn primary" data-act="dial">📞 Call</button></div>
      <div class="ivr-call" id="ivr-call" style="display:none"><div class="ivr-head"><div><b id="iv-title"></b><small id="iv-sub"></small></div><button class="btn sm danger" data-act="hang">Hang up</button></div>
      <div class="ivr-log" id="ivr-log"></div><div class="keypad" id="ivr-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(k => `<button data-key="${k}">${k}</button>`).join('')}</div></div></div>`;
    iv.shown = 'idle'; U.$('#iv-sel', root).value = iv.sel;
  }
  function draw(force) {
    if (!root.offsetParent) return;
    const inCall = iv.step !== 'idle';
    U.$('#ivr-idle', root).style.display = inCall ? 'none' : ''; U.$('#ivr-call', root).style.display = inCall ? '' : 'none';
    if (!inCall) return;
    const sub = { menu: 'Automated menu', confirm: 'Automated menu', queued: '⏳ On hold — waiting for an operator', operator: '🎧 Speaking with operator', ended: 'Call ended' }[iv.step];
    U.setText(U.$('#iv-title', root), `${U.fmtPhone(iv.phone)} · ${U.mmss((Date.now() - iv.t0) / 1000)}`); U.setText(U.$('#iv-sub', root), sub);
    U.setHTML(U.$('#ivr-log', root), iv.lines.map(l => `<div class="ln ${l.who}">${U.esc(l.text)}</div>`).join(''));
    const lg = U.$('#ivr-log', root); if (force) lg.scrollTop = lg.scrollHeight;
    U.$$('#ivr-keys button', root).forEach(b => b.disabled = ['queued', 'operator', 'ended'].includes(iv.step));
    const hb = U.$('[data-act="hang"]', root); hb.textContent = iv.step === 'ended' ? 'New call' : 'Hang up'; hb.className = 'btn sm ' + (iv.step === 'ended' ? 'primary' : 'danger');
  }
  root.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.key) return press(t.dataset.key);
    if (t.dataset.act === 'dial') { const p = iv.sel === 'custom' ? U.normPhone(U.$('#iv-custom', root).value) : iv.sel; if (p.length >= 9) { iv.tts = U.$('#iv-tts', root).checked; dial(p); } }
    else if (t.dataset.act === 'hang') { if (iv.step === 'ended') { iv.step = 'idle'; ui(); draw(); } else hangup('You hung up.'); }
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'iv-sel') { iv.sel = e.target.value; U.$('#iv-custom', root).style.display = iv.sel === 'custom' ? '' : 'none'; }
  });
  /* Follow the operator side of the call. */
  function sync() {
    if (iv.step !== 'queued' && iv.step !== 'operator') { draw(); return; }
    const c = call(); if (!c) return;
    if (iv.step === 'queued' && c.state === 'active') { iv.step = 'operator'; say('sys', `🎧 Connected to operator ${c.operator}.`); }
    if (iv.step !== 'idle' && c.bookingId && iv.bookedSeen !== c.bookingId) { iv.bookedSeen = c.bookingId; say('sys', `🎧 ${c.operator}: "Your taxi ${c.bookingId} is booked. You'll get an SMS shortly."`); }
    if (c.state === 'ended' && iv.step !== 'ended') { iv.step = 'ended'; say('sys', c.abandoned ? 'Call dropped.' : 'The operator ended the call. Thank you for calling RideOps.'); }
    draw();
  }
  let lt = 0; bus.on('tick', () => { const t = performance.now(); if (t - lt > 500) { lt = t; sync(); } });
  bus.on('sms', m => {
    if (m.to !== iv.phone || iv.step === 'idle') return;
    const n = document.createElement('div'); n.className = 'sms-toast'; n.innerHTML = `<b>💬 SMS to ${U.esc(U.fmtPhone(m.to))}</b><span>${U.esc(m.text)}</span>`;
    U.$('#dev-ivr').appendChild(n); setTimeout(() => n.remove(), 7000);
  });
  bus.on('devshow', () => { ui(); draw(true); });
  ui();
})(window.RO);
