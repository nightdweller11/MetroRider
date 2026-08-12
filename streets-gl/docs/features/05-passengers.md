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
