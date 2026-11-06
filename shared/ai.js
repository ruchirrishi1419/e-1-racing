/* =====================================================================
   E1 (EQUATION 1) - AI DRIVERS (computer-controlled cars)
   ---------------------------------------------------------------------
   Every AI car has its OWN brain with its own personality:
     skill        how fast it is overall
     aggression   how hard it attacks and defends, how late it brakes when overtaking
     consistency  how often it makes mistakes (lower = more mistakes)
     style        its favourite line on the track (wide or tight)

   What it does every frame (it "presses" the same controls as a human):
     1. Drives its own line: the racing line plus its own offset that keeps
        changing - it does NOT stick exactly to the racing line.
     2. Looks at the cars around it:
          - car just ahead  -> slipstream on straights, then pull out and
                               attack, usually up the inside of the next corner,
                               braking later than normal
          - car close behind -> defend: cover the inside before corners
          - car right alongside -> give it room (no driving into each other)
     3. Brakes for corners at its own braking points.
     4. Sometimes makes mistakes (brakes too late, runs wide).
     5. LEARNS: if it runs wide or hits a wall in a part of the track, it brakes
        a little earlier there next time; where it gets through cleanly it pushes
        a little harder. What it learns about each track is shared by all AI
        drivers and kept while the game is open, so they get faster the more
        you race a track.
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracks'), require('./physics'), require('./racingline'));
  else root.AI = factory(root.Tracks, root.Physics, root.RacingLine);
})(typeof self !== 'undefined' ? self : this, function (Tracks, Physics, RacingLine) {
  'use strict';

  const SEG = 25;   // the track is split into pieces of 25 racing-line points for learning

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------- Track experience (learned while racing, per track) ---------- */
  const experience = new Map();   // track id -> Float32Array of speed factors per piece
  function memoryFor(track, line) {
    if (!experience.has(track.id)) experience.set(track.id, new Float32Array(Math.ceil(line.n / SEG)).fill(1));
    return experience.get(track.id);
  }

  // skill: 0.8 (slow) to 1.0 (fast).  lane: -1 .. 1 favourite side of its line
  function createBrain(skill, lane) {
    const r = Math.random;
    return {
      skill,
      lane: lane === undefined ? r() * 2 - 1 : lane,
      aggression: 0.3 + r() * 0.7,
      consistency: 0.75 + r() * 0.25,
      style: (r() - 0.5) * 0.5,          // + = wider lines, - = tighter
      brakeBias: 0.97 + r() * 0.05,      // own braking points
      off: 0, offTarget: 0,              // current / wanted sideways offset from the racing line
      wander: r() * 100,
      plan: null, planUntil: 0,          // 'attack' / 'defend' with a chosen side
      mistakeUntil: 0, mistakeKind: null,
      time: 0, stuckTime: 0, reverseTime: 0,
      lastSeg: -1, segBad: false
    };
  }

  // others: [{ x, y, vx, vy }] = the other cars (AI and humans)
  function drive(car, track, brain, dt, others) {
    const input = { up: false, down: false, left: false, right: false, steer: 0, throttle: 0, brake: 0 };
    brain.time += dt;

    // Stuck against a barrier? Back up for a moment.
    if (brain.reverseTime > 0) {
      brain.reverseTime -= dt;
      input.down = true; input.brake = 1;
      return input;
    }
    if (Math.abs(car.speed) < 25) brain.stuckTime += dt; else brain.stuckTime = 0;
    if (brain.stuckTime > 1.5) { brain.stuckTime = 0; brain.reverseTime = 0.8; }

    const line = RacingLine.get(track);
    const mem = memoryFor(track, line);
    const near = Tracks.nearest(track, car.x, car.y, car.hint);
    const speed = Math.max(0, car.speed);
    const here = RacingLine.indexFor(line, near.index);
    const hw = track.halfWidth;
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);

    // How sharp is the next corner, and which way does it turn? (+ = right)
    const p1 = (here + 4) % line.n, p2 = (here + 16) % line.n;
    const a1 = Math.atan2(line.y[(p1 + 1) % line.n] - line.y[p1], line.x[(p1 + 1) % line.n] - line.x[p1]);
    const a2 = Math.atan2(line.y[(p2 + 1) % line.n] - line.y[p2], line.x[(p2 + 1) % line.n] - line.x[p2]);
    const turnAhead = angleDiff(a2, a1);
    const onStraight = Math.abs(turnAhead) < 0.12;

    /* ---- 1. look at the other cars ---- */
    let ahead = null, behind = null, beside = null;
    for (const o of (others || [])) {
      const dx = o.x - car.x, dy = o.y - car.y;
      const along = dx * fx + dy * fy, side = -dx * fy + dy * fx;   // + side = to my right
      if (along > 0 && along < 150 && Math.abs(side) < 30 && (!ahead || along < ahead.along)) ahead = { along, side, o };
      if (along < 0 && along > -110 && Math.abs(side) < 30 && (!behind || along > behind.along)) behind = { along, side, o };
      if (Math.abs(along) < 34 && Math.abs(side) < 26 && (!beside || Math.abs(side) < Math.abs(beside.side))) beside = { along, side, o };
    }

    // decide a plan (kept for a little while so it doesn't change its mind every frame)
    if (brain.time > brain.planUntil) brain.plan = null;
    if (!brain.plan && ahead) {
      const theirSpeed = Math.hypot(ahead.o.vx || 0, ahead.o.vy || 0);
      if (ahead.along < 110 && speed >= theirSpeed - 10 && Math.random() < 0.02 + brain.aggression * 0.05) {
        // attack: usually the inside of the next corner, otherwise the side with more room
        let side = Math.abs(turnAhead) > 0.15 ? Math.sign(turnAhead) : (ahead.side > 0 ? -1 : 1);
        if (Math.random() < 0.25) side = -side;   // sometimes a surprise move round the outside
        brain.plan = { kind: 'attack', side };
        brain.planUntil = brain.time + 2.5 + Math.random() * 2;
      }
    }
    if (!brain.plan && behind && behind.along > -60 && !onStraight && Math.random() < brain.aggression * 0.04) {
      // defend: cover the inside of the coming corner
      brain.plan = { kind: 'defend', side: Math.sign(turnAhead) || 1 };
      brain.planUntil = brain.time + 1.5 + Math.random();
    }

    /* ---- 2. choose where on the road to be ---- */
    brain.wander += dt * (0.15 + brain.aggression * 0.2);
    let off = (brain.lane * 0.35 + Math.sin(brain.wander) * 0.3) * hw * 0.5;   // its own changing line
    off += brain.style * hw * 0.4 * Math.sign(turnAhead) * -1;                   // wide or tight style
    if (brain.plan && brain.plan.kind === 'attack') off = brain.plan.side * hw * 0.5;
    if (brain.plan && brain.plan.kind === 'defend') off = brain.plan.side * hw * 0.5;
    if (ahead && !brain.plan && ahead.along < 70 && onStraight) off = brain.off + ahead.side * 0.6;   // tuck in behind it (slipstream)
    // give a car alongside some room
    if (beside) off += (beside.side > 0 ? -1 : 1) * Math.max(0, 26 - Math.abs(beside.side)) * 1.2;
    brain.offTarget = clamp(off, -(hw - 20), hw - 20);
    // the line changes smoothly (like turning the steering wheel gently)
    const rate = (brain.plan ? 70 : 35) * dt;
    brain.off += clamp(brain.offTarget - brain.off, -rate, rate);

    /* ---- 3. steer towards a point ahead on its own line ---- */
    const ai = (here + 3 + Math.round(speed * 0.006)) % line.n, an = (ai + 1) % line.n;
    const tx0 = line.x[an] - line.x[ai], ty0 = line.y[an] - line.y[ai], tl = Math.hypot(tx0, ty0) || 1;
    const tx = line.x[ai] - (ty0 / tl) * brain.off, ty = line.y[ai] + (tx0 / tl) * brain.off;
    const steer = angleDiff(Math.atan2(ty - car.y, tx - car.x), car.angle);
    input.steer = clamp(steer * 3.2, -1, 1);
    input.left = input.steer < -0.3; input.right = input.steer > 0.3;

    /* ---- 4. speed: corner limits x skill x what it has learned x the situation ---- */
    let target = Infinity;
    const look = 2 + Math.round(speed * 0.012);
    for (let k = 1; k <= look; k++) {
      const j = (here + k) % line.n;
      target = Math.min(target, line.speed[j] * mem[Math.floor(j / SEG)]);
    }
    target *= brain.skill * brain.brakeBias;
    if (Math.abs(brain.off) > hw * 0.35) target *= 0.985;                 // off the ideal line = a bit slower
    if (brain.plan && brain.plan.kind === 'attack') target *= 1 + brain.aggression * 0.05;   // brakes later to overtake
    if (ahead && ahead.along < 90 && onStraight) target *= 1.03;          // slipstream (tow) on straights
    if (beside && Math.abs(beside.side) < 16 && beside.along > 0) target *= 0.97;  // a car is half in front: ease off

    // mistakes: now and then brakes too late into a corner and runs wide
    if (brain.time > brain.mistakeUntil && !onStraight && Math.random() < (1 - brain.consistency) * 0.006) {
      brain.mistakeUntil = brain.time + 0.8 + Math.random() * 0.8;
      brain.mistakeKind = Math.random() < 0.6 ? 'late' : 'wide';
    }
    if (brain.time < brain.mistakeUntil) {
      if (brain.mistakeKind === 'late') target *= 1.12;
      else brain.off += (Math.sign(brain.off) || 1) * 25 * dt;
    }

    if (speed < target) { input.up = true; input.throttle = 1; }
    else if (speed > target + 25) { input.down = true; input.brake = clamp((speed - target) / 80, 0.4, 1); }

    /* ---- 5. learn from this piece of track ---- */
    const seg = Math.floor(here / SEG);
    if (car.surface === 'grass' || car.wallHit > 40) brain.segBad = true;
    if (seg !== brain.lastSeg) {
      if (brain.lastSeg >= 0 && brain.time > brain.mistakeUntil + 1) {
        const m = memoryFor(track, line);
        if (brain.segBad) {
          // went off or hit something here: brake a bit earlier here next time (the piece before too)
          m[brain.lastSeg] = Math.max(0.82, m[brain.lastSeg] - 0.03);
          const prev = (brain.lastSeg - 1 + m.length) % m.length;
          m[prev] = Math.max(0.82, m[prev] - 0.015);
        } else {
          m[brain.lastSeg] = Math.min(1.06, m[brain.lastSeg] + 0.004);   // clean: push a little harder
        }
      }
      brain.lastSeg = seg; brain.segBad = false;
    }
    return input;
  }

  return { createBrain, drive };
});
