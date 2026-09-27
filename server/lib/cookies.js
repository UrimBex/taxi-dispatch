// Minimal cookie parse/serialize — used by both ordinary HTTP requests
// (via Express) and the raw WebSocket upgrade request (which happens
// before Express's own cookie handling ever runs), so both paths share one
// implementation instead of two.
'use strict';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function serializeCookie(name, value, opts) {
  opts = opts || {};
  let s = `${name}=${encodeURIComponent(value)}`;
  s += `; Path=${opts.path || '/'}`;
  s += '; HttpOnly';
  s += `; SameSite=${opts.sameSite || 'Lax'}`;
  if (opts.maxAge != null) s += `; Max-Age=${opts.maxAge}`;
  if (opts.secure) s += '; Secure';
  return s;
}

module.exports = { parseCookies, serializeCookie };
