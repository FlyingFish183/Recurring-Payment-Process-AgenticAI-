import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/errors";
import {
  createDigitalSignature,
  decodeSignatureRecord,
  SIGNING_REQUIRED_ROLES,
  verifyDigitalSignature,
} from "./digitalSignature";
import { accessibleStoreIds, storeScopeWhere } from "./storeScope";

/** Strict chain after requester: HOD → F&A → CA → Cashier */
export const APPROVAL_CHAIN: UserRole[] = ["HOD", "FA", "CA", "CASHIER"];

const APPROVER_ROLES = new Set<UserRole>(APPROVAL_CHAIN);

export type ApprovalAction = "approve" | "reject" | "request_changes";

async function writeAudit(input: {
  requestId: string;
  actorId: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}) {
  await prisma.auditEvent.create({
    data: {
      requestId: input.requestId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/**
 * Requester sends a READY request into the 4-step approval chain.
 */
export async function submitForApproval(input: {
  requestId: string;
  requesterId: string;
  comments?: string;
}) {
  const request = await prisma.paymentRequest.findUnique({
    where: { id: input.requestId },
    include: { lines: { select: { id: true } } },
  });

  if (!request) throw new AppError(404, "NOT_FOUND", "Payment request not found");
  if (request.requesterId !== input.requesterId) {
    throw new AppError(403, "FORBIDDEN", "Only the requester can submit for approval");
  }
  if (request.status !== "READY" && request.status !== "CHANGES_REQUESTED") {
    throw new AppError(
      409,
      "CONFLICT",
      `Submit for approval requires READY or CHANGES_REQUESTED (now ${request.status})`,
    );
  }
  if (request.lines.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "Add at least one payment line first");
  }

  const blocking = await prisma.validationResult.count({
    where: { requestId: request.id, severity: "BLOCKING" },
  });
  const blockedLines = await prisma.paymentLine.count({
    where: { requestId: request.id, status: "BLOCKED" },
  });
  if (blocking > 0 || blockedLines > 0) {
    throw new AppError(
      409,
      "CONFLICT",
      "Request has blocking validation (e.g. duplicate invoice). Fix or remove blocked lines before approval.",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.approvalStep.deleteMany({ where: { requestId: request.id } });

    await tx.approvalStep.createMany({
      data: APPROVAL_CHAIN.map((role, i) => ({
        requestId: request.id,
        sequenceNumber: i + 1,
        roleRequired: role,
        status: "PENDING" as const,
      })),
    });

    const next = await tx.paymentRequest.update({
      where: { id: request.id },
      data: {
        status: "IN_REVIEW",
        currentApprovalLevel: 1,
        version: { increment: 1 },
      },
      include: {
        store: { select: { id: true, storeCode: true, storeName: true } },
        approvalSteps: { orderBy: { sequenceNumber: "asc" } },
        lines: { orderBy: { lineNumber: "asc" }, include: { vendor: true } },
      },
    });

    return next;
  });

  await writeAudit({
    requestId: request.id,
    actorId: input.requesterId,
    actorRole: "REQUESTER",
    action: "SUBMIT_FOR_APPROVAL",
    entityType: "PaymentRequest",
    entityId: request.id,
    payload: { comments: input.comments, level: 1 },
  });

  return updated;
}

/**
 * Current-role pending queue: steps waiting for this actor's role at the active level.
 */
export async function listPendingApprovalsForRole(role: UserRole, userId: string) {
  if (!APPROVER_ROLES.has(role)) return [];

  const storeIds = await accessibleStoreIds(userId, role);

  const steps = await prisma.approvalStep.findMany({
    where: {
      status: "PENDING",
      roleRequired: role,
      OR: APPROVAL_CHAIN.map((_, i) => ({
        sequenceNumber: i + 1,
        request: {
          status: "IN_REVIEW" as const,
          currentApprovalLevel: i + 1,
          ...storeScopeWhere(storeIds),
        },
      })),
    },
    orderBy: { createdAt: "asc" },
    include: {
      request: {
        select: {
          id: true,
          requestNumber: true,
          storeId: true,
          paymentPeriod: true,
          currency: true,
          totalAmount: true,
          status: true,
          riskLevel: true,
          currentApprovalLevel: true,
          store: { select: { id: true, storeCode: true, storeName: true, region: true } },
          requester: { select: { id: true, displayName: true, email: true, role: true } },
          approvalSteps: {
            orderBy: { sequenceNumber: "asc" },
            select: {
              id: true,
              sequenceNumber: true,
              roleRequired: true,
              status: true,
              actedAt: true,
            },
          },
          validationResults: {
            where: { severity: "BLOCKING" },
            select: { id: true, validationType: true, message: true },
            take: 5,
          },
          lines: {
            orderBy: { lineNumber: "asc" },
            select: {
              id: true,
              lineNumber: true,
              expenseType: true,
              grossAmount: true,
              invoiceNumber: true,
              status: true,
              vendor: { select: { legalName: true, vendorCode: true } },
            },
          },
          _count: { select: { lines: true } },
        },
      },
    },
  });

  return steps;
}

export async function actOnApprovalStep(input: {
  stepId: string;
  actorId: string;
  actorRole: UserRole;
  actorEmail: string;
  actorDisplayName: string;
  action: ApprovalAction;
  comments?: string;
  /** Required when CA/Cashier approve — confirms intent to digitally sign. */
  confirmSignature?: boolean;
}) {
  const step = await prisma.approvalStep.findUnique({
    where: { id: input.stepId },
    include: { request: true },
  });

  if (!step) throw new AppError(404, "NOT_FOUND", "Approval step not found");
  if (step.roleRequired !== input.actorRole) {
    throw new AppError(403, "FORBIDDEN", `This step requires role ${step.roleRequired}`);
  }
  if (step.status !== "PENDING") {
    throw new AppError(409, "CONFLICT", `Step already ${step.status}`);
  }
  if (step.request.status !== "IN_REVIEW") {
    throw new AppError(409, "CONFLICT", `Request is ${step.request.status}, not IN_REVIEW`);
  }
  if (step.request.currentApprovalLevel !== step.sequenceNumber) {
    throw new AppError(
      409,
      "CONFLICT",
      `Waiting on level ${step.request.currentApprovalLevel}, not ${step.sequenceNumber}`,
    );
  }

  const storeIds = await accessibleStoreIds(input.actorId, input.actorRole);
  if (storeIds !== null && !storeIds.includes(step.request.storeId)) {
    throw new AppError(403, "FORBIDDEN", "This request is outside your managed stores");
  }

  if (input.action === "approve") {
    const blocking = await prisma.validationResult.count({
      where: { requestId: step.requestId, severity: "BLOCKING" },
    });
    const blockedLines = await prisma.paymentLine.count({
      where: { requestId: step.requestId, status: "BLOCKED" },
    });
    if (blocking > 0 || blockedLines > 0) {
      throw new AppError(
        409,
        "CONFLICT",
        "Cannot approve — request has blocking validation (e.g. duplicate invoice).",
      );
    }
  }

  const needsDigitalSign =
    input.action === "approve" && SIGNING_REQUIRED_ROLES.has(input.actorRole);
  if (needsDigitalSign && !input.confirmSignature) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Digital signature confirmation is required for CA / Cashier approval",
    );
  }

  const now = new Date();
  let signatureStored: string | null = null;
  let signatureMeta: Record<string, unknown> | undefined;

  if (needsDigitalSign) {
    const { stored, record } = await createDigitalSignature({
      requestId: step.request.id,
      requestNumber: step.request.requestNumber,
      stepId: step.id,
      sequenceNumber: step.sequenceNumber,
      roleRequired: step.roleRequired,
      action: input.action,
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      actorDisplayName: input.actorDisplayName,
      totalAmount: String(step.request.totalAmount),
      currency: step.request.currency,
      paymentPeriod: step.request.paymentPeriod,
      storeId: step.request.storeId,
      signedAt: now.toISOString(),
    });
    signatureStored = stored;
    signatureMeta = {
      algorithm: record.algorithm,
      keyId: record.keyId,
      contentHash: record.contentHash,
    };
  }

  if (input.action === "approve") {
    const isLast = step.sequenceNumber >= APPROVAL_CHAIN.length;
    await prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: step.id },
        data: {
          status: "APPROVED",
          actorId: input.actorId,
          comments: input.comments,
          signatureHash: signatureStored,
          signedAt: needsDigitalSign ? now : null,
          actedAt: now,
        },
      });

      if (isLast) {
        await tx.paymentRequest.update({
          where: { id: step.requestId },
          data: {
            status: "APPROVED",
            currentApprovalLevel: step.sequenceNumber,
          },
        });
        await tx.paymentLine.updateMany({
          where: { requestId: step.requestId },
          data: { status: "APPROVED" },
        });
      } else {
        await tx.paymentRequest.update({
          where: { id: step.requestId },
          data: {
            status: "IN_REVIEW",
            currentApprovalLevel: step.sequenceNumber + 1,
          },
        });
      }
    });
  } else if (input.action === "reject") {
    await prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: step.id },
        data: {
          status: "REJECTED",
          actorId: input.actorId,
          comments: input.comments,
          signatureHash: null,
          signedAt: null,
          actedAt: now,
        },
      });
      await tx.paymentRequest.update({
        where: { id: step.requestId },
        data: { status: "REJECTED" },
      });
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: step.id },
        data: {
          status: "CHANGES_REQUESTED",
          actorId: input.actorId,
          comments: input.comments,
          signatureHash: null,
          signedAt: null,
          actedAt: now,
        },
      });
      await tx.paymentRequest.update({
        where: { id: step.requestId },
        data: {
          status: "CHANGES_REQUESTED",
          currentApprovalLevel: 0,
        },
      });
    });
  }

  await writeAudit({
    requestId: step.requestId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: needsDigitalSign
      ? "APPROVAL_SIGNED"
      : `APPROVAL_${input.action.toUpperCase()}`,
    entityType: "ApprovalStep",
    entityId: step.id,
    payload: {
      comments: input.comments,
      sequenceNumber: step.sequenceNumber,
      roleRequired: step.roleRequired,
      action: input.action,
      ...(signatureMeta ?? {}),
    },
  });

  return prisma.paymentRequest.findUniqueOrThrow({
    where: { id: step.requestId },
    include: {
      store: { select: { id: true, storeCode: true, storeName: true } },
      requester: { select: { id: true, displayName: true, email: true, role: true } },
      approvalSteps: {
        orderBy: { sequenceNumber: "asc" },
        include: {
          actor: { select: { id: true, displayName: true, email: true, role: true } },
        },
      },
      auditEvents: { orderBy: { createdAt: "desc" }, take: 20 },
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          vendor: { select: { id: true, vendorCode: true, legalName: true, taxId: true } },
        },
      },
      validationResults: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
}

export async function verifyStepSignature(stepId: string) {
  const step = await prisma.approvalStep.findUnique({
    where: { id: stepId },
    include: {
      actor: { select: { id: true, displayName: true, email: true, role: true } },
      request: {
        select: {
          id: true,
          requestNumber: true,
          totalAmount: true,
          currency: true,
          paymentPeriod: true,
        },
      },
    },
  });
  if (!step) throw new AppError(404, "NOT_FOUND", "Approval step not found");

  const decoded = decodeSignatureRecord(step.signatureHash);
  if (!decoded) {
    return {
      stepId: step.id,
      signed: false,
      valid: false,
      reason: step.signatureHash
        ? "Legacy non-verifiable signature hash"
        : "No digital signature on this step",
      step: {
        sequenceNumber: step.sequenceNumber,
        roleRequired: step.roleRequired,
        status: step.status,
        signedAt: step.signedAt,
        actor: step.actor,
      },
      request: step.request,
    };
  }

  const result = await verifyDigitalSignature(step.signatureHash!);
  return {
    stepId: step.id,
    signed: true,
    valid: result.valid,
    reason: result.reason,
    algorithm: decoded.algorithm,
    keyId: decoded.keyId,
    contentHash: decoded.contentHash,
    payload: decoded.payload,
    step: {
      sequenceNumber: step.sequenceNumber,
      roleRequired: step.roleRequired,
      status: step.status,
      signedAt: step.signedAt,
      actor: step.actor,
    },
    request: step.request,
  };
}
