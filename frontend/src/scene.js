import * as THREE from 'three';
import { sunEci, moonEci, precessionMatrix, applyMat3, centuriesTT } from './astro.js';

export function createRenderer(canvas){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

export function createScene(renderer){
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 10000);
  camera.position.set(0,0,8);
  scene.add(camera);

  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 5);
  sun.position.set(10, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  sun.target.position.set(0, 0, 0);
  scene.add(sun.target);

  const texLoader = new THREE.TextureLoader();
  const earthMap = texLoader.load('/overlays/earth_day.png', t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  });

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(2, 128, 128),
    new THREE.MeshPhongMaterial({ map: earthMap })
  );
  earth.castShadow = true;
  earth.receiveShadow = true;
  earth.rotation.z = THREE.MathUtils.degToRad(23.4);
  scene.add(earth);

  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0xffe08a })
  );
  sunMesh.position.copy(sun.position);
  scene.add(sunMesh);

  const moonTex = texLoader.load('/overlays/moon.jpg', t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  });
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.54, 64, 64),
    new THREE.MeshPhongMaterial({ map: moonTex, bumpMap: moonTex, bumpScale: 0.025, specular: 0x111111, shininess: 5 })
  );
  moon.castShadow = true;
  moon.receiveShadow = true;
  scene.add(moon);

  function updateCelestials(T, eciToThree, AU_TO_UNITS){
    const P = precessionMatrix(T);
    const s = applyMat3(P, sunEci(T));
    const m = applyMat3(P, moonEci(T));
    const sunDir = eciToThree(s).normalize();
    const sunPos = sunDir.multiplyScalar(12);
    sun.position.copy(sunPos);
    sunMesh.position.copy(sunPos);
    sun.target.position.set(0,0,0);
    sun.target.updateMatrixWorld();

    const moonPos = eciToThree(m).multiplyScalar(AU_TO_UNITS);
    moon.position.copy(moonPos);
    moon.lookAt(0,0,0);
  }

  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  return { scene, camera, earth, sun, sunMesh, moon, texLoader, updateCelestials };
}
