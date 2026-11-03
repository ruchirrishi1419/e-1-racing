/* =====================================================================
   E1 (EQUATION 1) - SKY, LIGHT AND TIME OF DAY
   ---------------------------------------------------------------------
   Day:    bright blue sky with clouds, high sun, soft shadows.
   Sunset: orange and pink sky, low sun, long shadows.
   Night:  dark sky with stars and a moon; tall floodlights light up the
           track like a real night race, billboards, screens, windows
           and grandstands glow.
   The skies are real 360-degree photos (HDRI) from Poly Haven (CC0).
   They also give the shiny car paint and metal realistic reflections.
   ===================================================================== */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const SKIES = {
  day: 'kloofendal_48d_partly_cloudy_puresky',
  sunset: 'qwantani_sunset_puresky',
  night: 'qwantani_night_puresky'
};

const PRESETS = {
  day:    { sunColor: '#fff3df', sun: 2.8, hemi: 0.55, hemiSky: '#cfe3ff', hemiGround: '#5d6a4c', env: 0.8, bg: 1.0, fallbackFog: '#c5d6e6', exposure: 1.0 },
  sunset: { sunColor: '#ff9a55', sun: 2.4, hemi: 0.4, hemiSky: '#ffb98c', hemiGround: '#4a3836', env: 0.6, bg: 0.8, fallbackFog: '#c98a6a', exposure: 0.92 },
  night:  { sunColor: '#dfe6ff', sun: 1.3, hemi: 1.05, hemiSky: '#fff0d6', hemiGround: '#40404a', env: 0.15, bg: 0.15, fallbackFog: '#0b1120', exposure: 1.0 }
};

const cache = new Map();   // name -> Promise of { texture, sunDir, horizon }
function loadSky(name, maxValue = 16) {
  if (cache.has(name)) return cache.get(name);
  const p = new Promise((resolve, reject) => {
    new RGBELoader().setDataType(THREE.FloatType).load(`assets/sky/${name}.hdr`, texture => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      resolve({ texture, ...analyseSky(texture, maxValue) });
    }, undefined, reject);
  });
  cache.set(name, p);
  return p;
}

// Look through the sky photo: where is the sun (the brightest spot)? What color is the horizon?
function analyseSky(texture, maxValue) {
  const { data, width: W, height: H } = texture.image;
  let best = -1, bx = 0, by = 0;
  const hor = [0, 0, 0];
  let hn = 0;
  for (let y = 0; y < H; y += 2) {
    const v = 1 - (y + 0.5) / H;           // 1 = straight up, 0.5 = horizon
    for (let x = 0; x < W; x += 2) {
      const k = (y * W + x) * 4;
      const lum = data[k] * 0.2126 + data[k + 1] * 0.7152 + data[k + 2] * 0.0722;
      if (v > 0.5 && lum > best) { best = lum; bx = x; by = y; }
      if (v > 0.5 && v < 0.53) { hor[0] += data[k]; hor[1] += data[k + 1]; hor[2] += data[k + 2]; hn++; }
    }
  }
  const u = (bx + 0.5) / W, v = 1 - (by + 0.5) / H;
  const el = (v - 0.5) * Math.PI, az = (u - 0.5) * Math.PI * 2;
  const sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
  const horizon = new THREE.Color(hor[0] / hn, hor[1] / hn, hor[2] / hn);
  // The sun in the photo can be thousands of times brighter than the sky. That is too
  // bright for the glow effect (it can turn the whole picture black), so cap it.
  for (let k = 0; k < data.length; k++) if (data[k] > maxValue) data[k] = maxValue;
  texture.needsUpdate = true;
  return { sunDir, horizon, sunStrength: best };
}

// Preload the day sky as soon as the game page opens (the default time of day)
loadSky(SKIES.day, 16).catch(() => {});

/* opts: { scene, renderer, quality, timeOfDay, floodlights, nightMaterials, fogFar } */
export function setupEnvironment(opts) {
  const { scene, renderer, quality } = opts;
  const tod = PRESETS[opts.timeOfDay] ? opts.timeOfDay : 'day';
  const P = PRESETS[tod];
  const night = tod === 'night';

  // Fog makes far-away things fade into the sky (also hides where the world ends)
  scene.fog = new THREE.Fog(P.fallbackFog, opts.fogFar * 0.25, opts.fogFar);
  scene.background = new THREE.Color(P.fallbackFog);
  renderer.toneMappingExposure = P.exposure;

  // Lights: soft light from the whole sky + the sun (or the moon at night)
  // On Low there are no sky reflections, so add a bit more general light instead
  const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemi + (quality === 'low' ? 0.8 : 0));
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(P.sunColor, P.sun);
  const shadows = quality !== 'low';
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  const sc = sun.shadow.camera;
  const span = tod === 'sunset' ? 420 : 340;
  sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 10; sc.far = 2600;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  let sunDir = new THREE.Vector3(0.45, 0.6, 0.35).normalize();
  if (tod === 'sunset') sunDir = new THREE.Vector3(0.8, 0.13, 0.4).normalize();
  if (night) sunDir = new THREE.Vector3(-0.3, 0.85, 0.2).normalize();

  // Night: moon, stars and floodlight glow
  const nightLights = [];
  if (night) {
    const moon = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({ color: '#fdf8e4', fog: false, toneMapped: false }));
    moon.userData.skyDir = new THREE.Vector3(-0.35, 0.42, -0.6).normalize();
    moon.userData.followCamera = true;
    scene.add(moon);
    const starPos = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 0.9 + 0.08, Math.random() * 2 - 1).normalize().multiplyScalar(opts.fogFar * 1.6);
      starPos.push(v.x, v.y, v.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    stars.userData.followCamera = true;
    scene.add(stars);
    // a few real lights that jump to the floodlights nearest to the camera (shiny reflections on the track)
    const count = quality === 'high' ? 6 : quality === 'medium' ? 3 : 0;
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight('#fff2dc', 2200, 800, 1.6);
      scene.add(l);
      nightLights.push(l);
    }
  }

  // Things that glow at night: billboards, screens, windows, floodlight lamps, grandstands
  (opts.nightMaterials || []).forEach(e => {
    if (e.emissive) e.mat.emissiveIntensity = night ? (e.night !== undefined ? e.night : 1.0) : (e.day || 0);
    else if (e.mat.emissive) { e.mat.emissive.set(e.color || '#ffffff'); e.mat.emissiveIntensity = night ? e.intensity : (e.day || 0); }
    e.mat.needsUpdate = true;
  });

  // Load the sky photo (it may take a second the first time)
  let fogTarget = null;
  loadSky(SKIES[tod], { day: 16, sunset: 8, night: 2 }[tod]).then(sky => {
    scene.background = sky.texture;
    scene.backgroundIntensity = P.bg;
    // reflections from the sky photo (done once, then cached on the texture)
    if (!sky.texture.userData.pmrem) {
      const pm = new THREE.PMREMGenerator(renderer);
      sky.texture.userData.pmrem = pm.fromEquirectangular(sky.texture).texture;
      pm.dispose();
    }
    if (quality !== 'low') { scene.environment = sky.texture.userData.pmrem; scene.environmentIntensity = P.env; }
    // the sun goes where the sun is in the photo (not at night)
    if (!night && sky.sunDir.y > 0.05) sunDir = sky.sunDir.clone();
    fogTarget = night ? new THREE.Color(P.fallbackFog) : sky.horizon.clone();
    const m = Math.max(fogTarget.r, fogTarget.g, fogTarget.b);
    if (m > 0.75) fogTarget.multiplyScalar(0.75 / m);   // keep the haze from going pure white
    scene.fog.color.copy(fogTarget);
  }).catch(err => console.warn('Sky picture could not be loaded:', err));

  // Every frame: the sun's shadows follow the area around my car; moon/stars follow the camera
  function update(camera, focusX, focusY, focusH) {
    sun.position.set(focusX + sunDir.x * 1200, focusH + sunDir.y * 1200, focusY + sunDir.z * 1200);
    sun.target.position.set(focusX, focusH, focusY);
    scene.children.forEach(o => {
      if (!o.userData.followCamera) return;
      if (o.userData.skyDir) o.position.copy(camera.position).addScaledVector(o.userData.skyDir, opts.fogFar * 1.5);
      else o.position.copy(camera.position);
    });
    if (nightLights.length && opts.floodlights && opts.floodlights.length) {
      const near = opts.floodlights
        .map(f => ({ f, d: (f.x - focusX) ** 2 + (f.z - focusY) ** 2 }))
        .sort((a, b) => a.d - b.d).slice(0, nightLights.length);
      near.forEach((o, k) => nightLights[k].position.set(o.f.x, o.f.y, o.f.z));
    }
  }

  return { update, sun, night, timeOfDay: tod, bloomStrength: night ? 0.5 : tod === 'sunset' ? 0.35 : 0.25 };
}
