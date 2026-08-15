import {readdirSync, readFileSync, statSync} from 'fs';
import {join} from 'path';

/**
 * Every mesh a system exposes must be in the pass that draws it.
 *
 * `GBufferPass.renderTrains()` draws an EXPLICIT LIST. A mesh added to the
 * scene wrapper alone is never drawn — which is how the player's avatar came
 * to be built, positioned, posed, and invisible, and how a whole release went
 * out before anyone noticed. Nothing about that failure is visible to a
 * type-check or to any test of the system that owns the mesh: the system is
 * perfectly correct in isolation.
 *
 * So this walks the source instead. Any system that publishes a
 * `TrainMeshObject` (or an array of them) is claiming "draw this"; if the pass
 * has never heard of it, the claim is false and the build should say so.
 */

const GAME_DIR = join(__dirname, '..', 'app', 'game');
const GBUFFER = join(__dirname, '..', 'app', 'render', 'passes', 'GBufferPass.ts');

function sourceFiles(dir: string): string[] {
	const out: string[] = [];

	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);

		if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
		else if (p.endsWith('.ts')) out.push(p);
	}

	return out;
}

/** Every `public <name>: TrainMeshObject…` in the game code. */
function publishedMeshes(): {file: string; name: string}[] {
	const found: {file: string; name: string}[] = [];

	for (const file of sourceFiles(GAME_DIR)) {
		const text = readFileSync(file, 'utf8');

		for (const m of text.matchAll(/^\s*public\s+(\w+)\s*:\s*TrainMeshObject/gm)) {
			found.push({file, name: m[1]});
		}
	}

	return found;
}

describe('every published mesh reaches the draw list', () => {
	const published = publishedMeshes();
	const pass = readFileSync(GBUFFER, 'utf8');

	test('the game publishes meshes at all (the walker still works)', () => {
		// If a refactor renames TrainMeshObject this test would quietly pass by
		// finding nothing, which is the same silence it exists to break.
		expect(published.length).toBeGreaterThanOrEqual(8);
	});

	test.each(published.map(p => [p.name, p.file] as const))(
		'%s is named in GBufferPass',
		(name: string) => {
			expect(pass).toContain(`.${name}`);
		},
	);

	test('the list is drawn, not just assembled', () => {
		// `allMeshes` is built and then filtered and drawn; if the draw loop
		// ever stops reading it, everything above is decoration.
		expect(pass).toMatch(/const allMeshes = \[/);
		expect(pass).toMatch(/for \(const meshObj of meshes\)/);
	});
});
