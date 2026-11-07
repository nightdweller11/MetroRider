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

---

## Landmarks on the network map (wave 2)

The 🗺 overlay already drew the places you had found (2.38.0). It now draws the
places you have NOT found yet too — dim — so the map says "there is more out
there, and roughly where".

| Piece | Where |
|---|---|
| Which places, and how many (pure) | `src/app/game/data/Landmarks.ts` — `selectLandmarks`, `Corridor`, `spacedOut` |
| The labels in the loaded streets | `DiscoverySystem.loadedPlaces()` |
| Drawing the pins and the key | `src/app/game/ui/MapLandmarkMarks.ts` (the `MapInterchangeMarks` pattern) |
| Wiring | `GameUISystem.toggleMetroMapOverlay` |
| Tests | `src/__tests__/landmarks.test.ts` |

**What is genuinely there.** A dim pin is a place the discovery check itself
would find from the line: a label in a loaded tile, passing `worthFinding`
(named, priority ≥ 10), not already in the journey record, and within
`DISCOVER_RADIUS_M` (300) of a line segment — the same rule, the same units.
The game only knows the labels of the streets it has streamed in, i.e. the
country around where you have been, so the dim pins grow as you travel; it does
not invent places along the rest of the line. A dim pin has a "?" and no name:
finding out what it is is the point of going there.

**Caps, and why.** A map that already carries lines, station dots, names and
change rings has room for a few more marks, not a field of them.
- At most **12** still-to-find pins (`MAX_TO_FIND`), the most important by the
  map's own label priority. Measured (counted independently in the page, by
  brute force over every line segment): on Jerusalem Light Rail after six
  stations, 257 worth-finding labels were loaded and 75 were within reach of
  the line → 12 pins drawn. On Israel Railways after four stations around Tel
  Aviv, 207 loaded, 29 within reach → **2** drawn: at whole-country scale the
  14-unit spacing is several kilometres, all 29 sat in the one patch of the
  map that is already a stack of station names, and two pins there is right.
- Spacing is applied before the cap (`pickVisible`): capping first would
  spend all twelve on one cluster and then thin them to one.
- Every find on this map gets its pin (up to 80), but only the **8** most
  recent carry their name (`MAX_FOUND_LABELS`), and a name that would run into
  another name is not written.
- A dim pin that would sit on another pin (closer than 14 map units, after
  projection) is left out — two places 200 m apart are one blob on a
  whole-country map.
- Finds from other cities are excluded by the network's own extent (+2 km).

**The keys moved under the map.** The change-here key had been put in the
header in 2.51.0; at 390 px wide the header (name, key, MetroDreamin link,
close) pushed the close button off the screen. Both keys — rings and pins —
now sit in a strip under the map (`mapKeyRow`).

## Map browser (wave 2)

| Piece | Where |
|---|---|
| Projection shared with the overlay; sketch + thumbnail (pure) | `src/app/game/data/MapThumbnail.ts` — `fitProjection`, `sketchMap`, `renderMapThumbnail(map, w, h)` |
| Recents + thumbnail cache (pure + storage wrapper) | `src/app/game/data/MapLibrary.ts` |
| Featured list | `src/app/game/data/FeaturedMaps.ts`, baked sketches in `FeaturedSketches.ts` |
| Baking/checking Featured maps | `scripts/featured/bake-featured-maps.ts` |
| Row models for both lists | `src/app/game/data/MapBrowserModel.ts` |
| Start-screen DOM | `src/app/game/ui/MapBrowser.ts`; `CabSheet` rows take a `thumb` |
| Tests | `mapThumbnail.test.ts`, `mapLibrary.test.ts`, `mapBrowserModel.test.ts` |

**Thumbnails are the map's own lines.** `renderMapThumbnail` draws from a
*sketch*: the lines projected with the overlay's projection into a 1000-unit
box, simplified (Douglas–Peucker, 3 units) and rounded to integers, with the
line and station counts. A sketch is 0.4–6 KB (Jerusalem 0.4, Israel Railways
3.7, New York 5.9) where the map itself is hundreds of KB, so it is what gets
cached: `metrorider-map-sketches`, at most 40, oldest dropped. Every map load
stores its sketch (including the background load of the default map), so a
list never refetches a map to draw it. Colours are checked to be plain hex and
no text from the map goes into the markup (tested with a hostile map).

**Featured** — six, in this order: the built-in Tel Aviv Metro (no fetch, so
it always works), Israel Railways, Jerusalem Light Rail, Paris Métro,
Washington Metro, San Francisco BART. Each id was run through the game's own
importer and route parser (`bake-featured-maps.ts --check`): all load, every
line has ≥ 2 stops. Their sketches are baked into the bundle so the cards draw
before anything is fetched; a map's own load then replaces its baked sketch.
On the start screen they are a row of cards you swipe along; on the in-game
"Drive another map" sheet they head the list, and the long list below leaves
them out. Picking Israel Railways when it is already the background-loaded map
starts it without a second fetch.

**Recents** say when you last drove each map ("Driven yesterday"), its size
("26 lines · 84 stops") and your progress from the journey record ("2 of 26
lines"). Two behaviour changes: the map the start screen fetches by itself is
no longer a "Recent" until you play it (it used to sit at the top of every
first visit), and the built-in map now appears in Recents when driven (key
`builtin:tel-aviv`). Two spellings of one MetroDreamin URL (`%3D` vs `=`) are
one Recent. Progress is keyed by map NAME in the journey record, so two maps
with the same title share it — rare, and documented in `progressOn`. The
in-game sheet shows up to four driven Recents (not the one you are on).

Validated locally (production build, desktop 1440×900 and phone 390×844,
three runs, no page errors):
- Fresh visit: six Featured cards, each thumbnail with as many polylines as
  the map has lines (3, 26, 2, 19, 7, 6); Recent empty although the default
  map had loaded (its sketch was cached); no horizontal page scroll on either
  viewport (the rail scrolls inside the card: 700 px of cards in 402 / 301).
- Featured Jerusalem Light Rail: fetched through the importer, both lines
  parsed (35 and 13 stops), drove 256 m in 15 s to 22 m/s. Featured Israel
  Railways when already loaded: started with **0** refetches. San Francisco
  BART from the in-game sheet: loaded in 1.5 s, drove 330 m to 25 m/s. The
  built-in Tel Aviv from the sheet: loaded with no fetch.
- In-game sheet: Featured with thumbnails, "Driving now" on the current map,
  then Recent ("Israel railways … — Driven today · 1 of 26 lines"), then All
  maps without the Featured ones.
- After a reload, Recent: "Tel Aviv Metro — 3 lines · 25 stops — Driven today
  · 1 of 3 lines" and "Jerusalem Light Rail — 2 lines · 47 stops — Driven
  today · 1 of 2 lines", each with its thumbnail; a Recent row reopens its map.
- Overlay: Jerusalem 7 found (5 named) + 12 to find; phone header close button
  inside the viewport (right edge 372 of 390), key strip under the map.
