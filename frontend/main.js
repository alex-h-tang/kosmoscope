import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- Renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Make background white
renderer.setClearColor(0x000000, 1);
// Correct color output (r150+)
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------- Scene & Camera ----------
const scene = new THREE.Scene(); // background already white via renderer
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
camera.position.set(0, 0, 8);
scene.add(camera);

// ---------- Controls ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 30;

// ---------- Lights ----------
const ambient = new THREE.AmbientLight(0xffffff, 0.15);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 5);
sun.position.set(10, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
sun.target.position.set(0, 0, 0);
scene.add(sun.target);

// ---------- Earth (single texture) ----------
const texLoader = new THREE.TextureLoader();
const earthMap = texLoader.load(
  '/overlays/earth_day.png',
  (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  },
  undefined,
  (err) => {
    console.error('Failed to load /textures/earth_day.jpg', err);
  }
);

const earthGeo = new THREE.SphereGeometry(2, 128, 128);
const earthMat = new THREE.MeshPhongMaterial({ map: earthMap });
const earth = new THREE.Mesh(earthGeo, earthMat);
earth.castShadow = true;
earth.receiveShadow = true;
// axial tilt (visual)
earth.rotation.z = THREE.MathUtils.degToRad(23.4);
scene.add(earth);

// --- Visible Sun sphere (purely decorative) ---
const sunGeo = new THREE.SphereGeometry(0.8, 48, 48);
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
sunMesh.position.copy(sun.position);
scene.add(sunMesh);

// --- Moon (textured) ---
const moonRadius   = 0.54;  // relative to Earth radius=2
const moonDistance = 5.0;   // distance from Earth center (scene units)

const moonTex = texLoader.load(
  '/overlays/moon.jpg',
  (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  },
  undefined,
  (err) => console.error('Failed to load /overlays/moon.jpg', err)
);

const moonMat = new THREE.MeshPhongMaterial({
  map: moonTex,
  bumpMap: moonTex,
  bumpScale: 0.025,
  specular: 0x111111,
  shininess: 5
});

const moonGeo = new THREE.SphereGeometry(moonRadius, 64, 64);
const moon    = new THREE.Mesh(moonGeo, moonMat);
moon.castShadow = true;
moon.receiveShadow = true;

// Pivot so we can rotate to orbit Earth
const moonPivot = new THREE.Object3D();
scene.add(moonPivot);
moonPivot.add(moon);
moon.position.set(moonDistance, 0, 0); // start on +X

// ---------- Resize ----------
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

// ===== HELPER FUNCTIONS FOR ANIMATION =====
function jdUTC(date = new Date()) { return date.getTime() / 86400000 + 2440587.5; }

function centuriesTT(jd_utc) {
  const deltaT = 69; // seconds
  const jd_tt = jd_utc + deltaT / 86400;
  return (jd_tt - 2451545.0) / 36525;
}

function meanObliquityRad(T) {
  const eps0_arcsec =
    84381.406 - 46.836769*T - 0.0001831*T*T + 0.00200340*T*T*T
    - 5.76e-7*T*T*T*T - 4.34e-8*T*T*T*T*T;
  return (eps0_arcsec / 3600) * Math.PI / 180;
}

function gmstRad(jd) {
  const Tu = (jd - 2451545.0) / 36525.0;
  let gmst_sec =
    67310.54841 +
    (876600*3600 + 8640184.812866)*Tu +
    0.093104*Tu*Tu -
    6.2e-6*Tu*Tu*Tu;
  gmst_sec = ((gmst_sec % 86400) + 86400) % 86400;
  return (gmst_sec / 240) * Math.PI / 180;
}

// Sun position in ECI (AU)
function sunEci(T) {
  const d2r = Math.PI/180;
  const g = (357.52911 + 35999.05029*T - 0.0001537*T*T) * d2r;
  const L = (280.46646 + 36000.76983*T + 0.0003032*T*T) * d2r;
  const lambda =
    ( (L/d2r)
    + (1.914602 - 0.004817*T - 0.000014*T*T)*Math.sin(g)
    + (0.019993 - 0.000101*T)*Math.sin(2*g)
    + 0.000289*Math.sin(3*g) ) * d2r;
  const R = 1.000001018 - 0.016708617*Math.cos(g) - 0.000139589*Math.cos(2*g);
  const eps = meanObliquityRad(T);
  const x = R * Math.cos(lambda);
  const y = R * Math.sin(lambda) * Math.cos(eps);
  const z = R * Math.sin(lambda) * Math.sin(eps);
  return { x, y, z, R_AU: R };
}

// Moon (Meeus short series) in ECI (AU)
function moonEci(T) {
  const d2r = Math.PI/180;
  const Lp = 218.3164477 + 481267.88123421*T - 0.0015786*T*T + T*T*T/538841 - T*T*T*T/65194000;
  const D  = 297.8501921 + 445267.1114034*T - 0.0018819*T*T + T*T*T/545868 - T*T*T*T/113065000;
  const M  = 357.5291092 + 35999.0502909*T - 0.0001536*T*T + T*T*T/24490000;
  const Mp = 134.9633964 + 477198.8675055*T + 0.0087414*T*T + T*T*T/69699 - T*T*T*T/14712000;
  const F  = 93.2720950 + 483202.0175233*T - 0.0036539*T*T - T*T*T/3526000 + T*T*T*T/863310000;

  const Lp_r = Lp*d2r, D_r = D*d2r, Mp_r = Mp*d2r, F_r = F*d2r;

  const lon = (Lp
    + 6.289*Math.sin(Mp_r)
    + 1.274*Math.sin(2*D_r - Mp_r)
    + 0.658*Math.sin(2*D_r)
    + 0.214*Math.sin(2*Mp_r)
    + 0.110*Math.sin(D_r)
  ) * d2r;

  const lat = (5.128*Math.sin(F_r)
    + 0.280*Math.sin(Mp_r + F_r)
    + 0.277*Math.sin(Mp_r - F_r)
    + 0.173*Math.sin(2*D_r - F_r)
    + 0.055*Math.sin(2*D_r + F_r)
    + 0.046*Math.sin(2*D_r - Mp_r + F_r)
  ) * d2r;

  const delta_km =
    385000.56
    - 20905.355*Math.cos(Mp_r)
    - 3699.111*Math.cos(2*D_r - Mp_r)
    - 2955.968*Math.cos(2*D_r)
    - 569.925*Math.cos(2*Mp_r);

  const r_AU = delta_km / 149597870.7;

  const cosLat = Math.cos(lat);
  const xe = r_AU * cosLat * Math.cos(lon);
  const ye = r_AU * cosLat * Math.sin(lon);
  const ze = r_AU * Math.sin(lat);

  const eps = meanObliquityRad(T);
  const x = xe;
  const y = ye*Math.cos(eps) - ze*Math.sin(eps);
  const z = ye*Math.sin(eps) + ze*Math.cos(eps);
  return { x, y, z, r_AU: r_AU };
}

// IAU-1976 precession matrix (J2000 → mean of date)
function precessionMatrix(T) {
  const as2r = Math.PI / (180*3600);
  const zetaA  = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T) * as2r;
  const zA     = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T) * as2r;
  const thetaA = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T) * as2r;

  const cz = Math.cos(zA),    sz = Math.sin(zA);
  const ct = Math.cos(thetaA),st = Math.sin(thetaA);
  const cp = Math.cos(zetaA), sp = Math.sin(zetaA);

  const m1 = [ [ cz,  sz, 0], [ -sz,  cz, 0], [ 0, 0, 1] ];
  const m2 = [ [ 1,   0,  0], [  0,  ct, st], [ 0,-st, ct] ];
  const m3 = [ [ cp,  sp, 0], [ -sp, cp, 0], [ 0, 0, 1] ];

  function mul(A,B){
    const M = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++) M[i][j]+=A[i][k]*B[k][j];
    return M;
  }
  return mul(mul(m1,m2),m3);
}

function applyMat3(m, v) {
  return {
    x: m[0][0]*v.x + m[0][1]*v.y + m[0][2]*v.z,
    y: m[1][0]*v.x + m[1][1]*v.y + m[1][2]*v.z,
    z: m[2][0]*v.x + m[2][1]*v.y + m[2][2]*v.z,
  };
}

// Map ECI (x,y,z) → your scene axes (Y up). We'll use (x,z,y) ordering.
function eciToThree(v) { return new THREE.Vector3(v.x, v.z, v.y); }

// === Scene scale: keep your existing sizes ===
const MEAN_LUNAR_AU = 384400 / 149597870.7; // ≈ 0.002569 AU
const AU_TO_UNITS = (typeof moonDistance !== 'undefined' ? moonDistance : 5) / MEAN_LUNAR_AU;

// Time scale
let speedMultiplier = 1000;
const realStart = Date.now();
function simDate() {
  const elapsed = Date.now() - realStart;
  return new Date(realStart + elapsed * speedMultiplier);
}

/* ======= UTC HUD (top-center) ======= */
const utcHud = document.createElement('div');
utcHud.style.cssText = `
  position:fixed; top:0; left:50%; transform:translateX(-50%);
  background:#000; color:#fff; padding:6px 10px;
  font:14px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  z-index:9999; border-bottom-left-radius:6px; border-bottom-right-radius:6px;
  pointer-events:none;
`;
utcHud.textContent = 'UTC: —';
document.body.appendChild(utcHud);

function pad2(n){ return String(n).padStart(2,'0'); }
function formatUTC(d){
  return `UTC: ${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())} `
       + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/* ======= Moon rotation tweak controls ======= */
const _toEarth = new THREE.Vector3();
let MOON_ROLL_SPEED = 0.0;
const MOON_ROLL_OFFSET = 0;
let _prevSimMs = null;

/* ========= Space stations via Kepler (dot only) ========= */
const EARTH_RADIUS_KM    = 6378.137;
const MU_EARTH           = 398600.4418;
const J2                 = 1.08262668e-3;
const EARTH_RADIUS_UNITS = 2.0;
const KM_TO_UNITS_LEO    = EARTH_RADIUS_UNITS / EARTH_RADIUS_KM;
const D2R = Math.PI/180;

function solveE(M, e, tol=1e-8){
  let E = e < 0.8 ? M : Math.PI;
  for (let k=0;k<20;k++){
    const f = E - e*Math.sin(E) - M;
    const fp= 1 - e*Math.cos(E);
    const dE= -f/fp;
    E += dE;
    if (Math.abs(dE) < tol) break;
  }
  return E;
}
function perifocalToECI(Ω,i,ω){
  const cO=Math.cos(Ω), sO=Math.sin(Ω);
  const ci=Math.cos(i), si=Math.sin(i);
  const cw=Math.cos(ω), sw=Math.sin(ω);
  return [
    [ cO*cw - sO*sw*ci,  -cO*sw - sO*cw*ci,  sO*si ],
    [ sO*cw + cO*sw*ci,  -sO*sw + cO*cw*ci, -cO*si ],
    [ sw*si           ,   cw*si            ,  ci   ]
  ];
}
function mul3(M,v){
  return { x:M[0][0]*v.x + M[0][1]*v.y + M[0][2]*v.z,
           y:M[1][0]*v.x + M[1][1]*v.y + M[1][2]*v.z,
           z:M[2][0]*v.x + M[2][1]*v.y + M[2][2]*v.z };
}
function eciKmToThreeUnits(p){
  return new THREE.Vector3(p.x, p.z, p.y).multiplyScalar(KM_TO_UNITS_LEO);
}
function j2Rates(a,e,i){
  const n = Math.sqrt(MU_EARTH/(a*a*a));
  const p = a*(1-e*e);
  const fac = J2 * Math.pow(EARTH_RADIUS_KM/p,2) * n;
  const raanDot = -1.5 * fac * Math.cos(i);
  const argpDot =  0.75 * fac * (5*Math.cos(i)**2 - 1);
  return { n, raanDot, argpDot };
}
function propagateKepler(elem, date){
  const t = date.getTime()/1000;
  const dt = t - elem.epoch_s;
  const { n, raanDot, argpDot } = j2Rates(elem.a_km, elem.e, elem.i_rad);
  const Ω = elem.raan_rad + raanDot*dt;
  const ω = elem.argp_rad + argpDot*dt;
  const M = elem.M0_rad   + n*dt;
  const E = solveE(((M%(2*Math.PI))+2*Math.PI)%(2*Math.PI), elem.e);
  const r = elem.a_km * (1 - elem.e*Math.cos(E));
  const ν = Math.atan2(Math.sqrt(1-elem.e*elem.e)*Math.sin(E), Math.cos(E)-elem.e);
  const r_pqw = { x:r*Math.cos(ν), y:r*Math.sin(ν), z:0 };
  const R = perifocalToECI(Ω, elem.i_rad, ω);
  return mul3(R, r_pqw); // km
}

// Stations container and adder (dot only)
const stations = [];
function addStationKepler({
  name='Station', a_km, e=0.001, i_deg,
  raan_deg=0, argp_deg=0, M0_deg=0,
  epoch=new Date(), color=0xff5555
}){
  const station = {
    name, a_km, e,
    i_rad: i_deg*D2R,
    raan_rad: raan_deg*D2R,
    argp_rad: argp_deg*D2R,
    M0_rad: M0_deg*D2R,
    epoch_s: epoch.getTime()/1000
  };
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 16, 16),
    new THREE.MeshBasicMaterial({ color })
  );
  dot.userData.station = station;
  scene.add(dot);
  const entry = { station, dot };
  stations.push(entry);
  return entry;
}

// ---- ISS CONTRAIL HELPERS ----
function attachTrailToStation(entry, { length = 100, color = 0xffffff, opacity = 0.8 } = {}) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(length * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geom, mat);
  line.frustumCulled = false;
  scene.add(line);

  entry.trail = {
    line,
    geom,
    positions,
    max: length,
    points: [],
  };
}

function updateTrail(entry, posVec3) {
  const t = entry.trail;
  if (!t) return;

  t.points.push(posVec3.clone());
  if (t.points.length > t.max) t.points.shift();

  const n = t.points.length; // number of vertices
  for (let i = 0; i < n; i++) {
    const p = t.points[i];
    const k = i * 3;
    t.positions[k]     = p.x;
    t.positions[k + 1] = p.y;
    t.positions[k + 2] = p.z;
  }
  t.geom.setDrawRange(0, n); // draw n vertices (n-1 segments)
  t.geom.attributes.position.needsUpdate = true;
}

// Example station (ISS-like) — tune angles to taste
const issEntry = addStationKepler({
  name: 'ISS',
  a_km: EARTH_RADIUS_KM + 420, // ~420 km altitude
  e:    0.001,
  i_deg:51.64,
  raan_deg: 0,
  argp_deg: 0,
  M0_deg:   0,
  epoch: new Date(Date.UTC(2025,0,1,0,0,0)),
  color: 0xffffff
});
// >>> ATTACH THE TRAIL <<<
attachTrailToStation(issEntry, { length: 335, color: 0xbebebe, opacity: 0.6 });

/* ------------------------------ */

// ---------- Animate ----------
renderer.setAnimationLoop(() => {
  // Simulated time
  const date = simDate();
  utcHud.textContent = formatUTC(date);

  // Sim dt in seconds (based on simulated clock)
  const simMs = date.getTime();
  const dtSimSec = (_prevSimMs === null) ? 0 : (simMs - _prevSimMs) / 1000;
  _prevSimMs = simMs;

  const jd   = jdUTC(date);
  const T    = centuriesTT(jd);

  // Ephemerides (J2000 ECI)
  const sunJ  = sunEci(T);
  const moonJ = moonEci(T);

  // Precess to mean-of-date ECI
  const P = precessionMatrix(T);
  const sunMOD  = applyMat3(P, sunJ);
  const moonMOD = applyMat3(P, moonJ);

  // --- Sun: direction-only, small radius for shadows ---
  const sunDir = eciToThree(sunMOD).normalize();
  const sunR   = 12;
  const sunPos = sunDir.multiplyScalar(sunR);
  sun.position.copy(sunPos);
  sunMesh.position.copy(sunPos);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();

  // --- Moon: true position (scaled) + tidal locking w/ adjustable roll ---
  const moonPos = eciToThree(moonMOD).multiplyScalar(AU_TO_UNITS);
  moon.position.copy(moonPos);
  moon.lookAt(0, 0, 0);
  const roll = MOON_ROLL_OFFSET + MOON_ROLL_SPEED * dtSimSec;
  if (roll !== 0) {
    _toEarth.set(-moon.position.x, -moon.position.y, -moon.position.z).normalize();
    moon.rotateOnAxis(_toEarth, roll);
  }

  // --- Stations: propagate, position dot, update contrail ---
  for (const s of stations){
    const rECI_km = propagateKepler(s.station, date);
    const pos = eciKmToThreeUnits(rECI_km);
    s.dot.position.copy(pos);
    updateTrail(s, pos);
  }

  // --- Earth spin: tilt + sidereal rotation (GMST) ---
  earth.rotation.set(0, 0, 0);
  earth.rotateZ(THREE.MathUtils.degToRad(23.4));
  earth.rotateY(gmstRad(jd));

  controls.update();
  renderer.render(scene, camera);
});
