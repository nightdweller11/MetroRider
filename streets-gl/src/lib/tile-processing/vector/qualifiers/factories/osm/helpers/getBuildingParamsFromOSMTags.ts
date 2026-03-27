import {VectorAreaDescriptor} from "~/lib/tile-processing/vector/qualifiers/descriptors";
import getRoofOrientationFromOSMOrientation
	from "~/lib/tile-processing/vector/qualifiers/factories/osm/helpers/getRoofOrientationFromOSMOrientation";
import {
	parseDirection,
	parseHeight,
	parseRoofLevels,
	readTagAsUnsignedFloat,
	readTagAsUnsignedInt
} from "~/lib/tile-processing/vector/qualifiers/factories/osm/helpers/tagHelpers";
import getDefaultLevelsFromRoofType
	from "~/lib/tile-processing/vector/qualifiers/factories/osm/helpers/getDefaultLevelsFromRoofType";
import getFacadeParamsFromTags from "~/lib/tile-processing/vector/qualifiers/factories/osm/helpers/getFacadeParamsFromTags";
import isBuildingHasWindows from "~/lib/tile-processing/vector/qualifiers/factories/osm/helpers/isBuildingHasWindows";
import getRoofParamsFromTags from "~/lib/tile-processing/vector/qualifiers/factories/osm/helpers/getRoofParamsFromTags";

export default function getBuildingParamsFromOSMTags(
	tags: Record<string, string>,
	onlyRoof: boolean = false
): {
	label: string;
	buildingLevels: number;
	buildingHeight: number;
	buildingMinHeight: number;
	buildingRoofHeight: number;
	buildingRoofType: VectorAreaDescriptor['buildingRoofType'];
	buildingRoofOrientation: VectorAreaDescriptor['buildingRoofOrientation'];
	buildingRoofDirection: number;
	buildingRoofAngle: number;
	buildingFacadeMaterial: VectorAreaDescriptor['buildingFacadeMaterial'];
	buildingFacadeColor: number;
	buildingRoofMaterial: VectorAreaDescriptor['buildingRoofMaterial'];
	buildingRoofColor: number;
	buildingWindows: boolean;
	buildingFoundation: boolean;
} {
	const fallbackLevels = 1;
	const groundLevelHeight = 4.0;
	const upperLevelHeight = 3.2;
	const roofLevelHeight = 3.2;

	function bodyHeightFromLevels(lvl: number): number {
		if (lvl <= 0) return 0;
		if (lvl <= 1) return groundLevelHeight;
		return groundLevelHeight + (lvl - 1) * upperLevelHeight;
	}

	function levelsFromBodyHeight(h: number): number {
		if (h <= groundLevelHeight) return 1;
		return Math.max(1, 1 + Math.round((h - groundLevelHeight) / upperLevelHeight));
	}

	const hasFoundation = !onlyRoof &&
		tags['building:levels'] === undefined &&
		tags['building:min_level'] === undefined &&
		tags.height === undefined &&
		tags.est_height === undefined &&
		tags.min_height === undefined;

	const roofParams = getRoofParamsFromTags(tags);
	const roofOrientation = getRoofOrientationFromOSMOrientation(tags['roof:orientation']);
	const roofLevels = parseRoofLevels(tags, 'roof:levels') ?? getDefaultLevelsFromRoofType(roofParams.type);
	const roofDirection = parseDirection(tags['roof:direction'], null);
	const roofAngle = readTagAsUnsignedFloat(tags, 'roof:angle');
	let roofHeight = parseHeight(tags['roof:height'], roofLevels * roofLevelHeight);

	let minLevel = readTagAsUnsignedInt(tags, 'building:min_level') ?? null;
	let height = parseHeight(tags.height, parseHeight(tags.est_height, null));
	let levels = readTagAsUnsignedInt(tags, 'building:levels') ?? null;
	let minHeight = parseHeight(tags.min_height, null);

	if (height !== null) {
		roofHeight = Math.min(roofHeight, height - (minHeight ?? 0));
	}

	if (height === null && levels === null) {
		levels = (minLevel !== null) ? minLevel: fallbackLevels;
		height = bodyHeightFromLevels(levels) + roofHeight;
	} else if (height === null) {
		height = bodyHeightFromLevels(levels) + roofHeight;
	} else if (levels === null) {
		levels = levelsFromBodyHeight(height - roofHeight);
	}

	if (minLevel === null) {
		if (minHeight !== null) {
			minLevel = Math.min(levels - 1, Math.round(minHeight / upperLevelHeight));
		} else {
			minLevel = 0;
		}
	}

	if (minHeight === null) {
		minHeight = Math.min(minLevel * upperLevelHeight, height);
	}

	const facadeParams = getFacadeParamsFromTags(tags);
	const label = tags.name ?? null;

	let windows = isBuildingHasWindows(tags);
	if (height - minHeight - roofHeight < 2) {
		windows = false;
	}

	return {
		label: label,
		buildingLevels: levels - minLevel,
		buildingHeight: height,
		buildingMinHeight: onlyRoof ? (height - roofHeight) : minHeight,
		buildingRoofHeight: roofHeight,
		buildingRoofType: roofParams.type,
		buildingRoofOrientation: roofOrientation,
		buildingRoofDirection: roofDirection,
		buildingRoofAngle: roofAngle,
		buildingFacadeMaterial: facadeParams.material,
		buildingFacadeColor: facadeParams.color,
		buildingRoofMaterial: roofParams.material,
		buildingRoofColor: roofParams.color,
		buildingWindows: windows,
		buildingFoundation: hasFoundation
	};
}