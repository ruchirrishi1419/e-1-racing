/* =====================================================================
   E1 (EQUATION 1) - AI DRIVERS (computer-controlled cars)
   ---------------------------------------------------------------------
   Each AI car "presses" the same controls a human would (up, down,
   left, right), so it follows exactly the same physics rules.
   How an AI driver thinks, every frame:
     1. Follow the racing line (racingline.js): steer towards a point on
        it a little way ahead, with a small personal offset so cars
        don't all drive in single file.
     2. Look at the speed the racing line allows a bit further ahead and
        brake or accelerate to match it (multiplied by the driver's skill).
     3. If stuck against a barrier, reverse for a moment.
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracks'), require('./physics'), require('./racingline'));
  else root.AI = factory(root.Tracks, root.Physics, root.RacingLine);
})(typeof self !== 'undefined' ? self : this, function (Tracks, Physics, RacingLine) {
  'use strict';

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // skill: 0.8 (slow) to 1.0 (fast).  lane: -1 to 1 (small personal offset from the racing line)
  function createBrain(skill, lane) {
    return { skill, lane, stuckTime: 0, reverseTime: 0, laneDrift: Math.random() * 10 };
  }

  // Decide which controls to press this frame
  function drive(car, track, brain, dt) {
    const input = { up: false, down: false, left: false, right: false };

    // Stuck? Back up for a moment.
    if (brain.reverseTime > 0) {
      brain.reverseTime -= dt;
      input.down = true;
      return input;
    }
    if (Math.abs(car.speed) < 25) brain.stuckTime += dt; else brain.stuckTime = 0;
    if (brain.stuckTime > 1.5) { brain.stuckTime = 0; brain.reverseTime = 0.8; }

    const line = RacingLine.get(track);
    const near = Tracks.nearest(track, car.x, car.y, car.hint);
    const speed = Math.max(0, car.speed);
    const here = RacingLine.indexFor(line, near.index);

    // 1. Steer towards a point on the racing line ahead (with a small personal offset)
    brain.laneDrift += dt * 0.25;
    const ahead = (here + 3 + Math.round(speed * 0.006)) % line.n;
    const nextP = (ahead + 1) % line.n;
    const tx0 = line.x[nextP] - line.x[ahead], ty0 = line.y[nextP] - line.y[ahead];
    const tl = Math.hypot(tx0, ty0) || 1;
    const off = (brain.lane * 0.6 + Math.sin(brain.laneDrift) * 0.25) * track.halfWidth * 0.3;
    const tx = line.x[ahead] - (ty0 / tl) * off, ty = line.y[ahead] + (tx0 / tl) * off;
    const steer = angleDiff(Math.atan2(ty - car.y, tx - car.x), car.angle);
    if (steer > 0.035) input.right = true;
    if (steer < -0.035) input.left = true;

    // 2. Match the racing line's speed a little ahead (earlier at high speed = braking in time)
    let target = Infinity;
    const look = 2 + Math.round(speed * 0.012);
    for (let k = 1; k <= look; k++) target = Math.min(target, line.speed[(here + k) % line.n]);
    target *= brain.skill;
    if (speed < target) input.up = true;
    else if (speed > target + 25) input.down = true;

    return input;
  }

  return { createBrain, drive };
});
