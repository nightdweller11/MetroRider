import AbstractAttributeBuffer from "~/lib/renderer/abstract-renderer/AbstractAttributeBuffer";

export interface BufferSlot {
	offset: number;
	count: number;
	key: string;
}

interface FreeRegion {
	offset: number;
	count: number;
}

export default class MegaBufferAllocator {
	private readonly buffer: AbstractAttributeBuffer;
	private readonly bytesPerElement: number;
	private readonly slots: Map<string, BufferSlot> = new Map();
	private readonly freeList: FreeRegion[] = [];
	private capacity: number;
	private readonly initialCapacity: number;
	private used: number = 0;

	public constructor(buffer: AbstractAttributeBuffer, capacity: number, bytesPerElement: number) {
		if (!buffer) {
			throw new Error('MegaBufferAllocator requires a valid AbstractAttributeBuffer');
		}
		if (capacity <= 0) {
			throw new Error('MegaBufferAllocator capacity must be positive');
		}
		if (bytesPerElement <= 0) {
			throw new Error('MegaBufferAllocator bytesPerElement must be positive');
		}

		this.buffer = buffer;
		this.capacity = capacity;
		this.initialCapacity = capacity;
		this.bytesPerElement = bytesPerElement;
	}

	public allocate(key: string, data: TypedArray): BufferSlot {
		if (this.slots.has(key)) {
			throw new Error(`MegaBufferAllocator: slot with key "${key}" already exists`);
		}

		const count = data.length;

		if (count === 0) {
			const slot: BufferSlot = {offset: 0, count: 0, key};
			this.slots.set(key, slot);
			return slot;
		}

		const freeIdx = this.findFreeRegion(count);

		let offset: number;
		if (freeIdx >= 0) {
			const region = this.freeList[freeIdx];
			offset = region.offset;

			if (region.count > count) {
				region.offset += count;
				region.count -= count;
			} else {
				this.freeList.splice(freeIdx, 1);
			}
		} else {
			if (this.used + count > this.capacity) {
				this.grow(Math.max(this.capacity * 2, this.used + count));
			}
			offset = this.used;
			this.used += count;
		}

		const byteOffset = offset * this.bytesPerElement;
		this.buffer.setSubData(data, byteOffset);

		const slot: BufferSlot = {offset, count, key};
		this.slots.set(key, slot);
		return slot;
	}

	public free(key: string): void {
		const slot = this.slots.get(key);
		if (!slot) {
			throw new Error(`MegaBufferAllocator: no slot with key "${key}"`);
		}

		this.slots.delete(key);

		if (slot.count === 0) {
			return;
		}

		this.freeList.push({offset: slot.offset, count: slot.count});
		this.mergeFreeRegions();
	}

	public getSlot(key: string): BufferSlot | undefined {
		return this.slots.get(key);
	}

	public getBuffer(): AbstractAttributeBuffer {
		return this.buffer;
	}

	public getCapacity(): number {
		return this.capacity;
	}

	public getUsed(): number {
		return this.used;
	}

	public getSlotCount(): number {
		return this.slots.size;
	}

	public getFreeRegionCount(): number {
		return this.freeList.length;
	}

	/** Total elements currently held by live slots. */
	public getLiveCount(): number {
		let sum = 0;
		for (const slot of this.slots.values()) {
			sum += slot.count;
		}
		return sum;
	}

	/**
	 * Periodic upkeep: compacts when fragmentation is significant, then shrinks
	 * the backing buffer when it is far larger than what is live. Without this,
	 * `used` only ever grows (frees just punch holes) and every overflow DOUBLES
	 * the buffer — both CPU mirror and GPU copy — for the rest of the session.
	 */
	public maintain(): boolean {
		const live = this.getLiveCount();
		const wasted = this.used - live;

		let didWork = false;

		if (wasted > Math.max(live * 0.5, this.initialCapacity / 4)) {
			this.compact();
			didWork = true;
		}

		const shrinkThreshold = Math.max(this.initialCapacity, this.used * 2);
		if (this.capacity > shrinkThreshold) {
			this.shrink(Math.max(this.initialCapacity, Math.ceil(this.used * 1.5)));
			didWork = true;
		}

		return didWork;
	}

	private shrink(newCapacity: number): void {
		if (newCapacity >= this.capacity) return;

		const oldData = this.buffer.data;
		const Constructor = oldData ? (oldData.constructor as any) : Float32Array;
		const newData = new Constructor(newCapacity);

		if (oldData && this.used > 0) {
			newData.set(oldData.subarray(0, Math.min(this.used, newCapacity)));
		}

		// setData reuses the same WebGLBuffer object, so existing VAOs stay valid.
		this.buffer.setData(newData);
		this.capacity = newCapacity;
	}

	public compact(): void {
		if (this.freeList.length === 0) {
			return;
		}

		const sortedSlots = Array.from(this.slots.values())
			.filter(s => s.count > 0)
			.sort((a, b) => a.offset - b.offset);

		let writeOffset = 0;
		for (const slot of sortedSlots) {
			if (slot.offset !== writeOffset) {
				const byteOffsetSrc = slot.offset * this.bytesPerElement;
				const byteOffsetDst = writeOffset * this.bytesPerElement;
				const byteLength = slot.count * this.bytesPerElement;

				const tempData = new Uint8Array(byteLength);
				const srcData = this.buffer.data;
				if (srcData) {
					const srcView = new Uint8Array(srcData.buffer, srcData.byteOffset + byteOffsetSrc, byteLength);
					tempData.set(srcView);
					this.buffer.setSubData(tempData, byteOffsetDst);
				}

				slot.offset = writeOffset;
			}
			writeOffset += slot.count;
		}

		this.used = writeOffset;
		this.freeList.length = 0;
	}

	private findFreeRegion(count: number): number {
		let bestIdx = -1;
		let bestSize = Infinity;

		for (let i = 0; i < this.freeList.length; i++) {
			const region = this.freeList[i];
			if (region.count >= count && region.count < bestSize) {
				bestIdx = i;
				bestSize = region.count;
			}
		}

		return bestIdx;
	}

	private mergeFreeRegions(): void {
		if (this.freeList.length < 2) {
			return;
		}

		this.freeList.sort((a, b) => a.offset - b.offset);

		let i = 0;
		while (i < this.freeList.length - 1) {
			const current = this.freeList[i];
			const next = this.freeList[i + 1];

			if (current.offset + current.count === next.offset) {
				current.count += next.count;
				this.freeList.splice(i + 1, 1);
			} else {
				i++;
			}
		}
	}

	private grow(newCapacity: number): void {
		const oldData = this.buffer.data;
		const Constructor = oldData ? (oldData.constructor as any) : Float32Array;
		const newData = new Constructor(newCapacity);

		if (oldData && oldData.length > 0) {
			newData.set(oldData);
		}

		this.buffer.setData(newData);
		this.capacity = newCapacity;
	}
}
