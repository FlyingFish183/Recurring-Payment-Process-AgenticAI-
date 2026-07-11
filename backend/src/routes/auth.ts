import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole, signToken } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { WORKFLOW_ROLES } from "../types/auth";
import { AppError } from "../utils/errors";

export const authRouter = Router();

/** Hackathon mock Entra — same password for all seeded actors. */
export const DEMO_PASSWORD = "KfcDemo2026!";

const DEMO_EMAILS = [
  "requester@kfc.vn",
  "hod@kfc.vn",
  "fa@kfc.vn",
  "ca@kfc.vn",
  "cashier@kfc.vn",
] as const;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Email + password login (matches User.email in Aurora). */
authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const normalized = email.trim().toLowerCase();

    if (password !== DEMO_PASSWORD) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid email or password");
    }

    const user = await prisma.user.findFirst({
      where: { email: normalized, status: "ACTIVE" },
      select: { id: true, email: true, displayName: true, role: true, department: true },
    });
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid email or password");
    }

    const token = signToken(user);
    res.json({
      token,
      user,
      expiresIn: env.JWT_EXPIRES_IN,
      availableRoles: WORKFLOW_ROLES,
    });
  }),
);

authRouter.get(
  "/demo-accounts",
  asyncHandler(async (_req, res) => {
    res.json({
      password: DEMO_PASSWORD,
      accounts: DEMO_EMAILS.map((email) => ({ email })),
    });
  }),
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

authRouter.get(
  "/roles",
  asyncHandler(async (_req, res) => {
    res.json({ roles: WORKFLOW_ROLES });
  }),
);

authRouter.get(
  "/fa-only",
  authenticate,
  requireRole("FA"),
  asyncHandler(async (req, res) => {
    res.json({ ok: true, user: req.user });
  }),
);
