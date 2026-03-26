/**
 * Integration test: verifies real Kenney GLB files can be parsed and contain expected data.
 */
import * as fs from 'fs';
import * as path from 'path';

interface GLBParseResult {
	meshCount: number;
	totalVertices: number;
	hasUVs: boolean;
	hasNormals: boolean;
	hasVertexColors: boolean;
	materialNames: string[];
	textureUris: string[];
	nodeTranslations: Array<[number, number, number] | null>;
	boundsMin: [number, number, number];
	boundsMax: [number, number, number];
}

function parseGLBHeader(buffer: Buffer): GLBParseResult | null {
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	if (view.getUint32(0, true) !== 0x46546C67) return null;

	let jsonChunk: any = null;
	let offset = 12;

	while (offset < buffer.length) {
		const chunkLength = view.getUint32(offset, true);
		const chunkType = view.getUint32(offset + 4, true);
		if (chunkType === 0x4E4F534A) {
			jsonChunk = JSON.parse(buffer.slice(offset + 8, offset + 8 + chunkLength).toString());
		}
		offset += 8 + chunkLength;
	}

	if (!jsonChunk) return null;

	let meshCount = 0;
	let totalVertices = 0;
	let hasUVs = false;
	let hasNormals = false;
	let hasVertexColors = false;

	for (const mesh of jsonChunk.meshes || []) {
		meshCount++;
		for (const prim of mesh.primitives || []) {
			const posIdx = prim.attributes?.POSITION;
			if (posIdx !== undefined) {
				totalVertices += jsonChunk.accessors[posIdx].count;
			}
			if (prim.attributes?.TEXCOORD_0 !== undefined) hasUVs = true;
			if (prim.attributes?.NORMAL !== undefined) hasNormals = true;
			if (prim.attributes?.COLOR_0 !== undefined) hasVertexColors = true;
		}
	}

	const materialNames = (jsonChunk.materials || []).map((m: any) => m.name || 'unnamed');
	const textureUris = (jsonChunk.images || []).map((img: any) => img.uri || '(embedded)');

	const nodeTranslations = (jsonChunk.nodes || []).map((n: any) => {
		return n.translation ? [n.translation[0], n.translation[1], n.translation[2]] as [number, number, number] : null;
	});

	const posAccessor = jsonChunk.accessors[jsonChunk.meshes[0].primitives[0].attributes.POSITION];

	return {
		meshCount,
		totalVertices,
		hasUVs,
		hasNormals,
		hasVertexColors,
		materialNames,
		textureUris,
		nodeTranslations,
		boundsMin: posAccessor.min as [number, number, number],
		boundsMax: posAccessor.max as [number, number, number],
	};
}

describe('Real Kenney GLB parsing', () => {
	const modelsDir = path.join(__dirname, '../../data/assets/models/trains');

	test('train-electric-subway-a.glb exists and has valid GLB header', () => {
		const filePath = path.join(modelsDir, 'train-electric-subway-a.glb');
		expect(fs.existsSync(filePath)).toBe(true);

		const buffer = fs.readFileSync(filePath);
		const result = parseGLBHeader(buffer);
		expect(result).not.toBeNull();
	});

	test('subway model has expected mesh structure', () => {
		const buffer = fs.readFileSync(path.join(modelsDir, 'train-electric-subway-a.glb'));
		const result = parseGLBHeader(buffer)!;

		expect(result.meshCount).toBe(3);
		expect(result.totalVertices).toBeGreaterThan(100);
		expect(result.hasUVs).toBe(true);
		expect(result.hasNormals).toBe(true);
		expect(result.hasVertexColors).toBe(false);
	});

	test('subway model uses texture-based coloring', () => {
		const buffer = fs.readFileSync(path.join(modelsDir, 'train-electric-subway-a.glb'));
		const result = parseGLBHeader(buffer)!;

		expect(result.materialNames).toContain('colormap');
		expect(result.textureUris.length).toBeGreaterThan(0);
		expect(result.textureUris[0]).toMatch(/colormap/i);
	});

	test('subway model has node transforms for wheels', () => {
		const buffer = fs.readFileSync(path.join(modelsDir, 'train-electric-subway-a.glb'));
		const result = parseGLBHeader(buffer)!;

		expect(result.nodeTranslations.length).toBe(3);
		expect(result.nodeTranslations[0]).toBeNull();
		expect(result.nodeTranslations[1]).not.toBeNull();
		expect(result.nodeTranslations[2]).not.toBeNull();
		expect(result.nodeTranslations[1]![2]).toBeLessThan(0);
		expect(result.nodeTranslations[2]![2]).toBeGreaterThan(0);
	});

	test('subway model is approximately 2.6m long (needs scaling)', () => {
		const buffer = fs.readFileSync(path.join(modelsDir, 'train-electric-subway-a.glb'));
		const result = parseGLBHeader(buffer)!;

		const modelLength = result.boundsMax[2] - result.boundsMin[2];
		expect(modelLength).toBeGreaterThan(2);
		expect(modelLength).toBeLessThan(4);
	});

	test('colormap.png texture exists in trains directory', () => {
		const texturePath = path.join(modelsDir, 'textures', 'colormap.png');
		expect(fs.existsSync(texturePath)).toBe(true);
	});

	test('colormap.png texture also exists in tracks directory', () => {
		const texturePath = path.join(__dirname, '../../data/assets/models/tracks/textures', 'colormap.png');
		expect(fs.existsSync(texturePath)).toBe(true);
	});

	test('all train GLB files have valid headers', () => {
		const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.glb'));
		expect(files.length).toBeGreaterThan(10);

		for (const file of files) {
			const buffer = fs.readFileSync(path.join(modelsDir, file));
			const result = parseGLBHeader(buffer);
			expect(result).not.toBeNull();
			expect(result!.meshCount).toBeGreaterThan(0);
			expect(result!.totalVertices).toBeGreaterThan(0);
		}
	});
});
