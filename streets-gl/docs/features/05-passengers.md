# F5 — Passengers: Demand, Boarding, Transfers & Crowds

> STATUS: PLANNED · Depends on: F2 (scoring ties), F4 (transfers make sense
> with schedules). MetroDreamin already sends us the demand data we need.

## 1. Product definition

### Phase 1 — numbers that matter (no 3D people)
- Stations accumulate **waiting passengers** over time, proportional to the
  MetroDreamin station `density`/`grade` field (parsed and discarded today).
- The HUD PAX counter (stuck at 0 since forever) becomes real: on door open,
  waiting passengers board (count animates up), riders alight by a
  destination model (each boarding passenger gets a destination station
  weighted by density).
- Platform **crowd meter**: the station panel and ribbon show a small
  0–3-person icon per station (how many are waiting).
- **Scoring tie-in (F2)**: passengers delivered × distance = a "service"
  component on the run card; leaving a crowded platform without stopping
  shows on the summary ("142 passengers left behind").
- Skipped by express patterns (F4) is fine — passengers for skipped stations
  simply don't spawn for that service.

### Phase 2 — visible crowds (instanced, static)
- Low-poly people standing on platforms (2–4 variants), count = waiting
  number capped at ~30 visible; disappear on boarding. No walking animation
  in this phase — standing groups already read as "people waiting for MY
  train".

### Phase 3 (explicitly OUT for now): walking to doors, on-board views.

### Interchanges
- MetroDreamin `interchanges` (in the fetched payload, unused) mark transfer
  stations: shown with a double-ring icon on the map overlay + ribbon;
  a share of alighting passengers at an interchange "transfers" (statistics
  only — feeds the city stats screen in F10).

## 2. Technical implementation plan

- `MetroDreaminImporter`: stop dropping `grade`/`densityInfo` and
  `interchanges` — thread through `MetroMapData → ParsedLine/StationData`
  (`density: number` normalized 0–1, default 0.5 when absent;
  `isInterchange`).
- `src/app/game/passengers/PassengerSystem.ts` (a System):
  - Per real station: `waiting += density × rate × dt` (rate tuned so a
    dense station gathers ~40 in 5 min; cap 200). Uses the service clock
    (F4) when active.
  - Board/alight on door-open at the arrived station (`StationManager`
    arrival + `physicsState.doorsOpen`): alight = riders destined here;
    board at ~2 pax/s per car while doors open (dwell matters!), each with a
    destination sampled by downstream density.
  - Emits `PassengerEvents` for scoring + UI; state resets on line/map change.
- HUD: PAX = riders aboard (exists, currently hardcoded 0); crowd meter icons
  in the station panel rows + ribbon ticks.
- Phase 2 rendering: reuse the instancing pipeline (trees):
  a `people` instanced object (2–4 GLB variants — Kenney characters or
  simple capsule-people), per-station instance buffer rebuilt when
  `waiting` crosses thresholds; positions scattered on the platform
  rectangle used by station meshes, deterministic per station id.
- Interchange plumbing: `isInterchange` → map overlay double-ring, ribbon
  icon, transfer stat counter.

### Sizing
Phase 1 (demand+board+HUD+score): 3 days. Phase 2 (instanced people): 2–3
days. Interchange marks/stats: 1 day.

## 3. Testing plan & validation

- **Unit**: demand accumulation vs density and cap; board/alight conservation
  (nobody teleports: waiting+aboard+delivered constant per spawn); dwell-time
  boarding rate; destination sampling distribution sane; express skip = no
  spawn; loop-line destinations wrap.
- **Browser (local)**: drive two stops with doors — PAX rises/falls, crowd
  meter drains on boarding, run card shows delivered count; density data
  visibly differs across stations on the Israel map (dense TLV core vs rural).
- **Phase 2**: platform people appear/disappear with boarding (screenshots);
  instance count bounded; FPS unaffected (profile run: people are static
  instances, same path as trees).
- **Production validation**: Playwright run on live confirming PAX > 0 after
  a stop, crowd icons render, no errors; screenshot of a crowded platform.
