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
- [ ] Attach Railway volume at `/data`, set `DATA_DIR=/data`, migrate seed
      data, verify persistence across a redeploy (test file survives)
- [ ] Update `docs/DEPLOYMENT.md` (volume replaces the sync-script mandate)
- [ ] SQLite setup (`better-sqlite3`), schema: profiles/sessions/scores/profile_data
- [ ] Server routes: create/login (PIN hash + lockout), `GET /api/me`,
      profile_data KV, `POST /api/scores` (personal-best upsert + history),
      `GET /api/scores` board query, rate limits
- [ ] Server unit tests (temp DB): auth, lockout, best-upsert, board order, KV
- [ ] Client `ProfileClient.ts` (token storage, offline queue + flush)
- [ ] Start-screen "Who's driving?" UI + create/login modal + HUD name chip
- [ ] Settings/consist backup + restore-on-login flow
- [ ] Local browser validation (profile lifecycle, storage-wipe recovery, guest mode)
- [ ] Production validation (profile + score survive a redeploy), changelog entry

## F6 — Line modes & vehicles (`06-line-modes-and-vehicles.md`)
- [ ] Thread `mode` through MetroDreaminImporter → LineData/ParsedLine
- [ ] `LineModes.ts` (mode → base limit, default consist, icon, dwell)
- [ ] Line list/picker icons per mode
- [ ] Mode default consists in TrainRenderingSystem (when user is all-default)
- [ ] `PhysicsProfile` per catalog model (+ `performance` metadata in
      catalog.json) replacing TrainPhysics constants; mode top-speed cap
- [ ] Terrain-grade force in physics
- [ ] Ferry mode (water routes; 1–2 boat GLBs added via existing import flow)
- [ ] Cab overlay (speedo needle, throttle/brake, doors; Cab camera only)
- [ ] Sound: flange squeal by curvature×speed; hold-to-sustain horn
- [ ] TTS station announcements (SpeechSynthesis, voice by locale, settings toggle)
- [ ] Livery tint: SlotSpec `#tint=RRGGBB` token + material uniform + composer palette UI
- [ ] Unit tests (SlotSpec tokens, mode resolution, profiles, grade, announcement text)
- [ ] Local browser validation (multi-mode fixture map; accel-feel harness measurements;
      tint + flip persistence), production validation, changelog entry

## F2 — Driving score (`02-driving-score.md`)
- [ ] `StopScorer.ts` state machine (precision/smoothness/doors → points) + unit tests
- [ ] Stop marker visuals + HUD distance-to-mark readout
- [ ] Stop card UI (verdict + points, 3 s)
- [ ] `RunScorer.ts` (aggregate, terminus/lap finalize incl. loop lines) + unit tests
- [ ] Run card UI + personal-best callout
- [ ] Score posting to F1 (`run-score`), board display on run card
- [ ] Badges: rule list + `BadgeService` + persistence + splash/run-card surfacing
- [ ] Kid-mode + overspeed(F3) + punctuality(F4) integration hooks (drain suppression flags)
- [ ] Phase 2: `RunRecorder` (5 Hz ring) + stop replay (orbit cam) + own-ghost
      translucent consist + unit tests
- [ ] Local browser validation (scripted precise stop, full-line run, loop lap,
      replay screenshot), production validation, changelog entry

## F3 — Speed limits & route ribbon (`03-speed-limits.md`)
- [ ] `SpeedProfile.ts` (curvature → limit, smoothing/merging, loop-aware) + unit tests
- [ ] `limitAt`/`nextChange` lookups + unit tests
- [ ] Physics: >25% overspeed penalty brake; `SpeedState` (none/amber/red)
- [ ] HUD limit chip + approach countdown
- [ ] Track-side speed boards (number quads at change points)
- [ ] Overspeed → F2 score drain wiring
- [ ] Route ribbon (DOM/SVG; dots, train marker, limit ticks; ring for loops;
      mobile collapse)
- [ ] Local browser validation (known-curve limits, forced overspeed chain,
      ribbon on straight + loop lines, perf-neutral check),
      production validation, changelog entry

## F4 — Timetables & service (`04-timetables-and-service.md`)
- [ ] `Timetable.ts` generator (limits + dwell → arr/dep per station; express
      skip lists; loop continuity) + unit tests
- [ ] `ServiceClock.ts` (real | ×10) + MapTimeSystem time-provider hook
- [ ] Service picker ("Drive the 09:12") in the line/station panel
- [ ] HUD drift chip (`+0:42`), departure-ready chime, early-door rule
- [ ] Punctuality scoring (per-station window → run card + `punctuality` score kind)
- [ ] `lineGroupId` plumbing + grouped picker + express patterns (ribbon dims skips)
- [ ] Validate against the Israel-railways map's real A1–A5 groups
- [ ] Local browser validation (on-time vs late runs, express skips, service-day sun),
      production validation, changelog entry

## F5 — Passengers (`05-passengers.md`)
- [ ] Thread `density`/`grade` + `interchanges` through the importer
- [ ] `PassengerSystem` (accumulation, board/alight on doors, destinations,
      conservation) + unit tests
- [ ] HUD PAX (real at last), platform crowd meters (station panel + ribbon)
- [ ] F2 integration: delivered-passenger component + left-behind note
- [ ] Express/skip handling (no spawn for skipped services)
- [ ] Interchange icons (map overlay + ribbon) + transfer stats
- [ ] Phase 2: instanced platform people (2–4 GLB variants, deterministic
      placement, thresholds, caps) + perf check
- [ ] Local browser validation (PAX flow over two stops, density contrast on the
      Israel map, crowd visuals + FPS), production validation, changelog entry

## F7 — AI traffic & signals (`07-ai-traffic-and-signals.md`)
- [ ] `ConsistRenderer` extraction (player = instance 0; N consists)
- [ ] `AiTrainSystem` (driver policy: limit-following, station stops, dwell,
      reversal/loop) + unit tests
- [ ] Density setting (Off/Light/Normal, hard cap) + frustum culling of consists
- [ ] Perf gate: 4×-throttle profile with AI ≥85% of no-AI fps; density becomes
      governor-aware if not
- [ ] `BlockSystem` (blocks, occupancy, aspects) + unit tests
- [ ] Signal post meshes + aspect rendering
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
- [ ] Camera modes Walk/Ride/Photo added to GameCameraSystem (explicit entry
      buttons; cycle untouched for Chase/Cab/Orbit)
- [ ] Walk: `WalkController` (terrain clamp, WASD+drag, mobile dual-zone touch),
      "Step out"/"Return" flow, distance leash toast
- [ ] Ride: interior camera + auto-drive (F7 driver policy on player train,
      manual-input override)
- [ ] Photo: damped flight, FOV slider, HUD hide, PNG screenshot capture path
- [ ] Kid mode: toggle, button scale, auto-throttle assist, score-drain
      suppression (flags consumed by F2/F3)
- [ ] Unit tests (terrain clamp, auto-drive stop accuracy, PNG encoder)
- [ ] Local + mobile-emulation browser validation (all four, screenshots),
      production validation, changelog entry

## F9 — World atmosphere (`09-world-atmosphere.md`)
- [ ] MapTimeSystem `TimeProvider` (real | manual | service-day) + time slider UI
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
- [ ] World Tour tab (curated JSON, goals, stamps in profile_data)
- [ ] Share links (`?map&line&consist` parse/apply, session-only consist,
      confirm before overwriting saved setup) + unit tests
- [ ] Local browser validation (discovery toast, stats plausibility, share
      round-trip in fresh context, tour stamp), production validation,
      changelog entry

---

## Program-wide gates (apply to every section)
- [ ] No feature ships without its unit tests and a local Playwright pass
- [ ] Perf: 4×-throttle profile run (scripts/perf) within 10% of pre-feature
      baseline, or the feature gains a tier/governor gate
- [ ] Every release bumps `version.ts` (new CHANGELOG entry + codename) and
      `package.json` together
- [ ] Production validation on the live URL after each deploy
- [ ] `docs/WORKLOG-*.md` updated per session; feature doc updated to
      STATUS: SHIPPED with what was actually built
