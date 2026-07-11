import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { paymentRequestDocumentHandlers } from "./documents";
import { withViewUrls } from "../services/documents";
import { submitPaymentRequestForProcessing } from "../services/submitRequest";
import { AppError } from "../utils/errors";

export const paymentRequestRouter = Router();

paymentRequestRouter.use(authenticate);

const periodSchema = z.string().regex(/^\d{4}-\d{2}$/, "paymentPeriod must be YYYY-MM");

async function recalculateTotal(requestId: string) {
  const agg = await prisma.paymentLine.aggregate({
    where: { requestId, status: { not: "REJECTED" } },
    _sum: { grossAmount: true },
  });
  const total = agg._sum.grossAmount ?? new Prisma.Decimal(0);
  return prisma.paymentRequest.update({
    where: { id: requestId },
    data: { totalAmount: total },
  });
}

const requestInclude = {
  store: { select: { id: true, storeCode: true, storeName: true } },
  requester: { select: { id: true, email: true, displayName: true, role: true } },
  lines: {
    orderBy: { lineNumber: "asc" as const },
    include: {
      vendor: { select: { id: true, vendorCode: true, legalName: true } },
      contract: { select: { id: true, contractNumber: true } },
      bankAccount: {
        select: { id: true, bankName: true, accountName: true, accountNumberHash: true },
      },
    },
  },
};

const lineInputSchema = z.object({
  expenseType: z.enum(["RENT", "ELECTRICITY", "WATER", "SERVICE_FEE", "MAINTENANCE", "OTHER"]),
  vendorId: z.string().min(1),
  contractId: z.string().optional(),
  bankAccountId: z.string().optional(),
  netAmount: z.coerce.number().nonnegative(),
  taxAmount: z.coerce.number().nonnegative().default(0),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.coerce.date().optional(),
  description: z.string().optional(),
});

paymentRequestRouter.post(
  "/",
  requireRole("REQUESTER"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        storeId: z.string().min(1),
        paymentPeriod: periodSchema,
        currency: z.string().default("VND"),
        lines: z.array(lineInputSchema).min(1).optional(),
      })
      .parse(req.body);

    const store = await prisma.store.findUnique({ where: { id: body.storeId } });
    if (!store) throw new AppError(404, "NOT_FOUND", "Store not found");

    if (body.lines?.length) {
      const vendorIds = [...new Set(body.lines.map((l) => l.vendorId))];
      const vendors = await prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true },
      });
      if (vendors.length !== vendorIds.length) {
        throw new AppError(400, "VALIDATION_ERROR", "One or more vendors were not found");
      }
    }

    const count = await prisma.paymentRequest.count();
    const requestNumber = `PR-${body.paymentPeriod.replace("-", "")}-${String(count + 1).padStart(4, "0")}`;

    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.paymentRequest.create({
        data: {
          requestNumber,
          storeId: body.storeId,
          requesterId: req.user!.id,
          paymentPeriod: body.paymentPeriod,
          currency: body.currency,
          status: "DRAFT",
          totalAmount: 0,
        },
      });

      if (body.lines?.length) {
        let total = new Prisma.Decimal(0);
        for (let i = 0; i < body.lines.length; i++) {
          const line = body.lines[i];
          const grossAmount = line.netAmount + line.taxAmount;
          total = total.add(grossAmount);
          await tx.paymentLine.create({
            data: {
              requestId: request.id,
              lineNumber: i + 1,
              expenseType: line.expenseType,
              vendorId: line.vendorId,
              contractId: line.contractId,
              bankAccountId: line.bankAccountId,
              netAmount: line.netAmount,
              taxAmount: line.taxAmount,
              grossAmount,
              invoiceNumber: line.invoiceNumber,
              invoiceDate: line.invoiceDate,
              description: line.description,
              source: "MANUAL",
              status: "DRAFT",
              confirmedById: req.user!.id,
            },
          });
        }
        await tx.paymentRequest.update({
          where: { id: request.id },
          data: { totalAmount: total },
        });
      }

      return tx.paymentRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: requestInclude,
      });
    });

    res.status(201).json(created);
  }),
);

paymentRequestRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(100).default(20),
        storeId: z.string().optional(),
        status: z.string().optional(),
        paymentPeriod: periodSchema.optional(),
      })
      .parse(req.query);

    const where = {
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.paymentPeriod ? { paymentPeriod: query.paymentPeriod } : {}),
    };

    const [data, totalItems] = await Promise.all([
      prisma.paymentRequest.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          store: { select: { id: true, storeCode: true, storeName: true } },
          requester: { select: { id: true, displayName: true, role: true } },
          _count: { select: { lines: true } },
        },
      }),
      prisma.paymentRequest.count({ where }),
    ]);

    res.json({
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    });
  }),
);

paymentRequestRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const request = await prisma.paymentRequest.findUnique({
      where: { id },
      include: {
        ...requestInclude,
        documents: { orderBy: { createdAt: "desc" } },
        validationResults: true,
        approvalSteps: { orderBy: { sequenceNumber: "asc" } },
        auditEvents: { orderBy: { createdAt: "asc" }, take: 100 },
      },
    });
    if (!request) throw new AppError(404, "NOT_FOUND", "Payment request not found");
    const documents = await withViewUrls(request.documents);
    res.json({ ...request, documents });
  }),
);

paymentRequestRouter.post(
  "/:id/documents",
  ...paymentRequestDocumentHandlers.upload,
);

/** Submit for AI extract/validate — enqueues FIFO SQS message for the worker. */
paymentRequestRouter.post(
  "/:id/submit",
  requireRole("REQUESTER"),
  asyncHandler(async (req, res) => {
    const requestId = String(req.params.id);
    const result = await submitPaymentRequestForProcessing({
      requestId,
      requesterId: req.user!.id,
    });
    res.json(result);
  }),
);

paymentRequestRouter.post(
  "/:id/lines",
  requireRole("REQUESTER"),
  asyncHandler(async (req, res) => {
    const requestId = String(req.params.id);
    const body = lineInputSchema.parse(req.body);

    const request = await prisma.paymentRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AppError(404, "NOT_FOUND", "Payment request not found");
    if (
      request.status !== "DRAFT" &&
      request.status !== "CHANGES_REQUESTED" &&
      request.status !== "EXTRACTING" &&
      request.status !== "READY"
    ) {
      throw new AppError(409, "CONFLICT", "Lines can only be added before submit");
    }

    const last = await prisma.paymentLine.findFirst({
      where: { requestId },
      orderBy: { lineNumber: "desc" },
    });
    const lineNumber = (last?.lineNumber ?? 0) + 1;
    const grossAmount = body.netAmount + body.taxAmount;

    const line = await prisma.paymentLine.create({
      data: {
        requestId,
        lineNumber,
        expenseType: body.expenseType,
        vendorId: body.vendorId,
        contractId: body.contractId,
        bankAccountId: body.bankAccountId,
        netAmount: body.netAmount,
        taxAmount: body.taxAmount,
        grossAmount,
        invoiceNumber: body.invoiceNumber,
        invoiceDate: body.invoiceDate,
        description: body.description,
        source: "MANUAL",
        status: "DRAFT",
        confirmedById: req.user!.id,
      },
    });

    const updated = await recalculateTotal(requestId);
    res.status(201).json({ line, totalAmount: updated.totalAmount });
  }),
);
