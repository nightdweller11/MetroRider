import React, {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader';

interface Props {
	modelPath: string;
}

let sharedRenderer: THREE.WebGLRenderer | null = null;
let rendererRefCount = 0;

const snapshotCache = new Map<string, string>();

const SESSION_KEY_PREFIX = 'model-preview:';

function getCachedSnapshot(modelPath: string): string | null {
	const mem = snapshotCache.get(modelPath);
	if (mem) return mem;
	try {
		const stored = sessionStorage.getItem(SESSION_KEY_PREFIX + modelPath);
		if (stored) {
			snapshotCache.set(modelPath, stored);
			return stored;
		}
	} catch (e) {
		// sessionStorage unavailable
	}
	return null;
}

function setCachedSnapshot(modelPath: string, dataUrl: string): void {
	snapshotCache.set(modelPath, dataUrl);
	try {
		sessionStorage.setItem(SESSION_KEY_PREFIX + modelPath, dataUrl);
	} catch (e) {
		// storage full or unavailable
	}
}

function getSharedRenderer(): THREE.WebGLRenderer {
	if (!sharedRenderer) {
		sharedRenderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
		sharedRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		sharedRenderer.setClearColor(0x0f1117, 1);
	}
	rendererRefCount++;
	return sharedRenderer;
}

function releaseSharedRenderer(): void {
	rendererRefCount--;
	if (rendererRefCount <= 0 && sharedRenderer) {
		sharedRenderer.dispose();
		sharedRenderer = null;
		rendererRefCount = 0;
	}
}

function createCaseInsensitiveLoader(modelPath: string): GLTFLoader {
	const manager = new THREE.LoadingManager();
	const baseUrl = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
	manager.setURLModifier((url: string): string => {
		if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http')) return url;
		if (url === modelPath) return url;
		const relative = url.startsWith(baseUrl) ? url.substring(baseUrl.length) : url;
		const lowered = relative.split('/').map(s => s.toLowerCase()).join('/');
		if (lowered !== relative) {
			return baseUrl + lowered;
		}
		return url;
	});
	return new GLTFLoader(manager);
}

export default function ModelPreview({modelPath}: Props): React.ReactElement {
	const containerRef = useRef<HTMLDivElement>(null);
	const [imageDataUrl, setImageDataUrl] = useState<string | null>(() => getCachedSnapshot(modelPath));
	const [loadError, setLoadError] = useState(false);

	useEffect((): (() => void) => {
		let cancelled = false;

		const cached = getCachedSnapshot(modelPath);
		if (cached) {
			setImageDataUrl(cached);
			return (): void => { cancelled = true; };
		}

		const renderSnapshot = (): void => {
			const renderer = getSharedRenderer();
			const w = 260;
			const h = 200;
			renderer.setSize(w, h);

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);

			scene.add(new THREE.AmbientLight(0xffffff, 0.8));
			const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
			dirLight.position.set(4, 6, 5);
			scene.add(dirLight);
			const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
			fillLight.position.set(-4, 2, -3);
			scene.add(fillLight);

			const loader = createCaseInsensitiveLoader(modelPath);
			loader.load(
				modelPath,
				(gltf): void => {
					if (cancelled) {
						releaseSharedRenderer();
						return;
					}

					const model = gltf.scene;
					const box = new THREE.Box3().setFromObject(model);
					const center = box.getCenter(new THREE.Vector3());
					const size = box.getSize(new THREE.Vector3());
					const maxDim = Math.max(size.x, size.y, size.z);
					const scale = 2.2 / maxDim;
					model.scale.setScalar(scale);
					model.position.sub(center.multiplyScalar(scale));
					scene.add(model);

					camera.position.set(Math.sin(0.5) * 4.5, 2.5, Math.cos(0.5) * 4.5);
					camera.lookAt(0, 0, 0);
					renderer.render(scene, camera);

					try {
						const dataUrl = renderer.domElement.toDataURL('image/png');
						if (!cancelled) {
							setCachedSnapshot(modelPath, dataUrl);
							setImageDataUrl(dataUrl);
						}
					} catch (err) {
						console.error(`[ModelPreview] Failed to capture snapshot for ${modelPath}:`, err);
						if (!cancelled) setLoadError(true);
					}

					scene.remove(model);
					model.traverse((child: THREE.Object3D): void => {
						if ((child as THREE.Mesh).geometry) {
							(child as THREE.Mesh).geometry.dispose();
						}
						if ((child as THREE.Mesh).material) {
							const mat = (child as THREE.Mesh).material;
							if (Array.isArray(mat)) {
								mat.forEach(m => m.dispose());
							} else {
								mat.dispose();
							}
						}
					});
					releaseSharedRenderer();
				},
				undefined,
				(err: unknown): void => {
					console.error(`[ModelPreview] Failed to load ${modelPath}:`, err);
					if (!cancelled) setLoadError(true);
					releaseSharedRenderer();
				}
			);
		};

		renderSnapshot();

		return (): void => {
			cancelled = true;
		};
	}, [modelPath]);

	if (loadError) {
		return (
			<div ref={containerRef} style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1d30', color: '#5a6378', fontSize: '12px'}}>
				Failed to load model
			</div>
		);
	}

	if (imageDataUrl) {
		return (
			<div ref={containerRef} style={{width: '100%', height: '100%'}}>
				<img src={imageDataUrl} alt="Model preview" style={{width: '100%', height: '100%', objectFit: 'contain', display: 'block'}} />
			</div>
		);
	}

	return (
		<div ref={containerRef} style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1117', color: '#5a6378', fontSize: '12px'}}>
			Loading...
		</div>
	);
}
