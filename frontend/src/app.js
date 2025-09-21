// app.js — CSV-driven launches + Next Launch + flags + AUTO INFO (no rocket clicking)
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
const { scene, camera, earth, moon, texLoader, updateCelestials } = createScene(renderer);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 30;

const MEAN_LUNAR_AU = 384400 / 149597870.7;
const AU_TO_UNITS = 5.0 / MEAN_LUNAR_AU;

/* ==================== UTC timeline UI ==================== */
const SIM_START_MS = Date.UTC(1957, 9, 1, 0, 0, 0);
const SIM_END_MS   = Date.now();

const bar = document.createElement('div');
bar.style.cssText = `
  position:fixed; left:50%; transform:translateX(-50%);
  top:0; z-index:9999; display:flex; gap:10px; align-items:center;
  background:rgba(0,0,0,.72); color:#fff; padding:8px 12px; border-radius:0 0 12px 12px;
  font:12px/1.3 ui-monospace, Menlo, Consolas, monospace; backdrop-filter: blur(4px);
`;
bar.innerHTML = `
  <span id="utcLabel">UTC —</span>
  <input id="timeSlider" type="range" min="0" max="10000" step="1" value="0" style="width:42vw">
  <button id="playPauseBtn" style="padding:4px 8px;border-radius:8px;border:1px solid #444; background:#222; color:#fff; cursor:pointer">▶︎</button>
  <button id="nextLaunchBtn" title="Jump to next scheduled launch (N)" style="padding:4px 10px;border-radius:8px;border:1px solid #3b82f6; background:#1f2937; color:#bfdbfe; cursor:pointer">Next Launch ➜</button>
`;
document.body.appendChild(bar);
const utcLabel   = bar.querySelector('#utcLabel');
const sliderEl   = bar.querySelector('#timeSlider');
const playBtn    = bar.querySelector('#playPauseBtn');
const nextBtn    = bar.querySelector('#nextLaunchBtn');

const pad2 = (n) => String(n).padStart(2,'0');
const msToUTCString = (ms) => {
  const d = new Date(ms);
  return `UTC ${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
};
const sliderToMs = (val) => Math.round(SIM_START_MS + (Number(val) / 10000) * (SIM_END_MS - SIM_START_MS));
const msToSlider = (ms) => Math.round(Math.min(1, Math.max(0, (ms - SIM_START_MS) / (SIM_END_MS - SIM_START_MS))) * 10000);

/* ===== Time controller ===== */
let isPlaying = true;
let simMs     = SIM_START_MS;
let lastRealMs = performance.now();
let simRate   = 24 * 3600; // 1 sim-day / sec

let rateFrom = simRate, rateTo = simRate, rateLerpStartReal = 0, rateLerpEndReal = 0;
function smoothSetSimRate(targetRate, rampSec = 0.4) {
  const now = performance.now();
  rateFrom = simRate; rateTo = Math.max(0.001, targetRate || 1);
  rateLerpStartReal = now; rateLerpEndReal = now + Math.max(0, rampSec) * 1000;
}
function tickRateLerp(nowRealMs) {
  if (rateLerpEndReal <= rateLerpStartReal) return;
  const t = Math.min(1, (nowRealMs - rateLerpStartReal) / (rateLerpEndReal - rateLerpStartReal));
  const e = t * t * (3 - 2 * t);
  simRate = rateFrom + (rateTo - rateFrom) * e;
  if (t >= 1) { rateFrom = rateTo = simRate; rateLerpStartReal = rateLerpEndReal = 0; }
}
let slowmoPrevRate = null, slowmoEndSimMs = null;
function startSlowmo(simSeconds = 260, slowRate = 120, rampSec = 0.4) {
  slowmoPrevRate = simRate;
  slowmoEndSimMs = simMs + simSeconds * 1000;
  smoothSetSimRate(slowRate, rampSec);
}
function maybeEndSlowmo() {
  if (slowmoEndSimMs != null && simMs >= slowmoEndSimMs) {
    smoothSetSimRate(slowmoPrevRate ?? 24*3600, 0.4);
    slowmoPrevRate = null; slowmoEndSimMs = null;
  }
}
function updateTimeUI() { utcLabel.textContent = msToUTCString(simMs); sliderEl.value = String(msToSlider(simMs)); }
sliderEl.addEventListener('input', () => { simMs = sliderToMs(sliderEl.value); isPlaying = false; playBtn.textContent = '▶︎'; });
playBtn.addEventListener('click', () => { isPlaying = !isPlaying; lastRealMs = performance.now(); playBtn.textContent = isPlaying ? '⏸' : '▶︎'; });
updateTimeUI();

/* ---------- HUD + (flags-only) Picking ---------- */
const hud = createHud?.();

// move HUD to bottom-center
const hudEl = document.getElementById('hud') || hud?.el; // whichever your HUD uses
if (hudEl) {
  hudEl.style.position = 'fixed';
  hudEl.style.left = '50%';
  hudEl.style.bottom = '16px';
  hudEl.style.top = 'auto';                 // unset any top pinning
  hudEl.style.transform = 'translateX(-50%)';
  hudEl.style.pointerEvents = 'none';       // optional: clicks pass through
}
// Keep PickManager only for FLAGS. We won't register rockets anymore.
const pick = new PickManager(renderer, camera, hud?.showInfo ?? (()=>{}), hud?.hideInfo ?? (()=>{}));

/* ---------- Audio (optional) ---------- */
try { createAudioButton?.({ src: '/audio/interstellar.mp3', volume: 0.25, loop: true }); } catch {}

/* ---------- Rockets (no click; emit events instead) ---------- */
function moonPositionFn() { return moon ? moon.getWorldPosition(new THREE.Vector3()) : null; }

let lastShownRocketId = null;
let eduPanelForId   = null;     // panel “owner”
let lastEduEventAt  = 0;        // last time we updated the panel
const EDU_DEBOUNCE_MS = 180;
let hudOrbitOwnerId   = null; 
const rockets = installRocketModule({
  THREE, scene, earth,
  orbitSlowdown: 4.0,
  ascentSlowdown: 2.0,
  pickManager: null,              // ← stop registering rockets for picking
  moonPositionFn,
  onEvent: (ev) => {
  if (ev.type === 'launch-start') {
    // (unchanged) sticky launch HUD you already have
    const who = (ev.astronauts || []).join(', ');
    const lat = ev.lat != null ? `${ev.lat.toFixed(4)}°` : '';
    const lon = ev.lon != null ? `${ev.lon.toFixed(4)}°` : '';
    const where = (lat && lon) ? ` • ${lat}, ${lon}` : '';
    const subtitle = [who, ev.description].filter(Boolean).join(' — ');
    const msg = `${ev.label || 'Launch'}${subtitle ? ` — ${subtitle}` : ''}${where}`;
    hud?.showInfo?.(msg, { sticky: true });
    lastShownRocketId = ev.id;
  }

  else if (ev.type === 'orbit-start') {
    // Right panel only — do NOT touch bottom HUD
    const summary = getYouthSummaryForLabel(ev.label);
    eduPanelForId = ev.id;
    lastEduEventAt = performance.now();
    eduPanel.show(ev.label, summary || 'This mission is now in orbit. Explore its path around Earth!');
  }

  else if (ev.type === 'follow-start') {
  // If this rocket already owns the panel OR no one owns it yet, show/update
  if (eduPanelForId === ev.id || eduPanelForId == null) {
    eduPanelForId = ev.id;
    lastEduEventAt = performance.now();
    const summary = getYouthSummaryForLabel(ev.label);
    const extra = ' The vehicle is now orbiting near the Moon—watch how its path changes!';
    eduPanel.show(ev.label, summary ? (summary + extra) : ('Now following the Moon.' + extra));
  }
  // (if a different rocket owns the panel, we ignore to avoid flicker/stealing)
}

  else if (ev.type === 'rocket-deleted') {
    // Hide sticky launch HUD only if this rocket owned it
    if (lastShownRocketId === ev.id) { hud?.hideInfo?.(); lastShownRocketId = null; }
    // Hide the right panel only if this rocket owns it, with debounce
    if (eduPanelForId === ev.id) {
      const since = performance.now() - lastEduEventAt;
      eduPanel.hide({ debounceMs: Math.max(EDU_DEBOUNCE_MS, 180 - since) });
      eduPanelForId = null;
    }
  }
}

});

/* ===================== CSV ingestion (unchanged parsing) ===================== */
async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
async function loadCSVWithFallback() {
  const paths = ['/data/influential_launches.csv', '/influential_launches.csv', './influential_launches.csv'];
  let lastErr;
  for (const p of paths) {
    try { return await loadText(p); } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error('CSV not found in fallback paths');
}
async function loadYouthSummariesCSV() {
  // Look in common public paths (adjust if you serve it elsewhere)
  const candidates = [
    '/data/mission_summaries_youth.csv',
    '/mission_summaries_youth.csv',
    './mission_summaries_youth.csv'
  ];
  let lastErr;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return text;
    } catch (e) { lastErr = e; }
  }
  console.warn('[edu] youth summaries CSV not found in default paths.');
  if (lastErr) console.warn(lastErr);
  return null;
}

function parseCSVToRows(text) {
  if (!text) return [];
  const rows = [];
  let i = 0, field = '', row = [], inQ = false;
  while (i < text.length) {
    const c = text[i++];
    if (inQ) {
      if (c === '"') { if (text[i] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field.trim()); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field.length || row.length) { row.push(field.trim()); rows.push(row); row = []; field = ''; }
        if (c === '\r' && text[i] === '\n') i++;
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

function buildYouthSummaryMap(rows) {
  if (!rows.length) return new Map();
  const header = rows[0].map(h => h.toLowerCase().replace(/\W+/g,''));
  const data = header.includes('label') || header.includes('mission') ? rows.slice(1) : rows;

  const iLabel = header.indexOf('label') >= 0 ? header.indexOf('label') : 0;
  const iSum   = header.indexOf('summaryeducation') >= 0 ? header.indexOf('summaryeducation')
                 : header.indexOf('summary') >= 0 ? header.indexOf('summary') : 1;

  const m = new Map();
  for (const r of data) {
    const label = (r[iLabel] || '').trim();
    const summary = (r[iSum] || '').trim();
    if (label && summary) m.set(label.toLowerCase(), summary);
  }
  return m;
}

/* ===================== Education Panel (right side) ===================== */
// Add this near your HUD creation in app.js
const eduPanel = (() => {
  const wrap = document.createElement('aside');
  wrap.id = 'edu-panel';
  wrap.style.cssText = `
    position: fixed;
    right: 16px; top: 50%; transform: translateY(-50%);
    width: min(420px, 28vw);
    max-height: 70vh; overflow:auto;
    padding: 12px 14px;
    background: rgba(10,10,15,0.55);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 12px;
    color: #f0f6ff; z-index: 9999;
    box-shadow: 0 6px 22px rgba(0,0,0,0.35);
    backdrop-filter: blur(6px) saturate(120%);
    opacity: 0; visibility: hidden; transition: opacity .18s ease, visibility 0s linear .18s;
  `;
  const title = document.createElement('div');
  title.id = 'edu-title';
  title.style.cssText = `font:700 15px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin-bottom:6px; color:#cde3ff;`;
  const body = document.createElement('div');
  body.id = 'edu-body';
  body.style.cssText = `font:400 14px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; white-space:normal;`;
  wrap.appendChild(title); wrap.appendChild(body);
  document.body.appendChild(wrap);

  let hideTimer = null;

  function show(label, summary) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    title.textContent = label || 'Mission';
    body.textContent  = summary || 'No summary available.';
    wrap.style.visibility = 'visible';
    wrap.style.transition = 'opacity .18s ease, visibility 0s';
    wrap.style.opacity = '1';
  }
  function hide({ debounceMs = EDU_DEBOUNCE_MS } = {}) {
    if (hideTimer) { clearTimeout(hideTimer); }
    hideTimer = setTimeout(() => {
      wrap.style.transition = 'opacity .18s ease, visibility 0s linear .18s';
      wrap.style.opacity = '0';
      wrap.style.visibility = 'hidden';
      hideTimer = null;
    }, debounceMs);
  }
  return { show, hide, el: wrap };
})();

/* ===================== Wire everything together ===================== */
let youthSummaryMap = new Map();
(async () => {
  const t = await loadYouthSummariesCSV();      // loads mission_summaries_youth.csv
  youthSummaryMap = buildYouthSummaryMap(parseCSVToRows(t)); // Map<labelLower -> summary>
})();

// Helper to fetch a summary by mission label with a soft fallback
function getYouthSummaryForLabel(label) {
  if (!label) return '';
  const key = String(label).toLowerCase();
  if (youthSummaryMap.has(key)) return youthSummaryMap.get(key);

  // very soft fuzzy: try without common punctuation/spaces
  const norm = key.replace(/[^\w]/g,'');
  for (const [k, v] of youthSummaryMap.entries()) {
    if (k.replace(/[^\w]/g,'') === norm) return v;
  }
  return '';
}
// tiny CSV + record builder
function parseCSV(text) {
  const rows = []; let i=0,f='',row=[],q=false;
  while (i < text.length) {
    const c = text[i++];
    if (q) { if (c === '"') { if (text[i] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f.trim()); f=''; }
    else if (c === '\n' || c === '\r') { if (f.length || row.length) { row.push(f.trim()); rows.push(row); row=[]; f=''; } if (c === '\r' && text[i] === '\n') i++; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f.trim()); rows.push(row); }
  return rows;
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'g' && firstLaunchMs) {
    simMs = firstLaunchMs;
    updateTimeUI();
  }
  if (k === ' ') { isPlaying = !isPlaying; playBtn.textContent = isPlaying ? '⏸' : '▶︎'; }
  if (k === '1') simRate = 3600;
  if (k === '2') simRate = 24*3600;
  if (k === '3') simRate = 7*24*3600;
});
function recordsFromRows(rows) {
  if (!rows?.length) return [];
  const h = rows[0] || [];
  const data = (h.length >= 7 && /label/i.test(h[0]) && /lat/i.test(h[1]) && /lon/i.test(h[2]) && /date/i.test(h[3])) ? rows.slice(1) : rows;
  const recs = [];
  for (let idx = 0; idx < data.length; idx++) {
    const [label, lat, lon, dateStr, astronautsStr, description, durationStr] = data[idx];
    const whenMs = Date.parse(dateStr);
    const latNum = Number(lat), lonNum = Number(lon);
    if (!isFinite(whenMs) || !isFinite(latNum) || !isFinite(lonNum)) continue;
    const durHours = Number(durationStr);
    const astronauts = (astronautsStr || '').split(/[;,\uFF0C]/).map(s => s.trim()).filter(Boolean);
    const durationMs = isFinite(durHours) && durHours > 0 ? durHours * 3600 * 1000 : 0;
    recs.push({ whenMs, lat: latNum, lon: lonNum, label: label || 'Launch', astronauts, description: description || '',
                durationMs, orbitAlt: 0.8, azimuthDeg: 90, durationAscent: 220, color: 0xff9955, ascentSpeedScale: 1.0,
                isMoon: /apollo\s*8|apollo\s*11|luna\s|trans-?lunar|moon/i.test(`${label} ${description}`), });
  }
  recs.sort((a,b)=>a.whenMs-b.whenMs);
  return recs.slice(0,25);
}

/* ---------- Flags by country (unchanged) ---------- */
const FLAG_PATHS = {
  china:  ['/flags/china.png',  '/china.png'],
  usa:    [  '/flags/usa.png',    '/usa.png'],
  guiana: ['/flags/guiana.png', '/guiana.png'],
  kazakhstan: ['/flags/kazakhstan.png', '/kazakhstan.png'],
  generic:[ '/public/icons/launchpad.png', '/public/flags/flag.png'],
};
const isInBox = (lat,lon,{latMin,latMax,lonMin,lonMax}) => lat>=latMin && lat<=latMax && lon>=lonMin && lon<=lonMax;
function siteCountry(lat, lon) {
  if (isInBox(lat, lon, { latMin: 2.0,  latMax: 7.0,  lonMin: -55.5, lonMax: -50.0 })) return 'guiana';
  if (isInBox(lat, lon, { latMin: 24.0, latMax: 31.5, lonMin: -90.0, lonMax: -70.0 })) return 'usa'; // Canaveral
  if (isInBox(lat, lon, { latMin: 32.0, latMax: 38.5, lonMin: -124.0, lonMax: -114.0 })) return 'usa'; // Vandenberg
  if (isInBox(lat, lon, { latMin: 18.0, latMax: 46.5, lonMin: 73.0,  lonMax: 135.0 })) return 'china';
  if (isInBox(lat, lon, { latMin: 40.0, latMax: 50.5, lonMin: 60.0,  lonMax: 65.0 })) return 'kazakhstan';
  return 'generic';
}
const pickFirstExisting = (paths) => (paths && paths.length) ? paths[0] : '';
function round(n,p=3){const f=Math.pow(10,p);return Math.round(n*f)/f;}
async function addLaunchFlagsUnique(recs) {
  if (!recs?.length) return;
  const siteMap = new Map();
  for (const r of recs) {
    const key = `${round(r.lat,3)}|${round(r.lon,3)}`;
    if (!siteMap.has(key)) siteMap.set(key, { lat:r.lat, lon:r.lon, labels:[] });
    siteMap.get(key).labels.push(r.label);
  }
  for (const [,site] of siteMap) {
    const imageUrl = pickFirstExisting(FLAG_PATHS[siteCountry(site.lat, site.lon)] || FLAG_PATHS.generic);
    const samples = site.labels.slice(0,2);
    const more = site.labels.length - samples.length;
    await addFlagMarker({
      earth, texLoader, renderer,
      latDeg: site.lat, lonDeg: site.lon, radiusUnits: 2.0,
      imageUrl, flagSize: [0.22, 0.14],
      title: `Launch Site (${site.labels.length})`,
      subtitle: samples.join(' • ') + (more>0 ? ` • +${more} more` : ''),
      pickManager: pick
    });
  }
}

/* ---------- Build launchQueue & flags ---------- */
const launchQueue = [];
let firstLaunchMs = null;

(async () => {
  try {
    const csvText = await loadCSVWithFallback();
    const recs = recordsFromRows(parseCSV(csvText));
    launchQueue.push(...recs);
    firstLaunchMs = recs.length ? recs[0].whenMs : null;
    await addLaunchFlagsUnique(recs);
    updateDebug();
  } catch (e) {
    console.warn('[CSV] CSV missing; seeding Sputnik-1 demo.', e);
    const demo = { whenMs: Date.UTC(1957,9,4,19,28,34), lat:45.9203, lon:63.3422, label:'Sputnik 1 (demo)',
      astronauts:[], description:'First artificial satellite; seed row', durationMs:1000*3600*1000,
      orbitAlt:0.8, azimuthDeg:90, durationAscent:220, color:0xff9955, ascentSpeedScale:1.0, isMoon:false };
    launchQueue.push(demo);
    firstLaunchMs = demo.whenMs;
    await addLaunchFlagsUnique([demo]);
    updateDebug();
  }
})();

/* ---------- Next Launch control ---------- */
function goToNextLaunch({ preRollMs = 5000 } = {}) {
  const next = launchQueue.length ? launchQueue[0] : null;
  if (!next) { const t=document.createElement('div'); t.textContent='No upcoming launches.'; t.style.cssText='position:fixed;left:50%;top:44px;transform:translateX(-50%);background:#111;color:#fff;padding:6px 10px;border:1px solid #333;border-radius:8px;z-index:9999'; document.body.appendChild(t); setTimeout(()=>t.remove(),1600); return; }
  simMs = Math.max(SIM_START_MS, Math.min(next.whenMs - Math.max(0, preRollMs), SIM_END_MS));
  updateTimeUI(); isPlaying = true; playBtn.textContent = '⏸'; smoothSetSimRate(120, 0.35);
}
nextBtn?.addEventListener('click', () => goToNextLaunch());
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'n') goToNextLaunch(); });

/* ---------- Debug overlay ---------- */
const dbg = document.createElement('div');
dbg.style.cssText = 'position:fixed;right:8px;bottom:8px;padding:6px 8px;background:rgba(0,0,0,.5);color:#9fe;border-radius:6px;font:11px ui-monospace;z-index:9999';
document.body.appendChild(dbg);
function updateDebug() {
  const next = launchQueue.length ? new Date(launchQueue[0].whenMs).toISOString() : '—';
  dbg.textContent = `Queue: ${launchQueue.length} | Next: ${next}`;
}

/* ---------- Animate ---------- */
renderer.setAnimationLoop(() => {
  const nowReal = performance.now();
  tickRateLerp(nowReal);

  if (isPlaying) {
    const realDt = Math.max(0, (nowReal - lastRealMs) / 1000);
    simMs = Math.min(SIM_END_MS, simMs + realDt * simRate * 1000);
  }
  lastRealMs = nowReal;

  maybeEndSlowmo();
  updateTimeUI();

  const date = new Date(simMs);
  const jd = jdUTC(date), T = centuriesTT(jd);
  updateCelestials(T, (v) => new THREE.Vector3(v.x, v.z, -v.y), AU_TO_UNITS);
  earth.rotation.set(0, 0, 0);
  earth.rotateZ(THREE.MathUtils.degToRad(23.4));
  earth.rotateY(gmstRad(jd));

  // Fire scheduled launches
  while (launchQueue.length && launchQueue[0].whenMs <= simMs) {
    const job = launchQueue.shift();
    const id = job.isMoon
      ? rockets.launchToMoonFromLatLon(job.lat, job.lon, {
          label: job.label, azimuthDeg: job.azimuthDeg, durationAscent: job.durationAscent,
          ascentSpeedScale: job.ascentSpeedScale, transferSeconds: 3*24*180, followSeconds: 10,
          color: 0x66c2ff, astronauts: job.astronauts, description: job.description,
        })
      : rockets.launchFromLatLon(job.lat, job.lon, {
          label: job.label, orbitAlt: job.orbitAlt, azimuthDeg: job.azimuthDeg,
          durationAscent: job.durationAscent, color: job.color, ascentSpeedScale: job.ascentSpeedScale,
          astronauts: job.astronauts, description: job.description,
        });

    const ascentSecs = job.durationAscent ?? 200;
    startSlowmo(ascentSecs + 60, 120, 0.4);

    if (job.durationMs && isFinite(job.durationMs) && job.durationMs > 0) {
      rockets.scheduleDelete(date.getTime() + job.durationMs + 60*60*10000, id);
    }
    updateDebug();
  }

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
