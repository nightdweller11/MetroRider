import * as fs from 'fs';
import * as path from 'path';

const SHADERS_DIR = path.resolve(__dirname, '../resources/shaders');
const CHUNKS_DIR = path.resolve(__dirname, '../resources/shaders/chunks');

const IncludePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;

function loadChunks(): Record<string, string> {
	const chunks: Record<string, string> = {};
	const files = fs.readdirSync(CHUNKS_DIR).filter(f => f.endsWith('.glsl'));
	for (const file of files) {
		const name = file.replace('.glsl', '');
		chunks[name] = fs.readFileSync(path.join(CHUNKS_DIR, file), 'utf-8');
	}
	return chunks;
}

function resolveIncludes(source: string, chunks: Record<string, string>): string {
	return source.replace(IncludePattern, (_match, include) => {
		const chunk = chunks[include];
		if (!chunk) {
			throw new Error(`Cannot resolve #include <${include}>`);
		}
		return resolveIncludes(chunk, chunks);
	});
}

jest.mock('~/app/render/shaders/ShaderChunks', () => {
	return { default: loadChunks() };
});

import ShaderPrecompiler from '~/app/render/shaders/ShaderPrecompiler';

function loadShader(name: string): string {
	return fs.readFileSync(path.join(SHADERS_DIR, name), 'utf-8');
}

function preprocessShader(
	source: string,
	defines: Record<string, string>,
	shaderName: string
): string {
	const chunks = loadChunks();
	const withIncludes = resolveIncludes(source, chunks);
	return ShaderPrecompiler.resolveNameAndDefines(withIncludes, shaderName, defines);
}

function getTokenLines(source: string): string[] {
	return source.split('\n');
}

function findFirstNonPreprocessorLine(lines: string[]): number {
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//')) {
			continue;
		}
		return i;
	}
	return lines.length;
}

function findExtensionLines(lines: string[]): number[] {
	const result: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].trim().startsWith('#extension')) {
			result.push(i);
		}
	}
	return result;
}

function expandIfdefBlocks(source: string, defines: Record<string, string>): string {
	const lines = source.split('\n');
	const output: string[] = [];
	const stack: boolean[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed.startsWith('#ifdef ')) {
			const symbol = trimmed.slice(7).trim();
			stack.push(symbol in defines);
			continue;
		}
		if (trimmed.startsWith('#ifndef ')) {
			const symbol = trimmed.slice(8).trim();
			stack.push(!(symbol in defines));
			continue;
		}
		if (trimmed === '#else') {
			stack[stack.length - 1] = !stack[stack.length - 1];
			continue;
		}
		if (trimmed === '#endif') {
			stack.pop();
			continue;
		}

		if (stack.every(v => v)) {
			output.push(line);
		}
	}

	return output.join('\n');
}

const MULTI_DRAW_DEFINES: Record<string, string> = {
	MULTI_DRAW_ENABLED: '1',
	MAX_BATCH_SIZE: '32',
	TILE_SIZE: '611.4962158203',
	USE_HEIGHT: '1',
	IS_EXTRUDED: '0',
	NORMAL_MIX_FROM: '10000.0',
	NORMAL_MIX_TO: '14500.0',
	DETAIL_UV_SCALE: '64.0000000000',
};

const NO_MULTI_DRAW_DEFINES: Record<string, string> = {
	TILE_SIZE: '611.4962158203',
	USE_HEIGHT: '1',
	IS_EXTRUDED: '0',
	NORMAL_MIX_FROM: '10000.0',
	NORMAL_MIX_TO: '14500.0',
	DETAIL_UV_SCALE: '64.0000000000',
};

const MULTI_DRAW_SHADERS = [
	'extruded.vert',
	'buildingDepth.vert',
	'projected.vert',
	'projectedDepth.vert',
];

describe('Shader preprocessing: #extension placement', () => {
	for (const shaderFile of MULTI_DRAW_SHADERS) {
		it(`${shaderFile}: #extension GL_ANGLE_multi_draw appears before any non-preprocessor tokens`, () => {
			const source = loadShader(shaderFile);
			const processed = preprocessShader(source, MULTI_DRAW_DEFINES, shaderFile.replace('.', '_'));
			const lines = getTokenLines(processed);

			const extensionLines = findExtensionLines(lines);
			expect(extensionLines.length).toBeGreaterThanOrEqual(1);

			const firstNonPreprocessor = findFirstNonPreprocessorLine(lines);

			for (const extLine of extensionLines) {
				expect(extLine).toBeLessThan(firstNonPreprocessor);
			}
		});
	}

	it('ShaderPrecompiler injects #extension when MULTI_DRAW_ENABLED is in defines', () => {
		const source = '#version 300 es\nprecision highp float;\nvoid main() {}';
		const result = ShaderPrecompiler.resolveNameAndDefines(source, 'test', { MULTI_DRAW_ENABLED: '1' });
		const lines = result.split('\n');

		const hasExtension = lines.some(l => l.includes('#extension GL_ANGLE_multi_draw'));
		expect(hasExtension).toBe(true);

		const versionIdx = lines.findIndex(l => l.startsWith('#version'));
		const extensionIdx = lines.findIndex(l => l.includes('#extension GL_ANGLE_multi_draw'));
		const precisionIdx = lines.findIndex(l => l.startsWith('precision'));

		expect(extensionIdx).toBeGreaterThan(versionIdx);
		expect(extensionIdx).toBeLessThan(precisionIdx);
	});

	it('ShaderPrecompiler does NOT inject #extension when MULTI_DRAW_ENABLED is absent', () => {
		const source = '#version 300 es\nprecision highp float;\nvoid main() {}';
		const result = ShaderPrecompiler.resolveNameAndDefines(source, 'test', {});
		expect(result).not.toContain('#extension GL_ANGLE_multi_draw');
	});
});

describe('Shader preprocessing: no inline #extension directives in shader source', () => {
	for (const shaderFile of MULTI_DRAW_SHADERS) {
		it(`${shaderFile}: does not contain inline #extension directive (handled by ShaderPrecompiler)`, () => {
			const source = loadShader(shaderFile);
			const extensionMatch = source.match(/#extension\s+GL_ANGLE_multi_draw/);
			expect(extensionMatch).toBeNull();
		});
	}
});

describe('Shader preprocessing: variable scoping with MULTI_DRAW_ENABLED', () => {
	for (const shaderFile of MULTI_DRAW_SHADERS) {
		it(`${shaderFile}: no undeclared UBO member references outside main() when MULTI_DRAW_ENABLED`, () => {
			const source = loadShader(shaderFile);
			const chunks = loadChunks();
			const withIncludes = resolveIncludes(source, chunks);

			const expanded = expandIfdefBlocks(withIncludes, MULTI_DRAW_DEFINES);

			const mainIdx = expanded.indexOf('void main()');
			if (mainIdx === -1) {
				return;
			}

			const beforeMain = expanded.substring(0, mainIdx);

			const functionBodies = beforeMain.match(
				/(?:float|vec[234]|mat[234]|int|void|bool)\s+\w+\s*\([^)]*\)\s*\{[^}]*\}/gs
			) || [];

			const perMeshUniforms = [
				'modelViewMatrix', 'modelViewMatrixPrev', 'tileId',
				'transformNormal0', 'transformNormal1', 'terrainRingSize',
				'terrainRingOffset', 'terrainLevelId', 'segmentCount',
				'cameraPosition', 'detailTextureOffset',
			];

			for (const body of functionBodies) {
				for (const uniform of perMeshUniforms) {
					const pattern = new RegExp(`(?<!\\.)\\b${uniform}\\b(?!\\s*[:(])`, 'g');
					const matches = body.match(pattern) || [];
					const filtered = matches.filter(m => {
						const idx = body.indexOf(m);
						const before = body.substring(Math.max(0, idx - 2), idx);
						return !before.endsWith('.');
					});

					if (filtered.length > 0) {
						fail(
							`${shaderFile}: function before main() references UBO member '${uniform}' ` +
							`directly, but it is inside a struct when MULTI_DRAW_ENABLED. ` +
							`Pass it as a function parameter instead.\n` +
							`Function body:\n${body}`
						);
					}
				}
			}
		});
	}
});

describe('Shader preprocessing: MULTI_DRAW_ENABLED shader structure', () => {
	for (const shaderFile of MULTI_DRAW_SHADERS) {
		it(`${shaderFile}: gl_DrawID only used inside MULTI_DRAW_ENABLED blocks`, () => {
			const source = loadShader(shaderFile);
			const chunks = loadChunks();
			const withIncludes = resolveIncludes(source, chunks);

			const nonMultiDraw = expandIfdefBlocks(withIncludes, NO_MULTI_DRAW_DEFINES);
			expect(nonMultiDraw).not.toContain('gl_DrawID');
		});

		it(`${shaderFile}: compiles cleanly without MULTI_DRAW_ENABLED (no struct references)`, () => {
			const source = loadShader(shaderFile);
			const chunks = loadChunks();
			const withIncludes = resolveIncludes(source, chunks);

			const expanded = expandIfdefBlocks(withIncludes, NO_MULTI_DRAW_DEFINES);
			expect(expanded).not.toContain('tiles[');
			expect(expanded).not.toContain('PerMeshArray');
		});

		it(`${shaderFile}: MULTI_DRAW_ENABLED path uses tiles[] array`, () => {
			const source = loadShader(shaderFile);
			const chunks = loadChunks();
			const withIncludes = resolveIncludes(source, chunks);

			const expanded = expandIfdefBlocks(withIncludes, MULTI_DRAW_DEFINES);

			const mainIdx = expanded.indexOf('void main()');
			const mainBody = expanded.substring(mainIdx);
			expect(mainBody).toContain('tiles[gl_DrawID]');
		});
	}
});

describe('Shader preprocessing: #version is first line', () => {
	for (const shaderFile of MULTI_DRAW_SHADERS) {
		it(`${shaderFile}: processed output starts with #version 300 es`, () => {
			const source = loadShader(shaderFile);
			const processed = preprocessShader(source, MULTI_DRAW_DEFINES, shaderFile.replace('.', '_'));
			const firstLine = processed.split('\n')[0].trim();
			expect(firstLine).toBe('#version 300 es');
		});
	}
});

describe('Shader preprocessing: directive ordering in full pipeline', () => {
	for (const shaderFile of MULTI_DRAW_SHADERS) {
		it(`${shaderFile}: full preprocessed output has correct directive order`, () => {
			const source = loadShader(shaderFile);
			const processed = preprocessShader(source, MULTI_DRAW_DEFINES, shaderFile.replace('.', '_'));
			const lines = processed.split('\n');

			const versionIdx = lines.findIndex(l => l.trim().startsWith('#version'));
			const extensionIdxs = lines
				.map((l, i) => l.trim().startsWith('#extension') ? i : -1)
				.filter(i => i >= 0);
			const precisionIdx = lines.findIndex(l => l.trim().startsWith('precision'));

			expect(versionIdx).toBe(0);
			expect(extensionIdxs.length).toBeGreaterThanOrEqual(1);

			for (const extIdx of extensionIdxs) {
				expect(extIdx).toBeGreaterThan(versionIdx);
				expect(extIdx).toBeLessThan(precisionIdx);
			}
		});
	}
});
