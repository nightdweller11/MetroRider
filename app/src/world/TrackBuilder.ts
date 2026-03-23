import * as THREE from 'three';
import type { StationData } from '@/data/RouteParser';
import { haversine } from '@/core/CoordinateSystem';
import type { LocalProjection } from '@/world/osm/LocalProjection';

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

export function buildTrackMesh(
  trackData: TrackData,
  color: string,
  projection: LocalProjection,
  aboveGround = 0.5,
): THREE.Line {
  const positions: number[] = [];
  const target = new THREE.Vector3();

  for (const [lng, lat] of trackData.spline.points) {
    projection.getPosition(lat, lng, aboveGround, target);
    positions.push(target.x, target.y, target.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.85,
    linewidth: 2,
  });

  const line = new THREE.Line(geometry, material);
  line.renderOrder = 10;
  return line;
}

const RAIL_GAUGE = 3.0;
const RAIL_HALF = RAIL_GAUGE / 2;
const RAIL_WIDTH = 0.25;
const RAIL_HEIGHT = 0.35;
const SLEEPER_SPACING = 1.2;
const SLEEPER_LENGTH = 4.5;
const SLEEPER_WIDTH = 0.5;
const SLEEPER_HEIGHT = 0.2;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);

export function buildTrainTracks(
  trackData: TrackData,
  projection: LocalProjection,
  aboveGround = 0.3,
): THREE.Group {
  const group = new THREE.Group();
  group.renderOrder = 5;

  const points = trackData.spline.points;
  const cumDist = trackData.cumDist;

  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x888888,
    metalness: 0.8,
    roughness: 0.3,
  });
  const sleeperMaterial = new THREE.MeshStandardMaterial({
    color: 0x8B6914,
    metalness: 0.1,
    roughness: 0.9,
  });

  const railGeom = new THREE.BoxGeometry(RAIL_WIDTH, RAIL_HEIGHT, 1);
  const sleeperGeom = new THREE.BoxGeometry(SLEEPER_LENGTH, SLEEPER_HEIGHT, SLEEPER_WIDTH);

  const segmentPositions: THREE.Vector3[] = [];
  const pos = new THREE.Vector3();

  for (const [lng, lat] of points) {
    projection.getPosition(lat, lng, aboveGround, pos);
    segmentPositions.push(pos.clone());
  }

  const railInstances = new THREE.InstancedMesh(railGeom, railMaterial, points.length * 2);
  let railIdx = 0;
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  for (let i = 0; i < segmentPositions.length - 1; i++) {
    const p0 = segmentPositions[i];
    const p1 = segmentPositions[i + 1];
    const segLen = p0.distanceTo(p1);

    if (segLen < 0.01) continue;

    _fwd.subVectors(p1, p0).normalize();
    _right.crossVectors(_fwd, _upVec).normalize();
    const center = new THREE.Vector3().lerpVectors(p0, p1, 0.5);

    const basisMat = new THREE.Matrix4().makeBasis(_right, _upVec, _fwd);
    quat.setFromRotationMatrix(basisMat);
    scale.set(1, 1, segLen);

    const leftPos = center.clone().add(_right.clone().multiplyScalar(-RAIL_HALF));
    mat4.compose(leftPos, quat, scale);
    railInstances.setMatrixAt(railIdx++, mat4);

    const rightPos = center.clone().add(_right.clone().multiplyScalar(RAIL_HALF));
    mat4.compose(rightPos, quat, scale);
    railInstances.setMatrixAt(railIdx++, mat4);
  }

  railInstances.count = railIdx;
  railInstances.instanceMatrix.needsUpdate = true;
  group.add(railInstances);

  let nextSleeperDist = 0;
  const sleeperMatrices: THREE.Matrix4[] = [];

  for (let i = 0; i < segmentPositions.length - 1; i++) {
    const segStart = cumDist[i];
    const segEnd = cumDist[i + 1];
    const segLen = segEnd - segStart;
    if (segLen < 0.01) continue;

    const p0 = segmentPositions[i];
    const p1 = segmentPositions[i + 1];

    _fwd.subVectors(p1, p0).normalize();
    _right.crossVectors(_fwd, _upVec).normalize();

    while (nextSleeperDist <= segEnd) {
      if (nextSleeperDist >= segStart) {
        const t = (nextSleeperDist - segStart) / segLen;
        const sleeperPos = new THREE.Vector3().lerpVectors(p0, p1, t);
        sleeperPos.add(_upVec.clone().multiplyScalar(-RAIL_HEIGHT * 0.5));

        const basisMat = new THREE.Matrix4().makeBasis(_right, _upVec, _fwd);
        quat.setFromRotationMatrix(basisMat);

        const m = new THREE.Matrix4();
        m.compose(sleeperPos, quat, new THREE.Vector3(1, 1, 1));
        sleeperMatrices.push(m);
      }
      nextSleeperDist += SLEEPER_SPACING;
    }
  }

  if (sleeperMatrices.length > 0) {
    const sleeperInstances = new THREE.InstancedMesh(sleeperGeom, sleeperMaterial, sleeperMatrices.length);
    for (let i = 0; i < sleeperMatrices.length; i++) {
      sleeperInstances.setMatrixAt(i, sleeperMatrices[i]);
    }
    sleeperInstances.instanceMatrix.needsUpdate = true;
    group.add(sleeperInstances);
  }

  return group;
}

export function buildStationMarker(
  station: StationData,
  color: string,
  projection: LocalProjection,
  trackBearingDeg = 0,
): THREE.Group {
  const pos = new THREE.Vector3();
  projection.getPosition(station.lat, station.lng, 0, pos);

  const group = new THREE.Group();
  group.name = `station-${station.id}`;
  group.position.copy(pos);
  group.userData = { stationId: station.id, stationName: station.name };

  const bearingRad = (trackBearingDeg * Math.PI) / 180;

  const PLATFORM_LENGTH = 30;
  const PLATFORM_WIDTH = 8;
  const PLATFORM_HEIGHT = 0.5;
  const platformGeom = new THREE.BoxGeometry(PLATFORM_WIDTH, PLATFORM_HEIGHT, PLATFORM_LENGTH);
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0xb0b0b0,
    roughness: 0.85,
    metalness: 0.1,
  });
  const platform = new THREE.Mesh(platformGeom, platformMat);
  platform.position.y = PLATFORM_HEIGHT / 2;
  platform.rotation.y = bearingRad;
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

  const CANOPY_HEIGHT = 4;
  const CANOPY_THICKNESS = 0.15;
  const CANOPY_WIDTH = PLATFORM_WIDTH + 2;
  const CANOPY_LENGTH = PLATFORM_LENGTH * 0.6;

  const PILLAR_RADIUS = 0.15;
  const PILLAR_HEIGHT = CANOPY_HEIGHT;
  const pillarGeom = new THREE.CylinderGeometry(PILLAR_RADIUS, PILLAR_RADIUS, PILLAR_HEIGHT, 8);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.6, roughness: 0.4 });

  const halfW = CANOPY_WIDTH / 2 - 0.5;
  const halfL = CANOPY_LENGTH / 2 - 1;
  const pillarPositions = [
    { x: -halfW, z: -halfL },
    { x: -halfW, z: halfL },
    { x: halfW, z: -halfL },
    { x: halfW, z: halfL },
  ];

  for (const pp of pillarPositions) {
    const pillar = new THREE.Mesh(pillarGeom, pillarMat);
    const rx = pp.x * Math.cos(bearingRad) - pp.z * Math.sin(bearingRad);
    const rz = pp.x * Math.sin(bearingRad) + pp.z * Math.cos(bearingRad);
    pillar.position.set(rx, PILLAR_HEIGHT / 2 + PLATFORM_HEIGHT, rz);
    pillar.castShadow = true;
    group.add(pillar);
  }

  const canopyGeom = new THREE.BoxGeometry(CANOPY_WIDTH, CANOPY_THICKNESS, CANOPY_LENGTH);
  const canopyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.6,
    metalness: 0.2,
    transparent: true,
    opacity: 0.85,
  });
  const canopy = new THREE.Mesh(canopyGeom, canopyMat);
  canopy.position.y = CANOPY_HEIGHT + PLATFORM_HEIGHT;
  canopy.rotation.y = bearingRad;
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  group.add(canopy);

  const edgeGeom = new THREE.BoxGeometry(PLATFORM_WIDTH, 0.08, PLATFORM_LENGTH);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.5,
  });
  const edge = new THREE.Mesh(edgeGeom, edgeMat);
  edge.position.y = PLATFORM_HEIGHT + 0.04;
  edge.rotation.y = bearingRad;
  group.add(edge);

  group.renderOrder = 11;
  return group;
}
