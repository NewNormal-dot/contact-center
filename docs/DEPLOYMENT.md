# Deployment notes

Read this before changing anything about how this app is built, packaged or
deployed — and **always** before adding an npm dependency.

## The short version

**This app cannot currently take on a new runtime npm dependency.** Adding one
passes CI, deploys "successfully", and then takes the site down with a 503,
because the instance ignores the `node_modules` this workflow ships and runs a
copy frozen at 2026-06-07. That happened on 2026-09-16; the site was down for
roughly two hours.

Three fixes have been attempted and none worked — see
[Three things that did NOT work](#three-things-that-did-not-work) before trying
a fourth. [The remaining candidate](#the-remaining-candidate) needs one
read-only SSH check first.

Two guardrails are in place so this can no longer be silent: the workflow warns
on any `dependencies` change, and fails the run if the app does not answer
`/api/health` after a deploy.

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

## Three things that did NOT work

**This is still unfixed.** All three attempts are recorded because each looks
obviously right, and each cost a production deploy to disprove — Basic tier has
**no deployment slot**, so there is nowhere else to test. Every one was shaped
so its worst case was "nothing changes", and that held: none of them caused an
outage. None of them fixed anything either.

**1. `SCM_DO_BUILD_DURING_DEPLOYMENT=false`** — it was *already* `false`. That
setting governs building from source; it does not stop Oryx packing
`node_modules` into a tarball.

**2. Deleting `oryx-manifest.toml` and `node_modules.tar.gz` before the
deploy** — both deleted cleanly, and the deploy recreated both three minutes
later while `node_modules` itself was never touched:

```
08:04:14  DELETE oryx-manifest.toml   -> HTTP 200
08:04:14  DELETE node_modules.tar.gz  -> HTTP 200
08:04:14  deploy starts
08:07:49  deploy ends
          -rwxrwxrwx 122973394 2026-09-16 08:07 node_modules.tar.gz   <- back
          -rwxrwxrwx        48 2026-09-16 08:07 oryx-manifest.toml    <- back
          drwxrwxrwx         0 2026-09-16 06:30 node_modules          <- untouched
```

**3. Pushing `node_modules` straight into `wwwroot` over Kudu's zip API** —
zipping the pruned `node_modules` (461 packages, 137 MB) and
`PUT /api/zip/site/wwwroot/node_modules/`. Kudu accepted the upload for three
minutes and then answered **HTTP 400 with an empty body**, so there is no
reason to go on. Removed again: it added three wasted minutes and a spurious
warning to every deploy.

## The remaining candidate

Removing **`wwwroot/_del_node_modules`**.

The startup script's swap fails at exactly one line:

```
mv: cannot move 'node_modules' to '_del_node_modules/node_modules': Permission denied
```

It fails *because `_del_node_modules` already exists* — an empty directory
dated 2026-06-06. With a destination directory present, `mv` means "move
into it" rather than "rename to it". Remove it and `mv` becomes a plain rename,
which should succeed; `ln -sfn /node_modules ./node_modules` then lands
correctly and the app picks up the freshly extracted tarball, which **is**
current (123 MB, rewritten on every deploy).

### Why it has not been done

`/node_modules` was observed **empty** on a running instance. If it is empty at
the moment the swap succeeds, the app is left with no modules at all.

One read-only command over SSH settles it (Kudu → **SSH — Application**):

```bash
ls /node_modules | wc -l
```

- **~460** → `/node_modules` is populated; removing `_del_node_modules` is safe:
  `rm -rf /home/site/wwwroot/_del_node_modules`, then restart from the portal.
- **0** → do not do it. The app would be left with nothing.

Recovery if it goes wrong: `mkdir /home/site/wwwroot/_del_node_modules` over
SSH plus a restart. Roughly two minutes.

### Other untried options

- **An explicit startup command**, bypassing the generated script.
- **`az webapp deploy --clean true`**, which empties `wwwroot` before
  extracting. Safe here only because the app writes nothing to disk — no
  uploads, no logs, no SQLite in production (verified: no `multer` disk storage
  and no `writeFileSync`/`createWriteStream` anywhere in `src/`).

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
They are, for now, the whole of the protection: the trap itself is still there.

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
