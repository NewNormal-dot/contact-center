import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import cors from "cors";
import helmet from "helmet";
import { createServer as createViteServer } from "vite";
import authRoutes from "./src/api/auth";
import userRoutes from "./src/api/users";
import slotRoutes from "./src/api/slots";
import requestRoutes from "./src/api/requests";
import broadcastRoutes from "./src/api/broadcasts";
import auditRoutes from "./src/api/audit";
import tradeRoutes from "./src/api/trades";
import forecastRoutes from "./src/api/forecast";
import ruleRoutes from "./src/api/rules";
import adminRoutes from "./src/api/admin";
import settingsRoutes from "./src/api/settings";
import db from "./src/database/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let migrationStatus: "skipped" | "running" | "complete" | "failed" = "skipped";
let migrationError: string | null = null;

function validateProductionDbEnv() {
  const required = [
    'DB_SERVER',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required production DB env vars: ${missing.join(', ')}`);
  }
}

async function runProductionMigrationsSafely() {
  if (process.env.NODE_ENV !== "production") {
    migrationStatus = "skipped";
    return true;
  }

  if (process.env.SKIP_DB_MIGRATIONS === "true") {
    migrationStatus = "skipped";
    console.log('Skipping production DB migrations because SKIP_DB_MIGRATIONS=true');
    return true;
  }

  validateProductionDbEnv();

  migrationStatus = "running";
  migrationError = null;
  try {
    const [batchNo, migrations] = await db.migrate.latest();
    migrationStatus = "complete";
    if (migrations.length > 0) {
      console.log(`Database migrations applied in batch ${batchNo}: ${migrations.join(", ")}`);
    } else {
      console.log("Database migrations already up to date");
    }
    return true;
  } catch (err: any) {
    migrationStatus = "failed";
    migrationError = err?.message || String(err);
    console.error("Database migrations failed:", err);
    return false;
  }
}

async function warmUpDatabaseConnection() {
  // Actively establish and verify a DB connection BEFORE we start accepting
  // traffic, instead of letting the first real user request pay for it.
  // This directly targets the "first login after deploy fails, then a
  // refresh works fine" symptom: without this, the pool's first connection
  // to Azure SQL (TCP + TLS handshake + auth) happens lazily on the first
  // incoming query, which can be slow enough to time out under load.
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.raw('SELECT 1');
      console.log('Database connection warmed up successfully.');
      return;
    } catch (err: any) {
      console.error(`DB warm-up attempt ${attempt}/${maxAttempts} failed:`, err?.message || err);
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      } else {
        console.error('DB warm-up did not succeed after all attempts; continuing startup anyway. The first real request may be slow.');
      }
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  // Basic security and middleware
  app.use(helmet({
    contentSecurityPolicy: false,
  }));
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/slots", slotRoutes);
  app.use("/api/requests", requestRoutes);
  app.use("/api/broadcasts", broadcastRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/trades", tradeRoutes);
  app.use("/api/forecast", forecastRoutes);
  app.use("/api/rules", ruleRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/settings", settingsRoutes);

  // API Health Check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
      migrations: {
        status: migrationStatus,
        error: process.env.NODE_ENV === "production" ? undefined : migrationError,
      },
    });
  });

  // Vite integration for development
  if ((process.env.NODE_ENV === "development" || !process.env.NODE_ENV) && process.env.SERVE_STATIC !== "true") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      // Avoid falling back to index.html for API routes
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'API endpoint not found' });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Error handling middleware
  app.use(((err, req, res, next) => {
    console.error('Error occurred:', err.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error(err.stack);
    }
    res.status(500).json({ 
      error: "Дотоод алдаа гарлаа",
      message: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }) as express.ErrorRequestHandler);

  if (process.env.NODE_ENV === "production") {
    const migrated = await runProductionMigrationsSafely();
    if (!migrated) {
      console.error('Production startup warning: DB migrations failed, but server is continuing to start. Some features may be unavailable.');
    }
  }

  await warmUpDatabaseConnection();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
