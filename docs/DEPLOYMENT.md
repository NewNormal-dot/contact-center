# Deployment notes

Read this before changing anything about how this app is built, packaged or
deployed — and **always** before adding an npm dependency.

## The short version

Adding an npm dependency used to pass CI, deploy "successfully", and then take
the site down with a 503 — because the instance ignored the `node_modules` this
workflow ships and ran a copy frozen at 2026-06-07. That happened on
2026-09-16; the site was down for roughly two hours.

[The fix](#the-fix) pushes the packages we build straight into the directory
the app reads. Before adding a dependency, check that a deploy has gone green
since: the workflow warns on any `dependencies` change and fails outright if
the app does not come back up.

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

## Two things that did NOT work

Recorded because they look obviously right and both cost a deploy to disprove.
Basic tier has **no deployment slot**, so every attempt is tested in production.

**`SCM_DO_BUILD_DURING_DEPLOYMENT=false`** — it was *already* `false`. That
setting governs building from source; it does not stop Oryx packing
`node_modules` into a tarball.

**Deleting `oryx-manifest.toml` and `node_modules.tar.gz` before the deploy** —
both were deleted successfully (Kudu returned HTTP 200), and the deploy
recreated both about three minutes later:

```
08:04:14  DELETE oryx-manifest.toml   -> HTTP 200
08:04:14  DELETE node_modules.tar.gz  -> HTTP 200
08:04:14  deploy starts
08:07:49  deploy ends
          -rwxrwxrwx 122973394 2026-09-16 08:07 node_modules.tar.gz   <- back
          -rwxrwxrwx        48 2026-09-16 08:07 oryx-manifest.toml    <- back
          drwxrwxrwx         0 2026-09-16 06:30 node_modules          <- untouched
```

Neither attempt harmed the app — both were shaped so that the worst case was
"nothing changes" — but neither fixed it either.

## The fix

Stop fighting the platform for control of `node_modules`, and write the correct
packages straight into the directory the app actually reads.

The build job zips the pruned `node_modules` separately. After the deploy, the
deploy job pushes that zip into `wwwroot/node_modules` over Kudu's zip API
(`PUT /api/zip/site/wwwroot/node_modules/`) and restarts the app so Node picks
the packages up.

The ordering matters: it runs **after** the deploy, because the deploy is what
re-freezes things, and **before** the health check, so a mistake here still
turns the run red.

This shape was chosen over the alternatives because of its failure mode. It
only adds and overwrites files in a directory the app already uses, so when it
fails, nothing changes — the app keeps running exactly as it did. That is what
ruled out the tempting alternative of deleting `wwwroot/node_modules` so the
platform's own symlink could take over: `/node_modules` was observed **empty**
on a running instance, so that path can leave the app with no modules at all.

The step is `continue-on-error: true` for the same reason: it must never be why
a deploy fails.

### Cost

The upload is ~137 MB and adds a few minutes to each deploy. A worthwhile
future improvement: write a marker file holding a hash of `package-lock.json`
next to `node_modules` and skip the upload when it still matches, so only
deploys that actually change dependencies pay the cost.

### Still untried, if this ever stops being enough

- **An explicit startup command**, bypassing the generated script.
- **`az webapp deploy --clean true`**, which empties `wwwroot` before
  extracting. Safe here only because the app writes nothing to disk — no
  uploads, no logs, no SQLite in production (verified: no `multer` disk storage
  and no `writeFileSync`/`createWriteStream` anywhere in `src/`).
- **Removing `wwwroot/_del_node_modules`.** The startup script fails at
  `mv -f node_modules _del_node_modules` precisely because that directory
  already exists (empty, dated 2026-06-06), so the move becomes "into" it
  rather than a rename. Delete it and the platform's own swap would likely
  work. Carries the `/node_modules`-is-empty risk above; recovery is
  `mkdir /home/site/wwwroot/_del_node_modules` over SSH plus a restart.

## Verifying it worked

Over SSH (Kudu → **SSH — Application**, not *SSH — Kudu*; the Kudu container
shares `/home` but not `/node_modules`, which is why `/node_modules` looks
empty there):

```bash
ls -la --time-style=long-iso /home/site/wwwroot/ | grep -E 'node_modules|oryx'
ls /home/site/wwwroot/node_modules | wc -l
```

`node_modules` should carry **today's** date, not 2026-06-07.

## Guardrails now in place

- **The workflow fails if the app does not come back up.** After deploying it
  polls `/api/health` for up to five minutes. A deploy that kills the process is
  now a red run within minutes, not a silent outage someone reports hours later.
- **The workflow warns loudly when `dependencies` change**, pointing here.

Neither guardrail prevents the breakage — they make it immediate and obvious.
[The fix](#the-fix) is what removes the trap; the guardrails are what catch the
next surprise nobody predicted.

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
