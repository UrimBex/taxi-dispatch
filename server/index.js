// RideOps app server. Serves the frontend (public/), the REST auth/admin
// API, and the WebSocket that carries the live dispatch simulation.
// Binds to 127.0.0.1 only by design — see scripts/https-proxy.js and the
// README for why: this process is never reachable directly from the LAN,
// only through the HTTPS proxy in front of it.
'use strict';
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const { prisma } = require('./lib/db');
const { decryptField } = require('./lib/crypto');
const { COOKIE_NAME, loadSession } = require('./lib/session');
const { parseCookies } = require('./lib/cookies');
const { startBackupSchedule, getBackupHealth } = require('./lib/backup');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const ws = require('./ws');

const app = express();
app.set('trust proxy', 1); // the HTTPS proxy sets x-forwarded-proto; trust it for req.secure (Secure cookies)
app.use(express.json());

// Security headers — hand-written rather than pulling in helmet for five lines. Every response, not just HTML:
// an API response embedded/sniffed the wrong way is exactly what nosniff and frame-ancestors guard against.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=()');
  // script/style 'unsafe-inline' because the app ships inline <script> blocks and style attributes (no build
  // step to hash or nonce them against) — still meaningfully narrows the attack surface vs. no CSP at all:
  // blocks loading a script/frame from anywhere unexpected, restricts connections to same-origin + the app's
  // own WS, and stops the page ever being framed by another origin (defense in depth alongside X-Frame-Options).
  // img-src covers maps.wikimedia.org — see map.js for why tiles come from there rather than OSM's own
  // (volunteer-run, embedding-hostile) tile.openstreetmap.org.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://maps.wikimedia.org; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

/** Resolves the session cookie into {id, role, name, companyId, phone (plaintext)} or null. Shared by REST and the WS upgrade. */
async function resolveUser(cookieHeader) {
  const sid = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!sid) return null;
  const session = await loadSession(sid);
  if (!session) return null;
  const u = session.user;
  return { id: u.id, role: u.role, name: u.name, companyId: u.companyId, phone: u.phone ? decryptField(u.phone) : null };
}

app.use(async (req, res, next) => {
  req.user = await resolveUser(req.headers.cookie).catch(() => null);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', async (req, res) => {
  const health = await getBackupHealth().catch(() => null);
  res.json({ ok: true, backup: health });
});

// The admin console is a plain static page, but gated here (not just left
// to the API's own SUPERUSER check) so a non-admin never even sees it load.
app.get('/admin.html', (req, res, next) => {
  if (!req.user || req.user.role !== 'SUPERUSER') return res.redirect('/');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
ws.attach(server, { onUpgradeAuth: req => resolveUser(req.headers.cookie) });

const PORT = Number(process.env.INTERNAL_PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

// The seed script's accounts ship with public, documented passwords (they're in the README) — worth a loud,
// unmissable warning every single startup for as long as any of them are still set, rather than a one-time
// README note nobody reads twice. Checked by hash comparison (bcrypt.compare), not a stored "is default" flag,
// so it keeps working correctly even if a password gets reset back to the same value by mistake.
async function warnAboutDefaultPasswords() {
  const bcrypt = require('bcryptjs');
  const KNOWN = [['superadmin', 'super-admin-pass'], ['ops', 'ops-demo-pass'], ['driver', 'driver-demo-pass']];
  const users = await prisma.user.findMany({ where: { username: { in: KNOWN.map(([u]) => u) } } });
  const stillDefault = [];
  for (const [username, pw] of KNOWN) {
    const u = users.find(x => x.username === username);
    if (u && u.passwordHash && await bcrypt.compare(pw, u.passwordHash)) stillDefault.push(username);
  }
  if (stillDefault.length) {
    console.warn('\n!!! SECURITY WARNING !!!');
    console.warn(`The following account(s) still use their default, publicly-documented password: ${stillDefault.join(', ')}`);
    console.warn('Change them now — /admin.html for "ops"/driver logins, or ask the superuser for superadmin.\n');
  }
}

async function main() {
  await prisma.$connect();
  await warnAboutDefaultPasswords().catch(err => console.error('[startup] default-password check failed:', err));
  startBackupSchedule();
  server.listen(PORT, HOST, () => {
    console.log(`RideOps listening on http://${HOST}:${PORT} (internal — reach it through the HTTPS proxy on the LAN, see scripts/https-proxy.js)`);
  });
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
