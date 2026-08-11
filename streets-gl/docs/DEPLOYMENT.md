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

## ⚠️ Data persistence — read before deploying

**The Railway service has NO persistent volume.** `DATA_DIR` lives on the container's
ephemeral disk, so **everything uploaded or saved on the live site since the last
deploy is wiped by the next deploy or restart**: Sketchfab/Freesound imports, direct
uploads, admin "server default" config — all of it.

On boot, `seed-data.js` copies `data-seed/` → `DATA_DIR` (only files that don't
already exist), so the repo's `data-seed/` is the only durable copy of the live data.

**Before every deploy, sync the live state back into the repo:**

```bash
cd streets-gl
node scripts/sync-live-data.mjs   # pulls live catalog.json, config.json and any missing asset files into data-seed/
git add data-seed && git commit -m "Sync live server data"
```

The long-term fix is attaching a Railway volume mounted at the data dir and pointing
`DATA_DIR` at it — until then, the sync script is mandatory pre-deploy hygiene.

## Server env vars (Railway → Variables)

| Var | Purpose |
|---|---|
| `ADMIN_TOKEN` | Admin token for uploads/config/deletes (also printed to boot logs if unset — ephemeral) |
| `DATA_DIR` | Asset/config directory (ephemeral without a volume) |
| `SKETCHFAB_API_TOKEN` | Sketchfab model search/import |
| `FREESOUND_API_KEY` | Freesound sound search/import |
| `PORT` | Set by Railway automatically |
