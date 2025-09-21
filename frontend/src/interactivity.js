// interactivity.js
import * as THREE from 'three';

/* ===========================
   Picking (hover outline + click info)
   =========================== */
export class PickManager {
  constructor(renderer, camera, showInfo, hideInfo) {
    this.renderer = renderer;
    this.camera = camera;
    this.showInfo = showInfo;
    this.hideInfo = hideInfo;

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.pickables = [];
    this._pickableIds = new Set();  // prevent duplicates
    this._hovered = null;

    this.onMove = this.onMove.bind(this);
    this.onClick = this.onClick.bind(this);

    renderer.domElement.addEventListener('pointermove', this.onMove, { passive: true });
    renderer.domElement.addEventListener('click', this.onClick);
  }

  register(group, meta) {
    group.userData.meta = meta;
    group.traverse((o) => {
      // Skip dynamic lines (trails) to avoid heavy raycasts
      if (!o.isMesh) return;
      if (this._pickableIds.has(o.id)) return;
      this._pickableIds.add(o.id);
      o.userData.pickParent = group;
      this.pickables.push(o);
    });
  }

  dispose() {
    this.renderer.domElement.removeEventListener('pointermove', this.onMove);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.pickables.length = 0;
    this._pickableIds.clear();
  }

  onMove(ev) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(this.pickables, false);
    const grp = hits.length ? (hits[0].object.userData.pickParent || null) : null;
    const k = grp?.userData?.meta?.kind;
    this.setHovered(grp && (k === 'flag' || k === 'rocket') ? grp : null);
  }

  onClick() {
    if (!this._hovered) { this.hideInfo(); return; }
    const m = this._hovered.userData.meta || {};
    const lat = m.lat != null ? `${m.lat.toFixed(4)}°` : '';
    const lon = m.lon != null ? `${m.lon.toFixed(4)}°` : '';
    const where = (lat && lon) ? ` • ${lat}, ${lon}` : '';
    const title = m.title || 'Launch Site';
    const subtitle = m.subtitle ? ` — ${m.subtitle}` : '';
    this.showInfo(`${title}${subtitle}${where}`);
  }

  setHovered(grp) {
    if (this._hovered === grp) return;
    if (this._hovered?.userData?.outline) this._hovered.userData.outline.visible = false;
    this._hovered = grp || null;
    if (this._hovered?.userData?.outline) this._hovered.userData.outline.visible = true;
    this.renderer.domElement.style.cursor = this._hovered ? 'pointer' : '';
  }
}

/* ===========================
   HUD: UTC (top-center) + Info (left-center)
   - Transparent background
   - Throttled UTC updates (1Hz)
   =========================== */
// interactivity.js
// interactivity.js
export function createHud() {
  const info = document.createElement('div');
  info.id = 'hud-info';
  info.style.cssText = `
    position:fixed; left:50%; bottom:16px; transform:translateX(-50%);
    background:transparent; color:#fff; padding:0; margin:0;
    font:600 16px/1.25 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
    z-index:9998; pointer-events:none; display:none; will-change: contents, opacity;
  `;
  document.body.appendChild(info);

  let hideTimer = null;
  let isSticky = false;

  function showInfo(text, { sticky = false, ttlMsAtSimRate3600 = 4000, simRate = 3600 } = {}) {
    isSticky = !!sticky;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    info.textContent = text ?? '';
    info.style.display = text ? 'block' : 'none';
    info.style.opacity = '1';

    // Only auto-hide if NOT sticky
    if (!isSticky && text) {
      const scale = Math.max(0.1, simRate / 3600);
      const ttlMs = Math.round(ttlMsAtSimRate3600 * scale);
      hideTimer = setTimeout(() => { hideInfo(); }, ttlMs);
    }
  }

  function hideInfo() {
    isSticky = false;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    info.style.opacity = '0';
    setTimeout(() => { if (!isSticky) info.style.display = 'none'; }, 200);
  }

  return { showInfo, hideInfo, el: info };
}

let __bgmSingleton = null;
export function initAutoplayMusicSafe(
  url,
  {
    volume = 0.25,
    loop = true,
    preload = 'metadata',
    crossOrigin = 'anonymous',
    unlockOnUserGesture = true,
    pauseWhenHidden = false
  } = {}
) {
  if (__bgmSingleton) return __bgmSingleton;

  const audio = new Audio();
  audio.src = url;
  audio.crossOrigin = crossOrigin;
  audio.preload = preload;
  audio.loop = loop;
  audio.volume = volume;
  audio.playsInline = true;
  audio.autoplay = true;

  const tryPlay = () => audio.play().catch(() => {});

  tryPlay();

  const unlock = () => {
    tryPlay().finally(() => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', onVisible);
    });
  };
  const onVisible = () => { if (document.visibilityState === 'visible') unlock(); };

  if (unlockOnUserGesture) {
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('visibilitychange', onVisible);
  }

  if (pauseWhenHidden) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { try { audio.pause(); } catch {} }
      else { tryPlay(); }
    });
  }

  audio.addEventListener('error', (e) => console.warn('[audio] warning:', e?.message || e), { once: true });
  __bgmSingleton = audio;
  return audio;
}

/* ===========================
   NEW: Play/Pause Button (upper-right)
   - White icon, clear background
   - SVG play/pause, accessible
   - Creates/controls a single <audio> element
   =========================== */
export function createAudioButton({
  src,
  volume = 0.25,
  loop = true,
  crossOrigin = 'anonymous',
  preload = 'metadata',
  title = 'Play/Pause'
} = {}) {
  // Singleton audio
  if (!__bgmSingleton) {
    const a = new Audio();
    a.src = src;
    a.crossOrigin = crossOrigin;
    a.preload = preload;
    a.loop = loop;
    a.volume = volume;
    a.playsInline = true;
    __bgmSingleton = a;
  }
  const audio = __bgmSingleton;

  // Button UI
  const btn = document.createElement('button');
  btn.setAttribute('type', 'button');
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('title', title);
  btn.style.cssText = `
    position:fixed; top:12px; right:12px;
    display:inline-flex; align-items:center; justify-content:center;
    width:38px; height:38px; border-radius:999px;
    background:rgba(0,0,0,0.15); backdrop-filter:saturate(150%) blur(2px);
    border:1px solid rgba(255,255,255,0.5);
    color:#fff; cursor:pointer; z-index:10000;
    transition:transform .12s ease, background .12s ease, border-color .12s ease, opacity .12s ease;
  `;
  btn.onmouseenter = () => { btn.style.background = 'rgba(255,255,255,0.18)'; btn.style.borderColor = 'rgba(255,255,255,0.8)'; };
  btn.onmouseleave = () => { btn.style.background = 'rgba(0,0,0,0.15)'; btn.style.borderColor = 'rgba(255,255,255,0.5)'; };
  btn.onmousedown  = () => { btn.style.transform = 'scale(0.96)'; };
  btn.onmouseup    = () => { btn.style.transform = 'scale(1)'; };

  // SVG icons
  const svgNS = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(svgNS, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '18');
  icon.setAttribute('height', '18');
  icon.style.cssText = 'display:block; fill:none; stroke:#fff; stroke-width:2;';

  // Paths for play / pause
  const playPath = document.createElementNS(svgNS, 'path');
  playPath.setAttribute('d', 'M8 5v14l11-7z');

  const pauseG = document.createElementNS(svgNS, 'g');
  const p1 = document.createElementNS(svgNS, 'rect');
  p1.setAttribute('x', '6'); p1.setAttribute('y', '5'); p1.setAttribute('width', '4'); p1.setAttribute('height', '14'); p1.setAttribute('rx', '1');
  const p2 = document.createElementNS(svgNS, 'rect');
  p2.setAttribute('x', '14'); p2.setAttribute('y', '5'); p2.setAttribute('width', '4'); p2.setAttribute('height', '14'); p2.setAttribute('rx', '1');
  pauseG.appendChild(p1); pauseG.appendChild(p2);

  icon.appendChild(playPath); // start with play
  btn.appendChild(icon);
  document.body.appendChild(btn);

  const setIconState = (isPlaying) => {
    btn.setAttribute('aria-pressed', String(isPlaying));
    icon.innerHTML = '';
    if (isPlaying) {
      icon.appendChild(pauseG);
    } else {
      icon.appendChild(playPath);
    }
  };

  // Keep visual state in sync with actual playback
  let desiredPlay = false;
  const syncStateFromAudio = () => setIconState(!audio.paused);
  audio.addEventListener('play',  syncStateFromAudio);
  audio.addEventListener('pause', syncStateFromAudio);

  // Toggle handler
  btn.addEventListener('click', async () => {
    try {
      if (audio.paused) {
        desiredPlay = true;
        await audio.play();
      } else {
        desiredPlay = false;
        audio.pause();
      }
    } catch (e) {
      console.warn('[audio] play/pause blocked:', e?.message || e);
      // If blocked, flip icon back to real state
      syncStateFromAudio();
    }
  });

  // Initialize icon to current state
  setIconState(!audio.paused);

  return { button: btn, audio };
}
