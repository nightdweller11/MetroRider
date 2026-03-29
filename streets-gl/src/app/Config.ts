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
	Config.TileFrustumFar = low ? 2000 : 8000;
	Config.AggressiveEviction = low;
}

const Config = {
	LowMemoryMode: _lowMemory,
	applyPerformanceMode,
	TileSize: /*40075016.68 / (1 << 16)*/ 611.4962158203125,
	MaxConcurrentTiles: _lowMemory ? 40 : 150,
	TileFrustumFar: _lowMemory ? 2000 : 8000,
	AggressiveEviction: _lowMemory,
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
		performanceMode: {
			label: 'Performance mode',
			status: ['off', 'on'],
			statusLabels: ['Standard', 'Low memory (mobile/tablet)'],
			statusDefault: _lowMemory ? 'on' : 'off',
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
			statusDefault: _lowMemory ? 'off' : 'on',
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
			selectRangeDefault: _lowMemory ? 0.65 : 1.0,
			category: 'graphics'
		},
		fpsLimit: {
			label: 'Frame rate limit',
			status: ['off', '30', '60'],
			statusLabels: ['Unlimited', '30 FPS', '60 FPS'],
			statusDefault: _lowMemory ? '30' : 'off',
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
