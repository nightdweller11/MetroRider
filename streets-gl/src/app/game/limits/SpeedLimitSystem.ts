import System from '~/app/System';
import TrainSystem from '../TrainSystem';
import MathUtils from '~/lib/math/MathUtils';
import {
	countryForLocation, signNumber, signStyleFor, SignStyle, TransportMode, unitLabel,
} from './SignStyle';
import {
	buildSpeedProfile, curveRadius, limitAt, limitForRadius, nextChange, speedState,
	SpeedSegment, SpeedState, NextChange, SERIOUS_OVERSPEED, toSignKmh,
} from './SpeedProfile';
import {inferLineMode, lineModeInfo, type LineMode} from '../data/LineModes';

/**
 * Distance the curve is measured over, metres — the same baseline the speed
 * profile uses, for the same reason: the spline points are close enough that
 * three adjacent ones read position noise as a tight bend.
 */
const CURVE_BASELINE_M = 60;

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
	/** What kind of service the line runs — from the map, or read off the line. */
	public lineMode: LineMode = 'rapid';
	/** The fastest anything may go on this line, m/s (mode cap ∩ rolling stock). */
	public lineCeiling = 0;
	public state: SpeedState = 'ok';
	public change: NextChange | null = null;
	/** Seconds spent above the limit this run — the score reads this. */
	public overspeedSeconds = 0;
	/** The line's geometry in metres, kept so curvature can be asked for. */
	private projected: {x: number; y: number}[] = [];
	private cumDist: number[] = [];
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

			// What kind of service this is has to be settled BEFORE the profile
			// is built: it sets the ceiling and the floor. A bus route through a
			// town centre has metro-like station spacing, so guessing from the
			// track alone signed it 90 km/h and drove it like a metro.
			const stations = ls.parsed.stations;

			this.lineMode = ls.parsed.mode
				?? inferLineMode(ls.parsed.name, ls.track.totalLength, stations.length);

			const modeInfo = lineModeInfo(this.lineMode);
			// The rolling stock is still a ceiling of its own — a mode cannot
			// make a model go faster than it can.
			const ceiling = Math.min(modeInfo.topKmh, trainSystem.getMaxSpeedKmH());

			this.lineCeiling = ceiling / 3.6;

			this.projected = ls.track.spline.points.map((p: [number, number]) => {
				const m = MathUtils.degrees2meters(p[1], p[0]);

				return {x: m.x, y: m.y};
			});
			this.cumDist = ls.track.cumDist;

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
				{
					lineMax: ceiling / 3.6,
					// The floor has to move with the ceiling. It defaults to
					// 40 km/h, which is ABOVE a bus route's top speed — left
					// alone, every bus stop would be posted faster than the
					// line's own maximum.
					floor: Math.min(modeInfo.floorKmh, ceiling) / 3.6,
				},
			);
			this.overspeedSeconds = 0;
			this.seriousOverspeedSeconds = 0;

			// Signage belongs to the railway, so it is resolved from where the
			// line actually is and what kind of service it runs.
			const mid = stations[Math.floor(stations.length / 2)] ?? stations[0];
			if (mid) {
				this.countryCode = countryForLocation(mid.lat, mid.lng);
			}
			this.mode = modeInfo.sign;
			this.sign = signStyleFor(this.mode, this.countryCode);
		}

		if (!trainSystem.gameActive) return;

		const dist = trainSystem.physicsState.trainDist;
		const speed = trainSystem.physicsState.trainSpeed;

		this.limit = limitAt(this.segments, dist, this.lineCeiling || trainSystem.getMaxSpeedKmH() / 3.6);
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

	/**
	 * The comfortable speed for the curve the train is ON, m/s — with no floor
	 * applied.
	 *
	 * The posted limit cannot answer this. It carries the line's FLOOR (40 km/h
	 * by default, or the mode's), so on the built-in map it reads 60 for
	 * kilometres of dead-straight track and anything reading it as curvature
	 * concludes the whole line is a bend. Measured directly off the geometry
	 * instead, over the same baseline the profile uses so the noise averages
	 * out rather than reading every wobble as a curve.
	 *
	 * `Infinity` on genuinely straight track.
	 */
	public curveSpeedAt(dist: number): number {
		const points = this.projected;

		if (points.length < 3 || this.cumDist.length !== points.length) return Infinity;

		const half = CURVE_BASELINE_M / 2;
		const at = this.indexAtDistance(dist);
		const back = this.indexAtDistance(dist - half);
		const fwd = this.indexAtDistance(dist + half);

		if (back === at || fwd === at || back === fwd) return Infinity;

		return limitForRadius(
			curveRadius(points[back], points[at], points[fwd]),
			// No floor: the question is what the CURVE allows, not what the
			// line posts.
			{floor: 0, lineMax: Infinity, step: 1 / 3.6},
		);
	}

	/** Nearest spline point to a distance along the line. */
	private indexAtDistance(dist: number): number {
		const total = this.cumDist[this.cumDist.length - 1] || 1;
		const d = ((dist % total) + total) % total;
		// The points are near enough evenly spaced that a proportional guess is
		// within a point or two, which is well inside the baseline.
		return Math.max(0, Math.min(this.cumDist.length - 1,
			Math.round((d / total) * (this.cumDist.length - 1))));
	}
}
