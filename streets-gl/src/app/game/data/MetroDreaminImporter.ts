import type { MetroMapData, LineData } from './RouteParser';
import { parseLineMode } from './LineModes';

const CORS_PROXIES = [
  (url: string): string => `/api/metrodreamin/view/${extractMapId(url)}`,
  (url: string): string => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string): string => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

function extractMapId(url: string): string {
  const match = url.match(/\/view\/([A-Za-z0-9_+/=%]+)$/);
  if (!match) {
    throw new Error(`Invalid MetroDreamin URL: expected format https://metrodreamin.com/view/<id>`);
  }
  return match[1];
}

interface MDDensityInfo {
  population?: number;
  employment?: number;
  density?: number;
  builtV?: number;
}

interface MDStationInfo {
  densityScore?: number;
  numNearbyBuildings?: number;
  buildingArea?: number;
}

interface MDStation {
  id: string;
  lat: number;
  lng: number;
  name?: string;
  isWaypoint?: boolean;
  /** 'below' | 'at' | 'above' — TRACK ELEVATION, not demand. */
  grade?: string;
  info?: MDStationInfo;
  densityInfo?: MDDensityInfo;
}

/**
 * Turn MetroDreamin's catchment numbers into a 0..1 passenger-demand weight.
 *
 * MetroDreamin computes, per station, the population and employment inside a
 * walking catchment (`densityInfo`) plus a `densityScore` from nearby building
 * footprints. Both matter: population is where trips START, employment is
 * where they END, so a business district with few residents still deserves a
 * busy platform.
 *
 * Measured on the Israel-railways map (86 real stations): population
 * 0 / 1,007 / 3,738 / 10,598 / 63,082 (min/p25/median/p75/max), employment
 * 0 / 42 / 1,056 / 7,044 / 46,726. That is three orders of magnitude, so the
 * combined weight is compressed logarithmically and normalised so the MEDIAN
 * station lands near 0.5 — the same value used when a map carries no data at
 * all, which keeps hand-drawn maps and real ones comparable.
 *
 * (`grade` is deliberately unused here: it is 'below'/'at'/'above', the track
 * elevation. The original plan called it a demand field; the live payload says
 * otherwise.)
 */
const DEMAND_LOG_FLOOR = 2.3;   // log10(1 + ~200 people) — a rural halt
const DEMAND_LOG_RANGE = 2.7;   // up to log10(1 + ~100k) — a city centre

export function stationDensityFromMD(st: {info?: MDStationInfo; densityInfo?: MDDensityInfo}): number {
  const di = st.densityInfo;
  const pop = typeof di?.population === 'number' && di.population >= 0 ? di.population : null;
  const emp = typeof di?.employment === 'number' && di.employment >= 0 ? di.employment : null;

  if (pop !== null || emp !== null) {
    const weight = (pop ?? 0) + 0.75 * (emp ?? 0);
    const norm = (Math.log10(1 + weight) - DEMAND_LOG_FLOOR) / DEMAND_LOG_RANGE;
    return Math.max(0.05, Math.min(1, norm));
  }

  const score = st.info?.densityScore;
  if (typeof score === 'number' && score >= 0) {
    return Math.max(0.05, Math.min(1, score / 100));
  }

  return 0.5;
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
    const snippet = html.substring(0, 500);
    console.error('[MetroDreaminImporter] __NEXT_DATA__ not found. HTML starts with:', snippet);
    throw new Error(
      'MetroDreamin page does not contain __NEXT_DATA__. ' +
      'The response may be a local page (proxy misconfiguration) or MetroDreamin returned a client-only shell.'
    );
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

  const interchangeStationIds = new Set<string>();
  const interchanges = fullSystem.map.interchanges;
  if (interchanges) {
    for (const entry of Object.values(interchanges)) {
      const ids = (entry as {stationIds?: string[]})?.stationIds;
      if (Array.isArray(ids)) {
        for (const id of ids) interchangeStationIds.add(id);
      }
    }
  }

  const stations: Record<string, {
    name: string;
    lat: number;
    lng: number;
    isWaypoint?: boolean;
    density?: number;
    isInterchange?: boolean;
  }> = {};
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
    stations[id] = {
      name,
      lat: st.lat,
      lng: st.lng,
      isWaypoint: isWaypoint || undefined,
      density: isWaypoint ? undefined : stationDensityFromMD(st),
      isInterchange: interchangeStationIds.has(id) || undefined,
    };
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
      mode: parseLineMode(line.mode),
    });
  }

  if (lines.length === 0) {
    throw new Error('No valid lines found in MetroDreamin map');
  }

  const interchangeCount = Object.values(stations).filter(s => s.isInterchange).length;
  console.log(
    `[MetroDreaminImporter] Converted: ${realStationCount} real stations, ` +
    `${waypointCount} waypoints, ${lines.length} lines, ${interchangeCount} interchange stops`
  );

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

  let lastError: Error | null = null;

  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const proxyUrl = CORS_PROXIES[i](url);
    console.log(`[MetroDreaminImporter] Attempt ${i + 1}/${CORS_PROXIES.length}: fetching via ${proxyUrl.substring(0, 80)}...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(proxyUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
        console.error(`[MetroDreaminImporter] Attempt ${i + 1}: ${lastError.message}`);
        continue;
      }

      const html = await response.text();

      if (!html.includes('__NEXT_DATA__')) {
        console.warn(
          `[MetroDreaminImporter] Attempt ${i + 1}: response has no __NEXT_DATA__ ` +
          `(${html.length} bytes, starts with: "${html.substring(0, 80)}..."). Trying next proxy.`
        );
        lastError = new Error('Response does not contain __NEXT_DATA__');
        continue;
      }

      console.log(`[MetroDreaminImporter] Attempt ${i + 1}: success (${html.length} bytes)`);
      const pageProps = parseNextData(html);
      return convertToMetroMapData(pageProps);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[MetroDreaminImporter] Attempt ${i + 1} failed: ${lastError.message}`);
    }
  }

  throw new Error(`Failed to fetch MetroDreamin map after ${CORS_PROXIES.length} attempts. Last error: ${lastError?.message ?? 'unknown'}`);
}

export interface MDMapListEntry {
  id: string;
  title: string;
  numLines: number;
  numStations: number;
}

function extractUserId(url: string): string {
  const match = url.match(/\/user\/([A-Za-z0-9_+/=%]+)$/);
  if (!match) {
    throw new Error('Invalid MetroDreamin user URL: expected format https://metrodreamin.com/user/<id>');
  }
  return match[1];
}

export function isUserUrl(url: string): boolean {
  return url.includes('metrodreamin.com/user/');
}

export function isMapUrl(url: string): boolean {
  return url.includes('metrodreamin.com/view/');
}

export async function fetchUserMaps(url: string): Promise<{username: string; maps: MDMapListEntry[]}> {
  const userId = extractUserId(url);
  const proxyUrl = `/api/metrodreamin/user/${userId}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(proxyUrl, {
      signal: controller.signal,
      headers: {'Accept': 'application/json'},
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as {username: string; maps: MDMapListEntry[]};

    console.log(`[MetroDreaminImporter] User "${data.username}": found ${data.maps.length} maps`);
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export function buildMapUrl(mapId: string): string {
  return `https://metrodreamin.com/view/${mapId}`;
}

export { extractMapId, parseNextData, convertToMetroMapData };
