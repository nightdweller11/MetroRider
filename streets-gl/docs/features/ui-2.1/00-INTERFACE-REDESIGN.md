# Interface redesign — iPad first

> STATUS: MOCKED. Interactive mock: `mocks/metrorider-ui.html` (open the file
> directly). Captures: `mocks/shot-*.png`. Nothing is implemented yet.

## Why

Measured on the shipped 2.0.0 build at four form factors
(`docs/observability/_artifacts/ui-audit-*.png`):

- **The line list is a permanent wall.** On iPad portrait it covers roughly
  **38% of the width and 63% of the height** — always, while driving — to list
  24 routes you choose once at the start and never touch again.
- **The speed block is a second opaque slab** in the opposite corner, so the
  two biggest objects on screen are both chrome.
- **Touch targets are 42px.** Below a comfortable target for an adult, and well
  below what a child can hit while the train is moving. This game is for a
  child.
- **No layout system.** 1,817 lines of `GameUISystem.ts` assembling panels with
  inline `cssText` and absolute coordinates. There are no breakpoints, so every
  form factor gets the same positions and the phone gets the worst of it.

## The rules this design follows

1. **Nothing permanent over the middle of the screen.** The game is the view.
   Chrome lives at the edges.
2. **One thing to read at a glance**, and it never moves: current speed against
   the current limit, as a single cluster.
3. **The line is a ribbon, not a list.** Progress along the route reads as a
   thin strip with a marker — the 24-row wall becomes a summoned sheet.
4. **Everything else is summoned.** A sheet opens, you use it, it dismisses.
   Nothing that is only needed occasionally is on screen permanently.
5. **A sheet DISPLACES the driving layer, never covers it.** Verified
   programmatically in the mock: with a sheet open on iPad landscape, iPad
   portrait and phone, zero driving controls intersect the sheet.
6. **60px targets, 78px for the two you press while moving** (brake, doors).
7. **Layout per form factor, not one layout scaled.** Landscape puts the
   controls in the bottom corners where thumbs already rest; portrait puts them
   in a band across the bottom; the phone drops the ribbon to a single line and
   shrinks the speed readout rather than rescaling everything.

## Direction: instruments, not readouts

The first pass followed the layout rules and still read as a competent
dark-glass **app**. A train sim should read as a **machine**. What actually
moves it, in order of effect:

1. **A real dial.** Swept arc, minor and major ticks with numbers, a needle,
   and the line limit marked on the scale. The travelled arc runs accent-blue
   up to the limit and **red only for the excess**, so margin against the limit
   is a shape rather than two numbers to compare. (First attempt filled
   everything above the limit with the same weight and turned the whole face
   red — it said nothing.)
2. **A console the controls are set INTO** — milled edge, panel seam, brushed
   grain — rather than pills floating over the scene.
3. **Cab tell-tales.** DOORS and LIMIT are lamps: dead when off, illuminated
   with bloom when live.
4. **A notched power lever** (P4…N…B2, knurled grip) with the brake as its own
   gauge alongside — train controls, not a generic slider.
5. **Technical type.** Condensed DIN/Bahnschrift for numerals and micro-labels,
   not the rounded UI face. This is most of why the first pass read as an app.
6. **Surface texture** — fine brushed grain and a specular sweep, so panels
   catch light instead of being flat fills.

## Screens mocked

| Screen | Covers |
|---|---|
| **Driving** | speed + limit, next stop, route ribbon, throttle/brake/doors, utility rail |
| **Pick a line** | replaces the permanent wall |
| **Service** | F4 — drive the 09:12, clock speed, punctuality read |
| **Camera & Kid** | F8 — Cab/Chase/Orbit/Ride/Walk/Photo, **Kid mode**, announcements, sound |
| **World** | F9/F10 — time of day, weather, season, discoveries |
| **Settings** | quality, frame limit, crowds, signs, driver profile |

Each renders at iPad landscape (primary), iPad portrait, iPhone and laptop.

## What this does NOT decide

- Visual identity beyond layout — colour and type here are a starting point.
- Whether the throttle is a slider or two buttons; the mock shows a slider
  because it suits a touch screen, but that wants trying on real glass.
- The map/metro overlay, which stays as it is until F10 reworks it.

## Next

Implementation should extract the HUD out of `GameUISystem.ts` into components
with a real layout layer and breakpoints, rather than more inline `cssText`.
That refactor is the bulk of the work; the mock exists so the target is agreed
before any of it starts.
