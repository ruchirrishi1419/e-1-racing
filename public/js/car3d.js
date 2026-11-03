/* =====================================================================
   E1 (EQUATION 1) - 3D CAR MODEL
   ---------------------------------------------------------------------
   Builds a smooth, modern open-wheel race car in 3D:
   nose, front wing, monocoque (driver's tub), sidepods, engine cover
   with airbox and shark fin, rear wing, halo, mirrors, suspension arms,
   racing tyres and the driver's helmet.

   The car's paint job ("livery") is drawn on 2D canvases and wrapped
   around the body like a sticker sheet: the player's color is the main
   color, with made-up sponsor names, the car number and the player's name.
   Sponsor names are invented for E1 - no real brands.

   Directions on the car: +x = front, +y = up, +z = the car's right side.
   Size: about 48 units long (1 metre is roughly 8.5 units).
   ===================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------------- Shape helpers ---------------- */

// Join several shapes into one (fewer pieces = faster drawing).
// Shapes must be stored the same way first, so convert them all to plain triangles.
function merge(list) {
  const plain = list.map(g => {
    const p = g.index ? g.toNonIndexed() : g;
    Object.keys(p.attributes).forEach(name => { if (!['position', 'normal', 'uv'].includes(name)) p.deleteAttribute(name); });
    p.clearGroups();
    return p;
  });
  return mergeGeometries(plain);
}

// Catmull-Rom: a smooth curve through four values (used to blend the body sections)
function cr(a, b, c, d, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

/* "Loft": builds a smooth body from cross-sections placed along the car.
   Each section: { x, w (half width), top, bottom, p (roundness: 2 = oval, 4+ = boxy) }
   The texture wraps around it: u goes from rear to front, v goes round the body
   (v = 0 bottom, 0.25 right side, 0.5 top, 0.75 left side). */
function loft(sections, stepsPerSection = 6, around = 28) {
  const S = sections;
  const get = (i) => S[Math.max(0, Math.min(S.length - 1, i))];
  const rings = [];
  for (let i = 0; i < S.length - 1; i++) {
    for (let k = 0; k < stepsPerSection; k++) {
      const t = k / stepsPerSection;
      const ring = {};
      ['x', 'w', 'top', 'bottom', 'p'].forEach(key => {
        ring[key] = cr(get(i - 1)[key], get(i)[key], get(i + 1)[key], get(i + 2)[key], t);
      });
      rings.push(ring);
    }
  }
  rings.push({ ...S[S.length - 1] });

  const x0 = S[0].x, x1 = S[S.length - 1].x;
  const pos = [], uv = [], idx = [];
  rings.forEach(r => {
    const mid = (r.top + r.bottom) / 2, h = (r.top - r.bottom) / 2, e = 2 / Math.max(1.2, r.p);
    for (let a = 0; a <= around; a++) {
      const th = -Math.PI / 2 + (a / around) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      pos.push(r.x, mid + h * Math.sign(s) * Math.pow(Math.abs(s), e), Math.max(0.01, r.w) * Math.sign(c) * Math.pow(Math.abs(c), e));
      uv.push((r.x - x0) / (x1 - x0), a / around);
    }
  });
  const row = around + 1;
  for (let j = 0; j < rings.length - 1; j++) {
    for (let a = 0; a < around; a++) {
      const p0 = j * row + a, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
      idx.push(p0, p2, p1, p1, p2, p3);
    }
  }
  // Close both ends with a cap
  [0, rings.length - 1].forEach((j, end) => {
    const r = rings[j];
    const centre = pos.length / 3;
    pos.push(r.x, (r.top + r.bottom) / 2, 0);
    uv.push(end ? 1 : 0, 0.5);
    for (let a = 0; a < around; a++) {
      const p0 = j * row + a, p1 = p0 + 1;
      if (end) idx.push(centre, p0, p1); else idx.push(centre, p1, p0);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A wing element: a smooth airfoil shape (side view), stretched across the car
function wingElement(chord, thickness, span, x, y, z, tilt = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(chord * 0.15, thickness * 1.3, chord * 0.6, thickness * 1.1, chord, thickness * 0.15);
  shape.lineTo(chord, 0);
  shape.bezierCurveTo(chord * 0.6, -thickness * 0.2, chord * 0.2, -thickness * 0.3, 0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 10 });
  g.translate(-chord / 2, 0, -span / 2);
  g.rotateZ(tilt);
  // the shape is drawn rear-to-front, so flip it to face forwards
  g.rotateY(Math.PI);
  g.translate(x, y, z);
  return g;
}

// A rounded flat plate (wing end plates, fin)
function roundedPlate(x0, y0, x1, y1, radius, thickness, z) {
  const s = new THREE.Shape();
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, z - thickness / 2);
  return g;
}

// A thin round bar from point a to point b (suspension arms, supports)
function bar(a, b, radius) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(radius, radius, len, 8);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  g.translate(A.x, A.y, A.z);
  return g;
}

/* ---------------- The car's shapes (built once, shared by all cars) ---------------- */

export const WHEELS = {
  front: { x: 14, z: 6.9, r: 3.1, w: 3.0 },
  rear: { x: -17, z: 6.7, r: 3.2, w: 3.6 }
};
export const HELMET = { x: -2.8, y: 5.65, r: 1.25 };

let GEO = null;
function buildGeometry() {
  // Driver's tub + nose (from behind the driver to the nose tip)
  const mono = loft([
    { x: -9, w: 2.6, top: 4.5, bottom: 0.9, p: 3 },
    { x: -6, w: 3.0, top: 4.9, bottom: 0.9, p: 3.2 },
    { x: -2, w: 3.1, top: 4.8, bottom: 0.9, p: 3.2 },
    { x: 2, w: 2.9, top: 4.9, bottom: 0.9, p: 3 },
    { x: 6, w: 2.4, top: 4.6, bottom: 1.0, p: 2.8 },
    { x: 10, w: 1.9, top: 4.0, bottom: 1.2, p: 2.6 },
    { x: 15, w: 1.5, top: 3.3, bottom: 1.35, p: 2.4 },
    { x: 20, w: 1.15, top: 2.6, bottom: 1.4, p: 2.3 },
    { x: 24, w: 0.6, top: 2.0, bottom: 1.45, p: 2.2 },
    { x: 24.8, w: 0.15, top: 1.75, bottom: 1.6, p: 2 }
  ], 6, 32);

  // Sidepods (the wide parts either side of the driver, with air intakes at the front)
  const pods = loft([
    { x: -15, w: 1.8, top: 2.6, bottom: 1.0, p: 3 },
    { x: -10, w: 4.0, top: 3.5, bottom: 0.9, p: 3.5 },
    { x: -5, w: 5.3, top: 4.0, bottom: 0.9, p: 4.2 },
    { x: -0.5, w: 5.8, top: 4.0, bottom: 0.9, p: 4.6 },
    { x: 2.5, w: 5.6, top: 3.7, bottom: 1.1, p: 4.2 },
    { x: 3.6, w: 4.6, top: 3.1, bottom: 1.5, p: 3 }
  ], 6, 32);

  // Engine cover with the airbox above the driver's head
  const cover = loft([
    { x: -24, w: 0.5, top: 2.6, bottom: 1.5, p: 2 },
    { x: -20, w: 1.2, top: 3.8, bottom: 1.0, p: 2.4 },
    { x: -15, w: 2.0, top: 5.5, bottom: 1.0, p: 2.6 },
    { x: -11, w: 2.4, top: 7.0, bottom: 1.6, p: 2.6 },
    { x: -8, w: 1.7, top: 7.9, bottom: 4.2, p: 2.4 },
    { x: -6.4, w: 1.15, top: 7.6, bottom: 5.4, p: 2.2 },
    { x: -5.9, w: 0.3, top: 7.0, bottom: 6.1, p: 2 }
  ], 6, 28);

  // Parts painted in the main color (no stickers)
  const paint = merge([
    roundedPlate(-20, 5.4, -10.5, 8.3, 1.4, 0.25, 0),                // shark fin
    roundedPlate(19.3, 0.6, 25.6, 3.0, 0.6, 0.3, 8.55),              // front wing end plates
    roundedPlate(19.3, 0.6, 25.6, 3.0, 0.6, 0.3, -8.55),
    wingElement(2.2, 0.35, 5.6, 21.0, 1.9, 5.4, -0.22),             // front wing flaps (each side)
    wingElement(2.2, 0.35, 5.6, 21.0, 1.9, -5.4, -0.22),
    wingElement(1.6, 0.3, 5.6, 19.9, 2.6, 5.4, -0.42),
    wingElement(1.6, 0.3, 5.6, 19.9, 2.6, -5.4, -0.42),
    roundedPlate(-25.2, 3.0, -19.4, 8.9, 0.8, 0.3, 4.45),            // rear wing end plates
    roundedPlate(-25.2, 3.0, -19.4, 8.9, 0.8, 0.3, -4.45),
    wingElement(1.9, 0.3, 8.6, -20.8, 7.9, 0, -0.35),               // rear wing top flap
    new THREE.SphereGeometry(1, 12, 8).scale(0.8, 0.4, 0.34).translate(5.0, 5.6, 4.6),   // mirror pods
    new THREE.SphereGeometry(1, 12, 8).scale(0.8, 0.4, 0.34).translate(5.0, 5.6, -4.6)
  ]);

  // Carbon fiber parts: floor, main wing planes, suspension arms, supports
  const floorShape = new THREE.Shape();
  [[-21, -1.8], [-14, -6.2], [6, -6.2], [9, -2.2], [9, 2.2], [6, 6.2], [-14, 6.2], [-21, 1.8]]
    .forEach(([x, z], i) => (i === 0 ? floorShape.moveTo(x, z) : floorShape.lineTo(x, z)));
  const floor = new THREE.ExtrudeGeometry(floorShape, { depth: 0.35, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 0.95, 0);
  const f = WHEELS.front, r = WHEELS.rear;
  const carbon = merge([
    floor,
    wingElement(4.6, 0.45, 17.0, 22.6, 0.95, 0, -0.04),            // front wing main plane
    wingElement(3.6, 0.5, 8.6, -22.2, 6.6, 0, -0.08),              // rear wing main plane
    wingElement(2.4, 0.3, 8.0, -22.5, 3.2, 0, -0.1),               // lower beam wing
    bar([-22.2, 1.6, 0], [-22.2, 6.7, 0], 0.32),                    // rear wing pillar
    bar([18, 1.6, 0.4], [21, 1.1, 0.4], 0.18), bar([18, 1.6, -0.4], [21, 1.1, -0.4], 0.18), // nose to wing
    // front suspension (upper and lower arms, both sides)
    bar([11, 3.6, 1.3], [f.x, f.r + 1.0, f.z - 1.2], 0.17), bar([16, 3.2, 1.0], [f.x, f.r + 1.0, f.z - 1.2], 0.17),
    bar([11, 1.8, 1.3], [f.x, f.r - 1.0, f.z - 1.2], 0.17), bar([16, 1.7, 1.0], [f.x, f.r - 1.0, f.z - 1.2], 0.17),
    bar([11, 3.6, -1.3], [f.x, f.r + 1.0, -f.z + 1.2], 0.17), bar([16, 3.2, -1.0], [f.x, f.r + 1.0, -f.z + 1.2], 0.17),
    bar([11, 1.8, -1.3], [f.x, f.r - 1.0, -f.z + 1.2], 0.17), bar([16, 1.7, -1.0], [f.x, f.r - 1.0, -f.z + 1.2], 0.17),
    // rear suspension
    bar([-14, 3.4, 1.8], [r.x, r.r + 1.0, r.z - 1.4], 0.17), bar([-19, 3.0, 1.2], [r.x, r.r + 1.0, r.z - 1.4], 0.17),
    bar([-14, 1.7, 2.0], [r.x, r.r - 1.0, r.z - 1.4], 0.17), bar([-19, 1.6, 1.2], [r.x, r.r - 1.0, r.z - 1.4], 0.17),
    bar([-14, 3.4, -1.8], [r.x, r.r + 1.0, -r.z + 1.4], 0.17), bar([-19, 3.0, -1.2], [r.x, r.r + 1.0, -r.z + 1.4], 0.17),
    bar([-14, 1.7, -2.0], [r.x, r.r - 1.0, -r.z + 1.4], 0.17), bar([-19, 1.6, -1.2], [r.x, r.r - 1.0, -r.z + 1.4], 0.17),
    // mirror stalks
    bar([4.2, 4.3, 2.4], [4.9, 5.5, 4.2], 0.14), bar([4.2, 4.3, -2.4], [4.9, 5.5, -4.2], 0.14),
    // rear crash structure
    new THREE.CylinderGeometry(0.5, 0.8, 4, 10).rotateZ(Math.PI / 2).translate(-24, 1.9, 0)
  ]);

  // Halo: the curved safety bar around the driver's head, with a centre pillar
  const haloCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.6, 5.0, 2.6),
    new THREE.Vector3(-3.6, 7.0, 2.5),
    new THREE.Vector3(-0.8, 7.85, 1.6),
    new THREE.Vector3(0.6, 7.95, 0),
    new THREE.Vector3(-0.8, 7.85, -1.6),
    new THREE.Vector3(-3.6, 7.0, -2.5),
    new THREE.Vector3(-5.6, 5.0, -2.6)
  ]);
  const pillarCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.6, 7.95, 0), new THREE.Vector3(2.3, 6.9, 0), new THREE.Vector3(3.6, 4.9, 0)
  ]);
  const halo = merge([
    new THREE.TubeGeometry(haloCurve, 40, 0.26, 10, false),
    new THREE.TubeGeometry(pillarCurve, 12, 0.15, 8, false)
  ]);

  // Mirror glass (faces backwards). In step 3 these will show the cars behind.
  const mirrorGlass = merge([
    new THREE.CircleGeometry(1, 16).scale(0.32, 0.37, 1).rotateY(-Math.PI / 2).translate(4.16, 5.6, 4.6),
    new THREE.CircleGeometry(1, 16).scale(0.32, 0.37, 1).rotateY(-Math.PI / 2).translate(4.16, 5.6, -4.6)
  ]);

  // Racing tyre: a rounded rubber ring (made by spinning a side profile around the axle)
  const tyre = (R, W) => {
    const rim = R * 0.62, pts = [];
    pts.push(new THREE.Vector2(rim, -W / 2));
    for (let i = 0; i <= 8; i++) {           // rounded shoulder
      const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector2(R - 0.45 + Math.cos(a) * 0.45, -W / 2 + 0.45 + Math.sin(a) * 0.45));
    }
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector2(R - 0.45 + Math.cos(a) * 0.45, W / 2 - 0.45 + Math.sin(a) * 0.45));
    }
    pts.push(new THREE.Vector2(rim, W / 2));
    return new THREE.LatheGeometry(pts, 32).rotateX(Math.PI / 2);
  };
  const stripe = (R, W) => merge([
    new THREE.RingGeometry(R * 0.74, R * 0.8, 40).translate(0, 0, W / 2 + 0.01),
    new THREE.RingGeometry(R * 0.74, R * 0.8, 40).rotateY(Math.PI).translate(0, 0, -W / 2 - 0.01)
  ]);
  const rim = (R, W) => merge([
    new THREE.CylinderGeometry(R * 0.62, R * 0.62, W * 0.9, 24, 1, true).rotateX(Math.PI / 2),
    new THREE.CircleGeometry(R * 0.62, 24).translate(0, 0, W * 0.42),
    new THREE.CircleGeometry(R * 0.62, 24).rotateY(Math.PI).translate(0, 0, -W * 0.42)
  ]);
  const wheelParts = (R, W) => ({ tyre: tyre(R, W), stripe: stripe(R, W), rim: rim(R, W) });

  // Rear wheels are merged into one piece each (they never steer)
  const rw = wheelParts(r.r, r.w);
  const rearAt = (g, z) => g.clone().translate(r.x, r.r, z);
  const rear = {
    tyre: merge([rearAt(rw.tyre, r.z), rearAt(rw.tyre, -r.z)]),
    stripe: merge([rearAt(rw.stripe, r.z), rearAt(rw.stripe, -r.z)]),
    rim: merge([rearAt(rw.rim, r.z), rearAt(rw.rim, -r.z)])
  };

  // Helmet with a dark visor across the front
  const helmet = new THREE.SphereGeometry(HELMET.r, 20, 14).translate(HELMET.x, HELMET.y, 0);
  const visor = new THREE.SphereGeometry(HELMET.r * 1.03, 16, 6, Math.PI - 0.95, 1.9, 1.15, 0.55).translate(HELMET.x, HELMET.y, 0);

  // Rear rain light (glows red)
  const rearLight = new THREE.BoxGeometry(0.4, 0.7, 1.4).translate(-26.1, 2.1, 0);

  return { mono, pods, cover, paint, carbon, halo, mirrorGlass, front: wheelParts(f.r, f.w), rear, helmet, visor, rearLight, stickers: buildStickerGeometry() };
}

/* ---------------- Sponsor stickers (shared by all cars) ----------------
   All sponsor logos are drawn onto ONE picture (an "atlas") and stuck on
   small flat pieces placed on the wings. Names are made up for E1. */
const STICKERS = [
  { text: 'ZENITH', color: '#ffffff', bg: '#111111' },      // 0 rear wing top
  { text: 'E1', color: '#ffcc00', bg: null },               // 1 rear wing end plates
  { text: 'APEX TYRES', color: '#ffffff', bg: '#c8170c' },  // 2 front wing flaps
  { text: 'NEXA FUEL', color: '#111111', bg: '#ffcc00' }    // 3 front wing end plates
];

function buildStickerAtlas() {
  const W = 512, rowH = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = rowH * STICKERS.length;
  const g = c.getContext('2d');
  STICKERS.forEach((s, i) => {
    const y = i * rowH;
    if (s.bg) { g.fillStyle = s.bg; roundRect(g, 4, y + 6, W - 8, rowH - 12, 10); g.fill(); }
    g.fillStyle = s.color;
    g.font = `italic bold ${rowH * 0.62}px "Russo One", Arial Black, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.text, W / 2, y + rowH / 2 + 2, W - 30);
  });
  return c;
}

// A flat sticker. u/v = which way the text runs / which way is "up" for the letters.
function stickerPlane(index, width, height, centre, uDir, vDir) {
  const g = new THREE.PlaneGeometry(width, height);
  const n = STICKERS.length, uvs = g.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setY(i, (n - 1 - index + uvs.getY(i)) / n);
  const U = new THREE.Vector3(...uDir), V = new THREE.Vector3(...vDir);
  const N = U.clone().cross(V);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(U, V, N));
  g.translate(...centre);
  return g;
}

function buildStickerGeometry() {
  return merge([
    stickerPlane(0, 7.2, 1.4, [-22.25, 7.15, 0], [0, 0, 1], [1, 0, 0]),       // rear wing (read from behind)
    stickerPlane(1, 3.2, 1.6, [-22.3, 6.0, 4.62], [1, 0, 0], [0, 1, 0]),      // rear end plate, right side
    stickerPlane(1, 3.2, 1.6, [-22.3, 6.0, -4.62], [-1, 0, 0], [0, 1, 0]),    // rear end plate, left side
    stickerPlane(2, 4.6, 0.75, [21.1, 2.3, 5.4], [0, 0, 1], [1, 0, 0]),       // front wing flaps
    stickerPlane(2, 4.6, 0.75, [21.1, 2.3, -5.4], [0, 0, 1], [1, 0, 0]),
    stickerPlane(3, 4.4, 1.0, [22.4, 1.9, 8.75], [1, 0, 0], [0, 1, 0]),       // front end plates
    stickerPlane(3, 4.4, 1.0, [22.4, 1.9, -8.75], [-1, 0, 0], [0, 1, 0])
  ]);
}

/* ---------------- Livery (paint job) drawn per car ---------------- */

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Pick colors that look good with the player's main color
function palette(hex) {
  const c = new THREE.Color(hex);
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const dark = lum > 0.55;
  return {
    main: hex,
    accent: dark ? '#14161c' : '#ffffff',          // stripes
    text: dark ? '#14161c' : '#ffffff',            // sponsor writing
    deep: '#' + c.clone().multiplyScalar(0.55).getHexString() // darker shade of the main color
  };
}

// Write text on the body so it reads correctly from the outside.
// side: 'right' (+z), 'left' (-z) or 'top'.  (u, v) = centre position (0-1).
function bodyText(g, W, H, text, u, v, size, color, side, maxW) {
  g.save();
  g.translate(u * W, v * H);
  if (side === 'right') g.scale(1, -1);       // on the right side "up" is towards smaller v
  else if (side === 'left') g.scale(-1, 1);   // on the left side the length runs backwards
  else if (side === 'top') g.rotate(Math.PI / 2);
  g.fillStyle = color;
  g.font = `italic bold ${size}px "Russo One", Arial Black, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 0, 0, maxW);
  g.restore();
}

// x position on the car -> u on that part's texture
const uOf = (x, x0, x1) => (x - x0) / (x1 - x0);

function liveryTextures(colorHex, number, name) {
  const P = palette(colorHex);
  const make = (W, H, draw) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    draw(g, W, H);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;          // row 0 of the picture = v 0 (bottom of the body)
    t.anisotropy = 4;
    return t;
  };
  const carbonBottom = (g, W, H) => {   // the underside is bare carbon
    g.fillStyle = '#1b1c20';
    g.fillRect(0, 0, W, H * 0.14);
    g.fillRect(0, H * 0.86, W, H * 0.14);
  };

  // Driver's tub + nose: x from -9 to 24.8
  const mono = make(1024, 256, (g, W, H) => {
    const u = x => uOf(x, -9, 24.8) * W;
    g.fillStyle = P.main; g.fillRect(0, 0, W, H);
    carbonBottom(g, W, H);
    // side stripes running along the nose
    g.fillStyle = P.deep;
    g.fillRect(u(-9), H * 0.17, W, H * 0.05);
    g.fillRect(u(-9), H * 0.78, W, H * 0.05);
    // thin stripe along the top of the nose
    g.fillStyle = P.accent;
    g.fillRect(u(4), H * 0.485, u(24.8) - u(4), H * 0.03);
    // cockpit opening (dark)
    g.fillStyle = '#0b0b0d';
    g.beginPath(); g.ellipse(u(-2.4), H * 0.5, u(2.2) - u(-2.4) + 40, H * 0.11, 0, 0, Math.PI * 2); g.fill();
    // sponsor on the nose sides, number on top of the nose
    bodyText(g, W, H, 'VOLT', uOf(12, -9, 24.8), 0.3, 34, P.text, 'right', 220);
    bodyText(g, W, H, 'VOLT', uOf(12, -9, 24.8), 0.7, 34, P.text, 'left', 220);
    bodyText(g, W, H, String(number), uOf(16.5, -9, 24.8), 0.5, 40, P.text, 'top', 60);
    // driver's name, small, beside the cockpit
    bodyText(g, W, H, name.toUpperCase(), uOf(3.2, -9, 24.8), 0.33, 20, P.text, 'right', 150);
    bodyText(g, W, H, name.toUpperCase(), uOf(3.2, -9, 24.8), 0.67, 20, P.text, 'left', 150);
  });

  // Sidepods: x from -15 to 3.6
  const pods = make(512, 256, (g, W, H) => {
    const u = x => uOf(x, -15, 3.6) * W;
    g.fillStyle = P.main; g.fillRect(0, 0, W, H);
    carbonBottom(g, W, H);
    g.fillStyle = P.deep;
    g.fillRect(0, H * 0.14, W, H * 0.05); g.fillRect(0, H * 0.81, W, H * 0.05);
    g.fillStyle = '#0b0b0d';                       // air intakes at the front
    g.fillRect(u(2.9), 0, W - u(2.9), H);
    bodyText(g, W, H, 'NEXA FUEL', uOf(-5.5, -15, 3.6), 0.24, 30, P.text, 'right', 280);
    bodyText(g, W, H, 'NEXA FUEL', uOf(-5.5, -15, 3.6), 0.76, 30, P.text, 'left', 280);
  });

  // Engine cover: x from -24 to -5.9
  const cover = make(512, 256, (g, W, H) => {
    const u = x => uOf(x, -24, -5.9) * W;
    g.fillStyle = P.main; g.fillRect(0, 0, W, H);
    carbonBottom(g, W, H);
    g.fillStyle = P.accent;
    g.fillRect(0, H * 0.48, u(-9), H * 0.04);      // stripe along the top
    g.fillStyle = '#0b0b0d';                       // airbox intake above the driver
    g.fillRect(u(-6.6), H * 0.35, W - u(-6.6), H * 0.3);
    bodyText(g, W, H, 'TURBOX', uOf(-17.5, -24, -5.9), 0.33, 30, P.text, 'right', 200);
    bodyText(g, W, H, 'TURBOX', uOf(-17.5, -24, -5.9), 0.67, 30, P.text, 'left', 200);
    bodyText(g, W, H, String(number), uOf(-12, -24, -5.9), 0.25, 46, P.text, 'right', 90);
    bodyText(g, W, H, String(number), uOf(-12, -24, -5.9), 0.75, 46, P.text, 'left', 90);
    bodyText(g, W, H, 'SKYLINE', uOf(-17, -24, -5.9), 0.5, 26, P.text, 'top', 120);
  });

  // Halo: dark with a sponsor name along it
  const halo = (() => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#17181c'; g.fillRect(0, 0, 512, 64);
    g.fillStyle = P.main; g.fillRect(150, 0, 212, 64);
    g.fillStyle = P.text;
    g.font = 'italic bold 30px "Russo One", Arial Black, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // flipped so it reads the right way up from the driver's seat
    g.translate(256, 32); g.scale(-1, -1);
    g.fillText('ZENITH', 0, 0, 200);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  // Helmet: main color with a white stripe over the top
  const helmet = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = P.main; g.fillRect(0, 0, 256, 128);
    g.fillStyle = P.accent === '#ffffff' ? '#ffffff' : '#ffcc00';
    g.fillRect(0, 0, 256, 18);                      // crown
    g.fillRect(124, 0, 8, 70); g.fillRect(0, 0, 4, 70); g.fillRect(252, 0, 4, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  return { mono, pods, cover, halo, helmet };
}

/* ---------------- Materials ---------------- */

let SHARED = null;
function sharedMaterials(quality) {
  if (SHARED && SHARED.quality === quality) return SHARED;
  const std = quality !== 'low';
  const M = opts => std ? new THREE.MeshStandardMaterial(opts) : new THREE.MeshLambertMaterial(opts);

  // A small woven carbon-fiber pattern
  const cc = document.createElement('canvas');
  cc.width = cc.height = 64;
  const g = cc.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#2a2c31' : '#1c1d21';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  const carbonTex = new THREE.CanvasTexture(cc);
  carbonTex.wrapS = carbonTex.wrapT = THREE.RepeatWrapping;
  carbonTex.repeat.set(6, 6);
  carbonTex.colorSpace = THREE.SRGBColorSpace;

  const stickerTex = new THREE.CanvasTexture(buildStickerAtlas());
  stickerTex.colorSpace = THREE.SRGBColorSpace;
  stickerTex.anisotropy = 4;

  SHARED = {
    quality,
    carbon: M(std ? { map: carbonTex, roughness: 0.38, metalness: 0.25 } : { map: carbonTex }),
    tyre: M(std ? { color: '#151515', roughness: 0.92, metalness: 0 } : { color: '#151515' }),
    stripe: M(std ? { color: '#ffd21f', roughness: 0.7 } : { color: '#ffd21f' }),
    rim: M(std ? { color: '#2c2e33', roughness: 0.3, metalness: 0.85 } : { color: '#3a3c42' }),
    visor: M(std ? { color: '#0a0a0c', roughness: 0.08, metalness: 0.6 } : { color: '#0a0a0c' }),
    mirror: M(std ? { color: '#7a8a99', roughness: 0.1, metalness: 0.9 } : { color: '#7a8a99' }),
    // brighter than white on purpose, so the glow (bloom) effect makes it shine
    rearLight: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.35, 0.2) }),
    sticker: M(std ? { map: stickerTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }
                   : { map: stickerTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 })
  };
  Object.values(SHARED).forEach(m => { if (m && m.isMaterial) m.userData.shared = true; });
  return SHARED;
}

/* ---------------- Build one car ---------------- */

// Returns { group, frontWheels: [group, group], helmet }
export function buildCar({ colorHex, number, name, quality = 'medium' }) {
  if (!GEO) GEO = buildGeometry();
  const S = sharedMaterials(quality);
  const std = quality !== 'low';
  const tex = liveryTextures(colorHex, number, name);

  // Shiny car paint (with a clear coat on High)
  const paint = map => {
    if (!std) return new THREE.MeshLambertMaterial({ color: '#ffffff', map });
    const opts = { color: '#ffffff', map, roughness: 0.32, metalness: 0.15 };
    return quality === 'high'
      ? new THREE.MeshPhysicalMaterial({ ...opts, clearcoat: 0.8, clearcoatRoughness: 0.15 })
      : new THREE.MeshStandardMaterial(opts);
  };
  const plainPaint = std
    ? new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.32, metalness: 0.15 })
    : new THREE.MeshLambertMaterial({ color: colorHex });

  const group = new THREE.Group();
  const add = (geo, mat, parent = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.userData.sharedGeo = true;   // the shape is shared by every car - don't delete it
    parent.add(m);
    return m;
  };

  add(GEO.mono, paint(tex.mono));
  add(GEO.pods, paint(tex.pods));
  add(GEO.cover, paint(tex.cover));
  add(GEO.paint, plainPaint);
  add(GEO.carbon, S.carbon);
  add(GEO.halo, std ? new THREE.MeshStandardMaterial({ map: tex.halo, roughness: 0.35, metalness: 0.3 }) : new THREE.MeshLambertMaterial({ map: tex.halo }));
  add(GEO.mirrorGlass, S.mirror);
  add(GEO.stickers, S.sticker).castShadow = false;
  add(GEO.rear.tyre, S.tyre);
  add(GEO.rear.stripe, S.stripe);
  add(GEO.rear.rim, S.rim);
  add(GEO.rearLight, S.rearLight).castShadow = false;
  const helmet = add(GEO.helmet, std ? new THREE.MeshStandardMaterial({ map: tex.helmet, roughness: 0.25, metalness: 0.1 }) : new THREE.MeshLambertMaterial({ map: tex.helmet }));
  const visor = add(GEO.visor, S.visor);

  // Front wheels are separate so they can turn when steering
  const F = WHEELS.front;
  const frontWheels = [F.z, -F.z].map(z => {
    const w = new THREE.Group();
    w.position.set(F.x, F.r, z);
    add(GEO.front.tyre, S.tyre, w);
    add(GEO.front.stripe, S.stripe, w);
    add(GEO.front.rim, S.rim, w);
    group.add(w);
    return w;
  });

  return { group, frontWheels, helmet, visor };
}

/* ---------------- Cockpit (only for my own car) ----------------
   A modern steering wheel with a small screen (gear, speed, lap, position),
   15 rev lights across the top (green, red, blue), colored buttons and
   rotary knobs, held by the driver's gloves. The arms are in the car color.
   Local directions of the wheel: x = right, y = up, z = towards the driver. */
export function buildCockpit({ colorHex, quality = 'medium' }) {
  const std = quality !== 'low';
  const M = o => std ? new THREE.MeshStandardMaterial(o) : new THREE.MeshLambertMaterial({ color: o.color, map: o.map });
  const carbon = sharedMaterials(quality).carbon;
  const rubber = M({ color: '#1d1e22', roughness: 0.9 });

  // Wheel body: a rounded plate with handles on both sides
  const plate = new THREE.Shape();
  const r = 0.22, x0 = -0.95, x1 = 0.95, y0 = -0.58, y1 = 0.55;
  plate.moveTo(x0 + r, y0); plate.lineTo(x1 - r, y0); plate.quadraticCurveTo(x1, y0, x1, y0 + r);
  plate.lineTo(x1, y1 - r); plate.quadraticCurveTo(x1, y1, x1 - r, y1);
  plate.lineTo(x0 + r, y1); plate.quadraticCurveTo(x0, y1, x0, y1 - r);
  plate.lineTo(x0, y0 + r); plate.quadraticCurveTo(x0, y0, x0 + r, y0);
  const body = new THREE.ExtrudeGeometry(plate, { depth: 0.22, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3 }).translate(0, 0, -0.22);

  const inner = new THREE.Group();   // this part turns when steering
  inner.add(new THREE.Mesh(body, carbon));
  [-1, 1].forEach(s => {
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.95, 6, 10), rubber);
    grip.position.set(s * 1.15, -0.02, -0.08);
    grip.rotation.z = s * 0.12;
    inner.add(grip);
  });

  // Screen (drawn on a small canvas and updated while driving)
  const sc = document.createElement('canvas');
  sc.width = 256; sc.height = 128;
  const screenTex = new THREE.CanvasTexture(sc);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.49), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 0.02, 0.085);   // just in front of the wheel face
  inner.add(screen);

  // Rev lights: 5 green, 5 red, 5 blue
  const revLights = [];
  const revColors = ['#19ff4a', '#19ff4a', '#19ff4a', '#19ff4a', '#19ff4a', '#ff2a1a', '#ff2a1a', '#ff2a1a', '#ff2a1a', '#ff2a1a', '#3a66ff', '#3a66ff', '#3a66ff', '#3a66ff', '#3a66ff'];
  const ledGeo = new THREE.SphereGeometry(0.045, 8, 6);
  revColors.forEach((c, i) => {
    const led = new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ color: '#202020', toneMapped: false }));
    led.position.set(-0.7 + i * 0.1, 0.42, 0.08);
    led.userData.on = new THREE.Color(c).multiplyScalar(3);   // extra bright so it glows
    led.userData.off = new THREE.Color('#1c1c1c');
    inner.add(led);
    revLights.push(led);
  });

  // Buttons and rotary knobs
  const btnColors = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ff9500', '#ffffff'];
  const btnGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12).rotateX(Math.PI / 2);
  [[-0.62, -0.18], [-0.62, -0.38], [0.62, -0.18], [0.62, -0.38], [-0.4, 0.3], [0.4, 0.3]].forEach(([x, y], i) => {
    const b = new THREE.Mesh(btnGeo, new THREE.MeshBasicMaterial({ color: btnColors[i] }));
    b.position.set(x, y, 0.07);
    inner.add(b);
  });
  const knobGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.09, 14).rotateX(Math.PI / 2);
  const knobMat = M({ color: '#5a5d63', metalness: 0.8, roughness: 0.3 });
  [[-0.25, -0.42], [0, -0.45], [0.25, -0.42]].forEach(([x, y]) => {
    const k = new THREE.Mesh(knobGeo, knobMat);
    k.position.set(x, y, 0.08);
    inner.add(k);
  });
  // Gear-shift paddles behind the wheel
  [-1, 1].forEach(s => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.04), carbon);
    p.position.set(s * 0.62, 0.1, -0.33);
    inner.add(p);
  });

  // Gloves holding the handles, with arms going back towards the driver
  const P = palette(colorHex);
  const glove = M({ color: P.main, roughness: 0.75 });
  const gloveDark = M({ color: '#18191c', roughness: 0.8 });
  const suit = M({ color: P.main, roughness: 0.85 });
  [-1, 1].forEach(s => {
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10).scale(1, 1.25, 1.05), glove);
    palm.position.set(0, 0, 0.12);
    hand.add(palm);
    for (let f = 0; f < 4; f++) {   // fingers wrapped round the front of the handle
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.26, 4, 8), f % 2 ? glove : gloveDark);
      finger.rotation.z = Math.PI / 2;
      finger.position.set(-s * 0.12, 0.3 - f * 0.17, -0.12);
      hand.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 4, 8), gloveDark);
    thumb.position.set(-s * 0.2, 0.28, 0.05);
    thumb.rotation.z = s * 0.9;
    hand.add(thumb);
    hand.position.set(s * 1.15, -0.02, 0);
    inner.add(hand);
    // forearm from the wrist back and down towards the driver
    const wrist = new THREE.Vector3(s * 1.2, -0.25, 0.25), elbow = new THREE.Vector3(s * 1.55, -1.5, 2.6);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, wrist.distanceTo(elbow), 6, 10), suit);
    arm.position.copy(wrist).add(elbow).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), elbow.clone().sub(wrist).normalize());
    inner.add(arm);
  });

  // The pivot holds the wheel in front of the driver
  const pivot = new THREE.Group();
  pivot.add(inner);
  // steering column going forwards into the car
  pivot.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8).rotateX(Math.PI / 2).translate(0, 0, -1.2), carbon));

  const g = sc.getContext('2d');
  let last = '';
  function updateScreen(d) {
    const key = [d.gear, d.speed, d.lap, d.laps, d.pos].join('|');
    if (key === last) return;
    last = key;
    g.fillStyle = '#05070a'; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#2a2f38'; g.lineWidth = 2; g.strokeRect(2, 2, 252, 124);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.font = 'bold 76px "Russo One", Arial';
    g.fillText(String(d.gear), 128, 66);
    g.font = 'bold 26px Arial'; g.fillStyle = '#19ff4a';
    g.fillText(String(d.speed), 46, 46);
    g.font = '13px Arial'; g.fillStyle = '#9aa3b5'; g.fillText('KM/H', 46, 72);
    g.font = 'bold 24px Arial'; g.fillStyle = '#ffcc00';
    g.fillText('P' + d.pos, 210, 40);
    g.font = 'bold 18px Arial'; g.fillStyle = '#ffffff';
    g.fillText(Math.min(d.lap, d.laps) + '/' + d.laps, 210, 80);
    g.font = '12px Arial'; g.fillStyle = '#9aa3b5'; g.fillText('LAP', 210, 102);
    screenTex.needsUpdate = true;
  }
  function updateRevs(rpm) {
    const lit = Math.max(0, Math.min(15, Math.round(((rpm - 0.55) / 0.42) * 15)));
    const flash = rpm > 0.985 && (Math.floor(performance.now() / 80) % 2 === 0);
    revLights.forEach((l, i) => l.material.color.copy(flash || i < lit ? l.userData.on : l.userData.off));
  }

  return { pivot, inner, updateScreen, updateRevs };
}
