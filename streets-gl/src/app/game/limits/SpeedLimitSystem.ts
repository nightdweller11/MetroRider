import System from '~/app/System';
import TrainSystem from '../TrainSystem';
import MathUtils from '~/lib/math/MathUtils';
import {
	buildSpeedProfile, limitAt, nextChange, speedState,
	SpeedSegment, SpeedState, NextChange, PENALTY_BRAKE_OVER, toSignKmh,
} from './SpeedProfile';

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
	public state: SpeedState = 'ok';
	public change: NextChange | null = null;
	/** Seconds spent above the limit this run — the score reads this. */
	public overspeedSeconds = 0;
	/** True while the overspeed brake is holding the train back. */
	public intervening = false;

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

		if (this.state !== 'over' && speed <= this.limit) this.intervening = false;

		if (this.state === 'over') {
			this.overspeedSeconds += Math.min(deltaTime, 0.5);

			// Well over the limit the train brakes itself. This is a safety
			// system, not a punishment: it eases the train back to the limit
			// and lets go, the way a real overspeed intervention does.
			//
			// It also CUTS TRACTION, by holding a ceiling the throttle cannot
			// push through. Subtracting a braking force alone does not work:
			// the intervention decelerates at 1.5 m/s² while the throttle
			// accelerates at 5, so the driver simply wins and sits at 198 km/h
			// in an 85 zone (measured — it is how the first version behaved).
			const ceiling = this.limit * (1 + PENALTY_BRAKE_OVER);
			if (speed > ceiling) {
				this.intervening = true;
			}
			if (this.intervening) {
				const braking = 2.5 * Math.min(deltaTime, 0.5);
				const next = Math.max(this.limit, Math.min(speed, ceiling) - braking);
				trainSystem.physicsState.trainSpeed = next;
				if (next <= this.limit + 0.05) this.intervening = false;
			}
		}
	}

	/** The number a sign or the HUD shows, km/h. */
	public limitKmh(): number {
		return toSignKmh(this.limit);
	}

	public getSegments(): SpeedSegment[] {
		return this.segments;
	}
}
