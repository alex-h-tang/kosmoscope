# kosmoscope

An interactive, real-time globe for visualizing influential space launches. Watch rockets lift off from historical pads, auto-annotated with astronauts and mission info; drop country flags at each launch site; jump to the next scheduled launch; and follow trans-lunar injections to the Moon.

# Features

CSV-driven launches — simple CSV powers the timeline (label, date, lat, lon, astronauts, description, duration).

“Next Launch” — jump the simulation clock to the next queued mission.

Auto HUD — launch info appears automatically at T-0 and hides when the vehicle is removed.

Clickable flags — one flag per unique launch site (de-duped by rounded lat/lon), with country-specific icons:

USA (Cape/Vandenberg), China (Wenchang/Jiuquan/etc.), French Guiana (Kourou), plus a generic fallback.

LEO + Moon — low-Earth orbit arcs and a trans-lunar injection (TLI) coast with a small lunar capture/follow segment.

Time controls — scrub, play/pause, slow-mo during ascent, and adjustable rates.

Lightweight stack — frontend is plain Three.js + ES modules; a Python backend folder is included for future services/integrations. 
GitHub

# Repo structure
```
kosmoscope/
├─ frontend/          # Browser app (Three.js, ES modules)
│  ├─ public/         # Static assets (flags, textures, audio, CSV)
│  ├─ src/
│  │  ├─ app.js       # Entry; UI + time controls + queue + flags + HUD
│  │  ├─ rockets.js   # Launch planner, ascent/LEO/TLI, lifecycle events
│  │  ├─ interactivity.js  # HUD utilities (auto show/hide)
│  │  ├─ markers.js   # Flag billboards on the globe
│  │  ├─ scene.js     # Scene/camera/lighting/earth
│  │  └─ astro.js     # UTC→sidereal helpers for Earth rotation, Moon pos
│  └─ index.html
├─ backend/           # Python service (optional; future data sources)
└─ README.md
```

# How to run

```
git clone

cd frontend

npm install

npm run dev

```

