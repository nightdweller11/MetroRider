# F9 — World Atmosphere: Weather, Time Control & Seasons

> STATUS: PLANNED · Pairs with F4's service clock and F8's photo mode.
> Visual-first: physics effects are a small, clearly-marked second phase.

## 1. Product definition

### Time control
- A **time-of-day slider** (in the clock panel that already exists,
  currently collapsible): drag from dawn to night; "now" and "service day"
  (F4) snap buttons. Sun/sky update live — the engine already computes sun
  position from time (MapTimeSystem), we're only exposing control.
  Golden-hour screenshots via F8 photo mode is the killer combo.

### Weather
- Settings + a dice button: Clear / Overcast / Rain / Fog / Storm.
  - **Fog**: distance fog with density presets (cheapest, most transformative
    — hides tile pop-in as a bonus).
  - **Overcast**: sun dimmed, shadows soften (shadow intensity uniform).
  - **Rain**: screen-space rain streaks + darker, slightly reflective roads
    (roughness tweak), rain audio loop.
  - **Storm**: rain + occasional lightning flash (fullscreen brief exposure
    pop + thunder sample, min 20 s apart).
- Phase 2 (physics, gated behind F2/F3 so it means something): wet rail =
  20% longer braking distances; the HUD shows a "wet" chip; scoring expects
  gentler braking. Kid mode ignores it.

### Seasons (lightweight)
- A season selector (Auto-by-date / Spring / Summer / Autumn / Winter):
  - tree color ramp (instanced tree material tint: green → yellow-red →
    bare-ish sparse → green),
  - winter adds subtle ground frost tint at high sun angles.
- No snow accumulation meshes in v1 — tint + fog + light does 80% of it.

## 2. Technical implementation plan

- **Time**: MapTimeSystem gains a `TimeProvider` (real | manual | service-day
  from F4). Slider UI in the existing TimePanel (streets-gl React UI) —
  it already has a collapsed time panel; wire a range input to
  `MapTimeSystem.setManualTime(ms)` (a manual mode partially exists in
  streets-gl's original UI actions — verify and reuse).
- **Weather state**: `src/app/world/WeatherSystem.ts` — one enum + params
  {fogDensity, sunDim, wetness, rainIntensity}; consumed by:
  - fog: shading pass uniform (ShadingPass has atmosphere hooks; add
    exponential height fog term),
  - sun dim / shadow soften: existing light uniforms in ShadingPass/CSM,
  - rain streaks: small fullscreen post in ScreenPass (a 20-line shader,
    intensity uniform; skip on low tier),
  - wet roads: projected-mesh material roughness/darken uniform,
  - audio: AudioSystem loop channel (rain) + one-shot (thunder).
- **Lightning**: WeatherSystem timer → 2-frame exposure pop uniform +
  thunder sample with distance delay.
- **Seasons**: tint uniform on TreeMaterialContainer (per-season ramp
  constants); density thinning for winter uses the F-instance density knob
  (drop LOD1). Ground frost: subtle cold tint mixed in terrain material at
  low sun.
- **Physics phase 2**: `wetness` → brake-force multiplier in PhysicsProfile
  (F6) + F2 smoothness thresholds relaxed; HUD chip.
- All weather params are governed-quality-independent (post effects cheap);
  rain post gated off at low tier.

### Sizing
Time slider: 1 day. Fog+overcast: 1–2 days. Rain+storm: 2 days.
Seasons: 1–2 days. Wet physics: 1 day.

## 3. Testing plan & validation

- **Unit**: WeatherSystem param derivation per state; lightning scheduler
  bounds; season ramp values; wet brake multiplier plumbing.
- **Browser (local)**: slider dawn→noon→night screenshots (sun/sky change);
  each weather state screenshot (fog visibly truncates draw distance, rain
  streaks present, storm flashes within 60 s); seasons change tree color
  (screenshot per season at the same camera); wet chip + longer braking
  measured via harness (stop distance from 80 km/h, dry vs wet).
- **Perf**: profile run in Rain+Fog on 4× throttle — within 10% of Clear
  (post effects must be cheap); low tier: rain post confirmed skipped.
- **Production validation**: Playwright — weather selector on live, fog and
  rain screenshots, no console errors, governor stable in storm.
