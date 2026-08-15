#!/usr/bin/env node
/**
 * Can the game be DRIVEN with a finger?
 *
 * The game is played on an iPad. It shipped with the power lever and the brake
 * drawn as instruments and wired to nothing, and the on-screen accelerate and
 * brake buttons had gone away with the legacy chrome — so on the device it was
 * built for there was no way to move the train at all. Keyboard-only, on a
 * machine with no keyboard.
 *
 * This drives the real controls the way a hand does: a touch pointer pressed,
 * held, and released, in a touch-emulating context. It asserts the train
 * actually accelerates and actually stops. Mouse is checked too, because a
 * press-and-hold has to work with both.
 *
 *   node scripts/touch-audit.mjs
 *   node scripts/touch-audit.mjs --url=https://metrorider.net
 */

import {chromium, devices} from 'playwright-core';

const args = new Map(process.argv.slice(2).map(a => {
	const [k, v] = a.replace(/^--/, '').split('=');

	return [k, v ?? true];
}));

const URL = args.get('url') ?? 'http://localhost:3001/';
const checks = [];

function record(name, ok, detail) {
	checks.push({name, ok});
	console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
}


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

/** Start the game the way a player does. */
async function startGame(page) {
	await page.goto(URL, {waitUntil: 'domcontentloaded'});
	await page.waitForTimeout(7000);
	// The splash is raised once the map has loaded, which can land AFTER the
	// wait above — so dismiss until it is actually gone rather than once.
	await dismissSplash(page);
	await page.locator('text=\u25B6 Play:').first().click();
	await page.waitForTimeout(4500);
}

const speed = page => page.evaluate(`() => (window.__trainSystem?.physicsState?.trainSpeed ?? 0) * 3.6`);

async function main() {
	const browser = await chromium.launch({
		channel: 'chrome',
		headless: true,
		args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
	});

	// ---- touch, as an iPad ------------------------------------------------
	const ipad = await browser.newContext({
		...devices['iPad Pro 11'],
		hasTouch: true,
		isMobile: true,
	});
	const page = await ipad.newPage();

	console.log(`\nMetroRider touch audit — ${URL}`);
	console.log(`viewport ${JSON.stringify(page.viewportSize())}, touch enabled\n`);

	await startGame(page);

	record('the game started', await page.evaluate(`() => !!window.__trainSystem?.gameActive`));

	const lever = page.locator('.cab-lever');
	const brake = page.locator('.cab-brake');

	record('the power lever is on screen', await lever.isVisible());
	record('the brake is on screen', await brake.isVisible());

	// Hold the power lever with a finger for two seconds.
	const before = await speed(page);
	const box = await lever.boundingBox();

	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
	// tap is press+release; for a hold we need the raw pointer sequence.
	await page.dispatchEvent('.cab-lever', 'pointerdown', {pointerId: 1, pointerType: 'touch', isPrimary: true});
	await page.waitForTimeout(2500);

	const during = await speed(page);

	await page.dispatchEvent('.cab-lever', 'pointerup', {pointerId: 1, pointerType: 'touch', isPrimary: true});
	await page.waitForTimeout(600);

	record('holding the power lever with a finger accelerates the train',
		during > before + 2, `${before.toFixed(1)} → ${during.toFixed(1)} km/h`);

	// Now the brake.
	const beforeBrake = await speed(page);

	await page.dispatchEvent('.cab-brake', 'pointerdown', {pointerId: 2, pointerType: 'touch', isPrimary: true});
	await page.waitForTimeout(2500);

	const afterBrake = await speed(page);

	await page.dispatchEvent('.cab-brake', 'pointerup', {pointerId: 2, pointerType: 'touch', isPrimary: true});

	record('holding the brake with a finger slows the train',
		afterBrake < beforeBrake - 1, `${beforeBrake.toFixed(1)} → ${afterBrake.toFixed(1)} km/h`);

	// Releasing must actually release: a stuck throttle is the dangerous failure.
	const released = await page.evaluate(`() => ({
		power: window.__trainSystem?.physicsState?.powerNotch ?? -1,
		brake: window.__trainSystem?.physicsState?.brakeNotch ?? -1,
	})`);

	await page.waitForTimeout(1200);

	const settled = await page.evaluate(`() => ({
		power: window.__trainSystem?.physicsState?.powerNotch ?? -1,
		brake: window.__trainSystem?.physicsState?.brakeNotch ?? -1,
	})`);

	record('letting go releases the handles', settled.power < 0.05 && settled.brake < 0.05,
		`power ${released.power.toFixed(2)}→${settled.power.toFixed(2)}, brake ${released.brake.toFixed(2)}→${settled.brake.toFixed(2)}`);

	// A finger that slides off the control must not leave it applied.
	await page.dispatchEvent('.cab-lever', 'pointerdown', {pointerId: 3, pointerType: 'touch', isPrimary: true});
	await page.waitForTimeout(500);
	await page.dispatchEvent('.cab-lever', 'pointercancel', {pointerId: 3, pointerType: 'touch', isPrimary: true});
	await page.waitForTimeout(1200);

	record('a cancelled press does not stick the throttle on',
		await page.evaluate(`() => (window.__trainSystem?.physicsState?.powerNotch ?? 1) < 0.05`));

	// The doors and horn, by finger.
	const doorsBefore = await page.evaluate(`() => !!window.__trainSystem?.physicsState?.doorsOpen`);

	await page.locator('.cab-btn.doors').tap();
	await page.waitForTimeout(900);

	record('the doors button responds to a tap',
		(await page.evaluate(`() => !!window.__trainSystem?.physicsState?.doorsOpen`)) !== doorsBefore);

	// The menu, by finger.
	await page.locator('.cab-util > *:nth-child(3)').tap();
	await page.waitForTimeout(400);

	record('the menu opens with a tap',
		await page.evaluate(`() => !!document.querySelector('.cab-sheet')`));

	await page.locator('.cab-sheet .row-item:nth-child(1)').tap();
	await page.waitForTimeout(500);

	record('a sheet row responds to a tap',
		await page.evaluate(`() => document.querySelector('.cab-sheet h3')?.textContent === 'Pick a line'`));

	// Picking a line must DRIVE that line, not open a second chooser.
	const lineBefore = await page.evaluate(`() => window.__trainSystem.currentLineIdx`);

	await page.locator('.cab-sheet .row-item:nth-child(2)').tap();
	await page.waitForTimeout(1200);

	const lineAfter = await page.evaluate(`() => window.__trainSystem.currentLineIdx`);

	record('tapping a line drives that line', lineAfter !== lineBefore, `line ${lineBefore} → ${lineAfter}`);
	record('tapping a line does not open the old panel',
		await page.evaluate(
			`() => ![...document.getElementById('game-hud').children].some(el => (el.textContent||'').startsWith('◀'))`));

	await ipad.close();

	// ---- the same controls, with a mouse ----------------------------------
	const desktop = await browser.newContext({viewport: {width: 1512, height: 860}});
	const dpage = await desktop.newPage();

	await startGame(dpage);

	const mBefore = await speed(dpage);
	const mbox = await dpage.locator('.cab-lever').boundingBox();

	await dpage.mouse.move(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2);
	await dpage.mouse.down();
	await dpage.waitForTimeout(2500);

	const mDuring = await speed(dpage);

	await dpage.mouse.up();
	await dpage.waitForTimeout(1000);

	record('holding the power lever with a mouse accelerates the train',
		mDuring > mBefore + 2, `${mBefore.toFixed(1)} → ${mDuring.toFixed(1)} km/h`);
	record('releasing the mouse releases the handle',
		await dpage.evaluate(`() => (window.__trainSystem?.physicsState?.powerNotch ?? 1) < 0.05`));

	await browser.close();

	const failed = checks.filter(c => !c.ok);

	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

	if (failed.length) {
		console.log(`\nFAILED:\n${failed.map(f => `  - ${f.name}`).join('\n')}`);
		process.exit(1);
	}
}

main().catch(e => { console.error('\naudit crashed:', e); process.exit(1); });
