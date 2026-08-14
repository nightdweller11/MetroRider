import {SettingsSchema, SettingsSchemaRangeScale} from "~/app/settings/SettingsSchema";

function detectLowMemoryMode(): boolean {
	try {
		if (typeof window !== 'undefined' && window.location.search.includes('mobile=true')) {
			return true;
		}

		if (typeof navigator !== 'undefined') {
			const hasTouch = navigator.maxTouchPoints > 0;
			const smallScreen = typeof screen !== 'undefined' && (screen.width < 1024 || screen.height < 1024);
			const isIPad = hasTouch && /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;

			if (isIPad || (hasTouch && smallScreen)) {
				return true;
			}

			const mem = (navigator as any).deviceMemory;
			if (typeof mem === 'number' && mem < 8) {
				return true;
			}
		}
	} catch {
		// safe fallback
	}
	return false;
}

const _lowMemory = detectLowMemoryMode();

function applyPerformanceMode(low: boolean): void {
	Config.LowMemoryMode = low;
	Config.MaxConcurrentTiles = low ? 40 : 150;
	Config.TileRetentionDistance = low ? 900 : 2500;
	Config.TileWorkingSetDistance = low ? 1400 : 3200;
	Config.TileEvictionGraceSeconds = low ? 5 : 25;
	Config.TileFrustumFar = low ? 2000 : 8000;
	Config.AggressiveEviction = low;
}

const Config = {
	LowMemoryMode: _lowMemory,
	applyPerformanceMode,
	TileSize: /*40075016.68 / (1 << 16)*/ 611.4962158203125,
	MaxConcurrentTiles: _lowMemory ? 40 : 150,
	/**
	 * Tiles closer than this to the camera are never evicted for being out of
	 * frustum. Turning the camera on the spot must not throw away the street
	 * behind you: it is metres away and you will be looking at it again in two
	 * seconds. Without this, an orbit at a station evicted and reloaded tiles
	 * continuously — measured at 2.2 building-mesh patches per frame, with the
	 * buildings visibly popping and re-texturing as their holder tile changed.
	 * One tile is ~1.1 km, so this keeps the immediate neighbourhood resident.
	 */
	TileRetentionDistance: _lowMemory ? 900 : 2500,
	/**
	 * Radius of the rotation-invariant tile working set, metres.
	 *
	 * Membership must not depend on where the camera is pointing: a set
	 * defined by the frustum changes completely on a turn, and a full cache
	 * then swaps itself out and back, which is what made whole blocks of
	 * buildings vanish and return. Held slightly wider than the retention
	 * radius so a tile is never wanted and evictable at the same time.
	 */
	TileWorkingSetDistance: _lowMemory ? 1400 : 3200,
	/**
	 * A tile that has been in view within this many seconds is not evicted.
	 *
	 * The queue is rebuilt from the CURRENT frustum every frame, so turning the
	 * camera makes the tiles behind you eligible for eviction the instant they
	 * leave the view — and you turn back onto them seconds later. Measured on a
	 * stationary camera doing a single slow turn: 278 tiles created and 289
	 * destroyed in five seconds, 113 tile events a second, with the buildings
	 * visibly popping and swapping texture as their holder tile changed. A
	 * grace period costs a little memory and removes the thrash entirely.
	 */
	TileEvictionGraceSeconds: _lowMemory ? 5 : 25,
	/** Wait this long before retrying a tile that failed once (a blip). */
	TileFailureCooldownShort: 20,
	/** After repeated failures the data does not exist — stop asking. */
	TileFailureCooldownLong: 900,
	TileFrustumFar: _lowMemory ? 2000 : 8000,
	AggressiveEviction: _lowMemory,
	// Anisotropic filtering level for world textures. 16 is free on desktop
	// GPUs but measurably slows bandwidth-starved mobile GPUs.
	TextureAnisotropy: _lowMemory ? 4 : 16,
	/**
	 * Rail LOD: distance in metres over which fine track detail fades into the
	 * ballast tone. Kept here rather than inline in the pass so the fade can be
	 * A/B'd at runtime — setting the start beyond the far plane disables it,
	 * which is how its effect was measured against the same camera.
	 */
	RailLodFadeStart: 120,
	RailLodFadeEnd: 420,
	MaxTilesPerWorker: 1,
	WorkersCount: _lowMemory
		? Math.min(2, navigator.hardwareConcurrency)
		: Math.min(4, navigator.hardwareConcurrency),
	StartPosition: {lat: 32.0795, lon: 34.7920, pitch: 45, yaw: 0, distance: 2000},
	MinCameraDistance: 10,
	MaxCameraDistance: 4000,
	SlippyMapTransitionDuration: 400,
	MinFreeCameraHeight: 10,
	CameraZoomSmoothing: 0.4,
	CameraZoomSpeed: 0.0005,
	CameraZoomTrackpadFactor: 4,
	MinCameraPitch: 5,
	MaxCameraPitch: 89.99,
	MinFreeCameraPitch: -89.99,
	MaxFreeCameraPitch: 89.99,
	GroundCameraSpeed: 400,
	GroundCameraSpeedFast: 1200,
	FreeCameraSpeed: 400,
	FreeCameraSpeedFast: 1200,
	FreeCameraRotationSensitivity: 0.00002,
	FreeCameraYawSpeed: 0.8,
	FreeCameraPitchSpeed: 0.8,
	MinTexturedRoofArea: 50,
	MaxTexturedRoofAABBArea: 2e6,
	BuildingSmoothNormalsThreshold: 30,
	LightTransitionDuration: 1,
	OverpassRequestTimeout: 30000,
	CameraFOVZoomFactor: 2,
	CSMShadowCameraNear: 1,
	CSMShadowCameraFar: 20000,
	TerrainRingCount: 6,
	TerrainRingSegmentCount: 64,
	TerrainRingSizeZoom: 13,
	TerrainRingSize: 40075016.68 / (1 << 13),
	TerrainMaskResolution: 32,
	TerrainNormalMixRange: [10000, 14500],
	TerrainUsageTextureSize: 512,
	TerrainUsageTexturePadding: 3,
	TerrainUsageSDFPasses: 3,
	TerrainDetailUVScale: 64,
	SlippyMapMinZoom: 0,
	SlippyMapMaxZoom: 16,
	SlippyMapZoomFactor: 0.001,
	SlippyMapFetchBatchSize: 4,
	SettingsSchema: {
		driveMode: {
			label: 'Driving',
			status: ['simple', 'advanced'],
			statusLabels: ['Simple — gentler, nothing to lose', 'Advanced — full control, runs are scored'],
			statusDefault: 'simple',
			category: 'general'
		},
		timeOfDay: {
			label: 'Time of day',
			status: ['now', 'morning', 'midday', 'evening', 'night'],
			statusLabels: [
				'Now — whatever time it really is',
				'Morning',
				'Midday',
				'Evening — golden light',
				'Night — the city lit up',
			],
			statusDefault: 'now',
			category: 'general'
		},
		announcements: {
			label: 'Station announcements',
			status: ['on', 'off'],
			statusLabels: ['On — stations are announced aloud', 'Off'],
			statusDefault: 'on',
			category: 'general'
		},
		performanceMode: {
			label: 'Graphics tier',
			status: ['low', 'medium', 'high', 'auto', 'custom'],
			statusLabels: ['Low-end', 'Medium', 'High-end', 'Auto (finds the best)', 'Custom'],
			statusDefault: 'auto',
			category: 'general'
		},
		fov: {
			label: 'Vertical field of view',
			selectRange: [5, 120, 1],
			selectRangeDefault: 40,
			category: 'general'
		},
		labels: {
			label: 'Text labels',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'general'
		},
		terrainHeight: {
			label: 'Use terrain elevation data',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'general'
		},
		/*airTraffic: {
			label: 'Real-time air traffic',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'general'
		},*/
		shadows: {
			label: 'Shadows',
			status: ['off', 'low', 'medium', 'high'],
			statusLabels: ['Disabled', 'Low', 'Medium', 'High'],
			statusDefault: _lowMemory ? 'off' : 'medium',
			category: 'graphics'
		},
		taa: {
			label: 'TAA',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: 'on',
			category: 'graphics'
		},
		dof: {
			label: 'Depth of field',
			status: ['off', 'low', 'high'],
			statusLabels: ['Disabled', 'Low quality', 'High quality'],
			statusDefault: 'off',
			category: 'graphics'
		},
		dofAperture: {
			label: 'Aperture',
			parent: 'dof',
			parentStatusCondition: ['low', 'high'],
			selectRange: [0.001, 1, 0.001],
			selectRangeDefault: 0.01,
			selectRangeScale: SettingsSchemaRangeScale.Logarithmic,
			category: 'graphics'
		},
		dofMode: {
			label: 'Focusing mode',
			parent: 'dof',
			parentStatusCondition: ['low', 'high'],
			status: ['center', 'cursor'],
			statusLabels: ['Screen center', 'Cursor position'],
			statusDefault: 'center',
			category: 'graphics'
		},
		bloom: {
			label: 'Bloom',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: _lowMemory ? 'off' : 'on',
			category: 'graphics'
		},
		ssr: {
			label: 'Screen-space reflections',
			status: ['off', 'low', 'high'],
			statusLabels: ['Disabled', 'Low quality', 'High quality'],
			statusDefault: 'off',
			category: 'graphics'
		},
		ssao: {
			label: 'Screen-space ambient occlusion',
			status: ['off', 'on'],
			statusLabels: ['Disabled', 'Enabled'],
			statusDefault: _lowMemory ? 'off' : 'on',
			category: 'graphics'
		},
		renderScale: {
			label: 'Render resolution scale',
			selectRange: [0.25, 1.0, 0.05],
			selectRangeDefault: 1.0,
			category: 'graphics'
		},
		fpsLimit: {
			label: 'Frame rate limit',
			status: ['off', '30', '60'],
			statusLabels: ['Unlimited', '30 FPS', '60 FPS'],
			// Uncapped rendering pegs the GPU process at ~100% CPU for no visible
			// benefit (measured 133 fps on desktop). Users can still choose Unlimited.
			statusDefault: _lowMemory ? '30' : '60',
			category: 'graphics'
		},
		terrainDetail: {
			label: 'Terrain detail',
			status: ['low', 'medium', 'high'],
			statusLabels: ['Low (mobile)', 'Medium', 'High'],
			statusDefault: _lowMemory ? 'low' : 'high',
			category: 'graphics'
		},
		shadowResolution: {
			label: 'Shadow map resolution',
			parent: 'shadows',
			parentStatusCondition: ['low', 'medium', 'high'],
			status: ['512', '1024', '2048'],
			statusLabels: ['512px', '1024px', '2048px'],
			statusDefault: _lowMemory ? '512' : '2048',
			category: 'graphics'
		},
		shadowCascades: {
			label: 'Shadow cascades',
			parent: 'shadows',
			parentStatusCondition: ['medium', 'high'],
			status: ['2', '3'],
			statusLabels: ['2 cascades', '3 cascades'],
			statusDefault: _lowMemory ? '2' : '3',
			category: 'graphics'
		}
	} as SettingsSchema,
	OverpassEndpoints: [
		{url: 'https://overpass.openstreetmap.fr/api/interpreter', isEnabled: true},
		{url: 'https://overpass.private.coffee/api/interpreter', isEnabled: true},
		{url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', isEnabled: true},
		{url: 'https://overpass-api.de/api/interpreter', isEnabled: true},
		{url: 'https://z.overpass-api.de/api/interpreter', isEnabled: false},
		{url: 'https://lz4.overpass-api.de/api/interpreter', isEnabled: false},
	],
	TileServerEndpoint: 'https://tiles.streets.gl',
	SlippyEndpointTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
	TilesEndpointTemplate: 'https://tiles.streets.gl/vector/{z}/{x}/{y}'
};

export default Config;
