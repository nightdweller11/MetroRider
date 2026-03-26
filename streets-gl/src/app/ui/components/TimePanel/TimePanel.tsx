import React, {useContext, useState} from "react";
import {useRecoilState} from "recoil";
import {AtomsContext} from "~/app/ui/UI";
import styles from './TimePanel.scss';
import timeButtonStyles from './TimeButton.scss';
import TimeControls from "~/app/ui/components/TimePanel/TimeControls";
import {IoTimeOutline} from "react-icons/io5";

const presets = ['Dynamic', 'Morning', 'Noon', 'Evening', 'Night'];

const TimePanel: React.FC = () => {
	const atoms = useContext(AtomsContext);
	const [timeMode, setTimeMode] = useRecoilState(atoms.mapTimeMode);
	const [expanded, setExpanded] = useState<boolean>(false);

	if (!expanded) {
		return (
			<button
				className={styles.timeToggle}
				onClick={(): void => setExpanded(true)}
				title="Time of day"
			>
				<IoTimeOutline size={22}/>
			</button>
		);
	}

	return (
		<div className={styles.timePanel}>
			<div className={styles.timePanel__headerRow}>
				<div className={styles.timePanel__header}>Time of day</div>
				<button
					className={styles.timePanel__close}
					onClick={(): void => setExpanded(false)}
					title="Close"
				>&times;</button>
			</div>
			<div className={styles.timePanel__presets}>
				{presets.map((presetName, i) => {
					const isActive = timeMode === i;
					let classList = timeButtonStyles.timeButton + ' ' + timeButtonStyles['timeButton--text'];

					if (isActive) {
						classList += ' ' + timeButtonStyles['timeButton--active'];
					}

					return (
						<button
							className={classList}
							onClick={(): void => {
								setTimeMode(i);
							}}
							key={i}
						>{presetName}</button>
					);
				})}
			</div>
			{timeMode === 0 && (
				<TimeControls/>
			)}
		</div>
	);
};

export default React.memo(TimePanel);