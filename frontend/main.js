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

// === CONSISTENT AXIS MAPPING (critical fix) ===
// ECI/ECEF x→scene x, z→scene y, y→scene (−z)  (matches your marker mapping)
function eciToThree(v) { return new THREE.Vector3(v.x, v.z, -v.y); }

// ECI -> ECEF sub-satellite point (spherical Earth)
function eciToSubpoint(rEci, jd) {
  const θ = gmstRad(jd); // radians
  const c = Math.cos(θ), s = Math.sin(θ);
  // ECEF = R3(-GMST) * ECI
  const x =  c * rEci.x + s * rEci.y;
  const y = -s * rEci.x + c * rEci.y;
  const z =  rEci.z;
  const lon = Math.atan2(y, x);                 // [-π, π], East+
  const lat = Math.atan2(z, Math.hypot(x, y));  // geocentric
  return { lat, lon, x, y, z };
}

// ---- Exact epoch alignment: set Ω and M0 so that at epoch the subpoint is at (lat,lon) ----
function alignElementsToLatLonAtEpoch(entry, latDeg, lonDeg) {
  const st = entry.station;
  const epochDate = new Date(st.epoch_s * 1000);
  const jd = jdUTC(epochDate);

  // Target ECEF unit vector from lat/lon (East-positive longitude)
  const φ = THREE.MathUtils.degToRad(latDeg);
  const λ = THREE.MathUtils.degToRad(lonDeg);
  const cφ = Math.cos(φ), sφ = Math.sin(φ);
  const cλ = Math.cos(λ), sλ = Math.sin(λ);
  const u_ecef = { x: cφ*cλ, y: cφ*sλ, z: sφ };

  // ECEF -> ECI at epoch: ECI = R3(+GMST) * ECEF
  const θ = gmstRad(jd);
  const c = Math.cos(θ), s = Math.sin(θ);
  const rhat = {
    x: c*u_ecef.x - s*u_ecef.y,
    y: s*u_ecef.x + c*u_ecef.y,
    z: u_ecef.z
  };

  // Known: inclination i; Unknowns: Ω (RAAN) and u (arg of latitude) at epoch.
  const i = st.i_rad;
  const si = Math.sin(i), ci = Math.cos(i);

  // Solve Ω from plane constraint: ĥ · r̂ = 0, with ĥ = (si sinΩ, -si cosΩ, ci)
  const Rxy = Math.hypot(rhat.x, rhat.y) || 1e-12;
  const alpha = Math.atan2(rhat.y, rhat.x);
  const sVal = THREE.MathUtils.clamp(-(ci/si) * (rhat.z / Rxy), -1, 1);
  let Omega = alpha + Math.asin(sVal);

  // u from:
  //   sin u = r_z / sin i
  //   cos u = r_x cosΩ + r_y sinΩ
  const sinu = THREE.MathUtils.clamp(rhat.z / si, -1, 1);
  const cosu = rhat.x * Math.cos(Omega) + rhat.y * Math.sin(Omega);
  const u = Math.atan2(sinu, cosu);

  // With ω as-is (you set 0), ν = u − ω. Convert ν -> E -> M.
  const e = st.e;
  const omega = st.argp_rad || 0;
  const nu = u - omega;

  const beta = Math.sqrt((1 - e) / (1 + e));
  const E = 2 * Math.atan(Math.tan(nu / 2) * beta); // << correct relation
  const M = E - e * Math.sin(E);

  function wrap2pi(x){ x = x % (2*Math.PI); return x < 0 ? x + 2*Math.PI : x; }
  st.raan_rad = wrap2pi(Omega);
  st.M0_rad   = wrap2pi(M);
}

function wrapPi(x){ return Math.atan2(Math.sin(x), Math.cos(x)); }

// Convert lat/lon (deg, lon East+) to Earth-local coords (Y up).
function addSurfaceMarker(latDeg, lonDeg, radiusUnits = 2.0, color = 0x00ff88) {
  const r   = radiusUnits * 1.002; // float above surface
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);

  // Matches scene mapping: x = r cosφ cosλ, y = r sinφ, z = - r cosφ sinλ
  const cosφ = Math.cos(lat), sinφ = Math.sin(lat);
  const cosλ = Math.cos(lon), sinλ = Math.sin(lon);

  const x = r * cosφ * cosλ;
  const y = r * sinφ;
  const z = -r * cosφ * sinλ;

  const mark = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 12, 12),
    new THREE.MeshBasicMaterial({ color })
  );
  mark.position.set(x, y, z);
  earth.add(mark);
  return mark;

}
// Flag marker with custom image (horizontal banner, facing equator)
// + elegant pole: tapered shaft, finial, and round base
function addFlagMarker(
  latDeg,
  lonDeg,
  radiusUnits = 2.0,
  {
    imageUrl = null,           // e.g. '/flags/kazakhstan.png'
    flagSize = [0.16, 0.10],   // [width, height]
    poleColor = 0xdedede,
    finialColor = 0xd4af37,    // gold-ish
    baseColor = 0x222222,
    doubleSided = true,
    flipY = true,
    gapFromPole = 0.015,

    // Pole & base styling
    poleHeight = 0.28,
    poleRadiusTop = 0.006,
    poleRadiusBottom = 0.01,
    baseRadius = 0.04,
    baseHeight = 0.01,
    finialRadius = 0.012
  } = {}
) {
  const r   = radiusUnits * 1.003;
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);

  // Earth-local (Y up) mapping used throughout your scene.
  const cosφ = Math.cos(lat), sinφ = Math.sin(lat);
  const cosλ = Math.cos(lon), sinλ = Math.sin(lon);
  const x = r * cosφ * cosλ;
  const y = r * sinφ;
  const z = -r * cosφ * sinλ;

  // Surface normal in Earth-local coords
  const n = new THREE.Vector3(x, y, z).normalize();

  const grp = new THREE.Group();

  // ---- Base (round plinth) ----
  // Place so its bottom just kisses the ground (tiny embed to prevent z-fight)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.2, roughness: 0.6 })
  );
  base.position.y = baseHeight * 0.5 - 0.001;
  grp.add(base);

  // Optional bevel lip (very thin disk) for a classier look
  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(baseRadius * 1.06, baseRadius * 1.06, 0.004, 24),
    new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.3, roughness: 0.5 })
  );
  lip.position.y = baseHeight + 0.002;
  grp.add(lip);

  // ---- Tapered pole ----
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(poleRadiusTop, poleRadiusBottom, poleHeight, 20),
    new THREE.MeshStandardMaterial({ color: poleColor, metalness: 0.1, roughness: 0.35 })
  );
  pole.position.y = baseHeight + poleHeight * 0.5;
  grp.add(pole);

  // ---- Finial (small sphere) ----
  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(finialRadius, 16, 12),
    new THREE.MeshStandardMaterial({ color: finialColor, metalness: 0.6, roughness: 0.25 })
  );
  finial.position.y = baseHeight + poleHeight + finialRadius * 0.9;
  grp.add(finial);

  // ---- Flag (horizontal banner: width +X, height +Y) ----
  const [fw, fh] = flagSize;
  const flagGeo = new THREE.PlaneGeometry(fw, fh);

  let flagMat;
  if (imageUrl) {
    const tex = texLoader.load(
      imageUrl,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        t.flipY = flipY;
      }
    );
    flagMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide
    });
  } else {
    flagMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide
    });
  }

  const flag = new THREE.Mesh(flagGeo, flagMat);
  // Left edge kisses pole; sits near the top of pole
  flag.position.set(
    fw * 0.5 + gapFromPole,
    baseHeight + poleHeight - fh * 0.55,
    0
  );
  // Keep horizontal (no Z-rotation)
  grp.add(flag);

  // 1) Align group +Y to the surface normal
  grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  grp.position.set(x, y, z);

  // 2) Yaw the group so the flag faces the equator (along local meridian)
  // Tangent toward geographic north at this point:
  const tNorth = new THREE.Vector3(
    -sinφ * cosλ,
     cosφ,
     sinφ * sinλ
  ).normalize();
  const towardEquator = (latDeg >= 0 ? tNorth.clone().negate() : tNorth);

  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(grp.quaternion);
  const cross = new THREE.Vector3().crossVectors(fwd, towardEquator);
  const dot = THREE.MathUtils.clamp(fwd.dot(towardEquator), -1, 1);
  const sign = Math.sign(cross.dot(n));
  const ang = Math.acos(dot) * (isNaN(sign) ? 1 : sign);
  grp.rotateY(ang);

  earth.add(grp);
  return grp;
}


// === Scene scale: keep your existing sizes ===
const MEAN_LUNAR_AU = 384400 / 149597870.7; // ≈ 0.002569 AU
const AU_TO_UNITS = (typeof moonDistance !== 'undefined' ? moonDistance : 5) / MEAN_LUNAR_AU;

// Time scale
let speedMultiplier = 1000;
const realStart = Date.now();
// start a bit before launch so you can see activation
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
  // *** CRITICAL: match surface mapping handedness ***
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
  // visibility window
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
  const n = t.points.length;
  for (let i = 0; i < n; i++) {
    const p = t.points[i];
    const k = i * 3;
    t.positions[k]     = p.x;
    t.positions[k + 1] = p.y;
    t.positions[k + 2] = p.z;
  }
  t.geom.setDrawRange(0, n);
  t.geom.attributes.position.needsUpdate = true;
}

// visibility helpers
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
  a_km: EARTH_RADIUS_KM + 420, // ~420 km altitude
  e:    0.001,
  i_deg:51.64,
  raan_deg: 0,
  argp_deg: 0,
  M0_deg:   0,
  epoch: new Date(Date.UTC(2025,0,1,0,0,0)),
  color: 0xffffff,
  startUTC: new Date(Date.UTC(1998,10,20,6,40,0)), // 1998-11-20T06:40Z
  endUTC:   null
});
attachTrailToStation(issEntry, { length: 335, color: 0xbebebe, opacity: 0.6 });

// Sputnik 1 — small red sphere + modest trail
const sputnikEntry = addStationKepler({
  name: 'Sputnik 1',
  a_km: 6955.2,      // semi-major axis (km)
  e:    0.05201,     // eccentricity
  i_deg:65.10,       // inclination (deg)
  raan_deg: 0,
  argp_deg: 0,
  M0_deg:   0,
  epoch:   new Date(Date.UTC(1957, 9, 4, 19, 28, 34)), // 1957-10-04T19:28:34Z
  color: 0xff2b2b,
  startUTC: new Date(Date.UTC(1957, 9, 4, 19, 28, 34)),
  endUTC:   new Date(Date.UTC(1958, 0, 4, 0, 0, 0))   // burned up on reentry
});
// **Analytic epoch alignment** so the subpoint is Baikonur at epoch:
alignElementsToLatLonAtEpoch(sputnikEntry, 45.9203, 63.3422);
attachTrailToStation(sputnikEntry, { length: 20, color: 0xff2b2b, opacity: 0.5 });

// Baikonur markers
const SPUTNIK_LAUNCH_LAT = 45.9203;
const SPUTNIK_LAUNCH_LON = 63.3422;
addFlagMarker(45.9203, 63.3422, 2.0, {
  imageUrl: '/public/flags/kazakhstan.png',
  flagSize: [0.20, 0.12],   // wider banner
});
// USA — Cape Canaveral (Mercury/Gemini/Apollo 7) + KSC (Apollo/Shuttle/Dragon/Orion)
addFlagMarker(28.4360,  -80.5680, 2.0, { imageUrl: '/public/flags/usa.png',    flagSize: [0.20, 0.12] }); // LC-5  (Mercury-Redstone MR-3/MR-4)

// China — Jiuquan (all Shenzhou crewed launches)
addFlagMarker(40.9606, 100.2983, 2.0, { imageUrl: '/public/flags/china.png',   flagSize: [0.20, 0.12] }); // JSLC LA-4 / Pad 921

// USA — suborbital crewed (historic & modern)
addFlagMarker(35.0590, -118.1530, 2.0, { imageUrl: '/public/flags/usa.png',    flagSize: [0.20, 0.12] }); // Edwards AFB AND Mojave Air & Space Port (SpaceShipOne, 2004)
addFlagMarker(32.9899, -106.9740, 2.0, { imageUrl: '/public/flags/usa.png',    flagSize: [0.20, 0.12] }); // Spaceport America (Virgin Galactic)
addFlagMarker(31.4420, -104.7570, 2.0, { imageUrl: '/public/flags/usa.png',    flagSize: [0.20, 0.12] }); // Blue Origin Launch Site One (Van Horn, TX)

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

  // --- Stations: propagate, respect time windows, update contrails ---
  for (const s of stations){
    const active = stationActiveAt(s, date);
    s.dot.visible = active;
    if (!active) { clearTrail(s); continue; }

    const rECI_km = propagateKepler(s.station, date);
    const pos = eciKmToThreeUnits(rECI_km); // uses corrected mapping (x, z, -y)
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
