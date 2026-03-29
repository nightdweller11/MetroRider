export interface AnimationChannel {
	nodeIdx: number;
	path: 'translation' | 'rotation' | 'scale';
	times: Float32Array;
	values: Float32Array;
	interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
}

export interface GLTFAnimationClip {
	name: string;
	channels: AnimationChannel[];
	duration: number;
}

export interface AnimatedNodeInfo {
	nodeIdx: number;
	vertexStart: number;
	vertexCount: number;
	localPositions: Float32Array;
	localNormals: Float32Array;
}

export interface ModelTransformParams {
	scale: number;
	centerX: number;
	centerZ: number;
	minY: number;
	needsRotation: boolean;
}

type AccessorExtractor = (gltf: any, bin: ArrayBuffer, idx: number) => Float32Array | Uint16Array | Uint32Array | null;

export function parseAnimations(
	gltf: any,
	binChunk: ArrayBuffer,
	extractAccessorData: AccessorExtractor,
): GLTFAnimationClip[] {
	const animations = gltf.animations;
	if (!animations || animations.length === 0) return [];

	const clips: GLTFAnimationClip[] = [];

	for (const anim of animations) {
		const channels: AnimationChannel[] = [];
		let maxTime = 0;

		for (const channel of anim.channels || []) {
			const target = channel.target;
			if (!target || target.node === undefined) continue;

			const path = target.path as string;
			if (path !== 'translation' && path !== 'rotation' && path !== 'scale') continue;

			const samplerIdx = channel.sampler;
			const sampler = anim.samplers?.[samplerIdx];
			if (!sampler) continue;

			const times = extractAccessorData(gltf, binChunk, sampler.input);
			const values = extractAccessorData(gltf, binChunk, sampler.output);
			if (!times || !values) continue;

			const timesF32 = times instanceof Float32Array ? times : new Float32Array(times);
			const valuesF32 = values instanceof Float32Array ? values : new Float32Array(values);

			if (timesF32.length > 0) {
				const lastTime = timesF32[timesF32.length - 1];
				if (lastTime > maxTime) maxTime = lastTime;
			}

			channels.push({
				nodeIdx: target.node,
				path: path as AnimationChannel['path'],
				times: timesF32,
				values: valuesF32,
				interpolation: (sampler.interpolation || 'LINEAR') as AnimationChannel['interpolation'],
			});
		}

		if (channels.length > 0) {
			clips.push({
				name: anim.name || '',
				channels,
				duration: maxTime,
			});
		}
	}

	return clips;
}

export function findDoorAnimationIndex(
	clips: GLTFAnimationClip[],
	gltfNodes: any[],
): number {
	const doorPattern = /door/i;
	const openPattern = /open/i;

	for (let i = 0; i < clips.length; i++) {
		if (doorPattern.test(clips[i].name) || openPattern.test(clips[i].name)) {
			return i;
		}
	}

	for (let i = 0; i < clips.length; i++) {
		for (const ch of clips[i].channels) {
			const node = gltfNodes[ch.nodeIdx];
			if (node && doorPattern.test(node.name || '')) {
				return i;
			}

			if (node && hasAncestorMatching(gltfNodes, ch.nodeIdx, doorPattern)) {
				return i;
			}
		}
	}

	return -1;
}

function hasAncestorMatching(nodes: any[], nodeIdx: number, pattern: RegExp): boolean {
	for (let pi = 0; pi < nodes.length; pi++) {
		const children: number[] = nodes[pi].children || [];
		if (children.includes(nodeIdx)) {
			if (pattern.test(nodes[pi].name || '')) return true;
			return hasAncestorMatching(nodes, pi, pattern);
		}
	}
	return false;
}

function findKeyframeIndex(times: Float32Array, t: number): number {
	if (t <= times[0]) return 0;
	if (t >= times[times.length - 1]) return times.length - 2;

	for (let i = 0; i < times.length - 1; i++) {
		if (t >= times[i] && t < times[i + 1]) return i;
	}
	return times.length - 2;
}

export function sampleChannelAtTime(channel: AnimationChannel, t: number): Float32Array {
	const {times, values, path, interpolation} = channel;
	const components = path === 'rotation' ? 4 : 3;

	if (times.length === 0) return new Float32Array(components);
	if (times.length === 1 || t <= times[0]) {
		return new Float32Array(values.buffer, values.byteOffset, components);
	}
	if (t >= times[times.length - 1]) {
		const offset = (times.length - 1) * components;
		return new Float32Array(values.subarray(offset, offset + components));
	}

	const i = findKeyframeIndex(times, t);
	const i1 = Math.min(i + 1, times.length - 1);

	if (interpolation === 'STEP') {
		const offset = i * components;
		return new Float32Array(values.subarray(offset, offset + components));
	}

	const t0 = times[i];
	const t1 = times[i1];
	const alpha = t1 > t0 ? (t - t0) / (t1 - t0) : 0;

	const off0 = i * components;
	const off1 = i1 * components;

	if (path === 'rotation') {
		return quatSlerp(
			values[off0], values[off0 + 1], values[off0 + 2], values[off0 + 3],
			values[off1], values[off1 + 1], values[off1 + 2], values[off1 + 3],
			alpha,
		);
	}

	const result = new Float32Array(3);
	for (let c = 0; c < 3; c++) {
		result[c] = values[off0 + c] + (values[off1 + c] - values[off0 + c]) * alpha;
	}
	return result;
}

function quatSlerp(
	ax: number, ay: number, az: number, aw: number,
	bx: number, by: number, bz: number, bw: number,
	t: number,
): Float32Array {
	let dot = ax * bx + ay * by + az * bz + aw * bw;

	if (dot < 0) {
		bx = -bx; by = -by; bz = -bz; bw = -bw;
		dot = -dot;
	}

	if (dot > 0.9995) {
		const result = new Float32Array(4);
		result[0] = ax + (bx - ax) * t;
		result[1] = ay + (by - ay) * t;
		result[2] = az + (bz - az) * t;
		result[3] = aw + (bw - aw) * t;
		const len = Math.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2 + result[3] ** 2) || 1;
		result[0] /= len; result[1] /= len; result[2] /= len; result[3] /= len;
		return result;
	}

	const theta0 = Math.acos(dot);
	const theta = theta0 * t;
	const sinTheta = Math.sin(theta);
	const sinTheta0 = Math.sin(theta0);

	const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
	const s1 = sinTheta / sinTheta0;

	const result = new Float32Array(4);
	result[0] = s0 * ax + s1 * bx;
	result[1] = s0 * ay + s1 * by;
	result[2] = s0 * az + s1 * bz;
	result[3] = s0 * aw + s1 * bw;
	return result;
}

export function composeTRS(t: number[], r: number[] | Float32Array, s: number[], out: Float64Array): void {
	const qx = r[0], qy = r[1], qz = r[2], qw = r[3];
	const sx = s[0], sy = s[1], sz = s[2];

	const xx = qx * qx, yy = qy * qy, zz = qz * qz;
	const xy = qx * qy, xz = qx * qz, yz = qy * qz;
	const wx = qw * qx, wy = qw * qy, wz = qw * qz;

	out[0]  = (1 - 2 * (yy + zz)) * sx;
	out[1]  = (2 * (xy + wz)) * sx;
	out[2]  = (2 * (xz - wy)) * sx;
	out[3]  = 0;
	out[4]  = (2 * (xy - wz)) * sy;
	out[5]  = (1 - 2 * (xx + zz)) * sy;
	out[6]  = (2 * (yz + wx)) * sy;
	out[7]  = 0;
	out[8]  = (2 * (xz + wy)) * sz;
	out[9]  = (2 * (yz - wx)) * sz;
	out[10] = (1 - 2 * (xx + yy)) * sz;
	out[11] = 0;
	out[12] = t[0];
	out[13] = t[1];
	out[14] = t[2];
	out[15] = 1;
}

export function multiplyMat4(a: Float64Array, b: Float64Array, out: Float64Array): void {
	const r = new Float64Array(16);
	for (let row = 0; row < 4; row++) {
		for (let col = 0; col < 4; col++) {
			r[col * 4 + row] =
				a[0 * 4 + row] * b[col * 4 + 0] +
				a[1 * 4 + row] * b[col * 4 + 1] +
				a[2 * 4 + row] * b[col * 4 + 2] +
				a[3 * 4 + row] * b[col * 4 + 3];
		}
	}
	for (let i = 0; i < 16; i++) out[i] = r[i];
}

export function getAnimatedNodeIndices(clips: GLTFAnimationClip[]): Set<number> {
	const indices = new Set<number>();
	for (const clip of clips) {
		for (const ch of clip.channels) {
			indices.add(ch.nodeIdx);
		}
	}
	return indices;
}

export function detectAnimTimeRange(clip: GLTFAnimationClip): {startTime: number; endTime: number} {
	let minTime = Infinity;
	for (const ch of clip.channels) {
		if (ch.times.length > 0 && ch.times[0] < minTime) {
			minTime = ch.times[0];
		}
	}
	if (minTime === Infinity) minTime = 0;

	const EPSILON = 0.001;
	let isFullCycle = true;

	for (const ch of clip.channels) {
		const {times, values, path} = ch;
		if (times.length < 2) continue;

		const components = path === 'rotation' ? 4 : 3;
		const firstOffset = 0;
		const lastOffset = (times.length - 1) * components;

		let diff = 0;
		for (let c = 0; c < components; c++) {
			const d = values[firstOffset + c] - values[lastOffset + c];
			diff += d * d;
		}

		if (Math.sqrt(diff) > EPSILON) {
			isFullCycle = false;
			break;
		}
	}

	if (!isFullCycle) return {startTime: minTime, endTime: clip.duration};

	let maxDisplacement = 0;
	let peakTime = (minTime + clip.duration) / 2;

	for (const ch of clip.channels) {
		const {times, values, path} = ch;
		if (times.length < 3) continue;

		const components = path === 'rotation' ? 4 : 3;

		for (let i = 1; i < times.length - 1; i++) {
			let disp = 0;
			for (let c = 0; c < components; c++) {
				const d = values[i * components + c] - values[c];
				disp += d * d;
			}
			if (disp > maxDisplacement) {
				maxDisplacement = disp;
				peakTime = times[i];
			}
		}
	}

	return {startTime: minTime, endTime: peakTime};
}
