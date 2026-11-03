/* =====================================================================
   E1 (EQUATION 1) - RACING LINE  (shared: used by the AI cars and the
   on-screen driving assist)
   ---------------------------------------------------------------------
   1. Find the best path: start on the centre line and keep pulling each
      point towards the middle of its neighbours (that straightens the path
      and makes it use the whole width of the road: outside - apex - outside).
   2. Work out the top speed at every point: tight bends = slow, straights =
      flat out. Then go backwards to find where you must start braking.
   3. Colors for the driving assist: GREEN = accelerate, YELLOW = lift off,
      RED = brake. If you are going too fast, red appears earlier.
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracks'), require('./physics'));
  else root.RacingLine = factory(root.Tracks, root.Physics);
})(typeof self !== 'undefined' ? self : this, function (Tracks, Physics) {
  'use strict';

  const STEP = 4;           // use every 4th centre-line point (about 40 units apart)
  const BRAKE = 800;        // how hard a car can brake (units per second, per second)
  const ACCEL = 360;        // how fast a car speeds up

  // Build (once) and return the racing line for a track
  function get(track) {
    if (track.racingLine) return track.racingLine;
    const P = track.path, n = Math.floor(P.length / STEP);
    const lim = track.halfWidth - 16;   // stay a little inside the white lines
    const cx = [], cy = [], nx = [], ny = [], off = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = P[(i * STEP - 1 + P.length) % P.length], b = P[(i * STEP + 1) % P.length], p = P[i * STEP];
      const tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty) || 1;
      cx.push(p.x); cy.push(p.y); nx.push(-ty / len); ny.push(tx / len);
    }
    const X = i => cx[i] + nx[i] * off[i], Y = i => cy[i] + ny[i] * off[i];

    // 1. Smooth the path inside the road edges
    for (let iter = 0; iter < 400; iter++) {
      for (let i = 0; i < n; i++) {
        const a = (i - 1 + n) % n, b = (i + 1) % n;
        const mx = (X(a) + X(b)) / 2, my = (Y(a) + Y(b)) / 2;
        const o = (mx - cx[i]) * nx[i] + (my - cy[i]) * ny[i];
        off[i] = Math.max(-lim, Math.min(lim, off[i] + (o - off[i]) * 0.9));
      }
    }
    const x = [], y = [];
    for (let i = 0; i < n; i++) { x.push(X(i)); y.push(Y(i)); }

    // 2. Speed limit from how tight the path bends (curvature = 1 / radius)
    const T = Physics.TUNING;
    const speed = new Float64Array(n), ds = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i + 2) % n;
      const ax = x[a], ay = y[a], bx = x[i], by = y[i], qx = x[b], qy = y[b];
      const A = Math.hypot(bx - ax, by - ay), B = Math.hypot(qx - bx, qy - by), C = Math.hypot(qx - ax, qy - ay);
      const area2 = Math.abs((bx - ax) * (qy - ay) - (by - ay) * (qx - ax));
      const curv = (2 * area2) / Math.max(1e-6, A * B * C);
      // the car can turn at most min(turnRate, lateralGrip / speed) radians per second,
      // so the fastest speed that can follow this bend is:
      speed[i] = Math.min(T.maxSpeed, Math.sqrt(0.8 * T.lateralGrip / Math.max(curv, 1e-6)), 0.8 * T.turnRate / Math.max(curv, 1e-6));
      ds[i] = Math.hypot(x[(i + 1) % n] - x[i], y[(i + 1) % n] - y[i]);
    }
    // braking zones (work backwards) and acceleration (work forwards), twice round
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 2 * n; k > 0; k--) {
        const i = k % n, j = (i + 1) % n;
        speed[i] = Math.min(speed[i], Math.sqrt(speed[j] * speed[j] + 2 * BRAKE * ds[i]));
      }
      for (let k = 1; k <= 2 * n; k++) {
        const i = k % n, j = (i - 1 + n) % n;
        speed[i] = Math.min(speed[i], Math.sqrt(speed[j] * speed[j] + 2 * ACCEL * ds[j]));
      }
    }

    track.racingLine = { n, step: STEP, x, y, speed, ds };
    return track.racingLine;
  }

  // Which racing-line point belongs to a track index (the car's "hint")
  function indexFor(line, trackIndex) {
    return Math.floor(Math.max(0, trackIndex) / line.step) % line.n;
  }

  /* Colors for the next "count" points ahead of the car.
     Returns an array of 0 = green (accelerate), 1 = yellow (lift), 2 = red (brake). */
  function colors(line, startIndex, carSpeed, count) {
    const out = new Uint8Array(count);
    const v = Math.max(0, carSpeed);
    let dist = 0;
    for (let k = 0; k < count; k++) {
      const i = (startIndex + k) % line.n, j = (i + 1) % line.n;
      // what the ideal lap does here: slowing down hard = red, a little = yellow
      const decel = (line.speed[i] * line.speed[i] - line.speed[j] * line.speed[j]) / (2 * Math.max(1, line.ds[i]));
      let c = decel > 450 ? 2 : decel > 60 ? 1 : 0;
      // and if I'm going faster than this point allows, how hard must I brake from here?
      dist += line.ds[i];
      const vt = line.speed[j];
      if (v > vt) {
        const need = (v * v - vt * vt) / (2 * Math.max(20, dist));
        if (need > 0.55 * BRAKE) c = 2; else if (need > 0.18 * BRAKE) c = Math.max(c, 1);
      }
      out[k] = c;
    }
    return out;
  }

  return { get, indexFor, colors };
});
