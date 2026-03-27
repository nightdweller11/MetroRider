import {VectorNodeDescriptor} from "~/lib/tile-processing/vector/qualifiers/descriptors";
import {VectorTile} from "~/lib/tile-processing/vector/providers/pbf/VectorTile";

const treeTypeMap: Record<string, VectorNodeDescriptor['treeType']> = {
	beech: 'beech',
	fagus: 'beech',
	fir: 'fir',
	abies: 'fir',
	linden: 'linden',
	tilia: 'linden',
	linde: 'linden',
	oak: 'oak',
	quercus: 'oak',
	palm: 'palm',
	phoenix: 'palm',
	washingtonia: 'palm',
	cocos: 'palm',
	chamaerops: 'palm',
	trachycarpus: 'palm',
	cypress: 'cypress',
	cupressus: 'cypress',
	thuja: 'cypress',
	juniperus: 'cypress',
};

export default function getTreeType(tags: VectorTile.FeatureTags): VectorNodeDescriptor['treeType'] {
	const genusTagValue = <string>tags.genus;
	const typeFromGenus = treeTypeMap[genusTagValue];

	if (typeFromGenus) {
		return typeFromGenus;
	}

	const leafTypeTagValue = <string>tags.leafType;

	if (leafTypeTagValue === 'needleleaved') {
		return 'genericNeedleleaved';
	}

	return 'genericBroadleaved';
}