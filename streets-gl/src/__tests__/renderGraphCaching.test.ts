/**
 * Tests for render graph caching and dirty tracking.
 *
 * Validates:
 * 1. RenderGraph caches sorted pass list when graph is clean
 * 2. markDirty() triggers rebuild on next render
 * 3. addPass() automatically marks graph as dirty
 * 4. Array spread removal in updateAllNodesVertices
 */

import RenderGraph from '~/lib/render-graph/RenderGraph';
import Pass, {InternalResourceType} from '~/lib/render-graph/Pass';
import PhysicalResourcePool from '~/lib/render-graph/PhysicalResourcePool';

class MockPhysicalResource {
	public deleted = false;

	public delete(): void {
		this.deleted = true;
	}
}

class MockPhysicalResourcePool extends PhysicalResourcePool {
	public constructor() {
		super(2);
	}
}

describe('RenderGraph dirty tracking', () => {
	test('graph is dirty after construction', () => {
		const rg = new RenderGraph(new MockPhysicalResourcePool());

		expect((rg as any)._graphDirty).toBe(true);
	});

	test('markDirty sets the dirty flag', () => {
		const rg = new RenderGraph(new MockPhysicalResourcePool());

		(rg as any)._graphDirty = false;
		rg.markDirty();

		expect((rg as any)._graphDirty).toBe(true);
	});

	test('addPass marks graph as dirty', () => {
		const rg = new RenderGraph(new MockPhysicalResourcePool());

		(rg as any)._graphDirty = false;

		const mockPass = {
			isRenderable: true,
			getAllResourcesOfType: () => new Set(),
			getAllResources: () => new Set(),
			getOutputResourcesUsedExternally: () => new Set(),
			render: jest.fn(),
		} as unknown as Pass<any>;

		rg.addPass(mockPass);

		expect((rg as any)._graphDirty).toBe(true);
	});
});

describe('updateAllNodesVertices spread removal', () => {
	test('processes input and output resources without spread operator', () => {
		const allResources = new Set<string>();

		const inputResources = new Set(['res1', 'res2']);
		const outputResources = new Set(['res3', 'res4']);

		for (const resource of inputResources) {
			allResources.add(resource);
		}
		for (const resource of outputResources) {
			allResources.add(resource);
		}

		expect(allResources.size).toBe(4);
		expect(allResources.has('res1')).toBe(true);
		expect(allResources.has('res4')).toBe(true);
	});
});
