# F8 — Cameras & Exploration: Walk Mode, Passenger Ride, Photo/Drone, Kid Mode

> STATUS: PLANNED · Independent of other features (pairs well with F5 crowds
> and F10 landmarks once those exist).

## 1. Product definition

### Walk mode
- At any station stop (doors open), a "🚶 Step out" button: first-person
  walking on and around the platform — look around, walk the street, find
  the entrance. "Return to train" re-boards (the train WAITS — no stranding;
  it's an exploration pause, not a mechanic).
- Controls: WASD/left stick + look (mouse drag / touch drag), walk 1.6 m/s,
  run ×2.5. Terrain-clamped with a human eye height; simple building
  collision (can't walk through walls) v2 — v1 allows clipping (kid-safe,
  zero frustration).

### Passenger ride
- "Ride along" mode: sit inside the train (camera at window height inside
  car 2), watch the world; the train follows the F4 timetable automatically
  (auto-drive: the AI driver policy from F7 drives YOUR train). Restful mode,
  and the younger-sibling mode.

### Photo / drone mode
- One polished mode replacing the raw Free camera: HUD hides, smooth flight
  (accel/damping), FOV slider, time-of-day slider (ties to F9), screenshot
  button (downloads PNG named `metrorider-<map>-<date>.png`), "return to
  train". Enter via camera cycle or 📷 button.

### Kid mode
- One toggle in settings: bigger touch buttons (1.4×), auto-throttle assist
  (train accelerates/brakes to limits automatically — the kid does doors,
  horn and stops via a single "stop at next station" button), no score
  drains (F2/F3 penalties display as gentle hints), simpler HUD.

## 2. Technical implementation plan

- `GameCameraSystem` gains modes `Walk`, `Ride`, `Photo` beside
  Chase/Cab/Orbit (mode enum + update methods; cycle order configurable —
  Walk/Ride enter via explicit buttons, not the cycle).
- **Walk**: `WalkController.ts` — position + yaw/pitch, terrain height clamp
  (`terrainHeightProvider.getHeightGlobalInterpolated` + 1.7 m), input reuse
  (InputHandler WASD + pointer drag from GameCameraSystem's existing drag
  handling), mobile: left-half virtual stick / right-half look. Spawn beside
  the door of car 1; "return" button always on screen; auto-return if >400 m
  away ("the train is leaving!" toast after 3 min, then it doesn't actually
  leave — toast only).
- **Ride**: camera at an offset inside car 2 (`getCarPosition` transform +
  lateral window offset); auto-drive = F7's driver policy applied to the
  player's `physicsState` (flag on TrainSystem, off on any manual input).
- **Photo**: extend Free camera with damping + FOV uniform (CameraFOVZoomFactor
  plumbing exists), `canvas.toBlob` screenshot (needs
  `preserveDrawingBuffer: false`-safe capture — render one frame to a copy
  FBO, or temporarily set preserveDrawingBuffer at context creation behind
  the button… simplest reliable: read pixels from the final ScreenPass
  target into a 2D canvas). HUD hide = `#game-hud` visibility toggle.
- **Kid mode**: settings toggle; auto-throttle = same driver policy with
  manual override priority; button scale CSS var on the HUD; score-drain
  suppression flags into F2/F3.

### Sizing
Walk: 3 days (mobile input is half). Ride+auto-drive: 2 days.
Photo: 1–2 days. Kid mode: 1–2 days.

## 3. Testing plan & validation

- **Unit**: walk terrain clamp (never below ground on synthetic heights);
  auto-drive stop accuracy (reuses F7 policy tests); screenshot encoder
  produces a decodable PNG of canvas size.
- **Browser (local)**: step out at a station → walk 100 m → screenshots show
  ground-level city; return re-boards and drive resumes; Ride mode follows
  timetable hands-off for 2 stations; Photo mode hides HUD + saves a PNG
  (verify download); Kid mode: buttons grow, auto-throttle drives to next
  station and stops.
- **Mobile emulation**: walk-mode touch sticks on an emulated phone (DPR 2
  profile), buttons reachable, FPS within tier expectations.
- **Production validation**: Playwright — each mode entered/exited on live
  without console errors; screenshots of walk + photo mode; auto-quality
  governor unaffected by mode switches.
