# Interface redesign — iPad first

> STATUS: BUILT AND SHIPPED (2.1.0 – 2.7.0). Interactive mock:
> `mocks/metrorider-ui.html` (open the file directly). Design captures:
> `mocks/shot-*.png`. Captures of the SHIPPED interface: `mocks/impl-*.png`.
> See "What shipped" at the end for the mapping from design to release.

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
| **Camera & driving** | F8 — Cab/Chase/Orbit/Ride/Walk/Photo, **Simple / Advanced driving**, announcements, sound |
| **World** | F9/F10 — time of day, weather, season, discoveries |
| **Settings** | quality, frame limit, crowds, signs, driver profile |

Each renders at iPad landscape (primary), iPad portrait, iPhone and laptop.

## What this does NOT decide

- Visual identity beyond layout — colour and type here are a starting point.
- Whether the throttle is a slider or two buttons; the mock shows a slider
  because it suits a touch screen, but that wants trying on real glass.
- The map/metro overlay, which stays as it is until F10 reworks it.

## What shipped

The HUD came out of `GameUISystem.ts` into two components with a real
stylesheet and breakpoints, as planned: `game/ui/CabHud.ts` (the driving
instruments, minimap and route ribbon) and `game/ui/CabSheet.ts` (every
summoned panel). `GameUISystem` now feeds them state and owns the sheet
contents; it no longer positions anything with inline `cssText`.

| Design screen | Shipped in | Where |
|---|---|---|
| Driving | 2.1.0 | `CabHud` — dial, notched lever, brake gauge, DOORS/LIMIT lamps, minimap, route ribbon |
| Pick a line | 2.1.0 | menu → Pick a line (`showLinePicker`) |
| Camera & driving | 2.1.0, 2.2.0 | menu → Camera — six named views + Simple/Advanced |
| Settings | 2.3.0 | menu → Settings — driving, time of day, announcements, other trains, sound, graphics, frame rate |
| Service | 2.7.0 | menu → Timetable, plus the due time on the destination board |
| World | 2.4.0 (time of day) | Settings → Time of day. Weather and seasons are NOT built |

Added beyond the mock, because hiding the old chrome would otherwise have
deleted the functions: **Turn the train around**, **Change map** and **Trains &
sounds** are menu rows (2.3.0), and **About this line** (2.6.0).

### Rules that survived contact, and one that changed

Rules 1–7 all held. The one correction: the mock put the route ribbon on the
same row as the destination board in landscape. The board's width follows the
station name, so a long bilingual name put the ribbon straight over the
waiting-passenger count. The ribbon now sits UNDER the board in landscape, as
it already did in portrait and on the phone — measured at 0 px overlap in all
three (2.2.0).

### Not built

- Weather and seasons (the sky is a physically-based atmosphere LUT; overcast
  is a renderer change, not a setting).
- The map/metro overlay is still the original one.
- Per-vehicle physics and line modes.
