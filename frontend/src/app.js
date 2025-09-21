// app.js — UTC timeline + auto-scheduled Sputnik launch + stations + rockets + time slow-mo
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { createRenderer, createScene } from './scene.js';
import { jdUTC, centuriesTT, gmstRad } from './astro.js';

import { addFlagMarker } from './markers.js';
import { PickManager, createHud, createAudioButton } from './interactivity.js';
import { installRocketModule } from './rockets.js';


/* ---------- Boot ---------- */
const canvas = document.getElementById('scene');
const renderer = createRenderer(canvas);
const { scene, camera, earth, texLoader, updateCelestials } = createScene(renderer);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 30;

/* ---------- Constants for sky scale ---------- */
const MEAN_LUNAR_AU = 384400 / 149597870.7;
const AU_TO_UNITS = 5.0 / MEAN_LUNAR_AU;

/* ==================== UTC timeline UI (no schedule button) ==================== */

// Range: Oct 1957 to now (UTC)
const SIM_START_MS = Date.UTC(1957, 9, 1, 0, 0, 0);
const SIM_END_MS   = Date.now();

// Top bar
const bar = document.createElement('div');
bar.style.cssText = `
  position:fixed; left:50%; transform:translateX(-50%);
  top:0; z-index:9999; display:flex; gap:10px; align-items:center;
  background:rgba(0,0,0,.72); color:#fff; padding:8px 12px; border-radius:0 0 12px 12px;
  font:12px/1.3 ui-monospace, Menlo, Consolas, monospace; backdrop-filter: blur(4px);
`;
bar.innerHTML = `
  <span id="utcLabel">UTC —</span>
  <input id="timeSlider" type="range" min="0" max="10000" step="1" value="0" style="width:48vw">
  <button id="playPauseBtn" style="padding:4px 8px;border-radius:8px;border:1px solid #444; background:#222; color:#fff; cursor:pointer">▶︎</button>
`;
document.body.appendChild(bar);

const utcLabel  = bar.querySelector('#utcLabel');
const sliderEl  = bar.querySelector('#timeSlider');
const playBtn   = bar.querySelector('#playPauseBtn');

// Helpers
const pad2 = (n) => String(n).padStart(2,'0');
function msToUTCString(ms) {
  const d = new Date(ms);
  return `UTC ${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())} `
       + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}
function sliderToMs(val) {
  const t = Number(val) / 10000;               // 0..1
  return Math.round(SIM_START_MS + t * (SIM_END_MS - SIM_START_MS));
}
function msToSlider(ms) {
  const t = (ms - SIM_START_MS) / (SIM_END_MS - SIM_START_MS);
  return Math.round(Math.min(1, Math.max(0, t)) * 10000);
}

/* ===== TimeController: slow-motion around launches ===== */
let isPlaying = true;
let simMs     = SIM_START_MS;
let lastRealMs = performance.now();

let simRate = 24 * 3600; // default: 1 sim-day per real second

// smooth ramp state
let rateFrom = simRate;
let rateTo = simRate;
let rateLerpStartReal = 0;
let rateLerpEndReal = 0;

function smoothSetSimRate(targetRate, rampSec = 0.4) {
  const now = performance.now();
  rateFrom = simRate;
  rateTo = Math.max(0.001, targetRate || 1);
  rateLerpStartReal = now;
  rateLerpEndReal = now + Math.max(0, rampSec) * 1000;
}
function tickRateLerp(nowRealMs) {
  if (rateLerpEndReal <= rateLerpStartReal) return;
  const t = Math.min(1, (nowRealMs - rateLerpStartReal) / (rateLerpEndReal - rateLerpStartReal));
  const e = t * t * (3 - 2 * t); // smoothstep
  simRate = rateFrom + (rateTo - rateFrom) * e;
  if (t >= 1) {
    rateFrom = rateTo = simRate;
    rateLerpStartReal = rateLerpEndReal = 0;
  }
}

// slowmo window state
let slowmoPrevRate = null;
let slowmoEndSimMs = null;
function startSlowmo(simSeconds = 260, slowRate = 120, rampSec = 0.4) {
  slowmoPrevRate = simRate;
  slowmoEndSimMs = simMs + simSeconds * 1000;
  smoothSetSimRate(slowRate, rampSec);
}
function maybeEndSlowmo() {
  if (slowmoEndSimMs != null && simMs >= slowmoEndSimMs) {
    smoothSetSimRate(slowmoPrevRate ?? 24*3600, 0.4);
    slowmoPrevRate = null;
    slowmoEndSimMs = null;
  }
}

function simDate() { return new Date(simMs); }
function updateTimeUI() {
  utcLabel.textContent = msToUTCString(simMs);
  sliderEl.value = String(msToSlider(simMs));
}

// UI events
sliderEl.addEventListener('input', () => {
  simMs = sliderToMs(sliderEl.value);
  isPlaying = false;
  playBtn.textContent = '▶︎';
});
playBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  lastRealMs = performance.now();
  playBtn.textContent = isPlaying ? '⏸' : '▶︎';
});
updateTimeUI();

/* ---------- HUD + Picking ---------- */
const hud = createHud?.();
const pick = new PickManager(renderer, camera, hud?.showInfo ?? (()=>{}), hud?.hideInfo ?? (()=>{}));

/* ---------- Audio ---------- */
try { createAudioButton?.({ src: '/audio/interstellar.mp3', volume: 0.25, loop: true }); } catch {}

/* ---------- Flag markers (converted) ---------- */
await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 28.4360, lonDeg: -80.5680, radiusUnits: 2.0,
  imageUrl: '/public/flags/usa.png',
  flagSize: [0.20, 0.12],
  title: 'Cape Canaveral — LC-5 (Mercury-Redstone MR-3/MR-4)',
  subtitle: 'USA',
  pickManager: pick
});

await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 40.9606, lonDeg: 100.2983, radiusUnits: 2.0,
  imageUrl: '/public/flags/china.png',
  flagSize: [0.20, 0.12],
  title: 'Jiuquan — LA-4 / Pad 921',
  subtitle: 'China',
  pickManager: pick
});

await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 35.0590, lonDeg: -118.1530, radiusUnits: 2.0,
  imageUrl: '/public/flags/usa.png',
  flagSize: [0.20, 0.12],
  title: 'Mojave Air & Space Port / Edwards AFB',
  subtitle: 'USA — suborbital (SpaceShipOne, 2004)',
  pickManager: pick
});

await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 32.9899, lonDeg: -106.9740, radiusUnits: 2.0,
  imageUrl: '/public/flags/usa.png',
  flagSize: [0.20, 0.12],
  title: 'Spaceport America',
  subtitle: 'USA — suborbital (Virgin Galactic)',
  pickManager: pick
});

await addFlagMarker({
  earth, texLoader, renderer,
  latDeg: 31.4420, lonDeg: -104.7570, radiusUnits: 2.0,
  imageUrl: '/public/flags/usa.png',
  flagSize: [0.20, 0.12],
  title: 'Launch Site One (Blue Origin)',
  subtitle: 'USA — suborbital (Van Horn, TX)',
  pickManager: pick
});

/* ---------- Stations ---------- */
const stations = [];


// make station dots interactive
for (const s of stations) {
  if (!s.dot) continue;
  const meta = { kind: 'station', title: s.station.name };
  if (typeof pick?.register === 'function') pick.register(s.dot, meta);
}

/* ---------- Rockets ---------- */
const rockets = installRocketModule({
  THREE, scene, earth,
  orbitSlowdown: 4.0,   // slower orbit → easy to click
  ascentSlowdown: 2.0,  // globally slower ascent phase
});

// Auto-scheduled: Sputnik 1 (Baikonur), 1957-10-04 19:28:34Z
const launchQueue = [{
  whenMs: Date.UTC(1957, 9, 4, 19, 28, 34),
  lat: 45.9203, lon: 63.3422,
  params: { label: 'Vostok 1', orbitAlt: 0.8, azimuthDeg: 90, durationAscent: 220, color: 0xff2b2b, ascentSpeedScale: 4 }
  },
  {
    whenMs: Date.UTC(1962,1,20,14,47,39),
    lat: 28.4360, lon : -80.5680,
    params: { label: 'MA6', orbitAlt: 0.8, azimuthDeg: 90, durationAscent: 220, color: 0xff2b2b, ascentSpeedScale: 4 }
  }

];

// Manual launch (L)
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'l') {
    rockets.launchFromLatLon(45.9203, 63.3422, {
      label: 'Manual Launch',
      orbitAlt: 0.8, azimuthDeg: 90, durationAscent: 200, color: 0xffaa33,
      ascentSpeedScale: 1.5, // this launch’s ascent ~1.5× slower than base
    });
    // global time slow-mo for ~ascent+coast
    startSlowmo(260, 120, 0.4);
  }
  if (k === ' ') { isPlaying = !isPlaying; playBtn.textContent = isPlaying ? '⏸' : '▶︎'; }
  if (k === '1') simRate = 3600;
  if (k === '2') simRate = 24*3600;
  if (k === '3') simRate = 7*24*3600;
});

/* ---------- Animate ---------- */
renderer.setAnimationLoop(() => {
  const nowReal = performance.now();

  // Smooth rate ramp
  tickRateLerp(nowReal);

  // Advance sim time
  if (isPlaying) {
    const realDt = Math.max(0, (nowReal - lastRealMs) / 1000);
    simMs = Math.min(SIM_END_MS, simMs + realDt * simRate * 1000);
  }
  lastRealMs = nowReal;

  // End slow-mo window if due
  maybeEndSlowmo();
  const length = [simDate().getTime() + 10*60*60*1000,simDate().getTime() + 10*60*60*1000,simDate().getTime() + 10*60*60*1000]
  let order = 0;

  // Fire scheduled launches
  while (launchQueue.length && launchQueue[0].whenMs <= simMs) {
    const job = launchQueue.shift();
    let id = rockets.launchFromLatLon(job.lat, job.lon, job.params);
    const ascent = job.params?.durationAscent ?? 200;
    const deleteAt = length[order]

    rockets.scheduleDelete(deleteAt, id);   // <— time first, then id
    order +=1;
    
  }
  

  // Update top bar
  updateTimeUI();

  // Build Date for sim
  const date = simDate();

  // Sun (via scene util)
  const jd = jdUTC(date), T = centuriesTT(jd);
  updateCelestials(T, (v) => new THREE.Vector3(v.x, v.z, -v.y), AU_TO_UNITS);

  // Earth rotation (GMST)
  earth.rotation.set(0, 0, 0);
  earth.rotateZ(THREE.MathUtils.degToRad(23.4));
  earth.rotateY(gmstRad(jd));



  // Rockets (sim-clock driven)
  rockets.update(date);

  controls.update();
  renderer.render(scene, camera);
});

/* ---------- Resize ---------- */
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});
