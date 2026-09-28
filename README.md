# RideOps — taxi dispatch service

A real, installable dispatch service for a taxi company: rider app, phone line (IVR), operations room and driver
app, all sharing one live fleet in real time. Built the same way as our other on-prem products (BarSaaS): a Node
server with its own database, real accounts, HTTPS, a Windows Service install, scheduled backups and field-level
encryption — not a demo that only works in one browser tab.

A platform **superuser** can provision more than one taxi-company account from a single install (`/admin.html`),
each with its own isolated fleet, bookings and riders — the same superuser/company-account pattern as BarSaaS.
Most installs will only ever need the one company this ships with.

## Architecture

```
server/            Express + WebSocket app: auth, the live dispatch simulation, persistence
  index.js         entry point — binds 127.0.0.1 only, see "Installing on the client's PC"
  world.js         loads public/js/{roads,city,store,engine}.js UNMODIFIED into an isolated sandbox
                    per company (see below) and ticks it on a server-side interval
  ws.js            per-connection auth + a role-gated allow-list of actions (server/ws.js) — this is
                    the only thing a client can ever ask the server to do
  routes/          REST: auth (phone+code / username+password), admin (superuser company/driver provisioning)
  lib/             db (Prisma), crypto (AES-256-GCM + HMAC lookup), sessions, backups, login rate-limiting
prisma/            schema.prisma (Company / User / DriverSlot / Trip / Session) + seed.js
public/            the frontend — served as static files, no build step
  js/{city,store,engine}.js   the dispatch/city/traffic engine — same file, runs on both sides (see below)
  js/net.js        the browser's WebSocket client: turns every mutating call into a round trip to the server
  js/{main,customer,driver,ops,ivr}.js   the four apps' UI
scripts/           generate-cert, https-proxy, install/uninstall-service, restore-backup — see install guide below
tools/build-roads.js   one-off tool that builds public/js/roads.js from OpenStreetMap (unrelated to the server)
```

**The dispatch engine runs on the server, not in the browser.** `public/js/city.js`, `store.js` and `engine.js`
were already written as plain functions closing over an `RO` object passed in by whoever loads them
(`(function (RO) {...})(window.RO)`), with no DOM dependency — originally so `tools/build-roads.js` could reuse
`city.js` under Node. `server/world.js` uses that same property to load all three, unmodified, into an isolated
sandbox per company (`node:vm`) and runs the tick loop there instead. The browser still loads the identical files
for their **read-only** calculations (fare estimates, ETAs — so typing in the booking form doesn't wait on a round
trip), but `public/js/net.js` replaces every *mutating* call (`createBooking`, `acceptOffer`, `assign`, ...) with a
WebSocket round trip, and the server pushes the resulting state to every connected client for that company. That's
what makes a rider's booking show up on the ops dashboard and the driver's phone live, on separate devices — the
one thing the earlier browser-only version couldn't do. See `AGENTS.md` before touching those three files.

## Getting started (development)

```bash
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # paste into DATA_ENCRYPTION_KEY in .env
npm run db:push      # creates the SQLite database and seeds demo accounts (prints their logins)
npm run dev
```

Open http://localhost:3000 (or whatever `INTERNAL_PORT` you set).

## Demo accounts (seeded by `npm run db:push` / `npm run db:seed`)

| Role | Sign-in | Sees |
|---|---|---|
| Client | phone number + text-message code (demo rider: `+383 44 111 222`; any other number registers a new rider) | Rider app (returning riders keep saved places and trip history) + the phone line (IVR) |
| Driver | username `driver` / password `driver-demo-pass` | Driver app, bound to one vehicle (Ben Krasniqi, seat 7 of the fleet) — see *Fleet roster* below, this login won't exist once the roster's been replaced |
| Ops room | username `ops` / password `ops-demo-pass` | Dispatch dashboard, alerts, call queue + operator desk, rules, simulation controls |
| Superuser | username `superadmin` / password `super-admin-pass` | `/admin.html` — create more companies and driver logins |

**Change all of these before this is reachable by anyone but you** — see `.env` and the admin panel. In dev mode,
`NOTIFICATION_PROVIDER=mock` also returns the rider's verification code directly in the sign-in response (shown
on screen, labelled "demo mode") instead of sending a real text — switch that once a real SMS provider is wired
into `server/routes/auth.js`'s `sendCode` step.

Every account, live booking, driver position and rider profile is now real, shared state on the server — sign in
as the client on your phone, the ops user on a laptop and the driver on another phone, and all three see the same
world update live. (Signing into a *different* account in another tab of the *same* browser will sign the first
tab out too, same as any cookie-based site — that's expected, not a bug; it doesn't happen across separate
devices/browsers, which is the normal way this gets used.)

## Installing on the client's Windows PC

This mirrors the BarSaaS install exactly — same shape, same reasoning:

1. `npm install` on the target machine, then `npm run db:push` (creates the database and prints the seeded logins
   — **change every password before continuing**, either via `/admin.html` once running or directly in the DB).
2. Set `.env`: `DATA_ENCRYPTION_KEY` (required), `APP_URL` (the LAN IP or hostname the taxi office will use, e.g.
   `https://192.168.1.22`), and optionally `BACKUP_MIRROR_DIR` pointed at a synced folder (OneDrive etc.) for
   off-machine backup redundancy.
3. `node scripts/generate-cert.js` — makes a 10-year self-signed certificate for that host. Install `certs/ca.crt`
   into each device's trusted-root store to stop the browser warning (Windows: double-click it → "Install
   Certificate" → Local Machine → Trusted Root Certification Authorities).
4. From an **elevated** PowerShell/cmd window: `node scripts/install-service.js`. This registers "RideOps" as a
   real Windows Service (`services.msc`) — it starts at boot and restarts itself on crash, running two processes:
   the app itself (loopback-only, never directly reachable) and `scripts/https-proxy.js` in front of it, which is
   what actually listens on the LAN over HTTPS (falls back to port 8443 if 443 is taken).
5. Open `https://<that IP>/` from any device on the same network.

To reinstall: `node scripts/uninstall-service.js` first. To restore from a backup:
`node scripts/restore-backup.js` (`--list` to see snapshots, `--file <path>` to pick one — stops the service,
swaps the database, keeps a safety copy of what it replaced, starts the service back up).

## Fleet roster (real drivers, not the demo names)

Every company starts out running the built-in 14-name demo roster (`ROSTER` in `public/js/store.js`) so there's
something to look at before anyone's set it up for real. To switch to your actual drivers, sign in at
`/admin.html` as the superuser, pick **Manage fleet** on the company, and either:

- **Replace the whole list at once** — paste `Name, username, password, vehicle` (login and vehicle both
  optional) into *Replace the roster*. This deletes the login on every seat you're overwriting and takes any
  seat the list doesn't cover out of service, so nothing from the old roster is left running.
- **Add or change one driver without touching the rest** — the table row's **+ Add login** / **Change login**
  button (a driver with no login yet can still be a real named seat, running on autopilot until they sign in).

A seat's name/vehicle is a `DriverSlot` row (`prisma/schema.prisma`) applied on top of the demo roster at
company-world startup **and after every reset** — `server/world.js`'s `loadAccounts()` re-applies it every time,
since a reset regenerates the roster from scratch first.

## Real GPS tracking

Signing into the driver app and going online also asks the browser for the device's real location
(`navigator.geolocation.watchPosition`, started/stopped by the online toggle) and sends a fix to the server every
~6s. The server projects it onto the nearest point on the actual road network — mid-block, not just the nearest
intersection (`nearestOnRoad` in `public/js/city.js`) — and that becomes the vehicle's real position, replacing
the simulated route-following for as long as fixes keep arriving (`d.gpsTracked`, checked in `moveDrivers()`,
`public/js/engine.js`). A rider's ETA, the ops map, and the driver's own turn-by-turn are all just reading
`driver.pos`, so none of them needed to change.

A few things worth knowing:

- **The service area is real, fixed geography** (Prishtina · Obiliq · Fushë Kosovë) — a fix more than 5 km from
  any mapped road is rejected rather than trusted (returned as `{applied:false, reason:'outside-service-area'}`),
  and the driver app's badge (📍 *Live GPS* / *Outside area* / *Simulated* / permission states) reflects the most
  recent attempt, not just whether tracking is technically still active. Testing this from anywhere outside that
  area — the normal case during development — will hit that fallback; it's meant to.
- **A stale device falls back to simulated movement**, not a frozen car: if fixes stop arriving for 30s (screen
  locked, tab backgrounded, permission revoked mid-shift), `world.js`'s tick loop clears `gpsTracked` and the
  vehicle resumes route-following from wherever it last really was.
- **Arrival is decided by real proximity** (within ~80m of the pickup/dropoff) while GPS-tracked, not by a
  simulated path running out — same "Arrived at Pickup" button, just driven by where the phone says the driver
  actually is.
- Two real streets can legitimately pass within meters of each other in this dataset — a fix can occasionally
  snap onto a nearby parallel/crossing road instead of the "right" one. A known, minor limitation of snapping
  discrete fixes onto a simplified grid graph, not a bug to chase further for this scale of app.

## Not in this pass

- **Real SMS/telephony**: the phone line is a simulator (`public/js/ivr.js`) and rider codes are logged/returned
  directly rather than texted — wire a real provider into `server/routes/auth.js` (`request-code`) and the IVR
  simulator's touch-tone flow into a real telephony provider (Twilio Studio, Amazon Connect) separately.
- **Real payments**: fares are simulated (`completeTrip()` in `engine.js`) with a random failure rate for the ops
  "retry payment" flow to have something to do — wire a real processor in similarly to BarSaaS's mock-Stripe.
- **Driver stats/company settings persistence**: a driver's rating/trip-count/earnings and the Rules-tab settings
  reset to defaults on a service restart (only completed trips, accounts and saved places are durable — see
  `prisma/schema.prisma`).
- **Postgres**: ships on SQLite (`prisma/schema.prisma`) as bar-order-app does locally; switch the datasource
  `provider` to `"postgresql"` and use `npx prisma migrate dev` instead of `db:push` for a bigger install.

## Real map (free, no API key)

The service area is **Prishtina + Obiliq + Fushë Kosovë**, drawn on OpenStreetMap tiles with Leaflet (`public/vendor/`).

- A 13×14 grid of intersections is laid over the area (the southern rows reach out to the airport). For every pair
  of neighbouring intersections, `tools/build-roads.js` asked the free OSRM public server for the real driving
  route and saved its geometry, length and street name into `public/js/roads.js`. At runtime **nothing calls a
  routing server**: vehicles drive along those real road shapes, ETAs/fares use real lengths, and the driver's
  turn-by-turn shows real street names.
- Routing is a shortest-path (Dijkstra) search over that graph under live traffic, so it steers around the few
  grid edges that hit rivers, rail or hills. Turn directions are approximate (derived from the grid, not the road bends).
- Landmarks (Adem Jashari Airport, Skanderbeg Square, Railway Station, University Clinical Center, Albi Mall,
  Obiliq Centre, Fushë Kosovë Train Station…) were looked up with Nominatim and snapped to the nearest
  intersection, so a booking "at" a landmark starts at the nearby junction.
- To use another city or a denser grid, change the constants and landmark list at the top of `tools/build-roads.js`
  and re-run `node tools/build-roads.js` (it reuses edges already in `public/js/roads.js` and only fetches new
  ones; a full build takes a few minutes, so please keep the request rate low).
- Map tiles load from `tile.openstreetmap.org`, fine for a pilot; for a bigger install use a tile provider
  (MapTiler, Stadia, self-hosted) and your own OSRM/Valhalla.
- Map data © OpenStreetMap contributors (ODbL).

## Simulation notes

- Time runs at 12× by default (speed selector, ops-only, applies to the whole company); offer timers and alert
  thresholds are in real seconds. All connected ops viewers share one clock/speed/pause state now.
- 1 grid step ≈ 1.1 km straight-line and ≈ 2 km by road; traffic follows a rush-hour curve (heaviest in central
  Prishtina) and slows vehicles; the sim clock starts at 08:15 when a company's world is first created.
- Roughly 1 in 8 simulated trips is to or from the airport; everyday cruising and demand stay in the urban core.
- Background demand, inbound calls and bot-driver behaviour (accept/decline/ignore/cancel) can be tuned or turned
  off per company in *Ops → Rules*.
- *Reset* (ops-only) clears that company's fleet, bookings and calls but keeps rider accounts and trip history.

## Manual end-to-end check

`tools/smoke-test.js` exercises the real server over HTTP + WebSocket (login as each role, book, force-assign,
verify cross-connection shared state, verify a client can't cancel someone else's booking, verify a driver can't
call an ops-only action) — useful after changing anything in `server/`:

```bash
npm run dev &
node tools/smoke-test.js http://127.0.0.1:3000
```
