# Moving to a fresh App Service

A runbook for replacing `contact-center-app` with a newly created App Service,
to escape the frozen `wwwroot/node_modules` described in `DEPLOYMENT.md`.

Same tier (Basic B1), same cost. The point is not more resources — it is a
`wwwroot` that has never been written to, so the deploy actually replaces
`node_modules` instead of leaving June's copy in place.

Do this at a quiet hour. It is reversible until the final step.

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

Three things can stop this migration. Check them first, not halfway through.

### 1. Azure SQL firewall — the most likely blocker

The new App Service has **different outbound IP addresses**. If the SQL server
only allows the old ones, the new app cannot connect and will fail on startup
with a connection timeout.

In the Azure Portal, on the **SQL server** (not the database) →
**Networking**:

- If **"Allow Azure services and resources to access this server"** is ON,
  nothing to do.
- If it is OFF and specific IPs are listed, add the new App Service's outbound
  IPs (App Service → **Networking** → *Outbound addresses*) **before** the
  cutover.

### 2. Do you have a custom domain?

If users reach the app at a custom domain, that domain and its TLS certificate
must be re-pointed, and that is the actual moment of cutover. If everyone uses
the `*.azurewebsites.net` hostname, the new app simply has a different
hostname and there is nothing to re-point — but see `CORS_ALLOWED_ORIGINS` and
the webchat widget below.

### 3. Write down the current settings

Copy the existing app's **Environment variables** out to a file first. Azure
hides secret values once saved, so collect them while you still can:

App Service → **Settings → Environment variables → Advanced edit** gives you
the whole set as JSON. Save it somewhere safe. This is your source of truth for
step 3 and your rollback reference.

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

### 6. Prove the trap is gone

This is the step that justifies the whole exercise. On a branch, add a small
runtime dependency that is currently blocked:

```bash
npm install compression
```

Import it in `server.ts`, deploy to the new app, and check `/api/health` still
answers. If it does, `wwwroot/node_modules` is being replaced properly and the
freeze is over.

Revert the commit afterwards unless you actually want the package.

Do this **before** the cutover. If it fails, you have learned that the new App
Service has the same problem, and nothing has moved yet.

### 7. Cut over

- **Custom domain**: remove it from the old app, add it to the new one, bind
  the TLS certificate. Brief interruption while DNS and the binding settle.
- **No custom domain**: tell people the new URL, and update
  `CORS_ALLOWED_ORIGINS`, `PUBLIC_APP_URL`, `APP_PUBLIC_URL` and
  `VITE_PUBLIC_APP_URL` to it.
- **The Agents.mn webchat widget**: if its dashboard restricts which domains
  may embed it, add the new hostname there too, or the widget silently stops
  loading.

Leave the old App Service **stopped, not deleted**, for a week or two. Stopped
costs nothing to keep as a rollback.

---

## Rollback

Nothing destructive happens to data at any point, because the database is never
touched.

- **Before cutover**: just keep using the old app. Delete the new one.
- **After cutover**: start the old app, move the custom domain back, restore
  `app-name` in the workflow. A few minutes.

The only irreversible action in this runbook is deleting the old App Service.
Do not do that until the new one has served real traffic for a while.

---

## What this does not fix

The frozen directory is a property of that one App Service instance. A fresh
one starts clean — but nothing guarantees it cannot drift the same way in
future. The guardrails already in the workflow are what make a repeat visible:

- the deploy warns when `package.json`'s runtime dependencies change
- the deploy fails unless the running app reports the commit that was just
  shipped

Keep both.
