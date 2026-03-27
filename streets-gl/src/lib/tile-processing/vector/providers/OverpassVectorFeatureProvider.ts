import MathUtils from "~/lib/math/MathUtils";
import OverpassDataObject, {NodeElement, RelationElement, RelationMember, WayElement} from "./OverpassDataObject";
import VectorFeatureProvider from "~/lib/tile-processing/vector/providers/VectorFeatureProvider";
import VectorFeatureCollection from "~/lib/tile-processing/vector/features/VectorFeatureCollection";
import Vec2 from "~/lib/math/Vec2";
import OSMNodeHandler from "~/lib/tile-processing/vector/handlers/OSMNodeHandler";
import OSMWayHandler from "~/lib/tile-processing/vector/handlers/OSMWayHandler";
import OSMRelationHandler from "~/lib/tile-processing/vector/handlers/OSMRelationHandler";
import VectorBuildingOutlinesCleaner from "~/lib/tile-processing/vector/VectorBuildingOutlinesCleaner";
import {VectorFeature} from "~/lib/tile-processing/vector/features/VectorFeature";
import OSMHandler from "~/lib/tile-processing/vector/handlers/OSMHandler";
import {getCollectionFromVectorFeatures} from "~/lib/tile-processing/vector/utils";

const TileRequestMargin = 0.05;

export type OverpassQueryMode = 'full' | 'buildings';

function getBbox(x: number, y: number, zoom: number): string {
	const position = [
		MathUtils.tile2degrees(x - TileRequestMargin, y + 1 + TileRequestMargin, zoom),
		MathUtils.tile2degrees(x + 1 + TileRequestMargin, y - TileRequestMargin, zoom)
	];
	return position[0].lat + ',' + position[0].lon + ',' + position[1].lat + ',' + position[1].lon;
}

const getBuildingsRequestBody = (x: number, y: number, zoom: number): string => {
	const bbox = getBbox(x, y, zoom);
	return `
		[out:json][timeout:12];
		(
			way["building"](${bbox});
			relation["building"](${bbox});
		);
		out body qt;
		>>;
		out skel qt;
	`;
};

const getFullRequestBody = (x: number, y: number, zoom: number): string => {
	const bbox = getBbox(x, y, zoom);
	return `
		[out:json][timeout:30];
		(
			node(${bbox});
			way(${bbox});
			rel["type"~"^(multipolygon|building)"](${bbox});
			(
				relation["building"](${bbox});
				>;
				way["building"](${bbox});
			) ->.buildingOutlines;
			way["building:part"](area.buildingOutlines);
		);
		out body qt;
		>>;
		out body qt;
	`;
};

interface ServerHealth {
	consecutiveFailures: number;
	cooldownUntil: number;
	lastRequestTime: number;
	activeRequests: number;
	totalRequests: number;
	totalSuccesses: number;
	avgResponseMs: number;
}

const MIN_REQUEST_INTERVAL_MS = 1000;
const BASE_COOLDOWN_MS = 5000;
const MAX_COOLDOWN_MS = 300000;
const DEAD_SERVER_COOLDOWN_MS = 600000;
const DEAD_SERVER_THRESHOLD = 3;
const MAX_RETRIES_PER_REQUEST = 3;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONCURRENT_PER_SERVER = 2;

const serverHealthMap: Map<string, ServerHealth> = new Map();
let roundRobinCounter = 0;

function getServerHealth(url: string): ServerHealth {
	let health = serverHealthMap.get(url);
	if (!health) {
		health = {
			consecutiveFailures: 0,
			cooldownUntil: 0,
			lastRequestTime: 0,
			activeRequests: 0,
			totalRequests: 0,
			totalSuccesses: 0,
			avgResponseMs: 0,
		};
		serverHealthMap.set(url, health);
	}
	return health;
}

function markServerSuccess(url: string, responseMs: number): void {
	const health = getServerHealth(url);
	health.consecutiveFailures = 0;
	health.cooldownUntil = 0;
	health.activeRequests = Math.max(0, health.activeRequests - 1);
	health.totalSuccesses++;
	health.avgResponseMs = health.avgResponseMs === 0
		? responseMs
		: health.avgResponseMs * 0.7 + responseMs * 0.3;
}

function markServerFailure(url: string, error?: string): void {
	const health = getServerHealth(url);
	health.consecutiveFailures++;
	health.activeRequests = Math.max(0, health.activeRequests - 1);

	const isDead = health.consecutiveFailures >= DEAD_SERVER_THRESHOLD;
	const backoff = isDead
		? DEAD_SERVER_COOLDOWN_MS
		: Math.min(BASE_COOLDOWN_MS * Math.pow(2, health.consecutiveFailures - 1), MAX_COOLDOWN_MS);

	health.cooldownUntil = Date.now() + backoff;
	const hostname = new URL(url).hostname;
	console.warn(
		`[Overpass] ${hostname} failed (${health.consecutiveFailures}x): ${error || 'unknown'}` +
		(isDead ? ` — server disabled for ${Math.round(backoff / 60000)}min` : ` — cooldown ${Math.round(backoff / 1000)}s`)
	);
}

function markRequestStart(url: string): void {
	const health = getServerHealth(url);
	health.activeRequests++;
	health.totalRequests++;
	health.lastRequestTime = Date.now();
}

function isServerAvailable(url: string): boolean {
	const health = getServerHealth(url);
	if (Date.now() < health.cooldownUntil) {
		return false;
	}
	if (health.activeRequests >= MAX_CONCURRENT_PER_SERVER) {
		return false;
	}
	return true;
}

function getRateLimitDelay(url: string): number {
	const health = getServerHealth(url);
	const elapsed = Date.now() - health.lastRequestTime;
	return Math.max(0, MIN_REQUEST_INTERVAL_MS - elapsed);
}

function scoreServer(url: string): number {
	const health = getServerHealth(url);
	let score = 0;

	score += health.consecutiveFailures * 1000;
	score += health.activeRequests * 500;

	if (health.avgResponseMs > 0) {
		score += health.avgResponseMs * 0.1;
	}

	return score;
}

function sortEndpointsByHealth(urls: string[]): string[] {
	return [...urls].sort((a, b) => scoreServer(a) - scoreServer(b));
}

function pickServerRoundRobin(urls: string[]): string[] {
	if (urls.length <= 1) return urls;

	const offset = roundRobinCounter++ % urls.length;
	return [...urls.slice(offset), ...urls.slice(0, offset)];
}

export default class OverpassVectorFeatureProvider extends VectorFeatureProvider {
	private readonly overpassURLs: string[];
	private queryMode: OverpassQueryMode = 'buildings';

	public constructor(overpassEndpoints: string | string[]) {
		super();
		this.overpassURLs = Array.isArray(overpassEndpoints) ? overpassEndpoints : [overpassEndpoints];
	}

	public setQueryMode(mode: OverpassQueryMode): void {
		this.queryMode = mode;
	}

	public async getCollection(
		{
			x,
			y,
			zoom
		}: {
			x: number;
			y: number;
			zoom: number;
		}
	): Promise<VectorFeatureCollection> {
		const tileOrigin = MathUtils.tile2meters(x, y + 1, zoom);
		const overpassData = await this.fetchWithFailover(x, y, zoom);

		const nodeHandlersMap: Map<number, OSMNodeHandler> = new Map();
		const wayHandlersMap: Map<number, OSMWayHandler> = new Map();
		const relationHandlersMap: Map<number, OSMRelationHandler> = new Map();

		const elements = OverpassVectorFeatureProvider.classifyElements(overpassData.elements);

		for (const element of elements.nodes) {
			const position = Vec2.sub(MathUtils.degrees2meters(element.lat, element.lon), tileOrigin);
			const handler = new OSMNodeHandler(
				element,
				position.x,
				position.y
			);

			nodeHandlersMap.set(element.id, handler);
		}

		for (const element of elements.ways) {
			const nodes = element.nodes.map(nodeId => {
				return nodeHandlersMap.get(nodeId);
			});

			const handler = new OSMWayHandler(
				element,
				nodes
			);

			wayHandlersMap.set(element.id, handler);
		}

		const osmMembersMap: Map<OSMRelationHandler, RelationMember[]> = new Map();

		for (const element of elements.relations) {
			const members = element.members.filter(member => member.type === 'way' || member.type === 'relation');

			if (members.length === 0) {
				continue;
			}

			const handler = new OSMRelationHandler(
				element
			);

			relationHandlersMap.set(element.id, handler);
			osmMembersMap.set(handler, members);
		}

		for (const relation of relationHandlersMap.values()) {
			const members = osmMembersMap.get(relation);

			for (const member of members) {
				const memberId = member.ref;
				let handler: OSMWayHandler | OSMRelationHandler;

				switch (member.type) {
					case 'way':
						handler = wayHandlersMap.get(memberId);
						break;
					case 'relation':
						handler = relationHandlersMap.get(memberId);
						break;
				}

				if (!handler) {
					console.error(`[Overpass] Missing handler for member ${memberId}`);
					continue;
				}

				relation.addMember(member, handler);
			}
		}

		const features = OverpassVectorFeatureProvider.getFeaturesFromHandlers([
			...nodeHandlersMap.values(),
			...wayHandlersMap.values(),
			...relationHandlersMap.values()
		]);
		const collection = getCollectionFromVectorFeatures(features);

		collection.areas = new VectorBuildingOutlinesCleaner().deleteBuildingOutlines(collection.areas);

		return collection;
	}

	private async fetchWithFailover(
		x: number, y: number, zoom: number
	): Promise<OverpassDataObject> {
		const body = this.queryMode === 'buildings'
			? getBuildingsRequestBody(x, y, zoom)
			: getFullRequestBody(x, y, zoom);
		const errors: string[] = [];

		for (let attempt = 0; attempt < MAX_RETRIES_PER_REQUEST; attempt++) {
			const healthSorted = sortEndpointsByHealth(this.overpassURLs);
			const ordered = attempt === 0
				? pickServerRoundRobin(healthSorted)
				: healthSorted;

			for (const url of ordered) {
				if (!isServerAvailable(url)) {
					continue;
				}

				const delay = getRateLimitDelay(url);
				if (delay > 0) {
					await new Promise(r => setTimeout(r, delay));
				}

				try {
					markRequestStart(url);
					const startTime = Date.now();
					const result = await OverpassVectorFeatureProvider.fetchOverpassTile(url, body);
					const elapsed = Date.now() - startTime;
					markServerSuccess(url, elapsed);
					const hostname = new URL(url).hostname;
					console.log(
						`[Overpass] ${hostname} responded in ${elapsed}ms ` +
						`(${result.elements?.length ?? 0} elements, mode=${this.queryMode})`
					);
					return result;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					errors.push(`${new URL(url).hostname}: ${msg}`);
					markServerFailure(url, msg);
				}
			}

			if (attempt < MAX_RETRIES_PER_REQUEST - 1) {
				const retryDelay = 2000 * (attempt + 1);
				console.warn(
					`[Overpass] All servers failed on attempt ${attempt + 1}/${MAX_RETRIES_PER_REQUEST}, ` +
					`retrying in ${Math.round(retryDelay / 1000)}s`
				);
				await new Promise(r => setTimeout(r, retryDelay));
			}
		}

		throw new Error(
			`[Overpass] All servers failed after ${MAX_RETRIES_PER_REQUEST} attempts. ` +
			`Errors: ${errors.join(' | ')}`
		);
	}

	private static getFeaturesFromHandlers(handlers: OSMHandler[]): VectorFeature[] {
		const features: VectorFeature[] = [];

		for (const handler of handlers) {
			features.push(...handler.getFeatures());
		}

		return features;
	}

	private static async fetchOverpassTile(
		overpassURL: string,
		body: string
	): Promise<OverpassDataObject> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			const response = await fetch(overpassURL, {
				method: 'POST',
				body,
				signal: controller.signal,
			});

			if (response.status === 429) {
				throw new Error(`Rate limited (429)`);
			}
			if (response.status === 504) {
				throw new Error(`Server too busy (504)`);
			}
			if (response.status === 403) {
				throw new Error(`Forbidden (403)`);
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			return await response.json() as OverpassDataObject;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	}

	private static classifyElements(elements: (NodeElement | WayElement | RelationElement)[]): {
		nodes: NodeElement[];
		ways: WayElement[];
		relations: RelationElement[];
	} {
		const nodes: NodeElement[] = [];
		const ways: WayElement[] = [];
		const relations: RelationElement[] = [];

		for (const el of elements) {
			switch (el.type) {
				case 'node':
					nodes.push(el);
					break;
				case 'way':
					ways.push(el);
					break;
				case 'relation':
					relations.push(el);
					break;
			}
		}

		return {nodes, ways, relations};
	}
}
