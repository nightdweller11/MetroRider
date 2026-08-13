import System from '~/app/System';
import SceneSystem from '~/app/systems/SceneSystem';
import TerrainSystem from '~/app/systems/TerrainSystem';
import TrainSystem from '../TrainSystem';
import TrainRenderingSystem from '../rendering/TrainRenderingSystem';
import TrainMeshObject from '../rendering/TrainMeshObject';
import AssetConfigSystem, {CROWD_CAPS} from '../assets/AssetConfigSystem';
import PassengerSystem from './PassengerSystem';
import {buildCrowdSlots, CrowdSlot, visibleCount} from './CrowdLayout';
import {buildPersonGeometry, PERSON_HEIGHT, PersonBuffers} from './PersonGeometry';
import {loadCharacter} from './CharacterLoader';
import MathUtils from '~/lib/math/MathUtils';
import {bearing} from '../data/CoordinateSystem';
import {getPositionAtDistance} from '../data/TrackBuilder';
import {debugLog} from '../debug';

const TRACK_HEIGHT_OFFSET = 0.05;
/** Must match TrainRenderingSystem's platform offset so figures stand ON it. */
const STATION_PLATFORM_OFFSET = 7;
const PLATFORM_LENGTH = 40;
const PLATFORM_WIDTH = 5;
/**
 * How far above the terrain a platform deck may plausibly sit. Station models
 * come from the catalog and can be anything (a bus shelter, a covered
 * terminus, a whole building), so the deck height is MEASURED from the placed
 * mesh — but capped here, or one model with a roof would put the crowd on
 * the roof.
 */
const MAX_DECK_HEIGHT = 1.6;
/** How far below the platform deck a figure may be placed, metres. */
const MAX_FOOT_DROP = 0.08;
/** Across-platform position of the train doors, metres (0 = track edge). */
const DOOR_EDGE_Z = 0.6;
/** Walking pace, metres per second — an unhurried commuter. */
const WALK_SPEED = 1.3;
/** How far back from the edge an alighting passenger walks before leaving. */
const ALIGHT_DEPTH = 5.5;
/**
 * People crossing the platform at once, per station.
 *
 * The first version capped each SPAWN at six, which is not the same thing:
 * spawns repeat every tick while the doors are open, so a 23-person platform
 * put 22 people in motion simultaneously. That reads as a stampede, and each
 * walker is a whole extra character in the bake — at the detailed LOD 22 of
 * them roughly doubled the crowd mesh. Anyone over the cap boards without the
 * walk, exactly as they did before.
 */
const MAX_CONCURRENT_WALKERS = 8;
/** Re-bake this often while anyone is walking, so the motion is not steppy. */
const WALK_REBUILD_INTERVAL = 0.05;
/** How many differently-dressed people the built-in figure expands into. */
/**
 * Distinct procedural figures in the mix.
 *
 * The palette carries 8 coats x 4 leg colours x 5 hair x 5 skin — 800
 * combinations — and the crowd was drawing six of them, so a busy platform
 * showed each person about seven times. Each figure is a few hundred
 * vertices, so a wider cast is cheap.
 */
const PROCEDURAL_TINTS = 24;
/** Frames baked out of a character's waiting animation. */
const POSE_COUNT = 8;
/** Playback rate of those frames. */
const POSE_FPS = 8;

/** Beyond this the crowd is a few pixels — not worth a buffer upload. */
const CROWD_RADIUS = 700;
/** Never build more than this many platforms' worth of figures. */
const MAX_CROWD_STATIONS = 6;
/** Seconds between rebuild sweeps — crowds change slowly, buffers are not free. */
const REBUILD_INTERVAL = 0.2;
/** How many of the nearest platforms get animated (re-baked) figures. */
const ANIMATED_STATIONS = 2;
/**
 * Beyond this, a platform's crowd is drawn with the cheap built-in figure
 * instead of the character model. A rigged character is ~5,000 vertices; the
 * built-in one is ~340. At 200 m a person is a few pixels tall, so the detail
 * buys nothing and the vertex budget buys everything.
 */
const DETAIL_RADIUS = 200;
/** Seconds between animation re-bakes of those platforms. */
const ANIM_REBAKE_SECONDS = 0.2;

/**
 * Someone crossing the platform, rather than standing on it.
 *
 * Boarding used to be a number: the waiting count dropped and the crowd was
 * rebuilt one person smaller, so people vanished where they stood. A walker
 * keeps its own path and phase, and is drawn alongside the standing figures
 * until it reaches the train (boarding) or the back of the platform
 * (alighting), at which point it is dropped.
 */
interface CrowdWalker {
	slot: CrowdSlot;
	/** 0 at the start of the walk, 1 when it is done. */
	phase: number;
	/** Metres travelled per second along the path. */
	speed: number;
	kind: 'board' | 'alight';
	fromX: number;
	fromZ: number;
	toX: number;
	toZ: number;
}

interface StationCrowd {
	stationIdx: number;
	mesh: TrainMeshObject;
	drawn: number;
	variantKey: string;
	/** Animation phase this mesh was baked at. */
	animTime: number;
	/** Whether this crowd was built with the detailed character model. */
	detailed: boolean;
	/** People currently walking to or from the train. */
	walkers: CrowdWalker[];
}

/**
 * Draws the waiting passengers as actual figures on the platform.
 *
 * One merged mesh per station (all its people baked into a single buffer), so
 * a platform costs exactly one draw call and one upload when its count
 * changes. Figures come from the asset catalog's `people` category; the
 * built-in procedural person is used when nothing is configured, so this
 * works on a fresh install with no uploaded models.
 */
export default class PassengerRenderingSystem extends System {
	/** Read by GBufferPass — rendered through the same material as the train. */
	public crowdMeshes: TrainMeshObject[] = [];

	private crowds: Map<number, StationCrowd> = new Map();
	/** Measured platform-deck height per station index (world Y). */
	private deckHeights: Map<number, number> = new Map();
	private slotCache: Map<string, CrowdSlot[]> = new Map();
	/** Figure variant buffers (a procedural entry expands into several). */
	private variants: PersonBuffers[] = [];
	/** For each variant, which configured model id produced it. */
	private variantSources: number[] = [];
	/** Baked animation cycles, by configured-model index. */
	private poseCycles: Map<number, PersonBuffers[]> = new Map();
	/** The cheap stand-in used beyond DETAIL_RADIUS. */
	private lowDetail: PersonBuffers | null = null;
	private variantKey = '';
	private loadingVariants = false;
	private rebuildTimer = 0;
	private animClock = 0;
	private lastLineKey = '';

	public postInit(): void {
		// Nothing to set up: crowds are built lazily on the first update that
		// has a line, a passenger model and a camera position to work from.
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const passengerSystem = this.systemManager.getSystem(PassengerSystem);
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!trainSystem || !passengerSystem || !sceneSystem) return;

		const ls = trainSystem.getCurrentLine();
		if (!ls) return;

		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		const config = assetConfig?.getConfig();
		const cap = CROWD_CAPS[config?.crowdLevel ?? 'normal'] ?? 20;

		const lineKey = `${trainSystem.mapName}::${ls.parsed.id}`;
		if (lineKey !== this.lastLineKey) {
			this.lastLineKey = lineKey;
			this.clearAll();
		}

		this.ensureVariants();

		if (cap === 0) {
			if (this.crowds.size > 0) this.clearAll();
			return;
		}

		this.animClock += deltaTime;

		this.syncWalkers(trainSystem, passengerSystem, deltaTime);

		this.rebuildTimer += deltaTime;

		// People mid-walk need a much higher re-pose rate than people standing
		// still; at the standing rate a walk reads as five steps a second.
		const interval = this.hasWalkers() ? WALK_REBUILD_INTERVAL : REBUILD_INTERVAL;

		if (this.rebuildTimer < interval) return;
		this.rebuildTimer = 0;

		this.syncCrowds(trainSystem, passengerSystem, ls, cap);
	}

	/** Boarding/alighting totals already turned into walkers, per station. */
	private walkerCursor: Map<number, {boarded: number; alighted: number}> = new Map();

	private hasWalkers(): boolean {
		for (const crowd of this.crowds.values()) {
			if (crowd.walkers.length > 0) return true;
		}

		return false;
	}

	/**
	 * Turn the passenger model's boarding/alighting counts into people who
	 * actually cross the platform, and advance the ones already walking.
	 *
	 * The model reports totals for the current stop; the difference against
	 * what has already been dramatised is how many new figures should set off.
	 */
	private syncWalkers(
		trainSystem: TrainSystem,
		passengerSystem: PassengerSystem,
		deltaTime: number,
	): void {
		for (const crowd of this.crowds.values()) {
			if (crowd.walkers.length === 0) continue;

			for (const walker of crowd.walkers) {
				const dx = walker.toX - walker.fromX;
				const dz = walker.toZ - walker.fromZ;
				const distance = Math.max(0.5, Math.hypot(dx, dz));

				walker.phase += (walker.speed * deltaTime) / distance;
			}

			crowd.walkers = crowd.walkers.filter(w => w.phase < 1);
		}

		const idx = passengerSystem.activeStation;

		if (idx < 0) {
			// Doors shut: the stop is over, so the next one starts from zero.
			this.walkerCursor.delete(idx);
			return;
		}

		const crowd = this.crowds.get(idx);

		if (!crowd) return;

		const seen = this.walkerCursor.get(idx) ?? {boarded: 0, alighted: 0};
		const newBoarders = Math.max(0, passengerSystem.boardedThisStop - seen.boarded);
		const newAlighters = Math.max(0, passengerSystem.alightedThisStop - seen.alighted);

		if (newBoarders === 0 && newAlighters === 0) return;

		this.walkerCursor.set(idx, {
			boarded: passengerSystem.boardedThisStop,
			alighted: passengerSystem.alightedThisStop,
		});

		const stationId = this.stationIdFor(trainSystem, idx);
		const slots = this.getSlots(stationId, Math.max(crowd.drawn, 8));

		const room = Math.max(0, MAX_CONCURRENT_WALKERS - crowd.walkers.length);

		if (room === 0) return;

		const boarders = Math.min(newBoarders, room);
		const alighters = Math.min(newAlighters, Math.max(0, room - boarders));

		for (let i = 0; i < boarders; i++) {
			// Boarders leave from the back of the standing crowd, so the people
			// who were drawn nearest the edge stay put and the platform thins
			// from behind — which is what it looks like in life.
			const slot = slots[(crowd.drawn + i) % slots.length];

			crowd.walkers.push({
				slot,
				phase: 0,
				speed: WALK_SPEED * (0.85 + ((i * 37) % 30) / 100),
				kind: 'board',
				fromX: slot.x,
				fromZ: slot.z,
				toX: slot.x + ((i * 53) % 7) - 3,
				toZ: DOOR_EDGE_Z,
			});
		}

		for (let i = 0; i < alighters; i++) {
			const slot = slots[(crowd.drawn + boarders + i) % slots.length];

			crowd.walkers.push({
				slot,
				phase: 0,
				speed: WALK_SPEED * (0.85 + ((i * 41) % 30) / 100),
				kind: 'alight',
				fromX: slot.x + ((i * 29) % 7) - 3,
				fromZ: DOOR_EDGE_Z,
				toX: slot.x + ((i * 17) % 9) - 4,
				toZ: ALIGHT_DEPTH,
			});
		}
	}

	private stationIdFor(trainSystem: TrainSystem, stationIdx: number): string {
		const ls = trainSystem.getCurrentLine();

		return ls?.parsed.stations[stationIdx]?.id ?? `idx-${stationIdx}`;
	}

	/** Load (or rebuild) the figure variant buffers from the configured models. */
	private ensureVariants(): void {
		const assetConfig = this.systemManager.getSystem(AssetConfigSystem);
		const config = assetConfig?.getConfig();
		const ids = config?.peopleModels?.length ? config.peopleModels : ['procedural-default'];
		const key = ids.join('|');

		if (key === this.variantKey || this.loadingVariants) return;

		this.variantKey = key;
		// Procedural figures are available immediately; a GLB replaces its slot
		// when it finishes loading, so crowds are never blocked on the network.
		//
		// A procedural entry expands into several differently-dressed people:
		// one buffer would put an identical clone in every slot, which is what
		// a platform full of one maroon coat looked like.
		this.variants = [];
		this.variantSources = [];
		this.poseCycles.clear();
		ids.forEach((id, index) => {
			if (id === 'procedural-default' || id === 'procedural') {
				for (let t = 0; t < PROCEDURAL_TINTS; t++) {
					this.variants.push(buildPersonGeometry(t));
					this.variantSources.push(index);
				}
			} else {
				// Placeholder until the GLB arrives — never an empty crowd.
				this.variants.push(buildPersonGeometry(index * 7 + 3));
				this.variantSources.push(index);
			}
		});
		this.clearAll();

		const catalog = assetConfig?.getCatalog();
		if (!catalog) return;

		const glbIds = ids
			.map((id, index) => ({id, index}))
			.filter(e => e.id !== 'procedural-default' && e.id !== 'procedural');

		if (glbIds.length === 0) return;

		this.loadingVariants = true;
		const trainRendering = this.systemManager.getSystem(TrainRenderingSystem);

		void Promise.all(glbIds.map(async ({id, index}) => {
			const entry = catalog.models.people?.find(e => e.id === id);
			if (!entry?.path || !trainRendering) return;

			if (!assetConfig) return;

			try {
				const url = assetConfig.getAssetUrl(entry.path);
				const response = await fetch(url);
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const buffer = await response.arrayBuffer();

				// A rigged character has to be POSED before it can be drawn:
				// this renderer bakes vertices and has no skinning, so a rig
				// would otherwise stand on the platform in its T-pose. The
				// character loader skins it on the CPU into a cycle of poses,
				// which the crowd then plays back per person.
				const character = await loadCharacter(buffer, POSE_COUNT);
				if (character) {
					const posed = character.poses.map(pose => ({
						position: pose.position,
						normal: pose.normal,
						color: character.color,
						indices: character.indices,
					}));
					for (let v = 0; v < this.variants.length; v++) {
						if (this.variantSources[v] === index) this.variants[v] = posed[0];
					}
					this.poseCycles.set(index, posed);
					debugLog(`[Passengers] Character "${id}" loaded: ${posed.length} poses, ${posed[0].position.length / 3} verts`);
					return;
				}

				// Not rigged — a statue is still better than nothing.
				const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
				const parsed = await trainRendering.parseGLBWithTextures(buffer, baseUrl, true);
				if (!parsed) throw new Error('parse returned null');

				const normalized = this.normalizeFigure(parsed);
				for (let v = 0; v < this.variants.length; v++) {
					if (this.variantSources[v] === index) this.variants[v] = normalized;
				}
				debugLog(`[Passengers] Figure model "${id}" loaded static (${parsed.position.length / 3} verts)`);
			} catch (err) {
				console.warn(`[Passengers] Figure model "${id}" unavailable, using the built-in person:`, err);
			}
		})).finally(() => {
			this.loadingVariants = false;
			this.clearAll(); // force a rebuild with the real figures
		});
	}

	/**
	 * Re-origin and scale an arbitrary GLB so it stands on y=0 at human height,
	 * whatever units the artist modelled in.
	 */
	private normalizeFigure(buffers: {position: Float32Array; normal: Float32Array; color: Float32Array; indices: Uint32Array}): PersonBuffers {
		const count = buffers.position.length / 3;
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
		for (let i = 0; i < count; i++) {
			const x = buffers.position[i * 3], y = buffers.position[i * 3 + 1], z = buffers.position[i * 3 + 2];
			if (x < minX) minX = x; if (x > maxX) maxX = x;
			if (y < minY) minY = y; if (y > maxY) maxY = y;
			if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
		}

		const height = maxY - minY;
		const scale = height > 0.001 ? PERSON_HEIGHT / height : 1;
		const cx = (minX + maxX) / 2;
		const cz = (minZ + maxZ) / 2;

		const position = new Float32Array(buffers.position.length);
		for (let i = 0; i < count; i++) {
			position[i * 3] = (buffers.position[i * 3] - cx) * scale;
			position[i * 3 + 1] = (buffers.position[i * 3 + 1] - minY) * scale;
			position[i * 3 + 2] = (buffers.position[i * 3 + 2] - cz) * scale;
		}

		return {
			position,
			normal: buffers.normal,
			color: buffers.color,
			indices: buffers.indices,
		};
	}

	private syncCrowds(
		trainSystem: TrainSystem,
		passengerSystem: PassengerSystem,
		ls: {parsed: {stations: {id: string}[]; color: string}; track: any; realStationDists: number[]},
		cap: number,
	): void {
		const train = trainSystem.trainPosition;
		if (!train) return;

		const stations = ls.parsed.stations;

		// Rank stations by distance to the train and keep the nearest few.
		const ranked: {idx: number; dist: number}[] = [];
		for (let i = 0; i < stations.length; i++) {
			const pos = this.stationWorldPos(ls, i);
			if (!pos) continue;
			const d = Math.hypot(pos.x - train.x, pos.z - train.y);
			if (d <= CROWD_RADIUS) ranked.push({idx: i, dist: d});
		}
		ranked.sort((a, b) => a.dist - b.dist);
		const keep = new Set(ranked.slice(0, MAX_CROWD_STATIONS).map(r => r.idx));

		for (const [idx, crowd] of this.crowds) {
			if (!keep.has(idx)) {
				this.removeCrowd(crowd);
				this.crowds.delete(idx);
			}
		}

		// The two nearest platforms are re-baked on the animation clock so the
		// people visibly move; the rest only change when their count does.
		const animated = new Set(ranked.slice(0, ANIMATED_STATIONS).map(r => r.idx));
		// LOD: only close platforms get the detailed character.
		const detailed = new Set(ranked.filter(r => r.dist <= DETAIL_RADIUS).map(r => r.idx));

		for (const idx of keep) {
			const want = visibleCount(passengerSystem.waitingAt(idx), cap);
			const existing = this.crowds.get(idx);
			const wantDetail = detailed.has(idx);
			const stale = existing !== undefined
				&& animated.has(idx)
				&& this.animClock - existing.animTime >= ANIM_REBAKE_SECONDS;

			if (
				existing && existing.drawn === want && existing.variantKey === this.variantKey
				&& existing.detailed === wantDetail && !stale
			) continue;

			// A re-bake for animation changes only where the vertices ARE — same
			// platform, same people, same variants, same detail level. Throwing
			// the mesh away and building another one meant ~4.8 mesh creations
			// a second with the train stationary, each allocating a fresh set
			// of GPU buffers. Rewrite the existing ones instead.
			const onlyAnimationChanged = existing !== undefined
				&& existing.drawn === want
				&& existing.variantKey === this.variantKey
				&& existing.detailed === wantDetail;

			if (onlyAnimationChanged) {
				const rebaked = this.buildCrowd(ls, idx, want, this.animClock, wantDetail, existing);

				if (rebaked) {
					this.crowds.set(idx, rebaked);
					continue;
				}
			}

			// Survives the rebuild: these people are mid-stride.
			const carried = existing?.walkers ?? [];

			if (existing) {
				this.removeCrowd(existing);
				this.crowds.delete(idx);
			}
			if (want <= 0 && carried.length === 0) continue;

			const crowd = this.buildCrowd(ls, idx, want, this.animClock, wantDetail, undefined, carried);
			if (crowd) this.crowds.set(idx, crowd);
		}

		this.crowdMeshes = [...this.crowds.values()].map(c => c.mesh);
	}

	private stationWorldPos(
		ls: {track: any; realStationDists: number[]},
		stationIdx: number,
	): {x: number; z: number; heading: number} | null {
		const dist = ls.realStationDists[stationIdx];
		if (dist === undefined) return null;

		const p = getPositionAtDistance(ls.track.spline.points, ls.track.cumDist, dist);
		const n = getPositionAtDistance(ls.track.spline.points, ls.track.cumDist, dist + 5);
		const heading = Math.PI / 2 - MathUtils.toRad(bearing(p.lat, p.lng, n.lat, n.lng));

		const centre = MathUtils.degrees2meters(p.lat, p.lng);
		return {
			x: centre.x + Math.cos(heading) * STATION_PLATFORM_OFFSET,
			z: centre.y - Math.sin(heading) * STATION_PLATFORM_OFFSET,
			heading,
		};
	}

	private buildCrowd(
		ls: {parsed: {stations: {id: string}[]}; track: any; realStationDists: number[]},
		stationIdx: number,
		count: number,
		animTime: number,
		detailed: boolean,
		/**
		 * An existing crowd to re-pose in place rather than replace. Used for
		 * the animation re-bake, where only vertex positions change.
		 */
		reuse?: StationCrowd,
		/**
		 * Walkers to carry into the new crowd.
		 *
		 * Adding or finishing a walker CHANGES the vertex count, which is
		 * precisely the case that falls through to a full rebuild — so reading
		 * them from `reuse` alone would drop every walker at the moment one
		 * set off, and boarding would go back to people vanishing where they
		 * stood.
		 */
		carryWalkers?: CrowdWalker[],
	): StationCrowd | null {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		if (!sceneSystem || this.variants.length === 0) return null;
		if (count <= 0 && (carryWalkers?.length ?? reuse?.walkers.length ?? 0) === 0) return null;

		const place = this.stationWorldPos(ls, stationIdx);
		if (!place) return null;

		const stationId = ls.parsed.stations[stationIdx]?.id ?? `idx-${stationIdx}`;
		const slots = this.getSlots(stationId, count);

		// One list of "who to draw and where": the standing crowd at its slots,
		// then anyone mid-walk at their interpolated position. Walkers are real
		// figures, not a separate effect, so they shade and ground identically.
		const walkers = carryWalkers ?? reuse?.walkers ?? [];
		const placements: {slot: CrowdSlot; x: number; z: number; yaw: number}[] = [];

		for (let i = 0; i < count; i++) {
			placements.push({slot: slots[i], x: slots[i].x, z: slots[i].z, yaw: slots[i].yaw});
		}

		for (const walker of walkers) {
			// Ease the ends so a walker starts and stops rather than snapping
			// into motion at full pace.
			const p = Math.min(1, Math.max(0, walker.phase));
			const eased = p * p * (3 - 2 * p);
			const wx = walker.fromX + (walker.toX - walker.fromX) * eased;
			const wz = walker.fromZ + (walker.toZ - walker.fromZ) * eased;

			// Face the direction of travel.
			const yaw = Math.atan2(walker.toX - walker.fromX, walker.toZ - walker.fromZ);

			placements.push({slot: walker.slot, x: wx, z: wz, yaw});
		}
		const baseHeight = this.deckHeight(stationIdx, place.x, place.z);
		const grid = this.deckGrid(stationIdx, place.x, place.z);

		const cosH = Math.cos(place.heading);
		const sinH = Math.sin(place.heading);

		let totalVerts = 0;
		let totalIndices = 0;
		for (const placement of placements) {
			const v = this.figureFor(placement.slot.variant, animTime, placement.x + placement.z, detailed);
			totalVerts += v.position.length / 3;
			totalIndices += v.indices.length;
		}

		const position = new Float32Array(totalVerts * 3);
		const normal = new Float32Array(totalVerts * 3);
		const color = new Float32Array(totalVerts * 3);
		const indices = new Uint32Array(totalIndices);

		let vOff = 0;
		let iOff = 0;

		for (let i = 0; i < placements.length; i++) {
			const placement = placements[i];
			const slot = placement.slot;
			const v = this.figureFor(slot.variant, animTime, placement.x + placement.z, detailed);
			const vCount = v.position.length / 3;

			// Idle life: everyone shifts weight and turns a little, out of phase
			// with their neighbours. A platform of statues reads as scenery; the
			// same platform with a small amount of motion reads as people.
			// Where the floor actually is under THIS person, relative to the
			// mesh origin (which carries the platform's own height).
			// Clamped: a slot on the very edge of the platform can sample the
			// drop to track level in its cell, and a person sunk 35 cm into the
			// deck reads exactly as wrong as one hovering above it. Small dips
			// (a ramp, a slightly uneven deck) are kept; a plunge is not.
			const footY = Math.max(
				-MAX_FOOT_DROP,
				this.deckAt(
					grid,
					placement.x * sinH + placement.z * cosH,
					placement.x * cosH - placement.z * sinH,
					baseHeight,
				) - baseHeight,
			);

			const phase = animTime * 1.7 + placement.x * 0.7 + placement.z * 1.3;
			const bob = Math.sin(phase) * 0.04;
			const sway = Math.sin(phase * 0.5) * 0.25;

			// Figure-local yaw. The model faces +z; the track is at -z in
			// platform-local space, so people turn to watch for the train with
			// only a little scatter — a platform of people facing random
			// directions reads as a bus queue that lost its bus.
			const fy = Math.PI + placement.yaw + sway;
			const cosY = Math.cos(fy), sinY = Math.sin(fy);

			for (let k = 0; k < vCount; k++) {
				const px = v.position[k * 3] * slot.scale;
				const py = v.position[k * 3 + 1] * slot.scale;
				const pz = v.position[k * 3 + 2] * slot.scale;

				// yaw about Y, then platform-local offset, then station heading
				const yx = px * cosY + pz * sinY;
				const yz = -px * sinY + pz * cosY;

				const lx = yx + placement.x;
				const lz = yz + placement.z;

				// Local to the platform centre — the mesh transform carries the
				// world position (same float32 reason as the stations).
				const o = (vOff + k) * 3;
				position[o] = lx * sinH + lz * cosH;
				position[o + 1] = py + bob + footY;
				position[o + 2] = lx * cosH - lz * sinH;

				const nx = v.normal[k * 3] ?? 0;
				const ny = v.normal[k * 3 + 1] ?? 1;
				const nz = v.normal[k * 3 + 2] ?? 0;
				const nyx = nx * cosY + nz * sinY;
				const nyz = -nx * sinY + nz * cosY;
				normal[o] = nyx * sinH + nyz * cosH;
				normal[o + 1] = ny;
				normal[o + 2] = nyx * cosH - nyz * sinH;

				color[o] = v.color[k * 3] ?? 0.6;
				color[o + 1] = v.color[k * 3 + 1] ?? 0.6;
				color[o + 2] = v.color[k * 3 + 2] ?? 0.6;
			}

			for (let k = 0; k < v.indices.length; k++) {
				indices[iOff + k] = v.indices[k] + vOff;
			}

			vOff += vCount;
			iOff += v.indices.length;
		}

		// Re-pose in place when the topology is unchanged. It usually is, but
		// not always: a GLB character finishing its download mid-run swaps a
		// placeholder figure for a rigged one with a different vertex count
		// WITHOUT changing the variant key, so the lengths are compared rather
		// than assumed. A mismatch falls through to a full rebuild.
		if (reuse && reuse.mesh.buffers.position.length === position.length) {
			reuse.mesh.updatePositionAndNormalBuffers(position, normal);
			reuse.mesh.position.set(place.x, baseHeight, place.z);
			reuse.mesh.updateMatrix();

			return {...reuse, animTime};
		}

		if (reuse) {
			return null;
		}

		const mesh = new TrainMeshObject({position, normal, color, indices});
		mesh.position.set(place.x, baseHeight, place.z);
		mesh.updateMatrix();
		sceneSystem.objects.wrapper.add(mesh);

		return {stationIdx, mesh, drawn: count, variantKey: this.variantKey, animTime, detailed, walkers};
	}

	/**
	 * The buffers to draw this person with right now: a pose from the baked
	 * cycle when the model is animated, otherwise the static figure. The phase
	 * offset keeps neighbours out of step — a platform of people moving in
	 * perfect unison looks worse than a platform of statues.
	 */
	private figureFor(
		variantIndex: number, animTime: number, phaseOffset: number, detailed: boolean,
	): PersonBuffers {
		const index = variantIndex % Math.max(1, this.variants.length);
		// Far platforms fall back to the built-in figure (LOD).
		if (!detailed) {
			if (!this.lowDetail) this.lowDetail = buildPersonGeometry(index * 5 + 1);
			return this.lowDetail;
		}
		const cycle = this.poseCycles.get(this.variantSources[index] ?? -1);
		if (cycle && cycle.length > 0) {
			const step = Math.floor((animTime * POSE_FPS + phaseOffset * 3.1)) % cycle.length;
			return cycle[(step + cycle.length) % cycle.length];
		}
		return this.variants[index];
	}

	private getSlots(stationId: string, atLeast: number): CrowdSlot[] {
		const cached = this.slotCache.get(stationId);
		if (cached && cached.length >= atLeast) return cached;

		const slots = buildCrowdSlots(stationId, {
			count: Math.max(atLeast, 40),
			length: PLATFORM_LENGTH,
			width: PLATFORM_WIDTH,
			variants: Math.max(1, this.variants.length),
		});
		this.slotCache.set(stationId, slots);
		return slots;
	}

	/**
	 * Where the feet go.
	 *
	 * Whatever station model the player picked has already been placed at this
	 * spot, so the deck height is read off that mesh (highest vertex within the
	 * platform footprint, capped at MAX_DECK_HEIGHT above the terrain) instead
	 * of assuming a fixed platform height. With no station mesh — or a model
	 * that is all roof — the figures stand on the ground, which is at least
	 * never floating.
	 */
	/**
	 * Deck height sampled UNDER EACH PERSON, not once for the platform.
	 *
	 * The single cached height was taken at the platform centre and given to
	 * everyone, and it was the highest vertex within a 14 m radius — which is
	 * not the walking surface. A bench top, a railing or a canopy lip under the
	 * 1.6 m ceiling wins that max and lifts the whole crowd off the floor,
	 * which is the floating the operator reported.
	 *
	 * One pass over the station geometry fills a 1 m grid of "highest surface
	 * in this cell"; each figure then reads the cell it actually stands in. Two
	 * metres away a bench no longer decides where someone's feet go.
	 */
	private deckGrids: Map<number, Map<string, number>> = new Map();

	private static gridKey(x: number, z: number): string {
		return `${Math.round(x)},${Math.round(z)}`;
	}

	private deckGrid(stationIdx: number, cx: number, cz: number): Map<string, number> {
		const cached = this.deckGrids.get(stationIdx);

		if (cached) return cached;

		const grid = new Map<string, number>();
		const ground = this.terrainHeight(cx, cz) + TRACK_HEIGHT_OFFSET;
		const ceiling = ground + MAX_DECK_HEIGHT;
		const meshes = this.systemManager.getSystem(TrainRenderingSystem)?.stationMeshes ?? [];

		for (const mesh of meshes) {
			const pos = mesh?.buffers?.position;

			if (!pos) continue;

			// Station geometry is baked at the origin and placed by the mesh
			// transform, so vertices are LOCAL and the position supplies the offset.
			const ox = mesh.position.x, oy = mesh.position.y, oz = mesh.position.z;

			for (let i = 0; i < pos.length; i += 3) {
				const y = pos[i + 1] + oy;

				if (y < ground || y > ceiling) continue;

				const wx = pos[i] + ox, wz = pos[i + 2] + oz;

				if (Math.abs(wx - cx) > 40 || Math.abs(wz - cz) > 40) continue;

				const key = PassengerRenderingSystem.gridKey(wx - cx, wz - cz);
				const best = grid.get(key);

				if (best === undefined || y > best) grid.set(key, y);
			}
		}

		this.deckGrids.set(stationIdx, grid);

		return grid;
	}

	/** Surface height under a point given in platform-local metres. */
	private deckAt(grid: Map<string, number>, localX: number, localZ: number, fallback: number): number {
		const here = grid.get(PassengerRenderingSystem.gridKey(localX, localZ));

		if (here !== undefined) return here;

		// A person standing on the very edge of the deck can land in a cell with
		// no geometry sample; borrow the nearest neighbour before giving up.
		for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const near = grid.get(PassengerRenderingSystem.gridKey(localX + dx, localZ + dz));

			if (near !== undefined) return near;
		}

		return fallback;
	}

	private deckHeight(stationIdx: number, x: number, z: number): number {
		const cached = this.deckHeights.get(stationIdx);
		if (cached !== undefined) return cached;

		const ground = this.terrainHeight(x, z) + TRACK_HEIGHT_OFFSET;
		let deck = ground;

		const trainRendering = this.systemManager.getSystem(TrainRenderingSystem);
		const meshes = trainRendering?.stationMeshes ?? [];
		const ceiling = ground + MAX_DECK_HEIGHT;
		const radiusSq = 14 * 14;

		// stationMeshes is NOT guaranteed to be index-aligned with the station
		// list (models fail to load, procedural placement skips stations), so
		// the deck is found by proximity: the highest vertex of ANY station
		// mesh that sits over this platform and within a plausible deck height.
		for (const mesh of meshes) {
			const pos = mesh?.buffers?.position;
			if (!pos) continue;
			// Station geometry is baked at the origin and placed by the mesh
			// transform (float32 cannot hold Mercator metres without wobbling),
			// so vertices are LOCAL and the mesh position supplies the offset.
			const ox = mesh.position.x;
			const oy = mesh.position.y;
			const oz = mesh.position.z;
			for (let i = 0; i < pos.length; i += 3) {
				const y = pos[i + 1] + oy;
				if (y <= deck || y > ceiling) continue;
				const dx = pos[i] + ox - x;
				const dz = pos[i + 2] + oz - z;
				if (dx * dx + dz * dz > radiusSq) continue;
				deck = y;
			}
		}

		this.deckHeights.set(stationIdx, deck);
		return deck;
	}

	private terrainHeight(x: number, z: number): number {
		const terrainSystem = this.systemManager.getSystem(TerrainSystem);
		const provider = terrainSystem?.terrainHeightProvider;
		if (!provider) return 0;
		const h = provider.getHeightGlobalInterpolated(x, z, true);
		return h === null ? 0 : h;
	}

	private removeCrowd(crowd: StationCrowd): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		sceneSystem?.objects.wrapper.remove(crowd.mesh);
		// Removing from the scene graph does not free GPU memory; this does.
		crowd.mesh.dispose();
	}

	private clearAll(): void {
		for (const crowd of this.crowds.values()) this.removeCrowd(crowd);
		this.crowds.clear();
		this.crowdMeshes = [];
		this.slotCache.clear();
		// Deck heights are measured off the station meshes, which are rebuilt
		// whenever the line or the station model changes.
		this.deckHeights.clear();
		this.deckGrids.clear();
		this.rebuildTimer = REBUILD_INTERVAL; // rebuild on the next tick
	}
}
