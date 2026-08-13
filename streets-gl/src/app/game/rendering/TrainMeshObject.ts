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
	/**
	 * Public so other systems can measure the placed geometry — the passenger
	 * crowds read the station mesh to find the platform deck height.
	 */
	public buffers: TrainMeshBuffers;
	private needsRebuild: boolean = false;
	private dynamic: boolean = false;

	/**
	 * World matrix as it was on the previously RENDERED frame — needed for
	 * correct TAA motion vectors. Train cars move in world space; deriving the
	 * "previous" model-view from the CURRENT world matrix (as static tiles do)
	 * hides that motion from the velocity buffer and TAA ghosts/blurs the
	 * moving train while the static world stays sharp.
	 */
	public readonly matrixWorldPrevFrame: Float64Array = new Float64Array(16);
	public hasPrevFrame: boolean = false;

	public storePrevFrameMatrix(): void {
		this.matrixWorldPrevFrame.set(this.matrixWorld.values);
		this.hasPrevFrame = true;
	}

	public constructor(buffers: TrainMeshBuffers, dynamic: boolean = false) {
		super();
		this.buffers = buffers;
		this.dynamic = dynamic;
		this.setBoundingBox(
			new Vec3(-100, -10, -100),
			new Vec3(100, 50, 100)
		);
	}

	public setBuffers(buffers: TrainMeshBuffers): void {
		// The old mesh owns GPU buffers and a VAO. Dropping the reference does
		// NOT free them — WebGL objects are not garbage collected — so every
		// rebuild used to leak. Measured with the render telemetry: ~100 index
		// buffers a second created and never deleted while parked at a station,
		// live buffers climbing ~1,000 a minute for as long as the game ran.
		this.dispose();
		this.buffers = buffers;
		this.needsRebuild = true;
	}

	/** Release this object's GPU resources. Safe to call more than once. */
	public dispose(): void {
		if (this.mesh) {
			this.mesh.delete();
			this.mesh = null;
		}
	}

	public updatePositionAndNormalBuffers(position: Float32Array, normal: Float32Array): void {
		this.buffers.position = position;
		this.buffers.normal = normal;
		if (this.mesh) {
			this.mesh.getAttribute('position').buffer.setData(position);
			this.mesh.getAttribute('normal').buffer.setData(normal);
		}
	}

	public isMeshReady(): boolean {
		return this.mesh !== null && !this.needsRebuild;
	}

	public updateMesh(renderer: AbstractRenderer): void {
		this.needsRebuild = false;
		const usage = this.dynamic
			? RendererTypes.BufferUsage.DynamicDraw
			: RendererTypes.BufferUsage.StaticDraw;

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
						usage,
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
						usage,
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
