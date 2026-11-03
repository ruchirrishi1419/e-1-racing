/* =====================================================================
   E1 (EQUATION 1) - TRACKS  (shared by the server AND the browser)
   ---------------------------------------------------------------------
   Each track is described by a list of "control points" (x, y).
   We join those points into a smooth closed loop called the
   "centre line". Everything else is measured from that line:

     - Distance from centre line <= halfWidth           -> on the ROAD
     - Distance <= halfWidth + runoff                     -> on GRASS/SAND (slow)
     - Further than that                                  -> hits the BARRIER

   The start/finish line is at the very first point of the loop, and
   cars drive in the order the points are listed.
   ===================================================================== */

(function (root, factory) {
  // This little wrapper lets the same file work in Node.js (server)
  // and in the browser (where it becomes the global "Tracks").
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tracks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SAMPLE_SPACING = 10; // distance (in pixels) between points on the final centre line
  const WORLD_MARGIN = 900;  // space around the track for grandstands, trees and buildings

  /* ---------------- Track designs ---------------- */
  // type 'spline'  = smooth flowing curves through the points
  // type 'corners' = straight lines with rounded corners of radius "radius"
  // type 'poly'    = points are already dense, use them as they are
  // Every track is long like a real circuit (about 1:20 - 1:40 per lap at racing speed),
  // with a long main straight, hairpins, chicanes (S-bends) and at least 10 corners.
  //   scale      = makes the whole layout bigger or smaller
  //   banked     = tilt the big fast corners (Oval)
  //   elevation  = how much the road goes up and down hills (Mountain Pass)
  //   hills      = how big the hills are in the background
  //   theme.ground = which ground texture to use around the track
  const DEFINITIONS = [
    {
      name: 'Oval Speedway',
      difficulty: 'Easy',
      description: 'A huge oval with two banked turns, a back-straight chicane and a twisty infield.',
      type: 'spline',
      scale: 1.75,
      points: [
        [2600, 0], [5000, 0], [7500, 0], [8300, 330], [8600, 1100], [8300, 1870], [7500, 2200],
        [6600, 2200], [6200, 2200], [5900, 2020], [5600, 2200], [5000, 2200],
        [4500, 2100], [4250, 1700], [4700, 1300], [4250, 850], [3600, 700], [3050, 1100],
        [3450, 1550], [2950, 1800], [2400, 2200], [1500, 2200], [700, 1870], [400, 1100],
        [700, 330], [1500, 0]
      ],
      halfWidth: 80,
      runoff: 110,
      banked: true,
      elevation: 0,
      hills: 70,
      theme: { bg: '#3d6e33', runoff: '#4f9a3a', road: '#3b3d42', decor: 'trees', ground: 'grass' }
    },
    {
      name: 'City Circuit',
      difficulty: 'Medium',
      description: 'A long street race with 18 tight corners between the city blocks.',
      type: 'corners',
      radius: 85,
      scale: 1.2,
      points: [
        [3200, 400], [7000, 400], [7000, 1500], [8000, 1500], [8000, 3000], [6600, 3000],
        [6600, 2200], [5400, 2200], [5400, 3600], [4400, 3600], [4400, 2900], [3200, 2900],
        [3200, 4200], [1600, 4200], [1600, 2600], [2400, 2600], [2400, 1600], [1200, 1600],
        [1200, 400]
      ],
      halfWidth: 60,
      runoff: 55,
      elevation: 0,
      hills: 0,
      theme: { bg: '#585d66', runoff: '#8d939b', road: '#2e3035', decor: 'buildings', ground: 'concrete' }
    },
    {
      name: 'Mountain Pass',
      difficulty: 'Medium',
      description: 'Long winding S-curves and switchbacks, climbing up and down the hills.',
      type: 'spline',
      scale: 1.6,
      points: [
        [2200, 500], [4800, 500], [6000, 700], [6800, 1300], [6200, 1900], [7000, 2500],
        [6300, 3100], [7100, 3800], [6600, 4600], [5600, 4500], [5000, 3800], [4400, 4600],
        [3600, 5000], [2800, 4500], [2000, 5000], [1200, 4600], [800, 3900], [1500, 3300],
        [800, 2700], [1500, 2100], [900, 1500], [1200, 800]
      ],
      halfWidth: 64,
      runoff: 85,
      elevation: 110,
      hills: 420,
      theme: { bg: '#2c5a31', runoff: '#3f7f3a', road: '#3a3a3f', decor: 'pines', ground: 'rock' }
    },
    {
      name: 'Desert Loop',
      difficulty: 'Hard',
      description: 'Enormous flat-out straights and huge braking zones into tight hairpins.',
      type: 'corners',
      radius: 240,
      scale: 1.43,
      points: [
        [2000, 500], [9000, 500], [9000, 1100], [6000, 1100], [5400, 1700], [6200, 2300],
        [9000, 2300], [9000, 2800], [3000, 2800], [2500, 2300], [3000, 1600], [1500, 1600],
        [1500, 500]
      ],
      halfWidth: 68,
      runoff: 110,
      elevation: 0,
      hills: 110,
      theme: { bg: '#d9b778', runoff: '#e8cf98', road: '#4a4440', decor: 'cacti', ground: 'sand' }
    },
    {
      name: 'Grand Prix',
      difficulty: 'Expert',
      description: 'The longest and most technical circuit: every kind of corner.',
      type: 'spline',
      scale: 1.22,
      points: [
        [2500, 500], [6500, 500], [7300, 650], [7500, 1200], [7000, 1600], [7600, 2100],
        [8600, 2000], [9300, 2500], [9100, 3300], [8300, 3500], [7900, 4200], [8600, 4900],
        [8000, 5600], [7000, 5400], [6300, 4600], [5600, 5300], [4600, 5500], [3800, 5000],
        [3200, 5500], [2200, 5400], [1600, 4700], [2200, 4000], [1500, 3300], [2300, 2700],
        [3300, 2900], [4000, 2400], [3400, 1800], [2200, 1900], [1400, 1400], [1500, 800]
      ],
      halfWidth: 62,
      runoff: 100,
      elevation: 25,
      hills: 160,
      theme: { bg: '#2b5e2e', runoff: '#4c8f3c', road: '#35363b', decor: 'trees', ground: 'grass' }
    }
  ];

  /* ---------------- Shape helpers ---------------- */

  // A "stadium" (oval with two straights). Starts in the middle of the
  // top straight, heading right, and goes clockwise on screen.
  function stadium(cx, cy, straight, radius) {
    const pts = [];
    const half = straight / 2;
    const step = 20;
    for (let x = cx; x < cx + half; x += step) pts.push([x, cy - radius]);
    for (let a = -Math.PI / 2; a < Math.PI / 2; a += step / radius)
      pts.push([cx + half + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    for (let x = cx + half; x > cx - half; x -= step) pts.push([x, cy + radius]);
    for (let a = Math.PI / 2; a < Math.PI * 1.5; a += step / radius)
      pts.push([cx - half + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    for (let x = cx - half; x < cx; x += step) pts.push([x, cy - radius]);
    return pts;
  }

  // Smooth curve through points (centripetal Catmull-Rom spline).
  // "Centripetal" means it never makes weird loops on sharp turns.
  function splineLoop(points) {
    const out = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n], p1 = points[i];
      const p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      const t0 = 0;
      const t1 = t0 + Math.pow(dist(p0, p1), 0.5);
      const t2 = t1 + Math.pow(dist(p1, p2), 0.5);
      const t3 = t2 + Math.pow(dist(p2, p3), 0.5);
      const steps = Math.max(8, Math.ceil(dist(p1, p2) / 6));
      for (let s = 0; s < steps; s++) {
        const t = t1 + (t2 - t1) * (s / steps);
        const a1 = mix(p0, p1, (t - t0) / (t1 - t0));
        const a2 = mix(p1, p2, (t - t1) / (t2 - t1));
        const a3 = mix(p2, p3, (t - t2) / (t3 - t2));
        const b1 = mix(a1, a2, (t - t0) / (t2 - t0));
        const b2 = mix(a2, a3, (t - t1) / (t3 - t1));
        out.push(mix(b1, b2, (t - t1) / (t2 - t1)));
      }
    }
    return out;
  }

  // Straight lines with rounded corners (good for street circuits).
  function roundedLoop(points, radius) {
    const out = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n], p = points[i], next = points[(i + 1) % n];
      const dIn = dist(prev, p), dOut = dist(p, next);
      const r = Math.min(radius, dIn / 2, dOut / 2);
      const start = mix(p, prev, r / dIn); // where the curve starts (before the corner)
      const end = mix(p, next, r / dOut);  // where the curve ends (after the corner)
      // Curve around the corner (quadratic Bezier with the corner as the control point)
      for (let s = 0; s < 12; s++) {
        const t = s / 12;
        const a = mix(start, p, t), b = mix(p, end, t);
        out.push(mix(a, b, t));
      }
      // Straight line to the start of the next corner
      const after = points[(i + 2) % n];
      const dNext = dist(next, after);
      const rNext = Math.min(radius, dOut / 2, dNext / 2);
      const straightEnd = mix(next, p, rNext / dOut);
      const len = dist(end, straightEnd);
      const steps = Math.ceil(len / 20);
      for (let s = 0; s < steps; s++) out.push(mix(end, straightEnd, s / steps));
    }
    // Rotate so the loop starts exactly at the first control point (start line)
    let best = 0, bestD = Infinity;
    out.forEach((q, i) => { const d = dist(q, points[0]); if (d < bestD) { bestD = d; best = i; } });
    return out.slice(best).concat(out.slice(0, best));
  }

  function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.0001; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

  // Turn any closed list of points into evenly spaced points.
  function resample(points, spacing) {
    const closed = points.concat([points[0]]);
    const out = [];
    let carry = 0;
    for (let i = 0; i < closed.length - 1; i++) {
      const a = closed[i], b = closed[i + 1];
      const segLen = dist(a, b);
      let d = carry;
      while (d < segLen) {
        out.push(mix(a, b, d / segLen));
        d += spacing;
      }
      carry = d - segLen;
    }
    return out;
  }

  /* ---------------- Build the final track objects ---------------- */

  function buildTrack(def, id) {
    let raw;
    const pts0 = def.points.map(p => [p[0] * (def.scale || 1), p[1] * (def.scale || 1)]);
    if (def.type === 'spline') raw = splineLoop(pts0);
    else if (def.type === 'corners') raw = roundedLoop(pts0, def.radius);
    else raw = def.points;

    let pts = resample(raw, SAMPLE_SPACING);

    // Move the track so it sits nicely inside the world with a margin.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => {
      minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
    });
    const ox = WORLD_MARGIN - minX, oy = WORLD_MARGIN - minY;
    const path = pts.map(p => ({ x: p[0] + ox, y: p[1] + oy }));

    // Cumulative distance along the track for each point
    const cum = [0];
    for (let i = 1; i < path.length; i++)
      cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    const last = path[path.length - 1];
    const length = cum[cum.length - 1] + Math.hypot(path[0].x - last.x, path[0].y - last.y);

    return {
      id,
      name: def.name,
      difficulty: def.difficulty,
      description: def.description,
      halfWidth: def.halfWidth,
      runoff: def.runoff,
      // more checkpoints on longer tracks (about one every 1.8 km)
      checkpoints: Math.max(10, Math.round(length / 1800)),
      theme: def.theme,
      banked: !!def.banked,
      elevation: def.elevation || 0,
      hills: def.hills || 0,
      path,
      cum,
      length,
      width: maxX - minX + WORLD_MARGIN * 2,
      height: maxY - minY + WORLD_MARGIN * 2
    };
  }

  const list = DEFINITIONS.map(buildTrack);

  /* ---------------- Helper functions used by the game ---------------- */

  function get(id) { return list[id] || list[0]; }

  // Find the closest point on the centre line to (x, y).
  // Returns the distance and "s" = how far around the lap that point is (0 to 1).
  // "hint" (optional) = the index from last time, so we only search nearby (faster).
  function nearest(track, x, y, hint) {
    const path = track.path, n = path.length;
    let from = 0, to = n;
    if (hint !== undefined && hint >= 0) { from = hint - 40; to = hint + 40; }
    let best = null;
    for (let k = from; k < to; k++) {
      const i = ((k % n) + n) % n;
      const a = path[i], b = path[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy || 0.0001;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + dx * t, py = a.y + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.dist) best = { dist: d, index: i, t, px, py };
    }
    // If the local search found something suspiciously far, do a full search
    if (hint !== undefined && hint >= 0 && best.dist > track.halfWidth + track.runoff + 60)
      return nearest(track, x, y);
    const segLen = Math.sqrt(
      Math.pow(path[(best.index + 1) % n].x - path[best.index].x, 2) +
      Math.pow(path[(best.index + 1) % n].y - path[best.index].y, 2));
    best.s = (track.cum[best.index] + best.t * segLen) / track.length;
    return best;
  }

  // A point on the centre line at a distance "d" along the lap, plus the direction.
  function pointAt(track, d) {
    const L = track.length;
    d = ((d % L) + L) % L;
    const path = track.path, cum = track.cum;
    let lo = 0, hi = path.length - 1;
    while (lo < hi) { // binary search for the segment
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= d) lo = mid; else hi = mid - 1;
    }
    const a = path[lo], b = path[(lo + 1) % path.length];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 0.0001;
    const t = (d - cum[lo]) / segLen;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  // Starting grid: 2 columns, staggered like a real grid, behind the start line.
  function gridSlot(track, slot) {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    const back = 55 + row * 62 + col * 30;
    const p = pointAt(track, -back);
    const side = (col === 0 ? -1 : 1) * track.halfWidth * 0.45;
    return {
      x: p.x - Math.sin(p.angle) * side,
      y: p.y + Math.cos(p.angle) * side,
      angle: p.angle
    };
  }

  return { list, get, nearest, pointAt, gridSlot };
});
