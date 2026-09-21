/* City model. A 13x14 grid of intersections (100 units apart) is laid over the real road network
   (Prishtina · Obiliq · Fushë Kosovë + Adem Jashari Airport, from js/roads.js). Each grid edge carries real road geometry, length and
   street name, so the sim stays simple (grid graph) while everything drawn and timed follows real roads.
   Without roads.js it falls back to a synthetic 1 km grid. */
(function (RO) {
  'use strict';
  const R = RO.ROADS || null;
  const G = 100, COLS = 13, ROWS = R ? R.rows : 9, CORE_ROWS = Math.min(ROWS, 9), W = (COLS - 1) * G, H = (ROWS - 1) * G;
  const LAT0 = R ? R.lat0 : 42.663, LNG0 = R ? R.lng0 : 21.125, DLAT = R ? R.dLat : .00975, DLNG = R ? R.dLng : .01417;
  const DEFAULT_LM = [['square', 'Central Square', '🏛️', 9, 4], ['station', 'Railway Station', '🚉', 8, 4], ['qkuk', 'Hospital', '🏥', 9, 6], ['albi', 'Mall', '🛍️', 8, 7]];
  const LM = (R && R.landmarks.length ? R.landmarks.map(l => [l.id, l.name, l.icon, l.i, l.j]) : DEFAULT_LM)
    .map(([id, name, icon, i, j]) => ({ id, name, icon, x: i * G, y: j * G }));

  /* ---------- live traffic (200-unit zones, heaviest around Prishtina centre) ---------- */
  const ZX = Math.ceil(W / 200), ZY = Math.ceil(H / 200), zones = [];
  for (let zy = 0; zy < ZY; zy++) for (let zx = 0; zx < ZX; zx++) {
    const d = Math.hypot(zx * 200 + 100 - 900, zy * 200 + 100 - 400);
    zones.push({ zx, zy, base: Math.max(.15, Math.min(.85, .85 - d / 900)), phase: Math.random() * 6.28, jam: 0, v: .3 });
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const gauss = (h, m, s) => Math.exp(-((h - m) ** 2) / (2 * s * s));
  const peak = t => { const h = (t / 3600) % 24; return .45 + .65 * (gauss(h, 8.5, 1.2) + gauss(h, 17.5, 1.5)); };
  function updateTraffic(simSec, dt) {
    const p = peak(simSec);
    for (const z of zones) {
      z.jam *= Math.pow(.985, dt);
      const tgt = clamp(z.base * p + .1 * Math.sin(simSec / 900 + z.phase) + z.jam, 0, 1);
      z.v = clamp(z.v + (tgt - z.v) * Math.min(1, dt * .6), 0, 1);
    }
  }
  const zoneAt = (x, y) => zones[clamp(Math.floor(y / 200), 0, ZY - 1) * ZX + clamp(Math.floor(x / 200), 0, ZX - 1)];
  const density = (x, y) => zoneAt(x, y).v;
  const speedKmh = (x, y) => 42 * (1 - .65 * density(x, y));
  function addJam(x, y) { const z = x == null ? zones[Math.floor(Math.random() * zones.length)] : zoneAt(x, y); z.jam += .6; return z; }

  /* ---------- nodes & edges ---------- */
  const snap = p => ({ x: clamp(Math.round(p.x / G) * G, 0, W), y: clamp(Math.round(p.y / G) * G, 0, H) });
  /* everyday demand and idle cruising stay in the urban core (first 9 rows); the airport is reached via tripEnds() in the engine */
  const randomNode = () => ({ x: G * Math.floor(Math.random() * COLS), y: G * Math.floor(Math.random() * CORE_ROWS) });
  const isNode = v => Math.abs(v - Math.round(v / G) * G) < 1e-6;
  const cosLat = Math.cos(LAT0 * Math.PI / 180);
  const KS = R && R.kmScale ? R.kmScale : 1; // calibration: grid paths are longer than the true shortest road (see tools/build-roads.js)

  function nodeLL(i, j) {
    if (R) { const n = R.nodes[j * COLS + i]; return { lat: n[0], lng: n[1] }; }
    return { lat: LAT0 - (j - 4) * DLAT, lng: LNG0 + (i - 6) * DLNG };
  }
  const edgeCache = {};
  function getEdge(axis, i, j) { // 'h': (i,j)->(i+1,j)   'v': (i,j)->(i,j+1)
    const key = `${axis}:${i}:${j}`; if (edgeCache[key]) return edgeCache[key];
    const raw = R && R.edges[key], a = nodeLL(i, j), b = axis === 'h' ? nodeLL(i + 1, j) : nodeLL(i, j + 1);
    const flat = raw ? raw.p : [a.lat, a.lng, b.lat, b.lng], pts = [], cum = [0];
    for (let k = 0; k < flat.length; k += 2) pts.push([flat[k], flat[k + 1]]);
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot((pts[k][0] - pts[k - 1][0]) * 111.2, (pts[k][1] - pts[k - 1][1]) * 111.2 * cosLat));
    const e = { km: raw ? raw.k * KS : 1, name: raw ? raw.n : '', pts, cum, total: cum[cum.length - 1] || 1e-9 };
    return (edgeCache[key] = e);
  }
  const edgeName = (axis, i, j) => (i < 0 || j < 0 || (axis === 'h' ? i >= COLS - 1 || j >= ROWS : i >= COLS || j >= ROWS - 1)) ? '' : getEdge(axis, i, j).name;

  /* Split an axis-aligned segment into per-edge pieces (f0/f1 = fraction along the edge, from its first node). */
  function pieces(a, b) {
    const out = [], hz = Math.abs(a.y - b.y) < 1e-6, vt = Math.abs(a.x - b.x) < 1e-6;
    if (!hz && !vt) return out;
    const axis = hz ? 'h' : 'v', s = hz ? a.x : a.y, t = hz ? b.x : b.y, line = Math.round((hz ? a.y : a.x) / G), dir = Math.sign(t - s);
    let cur = s;
    while (dir && dir * (t - cur) > 1e-9) {
      const cell = dir > 0 ? Math.floor(cur / G + 1e-9) : Math.ceil(cur / G - 1e-9) - 1, start = cell * G, bound = dir > 0 ? start + G : start;
      const nxt = dir > 0 ? Math.min(bound, t) : Math.max(bound, t);
      out.push({ axis, line, cell, f0: (cur - start) / G, f1: (nxt - start) / G, len: Math.abs(nxt - cur), mid: (cur + nxt) / 2, dir: axis === 'h' ? (dir > 0 ? 'E' : 'W') : (dir > 0 ? 'S' : 'N') });
      cur = nxt;
    }
    return out;
  }
  const pieceEdge = pc => pc.axis === 'h' ? getEdge('h', pc.cell, pc.line) : getEdge('v', pc.line, pc.cell);
  const pieceMid = pc => pc.axis === 'h' ? { x: pc.mid, y: pc.line * G } : { x: pc.line * G, y: pc.mid };

  function polyInfo(pts) {
    let len = 0, km = 0, sec = 0, ds = 0;
    for (let k = 1; k < pts.length; k++) for (const pc of pieces(pts[k - 1], pts[k])) {
      const m = pieceMid(pc), d = density(m.x, m.y), kmh = 42 * (1 - .65 * d), pk = pc.len / G * pieceEdge(pc).km;
      len += pc.len; km += pk; ds += d * pc.len; sec += pk / kmh * 3600;
    }
    return { km, etaSec: sec, avgDensity: len ? ds / len : density(pts[0].x, pts[0].y) };
  }
  /* real km covered per 100 units on the edge the segment a->b starts on (drives vehicle speed) */
  function kmPerHundred(a, b) { const pc = pieces(a, b)[0]; return pc ? pieceEdge(pc).km : 1; }

  /* ---------- routing: fastest path over the real-road graph under current traffic (Dijkstra, ~180 nodes) ---------- */
  let adj = null;
  function buildAdj() {
    adj = Array.from({ length: COLS * ROWS }, () => []);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const link = (i2, j2, e, mx, my) => { adj[j * COLS + i].push({ n: j2 * COLS + i2, e, mx, my }); adj[j2 * COLS + i2].push({ n: j * COLS + i, e, mx, my }); };
      if (i < COLS - 1) link(i + 1, j, getEdge('h', i, j), i * G + G / 2, j * G);
      if (j < ROWS - 1) link(i, j + 1, getEdge('v', i, j), i * G, j * G + G / 2);
    }
  }
  function route(a, b) {
    a = snap(a); b = snap(b); if (!adj) buildAdj();
    const N = COLS * ROWS, s = (a.y / G) * COLS + a.x / G, t = (b.y / G) * COLS + b.x / G;
    if (s === t) return [{ x: a.x, y: a.y }];
    const dist = new Float64Array(N).fill(Infinity), prev = new Int16Array(N).fill(-1), done = new Uint8Array(N);
    dist[s] = 0;
    for (let it = 0; it < N; it++) {
      let u = -1, bd = Infinity; for (let k = 0; k < N; k++) if (!done[k] && dist[k] < bd) { bd = dist[k]; u = k; }
      if (u < 0 || u === t) break; done[u] = 1;
      for (const nb of adj[u]) {
        if (done[nb.n]) continue;
        const cost = nb.e.km / (42 * (1 - .65 * density(nb.mx, nb.my))) * 3600, nd = dist[u] + cost;
        if (nd < dist[nb.n]) { dist[nb.n] = nd; prev[nb.n] = u; }
      }
    }
    const pts = []; for (let k = t; k !== -1; k = prev[k]) pts.push({ x: (k % COLS) * G, y: Math.floor(k / COLS) * G });
    return pts.reverse();
  }

  /* ---------- geography ---------- */
  function slice(e, f0, f1) {
    const at = f => { const d = f * e.total; let k = 1; while (k < e.cum.length - 1 && e.cum[k] < d) k++; const c0 = e.cum[k - 1], c1 = e.cum[k], u = c1 > c0 ? (d - c0) / (c1 - c0) : 0; return { k, p: [e.pts[k - 1][0] + (e.pts[k][0] - e.pts[k - 1][0]) * u, e.pts[k - 1][1] + (e.pts[k][1] - e.pts[k - 1][1]) * u] }; };
    const a = at(f0), b = at(f1), out = [a.p];
    if (f1 >= f0) for (let k = a.k; k < b.k; k++) out.push(e.pts[k]); else for (let k = a.k - 1; k >= b.k; k--) out.push(e.pts[k]);
    out.push(b.p); return out;
  }
  function toLatLng(p) {
    const nx = isNode(p.x), ny = isNode(p.y);
    if (nx && ny) return nodeLL(Math.round(p.x / G), Math.round(p.y / G));
    let e, f;
    if (ny) { const i = Math.floor(p.x / G); e = getEdge('h', i, Math.round(p.y / G)); f = (p.x - i * G) / G; }
    else { const j = Math.floor(p.y / G); e = getEdge('v', Math.round(p.x / G), j); f = (p.y - j * G) / G; }
    const s = slice(e, f, f)[0]; return { lat: s[0], lng: s[1] };
  }
  function pathLatLngs(pts) {
    if (pts.length < 2) { const l = toLatLng(pts[0]); return [[l.lat, l.lng]]; }
    const out = [];
    for (let k = 1; k < pts.length; k++) for (const pc of pieces(pts[k - 1], pts[k])) {
      const s = slice(pieceEdge(pc), pc.f0, pc.f1); (out.length ? s.slice(1) : s).forEach(q => out.push(q));
    }
    return out.length ? out : [[toLatLng(pts[0]).lat, toLatLng(pts[0]).lng]];
  }
  function fromLatLng(lat, lng) {
    let best = null, bd = 1e18;
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) { const n = nodeLL(i, j), d = (n.lat - lat) ** 2 + ((n.lng - lng) * cosLat) ** 2; if (d < bd) { bd = d; best = { x: i * G, y: j * G }; } }
    return best;
  }
  const bounds = () => { const a = nodeLL(0, ROWS - 1), b = nodeLL(COLS - 1, 0); return [[Math.min(a.lat, b.lat) - .004, Math.min(a.lng, b.lng) - .004], [Math.max(a.lat, b.lat) + .004, Math.max(a.lng, b.lng) + .004]]; };

  /* ---------- naming / turn-by-turn ---------- */
  function label(p) {
    const s = snap(p), lm = LM.find(l => l.x === s.x && l.y === s.y); if (lm) return lm.name;
    const i = s.x / G, j = s.y / G;
    const hn = [edgeName('h', i, j), edgeName('h', i - 1, j)].find(Boolean), vn = [edgeName('v', i, j), edgeName('v', i, j - 1)].find(Boolean);
    if (hn && vn && hn !== vn) return hn + ' & ' + vn; return hn || vn || `Junction ${i + 1}-${j + 1}`;
  }
  const DIRS = ['N', 'E', 'S', 'W'];
  function instructions(pts) {
    const steps = [];
    for (let k = 1; k < pts.length; k++) for (const pc of pieces(pts[k - 1], pts[k])) {
      const e = pieceEdge(pc), km = pc.len / G * e.km, name = e.name || 'local road', last = steps[steps.length - 1];
      if (last && last.dir === pc.dir && last.street === name) { last.len += pc.len; last.km += km; }
      else steps.push({ dir: pc.dir, len: pc.len, km, street: name });
    }
    steps.forEach((s, i) => {
      if (!i) { s.turn = 'start'; return; }
      const diff = (DIRS.indexOf(s.dir) - DIRS.indexOf(steps[i - 1].dir) + 4) % 4;
      s.turn = diff === 1 ? 'right' : diff === 3 ? 'left' : diff === 2 ? 'around' : 'straight';
    });
    return steps;
  }

  RO.City = { G, COLS, ROWS, W, H, CORE_H: (CORE_ROWS - 1) * G, LM, ZX, ZY, zones, geo: !!R, area: R ? R.area : 'Demo city', updateTraffic, density, speedKmh, addJam, snap, randomNode, label, polyInfo, kmPerHundred, route, instructions, toLatLng, pathLatLngs, fromLatLng, bounds };
})(window.RO = window.RO || {});
