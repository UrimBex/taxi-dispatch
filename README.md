# RideOps — taxi dispatch service

A real, installable dispatch service for a taxi company: rider app (with an in-app call-dispatch line), operations room and driver
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

## Accounts (seeded by `npm run db:push` / `npm run db:seed`)

**A normal install** (what you do at the client) creates just a platform superuser (`superadmin`), the company, and
one ops login (`ops`), each with a **random password printed once** by the seed — write them down then. Running the
seed again never resets an existing account. Change a password any time with
`npm run user:set-password -- <username>` (omit the password to generate one; it also signs that user out
everywhere). That script is the only way to change the `superadmin` password; ops/driver logins can also be managed in
`/admin.html`.

**Demo mode** (`SEED_DEMO=1 npm run db:push`) instead creates the publicly-documented logins below, plus a demo driver
and rider — for development and for `tools/smoke-test.js` only. Never use it on a real install.

| Role | Sign-in (demo mode) | Sees |
|---|---|---|
| Client | phone number + text-message code (demo rider: `+383 44 111 222`; any other number registers a new rider) | Rider app (returning riders keep saved places and trip history) + the in-app call-dispatch line |
| Driver | username `driver` / password `driver-demo-pass` | Driver app, bound to one vehicle (Ben Krasniqi, seat 7 of the fleet) — see *Fleet roster* below |
| Ops room | username `ops` / password `ops-demo-pass` | Dispatch dashboard, alerts, call queue + operator desk, rules |
| Superuser | username `superadmin` / password `super-admin-pass` | `/admin.html` — create more companies and driver logins |

**Rider sign-in codes.** `NOTIFICATION_PROVIDER` in `.env` picks how the 6-digit code reaches the rider
(`server/lib/sms.js`): `mock` (default) shows the code on screen — **demo only, anyone can then sign in as any
rider, and the server warns about it on every start when `APP_URL` isn't localhost** — or `twilio`, which texts it
for real (set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`; the
server refuses to start if they're missing). Code requests are limited to 3 per number per 10 minutes and 20 per
address per hour. Check Twilio's price/sender rules for +383 numbers before choosing it; another provider is a small
change to `sendSms()`.

**What each role can see.** The server never sends the whole company state to everyone: ops gets everything, a rider
gets only their own bookings/profile/calls plus the fleet needed for the map, a driver gets only their own job
(`server/lib/snapshot.js`). Riders can't dial as another number or touch anyone else's calls (`server/ws.js`).

Every account, live booking, driver position and rider profile is real, shared state on the server — sign in
as the client on your phone, the ops user on a laptop and the driver on another phone, and all three see the same
world update live. (Signing into a *different* account in another tab of the *same* browser will sign the first
tab out too, same as any cookie-based site — that's expected, not a bug; it doesn't happen across separate
devices/browsers, which is the normal way this gets used.)

## Installing on the client's Windows PC

Do this on the client's PC (Windows 10/11, wired network, set to never sleep; give it a fixed LAN IP in the router
and a UPS if you can). Install Node.js LTS first.

1. **Get a clean copy** — `git clone https://github.com/UrimBex/taxi-dispatch.git C:\TaxiArdi`, then `npm install`.
   Don't copy `node_modules`, `prisma/dev.db`, `backups`, `.env` or `certs` from a development machine: that database
   holds test riders and drivers.
2. **Configure** — copy `.env.example` to `.env` and set `DATA_ENCRYPTION_KEY` (generate with the command in the file;
   keep a copy somewhere safe — losing it makes every rider phone number and backup unreadable), `INTERNAL_PORT=3000`,
   `APP_URL` (`https://<the PC's fixed IP>` for now, the public address once step 7 is done),
   `NOTIFICATION_PROVIDER=twilio` + the `TWILIO_*` values, and optionally `BACKUP_MIRROR_DIR` (a OneDrive folder).
3. **Create the database — once** — `npm run db:push` prints the superadmin and ops passwords. **Write them down now**;
   they're shown only this once. (Re-running is safe — existing accounts are never touched — but there's nothing
   more to print.) To change one later: `npm run user:set-password -- superadmin`.
4. **Certificate (office LAN)** — `node scripts/generate-cert.js <the fixed IP>`. On each office PC, install
   `certs/ca.crt` into *Trusted Root Certification Authorities* (double-click → Install Certificate → Local Machine)
   to stop the browser warning.
5. **Install as a Windows Service** — from an **elevated** PowerShell: `node scripts/install-service.js`. This registers
   "RideOps" (`services.msc`), starts at boot and restarts itself on crash, running the app (loopback-only) and
   `scripts/https-proxy.js` in front of it (port 443, falling back to 8443). Open `https://<that IP>/` on an office PC.
6. **Set up the company** — sign in at `/admin.html` as superadmin: add one ops login per dispatcher, then replace the
   demo roster with the real drivers (see *Fleet roster*).
7. **Public address for drivers and riders** — the LAN address only works inside the office; drivers and riders are on
   mobile data and their phones need real HTTPS (GPS and the microphone refuse to work without it). Don't use a
   `cloudflared tunnel --url …` quick tunnel for this: it drops and its address changes on every restart. Use a
   *named* Cloudflare Tunnel on a domain you own (about $10–15/year): add the domain to a free Cloudflare account,
   `winget install Cloudflare.cloudflared`, `cloudflared tunnel login`, `cloudflared tunnel create taxiardi`,
   `cloudflared tunnel route dns taxiardi dispatch.<your-domain>`, a `config.yml` whose ingress sends that hostname to
   `http://127.0.0.1:3000`, then `cloudflared service install` (copy `config.yml` and the credentials JSON into
   `C:\Windows\System32\config\systemprofile\.cloudflared` — the service runs as LocalSystem and looks there).
   Set `APP_URL=https://dispatch.<your-domain>` in `.env` and restart the RideOps service.
8. **Acceptance test** — office PC signs in to ops; a driver phone on mobile data signs in, goes online and shows live
   GPS on the ops map; a rider phone signs in (real text message arrives), books, the driver accepts and the trip
   completes; calls work both ways; reboot the PC and confirm everything comes back by itself within ~2 minutes
   without anyone logging in; unplug the internet and confirm the office ops PCs still work.

**Dispatch phone numbers.** Set `DISPATCH_PHONES` in `.env` to the mobile number(s) dispatchers answer, comma-separated
(for example `+383 44 123 456, +383 49 123 456`, up to 5). The rider app's *Call dispatch* tab then shows a *Call* button
per number that dials it as a normal phone call — no telephony provider needed, and it works without internet. Those
calls are answered on that phone: they don't appear in the ops call queue, and one mobile can only take one call at a
time (more numbers = more simultaneous calls). The tab's second option, calling from the app
over the internet, rings the ops room instead (call queue + operator desk). A real number that feeds the ops room's
queue needs a telephony provider — see *Not in this pass*.

To reinstall: `node scripts/uninstall-service.js` first. To restore from a backup: `node scripts/restore-backup.js`
(`--list` to see snapshots, `--file <path>` to pick one — stops the service, swaps the database, keeps a safety copy
of what it replaced, starts the service back up). To update: `git pull`, `npm install`, restart the RideOps service
(never `npm run db:push` again on a live install).

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

- **Phone line into the ops room**: riders can already dial the dispatch mobile(s) (`DISPATCH_PHONES`), but a call from a
  real phone doesn't appear in the ops call queue or pop up on the operator's screen. That needs a telephony provider
  (Twilio Voice / SIP trunk) bridged into the operator's browser. Booking/receipt SMS to riders (today only in-app
  notifications) would use the same `sendSms()`.
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

## Live operation notes

- The clock runs at real time (1×) — no sped-up or pausable "sim clock". Offer timers and alert thresholds are in
  real seconds, and traffic follows a rush-hour curve keyed to the actual time of day on the server.
- There is no background demand generator, no simulated inbound calls and no autopilot ("bot") drivers — every
  booking, call and vehicle on the dashboard is real. A seat with no driver logged in just sits out of service
  (see *Fleet roster* below) instead of roaming the map on its own.
- The *Phone / IVR* tab in the rider app is a manual, hand-driven demo of the CTI/IVR concept (pick a caller
  number, press digits) for showing the client how phone bookings would screen-pop in the ops room — nothing on
  it fires on its own. It's a stand-in until a real telephony integration (Twilio/SIP) is wired up; see
  "Not in this pass" below.
- *Reset* (ops-only) clears that company's active bookings, calls and driver state (re-applying the saved fleet
  roster) but keeps rider accounts and trip history — useful for clearing out stuck state, not a scheduled thing.

## Manual end-to-end check

`tools/smoke-test.js` exercises the real server over HTTP + WebSocket (login as each role, book, force-assign,
verify the driver sees the job but a different rider doesn't, verify a client can't cancel someone else's booking,
verify a driver can't call an ops-only action) — useful after changing anything in `server/`. It signs in with the demo
passwords, so run it against a `SEED_DEMO=1` database only, never a real install:

```bash
npm run dev &
node tools/smoke-test.js http://127.0.0.1:3000
```
