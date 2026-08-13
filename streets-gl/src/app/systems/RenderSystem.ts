import {noteMeshRebuild, noteMeshRebuildFrame} from '~/app/debug/RenderTelemetry';
import Vec2 from "~/lib/math/Vec2";
import Config from "~/app/Config";
import System from "../System";
import PickingSystem from "./PickingSystem";
import GBufferPass from "../render/passes/GBufferPass";
import WebGL2Renderer from "~/lib/renderer/webgl2-renderer/WebGL2Renderer";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";
import * as RG from "~/lib/render-graph";
import RenderGraphResourceFactory from "../render/render-graph/RenderGraphResourceFactory";
import PassManager from '../render/PassManager';
import SceneSystem from './SceneSystem';
import TAAPass from '../render/passes/TAAPass';
import ShadowMappingPass from "../render/passes/ShadowMappingPass";
import ShadingPass from "../render/passes/ShadingPass";
import ScreenPass from "../render/passes/ScreenPass";
import SSAOPass from "../render/passes/SSAOPass";
import SelectionPass from "../render/passes/SelectionPass";
import LabelPass from "../render/passes/LabelPass";
import AtmosphereLUTPass from "../render/passes/AtmosphereLUTPass";
import SSRPass from "../render/passes/SSRPass";
import DoFPass from "../render/passes/DoFPass";
import TerrainTexturesPass from "../render/passes/TerrainTexturesPass";
import BloomPass from "../render/passes/BloomPass";
import FullScreenTriangle from "../objects/FullScreenTriangle";
import Node from "../../lib/render-graph/Node";
import SettingsSystem from "~/app/systems/SettingsSystem";
import SlippyMapPass from "~/app/render/passes/SlippyMapPass";
import AbstractTexture2D from "~/lib/renderer/abstract-renderer/AbstractTexture2D";
import ResourceLoader from "~/app/world/ResourceLoader";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import ControlsSystem from "~/app/systems/ControlsSystem";
import CursorStyleSystem from "~/app/systems/CursorStyleSystem";
import TrainSystem from "~/app/game/TrainSystem";
import TileMegaBuffers from "~/lib/renderer/TileMegaBuffers";
import GpuFrameTimer from '~/app/systems/GpuFrameTimer';
import {setTelemetryGpuTimer} from '~/app/debug/RenderTelemetry';

export default class RenderSystem extends System {
	private renderer: AbstractRenderer;
	private frameCount: number = 0;

	private renderGraph: RG.RenderGraph;
	private renderGraphResourceFactory: RenderGraphResourceFactory;
	private passManager: PassManager;
	public fullScreenTriangle: FullScreenTriangle;

	public get tileMegaBuffers(): TileMegaBuffers | null {
		return this.passManager?.tileMegaBuffers ?? null;
	}

	private _cachedResolutionUI: Vec2 = new Vec2(0, 0);
	private _cachedResolutionScene: Vec2 = new Vec2(0, 0);
	private _resolutionDirty: boolean = true;
	private _renderScale: number = 1.0;
	/**
	 * GPU cost of the frame, for the auto-quality governor. Always on: the
	 * governor needs it to know how much headroom it has, which frame rate
	 * cannot tell it under vsync or a frame limiter.
	 */
	public gpuFrameTimer: GpuFrameTimer | null = null;

	public postInit(): void {
		const canvas = <HTMLCanvasElement>document.getElementById('canvas');

		const gl = canvas.getContext('webgl2', {powerPreference: "high-performance"});
		if (!gl) {
			RenderSystem.showFatalOverlay(
				'3D engine could not start',
				'Your browser could not create a WebGL2 context. ' +
				'Try closing other tabs and reloading, or use a different browser.',
			);
			throw new Error('[RenderSystem] WebGL2 context creation failed');
		}

		this.gpuFrameTimer = new GpuFrameTimer(gl);
		// The debug telemetry reads this one rather than opening a second
		// TIME_ELAPSED query, which WebGL does not allow concurrently.
		setTelemetryGpuTimer(this.gpuFrameTimer);

		canvas.addEventListener('webglcontextlost', (e) => {
			e.preventDefault();
			console.error('[RenderSystem] WebGL context lost');
			RenderSystem.showFatalOverlay(
				'Graphics context lost',
				'The device ran out of graphics resources (common on phones). ' +
				'Tap reload to restart. If it keeps happening, lower the render resolution in Settings.',
			);
		});

		this.renderer = new WebGL2Renderer(gl);
		this.renderer.setSize(this.resolutionUI.x, this.resolutionUI.y);

		console.log(`Vendor: ${this.renderer.rendererInfo[0]} \nRenderer: ${this.renderer.rendererInfo[1]}`);

		window.addEventListener('resize', () => this.resize());

		this.initScene();
		this.listenToPerformanceSettings();
	}

	private static showFatalOverlay(title: string, message: string): void {
		if (document.getElementById('fatal-overlay')) return;
		const overlay = document.createElement('div');
		overlay.id = 'fatal-overlay';
		overlay.style.cssText = `
			position: fixed; inset: 0; z-index: 100000;
			background: rgba(0, 0, 0, 0.92); color: #fff;
			display: flex; flex-direction: column; align-items: center; justify-content: center;
			font-family: -apple-system, BlinkMacSystemFont, sans-serif;
			text-align: center; padding: 24px; gap: 12px;
		`;
		const h = document.createElement('div');
		h.style.cssText = 'font-size: 20px; font-weight: 700;';
		h.textContent = title;
		const p = document.createElement('div');
		p.style.cssText = 'font-size: 14px; color: #bbb; max-width: 420px; line-height: 1.5;';
		p.textContent = message;
		const btn = document.createElement('button');
		btn.textContent = 'Reload';
		btn.style.cssText = `
			margin-top: 8px; padding: 12px 32px; border-radius: 8px; border: none;
			background: #3b82f6; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
		`;
		btn.addEventListener('click', () => window.location.reload());
		overlay.appendChild(h);
		overlay.appendChild(p);
		overlay.appendChild(btn);
		document.body.appendChild(overlay);
	}

	private initScene(): void {
		this.fullScreenTriangle = new FullScreenTriangle(this.renderer);

		this.renderGraph = new RG.RenderGraph();
		this.renderGraphResourceFactory = new RenderGraphResourceFactory(this.renderer);
		this.passManager = new PassManager(
			this.systemManager,
			this.renderer,
			this.renderGraphResourceFactory,
			this.renderGraph,
			this.systemManager.getSystem(SettingsSystem).settings
		);

		this.passManager.addPasses(
			new GBufferPass(this.passManager),
			new TAAPass(this.passManager),
			new ShadowMappingPass(this.passManager),
			new ShadingPass(this.passManager),
			new ScreenPass(this.passManager),
			new SSAOPass(this.passManager),
			new SelectionPass(this.passManager),
			new LabelPass(this.passManager),
			new AtmosphereLUTPass(this.passManager),
			new SSRPass(this.passManager),
			new DoFPass(this.passManager),
			new BloomPass(this.passManager),
			new TerrainTexturesPass(this.passManager),
			new SlippyMapPass(this.passManager)
		);

		this.passManager.listenToSettings();
	}

	private listenToPerformanceSettings(): void {
		const settings = this.systemManager.getSystem(SettingsSystem).settings;

		settings.onChange('renderScale', ({numberValue}) => {
			this._renderScale = numberValue ?? 1.0;
			this._resolutionDirty = true;
			this.resize();
		}, true);
	}

	private resize(): void {
		this._resolutionDirty = true;

		const {x: widthUI, y: heightUI} = this.resolutionUI;
		const {x: widthScene, y: heightScene} = this.resolutionUI;

		this.renderer.setSize(widthUI, heightUI);
		this.passManager.resize();

		for (const pass of this.passManager.passes) {
			pass.setSize(widthScene, heightScene);
		}
	}

	public update(deltaTime: number): void {
		const controlsSystem = this.systemManager.getSystem(ControlsSystem);
		const sceneSystem = this.systemManager.getSystem(SceneSystem);
		const settings = this.systemManager.getSystem(SettingsSystem).settings;
		const tiles = sceneSystem.objects.tiles;

		this.passManager.updateRenderGraph(
			controlsSystem.isSlippyMapVisible,
			controlsSystem.isTilesVisible
		);

		if (settings.get('labels').statusValue === 'on') {
			sceneSystem.objects.labels.updateFromTiles(tiles, sceneSystem.objects.camera, this.resolutionScene);
		}

		// An object should build its mesh once. Anything that shows up here every
		// frame is rebuilding continuously; the telemetry names it so the churn
		// can be traced to a class instead of guessed at from a stack trace.
		noteMeshRebuildFrame();
		for (const object of sceneSystem.getObjectsToUpdateMesh()) {
			noteMeshRebuild(object.constructor.name);
			object.updateMesh(this.renderer);
		}

		const jitterFactor = settings.get('taa').statusValue === 'on' ? 1 : 0;

		sceneSystem.objects.camera.updateJitteredProjectionMatrix(
			this.frameCount,
			this.resolutionScene.x,
			this.resolutionScene.y,
			jitterFactor
		);

		this.gpuFrameTimer?.begin();

		this.renderGraph.render();

		this.gpuFrameTimer?.end();

		this.pickObjectId();

		++this.frameCount;

		// Memory upkeep, spread out over time:
		// - mega-buffer compaction/shrink (stops unbounded fragmentation growth)
		// - one-time release of startup images after they have been uploaded to GPU
		if (this.frameCount % 240 === 0) {
			this.passManager.tileMegaBuffers?.maintain();
		}
		if (!this._startupImagesReleased && this.frameCount > 300) {
			this._startupImagesReleased = true;
			ResourceLoader.releaseImages();
		}
	}

	private _startupImagesReleased: boolean = false;

	public getLastRenderGraph(): Set<RG.Node> {
		return this.renderGraph.lastGraph;
	}

	public getLastRenderGraphPassList(): RG.Pass<any>[] {
		return this.renderGraph.lastSortedPassList;
	}

	public getRenderGraphNodeConnectionSets(): {
		indegree: Map<Node, Set<Node>>;
		outdegree: Map<Node, Set<Node>>;
	} {
		return {
			indegree: this.renderGraph.indegreeSets,
			outdegree: this.renderGraph.outdegreeSets
		};
	}

	public createTileTexture(image: HTMLImageElement): AbstractTexture2D {
		return this.renderer.createTexture2D({
			width: image.width,
			height: image.height,
			data: image,
			minFilter: RendererTypes.MinFilter.Linear,
			magFilter: RendererTypes.MagFilter.Linear,
			wrap: RendererTypes.TextureWrap.ClampToEdge,
			format: RendererTypes.TextureFormat.RGBA8Unorm,
			mipmaps: false,
			flipY: false
		});
	}

	// Escape hatch for A/B profiling: ?keepPicking=1 restores the old
	// always-on object-ID readback.
	private static readonly KEEP_PICKING =
		typeof window !== 'undefined' && window.location.search.includes('keepPicking=1');

	private pickObjectId(): void {
		const pickingSystem = this.systemManager.getSystem(PickingSystem);
		const controlsSystem = this.systemManager.getSystem(ControlsSystem);
		const pass = <GBufferPass>this.passManager.getPass('GBufferPass');

		if (!pass || !controlsSystem.isTilesVisible) {
			pickingSystem.clearHoveredObjectId();
			return;
		}

		// While driving, nobody hover-picks buildings — skip the per-frame
		// object-ID GPU readback (a readPixels + fence sync every frame).
		const trainSystem = this.systemManager.getSystem(TrainSystem);
		const driving = !!trainSystem?.gameActive && !RenderSystem.KEEP_PICKING;
		pass.objectIdReadEnabled = !driving;
		if (driving) {
			pickingSystem.clearHoveredObjectId();
			return;
		}

		pass.objectIdX = pickingSystem.pointerPosition.x;
		pass.objectIdY = pickingSystem.pointerPosition.y;

		pickingSystem.readObjectId(pass.objectIdBuffer);
	}

	public get resolutionUI(): Vec2 {
		if (this._resolutionDirty) {
			this._updateResolutionCache();
		}
		return this._cachedResolutionUI;
	}

	public get resolutionScene(): Vec2 {
		if (this._resolutionDirty) {
			this._updateResolutionCache();
		}
		return this._cachedResolutionScene;
	}

	private _updateResolutionCache(): void {
		// Phones report devicePixelRatio 3 — rendering the deferred pipeline at
		// 3x costs ~2.25x the GPU memory/fill of 2x for no visible gain on a
		// small screen, and is a major cause of load failures on phones.
		// iPads report 2, so this cap leaves tablets unchanged.
		const dpr = Config.LowMemoryMode
			? Math.min(window.devicePixelRatio, 2)
			: window.devicePixelRatio;
		const pixelRatio = dpr * this._renderScale;
		this._cachedResolutionUI.x = window.innerWidth * pixelRatio;
		this._cachedResolutionUI.y = window.innerHeight * pixelRatio;
		this._cachedResolutionScene.x = window.innerWidth * this._renderScale;
		this._cachedResolutionScene.y = window.innerHeight * this._renderScale;
		this._resolutionDirty = false;
	}
}
