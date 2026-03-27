/**
 * Generates raw vertex/index buffers for train cars, rails, sleepers, and station platforms.
 * No Three.js - just typed arrays ready for the GPU.
 */

export interface GeometryBuffers {
	position: Float32Array;
	normal: Float32Array;
	color: Float32Array;
	indices: Uint32Array;
}

function hexToRGB(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [
		parseInt(h.substring(0, 2), 16) / 255,
		parseInt(h.substring(2, 4), 16) / 255,
		parseInt(h.substring(4, 6), 16) / 255,
	];
}

function appendBox(
	positions: number[], normals: number[], colors: number[], indices: number[],
	cx: number, cy: number, cz: number,
	sx: number, sy: number, sz: number,
	r: number, g: number, b: number,
): void {
	appendOrientedBox(
		positions, normals, colors, indices,
		cx, cy, cz,
		1, 0, 0,
		0, 1, 0,
		0, 0, 1,
		sx, sy, sz,
		r, g, b,
	);
}

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

export function buildTrainCarGeometry(colorHex: string): GeometryBuffers {
	const [r, g, b] = hexToRGB(colorHex);
	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];

	const CAR_LENGTH = 20;
	const CAR_WIDTH = 3.2;
	const CAR_HEIGHT = 3.8;
	const CAR_Y = 1.5;
	const BOGIE_GAP = 1.5;

	for (let carIdx = 0; carIdx < 3; carIdx++) {
		const cz = (carIdx - 1) * (CAR_LENGTH + BOGIE_GAP);

		appendBox(positions, normals, colors, indices,
			0, CAR_Y + CAR_HEIGHT / 2, cz,
			CAR_WIDTH, CAR_HEIGHT, CAR_LENGTH,
			r, g, b);

		const roofDarken = 0.7;
		appendBox(positions, normals, colors, indices,
			0, CAR_Y + CAR_HEIGHT + 0.1, cz,
			CAR_WIDTH + 0.05, 0.2, CAR_LENGTH,
			r * roofDarken, g * roofDarken, b * roofDarken);

		const windowColor = [0.7, 0.85, 0.95];
		const windowSpacing = 2.5;
		const windowCount = 6;
		for (let wi = 0; wi < windowCount; wi++) {
			const wz = cz - (windowCount - 1) * windowSpacing / 2 + wi * windowSpacing;
			for (const side of [-1, 1]) {
				appendBox(positions, normals, colors, indices,
					side * (CAR_WIDTH / 2 + 0.02), CAR_Y + CAR_HEIGHT * 0.55, wz,
					0.05, 1.2, 1.5,
					windowColor[0], windowColor[1], windowColor[2]);
			}
		}

		const bogieColor = [0.3, 0.3, 0.3];
		for (const bz of [cz - 6, cz + 6]) {
			appendBox(positions, normals, colors, indices,
				0, 0.5, bz, 2.4, 0.6, 3.0,
				bogieColor[0], bogieColor[1], bogieColor[2]);

			for (const woff of [-1, 1]) {
				for (const wside of [-1, 1]) {
					appendBox(positions, normals, colors, indices,
						wside * 1.3, 0.4, bz + woff * 1.0,
						0.3, 0.8, 0.8,
						0.15, 0.15, 0.15);
				}
			}
		}
	}

	return {
		position: new Float32Array(positions),
		normal: new Float32Array(normals),
		color: new Float32Array(colors),
		indices: new Uint32Array(indices),
	};
}

export function buildTrackGeometry(
	points: Float32Array,
	segCount: number,
): GeometryBuffers {
	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];

	const RAIL_GAUGE = 1.435;
	const RAIL_HALF = RAIL_GAUGE / 2;
	const RAIL_WIDTH = 0.15;
	const RAIL_HEIGHT = 0.3;
	const SLEEPER_SPACING = 0.6;
	const SLEEPER_LENGTH = 2.6;
	const SLEEPER_WIDTH = 0.22;
	const SLEEPER_HEIGHT = 0.25;
	const BALLAST_WIDTH = 2.8;
	const BALLAST_HEIGHT = 0.05;

	const railColor: [number, number, number] = [0.4, 0.42, 0.45];
	const sleeperColor: [number, number, number] = [0.42, 0.32, 0.18];
	const ballastColor: [number, number, number] = [0.35, 0.3, 0.25];

	const SEGMENT_GAP = 0.02;

	let totalDist = 0;
	let nextSleeperDist = 0;

	for (let i = 0; i < segCount - 1; i++) {
		const x0 = points[i * 3], y0 = points[i * 3 + 1], z0 = points[i * 3 + 2];
		const x1 = points[(i + 1) * 3], y1 = points[(i + 1) * 3 + 1], z1 = points[(i + 1) * 3 + 2];

		const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
		const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (segLen < 0.001) {
			totalDist += segLen;
			continue;
		}

		const fx = dx / segLen, fy = dy / segLen, fz = dz / segLen;
		let rx = -fz, rz = fx;
		const rLen = Math.sqrt(rx * rx + rz * rz);
		if (rLen > 0.001) { rx /= rLen; rz /= rLen; }
		else { rx = 1; rz = 0; }

		const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;
		const drawLen = Math.max(segLen - SEGMENT_GAP, 0.01);

		appendOrientedBox(positions, normals, colors, indices,
			mx, my + BALLAST_HEIGHT / 2, mz,
			rx, 0, rz,
			0, 1, 0,
			fx, fy, fz,
			BALLAST_WIDTH, BALLAST_HEIGHT, drawLen,
			ballastColor[0], ballastColor[1], ballastColor[2]);

		appendOrientedBox(positions, normals, colors, indices,
			mx + rx * RAIL_HALF, my + BALLAST_HEIGHT + RAIL_HEIGHT / 2, mz + rz * RAIL_HALF,
			rx, 0, rz,
			0, 1, 0,
			fx, fy, fz,
			RAIL_WIDTH, RAIL_HEIGHT, drawLen,
			railColor[0], railColor[1], railColor[2]);

		appendOrientedBox(positions, normals, colors, indices,
			mx - rx * RAIL_HALF, my + BALLAST_HEIGHT + RAIL_HEIGHT / 2, mz - rz * RAIL_HALF,
			rx, 0, rz,
			0, 1, 0,
			fx, fy, fz,
			RAIL_WIDTH, RAIL_HEIGHT, drawLen,
			railColor[0], railColor[1], railColor[2]);

		while (nextSleeperDist <= totalDist + segLen) {
			const t = (nextSleeperDist - totalDist) / segLen;
			if (t > 0 && t <= 1) {
				const spx = x0 + dx * t;
				const spy = y0 + dy * t;
				const spz = z0 + dz * t;

				appendOrientedBox(positions, normals, colors, indices,
					spx, spy + BALLAST_HEIGHT + SLEEPER_HEIGHT / 2, spz,
					rx, 0, rz,
					0, 1, 0,
					fx, fy, fz,
					SLEEPER_LENGTH, SLEEPER_HEIGHT, SLEEPER_WIDTH,
					sleeperColor[0], sleeperColor[1], sleeperColor[2]);
			}
			nextSleeperDist += SLEEPER_SPACING;
		}

		totalDist += segLen;
	}

	return {
		position: new Float32Array(positions),
		normal: new Float32Array(normals),
		color: new Float32Array(colors),
		indices: new Uint32Array(indices),
	};
}

export function buildStationGeometry(
	x: number, y: number, z: number,
	heading: number,
	colorHex: string,
): GeometryBuffers {
	const [r, g, b] = hexToRGB(colorHex);
	const positions: number[] = [];
	const normals: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];

	const cosH = Math.cos(heading);
	const sinH = Math.sin(heading);
	const fwdX = sinH, fwdZ = cosH;
	const rightX = cosH, rightZ = -sinH;

	const PLATFORM_LENGTH = 40;
	const PLATFORM_WIDTH = 4;
	const PLATFORM_HEIGHT = 0.6;

	// Platform slab (concrete)
	appendOrientedBox(positions, normals, colors, indices,
		x, y + PLATFORM_HEIGHT / 2, z,
		rightX, 0, rightZ,
		0, 1, 0,
		fwdX, 0, fwdZ,
		PLATFORM_WIDTH, PLATFORM_HEIGHT, PLATFORM_LENGTH,
		0.75, 0.73, 0.70);

	// Yellow safety line along the track-side edge
	const safetyLineOffset = -PLATFORM_WIDTH / 2 + 0.3;
	appendOrientedBox(positions, normals, colors, indices,
		x + rightX * safetyLineOffset, y + PLATFORM_HEIGHT + 0.02, z + rightZ * safetyLineOffset,
		rightX, 0, rightZ,
		0, 1, 0,
		fwdX, 0, fwdZ,
		0.5, 0.04, PLATFORM_LENGTH,
		0.95, 0.85, 0.15);

	// Line color stripe along the outer edge
	const stripeOffset = PLATFORM_WIDTH / 2 - 0.2;
	appendOrientedBox(positions, normals, colors, indices,
		x + rightX * stripeOffset, y + PLATFORM_HEIGHT + 0.02, z + rightZ * stripeOffset,
		rightX, 0, rightZ,
		0, 1, 0,
		fwdX, 0, fwdZ,
		0.3, 0.04, PLATFORM_LENGTH,
		r, g, b);

	// Canopy (covers center ~60% of platform)
	const CANOPY_HEIGHT = 3.5;
	const CANOPY_WIDTH = PLATFORM_WIDTH + 0.8;
	const CANOPY_LENGTH = PLATFORM_LENGTH * 0.55;

	appendOrientedBox(positions, normals, colors, indices,
		x, y + CANOPY_HEIGHT, z,
		rightX, 0, rightZ,
		0, 1, 0,
		fwdX, 0, fwdZ,
		CANOPY_WIDTH, 0.12, CANOPY_LENGTH,
		r * 0.7, g * 0.7, b * 0.7);

	// Canopy support pillars (4 pillars along the outer edge)
	const pillarEdge = PLATFORM_WIDTH / 2 - 0.2;
	const pillarSpacing = CANOPY_LENGTH / 2 - 1.5;
	const pillarPositions: [number, number][] = [
		[pillarEdge, -pillarSpacing], [pillarEdge, pillarSpacing],
		[pillarEdge, -pillarSpacing * 0.4], [pillarEdge, pillarSpacing * 0.4],
	];
	for (const [rOff, fOff] of pillarPositions) {
		const px = x + rightX * rOff + fwdX * fOff;
		const pz = z + rightZ * rOff + fwdZ * fOff;
		appendOrientedBox(positions, normals, colors, indices,
			px, y + (CANOPY_HEIGHT + PLATFORM_HEIGHT) / 2, pz,
			rightX, 0, rightZ,
			0, 1, 0,
			fwdX, 0, fwdZ,
			0.15, CANOPY_HEIGHT - PLATFORM_HEIGHT, 0.15,
			0.45, 0.45, 0.45);
	}

	// Benches (3 along the platform, on the outer half)
	const benchOffset = PLATFORM_WIDTH / 2 - 0.8;
	const benchSpacing = CANOPY_LENGTH * 0.35;
	for (let bi = -1; bi <= 1; bi++) {
		const bx = x + rightX * benchOffset + fwdX * (bi * benchSpacing);
		const bz = z + rightZ * benchOffset + fwdZ * (bi * benchSpacing);
		// Seat
		appendOrientedBox(positions, normals, colors, indices,
			bx, y + PLATFORM_HEIGHT + 0.4, bz,
			rightX, 0, rightZ,
			0, 1, 0,
			fwdX, 0, fwdZ,
			0.5, 0.06, 1.8,
			0.35, 0.25, 0.15);
		// Backrest
		appendOrientedBox(positions, normals, colors, indices,
			bx + rightX * 0.2, y + PLATFORM_HEIGHT + 0.6, bz + rightZ * 0.2,
			rightX, 0, rightZ,
			0, 1, 0,
			fwdX, 0, fwdZ,
			0.06, 0.35, 1.8,
			0.35, 0.25, 0.15);
		// Legs (2)
		for (const legOff of [-0.7, 0.7]) {
			const lx = bx + fwdX * legOff;
			const lz = bz + fwdZ * legOff;
			appendOrientedBox(positions, normals, colors, indices,
				lx, y + PLATFORM_HEIGHT + 0.2, lz,
				rightX, 0, rightZ,
				0, 1, 0,
				fwdX, 0, fwdZ,
				0.5, 0.4, 0.06,
				0.3, 0.3, 0.3);
		}
	}

	// Platform edge curb (slightly raised track-side edge)
	const curbOffset = -PLATFORM_WIDTH / 2 + 0.1;
	appendOrientedBox(positions, normals, colors, indices,
		x + rightX * curbOffset, y + PLATFORM_HEIGHT + 0.06, z + rightZ * curbOffset,
		rightX, 0, rightZ,
		0, 1, 0,
		fwdX, 0, fwdZ,
		0.15, 0.12, PLATFORM_LENGTH,
		0.65, 0.63, 0.60);

	return {
		position: new Float32Array(positions),
		normal: new Float32Array(normals),
		color: new Float32Array(colors),
		indices: new Uint32Array(indices),
	};
}
