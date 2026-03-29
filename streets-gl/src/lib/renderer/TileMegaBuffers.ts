import MegaBufferAllocator, {BufferSlot} from "~/lib/renderer/MegaBufferAllocator";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import AbstractMesh from "~/lib/renderer/abstract-renderer/AbstractMesh";
import {RendererTypes} from "~/lib/renderer/RendererTypes";

const INITIAL_CAPACITY = 500000;
const MAX_BATCH_SIZE = 32;

export interface TileMegaBufferGroup {
	allocators: Map<string, MegaBufferAllocator>;
	sharedMesh: AbstractMesh;
}

export interface TileSlotSet {
	slots: Map<string, BufferSlot>;
}

export default class TileMegaBuffers {
	private readonly renderer: AbstractRenderer;
	public readonly extruded: TileMegaBufferGroup;
	public readonly projected: TileMegaBufferGroup;
	public readonly hugging: TileMegaBufferGroup;

	private readonly _batchFirsts: Int32Array = new Int32Array(MAX_BATCH_SIZE);
	private readonly _batchCounts: Int32Array = new Int32Array(MAX_BATCH_SIZE);

	private readonly _extrudedUBOBuffer: ArrayBuffer = new ArrayBuffer(MAX_BATCH_SIZE * 144);
	private readonly _extrudedUBOView: Float32Array = new Float32Array(this._extrudedUBOBuffer);
	private readonly _extrudedUBOUintView: Uint32Array = new Uint32Array(this._extrudedUBOBuffer);

	private readonly _depthUBOBuffer: ArrayBuffer = new ArrayBuffer(MAX_BATCH_SIZE * 64);
	private readonly _depthUBOView: Float32Array = new Float32Array(this._depthUBOBuffer);

	public constructor(renderer: AbstractRenderer) {
		this.renderer = renderer;

		this.extruded = this.createGroup([
			{name: 'position', size: 3, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'normal', size: 3, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'color', size: 3, type: RendererTypes.AttributeType.UnsignedByte, format: RendererTypes.AttributeFormat.Float, bpe: 1, normalized: true},
			{name: 'uv', size: 2, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'textureId', size: 1, type: RendererTypes.AttributeType.UnsignedByte, format: RendererTypes.AttributeFormat.Integer, bpe: 1},
			{name: 'localId', size: 1, type: RendererTypes.AttributeType.UnsignedInt, format: RendererTypes.AttributeFormat.Integer, bpe: 4},
			{name: 'display', size: 1, type: RendererTypes.AttributeType.UnsignedByte, format: RendererTypes.AttributeFormat.Integer, bpe: 1},
		]);

		this.projected = this.createGroup([
			{name: 'position', size: 3, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'normal', size: 3, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'uv', size: 2, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'textureId', size: 1, type: RendererTypes.AttributeType.UnsignedByte, format: RendererTypes.AttributeFormat.Integer, bpe: 1},
		]);

		this.hugging = this.createGroup([
			{name: 'position', size: 3, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'normal', size: 3, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'uv', size: 2, type: RendererTypes.AttributeType.Float32, format: RendererTypes.AttributeFormat.Float, bpe: 4},
			{name: 'textureId', size: 1, type: RendererTypes.AttributeType.UnsignedByte, format: RendererTypes.AttributeFormat.Integer, bpe: 1},
		]);
	}

	private createGroup(attrDefs: Array<{
		name: string;
		size: number;
		type: RendererTypes.AttributeType;
		format: RendererTypes.AttributeFormat;
		bpe: number;
		normalized?: boolean;
	}>): TileMegaBufferGroup {
		const allocators = new Map<string, MegaBufferAllocator>();
		const attributes = [];

		for (const def of attrDefs) {
			const elemCount = INITIAL_CAPACITY * def.size;
			const bufferData = def.bpe === 4
				? new Float32Array(elemCount)
				: new Uint8Array(elemCount);

			const attrBuffer = this.renderer.createAttributeBuffer({
				usage: RendererTypes.BufferUsage.DynamicDraw,
				data: bufferData
			});

			const allocator = new MegaBufferAllocator(attrBuffer, INITIAL_CAPACITY * def.size, def.bpe);
			allocators.set(def.name, allocator);

			attributes.push(this.renderer.createAttribute({
				name: def.name,
				size: def.size,
				type: def.type,
				format: def.format,
				normalized: def.normalized ?? false,
				buffer: attrBuffer,
			}));
		}

		const sharedMesh = this.renderer.createMesh({attributes});

		return {allocators, sharedMesh};
	}

	public allocateTile(
		group: TileMegaBufferGroup,
		key: string,
		buffers: Record<string, TypedArray>
	): TileSlotSet {
		const slots = new Map<string, BufferSlot>();

		for (const [attrName, allocator] of group.allocators) {
			const data = buffers[attrName];
			if (data) {
				slots.set(attrName, allocator.allocate(key, data));
			}
		}

		return {slots};
	}

	public freeTile(group: TileMegaBufferGroup, key: string): void {
		for (const allocator of group.allocators.values()) {
			if (allocator.getSlot(key)) {
				allocator.free(key);
			}
		}
	}

	public buildBatchParams(
		slotSets: TileSlotSet[],
		attrName: string = 'position'
	): {firsts: Int32Array; counts: Int32Array; drawCount: number} {
		const drawCount = Math.min(slotSets.length, MAX_BATCH_SIZE);

		for (let i = 0; i < drawCount; i++) {
			const posSlot = slotSets[i].slots.get(attrName);
			if (posSlot) {
				this._batchFirsts[i] = posSlot.offset / 3;
				this._batchCounts[i] = posSlot.count / 3;
			} else {
				this._batchFirsts[i] = 0;
				this._batchCounts[i] = 0;
			}
		}

		return {
			firsts: this._batchFirsts,
			counts: this._batchCounts,
			drawCount
		};
	}

	public packExtrudedUBO(
		tileData: Array<{modelViewMatrix: Float32Array; modelViewMatrixPrev: Float32Array; tileId: number}>
	): {buffer: Float32Array; byteLength: number} {
		const stride = 36;
		const count = Math.min(tileData.length, MAX_BATCH_SIZE);

		for (let i = 0; i < count; i++) {
			const base = i * stride;
			const d = tileData[i];

			this._extrudedUBOView.set(d.modelViewMatrix, base);
			this._extrudedUBOView.set(d.modelViewMatrixPrev, base + 16);
			this._extrudedUBOUintView[base + 32] = d.tileId;
		}

		return {buffer: this._extrudedUBOView, byteLength: count * 144};
	}

	public packDepthUBO(
		matrices: Float32Array[]
	): {buffer: Float32Array; byteLength: number} {
		const count = Math.min(matrices.length, MAX_BATCH_SIZE);

		for (let i = 0; i < count; i++) {
			this._depthUBOView.set(matrices[i], i * 16);
		}

		return {buffer: this._depthUBOView, byteLength: count * 64};
	}

	public updateDisplayBuffer(
		key: string,
		start: number,
		size: number,
		value: number
	): void {
		const allocator = this.extruded.allocators.get('display');
		const slot = allocator?.getSlot(key);
		if (!slot) return;

		const patchData = new Uint8Array(size);
		for (let i = 0; i < size; i++) {
			patchData[i] = value;
		}

		const buffer = allocator.getBuffer();
		buffer.setSubData(patchData, slot.offset + start);
	}
}
