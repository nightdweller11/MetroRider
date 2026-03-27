import {VectorAreaDescriptor} from "~/lib/tile-processing/vector/qualifiers/descriptors";
import {parseColor} from "~/lib/tile-processing/vector/qualifiers/factories/osm/helpers/tagHelpers";

type FacadeConfig = {
	type: VectorAreaDescriptor['buildingFacadeMaterial'];
	defaultColor: number;
};

const materialLookup: Record<string, FacadeConfig> = {
	brick: {type: 'brick', defaultColor: 0x8c4834},
	cement_block: {type: 'cementBlock', defaultColor: 0xffffff},
	block: {type: 'cementBlock', defaultColor: 0xffffff},
	wood: {type: 'wood', defaultColor: 0xffffff},
	plaster: {type: 'plaster', defaultColor: 0xffffff},
	plastered: {type: 'plaster', defaultColor: 0xffffff},
	concrete: {type: 'plaster', defaultColor: 0xdddddd},
	hard: {type: 'plaster', defaultColor: 0xdddddd},
	glass: {type: 'glass', defaultColor: 0xffffff},
	mirror: {type: 'glass', defaultColor: 0xffffff},
	stone: {type: 'stone', defaultColor: 0xc8c0b0},
	sandstone: {type: 'stone', defaultColor: 0xd4c4a0},
	limestone: {type: 'stone', defaultColor: 0xe0d8c8},
	marble: {type: 'stone', defaultColor: 0xf0ece8},
	granite: {type: 'stone', defaultColor: 0xa0a0a0},
	stucco: {type: 'stucco', defaultColor: 0xf0ebe0},
	metal: {type: 'metalPanel', defaultColor: 0xc0c0c8},
	steel: {type: 'metalPanel', defaultColor: 0xc0c0c8},
	aluminium: {type: 'metalPanel', defaultColor: 0xd0d0d8},
	painted: {type: 'paintedConcrete', defaultColor: 0xe0e0e0},
};

const buildingTypeLookup: Record<string, FacadeConfig> = {
	commercial: {type: 'glass', defaultColor: 0xdde8f0},
	office: {type: 'glass', defaultColor: 0xdde8f0},
	retail: {type: 'glass', defaultColor: 0xe8e8e8},
	industrial: {type: 'cementBlock', defaultColor: 0xd0d0d0},
	warehouse: {type: 'cementBlock', defaultColor: 0xcccccc},
	garage: {type: 'cementBlock', defaultColor: 0xd0d0d0},
	garages: {type: 'cementBlock', defaultColor: 0xd0d0d0},
	school: {type: 'brick', defaultColor: 0x9c5840},
	university: {type: 'brick', defaultColor: 0x9c5840},
	hospital: {type: 'plaster', defaultColor: 0xf0f0f0},
	supermarket: {type: 'cementBlock', defaultColor: 0xe0e0e0},
	apartments: {type: 'plaster', defaultColor: 0xe8dcc8},
	hotel: {type: 'plaster', defaultColor: 0xe8dcc8},
	civic: {type: 'plaster', defaultColor: 0xe0d8c8},
	public: {type: 'plaster', defaultColor: 0xe0d8c8},
	train_station: {type: 'brick', defaultColor: 0x9c5840},
	church: {type: 'plaster', defaultColor: 0xe8e0d0},
	cathedral: {type: 'plaster', defaultColor: 0xe0d8c8},
	mosque: {type: 'plaster', defaultColor: 0xf0ebe0},
	synagogue: {type: 'plaster', defaultColor: 0xeee8d5},
};

export default function getFacadeParamsFromTags(
	tags: Record<string, string>
): {
	material: VectorAreaDescriptor['buildingFacadeMaterial'];
	color: number;
} {
	const materialTagValue = tags['building:material'];
	const colorTagValue = tags['building:colour'];

	if (materialTagValue && materialLookup[materialTagValue]) {
		const config = materialLookup[materialTagValue];
		return {
			material: config.type,
			color: parseColor(colorTagValue, config.defaultColor)
		};
	}

	const buildingType = tags.building;
	if (buildingType && buildingTypeLookup[buildingType]) {
		const config = buildingTypeLookup[buildingType];
		return {
			material: config.type,
			color: parseColor(colorTagValue, config.defaultColor)
		};
	}

	const fallback = materialLookup.plaster;
	return {
		material: fallback.type,
		color: parseColor(colorTagValue, fallback.defaultColor)
	};
}