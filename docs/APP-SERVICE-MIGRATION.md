# Moving to a fresh App Service

**Done, 2026-09-21.** `contact-center-web` is production; `contact-center-app`
is stopped, not deleted.

This ran as a runbook and is kept as a record. The steps below are what was
actually done, in order, with what each one cost. If a third App Service is
ever needed, start at **5a** and **6** — those are the two that were not
obvious and took five failed deploys between them.

### What it took

| | |
|---|---|
| Deploys before the new app started | **5** |
| Cause of failure 1-3 | guessing instead of reading the container log |
| Cause of failure 4 | `appCommandLine` silently loses quoting |
| Cause of failure 5 | the app raced Oryx's `node_modules` extraction |
| Actual root cause | `zip -rq` ships `node_modules/.bin/*` as copies, not symlinks |
| Production downtime | **none** |

The single most useful change was making CI print the container's own log on
failure. Every attempt before that was a guess; the first attempt after it
produced the answer.

### Cleanup still outstanding

- [ ] Delete `src/utils/dependencyProbe.ts`, its three tests, the `dependency`
      field in `/api/health`, and the `compression` dependency. They exist only
      to answer a question that is now answered.
- [ ] Remove `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` from the old
      App Service and change that account's password. They are not on the new
      app, and `src/database/seeds/initial_user.ts` runs `knex('users').del()`.
- [ ] Tidy the duplicated `AllowAppServiceOutbound*` / `app-out-*` firewall
      rules and the accumulated `QueryEditorClientIPAddress_*` ones.
- [ ] Consider a custom domain, so the next migration is invisible to users.
- [ ] Consider `zip -ryq` in the build job — see `DEPLOYMENT.md`. Now that the
      old app is the expendable one, this is finally safe to test.
- [ ] Delete the old App Service, once a week or two has passed without regret.

---

## What moves, and what does not

This is the question that matters most, so it goes first.

| | Where it lives | Affected? |
|---|---|---|
| Users, passwords | Azure SQL | **No** |
| Bookings, schedules, shifts | Azure SQL | **No** |
| Leave and vacation requests | Azure SQL | **No** |
| Audit log, quotas, segments, holidays | Azure SQL | **No** |
| Application code | App Service | Redeployed from GitHub |
| Configuration (env vars) | App Service | **Copied by hand** |

`knexfile.ts` connects with `DB_SERVER` / `DB_NAME` / `DB_USER` /
`DB_PASSWORD`. The database is a **separate Azure resource**. A new App Service
pointed at the same four values sees exactly the same data.

**Nobody re-registers. Nothing is re-entered.** The App Service runs the code;
it stores nothing.

The one user-visible effect: if `JWT_SECRET` is not copied exactly, every
existing login token becomes invalid and everyone signs in again. Accounts are
untouched — it is a sign-in, not a re-registration.

---

## Before you start

Three things can stop this migration. **All three were checked on 2026-09-18**
and the answers are recorded below, so they do not need repeating unless the
Azure configuration changes.

### 1. Azure SQL firewall — ✅ no work needed

The new App Service has **different outbound IP addresses**, so a firewall
that allows only the old ones would reject it, and the app would fail on
startup with a connection timeout.

Checked on `contact-center-sql` → **Security → Networking**:

```
Public network access:  Selected networks
Exceptions:             [x] Allow Azure services and resources to access this server
```

That exception is ON, and a new App Service is an Azure resource, so it
connects with no firewall change at all.

> Two things noticed while checking, both **out of scope for this migration**
> and best left until after it has settled:
>
> - The eight App Service outbound IPs are listed **twice**, once as
>   `AllowAppServiceOutbound1-8` and again as `app-out-<ip>`. With the Azure
>   services exception on, both sets are redundant.
> - Around ten `QueryEditorClientIPAddress_*` / `ClientIPAddress_*` rules have
>   accumulated — personal addresses the Portal's Query Editor adds
>   automatically each time someone uses it.
>
> Do not tidy these during the migration. If something breaks, you want one
> variable changed, not two.

### 2. Custom domain — ✅ none

Checked on the App Service → **Custom domains**: one entry, the default
`contact-center-app-….azurewebsites.net`. No custom hostname is bound.

That removes the DNS and certificate work, but it has a consequence: **the new
app has a different URL, and everyone has to be told.** See step 7.

It also means a custom domain (e.g. `workforce.mobicom.mn`) would have made
this migration invisible to users, and every future one too. Worth considering
separately — it does not change anything here.

### 3. Current settings — ✅ exported

App Service → **Settings → Environment variables → Advanced edit** gives the
whole set as JSON. Azure hides secret values once saved, so this has to be
collected before anything else. Done; keep it safe. It is the source of truth
for step 3 and the rollback reference.

---

## Steps

### 1. Create the new App Service

- **Runtime**: Node 22 LTS, **Linux**
- **Plan**: Basic B1 (the same as today)
- **Region**: the same region as the SQL server, so the app and database stay
  close
- Name it something distinguishable, e.g. `contact-center-app2`

Do **not** connect deployment yet.

### 2. Turn on Always On

App Service → **Settings → Configuration → General settings → Always On: On**.

Without it the app sleeps and the first user after an idle period waits for a
cold start — which is what the "Check and enable Always On" step in the
workflow exists to prevent.

### 3. Copy the environment variables

From the JSON you saved in the pre-flight. Grouped by how much they matter:

**Required — the app refuses to start without these** (`requireEnv` in
`knexfile.ts`):

```
DB_SERVER
DB_NAME
DB_USER
DB_PASSWORD
```

**Copy exactly, or behaviour changes:**

```
JWT_SECRET               different value => everyone signs in again
NODE_ENV=production
SKIP_DB_MIGRATIONS       currently true; migrations are applied by hand
SERVE_STATIC             serves the built SPA
CORS_ALLOWED_ORIGINS     must list the hostname users actually visit
PUBLIC_APP_URL           links in invitation / reset emails
APP_PUBLIC_URL
VITE_PUBLIC_APP_URL
ROOT_ADMIN_EMAILS
EMAIL_WEBHOOK_URL
EMAIL_INVITE_WEBHOOK_URL
EMAIL_WEBHOOK_SECRET
PASSWORD_SETUP_TOKEN_TTL_HOURS
```

**Optional tuning** — copy if set, otherwise the defaults in code apply:
`DB_PORT`, `DB_POOL_MIN`, `DB_POOL_MAX`, the `DB_*_TIMEOUT_MS` family,
`SLOTS_CACHE_TTL_MS`, `AUTH_USER_CACHE_TTL_MS`, `MIGRATION_STATUS_TTL_MS`.

### ⚠️ Do NOT copy these

```
ALLOW_DESTRUCTIVE_SEED
SEED_SUPERADMIN_EMAIL
SEED_SUPERADMIN_PASSWORD
INITIAL_SUPERADMIN_EMAIL
INITIAL_SUPERADMIN_PASSWORD
```

`src/database/seeds/initial_user.ts` runs `knex('users').del()` — it deletes
**every user**. Two guards stop it: production, and a non-empty users table.
`ALLOW_DESTRUCTIVE_SEED=true` disables both. It has no business existing on a
production app pointed at the live database.

If any of these are set on the current app, that is worth removing there too.

### 4. Point GitHub Actions at the new app

`.github/workflows/main_contact-center-app.yml` deploys with:

```yaml
app-name: 'contact-center-app'
slot-name: 'Production'
```

and authenticates over OIDC using three repository secrets
(`AZUREAPPSERVICE_CLIENTID_*`, `TENANTID_*`, `SUBSCRIPTIONID_*`). Those
federated credentials are scoped to the **existing** resource, so both the name
and the access need updating:

1. In the Azure Portal, on the new App Service → **Deployment Center** →
   connect it to this GitHub repository and branch. Azure will create a new
   workflow file and new secrets.
2. Take the new `app-name` and the three new secret names from what Azure
   generated, and put them into the **existing** workflow file — keep all the
   guardrails it already has (the dependency warning, the packaging steps, the
   build-SHA verification). Then delete the workflow file Azure added.

Alternatively, grant the existing federated credential access to the new
resource and change only `app-name`. Either works; the first is less fiddly.

### 5. Deploy and verify — before sending anyone to it

Push to `main`, or re-run the workflow. Then, against the **new** hostname:

```
https://<new-app>.azurewebsites.net/api/health
```

Expected:

```json
{"status":"ok","env":"production","commit":"<the sha you just deployed>","migrations":{"status":"skipped","pending":0}}
```

Check, in order:

- **`commit` matches the SHA you deployed.** This is the whole point of the
  migration — it proves the new app is running new code from a `wwwroot` that
  was actually replaced.
- **`pending: 0`.** The schema is shared, so the migrations are already
  applied. If it says otherwise, run `POST /api/admin/run-migrations` as a
  superadmin.
- **Sign in.** Your existing account, existing password. If it works, the
  database connection and the firewall are both fine.
- **Look at a schedule.** Real shifts, real bookings — the same data as the
  old app, because it is the same database.

### 5a. Set the startup command — the new app will not start without it

Found the hard way over five runs on 2026-09-19/21. A newly created App
Service has an empty `appCommandLine`, and the fallbacks Azure's Node image
offers (`npm start`, and the old app's `npx tsx server.ts`) both reach `tsx`
through `node_modules/.bin/tsx`, which the package ships broken. See **The
package has shipped a broken node_modules all along** in `DEPLOYMENT.md`.

Set it to the real file instead:

```
bash -c 'cd /home/site/wwwroot && node node_modules/tsx/dist/cli.mjs server.ts'
```

The workflow's `deploy-new` job now sets this on every run, so there is
nothing to do by hand — it is recorded here because it explains why the
obvious values do not work.

### 6. Prove the trap is gone

This is the step that justifies the whole exercise, and it is now automatic.

`compression` is a real dependency in `package.json` — the same package whose
addition took production down on 2026-09-16. Nothing imports it at startup.
Instead `src/utils/dependencyProbe.ts` tries to load it at request time,
inside a try, caches the answer, and `/api/health` reports it:

```json
"dependency": { "package": "compression", "loaded": true, "error": null }
```

Read it on each app:

| `loaded` | Means |
|---|---|
| `true` | the instance runs the `node_modules` the deploy shipped — **the trap is gone** |
| `false` | the instance runs its own frozen copy — the trap is still there |

Expect `false` on the old app and `true` on the new one. Both are correct
answers for their app, and neither can break anything: a failed import is
caught and reported, never thrown. That is what makes it safe to ship to
production and the new app from a single build, which the previous approach —
importing it at the top of `server.ts` — was not.

Once the old App Service is retired, delete `dependencyProbe.ts`, its tests,
the `dependency` field, and the dependency itself. It has no other purpose.

### 7. Cut over — done 2026-09-21

No custom domain was bound, so the new app has a **different URL** and the
cutover was a communication exercise rather than a DNS one:

```
https://contact-center-web-e4f6a3bqapfxeseh.westus2-01.azurewebsites.net
```

Everyone signs in at that address. Accounts, passwords, schedules and history
are untouched — it is the same database.

The old App Service was **stopped, not deleted**, the same day. Stopped costs
nothing and keeps the rollback one click away.

**If the Agents.mn webchat dashboard restricts which domains may embed the
widget**, the new hostname has to be added there. Nothing in this repo
controls that, so if the widget stops appearing, look there first.

If you would rather users never saw this: binding a custom domain (e.g.
`workforce.mobicom.mn`) makes this step and every future one invisible. It was
considered and set aside. The option does not expire, and it is on the cleanup
list at the top of this file.

---

## Rollback

Nothing destructive happened to data at any point, because the database was
never touched — both App Services read the same Azure SQL server.

To go back to `contact-center-app`:

1. **Start** it in the Portal. It still holds the last build it received.
2. Restore its deploy job from git history — the commit that removed it names
   the line to look for.
3. Tell people to use the old URL again.

A few minutes, and no data moves.

The only irreversible action is **deleting** the old App Service. That is on
the cleanup list deliberately, not done.

---

## What this does not fix

The frozen directory was a property of that one App Service instance. A fresh
one starts clean — but nothing guarantees it cannot drift the same way. The
guardrails in the workflow are what make a repeat visible:

- the deploy warns when `package.json`'s runtime dependencies change
- the deploy fails unless the running app reports the commit just shipped
- on failure, the deploy prints the container's own log

Keep all three. The third was added late and is the reason this was solved at
all: the four attempts before it were guesses, and the first attempt after it
had the answer.
