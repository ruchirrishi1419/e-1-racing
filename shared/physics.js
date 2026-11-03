/* =====================================================================
   E1 (EQUATION 1) - CAR PHYSICS  (shared by the server AND the browser)
   ---------------------------------------------------------------------
   Simple, fun "arcade" physics. Every frame we:
     1. Split the car's movement into "forwards" and "sideways" parts.
     2. Speed up / brake / reverse the forwards part.
     3. Shrink the sideways part (tyre grip). Less grip = more drifting.
     4. Turn the car, move it, and check grass and barriers.
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracks'));
  else root.Physics = factory(root.Tracks);
})(typeof self !== 'undefined' ? self : this, function (Tracks) {
  'use strict';

  // Change these numbers to change how the cars feel!
  const TUNING = {
    accel: 430,          // how fast the car speeds up (pixels per second, per second)
    brake: 950,          // how strong the brakes are
    reverseAccel: 280,   // how fast you speed up going backwards
    maxSpeed: 560,       // top speed on the road (pixels per second)
    maxReverse: 170,     // top speed going backwards
    grassMaxSpeed: 210,  // top speed on grass/sand
    airDrag: 0.25,       // slows the car a little at high speed
    rolling: 150,        // slows the car when you don't press anything
    turnRate: 2.0,       // fastest the car can turn at low speed (radians per second)
    lateralGrip: 430,    // how much sideways force the tyres can hold (higher speed = gentler turning)
    steerSpeed: 4.0,     // how fast the steering wheel turns to full lock (per second)
    steerReturn: 6.0,    // how fast it straightens out when you let go
    grip: 10,            // normal tyre grip (higher = less sliding)
    driftGrip: 3.2,      // grip while turning hard at speed (gives a small drift)
    grassGrip: 4.5,      // grip on grass
    wallBounce: 0.45     // how bouncy the barriers are (0 = sticky, 1 = super bouncy)
  };

  const CAR = { length: 40, width: 20, radius: 13 };

  // Make a new car at a position, facing "angle" (in radians).
  function createCar(x, y, angle) {
    return { x, y, angle, vx: 0, vy: 0, speed: 0, surface: 'road', hint: -1,
             drifting: false, wallHit: 0, s: 0 };
  }

  // Move the car forward by "dt" seconds using the player's input
  // (input = { up, down, left, right } each true/false).
  function step(car, input, dt, track) {
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle); // forwards direction
    const rx = -fy, ry = fx;                                  // sideways direction

    let forward = car.vx * fx + car.vy * fy;
    let side = car.vx * rx + car.vy * ry;
    const onGrass = car.surface === 'grass';

    // --- Gas, brake and reverse ---
    if (input.up) {
      forward += (forward < 0 ? TUNING.brake : TUNING.accel) * dt;
    } else if (input.down) {
      forward -= (forward > 15 ? TUNING.brake : TUNING.reverseAccel) * dt;
    } else {
      // No pedal pressed: slowly roll to a stop
      const r = TUNING.rolling * dt;
      forward = Math.abs(forward) <= r ? 0 : forward - Math.sign(forward) * r;
    }
    forward -= forward * TUNING.airDrag * dt;

    // --- Grass slows you down ---
    const limit = onGrass ? TUNING.grassMaxSpeed : TUNING.maxSpeed;
    if (forward > limit) forward += (limit - forward) * Math.min(1, 4 * dt);
    forward = Math.max(-TUNING.maxReverse, Math.min(TUNING.maxSpeed, forward));

    // --- Steering ---
    // The steering wheel moves smoothly towards full lock (keys are just on/off)
    const target = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const rate = (target === 0 ? TUNING.steerReturn : TUNING.steerSpeed) * dt;
    car.steer = car.steer || 0;
    car.steer += Math.max(-rate, Math.min(rate, target - car.steer));
    const steer = car.steer;
    // Like a real race car, the tyres can only hold so much sideways force:
    // the faster you go, the less sharply the car can turn.
    const v = Math.abs(forward);
    const maxTurn = Math.min(TUNING.turnRate, TUNING.lateralGrip / Math.max(v, 1));
    const lowSpeed = Math.min(1, v / 120);           // can't turn while stopped
    const turning = steer * maxTurn * lowSpeed * Math.sign(forward);

    // --- Grip / drifting ---
    let grip = TUNING.grip;
    if (onGrass) grip = TUNING.grassGrip;
    else if (Math.abs(steer) > 0.6 && forward > 380) grip = TUNING.driftGrip;
    side *= Math.exp(-grip * dt);

    // Put the two parts back together, then turn the car.
    // (The car turns but its movement lags behind a bit -> that's the drift!)
    car.vx = fx * forward + rx * side;
    car.vy = fy * forward + ry * side;
    car.angle += turning * dt;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.speed = forward;
    car.drifting = Math.abs(side) > 70 || (input.down && forward > 250);

    // --- Grass and barriers ---
    keepOnTrack(car, track);
  }

  // Works out if the car is on road or grass, and bounces it off barriers.
  function keepOnTrack(car, track) {
    const near = Tracks.nearest(track, car.x, car.y, car.hint);
    car.hint = near.index;
    car.s = near.s;
    car.wallHit = 0;
    const maxDist = track.halfWidth + track.runoff - CAR.radius;
    if (near.dist > maxDist) {
      // Push the car back inside the barrier
      const nx = (car.x - near.px) / near.dist, ny = (car.y - near.py) / near.dist;
      car.x = near.px + nx * maxDist;
      car.y = near.py + ny * maxDist;
      const into = car.vx * nx + car.vy * ny; // speed going into the wall
      if (into > 0) {
        car.vx -= nx * into * (1 + TUNING.wallBounce);
        car.vy -= ny * into * (1 + TUNING.wallBounce);
        car.vx *= 0.8; car.vy *= 0.8;           // scraping the wall slows you down
        car.wallHit = into;
      }
    }
    car.surface = near.dist <= track.halfWidth ? 'road' : 'grass';
    car.trackDist = near.dist;   // distance from the centre line (used to feel the kerbs)
  }

  // Light bump between my car and another car (only "my" car is moved,
  // the other player's own computer moves theirs). Returns the bump strength.
  function bump(car, other) {
    const dx = car.x - other.x, dy = car.y - other.y;
    const d = Math.hypot(dx, dy);
    const minD = CAR.radius * 2;
    if (d >= minD || d === 0) return 0;
    const nx = dx / d, ny = dy / d;
    car.x += nx * (minD - d);
    car.y += ny * (minD - d);
    const rel = (car.vx - (other.vx || 0)) * nx + (car.vy - (other.vy || 0)) * ny;
    if (rel < 0) {
      car.vx -= nx * rel * 0.9;
      car.vy -= ny * rel * 0.9;
      return -rel;
    }
    return 0;
  }

  return { TUNING, CAR, createCar, step, bump };
});
