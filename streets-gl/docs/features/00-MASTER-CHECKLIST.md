# MetroRider Feature Program — Master Checklist

> One checklist for the whole program. Each section = one feature doc
> (01–10 in this folder). Work top-to-bottom within a section; sections list
> their dependencies. Every item ends with the doc's testing gate:
> **unit tests green → local browser validation → deploy → production
> validation → changelog entry** (the release process from `version.ts`).
>
> **Exclusions (by decision):** no XP/ranks/progression gating of any kind;
> no real-time multiplayer. Scores, records, badges and shared score boards
> ARE in scope, backed by lightweight profiles.

## Progress (2026-08-15)

**Live on metrorider.net: v2.21.0 "Come and See This"** — 42 releases. Every row
below reflects what is DEPLOYED, not what is merged.

| Feature | State |
|---|---|
| **F1 Profiles & scores** | **SHIPPED** — and the Railway volume is attached with `DATA_DIR=/data`, persistence PROVEN across a real container replacement (an earlier doc claiming otherwise was stale) |
| **F2 Driving score** | **SHIPPED** — stop + run scoring, cards, badges, board, distance-to-mark readout v2.17.0, stop marker v2.18.0. Replay/ghost still outstanding |
| **F3 Speed limits** | **SHIPPED v1.1.12–v1.1.14** — curvature-derived profile, HUD limit, lineside speed boards, country-correct signage |
| **F4 Timetables** | **SHIPPED v2.7.0 "The 08:06"** — due times from the line's real speed profile, punctuality read, follows a reversal |
| **F5 Passengers** | **SHIPPED** — demand from real map data, boarding, figures on platforms |
| **F6 Line modes & vehicles** | **PART SHIPPED** — modes v2.12.0, livery tint v2.13.0, mode consists + texture fixes v2.14.0/v2.16.0, per-mode accel/brake feel v2.15.0, TTS announcements v2.5.0. Per-MODEL physics, terrain grade, ferry water, cab overlay, flange squeal outstanding |
| **F7 AI traffic & signals** | **PART SHIPPED** — passing services v2.5.0, block signals v2.11.0. Same-line AI, dispatch spacing and SPAD outstanding |
| **F8 Cameras & exploration** | **PART SHIPPED** — six named views v2.2.0, photo mode saves the photo v2.10.0, Simple/Advanced driving v2.2.0. Walk mode outstanding |
| **F9 World atmosphere** | **PART SHIPPED** — time of day v2.4.0, corrected to the map's own local solar time v2.20.0. Weather and seasons deliberately deferred: overcast is a change to the atmosphere LUT chain and its UBO layout, not a setting |
| **F10 City & discovery** | **PART SHIPPED** — world tour / drive any map from inside the game v2.8.0, line facts v2.6.0, share links v2.21.0. Landmarks, discovery toasts and city stats outstanding |

The interface was rebuilt in v2.1.0–v2.3.0 (`docs/features/ui-2.1/`), which is
where most of the per-feature UI actually landed.

## Suggested build order

1. **F1 Profiles & scores** (foundation — everything persistent needs it)
2. **F6 Line modes & vehicles** (foundation — feeds limits, AI, passengers)
3. **F2 Driving score** + **F3 Speed limits** (the game gets a point)
4. **F4 Timetables** + **F5 Passengers** (the world gets purpose)
5. **F7 AI traffic & signals** (the world gets alive)
6. **F8 Cameras & exploration**, **F9 Atmosphere**, **F10 Discovery**
   (independent; can interleave anywhere after F1)

---

## F1 — Player profiles & score persistence (`01-accounts-and-scores.md`)
- [x] Attach Railway volume at `/data`, set `DATA_DIR=/data`, migrate seed
      data, verify persistence across a redeploy (test file survives)
- [x] Update `docs/DEPLOYMENT.md` (volume now also holds the player database)
- [x] SQLite setup (`better-sqlite3`), schema: profiles/sessions/scores/profile_data
- [x] Server routes: create/login (PIN hash + lockout), `GET /api/me`,
      profile_data KV, `POST /api/scores` (personal-best upsert + history),
      `GET /api/scores` board query, rate limits
- [x] Server unit tests (temp DB): auth, lockout, best-upsert, board order, KV
- [x] Client `ProfileClient.ts` (token storage, offline queue + flush)
- [x] Start-screen "Who's driving?" UI + create/login modal + HUD name chip
- [x] Settings/consist backup + restore-on-login flow
- [x] Local browser validation (profile lifecycle, guest mode, wrong-PIN path)
- [x] Production validation (profile + score survive a redeploy), changelog entry

## F6 — Line modes & vehicles (`06-line-modes-and-vehicles.md`)
- [x] Thread `mode` through MetroDreaminImporter → LineData/ParsedLine
- [x] `LineModes.ts` (mode → base limit, default consist, icon, dwell)
- [x] Line list/picker icons per mode
- [x] Mode default consists in TrainRenderingSystem (2.14.0, bus added 2.16.0)
      — used only when the player has never picked a train. Ferry and air still
      have none: there is no boat or aircraft model in the catalog
- [~] Per-MODE accel/brake feel (2.15.0) — `accelScale`/`brakeScale` on
      `LineModeInfo`, threaded into `TrainInput`; mode top-speed cap done in
      2.12.0. Per-MODEL `performance` metadata in catalog.json is NOT built:
      the feel is per line kind, not per carriage
- [ ] Terrain-grade force in physics
- [ ] Ferry mode (water routes; 1–2 boat GLBs added via existing import flow)
- [~] Cab instruments (speedo dial, notched power lever, brake gauge, DOORS/LIMIT
      lamps) shipped in v2.1.0 — but as the permanent HUD in EVERY view, not a
      Cab-only overlay. The windscreen framing that would make Cab view feel
      like a cab is NOT built
- [~] Hold-to-sustain horn SHIPPED (2.19.0) — press/release on the cab button
      AND the H key, which was mapped but had never been consumed by anything.
      Flange squeal by curvature x speed is NOT built
- [x] TTS station announcements (SpeechSynthesis, voice by locale, settings toggle)
- [x] Livery tint: SlotSpec `#tint=RRGGBB` token + material uniform + composer palette UI
- [~] Unit tests — SlotSpec tint tokens (14) and mode resolution (19) done;
      profiles, grade and announcement text await those features
- [x] Local browser validation (real multi-mode map — SEPTA, 13 regional/4 metro/
      1 light rail, checked against the raw map data; per-car tint incl. an
      untinted car), production validation, changelog entry

## F2 — Driving score (`02-driving-score.md`)
- [x] `StopScorer.ts` state machine (precision/smoothness/doors → points) + unit tests
- [x] Stop marker + HUD distance-to-mark readout (2.17.0 readout, 2.18.0
      marker). The readout's window is TIME (~20 s of running), not a fixed
      distance. The marker was held for one release because it could not be
      seen; the cause was CONTRAST, not placement — see the feature doc
- [x] Stop card UI (verdict + points, 3 s) — unit-tested; wants a human drive
- [x] `RunScorer.ts` (aggregate, terminus/lap finalize incl. loop lines) + unit tests
- [x] Run card UI + personal-best callout
- [x] Score posting to F1 (`run-score`), board display on run card
- [x] Badges: rule list + run-card surfacing (persistence via profile_data pending)
- [ ] Kid-mode + overspeed(F3) + punctuality(F4) integration hooks (drain suppression flags)
- [ ] Phase 2: `RunRecorder` (5 Hz ring) + stop replay (orbit cam) + own-ghost
      translucent consist + unit tests
- [ ] Local browser validation (scripted precise stop, full-line run, loop lap,
      replay screenshot), production validation, changelog entry

## F3 — Speed limits & route ribbon (`03-speed-limits.md`)
- [x] `SpeedProfile.ts` (curvature → limit, smoothing/merging, loop-aware) + unit tests
- [x] `limitAt`/`nextChange` lookups + unit tests
- [ ] Physics: >25% overspeed penalty brake; `SpeedState` (none/amber/red)
- [x] HUD limit chip + approach countdown
- [x] Track-side speed boards (number quads at change points)
- [x] Overspeed → F2 score drain wiring — `ScoringSystem` reads
      `overspeedSeconds` / `seriousOverspeedSeconds` off `SpeedLimitSystem` at
      run end and resets them, and suppresses both in Simple driving
- [~] Route ribbon (v2.1.0) — dots per stop, travelled segments lit, train
      marker, responsive placement. Limit ticks and a loop RING are NOT built
- [ ] Local browser validation (known-curve limits, forced overspeed chain,
      ribbon on straight + loop lines, perf-neutral check),
      production validation, changelog entry

## F4 — Timetables & service (`04-timetables-and-service.md`)
- [x] `Timetable.ts` generator (limits + dwell → arr/dep per station; express
      skip lists; loop continuity) + unit tests
- [x] `ServiceClock.ts` (real | ×10) + MapTimeSystem time-provider hook
- [ ] Service picker ("Drive the 09:12") in the line/station panel
- [x] HUD drift chip (`+0:42`), departure-ready chime, early-door rule
- [ ] Punctuality scoring (per-station window → run card + `punctuality` score kind)
- [ ] `lineGroupId` plumbing + grouped picker + express patterns (ribbon dims skips)
- [ ] Validate against the Israel-railways map's real A1–A5 groups
- [ ] Local browser validation (on-time vs late runs, express skips, service-day sun),
      production validation, changelog entry

## F5 — Passengers (`05-passengers.md`)
- [x] Thread density (`densityInfo`, NOT `grade`) + `interchanges` through the importer
- [x] `PassengerSystem` (accumulation, board/alight on doors, destinations,
      conservation) + unit tests
- [x] HUD PAX (real at last); platform crowd meters in the station panel still pending
- [ ] F2 integration: delivered-passenger component + left-behind note
- [ ] Express/skip handling (no spawn for skipped services)
- [ ] Interchange icons (map overlay + ribbon) + transfer stats
- [x] Platform people (promoted out of phase 2 by operator direction): merged
      per-station meshes, deterministic placement, caps, `models/people`
      catalog category + Sketchfab import + settings panel
- [ ] Local browser validation (PAX flow over two stops, density contrast on the
      Israel map, crowd visuals + FPS), production validation, changelog entry

## F7 — AI traffic & signals (`07-ai-traffic-and-signals.md`)
- [ ] `ConsistRenderer` extraction (player = instance 0; N consists)
- [ ] `AiTrainSystem` (driver policy: limit-following, station stops, dwell,
      reversal/loop) + unit tests
- [ ] Density setting (Off/Light/Normal, hard cap) + frustum culling of consists
- [ ] Perf gate: 4×-throttle profile with AI ≥85% of no-AI fps; density becomes
      governor-aware if not
- [x] `BlockSystem` (blocks, occupancy, aspects) + unit tests
- [x] Signal post meshes + aspect rendering
- [ ] Same-line AI + dispatch spacing; AI obeys signals
- [ ] Player SPAD → penalty brake + run-card note
- [ ] Ambient aircraft (unfilter resources behind the `airTraffic` setting,
      synthetic routes around map centroid)
- [ ] Ambient cars (road segment plumbing from worker, spawn box, instancing,
      caps, tier gating)
- [ ] Local browser validation (passing trains screenshot, aspect timelapse,
      SPAD chain, governor stability with AI on), production validation,
      changelog entry

## F8 — Cameras & exploration (`08-cameras-and-exploration.md`)
- [x] Camera modes Walk/Ride/Photo added to GameCameraSystem (explicit entry
      buttons; cycle untouched for Chase/Cab/Orbit)
- [ ] Walk: `WalkController` (terrain clamp, WASD+drag, mobile dual-zone touch),
      "Step out"/"Return" flow, distance leash toast
- [~] Ride (v2.2.0) — a seat view looking out along the train. Auto-drive is
      NOT built; you are still driving
- [x] Photo: damped flight, FOV slider, HUD hide, PNG screenshot capture path
- [~] Simple / Advanced driving (v2.2.0) — the assist holds the line's own
      limit and eases the controls. Score-drain suppression NOT wired
- [ ] Unit tests (terrain clamp, auto-drive stop accuracy, PNG encoder)
- [ ] Local + mobile-emulation browser validation (all four, screenshots),
      production validation, changelog entry

## F9 — World atmosphere (`09-world-atmosphere.md`)
- [x] MapTimeSystem `TimeProvider` (real | manual | service-day) + time slider UI
- [ ] `WeatherSystem` (state → fog/sunDim/wetness/rain params)
- [ ] Fog term in shading pass; overcast light/shadow softening
- [ ] Rain streak post (tier-gated) + rain/thunder audio + lightning scheduler
- [ ] Wet-road material tweak
- [ ] Seasons: tree tint ramp + winter thinning + frost tint
- [ ] Phase 2: wet-rail braking multiplier + HUD chip + F2 threshold relax
- [ ] Unit tests (params, scheduler bounds, season ramps, wet multiplier)
- [ ] Local browser validation (screenshot matrix: times × weathers × seasons;
      wet-braking harness measurement; perf within 10% on 4× throttle),
      production validation, changelog entry

## F10 — City & discovery (`10-city-discovery.md`)
- [ ] Worker plumb: `notable[]` (tall/named features) into Tile3DBuffers
- [ ] `LandmarkIndex` (top-K by height near corridor + named features) + unit tests
- [ ] `DiscoverySystem` (proximity, toasts, persistence via F1/localStorage)
- [ ] Map-overlay landmark icons (dim/lit)
- [ ] City stats card (buildings/trees/water/line-km/stations, "explored so far")
- [ ] Map browser: SVG thumbnails (refactor overlay renderer), Featured list
      (server-served JSON), richer Recents metadata
- [~] "Drive another map" (v2.8.0) lists the live profile's maps and loads any
      of them mid-game. It is NOT the curated tour with goals and stamps
- [x] Share links (2.21.0) — `?map&line&train`, session-only consist that is
      never written to the saved setup (so no confirm is needed), + 12 unit
      tests. Opens straight into the game, skipping the start screen and the
      release splash
- [ ] Local browser validation (discovery toast, stats plausibility, share
      round-trip in fresh context, tour stamp), production validation,
      changelog entry

---

## Program-wide gates (apply to every section)
- [ ] No feature ships without its unit tests and a local Playwright pass
- [ ] Perf: 4×-throttle profile run (scripts/perf) within 10% of pre-feature
      baseline, or the feature gains a tier/governor gate
- [x] Every release bumps `version.ts` (new CHANGELOG entry + codename) and
      `package.json` together — held for all 34 releases
- [x] Production validation on the live URL after each deploy
- [ ] `docs/WORKLOG-*.md` updated per session; feature doc updated to
      STATUS: SHIPPED with what was actually built
