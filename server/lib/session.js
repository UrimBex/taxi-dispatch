// DB-backed sessions: the cookie carries only a random session id, looked
// up here on every request/WS connection. Unlike a self-contained JWT, a
// session revoked here (sign-out, or an account removed) takes effect on
// the very next request instead of staying valid until it happens to
// expire on its own.
'use strict';
const crypto = require('crypto');
const { prisma } = require('./db');

const COOKIE_NAME = 'rideops_sid';
const SESSION_DAYS = 30;

async function createSession(userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { id, userId, expiresAt } });
  return { id, maxAge: SESSION_DAYS * 24 * 60 * 60 };
}

async function loadSession(sid) {
  if (!sid) return null;
  const session = await prisma.session.findUnique({ where: { id: sid }, include: { user: { include: { company: true, driverSlot: true } } } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

async function destroySession(sid) {
  if (!sid) return;
  await prisma.session.delete({ where: { id: sid } }).catch(() => {});
}

module.exports = { COOKIE_NAME, createSession, loadSession, destroySession };
