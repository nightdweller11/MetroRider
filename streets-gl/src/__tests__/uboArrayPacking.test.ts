import type AbstractRenderer from '~/lib/renderer/abstract-renderer/AbstractRenderer';
import type AbstractAttribute from '~/lib/renderer/abstract-renderer/AbstractAttribute';
import type AbstractAttributeBuffer from '~/lib/renderer/abstract-renderer/AbstractAttributeBuffer';
import type {AbstractAttributeParams} from '~/lib/renderer/abstract-renderer/AbstractAttribute';
import type AbstractMesh from '~/lib/renderer/abstract-renderer/AbstractMesh';
import TileMegaBuffers from '~/lib/renderer/TileMegaBuffers';

const MAX_BATCH_SIZE = 32;
const EXTRUDED_STRIDE_FLOATS = 36;
const EXTRUDED_BYTES_PER_TILE = 144;
const DEPTH_FLOATS_PER_TILE = 16;
const DEPTH_BYTES_PER_TILE = 64;
const UBO_16KB = 16 * 1024;

function stubAttributeBuffer(data: TypedArray): AbstractAttributeBuffer {
	return {
		data,
		setData: () => {},
		setSubData: () => {},
		delete: () => {},
	};
}

function stubAttribute(params: AbstractAttributeParams): AbstractAttribute {
	return {
		name: params.name,
		size: params.size,
		type: params.type,
		format: params.format,
		normalized: params.normalized,
		instanced: params.instanced ?? false,
		divisor: params.divisor ?? 0,
		stride: params.stride ?? 0,
		offset: params.offset ?? 0,
		buffer: params.buffer,
	};
}

function stubMesh(): AbstractMesh {
	return {
		indexed: false,
		indices: new Uint32Array(0),
		instanced: false,
		instanceCount: 0,
		getAttribute: () => {
			throw new Error('getAttribute not implemented in stub');
		},
		addAttribute: () => {},
		setIndices: () => {},
		bind: () => {},
		draw: () => {},
		delete: () => {},
	};
}

function createMockRenderer(): AbstractRenderer {
	return {
		setSize: () => {},
		createTexture2D: () => {
			throw new Error('not implemented');
		},
		createTexture2DArray: () => {
			throw new Error('not implemented');
		},
		createTexture3D: () => {
			throw new Error('not implemented');
		},
		createTextureCube: () => {
			throw new Error('not implemented');
		},
		createRenderPass: () => {
			throw new Error('not implemented');
		},
		createMaterial: () => {
			throw new Error('not implemented');
		},
		createAttributeBuffer: (params) => stubAttributeBuffer(params?.data ?? new Float32Array(0)),
		createAttribute: (params) => stubAttribute(params),
		createMesh: () => stubMesh(),
		beginRenderPass: () => {},
		useMaterial: () => {},
		batchDrawArrays: () => {},
		startTimer: () => {},
		finishTimer: async () => 0,
		fence: async () => {},
		supportsBatchDraw: false,
		rendererInfo: ['mock', 'mock'],
		resolution: {x: 0, y: 0},
	};
}

function makeMat4(seed: number): Float32Array {
	const m = new Float32Array(16);
	for (let i = 0; i < 16; i++) {
		m[i] = seed + i * 0.01;
	}
	return m;
}

describe('UBO array packing (extruded batch)', () => {
	let mega: TileMegaBuffers;

	beforeEach(() => {
		mega = new TileMegaBuffers(createMockRenderer());
	});

	test('extruded TileData stride is 144 bytes (36 floats: 2x mat4 + uint slot through float view)', () => {
		expect(EXTRUDED_STRIDE_FLOATS * 4).toBe(EXTRUDED_BYTES_PER_TILE);
		expect(EXTRUDED_STRIDE_FLOATS).toBe(16 + 16 + 4);
	});

	test('modelViewMatrix starts at float offset 0 of each entry', () => {
		const m0 = makeMat4(1);
		const m1 = makeMat4(100);
		const {buffer} = mega.packExtrudedUBO([
			{modelViewMatrix: m0, modelViewMatrixPrev: m1, tileId: 0},
		]);
		for (let i = 0; i < 16; i++) {
			expect(buffer[i]).toBeCloseTo(m0[i], 6);
		}
	});

	test('modelViewMatrixPrev starts at byte 64 (float offset 16) of each entry', () => {
		const m0 = makeMat4(1);
		const m1 = makeMat4(100);
		const {buffer} = mega.packExtrudedUBO([
			{modelViewMatrix: m0, modelViewMatrixPrev: m1, tileId: 0},
		]);
		for (let i = 0; i < 16; i++) {
			expect(buffer[16 + i]).toBeCloseTo(m1[i], 6);
		}
	});

	test('tileId starts at byte 128 (float offset 32) of each entry', () => {
		const m0 = makeMat4(0);
		const m1 = makeMat4(0);
		const tileId = 0xabcdd00f;
		const uboBytes = mega.packExtrudedUBO([
			{modelViewMatrix: m0, modelViewMatrixPrev: m1, tileId},
		]).buffer.buffer;
		const u32 = new Uint32Array(uboBytes);
		expect(u32[32]).toBe(tileId >>> 0);
	});

	test('packing 1 tile yields byteLength 144', () => {
		const m = makeMat4(0);
		const {byteLength} = mega.packExtrudedUBO([{modelViewMatrix: m, modelViewMatrixPrev: m, tileId: 0}]);
		expect(byteLength).toBe(144);
	});

	test('packing N tiles yields byteLength N * 144', () => {
		const m = makeMat4(0);
		for (const n of [1, 2, 5, 17, 31]) {
			const tiles = Array.from({length: n}, () => ({
				modelViewMatrix: m,
				modelViewMatrixPrev: m,
				tileId: 0,
			}));
			expect(mega.packExtrudedUBO(tiles).byteLength).toBe(n * EXTRUDED_BYTES_PER_TILE);
		}
	});

	test('tile i packed at byte offset i * 144 (float base i * 36)', () => {
		const tiles = [0, 1, 2].map((i) => ({
			modelViewMatrix: makeMat4(i * 1000),
			modelViewMatrixPrev: makeMat4(i * 2000),
			tileId: 100 + i,
		}));
		const {buffer} = mega.packExtrudedUBO(tiles);
		for (let i = 0; i < 3; i++) {
			const base = i * EXTRUDED_STRIDE_FLOATS;
			for (let k = 0; k < 16; k++) {
				expect(buffer[base + k]).toBeCloseTo(tiles[i].modelViewMatrix[k], 5);
				expect(buffer[base + 16 + k]).toBeCloseTo(tiles[i].modelViewMatrixPrev[k], 5);
			}
			expect(new Uint32Array(buffer.buffer)[base + 32]).toBe(tiles[i].tileId >>> 0);
		}
	});

	test('gl_DrawID 0 vs 1 map to first and second tile regions', () => {
		const a = makeMat4(1);
		const b = makeMat4(2);
		const c = makeMat4(3);
		const d = makeMat4(4);
		const {buffer} = mega.packExtrudedUBO([
			{modelViewMatrix: a, modelViewMatrixPrev: b, tileId: 11},
			{modelViewMatrix: c, modelViewMatrixPrev: d, tileId: 22},
		]);
		const drawId = (id: number) => id * EXTRUDED_STRIDE_FLOATS;
		expect(buffer[drawId(0)]).toBeCloseTo(a[0], 6);
		expect(buffer[drawId(0) + 16]).toBeCloseTo(b[0], 6);
		expect(buffer[drawId(1)]).toBeCloseTo(c[0], 6);
		expect(buffer[drawId(1) + 16]).toBeCloseTo(d[0], 6);
	});

	test('32 tiles use 4608 bytes, below 16KB UBO limit', () => {
		const m = makeMat4(0);
		const tiles = Array.from({length: MAX_BATCH_SIZE}, (_, i) => ({
			modelViewMatrix: m,
			modelViewMatrixPrev: m,
			tileId: i,
		}));
		const {byteLength} = mega.packExtrudedUBO(tiles);
		expect(byteLength).toBe(MAX_BATCH_SIZE * EXTRUDED_BYTES_PER_TILE);
		expect(byteLength).toBe(4608);
		expect(byteLength).toBeLessThanOrEqual(UBO_16KB);
	});

	test('packed matrix floats match inputs', () => {
		const mv = makeMat4(42);
		const mvPrev = makeMat4(99);
		const {buffer} = mega.packExtrudedUBO([{modelViewMatrix: mv, modelViewMatrixPrev: mvPrev, tileId: 7}]);
		expect(Array.from(buffer.subarray(0, 16))).toEqual(Array.from(mv));
		expect(Array.from(buffer.subarray(16, 32))).toEqual(Array.from(mvPrev));
	});

	test('repeated packExtrudedUBO calls reuse the same ArrayBuffer', () => {
		const m = makeMat4(0);
		const r1 = mega.packExtrudedUBO([{modelViewMatrix: m, modelViewMatrixPrev: m, tileId: 1}]);
		const r2 = mega.packExtrudedUBO([{modelViewMatrix: m, modelViewMatrixPrev: m, tileId: 2}]);
		expect(r1.buffer.buffer).toBe(r2.buffer.buffer);
	});

	test('packed tileId matches input for several tiles', () => {
		const m = makeMat4(0);
		const ids = [0, 1, 0xffffffff, 0x7fffffff];
		const tiles = ids.map((tileId) => ({modelViewMatrix: m, modelViewMatrixPrev: m, tileId}));
		const {buffer} = mega.packExtrudedUBO(tiles);
		const u32 = new Uint32Array(buffer.buffer);
		ids.forEach((tileId, i) => {
			expect(u32[i * EXTRUDED_STRIDE_FLOATS + 32]).toBe(tileId >>> 0);
		});
	});
});

describe('UBO array packing (depth / buildingDepth)', () => {
	let mega: TileMegaBuffers;

	beforeEach(() => {
		mega = new TileMegaBuffers(createMockRenderer());
	});

	test('depth TileData is 64 bytes (16 floats, one mat4 per draw)', () => {
		expect(DEPTH_FLOATS_PER_TILE * 4).toBe(DEPTH_BYTES_PER_TILE);
	});

	test('packDepthUBO uses 64-byte stride and reported byteLength', () => {
		const m0 = makeMat4(1);
		expect(mega.packDepthUBO([m0]).byteLength).toBe(64);
		const m1 = makeMat4(2);
		expect(mega.packDepthUBO([m0, m1]).byteLength).toBe(128);
	});

	test('packDepthUBO places matrix i at float offset i * 16', () => {
		const matrices = [makeMat4(10), makeMat4(20), makeMat4(30)];
		const {buffer} = mega.packDepthUBO(matrices);
		matrices.forEach((mat, i) => {
			const base = i * DEPTH_FLOATS_PER_TILE;
			expect(Array.from(buffer.subarray(base, base + 16))).toEqual(Array.from(mat));
		});
	});

	test('repeated packDepthUBO calls reuse the same ArrayBuffer', () => {
		const m = makeMat4(0);
		const r1 = mega.packDepthUBO([m]);
		const r2 = mega.packDepthUBO([makeMat4(1)]);
		expect(r1.buffer.buffer).toBe(r2.buffer.buffer);
	});
});
