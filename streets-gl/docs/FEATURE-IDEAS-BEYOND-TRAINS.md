# Feature Ideas — Beyond Trains

> STATUS: PROPOSAL (2026-08-12). Non-train directions for MetroRider. The big
> insight: we're sitting on a full 3D mirror of the real world (streets-gl:
> real buildings, roads, terrain, water, trees, even a dormant aircraft
> system) — the train is just the first vehicle we put in it.
> Sizes: S = a day-ish, M = a few days, L = a week+.

## 1. Other vehicles on the same rails (cheap wins first)

### 1.1 Buses & trams from MetroDreamin modes (M) ⭐ closest to free
MetroDreamin lines have a `mode` field — bus and tram lines are common in the
maps people build (we import and ignore the distinction). A bus line is just
a consist of one bus model following the same spline with road-ish speeds; we
already have `generic-town-bus.glb` in the catalog and tram models
(`train-tram-*`). Ship "drive the bus route" with zero new engine systems.

### 1.2 Boats & ferries (M)
Water polygons render already. A ferry line drawn over water in MetroDreamin
becomes a boat route: same spline-following, a wake particle later. Great fit
for coastal maps (Tel Aviv, Istanbul, Hong Kong style maps).

### 1.3 Planes — wake the dormant aircraft system (M–L)
streets-gl ships a whole `VehicleSystem` with aircraft models
(B777, A321, Cessna, helicopters) that we currently skip loading
(`ResourceLoader.addFromJSON` filters `aircraft*`). Re-enable as ambient
traffic first (they originally flew live air-traffic routes), then as a
flyable "helicopter tour" camera over your metro map — a kid-favorite way to
see the whole network.

### 1.4 Cars/ambient road traffic (L)
Roads exist as geometry. Simple ambient cars following road polylines
(no intersections logic v1 — spawn, drive a segment chain, despawn) make the
city feel inhabited from the cab window. Costly to do *well*; do after §3.

## 2. Get out of the train

### 2.1 Walk mode at stations (M–L) ⭐ the most-requested thing in every train game
First-person walking on the platform and around the station block: reuse the
existing Free camera with gravity + terrain height clamp (the height provider
is per-frame queryable). Board/exit through the working doors. Suddenly the
stations you stop at are *places* — and it unlocks §2.2/§4.
Roblox rail games live off this (riding as a passenger is half of SCR).

### 2.2 Ride as a passenger (S after 2.1)
Sit the camera in a car (interior-ish view), watch the world go by while the
AI (or a ghost recording) drives. Restful mode for younger kids; pairs with
in-train announcements.

### 2.3 Drone/photo flight (S)
Free camera already exists — package it: speed presets, FOV control, HUD off,
screenshot button, "return to train". A safe sandbox "explore the city" mode.

## 3. The city as a playground

### 3.1 Landmarks & discovery (M)
We render real buildings; OSM tags flow through the pipeline (picking shows
building info on the map today). Curate per-map "landmarks" (tallest
building, stadium, port…) and award discovery badges when the train passes or
the player walks/flies to them. Turns any imported city into a scavenger hunt.

### 3.2 City stats & dioramas (S–M)
A "city card" per map: building count, line lengths, tallest structure,
land/water ratio — computed from loaded tiles. Kids love numbers about *their*
city. Cheap and it makes importing new maps rewarding by itself.

### 3.3 Time & seasons (S–M)
`MapTimeSystem` already moves the sun. Expose a time slider (golden-hour
screenshots!), then seasonal palettes (tree color ramp, snow albedo above a
latitude/date) as pure shader tints.

### 3.4 Mini map-editor overlays (M)
Not a MetroDreamin replacement — just in-game stickers: place station name
signs, route totems, benches from the existing station-model catalog along
platforms. Persist per-map in localStorage like everything else.

## 4. People (the biggest "alive" multiplier, after AI trains)

### 4.1 Passenger dots → simple pedestrians (M → L)
Phase 1: crowd meters on platforms (see trains doc §2.1) — numbers only.
Phase 2: instanced low-poly people standing/pooling on platforms (the
instancing pipeline for trees handles thousands of static instances today).
Phase 3: walking to doors on arrival. Stop at phase 2 for a long time — it
already reads as "people are waiting for MY train".

## 5. Meta / platform ideas

### 5.1 Session share-links (M)
Encode map URL + line + consist in the URL hash (camera state is already
hash-persisted). "Look at my train on my map" — one link, huge for a family +
friends loop, no accounts.

### 5.2 A "world tour" campaign (M)
A curated playlist of public MetroDreamin maps (Tokyo-like, London-like,
fantasy loops…) with one goal each ("run the circle line on time"). Gives
structure to the content that already exists for free on MetroDreamin.

### 5.3 Kid mode (S)
One toggle: bigger buttons, auto-throttle assist (train drives, kid does
doors + horn), no scoring penalties. Widens the audience to younger siblings.

## What NOT to do (for now)
- **Real-time multiplayer** — a server + netcode rewrite; ghosts and
  leaderboards (trains doc §5) capture most of the fun at ~5% of the cost.
- **Combat/destruction anything** — fights the calm-builder identity shared
  with MetroDreamin, and the physics/audio budget is better spent on trains.
- **Procedural fictional cities** — the magic of this game is *real places*;
  MetroDreamin already covers "fantasy maps on real geography".

## Suggested order
1. §1.1 buses/trams (uses data we already parse)
2. §2.3 drone mode + §3.3 time slider (tiny, high delight)
3. §2.1 walk mode (the identity-expanding one)
4. §4.1 phase 1–2 people + §3.1 landmarks
5. §1.3 aircraft ambience, §5.2 world tour
