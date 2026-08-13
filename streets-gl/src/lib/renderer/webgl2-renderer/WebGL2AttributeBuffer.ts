import AbstractAttributeBuffer, {
	AbstractAttributeBufferParams
} from "~/lib/renderer/abstract-renderer/AbstractAttributeBuffer";
import WebGL2Renderer from "~/lib/renderer/webgl2-renderer/WebGL2Renderer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import WebGL2Constants from "~/lib/renderer/webgl2-renderer/WebGL2Constants";

export default class WebGL2AttributeBuffer implements AbstractAttributeBuffer {
	private readonly renderer: WebGL2Renderer;
	private readonly usage: RendererTypes.BufferUsage;
	public buffer: WebGLBuffer;
	public data: TypedArray;

	public constructor(
		renderer: WebGL2Renderer,
		{
			usage = RendererTypes.BufferUsage.StaticDraw,
			data = null
		}: AbstractAttributeBufferParams
	) {
		this.renderer = renderer;
		this.usage = usage;
		this.data = data;

		this.createBuffer();

		if (data) {
			this.setData(data);
		}
	}

	private createBuffer(): void {
		this.buffer = this.renderer.gl.createBuffer();
	}

	public setData(data: TypedArray): void {
		this.data = data;

		const usage = WebGL2AttributeBuffer.convertUsageToWebGLConstant(this.usage);

		this.renderer.gl.bindBuffer(WebGL2Constants.ARRAY_BUFFER, this.buffer);
		this.renderer.gl.bufferData(WebGL2Constants.ARRAY_BUFFER, data, usage);
		this.renderer.gl.bindBuffer(WebGL2Constants.ARRAY_BUFFER, null);
	}

	public setSubData(data: TypedArray, byteOffset: number): void {
		this.renderer.gl.bindBuffer(WebGL2Constants.ARRAY_BUFFER, this.buffer);
		this.renderer.gl.bufferSubData(WebGL2Constants.ARRAY_BUFFER, byteOffset, data);
		this.renderer.gl.bindBuffer(WebGL2Constants.ARRAY_BUFFER, null);

		if (this.data) {
			const dst = new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength);
			const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			dst.set(src, byteOffset);
		}
	}

	public bind(): void {
		this.renderer.gl.bindBuffer(WebGL2Constants.ARRAY_BUFFER, this.buffer);
	}

	public unbind(): void {
		this.renderer.gl.bindBuffer(WebGL2Constants.ARRAY_BUFFER, null);
	}

	/**
	 * How many attributes point at this buffer.
	 *
	 * One buffer can back many meshes — that is the whole point of the tile
	 * mega-buffers — so an attribute cannot simply free the buffer it holds.
	 * It also must not leave it allocated forever, which is what happened:
	 * `WebGL2Attribute.delete()` was an empty stub, so every per-mesh
	 * attribute buffer ever created stayed on the GPU. Measured while parked
	 * at a station, that was 357 orphaned buffers every 25 seconds.
	 */
	private refCount: number = 0;

	public retain(): void {
		this.refCount++;
	}

	/** Drop one reference; free once nothing points here any more. */
	public release(): void {
		this.refCount--;

		if (this.refCount <= 0) {
			this.delete();
		}
	}

	public delete(): void {
		if (this.buffer === null) {
			return;
		}

		this.renderer.gl.deleteBuffer(this.buffer);
		this.buffer = null;
		this.refCount = 0;
	}

	public static convertUsageToWebGLConstant(usage: RendererTypes.BufferUsage): number {
		switch (usage) {
			case RendererTypes.BufferUsage.StaticDraw:
				return WebGL2Constants.STATIC_DRAW;
			case RendererTypes.BufferUsage.DynamicDraw:
				return WebGL2Constants.DYNAMIC_DRAW;
			case RendererTypes.BufferUsage.StreamDraw:
				return WebGL2Constants.STREAM_DRAW;
			case RendererTypes.BufferUsage.StaticRead:
				return WebGL2Constants.STATIC_READ;
			case RendererTypes.BufferUsage.DynamicRead:
				return WebGL2Constants.DYNAMIC_READ;
			case RendererTypes.BufferUsage.StreamRead:
				return WebGL2Constants.STREAM_READ;
			case RendererTypes.BufferUsage.StaticCopy:
				return WebGL2Constants.STATIC_COPY;
			case RendererTypes.BufferUsage.DynamicCopy:
				return WebGL2Constants.DYNAMIC_COPY;
			case RendererTypes.BufferUsage.StreamCopy:
				return WebGL2Constants.STREAM_COPY;
		}
	}
}