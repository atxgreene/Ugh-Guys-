// Minimal WebAudio synth: UI blips, combat hits, alerts. No assets needed.
let ctx = null;
let lastHit = 0;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  try {
    const a = ac();
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  } catch (e) { /* audio unavailable */ }
}

function noiseBurst(dur = 0.15, vol = 0.08, freq = 800) {
  try {
    const a = ac();
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
    const g = a.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  } catch (e) { /* audio unavailable */ }
}

export const Sound = {
  click()      { tone(620, 0.05, 'square', 0.05); },
  select()     { tone(440, 0.06, 'triangle', 0.06); },
  command()    { tone(520, 0.07, 'triangle', 0.06, 120); },
  place()      { tone(220, 0.2, 'sine', 0.1, -80); noiseBurst(0.12, 0.05, 400); },
  trained()    { tone(660, 0.1, 'triangle', 0.08, 160); },
  upgrade()    { tone(520, 0.3, 'sine', 0.1, 300); },
  hit() {
    const now = performance.now();
    if (now - lastHit < 90) return; // throttle
    lastHit = now;
    noiseBurst(0.08, 0.05, 1400);
  },
  death()      { noiseBurst(0.25, 0.07, 300); },
  buildingDie(){ noiseBurst(0.5, 0.12, 150); tone(90, 0.5, 'sawtooth', 0.08, -40); },
  alert()      { tone(330, 0.18, 'square', 0.09); setTimeout(() => tone(262, 0.25, 'square', 0.09), 180); },
  error()      { tone(160, 0.15, 'square', 0.07); },
  win()        { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'triangle', 0.1), i * 160)); },
  lose()       { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.45, 'sawtooth', 0.07), i * 220)); },
};
