import fs from 'fs';
import os from 'os';
import path from 'path';
import {ProfileStore, isHigherBetter, isPlausibleEmail, MIN_PASSWORD_LENGTH} from '../../server/store/ProfileStore';

/** Each test gets its own temp DB — no shared state, no cleanup surprises. */
function freshStore(): {store: ProfileStore; dir: string} {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrorider-profiles-'));
	return {store: new ProfileStore(dir), dir};
}

describe('ProfileStore — profiles', () => {
	let store: ProfileStore;
	let dir: string;

	beforeEach(() => {
		({store, dir} = freshStore());
	});

	afterEach(() => {
		store.close();
		fs.rmSync(dir, {recursive: true, force: true});
	});

	it('creates a profile and signs it in', () => {
		const {token, profile} = store.createProfile('Yotam', '1234');

		expect(profile.name).toBe('Yotam');
		expect(token).toHaveLength(64);
		expect(store.resolveSession(token)?.id).toBe(profile.id);
	});

	it('rejects a duplicate name regardless of case', () => {
		store.createProfile('Driver', '1111');
		expect(() => store.createProfile('driver', '2222')).toThrow(/taken/i);
	});

	it('rejects a PIN that is not four digits', () => {
		expect(() => store.createProfile('Kid', '12')).toThrow(/4 digits/i);
		expect(() => store.createProfile('Kid', 'abcd')).toThrow(/4 digits/i);
	});

	it('rejects a name that is too short or too long', () => {
		expect(() => store.createProfile('A', '1234')).toThrow(/2-24/);
		expect(() => store.createProfile('x'.repeat(25), '1234')).toThrow(/2-24/);
	});

	it('logs in with the right PIN and refuses the wrong one', () => {
		store.createProfile('Maya', '4321');

		expect(store.login('maya', '4321').profile.name).toBe('Maya');
		expect(() => store.login('Maya', '0000')).toThrow(/Wrong details/);
	});

	it('gives the same message for an unknown name as for a wrong PIN', () => {
		store.createProfile('Known', '1234');

		let unknownMsg = '';
		let wrongPinMsg = '';
		try { store.login('Nobody', '1234'); } catch (e) { unknownMsg = (e as Error).message; }
		try { store.login('Known', '9999'); } catch (e) { wrongPinMsg = (e as Error).message; }

		expect(unknownMsg).toBe(wrongPinMsg);
	});

	it('locks a profile after five wrong PINs and says so', () => {
		store.createProfile('Locked', '1234');

		for (let i = 0; i < 4; i++) {
			expect(() => store.login('Locked', '0000')).toThrow(/Wrong details/);
		}
		expect(() => store.login('Locked', '0000')).toThrow(/locked for 5 minutes/i);
		// Even the CORRECT pin is refused while locked.
		expect(() => store.login('Locked', '1234')).toThrow(/locked/i);
	});

	it('clears the failure count after a successful login', () => {
		store.createProfile('Resilient', '1234');
		for (let i = 0; i < 3; i++) {
			expect(() => store.login('Resilient', '0000')).toThrow();
		}
		expect(store.login('Resilient', '1234').profile.name).toBe('Resilient');

		// A fresh run of failures is needed to lock again.
		for (let i = 0; i < 4; i++) {
			expect(() => store.login('Resilient', '0000')).toThrow(/Wrong details/);
		}
	});

	it('lists profiles for the "who is driving" row', () => {
		store.createProfile('Zoe', '1111');
		store.createProfile('Adam', '2222');

		expect(store.listProfiles().map(p => p.name)).toEqual(['Adam', 'Zoe']);
	});

	it('forgets a session after logout', () => {
		const {token} = store.createProfile('Bye', '1234');
		store.logout(token);
		expect(store.resolveSession(token)).toBeNull();
	});

	it('treats a bogus token as signed out', () => {
		expect(store.resolveSession('not-a-token')).toBeNull();
		expect(store.resolveSession(undefined)).toBeNull();
	});
});

describe('ProfileStore — email and password', () => {
	let store: ProfileStore;
	let dir: string;

	beforeEach(() => { ({store, dir} = freshStore()); });
	afterEach(() => { store.close(); fs.rmSync(dir, {recursive: true, force: true}); });

	it('creates an account with an email and a password', () => {
		const {profile} = store.createProfile('Yossi', 'trainsAreGreat', 'yossi@example.com');

		expect(profile.email).toBe('yossi@example.com');
		expect(store.login('yossi@example.com', 'trainsAreGreat').profile.id).toBe(profile.id);
	});

	it('signs in by display name too', () => {
		store.createProfile('Yossi', 'trainsAreGreat', 'yossi@example.com');

		expect(store.login('Yossi', 'trainsAreGreat').profile.name).toBe('Yossi');
	});

	it('is case-insensitive about the email', () => {
		store.createProfile('Case', 'longenoughpw', 'Mixed.Case@Example.COM');

		expect(store.login('mixed.case@example.com', 'longenoughpw').profile.name).toBe('Case');
	});

	it('refuses a second account on the same email', () => {
		store.createProfile('First', 'longenoughpw', 'shared@example.com');

		expect(() => store.createProfile('Second', 'longenoughpw', 'SHARED@example.com'))
			.toThrow(/already an account/i);
	});

	it('refuses a password shorter than the minimum', () => {
		expect(() => store.createProfile('Short', 'abc', 'short@example.com'))
			.toThrow(new RegExp(`at least ${MIN_PASSWORD_LENGTH}`));
	});

	it('refuses an address that is obviously not an email', () => {
		for (const bad of ['nope', 'no@dot', '@example.com', 'two@@example.com', 'has space@example.com']) {
			expect(() => store.createProfile('X' + bad.length, 'longenoughpw', bad)).toThrow(/does not look right/i);
		}
		expect(isPlausibleEmail('fine@example.co.uk')).toBe(true);
	});

	it('still accepts the name + PIN path with no email', () => {
		const {profile} = store.createProfile('KidOnIpad', '4321');

		expect(profile.email).toBeNull();
		expect(store.login('KidOnIpad', '4321').profile.id).toBe(profile.id);
	});

	it('gives the same answer for an unknown email as for a wrong password', () => {
		store.createProfile('Known', 'longenoughpw', 'known@example.com');

		let unknown = '', wrong = '';
		try { store.login('nobody@example.com', 'longenoughpw'); } catch (e) { unknown = (e as Error).message; }
		try { store.login('known@example.com', 'wrongpassword'); } catch (e) { wrong = (e as Error).message; }

		expect(unknown).toBe(wrong);
	});

	it('locks the account after five wrong passwords', () => {
		store.createProfile('Locked', 'longenoughpw', 'locked@example.com');
		for (let i = 0; i < 4; i++) {
			expect(() => store.login('locked@example.com', 'nope-nope')).toThrow(/Wrong details/);
		}
		expect(() => store.login('locked@example.com', 'nope-nope')).toThrow(/locked for 5 minutes/i);
		expect(() => store.login('locked@example.com', 'longenoughpw')).toThrow(/locked/i);
	});

	it('keeps the email on the session profile', () => {
		const {token} = store.createProfile('Sessioned', 'longenoughpw', 'sess@example.com');

		expect(store.resolveSession(token)?.email).toBe('sess@example.com');
	});
});

describe('ProfileStore — scores', () => {
	let store: ProfileStore;
	let dir: string;
	let profileId: number;

	beforeEach(() => {
		({store, dir} = freshStore());
		profileId = store.createProfile('Racer', '1234').profile.id;
	});

	afterEach(() => {
		store.close();
		fs.rmSync(dir, {recursive: true, force: true});
	});

	it('records the first score as a personal best', () => {
		const r = store.submitScore(profileId, 'map1', 'lineA', 'run-score', 820);

		expect(r.isPersonalBest).toBe(true);
		expect(r.previousBest).toBeNull();
		expect(r.best).toBe(820);
	});

	it('keeps the higher value for higher-is-better kinds', () => {
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 820);
		const worse = store.submitScore(profileId, 'map1', 'lineA', 'run-score', 500);
		const better = store.submitScore(profileId, 'map1', 'lineA', 'run-score', 910);

		expect(worse.isPersonalBest).toBe(false);
		expect(worse.best).toBe(820);
		expect(better.isPersonalBest).toBe(true);
		expect(better.best).toBe(910);
	});

	it('keeps the LOWER value for kinds where less is better', () => {
		expect(isHigherBetter('stop-error')).toBe(false);

		store.submitScore(profileId, 'map1', 'lineA', 'stop-error', 3.2);
		const worse = store.submitScore(profileId, 'map1', 'lineA', 'stop-error', 9.0);
		const better = store.submitScore(profileId, 'map1', 'lineA', 'stop-error', 0.4);

		expect(worse.isPersonalBest).toBe(false);
		expect(better.isPersonalBest).toBe(true);
		expect(better.best).toBe(0.4);
	});

	it('keeps bests separate per map, line and kind', () => {
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 900);
		const otherLine = store.submitScore(profileId, 'map1', 'lineB', 'run-score', 100);
		const otherMap = store.submitScore(profileId, 'map2', 'lineA', 'run-score', 100);
		const otherKind = store.submitScore(profileId, 'map1', 'lineA', 'punctuality', 100);

		expect(otherLine.isPersonalBest).toBe(true);
		expect(otherMap.isPersonalBest).toBe(true);
		expect(otherKind.isPersonalBest).toBe(true);
	});

	it('orders the board best-first across profiles', () => {
		const second = store.createProfile('Rival', '4321').profile.id;
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 700);
		store.submitScore(second, 'map1', 'lineA', 'run-score', 950);

		const board = store.getBoard('map1', 'lineA', 'run-score');

		expect(board.map(b => b.profileName)).toEqual(['Rival', 'Racer']);
		expect(board[0].value).toBe(950);
	});

	it('shows one row per profile on the board — their best, not every run', () => {
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 300);
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 800);
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 500);

		const board = store.getBoard('map1', 'lineA', 'run-score');

		expect(board).toHaveLength(1);
		expect(board[0].value).toBe(800);
	});

	it('orders a lower-is-better board the other way round', () => {
		const second = store.createProfile('Precise', '4321').profile.id;
		store.submitScore(profileId, 'map1', 'lineA', 'stop-error', 4.0);
		store.submitScore(second, 'map1', 'lineA', 'stop-error', 0.2);

		expect(store.getBoard('map1', 'lineA', 'stop-error').map(b => b.profileName))
			.toEqual(['Precise', 'Racer']);
	});

	it('caps history but never deletes the standing best', () => {
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 10_000); // the best
		for (let i = 0; i < 60; i++) {
			store.submitScore(profileId, 'map1', 'lineA', 'run-score', i);
		}

		const board = store.getBoard('map1', 'lineA', 'run-score');
		expect(board[0].value).toBe(10_000);
	});

	it('round-trips the detail payload', () => {
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 640, {stops: 7, perfect: 3});

		expect(store.getBoard('map1', 'lineA', 'run-score')[0].detail).toEqual({stops: 7, perfect: 3});
	});

	it('refuses a non-numeric score instead of storing NaN', () => {
		expect(() => store.submitScore(profileId, 'map1', 'lineA', 'run-score', Number.NaN)).toThrow();
	});
});

describe('ProfileStore — saved data', () => {
	let store: ProfileStore;
	let dir: string;
	let profileId: number;

	beforeEach(() => {
		({store, dir} = freshStore());
		profileId = store.createProfile('Saver', '1234').profile.id;
	});

	afterEach(() => {
		store.close();
		fs.rmSync(dir, {recursive: true, force: true});
	});

	it('stores and returns a value', () => {
		store.setData(profileId, 'setup', {trainSlots: ['a', 'b'], crowdLevel: 'busy'});

		expect(store.getData(profileId, 'setup')).toEqual({trainSlots: ['a', 'b'], crowdLevel: 'busy'});
	});

	it('overwrites on the second write instead of duplicating', () => {
		store.setData(profileId, 'badges', ['first-run']);
		store.setData(profileId, 'badges', ['first-run', 'perfect-stop']);

		expect(store.getData(profileId, 'badges')).toEqual(['first-run', 'perfect-stop']);
		expect(store.listDataKeys(profileId)).toEqual(['badges']);
	});

	it('returns null for a key that was never written', () => {
		expect(store.getData(profileId, 'nothing-here')).toBeNull();
	});

	it('keeps profiles separate', () => {
		const other = store.createProfile('Other', '4321').profile.id;
		store.setData(profileId, 'setup', {a: 1});

		expect(store.getData(other, 'setup')).toBeNull();
	});

	it('deletes everything belonging to a removed profile', () => {
		store.setData(profileId, 'setup', {a: 1});
		store.submitScore(profileId, 'map1', 'lineA', 'run-score', 100);
		store.deleteProfile(profileId);

		expect(store.listProfiles()).toHaveLength(0);
		expect(store.getBoard('map1', 'lineA', 'run-score')).toHaveLength(0);
	});
});

describe('ProfileStore — persistence', () => {
	it('survives a process restart (the whole point of the volume)', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrorider-persist-'));

		const first = new ProfileStore(dir);
		const {profile} = first.createProfile('Persistent', '1234');
		first.submitScore(profile.id, 'map1', 'lineA', 'run-score', 777);
		first.close();

		const second = new ProfileStore(dir);
		expect(second.listProfiles().map(p => p.name)).toEqual(['Persistent']);
		expect(second.getBoard('map1', 'lineA', 'run-score')[0].value).toBe(777);
		// And the PIN still works after the restart.
		expect(second.login('Persistent', '1234').profile.name).toBe('Persistent');
		second.close();

		fs.rmSync(dir, {recursive: true, force: true});
	});
});
