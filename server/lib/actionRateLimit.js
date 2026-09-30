// Throttles how often a given key can perform something, independent of success/failure — unlike
// loginRateLimit.js (which only locks out after repeated WRONG attempts), this caps repeated CORRECT calls too,
// for actions an authenticated-but-low-trust session (a rider, just phone+OTP) could otherwise spam: creating
// bookings, dialling into the IVR. Fixed window, in-memory, same trade-off as loginRateLimit.js — resets on
// restart, fine for a small known fleet of callers.
'use strict';

const buckets = new Map(); // key -> { count, windowStart }

/** True if this call is allowed; false if `key` has already used up its quota for the current window. */
function allow(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart >= windowMs) { buckets.set(key, { count: 1, windowStart: now }); return true; }
  b.count += 1;
  return b.count <= max;
}

module.exports = { allow };
