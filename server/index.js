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

async function main() {
  await prisma.$connect();
  startBackupSchedule();
  server.listen(PORT, HOST, () => {
    console.log(`RideOps listening on http://${HOST}:${PORT} (internal — reach it through the HTTPS proxy on the LAN, see scripts/https-proxy.js)`);
  });
}
main().catch(err => { console.error('Failed to start:', err); process.exit(1); });

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
