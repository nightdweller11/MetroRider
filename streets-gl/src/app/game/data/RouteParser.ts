import { haversine } from './CoordinateSystem';
import type { LineMode } from './LineModes';

export interface StationData {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isWaypoint?: boolean;
  /** Passenger demand weight 0..1 (from the map's density/grade), 0.5 default. */
  density?: number;
  /** Transfer station (served by more than one line). */
  isInterchange?: boolean;
}

export interface LineData {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
  /** What kind of service this is, when the source map says. */
  mode?: LineMode;
  /** The map's line group (MetroDreamin `lineGroupId`): branches of one service. */
  groupId?: string;
  /** The group's own label ("A"), when the map gives one. */
  groupLabel?: string;
  /**
   * Stations on this line's path it runs THROUGH without calling — the
   * express pattern (MetroDreamin `waypointOverrides`, cleaned; see
   * `ServicePatterns.effectiveSkips`).
   */
  skipStationIds?: string[];
  /** The map's author marked this line an express (name or diamond bullet). */
  express?: boolean;
}

export interface MetroMapData {
  name: string;
  stations: Record<string, {
    name: string;
    lat: number;
    lng: number;
    isWaypoint?: boolean;
    density?: number;
    isInterchange?: boolean;
  }>;
  lines: LineData[];
}

export interface ParsedLine {
  id: string;
  name: string;
  color: string;
  /** What kind of service this is, when the source map says. */
  mode?: LineMode;
  stations: StationData[];
  allPoints: StationData[];
  /** True when the line closes back on its first station (circle/loop service). */
  isLoop: boolean;
  /** For each entry of `stations`, its index into `allPoints`. */
  stationPointIndices: number[];
  groupId?: string;
  groupLabel?: string;
  /** The map's author marked this line an express. */
  express?: boolean;
  /**
   * Real stations on the path this service runs through without stopping.
   *
   * Kept OUT of `stations`, deliberately: everything that asks "where does
   * this train stop" — the stop detector, the timetable, the passengers, the
   * other trains, the interchange index — reads `stations`, so an express
   * that skips a station gets no stop, no due time and no waiting crowd
   * there without any of them having to learn a new rule.
   */
  skipped: StationData[];
  /** For each entry of `skipped`, its index into `allPoints`. */
  skippedPointIndices: number[];
}

/** Endpoints closer than this (meters) are treated as a closed loop. */
const LOOP_CLOSE_DISTANCE_M = 150;

export function parseMetroMap(data: MetroMapData): ParsedLine[] {
  if (!data || !data.stations || !data.lines) {
    throw new Error('Invalid metro map data: missing stations or lines');
  }

  return data.lines.map(line => {
    const allPoints: StationData[] = line.stationIds.map(id => {
      const st = data.stations[id];
      if (!st) {
        throw new Error(`Station "${id}" referenced by line "${line.name}" not found`);
      }
      return {
        id,
        name: st.name,
        lat: st.lat,
        lng: st.lng,
        isWaypoint: st.isWaypoint,
        density: st.density,
        isInterchange: st.isInterchange,
      };
    });

    let isLoop = false;
    if (allPoints.length >= 3) {
      const first = allPoints[0];
      const last = allPoints[allPoints.length - 1];
      if (first.id === last.id) {
        isLoop = true;
        // Make the closure exact so the track geometry closes cleanly.
        last.lat = first.lat;
        last.lng = first.lng;
      } else if (haversine(first.lat, first.lng, last.lat, last.lng) < LOOP_CLOSE_DISTANCE_M) {
        isLoop = true;
        // Append an exact copy of the first point (as a waypoint) so the
        // track closes back on itself without duplicating a stop.
        allPoints.push({
          id: `${first.id}__loop-close`,
          name: first.name,
          lat: first.lat,
          lng: first.lng,
          isWaypoint: true,
        });
      }
    }

    let stations: StationData[] = [];
    let stationPointIndices: number[] = [];
    const skipped: StationData[] = [];
    const skippedPointIndices: number[] = [];
    const skip = new Set(line.skipStationIds ?? []);
    for (let i = 0; i < allPoints.length; i++) {
      const p = allPoints[i];
      if (p.isWaypoint) continue;
      // On a loop the closing point revisits the first station — it is the
      // same stop, not a second one.
      if (isLoop && i === allPoints.length - 1 && p.id === allPoints[0].id) continue;
      if (skip.has(p.id)) {
        skipped.push(p);
        skippedPointIndices.push(i);
        continue;
      }
      stations.push(p);
      stationPointIndices.push(i);
    }

    // A skip list that would leave fewer than two stops is not a service
    // pattern, it is a broken one: run the line all-stops instead.
    if (skipped.length > 0 && stations.length < 2) {
      const merged = [
        ...stations.map((st, k) => ({st, at: stationPointIndices[k]})),
        ...skipped.map((st, k) => ({st, at: skippedPointIndices[k]})),
      ].sort((a, b) => a.at - b.at);
      stations = merged.map(m => m.st);
      stationPointIndices = merged.map(m => m.at);
      skipped.length = 0;
      skippedPointIndices.length = 0;
    }

    if (stations.length < 2) {
      throw new Error(`Line "${line.name}" must have at least 2 real stations (has ${stations.length})`);
    }

    return {
      id: line.id,
      name: line.name,
      color: line.color,
      mode: line.mode,
      stations,
      allPoints,
      isLoop,
      stationPointIndices,
      groupId: line.groupId,
      groupLabel: line.groupLabel,
      express: line.express,
      skipped,
      skippedPointIndices,
    };
  });
}
