import System from '~/app/System';
import TrainSystem from '../TrainSystem';
import MathUtils from '~/lib/math/MathUtils';
import {
	countryForLocation, signNumber, signStyleFor, SignStyle, TransportMode, unitLabel,
} from './SignStyle';
import {
	buildSpeedProfile, limitAt, nextChange, speedState,
	SpeedSegment, SpeedState, NextChange, SERIOUS_OVERSPEED, toSignKmh,
} from './SpeedProfile';

/**
 * What kind of railway this is, from what the line looks like.
 *
 * MetroDreamin does carry a mode per line, but it is not threaded through the
 * importer yet (that is F6), and the signage has to be right today. Station
 * spacing is a good proxy in the meantime: metros stop every few hundred
 * metres, trams more often still, and main lines run kilometres between stops.
 */
function inferMode(lineName: string, totalLength: number, stationCount: number): TransportMode {
	const name = lineName.toLowerCase();
	if (name.includes('tram')) return 'tram';
	if (name.includes('metro') || name.includes('subway') || name.includes('underground')) return 'metro';
	if (name.includes('light rail') || name.includes('lrt')) return 'light-rail';

	const spacing = stationCount > 1 ? totalLength / (stationCount - 1) : totalLength;
	if (spacing < 600) return 'tram';
	if (spacing < 1800) return 'metro';
	return 'rail';
}

/**
 * Speed limits, in force.
 *
 * Builds the profile once per line (it only depends on the track geometry),
 * then each frame answers the three questions the rest of the game asks: what
 * is the limit here, what changes next, and is the driver over it.
 */
export default class SpeedLimitSystem extends System {
	private segments: SpeedSegment[] = [];
	private lineKey = '';

	public limit = 0;
	/** Signage of the railway this map belongs to. */
	public sign: SignStyle = signStyleFor('rail', 'XX');
	public countryCode = 'XX';
	public mode: TransportMode = 'rail';
	public state: SpeedState = 'ok';
	public change: NextChange | null = null;
	/** Seconds spent above the limit this run — the score reads this. */
	public overspeedSeconds = 0;
	/** Of that, seconds spent MORE than 25% over — the expensive kind. */
	public seriousOverspeedSeconds = 0;

	public postInit(): void {
		// The profile is built lazily on the first update that has a line.
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const ls = trainSystem?.getCurrentLine();
		if (!trainSystem || !ls) return;

		const key = `${trainSystem.mapName}::${ls.parsed.id}`;
		if (key !== this.lineKey) {
			this.lineKey = key;
			this.segments = buildSpeedProfile(
				// The spline stores [lng, lat] DEGREES. Curvature has to be
				// measured in metres or every curve looks like a straight line:
				// a 200 m bend spans ~0.002° and the three points are collinear
				// to within floating-point noise, so the first version posted
				// the line maximum over all 87 km of the Israel map.
				ls.track.spline.points.map((p: [number, number]) => {
					const m = MathUtils.degrees2meters(p[1], p[0]);
					return {x: m.x, y: m.y};
				}),
				ls.track.cumDist,
				ls.track.isLoop,
				{lineMax: trainSystem.getMaxSpeedKmH() / 3.6},
			);
			this.overspeedSeconds = 0;
			this.seriousOverspeedSeconds = 0;

			// Signage belongs to the railway, so it is resolved from where the
			// line actually is and what kind of service it runs.
			const stations = ls.parsed.stations;
			const mid = stations[Math.floor(stations.length / 2)] ?? stations[0];
			if (mid) {
				this.countryCode = countryForLocation(mid.lat, mid.lng);
			}
			this.mode = inferMode(ls.parsed.name, ls.track.totalLength, stations.length);
			this.sign = signStyleFor(this.mode, this.countryCode);
		}

		if (!trainSystem.gameActive) return;

		const dist = trainSystem.physicsState.trainDist;
		const speed = trainSystem.physicsState.trainSpeed;

		this.limit = limitAt(this.segments, dist, trainSystem.getMaxSpeedKmH() / 3.6);
		this.state = speedState(speed, this.limit);
		this.change = nextChange(
			this.segments, dist, trainSystem.physicsState.direction,
			ls.track.totalLength, ls.track.isLoop,
		);

		if (this.state === 'over') {
			this.overspeedSeconds += Math.min(deltaTime, 0.5);
			if (speed > this.limit * (1 + SERIOUS_OVERSPEED)) {
				this.seriousOverspeedSeconds += Math.min(deltaTime, 0.5);
			}
		}

		// Nothing here touches the train. A speed limit is information the
		// DRIVER acts on — a previous version cut traction above the limit,
		// which took the decision away from the player and made the sign
		// pointless. Ignoring it costs points on the run card; that is the
		// whole enforcement, and it is the player's call.
	}

	/** The number a sign or the HUD shows, km/h — the plain figure. */
	public limitKmh(): number {
		return toSignKmh(this.limit);
	}

	/** The number printed on THIS railway's sign face (tens, mph, or km/h). */
	public signFace(): number {
		return signNumber(this.limit, this.sign);
	}

	public signFaceFor(limitMs: number): number {
		return signNumber(limitMs, this.sign);
	}

	public unit(): string {
		return unitLabel(this.sign);
	}

	public getSegments(): SpeedSegment[] {
		return this.segments;
	}
}
