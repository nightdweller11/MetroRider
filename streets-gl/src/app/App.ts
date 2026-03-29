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
import TrainRenderingSystem from "~/app/game/rendering/TrainRenderingSystem";
import AudioSystem from "~/app/game/audio/AudioSystem";
import AssetConfigSystem from "~/app/game/assets/AssetConfigSystem";

class App {
	private loop = (deltaTime: number): void => this.update(deltaTime);
	private time = 0;
	private systemManager: SystemManager;
	private _fpsLimitInterval: number = 0;
	private _lastRenderedTime: number = 0;

	public constructor() {
		this.init();
	}

	private init(): void {
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
				AudioSystem,
				GameCameraSystem,
				RenderSystem,
				TileLoadingSystem,
				GameUISystem,
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

	private update(rafTime = 0): void {
		requestAnimationFrame(this.loop);

		if (this._fpsLimitInterval > 0 && (rafTime - this._lastRenderedTime) < this._fpsLimitInterval) {
			return;
		}
		this._lastRenderedTime = rafTime;

		const frameStart = performance.now();
		const deltaTime = (rafTime - this.time) / 1e3;
		this.time = rafTime;

		this.systemManager.updateSystems(deltaTime);

		const frameTime = performance.now() - frameStart;
		this.systemManager.getSystem(UISystem).updateFrameTime(frameTime);
	}
}

export default new App;
