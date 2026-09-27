// Sign-in. Two flows, matching the two kinds of account:
//   - CLIENT: phone number + a 6-digit code (a mock "text message" — see
//     the devCode note below; swap in a real SMS provider by having
//     sendCode() call it instead of just holding the code in memory).
//   - DRIVER / OPS / SUPERUSER: username + password (bcrypt), created by
//     the seed script or the admin panel.
// Either way, success creates a DB-backed Session (server/lib/session.js)
// and sets its id as an httpOnly cookie — nothing else about "being
// logged in" is trusted from anything the client sends.
'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { prisma } = require('../lib/db');
const { encryptField, hashLookup } = require('../lib/crypto');
const { COOKIE_NAME, createSession, destroySession } = require('../lib/session');
const rateLimit = require('../lib/loginRateLimit');
const { getWorld } = require('../world');
const { serializeCookie } = require('../lib/cookies');

const router = express.Router();

// In-memory, short-lived — a verification code is only ever useful for a
// couple of minutes and there is no reason to survive a restart.
const pendingCodes = new Map(); // phoneHash -> { code, expiresAt, tries }
const CODE_TTL_MS = 5 * 60 * 1000;
const MOCK_SMS = (process.env.NOTIFICATION_PROVIDER || 'mock') === 'mock';

function normPhone(s) { const d = String(s || '').replace(/\D/g, ''); return d ? '+' + d : ''; }

function setSessionCookie(req, res, sid, maxAge) {
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAME, sid, { maxAge, secure: req.secure }));
}

async function defaultCompany() {
  return prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
}

/** For a DRIVER account, which vehicle in their company's live fleet they control (e.g. "D07") — null if none bound yet. */
async function driverVehicleId(user) {
  if (user.role !== 'DRIVER' || !user.companyId) return null;
  const world = await getWorld(user.companyId);
  const d = world && world.driverForUser(user.id);
  return d ? d.id : null;
}

router.post('/request-code', async (req, res) => {
  const phone = normPhone(req.body && req.body.phone);
  if (phone.length < 9) return res.status(400).json({ error: 'Enter a valid phone number.' });
  const key = hashLookup(phone);
  if (rateLimit.isLockedOut('otp', key)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  pendingCodes.set(key, { code, expiresAt: Date.now() + CODE_TTL_MS, tries: 0 });

  // Mock SMS provider: logs it, and hands it back in the response for the
  // UI to display as if it had arrived — see NOTIFICATION_PROVIDER in
  // .env.example for wiring in a real one instead.
  console.log(`[sms mock] to ${phone}: your RideOps verification code is ${code}`);
  res.json({ ok: true, devCode: MOCK_SMS ? code : undefined });
});

router.post('/verify-code', async (req, res) => {
  const phone = normPhone(req.body && req.body.phone);
  const code = String(req.body && req.body.code || '').trim();
  const key = hashLookup(phone);
  const pending = pendingCodes.get(key);

  if (rateLimit.isLockedOut('otp', key)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  if (!pending || pending.expiresAt < Date.now()) return res.status(400).json({ error: 'Code expired — request a new one.' });
  pending.tries++;
  if (pending.tries > 6 || pending.code !== code) { rateLimit.recordFailure('otp', key); return res.status(400).json({ error: 'Wrong code, try again.' }); }
  pendingCodes.delete(key);
  rateLimit.recordSuccess('otp', key);

  let user = await prisma.user.findUnique({ where: { phoneHash: key } });
  if (!user) {
    const company = await defaultCompany();
    if (!company) return res.status(500).json({ error: 'No company is set up on this install yet.' });
    user = await prisma.user.create({ data: { role: 'CLIENT', companyId: company.id, name: 'Rider ' + phone.slice(-3), phone: encryptField(phone), phoneHash: key, favorites: '[]' } });
  }
  const world = user.companyId ? await getWorld(user.companyId) : null;
  if (world) world.ensureClient(phone, user.name);

  const { id, maxAge } = await createSession(user.id);
  setSessionCookie(req, res, id, maxAge);
  res.json({ ok: true, role: 'client', name: user.name, phone });
});

router.post('/login', async (req, res) => {
  const username = String(req.body && req.body.username || '').trim().toLowerCase();
  const password = String(req.body && req.body.password || '');
  if (rateLimit.isLockedOut('pw', username)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

  const user = username ? await prisma.user.findUnique({ where: { username } }) : null;
  const valid = user && user.passwordHash && await bcrypt.compare(password, user.passwordHash);
  if (!valid) { rateLimit.recordFailure('pw', username); return res.status(401).json({ error: 'Wrong username or password.' }); }
  rateLimit.recordSuccess('pw', username);

  const driverId = await driverVehicleId(user); // also makes sure the world is running before the client opens its socket

  const { id, maxAge } = await createSession(user.id);
  setSessionCookie(req, res, id, maxAge);
  res.json({ ok: true, role: user.role.toLowerCase(), name: user.name, driverId });
});

router.post('/logout', async (req, res) => {
  const cookies = require('../lib/cookies').parseCookies(req.headers.cookie);
  await destroySession(cookies[COOKIE_NAME]);
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAME, '', { maxAge: 0, secure: req.secure }));
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  // req.user is resolved by the session middleware in server/index.js,
  // which already decrypts phone once — never re-decrypt it here (it's
  // plaintext by the time it reaches any route).
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  const driverId = await driverVehicleId(req.user);
  res.json({ role: req.user.role.toLowerCase(), name: req.user.name, phone: req.user.phone || null, driverId });
});

module.exports = router;
