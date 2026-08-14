import Shaders from "../shaders/Shaders";
import MaterialContainer from "./MaterialContainer";
import {RendererTypes} from "~/lib/renderer/RendererTypes";
import AbstractRenderer from "~/lib/renderer/abstract-renderer/AbstractRenderer";

export default class TrainMaterialContainer extends MaterialContainer {
	public constructor(renderer: AbstractRenderer) {
		super(renderer);

		this.material = this.renderer.createMaterial({
			name: 'Train material',
			uniforms: [
				{
					name: 'projectionMatrix',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				},
				{
					name: 'modelMatrix',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				},
				{
					name: 'viewMatrix',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				},
				{
					name: 'modelViewMatrixPrev',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Matrix4,
					value: new Float32Array(16)
				},
				{
					name: 'objectMotion',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Float1,
					value: new Float32Array(1)
				},
				{
					name: 'hasTexture',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Float1,
					value: new Float32Array(1)
				},
				{
					name: 'trackBlendColor',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Float4,
					value: new Float32Array(4)
				},
				{
					name: 'detailFadeStart',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Float1,
					value: new Float32Array(1)
				},
				{
					name: 'detailFadeEnd',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Float1,
					value: new Float32Array(1)
				},
				{
					// Livery paint: rgb + strength. Strength 0 leaves the model
					// exactly as its author made it, which is the default for
					// every mesh that is not a player's car.
					name: 'tintColor',
					block: 'MainBlock',
					type: RendererTypes.UniformType.Float4,
					value: new Float32Array(4)
				},
				{
					name: 'tDiffuse',
					block: null,
					type: RendererTypes.UniformType.Texture2D,
					value: null
				},
			],
			primitive: {
				frontFace: RendererTypes.FrontFace.CCW,
				cullMode: RendererTypes.CullMode.Back
			},
			depth: {
				depthWrite: true,
				depthCompare: RendererTypes.DepthCompare.LessEqual
			},
			blend: {
				color: {
					operation: RendererTypes.BlendOperation.Add,
					srcFactor: RendererTypes.BlendFactor.One,
					dstFactor: RendererTypes.BlendFactor.Zero
				},
				alpha: {
					operation: RendererTypes.BlendOperation.Add,
					srcFactor: RendererTypes.BlendFactor.One,
					dstFactor: RendererTypes.BlendFactor.Zero
				}
			},
			vertexShaderSource: Shaders.train.vertex,
			fragmentShaderSource: Shaders.train.fragment
		});
	}
}
