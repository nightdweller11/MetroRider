import {SkinSource, PoseSampler, bakePoseCycle, BakedPose} from './SkinnedPoseBaker';
import {PERSON_HEIGHT} from './PersonGeometry';

/**
 * Loads a rigged character GLB into poses the crowd renderer can draw.
 *
 * The renderer has no skinning and no textures on this material, so this does
 * both jobs on the CPU, once, at load: it reads the skin, bakes N poses of a
 * chosen clip (see SkinnedPoseBaker), and turns the character's base-colour
 * texture into per-vertex colours by sampling it at each vertex's UV. A
 * character reduced to a single average colour is a beige blob; sampling per
 * vertex is what keeps the shirt, the skin and the hair distinguishable.
 */

export interface LoadedCharacter {
	/** One entry per baked pose; all share the index buffer and colours. */
	poses: BakedPose[];
	color: Float32Array;
	indices: Uint32Array;
}

/** Clips worth standing on a platform with, best first. */
const PREFERRED_CLIPS = ['idle', 'stand', 'wait', 'walk', 'walking'];

interface Gltf {
	nodes?: {
		mesh?: number; skin?: number; children?: number[];
		translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[];
	}[];
	meshes?: {primitives: {attributes: Record<string, number>; indices?: number; material?: number}[]}[];
	skins?: {joints: number[]; inverseBindMatrices?: number}[];
	animations?: {
		name?: string;
		channels: {sampler: number; target: {node?: number; path: string}}[];
		samplers: {input: number; output: number; interpolation?: string}[];
	}[];
	accessors?: {bufferView?: number; componentType: number; count: number; type: string; byteOffset?: number}[];
	bufferViews?: {buffer: number; byteOffset?: number; byteLength: number; byteStride?: number}[];
	materials?: {pbrMetallicRoughness?: {baseColorTexture?: {index: number}; baseColorFactor?: number[]}}[];
	textures?: {source?: number}[];
	images?: {bufferView?: number; mimeType?: string; uri?: string}[];
}

const COMPONENT_SIZE: Record<number, number> = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
const TYPE_COUNT: Record<string, number> = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16};

function readAccessor(gltf: Gltf, bin: ArrayBuffer, index: number): Float32Array | Uint32Array | null {
	const accessor = gltf.accessors?.[index];
	if (!accessor || accessor.bufferView === undefined) return null;
	const view = gltf.bufferViews?.[accessor.bufferView];
	if (!view) return null;

	const comps = TYPE_COUNT[accessor.type] ?? 1;
	const compSize = COMPONENT_SIZE[accessor.componentType] ?? 4;
	const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	const stride = view.byteStride && view.byteStride > 0 ? view.byteStride : comps * compSize;
	const dv = new DataView(bin);

	const float = accessor.componentType === 5126;
	const out = float ? new Float32Array(accessor.count * comps) : new Uint32Array(accessor.count * comps);

	for (let i = 0; i < accessor.count; i++) {
		for (let c = 0; c < comps; c++) {
			const at = base + i * stride + c * compSize;
			if (at + compSize > bin.byteLength) return out;
			switch (accessor.componentType) {
				case 5126: out[i * comps + c] = dv.getFloat32(at, true); break;
				case 5125: out[i * comps + c] = dv.getUint32(at, true); break;
				case 5123: out[i * comps + c] = dv.getUint16(at, true); break;
				case 5121: out[i * comps + c] = dv.getUint8(at); break;
				case 5122: out[i * comps + c] = dv.getInt16(at, true); break;
				case 5120: out[i * comps + c] = dv.getInt8(at); break;
				default: break;
			}
		}
	}
	return out;
}

function parseGlb(buffer: ArrayBuffer): {gltf: Gltf; bin: ArrayBuffer} | null {
	const dv = new DataView(buffer);
	if (dv.getUint32(0, true) !== 0x46546c67) return null;

	let offset = 12;
	let gltf: Gltf | null = null;
	let bin: ArrayBuffer | null = null;

	while (offset + 8 <= buffer.byteLength) {
		const length = dv.getUint32(offset, true);
		const type = dv.getUint32(offset + 4, true);
		if (type === 0x4e4f534a) {
			gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length))) as Gltf;
		} else if (type === 0x004e4942) {
			bin = buffer.slice(offset + 8, offset + 8 + length);
		}
		offset += 8 + length;
	}

	return gltf && bin ? {gltf, bin} : null;
}

function buildParents(gltf: Gltf): Int32Array {
	const count = gltf.nodes?.length ?? 0;
	const parents = new Int32Array(count).fill(-1);
	gltf.nodes?.forEach((node, i) => {
		for (const child of node.children ?? []) {
			if (child >= 0 && child < count) parents[child] = i;
		}
	});
	return parents;
}

function nodeTRS(gltf: Gltf): {t: number[]; r: number[]; s: number[]}[] {
	return (gltf.nodes ?? []).map(node => ({
		t: node.translation ?? [0, 0, 0],
		r: node.rotation ?? [0, 0, 0, 1],
		s: node.scale ?? [1, 1, 1],
	}));
}

/** Pick the clip a waiting passenger should be playing. */
export function pickClipIndex(gltf: Gltf): number {
	const names = (gltf.animations ?? []).map(a => (a.name ?? '').toLowerCase());
	for (const wanted of PREFERRED_CLIPS) {
		const found = names.findIndex(n => n.includes(wanted));
		if (found >= 0) return found;
	}
	return names.length > 0 ? 0 : -1;
}

/** Wraps one glTF animation as a sampler the pose baker can query. */
function makeSampler(gltf: Gltf, bin: ArrayBuffer, clipIndex: number): PoseSampler | null {
	const clip = gltf.animations?.[clipIndex];
	if (!clip) return null;

	interface Track {times: Float32Array; values: Float32Array; comps: number}
	const tracks = new Map<number, {translation?: Track; rotation?: Track; scale?: Track}>();
	let duration = 0;

	for (const channel of clip.channels) {
		const node = channel.target.node;
		if (node === undefined) continue;
		const sampler = clip.samplers[channel.sampler];
		if (!sampler) continue;

		const times = readAccessor(gltf, bin, sampler.input);
		const values = readAccessor(gltf, bin, sampler.output);
		if (!(times instanceof Float32Array) || !(values instanceof Float32Array) || times.length === 0) continue;

		duration = Math.max(duration, times[times.length - 1]);
		const comps = values.length / times.length;
		const entry = tracks.get(node) ?? {};
		const track: Track = {times, values, comps};
		if (channel.target.path === 'translation') entry.translation = track;
		else if (channel.target.path === 'rotation') entry.rotation = track;
		else if (channel.target.path === 'scale') entry.scale = track;
		tracks.set(node, entry);
	}

	if (tracks.size === 0 || duration <= 0) return null;

	const sampleTrack = (track: Track | undefined, time: number, fallback: number[]): number[] => {
		if (!track) return fallback;
		const {times, values, comps} = track;
		let i = 0;
		while (i < times.length - 1 && times[i + 1] < time) i++;
		const t0 = times[i];
		const t1 = times[Math.min(i + 1, times.length - 1)];
		const span = t1 - t0;
		const f = span > 1e-6 ? Math.min(1, Math.max(0, (time - t0) / span)) : 0;
		const a = i * comps;
		const b = Math.min(i + 1, times.length - 1) * comps;

		const out: number[] = [];
		for (let c = 0; c < comps; c++) out.push(values[a + c] + (values[b + c] - values[a + c]) * f);

		// Quaternions must stay unit length after a linear blend.
		if (comps === 4) {
			const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
			for (let c = 0; c < 4; c++) out[c] /= len;
		}
		return out;
	};

	const rest = nodeTRS(gltf);

	return {
		duration,
		sample: (nodeIndex: number, time: number): {t: number[]; r: number[]; s: number[]} | null => {
			const entry = tracks.get(nodeIndex);
			if (!entry) return null;
			const base = rest[nodeIndex] ?? {t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1]};
			return {
				t: sampleTrack(entry.translation, time, base.t),
				r: sampleTrack(entry.rotation, time, base.r),
				s: sampleTrack(entry.scale, time, base.s),
			};
		},
	};
}

/** Decode the base-colour texture of `material` into pixels we can sample. */
async function loadBaseColor(
	gltf: Gltf, bin: ArrayBuffer, materialIndex: number | undefined,
): Promise<{data: Uint8ClampedArray; width: number; height: number} | null> {
	const material = materialIndex === undefined ? undefined : gltf.materials?.[materialIndex];
	const texIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
	if (texIndex === undefined) return null;

	const image = gltf.images?.[gltf.textures?.[texIndex]?.source ?? -1];
	if (!image || image.bufferView === undefined) return null;

	const view = gltf.bufferViews?.[image.bufferView];
	if (!view) return null;

	try {
		const bytes = new Uint8Array(bin, view.byteOffset ?? 0, view.byteLength);
		const blob = new Blob([bytes], {type: image.mimeType ?? 'image/png'});
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		canvas.width = Math.min(bitmap.width, 512);
		canvas.height = Math.min(bitmap.height, 512);
		const ctx = canvas.getContext('2d', {willReadFrequently: true});
		if (!ctx) return null;
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
		bitmap.close();
		return {data: pixels.data, width: canvas.width, height: canvas.height};
	} catch {
		return null;
	}
}

/**
 * Load a character GLB and bake `poseCount` poses of its waiting animation.
 * Returns null when the file has no skin — the caller falls back to the
 * built-in figure rather than drawing a T-pose.
 */
export async function loadCharacter(buffer: ArrayBuffer, poseCount = 8): Promise<LoadedCharacter | null> {
	const parsed = parseGlb(buffer);
	if (!parsed) return null;
	const {gltf, bin} = parsed;

	const skinnedNode = (gltf.nodes ?? []).find(n => n.skin !== undefined && n.mesh !== undefined);
	if (!skinnedNode || skinnedNode.skin === undefined || skinnedNode.mesh === undefined) return null;

	const skin = gltf.skins?.[skinnedNode.skin];
	const mesh = gltf.meshes?.[skinnedNode.mesh];
	if (!skin || !mesh) return null;

	const positions: number[] = [];
	const normals: number[] = [];
	const joints: number[] = [];
	const weights: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];

	for (const prim of mesh.primitives) {
		const pos = readAccessor(gltf, bin, prim.attributes.POSITION);
		if (!(pos instanceof Float32Array)) continue;
		const nrm = readAccessor(gltf, bin, prim.attributes.NORMAL);
		const jnt = prim.attributes.JOINTS_0 !== undefined ? readAccessor(gltf, bin, prim.attributes.JOINTS_0) : null;
		const wgt = prim.attributes.WEIGHTS_0 !== undefined ? readAccessor(gltf, bin, prim.attributes.WEIGHTS_0) : null;
		const uv = prim.attributes.TEXCOORD_0 !== undefined ? readAccessor(gltf, bin, prim.attributes.TEXCOORD_0) : null;
		const idx = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices) : null;

		const base = positions.length / 3;
		const count = pos.length / 3;
		const texture = await loadBaseColor(gltf, bin, prim.material);
		const factor = gltf.materials?.[prim.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor;

		for (let i = 0; i < count; i++) {
			positions.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
			normals.push(
				nrm instanceof Float32Array ? nrm[i * 3] : 0,
				nrm instanceof Float32Array ? nrm[i * 3 + 1] : 1,
				nrm instanceof Float32Array ? nrm[i * 3 + 2] : 0,
			);
			for (let c = 0; c < 4; c++) {
				joints.push(jnt ? Number(jnt[i * 4 + c]) : 0);
				weights.push(wgt instanceof Float32Array ? wgt[i * 4 + c] : (c === 0 ? 1 : 0));
			}

			if (texture && uv instanceof Float32Array) {
				const u = uv[i * 2] - Math.floor(uv[i * 2]);
				const v = uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1]);
				const px = Math.min(texture.width - 1, Math.max(0, Math.round(u * (texture.width - 1))));
				const py = Math.min(texture.height - 1, Math.max(0, Math.round(v * (texture.height - 1))));
				const at = (py * texture.width + px) * 4;
				colors.push(texture.data[at] / 255, texture.data[at + 1] / 255, texture.data[at + 2] / 255);
			} else if (factor) {
				colors.push(factor[0] ?? 0.7, factor[1] ?? 0.7, factor[2] ?? 0.7);
			} else {
				colors.push(0.72, 0.7, 0.68);
			}
		}

		if (idx) {
			for (let i = 0; i < idx.length; i++) indices.push(base + Number(idx[i]));
		} else {
			for (let i = 0; i < count; i++) indices.push(base + i);
		}
	}

	if (positions.length === 0) return null;

	const inverseBindRaw = skin.inverseBindMatrices !== undefined
		? readAccessor(gltf, bin, skin.inverseBindMatrices)
		: null;
	const inverseBind = inverseBindRaw instanceof Float32Array
		? inverseBindRaw
		: identityBinds(skin.joints.length);

	const source: SkinSource = {
		position: new Float32Array(positions),
		normal: new Float32Array(normals),
		joints: new Uint16Array(joints),
		weights: new Float32Array(weights),
		inverseBindMatrices: inverseBind,
		jointNodes: skin.joints,
		nodeTRS: nodeTRS(gltf),
		parents: buildParents(gltf),
	};

	const clipIndex = pickClipIndex(gltf);
	const sampler = clipIndex >= 0 ? makeSampler(gltf, bin, clipIndex) : null;
	const poses = sampler
		? bakePoseCycle(source, sampler, poseCount)
		: [{position: source.position, normal: source.normal}];

	normalizeToHumanHeight(poses);

	return {
		poses,
		color: new Float32Array(colors),
		indices: new Uint32Array(indices),
	};
}

function identityBinds(count: number): Float32Array {
	const out = new Float32Array(count * 16);
	for (let j = 0; j < count; j++) {
		out[j * 16] = 1;
		out[j * 16 + 5] = 1;
		out[j * 16 + 10] = 1;
		out[j * 16 + 15] = 1;
	}
	return out;
}

/**
 * Put every pose on the ground at human height, using ONE scale and offset for
 * the whole cycle — normalising each pose separately would make the figure
 * grow and shrink as it moved.
 */
function normalizeToHumanHeight(poses: BakedPose[]): void {
	let minY = Infinity, maxY = -Infinity, cx = 0, cz = 0, n = 0;
	for (const pose of poses) {
		for (let i = 0; i < pose.position.length; i += 3) {
			const y = pose.position[i + 1];
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			cx += pose.position[i];
			cz += pose.position[i + 2];
			n++;
		}
	}
	if (n === 0 || !Number.isFinite(minY)) return;

	cx /= n;
	cz /= n;
	const height = maxY - minY;
	const scale = height > 0.001 ? PERSON_HEIGHT / height : 1;

	for (const pose of poses) {
		for (let i = 0; i < pose.position.length; i += 3) {
			pose.position[i] = (pose.position[i] - cx) * scale;
			pose.position[i + 1] = (pose.position[i + 1] - minY) * scale;
			pose.position[i + 2] = (pose.position[i + 2] - cz) * scale;
		}
	}
}
