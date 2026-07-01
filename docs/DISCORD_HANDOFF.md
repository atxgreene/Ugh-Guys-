# HANDOFF: Shadow of the Watchers — finish Discord Activity hosting

You are picking up a task on an existing, working game. Most of the engineering is
DONE and merged; the remaining work is (1) Discord Developer Portal configuration and
(2) optional polish. Read this whole brief before acting.

## Project
- **Game**: "Shadow of the Watchers" (aka aethercraft) — a browser RTS, Three.js + Vite,
  deterministic lockstep 1v1 multiplayer. 100% procedural, no external art.
- **Repo**: github.com/atxgreene/Ugh-Guys-  (default branch: `main`)
- **Deployments**:
  - Playable game (production): https://aethercraft.vercel.app/  ← Vercel, auto-deploys from `main`
  - Landing/marketing page: https://atxgreene.github.io/Ugh-Guys-/  ← GitHub Pages, serves `landing/`, links out to Vercel
- **Multiplayer relay**: Cloudflare Worker + Durable Object
  - URL: `wss://sotw-relay.atxgreene.workers.dev`  (worker name `sotw-relay`, subdomain `atxgreene`)
  - Source: `server/cloudflare/worker.js` + `server/cloudflare/wrangler.toml`
  - Deployed via GitHub Actions: `.github/workflows/deploy-relay.yml` (workflow_dispatch)
  - (A Node version `server/relay.mjs` exists for local dev; identical wire protocol.)

## Repo conventions / hard constraints
- **NEVER push directly to `main`** — it's blocked. Workflow: create a branch
  `codex/<slug>` (or `claude/<slug>`), push it, open a PR, squash-merge via API/UI.
- Feature branches are fine to push directly.
- End commit messages with a real co-author trailer; do not put model names in commits.
- Secrets live ONLY in GitHub repo Secrets (write-only). Do NOT paste secrets anywhere.
  Existing secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. (Old `FLY_API_TOKEN`
  exists but Fly is retired — see below.)

## Multiplayer architecture (why the Discord wiring is trivial)
- `src/net.js` `WebSocketTransport` dials the relay HOST directly (no path params) and
  sends the room name inside a `join` JSON message. So a URL-mapping proxy can rewrite
  the host transparently — nothing in the transport needs Discord-specific code.
- Relay enforces an **origin allowlist** (`ALLOWED_ORIGINS` in `wrangler.toml`, supports
  `*` wildcards). Current value:
  `https://aethercraft.vercel.app,https://aethercraft-*.vercel.app,https://*.discordsays.com`
- Room codes like `RAVEN-7F2A`, invite links `?join=CODE`, and a Quick Match queue all
  work through the same relay.

## What was JUST completed and merged to `main` (do not redo)
1. **Relay migrated Fly.io → Cloudflare** (free, always-on). `DEFAULT_RELAY` in
   `src/main.js` = `wss://sotw-relay.atxgreene.workers.dev`. The Fly app was destroyed.
2. **Stale-relay auto-heal**: returning players had `wss://sotw-relay.fly.dev` saved in
   localStorage (the lobby re-saves relay on match start). `openLobby()` now drops any
   `fly.dev` host and falls back to `DEFAULT_RELAY`.
3. **Discord Activity code** — `src/discord.js` (new) + boot wiring in `src/main.js`:
   - Detects the Discord iframe via the `frame_id` query param.
   - LAZILY imports `@discord/embedded-app-sdk` (~160 KB, code-split so web-only players
     don't load it), calls `sdk.ready()`.
   - Calls `patchUrlMappings([{ prefix: '/relay', target: 'sotw-relay.atxgreene.workers.dev' }])`
     BEFORE any socket opens, so the relay WebSocket is proxied through Discord's CSP.
   - `DISCORD_CLIENT_ID = '1521732402249076896'` (public, safe to ship).
   - Boot is an async IIFE that `await initDiscord()` then builds the menu; standalone
     returns instantly and is unaffected.
   - `document.body.classList.add('in-discord')` is set when embedded (for optional CSS).
4. Relay redeployed so `*.discordsays.com` is allowlisted.

## REMAINING WORK

### A. Discord Developer Portal (REQUIRED — likely manual; no reliable public API for URL mappings)
App ID **1521732402249076896** → https://discord.com/developers/applications/1521732402249076896
1. **Activities → Settings**: enable/opt-in to Activities (accept terms if prompted).
2. **Activities → URL Mappings**: add EXACTLY these two (prefix → target, target is host only, no scheme):
   - `/`       → `aethercraft.vercel.app`            (serves the game)
   - `/relay`  → `sotw-relay.atxgreene.workers.dev`  (the relay; MUST match the patchUrlMappings prefix `/relay`)
3. **OAuth2 → General → Redirects**: add `https://1521732402249076896.discordsays.com`
   (Discord requires a redirect entry even though the current build does ready()-only, no token exchange).
4. **Test**: in a Discord voice channel → Activities (rocket) → launch the app (owner can
   run it in dev). Two clients → host/join by room code, or Quick Match.
   - If the relay fails inside Discord, open devtools in the Discord desktop client
     (Ctrl+Shift+I) and check the console. Usual cause: URL-mapping prefix mismatch
     (must be `/relay`) or the Activity not opted-in. These are one-line/one-field fixes.

If you (the executing agent) have NO browser/Discord portal access, STOP at this point and
report that steps A1–A4 are manual and must be done by the human in the portal. Do not
fake them.

### B. OPTIONAL polish — auto-fill lobby name from Discord identity
Currently players type a name. To pull their Discord username you need the full OAuth
handshake (not just ready()):
1. Add a `/token` POST endpoint to `server/cloudflare/worker.js` that exchanges an OAuth
   `code` for an `access_token` using `client_id` + `client_secret` (Discord token URL
   `https://discord.com/api/oauth2/token`, grant_type=authorization_code).
2. Store the Discord **client secret** as a Cloudflare Worker secret. Because the deploy
   token may not have the needed scope and the sandbox can't reach Cloudflare, add it via
   `wrangler secret put DISCORD_CLIENT_SECRET` in the deploy workflow, or have the human
   add it in the CF dashboard. Never hardcode it.
3. In `src/discord.js`, after `ready()`: `const {code} = await sdk.commands.authorize({
   client_id, scope:['identify'], response_type:'code', prompt:'none' })`, POST it to the
   proxied `/token` (add a `/token` URL mapping → the worker), then
   `await sdk.commands.authenticate({ access_token })`.
4. Use `auth.user.username` to prefill the lobby name (`Settings.set('mpName', …)` and the
   `#mp-name` input) only when empty.
Gate all of it behind `isDiscordActivity()` so the website is unaffected. This is
nice-to-have; skip if time-constrained.

### C. OPTIONAL — allow the GitHub Pages origin on the relay
Only needed if the landing page ever hosts a playable/embedded build. To do it: add
`https://atxgreene.github.io` to `ALLOWED_ORIGINS` in `server/cloudflare/wrangler.toml`
and redeploy (below). Not required today (Pages is just a link-out).

## How to deploy the relay (after any wrangler.toml / worker.js change)
- Trigger the GitHub Actions workflow **"Deploy relay"** (`deploy-relay.yml`) on `main`
  (workflow_dispatch). It verifies the CF secrets then runs `wrangler deploy` from
  `server/cloudflare`. Confirm the run's "Deploy to Cloudflare Workers" step succeeds and
  prints `https://sotw-relay.atxgreene.workers.dev`.
- You cannot curl the relay/api.cloudflare.com from a restricted sandbox (network policy);
  verify via the Actions logs, not local curl.

## Known gotchas (learned the hard way)
- The `CLOUDFLARE_API_TOKEN` can deploy Workers but is NOT scoped for **Workers Builds**
  (`/builds/*` returns code 12006 "Invalid token", `/user/tokens/verify` returns 1000).
  A helper workflow `.github/workflows/cf-admin.yml` exists (actions: `discover`,
  `disconnect-build`) but disconnect needs the token broadened with "Workers CI / Builds"
  permission first (a portal action).
- There is a REDUNDANT Cloudflare dashboard Git-build connection (root dir `/`, wrong) that
  may email build failures. Harmless — the live worker is deployed by GitHub Actions
  (`triggered_by: upload`). Disconnect it in CF dashboard → Workers & Pages → sotw-relay →
  Settings → Build, or ignore it.
- Vite `base: './'` (relative) — assets resolve correctly under discordsays.com. Keep it.
- Build/verify with `npm run build`; confirm the bundle contains
  `wss://sotw-relay.atxgreene.workers.dev` and `frame_id`, and that the SDK is a separate
  chunk (it must NOT be in the main game chunk).

## Definition of done
- Discord portal steps A1–A4 configured.
- Launching the Activity in a Discord voice channel loads the game and a 1v1 match
  connects through the relay (room code or Quick Match) with no CSP/origin errors.
- Website + GitHub Pages unaffected; standalone multiplayer still works on aethercraft.vercel.app.
