/**
 * MetroDreamin Importer Test Script
 * Tests fetching, parsing, and converting MetroDreamin shared maps.
 * Run with: node test-metrodreamin.mjs
 */

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

// ── Replicate the importer logic in plain JS ──

function extractMapId(url) {
  const match = url.match(/\/view\/([A-Za-z0-9_+/=%]+)$/);
  if (!match) throw new Error(`Invalid MetroDreamin URL`);
  return match[1];
}

function parseNextData(html) {
  const marker = '__NEXT_DATA__';
  const idx = html.indexOf(marker);
  if (idx < 0) throw new Error('No __NEXT_DATA__ found');

  const startTag = html.indexOf('>', idx);
  if (startTag < 0) throw new Error('Malformed __NEXT_DATA__');

  const endTag = html.indexOf('</script>', startTag);
  if (endTag < 0) throw new Error('Unterminated __NEXT_DATA__');

  const jsonStr = html.substring(startTag + 1, endTag);
  const data = JSON.parse(jsonStr);

  if (!data?.props?.pageProps?.fullSystem?.map) {
    throw new Error('Missing fullSystem.map');
  }

  return data.props.pageProps;
}

function convertToMetroMapData(pageProps) {
  const { systemDocData, fullSystem } = pageProps;
  const mdStations = fullSystem.map.stations;
  const mdLines = fullSystem.map.lines;

  if (!mdStations || Object.keys(mdStations).length === 0) {
    throw new Error('MetroDreamin map has no stations');
  }
  if (!mdLines || Object.keys(mdLines).length === 0) {
    throw new Error('MetroDreamin map has no lines');
  }

  const stations = {};
  let waypointCount = 0;

  for (const [id, st] of Object.entries(mdStations)) {
    if (typeof st.lat !== 'number' || typeof st.lng !== 'number') continue;

    const name = st.isWaypoint
      ? `Waypoint ${++waypointCount}`
      : (st.name || `Station ${id}`);

    stations[id] = { name, lat: st.lat, lng: st.lng };
  }

  const lines = [];

  for (const [, line] of Object.entries(mdLines)) {
    if (!line.stationIds || !Array.isArray(line.stationIds)) continue;

    const validStationIds = line.stationIds.filter(id => stations[id]);
    const realStationCount = validStationIds.filter(id => {
      const mdSt = mdStations[id];
      return mdSt && !mdSt.isWaypoint;
    }).length;

    if (realStationCount < 2) continue;

    lines.push({
      id: line.id || String(lines.length),
      name: line.name || `Line ${lines.length + 1}`,
      color: line.color || '#888888',
      stationIds: validStationIds,
    });
  }

  if (lines.length === 0) {
    throw new Error('No valid lines found in MetroDreamin map');
  }

  return {
    name: systemDocData.title || 'MetroDreamin Map',
    stations,
    lines,
  };
}

// ──────────────────────────────────────────────────
// TEST 1: URL parsing
// ──────────────────────────────────────────────────
function testUrlParsing() {
  console.log('\n══ TEST 1: URL parsing ══');

  const validUrls = [
    'https://metrodreamin.com/view/S1pGUXNUbkpuSmNhN2JXUDFZUExVdkhzYnNmMnww',
    'https://metrodreamin.com/view/SW5uOFUxRHJRWFlnNTNDTmRIY3pwbWQxc2Q3M3w5',
    'https://metrodreamin.com/view/QlExNFJVcVVqNVQ5cW82bDlNemhhOThIV2FCM3w3OA%3D%3D',
  ];

  for (const url of validUrls) {
    const id = extractMapId(url);
    assert(id && id.length > 0, `Extracted ID from ${url.substring(url.lastIndexOf('/') + 1, url.lastIndexOf('/') + 20)}...`);
  }

  const invalidUrls = [
    'https://metrodreamin.com/',
    'https://metrodreamin.com/edit/new',
    '',
  ];

  for (const url of invalidUrls) {
    let threw = false;
    try { extractMapId(url); } catch { threw = true; }
    assert(threw, `Rejects invalid URL: "${url.substring(0, 40)}"`);
  }

  // extractMapId is path-only; domain validation happens in fetchMetroDreaminMap
  const nonDomainUrl = 'https://example.com/view/abc';
  const id = extractMapId(nonDomainUrl);
  assert(id === 'abc', 'extractMapId works on any domain (domain validation is separate)');
}

// ──────────────────────────────────────────────────
// TEST 2: Fetch and parse a real MetroDreamin map
// ──────────────────────────────────────────────────
async function testFetchAndParse() {
  console.log('\n══ TEST 2: Fetch and parse real MetroDreamin map ══');

  const url = 'https://metrodreamin.com/view/SW5uOFUxRHJRWFlnNTNDTmRIY3pwbWQxc2Q3M3w5';
  console.log(`  Fetching: ${url}`);

  let html;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    assert(resp.ok, `HTTP response OK (${resp.status})`);
    html = await resp.text();
    assert(html.length > 1000, `Got substantial HTML (${html.length} chars)`);
  } catch (err) {
    console.error(`  FAILED to fetch: ${err.message}`);
    assert(false, 'Fetch succeeded');
    return null;
  }

  // Parse __NEXT_DATA__
  let pageProps;
  try {
    pageProps = parseNextData(html);
    assert(true, 'Parsed __NEXT_DATA__ successfully');
  } catch (err) {
    assert(false, `Parse __NEXT_DATA__: ${err.message}`);
    return null;
  }

  // Verify page props structure
  assert(pageProps.systemDocData != null, 'Has systemDocData');
  assert(typeof pageProps.systemDocData.title === 'string', `Title: "${pageProps.systemDocData.title}"`);
  assert(pageProps.fullSystem != null, 'Has fullSystem');
  assert(pageProps.fullSystem.map != null, 'Has fullSystem.map');
  assert(typeof pageProps.fullSystem.map.stations === 'object', 'Has stations object');
  assert(typeof pageProps.fullSystem.map.lines === 'object', 'Has lines object');

  const stationCount = Object.keys(pageProps.fullSystem.map.stations).length;
  const lineCount = Object.keys(pageProps.fullSystem.map.lines).length;
  console.log(`  Raw data: ${stationCount} stations, ${lineCount} lines`);
  assert(stationCount > 0, `Has stations (${stationCount})`);
  assert(lineCount > 0, `Has lines (${lineCount})`);

  return pageProps;
}

// ──────────────────────────────────────────────────
// TEST 3: Convert to MetroMapData
// ──────────────────────────────────────────────────
function testConversion(pageProps) {
  console.log('\n══ TEST 3: Convert to MetroMapData ══');

  if (!pageProps) {
    console.log('  Skipped (no data from previous test)');
    return null;
  }

  let mapData;
  try {
    mapData = convertToMetroMapData(pageProps);
    assert(true, 'Conversion succeeded');
  } catch (err) {
    assert(false, `Conversion failed: ${err.message}`);
    return null;
  }

  assert(typeof mapData.name === 'string' && mapData.name.length > 0, `Map name: "${mapData.name}"`);
  assert(typeof mapData.stations === 'object', 'Has stations record');
  assert(Array.isArray(mapData.lines), 'Has lines array');

  const stationCount = Object.keys(mapData.stations).length;
  assert(stationCount > 0, `Has ${stationCount} stations`);
  assert(mapData.lines.length > 0, `Has ${mapData.lines.length} lines`);

  // Check station data integrity
  let hasLatLng = 0;
  let hasName = 0;
  let isWaypoint = 0;
  for (const [id, st] of Object.entries(mapData.stations)) {
    if (typeof st.lat === 'number' && typeof st.lng === 'number') hasLatLng++;
    if (st.name && st.name.length > 0) hasName++;
    if (st.name.startsWith('Waypoint')) isWaypoint++;
  }
  assert(hasLatLng === stationCount, `All ${stationCount} stations have valid lat/lng`);
  assert(hasName === stationCount, `All ${stationCount} stations have names`);
  console.log(`  Waypoints: ${isWaypoint}, Real stations: ${stationCount - isWaypoint}`);

  // Check line data integrity
  for (const line of mapData.lines) {
    assert(typeof line.id === 'string', `Line "${line.name}" has id`);
    assert(typeof line.name === 'string' && line.name.length > 0, `Line has name: "${line.name}"`);
    assert(typeof line.color === 'string' && line.color.startsWith('#'), `Line "${line.name}" has color: ${line.color}`);
    assert(Array.isArray(line.stationIds) && line.stationIds.length >= 2, `Line "${line.name}" has ${line.stationIds.length} station IDs`);

    // Verify all stationIds reference existing stations
    const allValid = line.stationIds.every(id => mapData.stations[id]);
    assert(allValid, `Line "${line.name}": all stationIds reference valid stations`);
  }

  return mapData;
}

// ──────────────────────────────────────────────────
// TEST 4: Waypoint preservation
// ──────────────────────────────────────────────────
function testWaypointPreservation(pageProps, mapData) {
  console.log('\n══ TEST 4: Waypoint preservation ══');

  if (!pageProps || !mapData) {
    console.log('  Skipped (no data)');
    return;
  }

  const mdStations = pageProps.fullSystem.map.stations;
  const originalWaypoints = Object.values(mdStations).filter(s => s.isWaypoint);
  console.log(`  Original waypoints in MetroDreamin data: ${originalWaypoints.length}`);

  // Count how many waypoints made it into stationIds of lines
  let waypointsInLines = 0;
  for (const line of mapData.lines) {
    for (const sid of line.stationIds) {
      const original = mdStations[sid];
      if (original && original.isWaypoint) waypointsInLines++;
    }
  }
  console.log(`  Waypoints preserved in line stationIds: ${waypointsInLines}`);

  if (originalWaypoints.length > 0) {
    assert(waypointsInLines > 0, 'Some waypoints are preserved in line station lists');
  } else {
    assert(true, 'No waypoints to preserve (map has none)');
  }
}

// ──────────────────────────────────────────────────
// TEST 5: Error handling
// ──────────────────────────────────────────────────
function testErrorHandling() {
  console.log('\n══ TEST 5: Error handling ══');

  // parseNextData with no __NEXT_DATA__
  let threw = false;
  try { parseNextData('<html><body>no data here</body></html>'); } catch { threw = true; }
  assert(threw, 'parseNextData throws on missing __NEXT_DATA__');

  // parseNextData with malformed JSON
  threw = false;
  try { parseNextData('<script id="__NEXT_DATA__" type="application/json">{invalid json}</script>'); } catch { threw = true; }
  assert(threw, 'parseNextData throws on malformed JSON');

  // convertToMetroMapData with empty stations
  threw = false;
  try {
    convertToMetroMapData({
      systemDocData: { title: 'test' },
      fullSystem: { map: { stations: {}, lines: { '1': { stationIds: ['a'] } } } },
    });
  } catch { threw = true; }
  assert(threw, 'convertToMetroMapData throws on empty stations');

  // convertToMetroMapData with no valid lines
  threw = false;
  try {
    convertToMetroMapData({
      systemDocData: { title: 'test' },
      fullSystem: { map: { stations: { '1': { lat: 0, lng: 0, name: 'A' } }, lines: {} } },
    });
  } catch { threw = true; }
  assert(threw, 'convertToMetroMapData throws on no valid lines');
}

// ──────────────────────────────────────────────────
// RUN ALL TESTS
// ──────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   MetroRider MetroDreamin Importer Tests      ║');
  console.log('╚══════════════════════════════════════════════╝');

  testUrlParsing();
  testErrorHandling();

  const pageProps = await testFetchAndParse();
  const mapData = testConversion(pageProps);
  testWaypointPreservation(pageProps, mapData);

  console.log('\n════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
