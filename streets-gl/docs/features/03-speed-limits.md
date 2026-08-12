# F3 — Speed Limits, Overspeed & the Route Ribbon

> STATUS: PLANNED · Depends on: F6 for mode-based base limits (falls back to a
> single base limit until F6 lands). Feeds F2 (overspeed affects run score).

## 1. Product definition

### Speed limits
- Every stretch of track has a limit derived from **curvature** (tight curve
  = slow) and the line's **mode** (tram 50 / metro 90 / rail 160 / HSR 300,
  from F6; until then: 160 base).
- HUD shows **current limit** and, when a lower limit approaches, a countdown
  chip: "80 → 60 in 400 m" (the TSW pattern — brake before the board, not at
  it).
- Track-side visual: small speed boards at limit-change points (simple quads
  with the number, placed like station meshes).

### Overspeed
- ≤10% over: HUD limit chip turns amber, score drains slowly (F2).
- >10% over for >3 s: red + warning chime + heavier score drain.
- >25% over: automatic **penalty brake** to the limit (never a fail screen —
  the train just brakes itself, kid-friendly), noted on the run card.

### Route ribbon (the driving-HUD navigator)
- A slim vertical ribbon at the screen edge: stations as dots (next station
  highlighted, passed ones dimmed), the train as a moving marker, upcoming
  limit changes as small ticks. Loop lines render the ribbon as a ring.
- Complements (not replaces) the full-map 🗺 overlay from v1.1.2.

## 2. Technical implementation plan

### Limit computation
- `src/app/game/data/SpeedProfile.ts`: from `TrackData.spline`, compute
  per-point curvature radius (circumradius of consecutive point triples on
  the meter-projected polyline), map radius→limit
  (`v = min(base, sqrt(a_lat × r))`, a_lat ≈ 1.2 m/s² comfort), then
  smooth + quantize to steps {30,50,60,80,90,120,160,200,300} and merge
  segments shorter than 150 m. Output: `SpeedProfile {dists[], limits[]}`
  built once per line in `TrainSystem.loadMap` (loop-aware wrap).
- Lookup helpers: `limitAt(dist)`, `nextChange(dist, direction)` — binary
  search like `getPositionAtDistance`.

### Enforcement + HUD
- `TrainPhysics.updateTrainPhysics` gains optional `speedProfile`:
  emergency clamp at >25% over (apply BRAKE_FORCE×2 until ≤limit).
  Overspeed state (none/amber/red + duration) computed in `TrainSystem`
  and exposed on a new `SpeedState` for HUD + F2 scoring hooks.
- HUD: limit chip + approach countdown in `GameUISystem` info panel;
  colors via existing styles.
- Speed boards: instanced quads with canvas-drawn number textures at
  `SpeedProfile` change points, placed/disposed with the line like station
  meshes in `TrainRenderingSystem`.

### Route ribbon
- `src/app/game/ui/RouteRibbon.ts` (DOM/SVG, not WebGL): built from
  `realStationDists` + `SpeedProfile`; updates marker position from
  `physicsState.trainDist` at 10 Hz; ring layout when `track.isLoop`.
  Collapsible on mobile (same pattern as the line list).

### Sizing
SpeedProfile + physics + HUD: 2–3 days. Boards: 1 day. Ribbon: 1–2 days.

## 3. Testing plan & validation

- **Unit**: curvature→limit mapping on synthetic geometries (straight line →
  base limit; 90° city corner → ≤60; gentle S-curves don't flap); segment
  merging; `limitAt/nextChange` incl. loop wrap; penalty-brake clamp in
  physics; overspeed state machine timings.
- **Browser (local)**: drive the Tel Aviv sample — assert HUD limit changes at
  known curves; force overspeed via teleport+full throttle → amber → red →
  auto-brake observed in `physicsState`; ribbon dots equal station count,
  marker advances, ring on the loop test map; screenshots of chip+ribbon.
- **Score integration**: overspeed drain visible in F2 run card detail.
- **Production validation**: Playwright drive on live, screenshot the limit
  chip + a speed board + the ribbon; no console errors; FPS unchanged
  (compare a 30 s profile run before/after — boards and ribbon must be
  free: DOM ribbon throttled, boards are static meshes).
