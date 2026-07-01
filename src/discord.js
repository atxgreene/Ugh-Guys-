// Discord Activity (Embedded App) integration.
//
// Shadow of the Watchers runs as a normal website (Vercel) AND as a Discord Activity —
// a web app embedded in an iframe inside a Discord voice channel. Discord serves the
// activity from https://<CLIENT_ID>.discordsays.com and wraps it in a strict CSP that
// blocks every external host: the only way out is Discord's own proxy, reached via URL
// Mappings configured in the Developer Portal.
//
// The multiplayer relay lives on a different origin (Cloudflare), so left alone the
// WebSocket would be blocked inside Discord. patchUrlMappings() solves this: it patches
// the global WebSocket/fetch so a connection to the relay host is transparently rewritten
// to go through Discord's proxy. Because our transport already dials the relay host
// directly (see net.js), nothing else in the game has to change — standalone play uses
// the raw wss://, embedded play is proxied, same code path.
//
// Portal setup this expects (Developer Portal -> your app -> Activities -> URL Mappings):
//   PREFIX /        TARGET  aethercraft.vercel.app                 (serves the game)
//   PREFIX /relay   TARGET  sotw-relay.atxgreene.workers.dev       (the lockstep relay)
// and the relay's ALLOWED_ORIGINS must include *.discordsays.com (see server/cloudflare).

// The SDK (~150 KB) is dynamically imported inside initDiscord() so it only loads for
// players actually inside Discord — plain website visitors never pay for it.

// Public application (client) ID — safe to ship; it's visible in the activity URL.
export const DISCORD_CLIENT_ID = '1521732402249076896';

// The relay host, kept in sync with DEFAULT_RELAY in main.js. Only the bare host goes
// here (no scheme/path) — that's what the URL-mapping proxy keys on.
const RELAY_HOST = 'sotw-relay.atxgreene.workers.dev';

// Discord loads the activity with a `frame_id` query param; its absence means we're a
// plain website and must not touch the SDK (constructing it would hang on a handshake).
export function isDiscordActivity() {
  try { return new URLSearchParams(location.search).has('frame_id'); }
  catch { return false; }
}

let sdk = null;
export function getDiscordSdk() { return sdk; }

// Initialize the Activity: route the relay through Discord's proxy, then complete the
// client handshake. No-op (returns null) when not embedded, so standalone play is
// unaffected. Never throws — a failed handshake degrades to "menu still works".
export async function initDiscord() {
  if (!isDiscordActivity()) return null;
  document.body.classList.add('in-discord');
  try {
    const { DiscordSDK, patchUrlMappings } = await import('@discord/embedded-app-sdk');
    // Must run before any relay WebSocket is created. Requests to RELAY_HOST become
    // wss://<CLIENT_ID>.discordsays.com/.proxy/relay/… automatically.
    try { patchUrlMappings([{ prefix: '/relay', target: RELAY_HOST }]); }
    catch (e) { console.warn('[discord] patchUrlMappings failed', e); }
    sdk = new DiscordSDK(DISCORD_CLIENT_ID);
    await sdk.ready();
    console.info('[discord] activity ready');
  } catch (e) {
    console.warn('[discord] SDK init failed; continuing standalone', e);
    sdk = null;
  }
  return sdk;
}
