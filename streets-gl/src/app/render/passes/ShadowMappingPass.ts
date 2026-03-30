import Pass from "./Pass";
import {InternalResourceType} from "~/lib/render-graph";
import RenderPassResource from "../render-graph/resources/RenderPassResource";
import PassManager from "../PassManager";
import AbstractMaterial from "~/lib/renderer/abstract-renderer/AbstractMaterial";
import {UniformFloat1, UniformMatrix4, UniformTexture2DArray} from "~/lib/renderer/abstract-renderer/Uniform";
import Mat4 from "~/lib/math/Mat4";
import TreeDepthMaterialContainer from "../materials/TreeDepthMaterialContainer";
import AircraftDepthMaterialContainer from "../materials/AircraftDepthMaterialContainer";
import ExtrudedMeshDepthMaterialContainer from "../materials/ExtrudedMeshDepthMaterialContainer";
import ProjectedMeshDepthMaterialContainer from "~/app/render/materials/ProjectedMeshDepthMaterialContainer";
import AbstractTexture2DArray from "~/lib/renderer/abstract-renderer/AbstractTexture2DArray";
import CSMCascadeCamera from "~/app/render/CSMCascadeCamera";
import GenericInstanceDepthMaterialContainer from "~/app/render/materials/GenericInstanceDepthMaterialContainer";
import {
	InstanceStructure,
	Tile3DInstanceLODConfig,
	Tile3DInstanceType
} from "~/lib/tile-processing/tile3d/features/Tile3DInstance";
import {InstanceTextureIdList} from "~/app/render/textures/createInstanceTexture";
import Camera from "~/lib/core/Camera";
import Vec2 from "~/lib/math/Vec2";
import VehicleSystem from "~/app/systems/VehicleSystem";
import {AircraftPartType} from "~/app/vehicles/aircraft/Aircraft";
import TrainDepthMaterialContainer from "~/app/render/materials/TrainDepthMaterialContainer";
import TrainRenderingSystem from "~/app/game/rendering/TrainRenderingSystem";
import TileMegaBuffers from "~/lib/renderer/TileMegaBuffers";
import Tile from "~/app/objects/Tile";
import Config from "~/app/Config";

const SkippedAircraftParts: AircraftPartType[] = [
	AircraftPartType.HelicopterRotorSpinning,
	AircraftPartType.HelicopterRotorStatic,
	AircraftPartType.HelicopterTailRotorSpinning,
	AircraftPartType.HelicopterTailRotorStatic
];

export default class ShadowMappingPass extends Pass<{
	ShadowMaps: {
		type: InternalResourceType.Output;
		resource: RenderPassResource;
	};
	TerrainRingHeight: {
		type: InternalResourceType.Input;
		resource: RenderPassResource;
	};
}> {
	private readonly extrudedMeshMaterial: AbstractMaterial;
	private readonly huggingMeshMaterial: AbstractMaterial;
	private readonly treeMaterial: AbstractMaterial;
	private readonly genericInstanceMaterial: AbstractMaterial;
	private readonly aircraftMaterial: AbstractMaterial;
	private readonly trainDepthMaterial: AbstractMaterial;

	private readonly _tmpMat4A: Float32Array = new Float32Array(16);
	private readonly _tmpMat4B: Float32Array = new Float32Array(16);
	private readonly _tmpVec4A: Float32Array = new Float32Array(4);
	private readonly _tmpFloat1: Float32Array = new Float32Array(1);

	public constructor(manager: PassManager) {
		super('ShadowMappingPass', manager, {
			ShadowMaps: {type: InternalResourceType.Output, resource: manager.getSharedResource('ShadowMaps')},
			TerrainRingHeight: {
				type: InternalResourceType.Input,
				resource: manager.getSharedResource('TerrainRingHeight')
			}
		});

		this.extrudedMeshMaterial = new ExtrudedMeshDepthMaterialContainer(this.renderer).material;
		this.huggingMeshMaterial = new ProjectedMeshDepthMaterialContainer(this.renderer).material;
		this.aircraftMaterial = new AircraftDepthMaterialContainer(this.renderer).material;

		this.genericInstanceMaterial = new GenericInstanceDepthMaterialContainer(this.renderer).material;
		this.genericInstanceMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('instance');

		this.treeMaterial = new TreeDepthMaterialContainer(this.renderer).material;
		this.treeMaterial.getUniform<UniformTexture2DArray>('tMap').value =
			<AbstractTexture2DArray>this.manager.texturePool.get('tree');

		this.trainDepthMaterial = new TrainDepthMaterialContainer(this.renderer).material;

		this.listenToSettings();
	}

	private shadowDrawDistance: number = Config.TileSize * 3;

	private listenToSettings(): void {
		this.manager.settings.onChange('shadows', ({statusValue}) => {
			const csm = this.manager.sceneSystem.objects.csm;

			if (statusValue === 'low') {
				csm.cascades = 1;
				csm.far = 3000;
				csm.biasScale = 1;
			} else if (statusValue === 'medium') {
				this.applyCascadeCount();
				csm.far = 4000;
				csm.biasScale = 1;
			} else {
				this.applyCascadeCount();
				csm.far = 5000;
				csm.biasScale = 0.5;
			}

			this.applyShadowResolution();
			csm.updateCascades();
			this.updateShadowMapDescriptor();
		}, true);

		this.manager.settings.onChange('shadowResolution', () => {
			this.applyShadowResolution();
			const csm = this.manager.sceneSystem.objects.csm;
			csm.updateCascades();
			this.updateShadowMapDescriptor();
		}, true);

		this.manager.settings.onChange('shadowCascades', () => {
			this.applyCascadeCount();
			const csm = this.manager.sceneSystem.objects.csm;
			csm.updateCascades();
			this.updateShadowMapDescriptor();
		}, true);
	}

	private applyCascadeCount(): void {
		const csm = this.manager.sceneSystem.objects.csm;
		const cascadeStr = this.manager.settings.get('shadowCascades')?.statusValue;

		csm.cascades = cascadeStr === '2' ? 2 : 3;
	}

	private applyShadowResolution(): void {
		const csm = this.manager.sceneSystem.objects.csm;
		const resStr = this.manager.settings.get('shadowResolution')?.statusValue;

		if (resStr === '512') {
			csm.resolution = 512;
		} else if (resStr === '1024') {
			csm.resolution = 1024;
		} else {
			csm.resolution = 2048;
		}
	}

	private updateMaterialsDefines(): void {
		const useHeight = this.manager.settings.get('terrainHeight').statusValue === 'on' ? '1' : '0';

		if (this.huggingMeshMaterial.defines.USE_HEIGHT !== useHeight) {
			this.huggingMeshMaterial.defines.USE_HEIGHT = useHeight;
			this.huggingMeshMaterial.recompile();
		}
	}

	private updateShadowMapDescriptor(): void {
		const csm = this.manager.sceneSystem.objects.csm;
		this.getResource('ShadowMaps').descriptor.setSize(csm.resolution, csm.resolution, csm.cascades);
	}

	private renderExtrudedMeshes(shadowCamera: CSMCascadeCamera): void {
		const tiles = this.manager.sceneSystem.objects.tiles;
		const megaBuffers = this.manager.tileMegaBuffers;

		this.renderer.useMaterial(this.extrudedMeshMaterial);

		this._tmpMat4A.set(shadowCamera.projectionMatrix.values);
		this.extrudedMeshMaterial.getUniform('projectionMatrix', 'PerMaterial').value = this._tmpMat4A;
		this.extrudedMeshMaterial.updateUniformBlock('PerMaterial');

		const mainCamera = this.manager.sceneSystem.objects.camera;
		const visibleTiles: Tile[] = [];
		for (const tile of tiles) {
			if (!tile.extrudedMesh || !tile.extrudedMesh.inCameraFrustum(shadowCamera)) {
				continue;
			}
			if (tile.distanceToCamera !== null && tile.distanceToCamera > this.shadowDrawDistance) {
				continue;
			}
			visibleTiles.push(tile);
		}

		if (megaBuffers && this.renderer.supportsBatchDraw && visibleTiles.length > 0) {
			const tilesWithSlots = visibleTiles.filter(t => t.extrudedSlot);

			if (tilesWithSlots.length > 0) {
				megaBuffers.extruded.sharedMesh.bind();

				for (let batchStart = 0; batchStart < tilesWithSlots.length; batchStart += 32) {
					const batchSlice = tilesWithSlots.slice(batchStart, batchStart + 32);

					const matrices = batchSlice.map(tile =>
						new Float32Array(Mat4.multiply(shadowCamera.matrixWorldInverse, tile.matrixWorld).values)
					);

					const {buffer, byteLength} = megaBuffers.packDepthUBO(matrices);
					this.extrudedMeshMaterial.updateUniformBlockRaw('PerMeshArray', buffer, byteLength);

					const batchParams = megaBuffers.buildBatchParams(batchSlice.map(t => t.extrudedSlot));
					this.renderer.batchDrawArrays(batchParams);
				}

				return;
			}
		}

		for (const tile of visibleTiles) {
			this._tmpMat4B.set(Mat4.multiply(shadowCamera.matrixWorldInverse, tile.matrixWorld).values);
			this.extrudedMeshMaterial.getUniform<UniformMatrix4>('modelViewMatrix', 'PerMesh').value = this._tmpMat4B;
			this.extrudedMeshMaterial.updateUniformBlock('PerMesh');

			tile.extrudedMesh.draw();
		}
	}

	private renderHuggingMeshes(shadowCamera: CSMCascadeCamera): void {
		const tiles = this.manager.sceneSystem.objects.tiles;
		const terrain = this.manager.sceneSystem.objects.terrain;

		this.huggingMeshMaterial.getUniform('tRingHeight').value =
			<AbstractTexture2DArray>this.getPhysicalResource('TerrainRingHeight').colorAttachments[0].texture;

		this.renderer.useMaterial(this.huggingMeshMaterial);

		this._tmpMat4A.set(shadowCamera.projectionMatrix.values);
		this.huggingMeshMaterial.getUniform<UniformMatrix4>('projectionMatrix', 'PerMaterial').value = this._tmpMat4A;
		this.huggingMeshMaterial.updateUniformBlock('PerMaterial');

		for (const tile of tiles) {
			if (!tile.huggingMesh || !tile.huggingMesh.inCameraFrustum(shadowCamera)) {
				continue;
			}

			if (tile.distanceToCamera !== null && tile.distanceToCamera > this.shadowDrawDistance) {
				continue;
			}

			const tileParams = terrain.getTileParams(tile);

			if (!tileParams) {
				continue;
			}

			const {ring0, levelId, ring0Offset, ring1Offset} = tileParams;

			this._tmpMat4B.set(Mat4.multiply(shadowCamera.matrixWorldInverse, tile.matrixWorld).values);
			this.huggingMeshMaterial.getUniform('modelViewMatrix', 'PerMesh').value = this._tmpMat4B;
			this.huggingMeshMaterial.getUniform<UniformFloat1>('terrainRingSize', 'PerMesh').value[0] = ring0.size;
			this._tmpVec4A[0] = ring0Offset.x;
			this._tmpVec4A[1] = ring0Offset.y;
			this._tmpVec4A[2] = ring1Offset.x;
			this._tmpVec4A[3] = ring1Offset.y;
			this.huggingMeshMaterial.getUniform('terrainRingOffset', 'PerMesh').value = this._tmpVec4A;
			this.huggingMeshMaterial.getUniform<UniformFloat1>('terrainLevelId', 'PerMesh').value[0] = levelId;
			this.huggingMeshMaterial.getUniform<UniformFloat1>('segmentCount', 'PerMesh').value[0] = ring0.segmentCount * 2;
			this.huggingMeshMaterial.updateUniformBlock('PerMesh');

			tile.huggingMesh.draw();
		}
	}

	private renderInstances(shadowCamera: CSMCascadeCamera): void {
		const tiles = this.manager.sceneSystem.objects.tiles;

		this.manager.sceneSystem.updateInstancedObjectsBuffers(tiles, shadowCamera, this.getInstancesOrigin(shadowCamera), this.manager.sceneSystem.frameId);

		for (const [name, instancedObject] of this.manager.sceneSystem.objects.instancedObjects.entries()) {
			if (instancedObject.instanceCount === 0) {
				continue;
			}

			const config = Tile3DInstanceLODConfig[name as Tile3DInstanceType];
			const materials: Record<InstanceStructure, AbstractMaterial> = {
				[InstanceStructure.Tree]: this.treeMaterial,
				[InstanceStructure.Generic]: this.genericInstanceMaterial,
				[InstanceStructure.Advanced]: null
			};
			const material = materials[config.structure];

			if (!material) {
				continue;
			}

			const mvMatrix = Mat4.multiply(shadowCamera.matrixWorldInverse, instancedObject.matrixWorld);

			this.renderer.useMaterial(material);

			this._tmpMat4A.set(shadowCamera.projectionMatrix.values);
			this._tmpMat4B.set(mvMatrix.values);
			material.getUniform('projectionMatrix', 'MainBlock').value = this._tmpMat4A;
			material.getUniform('modelViewMatrix', 'MainBlock').value = this._tmpMat4B;
			material.updateUniformBlock('MainBlock');

			const textureIdUniform = material.getUniform('textureId', 'PerInstanceType');

			if (textureIdUniform) {
				this._tmpFloat1[0] = InstanceTextureIdList[name as Tile3DInstanceType];
				textureIdUniform.value = this._tmpFloat1;
				material.updateUniformBlock('PerInstanceType');
			}

			instancedObject.mesh.draw();
		}
	}

	private getInstancesOrigin(camera: Camera): Vec2 {
		return new Vec2(
			Math.floor(camera.position.x / 10000) * 10000,
			Math.floor(camera.position.z / 10000) * 10000
		);
	}

	private renderAircraft(shadowCamera: CSMCascadeCamera): void {
		const aircraftObjects = this.manager.sceneSystem.objects.instancedAircraftParts;
		const vehicleSystem = this.manager.systemManager.getSystem(VehicleSystem);
		const buffers = vehicleSystem.aircraftPartsBuffers;

		for (const partType of buffers.keys()) {
			if (SkippedAircraftParts.includes(partType)) {
				continue;
			}

			const object = aircraftObjects.get(partType);

			if (!object || object.mesh.instanceCount === 0) {
				continue;
			}

			const mvMatrix = Mat4.multiply(shadowCamera.matrixWorldInverse, object.matrixWorld);

			this.renderer.useMaterial(this.aircraftMaterial);

			this._tmpMat4A.set(shadowCamera.projectionMatrix.values);
			this._tmpMat4B.set(mvMatrix.values);
			this.aircraftMaterial.getUniform('projectionMatrix', 'MainBlock').value = this._tmpMat4A;
			this.aircraftMaterial.getUniform('modelViewMatrix', 'MainBlock').value = this._tmpMat4B;
			this.aircraftMaterial.updateUniformBlock('MainBlock');

			object.mesh.draw();
		}
	}

	private renderTrains(shadowCamera: CSMCascadeCamera): void {
		const trainRenderingSystem = this.manager.systemManager.getSystem(TrainRenderingSystem);
		if (!trainRenderingSystem) return;

		const allMeshes = [
			...trainRenderingSystem.carMeshes,
			trainRenderingSystem.trackMesh,
			...trainRenderingSystem.stationMeshes,
		].filter(Boolean);

		const meshes = allMeshes.filter(m => m.isMeshReady() && m.mesh);

		if (meshes.length === 0) return;

		this.renderer.useMaterial(this.trainDepthMaterial);

		this._tmpMat4A.set(shadowCamera.projectionMatrix.values);
		this.trainDepthMaterial.getUniform('projectionMatrix', 'PerMaterial').value = this._tmpMat4A;
		this.trainDepthMaterial.updateUniformBlock('PerMaterial');

		for (const meshObj of meshes) {
			this._tmpMat4B.set(Mat4.multiply(shadowCamera.matrixWorldInverse, meshObj.matrixWorld).values);
			this.trainDepthMaterial.getUniform<UniformMatrix4>('modelViewMatrix', 'PerMesh').value = this._tmpMat4B;
			this.trainDepthMaterial.updateUniformBlock('PerMesh');

			meshObj.draw();
		}
	}

	public render(): void {
		const csm = this.manager.sceneSystem.objects.csm;
		const pass = this.getPhysicalResource('ShadowMaps');

		this.updateMaterialsDefines();

		for (let i = 0; i < csm.cascadeCameras.length; i++) {
			const camera = csm.cascadeCameras[i];

			pass.depthAttachment.slice = i;

			this.renderer.beginRenderPass(pass);

			if (i < 2) {
				this.renderInstances(camera);
				this.renderAircraft(camera);
			}

			this.renderExtrudedMeshes(camera);
			this.renderHuggingMeshes(camera);
			this.renderTrains(camera);
		}
	}

	public setSize(width: number, height: number): void {

	}
}