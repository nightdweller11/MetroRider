# MetroRider Debugging History

This document records all past debugging attempts, conclusions, and failures for persistent issues in the MetroRider/streets-gl integration, so they are not repeated.

## Issue 1: Tracks / Train / Stations Never Rendered

### Symptom
Despite multiple changes to track geometry dimensions, colors, offsets, and frustum culling parameters, the train, tracks, and stations were never visible in the scene.

### Attempts
1. **Increased rail/sleeper dimensions** (RAIL_WIDTH 0.07 -> 0.15, RAIL_HEIGHT 0.15 -> 0.3, etc.) -- No effect.
2. **Added ballast bed** (BALLAST_WIDTH 3.4, BALLAST_HEIGHT 0.2) underneath tracks -- No effect.
3. **Changed terrain offset** from +0.3 to +0.5 for track geometry -- No effect.
4. **Investigated frustum culling** in `RenderableObject3D.inCameraFrustum` and adjusted AABB on `TrainMeshObject` to (-100,-10,-100) to (100,50,100) -- No effect.
5. **Verified geometry buffer sizes** via console.log in `TrainRenderingSystem.rebuildTrack` -- Buffers were populated correctly.

### Root Cause (found 2026-03-23)
`TrainMeshObject.updateMesh(renderer)` -- the method that uploads vertex buffers to the GPU and creates the `AbstractMesh` -- was **never called anywhere** in the codebase. `GBufferPass.renderTrains()` filters with `.filter(m => m && m.mesh)`, and since `mesh` is initialized to `null` and never set, all game objects were filtered out every frame. The geometry buffers were computed correctly but never uploaded to the GPU.

### Fix
Call `updateMesh(this.renderer)` inside `GBufferPass.renderTrains()` for any mesh where `!isMeshReady()`.

---

## Issue 2: Corridor Clearing Not Working

### Symptom
Buildings remained in the train's path despite corridor clearing code being present.

### Attempts
1. **Increased clearing radius** from 15 -> 25 -> 50 meters -- No visible effect (but see root cause below).
2. **Reordered system init** to place `TrainSystem` before `TileLoadingSystem` in `App.ts` -- Intended to ensure corridor segments were sent before tiles were requested.
3. **Added `tileSystem.purgeTiles()`** after sending corridor segments -- Forces tile reload.
4. **Added delayed re-send** (500ms setTimeout) of corridor segments as a safety measure against race conditions.
5. **Verified coordinate math** with `corridorClearingReal.test.ts` using real Tel Aviv Metro coordinates -- All 6 tests passed, confirming:
   - `degrees2meters` produces valid Mercator coordinates (~10^6 magnitude)
   - `tile2meters(tileX, tileY+1)` produces correct tile offsets matching `Tile.updatePosition()`
   - Building center calculation (local bbox center + tile offset) aligns with corridor segments
   - A building ON the route is correctly identified as within 25m
   - A building 100m away is correctly kept
6. **Added diagnostic logging** in `WorkerInstance.ts` for segment receipt count, per-tile clearing stats, sample feature coordinates.
7. **Added diagnostic logging** in `TrainSystem.ts` for segment send with first-segment coordinates.

### Conclusions
- The coordinate math is **verified correct**.
- The `tile2meters(tileX, tileY+1)` offset convention matches `Tile.updatePosition()`.
- The `applyCorridorClearing` function correctly converts tile-local bounding box centers to global Mercator and compares against corridor segments.
- The remaining issue is likely a **race condition**: workers may process tiles before receiving `SetCorridorSegments` messages. The delayed re-send helps but is not deterministic.
- Additionally, since game objects were never rendered (Issue 1), it was impossible to visually confirm whether clearing was working.

### Recommended Next Steps
- Fix Issue 1 first (GPU mesh upload) to enable visual verification.
- ~~Include corridor segments in every `Start` message payload to eliminate the race condition entirely.~~ **Done** — corridor segments are now included in every Start message via `MapWorker.requestTile()`.
- Add debug overlay showing clearing statistics in real-time.

---

## Issue 3: Height Misalignment (Tracks Underwater)

### Symptom
Tracks appeared below the water/terrain surface, especially near coastline areas.

### Root Cause
Three different vertical offsets were used:
- **Tracks**: `terrain + 0.5` (in `TrainRenderingSystem.rebuildTrack`)
- **Train**: `terrain + 1.0` (in `TrainSystem.updateTrainPosition`)
- **Stations**: `terrain + 0` (raw height, in `TrainRenderingSystem.rebuildStations`)

Additionally, `getTerrainHeight()` returns 0 when terrain data hasn't loaded yet. Since tracks are built during `postInit` via `onSystemReady(TrainSystem)`, terrain tiles may not be loaded, causing all heights to default to 0. The tracks end up at Y=0.5, which is below the rendered terrain/water surface.

### Key Insight
Real-world OSM railway tracks in streets-gl use **projected geometry** that is draped onto terrain via shaders in `GBufferPass.renderProjectedMeshes()`. This approach never has the "underwater" problem because height is resolved at render time, not at geometry-build time.

---

## Issue 4: Camera Controls Non-functional

### Root Cause
When `GameCameraSystem.activate()` sets `ControlsSystem.gameMode = true`, the `ControlsSystem.update()` method returns immediately, disabling all mouse/touch/scroll interaction. `GameCameraSystem` provides Chase/Cab/Orbit camera modes but implements zero user input handling (no drag, zoom, or scroll).

---

## Issue 5: Settings Page

### History
1. First implemented as a React overlay within the main game's React tree (`Root.tsx`), using `window.__assetConfigSystem` for data access.
2. Migrated to a separate webpack entry point (`settings.html`) with its own React app that fetches data from `/api` endpoints directly.
3. Sound preview uses `new Audio('/data/assets/...')` which requires proper proxy configuration.
4. Model selection saves to localStorage but `TrainRenderingSystem` always uses procedural geometry, ignoring config.

---

## Architecture Notes

### Coordinate Systems
- `MathUtils.degrees2meters(lat, lng)` returns `Vec2(x, y)` in Web Mercator meters.
- In the 3D scene: X = Mercator X (north), Y = height (up), Z = Mercator Y (east).
- `tile2meters(tileX, tileY+1, zoom)` gives the SW corner of a tile in Mercator meters.
- Tile-local positions + `tile2meters` offset = global Mercator positions.
- `wrapper.position` is set to `(-camera.x, 0, -camera.z)` each frame for floating-origin precision.

### Rendering Pipeline for Game Objects
- `TrainRenderingSystem` builds geometry buffers and creates `TrainMeshObject` instances.
- `TrainMeshObject` extends `RenderableObject3D` and stores buffers.
- `GBufferPass.renderTrains()` iterates meshes, sets uniforms, calls `draw()`.
- `TrainMaterialContainer` provides the shader (vertex: `train.vert`, fragment: `train.frag`).
- **Critical**: `updateMesh(renderer)` must be called to upload buffers to GPU before `draw()`.

### Corridor Clearing Pipeline
1. `TrainSystem.updateCorridorSegments()` builds segments from track spline points in global Mercator.
2. `MapWorkerSystem.setCorridorSegments()` posts `SetCorridorSegments` to all workers.
3. `TileSystem.purgeTiles()` forces tile reload.
4. Workers store segments; on next `Start` (tile request), `applyCorridorClearing()` filters both `collection.extruded` (buildings) and `collection.projected` (OSM railway tracks with z-indices 11, 12, 28).
5. Filtering compares global centers (tile-local bbox center + `tile2meters` offset) against segments.
6. Corridor segments are also included in every `Start` message payload to eliminate race conditions.

### OSM Railway Track Handling
- Real-world railways in streets-gl use projected geometry (z-indices: Railway=11, RailwayOverlay=12, Rail=28).
- These are flat textured ribbons draped on terrain via shaders.
- Corridor clearing now suppresses these within the train path to avoid duplication with procedural tracks.
- Future enhancement: detect OSM tracks near the route and snap to them instead of generating procedural geometry.
