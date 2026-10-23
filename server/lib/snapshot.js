// What each role is allowed to SEE of a company's live state. The world pushes one full state object per tick;
// before this existed every socket got all of it — so any rider's browser received every other rider's name,
// phone number, bookings and trip history, and every driver's earnings. Ops legitimately needs the lot; riders
// and drivers only need their own slice (plus enough of the fleet to draw the map and quote ETAs).
// The result keeps the exact shape of the real state (same keys, arrays/objects just emptier), because the
// browser mirrors it wholesale into RO.state and runs the read-only half of engine.js against it.
'use strict';

// Fleet entries other people can see: positions/status/vehicle (needed for the map and "N min away"), but not
// what a driver earns or which internal login they are.
const pubDriver = d => { const { earnings, userId, ...rest } = d; return rest; };

const EMPTY_STATS = () => ({ done: 0, revenue: 0, waitSum: 0, waitN: 0 });
const OPEN = ['enroute', 'arrived', 'ontrip'];

function base(state, drivers) {
  return { simSec: state.simSec, seq: state.seq, settings: state.settings, stats: EMPTY_STATS(), drivers, bookings: [], calls: [], alerts: [], log: [], sms: [], voip: null, customers: {} };
}

function forClient(state, phone) {
  const mine = state.bookings.filter(b => b.phone === phone);
  const active = mine.find(b => OPEN.includes(b.status));
  const snap = base(state, state.drivers.map(pubDriver));
  // The internal timeline carries operator-only notes ("manually assigned by Dana"…) — not for the rider.
  snap.bookings = mine.map(({ timeline, ...b }) => b);
  snap.calls = state.calls.filter(c => c.phone === phone);
  snap.customers = state.customers[phone] ? { [phone]: state.customers[phone] } : {};
  const v = state.voip;
  snap.voip = v && v.peer === 'client' && active && v.driverId === active.driverId ? v : null;
  return snap;
}

function forDriver(state, driver) {
  const snap = base(state, state.drivers.map(d => driver && d.id === driver.id ? d : pubDriver(d)));
  if (!driver) return snap;
  // Their current job and any offer on the table — with the rider's phone number and the internal timeline removed
  // (calls to the rider go through the app, not by number).
  snap.bookings = state.bookings
    .filter(b => b.id === driver.bookingId || b.id === driver.offerBookingId || b.driverId === driver.id || (b.offer && b.offer.driverId === driver.id))
    .map(({ phone, timeline, ...b }) => b);
  snap.voip = state.voip && state.voip.driverId === driver.id ? state.voip : null;
  return snap;
}

/** `ctx` is the per-socket context from ws.js: { phone } for a rider, { driver } for a driver. */
function snapshotFor(role, state, ctx) {
  if (role === 'OPS') return state;
  if (role === 'CLIENT') return forClient(state, ctx.phone);
  if (role === 'DRIVER') return forDriver(state, ctx.driver);
  return base(state, []);
}

module.exports = { snapshotFor };
