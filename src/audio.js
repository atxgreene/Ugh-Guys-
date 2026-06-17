// Minimal WebAudio synth: UI blips, combat hits, alerts. No assets needed.
let ctx = null;
let lastHit = 0;
let sfxVol = 1;   // master multiplier for all SFX (settings panel)

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (sfxVol <= 0) return;
  try {
    const a = ac();
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
    g.gain.setValueAtTime(vol * sfxVol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start(); o.stop(a.currentTime + dur);
  } catch (e) { /* audio unavailable */ }
}

function noiseBurst(dur = 0.15, vol = 0.08, freq = 800) {
  if (sfxVol <= 0) return;
  try {
    const a = ac();
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
    const g = a.createGain(); g.gain.value = vol * sfxVol;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  } catch (e) { /* audio unavailable */ }
}

// ---------- Ambient music: a low, evolving pre-Flood drone (pure synth) ----------
// A root + fifth + octave stack through a slow-sweeping lowpass, with two of the
// voices detuned and drifting, plus a distant bell that tolls on a long random
// interval. No audio files — it's all oscillators, so it's free to ship.
const Music = {
  playing: false,
  vol: 0.6,
  _nodes: null,
  _bellT: null,

  setVolume(v) {
    this.vol = Math.max(0, Math.min(1, v));
    if (this._nodes) this._nodes.master.gain.setTargetAtTime(this.vol * 0.16, ac().currentTime, 0.5);
  },

  start() {
    if (this.playing) return;
    let a; try { a = ac(); } catch { return; }
    this.playing = true;
    const master = a.createGain();
    master.gain.value = 0;
    master.connect(a.destination);
    master.gain.setTargetAtTime(this.vol * 0.16, a.currentTime, 2.5); // gentle fade-in

    // a warm lowpass the whole drone breathes through
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.7;
    lp.connect(master);
    // slow filter sweep (the "evolving" part)
    const sweep = a.createOscillator(), sweepGain = a.createGain();
    sweep.type = 'sine'; sweep.frequency.value = 0.045;
    sweepGain.gain.value = 180;
    sweep.connect(sweepGain).connect(lp.frequency);
    sweep.start();

    // drone voices: D1 root, A1 fifth, D2 octave — slightly detuned for movement
    const voices = [];
    for (const [freq, detune, type, g] of [
      [36.7, 0, 'sawtooth', 0.5], [55.0, +4, 'sawtooth', 0.34],
      [73.4, -5, 'triangle', 0.4], [110.0, +7, 'sine', 0.18],
    ]) {
      const o = a.createOscillator(), vg = a.createGain();
      o.type = type; o.frequency.value = freq; o.detune.value = detune;
      vg.gain.value = g;
      o.connect(vg).connect(lp);
      o.start();
      // each voice swells in and out on its own slow cycle
      const lfo = a.createOscillator(), lg = a.createGain();
      lfo.type = 'sine'; lfo.frequency.value = 0.02 + Math.random() * 0.05;
      lg.gain.value = g * 0.5;
      lfo.connect(lg).connect(vg.gain); lfo.start();
      voices.push(o, lfo, sweep);
    }
    this._nodes = { master, voices };

    // a far-off bell that tolls now and then over the drone
    const tollBell = () => {
      if (!this.playing) return;
      try {
        const t = a.currentTime;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.value = [146.8, 174.6, 220][Math.floor(Math.random() * 3)];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(this.vol * 0.09, t + 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
        o.connect(g).connect(master);
        o.start(t); o.stop(t + 7);
      } catch {}
      this._bellT = setTimeout(tollBell, 16000 + Math.random() * 22000);
    };
    this._bellT = setTimeout(tollBell, 9000 + Math.random() * 8000);
  },

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this._bellT);
    const n = this._nodes; this._nodes = null;
    if (!n) return;
    try {
      const a = ac(), t = a.currentTime;
      n.master.gain.setTargetAtTime(0, t, 0.8);
      setTimeout(() => { for (const o of n.voices) { try { o.stop(); } catch {} } try { n.master.disconnect(); } catch {} }, 1600);
    } catch {}
  },
};

export { Music };

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
  setVolume(v) { sfxVol = Math.max(0, Math.min(1, v)); },
};
