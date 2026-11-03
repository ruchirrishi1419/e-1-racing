/* =====================================================================
   E1 (EQUATION 1) - 3D TRACK
   ---------------------------------------------------------------------
   Builds everything that belongs to the circuit itself:
     - the ground (with hills, and banked corners on the Oval)
     - the road surface with real asphalt texture, white edge lines,
       red-and-white kerbs, blue/red striped run-off and gravel traps
     - the start/finish line, grid boxes and tyre marks
     - barriers: tyre walls on corners, metal guardrails with sponsor
       boards, concrete walls in the city, and tall catch fences
     - the racing line (green / yellow / red driving assist)

   Heights: the game's physics is flat (2D). The 3D world adds hills on
   top, using one "height map" so the road, cars and buildings all agree.
   ===================================================================== */

import * as THREE from 'three';

/* ---------------- Textures (Poly Haven CC0, see assets/CREDITS.md) ---------------- */
const loader = new THREE.TextureLoader();
const texCache = new Map();
export function tex(name, repeat = 1, isColor = true) {
  const key = name + (isColor ? '' : ':lin');
  if (!texCache.has(key)) {
    const t = loader.load(`assets/textures/${name}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    texCache.set(key, t);
  }
  const t = texCache.get(key).clone();   // clones share the picture, but can repeat differently
  t.repeat.set(repeat, repeat);
  t.userData.shared = true;
  return t;
}

// The asphalt photo, turned into a neutral gray (real race tracks are gray, not brown).
// mean = average brightness (0-255), contrast = how strong the little details are.
export function grayTex(name, mean = 118, contrast = 1.25) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const img = new Image();
  img.onload = () => {
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 512, 512);
    const d = g.getImageData(0, 0, 512, 512), p = d.data;
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) sum += 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
    const avg = sum / (p.length / 4);
    for (let i = 0; i < p.length; i += 4) {
      const l = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
      const v = Math.max(0, Math.min(255, mean + (l - avg) * contrast));
      p[i] = p[i + 1] = v; p[i + 2] = Math.min(255, v + 3);   // a tiny cool tint, like fresh tarmac
    }
    g.putImageData(d, 0, 0);
    t.needsUpdate = true;
  };
  img.src = 'assets/textures/' + name + '.jpg';
  return t;
}

// Simple canvas texture helper
export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// Made-up sponsor names (no real brands)
export const SPONSORS = [
  { name: 'E1', bg: '#c8170c', fg: '#ffcc00' },
  { name: 'TURBOX', bg: '#111318', fg: '#ff3b30' },
  { name: 'NEXA FUEL', bg: '#ffcc00', fg: '#111318' },
  { name: 'VOLT', bg: '#0f5cd6', fg: '#ffffff' },
  { name: 'SKYLINE', bg: '#ffffff', fg: '#0f2a5c' },
  { name: 'APEX TYRES', bg: '#1b1b1b', fg: '#ffd21f' },
  { name: 'ZENITH', bg: '#6a1bb5', fg: '#ffffff' },
  { name: 'ORBITA', bg: '#00a3a3', fg: '#ffffff' },
  { name: 'KRONO WATCHES', bg: '#0d1f2d', fg: '#e6c065' },
  { name: 'FLUX ENERGY', bg: '#12a150', fg: '#ffffff' }
];

// A long strip of sponsor boards (used on barriers, grandstands, bridges)
let adTexture = null;
export function adStrip() {
  if (adTexture) return adTexture;
  adTexture = canvasTex(2560, 128, (g, w, h) => {
    const pw = w / SPONSORS.length;
    SPONSORS.forEach((s, i) => {
      g.fillStyle = s.bg; g.fillRect(i * pw, 0, pw, h);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(i * pw, 0, pw, h * 0.18);
      g.fillStyle = s.fg;
      g.font = 'italic bold 64px "Russo One", Arial Black, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s.name, i * pw + pw / 2, h / 2 + 4, pw - 24);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(i * pw, 0, 3, h);
    });
  }, { repeat: true });
  adTexture.userData.shared = true;
  return adTexture;
}

/* ---------------- Small math helpers ---------------- */
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Smooth random hills (the same every time for a given seed)
function makeNoise(seed) {
  const rnd = (x, y) => {
    let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const value = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi), b = rnd(xi + 1, yi), c = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => value(x / 1700, y / 1700) * 0.6 + value(x / 650, y / 650) * 0.3 + value(x / 230, y / 230) * 0.1;
}

/* ---------------- Track information used by everything else ---------------- */
// For every centre-line point: sideways direction, turning direction and "is this a corner?"
export function analyse(track) {
  const P = track.path, n = P.length;
  const ang = i => { const a = P[(i + n) % n], b = P[(i + 1 + n) % n]; return Math.atan2(b.y - a.y, b.x - a.x); };
  const info = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty) || 1;
    let d = ang(i + 8) - ang(i - 8);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // turn > 0 means turning right (clockwise on the map); the "outside" is then the left side
    info.push({ x: P[i].x, y: P[i].y, nx: -ty / len, ny: tx / len, turn: d, corner: false });
  }
  for (let i = 0; i < n; i++) {
    if (Math.abs(info[i].turn) > 0.13) for (let k = -6; k <= 6; k++) info[(i + k + n) % n].corner = true;
  }
  // Group corner points into individual corners
  const corners = [];
  let i0 = info.findIndex(p => !p.corner);
  if (i0 < 0) i0 = 0;
  let cur = null;
  for (let k = 0; k <= n; k++) {
    const i = (i0 + k) % n;
    if (info[i].corner && k < n) {
      if (!cur) cur = { start: i, total: 0, apex: i, peak: 0 };
      cur.total += info[i].turn / 16;
      if (Math.abs(info[i].turn) > cur.peak) { cur.peak = Math.abs(info[i].turn); cur.apex = i; }
      cur.end = i;
    } else if (cur) {
      cur.outside = cur.total > 0 ? -1 : 1;     // which side is the outside of the corner
      cur.angle = Math.abs(cur.total);
      corners.push(cur);
      cur = null;
    }
  }
  return { info, corners };
}

/* ---------------- Height map ---------------- */
// Returns heightAt(x, y) for the whole world, plus distance-to-track for placing things
export function buildHeights(track, an) {
  const CELL = 40, PAD = 2600;
  const x0 = -PAD, y0 = -PAD;
  const cols = Math.ceil((track.width + PAD * 2) / CELL) + 1, rows = Math.ceil((track.height + PAD * 2) / CELL) + 1;
  const best = new Float32Array(cols * rows).fill(1e9);  // distance from the centre line
  const offs = new Float32Array(cols * rows), idx = new Int32Array(cols * rows).fill(-1);
  const P = track.path, n = P.length, hw = track.halfWidth, wall = hw + track.runoff;
  const reach = wall + 1100;

  // "Paint" every point near the track with its distance and side from the centre line
  for (let i = 0; i < n; i += 2) {
    const s = an.info[i];
    for (let o = -reach; o <= reach; o += 20) {
      const gx = Math.round((s.x + s.nx * o - x0) / CELL), gy = Math.round((s.y + s.ny * o - y0) / CELL);
      if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
      const c = gy * cols + gx;
      if (Math.abs(o) < best[c]) { best[c] = Math.abs(o); offs[c] = o; idx[c] = i; }
    }
  }

  // Track elevation: smooth ups and downs along the lap (Mountain Pass, Grand Prix)
  const elev = i => track.elevation * (0.6 * Math.sin(2 * Math.PI * 3 * i / n + 0.5) + 0.4 * Math.sin(2 * Math.PI * 7 * i / n + 2.0));
  // Banking on the Oval: only the big fast corners lean inwards
  const bankWeight = new Float32Array(n);
  if (track.banked) {
    for (let i = 0; i < n; i++) {
      const t = Math.abs(an.info[i].turn);                 // turn over 160 units
      bankWeight[i] = smooth(0.02, 0.05, t) * (1 - smooth(0.22, 0.3, t));
    }
    // smooth it out along the track
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n; i++)
      bankWeight[i] = (bankWeight[(i - 20 + n) % n] + bankWeight[i] + bankWeight[(i + 20) % n]) / 3;
  }
  const noise = makeNoise(track.id + 7);

  const H = new Float32Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const c = gy * cols + gx, x = x0 + gx * CELL, y = y0 + gy * CELL;
      const d = best[c];
      let trackH = 0;
      if (idx[c] >= 0) {
        const i = idx[c], o = offs[c];
        trackH = elev(i);
        if (track.banked && bankWeight[i] > 0) {
          const outside = Math.sign(an.info[i].turn) > 0 ? -1 : 1;   // turning right -> left side is outside
          const along = Math.max(0, Math.min(wall + 40, o * outside));
          trackH += bankWeight[i] * along * 0.19;                   // about 11 degrees of banking
        }
      }
      const hills = track.hills * noise(x, y);
      const f = smooth(wall + 70, wall + 900, d);
      H[c] = trackH * (1 - f) + (hills + (idx[c] >= 0 ? trackH * 0.35 : 0)) * f;
    }
  }

  function heightAt(x, y) {
    const fx = (x - x0) / CELL, fy = (y - y0) / CELL;
    const gx = Math.max(0, Math.min(cols - 2, Math.floor(fx))), gy = Math.max(0, Math.min(rows - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - gx)), ty = Math.max(0, Math.min(1, fy - gy));
    const c = gy * cols + gx;
    const a = H[c], b = H[c + 1], d = H[c + cols], e = H[c + cols + 1];
    return (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
  }
  function distAt(x, y) {
    const gx = Math.round((x - x0) / CELL), gy = Math.round((y - y0) / CELL);
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return 1e9;
    return best[gy * cols + gx];
  }
  return { heightAt, distAt, bounds: { x0, y0, x1: x0 + (cols - 1) * CELL, y1: y0 + (rows - 1) * CELL } };
}

/* ---------------- Ribbon: a strip of road-like surface along the track ---------------- */
// from/to = sideways distance from the centre line (negative = left side).
// segments = list of [startIndex, endIndex] ranges along the track.
function ribbon(track, an, heightAt, ranges, from, to, lift, uvMode) {
  const pos = [], uv = [], index = [];
  const n = track.path.length;
  ranges.forEach(([a, b]) => {
    const count = ((b - a + n) % n) + 1;
    const base = pos.length / 3;
    for (let k = 0; k < count; k++) {
      const i = (a + k) % n, s = an.info[i];
      const v = track.cum[i];
      for (const o of [from, to]) {
        const x = s.x + s.nx * o, y = s.y + s.ny * o;
        pos.push(x, heightAt(x, y) + lift, y);
        if (uvMode === 'tile') uv.push((o - from) / 120, v / 120);
        else uv.push(o === from ? 0 : 1, v / (uvMode || 10));
      }
      if (k > 0) {
        const p = base + (k - 1) * 2;
        index.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);   // counter-clockwise seen from above = faces up
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Ranges of track indices where a condition is true (e.g. "is a corner")
function rangesWhere(n, test) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && test(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push([start, i - 1]); start = -1; }
  }
  return out;
}

/* ---------------- Build the whole track ---------------- */
// ctx: { scene, track, quality ('low'|'medium'|'high'), renderer }
export function buildTrack(ctx) {
  const { scene, track } = ctx;
  const std = ctx.quality !== 'low';
  const an = analyse(track);
  const hm = buildHeights(track, an);
  const { heightAt } = hm;
  const n = track.path.length, hw = track.halfWidth, wall = hw + track.runoff;
  const M = (o) => std ? new THREE.MeshStandardMaterial(o) : new THREE.MeshLambertMaterial(stripStd(o));
  const nightMaterials = [];      // things that glow at night (sponsor boards)
  const group = new THREE.Group();
  scene.add(group);

  /* --- Ground --- */
  const groundTex = { grass: 'sparse_grass', sand: 'aerial_sand', rock: 'sparse_grass', concrete: 'concrete_floor' }[track.theme.ground] || 'sparse_grass';
  const B = hm.bounds;
  const GW = B.x1 - B.x0, GH = B.y1 - B.y0;
  const step = ctx.quality === 'high' ? 50 : ctx.quality === 'medium' ? 70 : 100;
  const terrain = new THREE.PlaneGeometry(GW, GH, Math.round(GW / step), Math.round(GH / step));
  terrain.rotateX(-Math.PI / 2);
  terrain.translate(B.x0 + GW / 2, 0, B.y0 + GH / 2);
  const tp = terrain.attributes.position, colors = [];
  const rockColor = new THREE.Color('#8a8176'), base = new THREE.Color('#ffffff');
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), y = tp.getZ(i);
    let h = heightAt(x, y);
    if (hm.distAt(x, y) < hw + 20) h -= 1.2;          // keep the grass under the road
    tp.setY(i, h);
    // Mountain Pass: rocky colour on the high slopes
    const c = base.clone();
    if (track.theme.ground === 'rock') c.lerp(rockColor, smooth(80, 320, h));
    colors.push(c.r, c.g, c.b);
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // UVs for the repeating ground texture (one tile every 160 units)
  const tuv = terrain.attributes.uv;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tp.getX(i) / 160, tp.getZ(i) / 160);
  terrain.computeVertexNormals();
  const groundMat = M({ map: tex(groundTex + '_diff'), normalMap: std ? tex(groundTex + '_nor', 1, false) : null, vertexColors: true, roughness: 0.95, metalness: 0 });
  if (track.theme.ground === 'concrete') groundMat.color = new THREE.Color('#b8bcc4');
  if (groundTex === 'sparse_grass') groundMat.color = new THREE.Color('#9fd27c');   // a fresher green
  const ground = new THREE.Mesh(terrain, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  /* --- Road --- */
  const all = [[0, n - 1], [n - 1, 0]];
  const asphalt = M({ map: grayTex('asphalt_track_diff'), normalMap: std ? tex('asphalt_track_nor', 1, false) : null, roughness: 0.82, metalness: 0, color: '#ffffff' });
  const road = new THREE.Mesh(ribbon(track, an, heightAt, all, -hw, hw, 0.6, 'tile'), asphalt);
  road.receiveShadow = true;
  group.add(road);

  // White edge lines
  const white = M({ color: '#f2f2f2', roughness: 0.6 });
  [[-hw + 1.5, -hw + 4.5], [hw - 4.5, hw - 1.5]].forEach(([a, b]) => {
    const m = new THREE.Mesh(ribbon(track, an, heightAt, all, a, b, 0.75), white);
    m.receiveShadow = true; group.add(m);
  });

  // Red-and-white kerbs on the corners (both sides)
  const kerbTex = canvasTex(64, 64, (g) => { g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#d62a20'; g.fillRect(0, 0, 64, 32); }, { repeat: true });
  const kerbMat = M({ map: kerbTex, roughness: 0.55 });
  const cornerRanges = rangesWhere(n, i => an.info[i].corner);
  [[-hw - 12, -hw + 1.5], [hw - 1.5, hw + 12]].forEach(([a, b]) => {
    const m = new THREE.Mesh(ribbon(track, an, heightAt, cornerRanges, a, b, 0.95, 24), kerbMat);
    m.receiveShadow = true; group.add(m);
  });

  // Outside of corners: blue/red striped run-off, then gravel trap
  const stripeTex = canvasTex(64, 128, (g) => {
    g.fillStyle = '#1f5fd1'; g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#d62a20'; g.fillRect(0, 88, 64, 40);
  }, { repeat: true });
  const stripeMat = M({ map: stripeTex, roughness: 0.7 });
  const gravelMat = M({ map: tex('gravel_diff'), normalMap: std ? tex('gravel_nor', 1, false) : null, roughness: 1, color: '#d9cdb8' });
  [-1, 1].forEach(side => {
    const outsideRanges = rangesWhere(n, i => {
      const c = an.info[i];
      return c.corner && (c.turn > 0 ? -1 : 1) === side;
    });
    const a1 = side * (hw + 12), a2 = side * (hw + 52), a3 = side * (wall - 4);
    const stripe = new THREE.Mesh(ribbon(track, an, heightAt, outsideRanges, Math.min(a1, a2), Math.max(a1, a2), 0.55, 60), stripeMat);
    stripe.receiveShadow = true; group.add(stripe);
    if (Math.abs(a3) > Math.abs(a2) + 10 && track.theme.ground !== 'concrete') {
      const gravel = new THREE.Mesh(ribbon(track, an, heightAt, outsideRanges, Math.min(a2, a3), Math.max(a2, a3), 0.4, 'tile'), gravelMat);
      gravel.receiveShadow = true; group.add(gravel);
    }
  });

  // City Circuit: concrete pavement everywhere beside the road
  if (track.theme.ground === 'concrete') {
    const pave = M({ map: tex('concrete_floor_diff'), normalMap: std ? tex('concrete_floor_nor', 1, false) : null, roughness: 0.9, color: '#9fa3aa' });
    [[-wall, -hw - 12], [hw + 12, wall]].forEach(([a, b]) => {
      const m = new THREE.Mesh(ribbon(track, an, heightAt, all, a, b, 0.3, 'tile'), pave);
      m.receiveShadow = true; group.add(m);
    });
  }

  /* --- Start/finish line and grid boxes --- */
  const chequer = canvasTex(64, 256, (g) => {
    for (let r = 0; r < 16; r++) for (let c = 0; c < 4; c++) { g.fillStyle = (r + c) % 2 ? '#111' : '#fafafa'; g.fillRect(c * 16, r * 16, 16, 16); }
  });
  const startLine = new THREE.Mesh(ribbon(track, an, heightAt, [[n - 1, 1]], -hw, hw, 0.8, 1e9), new THREE.MeshLambertMaterial({ map: chequer }));
  // rotate the picture so squares run across the road
  startLine.geometry.attributes.uv.array.forEach((v, k, arr) => { if (k % 2 === 1) arr[k] = (k / 2 | 0) % 4 < 2 ? 0 : 1; });
  group.add(startLine);
  const gridMat = new THREE.MeshLambertMaterial({ color: '#f5f5f5' });
  const gridGeo = [];
  for (let s = 0; s < 10; s++) {
    const g = Tracks.gridSlot(track, s);
    const bracket = new THREE.BoxGeometry(2.5, 0.2, 26).translate(26, 0, 0);
    const arm1 = new THREE.BoxGeometry(14, 0.2, 2.5).translate(19.5, 0, 12);
    const arm2 = new THREE.BoxGeometry(14, 0.2, 2.5).translate(19.5, 0, -12);
    [bracket, arm1, arm2].forEach(b => {
      b.rotateY(-g.angle); b.translate(g.x, heightAt(g.x, g.y) + 0.85, g.y);
      gridGeo.push(b);
    });
  }
  gridGeo.forEach(b => group.add(new THREE.Mesh(b, gridMat)));

  /* --- Tyre marks on the asphalt (braking zones and corners, along the racing line) --- */
  const line = RacingLine.get(track);
  const markTex = canvasTex(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(10,10,10,${0.12 + Math.random() * 0.25})`;
      g.fillRect(4 + Math.random() * 50, 0, 3 + Math.random() * 6, h);
    }
  }, { repeat: true });
  const markMat = new THREE.MeshLambertMaterial({ map: markTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const markPos = [], markUv = [], markIdx = [];
  const ln = line.n;
  for (let i = 0; i < ln; i++) {
    const j = (i + 1) % ln;
    const braking = line.speed[i] - line.speed[j] > 3;
    const slow = line.speed[i] < 420;
    if (!braking && !slow) continue;
    const dx = line.x[j] - line.x[i], dy = line.y[j] - line.y[i], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    for (const side of [-6.9, 6.9]) {
      const base = markPos.length / 3;
      [[i, -3], [i, 3], [j, -3], [j, 3]].forEach(([k, w]) => {
        const x = line.x[k] + nx * (side + w), y = line.y[k] + ny * (side + w);
        markPos.push(x, heightAt(x, y) + 0.7, y);
        markUv.push(w < 0 ? 0 : 1, k === i ? 0 : 0.3);
      });
      markIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const markGeo = new THREE.BufferGeometry();
  markGeo.setAttribute('position', new THREE.Float32BufferAttribute(markPos, 3));
  markGeo.setAttribute('uv', new THREE.Float32BufferAttribute(markUv, 2));
  markGeo.setIndex(markIdx);
  markGeo.computeVertexNormals();
  group.add(new THREE.Mesh(markGeo, markMat));

  /* --- Barriers --- */
  const walls = buildBarriers(ctx, track, an, hm, group, M, nightMaterials);

  /* --- Racing line (driving assist) --- */
  const racing = buildRacingLineMesh(track, line, heightAt, group);

  return { an, hm, heightAt, walls, racing, nightMaterials, group };
}

function stripStd(o) {
  const out = { ...o };
  delete out.roughness; delete out.metalness; delete out.normalMap;
  return out;
}

/* ---------------- Barriers, tyre walls, catch fences ---------------- */
function buildBarriers(ctx, track, an, hm, group, M, nightMaterials) {
  const { heightAt } = hm;
  const n = track.path.length, wallD = track.halfWidth + track.runoff;
  const city = track.theme.ground === 'concrete';
  const std = ctx.quality !== 'low';
  const sides = [];

  [1, -1].forEach(side => {
    // the wall line; drop points that fold back on the inside of tight corners
    const pts = [];
    for (let i = 0; i < n; i += 2) {
      const s = an.info[i];
      const x = s.x + s.nx * wallD * side, y = s.y + s.ny * wallD * side;
      if (Tracks.nearest(track, x, y, i).dist < wallD - 3) continue;
      const outside = s.corner && (s.turn > 0 ? -1 : 1) === side;
      pts.push({ x, y, h: heightAt(x, y), i, outside, ox: s.nx * side, oy: s.ny * side });
    }
    sides.push({ side, pts });
  });

  // Ad boards / concrete wall: a strip 7 units high (9 in the city)
  const HGT = city ? 9 : 7;
  const pos = [], uv = [], idx = [];
  const railPos = [], railIdx = [];
  const tyreSpots = [];
  sides.forEach(({ pts }) => {
    let run = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 300) continue;
      if (a.outside && !city) {
        // tyre wall on the outside of corners
        for (let t = 0; t < len; t += 7) tyreSpots.push({ x: a.x + (b.x - a.x) * t / len, y: a.y + (b.y - a.y) * t / len, h: a.h + (b.h - a.h) * t / len, ox: a.ox, oy: a.oy });
        run += len;
        continue;
      }
      const base = pos.length / 3;
      pos.push(a.x, a.h, a.y, b.x, b.h, b.y, b.x, b.h + HGT, b.y, a.x, a.h + HGT, a.y);
      const u0 = run / 160, u1 = (run + len) / 160;
      uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      if (!city) {
        // metal guardrail on top of the boards
        const rb = railPos.length / 3;
        railPos.push(a.x, a.h + HGT, a.y, b.x, b.h + HGT, b.y, b.x, b.h + HGT + 2.2, b.y, a.x, a.h + HGT + 2.2, a.y);
        railIdx.push(rb, rb + 1, rb + 2, rb, rb + 2, rb + 3);
      }
      run += len;
    }
  });
  const boardGeo = new THREE.BufferGeometry();
  boardGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  boardGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  boardGeo.setIndex(idx);
  boardGeo.computeVertexNormals();
  let boardMat;
  if (city) {
    // concrete walls with sponsor boards painted on every other panel
    const cityTex = canvasTex(1024, 128, (g, w, h) => {
      g.fillStyle = '#a7abb2'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let x = 0; x < w; x += 128) g.fillRect(x, 0, 3, h);
      const s = SPONSORS[(Math.random() * SPONSORS.length) | 0];
      [0, 2].forEach(k => {
        const sp = SPONSORS[(k * 3 + 1) % SPONSORS.length];
        g.fillStyle = sp.bg; g.fillRect(k * 256 + 20, 22, 216, 84);
        g.fillStyle = sp.fg; g.font = 'italic bold 44px "Russo One", Arial Black'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(sp.name, k * 256 + 128, 66, 200);
      });
      void s;
    }, { repeat: true });
    boardMat = M({ map: cityTex, roughness: 0.9, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: cityTex, emissiveIntensity: 0 });
  } else {
    const ad = adStrip();
    boardMat = M({ map: ad, roughness: 0.6, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: ad, emissiveIntensity: 0 });
  }
  nightMaterials.push(boardMat);
  const boards = new THREE.Mesh(boardGeo, boardMat);
  boards.receiveShadow = true;
  group.add(boards);

  if (railPos.length) {
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
    railGeo.setIndex(railIdx);
    railGeo.computeVertexNormals();
    group.add(new THREE.Mesh(railGeo, M({ color: '#c9ced6', roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide })));
  }

  // Stacked tyre walls (thousands of tyres drawn in one go with "instancing")
  if (tyreSpots.length) {
    const stack = new THREE.CylinderGeometry(3.3, 3.3, 9, 10, 1, true);
    stack.translate(0, 4.5, 0);
    const tyreMat = M({ color: '#1a1a1a', roughness: 0.95 });
    const inst = new THREE.InstancedMesh(stack, tyreMat, tyreSpots.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    tyreSpots.forEach((t, k) => {
      m.makeTranslation(t.x + t.ox * 4, t.h, t.y + t.oy * 4);
      inst.setMatrixAt(k, m);
      // every few stacks has a painted band, like real tyre walls
      inst.setColorAt(k, col.set(k % 6 === 0 ? '#d62a20' : k % 6 === 3 ? '#f2f2f2' : '#1a1a1a'));
    });
    inst.castShadow = std;
    inst.receiveShadow = true;
    group.add(inst);
    // a belt over the front of the tyres with sponsor names
    const beltPos = [], beltUv = [], beltIdx = [];
    let run = 0;
    for (let k = 0; k < tyreSpots.length - 1; k++) {
      const a = tyreSpots[k], b = tyreSpots[k + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 20) continue;
      const base = beltPos.length / 3;
      const ax = a.x + a.ox * 0.4, ay = a.y + a.oy * 0.4, bx = b.x + b.ox * 0.4, by = b.y + b.oy * 0.4;
      beltPos.push(ax, a.h + 1, ay, bx, b.h + 1, by, bx, b.h + 8, by, ax, a.h + 8, ay);
      beltUv.push(run / 160, 0, (run + len) / 160, 0, (run + len) / 160, 1, run / 160, 1);
      beltIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      run += len;
    }
    const beltGeo = new THREE.BufferGeometry();
    beltGeo.setAttribute('position', new THREE.Float32BufferAttribute(beltPos, 3));
    beltGeo.setAttribute('uv', new THREE.Float32BufferAttribute(beltUv, 2));
    beltGeo.setIndex(beltIdx);
    beltGeo.computeVertexNormals();
    group.add(new THREE.Mesh(beltGeo, boardMat));
  }

  // Tall catch fences behind the barriers (see-through wire mesh)
  const fenceTex = canvasTex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(200,205,212,0.95)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64); g.stroke();
    g.fillStyle = 'rgba(200,205,212,1)'; g.fillRect(0, 0, 64, 3);
  }, { repeat: true });
  const fencePos = [], fenceUv = [], fenceIdx = [], postSpots = [];
  const FH = city ? 26 : 30;
  sides.forEach(({ pts }) => {
    let run = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 300) continue;
      const off = a.outside && !city ? 14 : 3;
      const ax = a.x + a.ox * off, ay = a.y + a.oy * off, bx = b.x + b.ox * off, by = b.y + b.oy * off;
      const base = fencePos.length / 3;
      fencePos.push(ax, a.h + 2, ay, bx, b.h + 2, by, bx, b.h + FH, by, ax, a.h + FH, ay);
      fenceUv.push(run / 7, 0, (run + len) / 7, 0, (run + len) / 7, FH / 7, run / 7, FH / 7);
      fenceIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      if (Math.floor((run + len) / 60) !== Math.floor(run / 60)) postSpots.push({ x: ax, y: ay, h: a.h });
      run += len;
    }
  });
  const fenceGeo = new THREE.BufferGeometry();
  fenceGeo.setAttribute('position', new THREE.Float32BufferAttribute(fencePos, 3));
  fenceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fenceUv, 2));
  fenceGeo.setIndex(fenceIdx);
  fenceGeo.computeVertexNormals();
  const fence = new THREE.Mesh(fenceGeo, new THREE.MeshLambertMaterial({ map: fenceTex, alphaTest: 0.4, side: THREE.DoubleSide }));
  group.add(fence);
  const post = new THREE.CylinderGeometry(0.5, 0.5, FH, 6).translate(0, FH / 2, 0);
  const posts = new THREE.InstancedMesh(post, new THREE.MeshLambertMaterial({ color: '#8d939b' }), postSpots.length);
  const pm = new THREE.Matrix4();
  postSpots.forEach((p, k) => { pm.makeTranslation(p.x, p.h, p.y); posts.setMatrixAt(k, pm); });
  group.add(posts);

  return sides;
}

/* ---------------- Racing line mesh ---------------- */
function buildRacingLineMesh(track, line, heightAt, group) {
  const N = line.n, W = 2.6;
  const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 4), index = [];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const dx = line.x[j] - line.x[i], dy = line.y[j] - line.y[i], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    [-1, 1].forEach((s, k) => {
      const x = line.x[i] + nx * W * s, y = line.y[i] + ny * W * s;
      pos.set([x, heightAt(x, y) + 1.0, y], (i * 2 + k) * 3);
    });
    const a = i * 2, b = j * 2;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const colorAttr = new THREE.BufferAttribute(col, 4);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('color', colorAttr);
  g.setIndex(index);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, toneMapped: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  group.add(mesh);

  const AHEAD = 90;              // how many points ahead to show (about 3.5 km)
  const COLORS = [[0.15, 0.95, 0.3], [1.0, 0.85, 0.1], [1.0, 0.15, 0.12]];
  let shown = [];
  return {
    mesh,
    // Update the colors in front of the car. enabled=false hides the line.
    update(trackIndex, carSpeed, enabled) {
      shown.forEach(i => { col[i * 8 + 3] = 0; col[i * 8 + 7] = 0; });
      shown = [];
      if (enabled) {
        const start = (RacingLine.indexFor(line, trackIndex) + 1) % N;
        const cs = RacingLine.colors(line, start, carSpeed, AHEAD);
        for (let k = 0; k < AHEAD; k++) {
          const i = (start + k) % N, c = COLORS[cs[k]];
          const alpha = Math.min(1, k / 3) * (1 - smooth(AHEAD * 0.6, AHEAD, k)) * 0.85;
          for (let v = 0; v < 2; v++) col.set([c[0], c[1], c[2], alpha], (i * 2 + v) * 4);
          shown.push(i);
        }
      }
      colorAttr.needsUpdate = true;
    }
  };
}
