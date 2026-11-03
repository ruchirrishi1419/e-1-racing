/* =====================================================================
   E1 (EQUATION 1) - PODIUM CELEBRATION (shown on the results screen)
   ---------------------------------------------------------------------
   The top 3 drivers stand on the podium (1st in the middle and highest,
   2nd on the left, 3rd on the right) in their team colors, waving.
   The winner holds a gold trophy. Fireworks burst in the night sky
   behind them.
   Usage: Podium.show(canvas, [{ name, colorId }, ...top 3])  /  Podium.stop()
   ===================================================================== */

import * as THREE from 'three';

let renderer = null, scene = null, camera = null, raf = 0, running = false;
let drivers = [], bursts = [], lastBurst = 0, t0 = 0;
const disposables = [];

function team(colorId) {
  const t = (window.RaceRules && RaceRules.COLORS.find(c => c.id === colorId)) || {};
  return { main: t.hex || '#cccccc', second: t.second || '#333333', accent: t.accent || '#ffffff', label: t.label || '' };
}

// A picture with text on it (names, step numbers, banner)
function textTex(text, w, h, color, bg, font) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color;
  g.font = font || `bold ${Math.round(h * 0.6)}px "Russo One", Arial Black, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2, w - 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  disposables.push(t);
  return t;
}

const mat = (color, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }); disposables.push(m); return m; };

// A simple racing driver: race suit in the team colors, helmet with visor, arms that wave
function makeDriver(colors, withTrophy) {
  const g = new THREE.Group();
  const suit = mat(colors.main), second = mat(colors.second), visorM = mat('#0a0a0c', { roughness: 0.1, metalness: 0.6 });
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.5, 6, 10), second);
  legs.position.y = 1.3; legs.scale.x = 1.3;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 1.2, 6, 12), suit);
  body.position.y = 3.0;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.25, 16), mat(colors.accent));
  belt.position.y = 2.35;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.72, 20, 14), mat(colors.main, { roughness: 0.25 }));
  helmet.position.y = 4.65;
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.08, 8, 24), mat(colors.accent));
  stripe.position.y = 4.65; stripe.rotation.y = Math.PI / 2;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.74, 16, 8, -0.9, 1.8, 1.2, 0.6), visorM);
  visor.position.y = 4.65; visor.rotation.y = Math.PI / 2;
  g.add(legs, body, belt, helmet, stripe, visor);

  // arms on shoulder pivots so they can wave
  const arms = [-1, 1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.95, 3.6, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.3, 4, 8), suit);
    arm.position.y = 0.75;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), second);
    glove.position.y = 1.55;
    pivot.add(arm, glove);
    if (withTrophy && side === 1) {
      // gold trophy held up high
      const gold = mat('#ffcf3a', { metalness: 0.9, roughness: 0.25, emissive: '#5a3a00', emissiveIntensity: 0.4 });
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.25, 1.1, 16, 1, true), gold);
      cup.position.y = 2.45;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), gold);
      stem.position.y = 1.75;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.15, 12), gold);
      base.position.y = 1.55;
      pivot.add(cup, stem, base);
    }
    g.add(pivot);
    return { pivot, side };
  });
  return { group: g, arms };
}

// Name tag floating above a driver
function nameTag(text, colors, place) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex(`P${place}  ${text}`, 512, 96, '#ffffff', 'rgba(0,0,0,0.65)'), depthWrite: false }));
  disposables.push(sp.material);
  sp.scale.set(5.2, 1.0, 1);
  return sp;
}

/* ---------------- Fireworks ---------------- */
const FW_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ff2d95', '#ffffff', '#ff9500', '#5ac8fa'];
function spawnBurst() {
  const n = 160;
  const pos = new Float32Array(n * 3), vel = [];
  const centre = new THREE.Vector3((Math.random() - 0.5) * 30, 11 + Math.random() * 7, -12 - Math.random() * 8);
  const speed = 5 + Math.random() * 4;
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(speed * (0.7 + Math.random() * 0.3));
    vel.push(v);
    pos.set([centre.x, centre.y, centre.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const color = new THREE.Color(FW_COLORS[(Math.random() * FW_COLORS.length) | 0]).multiplyScalar(2.2);
  const m = new THREE.PointsMaterial({ color, size: 0.6, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pts = new THREE.Points(geo, m);
  scene.add(pts);
  bursts.push({ pts, vel, age: 0, life: 1.8 + Math.random() * 0.6 });
  if (window.Sound && Sound.firework) Sound.firework();
}

function updateBursts(dt) {
  bursts = bursts.filter(b => {
    b.age += dt;
    const p = b.pts.geometry.attributes.position;
    for (let i = 0; i < b.vel.length; i++) {
      const v = b.vel[i];
      v.y -= 3.2 * dt;               // gravity
      v.multiplyScalar(1 - 0.9 * dt); // air slows the sparks
      p.setXYZ(i, p.getX(i) + v.x * dt, p.getY(i) + v.y * dt, p.getZ(i) + v.z * dt);
    }
    p.needsUpdate = true;
    b.pts.material.opacity = Math.max(0, 1 - b.age / b.life);
    if (b.age > b.life) {
      scene.remove(b.pts);
      b.pts.geometry.dispose(); b.pts.material.dispose();
      return false;
    }
    return true;
  });
}

/* ---------------- Show / stop ---------------- */
function show(canvas, top3) {
  stop();
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) { return false; }
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#070b1a');
  scene.fog = new THREE.Fog('#070b1a', 30, 70);
  camera = new THREE.PerspectiveCamera(46, 2, 0.1, 200);

  scene.add(new THREE.HemisphereLight('#c9d6ff', '#202030', 1.2));
  const spot = new THREE.SpotLight('#fff3dd', 600, 60, 0.6, 0.5, 1.5);
  spot.position.set(0, 22, 14);
  scene.add(spot, spot.target);
  const fill = new THREE.DirectionalLight('#ffffff', 1.2);
  fill.position.set(-6, 8, 10);
  scene.add(fill);

  // floor and back wall with a banner
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), mat('#2a2d36', { roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(15, 2.4), new THREE.MeshBasicMaterial({ map: textTex('E1 – EQUATION 1   ·   PODIUM', 1024, 160, '#ffcc00', '#c8170c') }));
  wall.position.set(0, 1.6, -3);
  scene.add(floor, wall);

  // the three steps: 2nd (left), 1st (middle, tallest), 3rd (right)
  const layout = [{ place: 2, x: -4.2, h: 2.2 }, { place: 1, x: 0, h: 3.2 }, { place: 3, x: 4.2, h: 1.5 }];
  drivers = [];
  layout.forEach(L => {
    const step = new THREE.Mesh(new THREE.BoxGeometry(4, L.h, 3.4), mat('#f3f4f6', { roughness: 0.4 }));
    step.position.set(L.x, L.h / 2, 0);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: textTex(String(L.place), 128, 128, L.place === 1 ? '#c99a00' : L.place === 2 ? '#8b9096' : '#a0612b') }));
    num.position.set(L.x, L.h / 2, 1.71);
    scene.add(step, num);
    const d = top3[L.place - 1];
    if (!d) return;
    const colors = team(d.colorId);
    const dr = makeDriver(colors, L.place === 1);
    dr.group.position.set(L.x, L.h, 0);
    const tag = nameTag(d.name, colors, L.place);
    tag.position.set(L.x, L.h + (L.place === 1 ? 7.6 : 6.4), 0);   // higher for the winner (above the trophy)
    scene.add(dr.group, tag);
    drivers.push({ ...dr, place: L.place, phase: Math.random() * 6 });
  });

  bursts = [];
  lastBurst = 0;
  t0 = performance.now();
  running = true;
  const loop = now => {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, (now - (loop.last || now)) / 1000);
    loop.last = now;
    // resize to the canvas size
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    // slow camera sway
    camera.position.set(Math.sin(t * 0.25) * 3, 5, 16.5);
    camera.lookAt(0, 6.2, 0);
    camera.updateProjectionMatrix();
    // drivers wave and bounce (the winner jumps with the trophy)
    drivers.forEach(d => {
      const k = t * (d.place === 1 ? 5 : 3.5) + d.phase;
      d.arms.forEach(a => {
        // 0 = arm straight up; a bigger angle tilts it outwards (waving)
        const tilt = d.place === 1 && a.side === 1 ? 0.08 : 0.45 + Math.sin(k + a.side) * 0.35;
        a.pivot.rotation.z = -a.side * tilt;
      });
      d.group.position.y = (d.place === 1 ? 3.2 : d.place === 2 ? 2.2 : 1.5) + Math.max(0, Math.sin(k * 0.8)) * (d.place === 1 ? 0.5 : 0.2);
      d.group.rotation.y = Math.sin(t * 0.7 + d.phase) * 0.25;
    });
    // fireworks
    if (t - lastBurst > 0.45 + Math.random() * 0.4) { spawnBurst(); lastBurst = t; }
    updateBursts(dt);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  return true;
}

function stop() {
  running = false;
  cancelAnimationFrame(raf);
  bursts.forEach(b => { b.pts.geometry.dispose(); b.pts.material.dispose(); });
  bursts = [];
  if (scene) scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  disposables.forEach(d => d.dispose && d.dispose());
  disposables.length = 0;
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null;
}

window.Podium = { show, stop };
