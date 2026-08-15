# F10 — City & Discovery: Landmarks, City Stats, Map Browser, World Tour, Share Links

> STATUS: PLANNED · Depends on: F1 for persisting discoveries; standalone
> otherwise. Turns imported cities into places worth exploring.

## 1. Product definition

### Landmarks & discovery
- Each map gets **landmarks**: the tallest building, stadiums, ports, parks,
  bridges — derived automatically from OSM data already in the tiles (no
  hand-curation needed; optional curated extras for famous maps).
- Passing near a landmark (driving, or on foot/drone via F8) "discovers" it:
  a toast + an entry in the map's discovery list (shown on the 🗺 overlay as
  small icons — dim until discovered). Discoveries persist per profile (F1).
- No rewards beyond the collection itself (fits the no-progression rule).

### City stats ("your city card")
- A card per map (button on the 🗺 overlay): building count, total line km,
  station count, tallest structure discovered, land/water ratio, trees
  rendered — computed from loaded tiles + map data. Kids love numbers about
  THEIR city; makes importing new maps rewarding by itself.

### Map browser upgrades
- Start-screen upgrades: "Recently played" rail (exists as Recent — add
  thumbnails: line-map SVG minis rendered from map data), a Featured list
  (curated JSON of great public MetroDreamin maps), and map metadata
  (lines/stations count — already shown for user maps; add to recents).

### World tour (curated single-player "campaign")
- A "World Tour" tab on the start screen: ~10 curated public maps, each with
  one goal ("Complete the circle line", "Drive the airport express on time
  — needs F4"). Completion = a stamp on the tour card (records only, no
  unlock gating). Ships as a JSON the server serves so tours update without
  redeploys.

### Share links
- "Share this" button (start card + map overlay): URL encoding map + line +
  consist (`?map=<mdId>&line=<id>&consist=<slots>`); opening it loads
  everything and shows "X shared this setup with you". No accounts involved,
  no server state — pure URL.

## 2. Technical implementation plan

- **Landmark extraction**: `src/app/game/discovery/LandmarkIndex.ts` — as
  tiles load, scan `buildingOffsetMap`-adjacent OSM attributes… building
  heights are available in the worker's Tile3D features; simplest robust v1:
  landmarks = top-5 tallest buildings within 1 km of the line corridor
  (height from extruded feature data, captured at tile-parse in the worker
  and shipped in `Tile3DBuffers` as a tiny `notable[]` list: {lat, lng,
  height, osmTags(name)}). Named OSM features (stadium/port/park with a
  `name` tag) added where tags survive the pipeline (verify in worker;
  if stripped, phase 2 plumbs them).
- **Discovery**: `DiscoverySystem` — proximity check (train/walk/drone
  position vs landmark, 250 m) at 1 Hz; toast + persist
  (`profile_data['discoveries:<map>']` or localStorage for guests); icons on
  the map overlay SVG (F-existing) with dim/lit states.
- **City stats**: counters aggregated from loaded tiles (buildings, trees =
  instance counts; water ratio from hugging-mesh area share) + map data
  (line km from `track.totalLength` sums, station count). Card UI on the
  map overlay; values marked "explored so far" (they grow as tiles load —
  honest framing).
- **Map browser**: mini-map SVG thumbnails = the v1.1.2 overlay renderer
  refactored into a reusable `renderMapThumbnail(mapData, w, h)`; Featured +
  World Tour JSONs served from `DATA_DIR/config/` (admin-editable);
  tour progress in profile_data.
- **Share links**: extend the existing URL-hash camera code path — parse
  `?map&line&consist` on boot in GameUISystem (map loads exist), apply
  consist via AssetConfigSystem user overrides (session-only — do NOT
  overwrite the visitor's saved consist without a confirm).

### Sizing
Landmarks+discovery: 3 days (worker plumb is half). City stats: 1–2 days.
Browser upgrades: 1–2 days. World tour: 1–2 days. Share links: 1 day.

## 3. Testing plan & validation

- **Unit**: landmark selection (top-K by height, corridor filter);
  discovery proximity + persistence round-trip; thumbnail renderer output
  (station/line counts in SVG); share-link encode/parse round-trip incl.
  flipped/tinted consist tokens; tour progress marking.
- **Browser (local)**: drive past the tallest-building landmark → toast +
  lit icon on overlay (screenshots); city card numbers plausible on the
  Tel Aviv sample (assert > 0 and stable shape); share link opened in a
  fresh context loads the same map/line/consist (assert slots) without
  overwriting saved config; world tour stamp after completing a goal map.
- **Production validation**: Playwright — discovery toast on live, share
  link round-trip on the deployed URL, featured list renders; screenshots.

---

## Share links (2.21.0)

A parent sending their child a URL that opens the exact map, line and train
they were just looking at — rather than "load London, then find the Circle
line, then set the carriages".

| Piece | Where |
|---|---|
| Parse + build (pure, no DOM) | `src/app/game/data/ShareLink.ts` |
| Applying an incoming link | `GameUISystem.applyRideLink` (called from `postInit`) |
| Session-only consist | `GameUISystem.sessionConsist()` → `TrainRenderingSystem.slotsForCurrentLine()` |
| "Copy a link to this ride" | `GameUISystem.copyRideLink`, menu row |
| Tests | `src/__tests__/shareLink.test.ts` (12) |

Format: `?map=<metrodreamin id>&line=<index>&train=<slot,slot,…>`.

**A link never changes the train you built.** Its consist is applied for the
session only and is never written to the saved setup, which is also why there
is no "are you sure?" prompt — there is nothing to overwrite. It sits at the
top of the same `slotsForCurrentLine()` resolution the mode defaults use:
shared link → the player's own choice → the line's mode default → configured.

**A link is untrusted input**, so the parser caps the consist at 12 cars and
each slot at 120 characters; without that, a URL asking for ten thousand
carriages would take the tab down, and it would be handed to a child.

**Two things the build corrected**, both found by opening a link rather than by
reading the code. (1) The default map was ALREADY loading when the link's map
started, and being larger it finished LAST and silently overwrote it — the link
opened the wrong city while reporting success. The default load is now skipped
when a link is present. (2) The release splash rendered on top of the shared
ride; a link is someone saying "come and see this", and meeting a changelog
dialog instead is not that, so the announcement waits for an ordinary visit.

Validated end to end: a link naming SEPTA, line 17 and two tinted trams opened
on SEPTA's M line with a red tram and a yellow tram, no splash, saved setup
untouched — and "Copy a link to this ride" round-tripped back to the same ride.
Screenshot in `docs/features/_artifacts/share-links-2026-08-15/`.
