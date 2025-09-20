import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- Renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------- Scene & Camera ----------
const scene = new THREE.Scene();

// after: const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff); // pure white


const camera = new THREE.PerspectiveCamera(
  55, window.innerWidth / window.innerHeight, 0.1, 1e7
);
camera.position.set(0, 300, 900);
scene.add(camera);

// Controls: drag to rotate, scroll to zoom
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = true;
controls.minDistance = 200;
controls.maxDistance = 4000;

// ---------- Helpers (optional) ----------
// const axes = new THREE.AxesHelper(200); scene.add(axes);

// ---------- Textures ----------
const loader = new THREE.TextureLoader();
const texEarthDay     = loader.load('/earth_day.jpg');
const texEarthNormal  = loader.load('/earth_normal.jpg', t => { t.flipY = false; }, undefined, () => {});
const texEarthSpecular= loader.load('/earth_specular.jpg', t => { t.flipY = false; }, undefined, () => {});
const texMoon         = loader.load('/moon.jpg');
const texSun          = loader.load('/sun.jpg'); // optional

// ---------- Scales (not real km; just pleasing proportions) ----------
const R_EARTH = 200;
const R_MOON  = 54;
const EARTH_ROT_SPEED = 0.02;      // radians/frame (scaled)
const MOON_ORBIT_RADIUS = 600;     // “distance” to moon
const MOON_ORBIT_PERIOD = 27.3;    // “days”, we’ll scale in animation
const SUN_DISTANCE = 5000;         // placed far enough to give directional shadows

// ---------- Earth ----------
const earthGeo = new THREE.SphereGeometry(R_EARTH, 128, 128);
const earthMat = new THREE.MeshPhongMaterial({
  map: texEarthDay,
  normalMap: texEarthNormal || null,
  specularMap: texEarthSpecular || null,
  specular: new THREE.Color(0x333333),
  shininess: 10
});
const earth = new THREE.Mesh(earthGeo, earthMat);
earth.castShadow = true;
earth.receiveShadow = true;
scene.add(earth);

// Tilt Earth ~23.4° around Z to mimic axial tilt (visual flair)
earth.rotation.z = THREE.MathUtils.degToRad(23.4);

// ---------- Moon (grouped so it orbits Earth) ----------
const moonGeo = new THREE.SphereGeometry(R_MOON, 64, 64);
const moonMat = new THREE.MeshPhongMaterial({ map: texMoon });
const moon = new THREE.Mesh(moonGeo, moonMat);
moon.castShadow = true;
moon.receiveShadow = true;

const moonPivot = new THREE.Object3D();
scene.add(moonPivot);
moonPivot.add(moon);
moon.position.set(MOON_ORBIT_RADIUS, 0, 0); // starting position on x-axis

// ---------- Sun (light + optional visible sphere) ----------
const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 12000;
sunLight.shadow.camera.left   = -2000;
sunLight.shadow.camera.right  =  2000;
sunLight.shadow.camera.top    =  2000;
sunLight.shadow.camera.bottom = -2000;

sunLight.position.set(SUN_DISTANCE, 1200, 0);
sunLight.target = earth; // light points at Earth
scene.add(sunLight);
scene.add(sunLight.target);

// Visible sun disk (purely decorative)
const sunGeo = new THREE.SphereGeometry(180, 64, 64);
const sunMat = new THREE.MeshBasicMaterial(
  texSun ? { map: texSun } : { color: 0xfff2a8 }
);
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
sunMesh.position.copy(sunLight.position);
scene.add(sunMesh);

// Subtle ambient light so shaded side isn’t pitch black
scene.add(new THREE.AmbientLight(0x11131a, 0.5));

// ---------- Resize ----------
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

// ---------- Animation loop ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const t = clock.getElapsedTime();

  // Spin Earth (roughly 1 “day” per 10s screen time)
  earth.rotation.y += EARTH_ROT_SPEED * 0.6;

  // Orbit Moon: full orbit every ~15s (tune as you like)
  const orbitSpeed = (2 * Math.PI) / 15; // radians per second
  moonPivot.rotation.y = t * orbitSpeed;

  // Optionally: rotate the sun around for day/night changes
  const sunOrbitSpeed = (2 * Math.PI) / 60; // 1 min per full orbit
  const sx = Math.cos(t * sunOrbitSpeed) * SUN_DISTANCE;
  const sz = Math.sin(t * sunOrbitSpeed) * SUN_DISTANCE;
  sunLight.position.set(sx, 1200, sz);
  sunMesh.position.copy(sunLight.position);
  sunLight.target.updateMatrixWorld();

  controls.update();
  renderer.render(scene, camera);
}

animate();
