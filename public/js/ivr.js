/* IVR phone simulator: recognises repeat callers by number, DTMF menu, status, quick rebooking, hand-off to operator queue. */
(function (RO) {
  'use strict';
  const C = RO.City, U = RO.util, E = RO.E, bus = RO.bus;
  const root = U.$('#ivr'), st = () => RO.state, I = RO.i18n, tr = I.t;
  const iv = { callId: null, phone: '', step: 'idle', lines: [], tts: false, sel: '+38344111222', custom: '', seen: '', bookedSeen: null, t0: 0 };

  const say = (who, text) => {
    iv.lines.push({ who, text });
    if (who === 'ivr' && iv.tts && window.speechSynthesis) { try { const u = new SpeechSynthesisUtterance(text); u.lang = I.speechLang(); speechSynthesis.speak(u); } catch (e) { } }
    draw(true);
  };
  const cust = () => st().customers[iv.phone];
  const lastTrip = () => { const c = cust(); return c && c.trips[0]; };
  const call = () => st().calls.find(c => c.id === iv.callId);

  function menuText() {
    const c = cust(), lt = lastTrip();
    let m = c ? tr('iv.welcomeBack', { name: c.name.split(' ')[0] }) : tr('iv.welcome');
    m += tr('iv.p1');
    if (lt) m += tr('iv.p2', { from: I.place(lt.pickup.label), to: I.place(lt.dropoff.label) });
    m += tr('iv.p3');
    return m;
  }
  function statusText() {
    const b = st().bookings.filter(x => x.phone === iv.phone && !['completed', 'cancelled'].includes(x.status)).pop();
    if (!b) return tr('iv.noactive');
    const d = E.drv(b.driverId), eta = E.driverEta(b);
    const m = { scheduled: tr('iv.s.scheduled', { id: b.id, when: U.clock(b.scheduledSim) }), pending: tr('iv.s.pending', { id: b.id }), offered: tr('iv.s.offered', { id: b.id }),
      enroute: d ? tr('iv.s.enroute', { id: b.id, name: d.name, model: d.model, plate: d.plate, n: Math.max(1, Math.round(eta)) }) : '', arrived: tr('iv.s.arrived', { name: d ? d.name : '' }), ontrip: tr('iv.s.ontrip') };
    return m[b.status] || tr('iv.s.unavail');
  }
  async function dial(phone) {
    const c = await E.newCall(phone); Object.assign(iv, { callId: c.id, phone, step: 'menu', lines: [], t0: Date.now(), seen: 'ivr', bookedSeen: null });
    say('sys', tr('iv.dialling', { phone: U.fmtPhone(phone) })); setTimeout(() => { if (iv.step === 'menu') say('ivr', menuText()); }, 500);
  }
  async function hangup(msg) {
    RO.RTC.hangup();
    if (iv.callId) await E.endCall(iv.callId);
    iv.step = 'ended'; say('sys', msg || tr('iv.callended'));
  }
  async function press(k) {
    if (['idle', 'ended', 'queued', 'operator'].includes(iv.step)) return;
    say('you', tr('iv.pressed', { k }));
    if (k === '*') return hangup(tr('iv.hungup'));
    if (iv.step === 'confirm') {
      if (k === '1') {
        const lt = lastTrip(), b = await E.ivrRebook({ pickup: lt.pickup, dropoff: lt.dropoff, vehicle: lt.vehicle || 'standard', phone: iv.phone, name: cust().name, callId: iv.callId });
        iv.step = 'menu'; return say('ivr', tr('iv.rebooked', { id: b.id }));
      }
      iv.step = 'menu'; return say('ivr', menuText());
    }
    if (k === '1') say('ivr', statusText());
    else if (k === '2') {
      const lt = lastTrip();
      if (!lt) return say('ivr', tr('iv.rebookonly'));
      iv.step = 'confirm'; say('ivr', tr('iv.confirm', { from: I.place(lt.pickup.label), to: I.place(lt.dropoff.label) }));
    } else if (k === '3' || k === '0') {
      iv.step = 'queued'; await E.queueCall(call(), cust() ? 'caller requested operator' : 'unknown caller'); say('ivr', tr('iv.hold'));
      // Real audio (see rtc.js) — sent as soon as we're queued, not once an operator actually answers: the
      // offer just sits buffered on whichever ops browser receives it until someone clicks Answer, same as
      // every other call in this app (the offer always arrives before the answer click, not after).
      RO.RTC.startAsCaller(iv.callId, null, 'call');
    } else if (k === '9') say('ivr', menuText());
    else say('ivr', tr('iv.badopt') + menuText());
  }

  function ui() {
    const known = Object.values(st().customers).map(c => `<option value="${c.phone}">${U.esc(c.name)} — ${U.fmtPhone(c.phone)} ${U.esc(tr('iv.repeat'))}</option>`).join('');
    root.innerHTML = `<div class="ivr-wrap" id="ivr-wrap"><div class="ivr-idle" id="ivr-idle"><div class="logo">☎️</div><h2>${tr('iv.callTitle')}</h2><p>${tr('iv.callDesc')}</p>
      <label>${tr('iv.callingfrom')}<select id="iv-sel">${known}<option value="+38349555010">${U.esc(tr('iv.unknown'))}</option><option value="custom">${tr('iv.custom')}</option></select></label>
      <input id="iv-custom" type="tel" placeholder="+383 4x xxx xxx" style="display:none">
      <label class="chk"><input type="checkbox" id="iv-tts"> ${tr('iv.tts')}</label><button class="btn primary" data-act="dial">${tr('iv.callbtn')}</button></div>
      <div class="ivr-call" id="ivr-call" style="display:none"><div class="ivr-head"><div><b id="iv-title"></b><small id="iv-sub"></small></div><button class="btn sm danger" data-act="hang">${tr('iv.hang')}</button></div>
      <div class="ivr-log" id="ivr-log"></div><div class="keypad" id="ivr-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(k => `<button data-key="${k}">${k}</button>`).join('')}</div></div></div>`;
    iv.shown = 'idle'; U.$('#iv-sel', root).value = iv.sel;
    U.$('#iv-tts', root).checked = iv.tts; U.$('#iv-custom', root).value = iv.custom; U.$('#iv-custom', root).style.display = iv.sel === 'custom' ? '' : 'none';
  }
  let rtcNote = '';
  bus.on('rtc-error', msg => { rtcNote = ` · ⚠️ ${msg}`; draw(); });
  bus.on('rtc-state', s => { rtcNote = s === 'connected' ? tr('rtc.live') : s === 'connecting' ? tr('rtc.connecting') : ''; draw(); });
  function draw(force) {
    if (!root.offsetParent) return;
    const inCall = iv.step !== 'idle';
    U.$('#ivr-idle', root).style.display = inCall ? 'none' : ''; U.$('#ivr-call', root).style.display = inCall ? '' : 'none';
    if (!inCall) return;
    const sub = { menu: tr('iv.sub.auto'), confirm: tr('iv.sub.auto'), queued: tr('iv.sub.hold'), operator: tr('iv.sub.op') + rtcNote, ended: tr('iv.sub.ended') }[iv.step];
    U.setText(U.$('#iv-title', root), `${U.fmtPhone(iv.phone)} · ${U.mmss((Date.now() - iv.t0) / 1000)}`); U.setText(U.$('#iv-sub', root), sub);
    U.setHTML(U.$('#ivr-log', root), iv.lines.map(l => `<div class="ln ${l.who}">${U.esc(l.text)}</div>`).join(''));
    const lg = U.$('#ivr-log', root); if (force) lg.scrollTop = lg.scrollHeight;
    U.$$('#ivr-keys button', root).forEach(b => b.disabled = ['queued', 'operator', 'ended'].includes(iv.step));
    const hb = U.$('[data-act="hang"]', root); hb.textContent = iv.step === 'ended' ? tr('iv.newcall') : tr('iv.hang'); hb.className = 'btn sm ' + (iv.step === 'ended' ? 'primary' : 'danger');
  }
  root.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.key) return press(t.dataset.key);
    if (t.dataset.act === 'dial') { const p = iv.sel === 'custom' ? U.normPhone(U.$('#iv-custom', root).value) : iv.sel; if (p.length >= 9) { iv.tts = U.$('#iv-tts', root).checked; dial(p); } }
    else if (t.dataset.act === 'hang') { if (iv.step === 'ended') { iv.step = 'idle'; ui(); draw(); } else hangup(tr('iv.hungup')); }
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'iv-sel') { iv.sel = e.target.value; U.$('#iv-custom', root).style.display = iv.sel === 'custom' ? '' : 'none'; }
    else if (e.target.id === 'iv-tts') iv.tts = e.target.checked;
  });
  root.addEventListener('input', e => { if (e.target.id === 'iv-custom') iv.custom = e.target.value; });
  /* Follow the operator side of the call. */
  function sync() {
    if (iv.step !== 'queued' && iv.step !== 'operator') { draw(); return; }
    const c = call(); if (!c) return;
    if (iv.step === 'queued' && c.state === 'active') { iv.step = 'operator'; say('sys', tr('iv.opconn', { op: c.operator })); }
    if (iv.step !== 'idle' && c.bookingId && iv.bookedSeen !== c.bookingId) { iv.bookedSeen = c.bookingId; say('sys', tr('iv.opbooked', { op: c.operator, id: c.bookingId })); }
    if (c.state === 'ended' && iv.step !== 'ended') { RO.RTC.hangup(); iv.step = 'ended'; say('sys', c.abandoned ? tr('iv.dropped') : tr('iv.opended')); }
    draw();
  }
  let lt = 0; bus.on('tick', () => { const t = performance.now(); if (t - lt > 500) { lt = t; sync(); } });
  bus.on('sms', m => {
    if (m.to !== iv.phone || iv.step === 'idle') return;
    const n = document.createElement('div'); n.className = 'sms-toast'; n.innerHTML = `<b>${U.esc(tr('iv.smsto', { phone: U.fmtPhone(m.to) }))}</b><span>${U.esc(I.tx(m.text))}</span>`;
    U.$('#dev-ivr').appendChild(n); setTimeout(() => n.remove(), 7000);
  });
  bus.on('devshow', () => { ui(); draw(true); });
  I.onChange(() => { ui(); draw(true); });
  ui();
})(window.RO);
