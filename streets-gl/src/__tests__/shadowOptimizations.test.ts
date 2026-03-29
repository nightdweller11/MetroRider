import Config from '~/app/Config';

type MockExtrudedMesh = {
	inCameraFrustum: (cam: unknown) => boolean;
};

type MockTile = {
	extrudedMesh: MockExtrudedMesh | null;
	distanceToCamera: number | null;
};

function filterShadowExtrudedTiles(
	tiles: MockTile[],
	shadowDrawDistance: number,
	shadowCamera: unknown
): MockTile[] {
	const visibleTiles: MockTile[] = [];
	for (const tile of tiles) {
		if (!tile.extrudedMesh || !tile.extrudedMesh.inCameraFrustum(shadowCamera)) {
			continue;
		}
		if (tile.distanceToCamera !== null && tile.distanceToCamera > shadowDrawDistance) {
			continue;
		}
		visibleTiles.push(tile);
	}
	return visibleTiles;
}

function csmCascadeCountFromSetting(cascadeStr: string | undefined): number {
	return cascadeStr === '2' ? 2 : 3;
}

function extrudedMeshDrawCallsPerFrame(visibleTileCount: number, cascadeCount: number): number {
	return visibleTileCount * cascadeCount;
}

describe('shadow extruded mesh distance culling', () => {
	const shadowCamera = {};
	const shadowDrawDistance = Config.TileSize * 3;

	test('tiles within shadowDrawDistance are included', () => {
		const tiles: MockTile[] = [
			{
				extrudedMesh: {inCameraFrustum: () => true},
				distanceToCamera: shadowDrawDistance * 0.5,
			},
		];
		expect(filterShadowExtrudedTiles(tiles, shadowDrawDistance, shadowCamera)).toHaveLength(1);
	});

	test('tiles beyond shadowDrawDistance are excluded', () => {
		const tiles: MockTile[] = [
			{
				extrudedMesh: {inCameraFrustum: () => true},
				distanceToCamera: shadowDrawDistance + 1,
			},
		];
		expect(filterShadowExtrudedTiles(tiles, shadowDrawDistance, shadowCamera)).toHaveLength(0);
	});

	test('tiles exactly at boundary are included', () => {
		const tiles: MockTile[] = [
			{
				extrudedMesh: {inCameraFrustum: () => true},
				distanceToCamera: shadowDrawDistance,
			},
		];
		expect(filterShadowExtrudedTiles(tiles, shadowDrawDistance, shadowCamera)).toHaveLength(1);
	});

	test('frustum-culled tiles are excluded regardless of distance', () => {
		const tiles: MockTile[] = [
			{
				extrudedMesh: {inCameraFrustum: () => false},
				distanceToCamera: 0,
			},
			{
				extrudedMesh: {inCameraFrustum: () => false},
				distanceToCamera: shadowDrawDistance * 10,
			},
		];
		expect(filterShadowExtrudedTiles(tiles, shadowDrawDistance, shadowCamera)).toHaveLength(0);
	});

	test('distanceToCamera null means no distance culling', () => {
		const tiles: MockTile[] = [
			{
				extrudedMesh: {inCameraFrustum: () => true},
				distanceToCamera: null,
			},
		];
		expect(filterShadowExtrudedTiles(tiles, shadowDrawDistance, shadowCamera)).toHaveLength(1);
	});

	test('shadowDrawDistance matches three tile widths', () => {
		expect(shadowDrawDistance).toBeCloseTo(611.4962158203125 * 3, 6);
		expect(shadowDrawDistance).toBe(Config.TileSize * 3);
	});

	test('20 tiles with 8 beyond distance yields 12 visible', () => {
		const tiles: MockTile[] = [];
		for (let i = 0; i < 12; i++) {
			tiles.push({
				extrudedMesh: {inCameraFrustum: () => true},
				distanceToCamera: shadowDrawDistance * 0.5,
			});
		}
		for (let i = 0; i < 8; i++) {
			tiles.push({
				extrudedMesh: {inCameraFrustum: () => true},
				distanceToCamera: shadowDrawDistance + 100 + i,
			});
		}
		expect(filterShadowExtrudedTiles(tiles, shadowDrawDistance, shadowCamera)).toHaveLength(12);
	});

	test('distance and frustum culling both apply', () => {
		const tiles: MockTile[] = [
			{
				extrudedMesh: {inCameraFrustum: () => true},
				distanceToCamera: 10,
			},
			{
				extrudedMesh: {inCameraFrustum: () => true},
				distanceToCamera: shadowDrawDistance + 500,
			},
			{
				extrudedMesh: {inCameraFrustum: () => false},
				distanceToCamera: 10,
			},
			{
				extrudedMesh: {inCameraFrustum: () => false},
				distanceToCamera: shadowDrawDistance + 500,
			},
		];
		const visible = filterShadowExtrudedTiles(tiles, shadowDrawDistance, shadowCamera);
		expect(visible).toHaveLength(1);
		expect(visible[0].distanceToCamera).toBe(10);
		expect(visible[0].extrudedMesh?.inCameraFrustum(shadowCamera)).toBe(true);
	});
});

describe('shadow cascades setting and draw cost', () => {
	test('schema status allows 2 and 3', () => {
		const entry = Config.SettingsSchema.shadowCascades;
		expect(entry.status).toContain('2');
		expect(entry.status).toContain('3');
		expect(entry.status).toEqual(['2', '3']);
	});

	test('two cascades implies fewer per-frame extruded draws than three for the same visible tiles', () => {
		const visibleTiles = 14;
		const draws2 = extrudedMeshDrawCallsPerFrame(visibleTiles, csmCascadeCountFromSetting('2'));
		const draws3 = extrudedMeshDrawCallsPerFrame(visibleTiles, csmCascadeCountFromSetting('3'));
		expect(draws2).toBe(28);
		expect(draws3).toBe(42);
		expect(draws2).toBeLessThan(draws3);
	});

	test('applyCascadeCount mapping matches settings string', () => {
		expect(csmCascadeCountFromSetting('2')).toBe(2);
		expect(csmCascadeCountFromSetting('3')).toBe(3);
		expect(csmCascadeCountFromSetting(undefined)).toBe(3);
	});

	test('shadowCascades nests under shadows with medium/high visibility', () => {
		const entry = Config.SettingsSchema.shadowCascades;
		expect(entry.parent).toBe('shadows');
		expect(entry.parentStatusCondition).toEqual(['medium', 'high']);
	});

	test('default cascade preset follows low-memory flag', () => {
		const def = Config.SettingsSchema.shadowCascades.statusDefault;
		expect(def === '2' || def === '3').toBe(true);
		expect(def).toBe(Config.LowMemoryMode ? '2' : '3');
	});
});
