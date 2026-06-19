# Lockstep relay

A tiny WebSocket relay. Clients run the deterministic simulation themselves; this server
only groups them into rooms and rebroadcasts turn packets, chat, and lobby state. It
never simulates anything, so it stays cheap and (almost) stateless.

Two interchangeable implementations of the **same wire protocol**:

| File | Runtime | Use it for |
| --- | --- | --- |
| `relay.mjs` | Node (zero deps) | local dev, a home PC, or any VM/VPS |
| `cloudflare/worker.js` | Cloudflare Workers + Durable Objects | **the free, always-on, global host** |

The browser client (`src/net.js`) talks to either one unchanged — only the URL differs.

---

## Option A — Cloudflare (recommended: free, always-on, global)

Durable Objects run on the Workers **free plan**, never cold-start a lobby away, and live
at the edge for low latency worldwide.

```bash
cd server/cloudflare
npx wrangler login      # one-time, opens a browser
npx wrangler deploy     # ships the Worker + Durable Object
```

Wrangler prints a URL like `https://sotw-relay.<you>.workers.dev`. Then:

1. Open `src/main.js` and set `DEFAULT_RELAY` to `wss://sotw-relay.<you>.workers.dev`
   (replace the `YOUR-SUBDOMAIN` placeholder). Until you do, the game shows a setup hint
   instead of failing silently.
2. **Lock it to your game's origin** (so strangers can't use your relay): edit
   `ALLOWED_ORIGINS` in `cloudflare/wrangler.toml` to your deployed game URL(s),
   comma-separated, then `npx wrangler deploy` again.

That's it — players never run anything; Host / Join / Quick Match just work.

---

## Option B — Home PC (free, good for "let's play tonight")

The relay must be reachable over **`wss://`** (TLS), because the game is served over
HTTPS and browsers block insecure `ws://` from a secure page. The clean way to get TLS
on a home machine is a tunnel — it also means **you never open a port on your router.**

```bash
npm run relay                                   # listens on 127.0.0.1:8787 ONLY
# in another terminal — Cloudflare Tunnel (free, no account needed for a quick tunnel):
cloudflared tunnel --url http://localhost:8787
#   → prints https://<random>.trycloudflare.com
# or ngrok:  ngrok http 8787
```

Take the printed `https://…` URL, change `https` → `wss`, and paste it into the game's
**Multiplayer → Advanced → Relay** field. Share that URL (or the invite link) with your
opponent. It works only while your PC and the tunnel are running.

> The relay binds to **127.0.0.1 by default on purpose** — a bare `npm run relay` is not
> reachable from your LAN or the internet. The tunnel connects to it locally. Do **not**
> set `HOST=0.0.0.0` and port-forward your router unless you fully understand the
> exposure; the tunnel is safer and gives you TLS for free.

---

## Option C — VM / VPS / Fly.io

Run `relay.mjs` on any always-on host. Inside a trusted container set `HOST=0.0.0.0` and
front it with TLS (the platform's proxy, or Caddy for auto-certs). Fly.io files are in
this folder (`Dockerfile`, `fly.toml`); `fly launch --no-deploy && fly deploy`.

---

## Security model

A relay is an internet-facing service. Both implementations enforce the same guards;
the defaults are safe, but **set the origin allowlist in production**.

| Guard | Env / config | Default | Why |
| --- | --- | --- | --- |
| Bind address | `HOST` (Node) | `127.0.0.1` | local run isn't exposed; tunnels still reach it |
| Origin allowlist | `ALLOWED_ORIGINS` | empty (dev) | only your game may use the relay |
| Room size cap | `MAX_ROOM` | `2` | a stranger with your code can't join as a 3rd seat and desync the match |
| Frame size cap | `MAX_FRAME_BYTES` | 64 KB | oversized frames are dropped before allocation |
| Rate limit | `RATE_LIMIT` | 60 msg/s | a flooding peer is throttled, then disconnected |
| Connection / room caps | `MAX_CONNECTIONS`, `MAX_ROOMS` | 500 / 200 | bounds total resource use |
| Idle sweep | `IDLE_TIMEOUT_MS` | 30 s | half-open sockets can't hold a room hostage |

Still intentionally out of scope (fine for friends-and-community play, revisit for a
public ranked service): authentication / accounts, persistent identities, and
anti-cheat. The deterministic sim already cross-checks per-turn checksums, so a tampered
client desyncs rather than silently cheating.

## Protocol

JSON text frames. See the header comment in `relay.mjs` for the full message list
(`join`, `name`, `faction`, `ready`, `start`, `packet`, `chat`, `quickmatch`,
`cancelqm`, `ping` → `lobby`, `start`, `packet`, `chat`, `pong`, `reject`).
