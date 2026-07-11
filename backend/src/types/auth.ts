import type { User, UserRole } from "@prisma/client";
import type { Request } from "express";

export type AuthUser = Pick<User, "id" | "email" | "displayName" | "role" | "department">;

export type AuthedRequest = Request & {
  user?: AuthUser;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const WORKFLOW_ROLES: UserRole[] = ["REQUESTER", "HOD", "FA", "CA", "CASHIER"];
