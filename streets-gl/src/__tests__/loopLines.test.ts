/**
 * Loop-line support: detection in the route parser, wrap-around physics,
 * and circular station math.
 */
import {parseMetroMap, MetroMapData} from '~/app/game/data/RouteParser';
import {buildTrackData, wrapTrackDistance} from '~/app/game/data/TrackBuilder';
import {createTrainPhysicsState, updateTrainPhysics} from '~/app/game/physics/TrainPhysics';
import {StationManager} from '~/app/game/data/StationManager';

// A ~square loop around central Tel Aviv, closed by repeating the first id.
const LOOP_MAP: MetroMapData = {
	name: 'Loop Test',
	stations: {
		a: {name: 'Alpha', lat: 32.06, lng: 34.76},
		b: {name: 'Beta', lat: 32.08, lng: 34.76},
		c: {name: 'Gamma', lat: 32.08, lng: 34.79},
		d: {name: 'Delta', lat: 32.06, lng: 34.79},
	},
	lines: [
		{id: 'loop', name: 'Circle Line', color: '#ff0000', stationIds: ['a', 'b', 'c', 'd', 'a']},
	],
};

const STRAIGHT_MAP: MetroMapData = {
	name: 'Straight Test',
	stations: {
		a: {name: 'Alpha', lat: 32.06, lng: 34.76},
		b: {name: 'Beta', lat: 32.08, lng: 34.76},
		c: {name: 'Gamma', lat: 32.10, lng: 34.76},
	},
	lines: [
		{id: 's', name: 'Straight Line', color: '#00ff00', stationIds: ['a', 'b', 'c']},
	],
};

describe('RouteParser loop detection', () => {
	test('repeated first/last station id marks the line as a loop', () => {
		const [line] = parseMetroMap(LOOP_MAP);
		expect(line.isLoop).toBe(true);
	});

	test('the closing duplicate is not listed as a second stop', () => {
		const [line] = parseMetroMap(LOOP_MAP);
		expect(line.stations.map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(line.allPoints.length).toBe(5); // geometry keeps the closing point
	});

	test('stationPointIndices aligns stations with allPoints', () => {
		const [line] = parseMetroMap(LOOP_MAP);
		expect(line.stationPointIndices).toEqual([0, 1, 2, 3]);
		for (let i = 0; i < line.stations.length; i++) {
			expect(line.allPoints[line.stationPointIndices[i]].id).toBe(line.stations[i].id);
		}
	});

	test('endpoints within 150m close the loop with a synthetic waypoint', () => {
		const nearLoop: MetroMapData = {
			...LOOP_MAP,
			stations: {
				...LOOP_MAP.stations,
				e: {name: 'Epsilon', lat: 32.0601, lng: 34.7601}, // ~15m from a
			},
			lines: [{id: 'nl', name: 'Near Loop', color: '#0000ff', stationIds: ['a', 'b', 'c', 'd', 'e']}],
		};
		const [line] = parseMetroMap(nearLoop);
		expect(line.isLoop).toBe(true);
		const last = line.allPoints[line.allPoints.length - 1];
		expect(last.isWaypoint).toBe(true);
		expect(last.lat).toBe(line.allPoints[0].lat);
		expect(last.lng).toBe(line.allPoints[0].lng);
	});

	test('an ordinary line is not a loop', () => {
		const [line] = parseMetroMap(STRAIGHT_MAP);
		expect(line.isLoop).toBe(false);
		expect(line.stations.length).toBe(3);
	});
});

describe('Loop track geometry', () => {
	test('loop track closes exactly (last point equals first)', () => {
		const [line] = parseMetroMap(LOOP_MAP);
		const track = buildTrackData(line.allPoints, line.isLoop);
		expect(track.isLoop).toBe(true);
		const pts = track.spline.points;
		expect(pts[pts.length - 1][0]).toBeCloseTo(pts[0][0], 10);
		expect(pts[pts.length - 1][1]).toBeCloseTo(pts[0][1], 10);
	});
});

describe('Loop physics wrap-around', () => {
	function makeLoopTrack() {
		const [line] = parseMetroMap(LOOP_MAP);
		return buildTrackData(line.allPoints, line.isLoop);
	}

	test('train crosses the seam forward without stopping', () => {
		const track = makeLoopTrack();
		const state = createTrainPhysicsState(track.totalLength - 10);
		state.trainSpeed = 20;
		updateTrainPhysics(state, {throttle: true, braking: false, emergency: false}, track, 1.0);
		expect(state.trainDist).toBeLessThan(track.totalLength);
		expect(state.trainDist).toBeGreaterThan(0);
		expect(state.trainDist).toBeLessThan(40); // wrapped past the seam
		expect(state.trainSpeed).toBeGreaterThan(0); // no forced end-stop
	});

	test('train crosses the seam backward', () => {
		const track = makeLoopTrack();
		const state = createTrainPhysicsState(5);
		state.trainSpeed = 20;
		state.direction = -1;
		updateTrainPhysics(state, {throttle: false, braking: false, emergency: false}, track, 1.0);
		expect(state.trainDist).toBeGreaterThan(track.totalLength - 40);
	});

	test('non-loop track still stops at the ends', () => {
		const [line] = parseMetroMap(STRAIGHT_MAP);
		const track = buildTrackData(line.allPoints, line.isLoop);
		const state = createTrainPhysicsState(track.totalLength - 10);
		state.trainSpeed = 30;
		updateTrainPhysics(state, {throttle: true, braking: false, emergency: false}, track, 1.0);
		expect(state.trainDist).toBe(track.totalLength);
		expect(state.trainSpeed).toBe(0);
	});

	test('wrapTrackDistance wraps loops and clamps straights', () => {
		const track = makeLoopTrack();
		const L = track.totalLength;
		expect(wrapTrackDistance(L + 25, track)).toBeCloseTo(25, 6);
		expect(wrapTrackDistance(-25, track)).toBeCloseTo(L - 25, 6);

		const [line] = parseMetroMap(STRAIGHT_MAP);
		const straight = buildTrackData(line.allPoints, line.isLoop);
		expect(wrapTrackDistance(straight.totalLength + 25, straight)).toBe(straight.totalLength);
		expect(wrapTrackDistance(-25, straight)).toBe(0);
	});
});

describe('StationManager circular distances', () => {
	test('station at the seam is "near" from both sides of a loop', () => {
		const stations = [
			{id: 'a', name: 'Alpha', lat: 0, lng: 0},
			{id: 'b', name: 'Beta', lat: 0, lng: 0},
		];
		const dists = [0, 500];
		const L = 1000;
		const sm = new StationManager();

		// Train just before the seam (dist 990): station a (at 0) is 10m away circularly.
		const state = sm.update(dists, stations, 990, 1, 1, true, L);
		expect(state.nearestStationIdx).toBe(0);
		expect(state.nearestStationDist).toBeCloseTo(10, 6);
		expect(state.arriving).toBe(true);
	});

	test('next station wraps around the seam', () => {
		const stations = [
			{id: 'a', name: 'Alpha', lat: 0, lng: 0},
			{id: 'b', name: 'Beta', lat: 0, lng: 0},
		];
		const dists = [0, 500];
		const L = 1000;
		const sm = new StationManager();

		// Train at 600 heading forward: next is a (at 0 → 400m ahead via seam).
		const state = sm.update(dists, stations, 600, 10, 1, true, L);
		expect(state.nextStationIdx).toBe(0);
		expect(state.nextStationDist).toBeCloseTo(400, 6);
	});
});
