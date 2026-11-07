# MetroRider Deployment

## Where it runs

- **Platform**: Railway — project `MetroRider`, service `MetroRider`, environment `production`.
- **Live URL**: https://metrorider-production.up.railway.app
- **Build**: Nixpacks per `railway.json` (`npm run build:all`), start command `npm start`
  (root `package.json`: runs `seed-data.js`, then `server/dist/index.js`).
- The service deploys from the GitHub repo `nightdweller11/MetroRider` (branch `main`).

## How a deploy happens

**Pushing to `main` on GitHub deploys.** The Railway service is sourced from the
repo `nightdweller11/MetroRider` through Railway's GitHub integration (not GitHub
Actions — the workflows under `.github/` are upstream streets-gl leftovers and run
nothing here). A push builds and replaces the container in about 3–4 minutes.
Verified 2026-11-07 with 2.48.0 and 2.49.0.

After the deploy reaches `SUCCESS`, validate on the live URL by playing, as every
release has been.

### Caching (2.49.0)

The page and the unhashed stylesheet are served `no-cache` (an ETag revalidation,
a 304 when unchanged), content-hashed scripts `immutable` for a year, everything
else an hour — `server/utils/cachePolicy.ts`. Before 2.49.0 the page itself was
cached for an hour, so a player who had the game open before a deploy kept the
old build for up to an hour after it.

## Railway access

The project token that used to live in the git-ignored `streets-gl/.env` as
`RAILWAY_TOKEN` (added 2026-08-11) **no longer works**: every pre-existing project
token was deleted in the 2026-10-22 rotation after Railway's security incident
("Project Token not found"). To watch deploys or read logs, use an account or
workspace token as `Authorization: Bearer <token>` on
`https://backboard.railway.com/graphql/v2`, or create a new project token in the
Railway dashboard (Project → Settings → Tokens) and put it back in `.env`.

IDs: project `4df0ce74-1fb6-4206-99c3-01097b803420`, service `MetroRider`
`edf43f50-f308-44a2-97c1-06ba1b9b1161`, environment `production`
`fcb1d9f4-beec-4e70-83ed-49b7f93af015`.

## Data persistence — VOLUME ATTACHED AND VERIFIED (2026-08-14)

> **This section said "the service has NO persistent volume" long after that
> stopped being true.** It is corrected here because the stale warning was still
> being acted on: sessions were treating every deploy as data-destroying and
> telling the operator that attaching a volume was outstanding work.

**A Railway volume IS attached and IS in use:**

| | |
|---|---|
| Volume | `metrorider-volume` (id `5c1864b6-…`), state `READY` |
| Mount path | `/data` |
| `DATA_DIR` | `/data` — set in the service variables, so the server and `seed-data.js` both use it |
| Size | 50 GB allocated, ~1.1 GB used |

`DATA_DIR` holds both the uploaded assets and `metrorider.db`, the SQLite file
with every player profile and saved best run. Both now survive deploys.

**Verified end-to-end on 2026-08-14** (the check this doc had been asking for):

1. Created profile `PersistCheck185052` on the live site and posted a score.
2. Forced a redeploy through the Railway API (`serviceInstanceRedeploy`).
3. **Waited for the new deployment to reach `SUCCESS` and the old one `REMOVED`** —
   the first attempt "passed" after 20 s while the new deployment was still
   `BUILDING`, i.e. it was still talking to the old container and proved nothing.
4. Against the genuinely new container: the profile signs in with the same `id`
   and the same `createdAt` (1786722652554), and the score is still on the board
   with its original `createdAt`. Same rows, not recreated.

A leftover test profile `PersistCheck185052` and a score on the fake `mapId`
`persist-check` remain in the live DB. They are inert — that map id appears on no
real board — but delete them if a profile-delete route is ever added.

### `seed-data.js` and the volume

On boot, `seed-data.js` copies `data-seed/` → `DATA_DIR`, **skipping files that
already exist**. That is what makes the volume safe: an empty volume is filled on
first boot, and afterwards live edits are never overwritten by the seed copies.

`scripts/sync-live-data.mjs` is therefore no longer mandatory pre-deploy hygiene.
It is still useful for pulling live-authored content back into the repo so a
*fresh* environment seeds with it:

```bash
cd streets-gl
node scripts/sync-live-data.mjs
git add data-seed && git commit -m "Sync live server data"
```

## Server env vars (Railway → Variables)

| Var | Purpose |
|---|---|
| `ADMIN_TOKEN` | Admin token for uploads/config/deletes (also printed to boot logs if unset) |
| `DATA_DIR` | Asset/config/database directory. Set to `/data`, the mounted volume — persistent |
| `SKETCHFAB_API_TOKEN` | Sketchfab model search/import |
| `FREESOUND_API_KEY` | Freesound sound search/import |
| `PORT` | Set by Railway automatically |
