/* =====================================================================
   E1 (EQUATION 1) - THE RACE (driving + drawing)
   ---------------------------------------------------------------------
   About 60 times every second this file:
     1. Moves YOUR car using the shared physics (so it reacts instantly).
     2. Sends your position to the server 20 times a second.
     3. Moves the OTHER cars smoothly between the updates from the server.
     4. Draws the track, skid marks, cars, name tags and effects.
   ===================================================================== */

const Game = (() => {
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  const STEP = 1 / 60;          // physics runs in fixed steps of 1/60 second
  const SEND_EVERY = 0.05;      // send my position every 0.05 s (20 times a second)
  const INTERP_DELAY = 150;     // show other cars 150 ms "in the past" so they move smoothly

  let track = null, trackPath = null, laps = 3;
  let myId = null, myCar = null;
  let players = new Map();      // everyone in the race (including me), by id
  let order = [];               // ids sorted by race position (from the server)
  let locked = true;            // true until the lights go green
  let running = false, rafId = 0, lastFrame = 0, accumulator = 0, sendClock = 0;
  let send = () => {}, serverNow = () => Date.now();
  let camera = { x: 0, y: 0 };
  let skids = [], particles = [], decor = [];
  let lastWallSound = 0;
  let me = { lap: 0, pos: 1, best: null, cur: null, curAt: 0, fin: false };
  let finishRemaining = null, finishAt = 0;
  let viewW = 0, viewH = 0, dpr = 1;
  let use3D = false;            // true = draw in 3D (render3d.js), false = old 2D view
  let showRacingLine = true;    // the green/yellow/red driving assist
  let raceTime = 0;             // seconds since this race screen started (for animations)
  let lastOvertake = new Map(); // "A>B" -> time, so the same overtake isn't announced twice
  let prevOrder = [];
  let goTime = 0;

  /* ---------------- Gearbox (8 gears) ----------------
     Works out the gear and engine speed (RPM) from the car's speed.
     Used for the steering wheel screen, the rev lights and the engine sound. */
  const GEARS = 8;
  const gearTop = n => Physics.TUNING.maxSpeed * (0.22 + 0.78 * Math.pow(n / GEARS, 0.9));
  function makeGearbox() { return { gear: 1, rpm: 0.3, shifted: 0 }; }
  function updateGearbox(gb, speed, throttle) {
    gb.shifted = 0;
    if (speed < -5) { gb.label = 'R'; gb.rpm = 0.3 + 0.5 * Math.min(1, -speed / Physics.TUNING.maxReverse); return gb; }
    if (gb.gear < GEARS && speed > gearTop(gb.gear) * 0.97) { gb.gear++; gb.shifted = 1; }
    else if (gb.gear > 1 && speed < gearTop(gb.gear - 1) * 0.8) { gb.gear--; gb.shifted = -1; }
    const ratio = Math.max(0, speed) / gearTop(gb.gear);
    const target = 0.3 + 0.7 * Math.min(1, ratio);
    gb.rpm += (target - gb.rpm) * 0.35;
    gb.label = Math.abs(speed) < 3 && !throttle ? 'N' : String(gb.gear);
    return gb;
  }
  let gearbox = makeGearbox();

  /* ---------------- Starting and stopping ---------------- */

  // opts: { trackId, laps, myId, players: [{id, name, colorHex, slot}], send, serverNow }
  function start(opts) {
    track = Tracks.get(opts.trackId);
    laps = opts.laps;
    myId = opts.myId;
    send = opts.send;
    serverNow = opts.serverNow;

    players = new Map();
    opts.players.forEach(p => {
      const g = Tracks.gridSlot(track, p.slot);
      players.set(p.id, {
        id: p.id, name: p.name, colorHex: p.colorHex,
        x: g.x, y: g.y, a: g.angle, vx: 0, vy: 0, d: false,
        buffer: [], lap: 0, pos: p.slot + 1, fin: false, lastRear: null,
        history: [], progress: 0, gearbox: makeGearbox(), speed: 0
      });
    });
    gearbox = makeGearbox();
    showRacingLine = opts.racingLine !== false;
    raceTime = 0;
    lastOvertake = new Map();
    prevOrder = [];
    goTime = 0;
    order = opts.players.slice().sort((a, b) => a.slot - b.slot).map(p => p.id);

    const mine = players.get(myId);
    myCar = Physics.createCar(mine.x, mine.y, mine.a);
    camera = { x: myCar.x, y: myCar.y };
    me = { lap: 0, pos: mine.pos, best: null, cur: null, curAt: 0, fin: false };
    finishRemaining = null;

    trackPath = new Path2D();
    track.path.forEach((p, i) => (i === 0 ? trackPath.moveTo(p.x, p.y) : trackPath.lineTo(p.x, p.y)));
    trackPath.closePath();

    decor = makeDecor(track);
    skids = [];
    particles = [];
    locked = true;

    // Try the 3D view first. If this device can't do 3D, use the 2D view.
    use3D = !!(window.Render3D && Render3D.start({
      canvas: document.getElementById('game-3d'), track, myId,
      players: opts.players, quality: opts.quality, timeOfDay: opts.timeOfDay
    }));
    document.getElementById('visor').classList.toggle('hidden', !use3D);
    canvas.classList.toggle('off', use3D);
    document.getElementById('game-3d').classList.toggle('off', !use3D);

    resize();
    Hud.setupMinimap(track);
    Hud.finishTimer(null);
    running = true;
    lastFrame = performance.now();
    accumulator = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
    Sound.startEngine();
  }

  function go() { locked = false; goTime = performance.now(); }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
    Sound.stopEngine();
    Sound.stopWorld();
    if (use3D) Render3D.stop();
  }

  // Make the crowd cheer (overtakes, finishes)
  function cheer(amount = 0.8) {
    if (use3D) Render3D.cheer(amount);
    Sound.cheer(amount);
  }

  // Start lights on the 3D gantry (the on-screen lights are handled by hud.js)
  function setLights(n) { if (use3D) Render3D.setLights(n); }

  /* ---------------- Messages from the server ---------------- */

  // The official race state, 20 times a second
  function onState(state) {
    state.players.forEach(sp => {
      const p = players.get(sp.id);
      if (!p) return;
      p.lap = sp.lap; p.pos = sp.pos; p.fin = sp.fin;
      if (sp.id === myId) {
        me.lap = sp.lap; me.pos = sp.pos; me.best = sp.best; me.fin = sp.fin;
        me.cur = sp.cur; me.curAt = performance.now();
      } else {
        // Save this position so we can glide smoothly between updates
        const last = p.buffer[p.buffer.length - 1];
        if (!last || sp.ts > last.t) {
          p.buffer.push({ t: sp.ts, x: sp.x, y: sp.y, a: sp.a, vx: sp.vx, vy: sp.vy, d: sp.d });
          if (p.buffer.length > 40) p.buffer.shift();
        }
      }
    });
    order = state.players.map(sp => sp.id).filter(id => players.has(id));
    finishRemaining = state.remaining;
    finishAt = performance.now();

    // How far round the race each car is (laps + part of a lap), remembered over time
    // so we can tell the gap in seconds to the car ahead
    const now = performance.now();
    state.players.forEach(sp => {
      const p = players.get(sp.id);
      if (!p) return;
      const x = sp.id === myId ? myCar.x : sp.x, y = sp.id === myId ? myCar.y : sp.y;
      const near = Tracks.nearest(track, x, y, p.trackHint);
      let s = near.s;
      p.trackHint = near.index;
      if (sp.cp === 0 && s > 0.8) s -= 1;                         // still before the line
      if (sp.cp >= track.checkpoints - 1 && s < 0.2) s += 1;      // crossed the line, lap not counted yet
      p.progress = sp.lap + s;
      p.history.push([p.progress, now]);
      while (p.history.length > 2 && now - p.history[0][1] > 180000) p.history.shift();
    });

    // Timing tower rows: position, name, gap to the car ahead
    const rows = order.map((id, i) => {
      const p = players.get(id);
      let gap = '';
      if (p.fin) gap = 'FIN';
      else if (i === 0) gap = 'LEADER';
      else {
        const ahead = players.get(order[i - 1]);
        const t = timeAt(ahead, p.progress);
        if (t !== null) gap = '+' + Math.max(0, (now - t) / 1000).toFixed(1) + 's';
        else gap = '+' + Math.max(0, ahead.progress - p.progress).toFixed(1) + ' L';
      }
      return { id, name: p.name, colorHex: p.colorHex, gap, fin: p.fin };
    });
    Hud.updateTower(rows, myId);

    // Overtakes: a car that was behind is now directly in front
    if (goTime && now - goTime > 4000 && prevOrder.length) {
      for (let i = 0; i < order.length - 1; i++) {
        const a = order[i], b = order[i + 1];
        const pa = players.get(a), pb = players.get(b);
        if (pa.fin || pb.fin) continue;
        if (prevOrder.indexOf(a) > prevOrder.indexOf(b) && prevOrder.indexOf(b) >= 0) {
          const key = a + '>' + b, back = b + '>' + a;
          if (now - (lastOvertake.get(key) || 0) > 5000 && now - (lastOvertake.get(back) || 0) > 3000) {
            Hud.overtake(`${pa.name} overtakes ${pb.name} for P${i + 1}`, a === myId || b === myId);
            cheer(a === myId ? 1 : 0.6);
          }
          lastOvertake.set(key, now);
        }
      }
    }
    prevOrder = order.slice();
  }

  // When was this car at a given race progress? (searching its history)
  function timeAt(p, progress) {
    const h = p.history;
    for (let k = h.length - 1; k > 0; k--) {
      if (h[k - 1][0] <= progress && h[k][0] >= progress) {
        const t = (progress - h[k - 1][0]) / ((h[k][0] - h[k - 1][0]) || 1);
        return h[k - 1][1] + (h[k][1] - h[k - 1][1]) * t;
      }
    }
    return null;
  }

  function removePlayer(id) {
    players.delete(id);
    order = order.filter(o => o !== id);
    if (use3D) Render3D.removeCar(id);
  }

  // The server says my car jumped too far - put it back
  function correct(pos) {
    if (!myCar) return;
    myCar.x = pos.x; myCar.y = pos.y; myCar.angle = pos.a;
    myCar.vx = 0; myCar.vy = 0; myCar.hint = -1;
  }

  /* ---------------- Smooth movement for other cars ---------------- */

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function interpolate(p) {
    const buf = p.buffer;
    if (buf.length === 0) return; // still on the grid
    const t = serverNow() - INTERP_DELAY;
    while (buf.length > 2 && buf[1].t <= t) buf.shift(); // forget old positions

    const a = buf[0], b = buf[1];
    if (b && t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      p.x = a.x + (b.x - a.x) * k;
      p.y = a.y + (b.y - a.y) * k;
      p.a = lerpAngle(a.a, b.a, k);
      p.vx = b.vx; p.vy = b.vy; p.d = b.d;
    } else {
      // No newer position yet: keep moving the way it was going (only a little)
      const last = buf[buf.length - 1];
      const ahead = Math.max(0, Math.min(0.12, (t - last.t) / 1000));
      p.x = last.x + last.vx * ahead;
      p.y = last.y + last.vy * ahead;
      p.a = last.a; p.vx = last.vx; p.vy = last.vy; p.d = last.d;
    }
  }

  /* ---------------- The main loop (runs every frame) ---------------- */

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min((now - lastFrame) / 1000, 0.25);
    lastFrame = now;

    // Other cars first, so my car can bump into them
    players.forEach(p => { if (p.id !== myId) interpolate(p); });

    // Move my car in fixed small steps (keeps physics the same on every computer)
    const input = locked ? { up: false, down: false, left: false, right: false } : Input.state;
    accumulator += dt;
    let strongestBump = 0, strongestWall = 0;
    while (accumulator >= STEP) {
      Physics.step(myCar, input, STEP, track);
      strongestWall = Math.max(strongestWall, myCar.wallHit);
      players.forEach(p => {
        if (p.id !== myId) strongestBump = Math.max(strongestBump, Physics.bump(myCar, p));
      });
      accumulator -= STEP;
    }
    const mine = players.get(myId);
    if (mine) { mine.x = myCar.x; mine.y = myCar.y; mine.a = myCar.angle; mine.d = myCar.drifting; }

    // Crash effects
    if (strongestWall > 90 && now - lastWallSound > 200) {
      Sound.crash(strongestWall);
      lastWallSound = now;
      sparks(myCar.x + Math.cos(myCar.angle) * 18, myCar.y + Math.sin(myCar.angle) * 18, 12);
    }
    if (strongestBump > 40) { Sound.bump(); sparks(myCar.x, myCar.y, 6); }

    // Send my position to the server
    sendClock += dt;
    if (sendClock >= SEND_EVERY) {
      sendClock = 0;
      if (!locked) {
        send({ x: myCar.x, y: myCar.y, a: myCar.angle, vx: myCar.vx, vy: myCar.vy, d: myCar.drifting });
      }
    }

    updateEffects(dt);

    // Camera follows my car, looking a little ahead
    const k = 1 - Math.exp(-6 * dt);
    camera.x += (myCar.x + myCar.vx * 0.3 - camera.x) * k;
    camera.y += (myCar.y + myCar.vy * 0.3 - camera.y) * k;

    const speedRatio = myCar.speed / Physics.TUNING.maxSpeed;
    raceTime += dt;

    // Gearbox and engine sound
    updateGearbox(gearbox, myCar.speed, input.up);
    const onKerb = myCar.surface === 'road' && Math.abs((myCar.trackDist || 0) - track.halfWidth) < 12 && Math.abs(myCar.speed) > 80;
    Sound.updateEngine({
      rpm: gearbox.rpm, gear: gearbox.gear, shifted: gearbox.shifted, throttle: input.up && !locked,
      speedRatio, drifting: myCar.drifting, onGrass: myCar.surface === 'grass', onKerb
    });

    // Other cars: estimate their speed and engine RPM, so they can be heard (louder when close)
    const others = [];
    players.forEach(p => {
      if (p.id === myId) return;
      const sp = Math.hypot(p.vx || 0, p.vy || 0);
      p.speed = sp;
      updateGearbox(p.gearbox, sp, true);
      const dx = p.x - myCar.x, dy = p.y - myCar.y;
      const dist = Math.hypot(dx, dy);
      // left/right: + means the car is on my right
      const pan = dist > 1 ? ((-Math.sin(myCar.angle) * dx + Math.cos(myCar.angle) * dy) / dist) : 0;
      others.push({ id: p.id, dist, pan, rpm: p.gearbox.rpm, speed: sp });
    });
    Sound.updateOthers(others);
    if (use3D) Sound.updateCrowd(Render3D.crowdLevel(myCar.x, myCar.y));

    if (use3D) {
      Render3D.frame({
        dt, time: raceTime,
        me: {
          x: myCar.x, y: myCar.y, a: myCar.angle, speed: myCar.speed, speedRatio,
          steer: (input.right ? 1 : 0) - (input.left ? 1 : 0),
          wallHit: strongestWall, bump: strongestBump,
          onGrass: myCar.surface === 'grass' && Math.abs(myCar.speed) > 40,
          trackIndex: Math.max(0, myCar.hint), trackDist: myCar.trackDist || 0,
          gear: gearbox.label, rpm: gearbox.rpm, kmh: Math.round(Math.abs(myCar.speed) * 0.6),
          lap: me.lap + 1, laps, pos: me.pos, total: players.size
        },
        cars: [...players.values()].map(p => ({ id: p.id, x: p.x, y: p.y, a: p.a })),
        leaderId: order[0],
        racingLine: showRacingLine
      });
    } else {
      render(speedRatio);
    }
    updateHud(now);
  }

  function updateHud(now) {
    const lapTime = me.cur === null ? (locked ? 0 : null) : me.cur + (now - me.curAt);
    Hud.updateInfo({
      lap: me.lap + 1, laps,
      pos: me.pos, total: players.size,
      lapTime: me.fin ? null : lapTime,
      best: me.best,
      speedKmh: Math.round(Math.abs(myCar.speed) * 0.6),
      gear: gearbox.label
    });
    Hud.finishTimer(finishRemaining === null ? null : Math.max(0, finishRemaining - (now - finishAt)));
    Hud.drawMinimap([...players.values()].map(p => ({ x: p.x, y: p.y, colorHex: p.colorHex, me: p.id === myId })));
  }

  /* ---------------- Visual effects ---------------- */

  function rearWheels(x, y, a) {
    const bx = x - Math.cos(a) * 13, by = y - Math.sin(a) * 13;
    const sx = -Math.sin(a) * 9, sy = Math.cos(a) * 9;
    return [{ x: bx + sx, y: by + sy }, { x: bx - sx, y: by - sy }];
  }

  function updateEffects(dt) {
    // Skid marks for every car that's sliding
    players.forEach(p => {
      const wheels = rearWheels(p.x, p.y, p.a);
      if (p.d && p.lastRear) {
        for (let i = 0; i < 2; i++)
          skids.push({ x1: p.lastRear[i].x, y1: p.lastRear[i].y, x2: wheels[i].x, y2: wheels[i].y });
      }
      p.lastRear = wheels;
    });
    if (skids.length > 1600) skids.splice(0, skids.length - 1600);

    // Dust when my car drives on grass/sand
    if (myCar.surface === 'grass' && Math.abs(myCar.speed) > 60 && Math.random() < 0.7) {
      const w = rearWheels(myCar.x, myCar.y, myCar.angle)[Math.random() < 0.5 ? 0 : 1];
      particles.push({
        x: w.x, y: w.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
        life: 0.7, max: 0.7, size: 5 + Math.random() * 6, color: track.theme.runoff, grow: true
      });
    }

    particles.forEach(p => {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
      p.life -= dt;
    });
    particles = particles.filter(p => p.life > 0);
  }

  function sparks(x, y, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 220;
      particles.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 0.35, max: 0.35, size: 2 + Math.random() * 2,
        color: Math.random() < 0.5 ? '#ffd54f' : '#ff8f00', grow: false
      });
    }
  }

  // Trees, buildings or cacti around the track (same every time for each track)
  function makeDecor(track) {
    let seed = 12345 + track.id * 777;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const items = [];
    const kind = track.theme.decor;
    const wanted = Math.min(420, Math.floor(track.width * track.height / (kind === 'buildings' ? 70000 : 45000)));
    for (let tries = 0; tries < wanted * 4 && items.length < wanted; tries++) {
      const x = rand() * track.width, y = rand() * track.height;
      const size = kind === 'buildings' ? 50 + rand() * 70 : 14 + rand() * 18;
      const clear = track.halfWidth + track.runoff + 25 + size * (kind === 'buildings' ? 0.75 : 1);
      if (Tracks.nearest(track, x, y).dist < clear) continue;
      items.push({ x, y, size, r: rand(), h: 0.6 + rand() * 0.8 });
    }
    return items;
  }

  /* ---------------- Drawing ---------------- */

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = canvas.clientWidth || window.innerWidth;
    viewH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
  }
  window.addEventListener('resize', () => { if (running) resize(); });

  function render(speedRatio) {
    if (canvas.clientWidth !== viewW || canvas.clientHeight !== viewH) resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = track.theme.bg;
    ctx.fillRect(0, 0, viewW, viewH);

    // Zoom: further out on small screens and at high speed
    let zoom = Math.max(0.5, Math.min(1.1, Math.min(viewW, viewH) / 750));
    zoom *= 1 - 0.12 * Math.min(1, Math.abs(speedRatio));

    ctx.save();
    ctx.translate(viewW / 2, viewH / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camera.x, -camera.y);
    const view = {
      x0: camera.x - viewW / 2 / zoom - 150, x1: camera.x + viewW / 2 / zoom + 150,
      y0: camera.y - viewH / 2 / zoom - 150, y1: camera.y + viewH / 2 / zoom + 150
    };

    drawTrack();
    drawSkids();
    drawParticles(true);
    // Cars: others first, then mine on top
    players.forEach(p => { if (p.id !== myId) drawCar(p.x, p.y, p.a, p.colorHex); });
    drawCar(myCar.x, myCar.y, myCar.angle, players.get(myId).colorHex);
    drawDecor(view);
    drawParticles(false);
    players.forEach(p => drawNameTag(p, p.id === myId));
    ctx.restore();
  }

  function drawTrack() {
    const hw = track.halfWidth, outer = (hw + track.runoff) * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Barrier (red and white stripes)
    ctx.lineWidth = outer + 16;
    ctx.strokeStyle = '#eeeeee';
    ctx.stroke(trackPath);
    ctx.setLineDash([40, 40]);
    ctx.strokeStyle = '#d32f2f';
    ctx.stroke(trackPath);
    ctx.setLineDash([]);

    // Grass / sand run-off area (slow!)
    ctx.lineWidth = outer;
    ctx.strokeStyle = track.theme.runoff;
    ctx.stroke(trackPath);

    // Kerbs (red and white edges of the road)
    ctx.lineWidth = hw * 2 + 12;
    ctx.strokeStyle = '#f5f5f5';
    ctx.stroke(trackPath);
    ctx.setLineDash([22, 22]);
    ctx.strokeStyle = '#e53935';
    ctx.stroke(trackPath);
    ctx.setLineDash([]);

    // The road itself
    ctx.lineWidth = hw * 2;
    ctx.strokeStyle = track.theme.road;
    ctx.stroke(trackPath);

    // Dashed centre line
    ctx.lineWidth = 3;
    ctx.setLineDash([40, 60]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke(trackPath);
    ctx.setLineDash([]);

    // Checkpoints (faint lines across the road)
    for (let k = 1; k < track.checkpoints; k++) {
      const p = Tracks.pointAt(track, (k / track.checkpoints) * track.length);
      acrossRoad(p, () => {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(-3, -hw, 6, hw * 2);
      });
    }

    // Starting grid boxes
    for (let s = 0; s < 10; s++) {
      const g = Tracks.gridSlot(track, s);
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6, -14); ctx.lineTo(24, -14); ctx.lineTo(24, 14); ctx.lineTo(-6, 14);
      ctx.stroke();
      ctx.restore();
    }

    // Start / finish line (black and white chequers)
    acrossRoad(Tracks.pointAt(track, 0), () => {
      const sq = 10;
      for (let col = 0; col < 2; col++) {
        for (let row = 0; row * sq < hw * 2; row++) {
          ctx.fillStyle = (row + col) % 2 ? '#111' : '#fff';
          ctx.fillRect(-sq + col * sq, -hw + row * sq, sq, Math.min(sq, hw * 2 - row * sq));
        }
      }
    });
  }

  // Helper: draw something lined up across the road at point p
  function acrossRoad(p, draw) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    draw();
    ctx.restore();
  }

  function drawSkids() {
    if (!skids.length) return;
    ctx.strokeStyle = 'rgba(15,15,15,0.35)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    skids.forEach(s => { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); });
    ctx.stroke();
  }

  function drawParticles(dust) {
    particles.forEach(p => {
      if (p.grow !== dust) return;
      const life = p.life / p.max;
      ctx.globalAlpha = dust ? life * 0.6 : life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, dust ? p.size * (1.8 - life) : p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawDecor(view) {
    const kind = track.theme.decor;
    decor.forEach(d => {
      if (d.x < view.x0 || d.x > view.x1 || d.y < view.y0 || d.y > view.y1) return;
      const s = d.size;
      if (kind === 'buildings') {
        const w = s, h = s * d.h;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(d.x - w / 2 + 10, d.y - h / 2 + 10, w, h);         // shadow
        ctx.fillStyle = ['#6d7480', '#7d6a5a', '#5b6a7a', '#8a8f99'][Math.floor(d.r * 4)];
        ctx.fillRect(d.x - w / 2, d.y - h / 2, w, h);                    // roof
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(d.x - w / 2 + 8, d.y - h / 2 + 8, w - 16, h - 16);  // roof detail
      } else if (kind === 'cacti') {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.ellipse(d.x + 6, d.y + 6, s * 0.6, s * 0.35, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = d.r < 0.3 ? '#a08060' : '#4f8a3a'; // some are rocks, some cacti
        ctx.beginPath(); ctx.arc(d.x, d.y, s * 0.45, 0, Math.PI * 2); ctx.fill();
        if (d.r >= 0.3) {
          ctx.fillRect(d.x - s * 0.7, d.y - 3, s * 1.4, 6);
          ctx.fillStyle = '#6fae55';
          ctx.beginPath(); ctx.arc(d.x - 2, d.y - 2, s * 0.2, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        // trees and pines: round shadow + leafy top
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.arc(d.x + 7, d.y + 7, s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = kind === 'pines' ? '#163d1f' : '#25632b';
        ctx.beginPath(); ctx.arc(d.x, d.y, s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = kind === 'pines' ? '#245a30' : '#3b8a3e';
        ctx.beginPath(); ctx.arc(d.x - s * 0.25, d.y - s * 0.25, s * 0.55, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  // A small open-wheel race car seen from above. Facing right (+x) before rotating.
  function drawCar(x, y, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const outline = color === '#212121' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)';

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-19, -9, 40, 22);

    // Tyres
    ctx.fillStyle = '#111';
    ctx.fillRect(-17, -12, 11, 6); ctx.fillRect(-17, 6, 11, 6);   // rear
    ctx.fillRect(9, -11, 8, 5);    ctx.fillRect(9, 6, 8, 5);      // front

    // Rear wing
    ctx.fillStyle = '#222';
    ctx.fillRect(-21, -10, 5, 20);

    // Body
    ctx.fillStyle = color;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-17, -5);
    ctx.lineTo(-4, -7);   // side pod
    ctx.lineTo(5, -7);
    ctx.lineTo(8, -3);
    ctx.lineTo(21, -1.5); // nose
    ctx.lineTo(21, 1.5);
    ctx.lineTo(8, 3);
    ctx.lineTo(5, 7);
    ctx.lineTo(-4, 7);
    ctx.lineTo(-17, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Front wing
    ctx.fillRect(18, -11, 4, 22);
    ctx.strokeRect(18, -11, 4, 22);

    // Cockpit and helmet
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.ellipse(-2, 0, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd400';
    ctx.beginPath(); ctx.arc(-2.5, 0, 2.6, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function drawNameTag(p, isMe) {
    ctx.font = 'bold 13px Inter, Arial, sans-serif';
    const text = p.name;
    const w = ctx.measureText(text).width + 12;
    const x = p.x - w / 2, y = p.y - 42;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(x, y, w, 19, 5);
    ctx.fill();
    ctx.strokeStyle = isMe ? '#ffcc00' : p.colorHex;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, p.x, y + 10);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { start, go, stop, onState, removePlayer, correct, setLights, cheer };
})();
