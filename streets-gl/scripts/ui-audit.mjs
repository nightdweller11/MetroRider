#!/usr/bin/env node
/**
 * Walk the interface and check it is actually usable.
 *
 * This exists because v2.23.0 shipped after three defects that no unit test
 * could see and no amount of reading the source revealed: every sheet row in
 * the game was unclickable (the panel inherited `pointer-events:none` from the
 * HUD container and never opted back in), every panel piled into the top-left
 * corner until the first frame of a running game (`data-o` was written only
 * inside `update()`), and the minimap had never once drawn a map (it renders a
 * `routePoints` field no caller has ever passed, and fell back to a hard-coded
 * diagonal). All three were reported by a nine-year-old's father, not by CI.
 *
 * So: this drives a real browser, clicks real controls, and asserts the things
 * that were broken — that a control is not covered by something else, that
 * tapping it changes something, and that panels do not overlap in any of the
 * three layouts.
 *
 * It runs against the LOCAL build by default and can be pointed at production.
 * It uses the system Chrome through playwright-core, so there is no browser
 * download and nothing is written outside this repository.
 *
 *   node scripts/ui-audit.mjs
 *   node scripts/ui-audit.mjs --url=https://metrorider.net --headed
 *   node scripts/ui-audit.mjs --out=docs/features/_artifacts/ui-audit-2026-08-15
 *
 * Exits non-zero if any check fails, so it can gate a release.
 */

import {chromium} from 'playwright-core';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = new Map(
	process.argv.slice(2).map(a => {
		const [k, v] = a.replace(/^--/, '').split('=');

		return [k, v ?? true];
	}),
);

const URL = args.get('url') ?? 'http://localhost:3001/';
const HEADED = args.has('headed');
const OUT = args.get('out') ? resolve(ROOT, args.get('out')) : null;

/** Landscape, tablet portrait, phone — the three the stylesheet branches on. */
const LAYOUTS = [
	{name: 'land', width: 1512, height: 860},
	{name: 'port', width: 820, height: 1180},
	{name: 'phone', width: 390, height: 844},
];

const checks = [];

function record(name, ok, detail) {
	checks.push({name, ok, detail});
	const mark = ok ? '  ok  ' : ' FAIL ';

	console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, label) {
	if (!OUT) return;

	mkdirSync(OUT, {recursive: true});
	await page.screenshot({path: resolve(OUT, `${label}.png`)});
}

/**
 * Is this element actually reachable by a finger?
 *
 * Hit-tests the centre of every visible control and reports the ones where
 * something else is on top. This is the check that would have caught the
 * pointer-events bug, the corner-pile bug, and the minimap sitting on the
 * time-of-day button — all three at once.
 */
const REACHABILITY = `() => {
	const out = [];
	const seen = new Set();
	document.querySelectorAll('.cab *, .cab-sheet *, #metro-map-overlay *, #game-hud > div *').forEach(el => {
		if (el.namespaceURI && el.namespaceURI.includes('svg')) return;
		const cs = getComputedStyle(el);
		if (cs.cursor !== 'pointer' && el.tagName !== 'BUTTON') return;
		if (cs.visibility === 'hidden' || cs.display === 'none') return;
		const r = el.getBoundingClientRect();
		if (r.width < 8 || r.height < 8) return;
		const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
		if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return;
		const top = document.elementFromPoint(cx, cy);
		const ok = !!top && (el.contains(top) || top === el);
		const label = (el.getAttribute('title') || el.getAttribute('aria-label') ||
			(el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24) ||
			'.' + (el.className || '').toString().split(' ')[0]);
		const key = label + Math.round(r.x) + Math.round(r.y);
		if (seen.has(key)) return;
		seen.add(key);
		if (!ok) {
			out.push({label, at: [Math.round(r.x), Math.round(r.y)],
				blockedBy: top ? (top.tagName + (top.id ? '#' + top.id : '') + '.' + (top.className || '').toString().split(' ')[0]) : 'nothing'});
		}
	});
	return out;
}`;

/** Panels must not sit on top of each other in any layout. */
const OVERLAPS = `() => {
	const sels = ['.cab-dest', '.cab-rib', '.cab-mini', '.cab-util', '.cab-con'];
	const boxes = sels.map(sel => {
		const el = document.querySelector(sel);
		if (!el) return null;
		const cs = getComputedStyle(el);
		if (cs.display === 'none') return null;
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return null;
		return {sel, x: r.x, y: r.y, w: r.width, h: r.height};
	}).filter(Boolean);
	const hits = [];
	for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
		const a = boxes[i], b = boxes[j];
		if (!(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)) {
			hits.push(a.sel + ' x ' + b.sel);
		}
	}
	const off = boxes.filter(b => b.x < -1 || b.y < -1 || b.x + b.w > innerWidth + 1 || b.y + b.h > innerHeight + 1);
	return {overlaps: hits, offscreen: off.map(b => b.sel), dataO: document.querySelector('.cab').dataset.o};
}`;

/**
 * Close the release splash, however late it appears.
 *
 * It is raised once the map has loaded, which can be well after the page is
 * ready — so "not up yet" and "already dismissed" look identical if you only
 * check once. Wait for it to exist first, then close it and confirm.
 */
async function dismissSplash(page) {
	try {
		await page.waitForSelector('#release-splash', {timeout: 20000});
	} catch {
		return; // never appeared: this release has already been announced
	}

	for (let i = 0; i < 20; i++) {
		await page.evaluate(`() => document.getElementById('release-splash-dismiss')?.click()`);
		await page.waitForTimeout(300);

		if (!await page.evaluate(`() => !!document.getElementById('release-splash')`)) return;
	}

	throw new Error('the release splash would not close');
}

async function openMenu(page) {
	await page.evaluate(`() => { document.querySelector('.cab-sheet .x')?.click(); }`);
	await page.waitForTimeout(120);
	await page.click('.cab-util > *:nth-child(3)');
	await page.waitForTimeout(200);
}

async function main() {
	const browser = await chromium.launch({
		channel: 'chrome',
		headless: !HEADED,
		args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
	});
	const page = await browser.newPage({viewport: {width: 1512, height: 860}});
	const consoleErrors = [];

	page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

	console.log(`\nMetroRider UI audit — ${URL}\n`);

	await page.goto(URL, {waitUntil: 'domcontentloaded'});
	await page.waitForTimeout(7000);

	// --- before the game starts -------------------------------------------
	const preStart = await page.evaluate(`() => {
		const cab = document.querySelector('.cab');
		return {dataO: cab?.getAttribute('data-o'), display: cab ? getComputedStyle(cab).display : null,
			version: document.querySelector('#game-version-badge')?.textContent ?? null};
	}`);

	record('layout is set before the first frame', preStart.dataO !== null && preStart.dataO !== '',
		`data-o=${preStart.dataO}`);
	record('driving console is hidden on the start screen', preStart.display === 'none',
		`display=${preStart.display}`);
	console.log(`       version: ${preStart.version}\n`);
	await shot(page, '01-start-screen');

	// --- start the game ----------------------------------------------------
	await dismissSplash(page);
	await page.locator('text=\u25B6 Play:').first().click();
	await page.waitForTimeout(4000);

	const running = await page.evaluate(`() => ({active: !!window.__trainSystem?.gameActive,
		display: getComputedStyle(document.querySelector('.cab')).display})`);

	record('pressing Play starts the game', running.active);
	record('driving console appears once driving', running.display !== 'none');
	await shot(page, '02-driving');

	// --- every control reachable, in every layout --------------------------
	for (const layout of LAYOUTS) {
		await page.setViewportSize({width: layout.width, height: layout.height});
		await page.waitForTimeout(700);

		const geom = await page.evaluate(OVERLAPS);

		record(`${layout.name}: stylesheet layout applied`, geom.dataO === layout.name, `data-o=${geom.dataO}`);
		record(`${layout.name}: panels do not overlap`, geom.overlaps.length === 0, geom.overlaps.join(', '));
		record(`${layout.name}: panels are on screen`, geom.offscreen.length === 0, geom.offscreen.join(', '));

		const blocked = await page.evaluate(REACHABILITY);

		record(`${layout.name}: every control is reachable`, blocked.length === 0,
			blocked.map(b => `${b.label} blocked by ${b.blockedBy}`).join(' | '));
		await shot(page, `03-layout-${layout.name}`);
	}

	await page.setViewportSize({width: 1512, height: 860});
	await page.waitForTimeout(600);

	// --- every menu row does something -------------------------------------
	await openMenu(page);

	const rowNames = await page.evaluate(
		`() => [...document.querySelectorAll('.cab-sheet .row-item .t')].map(t => t.textContent)`);

	record('the menu opens', rowNames.length > 0, `${rowNames.length} rows`);

	// These two hand off to the legacy dialogs rather than opening a sheet.
	const HANDS_OFF = new Set(['Load a map by link', 'Trains & sounds']);
	const ACTIONS = new Set(['Turn the train around']);

	for (let i = 0; i < rowNames.length; i++) {
		const name = rowNames[i];

		if (HANDS_OFF.has(name)) continue;

		await openMenu(page);

		const before = await page.evaluate(`() => document.querySelector('.cab-sheet h3')?.textContent`);

		await page.click(`.cab-sheet .row-item:nth-child(${i + 1})`);
		await page.waitForTimeout(450);

		const after = await page.evaluate(`() => ({
			title: document.querySelector('.cab-sheet h3')?.textContent ?? null,
			rows: document.querySelectorAll('.cab-sheet .row-item').length,
			overlay: !!document.getElementById('metro-map-overlay'),
		})`);

		// An action row closes the sheet and does its thing; a drill-down row
		// replaces the sheet with a different one.
		const ok = ACTIONS.has(name) ? after.title === null : (after.title !== before && after.title !== null);

		record(`menu: "${name}" responds`, ok, after.title ? `→ ${after.title} (${after.rows})` : 'closed');
	}

	// --- the line picker actually changes the line -------------------------
	await openMenu(page);
	await page.click('.cab-sheet .row-item:nth-child(1)');
	await page.waitForTimeout(400);

	const lineCount = await page.evaluate(`() => document.querySelectorAll('.cab-sheet .row-item').length`);

	record('line picker lists the lines', lineCount > 1, `${lineCount} lines`);
	await shot(page, '04-line-picker');

	const beforeLine = await page.evaluate(`() => window.__trainSystem.currentLineIdx`);

	await page.click('.cab-sheet .row-item:nth-child(2)');
	await page.waitForTimeout(500);

	const panelOpen = await page.evaluate(
		`() => [...document.getElementById('game-hud').children].some(el => (el.textContent||'').startsWith('◀'))`);

	record('picking a line opens its stations', panelOpen);
	await shot(page, '05-station-panel');

	const changed = await page.evaluate(`() => {
		const hud = document.getElementById('game-hud');
		const panel = [...hud.children].find(el => (el.textContent||'').startsWith('◀'));
		if (!panel) return null;
		const rows = [...panel.querySelectorAll('div')].filter(d => d.style.cursor === 'pointer' && d.textContent.trim().length > 2);
		rows[2]?.click();
		return true;
	}`);

	await page.waitForTimeout(900);

	const afterLine = await page.evaluate(`() => window.__trainSystem.currentLineIdx`);

	record('picking a station drives that line', changed && afterLine !== beforeLine,
		`line ${beforeLine} → ${afterLine}`);

	// --- the minimap is a map ----------------------------------------------
	const mini = await page.evaluate(`() => {
		const svg = document.querySelector('.cab-mini .plot svg');
		const d = [...(svg?.querySelectorAll('path') ?? [])].map(p => p.getAttribute('d'));
		return {paths: d.length, stations: svg?.querySelectorAll('circle').length ?? 0,
			foot: document.querySelector('.cab-mini .foot')?.textContent ?? '',
			// The placeholder that shipped for nine releases, so it can never come back.
			isPlaceholder: d.some(x => x && x.startsWith('M8.0 84.0 L30.0 66.0'))};
	}`);

	record('the minimap draws real geometry', mini.paths > 0 && !mini.isPlaceholder,
		`${mini.paths} lines, ${mini.stations} stations, "${mini.foot}"`);

	// --- photo mode has a way out ------------------------------------------
	await openMenu(page);
	await page.evaluate(
		`() => [...document.querySelectorAll('.cab-sheet .row-item')].find(r => r.querySelector('.t')?.textContent === 'Camera')?.click()`);
	await page.waitForTimeout(350);
	await page.evaluate(
		`() => [...document.querySelectorAll('.cab-sheet .row-item')].find(r => r.querySelector('.t')?.textContent === 'Photo')?.click()`);
	await page.waitForTimeout(600);

	const photo = await page.evaluate(`() => {
		const exit = document.getElementById('photo-exit');
		if (!exit) return {exit: false};
		const r = exit.getBoundingClientRect();
		const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		return {exit: true, clickable: exit.contains(top) || top === exit};
	}`);

	record('photo mode leaves a way back', photo.exit && photo.clickable);
	await shot(page, '06-photo-mode');

	await page.evaluate(`() => document.getElementById('photo-exit')?.click()`);
	await page.waitForTimeout(500);

	record('leaving photo mode restores the console',
		await page.evaluate(`() => getComputedStyle(document.querySelector('.cab')).display !== 'none'`));

	// --- console errors -----------------------------------------------------
	// Upstream tile 404s are not ours and are constant on maps that reach open
	// water; anything else is worth knowing about.
	const ours = consoleErrors.filter(e => !/tiles\.streets\.gl|Failed to load resource/.test(e));

	record('no unexpected console errors', ours.length === 0, ours.slice(0, 3).join(' | '));

	await browser.close();

	const failed = checks.filter(c => !c.ok);

	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

	if (OUT) {
		mkdirSync(OUT, {recursive: true});
		writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({url: URL, checks}, null, 2));
		console.log(`artifacts: ${OUT}`);
	}

	if (failed.length > 0) {
		console.log(`\nFAILED:\n${failed.map(f => `  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`).join('\n')}`);
		process.exit(1);
	}
}

main().catch(err => {
	console.error('\naudit crashed:', err);
	process.exit(1);
});
