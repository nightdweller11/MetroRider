export namespace WorkerMessage {
	export enum ToWorkerType {
		Start,
		Height,
		SetCorridorSegments,
	}

	export interface CorridorSegment {
		x1: number;
		z1: number;
		x2: number;
		z2: number;
		radius: number;
	}

	export interface ToWorker {
		type: ToWorkerType;
		tile: [number, number];
		overpassEndpoints?: string[];
		tileServerEndpoint?: string;
		vectorTilesEndpointTemplate?: string;
		isTerrainHeightEnabled?: boolean;
		useOverpassForBuildings?: boolean;
		height?: Float64Array;
		corridorSegments?: CorridorSegment[];
		debug?: boolean;
	}

	export enum FromWorkerType {
		Success,
		Error,
		RequestHeight
	}

	export interface FromWorker {
		type: FromWorkerType;
		tile: [number, number];
		payload?: any;
	}
}
