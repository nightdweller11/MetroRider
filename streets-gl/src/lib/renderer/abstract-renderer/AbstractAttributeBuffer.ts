import {RendererTypes} from "~/lib/renderer/RendererTypes";

export interface AbstractAttributeBufferParams {
	usage?: RendererTypes.BufferUsage;
	data?: TypedArray;
}

export default interface AbstractAttributeBuffer {
	data: TypedArray;
	setData(data: TypedArray): void;
	setSubData(data: TypedArray, byteOffset: number): void;
	delete(): void;
}