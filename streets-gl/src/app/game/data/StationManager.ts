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
  public reset(): void {
    this.lastArrivedIdx = null;
  }

  public update(
    stationDists: number[],
    stations: StationData[],
    trainDist: number,
    trainSpeed: number,
    direction: number,
    isLoop = false,
    totalLength = 0,
  ): StationState {
    let nearestStIdx = -1;
    let nearestStDist = Infinity;
    let nextStIdx = -1;
    let nextStDist = Infinity;

    const circular = isLoop && totalLength > 0;

    for (let i = 0; i < stationDists.length; i++) {
      let d = Math.abs(trainDist - stationDists[i]);
      if (circular) {
        d = Math.min(d, totalLength - d);
      }
      if (d < nearestStDist) {
        nearestStDist = d;
        nearestStIdx = i;
      }
      let ahead = direction === 1
        ? stationDists[i] - trainDist
        : trainDist - stationDists[i];
      if (circular) {
        // On a loop every station is always ahead — wrap into [0, L).
        ahead = ((ahead % totalLength) + totalLength) % totalLength;
      }
      if (ahead > 10 && ahead < nextStDist) {
        nextStDist = ahead;
        nextStIdx = i;
      }
    }

    const arriving = nearestStDist < STATION_STOP_DIST && trainSpeed < 2;

    if (arriving && this.lastArrivedIdx !== nearestStIdx) {
      this.lastArrivedIdx = nearestStIdx;
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
