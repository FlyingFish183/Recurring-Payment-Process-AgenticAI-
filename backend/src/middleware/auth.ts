import type { UserRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import type { AuthUser } from "../types/auth";
import { AppError } from "../utils/errors";

type JwtPayload = {
  sub: string;
  role: UserRole;
  email: string;
  displayName: string;
  department: string | null;
};

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      displayName: user.displayName,
      department: user.department ?? null,
    } satisfies JwtPayload,
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] },
  );
}

/**
 * Auth from JWT claims only — avoids an Aurora round-trip on every API call.
 * Login still validates the user against the DB once.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "UNAUTHORIZED", "Missing Bearer token");
    }
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (!payload.sub || !payload.role || !payload.email) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid token payload");
    }
    req.user = {
      id: payload.sub,
      email: payload.email,
      displayName: payload.displayName ?? payload.email,
      role: payload.role,
      department: payload.department,
    };
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError(401, "UNAUTHORIZED", "Invalid or expired token"));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(new AppError(401, "UNAUTHORIZED", "Not authenticated"));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(
        new AppError(403, "FORBIDDEN", `Role ${req.user.role} cannot perform this action`, {
          required: roles,
        }),
      );
      return;
    }
    next();
  };
}
