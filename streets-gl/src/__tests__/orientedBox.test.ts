/**
 * Tests for appendOrientedBox geometry correctness.
 * Verifies that oriented boxes produce correct vertices and normals
 * for axis-aligned and rotated configurations.
 */

function appendOrientedBox(
	positions: number[], normals: number[], colors: number[], indices: number[],
	cx: number, cy: number, cz: number,
	rightX: number, rightY: number, rightZ: number,
	upX: number, upY: number, upZ: number,
	fwdX: number, fwdY: number, fwdZ: number,
	width: number, height: number, depth: number,
	r: number, g: number, b: number,
): void {
	const hw = width / 2, hh = height / 2, hd = depth / 2;

	const faces: {n: number[]; corners: number[][]}[] = [
		{n: [fwdX, fwdY, fwdZ], corners: [
			[cx - hw * rightX - hh * upX + hd * fwdX, cy - hw * rightY - hh * upY + hd * fwdY, cz - hw * rightZ - hh * upZ + hd * fwdZ],
			[cx + hw * rightX - hh * upX + hd * fwdX, cy + hw * rightY - hh * upY + hd * fwdY, cz + hw * rightZ - hh * upZ + hd * fwdZ],
			[cx + hw * rightX + hh * upX + hd * fwdX, cy + hw * rightY + hh * upY + hd * fwdY, cz + hw * rightZ + hh * upZ + hd * fwdZ],
			[cx - hw * rightX + hh * upX + hd * fwdX, cy - hw * rightY + hh * upY + hd * fwdY, cz - hw * rightZ + hh * upZ + hd * fwdZ],
		]},
		{n: [-fwdX, -fwdY, -fwdZ], corners: [
			[cx + hw * rightX - hh * upX - hd * fwdX, cy + hw * rightY - hh * upY - hd * fwdY, cz + hw * rightZ - hh * upZ - hd * fwdZ],
			[cx - hw * rightX - hh * upX - hd * fwdX, cy - hw * rightY - hh * upY - hd * fwdY, cz - hw * rightZ - hh * upZ - hd * fwdZ],
			[cx - hw * rightX + hh * upX - hd * fwdX, cy - hw * rightY + hh * upY - hd * fwdY, cz - hw * rightZ + hh * upZ - hd * fwdZ],
			[cx + hw * rightX + hh * upX - hd * fwdX, cy + hw * rightY + hh * upY - hd * fwdY, cz + hw * rightZ + hh * upZ - hd * fwdZ],
		]},
		{n: [upX, upY, upZ], corners: [
			[cx - hw * rightX + hh * upX + hd * fwdX, cy - hw * rightY + hh * upY + hd * fwdY, cz - hw * rightZ + hh * upZ + hd * fwdZ],
			[cx + hw * rightX + hh * upX + hd * fwdX, cy + hw * rightY + hh * upY + hd * fwdY, cz + hw * rightZ + hh * upZ + hd * fwdZ],
			[cx + hw * rightX + hh * upX - hd * fwdX, cy + hw * rightY + hh * upY - hd * fwdY, cz + hw * rightZ + hh * upZ - hd * fwdZ],
			[cx - hw * rightX + hh * upX - hd * fwdX, cy - hw * rightY + hh * upY - hd * fwdY, cz - hw * rightZ + hh * upZ - hd * fwdZ],
		]},
		{n: [-upX, -upY, -upZ], corners: [
			[cx - hw * rightX - hh * upX - hd * fwdX, cy - hw * rightY - hh * upY - hd * fwdY, cz - hw * rightZ - hh * upZ - hd * fwdZ],
			[cx + hw * rightX - hh * upX - hd * fwdX, cy + hw * rightY - hh * upY - hd * fwdY, cz + hw * rightZ - hh * upZ - hd * fwdZ],
			[cx + hw * rightX - hh * upX + hd * fwdX, cy + hw * rightY - hh * upY + hd * fwdY, cz + hw * rightZ - hh * upZ + hd * fwdZ],
			[cx - hw * rightX - hh * upX + hd * fwdX, cy - hw * rightY - hh * upY + hd * fwdY, cz - hw * rightZ - hh * upZ + hd * fwdZ],
		]},
		{n: [rightX, rightY, rightZ], corners: [
			[cx + hw * rightX - hh * upX + hd * fwdX, cy + hw * rightY - hh * upY + hd * fwdY, cz + hw * rightZ - hh * upZ + hd * fwdZ],
			[cx + hw * rightX - hh * upX - hd * fwdX, cy + hw * rightY - hh * upY - hd * fwdY, cz + hw * rightZ - hh * upZ - hd * fwdZ],
			[cx + hw * rightX + hh * upX - hd * fwdX, cy + hw * rightY + hh * upY - hd * fwdY, cz + hw * rightZ + hh * upZ - hd * fwdZ],
			[cx + hw * rightX + hh * upX + hd * fwdX, cy + hw * rightY + hh * upY + hd * fwdY, cz + hw * rightZ + hh * upZ + hd * fwdZ],
		]},
		{n: [-rightX, -rightY, -rightZ], corners: [
			[cx - hw * rightX - hh * upX - hd * fwdX, cy - hw * rightY - hh * upY - hd * fwdY, cz - hw * rightZ - hh * upZ - hd * fwdZ],
			[cx - hw * rightX - hh * upX + hd * fwdX, cy - hw * rightY - hh * upY + hd * fwdY, cz - hw * rightZ - hh * upZ + hd * fwdZ],
			[cx - hw * rightX + hh * upX + hd * fwdX, cy - hw * rightY + hh * upY + hd * fwdY, cz - hw * rightZ + hh * upZ + hd * fwdZ],
			[cx - hw * rightX + hh * upX - hd * fwdX, cy - hw * rightY + hh * upY - hd * fwdY, cz - hw * rightZ + hh * upZ - hd * fwdZ],
		]},
	];

	for (const face of faces) {
		const vi = positions.length / 3;
		for (const v of face.corners) {
			positions.push(v[0], v[1], v[2]);
			normals.push(face.n[0], face.n[1], face.n[2]);
			colors.push(r, g, b);
		}
		indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
	}
}

describe('appendOrientedBox', () => {
	test('axis-aligned box produces 24 vertices and 36 indices', () => {
		const pos: number[] = [], norms: number[] = [], cols: number[] = [], idx: number[] = [];
		appendOrientedBox(pos, norms, cols, idx,
			0, 0, 0,
			1, 0, 0,
			0, 1, 0,
			0, 0, 1,
			2, 4, 6,
			1, 0, 0);

		expect(pos.length / 3).toBe(24);
		expect(norms.length / 3).toBe(24);
		expect(cols.length / 3).toBe(24);
		expect(idx.length).toBe(36);
	});

	test('axis-aligned box vertices stay within expected bounds', () => {
		const pos: number[] = [], norms: number[] = [], cols: number[] = [], idx: number[] = [];
		const cx = 10, cy = 5, cz = 20;
		const w = 4, h = 6, d = 8;
		appendOrientedBox(pos, norms, cols, idx,
			cx, cy, cz,
			1, 0, 0,
			0, 1, 0,
			0, 0, 1,
			w, h, d,
			0.5, 0.5, 0.5);

		for (let i = 0; i < pos.length; i += 3) {
			const x = pos[i], y = pos[i + 1], z = pos[i + 2];
			expect(x).toBeGreaterThanOrEqual(cx - w / 2 - 0.001);
			expect(x).toBeLessThanOrEqual(cx + w / 2 + 0.001);
			expect(y).toBeGreaterThanOrEqual(cy - h / 2 - 0.001);
			expect(y).toBeLessThanOrEqual(cy + h / 2 + 0.001);
			expect(z).toBeGreaterThanOrEqual(cz - d / 2 - 0.001);
			expect(z).toBeLessThanOrEqual(cz + d / 2 + 0.001);
		}
	});

	test('all normals are unit length', () => {
		const pos: number[] = [], norms: number[] = [], cols: number[] = [], idx: number[] = [];
		appendOrientedBox(pos, norms, cols, idx,
			0, 0, 0,
			1, 0, 0,
			0, 1, 0,
			0, 0, 1,
			2, 3, 4,
			1, 1, 1);

		for (let i = 0; i < norms.length; i += 3) {
			const len = Math.sqrt(norms[i] ** 2 + norms[i + 1] ** 2 + norms[i + 2] ** 2);
			expect(len).toBeCloseTo(1.0, 4);
		}
	});

	test('rotated 45-degree box has correct extents', () => {
		const pos: number[] = [], norms: number[] = [], cols: number[] = [], idx: number[] = [];
		const a = Math.PI / 4;
		const cosA = Math.cos(a), sinA = Math.sin(a);

		appendOrientedBox(pos, norms, cols, idx,
			0, 0, 0,
			cosA, 0, sinA,
			0, 1, 0,
			-sinA, 0, cosA,
			2, 2, 2,
			1, 0, 0);

		let maxDist = 0;
		for (let i = 0; i < pos.length; i += 3) {
			const x = pos[i], z = pos[i + 2];
			const dist = Math.sqrt(x * x + z * z);
			maxDist = Math.max(maxDist, dist);
		}
		// For a 2x2x2 cube rotated 45 deg, corner in XZ plane is at sqrt(2)
		expect(maxDist).toBeCloseTo(Math.sqrt(2), 3);
	});

	test('forward-aligned box extends along forward axis', () => {
		const pos: number[] = [], norms: number[] = [], cols: number[] = [], idx: number[] = [];
		// Forward = +X (rotated 90 from default)
		appendOrientedBox(pos, norms, cols, idx,
			0, 0, 0,
			0, 0, 1,   // right = +Z
			0, 1, 0,   // up = +Y
			1, 0, 0,   // forward = +X
			1, 1, 10,  // width=1, height=1, depth(along forward)=10
			1, 1, 1);

		let minX = Infinity, maxX = -Infinity;
		let minZ = Infinity, maxZ = -Infinity;
		for (let i = 0; i < pos.length; i += 3) {
			minX = Math.min(minX, pos[i]);
			maxX = Math.max(maxX, pos[i]);
			minZ = Math.min(minZ, pos[i + 2]);
			maxZ = Math.max(maxZ, pos[i + 2]);
		}

		expect(maxX - minX).toBeCloseTo(10, 3);
		expect(maxZ - minZ).toBeCloseTo(1, 3);
	});

	test('all face normals point outward (dot with center-to-face > 0)', () => {
		const pos: number[] = [], norms: number[] = [], cols: number[] = [], idx: number[] = [];
		const cx = 5, cy = 3, cz = 7;
		appendOrientedBox(pos, norms, cols, idx,
			cx, cy, cz,
			1, 0, 0,
			0, 1, 0,
			0, 0, 1,
			4, 4, 4,
			1, 1, 1);

		// 6 faces, 4 vertices each. For each face, the normal should point
		// away from center (dot of face-center-to-normal with normal > 0)
		for (let face = 0; face < 6; face++) {
			const baseIdx = face * 4;
			let fcx = 0, fcy = 0, fcz = 0;
			for (let v = 0; v < 4; v++) {
				fcx += pos[(baseIdx + v) * 3];
				fcy += pos[(baseIdx + v) * 3 + 1];
				fcz += pos[(baseIdx + v) * 3 + 2];
			}
			fcx /= 4; fcy /= 4; fcz /= 4;

			const nx = norms[baseIdx * 3];
			const ny = norms[baseIdx * 3 + 1];
			const nz = norms[baseIdx * 3 + 2];

			const dot = (fcx - cx) * nx + (fcy - cy) * ny + (fcz - cz) * nz;
			expect(dot).toBeGreaterThan(0);
		}
	});

	test('colors are correctly assigned to all vertices', () => {
		const pos: number[] = [], norms: number[] = [], cols: number[] = [], idx: number[] = [];
		appendOrientedBox(pos, norms, cols, idx,
			0, 0, 0,
			1, 0, 0, 0, 1, 0, 0, 0, 1,
			2, 2, 2,
			0.3, 0.6, 0.9);

		for (let i = 0; i < cols.length; i += 3) {
			expect(cols[i]).toBeCloseTo(0.3, 5);
			expect(cols[i + 1]).toBeCloseTo(0.6, 5);
			expect(cols[i + 2]).toBeCloseTo(0.9, 5);
		}
	});
});
