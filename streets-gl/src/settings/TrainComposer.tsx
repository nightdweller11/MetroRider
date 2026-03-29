import React, {useState, useCallback, useMemo} from 'react';
import ModelPreview from './ModelPreview';

interface AssetEntry {
	id: string;
	name: string;
	path: string | null;
	type: string;
	source: string;
}

interface TrainComposerProps {
	slots: string[];
	trainModels: AssetEntry[];
	onSlotsChange: (slots: string[]) => void;
	onDelete?: (entry: AssetEntry) => void;
}

const MAX_SLOTS = 12;
const MIN_SLOTS = 1;

export default function TrainComposer({slots, trainModels, onSlotsChange, onDelete}: TrainComposerProps): React.ReactElement {
	const [selectedSlot, setSelectedSlot] = useState<number>(0);
	const [filter, setFilter] = useState('');

	const nameMap = useMemo((): Map<string, string> => {
		const m = new Map<string, string>();
		m.set('procedural-default', 'Procedural');
		for (const e of trainModels) {
			m.set(e.id, e.name);
		}
		return m;
	}, [trainModels]);

	const getModelName = useCallback((id: string): string => {
		return nameMap.get(id) || id;
	}, [nameMap]);

	const handleAddSlot = useCallback((): void => {
		if (slots.length >= MAX_SLOTS) return;
		const lastModel = slots[slots.length - 1] || 'procedural-default';
		onSlotsChange([...slots, lastModel]);
	}, [slots, onSlotsChange]);

	const handleRemoveSlot = useCallback((idx: number): void => {
		if (slots.length <= MIN_SLOTS) return;
		const next = slots.filter((_, i) => i !== idx);
		onSlotsChange(next);
		if (selectedSlot >= next.length) {
			setSelectedSlot(Math.max(0, next.length - 1));
		}
	}, [slots, selectedSlot, onSlotsChange]);

	const handleAssignModel = useCallback((modelId: string): void => {
		if (selectedSlot < 0 || selectedSlot >= slots.length) return;
		const next = [...slots];
		next[selectedSlot] = modelId;
		onSlotsChange(next);
	}, [slots, selectedSlot, onSlotsChange]);

	const filterLower = filter.toLowerCase().trim();
	const filteredModels = filterLower
		? trainModels.filter(e => e.name.toLowerCase().includes(filterLower) || e.source.toLowerCase().includes(filterLower))
		: trainModels;

	return (
		<div className="train-composer">
			<div className="tc-slot-section">
				<h3 className="tc-section-title">Train Composition</h3>
				<p className="tc-section-desc">Click a slot to select it, then choose a model below. Each slot is an independent car.</p>
				<div className="tc-slot-strip">
					{slots.map((modelId, i) => (
						<div
							key={i}
							className={`tc-slot-card ${i === selectedSlot ? 'tc-slot-selected' : ''}`}
							onClick={(): void => setSelectedSlot(i)}
						>
							<div className="tc-slot-position">#{i + 1}</div>
							<div className="tc-slot-thumb">
								{(() => {
									const entry = trainModels.find(e => e.id === modelId);
									if (entry?.path) {
										return <ModelPreview modelPath={`/data/assets/${entry.path}`} />;
									}
									return <div className="tc-slot-procedural">P</div>;
								})()}
							</div>
							<div className="tc-slot-name">{getModelName(modelId)}</div>
							{slots.length > MIN_SLOTS && (
								<button
									className="tc-slot-remove"
									onClick={(ev): void => { ev.stopPropagation(); handleRemoveSlot(i); }}
									title="Remove this car"
								>&times;</button>
							)}
						</div>
					))}
					{slots.length < MAX_SLOTS && (
						<button className="tc-slot-add" onClick={handleAddSlot} title="Add a car">
							+
						</button>
					)}
				</div>
			</div>

			<div className="tc-picker-section">
				<h3 className="tc-section-title">
					Assign model to Slot #{selectedSlot + 1}
				</h3>

				{trainModels.length > 4 && (
					<div className="asset-filter-bar">
						<input
							type="text"
							value={filter}
							onChange={e => setFilter(e.target.value)}
							placeholder="Filter models by name..."
							className="asset-filter-input"
						/>
						{filter && (
							<button className="asset-filter-clear" onClick={() => setFilter('')}>&times;</button>
						)}
						{filterLower && (
							<span className="asset-filter-count">
								{filteredModels.length} of {trainModels.length}
							</span>
						)}
					</div>
				)}

				<div className="asset-grid">
					{filteredModels.map(entry => {
						const isAssigned = entry.id === slots[selectedSlot];
						return (
							<div
								key={entry.id}
								className={`asset-card ${isAssigned ? 'selected' : ''}`}
								onClick={(): void => handleAssignModel(entry.id)}
							>
								{entry.path ? (
									<div className="asset-preview">
										<ModelPreview modelPath={`/data/assets/${entry.path}`} />
									</div>
								) : (
									<div className="asset-preview procedural-preview">
										<span>Procedural</span>
									</div>
								)}
								<div className="asset-info">
									<div className="asset-name">{entry.name}</div>
									<div className="asset-source">{entry.source}</div>
									{isAssigned && <div className="asset-selected-badge">Slot #{selectedSlot + 1}</div>}
								</div>
								{entry.type !== 'procedural' && onDelete && (
									<button
										className="delete-btn"
										onClick={(ev: React.MouseEvent): void => { ev.stopPropagation(); onDelete(entry); }}
										title="Delete (requires admin token)"
									>&#x2715;</button>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
