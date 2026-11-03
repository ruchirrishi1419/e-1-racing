/* =====================================================================
   E1 (EQUATION 1) - SOUNDS
   All sounds are made by code using the browser's "Web Audio" feature,
   so there are no sound files to download.
   Browsers only allow sound after the player clicks something, so
   Sound.init() is called when "Create Race" or "Join Race" is clicked.
   ===================================================================== */

const Sound = (() => {
  let ctx = null;        // the audio "engine" of the browser
  let master = null;     // main volume knob
  let muted = false;
  let noiseBuffer = null;
  let engine = null;     // the running engine sound
  let skid = null;       // the running tyre squeal sound

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return; // very old browser: no sound
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);

    // One second of random "hiss", used for crashes and tyre sounds
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  // Play a simple musical note
  function tone(freq, duration, type = 'sine', volume = 0.25, delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // A short burst of noise (crash / bump)
  function noise(duration, volume, filterFreq) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + duration);
  }

  /* ---------- Engine (keeps running during the race) ---------- */
  function startEngine() {
    if (!ctx || engine) return;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(master);
    osc1.start(); osc2.start();
    engine = { osc1, osc2, filter, gain };

    // Tyre squeal: filtered looping noise, volume controlled while drifting
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 3;
    const skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    src.connect(band).connect(skidGain).connect(master);
    src.start();
    skid = { src, gain: skidGain };
  }

  // speedRatio: 0 (stopped) to 1 (top speed). throttle: true when pressing gas.
  function updateEngine(speedRatio, throttle, drifting) {
    if (!engine) return;
    const t = ctx.currentTime;
    const r = Math.min(1, Math.abs(speedRatio));
    // Fake gear changes: pitch rises, then drops a little at each "gear"
    const gearPos = (r * 5) % 1;
    const freq = 55 + r * 110 + gearPos * 45;
    engine.osc1.frequency.setTargetAtTime(freq, t, 0.05);
    engine.osc2.frequency.setTargetAtTime(freq * 0.5, t, 0.05);
    engine.filter.frequency.setTargetAtTime(500 + r * 1500 + (throttle ? 400 : 0), t, 0.1);
    engine.gain.gain.setTargetAtTime(0.05 + r * 0.06 + (throttle ? 0.03 : 0), t, 0.1);
    skid.gain.gain.setTargetAtTime(drifting && r > 0.25 ? 0.07 : 0, t, 0.05);
  }

  function stopEngine() {
    if (!engine) return;
    const t = ctx.currentTime;
    engine.gain.gain.setTargetAtTime(0, t, 0.1);
    skid.gain.gain.setTargetAtTime(0, t, 0.05);
    const e = engine, s = skid;
    setTimeout(() => { try { e.osc1.stop(); e.osc2.stop(); s.src.stop(); } catch (err) { /* already stopped */ } }, 400);
    engine = null;
    skid = null;
  }

  /* ---------- Sound effects ---------- */
  const countdown = () => tone(440, 0.25, 'square', 0.15);
  const go = () => tone(880, 0.6, 'square', 0.18);
  const lap = () => { tone(660, 0.12, 'triangle', 0.25); tone(990, 0.2, 'triangle', 0.25, 0.1); };
  const bestLap = () => { tone(660, 0.1, 'triangle', 0.25); tone(880, 0.1, 'triangle', 0.25, 0.1); tone(1320, 0.3, 'triangle', 0.25, 0.2); };
  const crash = strength => noise(0.25, Math.min(0.5, 0.1 + strength / 600), 700);
  const bump = () => noise(0.12, 0.2, 1200);
  const click = () => tone(1200, 0.05, 'square', 0.08);
  const finish = () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.22, i * 0.13));
  };

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.6;
    return muted;
  }

  return { init, startEngine, updateEngine, stopEngine, countdown, go, lap, bestLap, crash, bump, click, finish, toggleMute };
})();
