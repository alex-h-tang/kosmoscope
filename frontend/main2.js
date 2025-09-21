import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/* =========================
   Basic Scene / Renderer
   ========================= */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
camera.position.set(0, 0, 9);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 40;

/* Lights */
scene.add(new THREE.AmbientLight(0xffffff, 0.2));
const sunLight = new THREE.DirectionalLight(0xffffff, 5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
scene.add(sunLight);
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);
sunLight.target = sunTarget;

/* Decorative visible sun */
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.8, 48, 48),
  new THREE.MeshBasicMaterial({ color: 0xffe08a })
);
scene.add(sunMesh);

/* =========================
   Earth / Moon
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
earth.rotation.z = THREE.MathUtils.degToRad(23.4);
scene.add(earth);

const moonTex = texLoader.load(
  '/overlays/moon.jpg',
  t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); },
  undefined,
  err => console.error('Failed to load /overlays/moon.jpg', err)
);
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(0.54, 64, 64),
  new THREE.MeshPhongMaterial({ map: moonTex, bumpMap: moonTex, bumpScale: 0.025, shininess: 5 })
);
moon.castShadow = true;
moon.receiveShadow = true;
scene.add(moon);

/* =========================
   Astro helpers (Sun/Moon direction & Earth spin)
   ========================= */
function jdUTC(date = new Date()) { return date.getTime() / 86400000 + 2440587.5; }
function centuriesTT(jd_utc) { const deltaT = 69; const jd_tt = jd_utc + deltaT / 86400; return (jd_tt - 2451545.0) / 36525; }
function meanObliquityRad(T) {
  const e = 84381.406 - 46.836769*T - 0.0001831*T*T + 0.00200340*T*T*T - 5.76e-7*T*T*T*T - 4.34e-8*T*T*T*T*T;
  return (e / 3600) * Math.PI / 180;
}
function gmstRad(jd) {
  const Tu = (jd - 2451545.0) / 36525.0;
  let s = 67310.54841 + (876600*3600 + 8640184.812866)*Tu + 0.093104*Tu*Tu - 6.2e-6*Tu*Tu*Tu;
  s = ((s % 86400) + 86400) % 86400; // 0..86400
  return (s / 240) * Math.PI / 180;
}
function sunEci(T) {
  const d2r = Math.PI/180;
  const g = (357.52911 + 35999.05029*T - 0.0001537*T*T) * d2r;
  const L = (280.46646 + 36000.76983*T + 0.0003032*T*T) * d2r;
  const lambda = ((L/d2r) + (1.914602 - 0.004817*T - 0.000014*T*T)*Math.sin(g)
                + (0.019993 - 0.000101*T)*Math.sin(2*g) + 0.000289*Math.sin(3*g)) * d2r;
  const R = 1.000001018 - 0.016708617*Math.cos(g) - 0.000139589*Math.cos(2*g);
  const eps = meanObliquityRad(T);
  return { x: R * Math.cos(lambda), y: R * Math.sin(lambda) * Math.cos(eps), z: R * Math.sin(lambda) * Math.sin(eps) };
}
function moonEci(T) {
  const d2r = Math.PI/180;
  const Lp = 218.3164477 + 481267.88123421*T - 0.0015786*T*T + T*T*T/538841 - T*T*T*T/65194000;
  const D  = 297.8501921 + 445267.1114034*T - 0.0018819*T*T + T*T*T/545868 - T*T*T*T/113065000;
  const M  = 357.5291092 + 35999.0502909*T - 0.0001536*T*T + T*T*T/24490000;
  const Mp = 134.9633964 + 477198.8675055*T + 0.0087414*T*T + T*T*T/69699 - T*T*T*T/14712000;
  const F  = 93.2720950 + 483202.0175233*T - 0.0036539*T*T - T*T*T/3526000 + T*T*T*T/863310000;
  const Lp_r = Lp*d2r, D_r = D*d2r, Mp_r = Mp*d2r, F_r = F*d2r;
  const lon = (Lp + 6.289*Math.sin(Mp_r) + 1.274*Math.sin(2*D_r - Mp_r) + 0.658*Math.sin(2*D_r)
             + 0.214*Math.sin(2*Mp_r) + 0.110*Math.sin(D_r)) * d2r;
  const lat = (5.128*Math.sin(F_r) + 0.280*Math.sin(Mp_r + F_r) + 0.277*Math.sin(Mp_r - F_r)
             + 0.173*Math.sin(2*D_r - F_r) + 0.055*Math.sin(2*D_r + F_r)
             + 0.046*Math.sin(2*D_r - Mp_r + F_r)) * d2r;
  const delta_km = 385000.56 - 20905.355*Math.cos(Mp_r) - 3699.111*Math.cos(2*D_r - Mp_r)
                 - 2955.968*Math.cos(2*D_r) - 569.925*Math.cos(2*Mp_r);
  const r_AU = delta_km / 149597870.7;
  const xe = r_AU * Math.cos(lat) * Math.cos(lon);
  const ye = r_AU * Math.cos(lat) * Math.sin(lon);
  const ze = r_AU * Math.sin(lat);
  const eps = meanObliquityRad(T);
  return { x: xe, y: ye*Math.cos(eps) - ze*Math.sin(eps), z: ye*Math.sin(eps) + ze*Math.cos(eps) };
}
function precessionMatrix(T) {
  const as2r = Math.PI / (180*3600);
  const zetaA  = (2306.2181*T + 0.30188*T*T + 0.017998*T*T*T) * as2r;
  const zA     = (2306.2181*T + 1.09468*T*T + 0.018203*T*T*T) * as2r;
  const thetaA = (2004.3109*T - 0.42665*T*T - 0.041833*T*T*T) * as2r;
  const cz = Math.cos(zA), sz = Math.sin(zA);
  const ct = Math.cos(thetaA), st = Math.sin(thetaA);
  const cp = Math.cos(zetaA), sp = Math.sin(zetaA);
  const m1 = [[cz, sz, 0], [-sz, cz, 0], [0, 0, 1]];
  const m2 = [[1, 0, 0], [0, ct, st], [0, -st, ct]];
  const m3 = [[cp, sp, 0], [-sp, cp, 0], [0, 0, 1]];
  const mul=(A,B)=>{const M=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)M[i][j]+=A[i][k]*B[k][j];return M;};
  return mul(mul(m1,m2),m3);
}
function applyMat3(m, v) { return { x:m[0][0]*v.x + m[0][1]*v.y + m[0][2]*v.z,
                                    y:m[1][0]*v.x + m[1][1]*v.y + m[1][2]*v.z,
                                    z:m[2][0]*v.x + m[2][1]*v.y + m[2][2]*v.z }; }
const MEAN_LUNAR_AU = 384400 / 149597870.7;
const AU_TO_UNITS   = 5.0 / MEAN_LUNAR_AU;
const eciToThree = v => new THREE.Vector3(v.x, v.z, v.y);

/* =========================
   UTC HUD + Sim Clock
   ========================= */
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:6px 10px;font:14px ui-monospace,Menlo,Consolas,monospace;z-index:9999;border-radius:0 0 8px 8px;';
document.body.appendChild(hud);
const pad2=n=>String(n).padStart(2,'0');
const fmtUTC=d=>`UTC: ${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

let speedMultiplier = 2500; // simulated ms per real ms
const realStart = Date.now();
function simDate() {
  const elapsed = Date.now() - realStart;
  return new Date(realStart + elapsed * speedMultiplier);
}

/* =========================
   Shared lat/lon -> Earth local (station & rockets)
   ========================= */
const LON_OFFSET_DEG = 0; // keep 0; both station and rockets use this
function latLonToLocalOnEarth(latDeg, lonDeg, r = 2.0) {
  // Texture-friendly mapping used throughout the app
  const phi   = THREE.MathUtils.degToRad(90 - latDeg);
  const theta = THREE.MathUtils.degToRad(lonDeg + 180 + LON_OFFSET_DEG);
  const x = -r * Math.sin(phi) * Math.cos(theta);
  const z =  r * Math.sin(phi) * Math.sin(theta);
  const y =  r * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

/* =========================
   Add a surface station (Mojave)
   ========================= */
function addSurfaceStation({lat, lon, name='Station', altitude=0.03, scale=0.22}){
  const station = new THREE.Group();
  station.name = name;

  const surface = latLonToLocalOnEarth(lat, lon, 2.0);
  const up = surface.clone().normalize();
  station.position.copy(surface.clone().add(up.clone().multiplyScalar(altitude)));
  station.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), up);

  const body  = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.25,0.25), new THREE.MeshPhongMaterial({ color:0xdddddd, emissive:0x111111 }));
  const pgeo  = new THREE.BoxGeometry(0.6, 0.06, 0.22);
  const pmat  = new THREE.MeshPhongMaterial({ color:0x66a3ff, emissive:0x0a1a33 });
  const pL    = new THREE.Mesh(pgeo, pmat);
  const pR    = new THREE.Mesh(pgeo, pmat);
  pL.position.set(-0.55,0.02,0);
  pR.position.set( 0.55,0.02,0);
  const dot   = new THREE.Mesh(new THREE.SphereGeometry(0.05,12,12), new THREE.MeshBasicMaterial({ color:0xff4444 }));
  dot.position.set(0,0.22,0);
  station.add(body,pL,pR,dot);
  station.scale.setScalar(scale);
  earth.add(station);
  return station;
}
const stationMojave = addSurfaceStation({
  lat: 35.05910,
  lon: -118.14880,
  name: 'Mojave Station',
  altitude: 0.03,
  scale: 0.22
});

/* Build a local frame in WORLD space at a given lat/lon (or at a station) */
const _tmp = new THREE.Vector3();
function surfaceFrameFromLatLon(latDeg, lonDeg, r=2.0){
  const local = latLonToLocalOnEarth(latDeg, lonDeg, r);
  const pWorld = local.clone().applyMatrix4(earth.matrixWorld);
  const center = earth.getWorldPosition(new THREE.Vector3());
  const up = pWorld.clone().sub(center).normalize();
  const northAxisWorld = new THREE.Vector3(0,1,0).applyQuaternion(earth.quaternion);
  const north = northAxisWorld.clone().sub(up.clone().multiplyScalar(northAxisWorld.dot(up))).normalize();
  const east  = north.clone().cross(up).normalize();
  return { pWorld, up, north, east, center };
}
function surfaceFrameFromStation(station){
  const pWorld = station.getWorldPosition(_tmp.set(0,0,0)).clone();
  const center = earth.getWorldPosition(new THREE.Vector3());
  const up = pWorld.clone().sub(center).normalize();
  const northAxisWorld = new THREE.Vector3(0,1,0).applyQuaternion(earth.quaternion);
  const north = northAxisWorld.clone().sub(up.clone().multiplyScalar(northAxisWorld.dot(up))).normalize();
  const east  = north.clone().cross(up).normalize();
  return { pWorld, up, north, east, center };
}

function installRocketModule({ THREE, scene, earth }) {
  const EARTH_R = 2.0;
  const ARC_SEGS = 140;

  const rockets = [];

  // --- helpers ---
  const clamp = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const smoother=(t)=>{ t=clamp(t,0,1); return t*t*t*(t*(t*6-15)+10); };
  const quadPoint=(A,B,C,t)=> {
    const omt=1-t;
    return A.clone().multiplyScalar(omt*omt)
      .add(B.clone().multiplyScalar(2*omt*t))
      .add(C.clone().multiplyScalar(t*t));
  };
  const quadTangent=(A,B,C,t)=>{
    const t1=B.clone().sub(A).multiplyScalar(2*(1-t));
    const t2=C.clone().sub(B).multiplyScalar(2*t);
    return t1.add(t2).normalize();
  };

  // Frame-rate–independent time for rockets
  let prevSimMs = null;
  const simDtSec = (dateUTC)=>{
    const ms = dateUTC.getTime();
    const dt = (prevSimMs==null ? 0 : (ms - prevSimMs)/1000);
    prevSimMs = ms;
    return dt;
  };

  function createOrbitRing(center, normal, radius, color=0x888888, segments=128){
    normal = normal.clone().normalize();
    // construct stable in-plane basis (u,v)
    const arb = Math.abs(normal.x) < 0.8 ? new THREE.Vector3(1,0,0) : new THREE.Vector3(0,1,0);
    const u = arb.clone().sub(normal.clone().multiplyScalar(arb.dot(normal))).normalize();
    const v = normal.clone().cross(u).normalize();

    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array((segments+1)*3);
    for (let i=0;i<=segments;i++){
      const a = 2*Math.PI*i/segments;
      const p = center.clone()
        .add(u.clone().multiplyScalar(Math.cos(a)*radius))
        .add(v.clone().multiplyScalar(Math.sin(a)*radius));
      const k = i*3; pos[k]=p.x; pos[k+1]=p.y; pos[k+2]=p.z;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, transparent:true, opacity:0.35 }));
    line.frustumCulled = false;
    scene.add(line);
    return line;
  }

  function launchToOrbitFromFrame(frame, {
    orbitAlt = 2.0,
    azimuthDeg = 90,
    durationAscent = 220,
    color = 0xff9955,
    label = 'Orbiter',
    orbitPeriodSec = 5400
  } = {}) {
    const { pWorld:pad, up, north, east, center } = frame;
    const R_orbit = EARTH_R + orbitAlt;

    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const downrange = east.clone().multiplyScalar(Math.sin(az))
                          .add(north.clone().multiplyScalar(Math.cos(az)))
                          .normalize();

    const A = pad.clone().add(up.clone().multiplyScalar(0.02));
    const B = pad.clone()
                 .add(up.clone().multiplyScalar(orbitAlt*0.7))
                 .add(downrange.clone().multiplyScalar(orbitAlt*0.6));
    const C = center.clone()
                    .add(up.clone().multiplyScalar(R_orbit))
                    .add(downrange.clone().multiplyScalar(orbitAlt*0.6));

    const lineGeo = new THREE.BufferGeometry();
    const positions = new Float32Array((ARC_SEGS+1)*3);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    lineGeo.setDrawRange(0,0);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color, transparent:true, opacity:0.9 }));
    line.frustumCulled = false; scene.add(line);

    const rocket = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.18, 14),
      new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x111111 })
    );
    rocket.position.copy(A); scene.add(rocket);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.06,0.16,8), new THREE.MeshBasicMaterial({ color: 0xffaa33 }));
    flame.position.set(0,-0.12,0); flame.rotation.x = Math.PI; rocket.add(flame);

    const startMs = simDate().getTime();
    const endMs   = startMs + durationAscent*1000;

    const rec = { phase:'ASCENT', A,B,C, line, lineGeo, positions, rocket,
                  startMs, endMs, label, color, alive:true, orbit:null, ring:null };
    rockets.push(rec);
    return rec;
  }

  function launchFromLatLon(latDeg, lonDeg, opts={}) {
    return launchToOrbitFromFrame(surfaceFrameFromLatLon(latDeg, lonDeg, 2.0), opts);
  }
  function launchFromStation(station, opts={}) {
    return launchToOrbitFromFrame(surfaceFrameFromStation(station), opts);
  }

  // Kepler-ish scaling so higher orbits move slower
  function orbitPeriodGuess(R_units){
    const R0 = 4.0; // ~LEO radius in your units (2R⊕)
    const T0 = 5400; // 90 min
    return T0 * Math.pow(Math.max(R_units, R0)/R0, 1.5);
  }

  function update(dateUTC) {
    const dt = simDtSec(dateUTC);  // seconds of simulated time this frame

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      if (!r.alive) continue;

      if (r.phase === 'ASCENT') {
        const raw = (dateUTC.getTime() - r.startMs) / (r.endMs - r.startMs);
        const te  = smoother(raw);

        const pos = quadPoint(r.A, r.B, r.C, te);
        const tan = quadTangent(r.A, r.B, r.C, te);
        r.rocket.position.copy(pos);
        r.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), tan);

        const steps = Math.max(2, Math.floor(te * ARC_SEGS));
        for (let k=0; k<=steps; k++){
          const u = te * (k/steps);
          const p = quadPoint(r.A, r.B, r.C, u);
          const idx = k*3; r.positions[idx]=p.x; r.positions[idx+1]=p.y; r.positions[idx+2]=p.z;
        }
        r.lineGeo.setDrawRange(0, steps+1);
        r.lineGeo.attributes.position.needsUpdate = true;

        if (raw >= 1) {
          // ---- Robust orbit basis ----
          const center = earth.getWorldPosition(new THREE.Vector3());
          const rad = r.C.clone().sub(center).normalize();        // radial direction
          // Use ascent end tangent projected to the plane perpendicular to rad
          const approxTan = quadTangent(r.A, r.B, r.C, 1).clone();
          let t = approxTan.sub(rad.clone().multiplyScalar(approxTan.dot(rad))).normalize();
          if (!isFinite(t.x) || !isFinite(t.y) || !isFinite(t.z) || t.lengthSq() < 1e-6) {
            // fallback: build an east-like axis in the local tangent plane
            const worldUp = new THREE.Vector3(0,1,0);
            const side = worldUp.clone().cross(rad);
            t = side.lengthSq() > 1e-6 ? side.normalize() : new THREE.Vector3(1,0,0).cross(rad).normalize();
          }
          const normal = new THREE.Vector3().crossVectors(rad, t).normalize();
          // Orthonormal in-plane basis
          const u = t.clone().normalize();
          const v = normal.clone().cross(u).normalize();

          const R = r.C.distanceTo(center);
          const T = orbitPeriodGuess(R);
          r.orbit = { center, R, u, v, theta: 0, omega: (2*Math.PI)/T }; // rad/s
          r.ring  = createOrbitRing(center, normal, R, 0x888888, 128);
          r.phase = 'ORBIT';
        }
      } else if (r.phase === 'ORBIT') {
        if (!r.orbit || !isFinite(r.orbit.R) || !isFinite(r.orbit.omega)) {
          // Defensive: kill this rocket cleanly if numbers got bad
          if (r.line) { scene.remove(r.line); r.line.geometry.dispose(); r.line.material.dispose(); }
          scene.remove(r.rocket); r.rocket.geometry.dispose(); r.rocket.material.dispose();
          if (r.ring) { scene.remove(r.ring); r.ring.geometry.dispose(); r.ring.material.dispose(); }
          r.alive = false; rockets.splice(i,1);
          continue;
        }

        r.orbit.theta += r.orbit.omega * dt;  // use simulated Δt (fixes frame hitching)
        const cosT = Math.cos(r.orbit.theta), sinT = Math.sin(r.orbit.theta);

        const p = r.orbit.center.clone()
          .add(r.orbit.u.clone().multiplyScalar(cosT * r.orbit.R))
          .add(r.orbit.v.clone().multiplyScalar(sinT * r.orbit.R));
        const t = r.orbit.u.clone().multiplyScalar(-sinT).add(r.orbit.v.clone().multiplyScalar(cosT)).normalize();

        r.rocket.position.copy(p);
        r.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), t);

        // fade ascent trail once in orbit
        if (r.line) {
          r.line.material.opacity *= 0.98;
          if (r.line.material.opacity < 0.05) {
            scene.remove(r.line); r.line.geometry.dispose(); r.line.material.dispose(); r.line = null;
          }
        }
      }
    }
  }

  return { launchFromLatLon, launchFromStation, update };
}


const rockets = installRocketModule({ THREE, scene, earth });

/* =========================
   Launch scheduling (UTC) + key to launch
   ========================= */
const scheduled = []; // { tMs, lat, lon, opts, fired }

function scheduleLaunchUTC(utcWhen, lat, lon, opts={}){
  const tMs = (utcWhen instanceof Date) ? utcWhen.getTime() : new Date(utcWhen).getTime();
  if (!Number.isFinite(tMs)) return;
  scheduled.push({ tMs, lat, lon, opts, fired:false });
}
function processSchedule(prevMs, currMs){
  if (prevMs == null) return;
  const lo = Math.min(prevMs, currMs), hi = Math.max(prevMs, currMs);
  for (const job of scheduled){
    if (!job.fired && job.tMs > lo && job.tMs <= hi){
      rockets.launchFromLatLon(job.lat, job.lon, job.opts);
      job.fired = true;
    }
  }
}

// Demo: schedule one launch ~5 simulated seconds after load (from Mojave)
scheduleLaunchUTC(new Date(simDate().getTime() + 5_000 * speedMultiplier), 35.05910, -118.14880, {
  label:'Demo launch',
  azimuthDeg: 90,
  orbitAlt: 2.0,
  durationAscent: 220,
  color: 0xff9955
});

// Key “L” — immediate launch from the Mojave station
window.addEventListener('keydown', (e)=>{
  if (e.key.toLowerCase() === 'l') {
    rockets.launchFromStation(stationMojave, {
      label: 'Manual launch',
      azimuthDeg: 90,
      orbitAlt: 2.0,
      durationAscent: 220,
      color: 0xffcc55
    });
  }
});

/* =========================
   Resize
   ========================= */
window.addEventListener('resize', ()=>{
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w,h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
});

/* =========================
   Animate
   ========================= */
let prevSimMs = null;
renderer.setAnimationLoop(()=>{
  const date = simDate();
  hud.textContent = fmtUTC(date);

  // Sun / Moon positions
  const jd = jdUTC(date), T = centuriesTT(jd);
  const P = precessionMatrix(T);
  const sunJ  = sunEci(T),  moonJ = moonEci(T);
  const sunMOD  = applyMat3(P, sunJ),  moonMOD = applyMat3(P, moonJ);

  const sunDir = eciToThree(sunMOD).normalize();
  const sunPos = sunDir.clone().multiplyScalar(12);
  sunLight.position.copy(sunPos);
  sunMesh.position.copy(sunPos);
  sunTarget.position.set(0,0,0);
  sunLight.target.updateMatrixWorld();

  const moonPos = eciToThree(moonMOD).multiplyScalar(AU_TO_UNITS);
  moon.position.copy(moonPos);
  moon.lookAt(0,0,0);

  // Earth spin
  earth.rotation.set(0,0,0);
  earth.rotateZ(THREE.MathUtils.degToRad(23.4));
  earth.rotateY(gmstRad(jd));

  // Process scheduled launches
  const nowMs = date.getTime();
  processSchedule(prevSimMs, nowMs);
  prevSimMs = nowMs;

  // Update active rockets
  rockets.update(date);

  controls.update();
  renderer.render(scene, camera);
});
