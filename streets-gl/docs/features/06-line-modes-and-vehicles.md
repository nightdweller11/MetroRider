# F6 — Line Modes, Vehicle Classes & Feel (buses, trams, boats, cab, sound, liveries)

> STATUS: PART SHIPPED · **Line modes in 2.12.0 "Bus, Tram, Train"**, **livery
> tint in 2.13.0 "Your Colours"**, TTS announcements in 2.5.0. Still planned:
> per-model physics profiles, terrain grade, ferry water routes, cab overlay,
> flange squeal + sustained horn. Foundation for F3 (mode base limits) and F7.
>
> ### What shipped in 2.13.0 — livery tint
>
> | Piece | Where |
> |---|---|
> | `#tint=rrggbb` token, order-tolerant in, canonical out | `src/app/game/assets/SlotSpec.ts` |
> | Per-mesh paint | `TrainMeshObject.tint` ← `TrainRenderingSystem.tintBuffer` |
> | Uniform + shader | `TrainMaterialContainer` `tintColor`, `train.frag` **and `train.vert`** |
> | Palette UI | `src/settings/TrainComposer.tsx` (`LIVERY_COLOURS`) + `settings.css` |
> | Tests | `src/__tests__/slotSpec.test.ts` (14) |
>
> **Not a multiply.** Multiplying the model's colour by the tint carries the
> original with it — the same red reads as dark mush on a grey carriage and as
> pure red on a white one. The shader keeps each pixel's BRIGHTNESS and
> replaces its colour, so a lit panel becomes the full livery colour, a shaded
> one a darker version of it, and a window or wheel stays dark. Strength is
> 0.82, not 1.0: at full strength every panel line and logo collapses into one
> flat colour and the carriage stops looking like a carriage.
>
> **The trap that cost the most time — and it was already labelled.** A GLSL
> uniform block must be declared identically in EVERY stage. `tintColor` went
> into `train.frag` only, so the program failed to link with *"Field numbers of
> uniform block 'MainBlock' differ between VERTEX and FRAGMENT shaders"*, the
> material had no `MainBlock` at all, and the train rendered as flat untextured
> boxes. `train.vert` already carried a comment about this exact failure from a
> previous addition (`hasTexture`); the comment now says so in stronger terms.
> Compounding it, the first browser check was reading a CACHED bundle and
> showed the *previous* build's symptoms — always force a fresh load when
> validating a rebuild.
>
> **Validation.** Painted whole-train green (shading, grille and windows all
> survive); then red / green / **untinted** / yellow across four cars — the
> untinted third car is the proof that no paint leaks from one draw to the
> next, since the uniform block persists between them and is cleared
> explicitly. Track, stations and passing trains stay unpainted. Screenshots in
> `docs/features/_artifacts/livery-tint-2026-08-14/`.
>
> ### What shipped in 2.12.0 — and what the real data turned out to be
>
> The mode keys were **read off three published maps before the module was
> written**, not assumed: `BUS` `TRAM` `LIGHT` `RAPID` `REGIONAL` `HSR`
> `FERRY` `GONDOLA` `AIR`, with the field **absent** on many lines (30 of
> London Underground's 56). Absent means rapid transit — on that map the
> mode-less lines are the Underground lines themselves.
>
> | Piece | Where |
> |---|---|
> | Mode table (label, icon, top speed, floor, dwell, signage) | `src/app/game/data/LineModes.ts` |
> | `parseLineMode` / `lineModeInfo` / `inferLineMode` | same file |
> | Threading | `MetroDreaminImporter` → `LineData.mode` → `ParsedLine.mode` |
> | Speed ceiling + floor per mode | `SpeedLimitSystem.update` (before the profile is built) |
> | Dwell per mode | `ServiceSystem` → `buildTimetable(..., dwellS)` |
> | Picker + line facts | `GameUISystem.showLinePicker` / `openLineFactsSheet` |
> | Tests | `src/__tests__/lineModes.test.ts` (19) |
>
> **Two things the build corrected.** (1) The profile's default floor is
> 40 km/h, which is *above* a bus route's ceiling and well above a cable car's
> — left alone every stop would have been posted faster than the line's own
> maximum, so the floor moves with the ceiling. (2) The mode icon inline in
> the subtitle inherited 11.5 px muted grey and three different modes were
> indistinguishable; it gets its own larger span (`SheetRow.subtitleIcon`).
>
> **Validation (local browser, SEPTA Regional Rail map).** The raw map data
> was probed independently first — 13 `REGIONAL`, 4 `RAPID`, 1 `LIGHT` — and
> the picker then showed exactly 13 Regional train / 4 Metro / 1 Light rail.
> Driving the light-rail line posted `LIMIT 50` with the dial topping out at
> 120; the regional lines posted `LIMIT 100` with a 160 dial. Screenshots in
> `docs/features/_artifacts/line-modes-2026-08-14/`.
>
> **Known gap:** `AIR` and `GONDOLA` lines are labelled honestly but still
> driven as track. A ferry follows its route on the water surface only as
> well as the terrain height happens to allow — real water-following is the
> unshipped ferry item below.
>
> ### What shipped in 2.14.0 — mode default consists, and a texture bug
>
> `LineModeInfo.consist` names the vehicles a kind of line runs, and
> `TrainRenderingSystem.slotsForCurrentLine()` uses it **only when the player
> has never picked a train** (`AssetConfigSystem.hasUserTrainChoice()` — the
> same signal `rebuildMergedConfig` already used to let user slots beat server
> slots). A chosen consist is a choice and is never overridden. The mode is
> derived from the line inside that method rather than read off
> `SpeedLimitSystem`, so it does not depend on system update order on the frame
> the line changes. All four slot-read sites go through it, including the
> config poll — which is what makes the vehicle swap when you switch lines.
>
> A `lineModes.test.ts` case asserts every id in the table exists in the
> shipped `catalog.json`; a mode naming a missing model would render grey
> boxes, and the runtime guard (`hasTrainModel`) falls back rather than doing
> that.
>
> **The texture bug this uncovered.** Chasing a black bus found that the loader
> BAKED the base-colour map into vertex colours *and* the shader sampled the
> same map per fragment — so every textured model had its texture applied
> **twice** and its colours squared. A mid-dark panel at 0.3 came out at 0.09.
> Fixed by pushing the material's factor (not the baked sample) for parts that
> will sample the map per fragment; the before/after screenshots show every
> model brighter and more detailed. A companion fix adds a per-vertex
> `texFlag`, because a merged mesh keeps ONE image while a model can have many
> materials: the untextured parts were sampling that one image at their
> filled-in uv of (0, 0).
>
> **The bus is still not shipped as a default, and that is deliberate.**
> `generic-town-bus` has 20 materials and 2 images across 34 primitives; both
> fixes above helped it (its shape and windows now read) but it still comes out
> near-black in game while its own preview is correct — the single-texture
> merge cannot represent it. A bus route therefore gets bus speeds, bus dwell,
> the bus label and the bus icon, and keeps the player's train. Shipping a
> black slab labelled "bus" would be worse than not shipping a bus.
> Screenshots — including the bus rendering black beside two models that render
> correctly under the same sun — in
> `docs/features/_artifacts/mode-consists-2026-08-14/`.

## 1. Product definition

### Line modes → vehicle classes
- MetroDreamin lines carry a `mode` (bus / tram / metro / rail / HSR / ferry —
  parsed and ignored today). Each mode gets:
  - a **base speed limit** (bus 50, tram 60, metro 90, rail 160, HSR 300,
    ferry 35) feeding F3;
  - a **default consist** (bus → `generic-town-bus`, tram → `train-tram-*`,
    ferry → boat model, HSR → bullet set) used when the player hasn't
    customized;
  - an icon in the line list/picker (🚌 🚋 🚇 🚆 🚄 ⛴).
- Driving a bus or ferry line is the SAME game (follow the route, stop at
  stops) with the right vehicle, speeds and sounds — this instantly makes
  hundreds of existing MetroDreamin maps playable as intended.

### Per-model physics profiles ("feel")
- Each catalog model gets `performance` metadata: mass class, acceleration
  curve, brake rate, top speed. A steam loco crawls to speed; a metro EMU
  snaps. Terrain grade affects acceleration (height data exists).
- Defaults per model family; overridable per entry in the asset catalog
  (admin-editable JSON, no code change to tune).

### Cab overlay
- Cab camera gains a 2D overlay: speedometer needle, limit chip (F3),
  throttle/brake indicator, door lights — Densha-de-GO energy without 3D cab
  modeling. Toggleable; off by default in other cameras.

### Sound depth
- Flange squeal on tight curves (curvature known from F3's SpeedProfile),
  volume scaled by speed.
- **Station announcements** via SpeechSynthesis: "Next station: Rothschild"
  on departure, "This is Rothschild" on arrival — free TTS, language from
  the map's station names (Hebrew names use the he-IL voice when available).
  Toggle in sound settings.
- Horn: hold-to-sustain (long press = long horn) with attack/loop/tail
  segments when the sample supports it; short tap = short horn.

### Livery tinting
- Per-car color tint in the train composer (a small palette + custom color),
  multiplied into vertex colors — one uniform per car, works on every model.
  Stored in the slot string (`modelId#flip#tint=ff5522` — extend SlotSpec).

## 2. Technical implementation plan

- **Modes**: `MetroDreaminImporter` threads `mode` → `LineData/ParsedLine`
  (one field). `src/app/game/data/LineModes.ts`: mode → {baseLimit,
  defaultConsistIds, icon, dwellSec}. `TrainSystem.selectLine` passes base
  limit to F3's SpeedProfile; `TrainRenderingSystem` uses mode default
  consist when user slots are all-default; GameUISystem line rows show icons.
- **Physics profiles**: catalog entries gain optional
  `performance {accel, brake, topSpeed, massClass}`
  (`data-seed/assets/catalog.json`; served as-is). `TrainPhysics` becomes
  instance-configured (replace module constants with a `PhysicsProfile`
  resolved from the FIRST car of the consist + mode cap); grade force =
  `g·sin(slope)` from terrain height sampling fore/aft (already sampled for
  rendering).
- **Ferry**: mode ferry → water-following is identical spline-following;
  vehicle height uses water level (terrain height already returns it);
  a wake is out of scope v1. Needs 1–2 boat GLBs added to the catalog
  (Sketchfab import flow exists).
- **Cab overlay**: `CabOverlay.ts` DOM layer shown when
  `GameCameraSystem.mode === Cab`; needle = CSS rotate driven at 10 Ex Hz from
  `getSpeedKmH` (no per-frame DOM writes).
- **Sound**: `AudioSystem` gains `playFlange(intensity)` (procedural filtered
  noise or a sample, gain by curvature×speed); `speak(text)` wrapper with
  voice pick + queue + settings gate; horn press/release API replacing the
  single-shot call (buttons already track press state).
- **Tint**: SlotSpec grows `#tint=RRGGBB` token (backward compatible);
  `TrainMaterialContainer` gains a per-mesh tint uniform;
  composer UI: palette row on the slot card.

### Sizing
Modes+icons+default consists: 1–2 days. Physics profiles+grade: 2 days.
Cab overlay: 1–2 days. Sounds: 1–2 days. Tint: 1 day. Ferry: 1 day + assets.

## 3. Testing plan & validation

- **Unit**: SlotSpec tint token round-trip + legacy strings; LineModes
  resolution; PhysicsProfile application (accel curves differ, top speed
  capped by mode); grade force sign; announcement text builder (RTL names).
- **Browser (local)**: load a map with bus+tram+rail lines (make a small
  MetroDreamin fixture) — icons correct, default consists switch per line,
  speeds capped per mode; steam loco vs EMU acceleration visibly different
  (measure time to 60 via harness); cab overlay needle matches HUD; TTS
  speaks next station (assert utterance queued); tinted car renders
  (screenshot).
- **Production validation**: Playwright on live — pick a tram line on a real
  map, confirm tram consist + 60 cap + icon; a tinted, flipped car survives
  reload (slot string persistence).
