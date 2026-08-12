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
