# Lockstep relay

A tiny, zero-dependency WebSocket relay. Clients run the deterministic simulation
themselves; this server only groups them into rooms and rebroadcasts turn packets,
chat, and lobby state. It never simulates anything, so it stays cheap and stateless
beyond the in-memory room list.

## Run locally (development)

```bash
npm run relay          # node server/relay.mjs, listens on :8787
```

Then in the game's **Multiplayer → Advanced** panel set the relay to
`ws://localhost:8787`.

## Deploy to Fly.io (production)

The game ships with a default relay URL of `wss://sotw-relay.fly.dev` (see
`DEFAULT_RELAY` in `src/main.js`). To stand up your own:

```bash
cd server
fly launch --no-deploy   # creates the app; keep the name "sotw-relay" or pick your own
fly deploy               # builds the Dockerfile and ships it
```

If you choose a different app name, update `DEFAULT_RELAY` in `src/main.js` to your
`wss://<app>.fly.dev` hostname so players connect automatically.

### Why always-on?

`fly.toml` keeps one machine running (`min_machines_running = 1`,
`auto_stop_machines = "off"`). A relay that cold-starts would drop any lobby waiting
on it, which is exactly the seam we're removing. The trade-off is a small constant
cost instead of scale-to-zero.

## Protocol

JSON text frames. See the header comment in `relay.mjs` for the full message list
(`join`, `ready`, `start`, `packet`, `chat`, `quickmatch`, `ping` → `lobby`, `start`,
`packet`, `chat`, `pong`).
