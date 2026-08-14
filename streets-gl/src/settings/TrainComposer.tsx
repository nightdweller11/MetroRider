import React, {useState, useCallback, useMemo} from 'react';
import ModelPreview from './ModelPreview';
import {parseSlot, toggleSlotFlip, withSlotModel, withSlotTint, isSlotFlipped} from '~/app/game/assets/SlotSpec';

/**
 * The livery palette.
 *
 * A fixed set rather than a colour wheel: a child picking a colour wants to
 * point at the red one, and every colour here is one a real train is painted.
 * "Original" is first because it is the way out — a player who paints a
 * carriage they liked needs to be able to get it back.
 */
const LIVERY_COLOURS: {name: string; tint: string | null}[] = [
	{name: 'Original', tint: null},
	{name: 'Red', tint: 'd62828'},
	{name: 'Orange', tint: 'f77f00'},
	{name: 'Yellow', tint: 'ffd23f'},
	{name: 'Green', tint: '2a9d5c'},
	{name: 'Blue', tint: '1d70c4'},
	{name: 'Navy', tint: '1b3a6b'},
	{name: 'Purple', tint: '7b52d6'},
	{name: 'Pink', tint: 'ef7b9c'},
	{name: 'Silver', tint: 'c9d2da'},
	{name: 'White', tint: 'f2f5f7'},
	{name: 'Black', tint: '2a2f36'},
];

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
	onReassign?: (entry: AssetEntry, targetSub: string) => void;
	adminMode?: boolean;
}

const MAX_SLOTS = 12;
const MIN_SLOTS = 1;

const REASSIGN_TARGETS = [
	{sub: 'tracks', label: 'Track Models'},
	{sub: 'stations', label: 'Station Models'},
];

export default function TrainComposer({slots, trainModels, onSlotsChange, onDelete, onReassign, adminMode}: TrainComposerProps): React.ReactElement {
	const [selectedSlot, setSelectedSlot] = useState<number>(0);
	const [filter, setFilter] = useState('');
	const [reassigningId, setReassigningId] = useState<string | null>(null);

	const nameMap = useMemo((): Map<string, string> => {
		const m = new Map<string, string>();
		m.set('procedural-default', 'Procedural');
		for (const e of trainModels) {
			m.set(e.id, e.name);
		}
		return m;
	}, [trainModels]);

	const getModelName = useCallback((slot: string): string => {
		const {modelId} = parseSlot(slot);
		return nameMap.get(modelId) || modelId;
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
		next[selectedSlot] = withSlotModel(next[selectedSlot], modelId);
		onSlotsChange(next);
	}, [slots, selectedSlot, onSlotsChange]);

	const handleToggleFlip = useCallback((idx: number): void => {
		if (idx < 0 || idx >= slots.length) return;
		const next = [...slots];
		next[idx] = toggleSlotFlip(next[idx]);
		onSlotsChange(next);
	}, [slots, onSlotsChange]);

	const handleTint = useCallback((idx: number, tint: string | null): void => {
		if (idx < 0 || idx >= slots.length) return;
		const next = [...slots];
		next[idx] = withSlotTint(next[idx], tint);
		onSlotsChange(next);
	}, [slots, onSlotsChange]);

	const handlePaintAll = useCallback((tint: string | null): void => {
		onSlotsChange(slots.map(s => withSlotTint(s, tint)));
	}, [slots, onSlotsChange]);

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
					{slots.map((slot, i) => {
						const {modelId, flipped, tint} = parseSlot(slot);
						return (
							<div
								key={i}
								className={`tc-slot-card ${i === selectedSlot ? 'tc-slot-selected' : ''}`}
								onClick={(): void => setSelectedSlot(i)}
							>
								<div className="tc-slot-position">#{i + 1}</div>
								<div className="tc-slot-thumb" style={flipped ? {transform: 'scaleX(-1)'} : undefined}>
									{(() => {
										const entry = trainModels.find(e => e.id === modelId);
										if (entry?.path) {
											return <ModelPreview modelPath={`/data/assets/${entry.path}`} />;
										}
										return <div className="tc-slot-procedural">P</div>;
									})()}
								</div>
								<div className="tc-slot-name">{getModelName(slot)}</div>
								{flipped && <div className="tc-slot-flip-badge">Reversed</div>}
								{tint && (
									<div
										className="tc-slot-tint-badge"
										style={{background: `#${tint}`}}
										title={`Painted #${tint}`}
									/>
								)}
								<button
									className={`tc-slot-flip ${flipped ? 'tc-slot-flip-active' : ''}`}
									onClick={(ev): void => { ev.stopPropagation(); handleToggleFlip(i); }}
									title={flipped ? 'Facing backward — click to face forward' : 'Rotate this car 180°'}
								>&#x21BB;</button>
								{slots.length > MIN_SLOTS && (
									<button
										className="tc-slot-remove"
										onClick={(ev): void => { ev.stopPropagation(); handleRemoveSlot(i); }}
										title="Remove this car"
									>&times;</button>
								)}
							</div>
						);
					})}
					{slots.length < MAX_SLOTS && (
						<button className="tc-slot-add" onClick={handleAddSlot} title="Add a car">
							+
						</button>
					)}
				</div>

				<div className="tc-livery">
					<div className="tc-livery-head">
						<span className="tc-livery-title">Paint car #{selectedSlot + 1}</span>
						<button
							className="tc-livery-all"
							onClick={(): void => handlePaintAll(parseSlot(slots[selectedSlot] ?? '').tint)}
							title="Give every car the colour this one has"
						>Paint the whole train</button>
					</div>
					<div className="tc-livery-swatches">
						{LIVERY_COLOURS.map(colour => {
							const active = (parseSlot(slots[selectedSlot] ?? '').tint ?? null) === colour.tint;

							return (
								<button
									key={colour.name}
									className={`tc-swatch ${active ? 'tc-swatch-on' : ''} ${colour.tint ? '' : 'tc-swatch-none'}`}
									style={colour.tint ? {background: `#${colour.tint}`} : undefined}
									onClick={(): void => handleTint(selectedSlot, colour.tint)}
									title={colour.name}
									aria-label={colour.name}
								>{colour.tint ? '' : '✕'}</button>
							);
						})}
					</div>
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
						const isAssigned = entry.id === parseSlot(slots[selectedSlot] ?? '').modelId;
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
								{entry.type !== 'procedural' && adminMode && onReassign && (
									<div className="reassign-wrapper">
										<button
											className="reassign-btn"
											onClick={(ev: React.MouseEvent): void => {
												ev.stopPropagation();
												setReassigningId(reassigningId === entry.id ? null : entry.id);
											}}
											title="Move to another category"
										>&#x21C4;</button>
										{reassigningId === entry.id && (
											<div className="reassign-menu" onClick={(ev) => ev.stopPropagation()}>
												<div className="reassign-menu-title">Move to:</div>
												{REASSIGN_TARGETS.map(t => (
													<button
														key={t.sub}
														className="reassign-menu-item"
														onClick={() => { onReassign(entry, t.sub); setReassigningId(null); }}
													>{t.label}</button>
												))}
											</div>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
