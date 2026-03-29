jest.mock('~/app/objects/TileLabelBuffers', () => ({
	__esModule: true,
	default: class TileLabelBuffersMock {
		public constructor(_params: unknown) {}
	}
}));

import AbstractRenderer from '~/lib/renderer/abstract-renderer/AbstractRenderer';
import AbstractAttributeBuffer, {
	AbstractAttributeBufferParams
} from '~/lib/renderer/abstract-renderer/AbstractAttributeBuffer';
import AbstractMesh, {AbstractMeshParams} from '~/lib/renderer/abstract-renderer/AbstractMesh';
import AbstractAttribute, {AbstractAttributeParams} from '~/lib/renderer/abstract-renderer/AbstractAttribute';
import TileMegaBuffers, {TileSlotSet} from '~/lib/renderer/TileMegaBuffers';
import {BufferSlot} from '~/lib/renderer/MegaBufferAllocator';
import Tile from '~/app/objects/Tile';
import Tile3DBuffers from '~/lib/tile-processing/tile3d/buffers/Tile3DBuffers';
type TypedArray = Float32Array | Uint8Array | Uint32Array | Int32Array;

function createMockAttributeBuffer(initialData?: TypedArray): AbstractAttributeBuffer {
	const buf = {
		data: initialData ?? new Float32Array(0),
		setData: jest.fn((data: TypedArray) => {
			buf.data = data;
		}),
		setSubData: jest.fn((data: TypedArray, byteOffset: number) => {
			const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			const dst = new Uint8Array(buf.data.buffer, buf.data.byteOffset + byteOffset, src.byteLength);
			dst.set(src);
		}),
		delete: jest.fn()
	};
	return buf;
}

function createMockMesh(params: AbstractMeshParams): AbstractMesh {
	const attrs = params.attributes ?? [];
	const byName = new Map<string, AbstractAttribute>(attrs.map(a => [a.name, a]));
	return {
		indexed: false,
		indices: null,
		instanced: false,
		instanceCount: 0,
		getAttribute: (name: string) => {
			const a = byName.get(name);
			if (!a) {
				throw new Error(`createMockMesh: missing attribute "${name}"`);
			}
			return a;
		},
		addAttribute: jest.fn(),
		setIndices: jest.fn(),
		bind: jest.fn(),
		draw: jest.fn(),
		delete: jest.fn()
	};
}

function createMockRenderer(): AbstractRenderer {
	const createAttributeBuffer = jest.fn((params?: AbstractAttributeBufferParams) => {
		return createMockAttributeBuffer(params?.data as TypedArray | undefined);
	});

	const createAttribute = jest.fn((params: AbstractAttributeParams): AbstractAttribute => ({
		name: params.name,
		size: params.size,
		type: params.type,
		format: params.format,
		normalized: params.normalized,
		instanced: params.instanced ?? false,
		divisor: params.divisor ?? 0,
		stride: params.stride ?? 0,
		offset: params.offset ?? 0,
		buffer: params.buffer
	}));

	const createMesh = jest.fn((params: AbstractMeshParams) => createMockMesh(params));

	const noop = jest.fn();

	return {
		setSize: noop,
		createTexture2D: noop,
		createTexture2DArray: noop,
		createTexture3D: noop,
		createTextureCube: noop,
		createRenderPass: noop,
		createMaterial: noop,
		createAttribute,
		createAttributeBuffer,
		createMesh,
		beginRenderPass: noop,
		useMaterial: noop,
		batchDrawArrays: noop,
		startTimer: noop,
		finishTimer: async () => 0,
		fence: async () => {},
		supportsBatchDraw: true,
		rendererInfo: ['mock', 'mock'],
		resolution: {x: 800, y: 600}
	} as unknown as AbstractRenderer;
}

const bbox = {minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1};

function makeTile3DBuffers(exV: number, projV: number, hugV: number): Tile3DBuffers {
	const extrudedPosition = new Float32Array(exV * 3);
	const extrudedNormal = new Float32Array(exV * 3);
	const extrudedUv = new Float32Array(exV * 2);
	const extrudedColor = new Uint8Array(exV * 3);
	const extrudedTextureId = new Uint8Array(exV);
	const extrudedLocalId = new Uint32Array(exV);
	const idBuffer = new Uint32Array(2);
	const offsetBuffer = new Uint32Array(2);
	idBuffer[0] = 0;
	idBuffer[1] = 0;
	offsetBuffer[0] = 0;
	offsetBuffer[1] = exV;

	const projectedPosition = new Float32Array(projV * 3);
	const projectedNormal = new Float32Array(projV * 3);
	const projectedUv = new Float32Array(projV * 2);
	const projectedTextureId = new Uint8Array(projV);

	const huggingPosition = new Float32Array(hugV * 3);
	const huggingNormal = new Float32Array(hugV * 3);
	const huggingUv = new Float32Array(hugV * 2);
	const huggingTextureId = new Uint8Array(hugV);

	return {
		extruded: {
			positionBuffer: extrudedPosition,
			uvBuffer: extrudedUv,
			normalBuffer: extrudedNormal,
			textureIdBuffer: extrudedTextureId,
			colorBuffer: extrudedColor,
			idBuffer,
			offsetBuffer,
			localIdBuffer: extrudedLocalId,
			boundingBox: bbox
		},
		projected: {
			positionBuffer: projectedPosition,
			normalBuffer: projectedNormal,
			uvBuffer: projectedUv,
			textureIdBuffer: projectedTextureId,
			boundingBox: bbox
		},
		hugging: {
			positionBuffer: huggingPosition,
			normalBuffer: huggingNormal,
			uvBuffer: huggingUv,
			textureIdBuffer: huggingTextureId,
			boundingBox: bbox
		},
		terrainMask: {positionBuffer: new Float32Array(0)},
		labels: {
			position: new Float32Array(0),
			priority: new Float32Array(0),
			text: [],
			boundingBox: bbox
		},
		instances: {}
	};
}

function slotsOverlap(a: BufferSlot, b: BufferSlot): boolean {
	const aEnd = a.offset + a.count;
	const bEnd = b.offset + b.count;
	return a.offset < bEnd && b.offset < aEnd;
}

describe('TileMegaBuffers / MegaBufferAllocator integration', () => {
	test('allocateTile registers slots on each group allocator', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const key = '0,0';
		const pos = new Float32Array(9);
		const buffers: Record<string, TypedArray> = {
			position: pos,
			normal: new Float32Array(9),
			color: new Uint8Array(9),
			uv: new Float32Array(6),
			textureId: new Uint8Array(3),
			localId: new Uint32Array(3),
			display: new Uint8Array(3)
		};

		const slotSet = mega.allocateTile(mega.extruded, key, buffers);

		for (const name of Object.keys(buffers)) {
			const alloc = mega.extruded.allocators.get(name);
			expect(alloc.getSlot(key)).toBeDefined();
			expect(slotSet.slots.get(name)).toBe(alloc.getSlot(key));
		}
	});

	test('allocated position slot offset matches allocator getSlot', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const key = '1,1';
		const position = new Float32Array(12);
		const slotSet = mega.allocateTile(mega.extruded, key, {
			position,
			normal: new Float32Array(12),
			color: new Uint8Array(12),
			uv: new Float32Array(8),
			textureId: new Uint8Array(4),
			localId: new Uint32Array(4),
			display: new Uint8Array(4)
		});

		const allocator = mega.extruded.allocators.get('position');
		const fromAllocator = allocator.getSlot(key);
		const fromSet = slotSet.slots.get('position');

		expect(fromSet.offset).toBe(fromAllocator.offset);
		expect(fromSet.count).toBe(fromAllocator.count);
	});

	test('slot element count matches source typed array length', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const key = 'k';
		const vertexCount = 5;
		const position = new Float32Array(vertexCount * 3);

		mega.allocateTile(mega.projected, key, {
			position,
			normal: new Float32Array(vertexCount * 3),
			uv: new Float32Array(vertexCount * 2),
			textureId: new Uint8Array(vertexCount)
		});

		const posSlot = mega.projected.allocators.get('position').getSlot(key);
		expect(posSlot.count).toBe(position.length);
		expect(posSlot.count / 3).toBe(vertexCount);
	});

	test('freeTile removes slots from allocators', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const key = '2,2';
		mega.allocateTile(mega.extruded, key, {
			position: new Float32Array(6),
			normal: new Float32Array(6),
			color: new Uint8Array(6),
			uv: new Float32Array(4),
			textureId: new Uint8Array(2),
			localId: new Uint32Array(2),
			display: new Uint8Array(2)
		});

		mega.freeTile(mega.extruded, key);

		for (const allocator of mega.extruded.allocators.values()) {
			expect(allocator.getSlot(key)).toBeUndefined();
		}
	});

	test('after free, a new allocation with same size reuses the freed offset', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const keyA = 'a';
		const keyB = 'b';
		const len = 15;
		const dataA = new Float32Array(len);

		mega.allocateTile(mega.extruded, keyA, {
			position: dataA,
			normal: new Float32Array(len),
			color: new Uint8Array(len),
			uv: new Float32Array((len / 3) * 2),
			textureId: new Uint8Array(len / 3),
			localId: new Uint32Array(len / 3),
			display: new Uint8Array(len / 3)
		});

		const freedOffset = mega.extruded.allocators.get('position').getSlot(keyA).offset;
		mega.freeTile(mega.extruded, keyA);

		mega.allocateTile(mega.extruded, keyB, {
			position: new Float32Array(len),
			normal: new Float32Array(len),
			color: new Uint8Array(len),
			uv: new Float32Array((len / 3) * 2),
			textureId: new Uint8Array(len / 3),
			localId: new Uint32Array(len / 3),
			display: new Uint8Array(len / 3)
		});

		expect(mega.extruded.allocators.get('position').getSlot(keyB).offset).toBe(freedOffset);
	});

	test('five tiles get pairwise non-overlapping position regions', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const slots: BufferSlot[] = [];

		for (let i = 0; i < 5; i++) {
			const key = `t${i}`;
			mega.allocateTile(mega.extruded, key, {
				position: new Float32Array(9),
				normal: new Float32Array(9),
				color: new Uint8Array(9),
				uv: new Float32Array(6),
				textureId: new Uint8Array(3),
				localId: new Uint32Array(3),
				display: new Uint8Array(3)
			});
			slots.push(mega.extruded.allocators.get('position').getSlot(key));
		}

		for (let i = 0; i < slots.length; i++) {
			for (let j = i + 1; j < slots.length; j++) {
				expect(slotsOverlap(slots[i], slots[j])).toBe(false);
			}
		}
	});

	test('disposing middle tile frees a gap that the next allocation fills', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const keys = ['m0', 'm1', 'm2'];
		const makeBuffers = () => ({
			position: new Float32Array(9),
			normal: new Float32Array(9),
			color: new Uint8Array(9),
			uv: new Float32Array(6),
			textureId: new Uint8Array(3),
			localId: new Uint32Array(3),
			display: new Uint8Array(3)
		});

		for (const k of keys) {
			mega.allocateTile(mega.extruded, k, makeBuffers());
		}

		const middleOffset = mega.extruded.allocators.get('position').getSlot('m1').offset;
		mega.freeTile(mega.extruded, 'm1');

		mega.allocateTile(mega.extruded, 'm3', makeBuffers());
		expect(mega.extruded.allocators.get('position').getSlot('m3').offset).toBe(middleOffset);
	});

	test('buildBatchParams fills firsts and counts from position slots (vertex units)', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);

		const mkSlotSet = (offsetFloats: number, floatCount: number): TileSlotSet => ({
			slots: new Map<string, BufferSlot>([
				[
					'position',
					{offset: offsetFloats, count: floatCount, key: 'x'}
				]
			])
		});

		const a = mkSlotSet(0, 9);
		const b = mkSlotSet(30, 6);
		const {firsts, counts, drawCount} = mega.buildBatchParams([a, b], 'position');

		expect(drawCount).toBe(2);
		expect(firsts[0]).toBe(0);
		expect(counts[0]).toBe(3);
		expect(firsts[1]).toBe(10);
		expect(counts[1]).toBe(2);
	});

	test('buildBatchParams drawCount equals passed slot set count (capped at 32)', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const emptySlot: TileSlotSet = {slots: new Map()};

		const three = [emptySlot, emptySlot, emptySlot];
		expect(mega.buildBatchParams(three).drawCount).toBe(3);

		const many = Array.from({length: 40}, () => emptySlot);
		expect(mega.buildBatchParams(many).drawCount).toBe(32);
	});
});

describe('shared mesh uses mega-buffer attribute buffers', () => {
	test('each extruded shared mesh attribute buffer matches the allocator for that name', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const createMesh = renderer.createMesh as jest.MockedFunction<
			typeof renderer.createMesh
		>;

		const extrudedMeshCall = createMesh.mock.calls.find(
			([params]) => (params.attributes?.length ?? 0) === 7
		);
		expect(extrudedMeshCall).toBeDefined();
		const params = extrudedMeshCall![0];

		for (const attr of params.attributes ?? []) {
			const allocator = mega.extruded.allocators.get(attr.name);
			expect(allocator).toBeDefined();
			expect(attr.buffer).toBe(allocator!.getBuffer());
		}
	});
});

describe('Tile load / dispose with TileMegaBuffers', () => {
	test('load sets slot sets; dispose clears them and frees allocators', () => {
		const renderer = createMockRenderer();
		const mega = new TileMegaBuffers(renderer);
		const tile = new Tile(4, 5);
		const buffers = makeTile3DBuffers(3, 2, 2);
		const key = '4,5';

		tile.load(buffers, mega);

		expect(tile.extrudedSlot).not.toBeNull();
		expect(tile.projectedSlot).not.toBeNull();
		expect(tile.huggingSlot).not.toBeNull();
		expect(mega.extruded.allocators.get('position').getSlot(key)).toBeDefined();
		expect(mega.projected.allocators.get('position').getSlot(`${key}:proj`)).toBeDefined();
		expect(mega.hugging.allocators.get('position').getSlot(`${key}:hug`)).toBeDefined();

		tile.dispose(mega);

		expect(tile.extrudedSlot).toBeNull();
		expect(tile.projectedSlot).toBeNull();
		expect(tile.huggingSlot).toBeNull();
		expect(mega.extruded.allocators.get('position').getSlot(key)).toBeUndefined();
		expect(mega.projected.allocators.get('position').getSlot(`${key}:proj`)).toBeUndefined();
		expect(mega.hugging.allocators.get('position').getSlot(`${key}:hug`)).toBeUndefined();
	});
});
