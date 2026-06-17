// Player settings, persisted to localStorage. Centralizes the knobs surfaced in
// the settings panel (brightness/quality), the menu (difficulty), and audio
// (music/SFX). Everything degrades gracefully if storage is unavailable.
const KEY = 'sotw_settings_v1';

const DEFAULTS = {
  brightness: 1.0,        // exposure multiplier, 0.6 – 1.6
  quality: 'auto',        // 'auto' | 'high' | 'low'
  difficulty: 'normal',   // 'easy' | 'normal' | 'hard'
  enemy: 'random',        // 'random' | faction key
  biome: 'random',        // 'random' | biome key
  music: true,            // ambient drone on/off
  musicVol: 0.6,          // 0 – 1
  sfxVol: 1.0,            // 0 – 1
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

const state = load();
const listeners = new Set();

export const Settings = {
  get(k) { return state[k]; },
  all() { return { ...state }; },
  set(k, v) {
    if (state[k] === v) return;
    state[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    for (const fn of listeners) { try { fn(k, v); } catch {} }
  },
  // subscribe to changes; returns an unsubscribe fn
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  DEFAULTS,
};
