import type AbstractAttributeBuffer from '~/lib/renderer/abstract-renderer/AbstractAttributeBuffer';
import MegaBufferAllocator from '~/lib/renderer/MegaBufferAllocator';

function createMockBuffer(initialCapacity: number, bytesPerElement: number): AbstractAttributeBuffer & {
	setSubDataCalls: {data: TypedArray; byteOffset: number}[];
} {
	const setSubDataCalls: {data: TypedArray; byteOffset: number}[] = [];
	let data = new Float32Array(initialCapacity);

	const buffer: AbstractAttributeBuffer & {setSubDataCalls: typeof setSubDataCalls} = {
		get data() {
			return data;
		},
		setData: jest.fn((next: TypedArray) => {
			data = next as Float32Array;
		}),
		setSubData: jest.fn((src: TypedArray, byteOffset: number) => {
			setSubDataCalls.push({data: src, byteOffset});
			const dstElemOffset = byteOffset / bytesPerElement;
			for (let i = 0; i < src.length; i++) {
				data[dstElemOffset + i] = src[i];
			}
		}),
		delete: jest.fn(),
		setSubDataCalls,
	};

	return buffer;
}

describe('MegaBufferAllocator', () => {
	describe('constructor', () => {
		test('throws when buffer is null', () => {
			expect(() => new MegaBufferAllocator(null as unknown as AbstractAttributeBuffer, 16, 4)).toThrow(
				'MegaBufferAllocator requires a valid AbstractAttributeBuffer',
			);
		});

		test('throws when capacity is not positive', () => {
			const buf = createMockBuffer(4, 4);
			expect(() => new MegaBufferAllocator(buf, 0, 4)).toThrow('MegaBufferAllocator capacity must be positive');
		});

		test('throws when bytesPerElement is not positive', () => {
			const buf = createMockBuffer(4, 4);
			expect(() => new MegaBufferAllocator(buf, 16, 0)).toThrow('MegaBufferAllocator bytesPerElement must be positive');
		});
	});

	describe('allocation basics', () => {
		test('first allocation at offset 0, second contiguous, counts match', () => {
			const buf = createMockBuffer(32, 4);
			const alloc = new MegaBufferAllocator(buf, 32, 4);
			const a = alloc.allocate('a', new Float32Array([1, 2, 3]));
			const b = alloc.allocate('b', new Float32Array([4, 5]));
			expect(a).toEqual({offset: 0, count: 3, key: 'a'});
			expect(b).toEqual({offset: 3, count: 2, key: 'b'});
			expect(alloc.getUsed()).toBe(5);
			expect(buf.setSubData).toHaveBeenCalledTimes(2);
			expect(buf.setSubDataCalls[0]).toEqual({data: expect.any(Float32Array), byteOffset: 0});
			expect(buf.setSubDataCalls[1]).toEqual({data: expect.any(Float32Array), byteOffset: 12});
		});
	});

	test('allocate with duplicate key throws', () => {
		const buf = createMockBuffer(16, 4);
		const alloc = new MegaBufferAllocator(buf, 16, 4);
		alloc.allocate('x', new Float32Array([1]));
		expect(() => alloc.allocate('x', new Float32Array([2]))).toThrow(
			'MegaBufferAllocator: slot with key "x" already exists',
		);
	});

	describe('deallocation', () => {
		test('free removes slot and reuses region for next allocation of same size', () => {
			const buf = createMockBuffer(32, 4);
			const alloc = new MegaBufferAllocator(buf, 32, 4);
			alloc.allocate('a', new Float32Array([1, 2]));
			alloc.allocate('b', new Float32Array([3, 4, 5]));
			alloc.free('a');
			expect(alloc.getSlot('a')).toBeUndefined();
			expect(alloc.getFreeRegionCount()).toBeGreaterThanOrEqual(1);
			const c = alloc.allocate('c', new Float32Array([9, 8]));
			expect(c.offset).toBe(0);
			expect(c.count).toBe(2);
		});

		test('free with unknown key throws', () => {
			const buf = createMockBuffer(8, 4);
			const alloc = new MegaBufferAllocator(buf, 8, 4);
			expect(() => alloc.free('missing')).toThrow('MegaBufferAllocator: no slot with key "missing"');
		});
	});

	describe('fragmentation', () => {
		test('gap too small is skipped; allocation extends high-water used', () => {
			const buf = createMockBuffer(64, 4);
			const alloc = new MegaBufferAllocator(buf, 64, 4);
			alloc.allocate('A', new Float32Array([1, 1, 1, 1]));
			alloc.allocate('B', new Float32Array([2, 2]));
			alloc.allocate('C', new Float32Array([3, 3]));
			alloc.free('B');
			expect(alloc.getUsed()).toBe(8);
			const d = alloc.allocate('D', new Float32Array([4, 4, 4, 4]));
			expect(d.offset).toBe(8);
			expect(Array.from(buf.data.slice(0, 4))).toEqual([1, 1, 1, 1]);
			expect(Array.from(buf.data.slice(6, 8))).toEqual([3, 3]);
			expect(Array.from(buf.data.slice(8, 12))).toEqual([4, 4, 4, 4]);
			expect(Array.from(buf.data.slice(4, 6))).toEqual([2, 2]);
		});

		test('allocation fits exact gap', () => {
			const buf = createMockBuffer(64, 4);
			const alloc = new MegaBufferAllocator(buf, 64, 4);
			alloc.allocate('A', new Float32Array(3));
			alloc.allocate('B', new Float32Array(4));
			alloc.allocate('C', new Float32Array(2));
			alloc.free('B');
			const d = alloc.allocate('D', new Float32Array(4));
			expect(d.offset).toBe(3);
			expect(d.count).toBe(4);
		});
	});

	describe('free region splitting', () => {
		test('smaller allocation consumes start of larger free block', () => {
			const buf = createMockBuffer(64, 4);
			const alloc = new MegaBufferAllocator(buf, 64, 4);
			alloc.allocate('big', new Float32Array(10));
			alloc.free('big');
			const small = alloc.allocate('s', new Float32Array(3));
			const rest = alloc.allocate('t', new Float32Array(7));
			expect(small.offset).toBe(0);
			expect(rest.offset).toBe(3);
			expect(alloc.getFreeRegionCount()).toBe(0);
		});
	});

	describe('compaction', () => {
		test('compact packs slots and clears free list', () => {
			const buf = createMockBuffer(64, 4);
			const alloc = new MegaBufferAllocator(buf, 64, 4);
			alloc.allocate('A', new Float32Array([1, 2]));
			alloc.allocate('B', new Float32Array([3, 4, 5]));
			alloc.allocate('C', new Float32Array([6]));
			alloc.free('B');
			expect(alloc.getFreeRegionCount()).toBeGreaterThan(0);
			alloc.compact();
			expect(alloc.getSlot('A')!.offset).toBe(0);
			expect(alloc.getSlot('C')!.offset).toBe(2);
			expect(alloc.getUsed()).toBe(3);
			expect(alloc.getFreeRegionCount()).toBe(0);
		});

		test('compact returns early when there are no free regions', () => {
			const buf = createMockBuffer(16, 4);
			const alloc = new MegaBufferAllocator(buf, 16, 4);
			alloc.allocate('only', new Float32Array([1, 2]));
			const setSubDataMock = buf.setSubData as jest.Mock;
			const setSubDataBefore = setSubDataMock.mock.calls.length;
			alloc.compact();
			expect(setSubDataMock.mock.calls.length).toBe(setSubDataBefore);
			expect(alloc.getUsed()).toBe(2);
		});
	});

	describe('capacity growth', () => {
		test('allocate beyond capacity triggers setData with larger backing store', () => {
			const buf = createMockBuffer(4, 4);
			const alloc = new MegaBufferAllocator(buf, 4, 4);
			alloc.allocate('a', new Float32Array(3));
			alloc.allocate('b', new Float32Array(3));
			expect(buf.setData).toHaveBeenCalled();
			expect(alloc.getCapacity()).toBeGreaterThanOrEqual(6);
			expect(buf.data.length).toBeGreaterThanOrEqual(6);
		});
	});

	describe('edge cases', () => {
		test('zero-length allocation does not advance used or call setSubData', () => {
			const buf = createMockBuffer(8, 4);
			const alloc = new MegaBufferAllocator(buf, 8, 4);
			const z = alloc.allocate('z', new Float32Array(0));
			expect(z).toEqual({offset: 0, count: 0, key: 'z'});
			expect(alloc.getUsed()).toBe(0);
			expect(buf.setSubData).not.toHaveBeenCalled();
		});

		test('many interleaved alloc and free cycles stay consistent', () => {
			const buf = createMockBuffer(256, 4);
			const alloc = new MegaBufferAllocator(buf, 32, 4);
			for (let i = 0; i < 50; i++) {
				const k = `k${i}`;
				alloc.allocate(k, new Float32Array([i]));
				if (i >= 2) {
					alloc.free(`k${i - 2}`);
				}
			}
			expect(alloc.getSlotCount()).toBe(2);
			expect(() => alloc.free('k48')).not.toThrow();
			expect(() => alloc.free('k49')).not.toThrow();
		});

		test('getBuffer returns the injected buffer', () => {
			const buf = createMockBuffer(8, 4);
			const alloc = new MegaBufferAllocator(buf, 8, 4);
			expect(alloc.getBuffer()).toBe(buf);
		});
	});

	describe('multi-attribute coordination', () => {
		test('identical operation sequences on two allocators yield identical offsets', () => {
			const bufPos = createMockBuffer(64, 4);
			const bufUv = createMockBuffer(64, 4);
			const pos = new MegaBufferAllocator(bufPos, 64, 4);
			const uv = new MegaBufferAllocator(bufUv, 64, 4);
			const tileKey = 'tile:12/3456/789';
			pos.allocate(tileKey, new Float32Array(120));
			uv.allocate(tileKey, new Float32Array(120));
			expect(uv.getSlot(tileKey)!.offset).toBe(pos.getSlot(tileKey)!.offset);
			const other = 'tile:12/3456/790';
			pos.allocate(other, new Float32Array(80));
			uv.allocate(other, new Float32Array(80));
			expect(uv.getSlot(other)!.offset).toBe(pos.getSlot(other)!.offset);
		});
	});

	describe('getters', () => {
		test('getSlot returns reference for active key', () => {
			const buf = createMockBuffer(8, 4);
			const alloc = new MegaBufferAllocator(buf, 8, 4);
			const slot = alloc.allocate('p', new Float32Array([7]));
			expect(alloc.getSlot('p')).toBe(slot);
		});

		test('getSlotCount tracks slots including empty', () => {
			const buf = createMockBuffer(8, 4);
			const alloc = new MegaBufferAllocator(buf, 8, 4);
			alloc.allocate('e', new Float32Array(0));
			expect(alloc.getSlotCount()).toBe(1);
		});
	});
});
