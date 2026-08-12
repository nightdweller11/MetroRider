import React from 'react';
import ModelPreview from './ModelPreview';

interface AssetEntry {
	id: string;
	name: string;
	path: string | null;
	type: string;
	source: string;
}

export type CrowdLevel = 'off' | 'few' | 'normal' | 'busy';
export type DemandLevel = 'calm' | 'normal' | 'rush';

interface Props {
	people: AssetEntry[];
	selected: string[];
	crowdLevel: CrowdLevel;
	demandLevel: DemandLevel;
	onSelectedChange: (ids: string[]) => void;
	onCrowdLevelChange: (level: CrowdLevel) => void;
	onDemandLevelChange: (level: DemandLevel) => void;
	onDelete: (entry: AssetEntry) => void;
	adminMode: boolean;
}

const CROWD_OPTIONS: {id: CrowdLevel; label: string; hint: string}[] = [
	{id: 'off', label: 'Off', hint: 'No figures on platforms'},
	{id: 'few', label: 'Few', hint: 'Up to 8 per platform'},
	{id: 'normal', label: 'Normal', hint: 'Up to 20 per platform'},
	{id: 'busy', label: 'Busy', hint: 'Up to 40 per platform'},
];

const DEMAND_OPTIONS: {id: DemandLevel; label: string; hint: string}[] = [
	{id: 'calm', label: 'Calm', hint: 'Quiet service — platforms fill slowly'},
	{id: 'normal', label: 'Normal', hint: 'Everyday ridership'},
	{id: 'rush', label: 'Rush hour', hint: 'Crowds build fast — dwell time matters'},
];

/**
 * Passengers settings.
 *
 * Figure models are a MULTI-select on purpose: a platform mixes whatever is
 * ticked, so a crowd looks like a crowd instead of one person copy-pasted.
 */
export default function PassengerPanel(props: Props): React.ReactElement {
	const {people, selected, crowdLevel, demandLevel} = props;

	const toggle = (id: string): void => {
		const next = selected.includes(id)
			? selected.filter(s => s !== id)
			: [...selected, id];
		// Never leave the crowd with nothing to draw.
		props.onSelectedChange(next.length > 0 ? next : ['procedural-default']);
	};

	return (
		<>
			<h2>Passengers</h2>
			<p className="category-description">
				People waiting on the platforms are real: the number in the HUD is the number of
				figures you can see, and they board your train when you open the doors.
			</p>

			<div className="passenger-controls">
				<div className="passenger-control-group">
					<div className="passenger-control-label">Crowds on platforms</div>
					<div className="segmented">
						{CROWD_OPTIONS.map(opt => (
							<button
								key={opt.id}
								className={`segmented-item ${crowdLevel === opt.id ? 'active' : ''}`}
								title={opt.hint}
								onClick={(): void => props.onCrowdLevelChange(opt.id)}
							>
								{opt.label}
							</button>
						))}
					</div>
					<div className="passenger-control-hint">
						{CROWD_OPTIONS.find(o => o.id === crowdLevel)?.hint}
					</div>
				</div>

				<div className="passenger-control-group">
					<div className="passenger-control-label">How busy the line is</div>
					<div className="segmented">
						{DEMAND_OPTIONS.map(opt => (
							<button
								key={opt.id}
								className={`segmented-item ${demandLevel === opt.id ? 'active' : ''}`}
								title={opt.hint}
								onClick={(): void => props.onDemandLevelChange(opt.id)}
							>
								{opt.label}
							</button>
						))}
					</div>
					<div className="passenger-control-hint">
						{DEMAND_OPTIONS.find(o => o.id === demandLevel)?.hint}
					</div>
				</div>
			</div>

			<h3 className="passenger-section-title">
				Figure models <span className="passenger-section-note">pick one or more — platforms mix them</span>
			</h3>

			<div className="asset-grid">
				{people.map(entry => {
					const isSelected = selected.includes(entry.id);
					return (
						<div
							key={entry.id}
							className={`asset-card ${isSelected ? 'selected' : ''}`}
							onClick={(): void => toggle(entry.id)}
						>
							{entry.path ? (
								<div className="asset-preview">
									<ModelPreview modelPath={`/data/assets/${entry.path}`} />
								</div>
							) : (
								<div className="asset-preview procedural-preview">
									<span>Built-in person</span>
								</div>
							)}

							<div className="asset-info">
								<div className="asset-name">{entry.name}</div>
								<div className="asset-source">{entry.source}</div>
								{isSelected && <div className="asset-selected-badge">In the crowd</div>}
							</div>

							{entry.type !== 'procedural' && (
								<button
									className="delete-btn"
									onClick={(ev: React.MouseEvent): void => {
										ev.stopPropagation();
										props.onDelete(entry);
									}}
									title="Delete (requires admin token)"
								>
									&#x2715;
								</button>
							)}
						</div>
					);
				})}
			</div>

			{people.length <= 1 && (
				<p className="category-description" style={{marginTop: 16}}>
					Only the built-in figure is available. Add more from the <strong>Sketchfab Browser</strong>{' '}
					(admin) by importing into the <em>People</em> category, or upload a .glb above — any
					human model works, it is scaled to human height automatically.
				</p>
			)}
		</>
	);
}
