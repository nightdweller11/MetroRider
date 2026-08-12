import {StopResult} from './StopScorer';

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
	): RunResult | null {
		if (!this.context || this.stops.length === 0) return null;

		const totalPoints = this.getTotalPoints();
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
			summary: buildSummary(this.stops, perfect, passengers, completedLine),
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
): string {
	const scored = stops.filter(s => s.verdict !== 'passed').length;
	const missed = stops.length - scored;

	const parts: string[] = [];
	parts.push(`${scored} stop${scored === 1 ? '' : 's'} made`);
	if (perfect > 0) parts.push(`${perfect} perfect`);
	if (missed > 0) parts.push(`${missed} rolled through`);
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
	if (run.passengersDelivered >= 100) {
		badges.push({id: 'busy-service', label: '👥 Busy service', description: 'Delivered 100 passengers in one run'});
	}
	if (hourOfDay >= 2 && hourOfDay < 5) {
		badges.push({id: 'night-owl', label: '🌙 Night owl', description: 'Drove the night service'});
	}

	return badges;
}
