/**
 * V1/V2/V4/V5 — what IS the world made of right now?
 *
 * Walks the live scene and reports, per object class: how many meshes exist,
 * how big their buffers are, where they sit, and (for figures) whether their
 * feet touch the ground. The point is to turn "the buildings look wrong" and
 * "the people float" into numbers I can act on.
 */
import {openGame, startDriving} from './lib-drive.mjs';

export default async (page) => {
	const {ctx, page: p, errors} = await openGame(page.context().browser());
	await startDriving(p);
	await p.waitForTimeout(6000);

	const world = await p.evaluate(() => {
		const h = window.__h;
		const bbox = (mesh) => {
			const pos = mesh?.buffers?.position;
			if (!pos) return null;
			let minY = Infinity, maxY = -Infinity, maxAbs = 0;
			for (let i = 0; i < pos.length; i += 3) {
				maxAbs = Math.max(maxAbs, Math.abs(pos[i]), Math.abs(pos[i + 2]));
				minY = Math.min(minY, pos[i + 1]);
				maxY = Math.max(maxY, pos[i + 1]);
			}
			return {verts: pos.length / 3, minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), maxAbsXZ: +maxAbs.toFixed(1)};
		};

		const terrainAt = (x, z) => {
			const provider = h.terrain?.terrainHeightProvider;
			if (!provider) return null;
			const v = provider.getHeightGlobalInterpolated(x, z, true);
			return v === null ? null : +v.toFixed(2);
		};

		// Where do the crowd's feet sit relative to the ground under them?
		const grounding = [];
		for (const mesh of h.crowds?.crowdMeshes ?? []) {
			const box = bbox(mesh);
			if (!box) continue;
			const footWorldY = mesh.position.y + box.minY;
			const ground = terrainAt(mesh.position.x, mesh.position.z);
			grounding.push({
				meshY: +mesh.position.y.toFixed(2),
				footY: +footWorldY.toFixed(2),
				groundY: ground,
				gap: ground === null ? null : +(footWorldY - ground).toFixed(2),
				verts: box.verts,
			});
		}

		// How much variety does the crowd actually have? Sample vertex colours.
		let paletteSize = 0;
		const firstCrowd = h.crowds?.crowdMeshes?.[0];
		if (firstCrowd?.buffers?.color) {
			const seen = new Set();
			const c = firstCrowd.buffers.color;
			for (let i = 0; i < c.length; i += 3) {
				seen.add(`${Math.round(c[i] * 12)},${Math.round(c[i + 1] * 12)},${Math.round(c[i + 2] * 12)}`);
			}
			paletteSize = seen.size;
		}

		const tiles = window.__gameSystems
			? [...window.__gameSystems.systems.values()].find(v => v && v.tiles instanceof Map)
			: null;

		return {
			cars: (h.trainRender?.carMeshes ?? []).map(bbox),
			stations: (h.trainRender?.stationMeshes ?? []).length,
			crowdMeshes: (h.crowds?.crowdMeshes ?? []).length,
			signMeshes: (h.signs?.signMeshes ?? []).length,
			grounding,
			crowdPaletteSize: paletteSize,
			tileCount: tiles?.tiles?.size ?? null,
		};
	});

	const telemetry = await p.evaluate(() => window.__telemetry?.report());
	await p.close();
	await ctx.close();
	return {world, telemetry, errors: errors.slice(0, 5)};
};
