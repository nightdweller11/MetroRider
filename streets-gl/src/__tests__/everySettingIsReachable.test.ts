import {readFileSync} from 'fs';
import {join} from 'path';

/**
 * Every setting the engine defines must have a row a player can reach.
 *
 * The cab interface replaced a React settings panel that is not mounted in the
 * driving shell at all — so fifteen of the twenty-one settings, all of the
 * picture controls, silently had no path in the game. You could select
 * Graphics → Custom and be offered nothing to customise. Nothing failed: the
 * settings existed, the schema was valid, the engine honoured them, and no
 * test could tell that the only way to change them had been deleted.
 *
 * That is the same shape as a mesh built and never drawn, so it gets the same
 * kind of guard: walk the source and insist that every key defined is named by
 * a sheet the interface actually opens.
 */

const CONFIG = join(__dirname, '..', 'app', 'Config.ts');
const GAME_UI = join(__dirname, '..', 'app', 'game', 'GameUISystem.ts');

/** Every key under `Config.SettingsSchema`. */
function definedSettings(): string[] {
	const text = readFileSync(CONFIG, 'utf8');
	const start = text.indexOf('SettingsSchema: {');
	const open = text.indexOf('{', start);
	let depth = 0;
	let end = open;

	for (let i = open; i < text.length; i++) {
		if (text[i] === '{') depth++;
		else if (text[i] === '}') {
			depth--;
			if (depth === 0) { end = i; break; }
		}
	}

	const body = text.slice(open + 1, end);

	return [...body.matchAll(/^\t\t(\w+):\s*\{/gm)].map(m => m[1]);
}

describe('every setting has a way in', () => {
	const settings = definedSettings();
	const ui = readFileSync(GAME_UI, 'utf8');

	test('the schema was actually found (the walker still works)', () => {
		// A refactor that renames the schema would otherwise make this suite
		// pass by checking nothing, which is the same silence it exists to end.
		expect(settings.length).toBeGreaterThanOrEqual(15);
		expect(settings).toContain('shadows');
	});

	test.each(settings)('%s is offered by a sheet', (key: string) => {
		expect(ui).toContain(`'${key}'`);
	});

	test('the picture sheet is reachable from the settings sheet', () => {
		// Rows are built in one place and opened from another; a sheet nothing
		// opens is exactly as unreachable as no sheet at all.
		expect(ui).toMatch(/openGraphicsSheet\(\)/);
		expect(ui).toMatch(/graphicsSheetRows\(\)/);
		// And the row that opens it must survive its own tap.
		const row = ui.slice(ui.indexOf("title: 'Picture'"), ui.indexOf("title: 'Picture'") + 400);

		expect(row).toContain('keepOpen: true');
	});
});
