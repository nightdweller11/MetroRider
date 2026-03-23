/**
 * OSM Pipeline Test Script
 * Tests each layer: API fetch, parsing, projection, data integrity
 * Run with: node test-osm-pipeline.mjs
 */

const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

// Small test area: single block near Dizengoff Center, Tel Aviv (~300m x 300m)
const SMALL_BBOX = {
  south: 32.074,
  west: 34.773,
  north: 32.077,
  east: 34.776,
};

// Medium test area: around Arlozorov station (~1km x 1km)
const MED_BBOX = {
  south: 32.075,
  west: 34.787,
  north: 32.084,
  east: 34.797,
};

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function buildQuery(south, west, north, east) {
  return `[out:json][bbox:${south},${west},${north},${east}][timeout:120][maxsize:67108864];
(
  way["building"](${south},${west},${north},${east});
  way["highway"](${south},${west},${north},${east});
  way["railway"](${south},${west},${north},${east});
  way["natural"="tree_row"](${south},${west},${north},${east});
  way["landuse"="grass"](${south},${west},${north},${east});
  way["leisure"="park"](${south},${west},${north},${east});
  way["leisure"="garden"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
  way["waterway"](${south},${west},${north},${east});
  node["natural"="tree"](${south},${west},${north},${east});
  node["highway"="traffic_signals"](${south},${west},${north},${east});
  node["amenity"="bench"](${south},${west},${north},${east});
  node["highway"="street_lamp"](${south},${west},${north},${east});
);
out body; >; out skel qt;`;
}

async function fetchFromOverpass(bbox) {
  const query = buildQuery(bbox.south, bbox.west, bbox.north, bbox.east);

  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    const url = OVERPASS_SERVERS[i];
    console.log(`  Trying server: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        console.log(`  Server returned ${resp.status}, trying next...`);
        continue;
      }

      const text = await resp.text();
      return JSON.parse(text);
    } catch (err) {
      console.log(`  Failed: ${err.message}, trying next...`);
      if (i < OVERPASS_SERVERS.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  throw new Error('All Overpass servers failed');
}

function parseOSMResponse(elements) {
  const nodeMap = new Map();
  const buildings = [];
  const highways = [];
  const railways = [];
  const trees = [];
  const treeRows = [];
  const parks = [];
  const water = [];
  const benches = [];
  const streetLamps = [];
  const trafficSignals = [];

  for (const el of elements) {
    if (el.type === 'node') {
      nodeMap.set(el.id, el);
      if (!el.tags) continue;
      if (el.tags['natural'] === 'tree') trees.push(el);
      if (el.tags['amenity'] === 'bench') benches.push(el);
      if (el.tags['highway'] === 'street_lamp') streetLamps.push(el);
      if (el.tags['highway'] === 'traffic_signals') trafficSignals.push(el);
    } else if (el.type === 'way') {
      if (!el.tags) continue;
      if (el.tags['building']) buildings.push(el);
      if (el.tags['highway']) highways.push(el);
      if (el.tags['railway']) railways.push(el);
      if (el.tags['natural'] === 'tree_row') treeRows.push(el);
      if (el.tags['natural'] === 'water') water.push(el);
      if (el.tags['waterway']) water.push(el);
      if (el.tags['leisure'] === 'park' || el.tags['leisure'] === 'garden' || el.tags['landuse'] === 'grass') {
        parks.push(el);
      }
    }
  }

  return { nodeMap, buildings, highways, railways, trees, treeRows, parks, water, benches, streetLamps, trafficSignals };
}

// ──────────────────────────────────────────────────
// TEST 1: Overpass API fetch (small bbox)
// ──────────────────────────────────────────────────
async function testOverpassFetch() {
  console.log('\n══ TEST 1: Overpass API fetch (small bbox ~300m) ══');
  const bbox = SMALL_BBOX;
  console.log(`  Bbox: ${bbox.south},${bbox.west} to ${bbox.north},${bbox.east}`);

  const json = await fetchFromOverpass(bbox);

  assert(json !== null, 'Response is not null');
  assert(json.elements !== undefined, 'Response has "elements" key');
  assert(Array.isArray(json.elements), '"elements" is an array');
  assert(json.elements.length > 0, `Got ${json.elements.length} elements (> 0)`);

  const types = {};
  for (const el of json.elements) {
    types[el.type] = (types[el.type] || 0) + 1;
  }
  console.log(`  Element type breakdown: ${JSON.stringify(types)}`);

  assert(types.node > 0, 'Has nodes');
  assert(types.way > 0, 'Has ways');

  return json;
}

// ──────────────────────────────────────────────────
// TEST 2: Data parsing
// ──────────────────────────────────────────────────
function testParsing(json) {
  console.log('\n══ TEST 2: OSM data parsing ══');

  const data = parseOSMResponse(json.elements);

  assert(data.nodeMap.size > 0, `nodeMap has ${data.nodeMap.size} nodes`);
  assert(data.buildings.length > 0, `Found ${data.buildings.length} buildings`);
  assert(data.highways.length > 0, `Found ${data.highways.length} highways`);

  console.log(`  Summary:`);
  console.log(`    nodes:         ${data.nodeMap.size}`);
  console.log(`    buildings:     ${data.buildings.length}`);
  console.log(`    highways:      ${data.highways.length}`);
  console.log(`    railways:      ${data.railways.length}`);
  console.log(`    trees:         ${data.trees.length}`);
  console.log(`    treeRows:      ${data.treeRows.length}`);
  console.log(`    parks:         ${data.parks.length}`);
  console.log(`    water:         ${data.water.length}`);
  console.log(`    benches:       ${data.benches.length}`);
  console.log(`    streetLamps:   ${data.streetLamps.length}`);
  console.log(`    trafficSignals:${data.trafficSignals.length}`);

  return data;
}

// ──────────────────────────────────────────────────
// TEST 3: Building data integrity
// ──────────────────────────────────────────────────
function testBuildingIntegrity(data) {
  console.log('\n══ TEST 3: Building data integrity ══');

  let resolvedCount = 0;
  let unresolvedCount = 0;
  let withHeightTag = 0;
  let withLevelsTag = 0;
  let closedPolygons = 0;
  let minNodes = Infinity;
  let maxNodes = 0;

  for (const bldg of data.buildings) {
    assert(bldg.nodes && bldg.nodes.length > 0, `Building ${bldg.id} has nodes array`);

    let allResolved = true;
    for (const nodeId of bldg.nodes) {
      if (!data.nodeMap.has(nodeId)) {
        allResolved = false;
        break;
      }
    }

    if (allResolved) {
      resolvedCount++;
    } else {
      unresolvedCount++;
    }

    if (bldg.tags?.['height']) withHeightTag++;
    if (bldg.tags?.['building:levels']) withLevelsTag++;

    if (bldg.nodes.length >= 2 && bldg.nodes[0] === bldg.nodes[bldg.nodes.length - 1]) {
      closedPolygons++;
    }

    minNodes = Math.min(minNodes, bldg.nodes.length);
    maxNodes = Math.max(maxNodes, bldg.nodes.length);

    if (data.buildings.indexOf(bldg) >= 5) continue;
  }

  console.log(`  Resolved (all nodes found): ${resolvedCount}/${data.buildings.length}`);
  console.log(`  Unresolved:                 ${unresolvedCount}`);
  console.log(`  Closed polygons:            ${closedPolygons}/${data.buildings.length}`);
  console.log(`  With height tag:            ${withHeightTag}`);
  console.log(`  With levels tag:            ${withLevelsTag}`);
  console.log(`  Node count range:           ${minNodes} - ${maxNodes}`);

  assert(resolvedCount > 0, 'At least some buildings have all nodes resolved');
  assert(closedPolygons > 0, 'At least some buildings are closed polygons');

  // Show a sample building
  const sample = data.buildings.find(b => {
    const allHaveCoords = b.nodes.every(id => data.nodeMap.has(id));
    return allHaveCoords && b.nodes.length >= 4;
  });

  if (sample) {
    console.log(`\n  Sample building (id=${sample.id}):`);
    console.log(`    tags: ${JSON.stringify(sample.tags)}`);
    console.log(`    nodes: ${sample.nodes.length}`);
    const coords = sample.nodes.slice(0, 5).map(id => {
      const n = data.nodeMap.get(id);
      return n ? `(${n.lat.toFixed(6)}, ${n.lon.toFixed(6)})` : '?';
    });
    console.log(`    first coords: ${coords.join(' → ')}`);
  }
}

// ──────────────────────────────────────────────────
// TEST 4: Road data integrity
// ──────────────────────────────────────────────────
function testRoadIntegrity(data) {
  console.log('\n══ TEST 4: Road data integrity ══');

  const roadTypes = {};
  let resolvedCount = 0;

  for (const road of data.highways) {
    const type = road.tags?.['highway'] ?? 'unknown';
    roadTypes[type] = (roadTypes[type] || 0) + 1;

    const allResolved = road.nodes.every(id => data.nodeMap.has(id));
    if (allResolved) resolvedCount++;
  }

  console.log(`  Road types: ${JSON.stringify(roadTypes)}`);
  console.log(`  Resolved: ${resolvedCount}/${data.highways.length}`);

  assert(resolvedCount > 0, 'At least some roads have all nodes resolved');

  const sample = data.highways.find(r => r.nodes.every(id => data.nodeMap.has(id)) && r.nodes.length >= 3);
  if (sample) {
    console.log(`\n  Sample road (id=${sample.id}, type=${sample.tags?.['highway']}):`);
    console.log(`    nodes: ${sample.nodes.length}`);
    const coords = sample.nodes.slice(0, 4).map(id => {
      const n = data.nodeMap.get(id);
      return n ? `(${n.lat.toFixed(6)}, ${n.lon.toFixed(6)})` : '?';
    });
    console.log(`    first coords: ${coords.join(' → ')}`);
  }
}

// ──────────────────────────────────────────────────
// TEST 5: Projection math
// ──────────────────────────────────────────────────
function testProjection() {
  console.log('\n══ TEST 5: Local projection math ══');

  const DEG2RAD = Math.PI / 180;
  const centerLat = 32.0755;
  const centerLng = 34.7745;
  const metersPerDegLng = 111319 * Math.cos(centerLat * DEG2RAD);
  const metersPerDegLat = 111319;

  function project(lat, lng) {
    return {
      x: (lng - centerLng) * metersPerDegLng,
      z: -(lat - centerLat) * metersPerDegLat,
    };
  }

  function unproject(x, z) {
    return {
      lat: centerLat + (-z / metersPerDegLat),
      lng: centerLng + (x / metersPerDegLng),
    };
  }

  // Center should map to (0,0)
  const center = project(centerLat, centerLng);
  assert(Math.abs(center.x) < 0.001 && Math.abs(center.z) < 0.001,
    `Center (${centerLat}, ${centerLng}) → (${center.x.toFixed(4)}, ${center.z.toFixed(4)}) ≈ (0,0)`);

  // Point 1km east → x ≈ 1000, z ≈ 0
  const eastLng = centerLng + 1000 / metersPerDegLng;
  const east = project(centerLat, eastLng);
  assert(Math.abs(east.x - 1000) < 1 && Math.abs(east.z) < 0.001,
    `1km east → (${east.x.toFixed(1)}, ${east.z.toFixed(4)}) ≈ (1000, 0)`);

  // Point 1km north → x ≈ 0, z ≈ -1000
  const northLat = centerLat + 1000 / metersPerDegLat;
  const north = project(northLat, centerLng);
  assert(Math.abs(north.x) < 0.001 && Math.abs(north.z - (-1000)) < 1,
    `1km north → (${north.x.toFixed(4)}, ${north.z.toFixed(1)}) ≈ (0, -1000)`);

  // Roundtrip: project then unproject
  const testLat = 32.080;
  const testLng = 34.780;
  const projected = project(testLat, testLng);
  const unprojected = unproject(projected.x, projected.z);
  const latErr = Math.abs(unprojected.lat - testLat);
  const lngErr = Math.abs(unprojected.lng - testLng);
  assert(latErr < 1e-8 && lngErr < 1e-8,
    `Roundtrip (${testLat}, ${testLng}) → (${projected.x.toFixed(1)}, ${projected.z.toFixed(1)}) → (${unprojected.lat.toFixed(8)}, ${unprojected.lng.toFixed(8)}) error < 1e-8`);

  // Haversine distance vs projection distance for ~1km
  const stationA = { lat: 32.0755, lng: 34.7745 };
  const stationB = { lat: 32.0795, lng: 34.7920 };
  const pA = project(stationA.lat, stationA.lng);
  const pB = project(stationB.lat, stationB.lng);
  const projDist = Math.sqrt((pB.x - pA.x) ** 2 + (pB.z - pA.z) ** 2);

  // Haversine for comparison
  const R = 6371000;
  const dLat = (stationB.lat - stationA.lat) * DEG2RAD;
  const dLng = (stationB.lng - stationA.lng) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(stationA.lat * DEG2RAD) * Math.cos(stationB.lat * DEG2RAD) * Math.sin(dLng / 2) ** 2;
  const havDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distErr = Math.abs(projDist - havDist);
  const distErrPct = (distErr / havDist) * 100;
  console.log(`  Dizengoff→Arlozorov: projection=${projDist.toFixed(1)}m, haversine=${havDist.toFixed(1)}m, error=${distErr.toFixed(1)}m (${distErrPct.toFixed(2)}%)`);
  assert(distErrPct < 1.0, `Projection distance error < 1% (got ${distErrPct.toFixed(2)}%)`);
}

// ──────────────────────────────────────────────────
// TEST 6: Building geometry data validation
// ──────────────────────────────────────────────────
function testBuildingGeometryData(data) {
  console.log('\n══ TEST 6: Building geometry data validation ══');

  const DEG2RAD = Math.PI / 180;
  const centerLat = 32.0755;
  const centerLng = 34.7745;
  const metersPerDegLng = 111319 * Math.cos(centerLat * DEG2RAD);
  const metersPerDegLat = 111319;

  function project(lat, lng) {
    return {
      x: (lng - centerLng) * metersPerDegLng,
      z: -(lat - centerLat) * metersPerDegLat,
    };
  }

  let validShapes = 0;
  let invalidShapes = 0;
  let tooSmall = 0;
  let sampleAreas = [];

  for (const bldg of data.buildings) {
    const coords = [];
    let allResolved = true;
    for (const nodeId of bldg.nodes) {
      const node = data.nodeMap.get(nodeId);
      if (!node) { allResolved = false; break; }
      coords.push(project(node.lat, node.lon));
    }
    if (!allResolved) continue;
    if (coords.length < 4) { invalidShapes++; continue; }

    // Compute signed area (Shoelace formula)
    let area = 0;
    const pts = coords.slice(0, -1); // remove closing duplicate if closed
    if (pts.length < 3) { invalidShapes++; continue; }

    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i].x * pts[j].z;
      area -= pts[j].x * pts[i].z;
    }
    area = Math.abs(area) / 2;

    if (area < 1) {
      tooSmall++;
      continue;
    }

    validShapes++;
    if (sampleAreas.length < 10) {
      const height = bldg.tags?.['height'] ? parseFloat(bldg.tags['height']) :
                     bldg.tags?.['building:levels'] ? parseInt(bldg.tags['building:levels']) * 3 :
                     null;
      sampleAreas.push({ id: bldg.id, area: area.toFixed(1), nodes: pts.length, height, type: bldg.tags?.['building'] });
    }
  }

  console.log(`  Valid shapes: ${validShapes}`);
  console.log(`  Invalid (< 4 nodes): ${invalidShapes}`);
  console.log(`  Too small (< 1m²): ${tooSmall}`);

  assert(validShapes > 0, 'At least some buildings produce valid shapes');

  if (sampleAreas.length > 0) {
    console.log('\n  Sample buildings for geometry:');
    for (const s of sampleAreas) {
      console.log(`    id=${s.id} area=${s.area}m² nodes=${s.nodes} height=${s.height ?? 'default'} type=${s.type}`);
    }
  }
}

// ──────────────────────────────────────────────────
// TEST 7: Road geometry data validation
// ──────────────────────────────────────────────────
function testRoadGeometryData(data) {
  console.log('\n══ TEST 7: Road geometry data validation ══');

  const DEG2RAD = Math.PI / 180;
  const centerLat = 32.0755;
  const centerLng = 34.7745;
  const metersPerDegLng = 111319 * Math.cos(centerLat * DEG2RAD);
  const metersPerDegLat = 111319;

  function project(lat, lng) {
    return {
      x: (lng - centerLng) * metersPerDegLng,
      z: -(lat - centerLat) * metersPerDegLat,
    };
  }

  const ROAD_WIDTHS = {
    motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7,
    residential: 6, service: 4, footway: 2, path: 1.5, cycleway: 2, pedestrian: 4,
  };

  let validRoads = 0;
  let duplicatePointRoads = 0;

  for (const road of data.highways) {
    const points = [];
    let allResolved = true;
    for (const nodeId of road.nodes) {
      const node = data.nodeMap.get(nodeId);
      if (!node) { allResolved = false; break; }
      points.push(project(node.lat, node.lon));
    }
    if (!allResolved || points.length < 2) continue;

    // Check for duplicate consecutive points
    let hasDuplicates = false;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i-1].x;
      const dz = points[i].z - points[i-1].z;
      if (dx * dx + dz * dz < 0.0001) {
        hasDuplicates = true;
        break;
      }
    }

    if (hasDuplicates) duplicatePointRoads++;
    validRoads++;
  }

  console.log(`  Valid roads (all nodes resolved, >= 2 points): ${validRoads}`);
  console.log(`  Roads with near-duplicate consecutive points: ${duplicatePointRoads}`);

  assert(validRoads > 0, 'At least some roads produce valid polylines');

  // Show a sample road with computed ribbon width
  const sample = data.highways.find(r => {
    const type = r.tags?.['highway'];
    return type && ROAD_WIDTHS[type] && r.nodes.every(id => data.nodeMap.has(id)) && r.nodes.length >= 3;
  });

  if (sample) {
    const type = sample.tags['highway'];
    const width = ROAD_WIDTHS[type] || 5;
    const halfWidth = width / 2;
    const points = sample.nodes.map(id => {
      const n = data.nodeMap.get(id);
      return project(n.lat, n.lon);
    });

    console.log(`\n  Sample road ribbon (id=${sample.id}, type=${type}, width=${width}m):`);

    // Compute perpendicular offset for first segment
    const dx = points[1].x - points[0].x;
    const dz = points[1].z - points[0].z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const nx = -dz / len * halfWidth;
    const nz = dx / len * halfWidth;

    console.log(`    First point: (${points[0].x.toFixed(1)}, ${points[0].z.toFixed(1)})`);
    console.log(`    Left vertex:  (${(points[0].x + nx).toFixed(1)}, ${(points[0].z + nz).toFixed(1)})`);
    console.log(`    Right vertex: (${(points[0].x - nx).toFixed(1)}, ${(points[0].z - nz).toFixed(1)})`);
    console.log(`    Ribbon width check: ${(Math.sqrt((2*nx)**2 + (2*nz)**2)).toFixed(2)}m (expected ${width}m)`);
  }
}

// ──────────────────────────────────────────────────
// TEST 8: Full route bbox (the actual query the game uses)
// ──────────────────────────────────────────────────
async function testFullRouteBbox() {
  console.log('\n══ TEST 8: Full route bbox (all metro stations) ══');

  // All stations from SampleRoutes.ts
  const stations = [
    { lat: 32.0905, lng: 34.8855 }, { lat: 32.0865, lng: 34.8720 },
    { lat: 32.0840, lng: 34.8530 }, { lat: 32.0820, lng: 34.8350 },
    { lat: 32.0785, lng: 34.8120 }, { lat: 32.0795, lng: 34.7920 },
    { lat: 32.0755, lng: 34.7745 }, { lat: 32.0680, lng: 34.7790 },
    { lat: 32.0640, lng: 34.7710 }, { lat: 32.0565, lng: 34.7680 },
    { lat: 32.0510, lng: 34.7560 }, { lat: 32.0225, lng: 34.7505 },
    { lat: 32.1135, lng: 34.8045 }, { lat: 32.1050, lng: 34.7975 },
    { lat: 32.0885, lng: 34.7790 }, { lat: 32.0720, lng: 34.7795 },
    { lat: 32.0640, lng: 34.7755 }, { lat: 32.0570, lng: 34.7710 },
    { lat: 32.0520, lng: 34.7500 }, { lat: 32.1610, lng: 34.7920 },
    { lat: 32.1310, lng: 34.7870 }, { lat: 32.0985, lng: 34.7715 },
    { lat: 32.0830, lng: 34.7670 }, { lat: 32.0780, lng: 34.7680 },
    { lat: 32.0615, lng: 34.7605 },
  ];

  // Compute bbox
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const s of stations) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lng < minLng) minLng = s.lng;
    if (s.lng > maxLng) maxLng = s.lng;
  }

  const DEG2RAD = Math.PI / 180;
  const centerLat = (minLat + maxLat) / 2;
  const marginLat = 500 / 111319;
  const marginLng = 500 / (111319 * Math.cos(centerLat * DEG2RAD));

  const bbox = {
    south: minLat - marginLat,
    west: minLng - marginLng,
    north: maxLat + marginLat,
    east: maxLng + marginLng,
  };

  const latSpan = (bbox.north - bbox.south) * 111319;
  const lngSpan = (bbox.east - bbox.west) * 111319 * Math.cos(centerLat * DEG2RAD);

  console.log(`  Bbox: ${bbox.south.toFixed(5)},${bbox.west.toFixed(5)} to ${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`);
  console.log(`  Span: ${(latSpan/1000).toFixed(1)}km N-S × ${(lngSpan/1000).toFixed(1)}km E-W`);
  console.log(`  Area: ~${((latSpan/1000) * (lngSpan/1000)).toFixed(1)} km²`);

  // This is a large query. Let's see if it works or times out.
  console.log('  Fetching (this may take 30-90 seconds for the full area)...');

  try {
    const json = await fetchFromOverpass(bbox);
    const data = parseOSMResponse(json.elements);

    console.log(`  SUCCESS - received ${json.elements.length} elements`);
    console.log(`    buildings:     ${data.buildings.length}`);
    console.log(`    highways:      ${data.highways.length}`);
    console.log(`    railways:      ${data.railways.length}`);
    console.log(`    trees:         ${data.trees.length}`);
    console.log(`    parks:         ${data.parks.length}`);
    console.log(`    water:         ${data.water.length}`);
    console.log(`    benches:       ${data.benches.length}`);
    console.log(`    streetLamps:   ${data.streetLamps.length}`);
    console.log(`    trafficSignals:${data.trafficSignals.length}`);
    console.log(`    nodeMap size:  ${data.nodeMap.size}`);

    assert(data.buildings.length > 100, `Got substantial buildings (${data.buildings.length} > 100)`);
    assert(data.highways.length > 50, `Got substantial roads (${data.highways.length} > 50)`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    console.log('  The full bbox may be too large. Consider splitting into smaller tiles.');
    assert(false, `Full bbox fetch succeeded`);
  }
}

// ──────────────────────────────────────────────────
// RUN ALL TESTS
// ──────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   MetroRider OSM Pipeline Test Suite         ║');
  console.log('╚══════════════════════════════════════════════╝');

  // Test 5 runs without network
  testProjection();

  // Tests 1-4 and 6-7 use small bbox
  let json, data;
  try {
    json = await testOverpassFetch();
    data = testParsing(json);
    testBuildingIntegrity(data);
    testRoadIntegrity(data);
    testBuildingGeometryData(data);
    testRoadGeometryData(data);
  } catch (err) {
    console.error(`\nFATAL: Failed to fetch test data: ${err.message}`);
    failed++;
  }

  // Test 8: full route bbox
  await testFullRouteBbox();

  console.log('\n════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
