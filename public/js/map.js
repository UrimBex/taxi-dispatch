/* Map component on Leaflet + OpenStreetMap tiles (free, no API key). Vehicles/pins/routes are given in sim grid
   coordinates and drawn on the real road geometry from RO.City. Marker helpers (car/pin/line) return one JSON line
   each; a draw list is just their concatenation, so UI code can build it with plain string +=. Markers are keyed
   and reused between draws, so vehicles glide instead of flickering. */
(function (RO) {
  'use strict';
  const C = RO.City, U = RO.util, L = window.L;
  const STATUS_COL = { available: '#22c55e', offered: '#f59e0b', enroute: '#6366f1', arrived: '#a855f7', ontrip: '#0ea5e9', offline: '#64748b' };
  const enc = o => JSON.stringify(o) + '\n';
  const dec = s => s ? s.split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const r2 = v => Math.round(v * 100) / 100;
  const slots = {};
  const LINE_STYLE = { 'm-route': { color: '#2563eb', weight: 6, opacity: .85 }, 'm-route dim': { color: '#475569', weight: 4, opacity: .75, dashArray: '2 10' } };

  function carHTML(d) {
    return `<div class="car-i${d.sel ? ' sel' : ''}${d.sos ? ' sos' : ''}${d.me ? ' me' : ''}" style="--c:${STATUS_COL[d.status] || STATUS_COL.offline};--s:${d.s}"><span class="ring"></span>${d.tag ? `<em>${U.esc(d.id)}</em>` : ''}<b class="body"></b></div>`;
  }
  function pinHTML(d) {
    const k = .72 * d.s;
    return `<div class="pin-i ${d.cls || ''}">${d.label ? `<em>${U.esc(d.label)}</em>` : ''}<svg viewBox="0 0 28 38" width="${28 * k}" height="${38 * k}"><path d="M14 37 L5 21 A11 11 0 1 1 23 21 Z" fill="${d.color}" stroke="#0b1220" stroke-width="1.6"/><circle cx="14" cy="14" r="4.5" fill="#fff"/></svg></div>`;
  }

  class MapView {
    constructor(host, o) {
      this.o = Object.assign({ labels: true, heat: false, zoom: true, slot: null, onTap: null, onSelect: null }, o);
      if (this.o.slot) { if (slots[this.o.slot]) slots[this.o.slot].destroy(); slots[this.o.slot] = this; }
      this.host = host; host.innerHTML = ''; this.cars = {}; this.pins = {}; this.lines = []; this.heatOn = !!this.o.heat; this._needFit = true;
      const z = this.o.zoom; // phone maps are auto-framed and static; the ops map is fully interactive
      const map = this.map = L.map(host, { zoomControl: z, scrollWheelZoom: z, doubleClickZoom: z, dragging: z, touchZoom: z, boxZoom: z, keyboard: false, zoomSnap: .5, zoomDelta: .5, attributionControl: true });
      map.attributionControl.setPrefix(false);
      // Esri's free community basemap tiles. Tried three alternatives before this one, each confirmed broken
      // by actually loading a tile and checking it, not just eyeballing a screenshot (a translucent heat-layer
      // overlay on a blank map can look like terrain at a glance): OSM's own tile.openstreetmap.org blocks
      // embedded apps under its usage policy; CARTO's basemap tiles now require a paid API key; Wikimedia's
      // tile service is restricted to Wikimedia-affiliated sites only ("Forbidden", confirmed by request).
      // Esri's World_Street_Map needs no key and is the standard free fallback for exactly this case — verified
      // by loading a real tile directly (correct Pristina street data, labels, road numbers) before wiring it in.
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a> — Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom' }).addTo(map);
      map.setView([42.663, 21.125], 12);
      this.heatLayer = L.layerGroup(); this.heatPolys = [];
      C.zones.forEach(z => {
        if (z.zy * 200 >= C.CORE_H) { this.heatPolys.push(null); return; } // airport corridor rows are not a regular lattice: no heat cells there
        const x0 = z.zx * 200, y0 = z.zy * 200, x1 = Math.min(C.W, x0 + 200), y1 = Math.min(C.H, y0 + 200);
        const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => { const l = C.toLatLng({ x, y }); return [l.lat, l.lng]; });
        this.heatPolys.push(L.polygon(pts, { stroke: false, interactive: false, fillOpacity: .2 }).addTo(this.heatLayer));
      });
      if (this.heatOn) this.heatLayer.addTo(map);
      C.LM.forEach(l => {
        const ll = C.toLatLng(l);
        L.marker([ll.lat, ll.lng], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'lm-mk', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="lm-i"><span>${l.icon}</span>${this.o.labels ? `<em class="lm-name">${U.esc(l.name)}</em>` : ''}</div>` }) }).addTo(map);
      });
      map.on('click', e => { if (this.o.onTap) this.o.onTap(C.fromLatLng(e.latlng.lat, e.latlng.lng)); });
      this.ro = new ResizeObserver(() => {
        if (!host.clientWidth || !host.clientHeight) return;
        map.invalidateSize({ animate: false });
        if (this._needFit) { this._needFit = false; if (this.o.fitAll !== false && !this._fitted) this.fullView(); }
      });
      this.ro.observe(host);
    }
    destroy() { try { this.ro.disconnect(); this.map.remove(); } catch (e) { } }
    showHeat(on) { this.heatOn = on; on ? this.heatLayer.addTo(this.map) : this.heatLayer.remove(); }
    updateHeat() {
      if (!this.heatOn) return;
      C.zones.forEach((z, i) => this.heatPolys[i] && this.heatPolys[i].setStyle({ fillColor: `hsl(${Math.round(125 - 125 * z.v)} 85% 50%)`, fillOpacity: .12 + z.v * .28 }));
    }
    fullView() { this._fitted = true; if (this.host.clientWidth) this.map.fitBounds(C.bounds(), { animate: false }); }
    fit(points, opt) {
      const o = Object.assign({ pad: 110, minW: 420 }, opt); if (!this.host.clientWidth) return;
      const ll = points.map(p => C.toLatLng(p)).map(l => [l.lat, l.lng]), b = L.latLngBounds(ll), vb = this.map.getBounds();
      // only re-fit when something drifted out of view or the view is far too loose (avoids jitter every tick)
      const inside = vb.pad(-.12).contains(b), z = this.map.getBoundsZoom(b.pad(.25), false);
      if (this._fitted && inside && z - this.map.getZoom() <= 1) return;
      this._fitted = true; this.map.fitBounds(b.pad(.25), { animate: false, maxZoom: 16 });
    }
    centerOn(p, w) {
      if (!this.host.clientWidth) return; this._fitted = true;
      const l = p.lat != null ? p : C.toLatLng(p), z = Math.max(12, Math.min(17, Math.round(15 - Math.log2(w / 450)) + 0));
      this.map.setView([l.lat, l.lng], z, { animate: false });
    }
    draw(under, over) {
      const items = dec(under).concat(dec(over)); let li = 0; const seenC = {}, seenP = {}; let pn = 0;
      for (const it of items) {
        if (it.t === 'line') {
          let pl = this.lines[li]; const ll = C.pathLatLngs(it.pts);
          if (!pl) pl = this.lines[li] = L.polyline(ll, { interactive: false }).addTo(this.map);
          pl.setLatLngs(ll); pl.setStyle(Object.assign({ dashArray: null }, LINE_STYLE[it.cls] || LINE_STYLE['m-route'])); li++;
        } else if (it.t === 'car') {
          seenC[it.id] = 1; const ll = it.glat != null ? { lat: it.glat, lng: it.glng } : C.toLatLng(it.pos); let m = this.cars[it.id];
          if (!m) {
            m = this.cars[it.id] = L.marker([ll.lat, ll.lng], { icon: L.divIcon({ className: 'car-mk', iconSize: [34, 34], iconAnchor: [17, 17], html: carHTML(it) }), zIndexOffset: 500, keyboard: false }).addTo(this.map);
            m._sig = carHTML(it); m._hd = it.heading; m._ll = ll; m.on('click', () => this.o.onSelect && this.o.onSelect('driver', it.id));
          } else {
            const sig = carHTML(it); if (sig !== m._sig) { m.setIcon(L.divIcon({ className: 'car-mk', iconSize: [34, 34], iconAnchor: [17, 17], html: sig })); m._sig = sig; }
            const a = this.map.latLngToLayerPoint([m._ll.lat, m._ll.lng]), b = this.map.latLngToLayerPoint([ll.lat, ll.lng]);
            if (Math.hypot(b.x - a.x, b.y - a.y) > 1.5) { m._hd = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; m._ll = ll; }
            m.setLatLng([ll.lat, ll.lng]);
          }
          const body = m.getElement() && m.getElement().querySelector('.body'); if (body) body.style.transform = `rotate(${m._hd}deg)`;
          m.setZIndexOffset(it.sel ? 900 : it.me ? 700 : 500);
        } else if (it.t === 'pin') {
          let key = it.id ? 'b:' + it.id : 'p:' + it.x + ',' + it.y + ',' + it.color; if (seenP[key]) key += '#' + (pn++); seenP[key] = 1;
          const ll = C.toLatLng(it), sig = pinHTML(it), k = .72 * it.s; let m = this.pins[key];
          const icon = () => L.divIcon({ className: 'pin-mk', iconSize: [28 * k, 38 * k], iconAnchor: [14 * k, 38 * k], html: sig });
          if (!m) {
            m = this.pins[key] = L.marker([ll.lat, ll.lng], { icon: icon(), interactive: !!it.id, keyboard: false, zIndexOffset: 300 }).addTo(this.map); m._sig = sig;
            if (it.id) m.on('click', () => this.o.onSelect && this.o.onSelect(it.kind || 'booking', it.id));
          } else { if (sig !== m._sig) { m.setIcon(icon()); m._sig = sig; } m.setLatLng([ll.lat, ll.lng]); }
        }
      }
      while (this.lines.length > li) this.lines.pop().remove();
      for (const k in this.cars) if (!seenC[k]) { this.cars[k].remove(); delete this.cars[k]; }
      for (const k in this.pins) if (!seenP[k]) { this.pins[k].remove(); delete this.pins[k]; }
    }
  }

  // The grid position (d.pos) is what routing/ETA use, but it's snapped onto a ~1.1 km grid (see city.js) so it
  // can visibly diverge from where the phone actually is. Prefer the raw GPS fix for anything the driver or ops
  // actually LOOK at, while routing keeps using the grid position underneath.
  const driverLL = d => (d.gpsTracked && d.gpsLat != null) ? { lat: d.gpsLat, lng: d.gpsLng } : C.toLatLng(d.pos);
  MapView.driverLL = driverLL;
  MapView.car = (d, o) => { o = o || {}; const ll = driverLL(d); return enc({ t: 'car', id: d.id, pos: { x: r2(d.pos.x), y: r2(d.pos.y) }, glat: ll.lat, glng: ll.lng, status: d.online ? d.status : 'offline', heading: d.heading || 0, s: o.s || 1, sel: !!o.sel, sos: !!o.sos, me: !!o.me, tag: !!o.tag }); };
  MapView.pin = (p, o) => { o = o || {}; return enc({ t: 'pin', x: p.x, y: p.y, color: o.color || '#ef4444', label: o.label || '', id: o.id || '', kind: o.kind, cls: o.cls || '', s: o.s || 1 }); };
  MapView.line = (pts, cls) => enc({ t: 'line', pts: pts.map(p => ({ x: r2(p.x), y: r2(p.y) })), cls: cls || 'm-route' });
  MapView.STATUS_COL = STATUS_COL;
  RO.MapView = MapView;
})(window.RO);
