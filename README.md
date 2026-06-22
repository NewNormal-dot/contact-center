# Production Deployment - Azure App Service

This project is a full-stack Node.js application (Express + React/Vite) designed for deployment to Azure App Service.

## Prerequisites

* Azure account
* Azure SQL Database or Microsoft SQL Server
* Node.js environment

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run local SQLite migrations:

   ```bash
   npm run migrate
   ```

3. Start local development:

   ```bash
   npm run dev
   ```

> Local development uses SQLite via `knexfile.ts`.

## Azure App Service Configuration

When deploying to Azure App Service, configure the following **Application Settings**:

* `NODE_ENV`: `production`
* `PORT`: Azure provides this automatically; do not hardcode it
* `JWT_SECRET`: A long random string for securing tokens
* `INITIAL_SUPERADMIN_EMAIL`: Initial superadmin email for `/api/auth/register-initial`
* `INITIAL_SUPERADMIN_PASSWORD`: Strong initial superadmin password
* `DB_SERVER`: Azure SQL server host name
* `DB_NAME`: Database name
* `DB_USER`: Database user
* `DB_PASSWORD`: Database password
* `DB_PORT`: Usually `1433`

## Deployment Steps

1. **Build**: Run the frontend build.

   ```bash
   npm run build
   ```

2. **Deploy**: Deploy the entire repository to Azure App Service via GitHub Actions, Azure CLI, or VS Code.

3. **Database Migrations**: Run the production MSSQL migration command in Azure SSH/Kudu or as a deployment step.

   ```bash
   npm run migrate:prod
   ```

4. **Verify Migration Status**:

   ```bash
   npm run migrate:prod:status
   ```

5. **Startup Command**: Azure should automatically detect `npm start`. If not, set the startup command to:

   ```bash
   npm start
   ```

## API Endpoints Note

The backend serves both the API and the React frontend.

* API routes: `/api/*`
* Frontend: Served from `/dist/index.html` as a fallback for all other routes.

## Database Note

* **SQLite**: Used for local development via `knexfile.ts`.
* **Azure SQL / Microsoft SQL Server**: Used in production via `knexfile.mssql.cjs`.
* Production database connection uses the `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_PORT` environment variables.

## Important Migration Notes

Do **not** run production migrations with:

```bash
npx knex migrate:latest --knexfile knexfile.ts
```

For Azure production, always use:

```bash
npm run migrate:prod
```

To check Azure production migration status, use:

```bash
npm run migrate:prod:status
```
