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
import { captureError } from "./src/utils/errorLog";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let migrationStatus: "skipped" | "running" | "complete" | "failed" = "skipped";
let migrationError: string | null = null;
let pendingMigrationCount: number | null = null;

async function refreshPendingMigrationCount() {
  try {
    const [, pending] = await db.migrate.list();
    pendingMigrationCount = (pending as any[]).length;
    if (pendingMigrationCount > 0) {
      console.warn(
        `WARNING: ${pendingMigrationCount} database migration(s) are NOT applied. ` +
        `Features depending on them will fail with a generic error. ` +
        `Apply with POST /api/admin/run-migrations as a superadmin.`,
      );
    }
  } catch (err: any) {
    pendingMigrationCount = null;
    console.error('Could not determine pending migrations:', err?.message || err);
  }
}

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

// Safety net: catch anything that slips outside Express's normal
// request/response flow (e.g. a rejected promise in middleware that never
// calls next(err)). Logged and recorded for self-diagnosis, but does NOT
// crash the process - Node would otherwise terminate on an uncaught
// exception, which is worse than just logging it.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  captureError('unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  captureError('uncaughtException', err);
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  // Azure App Service terminates TLS and forwards the request over plain
  // HTTP, so without this Express reports every client as the proxy itself:
  // req.ip and req.protocol are wrong, and anything keyed on the client
  // address (the login rate limiter) would lump every user together.
  app.set('trust proxy', true);

  // Basic security and middleware.
  //
  // CSP was disabled outright. With the JWT living in localStorage and no
  // token revocation, any script injection was a 24-hour account takeover,
  // and there was no defence in depth behind React's escaping. The policy
  // below is deliberately permissive about the things this app genuinely
  // does - inline styles (Tailwind + motion write them), data: URLs (file
  // previews are base64) and two avatar CDNs - while still blocking
  // third-party script execution, which is the part that matters.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        // No inline scripts: the theme bootstrap and the Agents.mn webchat
        // loader were moved out of index.html into public/*.js precisely so
        // this can stay free of 'unsafe-inline'.
        scriptSrc: ["'self'", 'https://chat.agents.mn'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://ui-avatars.com', 'https://api.dicebear.com', 'https://chat.agents.mn'],
        mediaSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:', 'https://chat.agents.mn'],
        connectSrc: ["'self'", 'https://chat.agents.mn', 'wss://chat.agents.mn'],
        frameSrc: ["'self'", 'https://chat.agents.mn'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        // Helmet enables this by default. It is right in production (the app
        // is served over HTTPS behind App Service) but would rewrite plain
        // http subresource URLs during local development, so it is only
        // applied where it makes sense.
        ...(process.env.NODE_ENV === 'production' ? {} : { upgradeInsecureRequests: null }),
      },
    },
    // Keep cross-origin isolation off: base64 media in <img>/<video> and the
    // avatar CDNs above are loaded without CORS headers.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // NOTE: there is deliberately NO gzip middleware here, and adding one is
  // not as simple as it looks. This App Service instance starts from a
  // leftover Oryx `node_modules.tar.gz` in wwwroot rather than from the
  // node_modules this repo's workflow actually ships, so a newly added npm
  // package is present in package.json and in the deployment zip but STILL
  // missing at runtime - the process then dies on startup with
  // ERR_MODULE_NOT_FOUND and the site returns 503. Until that deployment
  // quirk is fixed, this app cannot take on any new runtime dependency.
  // (Everything else in this file uses only packages already installed.)

  // The API and the SPA are served by this same process, so cross-origin
  // access is never needed. `cors()` with no options answered every request
  // with Access-Control-Allow-Origin: *, letting any site on the internet
  // call the API on behalf of anyone whose token it could get hold of. An
  // explicit allow-list keeps the escape hatch for a separately hosted
  // frontend without leaving it open by default.
  const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: false,
  }));
  // Default express.json() limit is 100kb, which is too small for bulk
  // schedule operations - e.g. creating/editing shifts across many selected
  // days at once (each day's shifts + booking waves add up) easily exceeds
  // that on /api/slots/sync-schedules, failing with a generic
  // "PayloadTooLargeError: request entity too large" that surfaced to
  // admins as an unhelpful "Дотоод алдаа гарлаа" alert.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
        // Production runs with SKIP_DB_MIGRATIONS=true and applies
        // migrations by hand, so the schema can silently drift behind the
        // code - and the symptom is a generic 500 on whichever feature
        // needed the missing column. Surfacing the pending count here means
        // the drift is visible from the health check instead of being
        // discovered by a user.
        pending: pendingMigrationCount,
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

    // Vite fingerprints every file it emits into dist/assets (app.4f2a1c.js),
    // so those files can never change behind a given URL and are safe to
    // cache in the browser forever. Without this the browser re-validated
    // every asset on every page load - hundreds of extra requests to the
    // server when a shift of CSRs all open the app at once.
    app.use('/assets', express.static(path.join(distPath, 'assets'), {
      immutable: true,
      maxAge: '1y',
    }));

    // Everything else (index.html above all) must always be revalidated,
    // otherwise a deploy would not reach users still holding a cached page.
    app.use(express.static(distPath, { etag: true, maxAge: 0 }));

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
    captureError(`${req.method} ${req.path}`, err);
    if (err.type === 'entity.too.large' || err.status === 413) {
      return res.status(413).json({
        error: 'Хадгалах өгөгдөл хэт том байна. Сонгосон өдрийн тоог багасгаад дахин оролдоно уу.',
      });
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
  await refreshPendingMigrationCount();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
