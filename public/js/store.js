/* Shared state, event bus, utilities, seed data, persistence. */
(function (RO) {
  'use strict';
  const C = RO.City;

  RO.bus = {
    h: {},
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); },
    emit(e, d) { (this.h[e] || []).forEach(f => { try { f(d); } catch (err) { console.error(e, err); } }); }
  };

  const U = RO.util = {
    $: (s, r = document) => r.querySelector(s),
    $$: (s, r = document) => Array.from(r.querySelectorAll(s)),
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    rnd: (a, b) => a + Math.random() * (b - a),
    ri: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: a => a[Math.floor(Math.random() * a.length)],
    pad: n => String(n).padStart(2, '0'),
    clock: s => { s = Math.floor(s) % 86400; return U.pad(Math.floor(s / 3600)) + ':' + U.pad(Math.floor(s / 60) % 60); },
    mmss: s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + U.pad(s % 60); },
    money: n => '€' + Number(n).toFixed(2),
    uid: p => p + Math.random().toString(36).slice(2, 7),
    normPhone: s => { const d = String(s || '').replace(/\D/g, ''); return d ? '+' + d : ''; },
    fmtPhone: p => /^\+383\d{8}$/.test(p) ? p.replace(/^(\+383)(\d{2})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : p,
    initials: n => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(),
    km: k => k >= 1 ? k.toFixed(1) + ' km' : Math.max(50, Math.round(k * 1000 / 50) * 50) + ' m',
    setHTML(node, html) { if (node && node._h !== html) { node.innerHTML = html; node._h = html; } },
    setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
  };

  RO.VEH = {
    standard: { label: 'Standard', icon: '🚕', seats: 4, base: 2.5, perKm: .9, perMin: .15 },
    comfort: { label: 'Comfort', icon: '🚙', seats: 4, base: 3.5, perKm: 1.25, perMin: .2 },
    xl: { label: 'XL (6 seats)', icon: '🚐', seats: 6, base: 4.5, perKm: 1.5, perMin: .25 },
    access: { label: 'Wheelchair', icon: '♿', seats: 3, base: 2.5, perKm: .9, perMin: .15 }
  };
  RO.PAY = { card: '💳 Card •• 4242', wallet: '👛 Wallet', corp: '🏢 Corporate account', cash: '💵 Cash' };
  RO.TAGS = { wheelchair: '♿ Wheelchair', childseat: '👶 Child seat', pets: '🐾 Pets', luggage: '🧳 Extra luggage' };

  const ROSTER = [
    ['Lira Hoxha', 'standard', 'Toyota Prius'], ['Dritan Berisha', 'standard', 'Skoda Octavia'], ['Mira Gashi', 'comfort', 'Mercedes E-Class'],
    ['Arben Kelmendi', 'standard', 'VW Passat'], ['Vesa Shala', 'xl', 'Mercedes Vito'], ['Kushtrim Morina', 'standard', 'Toyota Corolla'],
    ['Ben Krasniqi', 'standard', 'Toyota Prius'], ['Elira Rama', 'comfort', 'BMW 5 Series'], ['Faton Bytyqi', 'access', 'VW Caddy Maxi'],
    ['Blerta Ahmeti', 'standard', 'Hyundai Ioniq'], ['Liridon Rexhepi', 'standard', 'Skoda Superb'], ['Naim Zeqiri', 'access', 'Ford Tourneo'],
    ['Teuta Sadiku', 'comfort', 'Audi A6'], ['Agron Deda', 'xl', 'Ford Tourneo Custom']
  ];
  RO.HUMAN_DRIVER = 'D07';
  RO.SIM_NAMES = ['Ardit', 'Sara', 'Diar', 'Nora', 'Leart', 'Ema', 'Gent', 'Rina', 'Flamur', 'Zana', 'Besnik', 'Lulja'];

  const DEFAULT_SETTINGS = { offerSec: 15, unassignedSec: 90, wETA: 1, wTraffic: .6, wRating: .8, maxEtaMin: 25, botCancelPct: 4, autoDispatch: true, favorHuman: true, leadMin: 10, demandOn: true, demandEvery: 28 };

  function seedCustomers() {
    const mk = (a, b, fare) => ({ id: 'T' + Math.random().toString(36).slice(2, 6), at: 0, pickup: { ...a, label: C.label(a) }, dropoff: { ...b, label: C.label(b) }, fare, vehicle: 'standard' });
    const home = { x: 300, y: 700 }, work = { x: 900, y: 200 };
    return {
      '+38344111222': {
        phone: '+38344111222', name: 'Arta Gashi',
        favorites: [{ name: 'Home', ...home }, { name: 'Work', ...work }],
        trips: [mk(home, work, 9.8), mk(work, home, 10.2), mk(home, { x: 600, y: 400 }, 6.4)]
      }
    };
  }
  function load(k, def) { try { const v = JSON.parse(localStorage.getItem(k)); return v || def; } catch (e) { return def; } }
  const CK = 'ro.customers.v2', SK = 'ro.settings'; // v2: rider places were re-based onto the real Prishtina map
  RO.save = () => { try { localStorage.setItem(CK, JSON.stringify(RO.state.customers)); localStorage.setItem(SK, JSON.stringify(RO.state.settings)); } catch (e) { } };

  RO.newState = function () {
    const keep = RO.state;
    const s = {
      simSec: 8 * 3600 + 15 * 60, speed: 12, paused: false, seq: 1001,
      drivers: [], bookings: [], calls: [], alerts: [], log: [], sms: [], voip: null,
      customers: keep ? keep.customers : load(CK, seedCustomers()),
      settings: keep ? keep.settings : Object.assign({}, DEFAULT_SETTINGS, load(SK, {})),
      demandNext: Date.now() + 8000, callNext: Date.now() + 25000, stats: { done: 0, revenue: 0, waitSum: 0, waitN: 0 }
    };
    ROSTER.forEach(([name, vehicle, model], i) => {
      const id = 'D' + U.pad(i + 1), pos = id === RO.HUMAN_DRIVER ? { x: 500, y: 400 } : C.randomNode();
      s.drivers.push({
        id, name, vehicle, model, plate: `0${U.ri(1, 9)}-${U.ri(100, 999)}-${String.fromCharCode(65 + U.ri(0, 25), 65 + U.ri(0, 25))}`,
        rating: +(4.3 + Math.random() * .69).toFixed(2), pos, path: [], heading: 0, status: 'available', online: i < 12,
        human: id === RO.HUMAN_DRIVER, bookingId: null, offerBookingId: null, atTarget: false, botAt: 0, willCancelAt: 0,
        earnings: 0, trips: U.ri(0, 4), speedMul: U.rnd(.9, 1.1)
      });
    });
    C.updateTraffic(s.simSec, 100);
    return s;
  };
  RO.state = RO.newState();
})(window.RO);
