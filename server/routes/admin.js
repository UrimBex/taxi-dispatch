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

router.get('/companies/:id/drivers', async (req, res) => {
  const slots = await prisma.driverSlot.findMany({ where: { companyId: req.params.id }, include: { user: true } });
  res.json(slots);
});

router.post('/companies/:id/drivers', async (req, res) => {
  const companyId = req.params.id;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return res.status(404).json({ error: 'No such company.' });
  const { username, password, name } = req.body || {};
  if (!username || !password || !name) return res.status(400).json({ error: 'username, password and name are required.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (await prisma.user.findUnique({ where: { username: String(username).toLowerCase() } })) return res.status(409).json({ error: 'That username is already taken.' });

  const taken = new Set((await prisma.driverSlot.findMany({ where: { companyId } })).map(s => s.slot));
  let slot = 0;
  while (taken.has(slot) && slot < company.fleetSize) slot++;
  if (slot >= company.fleetSize) return res.status(409).json({ error: `All ${company.fleetSize} fleet seats for this company already have a driver login.` });

  const passwordHash = await bcrypt.hash(password, 12);
  const driver = await prisma.user.create({ data: { role: 'DRIVER', companyId, name, username: String(username).toLowerCase(), passwordHash } });
  await prisma.driverSlot.create({ data: { companyId, slot, userId: driver.id } });

  const world = await getWorld(companyId);
  const seat = world.state.drivers[slot];
  if (seat) { seat.human = true; seat.userId = driver.id; world.RO.bus.emit('change'); }

  res.status(201).json({ id: driver.id, username: driver.username, slot, vehicle: seat && { id: seat.id, model: seat.model, plate: seat.plate } });
});

module.exports = router;
