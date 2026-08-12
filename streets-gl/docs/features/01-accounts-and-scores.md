# F1 — Player Profiles & Score Persistence

> STATUS: SHIPPED (server + client, v1.1.7) — except the Railway volume, which
> is a deploy-time action and is now flagged in `docs/DEPLOYMENT.md`.
> Foundation feature — most scoring features depend on it.
> Scope guard: NO XP, NO ranks, NO progression gating. Scores and records only.

## 1. Product definition

Players get a lightweight identity so their scores, badges, records and
preferences survive across devices and browser-storage wipes (iOS deletes
localStorage after ~7 days of not visiting — the #1 cause of "my stuff is gone").

- **Profiles, not "accounts".** Kid-friendly: pick a display name + a 4-digit
  PIN. No email, no password rules, no verification. A family typically has
  2–5 profiles.
- **Login UI** on the start screen: a small "Who's driving?" row showing
  existing profiles on this device (one tap to switch, PIN asked once per
  device), plus "New driver". Current profile name shows in the HUD corner.
- **What gets saved server-side per profile**: best scores per (map, line)
  — see F2 — badges earned, discovered landmarks (F10), and a copy of the
  player's settings/train consist (restore on new device: "Use my saved
  setup?").
- **Score boards** (allowed; this is not multiplayer): per-map/per-line "best
  runs" table showing all profiles on this server — family rivalry. No
  real-time interaction of any kind.
- **Guest mode** stays: everything works without a profile; scores just don't
  persist beyond localStorage, and boards show "Guest" entries only locally.

## 2. Technical implementation plan

### Storage (prerequisite: Railway volume)
- **Attach a Railway volume** mounted at `/data` and set `DATA_DIR=/data`
  (removes the "deploys wipe uploads" landmine documented in
  `docs/DEPLOYMENT.md` at the same time). Migration: run
  `scripts/sync-live-data.mjs`, deploy with the volume, seed once.
- **SQLite** (`better-sqlite3`) at `DATA_DIR/metrorider.db`. Tables:
  - `profiles(id, name UNIQUE COLLATE NOCASE, pin_hash, created_at)`
  - `sessions(token, profile_id, created_at, last_seen_at)`
  - `scores(id, profile_id, map_id, line_id, kind, value, detail_json, created_at)`
    — `kind` ∈ `run-score | best-stop | punctuality | …` (open enum, F2/F4 fill it)
  - `profile_data(profile_id, key, value_json, updated_at)` — badges,
    landmarks, saved setup (key-value keeps schema churn out of migrations).
- `map_id` = MetroDreamin system id (or `'sample-tel-aviv'`), `line_id` = the
  line id within the map.

### Server (`server/routes/profiles.ts`)
- `POST /api/profiles` `{name, pin}` → creates profile (name unique,
  pin bcrypt-hashed), returns `{token, profile}`.
- `POST /api/profiles/login` `{name, pin}` → `{token, profile}`.
- `GET /api/me` (Bearer token) → profile + saved data keys.
- `PUT /api/me/data/:key` / `GET /api/me/data/:key` — profile_data KV.
- `POST /api/scores` (Bearer) `{mapId, lineId, kind, value, detail}` —
  server keeps only personal-best per (profile,map,line,kind) + a rolling
  last-20 history.
- `GET /api/scores?mapId=&lineId=&kind=` → top N across profiles (the board).
- Rate limiting: reuse the pattern from the URI guard; 30 req/min/IP on
  profile endpoints. PINs are low-entropy → lock a profile name for 5 min
  after 5 failed logins.
- No PII, no email — state this in code comments; keep the DB out of logs.

### Client
- `src/app/game/profiles/ProfileClient.ts` — thin fetch wrapper + token in
  localStorage (`metrorider-profile-token`); degrade gracefully offline
  (queue score posts, flush on reconnect; queue in localStorage).
- `src/app/game/profiles/ProfileUI.ts` — the "Who's driving?" row on the
  start card (GameUISystem start screen), profile create/login modal in the
  splash visual style, HUD name chip.
- Settings/consist backup: on save (existing localStorage writes), also
  `PUT /api/me/data/setup` debounced 5 s when logged in; on login on a fresh
  device, offer restore.

### Sizing
Volume + DB + endpoints: 1–2 days. Client UI: 1–2 days.

## 3. Testing plan & validation

- **Unit (jest, server)**: profile create/login/PIN-lockout; personal-best
  upsert semantics (higher-is-better per kind); board query ordering; KV
  round-trip. Run against a temp SQLite file.
- **Browser (Playwright, local)**: create profile → drive → post score →
  reload with cleared localStorage → login → score present; second profile →
  board shows both; guest mode unaffected.
- **Production validation**: after volume+deploy, create a test profile on
  the live site, post a score, redeploy, verify profile+score survive
  (proves the volume actually persists), then delete the test profile.
- **Data safety check**: deploy pipeline docs updated — with the volume,
  `sync-live-data.mjs` becomes optional (keep as backup tooling).


---

## 4. What actually shipped (2026-08-12)

- `server/store/ProfileStore.ts` — SQLite (`better-sqlite3`) at
  `DATA_DIR/metrorider.db`: profiles, sessions, scores (personal-best flag +
  rolling 20-run history per key), profile_data KV. scrypt-hashed 4-digit PINs
  with a 5-attempt / 5-minute lockout; identical error text for "no such
  profile" and "wrong PIN" so the endpoint cannot enumerate players.
- `server/routes/profiles.ts` — create / login / logout / me / data KV /
  score submit / public board, 30 req/min/IP limiter.
- `src/app/game/profiles/ProfileClient.ts` — token in localStorage, **offline
  score queue** (a run earned signed-out or offline is flushed on the next
  sign-in), setup backup/restore.
- `src/app/game/profiles/ProfileUI.ts` — "Who's driving?" row on the start
  card, one-tap chips for drivers already on this server, sign-in / new-driver
  modal, HUD name chip.
- **27 unit tests** (`src/__tests__/profileStore.test.ts`) over a temp DB,
  including "survives a process restart", which is the exact property the
  Railway volume has to provide.

### Validation

HTTP smoke test (create → score → board → list) and a Playwright walkthrough:
modal renders with existing drivers, correct PIN signs in (HUD chip appears,
token persisted), wrong PIN says "Wrong name or PIN", no console errors.
Screenshots: `docs/_artifacts/profiles-2026-08-12/`.

### Not done

- The Railway volume itself (deploy action, needs the operator).
- Score boards in the UI — they arrive with F2, which is what produces
  `run-score` values in the first place.
