import {bakePose, bakePoseCycle, computeNodeMatrices, SkinSource, PoseSampler} from '~/app/game/passengers/SkinnedPoseBaker';

/**
 * A two-bone "arm": node 0 is the root at the origin, node 1 is its child one
 * metre up. Two vertices, each fully weighted to one joint. Bind pose puts the
 * tip at y = 2.
 */
function twoBoneSkin(): SkinSource {
	const identity = (): number[] => [0, 0, 0];
	return {
		position: new Float32Array([0, 1, 0, 0, 2, 0]),
		normal: new Float32Array([0, 0, 1, 0, 0, 1]),
		joints: new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0]),
		weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
		// Inverse bind for joint 0 = identity (bone at origin);
		// joint 1 sits at y=1 so its inverse bind translates by -1.
		inverseBindMatrices: new Float32Array([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
		]),
		jointNodes: [0, 1],
		nodeTRS: [
			{t: identity(), r: [0, 0, 0, 1], s: [1, 1, 1]},
			{t: [0, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1]},
		],
		parents: new Int32Array([-1, 0]),
	};
}

/** Rotates node 1 about Z by `angle(time)` radians. */
function rotationSampler(angleAt: (t: number) => number, duration = 1): PoseSampler {
	return {
		duration,
		sample: (nodeIndex, time) => {
			if (nodeIndex !== 1) return null;
			const a = angleAt(time);
			return {t: [0, 1, 0], r: [0, 0, Math.sin(a / 2), Math.cos(a / 2)], s: [1, 1, 1]};
		},
	};
}

describe('SkinnedPoseBaker — bind pose', () => {
	it('reproduces the bind pose when nothing is animated', () => {
		const {position} = bakePose(twoBoneSkin(), null, 0);

		expect(Array.from(position)).toEqual([0, 1, 0, 0, 2, 0]);
	});

	it('leaves an unweighted vertex where it was', () => {
		const skin = twoBoneSkin();
		skin.weights = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]);

		const {position} = bakePose(skin, null, 0);

		expect(Array.from(position)).toEqual([0, 1, 0, 0, 2, 0]);
	});
});

describe('SkinnedPoseBaker — animated pose', () => {
	it('moves a child-bone vertex when its joint rotates', () => {
		// 90° about Z: the tip (0,2) swings to (-1,1).
		const {position} = bakePose(twoBoneSkin(), rotationSampler(() => Math.PI / 2), 0);

		expect(position[0]).toBeCloseTo(0, 5); // root vertex unmoved
		expect(position[1]).toBeCloseTo(1, 5);
		expect(position[3]).toBeCloseTo(-1, 5);
		expect(position[4]).toBeCloseTo(1, 5);
	});

	it('rotates normals with the joint', () => {
		const bind = bakePose(twoBoneSkin(), null, 0);
		const bent = bakePose(twoBoneSkin(), rotationSampler(() => Math.PI / 2), 0);

		// Normal on the tip vertex started at +z; a Z rotation leaves it there.
		expect(bent.normal[5]).toBeCloseTo(1, 5);
		// And every normal stays unit length, which is what the renderer needs.
		for (const arr of [bind.normal, bent.normal]) {
			for (let v = 0; v < arr.length; v += 3) {
				expect(Math.hypot(arr[v], arr[v + 1], arr[v + 2])).toBeCloseTo(1, 5);
			}
		}
	});

	it('produces a different pose at a different time', () => {
		const sampler = rotationSampler(t => t * Math.PI);
		const a = bakePose(twoBoneSkin(), sampler, 0);
		const b = bakePose(twoBoneSkin(), sampler, 0.5);

		expect(Array.from(a.position)).not.toEqual(Array.from(b.position));
	});

	it('bakes a cycle of distinct poses across the clip', () => {
		const poses = bakePoseCycle(twoBoneSkin(), rotationSampler(t => t * Math.PI * 2), 8);

		expect(poses).toHaveLength(8);
		const tips = poses.map(p => `${p.position[3].toFixed(3)},${p.position[4].toFixed(3)}`);
		expect(new Set(tips).size).toBeGreaterThan(4); // a real cycle, not one pose repeated
	});
});

describe('SkinnedPoseBaker — hierarchy', () => {
	it('applies a parent transform to its children', () => {
		const skin = twoBoneSkin();
		const sampler: PoseSampler = {
			duration: 1,
			sample: nodeIndex => (nodeIndex === 0 ? {t: [5, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1]} : null),
		};

		const matrices = computeNodeMatrices(skin, sampler, 0);

		expect(matrices[0][12]).toBeCloseTo(5, 5);
		expect(matrices[1][12]).toBeCloseTo(5, 5); // child inherits the move
		expect(matrices[1][13]).toBeCloseTo(1, 5); // and keeps its own offset
	});

	it('survives a joint that points at a missing node', () => {
		const skin = twoBoneSkin();
		skin.jointNodes = [0, 99];

		expect(() => bakePose(skin, null, 0)).not.toThrow();
	});
});
