import {installRenderTelemetry} from '~/app/debug/RenderTelemetry';
import RenderSystem from "./systems/RenderSystem";
import TileSystem from "./systems/TileSystem";
import ControlsSystem from "./systems/ControlsSystem";
import PickingSystem from "./systems/PickingSystem";
import CursorStyleSystem from './systems/CursorStyleSystem';
import SystemManager from "./SystemManager";
import TileObjectsSystem from "./systems/TileObjectsSystem";
import TileLoadingSystem from "./systems/TileLoadingSystem";
import MapWorkerSystem from "./systems/MapWorkerSystem";
import MapTimeSystem from "./systems/MapTimeSystem";
import UISystem from "./systems/UISystem";
import SceneSystem from './systems/SceneSystem';
import ResourceLoader, {ResourceJSON} from './world/ResourceLoader';
import resourcesList from '../resources/resources.json';
import VehicleSystem from "./systems/VehicleSystem";
import TerrainSystem from "./systems/TerrainSystem";
import SettingsSystem from "~/app/systems/SettingsSystem";
import SlippyMapSystem from "~/app/systems/SlippyMapSystem";
import TrainSystem from "~/app/game/TrainSystem";
import GameCameraSystem from "~/app/game/GameCameraSystem";
import GameUISystem from "~/app/game/GameUISystem";
import PassengerSystem from '~/app/game/passengers/PassengerSystem';
import ScoringSystem from '~/app/game/scoring/ScoringSystem';
import SpeedLimitSystem from '~/app/game/limits/SpeedLimitSystem';
import TrackSignRenderingSystem from '~/app/game/limits/TrackSignRenderingSystem';
import PassengerRenderingSystem from '~/app/game/passengers/PassengerRenderingSystem';
import TrainRenderingSystem from "~/app/game/rendering/TrainRenderingSystem";
import AudioSystem from "~/app/game/audio/AudioSystem";
import AmbientTrainSystem from "~/app/game/AmbientTrainSystem";
import SignalRenderingSystem from "~/app/game/limits/SignalRenderingSystem";
import StopMarkRenderingSystem from "~/app/game/scoring/StopMarkRenderingSystem";
import ServiceSystem from "~/app/game/service/ServiceSystem";
import AnnouncementSystem from "~/app/game/audio/AnnouncementSystem";
import AssetConfigSystem from "~/app/game/assets/AssetConfigSystem";
import AutoQualitySystem from "~/app/systems/AutoQualitySystem";

class App {
	private loop = (deltaTime: number): void => this.update(deltaTime);
	private time = 0;
	private systemManager: SystemManager;
	private _fpsLimitInterval: number = 0;

	public constructor() {
		this.init();
	}

	private init(): void {
		// Before anything asks the canvas for a WebGL context — the telemetry
		// patches getContext, so it has to be first or it sees nothing.
		installRenderTelemetry();

		this.systemManager = new SystemManager();

		this.systemManager.addSystems(SettingsSystem);
		this.systemManager.addSystems(UISystem);

		ResourceLoader.addFromJSON(resourcesList as ResourceJSON);
		ResourceLoader.load({
			onFileLoad: (loaded: number, total: number) => {
				this.systemManager.getSystem(UISystem).setResourcesLoadingProgress(loaded / total);
			},
			onLoadedFileNameChange: (name: string) => {
				this.systemManager.getSystem(UISystem).setResourceInProgressPath(name);
			}
		}).then(() => {
			this.systemManager.addSystems(
				ControlsSystem,
				MapTimeSystem,
				TerrainSystem,
				TileSystem,
				SceneSystem,
				CursorStyleSystem,
				PickingSystem,
				TileObjectsSystem,
				SlippyMapSystem,
				VehicleSystem,
				MapWorkerSystem,
				AssetConfigSystem,
				TrainSystem,
				TrainRenderingSystem,
				AmbientTrainSystem,
				SignalRenderingSystem,
				StopMarkRenderingSystem,
				ServiceSystem,
				PassengerSystem,
				PassengerRenderingSystem,
				ScoringSystem,
				SpeedLimitSystem,
				TrackSignRenderingSystem,
				AudioSystem,
				AnnouncementSystem,
				GameCameraSystem,
				RenderSystem,
				TileLoadingSystem,
				GameUISystem,
				AutoQualitySystem,
			);

			this.initFpsLimitListener();
		});

		this.update();
	}

	private initFpsLimitListener(): void {
		const settings = this.systemManager.getSystem(SettingsSystem);
		if (!settings) return;

		settings.settings.onChange('fpsLimit', ({statusValue}) => {
			if (statusValue === '30') {
				this._fpsLimitInterval = 1000 / 30;
			} else if (statusValue === '60') {
				this._fpsLimitInterval = 1000 / 60;
			} else {
				this._fpsLimitInterval = 0;
			}
		}, true);
	}

	private _lastTickTime: number = 0;
	private _frameBudgetAcc: number = 0;

	private update(rafTime = 0): void {
		requestAnimationFrame(this.loop);

		// FPS limiter, accumulator style. Two designs failed here before:
		// `last = rafTime` quantized to vsync boundaries ("30" ran at ~20 fps),
		// and carried timestamps ran AHEAD of real time after any missed vsync
		// tick, locking a 48 fps beat pattern on 120 Hz displays ("60" under 60).
		// The accumulator banks real elapsed time per tick and spends one
		// interval per rendered frame; the remainder carries over (capped at one
		// interval), so the delivered rate averages exactly the target.
		const tickDelta = rafTime - this._lastTickTime;
		this._lastTickTime = rafTime;

		if (this._fpsLimitInterval > 0) {
			this._frameBudgetAcc += tickDelta;
			if (this._frameBudgetAcc < this._fpsLimitInterval - 1) {
				return;
			}
			this._frameBudgetAcc = Math.min(
				this._frameBudgetAcc - this._fpsLimitInterval,
				this._fpsLimitInterval,
			);
		} else {
			this._frameBudgetAcc = 0;
		}

		const frameStart = performance.now();
		const deltaTime = (rafTime - this.time) / 1e3;
		this.time = rafTime;

		this.systemManager.updateSystems(deltaTime);

		const frameTime = performance.now() - frameStart;
		this.systemManager.getSystem(UISystem).updateFrameTime(frameTime);
	}
}

export default new App;
