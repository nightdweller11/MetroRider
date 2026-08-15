import System from '../System';
import TileSystem from '../systems/TileSystem';
import TrainSystem from './TrainSystem';
import GameCameraSystem from './GameCameraSystem';
import JourneySystem from './JourneySystem';
import {
	nearestNewPlace, describeFind, ANNOUNCE_GAP_S, type NamedPlace,
} from './data/Discovery';

/**
 * Noticing where you are.
 *
 * The checklist had discovery waiting on `notable[]` being plumbed out of the
 * map worker. It did not need to be: every loaded tile already carries the
 * map's own labels — real named places, in world metres, each with the
 * cartography's own idea of how important it is. That is the data, and it was
 * already arriving.
 *
 * Works whether you are driving or on foot, because the interesting half of
 * walking is finding out what you have been driving past.
 */

/** How often to look, seconds. Places do not move. */
const CHECK_EVERY_S = 0.7;

export default class DiscoverySystem extends System {
	private sinceCheckS = 0;
	private sinceAnnounceS = ANNOUNCE_GAP_S;

	/** Set by GameUISystem so a find can be said out loud. */
	public onFind: ((text: string) => void) | null = null;

	public postInit(): void {
		// Tiles and their labels stream in; there is nothing to look at yet.
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem?.gameActive) return;

		this.sinceCheckS += deltaTime;
		this.sinceAnnounceS += deltaTime;

		if (this.sinceCheckS < CHECK_EVERY_S) return;

		this.sinceCheckS = 0;

		// One at a time, with a pause between: at 200 km/h a whole town's worth
		// of labels comes into range at once, and a stack of toasts is not a
		// discovery, it is a wall of text.
		if (this.sinceAnnounceS < ANNOUNCE_GAP_S) return;

		const where = this.playerGroundPosition();

		if (!where) return;

		const journey = this.systemManager.getSystem(JourneySystem);

		if (!journey) return;

		const found = journey.placesFound();
		const place = nearestNewPlace(this.nearbyPlaces(where), where.x, where.z, found);

		if (!place) return;

		if (journey.recordPlace(place.name, place.x, place.z)) {
			this.sinceAnnounceS = 0;
			this.onFind?.(describeFind(place.name, journey.snapshot().places.length));
		}
	}

	/**
	 * Where the player is on the ground — the walker when they have stepped
	 * out, the train otherwise. Finding places on foot is most of the point of
	 * being on foot.
	 */
	private playerGroundPosition(): {x: number; z: number} | null {
		const cam = this.systemManager.getSystem(GameCameraSystem);
		const walker = cam?.isWalkMode() ? cam.walkPosition() : null;

		if (walker) return {x: walker.x, z: walker.z};

		const pos = this.systemManager.getSystem(TrainSystem)?.trainPosition;

		return pos ? {x: pos.x, z: pos.y} : null;
	}

	/**
	 * Labels from the tiles around the player.
	 *
	 * Read straight off the loaded tiles rather than kept in an index of our
	 * own: the world already evicts a tile when it is far away, so an index
	 * would be a second copy of the same thing that had to be told when to
	 * forget.
	 */
	private nearbyPlaces(where: {x: number; z: number}): NamedPlace[] {
		const tileSystem = this.systemManager.getSystem(TileSystem);

		if (!tileSystem) return [];

		const out: NamedPlace[] = [];

		for (const tile of tileSystem.tiles.values()) {
			for (const label of tile.labelBuffersList) {
				// A cheap box test before the distance: a city tile carries
				// hundreds of labels and most are nowhere near.
				if (Math.abs(label.x - where.x) > 300 || Math.abs(label.z - where.z) > 300) continue;

				out.push({name: label.text, x: label.x, z: label.z, priority: label.priority});
			}
		}

		return out;
	}
}
