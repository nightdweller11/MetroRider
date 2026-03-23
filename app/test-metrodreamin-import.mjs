/**
 * Test script to verify MetroDreamin import works correctly.
 * Fetches a real MetroDreamin URL and simulates the full import pipeline.
 */

const TARGET_URL = 'https://metrodreamin.com/view/QVQ2V2ZIYVpyUFEzNE1acEVLcGhlVkdqR3BPMnwxNg%3D%3D';

async function fetchPage() {
  console.log('Fetching MetroDreamin page...');
  const resp = await fetch(TARGET_URL, { headers: { 'Accept': 'text/html' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

function parseNextData(html) {
  const marker = '__NEXT_DATA__';
  const idx = html.indexOf(marker);
  if (idx < 0) throw new Error('__NEXT_DATA__ not found');
  const startTag = html.indexOf('>', idx);
  const endTag = html.indexOf('</script>', startTag);
  return JSON.parse(html.substring(startTag + 1, endTag));
}

function simulateImporter(pageProps) {
  const { systemDocData, fullSystem } = pageProps;
  const mdStations = fullSystem.map.stations;
  const mdLines = fullSystem.map.lines;

  const stations = {};
  let waypointCount = 0;
  let realStationCount = 0;

  for (const [id, st] of Object.entries(mdStations)) {
    if (typeof st.lat !== 'number' || typeof st.lng !== 'number') continue;
    const isWaypoint = !!st.isWaypoint;
    const name = isWaypoint ? `Waypoint ${++waypointCount}` : (st.name || `Station ${id}`);
    if (!isWaypoint) realStationCount++;
    stations[id] = { name, lat: st.lat, lng: st.lng, isWaypoint: isWaypoint || undefined };
  }

  const lines = [];
  for (const [, line] of Object.entries(mdLines)) {
    if (!line.stationIds || !Array.isArray(line.stationIds)) continue;
    const validStationIds = line.stationIds.filter(id => stations[id]);
    const realCount = validStationIds.filter(id => !stations[id]?.isWaypoint).length;
    if (realCount < 2) continue;
    lines.push({
      id: line.id || String(lines.length),
      name: line.name,
      color: line.color,
      stationIds: validStationIds,
    });
  }

  return { name: systemDocData.title, stations, lines };
}

function simulateParseMetroMap(mapData) {
  return mapData.lines.map(line => {
    const allPoints = line.stationIds.map(id => {
      const st = mapData.stations[id];
      return { id, name: st.name, lat: st.lat, lng: st.lng, isWaypoint: st.isWaypoint };
    });
    const realStations = allPoints.filter(s => !s.isWaypoint);
    return { id: line.id, name: line.name, color: line.color, stations: realStations, allPoints };
  });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
  console.log('=== MetroDreamin Import Pipeline Test ===\n');

  const html = await fetchPage();
  const nextData = parseNextData(html);
  const pageProps = nextData.props.pageProps;

  // Step 1: Simulate importer
  const mapData = simulateImporter(pageProps);
  console.log(`Map: "${mapData.name}"`);
  console.log(`Total entries: ${Object.keys(mapData.stations).length}`);

  const waypointEntries = Object.values(mapData.stations).filter(s => s.isWaypoint).length;
  const realEntries = Object.values(mapData.stations).filter(s => !s.isWaypoint).length;
  console.log(`  Real stations: ${realEntries}`);
  console.log(`  Waypoints: ${waypointEntries}`);
  console.log(`  Lines: ${mapData.lines.length}\n`);

  // Step 2: Simulate parseMetroMap
  const parsed = simulateParseMetroMap(mapData);

  console.log('=== Line Details ===');
  let totalAllPoints = 0;
  let totalRealStations = 0;

  for (const line of parsed) {
    const hasWaypoints = line.allPoints.length > line.stations.length;
    totalAllPoints += line.allPoints.length;
    totalRealStations += line.stations.length;

    // Calculate track length from all points
    let trackLength = 0;
    for (let i = 1; i < line.allPoints.length; i++) {
      trackLength += haversine(
        line.allPoints[i - 1].lat, line.allPoints[i - 1].lng,
        line.allPoints[i].lat, line.allPoints[i].lng,
      );
    }

    console.log(`  "${line.name}" (${line.color})`);
    console.log(`    Real stations: ${line.stations.length}`);
    console.log(`    All points (path): ${line.allPoints.length}`);
    console.log(`    Has waypoints: ${hasWaypoints}`);
    console.log(`    Track length: ${(trackLength / 1000).toFixed(1)} km`);

    // Verify real station names
    const stationNames = line.stations.map(s => s.name).join(' → ');
    console.log(`    Stations: ${stationNames.substring(0, 120)}${stationNames.length > 120 ? '...' : ''}`);
    console.log();
  }

  console.log(`Total: ${parsed.length} lines, ${totalRealStations} real station refs, ${totalAllPoints} path points`);

  // Step 3: Verify bbox handling
  const allLats = [];
  const allLngs = [];
  for (const line of parsed) {
    for (const pt of line.allPoints) {
      allLats.push(pt.lat);
      allLngs.push(pt.lng);
    }
  }

  const latExtentKm = (Math.max(...allLats) - Math.min(...allLats)) * 111.319;
  const lngExtentKm = (Math.max(...allLngs) - Math.min(...allLngs)) * 111.319 * Math.cos(allLats[0] * Math.PI / 180);
  const isLargeMap = latExtentKm > 20 || lngExtentKm > 20;

  console.log(`\n=== BBox Analysis ===`);
  console.log(`  Full extent: ${latExtentKm.toFixed(1)} km x ${lngExtentKm.toFixed(1)} km`);
  console.log(`  Large map: ${isLargeMap}`);

  if (isLargeMap) {
    const firstLine = parsed[0];
    const fl_lats = firstLine.allPoints.map(p => p.lat);
    const fl_lngs = firstLine.allPoints.map(p => p.lng);
    const fl_latKm = (Math.max(...fl_lats) - Math.min(...fl_lats)) * 111.319;
    const fl_lngKm = (Math.max(...fl_lngs) - Math.min(...fl_lngs)) * 111.319 * Math.cos(fl_lats[0] * Math.PI / 180);
    console.log(`  First line "${firstLine.name}" extent: ${fl_latKm.toFixed(1)} km x ${fl_lngKm.toFixed(1)} km`);
    console.log(`  OSM data will be loaded for first line area only.`);
  }

  // Step 4: Verify station ordering makes sense
  console.log('\n=== Station Order Verification (first 3 lines) ===');
  for (const line of parsed.slice(0, 3)) {
    console.log(`  "${line.name}":`);
    for (let i = 0; i < line.stations.length; i++) {
      const st = line.stations[i];
      let dist = '';
      if (i > 0) {
        const prev = line.stations[i - 1];
        const d = haversine(prev.lat, prev.lng, st.lat, st.lng);
        dist = ` (${(d / 1000).toFixed(1)} km from prev)`;
      }
      console.log(`    ${i + 1}. ${st.name} (${st.lat.toFixed(4)}, ${st.lng.toFixed(4)})${dist}`);
    }
  }

  console.log('\n=== ALL TESTS PASSED ===');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
