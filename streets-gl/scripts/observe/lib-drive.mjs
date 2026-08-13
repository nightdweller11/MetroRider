/**
 * Shared setup for every observation probe: boot the game, silence audio,
 * grab the systems the probes need, and expose a small driving API.
 *
 * Kept in one place so a probe describes WHAT it observes, not how to start a
 * train.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Newest mtime anywhere under a directory, in ms. */
function newestMtime(dir) {
	let newest = 0;

	for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

		const full = path.join(dir, entry.name);
		const mtime = entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs;

		if (mtime > newest) newest = mtime;
	}

	return newest;
}

/**
 * Refuse to measure a build that predates the source.
 *
 * The port the probes hit serves a BUILT bundle, not a dev server — so
 * editing a file changes nothing until `npm run build` runs. Comparing the
 * browser against the server does not catch this: both happily agree on a
 * bundle that is two edits old. This has now produced a confident, entirely
 * fictitious measurement twice, most recently a "41% improvement" that was
 * really just a different camera position. An instrument that can silently
 * measure code you did not write is worse than no instrument.
 */
function assertBuildIsCurrent() {
	const indexPath = path.join(repoRoot, 'build', 'index.html');

	if (!fs.existsSync(indexPath)) return null;

	const bundleName = (fs.readFileSync(indexPath, 'utf8').match(/index\.[a-f0-9]+\.js/) ?? [])[0];

	if (!bundleName) return null;

	const bundlePath = path.join(repoRoot, 'build', 'js', bundleName);

	if (!fs.existsSync(bundlePath)) return null;

	const builtAt = fs.statSync(bundlePath).mtimeMs;
	const sourcedAt = newestMtime(path.join(repoRoot, 'src'));

	if (sourcedAt > builtAt) {
		const staleBy = Math.round((sourcedAt - builtAt) / 1000);

		throw new Error(
			`stale build: src/ is ${staleBy}s newer than ${bundleName}. ` +
			`Run "npm run build" — measuring now would describe code that is not running.`
		);
	}

	return bundleName;
}

/**
 * Open the game IN THE PAGE THE RUNNER ALREADY HAS.
 *
 * Probes used to create a fresh browser context and close it afterwards, which
 * pops a window to the front and steals focus every single run — unusable while
 * the operator is doing anything else. The existing page is reused and simply
 * parked on a blank page when the probe finishes.
 */
/**
 * Graphics settings a performance run is pinned to.
 *
 * `fpsLimit: 'off'` removes the limiter so the frame is not gated by a cap —
 * but note that removing it does NOT make frame rate a valid throughput metric,
 * because requestAnimationFrame is still vsync-locked. Judge a render change by
 * `__telemetry.gpuFrameMs()` and the work counts, never by fps.
 */
export const PERF_QUALITY = {
	fpsLimit: 'off',
	renderScale: '1',
	shadows: 'on',
	ssao: 'on',
	bloom: 'on',
};

export async function openGame(page, {
	url = 'http://localhost:3111/',
	telemetry = true,
	viewport = {width: 1280, height: 800},
	quality = PERF_QUALITY,
} = {}) {
	const ctx = page.context();
	await page.setViewportSize(viewport);
	const errors = [];
	page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
	page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200)); });

	// The HTML document is cacheable, so the browser will happily keep serving an
	// index.html that points at a bundle from two builds ago — and every
	// measurement taken through it is then a measurement of code that no longer
	// exists. This cost a whole diagnosis round on 2026-08-13. Bust the document
	// cache on every open, then PROVE the loaded bundle is the one on disk.
	const expectedOnDisk = assertBuildIsCurrent();

	const bust = `_b=${Date.now()}`;
	await page.goto(`${url}?${telemetry ? 'telemetry=1&' : ''}${bust}`, {waitUntil: 'domcontentloaded'});

	const served = await (await fetch(url, {cache: 'no-store'})).text();
	const expected = (served.match(/index\.[a-f0-9]+\.js/) ?? [])[0] ?? expectedOnDisk;
	const loaded = await page.evaluate(
		() => ([...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'))
			.find(s => /index\.[a-f0-9]+\.js/.test(s)) ?? '').replace('./js/', ''),
	);
	if (expected && loaded && expected !== loaded) {
		throw new Error(`stale bundle: page loaded ${loaded}, server serves ${expected}. Rebuild or hard-reload.`);
	}

	await page.waitForFunction(() => window.__trainSystem && window.__trainSystem.lines.length > 0, null, {timeout: 120000});
	await page.evaluate(() => { document.getElementById('release-splash-dismiss')?.click(); });
	await page.waitForFunction(
		() => [...document.querySelectorAll('#game-start-btn div')].some(x => x.textContent.startsWith('▶')),
		null, {timeout: 120000},
	);

	await page.evaluate(() => {
		const sm = window.__gameSystems;
		const handles = {};
		for (const [, v] of sm.systems) {
			if (v && v.settings && typeof v.settings.update === 'function') handles.settings = v.settings;
			if (v && typeof v.cycleMode === 'function' && typeof v.snapToTrain === 'function') handles.camera = v;
			if (v && v.objects && v.objects.camera) handles.scene = v;
			if (v && Array.isArray(v.carMeshes) && Array.isArray(v.stationMeshes)) handles.trainRender = v;
			if (v && Array.isArray(v.crowdMeshes)) handles.crowds = v;
			if (v && Array.isArray(v.signMeshes)) handles.signs = v;
			if (v && typeof v.waitingAt === 'function') handles.passengers = v;
			if (v && typeof v.signFace === 'function') handles.limits = v;
			if (v && v.terrainHeightProvider !== undefined) handles.terrain = v;
			if (v && v.ctx && typeof v.ctx.suspend === 'function') { try { v.ctx.suspend(); } catch {} }
		}
		window.__h = handles;
	});

	// Pin the graphics settings the measurement runs under.
	//
	// These persist per browser profile, so a probe used to inherit whatever
	// the operator last selected — including a frame limiter, which silently
	// makes every frame-rate reading a reading of the limiter. Set them
	// explicitly and hand them back so the run reports what it measured under.
	const graphics = await page.evaluate((wanted) => {
		const settings = window.__h?.settings;

		if (!settings) return null;

		for (const [key, statusValue] of Object.entries(wanted)) {
			try { settings.update(key, {statusValue}); } catch { /* unknown key on this build */ }
		}

		const applied = {};
		for (const key of Object.keys(wanted)) {
			applied[key] = settings.get?.(key)?.statusValue ?? wanted[key];
		}

		return applied;
	}, quality);

	return {ctx, page, errors, graphics};
}

/**
 * Finish a probe without disturbing the operator: leave the shared window on a
 * blank page rather than closing it (closing the last page tears the window
 * down and the next probe raises a new one to the front).
 */
export async function releaseGame(page) {
	try {
		await page.goto('about:blank', {waitUntil: 'domcontentloaded'});
	} catch {
		// A probe that already navigated away is fine.
	}
}

export async function startDriving(page, {station = 3, line = 0} = {}) {
	await page.evaluate(() => {
		[...document.querySelectorAll('#game-start-btn div')].find(x => x.textContent.startsWith('▶'))?.click();
	});
	await page.waitForTimeout(8000);
	await page.evaluate(([l, s]) => window.__trainSystem.goToStation(l, s, 1), [line, station]);
	await page.waitForTimeout(4000);
}

export async function throttle(page, seconds) {
	await page.evaluate(async (s) => {
		const ts = window.__trainSystem;
		ts.setHUDThrottle(true);
		await new Promise(r => setTimeout(r, s * 1000));
		ts.setHUDThrottle(false);
	}, seconds);
}

export async function telemetryReport(page) {
	return await page.evaluate(() => window.__telemetry?.report() ?? {error: 'telemetry not installed'});
}

export async function markPhase(page, name) {
	await page.evaluate((n) => window.__telemetry?.markPhase(n), name);
}
