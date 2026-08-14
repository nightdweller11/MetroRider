# MetroRider Deployment

## Where it runs

- **Platform**: Railway — project `MetroRider`, service `MetroRider`, environment `production`.
- **Live URL**: https://metrorider-production.up.railway.app
- **Build**: Nixpacks per `railway.json` (`npm run build:all`), start command `npm start`
  (root `package.json`: runs `seed-data.js`, then `server/dist/index.js`).
- The service deploys from the GitHub repo `nightdweller11/MetroRider` (branch `main`).

## Railway access

A **project token** for the MetroRider Railway project is stored in the git-ignored
`streets-gl/.env` as `RAILWAY_TOKEN` (added 2026-08-11). Use it with the Railway CLI
or GraphQL API:

```bash
cd streets-gl
export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env | cut -d= -f2)
railway status          # project/environment info
railway up --detach     # deploy the current directory
```

For logs/metrics, query the GraphQL API at `https://backboard.railway.app/graphql/v2`
with header `Project-Access-Token: $RAILWAY_TOKEN` (the CLI's `railway logs` needs a
service link; the API always works with the project token).

Note: a separate project token for the `sing.events` Railway project lives in
`~/Projects/live-karaoke/.env` — it does **not** grant access to MetroRider.

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
