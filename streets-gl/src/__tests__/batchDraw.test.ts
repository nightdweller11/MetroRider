jest.mock('~/lib/renderer/webgl2-renderer/WebGL2Material', () => ({
	__esModule: true,
	default: class WebGL2Material {},
}));

import WebGL2Renderer from '~/lib/renderer/webgl2-renderer/WebGL2Renderer';
import WebGL2Constants from '~/lib/renderer/webgl2-renderer/WebGL2Constants';
import type {BatchDrawParams} from '~/lib/renderer/abstract-renderer/AbstractRenderer';

const MAX_BATCH_SIZE = 32;

function createMockGl(multiDrawExtension: {multiDrawArraysWEBGL: jest.Mock} | null): WebGL2RenderingContext {
	return {
		canvas: {width: 1, height: 1} as HTMLCanvasElement,
		enable: jest.fn(),
		getExtension: jest.fn((name: string) => {
			if (name === 'WEBGL_multi_draw') {
				return multiDrawExtension;
			}
			return null;
		}),
		drawArrays: jest.fn(),
	} as unknown as WebGL2RenderingContext;
}

describe('WebGL2Renderer batch draw', () => {
	describe('supportsBatchDraw', () => {
		test('is true when WEBGL_multi_draw extension is present', () => {
			const multiDraw = {multiDrawArraysWEBGL: jest.fn()};
			const gl = createMockGl(multiDraw);
			const renderer = new WebGL2Renderer(gl);
			expect(renderer.supportsBatchDraw).toBe(true);
		});

		test('is false when WEBGL_multi_draw extension is null', () => {
			const gl = createMockGl(null);
			const renderer = new WebGL2Renderer(gl);
			expect(renderer.supportsBatchDraw).toBe(false);
		});
	});

	describe('batchDrawArrays with multiDraw extension', () => {
		test('calls multiDrawArraysWEBGL with triangle mode, firsts, counts, and drawCount', () => {
			const multiDrawArraysWEBGL = jest.fn();
			const gl = createMockGl({multiDrawArraysWEBGL});
			const renderer = new WebGL2Renderer(gl);
			const firsts = new Int32Array([0, 10, 25]);
			const counts = new Int32Array([3, 6, 12]);
			const params: BatchDrawParams = {firsts, counts, drawCount: 3};
			renderer.batchDrawArrays(params);
			expect(multiDrawArraysWEBGL).toHaveBeenCalledTimes(1);
			expect(multiDrawArraysWEBGL).toHaveBeenCalledWith(
				WebGL2Constants.TRIANGLES,
				firsts,
				0,
				counts,
				0,
				3
			);
			expect(gl.drawArrays).not.toHaveBeenCalled();
		});

		test('handles drawCount of 1', () => {
			const multiDrawArraysWEBGL = jest.fn();
			const gl = createMockGl({multiDrawArraysWEBGL});
			const renderer = new WebGL2Renderer(gl);
			const firsts = new Int32Array([7]);
			const counts = new Int32Array([99]);
			renderer.batchDrawArrays({firsts, counts, drawCount: 1});
			expect(multiDrawArraysWEBGL).toHaveBeenCalledWith(
				WebGL2Constants.TRIANGLES,
				firsts,
				0,
				counts,
				0,
				1
			);
		});

		test('with drawCount 0 does not call gl.drawArrays', () => {
			const multiDrawArraysWEBGL = jest.fn();
			const gl = createMockGl({multiDrawArraysWEBGL});
			const renderer = new WebGL2Renderer(gl);
			const firsts = new Int32Array([1, 2, 3]);
			const counts = new Int32Array([4, 5, 6]);
			renderer.batchDrawArrays({firsts, counts, drawCount: 0});
			expect(gl.drawArrays).not.toHaveBeenCalled();
			expect(multiDrawArraysWEBGL).toHaveBeenCalledWith(
				WebGL2Constants.TRIANGLES,
				firsts,
				0,
				counts,
				0,
				0
			);
		});

		test('accepts pre-allocated firsts and counts of length MAX_BATCH_SIZE', () => {
			const multiDrawArraysWEBGL = jest.fn();
			const gl = createMockGl({multiDrawArraysWEBGL});
			const renderer = new WebGL2Renderer(gl);
			const firsts = new Int32Array(MAX_BATCH_SIZE);
			const counts = new Int32Array(MAX_BATCH_SIZE);
			for (let i = 0; i < MAX_BATCH_SIZE; i++) {
				firsts[i] = i * 3;
				counts[i] = i + 1;
			}
			renderer.batchDrawArrays({firsts, counts, drawCount: MAX_BATCH_SIZE});
			expect(multiDrawArraysWEBGL).toHaveBeenCalledWith(
				WebGL2Constants.TRIANGLES,
				firsts,
				0,
				counts,
				0,
				MAX_BATCH_SIZE
			);
		});
	});

	describe('batchDrawArrays fallback without extension', () => {
		test('calls gl.drawArrays once per sub-draw with matching first and count', () => {
			const gl = createMockGl(null);
			const renderer = new WebGL2Renderer(gl);
			const firsts = new Int32Array([0, 10, 100]);
			const counts = new Int32Array([3, 6, 9]);
			renderer.batchDrawArrays({firsts, counts, drawCount: 3});
			expect(gl.drawArrays).toHaveBeenCalledTimes(3);
			expect(gl.drawArrays).toHaveBeenNthCalledWith(1, WebGL2Constants.TRIANGLES, 0, 3);
			expect(gl.drawArrays).toHaveBeenNthCalledWith(2, WebGL2Constants.TRIANGLES, 10, 6);
			expect(gl.drawArrays).toHaveBeenNthCalledWith(3, WebGL2Constants.TRIANGLES, 100, 9);
		});

		test('with drawCount 0 never calls gl.drawArrays', () => {
			const gl = createMockGl(null);
			const renderer = new WebGL2Renderer(gl);
			renderer.batchDrawArrays({
				firsts: new Int32Array([1]),
				counts: new Int32Array([2]),
				drawCount: 0,
			});
			expect(gl.drawArrays).not.toHaveBeenCalled();
		});

		test('single-element batch uses one drawArrays call', () => {
			const gl = createMockGl(null);
			const renderer = new WebGL2Renderer(gl);
			renderer.batchDrawArrays({
				firsts: new Int32Array([42]),
				counts: new Int32Array([18]),
				drawCount: 1,
			});
			expect(gl.drawArrays).toHaveBeenCalledTimes(1);
			expect(gl.drawArrays).toHaveBeenCalledWith(WebGL2Constants.TRIANGLES, 42, 18);
		});

		test('matches the call sequence of individual drawArrays invocations', () => {
			const gl = createMockGl(null);
			const renderer = new WebGL2Renderer(gl);
			const firsts = new Int32Array([5, 20, 40]);
			const counts = new Int32Array([2, 4, 8]);
			const n = 3;
			renderer.batchDrawArrays({firsts, counts, drawCount: n});

			const glRef = createMockGl(null);
			for (let i = 0; i < n; i++) {
				glRef.drawArrays(WebGL2Constants.TRIANGLES, firsts[i], counts[i]);
			}
			expect((gl.drawArrays as jest.Mock).mock.calls).toEqual((glRef.drawArrays as jest.Mock).mock.calls);
		});

		test('uses all MAX_BATCH_SIZE entries when drawCount is MAX_BATCH_SIZE', () => {
			const gl = createMockGl(null);
			const renderer = new WebGL2Renderer(gl);
			const firsts = new Int32Array(MAX_BATCH_SIZE);
			const counts = new Int32Array(MAX_BATCH_SIZE);
			for (let i = 0; i < MAX_BATCH_SIZE; i++) {
				firsts[i] = i * 2;
				counts[i] = i + 10;
			}
			renderer.batchDrawArrays({firsts, counts, drawCount: MAX_BATCH_SIZE});
			expect(gl.drawArrays).toHaveBeenCalledTimes(MAX_BATCH_SIZE);
			for (let i = 0; i < MAX_BATCH_SIZE; i++) {
				expect(gl.drawArrays).toHaveBeenNthCalledWith(
					i + 1,
					WebGL2Constants.TRIANGLES,
					firsts[i],
					counts[i]
				);
			}
		});
	});
});
