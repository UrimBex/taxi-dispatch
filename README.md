# RideOps — Taxi dispatch automation (working prototype)

One web app that runs the whole blueprint end to end: customer app, IVR phone line, operations room and driver app,
all wired to a shared dispatch engine. It is a front-end prototype with a simulated city, fleet and backend
(no server, no build step), so you can demo and refine the flows before building the real services.

## Run

```bash
python -m http.server 5180
```

(run it from the project folder; any static file server works, there is no build step).

Open http://localhost:5180 (opening `index.html` directly from disk also works in a normal browser).

## 2-minute demo script

1. **Customer app** – tap *Send code*; the SMS with the OTP pops up in the phone. Verify, pick a destination
   (dropdown or tap the map), compare Standard/Comfort/XL/Wheelchair fares + ETAs, **Book**.
2. **Ops room** (right) – the booking appears as a pulsing pin, dispatch offers it to the best-scored driver,
   the driver accepts, the car drives to the pickup on the live map. Watch *Bookings*, *Log* and the KPIs.
3. **Driver app** – you control driver D07 (Ben). With *Demo bias* on you receive real offers with the **15 s
   countdown**. Accept, then use the status button: *Arrived at Pickup → Start Trip → Trip Completed*.
   Turn-by-turn instructions update as the car moves. Try **SOS** or **Cancel**.
4. **Phone / IVR** – call as the returning rider (Arta): press **1** status, **2** rebook the last trip,
   **3** operator. In *Ops → Calls* the call is queued; **Answer** shows the CTI screen-pop and pre-fills the
   operator form (wheelchair/child-seat tags, vehicle class, pick-on-map). Create the booking; the caller hears it.
5. **Exceptions & override** – in *Ops → Rules* switch off *Auto-dispatch* (or lower the unassigned timer):
   an alert fires, then **Assign/Reassign** a driver manually, place a **VoIP** call to the driver, cancel, or
   retry a failed payment. Trigger a **traffic incident** and watch ETAs, routes and fares react.

## Blueprint → code

| Blueprint | Where |
|---|---|
| Mobile app: map pins, favourites, fare estimate, SMS-OTP, booking payload (coords, class, payment, schedule) | `js/customer.js` |
| IVR: repeat-caller recognition, "press 1 for current booking", quick rebook, overflow to humans | `js/ivr.js` |
| Call centre / CTI, operator dashboard, special-request tags (wheelchair etc.) | `js/ops.js` (Calls tab), `js/engine.js` (calls) |
| Master dispatch dashboard: live vehicles, pending orders, traffic density | `js/ops.js`, `js/map.js` |
| Automation rule engine: nearest optimal driver by ETA + traffic + rating | `candidates()` in `js/engine.js`; weights editable in *Rules* |
| Exception management: unassigned > 90 s, driver cancel, SOS, payment failure | `slowStep()`, `driverCancel()`, `sos()` in `js/engine.js` |
| Manual override: reassign, VoIP call to driver, emergency handling | `assign()`, `voip*()` in `js/engine.js`; detail card in `js/ops.js` |
| GIS / routing / live traffic | `js/city.js` (real-road graph, traffic zones, Dijkstra routing, turn-by-turn), `js/map.js` (Leaflet + OpenStreetMap), `js/roads.js` (generated road data) |
| Payment gateway (card, wallet, corporate, cash), post-ride capture | `completeTrip()` + `slowStep()` in `js/engine.js` |
| Driver app: 15 s offer, navigation, status toggles | `js/driver.js` |
| Database (profiles, history) | `localStorage` (`ro.customers`, `ro.settings`) in `js/store.js` |

## Moving to production

The engine's functions map 1:1 to backend services; the UI modules only call `RO.E.*` and listen to `RO.bus`.

- **API + realtime**: Node/TypeScript (NestJS/Fastify) + WebSocket or MQTT for driver GPS and offers.
- **Data**: PostgreSQL + PostGIS (drivers, bookings, profiles), Redis for live driver positions and offer timers.
- **Dispatch**: move `candidates()`/`dispatchStep()` into a worker; keep the scoring weights as config.
- **Maps/ETA**: Google Maps Platform, Mapbox or self-hosted OSRM/Valhalla instead of `city.js`.
- **Telephony/IVR**: Twilio or Amazon Connect (Studio/contact flows) + SIP/WebRTC softphone for operators and drivers.
- **SMS OTP**: Twilio Verify / Firebase Auth. **Payments**: Stripe (cards, wallets) + invoicing for corporate accounts.
- **Apps**: React Native / Flutter for rider and driver, with native background GPS and push notifications.

## Real map (free, no API key)

The service area is **Prishtina + Obiliq + Fushë Kosovë**, drawn on OpenStreetMap tiles with Leaflet (`vendor/`).

- A 13×14 grid of intersections is laid over the area (the southern rows reach out to the airport). For every pair of
  neighbouring intersections, `tools/build-roads.js` asked the free OSRM public server for the real driving route and saved its geometry,
  length and street name into `js/roads.js`. At runtime **nothing calls a routing server**:
  vehicles drive along those real road shapes, ETAs/fares use real lengths, and the driver's turn-by-turn shows real street names.
- Routing is a shortest-path (Dijkstra) search over that graph under live traffic, so it steers around the few
  grid edges that hit rivers, rail or hills. Turn directions are approximate (derived from the grid, not from the road bends).
- Landmarks (Adem Jashari Airport, Skanderbeg Square, Railway Station, University Clinical Center, Albi Mall, Obiliq Centre, Fushë Kosovë Train Station…)
  were looked up with Nominatim and snapped to the nearest intersection, so a booking "at" a landmark starts at the nearby junction.
- To use another city or a denser grid, change the constants and landmark list at the top of `tools/build-roads.js`
  and re-run `node tools/build-roads.js` (it reuses edges from the existing `js/roads.js` and only fetches new ones; a full build takes a few minutes, so please keep the request rate low).
- Map tiles load from `tile.openstreetmap.org`, which is fine for a prototype; for production use a tile provider
  (MapTiler, Stadia, self-hosted) and your own OSRM/Valhalla.
- Map data © OpenStreetMap contributors (ODbL).

## Simulation notes

- Time runs at 12× by default (speed selector in the header); offer timers and alert thresholds are in real seconds.
- 1 grid step ≈ 1.1 km straight-line and ≈ 2 km by road; traffic follows a rush-hour curve (heaviest in central Prishtina) and slows vehicles; the sim clock starts at 08:15.
- Roughly 1 in 8 simulated trips is to or from the airport; everyday cruising and demand stay in the urban core.
- Background demand, inbound calls and bot-driver behaviour (accept/decline/ignore/cancel) can be tuned or turned off in *Ops → Rules*.
- *Reset* clears the fleet, bookings and calls but keeps rider accounts (stored in your browser's localStorage).
