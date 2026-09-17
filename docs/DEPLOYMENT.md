# Deployment notes

Read this before changing anything about how this app is built, packaged or
deployed — and **always** before adding an npm dependency.

## The short version

**This app cannot currently take on a new runtime npm dependency.** Adding one
passes CI, deploys "successfully", and then takes the site down with a 503,
because the instance ignores the `node_modules` this workflow ships and runs a
copy frozen at 2026-06-07. That happened on 2026-09-16; the site was down for
roughly two hours.

Four fixes have been attempted or evaluated and none worked. Read
[Three things that did NOT work](#three-things-that-did-not-work) and
[the last candidate](#4-the-last-candidate--checked-and-ruled-out) before
spending a deploy on a fifth idea — and see
[Where this leaves things](#where-this-leaves-things) for what would actually
unblock it.

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

## 4. The last candidate — checked, and ruled out

Removing **`wwwroot/_del_node_modules`**. Do not do this.

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

### Why not

The whole idea depends on `/node_modules` being populated, because that is what
the app would be pointed at once the swap works. It is not. Checked on the app
container (Kudu → **SSH — Application**, 2026-09-16):

```
root@5e8289cfc534:/home# ls /node_modules | wc -l
0
```

Empty. So removing `_del_node_modules` would let the swap succeed, move the
working (if stale) `wwwroot/node_modules` out of the way, and point the app at
nothing. The site would go down completely.

This also resolves the contradiction that ran through this whole
investigation: the startup log clearly shows a 25-second extraction of the
123 MB tarball, yet `/node_modules` is empty every time it is looked at. The
extraction does not reach the filesystem the app process reads. Which means
`node_modules.tar.gz` being rewritten on every deploy is irrelevant — its
contents never get used. `wwwroot/node_modules`, frozen at 2026-06-07, is the
only thing that has ever mattered.

If you try this anyway, recovery is `mkdir /home/site/wwwroot/_del_node_modules`
over SSH plus a restart — about two minutes.

## Where this leaves things

Every avenue reachable from the repo has been tried or ruled out. The two that
remain — an explicit startup command, and `az webapp deploy --clean true`
(which empties `wwwroot` before extracting; safe from a data standpoint, since
the app writes nothing to disk: no `multer` disk storage, no
`writeFileSync`/`createWriteStream` anywhere in `src/`) — share the same
failure mode as the one above. If they do not work, the app is left with no
modules, and there is no slot to find that out on.

**The real unblock is a deployment slot.** Basic tier has none. Standard (S1,
~$58/month against B1's ~$12) provides one: every idea here could then be tried
on the slot, verified, and swapped into production with no downtime and no
guessing. That is a spending decision, not a technical one — worth making only
if new npm dependencies actually become necessary.

Until then: the app runs fine, and the guardrails make sure a repeat cannot go
unnoticed. Just do not add a dependency.

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

## Applying the migrations added on 2026-09-18

`SKIP_DB_MIGRATIONS=true` is set on the App Service, so the five migrations
below **will not apply themselves**. Everything that uses them is written to
degrade cleanly while they are missing (`columnExists`/`tableExists` guards),
so the code is safe to deploy first — but the features stay switched off
until they run.

| Migration | Adds | Until it runs |
|---|---|---|
| `20260918000000_create_training_attachments` | `training_attachments` | File attachments on training materials are refused with a clear message; link-only materials work |
| `20260918001000_add_sessions_valid_from` | `users.sessions_valid_from` | Sessions cannot be revoked; everything else is unaffected |
| `20260918002000_add_user_photo_data` | `users.photo_data` | Profile photo upload answers 503 with a clear message |
| `20260918003000_add_booking_waves` | `work_slots.booking_waves`, `slot_bookings.booking_wave_id` | Booking stays one undivided pool, exactly as today |
| `20260918004000_create_server_errors` | `server_errors` | Errors stay in the 30-entry in-memory ring only |

Check what is outstanding first — `/api/health` now reports the count, and
`GET /api/admin/migration-status` names them:

```js
// browser console, logged in as superadmin
fetch('/api/admin/migration-status', {
  headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
}).then(r => r.json()).then(console.log)
```

Then apply them:

```js
fetch('/api/admin/run-migrations', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + localStorage.getItem('token') },
}).then(r => r.json()).then(console.log)
```

Every one of these migrations is additive — new tables and new nullable
columns only. Nothing is dropped, altered or backfilled, so applying them
cannot break the running app, and rolling the code back does not require
rolling them back.

**Check `/api/health` before anything else when something "stops working".**
A non-zero `migrations.pending` means the schema is behind the code, and the
symptom of that is a generic 500 on whichever feature needed the missing
column.
