import type { StationData } from './RouteParser';

const STATION_STOP_DIST = 40;

export interface StationState {
  nearestStationIdx: number;
  nearestStationDist: number;
  nextStationIdx: number;
  nextStationDist: number;
  arriving: boolean;
  stationName: string;
}

export class StationManager {
  private lastArrivedIdx: number | null = null;
  private onArrival: ((station: StationData, index: number, totalStations: number) => void) | null = null;

  public setArrivalCallback(cb: (station: StationData, index: number, totalStations: number) => void): void {
    this.onArrival = cb;
  }

  public reset(): void {
    this.lastArrivedIdx = null;
  }

  public update(
    stationDists: number[],
    stations: StationData[],
    trainDist: number,
    trainSpeed: number,
    direction: number,
  ): StationState {
    let nearestStIdx = -1;
    let nearestStDist = Infinity;
    let nextStIdx = -1;
    let nextStDist = Infinity;

    for (let i = 0; i < stationDists.length; i++) {
      const d = Math.abs(trainDist - stationDists[i]);
      if (d < nearestStDist) {
        nearestStDist = d;
        nearestStIdx = i;
      }
      const ahead = direction === 1
        ? stationDists[i] - trainDist
        : trainDist - stationDists[i];
      if (ahead > 10 && ahead < nextStDist) {
        nextStDist = ahead;
        nextStIdx = i;
      }
    }

    const arriving = nearestStDist < STATION_STOP_DIST && trainSpeed < 2;

    if (arriving && this.lastArrivedIdx !== nearestStIdx) {
      this.lastArrivedIdx = nearestStIdx;
      if (this.onArrival && nearestStIdx >= 0 && nearestStIdx < stations.length) {
        this.onArrival(stations[nearestStIdx], nearestStIdx, stations.length);
      }
    }

    if (!arriving) {
      this.lastArrivedIdx = null;
    }

    const stationName = arriving
      ? stations[nearestStIdx]?.name ?? ''
      : nextStIdx >= 0
        ? stations[nextStIdx]?.name ?? ''
        : stations[nearestStIdx]?.name ?? '';

    return {
      nearestStationIdx: nearestStIdx,
      nearestStationDist: nearestStDist,
      nextStationIdx: nextStIdx,
      nextStationDist: nextStDist,
      arriving,
      stationName,
    };
  }
}
