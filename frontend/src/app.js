// app.js
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { createRenderer, createScene } from './scene.js';
import { jdUTC, centuriesTT, gmstRad } from './astro.js';
import {
  EARTH_RADIUS_KM,
  eciKmToThreeUnits,
  addStationKepler,
  attachTrail,
  updateTrail,
  stationActiveAt,
  clearTrail,
  propagateKepler,
  alignElementsToLatLonAtEpoch
} from './orbits.js';
import { addFlagMarker, addSurfaceMarker } from './markers.js';
import { PickManager, createHud, createAudioButton } from './interactivity.js';

// ---------- Boot ----------
const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const { scene, camera, earth, sun, sunMesh, texLoader, updateCelestials } = createScene(renderer);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 30;

// Scene scale for Moon updater
const MEAN_LUNAR_AU = 384400 / 149597870.7;
const AU_TO_UNITS = 5.0 / MEAN_LUNAR_AU;

// ---------- Time scale ----------
let speedMultiplier = 1000;
const realStart = Date.now();
const EPOCH_START_MS = Date.UTC(1957, 9, 4, 18, 0, 0, 0);
const simDate = () => new Date(EPOCH_START_MS + (Date.now() - realStart) * speedMultiplier);

// ---------- HUD + Picking ----------
const hud = createHud();
const pick = new PickManager(renderer, camera, hud.showInfo, hud.hideInfo);

// ---------- Audio control (upper-right play/pause) ----------
createAudioButton({
  src: '/audio/interstellar.mp3',  // place file under /public/audio or your static dir
  volume: 0.25,
  loop: true
});

// ---------- Helpers ----------
const pad2 = (n) => String(n).padStart(2, '0');

// ---------- Markers ----------
await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 45.9203, lonDeg: 63.3422, radiusUnits: 2.0,
  imageUrl: '/public/flags/kazakhstan.png', flagSize: [0.20, 0.12],
  title: 'Baikonur Cosmodrome — Site 1/5', subtitle: 'USSR / Kazakhstan',
  pickManager: pick
});
await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 28.4360, lonDeg: -80.5680, radiusUnits: 2.0,
  imageUrl: '/public/flags/usa.png', flagSize: [0.20, 0.12],
  title: 'Cape Canaveral', subtitle: 'USA',
  pickManager: pick
});
await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 40.9606, lonDeg: 100.2983, radiusUnits: 2.0,
  imageUrl: '/public/flags/china.png', flagSize: [0.20, 0.12],
  title: 'Jiuquan', subtitle: 'China',
  pickManager: pick
});
await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 35.0590, lonDeg: -118.1530, radiusUnits: 2.0,
  imageUrl: '/public/flags/usa.png', flagSize: [0.20, 0.12],
  title: 'Mojave / Edwards', subtitle: 'USA',
  pickManager: pick
});
await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 32.9899, lonDeg: -106.9740, radiusUnits: 2.0,
  imageUrl: '/public/flags/usa.png', flagSize: [0.20, 0.12],
  title: 'Spaceport America', subtitle: 'USA',
  pickManager: pick
});
await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 31.4420, lonDeg: -104.7570, radiusUnits: 2.0,
  imageUrl: '/public/flags/usa.png', flagSize: [0.20, 0.12],
  title: 'Launch Site One', subtitle: 'USA',
  pickManager: pick
});

addSurfaceMarker(earth, 45.9203, 63.3422, 2.0, 0x00ffd0);

// ---------- Orbits (ISS + Sputnik) ----------
const stations = [];

// ISS
const iss = addStationKepler(scene, {
  name: 'ISS',
  a_km: EARTH_RADIUS_KM + 420,
  e: 0.001,
  i_deg: 51.64,
  raan_deg: 0,
  argp_deg: 0,
  M0_deg: 0,
  epoch: new Date(Date.UTC(2025, 0, 1, 0, 0, 0)),
  color: 0xffffff,
  startUTC: new Date(Date.UTC(1998, 10, 20, 6, 40, 0)),
  endUTC: null
});
attachTrail(iss, scene, { length: 335, color: 0xbebebe, opacity: 0.6 });
stations.push(iss);

// Sputnik 1
const sputnik = addStationKepler(scene, {
  name: 'Sputnik 1',
  a_km: 6955.2,
  e: 0.05201,
  i_deg: 65.10,
  raan_deg: 0,
  argp_deg: 0,
  M0_deg: 0,
  epoch: new Date(Date.UTC(1957, 9, 4, 19, 28, 34)),
  color: 0xff2b2b,
  startUTC: new Date(Date.UTC(1957, 9, 4, 19, 28, 34)),
  endUTC: new Date(Date.UTC(1958, 0, 4, 0, 0, 0))
});
// Force epoch subpoint to Baikonur
alignElementsToLatLonAtEpoch(
  sputnik,
  45.9203, 63.3422,
  jdUTC(new Date(sputnik.station.epoch_s * 1000))
);
attachTrail(sputnik, scene, { length: 20, color: 0xff2b2b, opacity: 0.5 });
stations.push(sputnik);

// ---------- Animate ----------
renderer.setAnimationLoop(() => {
  const date = simDate();
  const jd = jdUTC(date);
  const T = centuriesTT(jd);

  // HUD (UTC top-center)
  hud.setUtc(
    `UTC: ${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
  );

  // Sun/Moon update (converter + scale)
  updateCelestials(T, (v) => new THREE.Vector3(v.x, v.z, -v.y), AU_TO_UNITS);

  // Orbits
  for (const e of stations) {
    const active = stationActiveAt(e, date);
    e.dot.visible = active;
    if (!active) { clearTrail(e); continue; }
    const rECI_km = propagateKepler(e.station, date);
    const pos = eciKmToThreeUnits(rECI_km);
    e.dot.position.copy(pos);
    updateTrail(e, pos);
  }

  // Earth rotation (GMST)
  earth.rotation.set(0, 0, 0);
  earth.rotateZ(THREE.MathUtils.degToRad(23.4));
  earth.rotateY(gmstRad(jd));

  controls.update();
  renderer.render(scene, camera);
});
