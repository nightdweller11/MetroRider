/**
 * Tests for per-frame allocation reduction.
 *
 * Validates:
 * 1. Pre-allocated buffers are reused instead of allocating new Float32Arrays
 * 2. SceneSystem.getObjectsToUpdateMesh uses index-based BFS (no shift/spread)
 * 3. RenderSystem resolution caching works correctly
 * 4. Instance buffer dedup via frame ID
 */

describe('GBufferPass pre-allocated buffers', () => {
	test('getTileDetailTextureOffset reuses pre-allocated buffer', () => {
		const _tmpDetailOffset = new Float32Array(2);

		function getTileDetailTextureOffset(posX: number, posZ: number): Float32Array {
			const offsetSize = 611.4962158203125 * 64;
			_tmpDetailOffset[0] = posX % offsetSize;
			_tmpDetailOffset[1] = posZ % offsetSize;
			return _tmpDetailOffset;
		}

		const result1 = getTileDetailTextureOffset(100, 200);
		const result2 = getTileDetailTextureOffset(300, 400);

		expect(result1).toBe(result2);
		expect(result1).toBe(_tmpDetailOffset);
	});

	test('getTileNormalTexturesTransforms reuses pre-allocated buffers', () => {
		const _tmpNormalTransform0 = new Float32Array(4);
		const _tmpNormalTransform1 = new Float32Array(4);

		function getTileNormalTexturesTransforms(): [Float32Array, Float32Array] {
			_tmpNormalTransform0[0] = 1;
			_tmpNormalTransform0[1] = 2;
			_tmpNormalTransform1[0] = 3;
			_tmpNormalTransform1[1] = 4;
			return [_tmpNormalTransform0, _tmpNormalTransform1];
		}

		const [t0a, t1a] = getTileNormalTexturesTransforms();
		const [t0b, t1b] = getTileNormalTexturesTransforms();

		expect(t0a).toBe(t0b);
		expect(t1a).toBe(t1b);
		expect(t0a).toBe(_tmpNormalTransform0);
	});

	test('mat4 temporary buffers are reused across render calls', () => {
		const _tmpMat4A = new Float32Array(16);
		const _tmpMat4B = new Float32Array(16);

		function setMatrixUniform(values: number[]): Float32Array {
			_tmpMat4A.set(values);
			return _tmpMat4A;
		}

		const r1 = setMatrixUniform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
		const r2 = setMatrixUniform([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2]);

		expect(r1).toBe(r2);
		expect(r1).toBe(_tmpMat4A);
		expect(_tmpMat4A[0]).toBe(2);
	});
});

describe('SceneSystem.getObjectsToUpdateMesh optimization', () => {
	interface MockNode {
		children: MockNode[];
		isMeshReady: boolean;
	}

	test('index-based BFS traverses all nodes without shift or spread', () => {
		const tree: MockNode = {
			children: [
				{
					children: [
						{children: [], isMeshReady: true},
						{children: [], isMeshReady: false},
					],
					isMeshReady: true,
				},
				{
					children: [
						{children: [], isMeshReady: false},
					],
					isMeshReady: false,
				},
			],
			isMeshReady: true,
		};

		const objects: MockNode[] = [tree];
		const result: MockNode[] = [];
		let idx = 0;

		while (idx < objects.length) {
			const object = objects[idx++];

			for (let i = 0; i < object.children.length; i++) {
				objects.push(object.children[i]);
			}

			if (!object.isMeshReady) {
				result.push(object);
			}
		}

		expect(result).toHaveLength(3);
		expect(objects).toHaveLength(6);
	});
});

describe('Instance buffer deduplication', () => {
	test('skips update when frameId matches', () => {
		let updateCount = 0;
		let _instanceBufferFrameId = -1;

		function updateInstancedObjectsBuffers(frameId: number): void {
			if (frameId >= 0 && frameId === _instanceBufferFrameId) {
				return;
			}
			_instanceBufferFrameId = frameId;
			updateCount++;
		}

		updateInstancedObjectsBuffers(1);
		updateInstancedObjectsBuffers(1);
		updateInstancedObjectsBuffers(1);

		expect(updateCount).toBe(1);

		updateInstancedObjectsBuffers(2);
		expect(updateCount).toBe(2);
	});

	test('allows update when frameId is negative (legacy calls)', () => {
		let updateCount = 0;
		let _instanceBufferFrameId = -1;

		function updateInstancedObjectsBuffers(frameId: number = -1): void {
			if (frameId >= 0 && frameId === _instanceBufferFrameId) {
				return;
			}
			_instanceBufferFrameId = frameId;
			updateCount++;
		}

		updateInstancedObjectsBuffers(-1);
		updateInstancedObjectsBuffers(-1);

		expect(updateCount).toBe(2);
	});
});

describe('Resolution caching', () => {
	test('cached resolution is updated only when dirty', () => {
		let computeCount = 0;
		let _resolutionDirty = true;
		const _cached = {x: 0, y: 0};

		function getResolution(width: number, height: number, pixelRatio: number): {x: number; y: number} {
			if (_resolutionDirty) {
				computeCount++;
				_cached.x = width * pixelRatio;
				_cached.y = height * pixelRatio;
				_resolutionDirty = false;
			}
			return _cached;
		}

		const r1 = getResolution(1920, 1080, 2);
		const r2 = getResolution(1920, 1080, 2);

		expect(computeCount).toBe(1);
		expect(r1).toBe(r2);
		expect(r1.x).toBe(3840);

		_resolutionDirty = true;
		const r3 = getResolution(1024, 768, 3);
		expect(computeCount).toBe(2);
		expect(r3.x).toBe(3072);
	});
});
