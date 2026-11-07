import {cacheControlFor} from '../../server/utils/cachePolicy';

describe('cacheControlFor', () => {
	it('never lets a browser keep an old page after a deploy', () => {
		expect(cacheControlFor('/app/build/index.html')).toBe('no-cache');
		expect(cacheControlFor('/app/build/settings.html')).toBe('no-cache');
		expect(cacheControlFor('/app/build/admin/sketchfab.html')).toBe('no-cache');
	});

	it('revalidates the unhashed stylesheet', () => {
		expect(cacheControlFor('/app/build/main.css')).toBe('no-cache');
	});

	it('keeps content-hashed scripts forever', () => {
		expect(cacheControlFor('/app/build/js/index.4af667d630d973eef7e3.js'))
			.toBe('public, max-age=31536000, immutable');
	});

	it('does not treat an unhashed script as immutable', () => {
		expect(cacheControlFor('/app/build/js/worker.js')).toBe('public, max-age=3600');
	});

	it('keeps other assets for an hour', () => {
		expect(cacheControlFor('/app/build/models/train.glb')).toBe('public, max-age=3600');
		expect(cacheControlFor('/app/build/textures/sky.png')).toBe('public, max-age=3600');
	});
});
