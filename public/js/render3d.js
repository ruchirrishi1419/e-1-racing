/* =====================================================================
   E1 (EQUATION 1) - 3D GRAPHICS (halo cockpit view) using Three.js
   ---------------------------------------------------------------------
   This file only DRAWS things. Driving, laps, AI and multiplayer still
   happen in the other files, exactly like before.

   How the flat 2D game world becomes 3D:
     2D position (x, y)  ->  3D position (x, height of the ground, y)

   It puts together:
     track3d.js    the road, kerbs, barriers, hills, racing line
     scenery3d.js  grandstands, crowd, pit building, trees, buildings...
     env3d.js      sky, sun/moon, lights, Day / Sunset / Night
     car3d.js      the cars and my cockpit (steering wheel, gloves)
   and adds the camera (driver's eyes, looking through the halo), working
   mirrors, TV screens showing the race, and screen effects (glow on
   lights, speed blur).
   ===================================================================== */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCar, buildCockpit } from './car3d.js';
import { buildTrack } from './track3d.js';
import { buildScenery } from './scenery3d.js';
import { setupEnvironment } from './env3d.js';

/* ---------------- Quality presets (Graphics: Low / Medium / High) ---------------- */
const QUALITY = {
  low:    { pixelRatio: 0.75, antialias: true,  fogFar: 2600, post: false, samples: 0, mirror: 160, mirrorEvery: 3, tv: 0,   tvEvery: 0 },
  medium: { pixelRatio: 1,    antialias: false, fogFar: 3600, post: true,  samples: 2, mirror: 256, mirrorEvery: 2, tv: 256, tvEvery: 8 },
  high:   { pixelRatio: 1.5,  antialias: false, fogFar: 4800, post: true,  samples: 4, mirror: 384, mirrorEvery: 1, tv: 384, tvEvery: 4 }
};

// The driver's eyes, in the car's own coordinates (x = forward, y = up, z = right)
const EYE = new THREE.Vector3(-2.0, 6.15, 0);
const WHEEL_POS = new THREE.Vector3(1.05, 4.9, 0);

let renderer = null, canvas = null, currentAntialias = null, roomEnv = null;
let scene = null, camera = null, composer = null, bloomPass = null, blurPass = null;
let q = QUALITY.medium, qName = 'medium';
let track = null, myId = null, world = null, scenery = null, env = null;
let cars = new Map();       // id -> { group, frontWheels, label }
let cockpit = null;         // my steering wheel and gloves
let mirror = null, tv = null;
let shake = 0, steerVis = 0, frameNo = 0;
let camOverride = null;
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

/* ---------------- Start / stop ---------------- */

// Returns true if 3D works on this device, false if not (then the game uses 2D)
function start(opts) {
  try {
    qName = QUALITY[opts.quality] ? opts.quality : 'medium';
    q = QUALITY[qName];
    if (!renderer || currentAntialias !== q.antialias) createRenderer(opts.canvas);
    track = opts.track;
    myId = opts.myId;
    buildScene(opts.timeOfDay || 'day');
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
  renderer.toneMapping = THREE.NeutralToneMapping;   // natural colors that stay bright and true
  renderer.info.autoReset = false;                   // count drawing work for the whole frame (for testing)
  // Simple built-in reflections, used until the real sky picture has loaded
  const pmrem = new THREE.PMREMGenerator(renderer);
  roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

function stop() {
  if (scene) disposeScene(scene);
  scene = null;
  cars.clear();
  cockpit = null;
}

function getCanvas() { return canvas; }

// Free the graphics memory used by the old track
function disposeScene(s) {
  s.traverse(obj => {
    if (obj.geometry && !obj.userData.sharedGeo) obj.geometry.dispose();
    if (obj.material) {
      [].concat(obj.material).forEach(m => {
        if (m.userData.shared) return;
        if (m.map && !m.map.userData.shared) m.map.dispose();
        m.dispose();
      });
    }
  });
  if (mirror) { mirror.target.dispose(); mirror = null; }
  if (tv) { tv.target.dispose(); tv = null; }
  if (composer) { composer.dispose(); composer = null; }
}

/* ---------------- Building the world ---------------- */

function buildScene(timeOfDay) {
  if (scene) disposeScene(scene);
  scene = new THREE.Scene();
  scene.environment = qName === 'low' ? null : roomEnv;
  scene.environmentIntensity = 0.5;
  cars.clear();
  cockpit = null;

  camera = new THREE.PerspectiveCamera(70, 1, 0.12, q.fogFar * 1.7 + 800);
  camera.layers.enable(1);          // layer 1 = crowd and trees (skipped by mirrors and TV cameras)

  renderer.shadowMap.enabled = qName !== 'low';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));

  const t0 = performance.now();
  world = buildTrack({ scene, track, quality: qName, renderer });
  const t1 = performance.now();
  scenery = buildScenery({ scene, track, quality: qName, world });
  window.__e1Build = { track: Math.round(t1 - t0), scenery: Math.round(performance.now() - t1) };
  env = setupEnvironment({
    scene, renderer, quality: qName, timeOfDay, fogFar: q.fogFar,
    floodlights: scenery.floodlights,
    nightMaterials: [...world.nightMaterials.map(mat => ({ mat, emissive: true, night: 0.9 })), ...scenery.nightMaterials]
  });

  setupMirror();
  setupTV();
  setupPost();
}

// Mirrors: a small camera looking backwards draws into a picture shown on the mirror glass
function setupMirror() {
  const size = q.mirror;
  const target = new THREE.WebGLRenderTarget(size * 2, size, { type: THREE.HalfFloatType });
  const cam = new THREE.PerspectiveCamera(28, 2, 1, 1400);
  mirror = { target, cam, material: new THREE.MeshBasicMaterial({ map: target.texture }) };
}

// TV screens around the track show the race from a "broadcast" camera
function setupTV() {
  if (!q.tv) {
    const logo = document.createElement('canvas');
    logo.width = 256; logo.height = 144;
    const g = logo.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 144);
    grad.addColorStop(0, '#c8170c'); grad.addColorStop(1, '#5a0a06');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 144);
    g.fillStyle = '#ffcc00'; g.font = 'italic bold 70px "Russo One", Arial Black'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('E1', 128, 64);
    g.fillStyle = '#fff'; g.font = 'bold 16px Arial'; g.fillText('LIVE  ·  EQUATION 1', 128, 116);
    const t = new THREE.CanvasTexture(logo);
    t.colorSpace = THREE.SRGBColorSpace;
    scenery.screens.forEach(m => { m.map = t; m.color.setScalar(1.6); m.needsUpdate = true; });
    tv = null;
    return;
  }
  const target = new THREE.WebGLRenderTarget(Math.round(q.tv * 16 / 9), q.tv, { type: THREE.HalfFloatType });
  const cam = new THREE.PerspectiveCamera(32, 16 / 9, 2, 2500);
  scenery.screens.forEach(m => { m.map = target.texture; m.color.setScalar(1.3); m.needsUpdate = true; });
  tv = { target, cam, follow: null };
}

// Screen effects: glow around bright lights (bloom) and a speed blur at the edges
const SpeedBlurShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main(){
      vec2 c = vec2(0.5, 0.55); vec2 d = vUv - c;
      float edge = smoothstep(0.12, 0.6, length(d));
      vec4 col = vec4(0.0);
      for (int i = 0; i < 8; i++) col += texture2D(tDiffuse, c + d * (1.0 - amount * edge * float(i) / 7.0));
      gl_FragColor = col / 8.0;
    }`
};
function setupPost() {
  if (!q.post) { composer = null; return; }
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: q.samples });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), env.bloomStrength, 0.45, 1.0);
  composer.addPass(bloomPass);
  blurPass = new ShaderPass(SpeedBlurShader);
  composer.addPass(blurPass);
  composer.addPass(new OutputPass());
}

/* ---------------- Cars ---------------- */

function addCar(id, colorHex, name, number) {
  const built = buildCar({ colorHex, number, name, quality: qName });
  const { group, frontWheels } = built;
  group.rotation.order = 'YZX';   // turn (yaw), then nose up/down (pitch), then lean (roll)

  // Floating name tag
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: textTexture(name, 256, 64, '#ffffff', 'rgba(0,0,0,0.6)', colorHex), depthWrite: false, fog: false
  }));
  label.scale.set(30, 7.5, 1);
  label.position.set(0, 16, 0);
  group.add(label);

  if (id === myId) {
    label.visible = false;          // no need to see my own name
    built.helmet.visible = false;   // the camera is inside my helmet
    built.visor.visible = false;
    // steering wheel, gloves and arms
    cockpit = buildCockpit({ colorHex, quality: qName });
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
    cockpit.pivot.quaternion.setFromRotationMatrix(basis);
    cockpit.pivot.rotateX(-0.42);     // lean the top of the wheel away from the driver
    cockpit.pivot.position.copy(WHEEL_POS);
    group.add(cockpit.pivot);
    // mirror glass that shows the picture from the rear camera
    [1, -1].forEach(side => {
      const glass = new THREE.CircleGeometry(1, 20).scale(0.31, 0.36, 1).rotateY(-Math.PI / 2);
      const uv = glass.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, side > 0 ? 0.5 - 0.5 * uv.getX(i) : 1 - 0.5 * uv.getX(i));
      glass.translate(4.14, 5.6, 4.6 * side);
      group.add(new THREE.Mesh(glass, mirror.material));
    });
  }

  scene.add(group);
  cars.set(id, { group, frontWheels, label });
}

function removeCar(id) {
  const c = cars.get(id);
  if (!c) return;
  scene.remove(c.group);
  c.label.material.map.dispose();
  c.label.material.dispose();
  cars.delete(id);
}

// Make a picture with text on it (for name tags)
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

// Put a car on the ground: follow hills and banking (nose up/down, lean left/right)
function placeOnGround(group, x, y, a) {
  const h = world.heightAt;
  const fx = Math.cos(a), fy = Math.sin(a);
  const hF = h(x + fx * 16, y + fy * 16), hB = h(x - fx * 16, y - fy * 16);
  const hR = h(x - fy * 8, y + fx * 8), hL = h(x + fy * 8, y - fx * 8);
  group.position.set(x, (hF + hB + hR + hL) / 4, y);
  group.rotation.set(-Math.atan((hR - hL) / 16), -a, Math.atan((hF - hB) / 32));
}

/* ---------------- Start lights (5 on the gantry) ---------------- */
// countdown step 1 -> 2 red lights, 2 -> 4, 3 -> all 5, 'go' -> all green, 0 -> all off
function setLights(n) {
  if (!scenery) return;
  const lit = n === 'go' ? 5 : [0, 2, 4, 5][n] || 0;
  scenery.gantryLights.forEach((l, i) => {
    if (n === 'go') l.material.color.setRGB(0.3, 4, 0.8);
    else if (i < lit) l.material.color.setRGB(5, 0.25, 0.1);
    else l.material.color.set('#3a0606');
  });
  if (n === 'go') setTimeout(() => setLights(0), 1500);
}

/* ---------------- Every frame ---------------- */

/* data: {
     dt, time,
     me: { x, y, a, speed, speedRatio, steer, wallHit, bump, onGrass, trackIndex, trackDist,
           gear, rpm, kmh, lap, laps, pos, total },
     cars: [{ id, x, y, a }], leaderId, racingLine (true/false) } */
function frame(data) {
  if (!scene) return;
  const dt = data.dt, me = data.me;
  frameNo++;
  renderer.info.reset();

  // Resize the drawing area if the window changed
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const pr = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
    renderer.setSize(w, h, false);
    if (composer) { composer.setSize(w, h); bloomPass.resolution.set(w / 2, h / 2); }
  }

  // Move every car to its position
  data.cars.forEach(c => {
    const car = cars.get(c.id);
    if (car) placeOnGround(car.group, c.x, c.y, c.a);
  });

  // Steering: front wheels, steering wheel and gloves turn smoothly
  steerVis += (me.steer - steerVis) * Math.min(1, dt * 10);
  const mine = cars.get(myId);
  if (mine) mine.frontWheels.forEach(fw => { fw.rotation.y = -steerVis * 0.38; });
  if (cockpit) {
    cockpit.inner.rotation.z = -steerVis * 1.25;
    cockpit.updateRevs(me.rpm);
    if (frameNo % 4 === 0) cockpit.updateScreen({ gear: me.gear, speed: me.kmh, lap: me.lap, laps: me.laps, pos: me.pos });
  }

  // Camera shake: vibration at high speed, rumble on kerbs and grass, a jolt on impacts
  const speedRatio = Math.max(0, me.speedRatio);
  const info = world.an.info[me.trackIndex] || {};
  const onKerb = info.corner && Math.abs(me.trackDist - track.halfWidth) < 13 && speedRatio > 0.15;
  if (me.wallHit > 90) shake = Math.min(3, shake + me.wallHit / 110);
  if (me.bump > 40) shake = Math.min(3, shake + me.bump / 120);
  shake *= Math.exp(-dt * 6);
  const rumble = (onKerb ? 0.9 : 0) + (me.onGrass ? 0.6 : 0);
  const amp = speedRatio * speedRatio * 0.35 + shake * 2 + rumble * Math.min(1, speedRatio * 3);
  const jitter = () => (Math.random() - 0.5) * 2 * amp;

  // Halo cockpit camera: at the driver's eyes, looking forward
  if (mine) {
    mine.group.updateMatrixWorld();
    camera.position.copy(EYE).applyMatrix4(mine.group.matrixWorld);
    tmpV.set(EYE.x + 100, EYE.y - 9, 0).applyMatrix4(mine.group.matrixWorld);
    camera.up.set(0, 1, 0).applyQuaternion(mine.group.quaternion);
    camera.lookAt(tmpV);
    camera.rotateX(jitter() * 0.0035);
    camera.rotateY(jitter() * 0.0035);
    camera.rotateZ(steerVis * speedRatio * 0.02 + jitter() * 0.002);  // tiny lean in corners
  }
  if (camOverride) {
    const o = camOverride, fx = Math.cos(me.a), fz = Math.sin(me.a), rx = -fz, rz = fx;
    const gh = world.heightAt(me.x, me.y);
    camera.up.set(0, 1, 0);
    camera.position.set(me.x + fx * o.f + rx * o.r, gh + o.u, me.y + fz * o.f + rz * o.r);
    camera.lookAt(me.x + fx * o.lf + rx * (o.lr || 0), gh + o.lu, me.y + fz * o.lf + rz * (o.lr || 0));
  }

  // Field of view: fairly wide, and still wide enough on tall phone screens
  const aspect = w / Math.max(1, h);
  const vFov = 2 * Math.atan(Math.tan((86 * Math.PI / 180) / 2) / aspect) * 180 / Math.PI;
  camera.fov = Math.max(50, Math.min(95, vFov)) + speedRatio * 3;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  // Racing line colors in front of me
  world.racing.update(me.trackIndex, me.speed, data.racingLine);

  // Crowd, sun/moon, far-away objects
  const groundH = world.heightAt(me.x, me.y);
  scenery.update(data.time, me.x, me.y, camera.position.x, camera.position.z);
  env.update(camera, me.x + Math.cos(me.a) * 150, me.y + Math.sin(me.a) * 150, groundH);

  // Shadows: draw them once per frame (not again for mirrors and TV)
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = false;

  // Mirrors: look backwards from just above the engine cover (my own car hidden)
  if (mine && frameNo % q.mirrorEvery === 0) {
    mine.group.visible = false;
    mirror.cam.position.set(-3, 8.6, 0).applyMatrix4(mine.group.matrixWorld);
    tmpV2.set(-200, -2, 0).applyMatrix4(mine.group.matrixWorld);
    mirror.cam.up.set(0, 1, 0);
    mirror.cam.lookAt(tmpV2);
    renderer.setRenderTarget(mirror.target);
    renderer.render(scene, mirror.cam);
    renderer.setRenderTarget(null);
    mine.group.visible = true;
  }

  // TV screens: a broadcast camera following the race leader
  if (tv && frameNo % q.tvEvery === 1) {
    const lead = cars.get(data.leaderId) || mine;
    if (lead) {
      const p = lead.group.position, yaw = -lead.group.rotation.y;
      const t = data.time * 0.15;
      tv.cam.position.set(p.x - Math.cos(yaw) * 70 + Math.sin(t) * 50, p.y + 34, p.z - Math.sin(yaw) * 70 + Math.cos(t) * 50);
      tv.cam.lookAt(p.x, p.y + 4, p.z);
      renderer.setRenderTarget(tv.target);
      renderer.render(scene, tv.cam);
      renderer.setRenderTarget(null);
    }
  }

  // Main picture (with effects on Medium and High)
  renderer.shadowMap.needsUpdate = true;
  if (composer) {
    blurPass.uniforms.amount.value = speedRatio > 0.55 ? (speedRatio - 0.55) * 0.09 : 0;
    composer.render(dt);
  } else {
    renderer.render(scene, camera);
  }
}

// How loud the crowd is at a spot (0 = nobody near, 1 = right next to a big grandstand)
function crowdLevel(x, y) {
  if (!scenery) return 0;
  let level = 0;
  scenery.stands.forEach(s => {
    const d = Math.hypot(s.x - x, s.y - y);
    level = Math.max(level, Math.min(1, s.size / 1000) * Math.max(0, 1 - d / 900));
  });
  return level;
}
function cheer(amount) { if (scenery) scenery.cheer(amount); }

/* ---------------- For automatic testing only ---------------- */
function debugPixel(px, py) {
  if (composer) composer.render(0); else renderer.render(scene, camera);
  const gl = renderer.getContext();
  const out = new Uint8Array(4);
  gl.readPixels(Math.floor(px * canvas.width), Math.floor((1 - py) * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return Array.from(out.slice(0, 3));
}
// view my car from a chosen spot: f = forward, u = up, r = right; lf/lu = point to look at
function debugCamera(o) { camOverride = o; }
function debugInfo() {
  const i = renderer.info;
  return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
}

function debugState() {
  const roadMats = [];
  world.group.traverse(o => { if (o.material && o.material.map && o.material.map.image) roadMats.push({ src: (o.material.map.image.src || '').split('/').pop(), ver: o.material.map.version, w: o.material.map.image.width }); });
  return { cam: camera.position.toArray().map(v => Math.round(v)), ground: Math.round(world.heightAt(camera.position.x, camera.position.z)),
           fog: scene.fog && scene.fog.color.getHexString(), bg: scene.background && (scene.background.isTexture ? 'texture' : scene.background.getHexString()), maps: roadMats.slice(0, 8) };
}
window.Render3D = { start, stop, frame, setLights, removeCar, getCanvas, crowdLevel, cheer, debugPixel, debugCamera, debugInfo, debugState };
