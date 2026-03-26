import React, {useCallback, useContext, useEffect, useState} from "react";
import {useRecoilValue} from "recoil";
import SelectionPanel from "~/app/ui/components/SelectionPanel";
import {AtomsContext} from "~/app/ui/UI";
import TimePanel from "~/app/ui/components/TimePanel";
import NavPanel from "~/app/ui/components/NavPanel";
import SettingsModalPanel from "~/app/ui/components/SettingsModalPanel";
import styles from './MainScreen.scss';

const MainScreen: React.FC = () => {
	const atoms = useContext(AtomsContext);

	const loadingProgress = useRecoilValue(atoms.resourcesLoadingProgress);
	const [activeModalWindow, setActiveModalWindow] = useState<string>('');
	const [isUIVisible, setIsUIVisible] = useState<boolean>(true);

	const closeModal = useCallback((): void => setActiveModalWindow(''), []);

	useEffect(() => {
		const handler = (e: KeyboardEvent): void => {
			if (e.code === 'KeyU' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				setIsUIVisible(!isUIVisible);
			}

			if (e.code === 'Escape') {
				closeModal();
			}
		}

		window.addEventListener('keydown', handler);
		return () => {
			window.removeEventListener('keydown', handler)
		};
	}, [isUIVisible]);

	let containerClassNames = styles.mainScreen;

	if (!isUIVisible || loadingProgress < 1.) {
		containerClassNames += ' ' + styles['mainScreen--hidden'];
	}

	return (
		<div className={containerClassNames}>
			<NavPanel
				setActiveModalWindow={setActiveModalWindow}
				activeModalWindow={activeModalWindow}
			/>
			{
				activeModalWindow === 'settings' && <SettingsModalPanel onClose={closeModal}/>
			}
			<TimePanel/>
			<SelectionPanel/>
		</div>
	);
}

export default MainScreen;
