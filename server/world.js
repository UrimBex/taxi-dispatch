// Loads the existing simulation core (public/js/{roads,city,store,engine}.js)
// UNCHANGED into an isolated sandbox per company, and runs it here on the
// server instead of in the browser. Those four files were already written
// as plain functions closing over an `RO` object passed in by their caller
// (`(function (RO) {...})(window.RO)`) with zero DOM or browser-API
// dependencies — built that way originally so the road-data build tool
// could reuse city.js under Node — which turns out to be exactly what's
// needed to host the whole engine here: give each company its own empty
// `RO` object in place of `window`, and it runs standalone, unmodified.
//
// One World per Company, kept in memory and ticked on an interval — this
// is what makes the dispatch, drivers, bookings, calls and alerts a single
// shared, live system that every connected client (rider, driver, ops)
// sees the same copy of, instead of each browser simulating its own.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { prisma } = require('./lib/db');
const { decryptField, encryptField } = require('./lib/crypto');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');
const SOURCE_FILES = ['roads.js', 'city.js', 'store.js', 'engine.js'];
const sources = SOURCE_FILES.map(f => ({ name: f, code: fs.readFileSync(path.join(PUBLIC_JS, f), 'utf8') }));

/** Evaluates the four core files against a fresh sandbox `window`, returning its `RO`. */
function loadSandboxRO() {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const { name, code } of sources) {
    try { vm.runInContext(code, sandbox, { filename: name }); }
    catch (err) { throw new Error(`Failed loading ${name} into the server-side simulation sandbox: ${err.message}`); }
  }
  return sandbox.RO;
}

const worlds = new Map(); // companyId -> World

class World {
  constructor(companyId, company) {
    this.companyId = companyId;
    this.company = company;
    this.listeners = new Set(); // broadcast callbacks, wired up by ws.js
    this.smsListeners = new Set();
    this.msgListeners = new Set();
    this.completedListeners = new Set();
    this._flushScheduled = false;

    this.RO = loadSandboxRO();
    // No human-controlled driver until a DriverSlot binds one (see
    // bindDriverSlots) — every seat starts on autopilot, same as an
    // ordinary reset.
    this.RO.HUMAN_DRIVER = '';
    this.RO.state = this.RO.newState();
    this.state = this.RO.state;
    this.E = this.RO.E;

    this.RO.bus.on('tick', () => this._scheduleBroadcast());
    this.RO.bus.on('change', () => this._scheduleBroadcast());
    this.RO.bus.on('alert', () => this._scheduleBroadcast());
    this.RO.bus.on('voip', () => this._scheduleBroadcast());
    this.RO.bus.on('reset', () => {
      this.state = this.RO.state; this.E = this.RO.E;
      this.loadAccounts().catch(err => console.error('[world] re-applying fleet/accounts after reset failed:', err));
    });
    this.RO.bus.on('sms', m => this.smsListeners.forEach(fn => fn(m)));
    this.RO.bus.on('driver-msg', text => this.msgListeners.forEach(fn => fn(text)));
    this.RO.bus.on('completed', ({ driverId, bid }) => {
      this._archiveTrip(bid).catch(err => console.error('[world] archive trip failed:', err));
      this.completedListeners.forEach(fn => fn({ driverId, bid }));
    });

    let last = Date.now();
    this._interval = setInterval(() => {
      const t = Date.now(), dt = Math.min(1, (t - last) / 1000);
      last = t;
      this.E.tick(dt);
    }, 200);
  }

  _scheduleBroadcast() {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    setImmediate(() => { this._flushScheduled = false; this.listeners.forEach(fn => fn(this.state)); });
  }

  async _archiveTrip(bid) {
    const b = this.E.bk(bid);
    if (!b) return;
    // customerId is left unset here (a phoneHash lookup would find it, but
    // archival only needs the phone/name shown on the record, not the
    // live link) — customerPhone is what invoice/history screens read.
    await prisma.trip.create({
      data: {
        companyId: this.companyId, bookingRef: b.id,
        customerPhone: b.phone ? encryptField(b.phone) : null, customerName: b.name || null,
        driverName: (this.state.drivers.find(d => d.id === b.driverId) || {}).name || null,
        pickup: b.pickup.label, dropoff: b.dropoff.label, vehicle: b.vehicle, payment: b.payment, source: b.source,
        fare: b.fare, distanceKm: b.tripKm || null, status: 'completed', completedAt: new Date()
      }
    }).catch(err => console.error('[world] Trip.create failed:', err));
  }

  /** Applies each company's customised fleet roster (name/vehicle/model + bound driver login) and loads its
      registered CLIENTs + trip history into the live state. Re-run after a reset too, not just at creation —
      RO.newState() rebuilds the roster from the built-in demo defaults, so any customisation has to be re-applied. */
  async loadAccounts() {
    const [slots, clients] = await Promise.all([
      prisma.driverSlot.findMany({ where: { companyId: this.companyId }, include: { user: true } }), // every customised seat, not just ones with a login
      prisma.user.findMany({ where: { companyId: this.companyId, role: 'CLIENT' } })
    ]);
    for (const slot of slots) {
      const d = this.state.drivers[slot.slot];
      if (!d) continue;
      if (slot.name) d.name = slot.name;
      if (slot.vehicleType) d.vehicle = slot.vehicleType;
      if (slot.model) d.model = slot.model;
      if (slot.userId) { d.human = true; d.userId = slot.userId; }
    }
    // Once a company has customised ANY seat, the ones it never got to sit out of service instead of showing
    // phantom demo drivers roaming the map — a company that hasn't touched its roster yet still runs the full
    // built-in demo fleet (so a fresh install has something to look at before anyone's set up real drivers).
    const usedSlots = new Set(slots.filter(s => s.name || s.userId).map(s => s.slot));
    if (usedSlots.size > 0) this.state.drivers.forEach((d, i) => { if (!usedSlots.has(i)) d.online = false; });
    for (const u of clients) {
      if (!u.phone) continue;
      const phone = decryptField(u.phone);
      const trips = await prisma.trip.findMany({ where: { companyId: this.companyId, customerId: u.id }, orderBy: { completedAt: 'desc' }, take: 20 }).catch(() => []);
      this.state.customers[phone] = {
        phone, name: u.name, favorites: JSON.parse(u.favorites || '[]'),
        trips: trips.map(t => ({ id: t.bookingRef, at: 0, pickup: { label: t.pickup }, dropoff: { label: t.dropoff }, fare: t.fare, vehicle: t.vehicle }))
      };
    }
  }

  /** Called right after a brand-new rider verifies their code, so a booking placed the same session works without a full reload. */
  ensureClient(phone, name) {
    if (!this.state.customers[phone]) this.state.customers[phone] = { phone, name, favorites: [], trips: [] };
    return this.state.customers[phone];
  }

  driverForUser(userId) { return this.state.drivers.find(d => d.userId === userId) || null; }

  destroy() { clearInterval(this._interval); }
}

async function getWorld(companyId) {
  let world = worlds.get(companyId);
  if (world) return world;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return null;
  world = new World(companyId, company);
  worlds.set(companyId, world);
  await world.loadAccounts();
  return world;
}

module.exports = { getWorld, worlds };
