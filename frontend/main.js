import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- Renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Make background white
renderer.setClearColor(0xffffff, 1);
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
const ambient = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.3);
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
  // onLoad
  (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  },
  // onProgress
  undefined,
  // onError
  (err) => {
    console.error('Failed to load /textures/earth_day.jpg', err);
  }
);

const earthGeo = new THREE.SphereGeometry(2, 128, 128);
// Start with Phong + map; if texture fails, we’ll swap to Basic color in animate loop
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

// --- Moon (simple gray sphere) ---
const moonRadius = 0.54;          // relative to Earth radius=2
const moonDistance = 5.0;         // distance from Earth center (scene units)

const moonGeo = new THREE.SphereGeometry(moonRadius, 64, 64);
const moonMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
const moon = new THREE.Mesh(moonGeo, moonMat);
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

// ---------- Animate ----------
renderer.setAnimationLoop((tMs) => {
  const t = tMs * 0.001;

  // Earth slow spin
  earth.rotation.y += 0.01;

  // Moon orbit (one revolution ~15s)
  const orbitSpeed = (2 * Math.PI) / 15; // rad/sec
  moonPivot.rotation.y = t * orbitSpeed;

  // OPTIONAL: move the sun around the Earth for changing lighting
  const sunOrbitSpeed = (2 * Math.PI) / 60; // one minute per orbit
  const sunR = 12;                           // distance from Earth
  sun.position.set(Math.cos(t * sunOrbitSpeed) * sunR, 6, Math.sin(t * sunOrbitSpeed) * sunR);
  if (typeof sunMesh !== 'undefined') sunMesh.position.copy(sun.position);
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();

  controls.update();
  renderer.render(scene, camera);
});

