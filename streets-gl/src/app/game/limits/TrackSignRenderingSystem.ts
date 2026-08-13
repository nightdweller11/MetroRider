import System from '~/app/System';
import SceneSystem from '~/app/systems/SceneSystem';
import TerrainSystem from '~/app/systems/TerrainSystem';
import MathUtils from '~/lib/math/MathUtils';
import TrainSystem from '../TrainSystem';
import TrainMeshObject from '../rendering/TrainMeshObject';
import {bearing} from '../data/CoordinateSystem';
import {getPositionAtDistance} from '../data/TrackBuilder';
import SpeedLimitSystem from './SpeedLimitSystem';
import {buildSignGeometry} from './SignGeometry';

/** Signs stand this far to the side of the track centre, metres. */
const SIGN_OFFSET = 4.5;
/** Only build boards this close to the train. */
const SIGN_RADIUS = 900;
/** Never build more than this many at once. */
const MAX_SIGNS = 14;
/** How far before a REDUCTION the yellow warning board stands, metres. */
const ADVANCE_DISTANCE = 300;
/**
 * Reminder boards inside a long stretch of unchanged limit.
 *
 * Boards were only ever placed where the limit CHANGED, so on a line whose
 * limits change rarely the driver saw almost nothing for kilometres at a time
 * — measured at one board ahead against five behind. Real railways repeat the
 * number periodically for exactly this reason.
 */
const REMINDER_SPACING = 750;
const REMINDER_MIN_SEGMENT = 1100;
const REBUILD_INTERVAL = 0.5;

interface PlacedSign {
	dist: number;
	mesh: TrainMeshObject;
}

/** A board to stand somewhere: where, what number, and which face. */
interface SignPlan {
	at: number;
	value: number;
	advance: boolean;
}

/**
 * Lineside speed boards.
 *
 * One board where each limit begins, on the driver's side of the track and
 * turned to face an approaching train — which is what makes it readable from
 * the cab rather than a decoration seen edge-on. Geometry is baked at the
 * origin and positioned by the mesh transform, like the stations, because
 * Mercator metres do not fit in float32 without wobbling.
 */
export default class TrackSignRenderingSystem extends System {
	/** Read by GBufferPass. */
	public signMeshes: TrainMeshObject[] = [];

	private placed: Map<number, PlacedSign> = new Map();
	private timer = 0;
	private lineKey = '';

	public postInit(): void {
		// Boards appear once a line has a speed profile to sign.
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const limits = this.systemManager.getSystem(SpeedLimitSystem);
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!trainSystem || !limits || !sceneSystem) return;

		const ls = trainSystem.getCurrentLine();
		if (!ls) return;

		const key = `${trainSystem.mapName}::${ls.parsed.id}::${limits.countryCode}`;
		if (key !== this.lineKey) {
			this.lineKey = key;
			this.clear();
		}

		this.timer += deltaTime;
		if (this.timer < REBUILD_INTERVAL) return;
		this.timer = 0;

		const train = trainSystem.trainPosition;
		const segments = limits.getSegments();
		if (!train || segments.length === 0) return;

		const dist = trainSystem.physicsState.trainDist;

		// A board belongs at the START of each limit — the point where the new
		// number takes effect — and a yellow warning board stands ahead of any
		// REDUCTION, which is what a driver actually needs to see coming.
		const plans: SignPlan[] = [];

		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];

			plans.push({at: segment.startDist, value: segment.limit, advance: false});

			// Repeat the number through a long stretch.
			const next = segments[i + 1];
			const segmentEnd = next ? next.startDist : segment.startDist + REMINDER_SPACING;
			const segmentLength = segmentEnd - segment.startDist;

			if (segmentLength >= REMINDER_MIN_SEGMENT) {
				for (let at = segment.startDist + REMINDER_SPACING; at < segmentEnd - 120; at += REMINDER_SPACING) {
					plans.push({at, value: segment.limit, advance: false});
				}
			}

			const previous = segments[i - 1];

			if (previous && segment.limit < previous.limit) {
				const at = segment.startDist - ADVANCE_DISTANCE;

				// Only if it does not land on top of the board before it.
				if (!previous || at > previous.startDist + 40) {
					plans.push({at, value: segment.limit, advance: true});
				}
			}
		}

		// Nearest FIRST, and ahead of the train before behind it.
		//
		// This used to take the first ten segment starts within the window in
		// segment order, which is line order — so on a line whose limits change
		// early, every board built was behind the driver and the road ahead was
		// bare. Ranking by how far away it is, with a penalty for being behind,
		// puts the boards where they can actually be read.
		const direction = trainSystem.physicsState.direction >= 0 ? 1 : -1;
		const ranked = plans
			.filter(p => Math.abs(p.at - dist) <= SIGN_RADIUS)
			.map(p => {
				const delta = (p.at - dist) * direction;
				const behind = delta < 0;

				return {plan: p, rank: Math.abs(delta) + (behind ? SIGN_RADIUS : 0)};
			})
			.sort((a, b) => a.rank - b.rank)
			.slice(0, MAX_SIGNS)
			.map(r => r.plan);

		const wanted = ranked.map(p => p.at);
		const keep = new Set(wanted);
		for (const [at, sign] of this.placed) {
			if (!keep.has(at)) {
				sceneSystem.objects.wrapper.remove(sign.mesh);
				sign.mesh.dispose();
				this.placed.delete(at);
			}
		}

		for (const plan of ranked) {
			if (this.placed.has(plan.at)) continue;

			const mesh = this.buildSign(ls, plan.at, limits.signFaceFor(plan.value), limits, plan.advance);

			if (mesh) this.placed.set(plan.at, {dist: plan.at, mesh});
		}

		this.signMeshes = [...this.placed.values()].map(s => s.mesh);
	}

	private buildSign(
		ls: {track: any},
		at: number,
		face: number,
		limits: SpeedLimitSystem,
		advance: boolean,
	): TrainMeshObject | null {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!sceneSystem) return null;

		const track = ls.track;
		const here = getPositionAtDistance(track.spline.points, track.cumDist, at);
		const ahead = getPositionAtDistance(track.spline.points, track.cumDist, at + 5);
		const heading = Math.PI / 2 - MathUtils.toRad(bearing(here.lat, here.lng, ahead.lat, ahead.lng));

		const centre = MathUtils.degrees2meters(here.lat, here.lng);
		const worldX = centre.x + Math.cos(heading) * SIGN_OFFSET;
		const worldZ = centre.y - Math.sin(heading) * SIGN_OFFSET;

		const style = limits.sign;
		// A reduction ahead is signed with the warning board when the country
		// has one; without it, the same permanent board stands there.
		const variant = advance && style.advance ? style.advance : style;
		const buffers = buildSignGeometry(face, {
			shape: variant.shape,
			background: variant.background,
			border: variant.border,
			text: variant.text,
		});

		// The board faces back down the line, so an approaching driver reads it.
		const facing = heading + Math.PI;
		const cos = Math.cos(facing);
		const sin = Math.sin(facing);
		const rotated = new Float32Array(buffers.position.length);
		const normals = new Float32Array(buffers.normal.length);
		for (let i = 0; i < buffers.position.length; i += 3) {
			const x = buffers.position[i];
			const z = buffers.position[i + 2];
			rotated[i] = x * cos + z * sin;
			rotated[i + 1] = buffers.position[i + 1];
			rotated[i + 2] = -x * sin + z * cos;

			const nx = buffers.normal[i];
			const nz = buffers.normal[i + 2];
			normals[i] = nx * cos + nz * sin;
			normals[i + 1] = buffers.normal[i + 1];
			normals[i + 2] = -nx * sin + nz * cos;
		}

		const terrain = this.systemManager.getSystem(TerrainSystem)?.terrainHeightProvider;
		const ground = terrain?.getHeightGlobalInterpolated(worldX, worldZ, true) ?? 0;

		const mesh = new TrainMeshObject({
			position: rotated,
			normal: normals,
			color: buffers.color,
			indices: buffers.indices,
		});
		mesh.position.set(worldX, (ground ?? 0) + 0.05, worldZ);
		mesh.updateMatrix();
		sceneSystem.objects.wrapper.add(mesh);
		return mesh;
	}

	private clear(): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		for (const sign of this.placed.values()) {
			sceneSystem?.objects.wrapper.remove(sign.mesh);
			sign.mesh.dispose();
		}
		this.placed.clear();
		this.signMeshes = [];
	}
}
