/* Top bar controls, device tabs, simulation loop. Loaded before the UI modules; RO.start() runs last. */
(function (RO) {
  'use strict';
  const U = RO.util, E = RO.E, bus = RO.bus;
  const HINTS = {
    customer: 'Rider view. Sign in with the demo number, tap the map or pick places, book — then watch the ops room and the driver app react.',
    ivr: 'Caller view. Dial as a repeat caller: press 1 for status, 2 to rebook the last trip, 3 for an operator (answer it in Ops › Calls).',
    driver: 'Driver view (D07 Ben). You get real 15 s job offers when dispatch picks you. Try SOS or Cancel to trigger ops exceptions.'
  };
  let dev = 'customer';
  function showDev(k) {
    dev = k;
    U.$$('.device').forEach(d => d.style.display = d.id === 'dev-' + k ? '' : 'none');
    U.$$('#dev-tabs button').forEach(b => b.classList.toggle('on', b.dataset.dev === k));
    U.$('#dev-hint').textContent = HINTS[k];
    bus.emit('devshow', k);
  }
  U.$('#dev-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showDev(b.dataset.dev); });
  U.$('#speed').addEventListener('change', e => { RO.state.speed = +e.target.value; });
  U.$('#pause').addEventListener('click', () => { E.setPaused(!RO.state.paused); U.$('#pause').textContent = RO.state.paused ? '▶ Resume' : '⏸ Pause'; });
  U.$('#demand').addEventListener('change', e => { RO.state.settings.demandOn = e.target.checked; RO.save(); });
  U.$('#reset').addEventListener('click', () => { if (confirm('Reset the simulation (drivers, bookings, calls)? Rider accounts are kept.')) { E.reset(); U.$('#speed').value = RO.state.speed; U.$('#pause').textContent = '⏸ Pause'; } });
  bus.on('tick', () => U.setText(U.$('#clock'), U.clock(RO.state.simSec)));

  RO.start = function () {
    U.$('#demand').checked = RO.state.settings.demandOn;
    showDev('customer');
    let last = performance.now();
    setInterval(() => { const t = performance.now(), dt = Math.min(1, (t - last) / 1000); last = t; E.tick(dt); }, 200);
    E.log('Ops room online. Dispatch engine running.');
  };
})(window.RO);
