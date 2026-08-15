import System from '../System';
import TrainSystem from './TrainSystem';
import ProfileClient from './profiles/ProfileClient';
import {
	addDriving, addLine, addPlace, addStop, emptyJourney, milestoneCrossed, type JourneyLog,
} from './data/JourneyLog';

/**
 * Keeping the record of everything you have driven.
 *
 * The scoring system grades a run and forgets it. This is the other half: how
 * far, how long, how many cities, how many stations — the numbers a child
 * wants after a fortnight rather than after a single trip.
 *
 * Written to localStorage every few seconds and to the signed-in profile when
 * there is one, so it survives a reload either way. Local storage is the
 * authority: a guest is still a player, and losing their record because they
 * never made an account would be the wrong way round.
 */

const STORAGE_KEY = 'metrorider.journey.v1';
/** How often the record is written out, seconds. */
const SAVE_EVERY_S = 8;

export default class JourneySystem extends System {
	private log: JourneyLog = emptyJourney();
	private sinceSaveS = 0;
	private lastLineKey = '';
	private dirty = false;

	/** Set by GameUISystem so a milestone can be said out loud. */
	public onMilestone: ((text: string) => void) | null = null;

	public postInit(): void {
		this.log = this.load();
	}

	public snapshot(): JourneyLog {
		return this.log;
	}

	private load(): JourneyLog {
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);

			if (!raw) return emptyJourney();

			const parsed = JSON.parse(raw) as Partial<JourneyLog>;

			// Merged over a fresh record rather than trusted: this is data from
			// an older version of the game, and a missing field must not become
			// `undefined` arithmetic that turns the whole total into NaN.
			return {
				...emptyJourney(),
				...parsed,
				stations: Array.isArray(parsed.stations) ? parsed.stations : [],
				lines: Array.isArray(parsed.lines) ? parsed.lines : [],
				maps: Array.isArray(parsed.maps) ? parsed.maps : [],
				places: Array.isArray(parsed.places) ? parsed.places : [],
			};
		} catch {
			return emptyJourney();
		}
	}

	private save(): void {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.log));
		} catch {
			// A full or blocked store is not worth interrupting a game for.
		}

		void ProfileClient.get().setData?.(STORAGE_KEY, this.log);
	}

	/** Every place found so far, for the discovery check and the sheet. */
	public placesFound(): ReadonlySet<string> {
		return new Set(this.log.places);
	}

	/** Record a named place come across, and say so if it is new. */
	public recordPlace(name: string): boolean {
		const before = this.log;

		this.log = addPlace(before, name);

		if (this.log === before) return false;

		this.dirty = true;
		this.announce(before, this.log);

		return true;
	}

	/** Called by the scorer when a stop is made, so it counts once. */
	public recordStop(stationIndex: number, delivered: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const ls = trainSystem?.getCurrentLine();

		if (!trainSystem || !ls) return;

		const before = this.log;

		this.log = addStop(before, trainSystem.mapName || 'map', ls.parsed.id, stationIndex, delivered);
		this.dirty = true;
		this.announce(before, this.log);
	}

	private announce(before: JourneyLog, after: JourneyLog): void {
		const milestone = milestoneCrossed(before, after);

		if (milestone) this.onMilestone?.(milestone);
	}

	public update(deltaTime: number): void {
		const trainSystem = this.systemManager.getSystem(TrainSystem);

		if (!trainSystem?.gameActive) return;

		const ls = trainSystem.getCurrentLine();

		if (!ls) return;

		const lineKey = `${trainSystem.mapName}::${ls.parsed.id}`;

		if (lineKey !== this.lastLineKey) {
			this.lastLineKey = lineKey;

			const before = this.log;

			this.log = addLine(before, trainSystem.mapName || 'map', ls.parsed.id, trainSystem.mapName || 'Unknown city');
			this.dirty = true;
			this.announce(before, this.log);
		}

		const speed = trainSystem.physicsState.trainSpeed;

		if (speed > 0.2) {
			const before = this.log;

			this.log = addDriving(before, speed, deltaTime);
			this.dirty = true;
			this.announce(before, this.log);
		}

		this.sinceSaveS += deltaTime;

		if (this.dirty && this.sinceSaveS >= SAVE_EVERY_S) {
			this.sinceSaveS = 0;
			this.dirty = false;
			this.save();
		}
	}
}
