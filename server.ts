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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

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

  // API Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
  });

  // Vite integration for development
  if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
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

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer().catch(console.error);
