# MetroRider — Full Conversation Log

> A browser-based 3D train simulator built from MetroDreamin' map data, using Mapbox + Three.js.

---

## User

I want to build a game that takes a MetroDreamin' map and turns it into a navigable, playable railway game where you can operate the trains. It can be in Roblox, it can be in Unity, it can be an in-browser game. I don't mind if the quality of the 3D game isn't perfect, but I would like it to feel like you're really riding the trains.

It would be cool to be able to import real world assets to create the landscape and the road system around it, to generate an environment that feels real and alive.

I am open to any engine, any architecture, any framework, any game engine.

I want something that AI tools know really well and can program and test automatically, and comprehensively.

---

## Claude

This is a fantastic project idea. Let me give you a strong, opinionated recommendation based on your priorities — especially the AI-programmability constraint, which narrows things down significantly.

### My Recommendation: Browser-based with Three.js + Mapbox

Here's why this wins over Unity/Roblox/Godot for your case:

**AI tools know web tech best.** JavaScript/TypeScript + Three.js has the deepest coverage in every AI coding tool (Cursor, Claude, Copilot). Unity C# is a distant second, and Roblox Lua is even further behind. Browser code is also instantly testable — no compile step, no editor to launch.

**Real-world environments are a solved problem in the browser.** Mapbox GL JS gives you 3D buildings, terrain, and road networks from OpenStreetMap — all keyed to real lat/lng coordinates, which is exactly what MetroDreamin' exports. Google Photorealistic 3D Tiles via CesiumJS is even more realistic (actual photogrammetry). Both integrate cleanly with Three.js.

**MetroDreamin' data is already web-native.** It stores maps as JSON with station lat/lng, line paths, and colors. No conversion layer needed — you parse it directly into your 3D scene.

Here's the architecture I'd propose:

- **Layer 1 — World** → Mapbox 3D terrain + buildings + roads (or Cesium for photorealistic)
- **Layer 2 — Rails** → Generated from MetroDreamin' line geometry, using Catmull-Rom splines for smooth curves
- **Layer 3 — Trains** → Simple GLTF models riding along spline paths, with physics for acceleration/braking
- **Layer 4 — Camera** → First-person cab view, third-person chase cam, and platform cam at stations
- **Layer 5 — Gameplay** → Throttle/brake controls, station stops, door open/close, passenger counts, schedule

The tech stack would be something like: **Vite + TypeScript + Three.js + Mapbox GL JS** (or **r3f** if you prefer React), with the game loop and train physics in vanilla TS.

### Clarifying Questions

Claude asked three questions:

1. Do you already have a MetroDreamin' map you'd like to use, or should I work with sample data?
2. For the real-world environment, what matters more? (Photorealistic vs Stylized/clean 3D vs Both)
3. What should I build first as a proof of concept?

---

## User

- Use sample data for now
- Stylized/clean 3D (Mapbox — free tier, OSM buildings, easier to customize)
- A full minimal prototype with both combined

---

## Claude

Built the first version: **MetroRider v1** — a single HTML file with:

- Mapbox 3D dark map with extruded buildings
- 3 sample metro lines (Red, Green, Blue) across Tel Aviv
- Catmull-Rom spline track generation from station coordinates
- Cab view / Chase cam / Overview camera modes
- Speed gauge, station detection, next-station HUD
- Keyboard controls: W/↑ accelerate, S/↓ brake, Space emergency stop, C camera, D doors, R reverse, 1-3 switch lines
- Requires a Mapbox access token (free tier)

### Sample Metro Data

```
Red Line: Petah Tikva Central → Em HaMoshavot → Kiryat Aryeh → Bnei Brak → Ramat Gan Diamond → Arlozorov → Dizengoff Center → Carlebach → Allenby → Neve Sha'anan → Jaffa Clock Tower → Bat Yam Central

Green Line: Tel Aviv University → Ramat Aviv → Basel Square → Habima → Rothschild → Florentin → Jaffa Port

Blue Line: Herzliya Marina → Tel Baruch Beach → Port of Tel Aviv → Gordon Beach → Frishman Beach → Jerusalem Beach
```

---

## User

I put in the wrong code, it has a script error and I can't do anything.

---

## Claude

Fixed error handling:

- **Bad token recovery** — if the token is invalid or auth fails, bounces back to the token screen with a clear error message
- **Token format check** — validates it starts with `pk.` before trying
- **15-second timeout** — if the map never loads, resets back automatically
- **Global error catch** — any uncaught JS error resets to the token screen
- **Enter key** support on the token input field

---

## User

```
Uncaught Error: Script error.
```

I still have errors — I put in the correct key now.

---

## Claude

Identified the root cause: the global error handler was too aggressive — catching normal internal Mapbox cross-origin errors (tile loads, etc.) and killing the game.

Fixes:

- Global error handler now **ignores** cross-origin `"Script error."` noise from Mapbox internals
- Added `crossorigin="anonymous"` to the Mapbox script tag
- Error handler only resets during init phase (`gameInitialized` flag), logs during gameplay
- Added `mapboxgl` existence check for sandbox/iframe environments

---

## User

*(Shared screenshot of the game working — dark 3D map of Tel Aviv with Red Line track, speed gauge at 16 KM/H, "Next Station: Em HaMoshavot 1178m ahead")*

This is what it looks like, it's cool, however, there's no actual train. It's just a dot. There's no train model at all.

---

## Claude

Built **MetroRider v2** — major upgrade with a full 3D train:

### Three.js Integration

Added Three.js rendered through Mapbox's custom WebGL layer API so the train model sits correctly in the 3D scene with the buildings.

### Train Model Details

- **3-car consist** — lead car, middle car, rear car
- **Each car includes:**
  - Colored body with metallic material
  - Roof with AC units
  - 6 glowing blue windows per side
  - 2 doors per side with door indicators
  - Undercarriage/bogie detail
  - Wheel cylinders
  - Line-color stripe along both sides
- **Lead car:** Headlights (emissive white spheres) + destination board
- **Middle car:** Pantograph (diamond-shaped arms + contact strip)
- **Rear car:** Red tail lights
- **Articulation:** Each car independently follows the spline, bending around curves
- **Dynamic recolor:** Train changes to match line color when switching lines
- **Head/tail swap:** Headlights and tail lights swap when reversing direction

### Camera Improvements

- Cab view positioned slightly ahead of the lead car for forward track visibility
- Chase cam offset behind the train for third-person view

### Tech Stack

- Mapbox GL JS v3.3.0 (3D buildings, terrain, sky)
- Three.js r128 (train model via custom WebGL layer)
- Catmull-Rom splines (track geometry)
- Single HTML file, zero build tools

---

## User

Export this whole conversation into an md file.

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Engine | Browser (Three.js + Mapbox) | Best AI tool coverage, instant testing, no compile step |
| 3D Environment | Mapbox GL JS dark style | Free tier, OSM 3D buildings, real lat/lng coordinates |
| Track Geometry | Catmull-Rom splines | Smooth curves between station points |
| Train Rendering | Three.js custom Mapbox layer | Sits correctly in the 3D scene with buildings |
| Data Format | MetroDreamin'-compatible JSON | Station lat/lng, line colors, station IDs |
| Distribution | Single HTML file | Zero dependencies, open in any browser |

## Files Produced

- `metrorider.html` — Full working prototype (v2 with 3D train)

## Next Steps Discussed

- Import real MetroDreamin' data (replace `METRO_DATA` object)
- GLTF train models for higher fidelity
- Sound design (Web Audio API — motor hum, door chimes, announcements)
- Passengers & schedule gameplay mechanics
- Photorealistic upgrade (Cesium + Google 3D Tiles)
