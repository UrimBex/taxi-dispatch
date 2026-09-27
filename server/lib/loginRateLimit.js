// Brute-force protection for the driver/ops password login and the client
// SMS-code verification — locks a key out for a cooldown period after too
// many wrong attempts in a row, instead of allowing unlimited guesses.
// Tracked per (kind, key) — e.g. per username for password login, per
// phone number for OTP — not per IP, since this app is typically reached
// through a single reverse proxy that may not forward a normalized client
// IP either way.
//
// In-memory (a plain Map), so it resets on every service restart — an
// accepted trade-off for a small, known set of accounts.
'use strict';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const attempts = new Map();
const norm = (kind, key) => `${kind}:${String(key || '').trim().toLowerCase()}`;

function isLockedOut(kind, key) {
  const k = norm(kind, key);
  const entry = attempts.get(k);
  if (!entry || entry.lockedUntil === null) return false;
  if (Date.now() >= entry.lockedUntil) { attempts.delete(k); return false; }
  return true;
}

function recordFailure(kind, key) {
  const k = norm(kind, key);
  const entry = attempts.get(k) || { failures: 0, lockedUntil: null };
  entry.failures += 1;
  if (entry.failures >= MAX_ATTEMPTS) entry.lockedUntil = Date.now() + LOCKOUT_MS;
  attempts.set(k, entry);
}

function recordSuccess(kind, key) { attempts.delete(norm(kind, key)); }

module.exports = { isLockedOut, recordFailure, recordSuccess };
