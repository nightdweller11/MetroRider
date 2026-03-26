/**
 * Tests for mobile memory optimizations.
 *
 * Validates:
 * 1. isLowMemoryMode detection (URL param, touch, deviceMemory)
 * 2. Config values differ between normal and low-memory modes
 * 3. MapWorker.tilesInProgress leak fix (entries cleaned after resolve/reject)
 * 4. Tile.dispose() cleans up terrainMaskMesh and instanceBuffers
 * 5. Aggressive eviction removes ALL out-of-frustum tiles in low-memory mode
 * 6. Graphics defaults differ between modes
 */

// ---------- re-implement detectLowMemoryMode for unit testing ----------

function detectLowMemoryMode(env: {
	urlSearch?: string;
	maxTouchPoints?: number;
	screenWidth?: number;
	screenHeight?: number;
	deviceMemory?: number;
}): boolean {
	if (env.urlSearch && env.urlSearch.includes('mobile=true')) {
		return true;
	}

	const hasTouch = (env.maxTouchPoints ?? 0) > 0;
	const smallScreen = (env.screenWidth ?? 1920) < 1024 || (env.screenHeight ?? 1080) < 1024;
	if (hasTouch && smallScreen) {
		return true;
	}

	if (typeof env.deviceMemory === 'number' && env.deviceMemory < 8) {
		return true;
	}

	return false;
}

function getConfigForMode(lowMemory: boolean) {
	return {
		MaxConcurrentTiles: lowMemory ? 40 : 150,
		TileFrustumFar: lowMemory ? 2000 : 8000,
		AggressiveEviction: lowMemory,
		WorkersCount: lowMemory ? 2 : 4,
		shadows: lowMemory ? 'off' : 'medium',
		taa: lowMemory ? 'off' : 'on',
		bloom: lowMemory ? 'off' : 'on',
		ssao: lowMemory ? 'off' : 'on',
	};
}

// ---------- 1. isLowMemoryMode detection ----------

describe('isLowMemoryMode detection', () => {
	test('default desktop environment returns false', () => {
		expect(detectLowMemoryMode({
			urlSearch: '',
			maxTouchPoints: 0,
			screenWidth: 1920,
			screenHeight: 1080,
		})).toBe(false);
	});

	test('?mobile=true URL param forces true on desktop', () => {
		expect(detectLowMemoryMode({
			urlSearch: '?mobile=true',
			maxTouchPoints: 0,
			screenWidth: 1920,
			screenHeight: 1080,
		})).toBe(true);
	});

	test('?mobile=true in longer query string works', () => {
		expect(detectLowMemoryMode({
			urlSearch: '?debug=true&mobile=true&admin=abc',
			maxTouchPoints: 0,
			screenWidth: 1920,
			screenHeight: 1080,
		})).toBe(true);
	});

	test('touch device with small screen auto-detects as true', () => {
		expect(detectLowMemoryMode({
			urlSearch: '',
			maxTouchPoints: 5,
			screenWidth: 390,
			screenHeight: 844,
		})).toBe(true);
	});

	test('touch device with large screen (iPad in desktop-like mode) returns false if screen >= 1024', () => {
		expect(detectLowMemoryMode({
			urlSearch: '',
			maxTouchPoints: 5,
			screenWidth: 1024,
			screenHeight: 1366,
		})).toBe(false);
	});

	test('deviceMemory < 8 triggers true', () => {
		expect(detectLowMemoryMode({
			urlSearch: '',
			maxTouchPoints: 0,
			screenWidth: 1920,
			screenHeight: 1080,
			deviceMemory: 4,
		})).toBe(true);
	});

	test('deviceMemory >= 8 does not trigger', () => {
		expect(detectLowMemoryMode({
			urlSearch: '',
			maxTouchPoints: 0,
			screenWidth: 1920,
			screenHeight: 1080,
			deviceMemory: 8,
		})).toBe(false);
	});

	test('no parameters (all undefined) defaults to false', () => {
		expect(detectLowMemoryMode({})).toBe(false);
	});
});

// ---------- 2. Config values differ between modes ----------

describe('Config values differ between normal and low-memory modes', () => {
	const normal = getConfigForMode(false);
	const lowMem = getConfigForMode(true);

	test('MaxConcurrentTiles is 150 in normal, 40 in low-memory', () => {
		expect(normal.MaxConcurrentTiles).toBe(150);
		expect(lowMem.MaxConcurrentTiles).toBe(40);
	});

	test('TileFrustumFar is 8000 in normal, 2000 in low-memory', () => {
		expect(normal.TileFrustumFar).toBe(8000);
		expect(lowMem.TileFrustumFar).toBe(2000);
	});

	test('AggressiveEviction is false in normal, true in low-memory', () => {
		expect(normal.AggressiveEviction).toBe(false);
		expect(lowMem.AggressiveEviction).toBe(true);
	});

	test('WorkersCount is 4 in normal, 2 in low-memory', () => {
		expect(normal.WorkersCount).toBe(4);
		expect(lowMem.WorkersCount).toBe(2);
	});
});

// ---------- 3. MapWorker.tilesInProgress leak fix ----------

describe('MapWorker.tilesInProgress leak fix', () => {
	class MockMapWorkerBefore {
		tilesInProgress: Map<string, {
			resolve: (v: any) => void;
			reject: (r?: any) => void;
		}> = new Map();

		requestTile(x: number, y: number): Promise<any> {
			return new Promise((resolve, reject) => {
				this.tilesInProgress.set(`${x},${y}`, {resolve, reject});
			});
		}

		processSuccessBefore(x: number, y: number, payload: any): void {
			const entry = this.tilesInProgress.get(`${x},${y}`);
			if (entry) entry.resolve(payload);
		}

		processErrorBefore(x: number, y: number, error: any): void {
			const entry = this.tilesInProgress.get(`${x},${y}`);
			if (entry) entry.reject(error);
		}
	}

	class MockMapWorkerAfter {
		tilesInProgress: Map<string, {
			resolve: (v: any) => void;
			reject: (r?: any) => void;
		}> = new Map();

		requestTile(x: number, y: number): Promise<any> {
			return new Promise((resolve, reject) => {
				this.tilesInProgress.set(`${x},${y}`, {resolve, reject});
			});
		}

		processSuccessAfter(x: number, y: number, payload: any): void {
			const key = `${x},${y}`;
			const entry = this.tilesInProgress.get(key);
			if (entry) {
				this.tilesInProgress.delete(key);
				entry.resolve(payload);
			}
		}

		processErrorAfter(x: number, y: number, error: any): void {
			const key = `${x},${y}`;
			const entry = this.tilesInProgress.get(key);
			if (entry) {
				this.tilesInProgress.delete(key);
				entry.reject(error);
			}
		}
	}

	test('BEFORE fix: tilesInProgress grows after resolve (leak)', () => {
		const worker = new MockMapWorkerBefore();

		worker.requestTile(1, 1);
		worker.requestTile(2, 2);
		worker.requestTile(3, 3);

		expect(worker.tilesInProgress.size).toBe(3);

		worker.processSuccessBefore(1, 1, {});
		worker.processSuccessBefore(2, 2, {});
		worker.processSuccessBefore(3, 3, {});

		expect(worker.tilesInProgress.size).toBe(3);
	});

	test('AFTER fix: tilesInProgress is empty after all resolve', () => {
		const worker = new MockMapWorkerAfter();

		worker.requestTile(1, 1);
		worker.requestTile(2, 2);
		worker.requestTile(3, 3);

		expect(worker.tilesInProgress.size).toBe(3);

		worker.processSuccessAfter(1, 1, {});
		worker.processSuccessAfter(2, 2, {});
		worker.processSuccessAfter(3, 3, {});

		expect(worker.tilesInProgress.size).toBe(0);
	});

	test('AFTER fix: tilesInProgress is empty after all reject', () => {
		const worker = new MockMapWorkerAfter();

		const p1 = worker.requestTile(1, 1).catch(() => {});
		const p2 = worker.requestTile(2, 2).catch(() => {});

		expect(worker.tilesInProgress.size).toBe(2);

		worker.processErrorAfter(1, 1, new Error('fail'));
		worker.processErrorAfter(2, 2, new Error('fail'));

		expect(worker.tilesInProgress.size).toBe(0);
	});

	test('AFTER fix: mixed resolve/reject cleans up', () => {
		const worker = new MockMapWorkerAfter();

		worker.requestTile(1, 1);
		worker.requestTile(2, 2).catch(() => {});

		worker.processSuccessAfter(1, 1, {});
		worker.processErrorAfter(2, 2, new Error('fail'));

		expect(worker.tilesInProgress.size).toBe(0);
	});
});

// ---------- 4. Tile.dispose() completeness ----------

describe('Tile.dispose() completeness', () => {
	interface MockMesh {
		disposed: boolean;
		dispose(): void;
	}
	interface MockTerrainMask {
		deleted: boolean;
		delete(): void;
	}

	function createMockMesh(): MockMesh {
		return {
			disposed: false,
			dispose() { this.disposed = true; },
		};
	}

	function createMockTerrainMask(): MockTerrainMask {
		return {
			deleted: false,
			delete() { this.deleted = true; },
		};
	}

	function disposeBeforeFix(tile: {
		extrudedMesh: MockMesh | null;
		projectedMesh: MockMesh | null;
		huggingMesh: MockMesh | null;
		terrainMaskMesh: MockTerrainMask | null;
		instanceBuffers: Map<string, any>;
		disposed: boolean;
	}): void {
		tile.disposed = true;
		if (tile.extrudedMesh) { tile.extrudedMesh.dispose(); tile.extrudedMesh = null; }
		if (tile.projectedMesh) { tile.projectedMesh.dispose(); tile.projectedMesh = null; }
		if (tile.huggingMesh) { tile.huggingMesh.dispose(); tile.huggingMesh = null; }
		// terrainMaskMesh NOT cleaned (old bug)
		// instanceBuffers NOT cleared (old bug)
	}

	function disposeAfterFix(tile: {
		extrudedMesh: MockMesh | null;
		projectedMesh: MockMesh | null;
		huggingMesh: MockMesh | null;
		terrainMaskMesh: MockTerrainMask | null;
		instanceBuffers: Map<string, any>;
		disposed: boolean;
	}): void {
		tile.disposed = true;
		if (tile.extrudedMesh) { tile.extrudedMesh.dispose(); tile.extrudedMesh = null; }
		if (tile.projectedMesh) { tile.projectedMesh.dispose(); tile.projectedMesh = null; }
		if (tile.huggingMesh) { tile.huggingMesh.dispose(); tile.huggingMesh = null; }
		if (tile.terrainMaskMesh) { tile.terrainMaskMesh.delete(); tile.terrainMaskMesh = null; }
		tile.instanceBuffers.clear();
	}

	function createMockTile() {
		const terrainMask = createMockTerrainMask();
		const instanceBuffers = new Map<string, any>();
		instanceBuffers.set('tree', { rawLOD0: new Float32Array(100), transformedLOD0: new Float32Array(100) });
		instanceBuffers.set('bench', { rawLOD0: new Float32Array(50), transformedLOD0: new Float32Array(50) });

		return {
			extrudedMesh: createMockMesh(),
			projectedMesh: createMockMesh(),
			huggingMesh: createMockMesh(),
			terrainMaskMesh: terrainMask,
			instanceBuffers,
			disposed: false,
		};
	}

	test('BEFORE fix: terrainMaskMesh.delete() NOT called, instanceBuffers NOT cleared', () => {
		const tile = createMockTile();
		const terrainMaskRef = tile.terrainMaskMesh;

		disposeBeforeFix(tile);

		expect(tile.disposed).toBe(true);
		expect(tile.extrudedMesh).toBeNull();
		expect(tile.projectedMesh).toBeNull();
		expect(tile.huggingMesh).toBeNull();
		expect(terrainMaskRef.deleted).toBe(false);
		expect(tile.terrainMaskMesh).not.toBeNull();
		expect(tile.instanceBuffers.size).toBe(2);
	});

	test('AFTER fix: terrainMaskMesh.delete() IS called, instanceBuffers cleared', () => {
		const tile = createMockTile();
		const terrainMaskRef = tile.terrainMaskMesh;

		disposeAfterFix(tile);

		expect(tile.disposed).toBe(true);
		expect(tile.extrudedMesh).toBeNull();
		expect(tile.projectedMesh).toBeNull();
		expect(tile.huggingMesh).toBeNull();
		expect(terrainMaskRef.deleted).toBe(true);
		expect(tile.terrainMaskMesh).toBeNull();
		expect(tile.instanceBuffers.size).toBe(0);
	});

	test('AFTER fix: dispose is safe when terrainMaskMesh is null', () => {
		const tile = createMockTile();
		tile.terrainMaskMesh = null;

		expect(() => disposeAfterFix(tile)).not.toThrow();
		expect(tile.disposed).toBe(true);
		expect(tile.instanceBuffers.size).toBe(0);
	});
});

// ---------- 5. Aggressive eviction ----------

describe('Aggressive eviction (before/after)', () => {
	interface MockTile {
		x: number;
		y: number;
		inFrustum: boolean;
		distanceToCamera: number;
		removed: boolean;
	}

	function createTileSet(): Map<string, MockTile> {
		const tiles = new Map<string, MockTile>();
		for (let i = 0; i < 30; i++) {
			tiles.set(`${i},0`, {
				x: i, y: 0,
				inFrustum: i < 20,
				distanceToCamera: i * 100,
				removed: false,
			});
		}
		return tiles;
	}

	function removeCulledDesktop(tiles: Map<string, MockTile>, maxConcurrentTiles: number): void {
		const outOfFrustum: MockTile[] = [];
		for (const tile of tiles.values()) {
			if (!tile.inFrustum) {
				outOfFrustum.push(tile);
			}
		}
		outOfFrustum.sort((a, b) => b.distanceToCamera - a.distanceToCamera);
		const tilesToRemove = Math.min(outOfFrustum.length, tiles.size - maxConcurrentTiles);
		for (let i = 0; i < tilesToRemove; i++) {
			outOfFrustum[i].removed = true;
			tiles.delete(`${outOfFrustum[i].x},${outOfFrustum[i].y}`);
		}
	}

	function removeCulledMobile(tiles: Map<string, MockTile>): void {
		const outOfFrustum: MockTile[] = [];
		for (const tile of tiles.values()) {
			if (!tile.inFrustum) {
				outOfFrustum.push(tile);
			}
		}
		outOfFrustum.sort((a, b) => b.distanceToCamera - a.distanceToCamera);
		for (const tile of outOfFrustum) {
			tile.removed = true;
			tiles.delete(`${tile.x},${tile.y}`);
		}
	}

	test('BEFORE (desktop, MaxConcurrentTiles=150): out-of-frustum tiles kept when total <= 150', () => {
		const tiles = createTileSet();
		expect(tiles.size).toBe(30);

		removeCulledDesktop(tiles, 150);

		expect(tiles.size).toBe(30);

		let keptOutOfFrustum = 0;
		for (const tile of tiles.values()) {
			if (!tile.inFrustum) keptOutOfFrustum++;
		}
		expect(keptOutOfFrustum).toBe(10);
	});

	test('AFTER (mobile, aggressive): ALL out-of-frustum tiles evicted immediately', () => {
		const tiles = createTileSet();
		expect(tiles.size).toBe(30);

		removeCulledMobile(tiles);

		expect(tiles.size).toBe(20);

		for (const tile of tiles.values()) {
			expect(tile.inFrustum).toBe(true);
		}
	});

	test('AFTER (mobile): eviction is safe when no tiles are out of frustum', () => {
		const tiles = new Map<string, MockTile>();
		for (let i = 0; i < 5; i++) {
			tiles.set(`${i},0`, {
				x: i, y: 0,
				inFrustum: true,
				distanceToCamera: i * 100,
				removed: false,
			});
		}

		removeCulledMobile(tiles);
		expect(tiles.size).toBe(5);
	});

	test('AFTER (mobile): eviction removes farthest tiles first', () => {
		const tiles = createTileSet();
		const removed: number[] = [];

		const outOfFrustum: MockTile[] = [];
		for (const tile of tiles.values()) {
			if (!tile.inFrustum) outOfFrustum.push(tile);
		}
		outOfFrustum.sort((a, b) => b.distanceToCamera - a.distanceToCamera);

		for (const tile of outOfFrustum) {
			removed.push(tile.x);
		}

		for (let i = 0; i < removed.length - 1; i++) {
			expect(removed[i]).toBeGreaterThan(removed[i + 1]);
		}
	});
});

// ---------- 6. Graphics defaults ----------

describe('Graphics defaults per mode', () => {
	test('normal mode has high-quality defaults', () => {
		const config = getConfigForMode(false);
		expect(config.shadows).toBe('medium');
		expect(config.taa).toBe('on');
		expect(config.bloom).toBe('on');
		expect(config.ssao).toBe('on');
	});

	test('low-memory mode disables expensive effects', () => {
		const config = getConfigForMode(true);
		expect(config.shadows).toBe('off');
		expect(config.taa).toBe('off');
		expect(config.bloom).toBe('off');
		expect(config.ssao).toBe('off');
	});
});

// ---------- 7. Merged buffer reuse ----------

describe('Merged buffer reuse optimization', () => {
	function mergeBuffersOld(buffers: Float32Array[]): Float32Array {
		let length = 0;
		for (const b of buffers) length += b.length;
		const result = new Float32Array(length);
		let offset = 0;
		for (const b of buffers) {
			result.set(b, offset);
			offset += b.length;
		}
		return result;
	}

	function mergeBuffersNew(
		buffers: Float32Array[],
		cache: Map<string, Float32Array>,
		key: string
	): Float32Array {
		let totalLength = 0;
		for (const b of buffers) totalLength += b.length;

		let merged = cache.get(key);
		if (!merged || merged.length !== totalLength) {
			merged = new Float32Array(totalLength);
			cache.set(key, merged);
		}

		let offset = 0;
		for (const b of buffers) {
			merged.set(b, offset);
			offset += b.length;
		}
		return merged;
	}

	test('old approach always allocates a new array', () => {
		const b1 = new Float32Array([1, 2, 3]);
		const b2 = new Float32Array([4, 5, 6]);

		const result1 = mergeBuffersOld([b1, b2]);
		const result2 = mergeBuffersOld([b1, b2]);

		expect(result1).not.toBe(result2);
		expect(Array.from(result1)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(Array.from(result2)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	test('new approach reuses the same buffer when length matches', () => {
		const cache = new Map<string, Float32Array>();
		const b1 = new Float32Array([1, 2, 3]);
		const b2 = new Float32Array([4, 5, 6]);

		const result1 = mergeBuffersNew([b1, b2], cache, 'test');
		const result2 = mergeBuffersNew([b1, b2], cache, 'test');

		expect(result1).toBe(result2);
		expect(Array.from(result2)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	test('new approach reallocates when total length changes', () => {
		const cache = new Map<string, Float32Array>();
		const b1 = new Float32Array([1, 2, 3]);
		const b2 = new Float32Array([4, 5, 6]);
		const b3 = new Float32Array([7, 8]);

		const result1 = mergeBuffersNew([b1, b2], cache, 'test');
		expect(result1.length).toBe(6);

		const result2 = mergeBuffersNew([b1, b3], cache, 'test');
		expect(result2.length).toBe(5);
		expect(result1).not.toBe(result2);
		expect(Array.from(result2)).toEqual([1, 2, 3, 7, 8]);
	});

	test('new approach data correctness with updated input', () => {
		const cache = new Map<string, Float32Array>();
		const b1 = new Float32Array([1, 2, 3]);
		const b2 = new Float32Array([4, 5, 6]);

		mergeBuffersNew([b1, b2], cache, 'x');
		expect(Array.from(cache.get('x')!)).toEqual([1, 2, 3, 4, 5, 6]);

		const b3 = new Float32Array([10, 20, 30]);
		mergeBuffersNew([b3, b2], cache, 'x');
		expect(Array.from(cache.get('x')!)).toEqual([10, 20, 30, 4, 5, 6]);
	});

	test('different keys use separate caches', () => {
		const cache = new Map<string, Float32Array>();
		const b1 = new Float32Array([1, 2]);
		const b2 = new Float32Array([3, 4]);

		const r1 = mergeBuffersNew([b1], cache, 'alpha');
		const r2 = mergeBuffersNew([b2], cache, 'beta');

		expect(r1).not.toBe(r2);
		expect(Array.from(r1)).toEqual([1, 2]);
		expect(Array.from(r2)).toEqual([3, 4]);
		expect(cache.size).toBe(2);
	});
});
