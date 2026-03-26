export interface StationData {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isWaypoint?: boolean;
}

export interface LineData {
  id: string;
  name: string;
  color: string;
  stationIds: string[];
}

export interface MetroMapData {
  name: string;
  stations: Record<string, { name: string; lat: number; lng: number; isWaypoint?: boolean }>;
  lines: LineData[];
}

export interface ParsedLine {
  id: string;
  name: string;
  color: string;
  stations: StationData[];
  allPoints: StationData[];
}

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
      return { id, name: st.name, lat: st.lat, lng: st.lng, isWaypoint: st.isWaypoint };
    });

    const stations = allPoints.filter(s => !s.isWaypoint);

    if (stations.length < 2) {
      throw new Error(`Line "${line.name}" must have at least 2 real stations (has ${stations.length})`);
    }

    return {
      id: line.id,
      name: line.name,
      color: line.color,
      stations,
      allPoints,
    };
  });
}
