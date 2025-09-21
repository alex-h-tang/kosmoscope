import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* =========================
   Renderer, Scene, Camera
   ========================= */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
camera.position.set(0, 0, 8);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 30;

/* =========================
   Lights
   ========================= */
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

const sun = new THREE.DirectionalLight(0xffffff, 5);
sun.position.set(10, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
sun.target.position.set(0, 0, 0);
scene.add(sun.target);

/* =========================
   Earth
   ========================= */
const texLoader = new THREE.TextureLoader();
const earthMap = texLoader.load(
  '/overlays/earth_day.png',
  t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); },
  undefined,
  err => console.error('Failed to load /overlays/earth_day.png', err)
);

const earth = new THREE.Mesh(
  new THREE.SphereGeometry(2, 128, 128),
  new THREE.MeshPhongMaterial({ map: earthMap })
);
earth.castShadow = true;
earth.receiveShadow = true;
earth.rotation.z = THREE.MathUtils.degToRad(23.4); // axial tilt
scene.add(earth);

/* =========================
   Visible Sun sphere
   ========================= */
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.8, 48, 48),
  new THREE.MeshBasicMaterial({ color: 0xffe08a })
);
sunMesh.position.copy(sun.position);
scene.add(sunMesh);

/* =========================
   Moon
   ========================= */
const moonRadius   = 0.54;  // relative to Earth radius=2
const moonDistance = 5.0;   // scene units

const moonTex = texLoader.load(
  '/overlays/moon.jpg',
  t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); },
  undefined,
  err => console.error('Failed to load /overlays/moon.jpg', err)
);

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(moonRadius, 64, 64),
  new THREE.MeshPhongMaterial({
    map: moonTex, bumpMap: moonTex, bumpScale: 0.025,
    specular: 0x111111, shininess: 5
  })
);
moon.castShadow = true;
moon.receiveShadow = true;

const moonPivot = new THREE.Object3D();
scene.add(moonPivot);
moonPivot.add(moon);
moon.position.set(moonDistance, 0, 0);

/* =========================
   UTC HUD
   ========================= */
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

/* =========================
   Astro helpers
   ========================= */
function jdUTC(date = new Date()) { return date.getTime() / 86400000 + 2440587.5; }
function centuriesTT(jd_utc) {
  const deltaT = 69; // seconds
  const jd_tt = jd_utc + deltaT / 86400;
  return (jd_tt - 2451545.0) / 36525;
}
function meanObliquityRad(T){
  const eps0_arcsec =
    84381.406 - 46.836769*T - 0.0001831*T*T + 0.00200340*T*T*T
    - 5.76e-7*T*T*T*T - 4.34e-8*T*T*T*T*T;
  return (eps0_arcsec / 3600) * Math.PI / 180;
}
function gmstRad(jd){
  const Tu = (jd - 2451545.0) / 36525.0;
  let gmst_sec =
    67310.54841 + (876600*3600 + 8640184.812866)*Tu + 0.093104*Tu*Tu - 6.2e-6*Tu*Tu*Tu;
  gmst_sec = ((gmst_sec % 86400) + 86400) % 86400;
  return (gmst_sec / 240) * Math.PI / 180;
}
function sunEci(T){
  const d2r = Math.PI/180;
  const g = (357.52911 + 35999.05029*T - 0.0001537*T*T) * d2r;
  const L = (280.46646 + 36000.76983*T + 0.0003032*T*T) * d2r;
  const lambda = ( (L/d2r)
    + (1.914602 - 0.004817*T - 0.000014*T*T)*Math.sin(g)
    + (0.019993 - 0.000101*T)*Math.sin(2*g)
    + 0.000289*Math.sin(3*g) ) * d2r;
  const R = 1.000001018 - 0.016708617*Math.cos(g) - 0.000139589*Math.cos(2*g);
  const eps = meanObliquityRad(T);
  return {
    x: R * Math.cos(lambda),
    y: R * Math.sin(lambda) * Math.cos(eps),
    z: R * Math.sin(lambda) * Math.sin(eps),
    R_AU: R
  };
}
function moonEci(T){
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
    385000.56 - 20905.355*Math.cos(Mp_r) - 3699.111*Math.cos(2*D_r - Mp_r)
              - 2955.968*Math.cos(2*D_r) - 569.925*Math.cos(2*Mp_r);
  const r_AU = delta_km / 149597870.7;

  const cosLat = Math.cos(lat);
  const xe = r_AU * cosLat * Math.cos(lon);
  const ye = r_AU * cosLat * Math.sin(lon);
  const ze = r_AU * Math.sin(lat);

  const eps = meanObliquityRad(T);
  return {
    x: xe,
    y: ye*Math.cos(eps) - ze*Math.sin(eps),
    z: ye*Math.sin(eps) + ze*Math.cos(eps),
    r_AU
  };
}
function precessionMatrix(T){
  const as2r = Math.PI / (180*3600);
  const zetaA  = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T) * as2r;
  const zA     = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T) * as2r;
  const thetaA = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T) * as2r;

  const cz = Math.cos(zA), sz = Math.sin(zA);
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
function applyMat3(m, v){
  return {
    x: m[0][0]*v.x + m[0][1]*v.y + m[0][2]*v.z,
    y: m[1][0]*v.x + m[1][1]*v.y + m[1][2]*v.z,
    z: m[2][0]*v.x + m[2][1]*v.y + m[2][2]*v.z,
  };
}
function eciToThree(v){ return new THREE.Vector3(v.x, v.z, v.y); }

/* =========================
   LEO / ISS helpers
   ========================= */
const EARTH_RADIUS_KM = 6378.137;
const MU_EARTH        = 398600.4418;         // km^3/s^2
const J2              = 1.08262668e-3;
const EARTH_R_UNITS   = 2.0;
const KM_TO_UNITS     = EARTH_R_UNITS / EARTH_RADIUS_KM;
const D2R             = Math.PI / 180;

function solveE(M, e, tol=1e-8) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 20; k++) {
    const f = E - e*Math.sin(E) - M;
    const fp = 1 - e*Math.cos(E);
    const dE = -f / fp;
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
function eciKmToUnitsVec3(p){
  return new THREE.Vector3(p.x, p.z, p.y).multiplyScalar(KM_TO_UNITS);
}
function j2Rates(a,e,i){
  const n = Math.sqrt(MU_EARTH/(a*a*a));
  const p = a*(1-e*e);
  const fac = J2 * Math.pow(EARTH_RADIUS_KM/p,2) * n;
  return {
    n,
    raanDot: -1.5 * fac * Math.cos(i),
    argpDot:  0.75 * fac * (5*Math.cos(i)**2 - 1),
  };
}
function propagateKepler(elem, date){
  const t  = date.getTime()/1000;
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
  return mul3(R, r_pqw); // km in ECI
}

/* =========================
   “Launch → Orbit” rocket module (define ONCE)
   ========================= */
function installOrbitingRocket({ THREE, scene, earth }) {
  const EARTH_R = 2.0;
  const ARC_SEGS = 150;
  const rockets = [];

  // helpers
  const clamp = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const smootherstep = (a,b,t)=>{const x=clamp((t-a)/(b-a),0,1);return x*x*x*(x*(x*6-15)+10);};
  function latLonToLocal(latDeg, lonDeg, r = EARTH_R) {
    const lat = THREE.MathUtils.degToRad(latDeg);
    const lon = THREE.MathUtils.degToRad(lonDeg);
    return new THREE.Vector3(
      r * Math.cos(lat) * Math.cos(lon),
      r * Math.sin(lat),
      r * Math.cos(lat) * Math.sin(lon)
    );
  }
  function earthCenterWorld(){ const c = new THREE.Vector3(); earth.getWorldPosition(c); return c; }
  function getSurfaceFrameWorld(latDeg, lonDeg) {
    const center = earthCenterWorld();
    const local  = latLonToLocal(latDeg, lonDeg, EARTH_R);
    const pWorld = local.clone().applyMatrix4(earth.matrixWorld);
    const up     = pWorld.clone().sub(center).normalize();
    const northAxisWorld = new THREE.Vector3(0,1,0).applyQuaternion(earth.quaternion);
    const north  = northAxisWorld.clone().sub(up.clone().multiplyScalar(northAxisWorld.dot(up))).normalize();
    const east   = north.clone().cross(up).normalize();
    return { pWorld, up, north, east, center };
  }
  const qPoint   = (A,B,C,t)=>{const u=1-t;return A.clone().multiplyScalar(u*u).add(B.clone().multiplyScalar(2*u*t)).add(C.clone().multiplyScalar(t*t));};
  const qTangent = (A,B,C,t)=>{const t1=B.clone().sub(A).multiplyScalar(2*(1-t));const t2=C.clone().sub(B).multiplyScalar(2*t);return t1.add(t2).normalize();};

  function launchToOrbit(latDeg, lonDeg, {
    durationAscent = 220,
    orbitAlt       = 2.0,
    azimuthDeg     = 90,
    color          = 0xff8855,
    label          = 'Orbiter',
    orbitPeriodSec = 5400
  } = {}) {
    const R_orbit = EARTH_R + orbitAlt;
    const { pWorld: pad, up, east, north, center } = getSurfaceFrameWorld(latDeg, lonDeg);
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const downrange = east.clone().multiplyScalar(Math.sin(az)).add(north.clone().multiplyScalar(Math.cos(az))).normalize();

    const A = pad.clone().add(up.clone().multiplyScalar(0.02));
    const B = pad.clone().add(up.clone().multiplyScalar(orbitAlt * 0.7)).add(downrange.clone().multiplyScalar(orbitAlt * 0.6));
    const C = center.clone().add(up.clone().multiplyScalar(R_orbit)).add(downrange.clone().multiplyScalar(orbitAlt * 0.6));

    const rocket = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.22, 14),
      new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x111111 })
    );
    rocket.position.copy(A);
    scene.add(rocket);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.18, 10),
      new THREE.MeshBasicMaterial({ color: 0xffaa33 })
    );
    flame.position.set(0,-0.14,0); flame.rotation.x = Math.PI; rocket.add(flame);

    const trailGeom = new THREE.BufferGeometry();
    const trailPos  = new Float32Array((ARC_SEGS + 1) * 3);
    trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    const trailMat  = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const trail     = new THREE.Line(trailGeom, trailMat);
    trail.frustumCulled = false;
    scene.add(trail);

    const planeNormal = up.clone().cross(downrange).normalize();
    const u = C.clone().sub(center).normalize();
    const v = planeNormal.clone().cross(u).normalize();
    const omega = (2 * Math.PI) / Math.max(1, orbitPeriodSec);

    const startMs = simDate().getTime();
    rockets.push({
      phase: 'ASCENT',
      startMs,
      endAscentMs: startMs + durationAscent * 1000,
      A, B, C,
      rocket, flame, trailGeom, trailPos, trail,
      center, R_orbit, u, v, omega,
      theta0: 0, orbitStartMs: 0, label
    });
  }

  function update(dateUTC) {
    const nowMs = dateUTC.getTime();
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      if (r.phase === 'ASCENT') {
        const t  = Math.max(0, Math.min(1, (nowMs - r.startMs) / (r.endAscentMs - r.startMs)));
        const te = smootherstep(0, 1, t);
        const pos = qPoint(r.A, r.B, r.C, te);
        const tan = qTangent(r.A, r.B, r.C, te);
        r.rocket.position.copy(pos);
        r.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), tan);

        const steps = Math.max(2, Math.floor(te * ARC_SEGS) + 1);
        for (let k = 0; k < steps; k++) {
          const u = (k / ARC_SEGS) * te;
          const p = qPoint(r.A, r.B, r.C, u);
          const idx = k * 3;
          r.trailPos[idx]   = p.x; r.trailPos[idx+1] = p.y; r.trailPos[idx+2] = p.z;
        }
        r.trailGeom.setDrawRange(0, steps);
        r.trailGeom.attributes.position.needsUpdate = true;

        if (t >= 1) {
          r.phase = 'ORBIT';
          r.orbitStartMs = nowMs;
          r.trail.material.opacity = 0.6;
        }
      } else {
        const dt = (nowMs - r.orbitStartMs) / 1000;
        const theta = r.theta0 + r.omega * dt;
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        const pos  = r.center.clone()
          .add(r.u.clone().multiplyScalar(r.R_orbit * cosT))
          .add(r.v.clone().multiplyScalar(r.R_orbit * sinT));
        const velDir = r.u.clone().multiplyScalar(-sinT).add(r.v.clone().multiplyScalar(cosT)).normalize();
        r.rocket.position.copy(pos);
        r.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), velDir);

        const segs = ARC_SEGS;
        const arcLen = 0.35 * Math.PI * 2;
        for (let k=0;k<=segs;k++){
          const a = theta - (k/segs)*arcLen;
          const ca = Math.cos(a), sa = Math.sin(a);
          const p = r.center.clone()
            .add(r.u.clone().multiplyScalar(r.R_orbit * ca))
            .add(r.v.clone().multiplyScalar(r.R_orbit * sa));
          const idx = k*3;
          r.trailPos[idx]   = p.x; r.trailPos[idx+1] = p.y; r.trailPos[idx+2] = p.z;
        }
        r.trailGeom.setDrawRange(0, segs+1);
        r.trailGeom.attributes.position.needsUpdate = true;
      }
    }
  }

  return { launchToOrbit, update };
}

/* =========================
   Simulated time
   ========================= */
let speedMultiplier = 1000;          // sim ms per real ms
const realStart = Date.now();
function simDate(){
  const elapsed = Date.now() - realStart;
  return new Date(realStart + elapsed * speedMultiplier);
}

/* =========================
   Surface Station (Mojave)
   ========================= */
const LON_OFFSET_DEG = 0;
function latLonToLocalOnEarth(latDeg, lonDeg, r = 2.0) {
  const phi   = THREE.MathUtils.degToRad(90 - latDeg);
  const theta = THREE.MathUtils.degToRad(lonDeg + 180 + LON_OFFSET_DEG);
  const x = -r * Math.sin(phi) * Math.cos(theta);
  const z =  r * Math.sin(phi) * Math.sin(theta);
  const y =  r * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}
function addSurfaceStation({ lat, lon, name='Ground Station', altitude=0.03, scale=0.22 } = {}){
  const station = new THREE.Group();
  station.name = name;

  const surface = latLonToLocalOnEarth(lat, lon, 2.0);
  const up = surface.clone().normalize();
  const pos = surface.clone().add(up.clone().multiplyScalar(altitude));
  station.position.copy(pos);

  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), up);
  station.quaternion.copy(q);

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.25, 0.25),
    new THREE.MeshPhongMaterial({ color: 0xdddddd, emissive: 0x111111, shininess: 30 })
  );
  const panelGeo = new THREE.BoxGeometry(0.6, 0.06, 0.22);
  const panelMat = new THREE.MeshPhongMaterial({ color: 0x66a3ff, emissive: 0x0a1a33, shininess: 10 });
  const panelL = new THREE.Mesh(panelGeo, panelMat);
  const panelR = new THREE.Mesh(panelGeo, panelMat);
  panelL.position.set(-0.55, 0.02, 0);
  panelR.position.set( 0.55, 0.02, 0);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.35, 12),
    new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x222222 })
  );
  mast.position.set(0, 0.3, 0);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5555 })
  );
  marker.position.set(0, 0.22, 0);

  station.add(core, panelL, panelR, mast, marker);
  station.scale.setScalar(scale);
  earth.add(station);
  return station;
}
const stationMojave = addSurfaceStation({
  lat: 35.05910,
  lon: -118.14880,
  name: 'California Test Station',
  altitude: 0.03,
  scale: 0.22
});

/* =========================
   Simple ISS dot + trail
   ========================= */
const stations = [];
function addStationKepler({ name='ISS', a_km, e=0.001, i_deg, raan_deg=0, argp_deg=0, M0_deg=0, epoch=new Date(), color=0xffffff }) {
  const station = {
    name,
    a_km, e,
    i_rad: i_deg * D2R,
    raan_rad: raan_deg * D2R,
    argp_rad: argp_deg * D2R,
    M0_rad:   M0_deg   * D2R,
    epoch_s: epoch.getTime()/1000,
  };
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), new THREE.MeshBasicMaterial({ color }));
  scene.add(dot);
  const entry = { station, dot };
  stations.push(entry);
  return entry;
}
function attachTrail(entry, { length = 300, color = 0xbebebe, opacity = 0.6 } = {}) {
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(length * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geom, mat);
  line.frustumCulled = false;
  scene.add(line);
  entry.trail = { line, geom, positions, max: length, points: [] };
}
function updateTrail(entry, pos) {
  const t = entry.trail; if (!t) return;
  t.points.push(pos.clone());
  if (t.points.length > t.max) t.points.shift();
  const n = t.points.length;
  for (let i=0;i<n;i++){
    const p = t.points[i]; const k = i*3;
    t.positions[k]   = p.x; t.positions[k+1] = p.y; t.positions[k+2] = p.z;
  }
  t.geom.setDrawRange(0, n);
  t.geom.attributes.position.needsUpdate = true;
}
const iss = addStationKepler({
  a_km: EARTH_RADIUS_KM + 420,
  e: 0.001,
  i_deg: 51.64,
  raan_deg: 0,
  argp_deg: 0,
  M0_deg:   0,
  epoch: new Date(Date.UTC(2025,0,1,0,0,0)),
  color: 0xffffff
});
attachTrail(iss);

/* =========================
   Rocket module instance + scheduler
   ========================= */
const orbiting = installOrbitingRocket({ THREE, scene, earth });

// Press “L” to launch immediately from Mojave
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'l') {
    orbiting.launchToOrbit(35.05910, -118.14880, {
      azimuthDeg: 90, durationAscent: 220, orbitAlt: 2.0, orbitPeriodSec: 5400,
      color: 0x66c2ff, label: 'Mojave LV-Now'
    });
  }
});

// Schedule launches at specific UTC times
const scheduled = []; // {tMs, lat, lon, opts, fired}
function scheduleLaunchUTC(whenUtcStringOrDate, lat, lon, opts={}) {
  const tMs = (whenUtcStringOrDate instanceof Date)
    ? whenUtcStringOrDate.getTime()
    : new Date(whenUtcStringOrDate).getTime();
  if (!Number.isFinite(tMs)) return;
  scheduled.push({ tMs, lat, lon, opts, fired:false });
}
// EXAMPLE: one a few (sim) seconds from now for quick feedback
scheduleLaunchUTC(new Date(simDate().getTime() + 10_000 / (speedMultiplier/1000)), 35.05910, -118.14880, {
  azimuthDeg: 90, durationAscent: 220, orbitAlt: 2.0, orbitPeriodSec: 5400,
  color: 0xff9966, label: 'Mojave LV-01'
});

function processScheduler(prevMs, currMs) {
  if (prevMs == null) return;
  const lo = Math.min(prevMs, currMs), hi = Math.max(prevMs, currMs);
  for (const job of scheduled) {
    if (!job.fired && job.tMs > lo && job.tMs <= hi) {
      orbiting.launchToOrbit(job.lat, job.lon, job.opts);
      job.fired = true;
    }
  }
}

/* =========================
   Resize
   ========================= */
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
});

/* =========================
   Animate
   ========================= */
const _toEarth = new THREE.Vector3();
let _prevSimMs = null;
let MOON_ROLL_SPEED = 0.0;
const MOON_ROLL_OFFSET = 0;

renderer.setAnimationLoop(() => {
  const date = simDate();
  utcHud.textContent = formatUTC(date);

  const simMs = date.getTime();
  processScheduler(_prevSimMs, simMs);

  const dtSimSec = (_prevSimMs === null) ? 0 : (simMs - _prevSimMs) / 1000;
  _prevSimMs = simMs;

  const jd = jdUTC(date);
  const T  = centuriesTT(jd);

  // Sun/Moon positions
  const P = precessionMatrix(T);
  const sunMOD  = applyMat3(P, sunEci(T));
  const moonMOD = applyMat3(P, moonEci(T));

  const sunPos = eciToThree(sunMOD).normalize().multiplyScalar(12);
  sun.position.copy(sunPos);
  sunMesh.position.copy(sunPos);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();

  const MEAN_LUNAR_AU = 384400 / 149597870.7;
  const AU_TO_UNITS   = moonDistance / MEAN_LUNAR_AU;
  moon.position.copy(eciToThree(moonMOD).multiplyScalar(AU_TO_UNITS));
  moon.lookAt(0, 0, 0);
  const roll = MOON_ROLL_OFFSET + MOON_ROLL_SPEED * dtSimSec;
  if (roll !== 0) {
    _toEarth.set(-moon.position.x, -moon.position.y, -moon.position.z).normalize();
    moon.rotateOnAxis(_toEarth, roll);
  }

  // Update ISS position + trail
  for (const s of stations) {
    const rECI_km = propagateKepler(s.station, date);
    const pos = eciKmToUnitsVec3(rECI_km);
    s.dot.position.copy(pos);
    updateTrail(s, pos);
  }
  scheduleLaunchUTC('2025-09-20T23:00:00Z', 35.05910, -118.14880, {
  azimuthDeg: 90, durationAscent: 220, orbitAlt: 2.2, orbitPeriodSec: 5400,
  color: 0x66c2ff, label: 'New Year Launch'
});

  // Earth spin
  earth.rotation.set(0, 0, 0);
  earth.rotateZ(THREE.MathUtils.degToRad(23.4));
  earth.rotateY(gmstRad(jd));

  // Advance rockets (both ascent & orbit phases)
  orbiting.update(date);

  controls.update();
  renderer.render(scene, camera);
});
