# F4 — Timetables, Punctuality & the Service Day

> STATUS: PLANNED · Depends on: F3 (limits make schedules honest), F2 (score
> integration). Enhanced by F6 (per-mode dwell/speeds) and 3.3 line groups.

## 1. Product definition

### The service day
- A game clock (top HUD, already shows wall time) gains a **Service Day
  mode**: time runs at 10× so a full timetable spans a ~2 h session; the sun
  follows it (MapTimeSystem already positions the sun by time). Toggle in
  settings: `Real time / Service day`.

### Timetables
- Picking a line offers **"Drive the 09:12 service"**: a generated schedule —
  departure time + arrival time per station — computed from distance, speed
  limits and a dwell time per stop (30 s metro / 45 s rail).
- HUD shows the next station's scheduled time and your drift: `+0:42` (late) /
  `−0:15` (early), green within ±30 s.
- Departing a station: a "ready" chime at scheduled departure; early
  departures count against punctuality (doors must close no earlier than
  T−10 s).

### Punctuality score
- Per-station on-time points (full within ±30 s, fading to 0 at ±3 min);
  end-of-run punctuality % on the F2 run card; posted as
  `kind: 'punctuality'` to F1.

### Service patterns (line groups)
- MetroDreamin `lineGroupId` (already in the payload, currently dropped)
  groups branches of one service. The line picker groups them and offers the
  pattern choice ("A1 all stops / A5 express — skips 6 stations"); express
  services get a skip-list in the schedule and the ribbon dims skipped stops.

## 2. Technical implementation plan

- `src/app/game/service/Timetable.ts` (pure): input
  `{stationDists, speedProfile, dwellSec, departure}` → per-station
  `{arr, dep}` using a trapezoidal speed integration over the profile (a
  simple `distance/limit + accel margin` per segment is enough; 10% pad).
  Loop lines: continuous schedule around the ring.
- `src/app/game/service/ServiceClock.ts`: game-time source
  (`real | x10`), drives MapTimeSystem instead of wall time when enabled
  (MapTimeSystem gains a time-provider hook).
- `RouteParser`: keep `lineGroupId` on `ParsedLine` (one line of plumbing
  from `MDLine` — it's parsed and discarded today); group lines in the
  GameUISystem picker; an express variant is just another line in the group,
  its skipped stations = group's union minus its own stations (marked on the
  ribbon via F3).
- HUD drift chip in `GameUISystem` (next scheduled time + drift, colored).
- Punctuality scoring hooks in F2's `RunScorer` (`onStationDeparture` events
  from `StationManager` — extend it to emit departure detection: was
  arrived && speed > 2 && doors closed).
- Departure chime via existing `AudioSystem` samples.

### Sizing
Timetable + clock + HUD: 2–3 days. Line groups/patterns: 1–2 days.
Punctuality scoring: 1 day.

## 3. Testing plan & validation

- **Unit**: `Timetable` — monotonic times, dwell applied, express skip-lists,
  loop continuity, schedule respects lowered limits (inject a slow
  `SpeedProfile`, times stretch); drift computation incl. midnight wrap;
  `ServiceClock` 10× progression.
- **Browser (local)**: pick a scheduled service → drive on time → drift chip
  stays green, punctuality 100%; deliberately dawdle → drift goes `+`,
  punctuality drops on the run card; express pattern skips flagged stations
  on the ribbon; service-day sun visibly moves (screenshot dawn→dusk 2 min
  apart).
- **Data**: verify `lineGroupId` parsing against the son's Israel-railways
  map (it has A1–A5 grouped patterns — perfect real fixture).
- **Production validation**: Playwright — schedule picker renders on live,
  one on-time run posts punctuality to the board, screenshots of drift chip.
