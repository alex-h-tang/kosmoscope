import * as THREE from 'three';

export function addSurfaceMarker(earth, latDeg, lonDeg, radiusUnits=2.0, color=0x00ff88){
  const r = radiusUnits * 1.002;
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const cosφ=Math.cos(lat), sinφ=Math.sin(lat), cosλ=Math.cos(lon), sinλ=Math.sin(lon);
  const x = r * cosφ * cosλ;
  const y = r * sinφ;
  const z = -r * cosφ * sinλ;
  const mark = new THREE.Mesh(new THREE.SphereGeometry(0.03,12,12), new THREE.MeshBasicMaterial({ color }));
  mark.position.set(x,y,z);
  earth.add(mark);
  return mark;
}

export async function addFlagMarker({
  earth, texLoader, renderer,
  latDeg, lonDeg, radiusUnits=2.0,
  imageUrl=null, flagSize=[0.16,0.10],
  poleColor=0xdedede, finialColor=0xd4af37, baseColor=0x222222,
  doubleSided=true, flipY=true, gapFromPole=0.015,
  poleHeight=0.28, poleRadiusTop=0.006, poleRadiusBottom=0.01,
  baseRadius=0.04, baseHeight=0.01, finialRadius=0.012,
  title='Launch Site', subtitle='',
  pickManager
}){
  const r = radiusUnits * 1.003;
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const cosφ=Math.cos(lat), sinφ=Math.sin(lat), cosλ=Math.cos(lon), sinλ=Math.sin(lon);
  const x = r * cosφ * cosλ, y = r * sinφ, z = -r * cosφ * sinλ;
  const n = new THREE.Vector3(x,y,z).normalize();

  const grp = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.2, roughness: 0.6 })
  );
  base.position.y = baseHeight * 0.5 - 0.001;
  grp.add(base);
  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(baseRadius*1.06, baseRadius*1.06, 0.004, 24),
    new THREE.MeshStandardMaterial({ color: baseColor, metalness: 0.3, roughness: 0.5 })
  );
  lip.position.y = baseHeight + 0.002;
  grp.add(lip);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(poleRadiusTop, poleRadiusBottom, poleHeight, 20),
    new THREE.MeshStandardMaterial({ color: poleColor, metalness: 0.1, roughness: 0.35 })
  );
  pole.position.y = baseHeight + poleHeight*0.5;
  grp.add(pole);

  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(finialRadius, 16, 12),
    new THREE.MeshStandardMaterial({ color: finialColor, metalness: 0.6, roughness: 0.25 })
  );
  finial.position.y = baseHeight + poleHeight + finialRadius*0.9;
  grp.add(finial);

  const [fw, fh] = flagSize;
  const flagGeo = new THREE.PlaneGeometry(fw, fh);
  const mat = imageUrl
    ? new THREE.MeshBasicMaterial({
        map: texLoader.load(imageUrl, t => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = renderer.capabilities.getMaxAnisotropy();
          t.flipY = flipY;
        }),
        transparent: true,
        side: doubleSided ? THREE.DoubleSide : THREE.FrontSide
      })
    : new THREE.MeshBasicMaterial({ color: 0xff0000, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  const flag = new THREE.Mesh(flagGeo, mat);
  flag.position.set(fw*0.5 + gapFromPole, baseHeight + poleHeight - fh*0.55, 0);
  grp.add(flag);

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(flagGeo),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
  );
  outline.position.copy(flag.position);
  outline.scale.set(1.05, 1.08, 1.05);
  outline.visible = false;
  grp.add(outline);

  grp.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), n);
  grp.position.set(x,y,z);

  const tNorth = new THREE.Vector3(-sinφ*cosλ, cosφ, sinφ*sinλ).normalize();
  const towardEquator = (latDeg >= 0 ? tNorth.clone().negate() : tNorth);
  const fwd = new THREE.Vector3(0,0,1).applyQuaternion(grp.quaternion);
  const cross = new THREE.Vector3().crossVectors(fwd, towardEquator);
  const dot = THREE.MathUtils.clamp(fwd.dot(towardEquator), -1, 1);
  const sign = Math.sign(cross.dot(n));
  const ang = Math.acos(dot) * (isNaN(sign) ? 1 : sign);
  grp.rotateY(ang);

  grp.userData.outline = outline;
  pickManager?.register(grp, { kind: 'flag', title, subtitle, lat: latDeg, lon: lonDeg });

  earth.add(grp);
  return grp;
}
