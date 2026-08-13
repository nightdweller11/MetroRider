# Observation toolkit

> Built 2026-08-13 after shipping visual regressions that neither the tests nor
> I could see. Unit tests check logic I already understood; a screenshot catches
> one frozen instant. Neither can see a GPU buffer created and never deleted, a
> texture re-uploaded every second, a figure whose feet do not touch the ground,
> or the difference between the world sliding past and the world flickering.
>
> These tools turn the visual and time-dependent experience into numbers.

## 1. `RenderTelemetry` — the game reports on itself

`src/app/debug/RenderTelemetry.ts`. Activated only by `?telemetry=1`, so the
shipped game pays nothing. It patches the WebGL context's **resource** entry
points (create/delete/upload/draw — never the hot uniform paths) and exposes:

| Call | Answers |
|---|---|
| `__telemetry.snapshot()` | live counts of buffers, textures, VAOs, programs; totals of uploads and draws |
| `__telemetry.series()` | one sample per second: the above plus fps and JS heap |
| `__telemetry.report()` | **growth per minute** by least squares — the leak signal — plus current rates |
| `__telemetry.blame(n)` | **who created them**: sampled stack attribution, ranked |
| `__telemetry.markPhase(name)` | tags samples so "parked" and "driving" can be compared |

`blame()` is the one that matters. Counting a leak proves it exists; the stack
attribution names the function, which is the difference between a hypothesis and
a fix.

## 2. Probes — `scripts/observe/`

Each probe is written against `lib-drive.mjs` (boot the game, mute audio, grab
system handles, drive). The probe runner cannot resolve imports, so
`node scripts/observe/compose.mjs` inlines the helpers and writes
self-contained files to `scripts/observe/build/`. Run those.

| Probe | Question it answers |
|---|---|
| `resource-leak.mjs` | Does playing for minutes grow GPU objects, heap or draw calls? |
| `visual-stability.mjs` | What is changing on screen, per region — and is it **motion or flicker**? |
| `world-inspect.mjs` | What exists right now: mesh counts, vertex budgets, **whether figures' feet touch the ground**, how much colour variety a crowd has |
| `boarding-behaviour.mjs` | Do passengers actually travel across the platform, or just vanish? |

### The measurement that mattered most

`visual-stability.mjs` separates two things a screenshot cannot:

- **meanDiff / hotPct** — how much changed between frames.
- **flipPct** — the share of pixels whose change **reverses direction** frame to
  frame.

Smooth camera motion is a high meanDiff with a LOW flip rate: the world slides.
Texture churn, popping and shimmer are a high flip rate: the same pixels jump
back and forth. That distinction is exactly what I was missing when I called
things "validated" off a screenshot.

## 3. Findings, 2026-08-13

Run with the game parked at a station, where **nothing should be changing**:

| Measurement | Before | After the fixes below |
|---|---|---|
| Live VAOs growth | **+288 / min** | **0 / min** |
| JS heap growth | **+866 MB / min** | −144 (parked, GC) / +30 (driving) |
| Live buffers growth | +1,154 / min | +800 / min (still open) |
| Buffer uploads | 28,000–32,000 / sec | ~28,000 / sec (still open) |

**Fixed:**

1. **`TrainMeshObject.setBuffers()` orphaned GPU resources.** It set
   `mesh = null` and let the old mesh go — but WebGL objects are not garbage
   collected. Every crowd rebuild (5/s), sign rebuild and station rebuild
   leaked its buffers and VAO. It now calls `dispose()`, and crowds, signs and
   stations dispose on removal. This is mine, introduced with the passenger
   work, and it is the leak the operator felt as "load going higher the longer
   I am in the game".
2. **Instance buffers were re-uploaded every frame even when identical.**
   `SceneSystem.updateInstancedObjectsBuffers` rebuilt and uploaded the merged
   instance data for every instanced type every frame, including while parked.
   It now compares against what was last sent and skips the upload when equal.

**Still open — the next lead, with its exact signature:**

```
bufferData ← ed.setData ← Hl.updateMesh ← G5.update ← Nw.updateSystems
```

~400 buffer uploads per frame remain, attributed to a `updateMesh` called from
a *system update* (not from the render pass). That is roughly 80 meshes rebuilt
per frame, which no scene of ~24 game meshes explains — so a tile/world object
is rebuilding its mesh continuously. This is the strongest candidate for the
building-texture corruption and pop-in (V1/V2), because a mesh rebuilt every
frame will also re-bind and re-fetch its textures.

Next step is mechanical, not speculative: build the bundle unminified (or add
`__name` tags to the classes involved) so `blame()` prints real class names,
then guard that `updateMesh` the way `TerrainRing` already guards its own
(`if (!this.mesh)`).

## 4. How to use this

```bash
node scripts/observe/compose.mjs          # regenerate build/*.mjs after editing a probe
# then run a composed probe through the browser runner, e.g. build/resource-leak.mjs
```

A change to rendering is not "validated" until a probe says so. Screenshots are
evidence of a moment; these are evidence of behaviour.
