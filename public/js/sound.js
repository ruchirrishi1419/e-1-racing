/* =====================================================================
   E1 (EQUATION 1) - SOUNDS
   ---------------------------------------------------------------------
   Every sound is made by code with the browser's "Web Audio" feature
   (sound synthesis), so there are no recordings or copyrighted sounds.

   F1-style engine: a high-pitched V6 "scream" whose pitch follows the
   engine speed (RPM) and gear, a turbo whine, a quick drop in pitch and
   a pop at every gear change, crackles when you lift off, tyre screech,
   kerb rumble. Other cars have their own engines, louder when they are
   close and coming from the left or right speaker.
   The crowd cheers near the grandstands, on overtakes and finishes.

   Browsers only allow sound after the player clicks something, so
   Sound.init() is called when a menu button is clicked.
   ===================================================================== */

const Sound = (() => {
  let ctx = null;        // the audio "engine" of the browser
  let master = null;     // main volume knob
  let muted = false;
  let volume = 0.7;
  let noiseBuffer = null;
  let engine = null;     // my engine
  let others = [];       // engine voices for the nearest other cars
  let crowd = null;      // crowd noise
  let cheerLevel = 0;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return; // very old browser: no sound
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    // a gentle "compressor" stops loud moments from distorting
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    // Two seconds of random "hiss", used for crashes, tyres, wind and the crowd
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  const now = () => ctx.currentTime;
  const ramp = (param, value, time = 0.05) => param.setTargetAtTime(value, now(), time);

  function noiseSource(loop = true) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = loop;
    return src;
  }
  function filter(type, freq, Q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = Q;
    return f;
  }
  function gain(v = 0) { const g = ctx.createGain(); g.gain.value = v; return g; }
  // soft distortion: makes the engine sound raspy instead of clean
  function shaper(amount) {
    const ws = ctx.createWaveShaper(), n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    ws.curve = curve;
    return ws;
  }

  // Play a simple musical note
  function tone(freq, duration, type = 'sine', vol = 0.25, delay = 0) {
    if (!ctx) return;
    const t = now() + delay;
    const osc = ctx.createOscillator(), g = gain(vol);
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t); osc.stop(t + duration + 0.05);
  }
  // A short burst of filtered noise (crash, bump, pops)
  function burst(duration, vol, type, freq, delay = 0) {
    if (!ctx) return;
    const t = now() + delay;
    const src = noiseSource(false), f = filter(type, freq, 0.8), g = gain(vol);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random()); src.stop(t + duration + 0.02);
  }

  /* ---------- My engine ---------- */
  function startEngine() {
    if (!ctx || engine) return;
    const out = gain(0);
    const tone1 = ctx.createOscillator(); tone1.type = 'sawtooth';   // main firing note
    const tone2 = ctx.createOscillator(); tone2.type = 'square';     // octave above (the "scream")
    const tone3 = ctx.createOscillator(); tone3.type = 'sawtooth';   // low body of the sound
    const whine = ctx.createOscillator(); whine.type = 'sine';       // turbo / electric whine
    tone2.detune.value = 8;
    const g1 = gain(0.5), g2 = gain(0.22), g3 = gain(0.35), gw = gain(0);
    const dist = shaper(2.2);
    const body = filter('peaking', 900, 1.2); body.gain.value = 6;
    const lp = filter('lowpass', 3000, 0.7);
    tone1.connect(g1).connect(dist); tone2.connect(g2).connect(dist); tone3.connect(g3).connect(dist);
    dist.connect(body).connect(lp).connect(out);
    whine.connect(gw).connect(out);
    // intake roar (filtered noise that follows the engine)
    const roar = noiseSource(), roarF = filter('bandpass', 1200, 1.5), roarG = gain(0);
    roar.connect(roarF).connect(roarG).connect(out);
    out.connect(master);
    // tyre screech, kerb rumble, grass rumble
    const screech = noiseSource(), screechF = filter('bandpass', 2300, 4), screechG = gain(0);
    screech.connect(screechF).connect(screechG).connect(master);
    const kerb = ctx.createOscillator(); kerb.type = 'square'; kerb.frequency.value = 38;
    const kerbF = filter('lowpass', 160), kerbG = gain(0);
    kerb.connect(kerbF).connect(kerbG).connect(master);
    const grass = noiseSource(), grassF = filter('lowpass', 300), grassG = gain(0);
    grass.connect(grassF).connect(grassG).connect(master);
    [tone1, tone2, tone3, whine, roar, screech, kerb, grass].forEach(n => n.start());
    engine = { out, tone1, tone2, tone3, whine, gw, lp, body, roarF, roarG, screechG, kerbG, grassG,
               nodes: [tone1, tone2, tone3, whine, roar, screech, kerb, grass], lastPop: 0, rpm: 0.3 };
  }

  // d: { rpm (0.3 idle .. 1 max), gear, shifted (+1 up / -1 down / 0), throttle, speedRatio, drifting, onGrass, onKerb }
  function updateEngine(d) {
    if (!engine) return;
    const e = engine;
    // A modern V6 turbo: about 4,000 - 12,500 rpm. Firing frequency = rpm / 60 * 3
    const rpmValue = 4000 + (d.rpm - 0.3) / 0.7 * 8500;
    const f = Math.max(60, rpmValue / 60 * 3);
    ramp(e.tone1.frequency, f, 0.02);
    ramp(e.tone2.frequency, f * 2, 0.02);
    ramp(e.tone3.frequency, f * 0.5, 0.02);
    ramp(e.whine.frequency, f * 4.6 + d.speedRatio * 600, 0.05);
    ramp(e.body.frequency, f * 2.2, 0.05);
    ramp(e.lp.frequency, 1200 + d.rpm * 6000 + (d.throttle ? 1500 : 0), 0.05);
    ramp(e.roarF.frequency, f * 3, 0.05);
    const load = d.throttle ? 1 : 0.45;
    ramp(e.out.gain, (0.05 + d.rpm * 0.14) * load + 0.02, 0.04);
    ramp(e.gw.gain, 0.012 + d.speedRatio * 0.02, 0.1);
    ramp(e.roarG.gain, d.throttle ? 0.05 * d.rpm : 0.005, 0.05);

    // Gear change: a tiny cut in sound and a pop (the pitch drop happens by itself as RPM falls)
    if (d.shifted) {
      e.out.gain.cancelScheduledValues(now());
      e.out.gain.setValueAtTime(e.out.gain.value * 0.35, now());
      e.out.gain.setTargetAtTime((0.05 + d.rpm * 0.14) * load, now() + 0.05, 0.03);
      burst(0.06, d.shifted > 0 ? 0.15 : 0.22, 'highpass', 1800);
    }
    // Crackles and pops when lifting off at high revs
    const t = performance.now();
    if (!d.throttle && d.rpm > 0.55 && t - e.lastPop > 60 && Math.random() < 0.25 * d.rpm) {
      e.lastPop = t;
      burst(0.03 + Math.random() * 0.04, 0.12 + Math.random() * 0.12, 'bandpass', 900 + Math.random() * 2500);
    }
    ramp(e.screechG.gain, d.drifting && d.speedRatio > 0.25 ? 0.06 + d.speedRatio * 0.05 : 0, 0.05);
    ramp(e.kerbG.gain, d.onKerb ? 0.12 : 0, 0.03);
    ramp(e.grassG.gain, d.onGrass && d.speedRatio > 0.05 ? 0.1 * Math.min(1, d.speedRatio * 3) : 0, 0.05);
  }

  function stopEngine() {
    if (!engine) return;
    const e = engine;
    ramp(e.out.gain, 0, 0.1);
    [e.screechG, e.kerbG, e.grassG].forEach(g => ramp(g.gain, 0, 0.05));
    setTimeout(() => e.nodes.forEach(n => { try { n.stop(); } catch (err) { /* already stopped */ } }), 400);
    engine = null;
  }

  /* ---------- Other cars' engines (the 4 nearest) ---------- */
  function makeVoice() {
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const lp = filter('lowpass', 2500), g = gain(0);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o1.connect(lp); o2.connect(lp);
    lp.connect(g);
    if (pan) g.connect(pan).connect(master); else g.connect(master);
    o1.start(); o2.start();
    return { o1, o2, lp, g, pan };
  }
  // list: [{ id, dist, pan (-1 left .. 1 right), rpm }]
  function updateOthers(list) {
    if (!ctx || !engine) return;
    while (others.length < 4) others.push(makeVoice());
    const near = list.filter(c => c.dist < 1100).sort((a, b) => a.dist - b.dist).slice(0, 4);
    others.forEach((v, k) => {
      const c = near[k];
      if (!c) { ramp(v.g.gain, 0, 0.1); return; }
      const f = (4000 + (c.rpm - 0.3) / 0.7 * 8500) / 60 * 3;
      ramp(v.o1.frequency, f, 0.05);
      ramp(v.o2.frequency, f * 2.01, 0.05);
      ramp(v.lp.frequency, 900 + c.rpm * 3500, 0.1);
      const loud = Math.pow(Math.max(0, 1 - c.dist / 1100), 2);
      ramp(v.g.gain, 0.09 * loud, 0.08);
      if (v.pan) ramp(v.pan.pan, Math.max(-1, Math.min(1, c.pan)), 0.08);
    });
  }

  /* ---------- Crowd ---------- */
  function ensureCrowd() {
    if (!ctx || crowd) return;
    const src = noiseSource();
    const f1 = filter('bandpass', 850, 0.7), f2 = filter('bandpass', 2400, 1.2);
    const g = gain(0), mod = gain(1);
    // a slow wobble so it sounds like many voices
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7;
    const lfoG = gain(0.35);
    lfo.connect(lfoG).connect(mod.gain);
    src.connect(f1).connect(mod); src.connect(f2).connect(mod);
    mod.connect(g).connect(master);
    src.start(); lfo.start();
    crowd = { src, lfo, g, level: 0 };
  }
  // level: 0 (no grandstand near) .. 1 (right next to a big one)
  function updateCrowd(level) {
    if (!ctx) return;
    ensureCrowd();
    cheerLevel *= 0.992;
    ramp(crowd.g.gain, 0.012 + level * 0.07 + cheerLevel * (0.04 + level * 0.12), 0.3);
  }
  function cheer(amount = 0.8) {
    cheerLevel = Math.min(1.5, cheerLevel + amount);
  }
  function stopWorld() {
    if (!ctx) return;
    others.forEach(v => ramp(v.g.gain, 0, 0.1));
    if (crowd) ramp(crowd.g.gain, 0, 0.3);
  }

  /* ---------- Sound effects ---------- */
  const countdown = () => tone(440, 0.25, 'square', 0.15);
  const go = () => tone(880, 0.6, 'square', 0.18);
  const lap = () => { tone(660, 0.12, 'triangle', 0.25); tone(990, 0.2, 'triangle', 0.25, 0.1); };
  const bestLap = () => { tone(660, 0.1, 'triangle', 0.25); tone(880, 0.1, 'triangle', 0.25, 0.1); tone(1320, 0.3, 'triangle', 0.25, 0.2); };
  const crash = strength => burst(0.25, Math.min(0.6, 0.15 + strength / 500), 'lowpass', 700);
  const bump = () => burst(0.12, 0.25, 'lowpass', 1200);
  const click = () => tone(1200, 0.05, 'square', 0.08);
  // Firework: a whoosh, then a bang and crackles
  const firework = () => {
    burst(0.5, 0.07, 'highpass', 2500);
    burst(0.45, 0.28, 'lowpass', 600, 0.25);
    for (let i = 0; i < 6; i++) burst(0.04, 0.08, 'bandpass', 2000 + Math.random() * 3000, 0.35 + Math.random() * 0.5);
  };
  const finish = () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.22, i * 0.13));
    cheer(1.2);
  };

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : volume;
    return muted;
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master && !muted) master.gain.value = volume;
  }

  return { init, startEngine, updateEngine, stopEngine, updateOthers, updateCrowd, cheer, stopWorld,
           countdown, go, lap, bestLap, crash, bump, click, finish, firework, toggleMute, setVolume };
})();
