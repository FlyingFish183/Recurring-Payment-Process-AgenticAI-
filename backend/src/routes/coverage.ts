import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { buildMonthlyCoverage, listCoveragePeriods } from "../services/coverage";

export const coverageRouter = Router();

coverageRouter.use(authenticate);

const periodSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM");

coverageRouter.get(
  "/periods",
  asyncHandler(async (_req, res) => {
    const periods = await listCoveragePeriods();
    res.json({ data: periods });
  }),
);

coverageRouter.get(
  "/monthly",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        period: periodSchema.optional(),
      })
      .parse(req.query);

    const now = new Date();
    const period =
      query.period ??
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const board = await buildMonthlyCoverage({
      period,
      userId: req.user!.id,
      role: req.user!.role,
    });

    res.json(board);
  }),
);
