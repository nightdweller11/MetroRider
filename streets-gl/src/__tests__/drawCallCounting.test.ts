const VISIBLE_TILES_DEFAULT = 20;
const SKYBOX = 1;
const TERRAIN = 6;
const PROJECTED_PER_TILE = true;
const INSTANCES = 5;
const AIRCRAFT = 3;
const TRAINS = 5;
const FULLSCREEN = 25;

type DrawCallFrameOptions = {
	visibleTiles: number;
	shadowCascadeCount: number;
	legacyExtrudedPerTile: boolean;
	shadowHuggingCullTiles: number;
};

type DrawCallBreakdown = {
	gbuffer: number;
	shadowByCascade: number[];
	fullscreen: number;
	total: number;
	gbufferExtruded: number;
	gbufferProjected: number;
	gbufferHugging: number;
	gbufferInstances: number;
	shadowInstancesPerRichCascade: number;
};

function projectedDraws(visibleTiles: number): number {
	return PROJECTED_PER_TILE ? visibleTiles : 0;
}

function extrudedDraws(visibleTiles: number, legacyExtrudedPerTile: boolean): number {
	return legacyExtrudedPerTile ? visibleTiles : 1;
}

function isRichShadowCascade(cascadeIndex: number, shadowCascadeCount: number): boolean {
	if (shadowCascadeCount < 3) {
		return true;
	}
	return cascadeIndex < shadowCascadeCount - 1;
}

class DrawCallCounter {
	static defaultOptions(): DrawCallFrameOptions {
		return {
			visibleTiles: VISIBLE_TILES_DEFAULT,
			shadowCascadeCount: 3,
			legacyExtrudedPerTile: true,
			shadowHuggingCullTiles: 0,
		};
	}

	countGBuffer(opts: DrawCallFrameOptions): number {
		const t = opts.visibleTiles;
		const ext = extrudedDraws(t, opts.legacyExtrudedPerTile);
		const hugging = t;
		return (
			SKYBOX +
			ext +
			TERRAIN +
			projectedDraws(t) +
			hugging +
			INSTANCES +
			AIRCRAFT +
			TRAINS
		);
	}

	countShadowCascade(cascadeIndex: number, opts: DrawCallFrameOptions): number {
		const t = opts.visibleTiles;
		const ext = extrudedDraws(t, opts.legacyExtrudedPerTile);
		const hugging = Math.max(0, t - opts.shadowHuggingCullTiles);
		let n = ext + hugging + TRAINS;
		if (isRichShadowCascade(cascadeIndex, opts.shadowCascadeCount)) {
			n += INSTANCES + AIRCRAFT;
		}
		return n;
	}

	countFullscreen(): number {
		return FULLSCREEN;
	}

	countFrame(opts: DrawCallFrameOptions): number {
		let total = this.countGBuffer(opts) + this.countFullscreen();
		for (let c = 0; c < opts.shadowCascadeCount; c++) {
			total += this.countShadowCascade(c, opts);
		}
		return total;
	}

	breakdown(opts: DrawCallFrameOptions): DrawCallBreakdown {
		const t = opts.visibleTiles;
		const ext = extrudedDraws(t, opts.legacyExtrudedPerTile);
		const shadowByCascade: number[] = [];
		for (let c = 0; c < opts.shadowCascadeCount; c++) {
			shadowByCascade.push(this.countShadowCascade(c, opts));
		}
		const gbuffer =
			SKYBOX +
			ext +
			TERRAIN +
			projectedDraws(t) +
			t +
			INSTANCES +
			AIRCRAFT +
			TRAINS;
		return {
			gbuffer,
			shadowByCascade,
			fullscreen: FULLSCREEN,
			total: gbuffer + FULLSCREEN + shadowByCascade.reduce((a, b) => a + b, 0),
			gbufferExtruded: ext,
			gbufferProjected: projectedDraws(t),
			gbufferHugging: t,
			gbufferInstances: INSTANCES,
			shadowInstancesPerRichCascade: INSTANCES,
		};
	}
}

describe('draw call counting (frame model)', () => {
	const counter = new DrawCallCounter();

	test('baseline: 20 visible tiles, 3 cascades, ~256 draws', () => {
		const opts = DrawCallCounter.defaultOptions();
		expect(counter.countFrame(opts)).toBe(256);
		expect(counter.breakdown(opts).total).toBe(256);
	});

	test('multi-draw: extruded collapses to 1 per pass', () => {
		const baseline = DrawCallCounter.defaultOptions();
		const optimized: DrawCallFrameOptions = {...baseline, legacyExtrudedPerTile: false};
		expect(counter.countFrame(optimized)).toBe(180);
		const b = counter.breakdown(optimized);
		expect(b.gbufferExtruded).toBe(1);
		expect(b.shadowByCascade[0]).toBe(34);
		expect(b.shadowByCascade[1]).toBe(34);
		expect(b.shadowByCascade[2]).toBe(26);
	});

	test('multi-draw + distance culling: fewer shadow hugging draws', () => {
		const optimized: DrawCallFrameOptions = {
			...DrawCallCounter.defaultOptions(),
			legacyExtrudedPerTile: false,
			shadowHuggingCullTiles: 8,
		};
		expect(counter.countFrame(optimized)).toBe(156);
		const b = counter.breakdown(optimized);
		expect(b.shadowByCascade).toEqual([26, 26, 18]);
	});

	test('multi-draw + cascade reduction 3->2 removes third cascade', () => {
		const optimized: DrawCallFrameOptions = {
			...DrawCallCounter.defaultOptions(),
			legacyExtrudedPerTile: false,
			shadowCascadeCount: 2,
		};
		expect(counter.countFrame(optimized)).toBe(154);
		const b = counter.breakdown(optimized);
		expect(b.shadowByCascade).toEqual([34, 34]);
	});

	test('combined optimizations: large reduction from baseline', () => {
		const baseline = counter.countFrame(DrawCallCounter.defaultOptions());
		const combined: DrawCallFrameOptions = {
			visibleTiles: VISIBLE_TILES_DEFAULT,
			shadowCascadeCount: 2,
			legacyExtrudedPerTile: false,
			shadowHuggingCullTiles: 8,
		};
		const optimized = counter.countFrame(combined);
		expect(optimized).toBe(138);
		expect(baseline - optimized).toBeGreaterThanOrEqual(100);
	});

	test('fallback without multi-draw extension matches baseline', () => {
		const noExt: DrawCallFrameOptions = {
			...DrawCallCounter.defaultOptions(),
			legacyExtrudedPerTile: true,
		};
		expect(counter.countFrame(noExt)).toBe(256);
	});

	test('per-pass breakdown: GBuffer, each shadow cascade, fullscreen stable', () => {
		const base = counter.breakdown(DrawCallCounter.defaultOptions());
		expect(base.gbuffer).toBe(80);
		expect(base.shadowByCascade).toEqual([53, 53, 45]);
		expect(base.fullscreen).toBe(25);

		const md = counter.breakdown({
			...DrawCallCounter.defaultOptions(),
			legacyExtrudedPerTile: false,
		});
		expect(md.gbuffer).toBe(61);
		expect(md.shadowByCascade).toEqual([34, 34, 26]);
		expect(md.fullscreen).toBe(25);
	});

	test('instance draw count unchanged under multi-draw', () => {
		const base = counter.breakdown(DrawCallCounter.defaultOptions());
		const md = counter.breakdown({
			...DrawCallCounter.defaultOptions(),
			legacyExtrudedPerTile: false,
		});
		expect(md.gbufferInstances).toBe(base.gbufferInstances);
		expect(md.shadowInstancesPerRichCascade).toBe(base.shadowInstancesPerRichCascade);
		expect(md.gbufferInstances).toBe(INSTANCES);
		let richCascades = 0;
		for (let c = 0; c < DrawCallCounter.defaultOptions().shadowCascadeCount; c++) {
			if (isRichShadowCascade(c, 3)) {
				richCascades++;
			}
		}
		const instanceDrawsGBufferAndShadow =
			md.gbufferInstances + richCascades * md.shadowInstancesPerRichCascade;
		expect(instanceDrawsGBufferAndShadow).toBe(5 + 5 + 5);
	});

	test('fullscreen pass count unchanged across scenarios', () => {
		const variants: DrawCallFrameOptions[] = [
			DrawCallCounter.defaultOptions(),
			{...DrawCallCounter.defaultOptions(), legacyExtrudedPerTile: false},
			{
				...DrawCallCounter.defaultOptions(),
				legacyExtrudedPerTile: false,
				shadowHuggingCullTiles: 8,
			},
			{
				...DrawCallCounter.defaultOptions(),
				legacyExtrudedPerTile: false,
				shadowCascadeCount: 2,
			},
		];
		for (const o of variants) {
			expect(counter.countFullscreen()).toBe(counter.breakdown(o).fullscreen);
			expect(counter.breakdown(o).fullscreen).toBe(FULLSCREEN);
		}
	});
});
