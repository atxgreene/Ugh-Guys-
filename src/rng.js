// Deterministic, seedable PRNG used for ALL simulation-affecting randomness so a
// match can be reproduced exactly from its seed + input stream (replays, and the
// groundwork for lockstep multiplayer). Cosmetic-only randomness (particle jitter,
// chimney smoke, idle chatter) deliberately stays on Math.random so it can never
// perturb the simulation stream — the two are kept on independent sources.
//
// mulberry32: tiny, fast, good-enough distribution for gameplay. 32-bit state.
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // expose/restore state so a replay can snapshot & verify mid-stream
  rng.getState = () => a >>> 0;
  rng.setState = (s) => { a = (s >>> 0) || 1; };
  return rng;
}
