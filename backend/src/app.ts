import cors from "cors";
import express from "express";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiRouter } from "./routes/api";
import { healthRouter } from "./routes/health";

export function createApp() {
  const app = express();

  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (_req, res) => {
    res.json({
      name: "KFC Recurring Payment API",
      version: "0.1.0",
      health: "/health",
      api: "/api",
    });
  });

  app.use("/health", healthRouter);
  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
