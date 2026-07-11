import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/errorHandler";

export const healthRouter = Router();

healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    let database: "up" | "down" = "down";
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "up";
    } catch {
      database = "down";
    }

    const ok = database === "up";
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      service: "kfc-recurring-payments-api",
      database,
      timestamp: new Date().toISOString(),
    });
  }),
);
