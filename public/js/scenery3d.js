/* =====================================================================
   E1 (EQUATION 1) - STADIUM AND SCENERY
   ---------------------------------------------------------------------
   Builds the Grand Prix venue around the track:
     Main straight: huge multi-level grandstands, pit lane with team
       garages, control tower, podium, start gantry with 5 lights and a
       big screen, flags and sponsor billboards.
     Around the track: grandstands at the big corners, spectator banks,
       TV screens, marshal posts (marshals in orange), floodlight poles,
       camera towers, tents, sponsor bridges over the track, trees, rocks,
       cacti and city buildings.
     The crowd: thousands of simple people drawn with "instancing" (the
       graphics card draws one shape many times in one go, so it stays
       fast). A small shader makes them bob, wave and stand up when a car
       goes past.
   Everything is placed BEHIND the barriers, so cars can't drive into it.
   Graphics Low / Medium / High changes how many people, trees and
   buildings there are, and how far away they are still drawn.
   ===================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, adStrip, SPONSORS } from './track3d.js';

const QUALITY = {
  low:    { crowd: 2500,  trees: 700,  buildings: 120, lod: 1700, bridges: 1 },
  medium: { crowd: 7000,  trees: 2000, buildings: 260, lod: 2700, bridges: 2 },
  high:   { crowd: 15000, trees: 4000, buildings: 420, lod: 3800, bridges: 3 }
};

// Same random numbers every time for a track (so the world doesn't change between races)
function rng(seed) {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => (s = s * 16807 % 2147483647) / 2147483647;
}

// Join shapes into one (convert them to the same format first)
function merge(list) {
  const plain = list.filter(Boolean).map(g => {
    const p = g.index ? g.toNonIndexed() : g;
    Object.keys(p.attributes).forEach(k => { if (!['position', 'normal', 'uv', 'color'].includes(k)) p.deleteAttribute(k); });
    return p;
  });
  const withColor = plain.some(p => p.attributes.color);
  plain.forEach(p => {
    if (withColor && !p.attributes.color) {
      const c = new Float32Array(p.attributes.position.count * 3).fill(1);
      p.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
  });
  return mergeGeometries(plain);
}
function colored(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/* ---------------- The crowd ---------------- */
// One person (about 15 units tall standing; seated people sink their legs into the seat row)
function personGeometry() {
  const parts = [
    { g: box(5, 7, 3, 0, 3.5, 0), arm: 0, skin: 0 },               // body (shirt)
    { g: box(4, 6, 2.6, 0, -3, 0), arm: 0, skin: 0.35 },           // legs (darker)
    { g: new THREE.IcosahedronGeometry(2.1, 0).translate(0, 9.2, 0), arm: 0, skin: 1 }, // head
    { g: box(1.4, 6, 1.4, -3.3, 4.6, 0), arm: 1, skin: 0 },        // arms
    { g: box(1.4, 6, 1.4, 3.3, 4.6, 0), arm: 1, skin: 0 }
  ];
  const geos = parts.map(p => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    const n = g.attributes.position.count;
    g.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(n).fill(p.arm), 1));
    g.setAttribute('aSkin', new THREE.BufferAttribute(new Float32Array(n).fill(p.skin), 1));
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(geos);
}

// The shared crowd material. "uCar" = where my car is, people near it get excited.
export const crowdUniforms = { uTime: { value: 0 }, uCar: { value: new THREE.Vector3() }, uCheer: { value: 0 } };
function crowdMaterial(std) {
  const m = std ? new THREE.MeshStandardMaterial({ roughness: 0.9 }) : new THREE.MeshLambertMaterial();
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, crowdUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec3 uCar; uniform float uCheer;
        attribute float aArm; attribute float aSkin; attribute float aPhase; attribute float aStand;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        float excite = clamp(smoothstep(750.0, 120.0, distance(wp.xz, uCar.xz)) + uCheer, 0.0, 1.4);
        float t = uTime * (2.2 + aPhase * 2.0) + aPhase * 40.0;
        float bob = max(0.0, sin(t)) * (0.25 + 1.8 * excite);
        transformed.y += bob + excite * 3.0 * (1.0 - aStand);                 // seated people stand up
        transformed.y += aArm * excite * (3.0 + 1.2 * sin(t * 2.3));         // arms up and waving
        transformed.x += aArm * excite * sin(t * 2.3) * 0.8 * sign(position.x);`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vec3 skin = mix(vec3(0.95, 0.76, 0.6), vec3(0.42, 0.27, 0.17), fract(aPhase * 7.13));
        vColor.xyz = mix(vColor.xyz * (1.0 - aSkin * 0.65), skin, step(0.9, aSkin));`);
  };
  m.customProgramCacheKey = () => 'e1-crowd-' + (std ? 's' : 'l');
  return m;
}

const SHIRTS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fb8c00', '#8e24aa', '#ffffff', '#212121', '#00bcd4', '#f06292', '#c8170c', '#0f5cd6', '#ffcc00'];

/* ---------------- Main builder ---------------- */
// ctx: { scene, track, quality, world: result of buildTrack() }
export function buildScenery(ctx) {
  const { scene, track, world } = ctx;
  const Q = QUALITY[ctx.quality] || QUALITY.medium;
  const std = ctx.quality !== 'low';
  const { an, hm } = world;
  const heightAt = hm.heightAt;
  const n = track.path.length, hw = track.halfWidth, wallD = hw + track.runoff;
  const rand = rng(track.id * 1000 + 17);
  const group = new THREE.Group();
  scene.add(group);
  const lodObjects = [];         // things hidden when far away: { obj, x, y, r }
  const stands = [];             // grandstand centres (for crowd noise)
  const floodlights = [];        // light positions (for night)
  const screens = [];            // TV screen materials (show the race)
  const nightMaterials = [];     // materials that glow at night
  const M = o => std ? new THREE.MeshStandardMaterial({ roughness: 0.8, ...o }) : new THREE.MeshLambertMaterial(o);

  /* --- Space bookkeeping: which ground is already used --- */
  const B = hm.bounds, CELL = 30;
  const gcols = Math.ceil((B.x1 - B.x0) / CELL), grows = Math.ceil((B.y1 - B.y0) / CELL);
  const used = new Uint8Array(gcols * grows);
  const cellOf = (x, y) => {
    const gx = Math.floor((x - B.x0) / CELL), gy = Math.floor((y - B.y0) / CELL);
    return gx < 0 || gy < 0 || gx >= gcols || gy >= grows ? -1 : gy * gcols + gx;
  };
  // check / mark a rotated rectangle (centre x,y; direction a; half length L, half depth D)
  function rectCells(x, y, a, L, D, fn) {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let u = -L; u <= L; u += 14) for (let v = -D; v <= D; v += 14) {
      if (fn(x + ca * u - sa * v, y + sa * u + ca * v) === false) return false;
    }
    return true;
  }
  function free(x, y, a, L, D, minDist = wallD + 30) {
    return rectCells(x, y, a, L, D, (px, py) => {
      const c = cellOf(px, py);
      return c >= 0 && !used[c] && hm.distAt(px, py) >= minDist;
    });
  }
  function mark(x, y, a, L, D) { rectCells(x, y, a, L, D, (px, py) => { const c = cellOf(px, py); if (c >= 0) used[c] = 1; }); }

  // A spot beside the track: index i, side (+1 right / -1 left), distance from centre line
  function spot(i, side, dist) {
    const s = an.info[(i + n) % n];
    const x = s.x + s.nx * dist * side, y = s.y + s.ny * dist * side;
    const a = Math.atan2(s.ny * side, s.nx * side) - Math.PI / 2; // local +x runs along the track
    return { x, y, a, h: heightAt(x, y), ox: s.nx * side, oy: s.ny * side };
  }
  // Put an object so its local +z points away from the track
  function place(obj, sp) {
    obj.position.set(sp.x, sp.h, sp.y);
    obj.rotation.y = -sp.a - Math.PI / 2 + Math.PI / 2;
    // local x along the track, local z away from it:
    obj.rotation.y = -Math.atan2(sp.oy, sp.ox) + Math.PI / 2;
    group.add(obj);
    return obj;
  }

  /* --- Crowd --- */
  const personGeo = personGeometry();
  const crowdMat = crowdMaterial(std);
  let crowdBudget = Q.crowd;
  // seats: list of {x, y, z} in the stand's own coordinates
  function addCrowd(parent, seats, standing, maxCount) {
    const count = Math.min(seats.length, maxCount, crowdBudget);
    if (count <= 0) return;
    crowdBudget -= count;
    const inst = new THREE.InstancedMesh(personGeo, crowdMat, count);
    const phase = new Float32Array(count), stand = new Float32Array(count).fill(standing ? 1 : 0);
    const m = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const step = seats.length / count;
    for (let k = 0; k < count; k++) {
      const s = seats[Math.floor(k * step + rand() * step * 0.9)];
      e.set(0, (rand() - 0.5) * 0.5, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(s.x + (rand() - 0.5) * 1.5, s.y, s.z), q, new THREE.Vector3(1, 0.9 + rand() * 0.2, 1));
      inst.setMatrixAt(k, m);
      inst.setColorAt(k, c.set(SHIRTS[(rand() * SHIRTS.length) | 0]));
      phase[k] = rand();
    }
    inst.geometry = personGeo.clone();
    inst.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    inst.geometry.setAttribute('aStand', new THREE.InstancedBufferAttribute(stand, 1));
    inst.computeBoundingSphere();
    inst.layers.set(1);  // the mirrors and TV cameras skip the crowd (faster)
    parent.add(inst);
    // some fans wave flags
    const flagCount = Math.floor(count * 0.04);
    if (flagCount > 0) {
      const flagGeo = merge([box(0.4, 9, 0.4, 0, 14, 0), colored(new THREE.PlaneGeometry(6, 4, 4, 1).translate(3, 17, 0), '#ffffff')]);
      const flags = new THREE.InstancedMesh(flagGeo, flagMaterial(), flagCount);
      for (let k = 0; k < flagCount; k++) {
        const s = seats[Math.floor(rand() * seats.length)];
        m.makeTranslation(s.x, s.y, s.z);
        flags.setMatrixAt(k, m);
        flags.setColorAt(k, c.set(SHIRTS[(rand() * SHIRTS.length) | 0]));
      }
      flags.layers.set(1);
      flags.computeBoundingSphere();
      parent.add(flags);
    }
  }

  /* --- Waving flags (shared shader) --- */
  let _flagMat = null;
  function flagMaterial() {
    if (_flagMat) return _flagMat;
    _flagMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: true });
    _flagMat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, crowdUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float wave = max(0.0, position.x) ;
          transformed.z += sin(uTime * 6.0 + position.x * 0.6 + instanceMatrix[3].x * 0.1) * wave * 0.25;`);
    };
    _flagMat.customProgramCacheKey = () => 'e1-flag';
    return _flagMat;
  }

  /* --- Grandstand --- */
  // len = length along the track, tiers = levels. Local: x along, z away from track, y up.
  const seatColors = ['#c8170c', '#1e4fa8', '#ececec', '#2b2f38', '#ffcc00'];
  const standMat = M({ vertexColors: true, roughness: 0.85, emissive: '#000000' });
  const roofMat = M({ color: '#dfe3e8', roughness: 0.5, metalness: 0.4 });
  nightMaterials.push({ mat: standMat, color: '#3a3322', intensity: 0.6 });
  function grandstand(len, tiers, seatColor) {
    const parts = [], seats = [];
    const rowsPerTier = 8, rowD = 9, rowH = 5.5;
    let y = 8, z = 4;
    parts.push(colored(box(len, 8, 4, 0, 4, 2), '#9aa0a8'));          // front wall
    for (let t = 0; t < tiers; t++) {
      for (let r = 0; r < rowsPerTier; r++) {
        const col = (r % 2) ? seatColor : new THREE.Color(seatColor).multiplyScalar(0.8).getStyle();
        parts.push(colored(box(len, rowH, rowD, 0, y - rowH / 2, z + rowD / 2), col));
        for (let x = -len / 2 + 4; x < len / 2 - 3; x += 6.5) seats.push({ x, y: y + 4.5, z: z + rowD * 0.55 });
        y += rowH; z += rowD;
      }
      if (t < tiers - 1) {
        // walkway between levels
        parts.push(colored(box(len, 3, 10, 0, y - 1.5, z + 5), '#8d939b'));
        y += 7; z += 10;
      }
    }
    const top = y, depth = z;
    parts.push(colored(box(len, top, 4, 0, top / 2, depth + 2), '#7d838c'));     // back wall
    parts.push(colored(box(4, top, depth, -len / 2 - 2, top / 2, depth / 2), '#7d838c'));
    parts.push(colored(box(4, top, depth, len / 2 + 2, top / 2, depth / 2), '#7d838c'));
    const g = new THREE.Group();
    const body = new THREE.Mesh(merge(parts), standMat);
    body.castShadow = std; body.receiveShadow = true;
    g.add(body);
    // roof on columns
    const roof = new THREE.Mesh(merge([
      box(len + 16, 2, depth + 20, 0, top + 26, depth / 2 - 4).rotateX(0.0),
      ...Array.from({ length: Math.max(2, Math.round(len / 70)) + 1 }, (_, k) => {
        const x = -len / 2 + k * (len / Math.max(2, Math.round(len / 70)));
        return box(2.5, 28, 2.5, x, top + 12, depth + 1);
      })
    ]), roofMat);
    roof.castShadow = std;
    g.add(roof);
    // sponsor billboard along the front of the roof
    const ad = adStrip().clone(); ad.needsUpdate = true; ad.repeat.set(len / 320, 1);
    const boardMat = new THREE.MeshLambertMaterial({ map: ad, emissive: '#ffffff', emissiveMap: ad, emissiveIntensity: 0 });
    nightMaterials.push({ mat: boardMat, emissive: true });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(len + 10, 12), boardMat);
    board.position.set(0, top + 20, depth / 2 - 14.5);
    board.rotation.y = Math.PI;                // facing the track
    g.add(board);
    return { group: g, seats, depth, top };
  }
  function addStand(i, side, len, tiers, gap = 30) {
    const sp = spot(i, side, wallD + gap);
    const depthGuess = tiers * 8 * 9 + tiers * 10 + 10;
    const cx = sp.x + sp.ox * depthGuess / 2, cy = sp.y + sp.oy * depthGuess / 2;
    const along = Math.atan2(sp.oy, sp.ox) - Math.PI / 2;
    if (!free(cx, cy, along, len / 2, depthGuess / 2)) return null;
    mark(cx, cy, along, len / 2 + 20, depthGuess / 2 + 20);
    const st = grandstand(len, tiers, seatColors[(rand() * seatColors.length) | 0]);
    place(st.group, sp);
    st.group.position.y = Math.min(sp.h, heightAt(cx, cy)) - 1;
    addCrowd(st.group, st.seats, false, Math.round(st.seats.length * 0.92));
    stands.push({ x: cx, y: cy, h: sp.h, size: len * tiers });
    lodObjects.push({ obj: st.group, x: cx, y: cy, r: len / 2 + depthGuess });
    return st;
  }

  /* --- Find the main straight (around the start line) --- */
  let back = 0, fwd = 0;
  while (back < n / 3 && !an.info[(n - back) % n].corner) back++;
  while (fwd < n / 3 && !an.info[fwd].corner) fwd++;
  const straightStart = -back + 25, straightEnd = fwd - 25;   // track indices (10 units each)
  // which side is the inside of the circuit? (pits go there, more grandstands on the outside)
  let cx0 = 0, cy0 = 0;
  track.path.forEach(p => { cx0 += p.x; cy0 += p.y; });
  cx0 /= n; cy0 /= n;
  const s0 = an.info[0];
  const pitSide = ((cx0 - s0.x) * s0.nx + (cy0 - s0.y) * s0.ny) > 0 ? 1 : -1;
  const standSide = -pitSide;

  /* --- Pit lane and pit building --- */
  const pitFrom = Math.max(straightStart, -170), pitTo = Math.min(straightEnd, 110);
  const pitParts = [], garageSpots = [];
  const pitLaneMat = M({ color: '#55585e', roughness: 0.9 });
  const laneGeo = [];
  for (let i = pitFrom; i < pitTo; i += 2) {
    const a = spot(i, pitSide, wallD + 4), b = spot(i + 2, pitSide, wallD + 4);
    const c = spot(i + 2, pitSide, wallD + 70), d = spot(i, pitSide, wallD + 70);
    laneGeo.push(...[a, b, c, a, c, d].map(p => [p.x, heightAt(p.x, p.y) + 0.5, p.y]).flat());
  }
  const lane = new THREE.BufferGeometry();
  lane.setAttribute('position', new THREE.Float32BufferAttribute(laneGeo, 3));
  lane.computeVertexNormals();
  const laneMesh = new THREE.Mesh(lane, pitLaneMat);
  laneMesh.material.side = THREE.DoubleSide;
  laneMesh.receiveShadow = true;
  group.add(laneMesh);
  for (let i = pitFrom; i < pitTo; i += 2) {
    const sp = spot(i, pitSide, wallD + 40);
    mark(sp.x, sp.y, 0, 60, 60);
  }

  // Garages: a long building made of 20-unit-wide sections that follow the straight
  const teamColors = ['#c8170c', '#1e88e5', '#ffcc00', '#43a047', '#8e24aa', '#00bcd4', '#fb8c00', '#212121', '#f06292', '#ececec'];
  const garageTex = canvasTex(512, 128, (g, w, h) => {
    for (let k = 0; k < 4; k++) {
      const x = k * 128;
      g.fillStyle = '#2b2f38'; g.fillRect(x, 0, 128, h);
      g.fillStyle = teamColors[k * 2 % teamColors.length]; g.fillRect(x + 8, 16, 112, 104);
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(x + 14, 22, 100, 8);     // lights inside
      g.fillStyle = '#e8e8e8'; g.fillRect(x + 8, 4, 112, 10);
      g.fillStyle = '#111'; g.font = 'bold 9px Arial'; g.textAlign = 'center'; g.fillText('TEAM ' + (k + 1), x + 64, 12);
    }
  }, { repeat: true });
  const garageMat = M({ map: garageTex, emissive: '#ffffff', emissiveMap: garageTex, emissiveIntensity: 0.15 });
  nightMaterials.push({ mat: garageMat, emissive: true, day: 0.15 });
  const glassMat = M({ color: '#5d7fa3', roughness: 0.1, metalness: 0.7, emissive: '#ffd9a0', emissiveIntensity: 0 });
  nightMaterials.push({ mat: glassMat, color: '#ffd9a0', intensity: 0.5 });
  const wallMat = M({ color: '#e4e6ea', roughness: 0.7 });
  const pitBuild = new THREE.Group();
  const buildingGeo = [], glassGeo = [], doorGeo = [];
  for (let i = pitFrom + 2; i < pitTo - 2; i += 2) {
    const a = spot(i, pitSide, wallD + 72), b = spot(i + 2, pitSide, wallD + 72);
    const len = Math.hypot(b.x - a.x, b.y - a.y) + 0.5;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const h0 = heightAt(mid.x, mid.y);
    const tf = g => g.rotateY(-ang).translate(mid.x + a.ox * 40, h0, mid.y + a.oy * 40);
    buildingGeo.push(tf(box(len, 8, 80, 0, 44, 0)));            // roof slab
    buildingGeo.push(tf(box(len, 40, 4, 0, 20, 38)));           // back wall
    glassGeo.push(tf(box(len, 14, 2, 0, 31, -36)));             // glass hospitality floor
    const door = box(len, 22, 1, 0, 11, -39);
    const uv = door.attributes.uv;
    const u0 = (i - pitFrom) / 6;
    for (let k = 0; k < uv.count; k++) uv.setX(k, u0 + uv.getX(k) * (len / 60));
    doorGeo.push(tf(door));
  }
  if (buildingGeo.length) {
    const bmesh = new THREE.Mesh(merge(buildingGeo), wallMat); bmesh.castShadow = std; bmesh.receiveShadow = true;
    pitBuild.add(bmesh, new THREE.Mesh(merge(glassGeo), glassMat), new THREE.Mesh(merge(doorGeo), garageMat));
  }
  group.add(pitBuild);
  lodObjects.push({ obj: pitBuild, x: spot(0, pitSide, wallD + 110).x, y: spot(0, pitSide, wallD + 110).y, r: (pitTo - pitFrom) * 6 });

  // Grandstand on top of the pit building, near the start line
  {
    const sp = spot(-20, pitSide, wallD + 112);
    const st = grandstand(260, 1, '#ececec');
    place(st.group, sp);
    st.group.position.y = heightAt(sp.x, sp.y) + 48;
    addCrowd(st.group, st.seats, false, st.seats.length);
    stands.push({ x: sp.x, y: sp.y, h: sp.h + 48, size: 260 });
    lodObjects.push({ obj: st.group, x: sp.x, y: sp.y, r: 300 });
  }

  // Control tower at the end of the pit building
  {
    const sp = spot(pitTo + 8, pitSide, wallD + 110);
    if (free(sp.x, sp.y, 0, 35, 35, wallD + 40)) {
      mark(sp.x, sp.y, 0, 40, 40);
      const tower = new THREE.Group();
      const t1 = new THREE.Mesh(new THREE.CylinderGeometry(16, 20, 120, 16).translate(0, 60, 0), wallMat);
      const t2 = new THREE.Mesh(new THREE.CylinderGeometry(30, 26, 24, 16).translate(0, 132, 0), glassMat);
      const t3 = new THREE.Mesh(new THREE.CylinderGeometry(32, 32, 4, 16).translate(0, 146, 0), wallMat);
      t1.castShadow = t2.castShadow = std;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(50, 16), new THREE.MeshBasicMaterial({ map: canvasTex(256, 80, g => {
        g.fillStyle = '#c8170c'; g.fillRect(0, 0, 256, 80); g.fillStyle = '#ffcc00';
        g.font = 'italic bold 58px "Russo One", Arial Black'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('E1', 128, 42);
      }), side: THREE.DoubleSide }));
      sign.position.set(0, 160, 0);
      sign.userData.faceCamera = true;
      tower.add(t1, t2, t3, sign);
      place(tower, sp);
      lodObjects.push({ obj: tower, x: sp.x, y: sp.y, r: 200 });
    }
  }

  // Podium: three steps on a balcony at the front of the pit building
  {
    const sp = spot(30, pitSide, wallD + 58);
    const pod = new THREE.Group();
    const stepMat = M({ color: '#f5f5f5' });
    [[0, 9], [-11, 6], [11, 4]].forEach(([x, h], k) => {
      const s = new THREE.Mesh(box(10, h, 8, x, 48 + h / 2, 0), stepMat);
      pod.add(s);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(5, 4), new THREE.MeshBasicMaterial({ map: canvasTex(64, 48, g => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 48); g.fillStyle = '#c8170c';
        g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(k + 1), 32, 26);
      }) }));
      num.position.set(x, 48 + h / 2, -4.1); num.rotation.y = Math.PI;
      pod.add(num);
    });
    pod.add(new THREE.Mesh(box(48, 2, 20, 0, 47, 0), wallMat));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(48, 20), new THREE.MeshLambertMaterial({ map: adStrip() }));
    back.position.set(0, 62, 8); back.rotation.y = Math.PI;
    pod.add(back);
    place(pod, sp);
    lodObjects.push({ obj: pod, x: sp.x, y: sp.y, r: 80 });
  }

  // Huge grandstands opposite the pits, along the whole main straight
  for (let i = straightStart + 10; i < straightEnd - 40; i += 64) addStand(i + 30, standSide, 560, 3, 30);
  // and more on the pit side, before and after the pit building
  for (let i = straightStart + 10; i < pitFrom - 40; i += 50) addStand(i + 22, pitSide, 400, 2, 30);
  for (let i = pitTo + 30; i < straightEnd - 40; i += 50) addStand(i + 22, pitSide, 400, 2, 30);

  /* --- Start gantry with 5 lights and a big screen --- */
  const gantryLights = [];
  {
    const p = Tracks.pointAt(track, 0);
    const span = wallD + 8;
    const g = new THREE.Group();
    const metal = M({ color: '#2b2f38', metalness: 0.6, roughness: 0.4 });
    [-1, 1].forEach(side => {
      const post = new THREE.Mesh(box(6, 90, 6, 0, 45, side * span), metal);
      post.castShadow = std; g.add(post);
    });
    g.add(new THREE.Mesh(box(8, 12, span * 2 + 6, 0, 86, 0), metal));
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 10, 10), new THREE.MeshBasicMaterial({ map: canvasTex(1024, 80, (c, w, h) => {
      c.fillStyle = '#c8170c'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffcc00';
      c.font = 'italic bold 56px "Russo One", Arial Black'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('E1 – EQUATION 1   ·   GRAND PRIX', w / 2, h / 2 + 3);
    }), side: THREE.DoubleSide }));
    banner.position.set(-4.2, 86, 0); banner.rotation.y = -Math.PI / 2;
    g.add(banner);
    // light box with 5 lights facing the grid
    g.add(new THREE.Mesh(box(4, 12, 66, -2, 72, 0), new THREE.MeshLambertMaterial({ color: '#111' })));
    for (let i = 0; i < 5; i++) {
      const light = new THREE.Mesh(new THREE.SphereGeometry(4, 14, 10), new THREE.MeshBasicMaterial({ color: '#3a0606', toneMapped: false }));
      light.position.set(-4.5, 72, (i - 2) * 12);
      g.add(light); gantryLights.push(light);
    }
    // big screen on top
    const screenMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    screens.push(screenMat);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(80, 45), screenMat);
    scr.position.set(-4.5, 118, 0); scr.rotation.y = -Math.PI / 2;
    g.add(scr, new THREE.Mesh(box(4, 50, 86, -1.5, 118, 0), metal));
    g.position.set(p.x, heightAt(p.x, p.y), p.y);
    g.rotation.y = -p.angle;
    group.add(g);
  }

  /* --- Around the track --- */
  // grandstands at the bigger corners (on the outside, behind the gravel)
  const bigCorners = an.corners.filter(c => c.angle > 0.9).sort((a, b) => b.angle - a.angle);
  bigCorners.forEach((c, k) => {
    const len = c.angle > 1.8 ? 380 : 260;
    addStand(c.apex, c.outside, len, c.angle > 1.8 ? 2 : 1, 34) ||
      addStand(c.apex + 25, c.outside, len * 0.7, 1, 34) ||
      addStand(c.apex - 25, -c.outside, len * 0.7, 1, 34);
  });

  // TV screens at some corners
  const tvSpots = an.corners.filter((c, k) => k % 3 === 1 && c.angle > 0.5);
  tvSpots.forEach(c => {
    const sp = spot(c.apex - 35, c.outside, wallD + 50);
    if (!free(sp.x, sp.y, 0, 30, 15)) return;
    mark(sp.x, sp.y, 0, 30, 15);
    const g = new THREE.Group();
    const frame = M({ color: '#1b1d22', metalness: 0.5 });
    g.add(new THREE.Mesh(box(64, 38, 3, 0, 44, 2), frame));
    g.add(new THREE.Mesh(box(3, 30, 3, -18, 15, 3), frame), new THREE.Mesh(box(3, 30, 3, 18, 15, 3), frame));
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    screens.push(mat);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(60, 34), mat);
    scr.position.set(0, 44, 0.3); scr.rotation.y = Math.PI;
    g.add(scr);
    place(g, sp);
    // turn it to face the cars coming into the corner a little
    g.rotation.y += 0.4 * -c.outside;
    lodObjects.push({ obj: g, x: sp.x, y: sp.y, r: 80 });
  });

  // Sponsor bridges over the track on long straights
  const straights = [];
  let runStart = -1;
  for (let i = 0; i < n; i++) {
    if (!an.info[i].corner) { if (runStart < 0) runStart = i; }
    else if (runStart >= 0) { if (i - runStart > 90) straights.push([runStart, i]); runStart = -1; }
  }
  straights.filter(([a, b]) => a > 250 && b < n - 250).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, Q.bridges).forEach(([a, b]) => {
    const i = Math.floor((a + b) / 2);
    const p = an.info[i], ang = Math.atan2(an.info[i + 1].y - p.y, an.info[i + 1].x - p.x);
    const g = new THREE.Group();
    const span = wallD + 14;
    const metal = M({ color: '#e8eaee', metalness: 0.5, roughness: 0.4 });
    [-1, 1].forEach(s => g.add(new THREE.Mesh(box(10, 66, 10, 0, 33, s * span), metal)));
    g.add(new THREE.Mesh(box(10, 16, span * 2 + 10, 0, 62, 0), metal));
    const ad = adStrip().clone(); ad.needsUpdate = true; ad.repeat.set((span * 2) / 320, 1); ad.offset.x = rand();
    const adMat = new THREE.MeshLambertMaterial({ map: ad, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: ad, emissiveIntensity: 0 });
    nightMaterials.push({ mat: adMat, emissive: true });
    [-5.2, 5.2].forEach(x => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, 14), adMat);
      b.position.set(x, 62, 0); b.rotation.y = Math.PI / 2;
      g.add(b);
    });
    g.position.set(p.x, heightAt(p.x, p.y), p.y);
    g.rotation.y = -ang;
    group.add(g);
    [-1, 1].forEach(s => { const sp = spot(i, s, span); mark(sp.x, sp.y, 0, 20, 20); });
  });

  // Marshal posts with marshals in orange, every ~900 units on alternating sides
  const marshalSeats = [], marshalGroup = new THREE.Group();
  const hutGeo = [];
  let side = 1;
  for (let i = 40; i < n - 40; i += 90) {
    side = -side;
    const sp = spot(i, side, wallD + 20);
    if (!free(sp.x, sp.y, 0, 8, 8, wallD + 10)) continue;
    mark(sp.x, sp.y, 0, 10, 10);
    hutGeo.push(colored(box(12, 14, 10, 0, 7, 0).rotateY(-Math.atan2(sp.oy, sp.ox)).translate(sp.x + sp.ox * 6, sp.h, sp.y + sp.oy * 6), '#f2f2f2'));
    hutGeo.push(colored(box(13, 2, 11, 0, 15, 0).rotateY(-Math.atan2(sp.oy, sp.ox)).translate(sp.x + sp.ox * 6, sp.h, sp.y + sp.oy * 6), '#fb8c00'));
    marshalSeats.push({ x: sp.x - sp.oy * 9, y: sp.h + 6, z: sp.y + sp.ox * 9 }, { x: sp.x + sp.oy * 9, y: sp.h + 6, z: sp.y - sp.ox * 9 });
  }
  if (hutGeo.length) group.add(new THREE.Mesh(merge(hutGeo), M({ vertexColors: true })));
  if (marshalSeats.length) {
    const inst = new THREE.InstancedMesh(personGeo.clone(), crowdMat, marshalSeats.length);
    const m = new THREE.Matrix4(), c = new THREE.Color('#ff7a00');
    const ph = new Float32Array(marshalSeats.length).map(() => rand());
    marshalSeats.forEach((s, k) => { m.makeTranslation(s.x, s.y, s.z); inst.setMatrixAt(k, m); inst.setColorAt(k, c); });
    inst.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    inst.geometry.setAttribute('aStand', new THREE.InstancedBufferAttribute(new Float32Array(marshalSeats.length).fill(1), 1));
    inst.computeBoundingSphere();
    group.add(inst);
  }
  group.add(marshalGroup);

  // Floodlight poles (they light the track at night), every ~420 units on alternating sides
  const poleSpots = [];
  side = 1;
  for (let i = 0; i < n; i += 42) {
    side = -side;
    const sp = spot(i, side, wallD + 34);
    if (!free(sp.x, sp.y, 0, 5, 5, wallD + 20)) continue;
    mark(sp.x, sp.y, 0, 6, 6);
    poleSpots.push(sp);
  }
  if (poleSpots.length) {
    const pole = new THREE.CylinderGeometry(1.4, 2.2, 110, 8).translate(0, 55, 0);
    const head = box(14, 8, 3, 0, 112, -3);
    const poles = new THREE.InstancedMesh(pole, M({ color: '#9aa0a8', metalness: 0.6 }), poleSpots.length);
    const headMat = new THREE.MeshStandardMaterial({ color: '#f0f0f0', emissive: '#fff6dd', emissiveIntensity: 0 });
    nightMaterials.push({ mat: headMat, color: '#fff6dd', intensity: 2.5 });
    const heads = new THREE.InstancedMesh(head, headMat, poleSpots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    poleSpots.forEach((sp, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(sp.oy, sp.ox) + Math.PI / 2);
      m.compose(new THREE.Vector3(sp.x, sp.h, sp.y), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(k, m); heads.setMatrixAt(k, m);
      floodlights.push({ x: sp.x - sp.ox * 6, y: sp.h + 108, z: sp.y - sp.oy * 6 });
    });
    group.add(poles, heads);
  }

  // Camera towers (scaffolding with a cameraman), every ~3000 units
  for (let i = 150; i < n; i += 300) {
    const sp = spot(i, -side, wallD + 45);
    side = -side;
    if (!free(sp.x, sp.y, 0, 8, 8)) continue;
    mark(sp.x, sp.y, 0, 10, 10);
    const g = new THREE.Group();
    const scaf = M({ color: '#b0b5bc', metalness: 0.5 });
    [[-5, -5], [5, -5], [-5, 5], [5, 5]].forEach(([x, z]) => g.add(new THREE.Mesh(box(1, 48, 1, x, 24, z), scaf)));
    g.add(new THREE.Mesh(box(13, 1.5, 13, 0, 48, 0), scaf));
    g.add(new THREE.Mesh(box(4, 4, 7, 0, 52, -1), M({ color: '#222' })));
    place(g, sp);
    lodObjects.push({ obj: g, x: sp.x, y: sp.y, r: 40 });
  }

  // Spectator banks on the straights: grassy slopes with standing fans
  const bankGeo = [];
  straights.forEach(([a, b], k) => {
    for (let i = a + 40; i < b - 40; i += 160) {
      const sd = (k + i) % 2 ? 1 : -1;
      const sp = spot(i, sd, wallD + 50);
      const along = Math.atan2(sp.oy, sp.ox) - Math.PI / 2;
      if (!free(sp.x + sp.ox * 30, sp.y + sp.oy * 30, along, 160, 35)) continue;
      mark(sp.x + sp.ox * 30, sp.y + sp.oy * 30, along, 170, 45);
      const g = new THREE.Group();
      const mound = new THREE.CylinderGeometry(40, 40, 320, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.35, 1).translate(0, 0, 30);
      bankGeo.push(mound);
      const seats = [];
      for (let x = -150; x < 150; x += 7) for (let z = 8; z < 52; z += 8) {
        const y = Math.sqrt(Math.max(0, 1 - Math.pow((z - 30) / 40, 2))) * 40 * 0.35;
        seats.push({ x, y: y + 6, z });
      }
      const holder = new THREE.Group();
      addCrowd(holder, seats, true, 260);
      g.add(holder);
      const m = new THREE.Mesh(mound, M({ color: track.theme.ground === 'sand' ? '#c9a66b' : '#4f8a3a' }));
      m.receiveShadow = true;
      g.add(m);
      place(g, sp);
      stands.push({ x: sp.x, y: sp.y, h: sp.h, size: 150 });
      lodObjects.push({ obj: g, x: sp.x, y: sp.y, r: 180 });
    }
  });

  // White tents near the grandstands
  const tentGeo = [];
  stands.slice(0, 14).forEach(s => {
    for (let k = 0; k < 3; k++) {
      const x = s.x + (rand() - 0.5) * 300, y = s.y + (rand() - 0.5) * 300;
      if (!free(x, y, 0, 14, 14)) continue;
      mark(x, y, 0, 16, 16);
      tentGeo.push(new THREE.ConeGeometry(16, 14, 4).rotateY(Math.PI / 4).translate(x, heightAt(x, y) + 19, y));
      tentGeo.push(box(22, 12, 22, x, heightAt(x, y) + 6, y));
    }
  });
  if (tentGeo.length) group.add(new THREE.Mesh(merge(tentGeo), M({ color: '#f7f7f7' })));

  // Big flags on poles along the main straight
  {
    const geo = merge([box(0.8, 44, 0.8, 0, 22, 0), colored(new THREE.PlaneGeometry(16, 10, 6, 1).translate(8, 38, 0), '#ffffff')]);
    const count = 24;
    const flags = new THREE.InstancedMesh(geo, flagMaterial(), count);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = straightStart + 20 + Math.floor((k / count) * (straightEnd - straightStart - 40));
      const sp = spot(i, k % 2 ? standSide : pitSide, wallD + 18);
      m.makeTranslation(sp.x, sp.h, sp.y);
      flags.setMatrixAt(k, m);
      flags.setColorAt(k, c.set(SHIRTS[k % SHIRTS.length]));
    }
    flags.computeBoundingSphere();
    group.add(flags);
  }

  /* --- Trees, rocks, cacti, buildings (the background) --- */
  const kind = track.theme.decor;
  const treeSpots = [];
  const clusters = Math.floor(Q.trees / 9);
  for (let c = 0, tries = 0; c < clusters && tries < clusters * 12; tries++) {
    const x = B.x0 + rand() * (B.x1 - B.x0), y = B.y0 + rand() * (B.y1 - B.y0);
    if (!free(x, y, 0, 20, 20, wallD + 90)) continue;
    c++;
    const count = 4 + Math.floor(rand() * 14);
    for (let k = 0; k < count && treeSpots.length < Q.trees; k++) {
      const tx = x + (rand() - 0.5) * 220, ty = y + (rand() - 0.5) * 220;
      if (!free(tx, ty, 0, 6, 6, wallD + 70)) continue;
      treeSpots.push({ x: tx, y: ty, h: heightAt(tx, ty), s: 0.6 + rand() * 0.9 });
    }
  }
  if (kind !== 'buildings') addTrees(kind, treeSpots);
  else addCity();
  // a few far-away buildings on the other tracks too
  if (kind !== 'buildings') addFarBuildings();

  function addTrees(kind, spots) {
    let geo, mats;
    if (kind === 'cacti') {
      geo = [
        merge([colored(new THREE.CylinderGeometry(2.2, 2.6, 26, 7).translate(0, 13, 0), '#3f7a35'),
               colored(new THREE.CylinderGeometry(1.5, 1.5, 10, 6).rotateZ(Math.PI / 2).translate(5, 12, 0), '#3f7a35'),
               colored(new THREE.CylinderGeometry(1.5, 1.5, 9, 6).translate(9, 17, 0), '#3f7a35')]),
        colored(new THREE.DodecahedronGeometry(9, 0).scale(1.3, 0.7, 1).translate(0, 3, 0), '#a28a6a')
      ];
    } else if (kind === 'pines') {
      geo = [
        merge([colored(new THREE.CylinderGeometry(1.6, 2.2, 12, 6).translate(0, 6, 0), '#5a4330'),
               colored(new THREE.ConeGeometry(13, 34, 7).translate(0, 26, 0), '#1f4a2a'),
               colored(new THREE.ConeGeometry(10, 26, 7).translate(0, 40, 0), '#245a30')]),
        colored(new THREE.DodecahedronGeometry(11, 0).scale(1.4, 0.8, 1.1).translate(0, 4, 0), '#7d776f')
      ];
    } else {
      geo = [
        merge([colored(new THREE.CylinderGeometry(1.8, 2.6, 16, 6).translate(0, 8, 0), '#5a4330'),
               colored(new THREE.IcosahedronGeometry(14, 0).scale(1, 0.9, 1).translate(0, 26, 0), '#2f6b2d'),
               colored(new THREE.IcosahedronGeometry(9, 0).translate(6, 33, 4), '#3b8236')]),
        merge([colored(new THREE.CylinderGeometry(1.4, 2.0, 10, 6).translate(0, 5, 0), '#5a4330'),
               colored(new THREE.ConeGeometry(11, 30, 7).translate(0, 22, 0), '#24592c')])
      ];
    }
    mats = M({ vertexColors: true, roughness: 0.95 });
    // Split into chunks of the world so far-away chunks can be hidden (level of detail)
    const CH = 2200, chunks = new Map();
    spots.forEach((s, k) => {
      const key = Math.floor(s.x / CH) + ',' + Math.floor(s.y / CH) + ',' + (k % geo.length === 0 || kind === 'trees' ? (k % 4 === 0 ? 1 : 0) : 1);
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(s);
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    chunks.forEach((list, key) => {
      const variant = Number(key.split(',')[2]) % geo.length;
      const inst = new THREE.InstancedMesh(geo[variant], mats, list.length);
      let sx = 0, sy = 0;
      list.forEach((s, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
        m.compose(new THREE.Vector3(s.x, s.h - 1, s.y), q, new THREE.Vector3(s.s, s.s * (0.85 + rand() * 0.3), s.s));
        inst.setMatrixAt(k, m);
        sx += s.x; sy += s.y;
      });
      inst.castShadow = ctx.quality === 'high';
      inst.layers.set(1);
      inst.computeBoundingSphere();
      group.add(inst);
      lodObjects.push({ obj: inst, x: sx / list.length, y: sy / list.length, r: CH, far: true });
    });
  }

  // City Circuit: blocks of buildings with windows (they glow at night)
  function windowTexture(base, lit) {
    return canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let y = 6; y < h; y += 16) for (let x = 6; x < w; x += 14) {
        g.fillStyle = Math.random() < lit ? 'rgba(255,214,150,0.95)' : 'rgba(40,52,68,0.9)';
        g.fillRect(x, y, 8, 10);
      }
    }, { repeat: true });
  }
  function addCity() {
    const looks = [['#8d939b', 0.35], ['#b7a58d', 0.4], ['#5d6a78', 0.3]].map(([c, l]) => {
      const t = windowTexture(c, l);
      t.repeat.set(2, 3);
      const mat = M({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0, roughness: 0.7 });
      nightMaterials.push({ mat, emissive: true, night: 0.8 });
      return { mat, list: [] };
    });
    const unit = box(1, 1, 1, 0, 0.5, 0);
    let made = 0;
    for (let tries = 0; tries < Q.buildings * 8 && made < Q.buildings; tries++) {
      const x = B.x0 + 600 + rand() * (B.x1 - B.x0 - 1200), y = B.y0 + 600 + rand() * (B.y1 - B.y0 - 1200);
      const w = 70 + rand() * 90, d = 70 + rand() * 90;
      if (!free(x, y, 0, w / 2 + 10, d / 2 + 10, wallD + 45)) continue;
      mark(x, y, 0, w / 2 + 14, d / 2 + 14);
      const near = hm.distAt(x, y) < wallD + 300;
      const h = near ? 40 + rand() * 120 : 80 + rand() * 360;
      looks[made % 3].list.push({ x, y, w, d, h });
      made++;
    }
    // fill the rest of the background with taller towers
    const m = new THREE.Matrix4();
    looks.forEach(look => {
      if (!look.list.length) return;
      const inst = new THREE.InstancedMesh(unit, look.mat, look.list.length);
      look.list.forEach((b, k) => { m.makeScale(b.w, b.h, b.d).setPosition(b.x, heightAt(b.x, b.y) - 1, b.y); inst.setMatrixAt(k, m); });
      inst.castShadow = std; inst.receiveShadow = true;
      inst.computeBoundingSphere();
      group.add(inst);
    });
    // street lights along the city streets
    addStreetLights();
  }
  function addStreetLights() {
    const spots = [];
    let sd = 1;
    for (let i = 0; i < n; i += 18) {
      sd = -sd;
      const sp = spot(i, sd, wallD + 8);
      if (Tracks.nearest(track, sp.x, sp.y, i).dist < wallD - 2) continue;
      spots.push(sp);
    }
    const geo = merge([new THREE.CylinderGeometry(0.7, 1, 40, 6).translate(0, 20, 0), box(1, 1, 10, 0, 40, -5)]);
    const lampGeo = box(3, 1.2, 4, 0, 39.2, -9);
    const poles = new THREE.InstancedMesh(geo, M({ color: '#3b3f46', metalness: 0.6 }), spots.length);
    const lampMat = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffd27a', emissiveIntensity: 0.2 });
    nightMaterials.push({ mat: lampMat, color: '#ffd27a', intensity: 3, day: 0.2 });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    spots.forEach((sp, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(sp.oy, sp.ox) + Math.PI / 2);
      m.compose(new THREE.Vector3(sp.x, sp.h, sp.y), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(k, m); lamps.setMatrixAt(k, m);
      if (k % 4 === 0) floodlights.push({ x: sp.x - sp.ox * 9, y: sp.h + 38, z: sp.y - sp.oy * 9 });
    });
    group.add(poles, lamps);
  }
  function addFarBuildings() {
    const list = [];
    for (let tries = 0; tries < 400 && list.length < Q.buildings / 6; tries++) {
      const x = B.x0 + rand() * (B.x1 - B.x0), y = B.y0 + rand() * (B.y1 - B.y0);
      if (hm.distAt(x, y) < wallD + 700) continue;
      const w = 80 + rand() * 120;
      if (!free(x, y, 0, w / 2, w / 2, wallD + 600)) continue;
      mark(x, y, 0, w / 2, w / 2);
      list.push({ x, y, w, h: 30 + rand() * 90 });
    }
    if (!list.length) return;
    const t = windowTexture('#c9c4bb', 0.25); t.repeat.set(3, 1);
    const mat = M({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0 });
    nightMaterials.push({ mat, emissive: true, night: 0.7 });
    const inst = new THREE.InstancedMesh(box(1, 1, 1, 0, 0.5, 0), mat, list.length);
    const m = new THREE.Matrix4();
    list.forEach((b, k) => { m.makeScale(b.w, b.h, b.w * 0.7).setPosition(b.x, heightAt(b.x, b.y) - 2, b.y); inst.setMatrixAt(k, m); });
    inst.computeBoundingSphere();
    group.add(inst);
  }

  /* --- Every frame: animate the crowd and hide far-away things --- */
  function update(time, carX, carY, camX, camY) {
    crowdUniforms.uTime.value = time;
    crowdUniforms.uCar.value.set(carX, 0, carY);
    crowdUniforms.uCheer.value *= 0.985;   // a cheer slowly calms down
    lodObjects.forEach(o => {
      const d = Math.hypot(o.x - camX, o.y - camY) - o.r;
      o.obj.visible = d < (o.far ? Q.lod * 1.3 : Q.lod);
    });
  }
  function cheer(amount = 0.8) { crowdUniforms.uCheer.value = Math.min(1.2, crowdUniforms.uCheer.value + amount); }

  return { group, update, cheer, stands, floodlights, screens, nightMaterials, gantryLights };
}
