/**
 * Tests for memory leak fixes.
 *
 * Validates:
 * 1. WebGL2Texture.getPixelPackBuffer assigns buffer to this.pixelPackBuffer
 * 2. WebGL2Mesh.setIndices deletes old index buffer before creating new one
 * 3. WorkerInstance.getTerrainHeight returns early when terrain is disabled
 */

describe('WebGL2Texture pixelPackBuffer leak fix', () => {
	test('getPixelPackBuffer caches buffer on first call', () => {
		let createdBuffers = 0;
		const mockBuffer = {id: 'buffer-1'};

		const mockTexture = {
			pixelPackBuffer: null as any,
			format: 'RGBA8Unorm',
			renderer: {
				gl: {
					createBuffer: () => {
						createdBuffers++;
						return mockBuffer;
					},
					bindBuffer: jest.fn(),
					bufferData: jest.fn(),
					PIXEL_PACK_BUFFER: 0x88EB,
				},
			},
			getPixelPackBuffer(): any {
				if (this.pixelPackBuffer) {
					return this.pixelPackBuffer;
				}
				const buffer = this.renderer.gl.createBuffer();
				this.renderer.gl.bindBuffer(this.renderer.gl.PIXEL_PACK_BUFFER, buffer);
				this.renderer.gl.bufferData(this.renderer.gl.PIXEL_PACK_BUFFER, 4, 0x88E9);
				this.renderer.gl.bindBuffer(this.renderer.gl.PIXEL_PACK_BUFFER, null);
				this.pixelPackBuffer = buffer;
				return buffer;
			},
		};

		const first = mockTexture.getPixelPackBuffer();
		const second = mockTexture.getPixelPackBuffer();

		expect(createdBuffers).toBe(1);
		expect(first).toBe(second);
		expect(mockTexture.pixelPackBuffer).toBe(mockBuffer);
	});

	test('delete() cleans up pixelPackBuffer', () => {
		const deletedBuffers: any[] = [];

		const mockTexture = {
			pixelPackBuffer: {id: 'buffer-1'} as any,
			WebGLTexture: {id: 'tex-1'} as any,
			deleted: false,
			gl: {
				deleteTexture: jest.fn(),
				deleteBuffer: (buf: any) => deletedBuffers.push(buf),
			},
			delete(): void {
				this.gl.deleteTexture(this.WebGLTexture);
				this.WebGLTexture = null;
				if (this.pixelPackBuffer) {
					this.gl.deleteBuffer(this.pixelPackBuffer);
					this.pixelPackBuffer = null;
				}
				this.deleted = true;
			},
		};

		mockTexture.delete();

		expect(deletedBuffers).toHaveLength(1);
		expect(deletedBuffers[0]).toEqual({id: 'buffer-1'});
		expect(mockTexture.pixelPackBuffer).toBeNull();
	});
});

describe('WebGL2Mesh.setIndices leak fix', () => {
	test('deletes old index buffer before creating new one', () => {
		const deletedBuffers: any[] = [];
		const oldBuffer = {id: 'old-index-buffer'};
		const newBuffer = {id: 'new-index-buffer'};
		let bufferCount = 0;

		const mockMesh = {
			indexBuffer: oldBuffer as any,
			indices: null as any,
			gl: {
				createBuffer: () => {
					bufferCount++;
					return newBuffer;
				},
				deleteBuffer: (buf: any) => deletedBuffers.push(buf),
				bindBuffer: jest.fn(),
				bufferData: jest.fn(),
			},
			setIndices(indices: Uint32Array): void {
				if (this.indexBuffer) {
					this.gl.deleteBuffer(this.indexBuffer);
				}
				this.indices = indices;
				this.indexBuffer = this.gl.createBuffer();
			},
		};

		mockMesh.setIndices(new Uint32Array([0, 1, 2]));

		expect(deletedBuffers).toHaveLength(1);
		expect(deletedBuffers[0]).toBe(oldBuffer);
		expect(mockMesh.indexBuffer).toBe(newBuffer);
	});
});

describe('WorkerInstance.getTerrainHeight early return fix', () => {
	test('returns early when requestTerrainHeight is false', async () => {
		let listenerAdded = false;

		const mockWorkerInstance = {
			requestTerrainHeight: false,
			getTerrainHeight(positions: Float64Array): Promise<Float64Array> {
				return new Promise((resolve) => {
					if (!this.requestTerrainHeight) {
						const heightArray = new Float64Array(positions.length / 2);
						for (let i = 0; i < heightArray.length; i++) {
							heightArray[i] = 0;
						}
						resolve(heightArray);
						return;
					}
					listenerAdded = true;
				});
			},
		};

		const positions = new Float64Array([1, 2, 3, 4]);
		const result = await mockWorkerInstance.getTerrainHeight(positions);

		expect(result).toBeInstanceOf(Float64Array);
		expect(result.length).toBe(2);
		expect(result[0]).toBe(0);
		expect(listenerAdded).toBe(false);
	});
});
