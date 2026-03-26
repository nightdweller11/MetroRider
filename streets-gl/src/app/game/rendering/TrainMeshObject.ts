import RenderableObject3D from '~/app/objects/RenderableObject3D';
import AbstractMesh from '~/lib/renderer/abstract-renderer/AbstractMesh';
import AbstractRenderer from '~/lib/renderer/abstract-renderer/AbstractRenderer';
import {RendererTypes} from '~/lib/renderer/RendererTypes';
import Vec3 from '~/lib/math/Vec3';

interface TrainMeshBuffers {
	position: Float32Array;
	normal: Float32Array;
	color: Float32Array;
	indices: Uint32Array;
}

export default class TrainMeshObject extends RenderableObject3D {
	public mesh: AbstractMesh = null;
	private buffers: TrainMeshBuffers;
	private needsRebuild: boolean = false;

	public constructor(buffers: TrainMeshBuffers) {
		super();
		this.buffers = buffers;
		this.setBoundingBox(
			new Vec3(-100, -10, -100),
			new Vec3(100, 50, 100)
		);
	}

	public setBuffers(buffers: TrainMeshBuffers): void {
		this.buffers = buffers;
		this.needsRebuild = true;
		this.mesh = null;
	}

	public isMeshReady(): boolean {
		return this.mesh !== null && !this.needsRebuild;
	}

	public updateMesh(renderer: AbstractRenderer): void {
		this.needsRebuild = false;

		this.mesh = renderer.createMesh({
			indexed: true,
			indices: this.buffers.indices,
			attributes: [
				renderer.createAttribute({
					name: 'position',
					size: 3,
					type: RendererTypes.AttributeType.Float32,
					format: RendererTypes.AttributeFormat.Float,
					normalized: false,
					buffer: renderer.createAttributeBuffer({
						data: this.buffers.position,
					}),
				}),
				renderer.createAttribute({
					name: 'normal',
					size: 3,
					type: RendererTypes.AttributeType.Float32,
					format: RendererTypes.AttributeFormat.Float,
					normalized: false,
					buffer: renderer.createAttributeBuffer({
						data: this.buffers.normal,
					}),
				}),
				renderer.createAttribute({
					name: 'color',
					size: 3,
					type: RendererTypes.AttributeType.Float32,
					format: RendererTypes.AttributeFormat.Float,
					normalized: false,
					buffer: renderer.createAttributeBuffer({
						data: this.buffers.color,
					}),
				}),
			],
		});
	}
}
