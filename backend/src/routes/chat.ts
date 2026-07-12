import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { runAnalyticsChat } from "../services/analyticsChat";

export const chatRouter = Router();

chatRouter.use(authenticate);

chatRouter.post(
  "/query",
  requireRole("CA", "CASHIER"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        question: z.string().min(3).max(2000),
      })
      .parse(req.body);

    const result = await runAnalyticsChat({
      question: body.question,
      actorId: req.user!.id,
      actorRole: req.user!.role,
    });

    res.json(result);
  }),
);
