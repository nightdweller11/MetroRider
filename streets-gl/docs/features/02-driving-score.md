# F2 — Driving Score: Stop Rating, Run Summary, Badges, Stop Replay

> STATUS: BUILT — core scoring + cards + board (v1.1.8). Stop card confirmed
> only through unit tests and the run card; a human drive is still wanted to
> sign it off in-game (see §4). Depends on: F1 (persistence; playable without it as
> session-only). The core game loop: drive precisely → get scored.
> Scope guard: badges are cosmetic records — nothing is gated or unlocked.

## 1. Product definition

### Stop rating (the heart of it)
Every station approach becomes a small challenge:
- A **stop marker** appears on the platform (a target bar across the track at
  the platform midpoint). The HUD shows distance-to-marker as you approach.
- On coming to a stop within the station zone, a **stop card** pops for ~3 s:
  - **Precision**: |stop point − marker| → Perfect (≤2 m) / Great (≤5 m) /
    Good (≤12 m) / Overshot–Undershot (>12 m or passed the marker).
  - **Smoothness**: peak deceleration in the last 120 m → Smooth / Firm /
    Rough (kids feel this as "did the passengers fall over").
  - **Doors**: opened only at full stop, closed before moving → OK / flag.
  - Points: precision 0–100, smoothness 0–50, doors 0–25.
- Skipping a station (passing through > station stop zone speed) simply scores
  0 for that stop — no punishment screens.

### Run summary
At the terminus (or on leaving the game), a **run card**: per-stop mini-list,
total score, best label achieved, and "Personal best!" when applicable.
Score posts to F1 (`kind: 'run-score'`, detail = per-stop breakdown).

### Badges (records, not progression)
A dozen fun records stored per profile, surfaced on the run card + splash:
"First Perfect stop", "5 Perfect stops in one run", "Full line, all stops",
"Drove a loop line 3× around", "Night owl (drove at 03:00)". No numbers to
grind, nothing locked behind them.

### Stop replay & own-ghost (single-player, optional phase 2)
- After a Perfect stop: "▶ watch replay" on the stop card — 15 s orbit-camera
  replay of the approach.
- **Race yourself**: on a line where you have a saved run, a translucent
  ghost train of your best run drives alongside. Purely local/single-player.

## 2. Technical implementation plan

### Data & detection (mostly exists)
- `StationManager` already computes nearest station distance + arrival.
  Extend `StationState` with `stopZone` info; a stop marker offset =
  `realStationDists[i]` (the marker IS the station point; visual bar drawn by
  `TrainRenderingSystem.placeProceduralStations` sibling code).
- New `src/app/game/scoring/StopScorer.ts` (pure logic, unit-testable):
  state machine per approach — `approaching(≤300 m) → stopped|passed` —
  consuming `{trainDist, speed, decel, doorsOpen}` per frame; emits
  `StopResult {stationIdx, precisionM, peakDecel, doorsOk, points}`.
  Peak decel from `TrainPhysics` speed deltas (already per-frame).
- `RunScorer.ts` aggregates `StopResult`s into `RunResult`; reset on
  `selectLine`/`loadMap`; finalize on terminus arrival (non-loop) or
  N-stations-visited (loop lines: a "lap" = every station visited once).

### UI
- `src/app/game/scoring/ScoreUI.ts` — stop card + run card, same visual
  language as the release splash (dark card, emoji verdicts 🎯 for Perfect).
  Marker bar: a colored quad at the station platform point (reuse
  station-mesh placement transform); HUD distance readout goes in the
  existing info panel ("MARK 34 m").
- Badges: `BadgeService.ts` evaluating a static rule list over
  `StopResult/RunResult` + clock; persisted via F1 `profile_data['badges']`
  (guest: localStorage).

### Replay/ghost (phase 2)
- `RunRecorder.ts`: sample `{t, trainDist, speed}` at 5 Hz into a ring
  (a full run ≈ few KB). Replay = drive a second consist's `carMeshes` along
  recorded dists with the orbit camera; ghost = same at 50% opacity material
  (TrainMeshObject already supports per-mesh materials via
  TrainMaterialContainer — add a ghost uniform).
- Storage: best-run recording as `profile_data['ghost:<map>:<line>']`
  (cap ~50 KB) or localStorage for guests.

### Sizing
Scorer+UI: 3–4 days. Badges: 1 day. Replay/ghost: 2–3 days (phase 2).

## 3. Testing plan & validation

- **Unit**: `StopScorer` state machine — perfect/overshot/pass-through/
  stop-and-creep sequences, loop-line wrap approaches (feed synthetic frame
  streams); `RunScorer` totals; badge rules; recorder/ghost interpolation.
- **Browser (local)**: scripted drive to a precise stop (teleport near
  station, controlled braking via `setHUDThrottle`) → assert stop card text +
  points; full short line → run card; loop line lap detection; replay renders
  (screenshot) and exits cleanly.
- **Persistence**: with a logged-in profile, run-score appears in
  `GET /api/scores`; personal best updates only on improvement.
- **Production validation**: one full scored run on the live site via
  Playwright + screenshots of stop card and run card; board shows the entry.


---

## 4. What actually shipped (2026-08-12)

- `StopScorer` — per-approach state machine (precision / smoothness / doors →
  points), direction-aware error sign, one result per approach, and an
  `abandon()` path so leaving mid-approach never silently drops a stop.
- `RunScorer` — totals, plain-language summary, loop-aware completion (a lap =
  every station served), and cosmetic badges.
- `ScoringSystem` — decides when an approach starts/ends, posts `run-score` to
  the profile API (queued locally when signed out), and rolls straight into
  the next run so a loop line keeps scoring lap after lap.
- `ScoreUI` — stop card (verdict, metres off, braking, doors, points) and run
  card (total, personal best, per-stop list, badges, **board of best runs on
  this line**).
- **29 unit tests**; 474 pass across 35 suites.

### What the live drive-through changed

Stopping 84 m short of the marker produced *nothing* — no card, no points, no
explanation — because the stop zone is 40 m. The scorer now also scores a stop
made SHORT of the zone the moment the driver opens the doors: opening up is the
driver declaring "this is my stop", and silence is the worst possible feedback.

### Validated

Run card end-to-end in the browser: total, "⭐ Personal best!", per-stop list,
badge chips, and the board fetched from the server showing the signed-in
driver. Screenshot: `docs/_artifacts/scoring-2026-08-12/run-card.png`.

### Not yet confirmed

The **stop card in a real drive**. The scripted test driver could not land
inside the 40 m zone (it brakes early and MetroRider's coasting drag stops it
short), so the card was only exercised through unit tests and the run-card
path. A human drive — brake into a station, open the doors — is the check that
remains. The `finishRun()` path and everything downstream of it are confirmed.

---

## Stop marker + distance readout (2.17.0 / 2.18.0)

`StopScorer` has always graded precision against a point on the track — within
2 m perfect, within 12 m good — and until 2.17.0 that point was **invisible**.
A child was being marked on how close they stopped to somewhere nobody had
shown them.

| Piece | Where |
|---|---|
| Distance readout on the destination board | `GameUISystem.stationMetaLine` |
| Marker geometry | `game/scoring/StopMarkGeometry.ts` |
| Placement (one marker, follows the next stop) | `game/scoring/StopMarkRenderingSystem.ts` |

**The readout's window is TIME, not distance** — about 20 s of running, floored
at 250 m. A fixed distance is wrong at both ends: 400 m is nine seconds to an
express doing 160 and most of a minute to a tram. Measured on a real approach,
it stayed hidden at 537 m / 81 km/h and appeared at 496 m / 104 km/h.

**The marker shipped a release late, and the delay is the interesting part.**
2.17.0 went out with the marker built but NOT registered, because it could not
be picked out from the cab at three different stations — and a target the
player cannot see is precisely the defect it exists to fix. Every measurement
said the mesh was fine (right station, right point, right terrain height, GPU
mesh uploaded), so the temptation was to call it good and ship.

What settled it was an A/B: swap the known-visible block-signal geometry into
the very same placement. The signal was picked out instantly at 120 m — so the
**placement was never the problem**. The geometry was: a near-white board at
1.9 on a grey post, standing in a sun-blasted white-and-sand landscape. It was
"lit" and had no contrast with anything.

The signals read because they are saturated red and green; the speed boards
read because they carry a dark border and dark numerals. So the marker is now a
DARK plate with a saturated orange bar pushed past 1.0 for bloom, on a dark
post, moved out to 5.0 m (between the speed boards' 4.5 and the signals' 7.6)
and clear of the platform furniture. Visible at 120 m, clearly readable at 45 m.

Screenshots, including the probe that proved placement was fine, in
`docs/features/_artifacts/stop-mark-2026-08-14/`.
