import type { StationData } from './RouteParser';
import { haversine } from './CoordinateSystem';

export interface SplinePath {
  points: [number, number][];       // [lng, lat] pairs
  stationIndices: number[];
}

export interface TrackData {
  spline: SplinePath;
  cumDist: number[];
  totalLength: number;
  stationDists: number[];
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export function buildSplinePath(stations: StationData[], pointsPerSegment = 30): SplinePath {
  const n = stations.length;
  if (n < 2) {
    return {
      points: stations.map(s => [s.lng, s.lat] as [number, number]),
      stationIndices: [0],
    };
  }

  const pts: [number, number][] = [];
  const stationIndices: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    const p0 = stations[Math.max(0, i - 1)];
    const p1 = stations[i];
    const p2 = stations[i + 1];
    const p3 = stations[Math.min(n - 1, i + 2)];

    stationIndices.push(pts.length);
    for (let j = 0; j < pointsPerSegment; j++) {
      const t = j / pointsPerSegment;
      pts.push([
        catmullRom(p0.lng, p1.lng, p2.lng, p3.lng, t),
        catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, t),
      ]);
    }
  }

  stationIndices.push(pts.length);
  pts.push([stations[n - 1].lng, stations[n - 1].lat]);

  return { points: pts, stationIndices };
}

export function buildCumulativeDistances(points: [number, number][]): number[] {
  const d = [0];
  for (let i = 1; i < points.length; i++) {
    d.push(d[i - 1] + haversine(points[i - 1][1], points[i - 1][0], points[i][1], points[i][0]));
  }
  return d;
}

export interface PositionOnTrack {
  lng: number;
  lat: number;
  idx: number;
}

export function getPositionAtDistance(
  points: [number, number][],
  cumDist: number[],
  dist: number,
): PositionOnTrack {
  if (dist <= 0) {
    return { lng: points[0][0], lat: points[0][1], idx: 0 };
  }
  const totalLen = cumDist[cumDist.length - 1];
  if (dist >= totalLen) {
    const last = points[points.length - 1];
    return { lng: last[0], lat: last[1], idx: points.length - 1 };
  }

  let lo = 0;
  let hi = cumDist.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] <= dist) lo = mid;
    else hi = mid;
  }

  const segLen = cumDist[hi] - cumDist[lo];
  const t = segLen > 0 ? (dist - cumDist[lo]) / segLen : 0;
  return {
    lng: points[lo][0] + t * (points[hi][0] - points[lo][0]),
    lat: points[lo][1] + t * (points[hi][1] - points[lo][1]),
    idx: lo,
  };
}

export function buildTrackData(stations: StationData[]): TrackData {
  const spline = buildSplinePath(stations);
  const cumDist = buildCumulativeDistances(spline.points);
  const totalLength = cumDist[cumDist.length - 1];
  const stationDists = spline.stationIndices.map(idx => cumDist[idx]);
  return { spline, cumDist, totalLength, stationDists };
}

/**
 * Simplify a polyline using Douglas-Peucker with a tolerance in degrees.
 * Preserves start/end and points near stations.
 */
function simplifyPolyline(
  polyline: [number, number][],
  toleranceDeg: number,
  stationCoords?: { lat: number; lng: number }[],
): [number, number][] {
  if (polyline.length <= 2) return polyline;

  const keepSet = new Set<number>();
  keepSet.add(0);
  keepSet.add(polyline.length - 1);

  if (stationCoords) {
    for (const st of stationCoords) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < polyline.length; i++) {
        const dx = polyline[i][0] - st.lng;
        const dy = polyline[i][1] - st.lat;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      keepSet.add(bestIdx);
    }
  }

  function perpDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-14) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
  }

  function dpRecurse(start: number, end: number): void {
    if (end - start <= 1) return;
    let maxDist = 0;
    let maxIdx = start;
    for (let i = start + 1; i < end; i++) {
      const d = perpDist(
        polyline[i][0], polyline[i][1],
        polyline[start][0], polyline[start][1],
        polyline[end][0], polyline[end][1],
      );
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > toleranceDeg || keepSet.has(maxIdx)) {
      keepSet.add(maxIdx);
      dpRecurse(start, maxIdx);
      dpRecurse(maxIdx, end);
    }
  }

  dpRecurse(0, polyline.length - 1);

  const indices = Array.from(keepSet).sort((a, b) => a - b);
  return indices.map(i => polyline[i]);
}

export function buildTrackDataFromPolyline(
  polyline: [number, number][],
  stations: StationData[],
  maxPoints = 200,
): TrackData {
  let simplified = polyline;
  if (polyline.length > maxPoints) {
    const tolerance = 0.0001; // ~11m
    simplified = simplifyPolyline(
      polyline,
      tolerance,
      stations.map(s => ({ lat: s.lat, lng: s.lng })),
    );
    if (simplified.length > maxPoints) {
      const coarserTolerance = 0.0003; // ~33m
      simplified = simplifyPolyline(
        polyline,
        coarserTolerance,
        stations.map(s => ({ lat: s.lat, lng: s.lng })),
      );
    }
    console.log(`[TrackBuilder] Simplified polyline: ${polyline.length} → ${simplified.length} points`);
  }

  const cumDist = buildCumulativeDistances(simplified);
  const totalLength = cumDist[cumDist.length - 1];

  const stationIndices: number[] = [];
  const stationDists: number[] = [];

  for (const st of stations) {
    let bestIdx = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i < simplified.length; i++) {
      const dx = simplified[i][0] - st.lng;
      const dy = simplified[i][1] - st.lat;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
    stationIndices.push(bestIdx);
    stationDists.push(cumDist[bestIdx]);
  }

  return {
    spline: { points: simplified, stationIndices },
    cumDist,
    totalLength,
    stationDists,
  };
}
