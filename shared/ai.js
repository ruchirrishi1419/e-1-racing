/* =====================================================================
   E1 (EQUATION 1) - AI DRIVERS (computer-controlled cars)
   ---------------------------------------------------------------------
   Each AI car "presses" the same controls a human would (up, down,
   left, right), so it follows exactly the same physics rules.
   How an AI driver thinks, every frame:
     1. Look at a point a little way ahead on the track and steer towards it.
     2. Look further ahead: if a sharp bend is coming, slow down.
     3. If stuck against a barrier, reverse for a moment.
   ===================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tracks'), require('./physics'));
  else root.AI = factory(root.Tracks, root.Physics);
})(typeof self !== 'undefined' ? self : this, function (Tracks, Physics) {
  'use strict';

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // skill: 0.8 (slow) to 1.0 (fast).  lane: -1 (left side) to 1 (right side)
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

    const near = Tracks.nearest(track, car.x, car.y, car.hint);
    const d = near.s * track.length;
    const speed = Math.max(0, car.speed);

    // 1. Steer towards a point ahead, in this driver's favourite "lane"
    brain.laneDrift += dt * 0.3;
    const lane = brain.lane + Math.sin(brain.laneDrift) * 0.3;
    const ahead = Tracks.pointAt(track, d + 110 + speed * 0.25);
    const off = lane * track.halfWidth * 0.45;
    const tx = ahead.x - Math.sin(ahead.angle) * off;
    const ty = ahead.y + Math.cos(ahead.angle) * off;
    const steer = angleDiff(Math.atan2(ty - car.y, tx - car.x), car.angle);
    if (steer > 0.04) input.right = true;
    if (steer < -0.04) input.left = true;

    // 2. How sharp is the bend coming up? Sharper bend = lower target speed
    const a1 = Tracks.pointAt(track, d + 40).angle;
    const a2 = Tracks.pointAt(track, d + 140 + speed * 0.8).angle;
    const bend = Math.abs(angleDiff(a2, a1));
    const target = Physics.TUNING.maxSpeed * brain.skill * Math.max(0.36, 1 - bend * 0.6);
    if (speed < target) input.up = true;
    else if (speed > target + 50) input.down = true;

    return input;
  }

  return { createBrain, drive };
});
