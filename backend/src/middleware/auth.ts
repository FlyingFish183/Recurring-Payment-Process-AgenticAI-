import type { UserRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import type { AuthUser } from "../types/auth";
import { AppError } from "../utils/errors";

type JwtPayload = {
  sub: string;
  role: UserRole;
};

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, role: user.role } satisfies JwtPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "UNAUTHORIZED", "Missing Bearer token");
    }
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const user = await prisma.user.findFirst({
      where: { id: payload.sub, status: "ACTIVE" },
      select: { id: true, email: true, displayName: true, role: true, department: true },
    });
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "User not found or inactive");
    }
    req.user = user;
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
