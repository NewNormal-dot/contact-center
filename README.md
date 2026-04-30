# Production Deployment - Azure App Service

This project is a full-stack Node.js application (Express + React/Vite) designed for deployment to Azure App Service.

## Prerequisites
- Azure account
- Azure SQL Database or Microsoft SQL Server
- Node.js environment

## Local Setup
1. `npm install`
2. `npm run migrate`
3. `npm run dev`

## Azure App Service Configuration
When deploying to Azure App Service, configure the following **Application Settings**:

- `NODE_ENV`: `production`
- `PORT`: (Azure provides this automatically, don't hardcode it)
- `JWT_SECRET`: A long random string for securing tokens
- `DB_SERVER`: Azure SQL server host name
- `DB_NAME`: Database name
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password
- `DB_PORT`: Usually `1433`

## Deployment Steps
1. **Build**: Run `npm run build` to build the Vite frontend.
2. **Deploy**: Deploy the entire repository to Azure App Service (via GitHub Actions, Azure CLI, or VS Code).
3. **Database Migrations**: Run `knex migrate:latest` in the Azure Kudu console or as a post-deployment script.
   ```bash
   npx knex migrate:latest --knexfile knexfile.ts
   ```
4. **Startup Command**: Azure should automatically detect `npm start`. If not, set it to:
   ```bash
   npm start
   ```

## API Endpoints Note
The backend serves both the API and the React frontend.
- API routes: `/api/*`
- Frontend: Served from `/dist/index.html` as a fallback for all other routes.

## Database Note
- **SQLite**: Used for local development (`database.sqlite`).
- **Azure SQL / Microsoft SQL Server**: Used in production via the `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_PORT` environment variables.
