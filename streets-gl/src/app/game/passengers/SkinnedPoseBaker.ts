/**
 * CPU skinning for platform crowds.
 *
 * The renderer bakes vertex positions once and draws them with a plain
 * material — there is no skinning on the GPU. A rigged character therefore
 * renders in its BIND POSE, which for a game-ready human is a T-pose: arms
 * straight out, standing on a platform. Unusable.
 *
 * Rather than add GPU skinning (a new material, a joint-matrix upload path and
 * a per-frame cost for hundreds of figures), this bakes a handful of POSES
 * off-line — the skinning is done once per pose, at load — and the crowd
 * renderer picks a pose per person per frame. Eight poses of a walk cycle at
 * five rebuilds a second reads as motion, and the draw path stays exactly the
 * same one merged mesh per platform.
 */

export interface SkinSource {
	/** Per-vertex joint indices, 4 per vertex. */
	joints: Uint16Array;
	/** Per-vertex weights, 4 per vertex. */
	weights: Float32Array;
	/** Bind-pose positions, 3 per vertex. */
	position: Float32Array;
	/** Bind-pose normals, 3 per vertex. */
	normal: Float32Array;
	/** 16 floats per joint, column-major (glTF order). */
	inverseBindMatrices: Float32Array;
	/** For each joint, its node index. */
	jointNodes: number[];
	/** Local TRS of every node in the file. */
	nodeTRS: {t: number[]; r: number[]; s: number[]}[];
	/** parent[i] = parent node index, or -1. */
	parents: Int32Array;
}

export interface PoseSampler {
	/**
	 * Local TRS for `nodeIndex` at `time`, or null to use the node's rest pose.
	 */
	sample(nodeIndex: number, time: number): {t: number[]; r: number[]; s: number[]} | null;
	/** Clip length in seconds. */
	duration: number;
}

export interface BakedPose {
	position: Float32Array;
	normal: Float32Array;
}

function trsToMatrix(t: number[], r: number[], s: number[], out: Float64Array): void {
	const [x, y, z, w] = r;
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2;
	const yy = y * y2, yz = y * z2, zz = z * z2;
	const wx = w * x2, wy = w * y2, wz = w * z2;

	out[0] = (1 - (yy + zz)) * s[0];
	out[1] = (xy + wz) * s[0];
	out[2] = (xz - wy) * s[0];
	out[3] = 0;
	out[4] = (xy - wz) * s[1];
	out[5] = (1 - (xx + zz)) * s[1];
	out[6] = (yz + wx) * s[1];
	out[7] = 0;
	out[8] = (xz + wy) * s[2];
	out[9] = (yz - wx) * s[2];
	out[10] = (1 - (xx + yy)) * s[2];
	out[11] = 0;
	out[12] = t[0];
	out[13] = t[1];
	out[14] = t[2];
	out[15] = 1;
}

function multiply(a: Float64Array, b: Float64Array, out: Float64Array): void {
	for (let c = 0; c < 4; c++) {
		const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
		out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
		out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
		out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
		out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
	}
}

/**
 * World matrix of every node at `time`, resolved parent-first.
 *
 * glTF requires a node to appear after nothing in particular, so the walk is
 * done by resolving each node's ancestor chain on demand and memoising it —
 * cheap for the ~90-node skeletons these characters use.
 */
export function computeNodeMatrices(
	source: SkinSource,
	sampler: PoseSampler | null,
	time: number,
): Float64Array[] {
	const count = source.nodeTRS.length;
	const local: Float64Array[] = new Array(count);
	const world: (Float64Array | null)[] = new Array(count).fill(null);

	for (let i = 0; i < count; i++) {
		const animated = sampler?.sample(i, time) ?? null;
		const trs = animated ?? source.nodeTRS[i];
		const m = new Float64Array(16);
		trsToMatrix(trs.t, trs.r, trs.s, m);
		local[i] = m;
	}

	const resolve = (index: number): Float64Array => {
		const cached = world[index];
		if (cached) return cached;

		const parent = source.parents[index];
		let m: Float64Array;
		if (parent < 0 || parent >= count) {
			m = local[index];
		} else {
			m = new Float64Array(16);
			multiply(resolve(parent), local[index], m);
		}
		world[index] = m;
		return m;
	};

	const result: Float64Array[] = new Array(count);
	for (let i = 0; i < count; i++) result[i] = resolve(i);
	return result;
}

/**
 * Skin the bind-pose mesh into one pose. Linear blend skinning:
 * `p' = Σ wᵢ · (jointWorldᵢ · inverseBindᵢ) · p`.
 */
export function bakePose(source: SkinSource, sampler: PoseSampler | null, time: number): BakedPose {
	const nodeMatrices = computeNodeMatrices(source, sampler, time);
	const jointCount = source.jointNodes.length;

	// Skinning matrix per joint, in the same order the vertex indices use.
	const skinMatrices: Float64Array[] = new Array(jointCount);
	const inverseBind = new Float64Array(16);
	for (let j = 0; j < jointCount; j++) {
		for (let k = 0; k < 16; k++) inverseBind[k] = source.inverseBindMatrices[j * 16 + k];
		const world = nodeMatrices[source.jointNodes[j]] ?? nodeMatrices[0];
		const m = new Float64Array(16);
		multiply(world, inverseBind, m);
		skinMatrices[j] = m;
	}

	const vertexCount = source.position.length / 3;
	const position = new Float32Array(source.position.length);
	const normal = new Float32Array(source.normal.length);

	for (let v = 0; v < vertexCount; v++) {
		const px = source.position[v * 3];
		const py = source.position[v * 3 + 1];
		const pz = source.position[v * 3 + 2];
		const nx = source.normal[v * 3] ?? 0;
		const ny = source.normal[v * 3 + 1] ?? 1;
		const nz = source.normal[v * 3 + 2] ?? 0;

		let ox = 0, oy = 0, oz = 0;
		let onx = 0, ony = 0, onz = 0;
		let totalWeight = 0;

		for (let i = 0; i < 4; i++) {
			const w = source.weights[v * 4 + i];
			if (w <= 0) continue;
			const m = skinMatrices[source.joints[v * 4 + i]];
			if (!m) continue;
			totalWeight += w;

			ox += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
			oy += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
			oz += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);

			// Normals ignore translation; scale is assumed uniform, which holds
			// for character rigs and saves inverting a matrix per joint.
			onx += w * (m[0] * nx + m[4] * ny + m[8] * nz);
			ony += w * (m[1] * nx + m[5] * ny + m[9] * nz);
			onz += w * (m[2] * nx + m[6] * ny + m[10] * nz);
		}

		// An unweighted vertex belongs to the mesh root, not to nowhere.
		if (totalWeight <= 0) {
			position[v * 3] = px;
			position[v * 3 + 1] = py;
			position[v * 3 + 2] = pz;
			normal[v * 3] = nx;
			normal[v * 3 + 1] = ny;
			normal[v * 3 + 2] = nz;
			continue;
		}

		position[v * 3] = ox;
		position[v * 3 + 1] = oy;
		position[v * 3 + 2] = oz;

		const len = Math.hypot(onx, ony, onz) || 1;
		normal[v * 3] = onx / len;
		normal[v * 3 + 1] = ony / len;
		normal[v * 3 + 2] = onz / len;
	}

	return {position, normal};
}

/** Bake `count` evenly spaced poses across one loop of the clip. */
export function bakePoseCycle(source: SkinSource, sampler: PoseSampler, count: number): BakedPose[] {
	const poses: BakedPose[] = [];
	const n = Math.max(1, count);
	for (let i = 0; i < n; i++) {
		poses.push(bakePose(source, sampler, (i / n) * sampler.duration));
	}
	return poses;
}
