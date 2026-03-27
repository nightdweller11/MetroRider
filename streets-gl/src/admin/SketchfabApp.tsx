import React from 'react';
import {createRoot} from 'react-dom/client';
import SketchfabBrowser from './SketchfabBrowser';

const container = document.getElementById('sketchfab-root');
if (container) {
	const root = createRoot(container);
	root.render(<SketchfabBrowser />);
}
