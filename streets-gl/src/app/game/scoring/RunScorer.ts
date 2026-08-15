import {StopResult} from './StopScorer';
import {
	arrivalMark, describePunctuality, lateArrivals, punctualityBonus, punctualityPercent,
} from '../service/Punctuality';

/**
 * A run = the stops made since the line was picked, aggregated into one score
 * with a plain-language summary.
 *
 * Loops matter here: a circle line has no terminus, so a "lap" is every
 * station visited once. Without that a loop run would never finish and never
 * post a score.
 */

export interface RunResult {
	mapId: string;
	lineId: string;
	lineName: string;
	stops: StopResult[];
	/** Stations on the line, for "6 of 9 stops". */
	stationCount: number;
	totalPoints: number;
	/** Average points per stop attempted, 0-175. */
	averagePoints: number;
	perfectStops: number;
	passengersDelivered: number;
	passengersLeftBehind: number;
	durationMs: number;
	completedLine: boolean;
	summary: string;
	/**
	 * How well the timetable was kept, as a percentage — `null` when nothing on
	 * this run had a scheduled time to be kept to.
	 */
	punctualityPercent: number | null;
	/** Points earned for keeping it. Always a bonus, never a deduction. */
	punctualityBonus: number;
}

export interface RunContext {
	mapId: string;
	lineId: string;
	lineName: string;
	stationCount: number;
	isLoop: boolean;
}

export class RunScorer {
	private context: RunContext | null = null;
	private stops: StopResult[] = [];
	private visited = new Set<number>();
	private startedAt = 0;

	public start(context: RunContext, now: number): void {
		this.context = context;
		this.stops = [];
		this.visited = new Set();
		this.startedAt = now;
	}

	public isActive(): boolean {
		return this.context !== null;
	}

	public getStops(): StopResult[] {
		return this.stops;
	}

	public getTotalPoints(): number {
		return this.stops.reduce((sum, s) => sum + s.points, 0);
	}

	public addStop(result: StopResult): void {
		if (!this.context) return;
		this.stops.push(result);
		if (result.verdict !== 'passed') this.visited.add(result.stationIndex);
	}

	/** True when the line has been driven end to end (or a full lap on a loop). */
	public isComplete(currentStationIndex: number): boolean {
		if (!this.context) return false;
		const {stationCount, isLoop} = this.context;

		if (isLoop) {
			return this.visited.size >= stationCount;
		}
		// A terminus is either end of the line, and only counts once we have
		// actually stopped somewhere on the way there.
		const atTerminus = currentStationIndex === 0 || currentStationIndex === stationCount - 1;
		return atTerminus && this.visited.size >= 2;
	}

	public finalize(
		now: number,
		passengers: {delivered: number; leftBehind: number},
		completedLine: boolean,
		/**
		 * How late each scored stop was, in the order they were made. `null` for
		 * a stop with no schedule — dropped from the average rather than counted
		 * as a failure.
		 */
		lateness: (number | null)[] = [],
	): RunResult | null {
		if (!this.context || this.stops.length === 0) return null;

		const marks = lateness.map(arrivalMark);
		const timed = marks.filter(m => m !== null).length;
		const percent = punctualityPercent(marks);
		const bonus = punctualityBonus(percent, timed);

		const totalPoints = this.getTotalPoints() + bonus;
		const perfect = this.stops.filter(s => s.verdict === 'perfect').length;
		const average = Math.round(totalPoints / this.stops.length);

		const result: RunResult = {
			mapId: this.context.mapId,
			lineId: this.context.lineId,
			lineName: this.context.lineName,
			stops: this.stops,
			stationCount: this.context.stationCount,
			totalPoints,
			averagePoints: average,
			perfectStops: perfect,
			passengersDelivered: passengers.delivered,
			passengersLeftBehind: passengers.leftBehind,
			durationMs: Math.max(0, now - this.startedAt),
			completedLine,
			punctualityPercent: percent,
			punctualityBonus: bonus,
			summary: buildSummary(
				this.stops, perfect, passengers, completedLine,
				describePunctuality(percent, lateArrivals(lateness)),
			),
		};

		this.context = null;
		this.stops = [];
		this.visited = new Set();
		return result;
	}

	public abandon(): void {
		this.context = null;
		this.stops = [];
		this.visited = new Set();
	}
}

/** One sentence a nine-year-old can read, not a stat dump. */
function buildSummary(
	stops: StopResult[],
	perfect: number,
	passengers: {delivered: number; leftBehind: number},
	completedLine: boolean,
	punctuality: string,
): string {
	const scored = stops.filter(s => s.verdict !== 'passed').length;
	const missed = stops.length - scored;

	const parts: string[] = [];
	parts.push(`${scored} stop${scored === 1 ? '' : 's'} made`);
	if (perfect > 0) parts.push(`${perfect} perfect`);
	if (missed > 0) parts.push(`${missed} rolled through`);
	if (punctuality) parts.push(punctuality);
	if (passengers.delivered > 0) parts.push(`${passengers.delivered} passengers delivered`);
	if (passengers.leftBehind > 0) parts.push(`${passengers.leftBehind} left waiting`);

	const head = completedLine ? 'Whole line driven — ' : '';
	return head + parts.join(' · ');
}

/** Records worth remembering. Cosmetic — nothing is ever locked behind them. */
export interface Badge {
	id: string;
	label: string;
	description: string;
}

export function badgesForRun(run: RunResult, hourOfDay: number): Badge[] {
	const badges: Badge[] = [];

	if (run.perfectStops >= 1) {
		badges.push({id: 'perfect-stop', label: '🎯 Perfect stop', description: 'Stopped within 2 m of the mark'});
	}
	if (run.perfectStops >= 5) {
		badges.push({id: 'five-perfect', label: '🎯🎯 Five perfect stops', description: 'Five perfect stops in one run'});
	}
	if (run.completedLine) {
		badges.push({id: 'full-line', label: '🛤️ Full line', description: 'Drove the line end to end'});
	}
	if (run.stops.length > 0 && run.stops.every(s => s.verdict !== 'passed')) {
		badges.push({id: 'every-stop', label: '🚉 Every stop served', description: 'Did not roll through a single station'});
	}
	if (run.stops.length > 0 && run.stops.every(s => s.smoothness === 'smooth')) {
		badges.push({id: 'smooth-operator', label: '☕ Smooth operator', description: 'Nobody spilled their coffee'});
	}
	// Three stops, because keeping time over one is not keeping time.
	if (run.punctualityPercent === 100 && run.stops.length >= 3) {
		badges.push({id: 'right-time', label: '⏱️ Right time', description: 'Every stop made on schedule'});
	}
	if (run.passengersDelivered >= 100) {
		badges.push({id: 'busy-service', label: '👥 Busy service', description: 'Delivered 100 passengers in one run'});
	}
	if (hourOfDay >= 2 && hourOfDay < 5) {
		badges.push({id: 'night-owl', label: '🌙 Night owl', description: 'Drove the night service'});
	}

	return badges;
}
