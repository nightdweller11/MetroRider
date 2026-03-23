# MetroRider OSM World — Technical Reference

## Why Not Google 3D Tiles

Google Photorealistic 3D Tiles **does not have 3D coverage for Israel**.

The [Google Maps Platform Coverage](https://developers.google.com/maps/coverage) table
uses two columns under "Map Tiles 2D / 3D":

| Country | Map Tiles 2D / 3D | Has 3D Buildings |
|---------|-------------------|-----------------|
| US      | ⬤ / ⬤            | Yes             |
| Japan   | ⬤ / ⬤            | Yes             |
| Germany | ⬤ / ⬤            | Yes             |
| France  | ⬤ / ⬤            | Yes             |
| UK      | ⬤ / ⬤            | Yes             |
| **Israel** | **⬤**         | **No**          |

Only 55 countries show `⬤ / ⬤`. Israel shows only `⬤` (2D tiles).
The API endpoint (`/v1/3dtiles/root.json`) still works and returns `.glb` mesh
tiles, but these are satellite-textured flat terrain — no building geometry.
This is confirmed by the data itself: the meshes have no vertical extent.

## OSM Data Architecture

### Overpass API

The [Overpass API](https://overpass-api.de/api/interpreter) is a read-only
query engine for OpenStreetMap data. It returns structured JSON with nodes
(points), ways (polylines/polygons), and relations (multipolygons).

**Endpoint:** `https://overpass-api.de/api/interpreter`
**Method:** POST with `data=<query>`

#### Query language (Overpass QL)

```
[out:json][bbox:south,west,north,east][timeout:30];
(
  way["building"]({{bbox}});
  relation["building"]["type"="multipolygon"]({{bbox}});
  way["highway"]({{bbox}});
  way["railway"]({{bbox}});
  way["natural"="tree_row"]({{bbox}});
  way["landuse"="grass"]({{bbox}});
  way["leisure"="park"]({{bbox}});
  way["leisure"="garden"]({{bbox}});
  way["natural"="water"]({{bbox}});
  way["waterway"]({{bbox}});
  node["natural"="tree"]({{bbox}});
  node["highway"="traffic_signals"]({{bbox}});
  node["amenity"="bench"]({{bbox}});
  node["highway"="street_lamp"]({{bbox}});
);
out body; >; out skel qt;
```

- `[out:json]` — return JSON (not XML)
- `[bbox:s,w,n,e]` — restrict to bounding box
- `out body` — full tags for the matched elements
- `>` — recursion: expand ways to their member nodes
- `out skel qt` — output referenced nodes with coordinates only

#### Response structure

```json
{
  "elements": [
    { "type": "node", "id": 123, "lat": 32.08, "lon": 34.78, "tags": { ... } },
    { "type": "way", "id": 456, "nodes": [123, 124, ...], "tags": { "building": "yes", "building:levels": "5" } },
    { "type": "relation", "id": 789, "members": [...], "tags": { ... } }
  ]
}
```

### OSM Building Tags (Simple 3D Buildings spec)

Reference: https://wiki.openstreetmap.org/wiki/Simple_3D_buildings

| Tag | Meaning | Example |
|-----|---------|---------|
| `height` | Total height in meters | `height=15` |
| `building:levels` | Number of above-ground floors | `building:levels=5` |
| `min_height` | Height of the bottom of the structure | `min_height=10` |
| `building:min_level` | Lowest floor number | `building:min_level=3` |
| `building:colour` | Facade color | `building:colour=#ffffff` |
| `roof:colour` | Roof color | `roof:colour=#cc0000` |
| `roof:shape` | Roof type | `flat`, `gabled`, `hipped`, `dome` |
| `roof:height` | Height of the roof portion | `roof:height=3` |

**Height calculation priority:**
1. Use `height` tag directly if present
2. Else use `building:levels * 3.0` meters
3. Else assign random height: `3 + Math.random() * 18` (1-7 floors)

### OSM Feature Types We Use

| Feature | OSM Tags | Geometry | 3D Treatment |
|---------|----------|----------|-------------|
| Buildings | `building=*` | Polygon (way/relation) | Extrude to height |
| Roads | `highway=*` | Polyline (way) | Flat ribbon, width by type |
| Railways | `railway=*` | Polyline (way) | Rails + sleepers |
| Trees (individual) | `natural=tree` | Point (node) | Instanced tree model |
| Tree rows | `natural=tree_row` | Polyline (way) | Trees at intervals |
| Parks | `leisure=park` | Polygon (way) | Green ground + scattered trees |
| Gardens | `leisure=garden` | Polygon (way) | Green ground |
| Grass | `landuse=grass` | Polygon (way) | Green ground |
| Water | `natural=water`, `waterway=*` | Polygon/line | Blue translucent plane |
| Traffic lights | `highway=traffic_signals` | Point (node) | Instanced pole+light |
| Street lamps | `highway=street_lamp` | Point (node) | Instanced lamp model |
| Benches | `amenity=bench` | Point (node) | Instanced bench model |

### Road Width by Highway Type

| `highway` value | Width (meters) |
|----------------|---------------|
| `motorway` | 14 |
| `trunk` | 12 |
| `primary` | 10 |
| `secondary` | 8 |
| `tertiary` | 7 |
| `residential` | 6 |
| `service` | 4 |
| `footway`, `path`, `cycleway` | 2 |
| `pedestrian` | 4 |
| default | 5 |

## Coordinate System

### Local Equirectangular Projection

All 3D positions use a local coordinate system centered on the route midpoint:

```
x = (lng - centerLng) * 111319 * cos(centerLat * PI/180)   [meters East]
y = height above ground                                      [meters Up]
z = -(lat - centerLat) * 111319                              [meters South→North, negated for Three.js]
```

Note the Z negation: in Three.js, -Z is "forward" / "into screen". We negate so
that increasing latitude (north) goes into -Z, which is visually "forward" when
looking from above at a standard map orientation.

This avoids the floating-point precision issues of ECEF coordinates
(values in the millions) and works well for city-scale areas (< 50 km).

### Why not WGS84 Ellipsoid / ECEF?

The previous Google 3D Tiles approach used ECEF (Earth-Centered Earth-Fixed)
coordinates via the `3d-tiles-renderer` Ellipsoid API. This required:
- Rotation of the tile group by `-PI/2` around X to convert Z-up to Y-up
- Complex matrix math for every object placement
- Near/far plane issues at globe scale

The local projection is simpler, more performant, and sufficient for
city-scale rendering.

## Performance Patterns

### Mesh Merging

All buildings are merged into a single `THREE.Mesh` using
`BufferGeometryUtils.mergeGeometries()`. This reduces draw calls from
thousands to one. Same for roads and ground planes.

Trade-off: all merged buildings share one material. Different colors
require separate merge groups (batched by color).

### Instanced Meshes

Repeated objects (trees, lamps, benches) use `THREE.InstancedMesh`:
- One geometry + one material + N transform matrices
- Single draw call for all instances of one type
- Each instance can have different position/rotation/scale via `setMatrixAt()`

### Tile-Based Loading

Divide the world into grid cells (~200m). Generate geometry per cell.
Load/unload cells based on distance from the camera. This prevents
generating geometry for the entire city at once.

## Caching Strategy

OSM data is cached in IndexedDB, keyed by a hash of the bounding box
coordinates. On subsequent loads:
1. Check IndexedDB for cached data matching the bbox
2. If found and not expired (24h TTL), use cached data
3. If not found, fetch from Overpass API and store

## Asset Sources

| Source | License | Format | Contents |
|--------|---------|--------|----------|
| [City Builder Bits](https://poly.pizza/bundle/City-Builder-Bits-1wLdnIddSx) | CC0 | glTF/FBX | Trees, buildings, vehicles, props |
| [Sketchfab City Props](https://sketchfab.com/3d-models/free-lowpoly-city-props-pack-by-maha-c81469186c6f442e88dc8a29fedcd082) | Free | glTF | Urban furniture, utilities |
| [Low Poly Trees](https://glory-asset.itch.io/low-poly-trees) | Free | FBX | Various tree types |
| Procedural | N/A | Code | Canvas window textures, cone+cylinder trees |
