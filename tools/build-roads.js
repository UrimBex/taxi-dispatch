/* One-off builder: samples the real road network of Prishtina + Obiliq + Fushë Kosovë.
   Lays a 13x14 grid over the area (rows 9-13 funnel towards the airport), asks the free OSRM public server for the driving route between every pair of
   neighbouring intersections, and writes js/roads.js (edges = real road geometry, length and street name).
   Also resolves real landmarks via Nominatim (OpenStreetMap).   Usage: node tools/build-roads.js
   Data © OpenStreetMap contributors (ODbL). Please keep the request rate low if you re-run it. */
const fs = require('fs'), path = require('path');
const COLS = 13, ROWS = 14, LAT0 = 42.663, LNG0 = 21.125, DLAT = 0.00975, DLNG = 0.01417; // node (6,4) = centre
// Nominatim asks for an identifying User-Agent: set CONTACT_EMAIL=you@example.com before running.
const UA = { 'User-Agent': `RideOpsPrototype/1.0 (${process.env.CONTACT_EMAIL || 'contact-not-set'})` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Grid paths (stair-steps over winding edges) are ~1.5x longer than the true shortest road: measured over 24 landmark pairs
// against direct OSRM routes, total 223 km grid vs 145 km real. Edge lengths are scaled by this factor at load time.
const KM_SCALE = 0.65;
const CORE = 9; // rows 0..8 are a regular lattice over the urban area; rows 9..13 funnel towards the airport
let AP = null;   // airport coordinate, resolved before building
function raw(i, j) {
  const base = [LAT0 - (Math.min(j, CORE - 1) - 4) * DLAT, LNG0 + (i - 6) * DLNG];
  if (j < CORE) return base;
  const t = (j - (CORE - 1)) / (ROWS - CORE), T = [AP[0] + 0.0006 * i, AP[1] + 0.0010 * i]; // converge on the airport, so the airport road is a short chain of real highway edges
  return [base[0] + t * (T[0] - base[0]), base[1] + t * (T[1] - base[1])];
}

const LANDMARKS = [
  ['square', 'Skanderbeg Square', '🏛️', 'Sheshi Skenderbeu Prishtine'], ['station', 'Railway Station', '🚉', 'Prishtina Railway Station'],
  ['qkuk', 'University Clinical Center', '🏥', 'QKUK Prishtine'], ['albi', 'Albi Mall', '🛍️', 'Albi Mall Pristina'],
  ['cathedral', 'Mother Teresa Cathedral', '⛪', 'Mother Teresa Cathedral Pristina'], ['obiliq', 'Obiliq Centre', '🏘️', 'Obiliq'],
  ['obmarket', 'Obiliq Market', '🛒', 'Market Qendra Obiliq'], ['fk', 'Fushë Kosovë Centre', '🏘️', 'Fushe Kosove'],
  ['fktrain', 'Fushë Kosovë Train Station', '🚆', 'Fushe Kosove Stacioni i Trenit'], ['bigmall', 'Big Mall Dardania', '🏬', 'Big Mall Center Fushe Kosove'],
  ['stadium', 'Fadil Vokrri Stadium', '🏟️', 'Fadil Vokrri Stadium Pristina'], ['innov', 'Innovation Centre Kosovo', '💼', 'Innovation Centre Kosovo Pristina'],
  ['airport', 'Adem Jashari Airport', '✈️', 'Adem Jashari International Airport']
];

function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let mx = 0, mi = -1;
    for (let k = a + 1; k < b; k++) {
      const [ay, ax] = pts[a], [by, bx] = pts[b], [py, px] = pts[k], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0, d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > mx) { mx = d; mi = k; }
    }
    if (mx > eps && mi > 0) { keep[mi] = true; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, k) => keep[k]);
}
const r5 = v => Math.round(v * 1e5) / 1e5;
async function osrm(a, b, tries = 4) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=true`;
  for (let t = 0; t < tries; t++) {
    try { const r = await fetch(url); const j = await r.json(); if (j.code === 'Ok') return j; } catch (e) { }
    await sleep(1500 * (t + 1));
  }
  return null;
}

function loadCache() { // reuse edges from a previous run over the same grid origin/spacing (only new edges are fetched)
  try {
    global.window = {}; require('../js/roads.js'); const c = global.window.RO.ROADS;
    if (c && c.lat0 === LAT0 && c.lng0 === LNG0 && c.dLat === DLAT && c.dLng === DLNG && c.cols === COLS) return c;
  } catch (e) { }
  return null;
}
(async () => {
  const ap = await (await fetch('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent('Adem Jashari International Airport') + '&format=json&limit=1', { headers: UA })).json();
  AP = [+ap[0].lat, +ap[0].lon]; console.log('airport at', AP.join(', ')); await sleep(1200);
  const cache = loadCache(), nodeLL = {}, edges = {}; let bad = 0, n = 0, reused = 0;
  const jobs = [];
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
    if (i < COLS - 1) jobs.push(['h', i, j, i + 1, j]);
    if (j < ROWS - 1) jobs.push(['v', i, j, i, j + 1]);
  }
  for (const [ax, i, j, i2, j2] of jobs) {
    const key = `${ax}:${i}:${j}`;
    if (cache && cache.edges[key] && j < CORE && j2 < CORE) {
      edges[key] = cache.edges[key]; reused++; n++;
      nodeLL[`${i},${j}`] = nodeLL[`${i},${j}`] || cache.nodes[j * COLS + i]; nodeLL[`${i2},${j2}`] = nodeLL[`${i2},${j2}`] || cache.nodes[j2 * COLS + i2];
      continue;
    }
    const res = await osrm(raw(i, j), raw(i2, j2)); n++;
    if (!res) { console.log('FAILED', key); edges[key] = null; continue; }
    const rt = res.routes[0], wa = res.waypoints[0].location, wb = res.waypoints[1].location;
    const A = [wa[1], wa[0]], B = [wb[1], wb[0]];
    nodeLL[`${i},${j}`] = nodeLL[`${i},${j}`] || A; nodeLL[`${i2},${j2}`] = nodeLL[`${i2},${j2}`] || B;
    let pts = rt.geometry.coordinates.map(([lng, lat]) => [lat, lng]); pts[0] = A; pts[pts.length - 1] = B;
    pts = simplify(pts, 0.00003).map(([la, ln]) => [r5(la), r5(ln)]);
    const names = {}; rt.legs[0].steps.forEach(s => { const nm = s.name || s.ref || ''; if (nm) names[nm] = (names[nm] || 0) + s.distance; });
    const name = Object.entries(names).sort((x, y) => y[1] - x[1]).map(x => x[0])[0] || '';
    const straight = Math.hypot((B[0] - A[0]) * 111.2, (B[1] - A[1]) * 82.1);
    if (rt.distance / 1000 > Math.max(3, straight * 2.6)) bad++;
    edges[key] = { k: +(rt.distance / 1000).toFixed(3), n: name, p: pts.flat() };
    if (n % 20 === 0) console.log(`${n}/${jobs.length} edges  (long detours so far: ${bad})`);
    await sleep(120);
  }
  const nodes = [];
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) nodes.push((nodeLL[`${i},${j}`] || raw(i, j)).map(r5));

  // landmarks: nearest free grid node to the real coordinate
  const used = new Set(), landmarks = [];
  for (const [id, name, icon, q] of LANDMARKS) {
    let res; try { res = await (await fetch('https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(q) + '&format=json&limit=1', { headers: UA })).json(); } catch (e) { }
    await sleep(1200);
    if (!res || !res[0]) { console.log('landmark not found', name); continue; }
    const la = +res[0].lat, ln = +res[0].lon;
    let best = null, bd = 1e9;
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const [nla, nln] = nodes[j * COLS + i], d = Math.hypot((nla - la) * 111.2, (nln - ln) * 82.1);
      if (d < bd && !used.has(i + ',' + j)) { bd = d; best = [i, j]; }
    }
    if (best && bd < 1.8) { used.add(best.join(',')); landmarks.push({ id, name, icon, i: best[0], j: best[1] }); console.log('landmark', name, best.join(','), bd.toFixed(2) + ' km off'); }
    else console.log('landmark skipped (outside grid)', name);
  }

  const out = `/* Generated by tools/build-roads.js — real road geometry © OpenStreetMap contributors (ODbL). */\n(window.RO = window.RO || {}).ROADS = ${JSON.stringify({
    area: 'Prishtina · Obiliq · Fushë Kosovë', lat0: LAT0, lng0: LNG0, dLat: DLAT, dLng: DLNG, kmScale: KM_SCALE, cols: COLS, rows: ROWS, nodes, edges, landmarks
  })};\n`;
  fs.writeFileSync(path.join(__dirname, '..', 'js', 'roads.js'), out);
  console.log(`done: ${Object.keys(edges).length} edges (${reused} reused from cache), ${landmarks.length} landmarks, ${bad} long detours, ${(out.length / 1024).toFixed(0)} KB`);
})();
