# F5 — Passengers: Demand, Boarding, Transfers & Real Figures

> STATUS: SHIPPED (Phase 1 + figures, v1.1.6) · Depends on: F2 (scoring ties),
> F4 (transfers make sense with schedules). MetroDreamin already sends us the
> demand data we need.
>
> **Operator direction (2026-08-12): passengers must be ACTUAL FIGURES on the
> platform — real 3D people from our own model database — and the figure set
> must be configurable, like every other model in the game.** That moves
> "visible crowds" from a Phase 2 nice-to-have into the core of this feature,
> and adds a new asset category (`models/people`) to the catalog + admin
> import + settings, exactly parallel to trains / tracks / stations.

## 1. Product definition

### Phase 1 — numbers that matter
- Stations accumulate **waiting passengers** over time, proportional to the
  MetroDreamin station `density`/`grade` field (parsed and discarded today).
- The HUD PAX counter (stuck at 0 since forever) becomes real: on door open,
  waiting passengers board (count animates up), riders alight by a
  destination model (each boarding passenger gets a destination station
  weighted by density).
- Platform **crowd meter**: the station panel shows how many are waiting.
- **Scoring tie-in (F2)**: passengers delivered × distance = a "service"
  component on the run card; leaving a crowded platform without stopping
  shows on the summary ("142 passengers left behind").
- Skipped by express patterns (F4) is fine — passengers for skipped stations
  simply don't spawn for that service.
  **BUILT 2026-11-07:** a station a line runs through (MetroDreamin
  `waypointOverrides`) is not in that line's `stations`, which is the list
  `PassengerSystem` binds the model to — so for that service nobody
  accumulates there, nobody boards if the doors are opened at its platform,
  nobody is given it as a destination, and rolling through it is not counted
  as leaving anyone behind. See F4 §4.

### Phase 1b — the figures (this is the headline, not an extra)
- Every waiting passenger the model counts is **drawn as a person standing on
  the platform**, up to a visible cap. Board the train and the platform
  visibly empties; roll past a packed platform and you can see the crowd you
  left behind. The number in the HUD and the number of bodies on the platform
  are the same number (below the cap).
- Figures come from the **asset catalog**, the same database that already
  serves trains / tracks / stations:
  - new category **`models/people`**, listed by `GET /api/assets/list` as
    `models.people`, uploadable via the admin upload endpoint and importable
    from **Sketchfab** through the existing admin browser (category dropdown
    gains "People").
  - a **built-in procedural figure** (`procedural-default`) so the feature
    works on a fresh install with zero assets — the live server has no
    persistent volume, so nothing may be assumed present.
  - **multi-variant**: the config holds a LIST of model ids
    (`peopleModels: string[]`). Each waiting passenger deterministically picks
    a variant from the list by station id + slot index, so a platform reads as
    a mixed crowd rather than a clone army, and the same platform looks the
    same every time you return to it.
- Configuration (Settings → Passengers), all persisted like other asset
  config (localStorage override + admin "save as server default"):
  - **Crowds**: Off / Few / Normal / Busy — the visible cap per platform
    (0 / 8 / 20 / 40) and it is auto-lowered by the quality tier / governor,
    never raised behind the user's back.
  - **Figure models**: multi-select over `models.people` (+ the procedural
    figure). Empty selection = procedural.
  - **Demand rate**: Calm / Normal / Rush (scales the accumulation rate) —
    this is a gameplay knob, not a graphics one, so it is independent of the
    crowd cap.

### Phase 2 (later): walking-to-doors animation, on-board interiors.

### Interchanges
- MetroDreamin `interchanges` (in the fetched payload, unused) mark transfer
  stations: shown with a double-ring icon on the map overlay + ribbon;
  a share of alighting passengers at an interchange "transfers" (statistics
  only — feeds the city stats screen in F10).

## 2. Technical implementation plan

### Demand model — `src/app/game/passengers/PassengerSystem.ts`
- Per real station of the active line:
  `waiting += density × ratePerMin × demandScale × dt`, capped
  (`MAX_WAITING = 240`). `density ∈ [0,1]` from the importer, default 0.5.
- Board / alight on door-open at the arrived station (`StationManager`
  arrival + `physicsState.doorsOpen`):
  - alight first: riders whose destination is this station leave at
    `ALIGHT_PER_SEC × cars`;
  - then board at `BOARD_PER_SEC × cars`, limited by remaining train capacity
    (`CAPACITY_PER_CAR × cars`), each boarder sampling a destination among
    stations ahead in the current direction weighted by their density (loops
    wrap; the current station is never a destination).
- **Conservation is a unit-tested invariant**: `waiting + aboard + delivered`
  is constant across any sequence of board/alight, per spawn.
- Emits `PassengerSnapshot` for HUD/UI and `delivered` totals for F2 scoring.
- Resets on map/line change; state is per line.

### Figures — `src/app/game/rendering/PassengerRenderingSystem.ts`
- Reuses the existing GLB path exactly (`parseGLBWithTextures` →
  `GeometryBuffers` → merged buffer → `TrainMeshObject` on the scene wrapper,
  drawn by `GBufferPass.renderTrains`). No new material, no new pass.
- Per station: deterministic platform slots (seeded PRNG on station id) laid
  out on the platform rectangle beside the track, each slot carrying a
  variant index + a small yaw jitter. Slot k is occupied iff `k < visible`
  where `visible = min(waiting, cap)`.
- One **merged mesh per station** (all its figures baked into one buffer) —
  a rebuild is a single buffer upload, and the pass draw count stays at
  1 per station.
- **Only nearby stations are built** (`CROWD_RADIUS = 700 m`, at most
  `MAX_CROWD_STATIONS = 6`), rebuilt when a station's visible count changes
  or it enters/leaves the radius, throttled to ≤ 4 rebuilds/second.
- Figure height is normalised to ~1.75 m regardless of the source model's
  units (same bbox-normalisation trick the station loader uses).
- The procedural figure is built in code (`buildPersonGeometry`): ~60 tris,
  head/torso/legs, colour-varied per slot.

### Asset-catalog plumbing (the "model database" part)
| Layer | Change |
|---|---|
| `server/routes/assets.ts` | `people` added to `/list`, to the reassign table and to the delete search dirs |
| `server/routes/sketchfab.ts` | `people` added to `validCategories` |
| `src/admin/SketchfabBrowser.tsx` | "People" in the import-category dropdown |
| `AssetConfigSystem` | `AssetCatalog.models.people`; config `peopleModels: string[]`, `crowdLevel`, `demandLevel`; merge + persistence |
| `GameUISystem` | Settings → Passengers section (crowd level, demand level, figure multi-select) |
| `data-seed/assets/models/people/` | directory ships (empty + README) so a fresh deploy has the category |

### Sizing
Demand + boarding + HUD: 1 day. Figures + catalog + settings: 1.5 days.
Interchange marks/stats: 0.5 day.

## 3. Testing plan & validation

- **Unit** (`src/app/game/passengers/__tests__/`):
  - accumulation scales with density, respects the cap, and is zero for a
    zero-density station;
  - conservation across a long random board/alight sequence;
  - boarding rate honours dwell time and train capacity;
  - destination sampling never targets the current station, respects
    direction, wraps on loops;
  - slot layout is deterministic for a given station id (same seed → same
    positions/variants) and stable when the count grows (existing figures do
    not jump when one more person arrives).
- **Browser (local, Playwright)**: drive two stops with doors — PAX rises and
  falls, the platform visibly empties on boarding, crowd meter drains,
  screenshots of a crowded vs emptied platform; density contrast visible
  across stations; FPS with crowds on within 10% of crowds off (4× CPU
  throttle profile).
- **Production validation**: live run confirming PAX > 0 after a stop,
  figures render, no console errors, screenshot of a crowded platform.


---

## 4. What actually shipped (2026-08-12)

Built and validated locally end-to-end:

- `PassengerModel` (pure logic) + `PassengerSystem` (wiring): demand from real
  MetroDreamin catchment data, board/alight on doors, destinations, capacity,
  left-behind counting. **15 unit tests**, including the conservation invariant.
- `CrowdLayout` deterministic slots (**10 unit tests**) + `PersonGeometry`
  built-in figure (14 boxes, expands into 6 differently-dressed variants).
- `PassengerRenderingSystem`: one merged mesh per platform, nearest 6 stations
  within 700 m, ≤ 4 rebuilds/s, figures normalised to 1.75 m, deck height
  MEASURED off the placed station mesh.
- Asset category `models/people` end-to-end: `/api/assets/list`, upload,
  reassign, delete, Sketchfab import ("People" in the admin dropdown),
  `data-seed/assets/models/people/`.
- Settings → Passengers: crowd level, demand level, multi-select figure models,
  persisted like every other asset setting (localStorage + admin server default).
- HUD PAX is real: `aboard` normally, `aboard · N waiting` while doors are open.

### Corrections the live data forced on the plan

- **`grade` is not demand.** The live payload says `grade ∈ {below, at, above}` —
  it is the track elevation. Demand comes from `densityInfo` (population +
  employment catchment) with `info.densityScore` as fallback; the mapping is
  logarithmic and calibrated so the median station lands at 0.5.
  Measured on the Israel map: 86 real stations, population 0/1,007/3,738/10,598/63,082
  (min/p25/median/p75/max).
- **Crowd slots are centred on the platform**, not offset from its edge — the
  first version put everybody in a line *beside* the platform.
- **`stationMeshes` is not index-aligned with the station list**, so the deck
  height is found by proximity across all station meshes, capped at 1.6 m above
  the terrain (a station model with a roof would otherwise put the crowd on it).

### Validation evidence (`docs/_artifacts/passengers-2026-08-12/`)

| Check | Result |
|---|---|
| Density differentiation (live map) | Rosh Ha'ayin North 0.05 → 1 waiting; Hod Hasharon 0.758 → 26 waiting |
| Boarding (real door path) | 27 waiting → 0; 28 aboard; HUD `28 · 0 waiting` |
| Platform empties visually | `crowd-waiting.png` → `crowd-boarded.png` |
| Crowd level control | busy 3,024 verts · normal 2,880 · few 1,152 · off 0 |
| Settings page | `settings-passengers.png`, values persisted to localStorage |
| Console errors | none (only pre-existing 404s for absent optional assets) |

### Still open (deliberately)

- Alighting was not observed end-to-end in the automated probe: the scripted
  drive stopped ~outside the 40 m arrival window, so the doors never armed at
  the next station. The path is unit-tested (alight-before-board, conservation)
  but wants a human drive to confirm in-game.
- Crowd meters in the station panel / ribbon, interchange icons and the F2
  scoring tie-in are still to come (they depend on F2/F3 surfaces).

---

## 5. Passengers in the score, the crowd meter, change stations (2026-11-07, wave 1)

Four open F5 rows, built together because they all hang off the same counts.

### Delivered passengers are a points component

`scoring/PassengerPoints.ts` holds the whole rule, so the card can quote it:

> **1 point for every passenger you set down, up to 20 for each stop you make.**

| Part of a stop | Up to |
|---|---|
| Stopping (precision + smoothness + doors) | 175 |
| Keeping time (`Punctuality.POINTS_PER_STOP`) | 15 |
| Passengers (`PASSENGER_POINTS_PER_STOP`) | 20 |

So passengers are at most 20 of a stop's 210 — **about a tenth of a run**, the
same order as timekeeping (~7%). Stopping well stays worth the most.

**Why a cap per stop made.** Deliveries pile up at the end of a line (at the
terminus everyone gets off) and the Calm / Normal / Rush demand setting
changes how many people there are. Measured on the model (ten stops, a minute
apart, three cars): ~190 delivered on Calm, ~380 on Normal, ~440 on Rush.
Uncapped, a Rush run would out-score the same drive on Normal for nothing the
driver did, and the score board would compare settings rather than drivers.
The cap puts Normal and Rush on the same 200 (a unit test pins this on the
real model) and Calm within a dozen of it.

**Left behind costs nothing — decided, not forgotten.** Rolling through a
station already scores zero for that stop, and F2's rule is "no punishment
screens"; charging again for the people on its platform would fine the same
act twice. Those people are already a cost — each is a point not earned.
Express services (F4) skip stations on purpose, and a penalty there would
punish the timetable, not the driver. The card still says how many were left.

Where the player sees it:

- **Live**: the points chip on the route strip now includes the passengers,
  and while people are getting off it flashes **"👥 +N"** for under two seconds
  before going back to the total — one points line, which says where the new
  points came from (`PassengerPointsFlash`).
- **Run card**: a passengers row — "👥 42 passengers delivered … +20" — with
  the mark scheme underneath ("1 point a passenger, up to 20 a stop — you hit
  the top"), how many got off at a change station, and how many were left on
  the platform. The passengers moved out of the summary sentence into this
  row, so they are said once.
- Posted with the score as `detail.passengerPoints`.

**Two counting bugs fixed on the way** (both made the passenger numbers on
the card wrong, which mattered once they became points):

1. *Per line, not per run.* The run card read the model's totals, which count
   from when the line was picked. The second run on a loop line (or after
   jumping to a stop or turning round) got the first run's passengers too, and
   the journey record's first stop of each new run re-added them all.
   `PassengerTally` now takes a baseline when a run starts; a model reset
   underneath it (counters going down) is read as the reset it is.
2. *The run closed before the terminus passengers got off.* A run completes the
   moment the last stop is scored — the train coming to a stand, doors still
   shut — so the biggest delivery of the line landed in the NEXT run. The run
   now waits (`readyToFinish`): until everyone for that stop is off, or the
   doors close, or the train leaves without opening, at most 45 s. Turning
   round in the meantime closes it with what it has rather than abandoning it.

And two more the drive itself turned up:

3. *Left behind was counted wrong both ways.* The model keys off the station's
   "arriving" flag (under 2 m/s inside 40 m). Rolling past a packed platform
   at speed never "arrived", so nobody was left behind; crawling in at about
   2 m/s flickered the flag, and the first "off" read as leaving without
   opening — measured: **39 left behind reported at a terminus whose doors
   then opened and served them**. The run card's count now comes from the
   scorer (`LeftBehindCount`): a stop scored as rolled through counts its
   whole platform; a stop made and then left (out of the 40 m zone, or the run
   ending) without the doors ever opening counts whoever is still waiting.
4. *A phantom "rolled straight through".* Stop more than 10 m short of the
   mark and the station is still "ahead", so pulling away began a fresh
   approach to the same station that ended as rolled through — one stop showed
   on the card twice, once as a good stop and once as a miss, and lost the
   "Every stop served" badge. `StopScorer.standingAtScoredStop` stops a new
   approach to the station just scored while the train is still in its zone.

The score-posting order was also tightened: the next run now starts before the
score is posted rather than after the network round-trip, so a stop made
while the post was in flight no longer lands on a closed run.

### Platform crowd meter

`passengers/CrowdMeter.ts`. The destination board's "26 WAITING" chip is now a
meter: the number, and five bars underneath — blue when few, amber when busy,
orange when packed. One full meter = one carriage-load (60), the same at every
station on every map, so "nearly full" means the same everywhere; bars are
linear, and one person lights one bar (an empty meter over a platform with
people on it would be a lie by rounding). It reads the stop being approached,
then the stop you are standing at, and drains as people board.

### Change stations: rings on the strip and the map, and the count

The first build ringed every stop another line calls at — and on the Israel
map that is **all 18 of 18** stops on A1–A3 (311 shared stop-visits across
the 26 lines), because the services overlap so heavily. A ring on every dot says nothing. A printed metro map has the same
problem and solves it the same way: shared track gets plain ticks, the
interchange symbol goes where a line **joins, leaves, ends or crosses**.
`Interchanges.changePoints` does that: a stop is a change station when some
other line calling there does not also call at both this line's stop before
and its stop after (either end of an open line counts when shared).

Measured on the Israel map (with 2.50.0's express patterns): A1–A3 goes from
18 rings to **6**; across all 26 lines 311 shared stop-visits become **179**
rings; the network map marks **35** of the 69 shared stations. It is still about half the stops on that
map, because its services really do start, end and branch everywhere — on a
map with one trunk per line it is far fewer.

Express patterns (2.50.0) come for free: a skipped station is not in the
express's `stations`, so the express does not "serve" it for the index, and an
express running through an interchange is not a change point there.

- **Route strip**: change stations are ringed dots. On a compressed strip
  (more than 24 stops) a dot is ringed when any station it stands for is one.
- **Network map** (the map button): one white double ring per change station,
  over the line colours, under the train marker, with a key in the header
  ("◎ Change here · N stations"). Positioned once per station, not once per
  line, so three lines' stacked dots read as one place.
- The destination board still says "CHANGE FOR …" at every shared stop — that
  is a different, true statement (another line does call here).

**Transfer stats — scoped to what is modelled.** `PassengerModel` gives every
rider a destination on the line being driven; nobody is routed onto another
line. So the game cannot honestly say "N passengers changed lines". What it
can say, and does, is how many were set down at a change station:
`PassengerSystem` counts them, the run card says "N got off at a ◎ change
station", and `RunResult.passengersAtInterchanges` carries it. Real transfers
would need a network-level demand model (origin–destination across lines);
that is a separate piece of work, not a relabelling of this count.

### Measured — PAX flow over two real stops (local production build)

Israel Railways map (MetroDreamin, 26 lines), line A1–A3, from Bat Yam
Yoseftal through Bat Yam Komemiyut to the terminus Rishon LeZion Moshe Dayan.
Driven with the cab lever (pointer presses on its notches) and the doors
opened with the cab's doors button; numbers read through `window.__gameSystems`
before and after each door cycle; script `~/.metrorider/scratch-b/pax-drive.cjs`.

| Moment | Board meter | Aboard | Delivered (run) | Change-station | Live chip |
|---|---|---|---|---|---|
| Start platform, doors shut | 29 WAITING, 3 bars | 0 | 0 | 0 | — |
| Start platform, doors cycled | NOBODY WAITING, 0 | 29 | 0 | 0 | — |
| Komemiyut, stopped (stop scored 59) | 30 WAITING, 3 bars | 29 | 0 | 0 | 59 PTS |
| Komemiyut, doors cycled | NOBODY WAITING, 0 | 44 | 15 | 0 | flashed 👥 +4 → +9 → +13, then 74 PTS |
| Terminus, stopped (stop scored 65) | 40 WAITING, 4 bars | 45 | 15 | 0 | 139 PTS |
| Terminus, doors open | — | 6 | 60 | 45 | run card 3.5 s after the doors opened |

Run card: **"👥 60 passengers delivered +40"** — "1 point a passenger, up to
20 a stop — you hit the top · 45 got off at a ◎ change station"; 59 + 65 + 30
(on time) + 40 (passengers) − 25 (overspeed) − 59 (two reds) = **110**. The
terminus's 45 riders are in this run's count only because the run now waits
for them; before, the card would have said 15. The model's own left-behind
counter read 40 at the terminus (the crawl-in flicker above) and the card,
correctly, says nobody was left. Network map: 35 rings and the key "Change
here · 35 stations". No console errors.

The test driver is a bot, not a careful driver: the overspeed and the red
signals on the card are its own (a same-line train was running ahead).
Earlier runs on the pre-fix code are what found bugs 3 and 4 above.

Screenshots in `docs/features/_artifacts/passengers-2026-11-07/`:
`stop1-approach.png` (meter + rings on the approach), `stop1-doors-open.png`
(chip flashing 👥 +15, meter draining, crowd on the platform),
`stop2-approach.png`, `run-card.png`, `map-overlay.png`.

### Not verified / still open
- **Production validation** — the lead deploys; not done here.
- Phone and portrait layouts of the meter were not screenshotted (the chip
  only grew a five-bar strip under the number, inside the same panel).
- Personal bests set before this release do not include passengers, so a new
  run scores up to ~10% more than an old one for the same driving.
- Real transfers (riders changing onto another line) are not modelled — see
  above.
