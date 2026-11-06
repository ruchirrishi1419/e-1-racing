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
  clear: 'kloofendal_43d_clear_puresky',
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

/* Sky / weather presets (visual only - grip never changes):
   clear    = hard sun, clear blue sky
   clouds   = scattered clouds (default)
   overcast = grey sky, soft flat light, muted colours, closer haze
   rain     = like overcast but darker, with rain streaks falling past the camera */
const WEATHER = ['clear', 'clouds', 'overcast', 'rain'];

/* opts: { scene, renderer, quality, timeOfDay, weather, floodlights, nightMaterials, fogFar } */
export function setupEnvironment(opts) {
  const { scene, renderer, quality } = opts;
  const tod = PRESETS[opts.timeOfDay] ? opts.timeOfDay : 'day';
  const P = { ...PRESETS[tod] };
  const night = tod === 'night';
  const weather = WEATHER.includes(opts.weather) ? opts.weather : 'clouds';
  const grey = weather === 'overcast' || weather === 'rain';
  if (weather === 'clear' && !night) { P.sun *= 1.15; P.hemi *= 0.9; }
  if (grey) {
    // flat grey light: weak sun, stronger soft sky light, grey haze closer in
    P.sun *= weather === 'rain' ? 0.18 : 0.3;
    P.hemi *= 1.6; P.hemiSky = night ? '#8a93a6' : '#c7ccd3'; P.hemiGround = '#4a4f55';
    P.fallbackFog = night ? '#0d1118' : weather === 'rain' ? '#7d858f' : '#9aa1aa';
    P.exposure *= weather === 'rain' ? 0.85 : 0.92;
  }

  // Fog makes far-away things fade into the sky (also hides where the world ends)
  // only a very light haze right at the horizon, so you can see far (a bit more in overcast / rain)
  scene.fog = new THREE.Fog(P.fallbackFog, opts.fogFar * (grey ? 0.2 : 0.6), opts.fogFar * (grey ? 0.75 : 1.1));
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
  // Grey weather in the day/sunset: no sky photo, just a grey cloudy dome
  if (grey && !night) {
    const c1 = new THREE.Color(weather === 'rain' ? '#5d646d' : '#7f8792'), c2 = new THREE.Color(P.fallbackFog);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(opts.fogFar * 1.4, 24, 12), new THREE.ShaderMaterial({
      uniforms: { top: { value: c1 }, bottom: { value: c2 } }, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(vP.y * 2.0, 0.0, 1.0)), 1.0); }'
    }));
    dome.userData.followCamera = true;
    dome.renderOrder = -1;
    scene.add(dome);
  }
  // Rain streaks: short lines that fall past the camera
  let rain = null;
  if (weather === 'rain') {
    const N = quality === 'low' ? 900 : 1800, pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 500, y = Math.random() * 160, z = (Math.random() - 0.5) * 500;
      pos.set([x, y, z, x - 0.6, y - 7, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#c8d2e0', transparent: true, opacity: 0.45, fog: false }));
    rain.frustumCulled = false;
    rain.userData.fall = 0;
    scene.add(rain);
  }

  if (!(grey && !night)) loadSky(SKIES[weather === 'clear' && tod === 'day' ? 'clear' : tod], { day: 16, sunset: 8, night: 2 }[tod]).then(sky => {
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
    if (rain) {
      // every streak falls on its own and starts again at the top when it reaches the bottom;
      // the whole box of rain moves with the camera
      const p = rain.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 6) {
        p[i + 1] -= 9; p[i + 4] -= 9;
        if (p[i + 1] < 0) { p[i + 1] += 160; p[i + 4] += 160; }
      }
      rain.geometry.attributes.position.needsUpdate = true;
      rain.position.set(camera.position.x, camera.position.y - 60, camera.position.z);
    }
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

  return { update, sun, night, weather, timeOfDay: tod, bloomStrength: night ? 0.5 : tod === 'sunset' ? 0.35 : 0.25 };
}
