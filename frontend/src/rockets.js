// rockets.js — smooth ascent → (slow) orbit, nicer ship, timed deletion, ascent/orbit slowdown knobs
import * as THREE_NS from 'three';

export function installRocketModule({
  THREE = THREE_NS,
  scene,
  earth,
  orbitSlowdown = 3.0, // >1 = slower orbit
  ascentSlowdown = 1.0 // >1 = longer/slower ascent (global)
}) {
  const EARTH_R = 2.0;
  const ARC_SEGS = 140;

  const rockets = [];
  let prevSimMs = null;
  let nextId = 1;

  // timed deletion queue: [{ atMs, id: number|null }]
  const deleteQueue = [];

  /* ---------- math helpers ---------- */
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

  // Visual Kepler-ish period: T ∝ R^(3/2)
  function orbitPeriodGuess(R_units) {
    const R0 = 4.0, T0 = 5400; // ~ LEO 90min at ~2*EarthR units
    return T0 * Math.pow(Math.max(R_units, R0) / R0, 1.5);
  }

  function planAscent(frame, { orbitAlt, azimuthDeg }) {
    const { pad, up, north, east, center } = frame;
    const R_orbit = EARTH_R + orbitAlt;
    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const downrange = east.clone().multiplyScalar(Math.sin(az))
                          .add(north.clone().multiplyScalar(Math.cos(az)))
                          .normalize();

    // steeper loft → visible climb before pitch-over
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

  // nicer spaceship
  function createSpaceshipMesh({
    hullColor = 0xcfd4da,
    accentColor = 0xffb259,
    finColor = 0x8892a0,
    emissive = 0x111111,
  } = {}) {
    const g = new THREE.Group();

    const hull = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.06, 0.22, 8, 16),
      new THREE.MeshPhongMaterial({ color: hullColor, shininess: 40, emissive })
    );
    hull.rotation.x = Math.PI * 0.5; // +Y forward
    g.add(hull);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.10, 16),
      new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80, emissive })
    );
    nose.position.y = 0.20;
    hull.add(nose);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.065, 0.012, 10, 24),
      new THREE.MeshPhongMaterial({ color: accentColor, shininess: 60, emissive })
    );
    ring.rotation.x = Math.PI * 0.5;
    ring.position.y = 0.02;
    hull.add(ring);

    const finGeom = new THREE.BoxGeometry(0.02, 0.08, 0.10);
    const finMat  = new THREE.MeshPhongMaterial({ color: finColor, emissive });
    const finL = new THREE.Mesh(finGeom, finMat);
    const finR = new THREE.Mesh(finGeom, finMat);
    finL.position.set(-0.07, -0.02, 0.02);
    finR.position.set( 0.07, -0.02, 0.02);
    hull.add(finL); hull.add(finR);

    const bell = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.12, 16),
      new THREE.MeshPhongMaterial({ color: 0x333333, emissive: 0x090909, shininess: 5 })
    );
    bell.rotation.x = Math.PI;
    bell.position.y = -0.18;
    hull.add(bell);

    const plume = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.10, 12),
      new THREE.MeshBasicMaterial({ color: 0xffa533 })
    );
    plume.rotation.x = Math.PI;
    plume.position.y = -0.22;
    hull.add(plume);

    return g;
  }

  /* ---------- create / destroy ---------- */
  function destroyRecord(rec) {
    if (!rec) return;
    if (rec.rocket?.parent) rec.rocket.parent.remove(rec.rocket);
    if (rec.line)  { scene.remove(rec.line);  rec.line.geometry.dispose(); rec.line.material.dispose(); rec.line = null; }
    if (rec.ring)  { scene.remove(rec.ring);  rec.ring.geometry.dispose(); rec.ring.material.dispose(); rec.ring = null; }
    rec.rocket = null;
  }

  function deleteById(id) {
  const idx = rockets.findIndex(r => r.id === id);
  if (idx === -1) return false;
  const rec = rockets[idx];
  destroyRecord(rec);         // tear down meshes/materials safely
  rockets.splice(idx, 1);
  return true;
}
  function deleteAll() {
    for (const r of rockets) destroyRecord(r);
    rockets.length = 0;
  }

  // timed deletions (UTC ms)
  function scheduleDelete(atMs, id = null) {
  const t = Number(atMs);
  if (!isFinite(t)) {
    console.warn('[rockets] scheduleDelete: invalid time', atMs);
    return false;
  }
  if (id !== null && !rockets.some(r => r.id === id)) {
    console.warn('[rockets] scheduleDelete: no rocket with id', id);
    return false;
  }
  // de-dupe: don't push exact duplicates
  if (deleteQueue.some(job => job.atMs === t && job.id === id)) return true;

  deleteQueue.push({ atMs: t, id });
  deleteQueue.sort((a, b) => a.atMs - b.atMs);
  return true;
}

  /* ---------- public: launch ---------- */
  function launchFromLatLon(latDeg, lonDeg, {
    orbitAlt = 0.8,
    azimuthDeg = 90,
    durationAscent = 200,
    color = 0xff9955,
    label = 'Launch',
    orbitPeriodSec = null,   // override orbit period
    ascentSpeedScale = 1.0,  // per-launch ascent slowdown (>1 slower)
  } = {}) {
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
      id,
      label, color,
      phase: 'ASCENT',
      A, B, C, center,
      line, positions, rocket,
      startMs: null,
      endMs: null,
      durationAscent: effDuration,
      orbit: null, ring: null, orbitPeriodSec,
      lockQuat: null
    });
    return id;
  }

  /* ---------- update ---------- */
  function update(dateUTC) {
    const nowMs = (dateUTC instanceof Date ? dateUTC : new Date()).getTime();
    const dt = prevSimMs == null ? 0 : (nowMs - prevSimMs) / 1000;
    prevSimMs = nowMs;

    // timed deletions
    while (deleteQueue.length && deleteQueue[0].atMs <= nowMs) {
      const job = deleteQueue.shift();
      if (job.id == null) deleteAll(); else deleteById(job.id);
    }

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];

      if (r.phase === 'ASCENT') {
        if (r.startMs == null) {
          r.startMs = nowMs;
          r.endMs   = r.startMs + r.durationAscent * 1000;
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
          const j = k * 3; r.positions[j] = p.x; r.positions[j+1] = p.y; r.positions[j+2] = p.z;
        }
        r.line.geometry.setDrawRange(0, steps + 1);
        r.line.geometry.attributes.position.needsUpdate = true;

        if (raw >= 1) {
          // smooth handoff at apex
          const center = r.center.clone();
          const rvec   = r.C.clone().sub(center);
          const R      = rvec.length();
          const radial = rvec.clone().divideScalar(R);

          const tEnd      = quadTangent(r.A, r.B, r.C, 1);
          let tangentProj = tEnd.clone().sub(radial.clone().multiplyScalar(tEnd.dot(radial)));
          if (tangentProj.lengthSq() < 1e-10) {
            const up = new THREE.Vector3(0,1,0).applyQuaternion(earth.getWorldQuaternion(new THREE.Quaternion()));
            tangentProj = up.clone().cross(radial);
          }
          const tangent = tangentProj.normalize();

          r.lockQuat = r.rocket.quaternion.clone(); // keep attitude steady in orbit

          const baseT = r.orbitPeriodSec ?? orbitPeriodGuess(R);
          const omega = (2*Math.PI) / (baseT * orbitSlowdown);

          r.orbit = { center, R, radial, tangent, theta: 0, omega };
          r.ring  = createOrbitRing(center, radial, tangent, R, 0x888888, 128);
          r.phase = 'ORBIT';
          if (r.line) r.line.material.opacity = 0.55;
        }

      } else if (r.phase === 'ORBIT' && r.orbit) {
        r.orbit.theta += r.orbit.omega * dt;
        const c = Math.cos(r.orbit.theta), s = Math.sin(r.orbit.theta);

        const p = r.orbit.center.clone()
          .add(r.orbit.radial.clone().multiplyScalar(c * r.orbit.R))
          .add(r.orbit.tangent.clone().multiplyScalar(s * r.orbit.R));

        r.rocket.position.copy(p);

        // lock orientation in orbit
        if (r.lockQuat) r.rocket.quaternion.copy(r.lockQuat);

        // fade ascent trail
        if (r.line) {
          r.line.material.opacity *= 0.985;
          if (r.line.material.opacity < 0.05) {
            scene.remove(r.line); r.line.geometry.dispose(); r.line.material.dispose(); r.line = null;
          }
        }
      }
    }
  }

  /* ---------- API ---------- */
  return {
    launchFromLatLon,
    update,

    // deletion (immediate)
    deleteById,
    deleteAll,

    // timed deletion (UTC ms)
    scheduleDelete,

    // runtime knobs
    setOrbitSlowdown: (f) => { orbitSlowdown = Math.max(0.1, Number(f) || 1); },
    setAscentSlowdown: (f) => { ascentSlowdown = Math.max(0.1, Number(f) || 1); },
  };
}
