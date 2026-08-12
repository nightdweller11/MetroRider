# Feature Ideas — Trains & Gameplay

> STATUS: PROPOSAL (2026-08-12). Sources: what makes the big Roblox rail games
> sticky (Stepford County Railway, British railway groups, Rails Unlimited,
> Terminal Railways), classic train sims (Train Sim World, Densha de GO,
> OpenBVE, Derail Valley), and unused data MetroRider already gets from
> MetroDreamin. Each idea notes what it builds on in our code and a rough size.
> (S = a day-ish, M = a few days, L = a week+)

## 1. The core game loop — make driving *score*

Today you drive; nothing pushes back. Every popular train game is built on
the same loop: **drive precisely → get scored → rank up**.

### 1.1 Station stop scoring (S–M) ⭐ start here
We already detect arrivals (`StationManager`, `arriving` + stop distance).
Score each stop like Densha de GO / TSW:
- **Precision**: distance from the platform's stop marker (a target bar the
  player can see) — "Perfect / Good / Overshot".
- **Smoothness**: peak deceleration in the last 100 m (we have per-frame
  speed in `TrainPhysics`).
- **Doors**: opened on a full stop, closed before departing.
Show a small score card on each departure, a line-total at the terminus.
This single feature turns "ride around" into "one more run".

### 1.2 Speed limits + overspeed (M)
Derive limits from track curvature (we have the spline —
`TrackBuilder` curvature per segment) plus a base limit per line mode (see
§3.1). HUD shows current/next limit like TSW; overspeed bleeds score, hard
overspeed triggers emergency brake. Physics change is a clamp — the content
is *displaying* the limit ramp ahead.

### 1.3 Timetables & punctuality (M)
Generate a schedule for the selected line (departure + per-station times from
distance/limits). Score on-time performance; show "+0:42" drift in the HUD.
SCR's entire service structure hangs on this and it needs no new world tech.

### 1.4 Progression: XP, ranks, unlocks (M)
XP from stops/punctuality → ranks (Trainee → Driver → Senior → Inspector,
etc.) stored in localStorage like everything else. Gate *cosmetic* things by
rank: train models, liveries, horns (we already have a model/sound catalog —
the unlock system is a filter over it). This is the #1 retention mechanic in
every Roblox rail game.

## 2. Make the train feel like a train

### 2.1 Passengers that exist (M) ⭐ the PAX HUD says 0 forever
MetroDreamin stations carry `grade` and `densityInfo` — we already parse and
discard them (`MetroDreaminImporter`). Use density as a demand model:
passengers accumulate at stations over time, board on door-open (count
animates), alight by destination share. PAX × distance = score/earnings.
No 3D people needed for v1 — numbers + a platform "crowd meter" first.

### 2.2 Better physics feel (S–M)
One acceleration curve fits all today (`TrainPhysics`: ACCEL 5, no friction).
Per-model performance profiles (mass, accel curve, brake rate, top speed) on
the catalog entry — a steam loco should feel different from a metro EMU.
Add rolling resistance + grade force from terrain height so hills matter.

### 2.3 Cab view upgrades (S)
Cab camera exists. Add a simple 2D cab overlay (speedometer needle,
throttle/brake indicator, door lights) — Densha de GO energy without 3D cab
modeling. Later: per-model cab images.

### 2.4 Sound depth (S)
The audio system already supports per-category samples. Add: speed-pitched
rail clatter (exists) + flange squeal on tight curves (curvature is known),
station announcements built from the next station name via SpeechSynthesis
("Next station: Rothschild") — free TTS, surprisingly transformative.

## 3. Use more of MetroDreamin

### 3.1 Line modes → vehicle classes (S) ⭐ trivially available
MetroDreamin lines carry `mode` (bus/tram/metro/rail/HSR) — parsed and
ignored today (`MDLine.mode`). Map mode → default speed limit + default
consist (tram model for tram lines, HSR for high-speed). Instantly makes
imported maps feel intentional.

### 3.2 Interchanges (S–M)
`fullSystem.map.interchanges` is in the payload we already fetch. Use it to
mark transfer stations on the HUD/route ribbon and (with §2.1) transfer
passenger flows between lines.

### 3.3 Line groups & service patterns (M)
MetroDreamin `lineGroupId` groups branches of one service. Offer "run the A
express" style patterns: skip-stop services on the same track — pairs
naturally with timetables (§1.3).

### 3.4 Map browser upgrades (S)
We list a user's maps. Add: featured/random public maps, a "recently played"
rail, and map metadata (centroid city name via reverse geocode) so the picker
feels like a level select screen.

## 4. World & operations (the SCR-shaped ideas)

### 4.1 AI trains on other lines (L) ⭐ the single biggest "alive" feeling
Run simple AI consists on the *other* lines of the map (constant schedule,
stop at stations). They're just more `TrainRenderingSystem` consists driven
by the same track data — no pathfinding needed since lines are fixed splines.
Passing an oncoming train at speed is the most memorable moment in every
train sim.

### 4.2 Signals (L)
Block signals along the line (red behind an AI train, yellow approach).
SCR's SPAD (signal passed at danger) penalty is their core discipline
mechanic. Needs AI trains first to mean anything.

### 4.3 Day/night + schedule time (S)
`MapTimeSystem` already does sun position; the HUD clock shows real time.
Let a "service day" run at 10× so a full timetable spans a session, with
dawn/dusk lighting for free.

### 4.4 Weather (M)
Rain/fog post effects + reduced adhesion (longer braking — feeds §1.1
scoring). Visual first (fog is one uniform in the shading pass), physics
later.

### 4.5 Route ribbon / minimap (S–M)
A line diagram at the screen edge (stations as dots, train position moving
along it — loop lines render as a circle). We have all distances already
(`realStationDists`). Huge orientation win for kids on long lines.

## 5. Multiplayer-lite (before real multiplayer)

Real-time multiplayer is a server rewrite — don't. Two cheap substitutes:
- **Ghost runs (M)**: record a run (positions over time, localStorage);
  race your own ghost on the same line. Zero server work.
- **Leaderboards (M)**: per-line best scores via one tiny table on the
  existing Express server (it already has persistence patterns). Family
  leaderboard = instant sibling rivalry.

## 6. Creative & quality-of-life

- **Livery tinting (S)**: per-slot color tint multiplied into the model's
  vertex colors — we already pipe `color` attributes; one uniform per car.
- **Photo mode (S)**: hide HUD, free camera (exists as Free mode), FOV
  slider, screenshot button.
- **Replay of the last stop (M)**: reuse ghost recording (§5) for a 15 s
  replay with the orbit camera after a Perfect stop.
- **Horn variations (S)**: hold-to-play-long horn; quill on analog press.
- **Achievements (S–M)**: "Complete a loop line without stopping", "Perfect
  stop streak ×5", "Drive at 03:00" — localStorage, surfaced on the splash.

## Suggested build order (each ships alone)
1. §3.1 line modes + §1.1 stop scoring — the game gets a *point* (1–2 weeks)
2. §1.2 speed limits + §4.5 route ribbon — driving gets *technique*
3. §2.1 passengers + §1.3 timetables — the world gets *purpose*
4. §1.4 progression + achievements — playing gets *retention*
5. §4.1 AI trains → §4.2 signals — the world gets *alive*
