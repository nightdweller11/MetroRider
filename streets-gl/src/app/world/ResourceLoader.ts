import {load} from '@loaders.gl/core';
import {GLTFLoader} from '@loaders.gl/gltf';

export enum ResourceType {
	Image,
	GLTF
}

export type ResourceJSONTypes = "image" | "text";
export type ResourceJSON = Record<string, {url: string; type: ResourceJSONTypes}>

export interface ResourceRequest {
	url: string;
	type: ResourceType;
}

const MAX_CONCURRENT_LOADS = 6;

export default new class ResourceLoader {
	private resources: Map<string, any> = new Map();
	private requests: Map<string, ResourceRequest> = new Map();

	public add(name: string, url: string, type: ResourceType): void {
		this.requests.set(name, {url, type});
	}

	public addFromJSON(resources: ResourceJSON): void {
		for (const [name, record] of Object.entries(resources)) {
			const type = ResourceLoader.getResourceTypeFromString(record.type);

			if (name.startsWith('aircraft')) {
				continue;
			}

			this.add(name, record.url, type);
		}
	}

	public get(name: string): any {
		return this.resources.get(name);
	}

	public async load(
		{
			onFileLoad,
			onLoadedFileNameChange
		}: {
			onFileLoad: (loaded: number, total: number) => void;
			onLoadedFileNameChange: (name: string) => void;
		}
	): Promise<void> {
		let loaded = 0;
		const total = this.requests.size;
		const entries = Array.from(this.requests.entries());

		let nextIndex = 0;
		const activeNames: Set<string> = new Set();

		const loadNext = async (): Promise<void> => {
			while (nextIndex < entries.length) {
				const idx = nextIndex++;
				const [name, request] = entries[idx];

				activeNames.add(name);
				onLoadedFileNameChange(request.url);

				try {
					let result: any;
					switch (request.type) {
						case ResourceType.Image:
							result = await this.loadImage(request.url);
							break;
						case ResourceType.GLTF:
							result = await this.loadGLTF(request.url);
							break;
					}
					this.resources.set(name, result);
				} catch (err) {
					console.error(`[ResourceLoader] Failed to load "${name}" from ${request.url}:`, err);
				}

				activeNames.delete(name);
				onFileLoad(++loaded, total);
			}
		};

		const workers = Math.min(MAX_CONCURRENT_LOADS, entries.length);
		const promises: Promise<void>[] = [];
		for (let i = 0; i < workers; i++) {
			promises.push(loadNext());
		}
		await Promise.all(promises);

		onLoadedFileNameChange('');
	}

	private async loadImage(url: string): Promise<HTMLImageElement> {
		return new Promise<HTMLImageElement>((resolve, reject) => {
			const image = new Image();

			image.crossOrigin = "anonymous";
			image.onload = (): void => {
				resolve(image);
			};
			image.onerror = (): void => {
				reject(new Error(`Image load failed: ${url}`));
			};

			image.src = url;
		});
	}

	private async loadGLTF(url: string): Promise<any> {
		return await load(url, GLTFLoader);
	}

	private static getResourceTypeFromString(str: string): ResourceType {
		switch (str) {
			case 'image':
				return ResourceType.Image;
			case 'gltf':
				return ResourceType.GLTF;
		}

		throw new Error(`Unknown resource type: ${str}`);
	}
};
