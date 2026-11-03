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
  // The 4 circuits are traced from track maps (points are pixel positions on the map,
  // listed in the direction the cars drive, starting at the start/finish line).
  //   scale      = map pixels -> game units (makes the lap the right length)
  //   elevation  = how much the road goes up and down
  //   hills      = how big the hills are in the background
  //   theme.ground = which ground texture to use around the track
  const DEFINITIONS = [
    {
      name: 'Bahrain',
      difficulty: 'Medium',
      description: 'Desert circuit: long straights and heavy braking into slow corners. 15 corners.',
      type: 'spline',
      scale: 14,
      points: [
        [345, 458], [200, 458], [70, 458], [45, 452], [62, 432], [88, 410], [84, 385], [78, 356],
        [92, 240], [105, 130], [110, 110], [135, 128], [190, 180], [232, 205], [235, 235], [230, 262],
        [275, 305], [315, 335], [300, 342], [230, 335], [175, 330], [145, 345], [128, 368], [150, 380],
        [300, 380], [440, 380], [458, 360], [440, 320], [365, 268], [340, 245], [350, 190], [387, 143],
        [410, 165], [482, 282], [550, 420], [527, 458], [440, 458]
      ],
      halfWidth: 66,
      runoff: 110,
      elevation: 0,
      hills: 90,
      theme: { bg: '#d9b778', runoff: '#e8cf98', road: '#4a4440', decor: 'cacti', ground: 'sand' }
    },
    {
      name: 'Spa-Francorchamps',
      difficulty: 'Hard',
      description: 'Long, fast and hilly: La Source hairpin, the Eau Rouge climb and the Kemmel straight. 19 corners.',
      type: 'spline',
      scale: 16,
      points: [
        [130, 345], [85, 383], [48, 415], [38, 420], [45, 405], [80, 345], [120, 285], [150, 248],
        [158, 222], [175, 212], [200, 205], [260, 170], [340, 120], [420, 80], [478, 50], [495, 62],
        [520, 58], [545, 45], [575, 65], [605, 95], [620, 120], [612, 138], [592, 130], [565, 116], [540, 112],
        [500, 122], [455, 145], [425, 165], [410, 180], [425, 212], [470, 240], [515, 262], [530, 282],
        [548, 312], [580, 335], [600, 352], [598, 385], [588, 415], [565, 405], [515, 368], [462, 332],
        [415, 300], [378, 280], [335, 270], [290, 285], [240, 305], [195, 318], [185, 305], [178, 300],
        [155, 325]
      ],
      halfWidth: 60,
      runoff: 95,
      elevation: 0,
      hills: 260,
      theme: { bg: '#2c5a31', runoff: '#3f7f3a', road: '#3a3a3f', decor: 'pines', ground: 'grass' }
    },
    {
      name: 'Monaco',
      difficulty: 'Expert',
      description: 'Narrow streets between buildings: tight hairpins, the tunnel and the swimming pool chicane. 19 corners.',
      type: 'spline',
      scale: 19,
      points: [
        [118, 140], [150, 108], [185, 85], [213, 76], [235, 92], [275, 130], [310, 160], [338, 172],
        [365, 190], [385, 202], [398, 185], [410, 165], [440, 160], [480, 160], [510, 163], [500, 180],
        [488, 203], [486, 214], [495, 210], [510, 194], [522, 196], [535, 207], [520, 225], [470, 245],
        [418, 258], [370, 240], [330, 215], [305, 190], [288, 183], [265, 160], [235, 128], [212, 108],
        [185, 112], [160, 122], [145, 130], [140, 140], [143, 160], [133, 180], [116, 184], [105, 200],
        [100, 212], [90, 238], [78, 236], [70, 224], [80, 200], [100, 165]
      ],
      halfWidth: 46,
      runoff: 32,
      elevation: 0,
      hills: 0,
      theme: { bg: '#585d66', runoff: '#8d939b', road: '#2e3035', decor: 'buildings', ground: 'concrete' }
    },
    {
      name: 'Buddh (India)',
      difficulty: 'Medium',
      description: 'Wide and fast with a huge back straight and a long looping corner. 16 corners.',
      type: 'spline',
      scale: 11,
      points: [
        [740, 503], [850, 495], [940, 487], [965, 490], [972, 520], [978, 560], [1000, 610], [1060, 650],
        [1110, 670], [1130, 685], [1110, 700], [1000, 703], [700, 705], [400, 708], [260, 712], [240, 700],
        [255, 680], [310, 600], [385, 518], [440, 450], [470, 410], [472, 372], [470, 350], [440, 335],
        [430, 328], [380, 318], [300, 300], [290, 280], [280, 265], [200, 230], [110, 200], [80, 185],
        [72, 150], [78, 110], [110, 82], [160, 75], [205, 85], [220, 105], [240, 135], [290, 195],
        [330, 240], [370, 248], [410, 230], [430, 225], [520, 255], [600, 285], [612, 305], [600, 330],
        [552, 395], [495, 462], [465, 508], [470, 520], [560, 515], [650, 510]
      ],
      halfWidth: 66,
      runoff: 105,
      elevation: 0,
      hills: 70,
      theme: { bg: '#3d6e33', runoff: '#4f9a3a', road: '#3b3d42', decor: 'trees', ground: 'grass' }
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
      origin: { ox, oy, scale: def.scale || 1 },   // to map back to the original track map (for testing)
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
