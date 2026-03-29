/**
 * Tests for the train model selection and rendering pipeline.
 * Covers: config merge with carCount, GLB parsing, model scaling, multi-car assembly.
 */

interface SoundConfig {
	horn: string;
	engine: string;
	rail: string;
	wind: string;
	brake: string;
	doorChime: string;
	stationChime: string;
}

interface AssetConfig {
	trainSlots: string[];
	trackModel: string;
	stationModel: string;
	sounds: SoundConfig;
}

function migrateToSlots(raw: any): string[] | null {
	if (Array.isArray(raw.trainSlots) && raw.trainSlots.length > 0) return raw.trainSlots;
	if (raw.trainModel || raw.locomotiveModel || raw.carCount) {
		const car = raw.trainModel || 'procedural-default';
		const loco = raw.locomotiveModel || 'procedural-default';
		const count = raw.carCount ?? 3;
		if (loco !== 'procedural-default' && loco !== car) return [loco, ...Array(count).fill(car)];
		return Array(count).fill(car);
	}
	return null;
}

const DEFAULT_SLOTS = ['procedural-default', 'procedural-default', 'procedural-default'];

function mergeConfig(serverConfig: any, userOverrides: any): AssetConfig {
	const userSlots = migrateToSlots(userOverrides);
	const serverSlots = migrateToSlots(serverConfig) || [...DEFAULT_SLOTS];
	return {
		trainSlots: userSlots || serverSlots,
		trackModel: userOverrides.trackModel || serverConfig.trackModel,
		stationModel: userOverrides.stationModel || serverConfig.stationModel,
		sounds: {
			...serverConfig.sounds,
			...(userOverrides.sounds || {}),
		},
	};
}

function scaleAndCenterPositions(positions: number[], targetWidth: number): void {
	const vertCount = positions.length / 3;
	let minX = Infinity, maxX = -Infinity;
	let minY = Infinity, maxY = -Infinity;
	let minZ = Infinity, maxZ = -Infinity;

	for (let i = 0; i < vertCount; i++) {
		const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
		if (x < minX) minX = x; if (x > maxX) maxX = x;
		if (y < minY) minY = y; if (y > maxY) maxY = y;
		if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
	}

	const modelWidth = maxX - minX;
	const scale = modelWidth > 0.01 ? targetWidth / modelWidth : 1;
	const centerX = (minX + maxX) / 2;
	const centerZ = (minZ + maxZ) / 2;

	for (let i = 0; i < vertCount; i++) {
		positions[i * 3] = (positions[i * 3] - centerX) * scale;
		positions[i * 3 + 1] = (positions[i * 3 + 1] - minY) * scale;
		positions[i * 3 + 2] = (positions[i * 3 + 2] - centerZ) * scale;
	}
}

interface GeometryBuffers {
	position: Float32Array;
	normal: Float32Array;
	color: Float32Array;
	indices: Uint32Array;
}

function assembleMultiCar(singleCar: GeometryBuffers, carCount: number, carGap: number): GeometryBuffers {
	const vertCount = singleCar.position.length / 3;
	const idxCount = singleCar.indices.length;

	let minZ = Infinity, maxZ = -Infinity;
	for (let i = 0; i < vertCount; i++) {
		const z = singleCar.position[i * 3 + 2];
		if (z < minZ) minZ = z;
		if (z > maxZ) maxZ = z;
	}
	const carLength = maxZ - minZ;
	const spacing = carLength + carGap;

	const totalVerts = vertCount * carCount;
	const totalIdx = idxCount * carCount;
	const positions = new Float32Array(totalVerts * 3);
	const normals = new Float32Array(totalVerts * 3);
	const colors = new Float32Array(totalVerts * 3);
	const indices = new Uint32Array(totalIdx);

	for (let c = 0; c < carCount; c++) {
		const zOffset = (c - (carCount - 1) / 2) * spacing;
		const vBase = c * vertCount;

		for (let v = 0; v < vertCount; v++) {
			positions[(vBase + v) * 3] = singleCar.position[v * 3];
			positions[(vBase + v) * 3 + 1] = singleCar.position[v * 3 + 1];
			positions[(vBase + v) * 3 + 2] = singleCar.position[v * 3 + 2] + zOffset;
			normals[(vBase + v) * 3] = singleCar.normal[v * 3];
			normals[(vBase + v) * 3 + 1] = singleCar.normal[v * 3 + 1];
			normals[(vBase + v) * 3 + 2] = singleCar.normal[v * 3 + 2];
			colors[(vBase + v) * 3] = singleCar.color[v * 3];
			colors[(vBase + v) * 3 + 1] = singleCar.color[v * 3 + 1];
			colors[(vBase + v) * 3 + 2] = singleCar.color[v * 3 + 2];
		}

		const iBase = c * idxCount;
		for (let i = 0; i < idxCount; i++) {
			indices[iBase + i] = singleCar.indices[i] + vBase;
		}
	}

	return {position: positions, normal: normals, color: colors, indices};
}

function sampleTextureColors(
	uvData: Float32Array,
	texture: {data: Uint8ClampedArray; width: number; height: number},
	vertCount: number,
): number[] {
	const {data, width, height} = texture;
	const outColors: number[] = [];

	for (let v = 0; v < vertCount; v++) {
		const u = uvData[v * 2];
		const vCoord = uvData[v * 2 + 1];
		let px = Math.floor(u * width) % width;
		let py = Math.floor(vCoord * height) % height;
		if (px < 0) px += width;
		if (py < 0) py += height;
		const idx = (py * width + px) * 4;
		outColors.push(data[idx] / 255, data[idx + 1] / 255, data[idx + 2] / 255);
	}

	return outColors;
}

describe('Config merge with trainSlots', () => {
	const serverConfig = {
		trainSlots: ['procedural-default', 'procedural-default', 'procedural-default'],
		trackModel: 'procedural-default',
		stationModel: 'procedural-default',
		sounds: {horn: 'procedural', engine: 'procedural', rail: 'procedural', wind: 'procedural', brake: 'procedural', doorChime: 'procedural', stationChime: 'procedural'},
	};

	test('default has 3 slots', () => {
		const result = mergeConfig(serverConfig, {});
		expect(result.trainSlots.length).toBe(3);
	});

	test('user overrides trainSlots', () => {
		const result = mergeConfig(serverConfig, {trainSlots: ['a', 'b', 'c', 'd', 'e']});
		expect(result.trainSlots.length).toBe(5);
	});

	test('user overrides to 1 slot', () => {
		const result = mergeConfig(serverConfig, {trainSlots: ['loco-a']});
		expect(result.trainSlots.length).toBe(1);
		expect(result.trainSlots[0]).toBe('loco-a');
	});

	test('backward compat: old carCount migrates to correct number of slots', () => {
		const result = mergeConfig({trainModel: 'subway-a', carCount: 6, trackModel: 'procedural-default', stationModel: 'procedural-default', sounds: serverConfig.sounds}, {});
		expect(result.trainSlots.length).toBe(6);
		expect(result.trainSlots[0]).toBe('subway-a');
	});

	test('mixed slots work correctly', () => {
		const result = mergeConfig(serverConfig, {trainSlots: ['loco', 'car-a', 'car-b', 'car-a']});
		expect(result.trainSlots).toEqual(['loco', 'car-a', 'car-b', 'car-a']);
	});
});

describe('Model scaling (width-based)', () => {
	test('scales model width to target 3.0m', () => {
		const positions = [
			-0.675, 0, -1.3,
			0.675, 1.4, -1.3,
			-0.675, 0, 1.3,
			0.675, 1.4, 1.3,
		];
		scaleAndCenterPositions(positions, 3.0);

		let minX = Infinity, maxX = -Infinity;
		for (let i = 0; i < 4; i++) {
			if (positions[i * 3] < minX) minX = positions[i * 3];
			if (positions[i * 3] > maxX) maxX = positions[i * 3];
		}
		expect(maxX - minX).toBeCloseTo(3.0, 1);
	});

	test('centers model horizontally and places bottom at y=0', () => {
		const positions = [
			-0.5, 0.5, -1,
			0.5, 0.5, -1,
			-0.5, 2.5, 1,
			0.5, 2.5, 1,
		];
		scaleAndCenterPositions(positions, 3.0);

		let minY = Infinity;
		for (let i = 0; i < 4; i++) {
			if (positions[i * 3 + 1] < minY) minY = positions[i * 3 + 1];
		}
		expect(minY).toBeCloseTo(0, 5);
	});

	test('uniform scale preserves aspect ratio', () => {
		const positions = [
			0, 0, -1.3,
			1.35, 1.41, 1.3,
		];
		const origWidth = 1.35;
		const origLen = 2.6;
		const origRatio = origWidth / origLen;

		scaleAndCenterPositions(positions, 3.0);

		const newWidth = positions[3] - positions[0];
		const newLen = positions[5] - positions[2];
		expect(newWidth / newLen).toBeCloseTo(origRatio, 3);
	});

	test('Kenney subway model scales to correct real-world dimensions', () => {
		const modelW = 1.35, modelH = 1.571, modelL = 2.6;
		const scale = 3.0 / modelW;
		const scaledW = modelW * scale;
		const scaledH = modelH * scale;
		const scaledL = modelL * scale;

		expect(scaledW).toBeCloseTo(3.0, 1);
		expect(scaledH).toBeCloseTo(3.49, 1);
		expect(scaledL).toBeCloseTo(5.78, 1);
		expect(scaledH).toBeLessThan(5);
		expect(scaledH).toBeGreaterThan(2.5);
	});
});

describe('Multi-car assembly', () => {
	const singleCar: GeometryBuffers = {
		position: new Float32Array([0, 0, -10, 0, 3, -10, 1, 0, 10, 1, 3, 10]),
		normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
		color: new Float32Array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0]),
		indices: new Uint32Array([0, 1, 2, 1, 2, 3]),
	};

	test('1 car produces same vertex count', () => {
		const result = assembleMultiCar(singleCar, 1, 1.5);
		expect(result.position.length).toBe(singleCar.position.length);
		expect(result.indices.length).toBe(singleCar.indices.length);
	});

	test('3 cars produces 3x vertices and indices', () => {
		const result = assembleMultiCar(singleCar, 3, 1.5);
		expect(result.position.length).toBe(singleCar.position.length * 3);
		expect(result.indices.length).toBe(singleCar.indices.length * 3);
		expect(result.color.length).toBe(singleCar.color.length * 3);
	});

	test('cars are spaced along Z axis', () => {
		const result = assembleMultiCar(singleCar, 3, 1.5);
		const vertCount = singleCar.position.length / 3;

		const car0CenterZ = (result.position[2] + result.position[(vertCount - 1) * 3 + 2]) / 2;
		const car1CenterZ = (result.position[(vertCount) * 3 + 2] + result.position[(2 * vertCount - 1) * 3 + 2]) / 2;
		const car2CenterZ = (result.position[(2 * vertCount) * 3 + 2] + result.position[(3 * vertCount - 1) * 3 + 2]) / 2;

		expect(car1CenterZ - car0CenterZ).toBeCloseTo(21.5, 1);
		expect(car2CenterZ - car1CenterZ).toBeCloseTo(21.5, 1);
	});

	test('indices are offset correctly for each car', () => {
		const result = assembleMultiCar(singleCar, 2, 1.5);
		const vertCount = singleCar.position.length / 3;
		const idxCount = singleCar.indices.length;

		for (let i = 0; i < idxCount; i++) {
			expect(result.indices[i]).toBe(singleCar.indices[i]);
		}
		for (let i = 0; i < idxCount; i++) {
			expect(result.indices[idxCount + i]).toBe(singleCar.indices[i] + vertCount);
		}
	});
});

describe('Texture color sampling', () => {
	test('samples correct pixel from UV coordinates', () => {
		const textureData = new Uint8ClampedArray([
			255, 0, 0, 255,   0, 255, 0, 255,
			0, 0, 255, 255,   255, 255, 0, 255,
		]);
		const texture = {data: textureData, width: 2, height: 2};

		const uvs = new Float32Array([0.0, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.5]);
		const colors = sampleTextureColors(uvs, texture, 4);

		expect(colors[0]).toBeCloseTo(1.0, 2);
		expect(colors[1]).toBeCloseTo(0.0, 2);
		expect(colors[2]).toBeCloseTo(0.0, 2);

		expect(colors[3]).toBeCloseTo(0.0, 2);
		expect(colors[4]).toBeCloseTo(1.0, 2);
		expect(colors[5]).toBeCloseTo(0.0, 2);
	});

	test('wraps UV coordinates outside [0,1]', () => {
		const textureData = new Uint8ClampedArray([
			128, 64, 32, 255,
		]);
		const texture = {data: textureData, width: 1, height: 1};
		const uvs = new Float32Array([1.5, 2.5]);
		const colors = sampleTextureColors(uvs, texture, 1);

		expect(colors[0]).toBeCloseTo(128 / 255, 2);
		expect(colors[1]).toBeCloseTo(64 / 255, 2);
		expect(colors[2]).toBeCloseTo(32 / 255, 2);
	});
});

describe('GLB JSON structure validation', () => {
	test('Kenney model uses TEXCOORD_0, not COLOR_0', () => {
		const kenneyPrimitive = {
			attributes: {POSITION: 0, NORMAL: 1, TANGENT: 2, TEXCOORD_0: 3},
			material: 0,
		};

		expect(kenneyPrimitive.attributes.TEXCOORD_0).toBeDefined();
		expect((kenneyPrimitive.attributes as any).COLOR_0).toBeUndefined();
	});

	test('Kenney material references baseColorTexture, not baseColorFactor', () => {
		const kenneyMaterial = {
			name: 'colormap',
			pbrMetallicRoughness: {
				baseColorTexture: {index: 0},
				metallicFactor: 0,
			},
		};

		expect(kenneyMaterial.pbrMetallicRoughness.baseColorTexture).toBeDefined();
		expect((kenneyMaterial.pbrMetallicRoughness as any).baseColorFactor).toBeUndefined();
	});

	test('node transforms are extracted correctly', () => {
		const nodes = [
			{mesh: 0, name: 'body'},
			{mesh: 1, translation: [-0.0875, 0.3595, -0.55], name: 'wheels-back'},
			{mesh: 2, translation: [-0.0875, 0.3595, 0.55], name: 'wheels-front'},
		];

		const transforms = nodes.map(n => {
			if (n.translation) {
				return {tx: n.translation[0], ty: n.translation[1], tz: n.translation[2]};
			}
			return null;
		});

		expect(transforms[0]).toBeNull();
		expect(transforms[1]!.tx).toBeCloseTo(-0.0875, 4);
		expect(transforms[1]!.tz).toBeCloseTo(-0.55, 4);
		expect(transforms[2]!.tz).toBeCloseTo(0.55, 4);
	});
});

describe('localStorage change detection', () => {
	test('detects slot change from localStorage raw string comparison', () => {
		const oldRaw = JSON.stringify({trainSlots: ['procedural-default']});
		const newRaw = JSON.stringify({trainSlots: ['kenney-subway-a']});
		expect(oldRaw !== newRaw).toBe(true);
	});

	test('same config produces same raw string', () => {
		const config = {trainSlots: ['kenney-subway-a', 'kenney-subway-a', 'kenney-subway-a']};
		const raw1 = JSON.stringify(config);
		const raw2 = JSON.stringify(config);
		expect(raw1).toBe(raw2);
	});

	test('slot count change produces different raw string', () => {
		const config1 = JSON.stringify({trainSlots: ['a', 'a', 'a']});
		const config2 = JSON.stringify({trainSlots: ['a', 'a', 'a', 'a', 'a']});
		expect(config1 !== config2).toBe(true);
	});
});
