import type { OSMData, OSMNode, OSMWay } from './OSMFetcher';
import { haversine } from '@/core/CoordinateSystem';

const SNAP_RADIUS_M = 200;
const SNAP_THRESHOLD_RATIO = 0.5;

interface GraphEdge {
  to: number;
  weight: number;
}

interface RailwayGraph {
  adjacency: Map<number, GraphEdge[]>;
  nodes: Map<number, { lat: number; lon: number }>;
}

export interface RouteResult {
  polyline: [number, number][];
  usedOSM: boolean;
}

function buildRailwayGraph(railways: OSMWay[], nodeMap: Map<number, OSMNode>): RailwayGraph {
  const adjacency = new Map<number, GraphEdge[]>();
  const nodes = new Map<number, { lat: number; lon: number }>();

  for (const way of railways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i];
      const b = way.nodes[i + 1];
      const nodeA = nodeMap.get(a);
      const nodeB = nodeMap.get(b);
      if (!nodeA || !nodeB) continue;

      nodes.set(a, { lat: nodeA.lat, lon: nodeA.lon });
      nodes.set(b, { lat: nodeB.lat, lon: nodeB.lon });

      const dist = haversine(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon);

      if (!adjacency.has(a)) adjacency.set(a, []);
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(a)!.push({ to: b, weight: dist });
      adjacency.get(b)!.push({ to: a, weight: dist });
    }
  }

  return { adjacency, nodes };
}

function findNearestNode(
  lat: number, lng: number,
  graph: RailwayGraph,
  maxRadius: number,
): number | null {
  let bestId: number | null = null;
  let bestDist = maxRadius;

  for (const [id, node] of graph.nodes) {
    const d = haversine(lat, lng, node.lat, node.lon);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }

  return bestId;
}

function dijkstra(
  graph: RailwayGraph,
  startNode: number,
  endNode: number,
): number[] | null {
  if (startNode === endNode) return [startNode];

  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const visited = new Set<number>();

  dist.set(startNode, 0);

  const pq: { node: number; cost: number }[] = [{ node: startNode, cost: 0 }];

  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const { node: current, cost: currentCost } = pq.shift()!;

    if (visited.has(current)) continue;
    visited.add(current);

    if (current === endNode) break;

    const edges = graph.adjacency.get(current);
    if (!edges) continue;

    for (const edge of edges) {
      if (visited.has(edge.to)) continue;

      const newCost = currentCost + edge.weight;
      const existing = dist.get(edge.to);
      if (existing === undefined || newCost < existing) {
        dist.set(edge.to, newCost);
        prev.set(edge.to, current);
        pq.push({ node: edge.to, cost: newCost });
      }
    }
  }

  if (!prev.has(endNode) && startNode !== endNode) return null;

  const path: number[] = [];
  let cur: number | undefined = endNode;
  while (cur !== undefined) {
    path.push(cur);
    if (cur === startNode) break;
    cur = prev.get(cur);
  }

  if (path[path.length - 1] !== startNode) return null;

  path.reverse();
  return path;
}

export function routeLineOnRailways(
  stations: { lat: number; lng: number }[],
  data: OSMData,
): RouteResult {
  if (stations.length < 2) {
    return { polyline: stations.map(s => [s.lng, s.lat]), usedOSM: false };
  }

  if (data.railways.length === 0) {
    console.log('[TrackRouter] No railway data available, using fallback');
    return { polyline: stations.map(s => [s.lng, s.lat]), usedOSM: false };
  }

  const graph = buildRailwayGraph(data.railways, data.nodeMap);
  console.log(`[TrackRouter] Built railway graph: ${graph.nodes.size} nodes, ${graph.adjacency.size} vertices with edges`);

  const snappedNodes: (number | null)[] = stations.map(
    s => findNearestNode(s.lat, s.lng, graph, SNAP_RADIUS_M),
  );

  const snappedCount = snappedNodes.filter(n => n !== null).length;
  const ratio = snappedCount / stations.length;
  console.log(`[TrackRouter] Station snap: ${snappedCount}/${stations.length} (${(ratio * 100).toFixed(0)}%) snapped within ${SNAP_RADIUS_M}m`);

  if (ratio < SNAP_THRESHOLD_RATIO) {
    console.log('[TrackRouter] Not enough stations snapped, using fallback');
    return { polyline: stations.map(s => [s.lng, s.lat]), usedOSM: false };
  }

  const polyline: [number, number][] = [];

  for (let i = 0; i < stations.length - 1; i++) {
    const fromSnap = snappedNodes[i];
    const toSnap = snappedNodes[i + 1];

    if (fromSnap !== null && toSnap !== null) {
      const path = dijkstra(graph, fromSnap, toSnap);
      if (path && path.length >= 2) {
        const startIdx = polyline.length === 0 ? 0 : 1;
        for (let j = startIdx; j < path.length; j++) {
          const n = graph.nodes.get(path[j]);
          if (n) polyline.push([n.lon, n.lat]);
        }
        continue;
      }
    }

    if (polyline.length === 0) {
      polyline.push([stations[i].lng, stations[i].lat]);
    }
    polyline.push([stations[i + 1].lng, stations[i + 1].lat]);
  }

  console.log(`[TrackRouter] OSM-routed polyline: ${polyline.length} points`);
  return { polyline, usedOSM: true };
}

export const CORRIDOR_RADIUS = 20;

export function isPointInCorridor(
  px: number, pz: number,
  corridorSegments: { x1: number; z1: number; x2: number; z2: number }[],
  radius: number = CORRIDOR_RADIUS,
): boolean {
  for (const seg of corridorSegments) {
    const d = pointToSegmentDistance(px, pz, seg.x1, seg.z1, seg.x2, seg.z2);
    if (d < radius) return true;
  }
  return false;
}

export function pointToSegmentDistance(
  px: number, pz: number,
  x1: number, z1: number,
  x2: number, z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;

  if (lenSq < 1e-10) {
    const ex = px - x1;
    const ez = pz - z1;
    return Math.sqrt(ex * ex + ez * ez);
  }

  let t = ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestZ = z1 + t * dz;
  const ex = px - closestX;
  const ez = pz - closestZ;
  return Math.sqrt(ex * ex + ez * ez);
}

export function buildCorridorSegments(
  polylineLocal: { x: number; z: number }[],
): { x1: number; z1: number; x2: number; z2: number }[] {
  const segments: { x1: number; z1: number; x2: number; z2: number }[] = [];
  for (let i = 0; i < polylineLocal.length - 1; i++) {
    segments.push({
      x1: polylineLocal[i].x,
      z1: polylineLocal[i].z,
      x2: polylineLocal[i + 1].x,
      z2: polylineLocal[i + 1].z,
    });
  }
  return segments;
}

/**
 * Spatial grid index for fast point-to-corridor checks.
 * Buckets segments into grid cells so lookups are O(k) instead of O(n).
 */
export class CorridorSpatialIndex {
  private cellSize: number;
  private grid = new Map<string, { x1: number; z1: number; x2: number; z2: number }[]>();
  private radius: number;

  constructor(
    segments: { x1: number; z1: number; x2: number; z2: number }[],
    radius: number,
  ) {
    this.radius = radius;
    this.cellSize = Math.max(radius * 2, 20);

    for (const seg of segments) {
      const minX = Math.min(seg.x1, seg.x2) - radius;
      const maxX = Math.max(seg.x1, seg.x2) + radius;
      const minZ = Math.min(seg.z1, seg.z2) - radius;
      const maxZ = Math.max(seg.z1, seg.z2) + radius;

      const cx0 = Math.floor(minX / this.cellSize);
      const cx1 = Math.floor(maxX / this.cellSize);
      const cz0 = Math.floor(minZ / this.cellSize);
      const cz1 = Math.floor(maxZ / this.cellSize);

      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const key = `${cx},${cz}`;
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(seg);
        }
      }
    }
  }

  isPointInCorridor(px: number, pz: number): boolean {
    const cx = Math.floor(px / this.cellSize);
    const cz = Math.floor(pz / this.cellSize);
    const key = `${cx},${cz}`;
    const bucket = this.grid.get(key);
    if (!bucket) return false;
    for (const seg of bucket) {
      if (pointToSegmentDistance(px, pz, seg.x1, seg.z1, seg.x2, seg.z2) < this.radius) {
        return true;
      }
    }
    return false;
  }
}

export { buildRailwayGraph, findNearestNode, dijkstra };
export type { RailwayGraph, GraphEdge };
