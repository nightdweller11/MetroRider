let _enabled: boolean | null = null;

export function isDebugEnabled(): boolean {
	if (_enabled === null) {
		try {
			if (typeof window !== 'undefined') {
				_enabled =
					window.location.search.includes('debug=true') ||
					(typeof localStorage !== 'undefined' && localStorage.getItem('metrorider_debug') === 'true');
			} else {
				_enabled = false;
			}
		} catch {
			_enabled = false;
		}
	}
	return _enabled;
}

export function setDebugEnabled(enabled: boolean): void {
	_enabled = enabled;
}

export function debugLog(...args: unknown[]): void {
	if (isDebugEnabled()) {
		console.log(...args);
	}
}
