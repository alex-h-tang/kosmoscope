// rockets.js — LEO + TLI + lunar follow; AUTO events for HUD; no rocket picking/click
import * as THREE_NS from 'three';

export function installRocketModule({
  THREE = THREE_NS,
  scene,
  earth,
  orbitSlowdown = 3.0,
  ascentSlowdown = 1.0,
  pickManager = null,      // ignored for rockets now
  moonPositionFn = null,
  onEvent = null           // ← emit {type, id, ...}
}) {
  const EARTH_R = 2.0;
  const ARC_SEGS = 140;

  const rockets = [];
  const deleteQueue = [];
  let prevSimMs = null;
  let nextId = 1;
  const TLI_SPEEDUP = 6;

  /* ---------- helpers ---------- */
  const clamp01  = (t) => Math.max(0, Math.min(1, t));
  const smoother = (t) => { t = clamp01(t); return t*t*t*(t*(t*6 - 15) + 10); };

  function quadPoint(A,B,C,t){
    const omt = 1 - t;
    return A.clone().multiplyScalar(omt*omt)
            .add(B.clone().multiplyScalar(2*omt*t))
            .add(C.clone().multiplyScalar(t*t));
  }
  function quadTangent(A,B,C,t){
    const t1 = B.clone().sub(A).multiplyScalar(2*(1 - t));
    const t2 = C.clone().sub(B).multiplyScalar(2*t);
    return t1.add(t2).normalize();
  }

  function latLonToLocalOnEarth(latDeg, lonDeg, r = EARTH_R) {
    const phi   = THREE.MathUtils.degToRad(90 - latDeg);
    const theta = THREE.MathUtils.degToRad(lonDeg + 180);
    const x = -r * Math.sin(phi) * Math.cos(theta);
    const z =  r * Math.sin(phi) * Math.sin(theta);
    const y =  r * Math.cos(phi);
    return new THREE.Vector3(x, y, z);
  }
  function surfaceFrameFromLatLon(latDeg, lonDeg) {
    earth.updateMatrixWorld(true);
    const pLocal = latLonToLocalOnEarth(latDeg, lonDeg, EARTH_R);
    const pad    = pLocal.clone().applyMatrix4(earth.matrixWorld);
    const center = earth.getWorldPosition(new THREE.Vector3());
    const up     = pad.clone().sub(center).normalize();
    const northish = new THREE.Vector3(0,1,0)
      .applyQuaternion(earth.getWorldQuaternion(new THREE.Quaternion()));
    const north = northish.clone().sub(up.clone().multiplyScalar(northish.dot(up))).normalize();
    const east  = north.clone().cross(up).normalize();
    return { pad, up, north, east, center };
  }

  function createOrbitRing(center, radial, tangent, radius, color = 0x888888, segments = 128) {
    const u = radial.clone().normalize();
    const v = tangent.clone().normalize();
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array((segments + 1) * 3);
    for (let i = 0; i <= segments; i++) {
      const a = 2*Math.PI*i/segments;
      const p = center.clone()
        .add(u.clone().multiplyScalar(Math.cos(a) * radius))
        .add(v.clone().multiplyScalar(Math.sin(a) * radius));
      const k = i*3; pos[k]=p.x; pos[k+1]=p.y; pos[k+2]=p.z;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, transparent:true, opacity:0.35 }));
    line.frustumCulled = false;
    scene.add(line);
    return line;
  }

  function orbitPeriodGuess(R_units) {
    const R0 = 4.0, T0 = 5400;
    return T0 * Math.pow(Math.max(R_units, R0) / R0, 1.5);
  }

  function planAscent(frame, { orbitAlt, azimuthDeg }) {
    const { pad, up, north, east, center } = frame;
    const R_orbit = EARTH_R + orbitAlt;
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const downrange = east.clone().multiplyScalar(Math.sin(az))
                          .add(north.clone().multiplyScalar(Math.cos(az)))
                          .normalize();

    const A = pad.clone().add(up.clone().multiplyScalar(0.03));
    const B = pad.clone().add(up.clone().multiplyScalar(orbitAlt * 1.05))
                         .add(downrange.clone().multiplyScalar(orbitAlt * 0.35));
    const C = center.clone().add(up.clone().multiplyScalar(R_orbit))
                           .add(downrange.clone().multiplyScalar(orbitAlt * 0.55));
    return { A, B, C, center };
  }

  function makeAscentLine(color = 0xffa64d) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC_SEGS + 1) * 3), 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    scene.add(line);
    return line;
  }

  function createSpaceshipMesh() {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.22, 8, 16),
                                new THREE.MeshPhongMaterial({ color: 0xcfd4da, shininess: 40, emissive: 0x111111 }));
    hull.rotation.x = Math.PI * 0.5; g.add(hull);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.10, 16),
                                new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80, emissive: 0x111111 }));
    nose.position.y = 0.20; hull.add(nose);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.012, 10, 24),
                                new THREE.MeshPhongMaterial({ color: 0xffb259, shininess: 60, emissive: 0x111111 }));
    ring.rotation.x = Math.PI * 0.5; ring.position.y = 0.02; hull.add(ring);
    const finGeom = new THREE.BoxGeometry(0.02, 0.08, 0.10);
    const finMat  = new THREE.MeshPhongMaterial({ color: 0x8892a0, emissive: 0x111111 });
    const finL = new THREE.Mesh(finGeom, finMat); const finR = new THREE.Mesh(finGeom, finMat);
    finL.position.set(-0.07, -0.02, 0.02); finR.position.set(0.07, -0.02, 0.02); hull.add(finL); hull.add(finR);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 16),
                                new THREE.MeshPhongMaterial({ color: 0x333333, emissive: 0x090909, shininess: 5 }));
    bell.rotation.x = Math.PI; bell.position.y = -0.18; hull.add(bell);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.10, 12),
                                 new THREE.MeshBasicMaterial({ color: 0xffa533 }));
    plume.rotation.x = Math.PI; plume.position.y = -0.22; hull.add(plume);
    return g;
  }

  /* ---------- create/destroy & deletion ---------- */
  function destroyRecord(rec) {
    if (!rec) return;
    if (rec.rocket?.parent) rec.rocket.parent.remove(rec.rocket);
    if (rec.line)  { scene.remove(rec.line);  rec.line.geometry?.dispose(); rec.line.material?.dispose(); rec.line = null; }
    if (rec.ring)  { scene.remove(rec.ring);  rec.ring.geometry?.dispose(); rec.ring.material?.dispose(); rec.ring = null; }
    rec.rocket = null;
  }

  function deleteById(id) {
    const idx = rockets.findIndex(r => r.id === id);
    if (idx === -1) return false;
    destroyRecord(rockets[idx]);
    const removed = rockets.splice(idx, 1)[0];
    onEvent && onEvent({ type: 'rocket-deleted', id: removed?.id });
    return true;
  }
  function deleteAll() {
    while (rockets.length) deleteById(rockets[0].id);
  }

  function scheduleDelete(atMs, id = null) {
    const t = Number(atMs);
    if (!isFinite(t)) { console.warn('[rockets] scheduleDelete: invalid time', atMs); return false; }
    if (id !== null && !rockets.some(r => r.id === id)) { console.warn('[rockets] scheduleDelete: no rocket', id); return false; }
    if (deleteQueue.some(job => job.atMs === t && job.id === id)) return true;
    deleteQueue.push({ atMs: t, id });
    deleteQueue.sort((a, b) => a.atMs - b.atMs);
    return true;
  }
  const scheduleDeleteAll = (atMs) => scheduleDelete(atMs, null);

  /* ---------- public: LEO ---------- */
  function launchFromLatLon(latDeg, lonDeg, opts = {}) {
    const {
      orbitAlt = 0.8, azimuthDeg = 90, durationAscent = 200, color = 0xff9955,
      label = 'Launch', orbitPeriodSec = null, ascentSpeedScale = 1.0,
      astronauts = undefined, description = undefined,
    } = opts;

    const frame = surfaceFrameFromLatLon(latDeg, lonDeg);
    const { A, B, C, center } = planAscent(frame, { orbitAlt, azimuthDeg });

    const line = makeAscentLine(color);
    const positions = line.geometry.attributes.position.array;

    const rocket = createSpaceshipMesh();
    rocket.visible = false;
    rocket.position.copy(A);
    scene.add(rocket);

    const id = nextId++;
    const effDuration = Math.max(1, durationAscent * ascentSlowdown * ascentSpeedScale);

    rockets.push({
      id, label, color, phase:'ASCENT',
      A, B, C, center,
      line, positions, rocket,
      startMs:null, endMs:null,
      durationAscent: effDuration,
      orbit:null, ring:null, orbitPeriodSec,
      lockQuat:null,
      astronauts: Array.isArray(astronauts) ? astronauts : (astronauts ? [String(astronauts)] : []),
      description, lat: latDeg, lon: lonDeg
    });
    return id;
  }

  /* ---------- public: direct TLI (no LEO) ---------- */
  function launchToMoonFromLatLon(latDeg, lonDeg, opts = {}) {
    const {
      azimuthDeg = 90, durationAscent = 200, ascentSpeedScale = 1.0,
      transferSeconds = 3 * 24 * 3600, followSeconds = 5, color = 0x66c2ff,
      label = 'TLI', astronauts = undefined, description = 'Trans-lunar injection',
    } = opts;

    const frame = surfaceFrameFromLatLon(latDeg, lonDeg);
    const ascent = planAscent(frame, { orbitAlt: 1.6, azimuthDeg });

    const line = makeAscentLine(color);
    const positions = line.geometry.attributes.position.array;

    const rocket = createSpaceshipMesh();
    rocket.visible = false;
    rocket.position.copy(ascent.A);
    scene.add(rocket);

    const id = nextId++;
    const effAscent = Math.max(1, durationAscent * ascentSlowdown * ascentSpeedScale);

    rockets.push({
      id, label, color, phase:'ASCENT_TLI',
      A:ascent.A, B:ascent.B, C:ascent.C,
      line, positions, rocket,
      startMs:null, endMs:null,
      durationAscent: effAscent,
      tli:null,
      transferSeconds: Math.max(60, transferSeconds),
      followSeconds: Math.max(0.1, followSeconds),
      lockQuat:null,
      moonPositionFn,
      follow:null,
      astronauts: Array.isArray(astronauts) ? astronauts : (astronauts ? [String(astronauts)] : []),
      description, lat: latDeg, lon: lonDeg
    });
    return id;
  }

  /* ---------- update ---------- */
  function update(dateUTC) {
    const nowMs = (dateUTC instanceof Date ? dateUTC : new Date()).getTime();
    const dt = prevSimMs == null ? 0 : (nowMs - prevSimMs) / 1000;
    prevSimMs = nowMs;

    // timed deletions
    let guard = 0;
    while (deleteQueue.length && deleteQueue[0].atMs <= nowMs && guard++ < 1000) {
      const job = deleteQueue.shift();
      if (!job) continue;
      if (job.id == null) deleteAll(); else deleteById(job.id);
    }

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];

      if (r.phase === 'ASCENT') {
        if (r.startMs == null) {
          r.startMs = nowMs; r.endMs = r.startMs + r.durationAscent * 1000;
          onEvent && onEvent({ type: 'launch-start', id: r.id, label: r.label, astronauts: r.astronauts, description: r.description, lat: r.lat, lon: r.lon });
        }
        const raw = (nowMs - r.startMs) / (r.endMs - r.startMs);
        const te  = smoother(raw);
        if (!r._shown) { r._shown = true; r.rocket.visible = true; }
        const pos = quadPoint(r.A, r.B, r.C, te);
        const tan = quadTangent(r.A, r.B, r.C, te);
        r.rocket.position.copy(pos);
        r.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), tan);

        const steps = Math.max(2, Math.floor(te * ARC_SEGS));
        for (let k = 0; k <= steps; k++) {
          const u = te * (k / steps);
          const p = quadPoint(r.A, r.B, r.C, u);
          const j = k*3; r.positions[j]=p.x; r.positions[j+1]=p.y; r.positions[j+2]=p.z;
        }
        r.line.geometry.setDrawRange(0, steps + 1);
        r.line.geometry.attributes.position.needsUpdate = true;

        if (raw >= 1) {
          const center = r.center.clone();
          const rvec   = r.C.clone().sub(center);
          const R      = rvec.length();
          const radial = rvec.clone().divideScalar(R);

          const tEnd = quadTangent(r.A, r.B, r.C, 1);
          let tangentProj = tEnd.clone().sub(radial.clone().multiplyScalar(tEnd.dot(radial)));
          if (tangentProj.lengthSq() < 1e-10) {
            const up = new THREE.Vector3(0,1,0).applyQuaternion(earth.getWorldQuaternion(new THREE.Quaternion()));
            tangentProj = up.clone().cross(radial);
          }
          const tangent = tangentProj.normalize();

          r.lockQuat = r.rocket.quaternion.clone();

          const baseT = r.orbitPeriodSec ?? orbitPeriodGuess(R);
          const omega = (2*Math.PI) / (baseT * orbitSlowdown);

          r.orbit = { center, R, radial, tangent, theta:0, omega };
          r.ring  = createOrbitRing(center, radial, tangent, R, 0x888888, 128);
          r.phase = 'ORBIT';
          if (r.line) r.line.material.opacity = 0.55;
        }
      }

      else if (r.phase === 'ORBIT' && r.orbit) {
        r.orbit.theta += r.orbit.omega * dt;
        const c = Math.cos(r.orbit.theta), s = Math.sin(r.orbit.theta);
        const p = r.orbit.center.clone()
          .add(r.orbit.radial.clone().multiplyScalar(c * r.orbit.R))
          .add(r.orbit.tangent.clone().multiplyScalar(s * r.orbit.R));
        r.rocket.position.copy(p);
        if (r.lockQuat) r.rocket.quaternion.copy(r.lockQuat);

        if (r.line) {
          r.line.material.opacity *= 0.985;
          if (r.line.material.opacity < 0.05) {
            scene.remove(r.line); r.line.geometry.dispose(); r.line.material.dispose(); r.line = null;
          }
        }
      }

      else if (r.phase === 'ASCENT_TLI') {
        if (r.startMs == null) {
          r.startMs = nowMs; r.endMs = r.startMs + r.durationAscent * 1000;
          onEvent && onEvent({ type: 'launch-start', id: r.id, label: r.label, astronauts: r.astronauts, description: r.description, lat: r.lat, lon: r.lon });
        }
        const raw = (nowMs - r.startMs) / (r.endMs - r.startMs);
        const te  = smoother(raw);
        if (!r._shown) { r._shown = true; r.rocket.visible = true; }
        const pos = quadPoint(r.A, r.B, r.C, te);
        const tan = quadTangent(r.A, r.B, r.C, te);
        r.rocket.position.copy(pos);
        r.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), tan);

        const steps = Math.max(2, Math.floor(te * ARC_SEGS));
        for (let k = 0; k <= steps; k++) {
          const u = te * (k / steps);
          const p = quadPoint(r.A, r.B, r.C, u);
          const j = k*3; r.positions[j]=p.x; r.positions[j+1]=p.y; r.positions[j+2]=p.z;
        }
        r.line.geometry.setDrawRange(0, steps + 1);
        r.line.geometry.attributes.position.needsUpdate = true;

        if (raw >= 1) {
          const start = r.C.clone();
          const center = earth.getWorldPosition(new THREE.Vector3());
          const radial = start.clone().sub(center).normalize();
          const tEnd   = quadTangent(r.A, r.B, r.C, 1);
          const tangent = tEnd.clone().sub(radial.clone().multiplyScalar(tEnd.dot(radial))).normalize();

          const moonNow = r.moonPositionFn?.();
          const end  = moonNow ? moonNow.clone() : start.clone().add(tangent.clone().multiplyScalar(8.0));
          const C1   = start.clone().add(radial.clone().multiplyScalar(2.0)).add(tangent.clone().multiplyScalar(3.0));
          const toM  = end.clone().sub(start);
          const side = toM.clone().cross(radial).setLength(1.5);
          const C2   = start.clone().add(toM.clone().multiplyScalar(0.75)).add(side);

          const transferMs = r.transferSeconds * 1000;
          r.tli = { start, C1, C2, end, t0: nowMs, transferMs };
          r.lockQuat = r.rocket.quaternion.clone();
          r.phase = 'TLI';
          if (r.line) r.line.material.opacity = 0.75;
        }
      }

      else if (r.phase === 'TLI' && r.tli) {
        const moonNow = r.moonPositionFn?.();
        if (moonNow) r.tli.end.copy(moonNow);

        const t = clamp01((nowMs - r.tli.t0) / r.tli.transferMs);
        const omt = 1 - t;

        const p = r.tli.start.clone().multiplyScalar(omt*omt*omt)
          .add(r.tli.C1.clone().multiplyScalar(3*omt*omt*t))
          .add(r.tli.C2.clone().multiplyScalar(3*omt*t*t))
          .add(r.tli.end.clone().multiplyScalar(t*t*t));

        const dp = r.tli.C1.clone().sub(r.tli.start).multiplyScalar(3*omt*omt)
          .add(r.tli.C2.clone().sub(r.tli.C1).multiplyScalar(6*omt*t))
          .add(r.tli.end.clone().sub(r.tli.C2).multiplyScalar(3*t*t)).normalize();

        r.rocket.position.copy(p);
        if (r.lockQuat) r.rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dp);

        const steps = Math.max(2, Math.floor(t * ARC_SEGS));
        for (let k = 0; k <= steps; k++) {
          const u = t * (k / steps);
          const omu = 1 - u;
          const pp = r.tli.start.clone().multiplyScalar(omu*omu*omu)
            .add(r.tli.C1.clone().multiplyScalar(3*omu*omu*u))
            .add(r.tli.C2.clone().multiplyScalar(3*omu*u*u))
            .add(r.tli.end.clone().multiplyScalar(u*u*u));
          const j = k*3; r.positions[j]=pp.x; r.positions[j+1]=pp.y; r.positions[j+2]=pp.z;
        }
        r.line.geometry.setDrawRange(0, steps + 1);
        r.line.geometry.attributes.position.needsUpdate = true;

        if (t >= 1) {
          const moonP = r.moonPositionFn?.() ?? r.tli.end.clone();
          const center = moonP.clone();

          const R = 0.9;
          let up = new THREE.Vector3(0, 1, 0);
          let radial = new THREE.Vector3(1, 0, 0);
          if (Math.abs(up.dot(radial)) > 0.95) radial.set(0, 0, 1);
          const u = up.clone().cross(radial).normalize();
          const v = radial.clone().cross(u).normalize();
          const periodSec = 10.0;
          const omega = (2*Math.PI) / periodSec;

          r.follow = {
            mode: 'LUNAR_ORBIT',
            center, u, v, R,
            theta: 0,
            omega,
            t0: nowMs,
            t1: nowMs + (r.followSeconds ?? 5) * 1000,
          };
          r.phase = 'FOLLOW_MOON';
        }
      }

      else if (r.phase === 'FOLLOW_MOON' && r.follow) {
        const moonNow = r.moonPositionFn?.();
        if (moonNow) r.follow.center.copy(moonNow);

        r.follow.theta += r.follow.omega * dt;
        const c = Math.cos(r.follow.theta), s = Math.sin(r.follow.theta);
        const pos = r.follow.center.clone()
          .add(r.follow.u.clone().multiplyScalar(c * r.follow.R))
          .add(r.follow.v.clone().multiplyScalar(s * r.follow.R));
        r.rocket.position.copy(pos);
        if (r.lockQuat) r.rocket.quaternion.copy(r.lockQuat);

        if (r.line) {
          r.line.material.opacity *= 0.985;
          if (r.line.material.opacity < 0.05) {
            scene.remove(r.line); r.line.geometry.dispose(); r.line.material.dispose(); r.line = null;
          }
        }

        if (nowMs >= r.follow.t1) {
          deleteById(r.id);
          continue;
        }
      }
    }
  }

  /* ---------- API ---------- */
  return {
    launchFromLatLon,
    launchToMoonFromLatLon,
    update,
    deleteById,
    deleteAll,
    scheduleDelete,
    scheduleDeleteAll,
    setOrbitSlowdown:  (f) => { orbitSlowdown  = Math.max(0.1, Number(f) || 1); },
    setAscentSlowdown: (f) => { ascentSlowdown = Math.max(0.1, Number(f) || 1); },
  };
}
