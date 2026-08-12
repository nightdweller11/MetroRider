# Performance Optimizations

> STATUS: PROPOSAL — reviewed against the code on 2026-08-12 (post-v1.1.0).
> Target: consistent 30 FPS on old/low-end machines (integrated GPUs, old iPads,
> mid-range phones), preferably 60. Desktop already runs 60+ uncapped.

Every item names the file(s) involved, the expected gain, and the effort.
"Gain" is for the frame budget on a low-end GPU unless stated otherwise.

## Where the frame actually goes

The renderer is a full deferred pipeline (`src/app/systems/RenderSystem.ts`,
passes in `src/app/render/passes/`): GBuffer (MRT) → shadow maps (up to 3
cascades, re-rendered every frame) → SSAO → shading → TAA → bloom → DoF/SSR
(off by default) → screen. On a low-end GPU the dominant costs are, in order:

1. **Fill rate / bandwidth** — the deferred GBuffer at full resolution.
2. **Shadow cascades** — the whole scene drawn again up to 3×, every frame.
3. **Draw calls** — projected + hugging tile meshes and instances draw
   per-tile (only extruded buildings are multi-draw batched).
4. **Per-frame CPU garbage** — allocation churn in the render loops.

---

## A. Optimizations that help everywhere (all machines)

### A1. Skip picking + object-ID work during gameplay — free win, LOW effort
`RenderSystem.pickObjectId()` runs **every frame**, and `GBufferPass` renders
an object-ID attachment plus a PBO readback (`WebGL2RenderPass.readback…`,
the console's "READ-usage buffer was written, then fenced…" warnings) so you
can hover-select buildings on the map. During a game you never hover-pick.
Gate it on `!trainSystem.gameActive` (and skip `SelectionPass` too). Saves a
readback fence + an attachment write per frame.

### A2. Pool the per-tile matrices in the batch loops — LOW effort
`GBufferPass.renderExtrudedMeshes()` and `ShadowMappingPass` allocate
`new Float32Array(Mat4.multiply(...).values)` **twice per visible tile per
frame per pass** (~150 tiles × 2 × (1 + cascades) ≈ 50k allocations/sec at
60 fps). Reuse two scratch `Float32Array(16)` per slot in a preallocated pool
(the UBO packing already copies out of them, so nothing outlives the loop).
Saves GC hitches — the visible micro-stutter every few seconds.

### A3. Throttle label layout — LOW effort
`Labels.updateFromTiles()` runs every frame (`RenderSystem.update`). Text
placement only needs ~10 Hz; run it every 6th frame (and on camera-move
deltas above a threshold). Minor CPU win, zero visual difference.

### A4. Batch projected + hugging meshes like extruded — MEDIUM/HIGH effort
Only extruded buildings use the `WEBGL_multi_draw` mega-buffer path
(`TileMegaBuffers`); roads (projected) and land-use (hugging) still draw
**per tile** in `GBufferPass` + `ShadowMappingPass` — ~2×150 draw calls with
per-mesh uniform updates. Extending the batch path to them was deliberately
skipped earlier because the old design kept dead CPU copies; a batched path
that (a) reuses the now-maintained allocator and (b) drops the per-tile GL
meshes would cut draw calls ~3× on the main pass. The per-tile uniforms
(terrain ring params) must move into a per-tile UBO array like the extruded
`PerMeshArray`. Biggest CPU-side render win available.

### A5. Throttle far shadow cascades — MEDIUM effort
`ShadowMappingPass` re-renders every cascade every frame. Cascade 0 (near)
needs per-frame updates; cascades 1–2 can update every 2nd/4th frame (or only
when the sun/camera cell changes). Typical shadow cost drops ~40–60% with no
visible artifact at train speeds.

### A6. `getTileByLocalId` linear scan — LOW effort
`TileSystem.getTileByLocalId()` walks the whole tile map; it's called from the
picking path. Keep a `Map<number, Tile>` by localId. (Moot for gameplay once
A1 lands, still right.)

### A7. Fetch/decode textures off the main thread — LOW effort
`ResourceLoader.loadImage` decodes on the main thread at startup. Use
`createImageBitmap(blob, {imageOrientation: 'flipY'})` in the existing fetch
path — decoding moves off-thread and upload gets cheaper. Speeds up initial
load everywhere; biggest effect on phones.

### A8. Compress the startup textures — MEDIUM effort (asset work)
`build/textures` is 92 MB of PNG. Re-encoding surfaces/buildings to WebP
(lossless or q95) typically halves it; download and decode time drop
accordingly. (KTX2/basis would also halve GPU memory, but needs a loader —
see B6.)

---

## B. The low-end path — consistent 30 FPS, aiming for 60

The knobs in `Config.SettingsSchema` already cover most of what a low-end
machine needs; the problem is nobody sets them. Two structural additions plus
tuned presets get us there.

### B1. A real "Performance preset" switch — LOW effort, do this first
One toggle (extend the existing `performanceMode` setting, which today only
changes tile/memory behavior via `Config.applyPerformanceMode`) that also
applies the graphics preset:

| Setting            | Balanced (default) | Low-end            |
|--------------------|--------------------|--------------------|
| renderScale        | 1.0                | 0.66               |
| shadows            | medium             | **off**            |
| ssao               | on                 | **off**            |
| bloom              | on                 | off                |
| taa                | on                 | on (cheap, and hides the 0.66 upscale) |
| terrainDetail      | high               | low                |
| fpsLimit           | 60                 | 30                 |
| labels             | on                 | off                |
| DPR cap            | 2 (mobile)         | **1**              |

Shadows-off alone removes the single biggest GPU cost (up to 3 scene
re-renders); renderScale 0.66 cuts shaded pixels to ~44%. Together these are
the difference between 15 and 45 fps on an integrated GPU. All the settings
already exist — this is wiring, not engine work.

### B2. Dynamic resolution scaling — MEDIUM effort, the "consistent" part
The app already tracks frame time (`UISystem.updateFrameTime`) and
`renderScale` already resizes everything live (`RenderSystem.listenToPerformanceSettings`).
Close the loop: every ~2 s, if the 95th-percentile frame time is over budget
(33 ms / 16.6 ms), step `renderScale` down 0.05 (floor 0.5); if comfortably
under budget, step back up (ceiling: user's setting). This is what console
games do and it is the only way to be *consistent* across unknown hardware.
Show the current scale in the debug overlay.

### B3. Cheap-shadow mode instead of no shadows — MEDIUM effort
For machines that can almost afford shadows: a "low" mode that uses **1
cascade at 512 px, updated every 2nd frame, `shadowDrawDistance` halved**
(`ShadowMappingPass`, `CSM`). Keeps grounding under the train (the visual
that matters at street level) at ~15% of the current shadow cost.

### B4. Instance density scaling — LOW/MEDIUM effort
Trees/streetlamps/wires draw with per-tile instance buffers
(`InstancedObject`, `Tile.instanceBuffers`). Add a density factor (1.0 / 0.5
/ 0.25) applied when tiles load: keep every Nth instance for LOD0 and drop
LOD1 entirely on low-end. Dense forests near Tel Aviv's parks are thousands
of instanced trees a weak GPU pays for twice (GBuffer + shadows).

### B5. Drop anisotropy on low-end — LOW effort
Every texture pool array is created with `anisotropy: 16`
(`createExtrudedMeshTexture.ts` and friends). On bandwidth-starved GPUs
aniso 16 is measurably slower; use 4 (or 2) in low-end mode. One parameter.

### B6. Native-compressed GPU textures — HIGH effort, biggest phone win
The 92 MB of PNGs decode to ~400 MB of RGBA on the GPU. KTX2/BasisU
transcoding (ETC2 on mobile, BC on desktop) cuts GPU texture memory ~4–6×
and helps every phone from loading through steady-state. Needs a build step +
a transcoder in `ResourceLoader` + `WebGL2Texture` support for compressed
formats. Do after A8's easy WebP win.

### B7. Reduce deferred targets on low-end — HIGH effort (engine surgery)
The GBuffer MRT layout is several full-res attachments plus motion vectors
for TAA. A trimmed low-end layout (no motion vectors when TAA is the only
consumer and DRS is active, packed normals) reduces bandwidth ~25–35%. Only
worth it after B1–B5 if 30 fps still isn't held on the worst target device.

### Suggested order
1. B1 preset + A1 picking skip + B5 aniso (one afternoon, transforms low-end)
2. A2 allocation pool + A3 label throttle + A6 map
3. B2 dynamic resolution (the consistency guarantee)
4. B3 cheap shadows + B4 instance density
5. A7/A8 loading pipeline, then A4 batching, then B6/B7 if still needed

## How to measure
- In-game: FPS in the HUD; `` ` `` debug overlay (add current renderScale +
  draw-call count there when implementing).
- Renderer counters: add per-pass GPU timings via `EXT_disjoint_timer_query_webgl2`
  behind the debug flag — otherwise you're tuning blind on other people's GPUs.
- Test matrix: an old iPad (works today), a mid-range Android phone, and a
  laptop with an integrated GPU, all through the live site.
