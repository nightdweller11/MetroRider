import System from '../../System';
import SettingsSystem from '../../systems/SettingsSystem';
import SceneSystem from '../../systems/SceneSystem';
import TrainSystem from '../TrainSystem';
import TrainRenderingSystem from '../rendering/TrainRenderingSystem';
import TrainMeshObject from '../rendering/TrainMeshObject';
import {buildSignalGeometry, signalAspectColors, type SignalAspect} from './SignalGeometry';
import AmbientTrainSystem from '../AmbientTrainSystem';
import {blockOccupied} from '../ai/LeadingTrainDriver';

/**
 * Block signals on the line beside you.
 *
 * They protect the OTHER track — the one the passing services run on — for a
 * reason that matters: signals only mean anything when something can be behind
 * them. A signal guarding the player's own road would be decoration, because
 * nothing is ever coming the other way on it, and a red one that does not stop
 * you teaches a child the opposite of what a signal is.
 *
 * On the adjacent alignment the rule is the real one and it plays out in
 * sight: a signal stands at danger while a service occupies the block beyond
 * it, and clears once that train is past. Driving towards an oncoming train,
 * you watch the signal ahead of it turn green the moment it goes by.
 */

/** Signals kept in front of the player, spaced along the line. */
const SIGNAL_COUNT = 3;
const SPACING = 620;
/** How far ahead the nearest one sits. */
const FIRST_AHEAD = 190;
/** A train within this distance beyond a signal keeps it at danger. */
const BLOCK_LENGTH = 620;
/** Same offset the passing services use, so signals stand by THEIR track. */
const TRACK_OFFSET = 4.6;
/** Just outside the running line, on the far side from the player. */
const SIGNAL_SIDE = 3.0;

interface Signal {
	mesh: TrainMeshObject;
	/** Distance along the line, in the player's travel frame. */
	dist: number;
	aspect: SignalAspect;
}

export default class SignalRenderingSystem extends System {
	public signalMeshes: TrainMeshObject[] = [];
	/**
	 * Signals passed at danger this run — the one thing on a railway that is
	 * never a matter of opinion. The run card reads and resets this.
	 */
	public spads = 0;
	/** Set by the UI so a SPAD can be said out loud the moment it happens. */
	public onSpad: (() => void) | null = null;

	private lastPlayerDist: number | null = null;

	private signals: Signal[] = [];
	private builtForLine: number = -1;
	private builtForMap: number = -1;

	public postInit(): void {
		// Nothing to build until a line is loaded and the game is running.
	}

	private enabled(): boolean {
		const settings = this.systemManager.getSystem(SettingsSystem)?.settings;

		// Signals belong to the passing services; without them there is nothing
		// to protect and a signal would be a prop that never changes.
		return settings?.get('ambientTrains')?.statusValue !== 'off';
	}

	private clear(): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);

		for (const signal of this.signals) {
			signal.mesh.dispose();
			sceneSystem?.objects.wrapper.remove(signal.mesh);
		}

		this.signals = [];
		this.lastPlayerDist = null;
		this.signalMeshes = [];
		this.builtForLine = -1;
	}

	private build(trainSystem: TrainSystem, playerDist: number, playerDir: number): void {
		const sceneSystem = this.systemManager.getSystem(SceneSystem);

		if (!sceneSystem) return;

		this.clear();

		for (let i = 0; i < SIGNAL_COUNT; i++) {
			const mesh = new TrainMeshObject(buildSignalGeometry('clear'));

			sceneSystem.objects.wrapper.add(mesh);
			this.signals.push({
				mesh,
				dist: playerDist + (FIRST_AHEAD + i * SPACING) * playerDir,
				aspect: 'clear',
			});
		}

		this.signalMeshes = this.signals.map(s => s.mesh);
		this.builtForLine = trainSystem.currentLineIdx;
		this.builtForMap = trainSystem.mapGeneration;
	}

	public update(): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem?.gameActive || !trainSystem.trainPosition) return;

		if (!this.enabled()) {
			if (this.signals.length > 0) this.clear();

			return;
		}

		const playerDist = trainSystem.physicsState.trainDist;
		const playerDir = trainSystem.physicsState.direction || 1;

		if (
			this.builtForLine !== trainSystem.currentLineIdx ||
			this.builtForMap !== trainSystem.mapGeneration ||
			this.signals.length === 0
		) {
			this.build(trainSystem, playerDist, playerDir);
			return;
		}

		const traffic = this.trafficDistances();

		for (const signal of this.signals) {
			// Keep them in front: once one is behind, move it up the line.
			const ahead = (signal.dist - playerDist) * playerDir;

			if (ahead < -80) {
				signal.dist += SIGNAL_COUNT * SPACING * playerDir;
			}

			this.setAspect(signal, this.aspectFor(signal, traffic, playerDir));
			this.pose(trainSystem, signal, playerDir);
		}

		this.checkForSpad(playerDist, playerDir);
		this.lastPlayerDist = playerDist;
	}

	/**
	 * Did the player just go past a signal at danger?
	 *
	 * Compares this frame's position with the last, so a signal is only ever
	 * counted once however fast the train is going — at 200 km/h a frame is
	 * nearly a metre, and a test on "am I near a red" would count the same
	 * signal for several frames running.
	 */
	private checkForSpad(playerDist: number, playerDir: number): void {
		if (this.lastPlayerDist === null) return;

		const from = this.lastPlayerDist;
		const travelled = (playerDist - from) * playerDir;

		if (travelled <= 0) return;

		for (const signal of this.signals) {
			if (signal.aspect !== 'danger') continue;

			const before = (signal.dist - from) * playerDir;
			const after = (signal.dist - playerDist) * playerDir;

			// It was in front and is now behind: passed.
			if (before > 0 && after <= 0) {
				this.spads++;
				this.onSpad?.();
			}
		}
	}

	/** Where the passing services are, along the line. */
	private trafficDistances(): number[] {
		const rendering = this.systemManager.getSystem(TrainRenderingSystem);
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const positions: number[] = [];

		if (!rendering || !trainSystem) return positions;

		// The ambient system owns the distances, but they are not public; the
		// meshes are, and their world positions are what matters for occupancy.
		// Projecting each onto the line would cost a search, so occupancy is
		// judged in world space against the signal's own world position below.
		for (const mesh of rendering.ambientMeshes) {
			positions.push(mesh.position.x, mesh.position.z);
		}

		return positions;
	}

	private aspectFor(signal: Signal, traffic: number[], playerDir: number): SignalAspect {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem) return 'clear';

		// The service on the PLAYER'S OWN LINE first. Until this existed the
		// signals only ever watched the passing trains on the adjacent
		// alignment — traffic that cannot be in your way — so a red protected
		// nothing and could be run through all day without consequence.
		const lead = this.systemManager.getSystem(AmbientTrainSystem)?.leadingDistance();

		if (lead !== null && lead !== undefined
			&& blockOccupied(signal.dist, BLOCK_LENGTH, lead, playerDir)) {
			return 'danger';
		}

		if (traffic.length === 0) return 'clear';

		// The block this signal protects runs from the signal onward, AWAY from
		// the player — the direction the oncoming service came from.
		const start = trainSystem.getPositionOnLine(
			trainSystem.currentLineIdx, signal.dist, playerDir, TRACK_OFFSET * playerDir,
		);
		const end = trainSystem.getPositionOnLine(
			trainSystem.currentLineIdx, signal.dist + BLOCK_LENGTH * playerDir, playerDir, TRACK_OFFSET * playerDir,
		);

		if (!start || !end) return 'clear';

		for (let i = 0; i < traffic.length; i += 2) {
			const x = traffic[i];
			const z = traffic[i + 1];

			// Inside the block if it is within reach of either end. A crude
			// test, but the block is a straight-ish 620 m and a train is 60 m:
			// the answer only has to be right about which side of the signal it
			// is on.
			const nearStart = Math.hypot(x - start.x, z - start.y);
			const nearEnd = Math.hypot(x - end.x, z - end.y);

			if (nearStart + nearEnd < BLOCK_LENGTH * 1.25) return 'danger';
		}

		return 'clear';
	}

	private setAspect(signal: Signal, aspect: SignalAspect): void {
		if (signal.aspect === aspect) return;

		signal.aspect = aspect;
		signal.mesh.updateColorBuffer(signalAspectColors(aspect));
	}

	private pose(trainSystem: TrainSystem, signal: Signal, playerDir: number): void {
		const pos = trainSystem.getPositionOnLine(
			trainSystem.currentLineIdx,
			signal.dist,
			playerDir,
			(TRACK_OFFSET + SIGNAL_SIDE) * playerDir,
		);

		if (!pos) return;

		signal.mesh.position.set(pos.x, pos.height, pos.y);
		// Facing back down the line, so it reads to the driver approaching it.
		signal.mesh.rotation.set(0, pos.heading + Math.PI, 0);
		signal.mesh.updateMatrix();
	}
}
