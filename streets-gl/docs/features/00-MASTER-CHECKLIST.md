# MetroRider Feature Program — Master Checklist

> One checklist for the whole program. Each section = one feature doc
> (01–10 in this folder). Every item ends with the doc's testing gate:
> **unit tests green → local browser validation → deploy → production
> validation → changelog entry** (the release process from `version.ts`).
>
> **Exclusions (by decision):** no XP/ranks/progression gating of any kind;
> no real-time multiplayer. Scores, records, badges and shared score boards
> ARE in scope, backed by lightweight profiles.

## Progress (2026-08-15)

**Live on metrorider.net: v2.42.0 "Change Here"** — 63 releases. Every row
below reflects what is DEPLOYED, not what is merged.

### What shipped on 2026-08-15

Twenty releases in one session, and fourteen of them were CORRECTIONS rather
than features — things that existed in code and did nothing, or did the wrong
thing. The pattern is worth naming because it recurred every single time: a
surface that looked built, wired to nothing or to the wrong source. Reading
the code showed a lever; running the game showed a green bar.

| Release | What was actually wrong |
|---|---|
| 2.23.0 Hands On | Every sheet row in the game was dead (`pointer-events`); panels piled at (0,0) before the first frame; the minimap had never drawn a map |
| 2.24.0 Take the Handle | No way to drive on a tablet at all — lever and brake were pictures |
| 2.25.0 The Real Lever | The cab had a controller SCALE and no controller; a tap did nothing visible |
| 2.26.0 Let It Run | Everyone started in Simple, pinned to the posted limit with nothing saying why |
| 2.27.0 Read the Dial | Speedo scaled to the limit not the train; mode top speeds held nothing; a raw id on screen |
| 2.28.0 The Streets Around You | The minimap was a route diagram, not a map |
| 2.29.0 Drive the 18:30 | The timetable was always "leaving now" — the clock face was decoration |
| 2.30.0 Step Out | Walk mode had never been built (Trackside had, and was ticked as it) |
| 2.31.0 Someone to Be | Walking had nobody doing the walking |
| 2.32.0 Every Line Its Own Name | Four routes shared the badge "A1"; the built-in map could not be shared |
| 2.33.0 The Train in Front | Block signals protected only the other track — a red meant nothing |
| 2.34.0 Count the Stops | The route strip drew 12 dots for 21 stations, marker between them |
| 2.35.0 Somewhere New | Discovery had been parked on worker plumbing it never needed |
| 2.36.0 Cast Off | Ferry was a line mode with no boat and rails laid under the water |
| 2.37.0 Inside the Cab | Cab view was a camera at the front, not a cab; curves were silent |
| 2.38.0 Pin It on the Map | Finds were counted and had nowhere to be seen |
| 2.39.0 Race Yourself | A best time you could never chase — and the clock ran before the race started |
| 2.40.0 Show Your Working | "Good stop, 65" is a grade with no mark scheme; the ghost row could come up empty |
| 2.41.0 Hold It There | A train jumped to a stop kept full power and drove off; in neutral it rolled away. Score and train-ahead were computed and shown nowhere |
| 2.42.0 Change Here | Nothing said a map was a network — and the flag that looked like it meant "you can change here" answers a different question, true at 3 stations out of 70 |

**The habit that found all of it: open the game and use it.** Not one of these
was visible to a passing test suite, and several had passing tests around
them.

### The interface was unusable, 2026-08-15

Reported by the operator, reproduced, and fixed in v2.23.0. Worth recording
because none of it was visible to any automated check, and because the audit
below had just declared several of these surfaces shipped:

- **Not one sheet row could be clicked.** `.cab-sheet` is mounted inside
  `#game-hud`, which is `pointer-events:none` so the world can be dragged
  through it. Every control inside has to opt back in and the sheet never
  did — so Pick a line, Camera, Settings, Timetable, About this line, Drive
  another map and Copy a link were all dead at once. The menu itself opened,
  because its button is a `.cab-btn`, which does opt in. That is why it read
  as "clicking Pick a line does nothing" rather than "the menu is broken".
- **Every panel piled into the top-left corner until the first frame of a
  running game.** All cab layout comes from `.cab[data-o="land|port|phone"]`
  rules, and `data-o` was only ever written inside `update()`. Before that
  ran, no rule matched and five `position:absolute` panels with no offsets
  stacked at (0,0) — over the engine's own controls. Now set at mount, on
  resize, and on show.
- **The HUD was visible before the game started**, over the start screen.
  Now hidden until `showGameUI()`.
- **The minimap had never drawn a real map.** It renders `routePoints`, which
  no caller ever passed, so it fell back to a hard-coded diagonal with five
  evenly spaced dots — the same picture on every line in every city. Replaced
  with real geometry, and the placeholder is gone: with nothing to draw it now
  says so.
- **The minimap sat on top of the time-of-day control**, which owns the
  bottom-left along with the rest of the engine's cluster (323×200). Moved
  into the left column under the ribbon.

The lesson for this checklist: **a row may only be ticked once the surface has
been driven by hand.** Several of the above were ticked on code that existed
and was wired but had never been clicked.

### Checklist audit, 2026-08-15

This file was re-read against the source before this run and was wrong in
**both** directions. Corrections, so the record is straight:

- **F8 claimed Walk mode was built.** It is not. The camera enum is
  Chase/Cab/Orbit/Ride/**Trackside**/Photo/Free — Trackside was built and
  Walk never was, and the row had been ticked for the wrong one.
- **F8 claimed Simple/Advanced score-drain suppression was NOT wired.** It
  is — `ScoringSystem.finishRun` reads `driveMode` and zeroes both overspeed
  counters in Simple.
- **F3's ">25% overspeed penalty brake" was listed as outstanding work.** It
  was built, then deliberately REMOVED, and the reason is recorded in
  `SpeedLimitSystem`: cutting traction takes the decision away from the
  player and makes the sign pointless. It is a closed decision, not a TODO.
  `SpeedState` also already exists (`ok`/`near`/`over`).
- **F5's "left-behind note" was listed as outstanding.** The run summary
  carries both delivered and left-behind, and there is a delivery badge. Only
  a points *component* is missing.

| Feature | State |
|---|---|
| **F1 Profiles & scores** | **SHIPPED** — Railway volume attached with `DATA_DIR=/data`, persistence PROVEN across a real container replacement |
| **F2 Driving score** | **SHIPPED** — stop + run scoring, cards, badges, board, distance readout v2.17.0, stop marker v2.18.0, own-ghost v2.39.0. Stop replay outstanding |
| **F3 Speed limits** | **SHIPPED v1.1.12–v1.1.14** — curvature-derived profile, HUD limit, lineside boards, country-correct signage. Ribbon limit ticks outstanding |
| **F4 Timetables** | **PART SHIPPED v2.7.0** — due times from the line's real speed profile, punctuality read, follows a reversal. Service picker + punctuality SCORING outstanding |
| **F5 Passengers** | **SHIPPED** — demand from real map data, boarding, figures on platforms, interchange surfacing v2.42.0 |
| **F6 Line modes & vehicles** | **PART SHIPPED** — modes v2.12.0, tint v2.13.0, consists v2.14.0/v2.16.0, feel v2.15.0, TTS v2.5.0, grade v2.22.0. Ferry water, cab overlay, flange squeal outstanding |
| **F7 AI traffic & signals** | **PART SHIPPED** — passing services v2.5.0, block signals v2.11.0. Same-line AI and SPAD outstanding |
| **F8 Cameras & exploration** | **PART SHIPPED** — six named views v2.2.0, photo save v2.10.0, Simple/Advanced v2.2.0 incl. drain suppression. Walk mode outstanding |
| **F9 World atmosphere** | **PART SHIPPED** — time of day v2.4.0, map-local solar time v2.20.0. Weather DEFERRED by agreement |
| **F10 City & discovery** | **PART SHIPPED** — world tour v2.8.0, line facts v2.6.0, share links v2.21.0. Landmarks, discovery and city stats outstanding |

---

## The plan for this run

Ordered by what a nine-year-old notices, then by what the code can carry.
Each is one release, shipped and verified on production before the next
starts.

| # | Release | Closes |
|---|---|---|
| 1 | ~~**Punctuality scoring**~~ — SHIPPED v2.23.0, with the interface fixes | F4, F2 hook |
| 2 | **Service picker** — "Drive the 09:12" instead of always departing now | F4 |
| 3 | **Walk mode** — step out of the train and walk around the city | F8 |
| 4 | **City stats + discovery** — what you have driven, what you found | F10 |
| 5 | **Same-line AI + SPAD** — a train ahead you can catch, a signal you can pass | F7 |
| 6 | **Ribbon limit ticks + loop ring** | F3 |

Deferred with a reason, not forgotten: **weather** (F9 — an atmosphere LUT
chain + UBO layout change, agreed to park), **ferry water routes** (F6 — no
boat model in the catalog), **replay/ghost** (F2 — wants a recorder before it
wants a camera).

---

## F1 — Player profiles & score persistence (`01-accounts-and-scores.md`)
- [x] Railway volume at `/data`, `DATA_DIR=/data`, persistence verified
- [x] `docs/DEPLOYMENT.md` updated (volume holds the player database)
- [x] SQLite (`better-sqlite3`): profiles/sessions/scores/profile_data
- [x] Server routes: create/login (PIN hash + lockout), `GET /api/me`,
      profile_data KV, `POST /api/scores`, `GET /api/scores`, rate limits
- [x] Server unit tests (temp DB): auth, lockout, best-upsert, board, KV
- [x] Client `ProfileClient.ts` (token storage, offline queue + flush)
- [x] Start-screen "Who's driving?" + create/login modal + HUD name chip
- [x] Settings/consist backup + restore-on-login
- [x] Local browser validation, production validation, changelog entry

**F1 is closed.**

## F6 — Line modes & vehicles (`06-line-modes-and-vehicles.md`)
- [x] Thread `mode` through MetroDreaminImporter → LineData/ParsedLine
- [x] `LineModes.ts` (mode → limit, consist, icon, dwell, feel)
- [x] Line list/picker icons per mode
- [x] Mode default consists — used only when the player has never picked a
      train. Ferry and air have none: no boat or aircraft model exists
- [x] Per-MODE accel/brake feel (2.15.0) + mode top-speed cap (2.12.0)
- [x] Terrain-grade force (2.22.0) — `g × grade`, 60 m baseline, 9% clamp,
      suppressed at a platform
- [x] TTS station announcements (voice by locale, settings toggle)
- [x] Livery tint: `#tint=RRGGBB` + material uniform + palette UI
- [x] Hold-to-sustain horn (2.19.0), cab button + H key
- [x] Unit tests — tint tokens (14), mode resolution (19+9), grade (8)
- [x] Local + production validation (SEPTA multi-mode), changelog entry
- [ ] **Per-MODEL physics** — `performance` metadata per carriage in
      catalog.json. Feel is currently per line kind, which is the axis that
      matters; this is a refinement, not a gap
- [ ] **Ferry water routes** — BLOCKED: no boat GLB in the catalog
- [ ] **Cab windscreen overlay** — instruments shipped in v2.1.0 as the
      permanent HUD in every view; the windscreen framing is not built
- [ ] **Flange squeal** by curvature × speed

## The dead-surface sweep (v2.41.0)

Eleven of the thirteen releases before it were corrections to surfaces that
existed in code and did nothing, or the wrong thing. None were visible to the
test suite. So the sweep was made mechanical: walk every `public` member
declared under `src/app/game/` and count its references across the whole of
`src/`. Anything referenced ONCE is its own declaration and nothing else.

222 public members; 15 came back lonely. They sorted into three kinds, and
only the first is what people mean by dead code:

**Hooks with no subscriber — deleted, both ends.** `TrainSystem`'s
`setStationArrivalCallback` and `setDirectionChangeCallback`, and
`StationManager.setArrivalCallback`, were never called, so the guarded
invocations (`this.onStationArrival?.(…)`) could never fire. A null-check that
can never pass is worse than nothing: it reads as a feature. Arrival is
already handled directly — the chime plays, the announcement fires on
departure — so nothing was lost. `setHUDThrottle`/`setHUDBrake` were the old
hold-to-drive buttons, superseded by the notched `setController`.

**Numbers computed and shown nowhere — SHIPPED, because they were features.**
`ScoringSystem.getRunTotal()` had no caller: a run is graded stop by stop and
the total only ever appeared on the card at the end, which is the one moment
it can no longer change anything. It is now a chip on the route strip that
climbs while you drive. `AmbientTrainSystem.leadingGap()` had no caller
either: the same-line traffic that shipped in 2.33.0 turned signals red but
never told the driver how far the train in front was. It is now the third cab
tell-tale, in metres, lit inside 900.

**One that was a bug.** `CabHud.resetNotch()` existed, was correct, and was
called by nothing — so a train jumped to another stop kept whatever the handle
was set to. At P4 it drove off on its own. Wiring it revealed the real
problem underneath: neutral is not enough either, because a train with nothing
applied rolls (measured, 20 m in 8 seconds on a gentle bank, still gaining).
A train set down at a platform is now HELD ON THE BRAKE — which is what the
physics already assumed, in a comment about doors that this path never
reached. Same for selecting a new line.

Re-run after the batch landed: 15 lonely members became **5**, none of them
from the new code. The five that remain (`AssetConfigSystem.isLoaded`,
`PassengerSystem.getModel`, `ProfileClient.isSignedIn`,
`ScoringSystem.getStopCount`, `StopScorer.getStationIndex`) were each read
and left alone deliberately: they are small accessors with no feature hiding
behind them and no bug in front of them, and two of the five belong to
coherent minimal public APIs where removing one predicate makes the class
worse rather than tidier. Reviewed and kept is a different answer from
missed, and worth writing down as one.

Sweep script: `/tmp/sweep.mjs` shape is four lines of `readdirSync` +
`matchAll(/^\s*public\s+…/gm)` + a reference count. Worth re-running whenever
a batch of features lands; it costs seconds and has now found more real
defects than the 824-test suite has.

## F2 — Driving score (`02-driving-score.md`)
- [x] `StopScorer.ts` state machine + unit tests
- [x] Stop marker + HUD distance-to-mark readout (2.17.0/2.18.0)
- [x] Stop card UI (verdict + points, 3 s)
- [x] `RunScorer.ts` (aggregate, terminus/lap finalize incl. loops) + tests
- [x] Run card UI + personal-best callout
- [x] Score posting to F1 (`run-score`), board on the run card
- [x] Badges: rule list + run-card surfacing
- [x] Overspeed drain + Simple-mode suppression (both wired in
      `ScoringSystem.finishRun`)
- [x] Punctuality on the run card (v2.23.0) — a percentage and a bonus, NOT a
      penalty, and one-sided: early is not a fault. The schedule is written at
      82% of the permitted speed with 20 s of recovery per stop, so holding the
      limit puts a train a clear two minutes early by the third station;
      marking that down would have scored good driving as a failure and fought
      the speed limits at the same time
- [x] **Own-ghost — race your best time (v2.39.0).** Shipped as a
      `GhostTrace`: a table of "how long it took me to get this far", one entry
      every 50 m, per journey. NOT a recorded train — nothing is drawn,
      animated, or kept in step with the physics, and a whole line's record is
      a few hundred numbers in localStorage. A green chip on the destination
      board says how far up or down you are and moves the whole way along; the
      run card says "46s faster than your best"; a better run replaces the
      record. 35 unit tests
- [~] **DECIDED: the clock starts when the train does.** The first build
      counted the time you sat at the platform before setting off, so the
      console told a stationary driver they were "24s down" on a race that had
      not started. Dwell at every LATER stop still counts — standing too long
      at a station genuinely is a slower run
- [x] **A journey is start-station + direction, not just the line** — jumping
      to another stop or turning the train round now bumps
      `TrainSystem.journeyGeneration`, which is in the scoring key. Without it
      "from the first station, forwards" and "from halfway, backwards" were the
      same key, and the game would have compared a run to a journey it never
      made — and scored a run over ground it never covered
- [x] **`RunRecorder` — the 5 Hz ring (v2.40.0).** A minute of driving kept at
      5 Hz in a fixed-size ring, carrying position and heading as well as speed
      so the same recording can later drive a camera. 23 unit tests, the
      load-bearing one being that it hands samples back in TIME order after the
      ring has wrapped — storage order would put a jump in the middle of every
      graph drawn from it
- [x] **The approach, drawn, on the stop card (v2.40.0).** Speed up the box,
      distance across it, the mark as a dashed line, a dot where the train came
      to a stand. Late braking reads as a cliff, a creep as a long flat tail, a
      good stop as a curve into the line — three different lessons that "Good
      stop, 65" cannot tell apart. 12 unit tests; a stop PAST the mark is drawn
      past it, because clamping the overshoot onto the line would hide exactly
      the mistake the picture is for
- [~] **DECIDED: a picture before a camera.** The original phase-2 note said
      "stop replay (orbit cam) + own-ghost translucent consist". The ghost
      needed no camera at all, and the approach needed a graph rather than a
      fly-past: the point of watching it again is finding out WHY it scored what
      it did, and a shape shows that in a glance where a camera move shows it
      once, slowly. A camera replay is still worth building — the recorder now
      carries what it needs — but it is a second way of seeing the same thing,
      not the first
- [ ] **Camera replay** — fly the recorded approach from outside. The ring
      already carries `x`/`z`/`heading` and `sampleAt` interpolates them; what
      is missing is a replay consist registered in `GBufferPass`'s explicit
      draw list and a camera mode
- [x] Local browser validation of two full scored runs on C6-C5 (2026-08-15):
      first run recorded (`::14::2::r`, 261.5 s / 3 677 m), second driven
      faster, chip tracked live from "4.0s up" through "level" to "3.4s down"
      and back, card read "46s faster than your best · NEW BEST", stored trace
      replaced with the 215.2 s one. Artifacts:
      `_artifacts/ghost-2.39.0/`

## F3 — Speed limits & route ribbon (`03-speed-limits.md`)
- [x] `SpeedProfile.ts` (curvature → limit, smoothing, loop-aware) + tests
- [x] `limitAt`/`nextChange` lookups + unit tests
- [x] `SpeedState` (`ok`/`near`/`over`)
- [x] HUD limit chip + approach countdown
- [x] Track-side speed boards at change points
- [x] Overspeed → F2 score drain, suppressed in Simple
- [x] Route ribbon (v2.1.0) — stop dots, travelled segments lit, train marker
- [~] **DECIDED AGAINST: overspeed penalty brake.** Built, then removed. A
      limit is information the driver acts on; cutting traction took the
      decision away and made the sign pointless. Ignoring it costs points —
      that is the entire enforcement, and it is the player's call
- [ ] **Ribbon limit ticks + loop ring** → release 6 below
- [ ] Local browser validation (known-curve limits, forced overspeed chain)

## F4 — Timetables & service (`04-timetables-and-service.md`)
- [x] `Timetable.ts` generator (limits + dwell → due times; loop continuity)
- [x] `ServiceClock` / MapTimeSystem time-provider hook
- [x] HUD drift chip (`+0:42`), departure chime, early-door rule
- [x] Timetable sheet (due vs actual per station)
- [x] Punctuality scoring (v2.23.0) — `Punctuality.ts` + 17 unit tests,
      `ServiceSystem.latenessAtStation`, captured per stop AS IT HAPPENS
      (the timetable is rebuilt on every reversal, so reading it at the end of
      a run would judge early stops against a schedule that no longer exists),
      posted to F1 as its own `punctuality` score kind
- [ ] **Service picker** ("Drive the 09:12") → release 2 below
- [ ] `lineGroupId` plumbing + grouped picker + express patterns
- [ ] Validate against the Israel-railways map's real A1–A5 groups
- [ ] Local + production validation, changelog entry

## F5 — Passengers (`05-passengers.md`)
- [x] Thread density (`densityInfo`) + `interchanges` through the importer
- [x] `PassengerSystem` (accumulation, board/alight, destinations) + tests
- [x] HUD PAX
- [x] Platform people: merged per-station meshes, deterministic placement,
      caps, `models/people` catalog category + import + settings
- [x] Delivered + left-behind in the run summary, delivery badge
- [ ] **Delivered-passenger points component** (currently narrative only)
- [ ] Express/skip handling (no spawn for skipped services)
- [ ] Interchange icons (map overlay + ribbon) + transfer stats
- [ ] Platform crowd meters in the station panel
- [ ] Local browser validation (PAX flow over two stops), production

## F7 — AI traffic & signals (`07-ai-traffic-and-signals.md`)
- [x] `BlockSystem` (blocks, occupancy, aspects) + unit tests
- [x] Signal post meshes + aspect rendering
- [x] Passing services on the adjacent alignment (v2.5.0), cheap by design
- [ ] **Same-line AI + dispatch spacing; AI obeys signals** → release 5
- [ ] **Player SPAD → run-card note** → release 5
- [ ] Density setting (Off/Light/Normal, hard cap) + consist culling
- [ ] Perf gate: 4×-throttle profile with AI ≥85% of no-AI
- [ ] Ambient aircraft; ambient cars
- [ ] Local + production validation, changelog entry

## F8 — Cameras & exploration (`08-cameras-and-exploration.md`)
- [x] Camera modes Chase/Cab/Orbit/Ride/Trackside/Photo/Free with explicit
      entry buttons (cycle covers Chase/Cab/Orbit)
- [x] Ride (v2.2.0) — a seat by the window looking out along the train
- [x] Photo: damped flight, FOV slider, HUD hide, PNG capture
- [x] Simple / Advanced driving (v2.2.0) incl. score-drain suppression
- [ ] **Walk mode** — `WalkController` (terrain clamp, WASD + drag, mobile
      dual-zone touch), "Step out" / "Return", distance leash → release 3
- [ ] Auto-drive while riding (Ride currently still needs you to drive)
- [ ] Unit tests (terrain clamp, leash)
- [ ] Local + mobile-emulation validation, production, changelog

## F9 — World atmosphere (`09-world-atmosphere.md`)
- [x] MapTimeSystem `TimeProvider` (real | manual | service-day) + slider
- [x] Map-local solar time (v2.20.0) — `utcHour = hour − lon / 15`
- [ ] **DEFERRED by agreement:** `WeatherSystem`, fog term, rain post,
      wet-rail braking, seasons. Overcast is a change to the atmosphere LUT
      chain and its UBO layout across four shaders, not a setting

## F10 — City & discovery (`10-city-discovery.md`)
- [x] "Drive another map" (v2.8.0) — the live profile's maps, loaded mid-game
- [x] Line facts (v2.6.0)
- [x] Share links (2.21.0) — `?map&line&train`, session-only consist + tests
- [x] Journey record (v2.32.0) — distance, time, cities, stations, lines,
      passengers, top speed; localStorage-first so a guest keeps theirs
- [x] Discovery (v2.35.0) — named places found while driving OR walking, with
      milestones. **The `notable[]` worker plumbing was never needed**: every
      loaded tile already carries the map's own labels, in world metres, with
      a priority. Radius and threshold set from measurement, not taste — at
      140 m a whole run found nothing, because a railway runs through open
      country and the places are in the towns
- [ ] Map-overlay landmark icons
- [ ] Map browser: SVG thumbnails, Featured list, richer Recents
- [ ] Local + production validation, changelog entry

---

## Program-wide gates (apply to every section)
- [x] Every release bumps `version.ts` and `package.json` together — held
      for all 43 releases
- [x] Production validation on the live URL after each deploy
- [ ] No feature ships without its unit tests and a local browser pass
- [ ] Perf: 4×-throttle profile within 10% of the pre-feature baseline, or
      the feature gains a tier/governor gate
- [ ] Feature doc updated with what was actually built, per session
