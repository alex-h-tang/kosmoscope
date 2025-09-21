import * as THREE from 'three';
import { gmstRad } from './astro.js';

export const EARTH_RADIUS_KM = 6378.137;
export const MU_EARTH = 398600.4418;
export const J2 = 1.08262668e-3;
export const EARTH_RADIUS_UNITS = 2.0;
export const KM_TO_UNITS_LEO = EARTH_RADIUS_UNITS / EARTH_RADIUS_KM;
const D2R = Math.PI/180;

export function eciKmToThreeUnits(p){
  return new THREE.Vector3(p.x, p.z, -p.y).multiplyScalar(KM_TO_UNITS_LEO);
}
export function eciToSubpoint(rEci, jd) {
  const θ = gmstRad(jd), c = Math.cos(θ), s = Math.sin(θ);
  const x =  c*rEci.x + s*rEci.y;
  const y = -s*rEci.x + c*rEci.y;
  const z =  rEci.z;
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z, Math.hypot(x, y));
  return { lat, lon, x, y, z };
}

export function solveE(M, e, tol=1e-8){
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
export function perifocalToECI(Ω,i,ω){
  const cO=Math.cos(Ω), sO=Math.sin(Ω);
  const ci=Math.cos(i), si=Math.sin(i);
  const cw=Math.cos(ω), sw=Math.sin(ω);
  return [
    [ cO*cw - sO*sw*ci,  -cO*sw - sO*cw*ci,  sO*si ],
    [ sO*cw + cO*sw*ci,  -sO*sw + cO*cw*ci, -cO*si ],
    [ sw*si           ,   cw*si            ,  ci   ]
  ];
}
export function mul3(M,v){
  return { x:M[0][0]*v.x + M[0][1]*v.y + M[0][2]*v.z,
           y:M[1][0]*v.x + M[1][1]*v.y + M[1][2]*v.z,
           z:M[2][0]*v.x + M[2][1]*v.y + M[2][2]*v.z };
}
export function j2Rates(a,e,i){
  const n = Math.sqrt(MU_EARTH/(a*a*a));
  const p = a*(1-e*e);
  const fac = J2 * Math.pow(EARTH_RADIUS_KM/p,2) * n;
  const raanDot = -1.5 * fac * Math.cos(i);
  const argpDot =  0.75 * fac * (5*Math.cos(i)**2 - 1);
  return { n, raanDot, argpDot };
}
export function propagateKepler(elem, date){
  const dt = date.getTime()/1000 - elem.epoch_s;
  const { n, raanDot, argpDot } = j2Rates(elem.a_km, elem.e, elem.i_rad);
  const Ω = elem.raan_rad + raanDot*dt;
  const ω = elem.argp_rad + argpDot*dt;
  const M = elem.M0_rad   + n*dt;
  const E = solveE(((M%(2*Math.PI))+2*Math.PI)%(2*Math.PI), elem.e);
  const r = elem.a_km * (1 - elem.e*Math.cos(E));
  const ν = Math.atan2(Math.sqrt(1-elem.e*elem.e)*Math.sin(E), Math.cos(E)-elem.e);
  const r_pqw = { x:r*Math.cos(ν), y:r*Math.sin(ν), z:0 };
  return mul3(perifocalToECI(Ω, elem.i_rad, ω), r_pqw);
}

export function addStationKepler(scene, { name='Station', a_km, e=0.001, i_deg,
  raan_deg=0, argp_deg=0, M0_deg=0, epoch=new Date(), color=0xff5555,
  startUTC=null, endUTC=null }) {

  const station = {
    name, a_km, e,
    i_rad: i_deg*D2R, raan_rad: raan_deg*D2R, argp_rad: argp_deg*D2R, M0_rad: M0_deg*D2R,
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
  return { station, dot, trail: null };
}

export function attachTrail(entry, scene, { length=100, color=0xffffff, opacity=0.8 } = {}){
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(length * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(geom, mat);
  line.frustumCulled = false;
  scene.add(line);
  entry.trail = { line, geom, positions, max: length, points: [] };
}
export function updateTrail(entry, pos){
  const t = entry.trail; if (!t) return;
  t.points.push(pos.clone()); if (t.points.length > t.max) t.points.shift();
  const n = t.points.length;
  for (let i=0;i<n;i++){ const p=t.points[i], k=i*3; t.positions[k]=p.x; t.positions[k+1]=p.y; t.positions[k+2]=p.z; }
  t.geom.setDrawRange(0, n);
  t.geom.attributes.position.needsUpdate = true;
}
export function stationActiveAt(entry, date) {
  const t = date.getTime()/1000;
  return t >= entry.station.start_s && t <= entry.station.end_s;
}
export function clearTrail(entry){
  if (!entry.trail) return;
  entry.trail.points.length = 0;
  entry.trail.geom.setDrawRange(0, 0);
  entry.trail.geom.attributes.position.needsUpdate = true;
}

export function alignElementsToLatLonAtEpoch(entry, latDeg, lonDeg, jdAtEpoch){
  const st = entry.station;
  const φ = THREE.MathUtils.degToRad(latDeg);
  const λ = THREE.MathUtils.degToRad(lonDeg);
  const u_ecef = { x: Math.cos(φ)*Math.cos(λ), y: Math.cos(φ)*Math.sin(λ), z: Math.sin(φ) };
  const θ = gmstRad(jdAtEpoch), c = Math.cos(θ), s = Math.sin(θ);
  const rhat = { x: c*u_ecef.x - s*u_ecef.y, y: s*u_ecef.x + c*u_ecef.y, z: u_ecef.z };

  const i = st.i_rad, si=Math.sin(i), ci=Math.cos(i);
  const Rxy = Math.hypot(rhat.x, rhat.y) || 1e-12;
  const alpha = Math.atan2(rhat.y, rhat.x);
  const sVal = THREE.MathUtils.clamp(-(ci/si) * (rhat.z / Rxy), -1, 1);
  const Omega = alpha + Math.asin(sVal);

  const sinu = THREE.MathUtils.clamp(rhat.z / si, -1, 1);
  const cosu = rhat.x * Math.cos(Omega) + rhat.y * Math.sin(Omega);
  const u = Math.atan2(sinu, cosu);

  const e = st.e, omega = st.argp_rad || 0, nu = u - omega;
  const beta = Math.sqrt((1 - e) / (1 + e));
  const E = 2 * Math.atan(Math.tan(nu/2) * beta);
  const M = E - e*Math.sin(E);

  const wrap2pi = x => (x % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  st.raan_rad = wrap2pi(Omega);
  st.M0_rad   = wrap2pi(M);
}
