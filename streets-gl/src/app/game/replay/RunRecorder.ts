/**
 * The last minute of driving, kept.
 *
 * A stop card says "Good stop, 65" and the child has no idea WHICH part of the
 * approach cost them the other 110 — whether they braked too late, too hard,
 * or coasted the last thirty metres and crept in. The verdict is a grade
 * without a mark scheme.
 *
 * This is the raw material for showing them: a fixed-size ring of samples
 * taken a few times a second. Fixed size on purpose — a player can drive for
 * an hour, and an array that grew for all of it would be a slow memory leak
 * that only ever bites the people who like the game most.
 *
 * Carries position and heading as well as speed, so the same recording can
 * later drive a camera along the approach rather than only a graph of it.
 *
 * Pure: a buffer and the functions that read it. No clock, no train.
 */

/** How often a sample is taken, seconds. 5 Hz. */
export const SAMPLE_EVERY_S = 0.2;

/**
 * How much driving is kept, seconds.
 *
 * Comfortably longer than an approach from 300 m out — at 30 km/h the last
 * 300 m alone takes 36 s — so the whole of a slow approach is still in the
 * ring when the stop is scored.
 */
export const KEEP_S = 60;

/** Samples that adds up to. */
export const CAPACITY = Math.ceil(KEEP_S / SAMPLE_EVERY_S);

export interface RunSample {
	/** Seconds since recording began. */
	t: number;
	/** Distance along the track, metres — the same axis stations sit on. */
	dist: number;
	/** Metres per second. */
	speed: number;
	/** World position, for a camera that wants to fly the approach. */
	x: number;
	z: number;
	/** Radians clockwise from north. */
	heading: number;
}

export interface RunRecorder {
	/** Ring storage. Shorter than `capacity` until it has filled once. */
	samples: RunSample[];
	/** Where the next sample goes. */
	head: number;
	capacity: number;
	/** Seconds since the last sample was taken, so the rate is honoured. */
	sinceLast: number;
	/** The clock the samples are stamped with. */
	elapsed: number;
}

export function createRecorder(capacity: number = CAPACITY): RunRecorder {
	return {samples: [], head: 0, capacity: Math.max(1, Math.floor(capacity)), sinceLast: 0, elapsed: 0};
}

export function resetRecorder(rec: RunRecorder): void {
	rec.samples = [];
	rec.head = 0;
	rec.sinceLast = 0;
	rec.elapsed = 0;
}

/**
 * Advance the clock and take a sample if one is due.
 *
 * Returns whether a sample was stored, which is the only thing a caller could
 * usefully branch on.
 */
export function tickRecorder(
	rec: RunRecorder,
	deltaTime: number,
	sample: Omit<RunSample, 't'>,
): boolean {
	if (!Number.isFinite(deltaTime) || deltaTime <= 0) return false;
	if (!Number.isFinite(sample.dist) || !Number.isFinite(sample.speed)) return false;

	// Capped like every other clock in the game: a backgrounded tab hands back
	// one enormous frame, and an uncapped one would stamp a sample a minute
	// after its neighbour and put a straight line through the graph.
	const step = Math.min(deltaTime, 1);

	rec.elapsed += step;
	rec.sinceLast += step;

	if (rec.sinceLast < SAMPLE_EVERY_S) return false;

	rec.sinceLast = 0;

	const stored: RunSample = {
		t: rec.elapsed,
		dist: sample.dist,
		speed: sample.speed,
		x: Number.isFinite(sample.x) ? sample.x : 0,
		z: Number.isFinite(sample.z) ? sample.z : 0,
		heading: Number.isFinite(sample.heading) ? sample.heading : 0,
	};

	if (rec.samples.length < rec.capacity) {
		rec.samples.push(stored);
		rec.head = rec.samples.length % rec.capacity;
	} else {
		rec.samples[rec.head] = stored;
		rec.head = (rec.head + 1) % rec.capacity;
	}

	return true;
}

/** Everything kept, oldest first. */
export function orderedSamples(rec: RunRecorder): RunSample[] {
	if (rec.samples.length < rec.capacity) return rec.samples.slice();

	return [...rec.samples.slice(rec.head), ...rec.samples.slice(0, rec.head)];
}

/** The last `seconds` of driving, oldest first. */
export function samplesSince(rec: RunRecorder, seconds: number): RunSample[] {
	if (!Number.isFinite(seconds) || seconds <= 0) return [];

	const from = rec.elapsed - seconds;

	return orderedSamples(rec).filter(s => s.t >= from);
}

/**
 * The run in towards a marker, oldest first.
 *
 * Selected by DISTANCE rather than by time: an approach is "the last 300 m",
 * and how long that took is the very thing being shown. Takes the direction
 * of travel because the track distance counts down on a reversed run, and a
 * filter that assumed one direction would return nothing at all on the other.
 */
export function approachSamples(
	rec: RunRecorder,
	markerDist: number,
	direction: number,
	windowM: number,
): RunSample[] {
	if (!Number.isFinite(markerDist) || !Number.isFinite(windowM) || windowM <= 0) return [];

	const all = orderedSamples(rec);
	const out: RunSample[] = [];

	for (const s of all) {
		// How far short of the marker this sample was, in the direction of
		// travel: positive before it, negative past it.
		const toGo = (markerDist - s.dist) * (direction >= 0 ? 1 : -1);

		// A little past the marker is kept — overshooting IS the story of some
		// stops, and cutting the graph off at the mark would hide it.
		if (toGo <= windowM && toGo >= -windowM * 0.25) out.push(s);
	}

	return out;
}

/** How far short of the marker a sample was; negative means past it. */
export function metresToGo(sample: RunSample, markerDist: number, direction: number): number {
	return (markerDist - sample.dist) * (direction >= 0 ? 1 : -1);
}

/**
 * Where the train sat between two samples, for a camera that runs on its own
 * clock rather than on the recorder's.
 *
 * Headings are blended the short way round, or a train crossing north would
 * swing the whole way through south to get there.
 */
export function sampleAt(samples: RunSample[], t: number): RunSample | null {
	if (samples.length === 0) return null;
	if (samples.length === 1 || t <= samples[0].t) return samples[0];

	const last = samples[samples.length - 1];

	if (t >= last.t) return last;

	let i = 0;

	while (i < samples.length - 1 && samples[i + 1].t <= t) i++;

	const a = samples[i];
	const b = samples[i + 1];
	const span = b.t - a.t;
	const f = span > 0 ? (t - a.t) / span : 0;

	let dh = b.heading - a.heading;

	while (dh > Math.PI) dh -= 2 * Math.PI;
	while (dh < -Math.PI) dh += 2 * Math.PI;

	return {
		t,
		dist: a.dist + (b.dist - a.dist) * f,
		speed: a.speed + (b.speed - a.speed) * f,
		x: a.x + (b.x - a.x) * f,
		z: a.z + (b.z - a.z) * f,
		heading: a.heading + dh * f,
	};
}
