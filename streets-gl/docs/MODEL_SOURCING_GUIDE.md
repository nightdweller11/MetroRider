# MetroRider — 3D Model Sourcing Guide

Reference document for finding, evaluating, and importing 3D models for MetroRider.

## Quick Start

1. Open the Sketchfab admin browser: `http://localhost:8080/admin/sketchfab?admin=YOUR_TOKEN`
2. Search for models using the suggested queries or your own keywords
3. Click a model to preview, then click "Download & Import GLB" to add it to the library
4. The model will appear in the Settings page model selector immediately

## Sketchfab API Integration

### Setup

Add your API token to `.env`:
```
SKETCHFAB_API_TOKEN=your_token_here
```
Get a token at: https://sketchfab.com/settings/password (under "API Token")

### API Endpoints (via our proxy)

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/sketchfab/status` | None | Check if API token is configured |
| `GET /api/sketchfab/search?q=...` | None | Search downloadable models |
| `GET /api/sketchfab/model/:uid` | None | Get model details |
| `POST /api/sketchfab/import/:uid` | Admin | Download and import model as GLB |

### Search Parameters

| Param | Description | Example |
|-------|-------------|---------|
| `q` | Search keywords | `train station low poly` |
| `downloadable` | Only downloadable (default: true) | `true` |
| `sort_by` | Sort order | `-likeCount`, `-viewCount`, `-publishedAt` |
| `max_face_count` | Max polygon count | `50000` |
| `license` | CC license filter | `cc0`, `by`, `by-sa`, `by-nc` |
| `categories` | Sketchfab category slug | `architecture` |

### Import Payload

```json
POST /api/sketchfab/import/{uid}?token=ADMIN_TOKEN
{
  "category": "stations",   // stations | trains | tracks
  "fileName": "my-station"  // optional, auto-generated if omitted
}
```

## Asset Categories & What We Need

### Stations (`data-seed/assets/models/stations/`)

Currently sourced models:
- `station-platform-basic` — simple open platform (procedural)
- `station-platform-covered` — covered with canopy (procedural)
- `station-tram-stop` — glass shelter tram stop (procedural)
- `station-subway-entrance` — underground platform (procedural)
- `station-modern` — angular modern design (procedural)
- `station-elevated` — raised platform with stairs (procedural)

**Models still wanted:**
- Realistic European train station platform
- Japanese-style covered platform
- Underground/metro station with escalators
- Rural/small-town station
- Elevated monorail station
- Historical Victorian-era station
- Bus/transit interchange hub

**Sketchfab search queries:**
```
train station platform low poly
metro subway station entrance
tram stop shelter urban
railway station building
train platform canopy
```

### Trains (`data-seed/assets/models/trains/`)

Existing: Kenney Train Kit models (electric, diesel, tram, subway, bullet)

**Models still wanted:**
- High-speed trains (Shinkansen, TGV, ICE)
- London Underground tube train
- New York subway car
- Freight/cargo train
- Steam locomotive
- Monorail car
- Light rail / streetcar
- Double-decker commuter train

**Sketchfab search queries:**
```
subway train car low poly
high speed train locomotive
tram streetcar 3d model
metro train wagon
```

### Tracks (`data-seed/assets/models/tracks/`)

Existing: Basic rail/track/sleeper segments

**Models still wanted:**
- Ballasted track with realistic sleepers
- Concrete slab track (high-speed)
- Tram embedded track (flush with road)
- Switch/junction track piece
- Platform edge coping

**Sketchfab search queries:**
```
railroad track rail segment
railway sleeper ballast
tram track embedded road
```

### Future Asset Categories

These don't exist yet but may be added as the game evolves:

| Category | Examples | Search Terms |
|----------|----------|--------------|
| Buildings | Offices, apartments, shops | `low poly building city` |
| Vehicles | Cars, buses, trucks | `low poly car vehicle urban` |
| Street Furniture | Benches, lamps, signs | `street lamp bench urban furniture` |
| Vegetation | Trees, bushes, grass | `low poly tree nature` |
| Infrastructure | Bridges, tunnels, overpasses | `bridge overpass low poly` |
| Signals | Traffic lights, rail signals | `traffic light signal` |
| People | Passengers, pedestrians | `low poly person character` |

## Model Quality Criteria

When evaluating models for import, check:

### Technical
- **Face count:** Prefer under 50K faces for game objects, under 10K for instanced objects
- **Format:** Must be downloadable as glTF/GLB (Sketchfab filter: `downloadable=true`)
- **Textures:** Embedded textures preferred; separate textures need manual bundling
- **Scale:** Will be auto-scaled at placement time, but should be proportional
- **Origin:** Center-bottom origin preferred for easy placement

### Visual
- **Style consistency:** Match the existing low-poly/stylized aesthetic (Kenney-style)
- **Color palette:** Neutral/muted tones work best with the terrain renderer
- **Detail level:** Medium detail — too simple looks flat, too complex hurts performance

### Legal
- **CC0** (Public Domain): Best — no attribution required
- **CC-BY**: Good — must credit author (stored in import metadata)
- **CC-BY-SA**: OK — derivative works must use same license
- **CC-BY-NC**: Caution — no commercial use
- **CC-BY-ND**: Avoid — no modifications allowed
- **Standard Sketchfab License**: Avoid — restrictive

## Alternative Model Sources

Beyond Sketchfab, these sources have free 3D models:

| Source | License | Formats | Notes |
|--------|---------|---------|-------|
| [Kenney.nl](https://kenney.nl/assets) | CC0 | GLB, FBX, OBJ | Our primary train source; consistently great low-poly quality |
| [OpenGameArt](https://opengameart.org) | CC0/CC-BY | Various | Community-contributed game assets |
| [Poly Pizza](https://poly.pizza) | CC-BY | GLB | Curated low-poly models, Google Poly successor |
| [Quaternius](https://quaternius.com) | CC0 | FBX, OBJ | High quality packs (cities, vehicles, nature) |
| [Kay Lousberg](https://kaylousberg.itch.io) | CC0 | GLB, FBX | Great city/vehicle/nature packs |
| [Turbosquid Free](https://turbosquid.com) | Various | Various | Large library but licenses vary |
| [CGTrader Free](https://cgtrader.com) | Various | Various | Check license per-model |

## File Naming Convention

```
{category}-{descriptor}[-{variant}].glb

Examples:
  station-platform-covered.glb
  station-subway-entrance.glb
  train-electric-bullet-a.glb
  track-detailed.glb
```

The server auto-discovers all `.glb` files in `data-seed/assets/models/{category}/` — no configuration needed. The file stem becomes the model ID, and a humanized version becomes the display name.

## Conversion Notes

### FBX/OBJ to GLB

If a model is only available in FBX or OBJ format:

```bash
# Using Blender CLI (install Blender first)
blender --background --python-expr "
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath='model.fbx')
bpy.ops.export_scene.gltf(filepath='model.glb', export_format='GLB')
bpy.ops.wm.quit_blender()
"
```

### Scale/Orientation Issues

If a model appears too large, too small, or rotated wrong:
- The `placeStationGLBs` function in `TrainRenderingSystem.ts` auto-scales models to a target platform length (40m)
- The model is centered on its bounding box center (X/Z) and placed bottom-up
- Rotation is handled by the spline tangent heading

## Attribution Tracking

When importing from Sketchfab, the import response includes an `attribution` field:
```json
{
  "attribution": {
    "name": "Railway Station Platform",
    "author": "ArtistName",
    "license": "CC Attribution",
    "url": "https://sketchfab.com/3d-models/..."
  }
}
```

Keep a record of attributions in `data-seed/assets/ATTRIBUTIONS.md` for models that require credit (CC-BY and variants).
