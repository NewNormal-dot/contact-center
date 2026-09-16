# Deployment notes

Read this before changing anything about how this app is built, packaged or
deployed — and **always** before adding an npm dependency.

## The short version

**This app cannot currently take on a new runtime npm dependency.** Adding one
passes CI, deploys "successfully", and then takes the site down with a 503.
This happened on 2026-09-16 and the site was down for roughly two hours.

If you need a new package, fix the underlying problem first (see
[Fixing it properly](#fixing-it-properly)). Do not just add it and hope.

## How the app is deployed

`.github/workflows/main_contact-center-app.yml` runs on every push to `main`:

1. `npm ci`, `tsc --noEmit`, `vite build`
2. `npm prune --omit=dev`
3. Zip up `package.json`, `server.ts`, `knexfile*`, `dist/`, `src/` **and
   `node_modules/`** into `release.zip`
4. Deploy that zip to the `contact-center-app` App Service (Linux, Basic B1)

Step 3 ships a complete, correct `node_modules`. Step 4 is where it goes wrong.

## Why a new dependency breaks the site

On startup the container runs a script Oryx generates, which does roughly this:

```sh
cd /home/site/wwwroot
echo Found tar.gz based node_modules.
rm -fr /node_modules
mkdir -p /node_modules
tar -xzf node_modules.tar.gz -C /node_modules   # NOT the zip's node_modules
if [ -d node_modules ]; then
    mv -f node_modules _del_node_modules || true   # <-- this FAILS
fi
ln -sfn /node_modules ./node_modules               # <-- so this misfires
```

Two things go wrong:

1. The instance runs in "compressed node_modules" mode (there is an
   `oryx-manifest.toml` and a ~123 MB `node_modules.tar.gz` in `wwwroot`). It
   therefore **ignores the `node_modules` directory the workflow ships**.
2. `wwwroot/node_modules` is a real directory that the startup script cannot
   move aside (`mv` fails with *Permission denied*). Because it is still a real
   directory, `ln -sfn /node_modules ./node_modules` does not replace it — it
   creates a stray `wwwroot/node_modules/node_modules -> /node_modules` symlink
   *inside* it.

So Node resolves packages from `wwwroot/node_modules`, and as observed on
2026-09-16 every package in there was dated **2026-06-07**. That directory has
been frozen since then. Nobody noticed, because no dependency changed in
between — every deploy since June has quietly been running June's packages.

The moment `compression` was added, `package.json` listed it, `release.zip`
contained it, and the runtime still could not find it:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'compression'
imported from /home/site/wwwroot/server.ts
```

The process exited immediately, so every request returned 503 — while the
GitHub Actions run showed a green "Successfully deployed web package".

### What we know, and what we do not

Confirmed by inspecting the running container over SSH:

- `wwwroot/node_modules` is a real directory, contents dated 2026-06-07
- it contains the stray `node_modules -> /node_modules` symlink
- `node_modules.tar.gz` and `oryx-manifest.toml` are rewritten on each deploy
- **`/node_modules` was empty** at the time of inspection, even though the app
  was running

That last point matters: the obvious fix — delete `wwwroot/node_modules` so the
symlink to `/node_modules` takes effect — would have left the app with **no
modules at all**. Do not do it without checking `/node_modules` first.

## Fixing it properly

Not yet done. Any of these could work; none has been verified, and the app runs
on Basic tier, which has **no deployment slot**, so there is nowhere to test but
production. Pick a quiet window and have a rollback ready.

1. **Turn off the Oryx build on deploy** — set `SCM_DO_BUILD_DURING_DEPLOYMENT=false`
   so the zip's `node_modules` is used verbatim and no tarball is produced.
   Probably the cleanest fix.
2. **Clear the stale state** — remove `wwwroot/node_modules`,
   `wwwroot/node_modules.tar.gz`, `wwwroot/oryx-manifest.toml` and
   `wwwroot/_del_node_modules`, then redeploy. Verify `/node_modules` is
   populated *before* removing `wwwroot/node_modules`.
3. **Set an explicit startup command** so the generated script is bypassed.

Whichever you choose, prove it worked by adding one small dependency
(`compression` is the obvious candidate — it buys roughly a 3x reduction on the
~2 MB JS bundle and on the schedule JSON) and confirming `/api/health` still
answers after the deploy.

## Guardrails now in place

- **The workflow fails if the app does not come back up.** After deploying it
  polls `/api/health` for up to five minutes. A deploy that kills the process is
  now a red run within minutes, not a silent outage someone reports hours later.
- **The workflow warns loudly when `dependencies` change**, pointing here.

Neither guardrail prevents the breakage — they only make it immediate and
obvious. The fix above is what actually removes the trap.

## Database migrations

`SKIP_DB_MIGRATIONS=true` is set on the App Service, so **migrations do not run
on deploy**. After deploying a migration, apply it manually as a superadmin:

```js
// browser console, logged in as superadmin
fetch('/api/admin/run-migrations', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
}).then(r => r.json()).then(console.log)
```

Check what is outstanding first with `GET /api/admin/migration-status`, and read
recent server-side errors with `GET /api/admin/recent-errors`.

## Capacity

Normal load is 1-10 concurrent users; during a booking window it is ~200. The
application-side work for that burst is done (see the commit
"perf: survive the booking rush"). If a future booking window is still slow, the
infrastructure can be scaled up temporarily and back down afterwards — both
changes bill hourly and cost well under a dollar for a few hours:

```bash
# before the rush
az sql db update -g cc-web -s contact-center-sql -n contact-center-db --service-objective S2
# App Service -> Scale out -> instance count 3   (scaling OUT does not restart the app; scaling UP does)

# afterwards
az sql db update -g cc-web -s contact-center-sql -n contact-center-db --service-objective S0
# instance count back to 1
```
