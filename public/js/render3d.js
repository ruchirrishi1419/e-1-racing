/* =====================================================================
   E1 (EQUATION 1) - 3D GRAPHICS (cockpit view) using Three.js
   ---------------------------------------------------------------------
   This file only DRAWS things. The driving, laps, AI and multiplayer
   still happen in the other files, exactly like before.

   How the flat 2D game world becomes 3D:
     2D position (x, y)  ->  3D position (x, height, y)
     The ground is one big flat picture of the track (road, kerbs,
     grass) and we stand 3D objects on it: barriers, cars, gantry...

   Main parts of this file:
     1. Quality presets (Low / Medium / High)
     2. Building the track (ground picture, barriers, start gantry)
     3. Sky, sun and lights
     4. Cars (3D models + floating name tags)
     5. Camera (cockpit view) and drawing each frame
   ===================================================================== */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCar } from './car3d.js';

/* ---------------- 1. Quality presets ---------------- */
const QUALITY = {
  low:    { pixelRatio: 0.75, antialias: false, shadows: false, shadowSize: 512,  groundTex: 2048, fogFar: 1900, scenery: 0.4 },
  medium: { pixelRatio: 1,    antialias: true,  shadows: true,  shadowSize: 1024, groundTex: 4096, fogFar: 2700, scenery: 0.7 },
  high:   { pixelRatio: 2,    antialias: true,  shadows: true,  shadowSize: 2048, groundTex: 4096, fogFar: 3600, scenery: 1.0 }
};

// Sky colors for each kind of track
const SKIES = {
  trees:     { top: '#3d7fd6', horizon: '#cfe6ff' },
  buildings: { top: '#5b7fa8', horizon: '#dfe4ea' },
  pines:     { top: '#2f6fc0', horizon: '#c4dcf5' },
  cacti:     { top: '#3f86d8', horizon: '#ffe3b8' }
};

// T-cam: the onboard camera on top of the engine cover, just above and behind
// the driver's helmet (the 3D car is 48 units long, the helmet sits at x = -3.2)
const TCAM = {
  back: 10.3,     // how far behind the car's centre (just in front of the shark fin)
  height: 9.8,    // how high above the ground (just above the airbox)
  lookAhead: 150, // looks at a point this far ahead...
  lookHeight: 0   // ...at this height (slightly downwards)
};

let renderer = null, canvas = null, currentAntialias = null;
let scene = null, camera = null, sky = null, sun = null;
let q = QUALITY.medium;
let track = null, myId = null;
let cars = new Map();       // id -> { group, frontWheels, label, helmet }
let gantryLights = [];
let shake = 0, steerVis = 0;
let qName = 'medium';       // 'low' | 'medium' | 'high'
let envMap = null;          // soft reflections for shiny paint and metal
let camOverride = null;     // for automatic testing: look at the car from anywhere

/* ---------------- Start / stop ---------------- */

// Returns true if 3D works on this device, false if not (then the game uses 2D)
function start(opts) {
  try {
    qName = QUALITY[opts.quality] ? opts.quality : 'medium';
    q = QUALITY[qName];
    if (!renderer || currentAntialias !== q.antialias) createRenderer(opts.canvas);
    track = opts.track;
    myId = opts.myId;
    buildScene();
    opts.players.forEach((p, i) => addCar(p.id, p.colorHex, p.name, (p.slot !== undefined ? p.slot : i) + 1));
    return true;
  } catch (err) {
    console.warn('3D graphics not available, using 2D instead:', err);
    return false;
  }
}

function createRenderer(canvasEl) {
  // A WebGL canvas can't change its antialias setting, so swap in a fresh canvas
  if (renderer) {
    renderer.dispose();
    const fresh = canvasEl.cloneNode(false);
    canvasEl.replaceWith(fresh);
    canvasEl = fresh;
  }
  canvas = canvasEl;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance' });
  currentAntialias = q.antialias;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping; // natural lighting that keeps car colors bright and true
  renderer.toneMappingExposure = 1.0;
  // Soft reflections for shiny materials (a simple built-in "studio" light setup;
  // a real outdoor sky picture replaces this in a later step)
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

function stop() {
  if (scene) disposeScene(scene);
  scene = null;
  cars.clear();
}

function getCanvas() { return canvas; }

// Free the graphics memory used by the old track
function disposeScene(s) {
  s.traverse(obj => {
    if (obj.geometry && !obj.userData.sharedGeo) obj.geometry.dispose();
    if (obj.material) {
      [].concat(obj.material).forEach(m => {
        if (m.userData.shared) return;   // used by every car, keep it
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

/* ---------------- 2. Building the track ---------------- */

function buildScene() {
  if (scene) disposeScene(scene);
  scene = new THREE.Scene();
  scene.environment = qName === 'low' ? null : envMap;
  scene.environmentIntensity = 0.45;
  cars.clear();
  gantryLights = [];

  const skyColors = SKIES[track.theme.decor] || SKIES.trees;
  scene.fog = new THREE.Fog(skyColors.horizon, q.fogFar * 0.3, q.fogFar);
  camera = new THREE.PerspectiveCamera(70, 1, 0.5, q.fogFar + 600);

  renderer.shadowMap.enabled = q.shadows;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));

  addSkyAndLights(skyColors);
  addGround();
  addBarriers();
  addGantry();
}

// Point on the track's centre line with its sideways direction ("normal")
function sample(i) {
  const P = track.path, n = P.length;
  const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], p = P[i % n];
  const tx = b.x - a.x, ty = b.y - a.y, len = Math.hypot(tx, ty) || 1;
  return { x: p.x, y: p.y, nx: -ty / len, ny: tx / len };
}

// Which parts of the track are corners? (used for red-white kerbs)
function cornerFlags() {
  const P = track.path, n = P.length;
  const ang = i => { const a = P[(i + n) % n], b = P[(i + 1 + n) % n]; return Math.atan2(b.y - a.y, b.x - a.x); };
  const flags = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    let d = ang(i + 6) - ang(i - 6);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.14) for (let k = -5; k <= 5; k++) flags[(i + k + n) % n] = true;
  }
  return flags;
}

// The ground is ONE big picture of the whole track, painted with a 2D canvas
function addGround() {
  const W = track.width, H = track.height;
  const maxTex = Math.min(q.groundTex, renderer.capabilities.maxTextureSize);
  const scale = maxTex / Math.max(W, H);
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  const theme = track.theme, hw = track.halfWidth, outer = (hw + track.runoff) * 2;

  // Background (outside the barriers)
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 0.35);

  const path = new Path2D();
  track.path.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  path.closePath();
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Concrete strip under the barriers, then grass/sand run-off
  g.lineWidth = outer + 14; g.strokeStyle = '#9a9a9a'; g.stroke(path);
  g.lineWidth = outer; g.strokeStyle = theme.runoff; g.stroke(path);

  // Red-white kerbs, only on corners
  const flags = cornerFlags();
  const runs = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) { runs.push([start, i - 1]); start = -1; }
  }
  runs.forEach(([s, e]) => {
    const kp = new Path2D();
    for (let i = s; i <= e; i++) {
      const p = track.path[i];
      if (i === s) kp.moveTo(p.x, p.y); else kp.lineTo(p.x, p.y);
    }
    g.lineCap = 'butt';
    g.lineWidth = hw * 2 + 22; g.strokeStyle = '#f2f2f2'; g.stroke(kp);
    g.setLineDash([16, 16]); g.strokeStyle = '#d62a20'; g.stroke(kp); g.setLineDash([]);
  });
  g.lineCap = 'round';

  // Road with painted white edge lines
  g.lineWidth = hw * 2; g.strokeStyle = '#eeeeee'; g.stroke(path);
  g.lineWidth = hw * 2 - 7; g.strokeStyle = theme.road; g.stroke(path);

  // Faint dashed centre line
  g.lineWidth = 2.5; g.setLineDash([30, 50]); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.stroke(path); g.setLineDash([]);

  // Starting grid boxes
  for (let s = 0; s < 10; s++) {
    const gs = Tracks.gridSlot(track, s);
    g.save(); g.translate(gs.x, gs.y); g.rotate(gs.angle);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-8, -14); g.lineTo(24, -14); g.lineTo(24, 14); g.lineTo(-8, 14); g.stroke();
    g.restore();
  }

  // Chequered start / finish line
  const sp = Tracks.pointAt(track, 0);
  g.save(); g.translate(sp.x, sp.y); g.rotate(sp.angle);
  const sq = 8;
  for (let col = 0; col < 3; col++)
    for (let row = 0; row * sq < hw * 2; row++) {
      g.fillStyle = (row + col) % 2 ? '#111' : '#fff';
      g.fillRect(-12 + col * sq, -hw + row * sq, sq, Math.min(sq, hw * 2 - row * sq));
    }
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, 0, H / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // Endless plain ground around the track, so the world never just "ends"
  const far = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ color: theme.bg }));
  far.rotation.x = -Math.PI / 2;
  far.position.set(W / 2, -0.4, H / 2);
  scene.add(far);
}

// Small random dots so the ground isn't one flat color (helps you feel the speed)
function speckle(g, W, H, strength) {
  const count = Math.min(90000, Math.floor(W * H / 160));
  for (let i = 0; i < count; i++) {
    const light = Math.random() < 0.5;
    g.fillStyle = light ? `rgba(255,255,255,${0.05 * strength})` : `rgba(0,0,0,${0.09 * strength})`;
    const s = 3 + Math.random() * 9;
    g.fillRect(Math.random() * W, Math.random() * H, s, s);
  }
}

// Red and white barrier walls along both edges of the run-off area
function addBarriers() {
  const d = track.halfWidth + track.runoff;
  const HEIGHT = 8;
  const positions = [], colors = [];
  const red = new THREE.Color('#d32f2f'), white = new THREE.Color('#f0f0f0');

  [1, -1].forEach(side => {
    // Work out the wall line. On the inside of tight corners some points would
    // fold back on themselves, so we drop any point that's too close to the road.
    const pts = [];
    for (let i = 0; i < track.path.length; i += 2) {
      const s = sample(i);
      const x = s.x + s.nx * d * side, y = s.y + s.ny * d * side;
      if (Tracks.nearest(track, x, y).dist >= d - 2) pts.push({ x, y });
    }
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 400) continue; // gap between separate wall pieces
      const col = Math.floor(run / 40) % 2 ? red : white;
      run += len;
      // two triangles = one rectangle of wall
      positions.push(a.x, 0, a.y, b.x, 0, b.y, b.x, HEIGHT, b.y,
                     a.x, 0, a.y, b.x, HEIGHT, b.y, a.x, HEIGHT, a.y);
      for (let k = 0; k < 6; k++) colors.push(col.r, col.g, col.b);
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const wall = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  wall.receiveShadow = true;
  scene.add(wall);
}

// The start/finish gantry: a bridge over the road with 3 start lights
function addGantry() {
  const p = Tracks.pointAt(track, 0);
  const span = track.halfWidth + 20;
  const group = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: '#2b2f38' });

  [-1, 1].forEach(side => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(5, 72, 5), metal);
    post.position.set(0, 36, side * span);
    post.castShadow = true;
    group.add(post);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(6, 10, span * 2 + 5), metal);
  beam.position.set(0, 70, 0);
  beam.castShadow = true;
  group.add(beam);

  // "E1 - EQUATION 1" banner on the beam (both sides)
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 10, 9), new THREE.MeshBasicMaterial({ map: textTexture('E1 – EQUATION 1', 1024, 80, '#ffcc00', '#c8170c'), side: THREE.DoubleSide }));
  banner.position.set(-3.2, 70, 0);
  banner.rotation.y = -Math.PI / 2;
  group.add(banner);

  // Light box with 3 lights, facing the cars waiting on the grid
  const box = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 54), new THREE.MeshLambertMaterial({ color: '#111' }));
  box.position.set(-2, 58, 0);
  group.add(box);
  for (let i = 0; i < 5; i++) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(3.6, 12, 8), new THREE.MeshBasicMaterial({ color: '#3a0606' }));
    light.position.set(-4.5, 58, (i - 2) * 10);
    group.add(light);
    gantryLights.push(light);
  }

  group.position.set(p.x, 0, p.y);
  group.rotation.y = -p.angle;
  scene.add(group);
}

// The countdown has 3 steps, the gantry has 5 lights:
// step 1 -> 2 red lights, step 2 -> 4, step 3 -> all 5, 'go' -> all green, 0 -> all off
function setLights(n) {
  const lit = n === 'go' ? 5 : [0, 2, 4, 5][n] || 0;
  gantryLights.forEach((l, i) => {
    l.material.color.set(n === 'go' ? '#18ff5a' : (i < lit ? '#ff2a12' : '#3a0606'));
  });
  if (n === 'go') setTimeout(() => setLights(0), 1500);
}

// Make a picture with text on it (for banners and name tags)
function textTexture(text, w, h, color, bg, border) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect ? g.roundRect(2, 2, w - 4, h - 4, h * 0.25) : g.rect(2, 2, w - 4, h - 4);
    g.fill();
    if (border) { g.lineWidth = 6; g.strokeStyle = border; g.stroke(); }
  }
  g.fillStyle = color;
  g.font = `bold ${Math.round(h * 0.62)}px "Russo One", Inter, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2, w - 20);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- 3. Sky, sun and lights ---------------- */

function addSkyAndLights(colors) {
  // Sky: a giant ball around the camera, blue at the top and pale at the horizon
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(colors.top) }, horizon: { value: new THREE.Color(colors.horizon) } },
    vertexShader: 'varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vPos; void main(){ float h = clamp(vPos.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, h), 1.0); }',
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  sky = new THREE.Mesh(new THREE.SphereGeometry(q.fogFar + 400, 24, 12), skyMat);
  sky.renderOrder = -1;
  scene.add(sky);

  // Soft light from the whole sky, plus sunlight that makes shadows
  scene.add(new THREE.HemisphereLight('#dbeeff', track.theme.bg, 1.4));
  sun = new THREE.DirectionalLight('#fff4dd', 2.4);
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  const s = sun.shadow.camera;
  s.left = -320; s.right = 320; s.top = 320; s.bottom = -320; s.near = 10; s.far = 1600;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);

  // A glowing sun disc in the sky
  const disc = new THREE.Mesh(new THREE.CircleGeometry(110, 32), new THREE.MeshBasicMaterial({ color: '#fff6d0', fog: false }));
  disc.userData.isSunDisc = true;
  sky.add(disc);
  const dir = new THREE.Vector3(0.45, 0.55, 0.35).normalize();
  disc.position.copy(dir.clone().multiplyScalar(q.fogFar));
  disc.lookAt(0, 0, 0);
  sun.userData.dir = dir;
}

/* ---------------- 4. Cars ---------------- */

// The car model itself is built in car3d.js. Each car gets its own number
// (its grid position + 1) and the player's name painted on it.
function addCar(id, colorHex, name, number) {
  const { group, frontWheels, helmet } = buildCar({ colorHex, number, name, quality: qName });

  // Floating name tag
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: textTexture(name, 256, 64, '#ffffff', 'rgba(0,0,0,0.6)', colorHex), depthWrite: false, fog: false
  }));
  label.scale.set(30, 7.5, 1);
  label.position.set(0, 16, 0);
  group.add(label);

  if (id === myId) label.visible = false; // no need to see my own name

  scene.add(group);
  cars.set(id, { group, frontWheels, label, helmet });
}

function removeCar(id) {
  const c = cars.get(id);
  if (!c) return;
  scene.remove(c.group);
  c.label.material.map.dispose();
  c.label.material.dispose();
  cars.delete(id);
}

/* ---------------- 5. Camera and drawing each frame ---------------- */

// data: { me: {x, y, a, speedRatio, steer, wallHit, bump}, cars: [{id, x, y, a}], dt }
function frame(data) {
  if (!scene) return;
  const dt = data.dt;

  // Resize the drawing area if the window changed
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio()))
    renderer.setSize(w, h, false);

  // Move every car to its position (2D x, y -> 3D x, z)
  data.cars.forEach(c => {
    const car = cars.get(c.id);
    if (!car) return;
    car.group.position.set(c.x, 0, c.y);
    car.group.rotation.y = -c.a;
  });

  // Front wheels turn smoothly when I steer
  const me = data.me;
  steerVis += (me.steer - steerVis) * Math.min(1, dt * 12);
  const mine = cars.get(myId);
  if (mine) mine.frontWheels.forEach(fw => { fw.rotation.y = -steerVis * 0.38; });

  // Camera shake: tiny vibration at high speed, bigger when hitting a barrier
  // or another car, and a rumble while driving on grass/gravel
  const speedRatio = Math.max(0, me.speedRatio);
  if (me.wallHit > 90) shake = Math.min(3, shake + me.wallHit / 110);
  if (me.bump > 40) shake = Math.min(3, shake + me.bump / 120);
  shake *= Math.exp(-dt * 6);
  const grassRumble = me.onGrass ? 0.5 * Math.min(1, speedRatio * 3) : 0;
  const amp = speedRatio * speedRatio * 0.12 + shake + grassRumble;
  const rand = () => (Math.random() - 0.5) * 2 * amp;

  // T-cam: on top of the car, just above and behind the helmet, looking forward
  const fx = Math.cos(me.a), fz = Math.sin(me.a);
  camera.position.set(me.x - fx * TCAM.back, TCAM.height + rand() * 0.25, me.y - fz * TCAM.back);
  camera.lookAt(me.x + fx * TCAM.lookAhead + rand() * 0.4, TCAM.lookHeight + rand() * 0.4, me.y + fz * TCAM.lookAhead);
  // A tiny tilt when cornering (the car leans a little)
  camera.rotateZ(steerVis * speedRatio * 0.035);
  if (camOverride) {
    // Test camera, positioned relative to my car (forward, up, right)
    const o = camOverride, rx = -fz, rz = fx;
    camera.position.set(me.x + fx * o.f + rx * o.r, o.u, me.y + fz * o.f + rz * o.r);
    camera.lookAt(me.x + fx * o.lf, o.lu, me.y + fz * o.lf);
  }

  // Fairly wide view, and still wide enough on tall phone screens
  const aspect = w / Math.max(1, h);
  const hFov = 92 * Math.PI / 180;
  const vFov = 2 * Math.atan(Math.tan(hFov / 2) / aspect) * 180 / Math.PI;
  camera.fov = Math.max(56, Math.min(95, vFov)) + speedRatio * 4; // widens slightly at speed
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  // Sky and sunlight follow the camera
  sky.position.copy(camera.position);
  const dir = sun.userData.dir;
  sun.position.set(me.x + dir.x * 800, dir.y * 800, me.y + dir.z * 800);
  sun.target.position.set(me.x + fx * 150, 0, me.y + fz * 150);

  renderer.render(scene, camera);
}

// For automatic testing only: draw one frame and read back the color of one pixel
function debugPixel(px, py) {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const out = new Uint8Array(4);
  gl.readPixels(Math.floor(px * canvas.width), Math.floor((1 - py) * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return Array.from(out.slice(0, 3));
}

// For automatic testing only: view my car from a chosen spot
// f = forward, u = up, r = right (from the car's centre); lf/lu = point to look at
function debugCamera(o) { camOverride = o; }

window.Render3D = { start, stop, frame, setLights, removeCar, getCanvas, debugPixel, debugCamera };
