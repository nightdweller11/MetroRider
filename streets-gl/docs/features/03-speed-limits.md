# F3 — Speed Limits, Overspeed & the Route Ribbon

> STATUS: BUILT (limits, HUD chip, intervention, score penalty) — track-side
> boards and the route ribbon are still to come. Originally: PLANNED · Depends on: F6 for mode-based base limits (falls back to a
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


---

## 4. What shipped (2026-08-13)

`SpeedProfile.ts` (pure, 24 unit tests) + `SpeedLimitSystem` + HUD chip +
overspeed intervention + a score penalty.

Limits come from the track's own geometry: curve radius through each spline
triple, `v = sqrt(a·r)` at 0.9 m/s² lateral comfort, clamped to the line
maximum and a 25 km/h floor. On the Israel map that yields **181 segments from
25 to 195 km/h**, which is exactly the shape you would expect — slow through
city curves, fast on the straight suburban run.

### Three things the tests and the live drive forced

1. **A look-ahead window is the wrong unit.** Braking 50 → 11 m/s at 1 m/s²
   takes about a kilometre, so "minimum limit over the next N points" cannot
   put the number in front of the driver in time. The profile is now
   back-propagated (`v(i) = sqrt(v(i+1)² + 2·a·ds)`), so limits ramp down on
   the approach and are in force at the curve. A test asserts the invariant
   directly: wherever the limit drops, the segment before it is long enough to
   brake in.
2. **Round DOWN, and inside the walk.** Rounding to 5 km/h steps afterwards
   re-broke that invariant (flooring the slower value widens the gap). Rounding
   happens inside the back-propagation now.
3. **Curvature must be measured in metres.** The spline stores `[lng, lat]`
   degrees; a 200 m bend spans ~0.002° and reads as a straight line. The first
   live run posted the line maximum across all 87 km — one flat segment.
4. **An intervention must cut traction.** Subtracting a braking force lost to
   the throttle (1.5 m/s² against 5), so the train sat at 198 km/h in an 85
   zone. It now holds a ceiling the throttle cannot push through: measured, the
   train pegs at 1.25× the limit and no further with the throttle held down.

### Not yet

Track-side speed boards and the route ribbon (dots, train marker, limit ticks,
loop ring). The profile already exposes everything they need
(`getSegments()`), so they are UI work, not model work.


---

## 5. Operator corrections (2026-08-13, same day)

Three, all correct, all shipped in v1.1.13:

1. **The limit must not drive the train.** v1.1.12 cut traction above 125% of
   the limit. That takes the decision away from the player, which is the
   opposite of what a speed limit is for. Nothing touches the train now — the
   sign informs, the driver chooses, and ignoring it costs points. That IS the
   enforcement.
2. **The numbers were too low.** Two causes, both real:
   - the lateral acceleration was a flat-track comfort figure (0.9 m/s²), but
     real track is CANTED. With ~150 mm cant plus ~100 mm cant deficiency over
     1.5 m between rail centres the usable figure is ~1.6 m/s².
   - curvature was measured between ADJACENT spline points, 20-60 m apart,
     where position noise fakes tight curves on nearly straight track. It is
     now fitted over a ~100 m baseline.
   Together: median limit on the Israel map went 45 → **90 km/h**, segments
   181 → 100, and a test pins the output against real practice (300 m ≈ 80,
   600 m ≈ 110, 1000 m ≈ 145 km/h, ±20%).
3. **A sign reads better than a number.** The HUD shows a white disc with a red
   ring, the way a lineside sign does; it turns amber near the limit and glows
   red over it, with the next change beside it (`▼ 70 in 21 m`).

Scoring now separates the two cases: a little over is 2 points a second, more
than 25% over is 5 — the difference between running late and taking a curve too
fast.


---

## 6. Signage (v1.1.14)

A red-ringed disc is a ROAD sign. Most railways do not use it, and the ones
that do use it differently — so the sign is now resolved from the country the
map is in and the mode being driven (`SignStyle.ts`, 15 unit tests):

| Where / what | Sign |
|---|---|
| Germany, Austria, NL, BE, DK, CZ, PL… | white square, black numeral, **tens of km/h** (Lf 7: 120 km/h reads "12"), yellow triangle for the advance warning (Lf 6) |
| France | white **disc**, black numeral, tens of km/h (TIV fixe), yellow triangle for the advance (TIV à distance) |
| Britain, Ireland | white **plate**, black numerals, **mph** |
| USA, Canada | white speed board, **mph** |
| Israel, Spain, Italy, most km/h railways | white square, the **full** number in km/h |
| **Tram** (any country) | road-style disc with the red ring — trams share the street, so they are signed like it |
| **Metro / light rail** | plain staff board, no road iconography |

Country comes from the map's own coordinates (a bounding-box table, checked
smallest-box-first so Amsterdam resolves to NL and not DE — no geocoder, no
key, no data file). Mode is inferred from station spacing until F6 threads
MetroDreamin's own `mode` through the importer: under 600 m between stops is a
tram, under 1.8 km a metro, above that heavy rail.

**Lineside boards** (`SignGeometry.ts` + `TrackSignRenderingSystem`) stand at
the start of each limit, on the driver's side, turned to face an approaching
train. Numerals are seven-segment quads rather than a texture, because the
train material carries vertex colours only — which keeps the boards in the same
draw path as everything else. Geometry is baked at the origin and positioned by
the mesh transform, like the stations, so they do not wobble.
