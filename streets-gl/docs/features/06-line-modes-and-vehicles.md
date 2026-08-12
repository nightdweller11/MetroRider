# F6 — Line Modes, Vehicle Classes & Feel (buses, trams, boats, cab, sound, liveries)

> STATUS: PLANNED · Foundation for F3 (mode base limits) and F7 (AI vehicle
> types). Unifies: line modes, per-model physics, buses/trams, ferries,
> cab overlay, sound depth, horn variations, livery tinting.

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
