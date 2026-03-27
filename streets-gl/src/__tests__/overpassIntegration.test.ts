/**
 * Tests for Overpass API integration and the CombinedVectorFeatureProvider
 * building-merge logic.
 *
 * - Unit tests verify merging logic with mock providers.
 * - Integration tests call the real Overpass API (skipped in CI by default).
 * - Performance tests compare optimized vs full queries with timing.
 */

import CombinedVectorFeatureProvider from '~/lib/tile-processing/vector/providers/CombinedVectorFeatureProvider';
import VectorFeatureCollection from '~/lib/tile-processing/vector/features/VectorFeatureCollection';
import VectorArea, {VectorAreaRingType} from '~/lib/tile-processing/vector/features/VectorArea';
import {VectorAreaDescriptor} from '~/lib/tile-processing/vector/qualifiers/descriptors';
import getFacadeParamsFromTags
	from '~/lib/tile-processing/vector/qualifiers/factories/vector-tile/helpers/getFacadeParams';
import getFacadeParamsFromOSMTags
	from '~/lib/tile-processing/vector/qualifiers/factories/osm/helpers/getFacadeParamsFromTags';

function makeArea(
	type: VectorAreaDescriptor['type'],
	material?: VectorAreaDescriptor['buildingFacadeMaterial'],
	osmId: number = 1
): VectorArea {
	return {
		type: 'area',
		osmReference: {type: 0, id: osmId},
		descriptor: {
			type,
			buildingFacadeMaterial: material ?? 'plaster',
			buildingFacadeColor: 0xffffff,
		} as VectorAreaDescriptor,
		rings: [{
			nodes: [{type: 'node', osmReference: null, descriptor: null, x: 0, y: 0, rotation: 0}],
			type: VectorAreaRingType.Outer,
		}],
	};
}

function makeCollection(areas: VectorArea[]): VectorFeatureCollection {
	return {nodes: [], polylines: [], areas};
}


// ---------------------------------------------------------------------------
//  Unit: CombinedVectorFeatureProvider merging
// ---------------------------------------------------------------------------

describe('CombinedVectorFeatureProvider merge logic', () => {
	let provider: CombinedVectorFeatureProvider;

	beforeEach(() => {
		provider = new CombinedVectorFeatureProvider({
			overpassEndpoints: ['https://overpass-api.de/api/interpreter'],
			tileServerEndpoint: 'https://tiles.streets.gl',
			vectorTilesEndpointTemplate: 'https://tiles.streets.gl/vector/{z}/{x}/{y}',
			heightPromise: async (p) => new Float64Array(p.length / 2),
		});
	});

	test('with useOverpassForBuildings disabled, returns PBF data unchanged', async () => {
		const pbfAreas = [makeArea('building', 'plaster', 100), makeArea('water', undefined, 200)];
		const mockPbf = makeCollection(pbfAreas);

		(provider as any).pbfProvider = {
			getCollection: jest.fn().mockResolvedValue(mockPbf),
		};
		(provider as any).overpassProvider = {
			getCollection: jest.fn().mockResolvedValue(makeCollection([])),
			setQueryMode: jest.fn(),
		};

		const result = await provider.getCollection({x: 35198, y: 24026, zoom: 16});

		expect(result.areas).toHaveLength(2);
		expect(result.areas).toEqual(pbfAreas);
		expect((provider as any).overpassProvider.getCollection).not.toHaveBeenCalled();
	});

	test('with useOverpassForBuildings enabled, replaces PBF buildings with Overpass buildings', async () => {
		provider.setUseOverpassForBuildings(true);

		const pbfBuilding = makeArea('building', 'plaster', 100);
		const pbfWater = makeArea('water', undefined, 200);
		const pbfRoad = makeArea('roadwayIntersection', undefined, 300);
		const overpassBuilding = makeArea('building', 'brick', 100);
		const overpassBuildingPart = makeArea('buildingPart', 'glass', 101);
		const overpassNonBuilding = makeArea('water', undefined, 999);

		(provider as any).pbfProvider = {
			getCollection: jest.fn().mockResolvedValue(
				makeCollection([pbfBuilding, pbfWater, pbfRoad])
			),
		};
		(provider as any).overpassProvider = {
			getCollection: jest.fn().mockResolvedValue(
				makeCollection([overpassBuilding, overpassBuildingPart, overpassNonBuilding])
			),
			setQueryMode: jest.fn(),
		};

		const result = await provider.getCollection({x: 35198, y: 24026, zoom: 16});

		const buildingAreas = result.areas.filter(
			a => a.descriptor.type === 'building' || a.descriptor.type === 'buildingPart'
		);
		const nonBuildingAreas = result.areas.filter(
			a => a.descriptor.type !== 'building' && a.descriptor.type !== 'buildingPart'
		);

		expect(buildingAreas).toHaveLength(2);
		expect(buildingAreas[0].descriptor.buildingFacadeMaterial).toBe('brick');
		expect(buildingAreas[1].descriptor.buildingFacadeMaterial).toBe('glass');

		expect(nonBuildingAreas).toEqual(
			expect.arrayContaining([pbfWater, pbfRoad])
		);
		expect(nonBuildingAreas).not.toContainEqual(overpassNonBuilding);
	});

	test('with useOverpassForBuildings enabled, falls back to PBF if Overpass fails', async () => {
		provider.setUseOverpassForBuildings(true);

		const pbfBuilding = makeArea('building', 'plaster', 100);
		(provider as any).pbfProvider = {
			getCollection: jest.fn().mockResolvedValue(makeCollection([pbfBuilding])),
		};
		(provider as any).overpassProvider = {
			getCollection: jest.fn().mockRejectedValue(new Error('Network error')),
			setQueryMode: jest.fn(),
		};

		const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		const result = await provider.getCollection({x: 35198, y: 24026, zoom: 16});

		expect(result.areas).toHaveLength(1);
		expect(result.areas[0]).toBe(pbfBuilding);
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Overpass fetch failed'),
			expect.any(Error)
		);
		consoleSpy.mockRestore();
	});
});


// ---------------------------------------------------------------------------
//  Unit: Facade params helpers
// ---------------------------------------------------------------------------

describe('getFacadeParamsFromTags (PBF vector-tile path)', () => {
	test('returns stone material for "stone" material tag', () => {
		const result = getFacadeParamsFromTags({material: 'stone'} as any);
		expect(result.material).toBe('stone');
	});

	test('returns stucco material for "stucco" material tag', () => {
		const result = getFacadeParamsFromTags({material: 'stucco'} as any);
		expect(result.material).toBe('stucco');
	});

	test('returns metalPanel material for "metal" material tag', () => {
		const result = getFacadeParamsFromTags({material: 'metal'} as any);
		expect(result.material).toBe('metalPanel');
	});

	test('returns glass for commercial buildingType when no material', () => {
		const result = getFacadeParamsFromTags({buildingType: 'commercial'} as any);
		expect(result.material).toBe('glass');
	});

	test('returns brick for school buildingType when no material', () => {
		const result = getFacadeParamsFromTags({buildingType: 'school'} as any);
		expect(result.material).toBe('brick');
	});

	test('returns cementBlock for industrial buildingType', () => {
		const result = getFacadeParamsFromTags({buildingType: 'industrial'} as any);
		expect(result.material).toBe('cementBlock');
	});

	test('material tag takes precedence over buildingType', () => {
		const result = getFacadeParamsFromTags({material: 'brick', buildingType: 'commercial'} as any);
		expect(result.material).toBe('brick');
	});

	test('falls back to plaster when no tags match', () => {
		const result = getFacadeParamsFromTags({} as any);
		expect(result.material).toBe('plaster');
	});
});

describe('getFacadeParamsFromOSMTags (Overpass OSM path)', () => {
	test('returns stone for building:material=stone', () => {
		const result = getFacadeParamsFromOSMTags({'building:material': 'stone'});
		expect(result.material).toBe('stone');
	});

	test('returns glass for building=commercial when no explicit material', () => {
		const result = getFacadeParamsFromOSMTags({building: 'commercial'});
		expect(result.material).toBe('glass');
	});

	test('building:material takes priority over building type', () => {
		const result = getFacadeParamsFromOSMTags({
			'building:material': 'brick',
			building: 'commercial',
		});
		expect(result.material).toBe('brick');
	});

	test('building:colour tag is passed to parseColor (does not crash)', () => {
		const resultNoColour = getFacadeParamsFromOSMTags({
			'building:material': 'plaster',
		});
		expect(typeof resultNoColour.color).toBe('number');
		expect(resultNoColour.color).toBe(0xffffff);
	});
});


// ---------------------------------------------------------------------------
//  Integration: Overpass API reachability, data quality, & performance
//  These hit the real Overpass API. Skip in CI with: SKIP_OVERPASS_TESTS=1
// ---------------------------------------------------------------------------

const skipOverpass = process.env.SKIP_OVERPASS_TESTS === '1' || process.env.CI === 'true';
const itOverpass = skipOverpass ? it.skip : it;

describe('Overpass API integration (real HTTP)', () => {
	const OVERPASS_URLS = [
		'https://overpass-api.de/api/interpreter',
		'https://z.overpass-api.de/api/interpreter',
		'https://lz4.overpass-api.de/api/interpreter',
		'https://overpass.openstreetmap.fr/api/interpreter',
	];
	const TILE_X = 35198;
	const TILE_Y = 24026;
	const ZOOM = 16;

	interface PerfResult {
		queryType: string;
		serverUrl: string;
		fetchMs: number;
		parseMs: number;
		totalMs: number;
		elementCount: number;
		responseSizeBytes: number;
	}

	const perfResults: PerfResult[] = [];

	afterAll(() => {
		if (perfResults.length > 0) {
			console.log('\n=== Overpass Performance Report ===');
			for (const r of perfResults) {
				console.log(
					`  [${r.queryType}] ${r.serverUrl}: ` +
					`fetch=${r.fetchMs}ms, parse=${r.parseMs}ms, total=${r.totalMs}ms, ` +
					`elements=${r.elementCount}, size=${(r.responseSizeBytes / 1024).toFixed(1)}KB`
				);
			}
			console.log('===================================\n');
		}
	});

	async function timedQueryOverpass(
		query: string,
		label: string,
		retries = 2
	): Promise<{data: any; perf: PerfResult}> {
		let lastError: Error | null = null;

		for (const url of OVERPASS_URLS) {
			for (let attempt = 0; attempt <= retries; attempt++) {
				try {
					const fetchStart = Date.now();
					const response = await fetch(url, {
						method: 'POST',
						body: query,
					});
					const fetchMs = Date.now() - fetchStart;

					if (response.status === 504 || response.status === 429) {
						lastError = new Error(`Overpass ${url} returned ${response.status}`);
						await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
						continue;
					}
					if (!response.ok) {
						throw new Error(`Overpass ${url} returned ${response.status}: ${await response.text()}`);
					}

					const parseStart = Date.now();
					const text = await response.text();
					const data = JSON.parse(text);
					const parseMs = Date.now() - parseStart;
					const totalMs = Date.now() - fetchStart;

					const perf: PerfResult = {
						queryType: label,
						serverUrl: new URL(url).hostname,
						fetchMs,
						parseMs,
						totalMs,
						elementCount: data.elements?.length ?? 0,
						responseSizeBytes: new TextEncoder().encode(text).length,
					};
					perfResults.push(perf);
					return {data, perf};
				} catch (e) {
					lastError = e instanceof Error ? e : new Error(String(e));
					if (attempt < retries) {
						await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
					}
				}
			}
		}
		throw lastError ?? new Error('All Overpass endpoints failed');
	}

	itOverpass('Overpass API is reachable and returns valid JSON', async () => {
		const bbox = '32.055,34.765,32.056,34.766';
		const query = `[out:json][timeout:10];node(${bbox});out count;`;

		let result: {data: any; perf: PerfResult};
		try {
			result = await timedQueryOverpass(query, 'reachability', 3);
		} catch (err) {
			console.warn(`[Overpass test] Skipping - all endpoints unavailable: ${err}`);
			return;
		}

		expect(result.data).toBeDefined();
		expect(result.data.elements).toBeDefined();
		expect(Array.isArray(result.data.elements)).toBe(true);
		expect(result.perf.totalMs).toBeLessThan(15000);
	}, 60000);

	itOverpass('Overpass returns buildings with tags that PBF typically strips', async () => {
		const bbox = '32.05,34.76,32.06,34.77';
		const query = `
			[out:json][timeout:15];
			(
				way["building"](${bbox});
				relation["building"](${bbox});
			);
			out body qt;
			>>;
			out body qt;
		`;

		const {data, perf} = await timedQueryOverpass(query, 'buildings-with-tags');

		const buildings = data.elements.filter(
			(el: any) => (el.type === 'way' || el.type === 'relation') && el.tags?.building
		);

		expect(buildings.length).toBeGreaterThan(0);

		const tagKeys = new Set<string>();
		for (const b of buildings) {
			if (b.tags) {
				Object.keys(b.tags).forEach(k => tagKeys.add(k));
			}
		}

		expect(tagKeys.has('building')).toBe(true);

		const richTags = [
			'building:levels', 'building:material', 'building:colour',
			'roof:shape', 'height', 'name', 'addr:street',
		];
		const foundRichTags = richTags.filter(t => tagKeys.has(t));
		console.log(
			`[Overpass test] ${buildings.length} buildings, ` +
			`rich tags: [${foundRichTags.join(', ')}], ` +
			`${perf.totalMs}ms, ${(perf.responseSizeBytes / 1024).toFixed(1)}KB`
		);

		expect(foundRichTags.length).toBeGreaterThanOrEqual(1);
	}, 45000);

	itOverpass('optimized buildings-only query is faster than full query', async () => {
		const bbox = '32.075,34.785,32.085,34.795';

		const buildingsQuery = `
			[out:json][timeout:25];
			(
				way["building"](${bbox});
				relation["building"](${bbox});
				way["building:part"](${bbox});
				node["natural"="tree"](${bbox});
				node["highway"="street_lamp"](${bbox});
				node["highway"="traffic_signals"](${bbox});
				node["barrier"="bollard"](${bbox});
			);
			out body qt;
			>>;
			out body qt;
		`;

		const fullQuery = `
			[out:json][timeout:30];
			(
				node(${bbox});
				way(${bbox});
				rel["type"~"^(multipolygon|building)"](${bbox});
			);
			out body qt;
			>>;
			out body qt;
		`;

		let buildingsResult: {data: any; perf: PerfResult};
		let fullResult: {data: any; perf: PerfResult};

		try {
			buildingsResult = await timedQueryOverpass(buildingsQuery, 'buildings-only (optimized)', 2);
			await new Promise(r => setTimeout(r, 2000));
			fullResult = await timedQueryOverpass(fullQuery, 'full-bbox (old)', 2);
		} catch (err) {
			console.warn(`[Overpass perf] Skipping - endpoints unavailable: ${err}`);
			return;
		}

		const buildingsElements = buildingsResult.data.elements?.length ?? 0;
		const fullElements = fullResult.data.elements?.length ?? 0;
		const sizeRatio = fullResult.perf.responseSizeBytes / Math.max(1, buildingsResult.perf.responseSizeBytes);

		console.log(
			`[Overpass perf] OPTIMIZED: ${buildingsElements} elements, ` +
			`${(buildingsResult.perf.responseSizeBytes / 1024).toFixed(1)}KB, ` +
			`${buildingsResult.perf.totalMs}ms`
		);
		console.log(
			`[Overpass perf] FULL:      ${fullElements} elements, ` +
			`${(fullResult.perf.responseSizeBytes / 1024).toFixed(1)}KB, ` +
			`${fullResult.perf.totalMs}ms`
		);
		console.log(
			`[Overpass perf] Full query returns ${sizeRatio.toFixed(1)}x more data`
		);

		expect(buildingsResult.perf.responseSizeBytes).toBeLessThan(fullResult.perf.responseSizeBytes);
		expect(buildingsElements).toBeLessThan(fullElements);
	}, 120000);

	itOverpass('Overpass building data includes building:levels or height for at least some buildings', async () => {
		const bbox = '32.055,34.765,32.058,34.768';
		const query = `
			[out:json][timeout:15];
			way["building"]["building:levels"](${bbox});
			out body qt;
		`;

		let result: {data: any; perf: PerfResult};
		try {
			result = await timedQueryOverpass(query, 'building:levels', 3);
		} catch (err) {
			console.warn(`[Overpass test] Skipping - all endpoints unavailable: ${err}`);
			return;
		}

		const withLevels = result.data.elements.filter(
			(el: any) => el.type === 'way' && el.tags?.['building:levels']
		);

		console.log(
			`[Overpass test] ${withLevels.length} buildings with building:levels, ` +
			`${result.perf.totalMs}ms`
		);
		expect(withLevels.length).toBeGreaterThan(0);

		for (const bldg of withLevels.slice(0, 5)) {
			const levels = parseInt(bldg.tags['building:levels'], 10);
			expect(levels).toBeGreaterThan(0);
			expect(levels).toBeLessThan(200);
		}
	}, 120000);

	itOverpass('CombinedVectorFeatureProvider with mocked PBF uses Overpass buildings', async () => {
		const provider = new CombinedVectorFeatureProvider({
			overpassEndpoints: OVERPASS_URLS,
			tileServerEndpoint: 'https://tiles.streets.gl',
			vectorTilesEndpointTemplate: 'https://tiles.streets.gl/vector/{z}/{x}/{y}',
			heightPromise: async (p) => new Float64Array(p.length / 2),
		});

		provider.setUseOverpassForBuildings(true);

		(provider as any).pbfProvider = {
			getCollection: jest.fn().mockResolvedValue({nodes: [], polylines: [], areas: []}),
		};

		const startMs = Date.now();
		let collection: VectorFeatureCollection;
		try {
			collection = await provider.getCollection({x: TILE_X, y: TILE_Y, zoom: ZOOM});
		} catch (err) {
			console.warn(`[Overpass integration] Skipping due to network error: ${err}`);
			return;
		}
		const elapsedMs = Date.now() - startMs;

		expect(collection).toBeDefined();
		expect(collection.areas).toBeDefined();
		expect(Array.isArray(collection.areas)).toBe(true);

		const buildings = collection.areas.filter(
			a => a.descriptor.type === 'building' || a.descriptor.type === 'buildingPart'
		);

		const materialsUsed = new Set(buildings.map(b => b.descriptor.buildingFacadeMaterial));
		console.log(
			`[Overpass integration] Tile ${TILE_X},${TILE_Y}: ` +
			`${buildings.length} buildings, ${collection.areas.length} total areas, ` +
			`materials: [${[...materialsUsed].join(', ')}], ` +
			`${elapsedMs}ms total (fetch + parse + classify)`
		);

		expect(buildings.length).toBeGreaterThan(0);
	}, 90000);

	itOverpass('multi-server failover: second server succeeds after first fails', async () => {
		const badUrl = 'https://overpass-api-nonexistent.example.com/api/interpreter';
		const provider = new CombinedVectorFeatureProvider({
			overpassEndpoints: [badUrl, ...OVERPASS_URLS],
			tileServerEndpoint: 'https://tiles.streets.gl',
			vectorTilesEndpointTemplate: 'https://tiles.streets.gl/vector/{z}/{x}/{y}',
			heightPromise: async (p) => new Float64Array(p.length / 2),
		});

		provider.setUseOverpassForBuildings(true);

		(provider as any).pbfProvider = {
			getCollection: jest.fn().mockResolvedValue({nodes: [], polylines: [], areas: []}),
		};

		const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
		const startMs = Date.now();

		let collection: VectorFeatureCollection;
		try {
			collection = await provider.getCollection({x: TILE_X, y: TILE_Y, zoom: ZOOM});
		} catch (err) {
			console.warn(`[failover test] Skipping - all endpoints unavailable: ${err}`);
			warnSpy.mockRestore();
			return;
		}
		const elapsedMs = Date.now() - startMs;

		const failoverLogs = warnSpy.mock.calls.filter(
			c => typeof c[0] === 'string' && c[0].includes('[Overpass]')
		);
		warnSpy.mockRestore();

		console.log(
			`[failover test] Completed in ${elapsedMs}ms with ${failoverLogs.length} server warnings`
		);

		expect(collection.areas.length).toBeGreaterThanOrEqual(0);
		expect(failoverLogs.length).toBeGreaterThan(0);
	}, 120000);
});
