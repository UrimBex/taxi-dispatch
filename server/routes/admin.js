// Platform administration — SUPERUSER only. Provisions taxi-company
// accounts (mirrors the bar-SaaS pattern of a superuser creating bar
// accounts): each one gets its own isolated simulated fleet, bookings,
// alerts and rider base (see server/world.js), and its own OPS login.
// A thin JSON API; public/admin.html is the small page that calls it.
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { prisma } = require('../lib/db');
const { getWorld } = require('../world');

const router = express.Router();

function requireSuperuser(req, res, next) {
  if (!req.user || req.user.role !== 'SUPERUSER') return res.status(403).json({ error: 'Superuser only.' });
  next();
}
router.use(requireSuperuser);

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'company';
}
async function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base, n = 1;
  while (await prisma.company.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
  return slug;
}

router.get('/companies', async (req, res) => {
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { users: true, drivers: true, trips: true } } }
  });
  res.json(companies);
});

router.post('/companies', async (req, res) => {
  const { name, opsUsername, opsPassword, opsName } = req.body || {};
  if (!name || !opsUsername || !opsPassword) return res.status(400).json({ error: 'name, opsUsername and opsPassword are required.' });
  if (String(opsPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (await prisma.user.findUnique({ where: { username: String(opsUsername).toLowerCase() } })) return res.status(409).json({ error: 'That username is already taken.' });

  const company = await prisma.company.create({ data: { name, slug: await uniqueSlug(name) } });
  const passwordHash = await bcrypt.hash(opsPassword, 12);
  const ops = await prisma.user.create({ data: { role: 'OPS', companyId: company.id, name: opsName || 'Ops', username: String(opsUsername).toLowerCase(), passwordHash } });
  await getWorld(company.id); // start its simulation now, rather than waiting for the first login
  res.status(201).json({ company, ops: { id: ops.id, username: ops.username } });
});

const VEHICLE_TYPES = ['standard', 'comfort', 'xl', 'access'];

async function requireCompany(req, res) {
  const company = await prisma.company.findUnique({ where: { id: req.params.id } });
  if (!company) res.status(404).json({ error: 'No such company.' });
  return company;
}

// Live roster: name/vehicle/model/online come from the running simulation (server/world.js), not just the
// database, so this always reflects the real current state — including seats still running under the built-in
// demo roster, which have no DriverSlot row at all until someone customises them.
router.get('/companies/:id/fleet', async (req, res) => {
  const company = await requireCompany(req, res); if (!company) return;
  const world = await getWorld(company.id);
  const rows = await prisma.driverSlot.findMany({ where: { companyId: company.id }, include: { user: true } });
  const byIdx = {}; rows.forEach(r => { byIdx[r.slot] = r; });
  res.json(world.state.drivers.map((d, i) => ({
    slot: i, name: d.name, vehicleType: d.vehicle, model: d.model, online: d.online,
    customised: !!(byIdx[i] && (byIdx[i].name || byIdx[i].userId)),
    username: byIdx[i] && byIdx[i].user ? byIdx[i].user.username : null
  })));
});

// Edits one seat's display name/vehicle/model without touching whatever login is bound to it.
router.put('/companies/:id/fleet/:slot', async (req, res) => {
  const company = await requireCompany(req, res); if (!company) return;
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= company.fleetSize) return res.status(400).json({ error: 'Invalid seat.' });
  const { name, vehicleType, model } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (vehicleType && !VEHICLE_TYPES.includes(vehicleType)) return res.status(400).json({ error: `vehicleType must be one of: ${VEHICLE_TYPES.join(', ')}.` });

  await prisma.driverSlot.upsert({
    where: { companyId_slot: { companyId: company.id, slot } },
    update: { name, vehicleType: vehicleType || null, model: model || null },
    create: { companyId: company.id, slot, name, vehicleType: vehicleType || null, model: model || null }
  });
  const world = await getWorld(company.id), seat = world.state.drivers[slot];
  if (seat) { seat.name = name; if (vehicleType) seat.vehicle = vehicleType; if (model) seat.model = model; seat.online = true; world.RO.bus.emit('change'); }
  res.json({ ok: true });
});

// Adds (or replaces) the login on exactly one seat, leaving every other seat untouched — for topping up the
// roster one driver at a time (a new hire, or finally giving an existing named-but-loginless seat a real login)
// without redoing the whole list via /fleet/bulk. name defaults to whatever the seat is already called.
router.put('/companies/:id/fleet/:slot/driver', async (req, res) => {
  const company = await requireCompany(req, res); if (!company) return;
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= company.fleetSize) return res.status(400).json({ error: 'Invalid seat.' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const world = await getWorld(company.id), seat = world.state.drivers[slot];
  const name = String((req.body && req.body.name) || (seat && seat.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required (this seat has no existing name to fall back on).' });

  const existing = await prisma.user.findUnique({ where: { username: String(username).toLowerCase() } });
  const row = await prisma.driverSlot.findUnique({ where: { companyId_slot: { companyId: company.id, slot } } });
  if (existing && !(row && existing.id === row.userId)) return res.status(409).json({ error: `Username "${username}" is already taken.` });
  if (row && row.userId && row.userId !== (existing && existing.id)) await prisma.user.delete({ where: { id: row.userId } }).catch(() => {});

  // Password is always (re)hashed and saved here, whether this is a brand-new login or "Change login" on an
  // existing one (e.g. a reset) — the form always collects a fresh password, on the same reasoning a real
  // password-change screen never shows or reuses the old one.
  const passwordHash = await bcrypt.hash(password, 12);
  let userId;
  if (existing) { await prisma.user.update({ where: { id: existing.id }, data: { name, passwordHash } }); userId = existing.id; }
  else { const user = await prisma.user.create({ data: { role: 'DRIVER', companyId: company.id, name, username: String(username).toLowerCase(), passwordHash } }); userId = user.id; }

  await prisma.driverSlot.upsert({
    where: { companyId_slot: { companyId: company.id, slot } },
    update: { name, userId },
    create: { companyId: company.id, slot, name, userId }
  });
  if (seat) { seat.name = name; seat.human = true; seat.userId = userId; seat.online = true; world.RO.bus.emit('change'); }
  res.status(201).json({ ok: true, slot, username: String(username).toLowerCase() });
});

// Removes whichever driver login is bound to a seat (if any) — the vehicle drops out of service rather than
// quietly continuing on autopilot, since clicking "remove" is a deliberate "this one's gone" action.
router.delete('/companies/:id/fleet/:slot/driver', async (req, res) => {
  const company = await requireCompany(req, res); if (!company) return;
  const slot = Number(req.params.slot);
  const row = await prisma.driverSlot.findUnique({ where: { companyId_slot: { companyId: company.id, slot } } });
  if (!row || !row.userId) return res.status(404).json({ error: 'That seat has no driver login.' });
  const userId = row.userId;
  await prisma.driverSlot.update({ where: { id: row.id }, data: { userId: null } });
  await prisma.user.delete({ where: { id: userId } }).catch(() => {}); // cascades: kills their session too, signing them out immediately

  const world = await getWorld(company.id), seat = world.state.drivers[slot];
  if (seat) {
    if (seat.bookingId || seat.offerBookingId) world.E.driverCancel(seat, 'Driver account removed');
    seat.human = false; seat.userId = null; seat.online = false;
    world.RO.bus.emit('change');
  }
  res.json({ ok: true });
});

// The wholesale swap: replaces seats 0..N-1 with the given list (each new driver overwrites — and deletes the
// login of — whatever was on that seat before) and takes every seat beyond the list out of service, so a
// company can go from "the built-in demo roster" (or an old list) straight to exactly the real drivers named
// here, with nothing left over. Pass just a name to leave a seat login-less (an autopilot car under a real
// vehicle name) — useful for setting up the fleet before every driver has a phone/login yet.
router.post('/companies/:id/fleet/bulk', async (req, res) => {
  const company = await requireCompany(req, res); if (!company) return;
  const list = Array.isArray(req.body && req.body.drivers) ? req.body.drivers : [];
  if (!list.length) return res.status(400).json({ error: 'Provide at least one driver.' });
  if (list.length > company.fleetSize) return res.status(400).json({ error: `This company's fleet only has ${company.fleetSize} seats.` });
  for (const d of list) {
    if (!d || !String(d.name || '').trim()) return res.status(400).json({ error: 'Every driver needs a name.' });
    if (d.vehicleType && !VEHICLE_TYPES.includes(d.vehicleType)) return res.status(400).json({ error: `Invalid vehicle type "${d.vehicleType}" (use one of: ${VEHICLE_TYPES.join(', ')}).` });
    if ((d.username && !d.password) || (d.password && !d.username)) return res.status(400).json({ error: `"${d.name}": a login needs both a username and a password.` });
    if (d.password && String(d.password).length < 8) return res.status(400).json({ error: `"${d.name}": password must be at least 8 characters.` });
  }
  // Every existing seat, not just the ones the new list covers — the cleanup pass below needs the rest too, to
  // find (and delete) logins sitting on seats that fall outside the new list.
  const existingRows = await prisma.driverSlot.findMany({ where: { companyId: company.id } });
  // A username must be free platform-wide — unless it's the very login already sitting on the seat we're about
  // to overwrite anyway (re-submitting the same list shouldn't collide with itself).
  const seatOwnsUsername = new Map(existingRows.filter(r => r.userId).map(r => [r.slot, r.userId]));
  for (let i = 0; i < list.length; i++) {
    const username = list[i].username && String(list[i].username).toLowerCase();
    if (!username) continue;
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing && existing.id !== seatOwnsUsername.get(i)) return res.status(409).json({ error: `Username "${username}" is already taken.` });
  }

  const world = await getWorld(company.id);
  const created = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i], name = String(d.name).trim();
    const prevRow = existingRows.find(r => r.slot === i);
    if (prevRow && prevRow.userId) await prisma.user.delete({ where: { id: prevRow.userId } }).catch(() => {});

    let userId = null;
    if (d.username && d.password) {
      const passwordHash = await bcrypt.hash(d.password, 12);
      const user = await prisma.user.create({ data: { role: 'DRIVER', companyId: company.id, name, username: String(d.username).toLowerCase(), passwordHash } });
      userId = user.id;
    }
    await prisma.driverSlot.upsert({
      where: { companyId_slot: { companyId: company.id, slot: i } },
      update: { name, vehicleType: d.vehicleType || null, model: d.model || null, userId },
      create: { companyId: company.id, slot: i, name, vehicleType: d.vehicleType || null, model: d.model || null, userId }
    });

    const seat = world.state.drivers[i];
    if (seat) {
      if (seat.bookingId || seat.offerBookingId) world.E.driverCancel(seat, 'Fleet roster replaced');
      seat.name = name; if (d.vehicleType) seat.vehicle = d.vehicleType; if (d.model) seat.model = d.model;
      seat.human = !!userId; seat.userId = userId; seat.online = true;
    }
    created.push({ slot: i, name, username: d.username || null });
  }
  // Seats past the end of the new list drop out of service — no leftover demo (or old-list) drivers roaming the map.
  for (let i = list.length; i < company.fleetSize; i++) {
    const prevRow = existingRows.find(r => r.slot === i);
    if (prevRow && prevRow.userId) { await prisma.user.delete({ where: { id: prevRow.userId } }).catch(() => {}); await prisma.driverSlot.update({ where: { id: prevRow.id }, data: { userId: null } }); }
    const seat = world.state.drivers[i];
    if (seat) { if (seat.bookingId || seat.offerBookingId) world.E.driverCancel(seat, 'Fleet roster replaced'); seat.online = false; }
  }
  world.RO.bus.emit('change');
  res.status(201).json({ ok: true, drivers: created });
});

module.exports = router;
