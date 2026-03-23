import type { MetroMapData, LineData } from './RouteParser';

const CORS_PROXIES = [
  (url: string) => `/api/metrodreamin/view/${extractMapId(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

function extractMapId(url: string): string {
  const match = url.match(/\/view\/([A-Za-z0-9_+/=%]+)$/);
  if (!match) {
    throw new Error(`Invalid MetroDreamin URL: expected format https://metrodreamin.com/view/<id>`);
  }
  return match[1];
}

interface MDStation {
  id: string;
  lat: number;
  lng: number;
  name?: string;
  isWaypoint?: boolean;
  grade?: string;
  info?: Record<string, unknown>;
  densityInfo?: Record<string, unknown>;
}

interface MDLine {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
  mode?: string;
  lineGroupId?: string;
}

interface MDFullSystem {
  map: {
    stations: Record<string, MDStation>;
    lines: Record<string, MDLine>;
    interchanges?: Record<string, unknown>;
  };
}

interface MDPageProps {
  systemDocData: {
    title: string;
    numStations?: number;
    numLines?: number;
    centroid?: { lat: number; lng: number };
  };
  fullSystem: MDFullSystem;
}

function parseNextData(html: string): MDPageProps {
  const marker = '__NEXT_DATA__';
  const idx = html.indexOf(marker);
  if (idx < 0) {
    throw new Error('MetroDreamin page does not contain __NEXT_DATA__');
  }

  const startTag = html.indexOf('>', idx);
  if (startTag < 0) {
    throw new Error('Malformed __NEXT_DATA__ script tag');
  }

  const endTag = html.indexOf('</script>', startTag);
  if (endTag < 0) {
    throw new Error('Unterminated __NEXT_DATA__ script tag');
  }

  const jsonStr = html.substring(startTag + 1, endTag);

  let data: { props: { pageProps: MDPageProps } };
  try {
    data = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse __NEXT_DATA__ JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!data?.props?.pageProps?.fullSystem?.map) {
    throw new Error('MetroDreamin data is missing fullSystem.map');
  }

  return data.props.pageProps;
}

function convertToMetroMapData(pageProps: MDPageProps): MetroMapData {
  const { systemDocData, fullSystem } = pageProps;
  const mdStations = fullSystem.map.stations;
  const mdLines = fullSystem.map.lines;

  if (!mdStations || Object.keys(mdStations).length === 0) {
    throw new Error('MetroDreamin map has no stations');
  }
  if (!mdLines || Object.keys(mdLines).length === 0) {
    throw new Error('MetroDreamin map has no lines');
  }

  const stations: Record<string, { name: string; lat: number; lng: number; isWaypoint?: boolean }> = {};
  let waypointCount = 0;
  let realStationCount = 0;

  for (const [id, st] of Object.entries(mdStations)) {
    if (typeof st.lat !== 'number' || typeof st.lng !== 'number') {
      console.error(`[MetroDreaminImporter] Station ${id} has invalid coordinates, skipping`);
      continue;
    }

    const isWaypoint = !!st.isWaypoint;
    const name = isWaypoint
      ? `Waypoint ${++waypointCount}`
      : (st.name || `Station ${id}`);

    if (!isWaypoint) realStationCount++;
    stations[id] = { name, lat: st.lat, lng: st.lng, isWaypoint: isWaypoint || undefined };
  }

  const lines: LineData[] = [];

  for (const [, line] of Object.entries(mdLines)) {
    if (!line.stationIds || !Array.isArray(line.stationIds)) {
      console.error(`[MetroDreaminImporter] Line "${line.name}" has no stationIds, skipping`);
      continue;
    }

    const validStationIds = line.stationIds.filter(id => stations[id]);

    const realStationCount = validStationIds.filter(id => {
      const mdSt = mdStations[id];
      return mdSt && !mdSt.isWaypoint;
    }).length;

    if (realStationCount < 2) {
      console.log(`[MetroDreaminImporter] Line "${line.name}" has < 2 real stations (${realStationCount}), skipping`);
      continue;
    }

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

  console.log(`[MetroDreaminImporter] Converted: ${realStationCount} real stations, ${waypointCount} waypoints, ${lines.length} lines`);

  return {
    name: systemDocData.title || 'MetroDreamin Map',
    stations,
    lines,
  };
}

export async function fetchMetroDreaminMap(url: string): Promise<MetroMapData> {
  if (!url || !url.includes('metrodreamin.com/view/')) {
    throw new Error('Invalid MetroDreamin URL: must be a metrodreamin.com/view/ link');
  }

  let html: string | null = null;
  let lastError: Error | null = null;

  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyUrl = CORS_PROXIES[i](url);
    console.log(`[MetroDreaminImporter] Attempt ${i + 1}/${CORS_PROXIES.length}: fetching via ${proxyUrl.substring(0, 60)}...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(proxyUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'text/html' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        console.error(`[MetroDreaminImporter] ${lastError.message}`);
        continue;
      }

      html = await response.text();
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[MetroDreaminImporter] Attempt ${i + 1} failed: ${lastError.message}`);
    }
  }

  if (!html) {
    throw new Error(`Failed to fetch MetroDreamin map. Last error: ${lastError?.message ?? 'unknown'}`);
  }

  const pageProps = parseNextData(html);
  return convertToMetroMapData(pageProps);
}

export { extractMapId, parseNextData, convertToMetroMapData };
