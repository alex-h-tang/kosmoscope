// audio.js
export async function initAutoplayMusic({
  src = '/audio/interstellar.mp3',
  volume = 0.35,
  loop = true
} = {}) {
  const el = document.createElement('audio');
  el.src = src;
  el.preload = 'auto';
  el.loop = loop;
  el.playsInline = true;               // iOS-friendly
  el.style.display = 'none';           // no UI
  el.crossOrigin = 'anonymous';        // if you ever host remotely with CORS
  document.body.appendChild(el);

  try {
    el.volume = Math.max(0, Math.min(1, volume));
    await el.play();                   // try direct (with sound)
    // success — nothing else to do
  } catch {
    // Fallback: muted autoplay (almost always allowed)
    try {
      el.muted = true;
      el.volume = Math.max(0, Math.min(1, volume));
      await el.play();                 // silent autoplay
      // Opportunistic unmute a bit later (works on some browsers / site policies)
      setTimeout(() => {
        try { el.muted = false; } catch {}
      }, 1500);
    } catch (e2) {
      // If even muted autoplay fails (rare), just leave it in the DOM silently
      // Browser will require user/site permission; no UI per your request.
      console.debug('Autoplay blocked; audio remains silent.', e2);
    }
  }

  return el; // in case you want to manage it later programmatically
}
