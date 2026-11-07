# F7 — AI Traffic & Signals (other trains, block signals, ambient sky & roads)

> STATUS: PLANNED · Depends on: F6 (vehicle classes for AI consists).
> The single biggest "the world is alive" multiplier. All AI is local
> simulation — no multiplayer of any kind.

## 1. Product definition

### AI trains (phase 1)
- The OTHER lines of the map run scheduled AI services: trains depart
  termini every N minutes, stop at stations (dwell), reverse at the ends —
  driven by the same physics/track code as the player.
- You SEE them: passing an oncoming train at speed, watching one leave as
  you pull in. Densities: Off / Light (1 per line) / Normal (schedule-based,
  cap ~8 total) in settings — the cap protects low-end machines (each AI
  consist ≈ one more player train render-wise).
- On YOUR line too (phase 1.5): an AI train ahead/behind on the same track —
  which requires signals to be meaningful.

### Block signals (phase 2)
- The line is divided into blocks (~station-to-station, subdivided on long
  gaps). Track-side signal posts show red (block occupied) / yellow (next
  block occupied) / green.
- Passing a red ("SPAD") triggers the penalty brake (same mechanism as F3
  overspeed — never a fail screen) and a run-card note. Approaching yellow
  expects ≤40.
- AI trains obey signals too — following a slow AI train teaches headway
  naturally.

### Ambient life (phase 3, cheap versions)
- **Sky**: re-enable the dormant streets-gl aircraft system (models ship in
  the repo, loading is filtered out today) as ambient flights on great-circle
  paths — pure decoration, far away, few draw calls.
- **Roads**: a handful of ambient cars following road polylines near the
  camera (spawn/despawn, no intersection logic v1). Strictly capped
  (≤20 instances); off in low tier.

## 2. Technical implementation plan

### AI trains
- `src/app/game/ai/AiTrainSystem.ts`: each AI service =
  `{lineIdx, physicsState, consist, schedule}` reusing `TrainPhysics.
  updateTrainPhysics` + `getPositionAtDistance` (already pure functions) and
  a simple driver policy: accelerate to limit (F3 profile), brake to stop at
  next station (braking distance = v²/2b), dwell, continue; reverse at ends
  (wrap on loops).
- Rendering: generalize `TrainRenderingSystem.buildCarMeshes` into a
  `ConsistRenderer` usable N times (player consist = instance 0). AI
  consists use mode default consists (F6) capped at 3 cars. Frustum-cull
  whole consists; skip terrain sampling when off-screen.
- Player/AI never share a line in phase 1 (no interaction needed).

### Signals
- `src/app/game/ai/BlockSystem.ts`: blocks from station dists (split >2.5 km
  gaps); occupancy map per line updated from all train positions (player +
  AI); signal aspect per block boundary. Post meshes = small canvas-lit
  quads placed like speed boards (F3).
- Same-line AI (phase 1.5): AI driver policy consumes aspects (yellow →
  brake to 40, red → stop at post). Player red-pass → penalty brake +
  `RunScorer` note.
- Dispatch spacing: AI departures held until 2 clear blocks ahead.

### Ambient sky & roads
- Aircraft: remove the `aircraft*` filter in `ResourceLoader.addFromJSON`
  behind a setting (`airTraffic` — the schema stub exists, commented out);
  resurrect `VehicleSystem` with synthetic circling routes (the original live
  air-traffic feed is gone — generate 2–3 paths around the map centroid).
  **Built (wave 1, agent C) — see "Ambient aircraft: as built" below.**
- Cars: `AmbientCarSystem` — nearest road polylines from the tile vector
  data (roads exist in worker output; expose a light `roadSegments` list per
  tile), spawn box around camera, constant-speed follow, instanced rendering
  (reuse instancing path). Hard caps + tier gating.

### Sizing
AI trains: 4–5 days. Signals + same-line: 3–4 days. Aircraft: 1–2 days.
Cars: 3 days (road data plumbing is most of it).

## 3. Testing plan & validation

- **Unit**: AI driver policy (stops within ±5 m at stations from any speed;
  respects limits; dwell; terminus reversal; loop wrap); block occupancy +
  aspect derivation (occupied/next-occupied/clear, boundaries, loop blocks);
  dispatch spacing; SPAD detection.
- **Browser (local)**: enable Normal density on the Israel map — AI trains
  visible on other lines (screenshot of a passing train), count ≤ cap,
  FPS delta < 10% (profile run with/without AI); signals change aspect as an
  AI train passes (timelapse screenshots); deliberately SPAD → penalty brake
  fires + run-card note.
- **Perf gate**: 4× throttle profile with Normal AI must stay ≥ 85% of the
  no-AI fps; otherwise density auto-reduces via the F-governor tier (AI
  density becomes a governed setting rung).
- **Production validation**: Playwright on live — AI visible, signals render,
  screenshots; the auto-quality governor unaffected (no down-spiral with AI
  on: re-run the fast-machine governor test).

## Ambient aircraft: as built (wave 1)

**What the player gets.** Six aeroplanes in the sky near wherever they are,
on by default, under Settings → Aeroplanes (On/Off; Off empties the sky at
once). Three cruise at 8.2–11.6 km at 800–950 km/h (B777 / A321 / ERJ
models). Three are low — 250–500 m at the middle of their pass, climbing out
or coming down on a three-degree path (floor 200 m), 250–330 km/h, never a
wide-body — and each low pass is laid **across the player's forward view**,
centred 2.5 km ahead, crossing the line of sight at 40–140°, low enough to
cross the cab's view (which tops out about 15° up — measured) rather than
above it. No real airports:
generated traffic, deterministic per flight and pass
(`src/app/game/data/SkyTraffic.ts`, fed to the existing interpolating
`VehicleSystem`).

**Why the previous attempt (2.47.0) "drew nothing".** It was not the render
path. Measured with each part's `mesh.draw` wrapped and `gl.getError` read
(`?telemetry=1`, scratch probes): every part's mesh is built by
`RenderSystem`'s scene walk (the parts are children of the wrapper — ready
with no help from `GBufferPass`), `drawElementsInstanced` runs once per part
type per frame with the right instance count and no GL error, and an
aeroplane pinned 500 m in front of the cab camera renders as a clear airliner
(on/off pixel diff: 713 px changed, all in the pinned spots). What made the
sky look empty:

1. **Sampling.** `VehicleSystem` draws every aircraft `AircraftRollbackTime`
   (20 s) behind the clock — built to smooth the old live feed. The generated
   samples began at "now", so the draw time was always before the first
   sample and every aircraft sat parked on its last one, jumping a whole
   interval (2.5 km at cruise) each update. Samples now span rollback-time
   to two intervals ahead.
2. **Placement.** The 2.47.0 pin ("900 m ahead at 320 m") was 900 m along the
   *horizontal* while the chase camera looks ~20° down — above the top of the
   frame. Low passes laid at random around the player crossed the cab's view
   4% of the time; at boot they were anchored at the map's start view,
   ~20 km from the first station.

So the WIP's `GBufferPass` `updateMesh` "fix" was redundant and is not
shipped. The five upstream switches stay on and `aircraftAreDrawn.test.ts`
guards each of them plus the behaviour (tracked → in the per-part instance
buffers near the player → moving smoothly between updates → continuing
across an update → gone when switched off).

**Passes.** A pass is fixed to the ground once laid (an aeroplane that slid
with the train would look tethered to it). Every layout is a new aircraft id
— the vehicle system interpolates per id, and a pass re-laid under the same
id was drawn sweeping to its new track at 991–1104 m/s. A camera jump
(> 3 km between updates: station jump, boot) re-lays the whole sky. A pass
the player has driven away from ends only once the aeroplane is far off
(> 0.7 × the half-pass); nothing is moved mid-pass.

**Measured** (local production bundle, SwiftShader, 1280×800, parked in the
cab at Hod HaSharon, Israel Railways map):

| | Aeroplanes on | Off |
|---|---|---|
| Draw calls / frame | 130 | 126 (+3.2%) |
| Buffer uploads / frame | 144.9 | 136.8 (+8) |
| VehicleSystem CPU / frame | 0.02–0.05 ms | ~0 |
| Frame time (SwiftShader, ~1 fps) | 870 / 833 ms | 833 / 833 ms (noise) |
| Triangles added | ~9k (1.3–1.9k per aircraft) | — |
| Max ground speed of any aircraft id | 250 m/s (no jumps) | — |
| Share of time an aeroplane is in the cab view (final layout, midday, 150 s) | 55% | was 4% (random layout) |

**What it looks like** (midday, cab): within ~1.5 km a low aeroplane is
plainly an aeroplane; at 2–3 km it is a faint 10–15 px cross in the haze
(aerial perspective), much as a real one is; cruise traffic is a speck high
up and mostly above the cab's view. Models are real size (A321 44.7 m, B777
74 m) and their on-screen size checks out against the projection.

Aircraft no longer render into the near shadow cascades (their shadow lands
far outside them; it was 8 of the 12 draw calls air traffic first added).
SwiftShader frame time cannot resolve a 10% gate at ~1 fps; the work counts
are the evidence (+4 instanced draws, ~9k triangles, ~0.03 ms CPU). A
hardware-GPU `gpuFrameMs` A/B is still worth one run on a real machine.

**Not done.** Real airports (take-off/landing near one in range). Night:
the aircraft are unlit silhouettes, so after dark one is visible only within
about a kilometre — real aircraft are seen by their lights, and at a few
kilometres a wingtip is sub-pixel, so nav/strobe lights need point sprites,
not texture glow. Per-instance motion vectors (TAA treats each aeroplane as
static — invisible at these distances). Models are at true metres while the
world is Mercator-stretched (×1.18 at Tel Aviv), so aircraft read slightly
small against buildings.
