/* =====================================================================
   E1 (EQUATION 1) - TEAM PREVIEW (Play Offline and lobby screens)
   ---------------------------------------------------------------------
   Shows the car in the chosen team's livery, slowly turning, so you can
   see the paint job before the race. Uses the same car model as the race.
   Usage: TeamPreview.show(canvas, teamId, playerName)
   ===================================================================== */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCar } from './car3d.js';

const views = new Map();   // canvas -> { renderer, scene, camera, car, key }

function setup(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;   // shiny paint reflections
  scene.environmentIntensity = 0.6;
  pm.dispose();
  scene.add(new THREE.HemisphereLight('#ffffff', '#40444f', 1.4));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(20, 40, 25);
  scene.add(sun);
  // a round floor the car stands on
  const floor = new THREE.Mesh(new THREE.CircleGeometry(36, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#20242f', roughness: 0.6, metalness: 0.2 }));
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(30, 2, 1, 500);
  const v = { renderer, scene, camera, car: null, key: '' };
  views.set(canvas, v);
  return v;
}

function show(canvas, teamId, name) {
  if (!canvas || !window.RaceRules) return;
  const team = RaceRules.COLORS.find(c => c.id === teamId) || RaceRules.COLORS[0];
  let v = views.get(canvas);
  try { if (!v) v = setup(canvas); } catch (e) { return; }   // no 3D on this device: skip
  const key = team.id + '|' + name;
  if (v.key === key) return;
  v.key = key;
  if (v.car) v.scene.remove(v.car);
  v.car = buildCar({ colorHex: team.hex, number: RaceRules.COLORS.indexOf(team) + 1, name: name || team.short, quality: 'high' }).group;
  v.scene.add(v.car);
}

// Draw the previews that are on screen (the car turns slowly)
function loop(t) {
  requestAnimationFrame(loop);
  views.forEach((v, canvas) => {
    if (!v.car || !canvas.offsetParent) return;   // hidden screen: don't draw
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * v.renderer.getPixelRatio())) v.renderer.setSize(w, h, false);
    v.camera.aspect = w / Math.max(1, h);
    const a = t / 3200;
    v.camera.position.set(Math.cos(a) * 50, 15, Math.sin(a) * 50);
    v.camera.lookAt(0, 2.5, 0);
    v.camera.updateProjectionMatrix();
    v.renderer.render(v.scene, v.camera);
  });
}
requestAnimationFrame(loop);

window.TeamPreview = { show };
