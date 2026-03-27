import {OverpassEndpoint} from "~/app/systems/TileLoadingSystem";
import {SettingsObjectEntry} from "~/app/settings/SettingsObject";

export default interface UIActions {
	updateRenderGraph: () => void;
	goToLatLon: (lat: number, lon: number) => void;
	goToState: (lat: number, lon: number, pitch: number, yaw: number, distance: number) => void;
	lookAtNorth: () => void;
	setTime: (time: number) => void;
	updateSetting: (key: string, value: SettingsObjectEntry) => void;
	resetSettings: () => void;
	setOverpassEndpoints: (endpoints: OverpassEndpoint[]) => void;
	resetOverpassEndpoints: () => void;
	setUseOverpassForBuildings: (enabled: boolean) => void;
	getControlsStateHash: () => string;
}