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
- **BUILT 2026-11-07 — see §4.** The skip list turned out to be in the data
  (`waypointOverrides`), not something to derive.

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

## 4. Service patterns — what was built (2026-11-07)

### What the payload actually carries

Read off the live Israel-railways map through the importer's own fetch path
(`fullSystem.map`), not assumed:

| Field | What it is | On the Israel map |
|---|---|---|
| `map.lineGroups` | `{id, label}` per group | 14 groups, labelled A, B, C, D, E, F, G, H, I, J, K, M, P and one "symbol" group (the decorative Blue Line strokes, which have no stations and are dropped anyway) |
| `line.lineGroupId` | the group a line belongs to | on all 30 lines |
| `line.waypointOverrides` | station ids THIS line treats as waypoints — runs through, does not call | on 10 lines. A1-A5 passes Holon Junction, Holon Wolfson, Bat Yam Yoseftal, Bat Yam Komemuyot; D1-D2 passes 15 |
| `line.icon` | bullet shape | `diamond` on exactly the five lines named "Express" (A1-A5, D1-D2, E1-E2, F1-F2, H1-H3) |

So express/skip patterns are **stated by the map's author, station by
station** — nothing had to be guessed. Checked the other way too: no line on
the map passes within 30 m of a station it does not list, so there are no
silent pass-throughs to infer from geometry.

`waypointOverrides` is not clean, and is cleaned (`effectiveSkips`): entries
survive a redraw, so the G lines still list Lod Ganei Aviv and Kfar Chabad,
which they no longer go near; D1-D2 lists one id that no longer exists and
one twice. An override counts only when it is a real station on the line's
own path and not either end. A list that would leave fewer than two stops is
ignored and the line runs all-stops.

### The rules

- **Skipped stations are not in `ParsedLine.stations`.** They are kept in
  `ParsedLine.skipped` (+ `skippedPointIndices`, and
  `LineState.skippedStationDists`). Everything that asks "where does this
  train stop" already reads `stations`, so with no further change: the stop
  detector does not arrive there, the timetable schedules no stop and no
  dwell (`buildTimetable` over `realStationDists`), passengers neither
  accumulate nor board nor count as left behind there (F5), same-line AI
  trains run through, and the interchange index does not list the express as
  serving that station.
- **Express** = the author marked it (name says "Express", or the diamond
  bullet). A line that passes stations without being marked express — B1-B2
  "Beach Local" passes two — is described as "skips 2", not called express.
- **Grouping** (`groupLinesForPicker`): each group of two or more lines sits
  under one header at the place its first line appears, longest service
  first. A group of one gets no header. A map with no groups (the Tel Aviv
  sample) is the same flat list as before. **Row order changes; the line
  INDEX each row drives does not** — share links and records point at lines
  by index.
- **"Part of"** — derived, because the data has no field for it: a line is a
  short working of the longest sibling in its group that calls, consecutively
  and with nothing left out, at exactly its stops (either direction). A1-A3
  and A1-A4 are part of A1-A2; A1-A5 is NOT (it leaves stations out — saying
  "part of A1-A2" would promise A1-A2's stops).

### Where a player sees it

- **Picker**: `A · 4 services` header, then A1-A2 (21 stops), A1-A3 (18 ·
  part of A1-A2), A1-A5 (16 · Express · skips 4), A1-A4 (13 · part of A1-A2).
- **Ribbon**: a hollow ring on each leg the train runs through a station
  (the timetable-map mark for a pass), with a tooltip counting them.
- **Board**: `NOT STOPPING · HOLON JUNCTION` within 900 m of a skipped
  station (before the next stop); `NOT A STOP FOR THIS TRAIN · …` when
  standing at one. The "change for" clause is left off these — it belongs to
  the next stop and would read as "change here".
- **Announcement** on departure: "The next station is Rishon letsiyyon moshe
  dayan. This train does not stop at Holon Junction, Holon Wolfson, Bat Yam
  Yoseftal or Bat Yam Komemuyot." (more than four: "runs non-stop through N
  stations").
- **Timetable sheet**: the passes listed in running order with no time,
  "Passes — this train does not stop".
- **About this line**: a PASS row naming them.
- **Platforms are still drawn** at skipped stations — an express runs past a
  real station, not a bare stretch of track.

### Code

`data/ServicePatterns.ts` (pure: skips, express marking, grouping, part-of,
along-track helpers), `ui/LinePicker.ts` (picker rows), plumbing in
`MetroDreaminImporter.ts` / `RouteParser.ts` / `TrainSystem.ts`, section
headings in `CabSheet.ts`, ring in `RouteRibbon.ts` / `CabHud.ts`.
Tests: `src/__tests__/servicePatterns.test.ts` (36) against
`src/__tests__/fixtures/israel-railways-stops.json` — the real payload with
the bend points dropped.

### Known limits

- Records (ghost traces, journey log) are keyed by stop INDEX. On the ten
  lines with skips, indices after the first skip now point at different
  stations, and an old best time set while stopping at every station is
  easy to beat. Not migrated.
- Only one pattern per line: MetroDreamin has no notion of the same line
  running express at some hours and all-stops at others.

