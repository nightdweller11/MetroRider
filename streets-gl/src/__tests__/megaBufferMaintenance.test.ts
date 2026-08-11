/**
 * Mega-buffer memory upkeep: compaction reclaims fragmentation, shrink
 * returns over-grown buffers to sane sizes. Without maintain(), `used`
 * only ever grows and every overflow doubles the buffer for the session.
 */
import MegaBufferAllocator from '~/lib/renderer/MegaBufferAllocator';

function createMockBuffer(initial: TypedArray): any {
	return {
		data: initial,
		setData(data: TypedArray): void {
			this.data = data;
		},
		setSubData(data: TypedArray, byteOffset: number): void {
			const dst = new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength);
			const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			dst.set(src, byteOffset);
		},
		bind(): void {/* noop */},
		unbind(): void {/* noop */},
		delete(): void {/* noop */},
	};
}

describe('MegaBufferAllocator.maintain', () => {
	test('compacts when fragmentation is significant', () => {
		const capacity = 1000;
		const alloc = new MegaBufferAllocator(createMockBuffer(new Float32Array(capacity)), capacity, 4);

		// Fill with alternating slots, then free every other one.
		for (let i = 0; i < 8; i++) {
			alloc.allocate(`t${i}`, new Float32Array(100).fill(i + 1));
		}
		for (let i = 0; i < 8; i += 2) {
			alloc.free(`t${i}`);
		}

		expect(alloc.getUsed()).toBe(800);
		expect(alloc.getLiveCount()).toBe(400);

		const didWork = alloc.maintain();

		expect(didWork).toBe(true);
		expect(alloc.getUsed()).toBe(400);
		expect(alloc.getFreeRegionCount()).toBe(0);

		// Surviving slot data is intact after the move.
		const buf = alloc.getBuffer().data as Float32Array;
		const slot = alloc.getSlot('t1');
		for (let i = slot.offset; i < slot.offset + slot.count; i++) {
			expect(buf[i]).toBe(2);
		}
	});

	test('shrinks a buffer that grew far beyond what is live', () => {
		const capacity = 100;
		const buffer = createMockBuffer(new Float32Array(capacity));
		const alloc = new MegaBufferAllocator(buffer, capacity, 4);

		// Force several doublings.
		alloc.allocate('big', new Float32Array(1000).fill(7));
		expect(alloc.getCapacity()).toBeGreaterThanOrEqual(1000);

		alloc.free('big');
		alloc.allocate('small', new Float32Array(10).fill(3));

		alloc.maintain();

		// Back near the initial capacity, data intact.
		expect(alloc.getCapacity()).toBeLessThanOrEqual(200);
		const slot = alloc.getSlot('small');
		const buf = alloc.getBuffer().data as Float32Array;
		expect(buf[slot.offset]).toBe(3);
	});

	test('does nothing when healthy', () => {
		const capacity = 1000;
		const alloc = new MegaBufferAllocator(createMockBuffer(new Float32Array(capacity)), capacity, 4);
		alloc.allocate('a', new Float32Array(500));

		expect(alloc.maintain()).toBe(false);
		expect(alloc.getCapacity()).toBe(capacity);
		expect(alloc.getUsed()).toBe(500);
	});
});
