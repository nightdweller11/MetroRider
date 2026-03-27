import System from "../System";
import MapWorkerSystem from "./MapWorkerSystem";
import Tile3DBuffers from "~/lib/tile-processing/tile3d/buffers/Tile3DBuffers";
import Config from "~/app/Config";
import MapWorker from "~/app/world/worker/MapWorker";
import TileSystem from "~/app/systems/TileSystem";
import Vec2 from "~/lib/math/Vec2";

export interface OverpassEndpoint {
	url: string;
	isEnabled: boolean;
	isUserDefined: boolean;
}

const OVERPASS_MIN_INTERVAL_MS = 2000;
const OVERPASS_MAX_IN_FLIGHT = 2;

export default class TileLoadingSystem extends System {
	private readonly overpassEndpointsDefault: OverpassEndpoint[] = [];
	public overpassEndpoints: OverpassEndpoint[] = [];
	public useOverpassForBuildings: boolean = localStorage.getItem('useOverpassForBuildings') === 'true';

	private overpassLastDispatchTime: number = 0;
	private overpassInFlight: number = 0;
	private overpassTotalDispatched: number = 0;
	private overpassTotalCompleted: number = 0;
	private overpassTotalFailed: number = 0;
	private lastLoggedOverpassState: boolean | null = null;

	public constructor() {
		super();

		for (const {url, isEnabled} of Config.OverpassEndpoints) {
			const endpoint: OverpassEndpoint = {
				url: url,
				isEnabled: isEnabled,
				isUserDefined: false
			};

			this.overpassEndpointsDefault.push(endpoint);
		}

		try {
			const lsEndpoints = JSON.parse(localStorage.getItem('overpassEndpoints'));

			if (Array.isArray(lsEndpoints)) {
				for (const endpoint of lsEndpoints) {
					this.overpassEndpoints.push({
						url: String(endpoint.url),
						isEnabled: Boolean(endpoint.isEnabled),
						isUserDefined: Boolean(endpoint.isUserDefined),
					});
				}
			}
		} catch (e) {
			console.error(e);
		}

		for (const endpoint of this.overpassEndpointsDefault) {
			if (!this.overpassEndpoints.some(e => e.url === endpoint.url)) {
				this.overpassEndpoints.push(endpoint);
			}
		}
	}

	public postInit(): void {

	}

	public async fetchTilesTimestamp(): Promise<Date> {
		const url = `${Config.TileServerEndpoint}/vector.timestamp`;
		let timestamp: Date = null;

		try {
			const response = await fetch(url);

			if (response.status === 200) {
				const text = await response.text();
				timestamp = new Date(text.replace(/\n/g, ''));
			} else {
				console.error(`Failed to fetch vector tiles timestamp. Status: ${response.status}`);
			}
		} catch (e) {
			console.error(e);
		}

		return timestamp;
	}

	public setOverpassEndpoints(endpoints: OverpassEndpoint[]): void {
		this.overpassEndpoints = endpoints;
		localStorage.setItem('overpassEndpoints', JSON.stringify(endpoints));
	}

	public resetOverpassEndpoints(): void {
		this.overpassEndpoints = this.overpassEndpointsDefault;
	}

	private getEnabledOverpassEndpoints(): string[] {
		return this.overpassEndpoints
			.filter(endpoint => endpoint.isEnabled)
			.map(endpoint => endpoint.url);
	}

	private canDispatchOverpassTile(): boolean {
		if (!this.useOverpassForBuildings) {
			return true;
		}

		if (this.overpassInFlight >= OVERPASS_MAX_IN_FLIGHT) {
			return false;
		}

		const elapsed = Date.now() - this.overpassLastDispatchTime;
		return elapsed >= OVERPASS_MIN_INTERVAL_MS;
	}

	public update(deltaTime: number): void {
		if (this.lastLoggedOverpassState !== this.useOverpassForBuildings) {
			this.lastLoggedOverpassState = this.useOverpassForBuildings;
			const endpoints = this.getEnabledOverpassEndpoints();
			console.log(
				`[TileLoading] Overpass: ${this.useOverpassForBuildings ? 'ENABLED' : 'DISABLED'}, ` +
				`${endpoints.length} server(s): ${endpoints.map(u => new URL(u).hostname).join(', ') || 'none'}`
			);
		}

		const mapWorkerSystem = this.systemManager.getSystem(MapWorkerSystem);
		const tileSystem = this.systemManager.getSystem(TileSystem);
		const overpassEndpoints = this.getEnabledOverpassEndpoints();

		const queuedTile = tileSystem.getNextTileToLoad();
		const worker = mapWorkerSystem.getFreeWorker();

		if (queuedTile && worker && this.canDispatchOverpassTile()) {
			if (this.useOverpassForBuildings) {
				this.overpassLastDispatchTime = Date.now();
				this.overpassInFlight++;
				this.overpassTotalDispatched++;
			}

			this.loadTile({
				tile: queuedTile.position,
				onBeforeLoad: queuedTile.onBeforeLoad,
				onLoad: queuedTile.onLoad,
				worker: worker,
				overpassEndpoints: overpassEndpoints,
				isTerrainHeightEnabled: tileSystem.enableTerrainHeight,
				useOverpassForBuildings: this.useOverpassForBuildings,
			});
		}
	}

	private async loadTile(
		{
			tile,
			onBeforeLoad,
			onLoad,
			worker,
			overpassEndpoints,
			isTerrainHeightEnabled,
			useOverpassForBuildings,
		}: {
			tile: Vec2;
			onBeforeLoad: () => Promise<any>;
			onLoad: (buffers: Tile3DBuffers) => void;
			worker: MapWorker;
			overpassEndpoints: string[];
			isTerrainHeightEnabled: boolean;
			useOverpassForBuildings: boolean;
		}
	): Promise<void> {
		await onBeforeLoad();

		const tileKey = `${tile.x},${tile.y}`;
		const startMs = Date.now();

		worker.requestTile(tile.x, tile.y, {
			overpassEndpoints: overpassEndpoints,
			tileServerEndpoint: Config.TileServerEndpoint,
			vectorTilesEndpointTemplate: Config.TilesEndpointTemplate,
			isTerrainHeightEnabled: isTerrainHeightEnabled,
			useOverpassForBuildings: useOverpassForBuildings,
		}).then(result => {
			if (useOverpassForBuildings) {
				this.overpassInFlight = Math.max(0, this.overpassInFlight - 1);
				this.overpassTotalCompleted++;
				console.log(
					`[TileLoading] Tile ${tileKey} done (${Date.now() - startMs}ms) ` +
					`[inflight=${this.overpassInFlight} done=${this.overpassTotalCompleted} failed=${this.overpassTotalFailed}]`
				);
			}
			onLoad(result);
		}, error => {
			if (useOverpassForBuildings) {
				this.overpassInFlight = Math.max(0, this.overpassInFlight - 1);
				this.overpassTotalFailed++;
				console.warn(
					`[TileLoading] Tile ${tileKey} failed (${Date.now() - startMs}ms): ${error} ` +
					`[inflight=${this.overpassInFlight} done=${this.overpassTotalCompleted} failed=${this.overpassTotalFailed}]`
				);
			}
			onLoad(null);
		});
	}
}
