/**
 * The rows of the "Pick a line" sheet.
 *
 * On the Israel-railways map four lines all started "A1 - A…" and read as four
 * near-identical rows: A1-A2, A1-A3 and A1-A4 are the same Sharon-to-Ayalon
 * service run to three different ends, and A1-A5 is its express. The map says
 * as much — every line carries a `lineGroupId` — and the picker threw it away.
 * Now each group sits under one header, the full run first, and every row says
 * what it is: an express and how many stations it runs through, or which
 * longer service a short working is part of.
 *
 * Kept out of GameUISystem so it can be tested without a DOM: rows in, rows
 * out. The ROW ORDER changes; the line INDEX each row drives never does,
 * because share links and saved records point at lines by index.
 */

import type {SheetRow} from './CabSheet';
import {inferLineMode, lineModeInfo, type LineMode} from '../data/LineModes';
import {lineBadge, lineCode, lineNameWithoutCode} from '../data/LineLabel';
import {groupLinesForPicker, patternNote} from '../data/ServicePatterns';

/** What the picker needs from a loaded line — no more. */
export interface PickerLine {
	parsed: {
		name: string;
		color: string;
		isLoop: boolean;
		mode?: LineMode;
		stations: {id: string}[];
		groupId?: string;
		groupLabel?: string;
		express?: boolean;
		skipped?: {id: string}[];
	};
	track: {totalLength: number};
}

export function linePickerRows(lines: PickerLine[], onSelect: (index: number) => void): SheetRow[] {
	const entries = groupLinesForPicker(lines.map(ls => ({
		name: ls.parsed.name,
		color: ls.parsed.color,
		groupId: ls.parsed.groupId,
		groupLabel: ls.parsed.groupLabel,
		stopIds: ls.parsed.stations.map(s => s.id),
	})));

	return entries.map((entry): SheetRow => {
		if (entry.kind === 'header') {
			return {
				section: true,
				badgeColor: entry.color,
				title: entry.label,
				subtitle: `${entry.count} services`,
				readOnly: true,
				onSelect: (): void => undefined,
			};
		}

		const idx = entry.index;
		const ls = lines[idx];
		// The map usually says what kind of service a line runs; when it does
		// not, the line itself is read. Either way the player should know they
		// are about to drive a bus before they pick it.
		const mode = lineModeInfo(
			ls.parsed.mode ?? inferLineMode(
				ls.parsed.name, ls.track.totalLength, ls.parsed.stations.length,
			),
		);
		const parent = entry.partOf === null ? null : lines[entry.partOf];
		const parentCode = parent ? (lineCode(parent.parsed.name) ?? lineBadge(parent.parsed.name, entry.partOf ?? 0)) : null;
		const note = patternNote(
			{express: ls.parsed.express, skippedCount: ls.parsed.skipped?.length ?? 0},
			parentCode,
		);

		return {
			// BOTH codes — a service is the A1 to A2, and taking only the
			// first badged four different routes on the built-in map "A1".
			// parsed.id is a numeric index and means nothing to a player.
			badge: lineBadge(ls.parsed.name, idx),
			badgeColor: ls.parsed.color,
			// The name without the code it is already badged with, so the
			// row is not "A1-A2 · A1 - A2 Sharon Local - Ayalon Local".
			title: ls.parsed.isLoop
				? `${lineNameWithoutCode(ls.parsed.name)} ⟳`
				: lineNameWithoutCode(ls.parsed.name),
			subtitleIcon: mode.icon,
			subtitle: `${mode.label} · ${ls.parsed.stations.length} stops${note ? ` · ${note}` : ''}`,
			inGroup: entry.grouped,
			// Tapping a line DRIVES that line, from its first stop.
			onSelect: (): void => onSelect(idx),
		};
	});
}
