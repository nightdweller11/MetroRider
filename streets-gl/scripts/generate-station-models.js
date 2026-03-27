#!/usr/bin/env node
/**
 * Generates low-poly GLB station models for MetroRider.
 * Run: node scripts/generate-station-models.js
 * Output: data-seed/assets/models/stations/*.glb
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'data-seed', 'assets', 'models', 'stations');

function appendBox(positions, normals, colors, indices, cx, cy, cz, hw, hh, hd, r, g, b) {
	const base = positions.length / 3;
	const faceNormals = [
		[0, 0, 1], [0, 0, -1],
		[0, 1, 0], [0, -1, 0],
		[1, 0, 0], [-1, 0, 0],
	];
	const faceVerts = [
		[[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
		[[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
		[[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
		[[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
		[[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
		[[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
	];

	for (let f = 0; f < 6; f++) {
		const [nx, ny, nz] = faceNormals[f];
		for (const [sx, sy, sz] of faceVerts[f]) {
			positions.push(cx + sx * hw, cy + sy * hh, cz + sz * hd);
			normals.push(nx, ny, nz);
			colors.push(r, g, b, 1);
		}
		const fb = base + f * 4;
		indices.push(fb, fb + 1, fb + 2, fb, fb + 2, fb + 3);
	}
}

function buildGLB(positions, normals, colors, indices, name) {
	const posF32 = new Float32Array(positions);
	const normF32 = new Float32Array(normals);
	const colF32 = new Float32Array(colors);
	const idxU16 = positions.length / 3 <= 65535 ? new Uint16Array(indices) : null;
	const idxU32 = idxU16 ? null : new Uint32Array(indices);
	const idxArray = idxU16 || idxU32;
	const idxComponentType = idxU16 ? 5123 : 5125;

	let minPos = [Infinity, Infinity, Infinity];
	let maxPos = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < posF32.length; i += 3) {
		for (let j = 0; j < 3; j++) {
			if (posF32[i + j] < minPos[j]) minPos[j] = posF32[i + j];
			if (posF32[i + j] > maxPos[j]) maxPos[j] = posF32[i + j];
		}
	}

	const posBuf = Buffer.from(posF32.buffer);
	const normBuf = Buffer.from(normF32.buffer);
	const colBuf = Buffer.from(colF32.buffer);
	const idxBuf = Buffer.from(idxArray.buffer);

	let offset = 0;
	const posOff = offset; offset += posBuf.length;
	const normOff = offset; offset += normBuf.length;
	const colOff = offset; offset += colBuf.length;
	const idxOff = offset; offset += idxBuf.length;
	const totalBinSize = offset;

	const gltfJson = {
		asset: { version: '2.0', generator: 'MetroRider Station Generator' },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, name }],
		meshes: [{
			primitives: [{
				attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
				indices: 3,
				mode: 4,
			}],
		}],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: posF32.length / 3, type: 'VEC3', min: minPos, max: maxPos },
			{ bufferView: 1, componentType: 5126, count: normF32.length / 3, type: 'VEC3' },
			{ bufferView: 2, componentType: 5126, count: colF32.length / 4, type: 'VEC4' },
			{ bufferView: 3, componentType: idxComponentType, count: indices.length, type: 'SCALAR' },
		],
		bufferViews: [
			{ buffer: 0, byteOffset: posOff, byteLength: posBuf.length, target: 34962 },
			{ buffer: 0, byteOffset: normOff, byteLength: normBuf.length, target: 34962 },
			{ buffer: 0, byteOffset: colOff, byteLength: colBuf.length, target: 34962 },
			{ buffer: 0, byteOffset: idxOff, byteLength: idxBuf.length, target: 34963 },
		],
		buffers: [{ byteLength: totalBinSize }],
	};

	const jsonStr = JSON.stringify(gltfJson);
	let jsonPadded = jsonStr;
	while (jsonPadded.length % 4 !== 0) jsonPadded += ' ';
	const jsonBuf = Buffer.from(jsonPadded, 'utf-8');

	let binPadded = Buffer.concat([posBuf, normBuf, colBuf, idxBuf]);
	while (binPadded.length % 4 !== 0) {
		binPadded = Buffer.concat([binPadded, Buffer.from([0])]);
	}

	const headerSize = 12;
	const jsonChunkSize = 8 + jsonBuf.length;
	const binChunkSize = 8 + binPadded.length;
	const totalSize = headerSize + jsonChunkSize + binChunkSize;

	const glb = Buffer.alloc(totalSize);
	let w = 0;
	glb.writeUInt32LE(0x46546C67, w); w += 4; // magic
	glb.writeUInt32LE(2, w); w += 4;           // version
	glb.writeUInt32LE(totalSize, w); w += 4;   // total length

	glb.writeUInt32LE(jsonBuf.length, w); w += 4;
	glb.writeUInt32LE(0x4E4F534A, w); w += 4;
	jsonBuf.copy(glb, w); w += jsonBuf.length;

	glb.writeUInt32LE(binPadded.length, w); w += 4;
	glb.writeUInt32LE(0x004E4942, w); w += 4;
	binPadded.copy(glb, w);

	return glb;
}

// --- Station Model Definitions ---

function buildPlatformBasic() {
	const positions = [], normals = [], colors = [], indices = [];

	// Main platform slab
	appendBox(positions, normals, colors, indices, 0, 0.3, 0, 2, 0.3, 10, 0.75, 0.73, 0.70);
	// Platform edge curb
	appendBox(positions, normals, colors, indices, -1.8, 0.65, 0, 0.2, 0.05, 10, 0.65, 0.63, 0.60);
	// Yellow safety line
	appendBox(positions, normals, colors, indices, -1.5, 0.62, 0, 0.25, 0.02, 10, 0.95, 0.85, 0.15);

	return buildGLB(positions, normals, colors, indices, 'station-platform-basic');
}

function buildPlatformCovered() {
	const positions = [], normals = [], colors = [], indices = [];

	// Main platform slab
	appendBox(positions, normals, colors, indices, 0, 0.3, 0, 2.0, 0.3, 12, 0.75, 0.73, 0.70);
	// Yellow safety line
	appendBox(positions, normals, colors, indices, -1.5, 0.62, 0, 0.25, 0.02, 12, 0.95, 0.85, 0.15);
	// Platform edge curb
	appendBox(positions, normals, colors, indices, -1.8, 0.65, 0, 0.2, 0.05, 12, 0.65, 0.63, 0.60);

	// Canopy roof
	appendBox(positions, normals, colors, indices, 0, 3.5, 0, 2.4, 0.08, 8, 0.35, 0.45, 0.55);
	// Roof edge trim
	appendBox(positions, normals, colors, indices, 0, 3.42, -8, 2.4, 0.04, 0.15, 0.3, 0.4, 0.5);
	appendBox(positions, normals, colors, indices, 0, 3.42, 8, 2.4, 0.04, 0.15, 0.3, 0.4, 0.5);

	// Support pillars (6 along outer edge)
	for (let i = -2; i <= 2; i += 2) {
		appendBox(positions, normals, colors, indices, 1.5, 1.9, i * 3, 0.1, 1.6, 0.1, 0.5, 0.5, 0.5);
	}

	// Benches (3)
	for (let i = -1; i <= 1; i++) {
		appendBox(positions, normals, colors, indices, 1.0, 0.85, i * 3.5, 0.3, 0.04, 0.6, 0.4, 0.3, 0.2);
		// Legs
		appendBox(positions, normals, colors, indices, 1.0, 0.72, i * 3.5 - 0.4, 0.3, 0.12, 0.04, 0.35, 0.35, 0.35);
		appendBox(positions, normals, colors, indices, 1.0, 0.72, i * 3.5 + 0.4, 0.3, 0.12, 0.04, 0.35, 0.35, 0.35);
	}

	return buildGLB(positions, normals, colors, indices, 'station-platform-covered');
}

function buildTramStop() {
	const positions = [], normals = [], colors = [], indices = [];

	// Raised platform (lower, tram height)
	appendBox(positions, normals, colors, indices, 0, 0.15, 0, 1.5, 0.15, 6, 0.72, 0.72, 0.72);
	// Yellow line
	appendBox(positions, normals, colors, indices, -1.2, 0.32, 0, 0.2, 0.02, 6, 0.95, 0.85, 0.15);
	// Curb
	appendBox(positions, normals, colors, indices, -1.4, 0.35, 0, 0.1, 0.05, 6, 0.6, 0.6, 0.6);

	// Glass shelter (transparent-ish panels represented with light blue)
	// Back wall
	appendBox(positions, normals, colors, indices, 1.2, 1.5, 0, 0.05, 1.2, 2.0, 0.6, 0.75, 0.85);
	// Side walls
	appendBox(positions, normals, colors, indices, 0.6, 1.5, -2.0, 0.6, 1.2, 0.05, 0.6, 0.75, 0.85);
	appendBox(positions, normals, colors, indices, 0.6, 1.5, 2.0, 0.6, 1.2, 0.05, 0.6, 0.75, 0.85);
	// Shelter roof
	appendBox(positions, normals, colors, indices, 0.6, 2.7, 0, 0.8, 0.06, 2.2, 0.4, 0.4, 0.4);

	// Bench inside shelter
	appendBox(positions, normals, colors, indices, 0.9, 0.6, 0, 0.2, 0.04, 1.0, 0.4, 0.3, 0.2);
	appendBox(positions, normals, colors, indices, 0.9, 0.45, -0.7, 0.2, 0.14, 0.04, 0.35, 0.35, 0.35);
	appendBox(positions, normals, colors, indices, 0.9, 0.45, 0.7, 0.2, 0.14, 0.04, 0.35, 0.35, 0.35);

	return buildGLB(positions, normals, colors, indices, 'station-tram-stop');
}

function buildSubwayEntrance() {
	const positions = [], normals = [], colors = [], indices = [];

	// Platform (wide, underground style)
	appendBox(positions, normals, colors, indices, 0, 0.3, 0, 2.5, 0.3, 14, 0.7, 0.7, 0.7);
	// Yellow safety line
	appendBox(positions, normals, colors, indices, -2.0, 0.62, 0, 0.3, 0.02, 14, 0.95, 0.85, 0.15);
	// Curb
	appendBox(positions, normals, colors, indices, -2.3, 0.65, 0, 0.2, 0.05, 14, 0.6, 0.6, 0.6);

	// Pillars along platform
	for (let i = -3; i <= 3; i++) {
		appendBox(positions, normals, colors, indices, 0, 2.0, i * 3.5, 0.2, 1.7, 0.2, 0.6, 0.6, 0.6);
	}

	// Ceiling
	appendBox(positions, normals, colors, indices, 0, 3.7, 0, 3.5, 0.1, 14, 0.55, 0.55, 0.55);

	// Signage board (colored strip)
	appendBox(positions, normals, colors, indices, 2.0, 2.8, 0, 0.05, 0.3, 3.0, 0.2, 0.4, 0.7);

	// Benches (recessed along back wall)
	for (let i = -2; i <= 2; i++) {
		appendBox(positions, normals, colors, indices, 2.0, 0.8, i * 2.5, 0.25, 0.04, 0.7, 0.4, 0.3, 0.2);
		appendBox(positions, normals, colors, indices, 2.0, 0.65, i * 2.5 - 0.5, 0.25, 0.14, 0.04, 0.35, 0.35, 0.35);
		appendBox(positions, normals, colors, indices, 2.0, 0.65, i * 2.5 + 0.5, 0.25, 0.14, 0.04, 0.35, 0.35, 0.35);
	}

	return buildGLB(positions, normals, colors, indices, 'station-subway-entrance');
}

function buildModernStation() {
	const positions = [], normals = [], colors = [], indices = [];

	// Wide platform
	appendBox(positions, normals, colors, indices, 0, 0.3, 0, 2.5, 0.3, 15, 0.78, 0.76, 0.73);
	// Yellow safety line
	appendBox(positions, normals, colors, indices, -2.0, 0.62, 0, 0.25, 0.02, 15, 0.95, 0.85, 0.15);
	// Curb
	appendBox(positions, normals, colors, indices, -2.3, 0.65, 0, 0.2, 0.05, 15, 0.65, 0.63, 0.60);

	// Modern canopy (angular, two-tier)
	appendBox(positions, normals, colors, indices, -0.5, 4.0, 0, 2.5, 0.06, 12, 0.85, 0.85, 0.88);
	appendBox(positions, normals, colors, indices, 0.5, 4.5, 0, 1.5, 0.06, 10, 0.85, 0.85, 0.88);

	// Angled support columns (V-shape represented as thin boxes)
	for (const zp of [-5, 0, 5]) {
		appendBox(positions, normals, colors, indices, -1.8, 2.2, zp, 0.08, 1.9, 0.08, 0.45, 0.45, 0.5);
		appendBox(positions, normals, colors, indices, 1.8, 2.4, zp, 0.08, 2.1, 0.08, 0.45, 0.45, 0.5);
	}

	// Benches (modern slab style)
	for (let i = -1; i <= 1; i++) {
		appendBox(positions, normals, colors, indices, 1.5, 0.75, i * 4, 0.4, 0.06, 0.8, 0.5, 0.5, 0.52);
		appendBox(positions, normals, colors, indices, 1.5, 0.55, i * 4, 0.08, 0.18, 0.08, 0.4, 0.4, 0.42);
	}

	// Information board
	appendBox(positions, normals, colors, indices, 2.0, 2.0, 0, 0.05, 0.5, 1.0, 0.2, 0.3, 0.5);
	// Board stand
	appendBox(positions, normals, colors, indices, 2.0, 1.1, 0, 0.04, 0.5, 0.04, 0.4, 0.4, 0.42);

	return buildGLB(positions, normals, colors, indices, 'station-modern');
}

function buildElevatedStation() {
	const positions = [], normals = [], colors = [], indices = [];

	// Support columns (base-to-platform level)
	for (const zp of [-8, -4, 0, 4, 8]) {
		appendBox(positions, normals, colors, indices, -1.5, 2.0, zp, 0.25, 2.0, 0.25, 0.55, 0.55, 0.55);
		appendBox(positions, normals, colors, indices, 1.5, 2.0, zp, 0.25, 2.0, 0.25, 0.55, 0.55, 0.55);
	}

	// Cross beams
	for (const zp of [-8, -4, 0, 4, 8]) {
		appendBox(positions, normals, colors, indices, 0, 3.8, zp, 1.5, 0.15, 0.2, 0.5, 0.5, 0.5);
	}

	// Elevated platform
	appendBox(positions, normals, colors, indices, 0, 4.2, 0, 2.2, 0.2, 10, 0.75, 0.73, 0.70);
	// Yellow safety line
	appendBox(positions, normals, colors, indices, -1.7, 4.42, 0, 0.25, 0.02, 10, 0.95, 0.85, 0.15);
	// Curb
	appendBox(positions, normals, colors, indices, -2.0, 4.45, 0, 0.15, 0.05, 10, 0.6, 0.6, 0.6);

	// Canopy on elevated level
	appendBox(positions, normals, colors, indices, 0, 7.0, 0, 2.4, 0.08, 8, 0.4, 0.5, 0.6);
	// Canopy pillars
	for (const zp of [-5, 0, 5]) {
		appendBox(positions, normals, colors, indices, 1.6, 5.7, zp, 0.08, 1.3, 0.08, 0.45, 0.45, 0.5);
	}

	// Staircase (stepped boxes)
	for (let step = 0; step < 8; step++) {
		const sy = 0.5 * step + 0.25;
		const sz = 10 + step * 0.6;
		appendBox(positions, normals, colors, indices, 0, sy, sz, 0.8, 0.25, 0.3, 0.7, 0.7, 0.7);
	}

	return buildGLB(positions, normals, colors, indices, 'station-elevated');
}

// --- Main ---

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const models = [
	{ name: 'station-platform-basic', builder: buildPlatformBasic },
	{ name: 'station-platform-covered', builder: buildPlatformCovered },
	{ name: 'station-tram-stop', builder: buildTramStop },
	{ name: 'station-subway-entrance', builder: buildSubwayEntrance },
	{ name: 'station-modern', builder: buildModernStation },
	{ name: 'station-elevated', builder: buildElevatedStation },
];

for (const { name, builder } of models) {
	const glb = builder();
	const outPath = path.join(OUTPUT_DIR, `${name}.glb`);
	fs.writeFileSync(outPath, glb);
	console.log(`Generated: ${outPath} (${glb.length} bytes)`);
}

console.log(`\nDone! ${models.length} station models generated.`);
