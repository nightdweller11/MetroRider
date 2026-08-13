/**
 * V6 — do passengers actually go anywhere?
 *
 * Watches a full stop: the platform count, the number aboard, and whether any
 * figure MOVES toward the train while the doors are open. Today the numbers
 * change and the bodies vanish; this probe is what will show the difference
 * once they walk.
 */
import {openGame, startDriving} from './lib-drive.mjs';

export default async (page) => {
	const {page: p, errors} = await openGame(page);
	await startDriving(p, {station: 3});
	await p.waitForTimeout(6000);

	const trace = await p.evaluate(async () => {
		const h = window.__h;
		const ts = window.__trainSystem;
		const idx = ts.stationState?.nearestStationIdx ?? 3;

		const centroid = () => {
			const m = h.crowds.crowdMeshes[0];
			if (!m) return null;
			const pos = m.buffers.position;
			let sx = 0, sz = 0, n = 0;
			for (let i = 0; i < pos.length; i += 3) { sx += pos[i]; sz += pos[i + 2]; n++; }
			return n ? {x: +(sx / n).toFixed(3), z: +(sz / n).toFixed(3), verts: n} : null;
		};

		const samples = [];
		const sample = (label) => samples.push({
			label,
			waiting: h.passengers.waitingAt(idx),
			aboard: h.passengers.getSnapshot().aboard,
			meshes: h.crowds.crowdMeshes.length,
			centroid: centroid(),
		});

		sample('before');
		ts.toggleDoors();
		for (let i = 0; i < 6; i++) {
			await new Promise(r => setTimeout(r, 800));
			sample(`doors-${i}`);
		}
		ts.toggleDoors();
		await new Promise(r => setTimeout(r, 1200));
		sample('after');
		return {stationIndex: idx, samples};
	});

	// Did anybody actually travel across the platform, or did they just vanish?
	const centroids = trace.samples.map(s => s.centroid).filter(Boolean);
	const movement = centroids.length > 1
		? Math.max(...centroids.map(c => Math.hypot(c.x - centroids[0].x, c.z - centroids[0].z)))
		: 0;

	await releaseGame(p);
	return {
		trace,
		crowdCentroidTravelM: +movement.toFixed(2),
		verdict: movement > 1 ? 'figures move toward the train' : 'figures do not walk — they only disappear',
		errors: errors.slice(0, 5),
	};
};
