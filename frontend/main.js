import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- Renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------- Scene & Camera ----------
const scene = new THREE.Scene();
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

// === CONSISTENT AXIS MAPPING ===
function eciToThree(v) { return new THREE.Vector3(v.x, v.z, -v.y); }

// For surface items (lat/lon in degrees, lon East+)
function addFlagMarker(latDeg, lonDeg, radiusUnits = 2.0, { imageUrl=null, flagSize=[0.20,0.12] } = {}) {
  const r   = radiusUnits * 1.003;
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const cosφ = Math.cos(lat), sinφ = Math.sin(lat);
  const cosλ = Math.cos(lon), sinλ = Math.sin(lon);
  const x = r * cosφ * cosλ;
  const y = r * sinφ;
  const z = -r * cosφ * sinλ;

  const grp = new THREE.Group();
  const n = new THREE.Vector3(x, y, z).normalize();
  grp.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), n);
  grp.position.set(x, y, z);

  const [fw, fh] = flagSize;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(fw, fh),
    new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide })
  );
  plane.position.set(fw*0.5+0.015, 0.12, 0);
  grp.add(plane);

  earth.add(grp);
  return grp;
}

// === Scene scale ===
const MEAN_LUNAR_AU = 384400 / 149597870.7;
const AU_TO_UNITS = (typeof moonDistance !== 'undefined' ? moonDistance : 5) / MEAN_LUNAR_AU;

// Time scale (start around Sputnik era so we can see scheduled events)
let speedMultiplier = 1000;
const realStart = Date.now();
const EPOCH_START_MS = Date.UTC(1957, 9, 4, 18, 0, 0, 0);
function simDate() {
  const elapsed = Date.now() - realStart;
  return new Date(EPOCH_START_MS + elapsed * speedMultiplier);
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
  return new THREE.Vector3(p.x, p.z, -p.y).multiplyScalar(KM_TO_UNITS_LEO);
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
  epoch=new Date(), color=0xff5555,
  startUTC=null, endUTC=null
}){
  const station = {
    name, a_km, e,
    i_rad: i_deg*D2R,
    raan_rad: raan_deg*D2R,
    argp_rad: argp_deg*D2R,
    M0_rad: M0_deg*D2R,
    epoch_s: epoch.getTime()/1000,
    start_s: startUTC ? startUTC.getTime()/1000 : -Infinity,
    end_s:   endUTC   ? endUTC.getTime()/1000   :  Infinity
  };
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 16, 16),
    new THREE.MeshBasicMaterial({ color })
  );
  dot.userData.station = station;
  scene.add(dot);
  const entry = { station, dot, trail: null };
  stations.push(entry);
  return entry;
}

// ---- contrail helpers ----
function attachTrailToStation(entry, { length = 100, color = 0xffffff, opacity = 0.8 } = {}) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(length * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geom, mat);
  line.frustumCulled = false;
  scene.add(line);

  entry.trail = { line, geom, positions, max: length, points: [] };
}
function updateTrail(entry, posVec3) {
  const t = entry.trail;
  if (!t) return;
  t.points.push(posVec3.clone());
  if (t.points.length > t.max) t.points.shift();
  const n = t.points.length;
  for (let i = 0; i < n; i++) {
    const p = t.points[i]; const k = i * 3;
    t.positions[k] = p.x; t.positions[k + 1] = p.y; t.positions[k + 2] = p.z;
  }
  t.geom.setDrawRange(0, n);
  t.geom.attributes.position.needsUpdate = true;
}
function stationActiveAt(entry, date) {
  const t = date.getTime() / 1000;
  return (t >= entry.station.start_s) && (t <= entry.station.end_s);
}
function clearTrail(entry) {
  if (!entry.trail) return;
  entry.trail.points.length = 0;
  entry.trail.geom.setDrawRange(0, 0);
  entry.trail.geom.attributes.position.needsUpdate = true;
}

// Example station (ISS-like)
const issEntry = addStationKepler({
  name: 'ISS',
  a_km: EARTH_RADIUS_KM + 420,
  e:    0.001,
  i_deg:51.64,
  raan_deg: 0,
  argp_deg: 0,
  M0_deg:   0,
  epoch: new Date(Date.UTC(2025,0,1,0,0,0)),
  color: 0xffffff,
  startUTC: new Date(Date.UTC(1998,10,20,6,40,0)),
  endUTC:   null
});
attachTrailToStation(issEntry, { length: 335, color: 0xbebebe, opacity: 0.6 });

// Sputnik 1 — red dot + short trail
const sputnikEntry = addStationKepler({
  name: 'Sputnik 1',
  a_km: 6955.2,
  e:    0.05201,
  i_deg:65.10,
  raan_deg: 0,
  argp_deg: 0,
  M0_deg:   0,
  epoch:   new Date(Date.UTC(1957, 9, 4, 19, 28, 34)),
  color: 0xff2b2b,
  startUTC: new Date(Date.UTC(1957, 9, 4, 19, 28, 34)),
  endUTC:   new Date(Date.UTC(1958, 0, 4, 0, 0, 0))
});
attachTrailToStation(sputnikEntry, { length: 20, color: 0xff2b2b, opacity: 0.5 });

// Baikonur marker (we’ll launch from here)
const SPUTNIK_LAUNCH_LAT = 45.9203;
const SPUTNIK_LAUNCH_LON = 63.3422;
addFlagMarker(SPUTNIK_LAUNCH_LAT, SPUTNIK_LAUNCH_LON, 2.0, {});

// ===== ROCKET MODULE =====
function installRocketModule({ scene, earth }) {
  const EARTH_R = 2.0;
  const rockets = [];

  // helpers
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function smootherstep(a, b, t) { const x = clamp((t - a) / (b - a), 0, 1); return x*x*x*(x*(x*6 - 15) + 10); }
  
  function latLonToLocal(latDeg, lonDeg, r = 2.0) {
  const φ = THREE.MathUtils.degToRad(latDeg);                      // latitude
  const λ = THREE.MathUtils.degToRad(lonDeg + LON_OFFSET_DEG);     // longitude + offset

  // X to lon=0°, Z to lon=+90°E (right-handed), Y up (lat)
  const cosφ = Math.cos(φ), sinφ = Math.sin(φ);
  const cosλ = Math.cos(λ), sinλ = Math.sin(λ);

  // NOTE: z has a minus so +λ (East) goes toward -Z, which matches your eciToThree mapping.
  const x = r * cosφ * cosλ;
  const y = r * sinφ;
  const z = -r * cosφ * sinλ;
  return new THREE.Vector3(x, y, z);
}

  function getSurfaceFrame(latDeg, lonDeg) {
    const pad = latLonToLocal(latDeg, lonDeg, EARTH_R);
    const up = pad.clone().normalize();
    // geographic “north” tangent on sphere
    const lat = THREE.MathUtils.degToRad(latDeg);
    const lon = THREE.MathUtils.degToRad(lonDeg);
    const north = new THREE.Vector3(
      -Math.sin(lat) * Math.cos(lon),
       Math.cos(lat),
       Math.sin(lat) * Math.sin(lon)
    ).normalize();
    const east = north.clone().cross(up).normalize();
    return { pad, up, north, east };
  }

  // quadratic Bézier utilities
  function quadPoint(A,B,C,t){ const omt=1-t; return A.clone().multiplyScalar(omt*omt).add(B.clone().multiplyScalar(2*omt*t)).add(C.clone().multiplyScalar(t*t)); }
  function quadTangent(A,B,C,t){ const t1=B.clone().sub(A).multiplyScalar(2*(1-t)); const t2=C.clone().sub(B).multiplyScalar(2*t); return t1.add(t2).normalize(); }

  // create a rocket mesh + flame
  function createRocketMesh(color = 0xffffff) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 12), new THREE.MeshPhongMaterial({ color, emissive: 0x111111 }));
    body.rotation.x = Math.PI * 0.5; // nose forward on +X
    g.add(body);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), new THREE.MeshBasicMaterial({ color: 0xffaa33 }));
    flame.position.z = -0.11; flame.rotation.x = Math.PI;
    body.add(flame);
    return g;
  }

  /**
   * Launch from lat/lon at scheduled UTC time:
   * - Bézier ascent until t1 = t0 + duration
   * - Then circular orbit at (EARTH_R + orbitAlt) with given period
   */
  function scheduleLaunchUTC(utcWhen, {
    lat, lon,
    durationSimSec = 220,
    apexUp = 0.9,
    downrange = 1.2,
    orbitAlt = 2.0,
    orbitPeriodSimSec = 600,
    pathColor = 0xffa64d
  }) {
    const t0 = (utcWhen instanceof Date) ? utcWhen.getTime() : new Date(utcWhen).getTime();
    if (!Number.isFinite(t0)) { console.warn('scheduleLaunchUTC: bad date', utcWhen); return; }

    // geometry for path
    const arcSegs = 160;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((arcSegs + 1) * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: pathColor, transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    scene.add(line);

    const rocket = createRocketMesh(0xffffff);
    rocket.visible = false;
    scene.add(rocket);

    // will compute A,B,C lazily on first frame after t0 to use current Earth rotation
    const state = {
      t0, t1: t0 + durationSimSec * 1000,
      lat, lon, apexUp, downrange,
      orbitAlt, orbitPeriodSimSec,
      A: null, B: null, C: null,
      line, geo, positions: geo.attributes.position.array,
      rocket, phase0: 0, // orbit phase chosen at insertion
      inOrbit: false, dead: false
    };
    rockets.push(state);
  }

  function update(dateUTC) {
    const now = dateUTC.getTime();
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      if (r.dead) continue;

      // Before t0: invisible
      if (now < r.t0) { r.rocket.visible = false; continue; }

      // Lazily build ascent geometry at first activation (Earth has rotated)
      if (!r.A) {
        const { pad, up, east } = getSurfaceFrame(r.lat, r.lon);
        const A = pad.clone().add(up.clone().multiplyScalar(0.02));
        const B = pad.clone().add(up.clone().multiplyScalar(r.apexUp)).add(east.clone().multiplyScalar(r.downrange * 0.6));
        const C = up.clone().multiplyScalar(EARTH_R + r.orbitAlt).add(east.clone().multiplyScalar(r.downrange * 0.6));
        r.A = A; r.B = B; r.C = C;
        r.rocket.visible = true;
      }

      const T = (now - r.t0) / (r.t1 - r.t0);
      if (T <= 1) {
        // ASCENT (Bézier)
        const te = smootherstep(0, 1, clamp(T,0,1));
        const pos = quadPoint(r.A, r.B, r.C, te);
        const tan = quadTangent(r.A, r.B, r.C, te);
        r.rocket.position.copy(pos);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0), tan.normalize());
        r.rocket.quaternion.copy(q);

        // grow path progressively
        const steps = Math.max(2, Math.floor(te * 160) + 1);
        for (let k = 0; k < steps; k++) {
          const u = (k / 160) * te;
          const p = quadPoint(r.A, r.B, r.C, u);
          const idx = k * 3;
          r.positions[idx] = p.x; r.positions[idx + 1] = p.y; r.positions[idx + 2] = p.z;
        }
        r.geo.setDrawRange(0, steps);
        r.geo.attributes.position.needsUpdate = true;

      } else {
        // ORBIT PHASE (simple circular in plane defined at insertion)
        if (!r.inOrbit) {
          // Define orbital frame at C: radial = Ĉ, tangential = (east-ish from A/B), normal = radial × tangential
          const radial = r.C.clone().normalize();
          // approximate tangential using last ascent tangent
          const tanEnd = quadTangent(r.A, r.B, r.C, 1).normalize();
          const normal = new THREE.Vector3().crossVectors(radial, tanEnd).normalize();
          const tangential = new THREE.Vector3().crossVectors(normal, radial).normalize();

          r.orbit = { radial, tangential, normal, R: r.C.length() };
          r.phase0 = 0;
          r.inOrbit = true;

          // fade the ascent path a bit
          r.line.material.opacity = 0.55;
        }

        const ω = 2 * Math.PI / r.orbitPeriodSimSec; // rad/s (sim)
        const tOrbit = (now - r.t1) / 1000;
        const θ = r.phase0 + ω * tOrbit;

        const cos = Math.cos(θ), sin = Math.sin(θ);
        const pos = r.orbit.radial.clone().multiplyScalar(cos * r.orbit.R)
                    .add(r.orbit.tangential.clone().multiplyScalar(sin * r.orbit.R));

        r.rocket.position.copy(pos);

        // orient rocket along velocity (tangent)
        const velDir = r.orbit.tangential.clone().multiplyScalar(cos).negate()
                       .add(r.orbit.radial.clone().multiplyScalar(sin));
        velDir.normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0), velDir);
        r.rocket.quaternion.copy(q);

        // Optional: draw a faint orbit hint (first time only)
        if (!r.orbitLine) {
          const og = new THREE.BufferGeometry();
          const N = 256;
          const arr = new Float32Array((N + 1) * 3);
          for (let k = 0; k <= N; k++) {
            const a = (2*Math.PI * k) / N;
            const p = r.orbit.radial.clone().multiplyScalar(Math.cos(a)*r.orbit.R)
                      .add(r.orbit.tangential.clone().multiplyScalar(Math.sin(a)*r.orbit.R));
            const j = k*3; arr[j]=p.x; arr[j+1]=p.y; arr[j+2]=p.z;
          }
          og.setAttribute('position', new THREE.BufferAttribute(arr, 3));
          const om = new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.35 });
          r.orbitLine = new THREE.Line(og, om); r.orbitLine.frustumCulled = false;
          scene.add(r.orbitLine);
        }
      }
    }
  }

  return { scheduleLaunchUTC, update };
}

const rockets = installRocketModule({ scene, earth });

// ====== SIMPLE SCHEDULER (UTC) ======
const scheduledJobs = []; // { whenMs, cb, fired }
function atUTC(when, fn) {
  const ms = (when instanceof Date) ? when.getTime() : new Date(when).getTime();
  if (!Number.isFinite(ms)) return;
  scheduledJobs.push({ whenMs: ms, cb: fn, fired: false });
}
let prevSimMs = null;
function runScheduler(prevMs, nowMs) {
  if (prevMs === null) return;
  const lo = Math.min(prevMs, nowMs), hi = Math.max(prevMs, nowMs);
  for (const j of scheduledJobs) {
    if (!j.fired && j.whenMs > lo && j.whenMs <= hi) { j.fired = true; j.cb(); }
  }
}

// === Seed a couple of launches ===
// 1) Baikonur: launch a few minutes after Sputnik epoch
atUTC(new Date(Date.UTC(1957, 9, 4, 19, 33, 0)), () => {
  rockets.scheduleLaunchUTC(new Date(Date.UTC(1957, 9, 4, 19, 33, 0)), {
    lat: SPUTNIK_LAUNCH_LAT,
    lon: SPUTNIK_LAUNCH_LON,
    durationSimSec: 220,
    apexUp: 1.1,
    downrange: 1.4,
    orbitAlt: 2.0,             // ~LEO above your 2.0-unit Earth
    orbitPeriodSimSec: 600,    // ~10 sim min
    pathColor: 0xffa64d
  });
});

// 2) Another launch later the same day
atUTC(new Date(Date.UTC(1957, 9, 4, 21, 0, 0)), () => {
  rockets.scheduleLaunchUTC(new Date(Date.UTC(1957, 9, 4, 21, 0, 0)), {
    lat: SPUTNIK_LAUNCH_LAT,
    lon: SPUTNIK_LAUNCH_LON,
    durationSimSec: 200,
    apexUp: 0.9,
    downrange: 1.2,
    orbitAlt: 2.3,
    orbitPeriodSimSec: 750,
    pathColor: 0x66c2ff
  });
});

// ---------- Animate ----------
renderer.setAnimationLoop(() => {
  // Sim time
  const date = simDate();
  const simMsNow = date.getTime();
  runScheduler(prevSimMs, simMsNow);
  prevSimMs = simMsNow;

  utcHud.textContent = formatUTC(date);

  // Sim dt
  const simMs = date.getTime();
  const dtSimSec = (_prevSimMs === null) ? 0 : (simMs - _prevSimMs) / 1000;
  _prevSimMs = simMs;

  const jd   = jdUTC(date);
  const T    = centuriesTT(jd);

  // Ephemerides
  const sunJ  = sunEci(T);
  const moonJ = moonEci(T);
  const P = precessionMatrix(T);
  const sunMOD  = applyMat3(P, sunJ);
  const moonMOD = applyMat3(P, moonJ);

  // Sun
  const sunDir = eciToThree(sunMOD).normalize();
  const sunR   = 12;
  const sunPos = sunDir.multiplyScalar(sunR);
  sun.position.copy(sunPos);
  sunMesh.position.copy(sunPos);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();

  // Moon
  const moonPos = eciToThree(moonMOD).multiplyScalar(AU_TO_UNITS);
  moon.position.copy(moonPos);
  moon.lookAt(0, 0, 0);
  const roll = MOON_ROLL_OFFSET + MOON_ROLL_SPEED * dtSimSec;
  if (roll !== 0) {
    _toEarth.set(-moon.position.x, -moon.position.y, -moon.position.z).normalize();
    moon.rotateOnAxis(_toEarth, roll);
  }

  // Stations
  for (const s of stations){
    const active = stationActiveAt(s, date);
    s.dot.visible = active;
    if (!active) { clearTrail(s); continue; }
    const rECI_km = propagateKepler(s.station, date);
    const pos = eciKmToThreeUnits(rECI_km);
    s.dot.position.copy(pos);
    updateTrail(s, pos);
  }

  // Earth spin
  earth.rotation.set(0, 0, 0);
  earth.rotateZ(THREE.MathUtils.degToRad(23.4));
  earth.rotateY(gmstRad(jd));

  // Rockets (ascent + orbit)
  rockets.update(date);

  controls.update();
  renderer.render(scene, camera);
});
