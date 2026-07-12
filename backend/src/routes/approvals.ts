import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import {
  actOnApprovalStep,
  listPendingApprovalsForRole,
  verifyStepSignature,
  type ApprovalAction,
} from "../services/approval";

export const approvalRouter = Router();

approvalRouter.use(authenticate);

approvalRouter.get(
  "/pending",
  requireRole("HOD", "FA", "CA", "CASHIER"),
  asyncHandler(async (req, res) => {
    const steps = await listPendingApprovalsForRole(req.user!.role, req.user!.id);
    res.json({
      data: steps,
      role: req.user!.role,
      count: steps.length,
    });
  }),
);

approvalRouter.get(
  "/steps/:id/signature",
  requireRole("REQUESTER", "HOD", "FA", "CA", "CASHIER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const result = await verifyStepSignature(String(req.params.id));
    res.json(result);
  }),
);

approvalRouter.post(
  "/steps/:id/actions",
  requireRole("HOD", "FA", "CA", "CASHIER"),
  asyncHandler(async (req, res) => {
    const stepId = String(req.params.id);
    const body = z
      .object({
        action: z.enum(["approve", "reject", "request_changes"]),
        comments: z.string().max(2000).optional(),
        confirmSignature: z.boolean().optional(),
      })
      .parse(req.body);

    if (
      (body.action === "reject" || body.action === "request_changes") &&
      !body.comments?.trim()
    ) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Comments are required for reject / request changes",
        },
      });
      return;
    }

    const request = await actOnApprovalStep({
      stepId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      actorEmail: req.user!.email,
      actorDisplayName: req.user!.displayName,
      action: body.action as ApprovalAction,
      comments: body.comments,
      confirmSignature: body.confirmSignature,
    });

    res.json(request);
  }),
);
