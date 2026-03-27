import MapboxVectorFeatureProvider from "~/lib/tile-processing/vector/providers/MapboxVectorFeatureProvider";
import VectorFeatureProvider from "~/lib/tile-processing/vector/providers/VectorFeatureProvider";
import VectorFeatureCollection from "~/lib/tile-processing/vector/features/VectorFeatureCollection";
import OverpassVectorFeatureProvider from "~/lib/tile-processing/vector/providers/OverpassVectorFeatureProvider";
import {Tile3DProviderParams} from "~/lib/tile-processing/tile3d/providers/Tile3DFromVectorProvider";
import MathUtils from "~/lib/math/MathUtils";
import VectorArea from "~/lib/tile-processing/vector/features/VectorArea";
import PBFVectorFeatureProvider from "~/lib/tile-processing/vector/providers/PBFVectorFeatureProvider";

export default class CombinedVectorFeatureProvider extends VectorFeatureProvider {
	private readonly overpassProvider: OverpassVectorFeatureProvider;
	private readonly mapboxProvider: MapboxVectorFeatureProvider;
	private readonly pbfProvider: PBFVectorFeatureProvider;
	private useOverpassForBuildings: boolean = false;

	public constructor(params: Tile3DProviderParams) {
		super();

		this.overpassProvider = new OverpassVectorFeatureProvider(params.overpassEndpoints);
		this.mapboxProvider = new MapboxVectorFeatureProvider(params.vectorTilesEndpointTemplate);
		this.pbfProvider = new PBFVectorFeatureProvider();
	}

	public setUseOverpassForBuildings(enabled: boolean): void {
		this.useOverpassForBuildings = enabled;
		this.overpassProvider.setQueryMode(enabled ? 'buildings' : 'full');
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
		const tileKey = `${x},${y}`;

		if (!this.useOverpassForBuildings) {
			return this.pbfProvider.getCollection({x, y, zoom});
		}

		const startMs = Date.now();
		const [pbfResult, overpassResult] = await Promise.allSettled([
			this.pbfProvider.getCollection({x, y, zoom}),
			this.overpassProvider.getCollection({x, y, zoom}),
		]);
		const fetchMs = Date.now() - startMs;

		if (pbfResult.status === 'rejected') {
			throw new Error(`PBF fetch failed: ${pbfResult.reason}`);
		}

		const pbfData = pbfResult.value;

		if (overpassResult.status === 'rejected') {
			console.error(
				`[Combined ${tileKey}] Overpass FAILED (${fetchMs}ms), PBF-only fallback: ` +
				`${pbfData.areas.length} areas, ${pbfData.nodes.length} nodes`
			);
			return pbfData;
		}

		const overpassData = overpassResult.value;

		const pbfBuildingCount = pbfData.areas.filter(
			a => a.descriptor.type === 'building' || a.descriptor.type === 'buildingPart'
		).length;
		const pbfNonBuildings: VectorArea[] = pbfData.areas.filter(
			a => a.descriptor.type !== 'building' && a.descriptor.type !== 'buildingPart'
		);
		const overpassBuildings: VectorArea[] = overpassData.areas.filter(
			a => a.descriptor.type === 'building' || a.descriptor.type === 'buildingPart'
		);

		const materials = new Set(overpassBuildings.map(b => b.descriptor.buildingFacadeMaterial));

		console.log(
			`[Combined ${tileKey}] Merged in ${fetchMs}ms: ` +
			`Overpass=${overpassBuildings.length} buildings (materials: ${[...materials].join(',')}) | ` +
			`PBF=${pbfBuildingCount} buildings replaced, ${pbfNonBuildings.length} other areas kept | ` +
			`Overpass nodes=${overpassData.nodes.length}, trees=${overpassData.nodes.filter(n => n.descriptor?.type === 'tree').length}`
		);

		return {
			nodes: this.mergeCollections(pbfData, overpassData).nodes,
			polylines: pbfData.polylines,
			areas: [...pbfNonBuildings, ...overpassBuildings]
		};
	}

	private mergeCollections(...collections: VectorFeatureCollection[]): VectorFeatureCollection {
		return {
			nodes: ([] as VectorFeatureCollection['nodes']).concat(...collections.map(c => c.nodes)),
			polylines: ([] as VectorFeatureCollection['polylines']).concat(...collections.map(c => c.polylines)),
			areas: ([] as VectorFeatureCollection['areas']).concat(...collections.map(c => c.areas))
		};
	}

	private clearFeaturesNotInTile(features: VectorFeatureCollection, x: number, y: number, zoom: number): void {
		const tileSize = MathUtils.tile2meters(0, 0, 16).x - MathUtils.tile2meters(1, 1, 16).x;

		for (let i = 0; i < features.areas.length; i++) {
			const area = features.areas[i];

			if (area.descriptor.type === 'building' && !this.isAreaInTile(area, tileSize)) {
				features.areas.splice(i, 1);
				i--;
			}
		}
	}

	private isAreaInTile(area: VectorArea, tileSize: number): boolean {
		for (const ring of area.rings) {
			for (const node of ring.nodes) {
				if (node.x >= 0 && node.x <= tileSize && node.y >= 0 && node.y <= tileSize) {
					return true;
				}
			}
		}

		return false;
	}
}
