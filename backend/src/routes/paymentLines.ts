import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { AppError } from "../utils/errors";

export const paymentLineRouter = Router();

paymentLineRouter.use(authenticate);

async function recalculateTotal(requestId: string) {
  const agg = await prisma.paymentLine.aggregate({
    where: { requestId, status: { not: "REJECTED" } },
    _sum: { grossAmount: true },
  });
  return prisma.paymentRequest.update({
    where: { id: requestId },
    data: { totalAmount: agg._sum.grossAmount ?? new Prisma.Decimal(0) },
  });
}

paymentLineRouter.patch(
  "/:id",
  requireRole("REQUESTER"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const body = z
      .object({
        expenseType: z.enum(["RENT", "ELECTRICITY", "WATER", "SERVICE_FEE", "MAINTENANCE", "OTHER"]).optional(),
        vendorId: z.string().optional(),
        contractId: z.string().nullable().optional(),
        bankAccountId: z.string().nullable().optional(),
        netAmount: z.coerce.number().nonnegative().optional(),
        taxAmount: z.coerce.number().nonnegative().optional(),
        invoiceNumber: z.string().nullable().optional(),
        invoiceDate: z.coerce.date().nullable().optional(),
        description: z.string().nullable().optional(),
      })
      .parse(req.body);

    const existing = await prisma.paymentLine.findUnique({
      where: { id },
      include: { request: true },
    });
    if (!existing) throw new AppError(404, "NOT_FOUND", "Payment line not found");
    if (existing.request.status !== "DRAFT" && existing.request.status !== "CHANGES_REQUESTED") {
      throw new AppError(409, "CONFLICT", "Lines can only be edited before submit");
    }

    const net = body.netAmount ?? Number(existing.netAmount);
    const tax = body.taxAmount ?? Number(existing.taxAmount);

    const line = await prisma.paymentLine.update({
      where: { id },
      data: {
        expenseType: body.expenseType,
        vendorId: body.vendorId,
        contractId: body.contractId === undefined ? undefined : body.contractId,
        bankAccountId: body.bankAccountId === undefined ? undefined : body.bankAccountId,
        netAmount: body.netAmount,
        taxAmount: body.taxAmount,
        grossAmount: net + tax,
        invoiceNumber: body.invoiceNumber === undefined ? undefined : body.invoiceNumber,
        invoiceDate: body.invoiceDate === undefined ? undefined : body.invoiceDate,
        description: body.description === undefined ? undefined : body.description,
        confirmedById: req.user!.id,
      },
    });

    const updated = await recalculateTotal(existing.requestId);
    res.json({ line, totalAmount: updated.totalAmount });
  }),
);
