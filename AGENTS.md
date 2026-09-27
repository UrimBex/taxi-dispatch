<!-- BEGIN:nextjs-agent-rules -->
This project does NOT use Next.js. It's a plain Node/Express server
(`server/`) with a hand-written frontend (`public/`) — no framework, no
build step. Ignore any Next.js-specific guidance from elsewhere.
<!-- END:nextjs-agent-rules -->

# What this is

RideOps: a taxi dispatch service (rider app, phone line, ops room, driver
app), sharing one live simulated fleet per company in real time over a
WebSocket. See README.md for the full architecture and how to run it.

# Working on the simulation core

`public/js/{city,store,engine}.js` are loaded BOTH in the browser (for
local, read-only calculations — fare estimates, ETAs) AND unmodified on the
server (`server/world.js`, via `vm`) as the actual source of truth. Keep
them free of any DOM/`window`-specific API beyond the `(function(RO){...})
(window.RO = window.RO || {})` wrapper pattern they already use — anything
that only makes sense in a browser (rendering, `localStorage`, etc.)
belongs in the UI modules (`customer.js`, `driver.js`, `ops.js`, `ivr.js`,
`main.js`, `map.js`), not in those three files.

`engine.js`'s exported functions fall into two groups:
- **Mutations** (createBooking, acceptOffer, assign, ...) run ONLY on the
  server now — see the allow-lists in `server/ws.js`. The browser's copies
  of these are thin RPC wrappers (`public/js/net.js`) sending a message and
  waiting for the resulting state push; never call them expecting a
  synchronous return value client-side.
- **Reads** (estimate, driverEta, candidates, assignable, canServe) stay
  real functions on both sides, computed locally in the browser against the
  mirrored state for instant UI feedback (typing in the booking form
  shouldn't wait on a round trip).

If you add a new mutation to engine.js, also add it to the right role's
action table in `server/ws.js` — nothing is reachable from a client unless
it's listed there.
