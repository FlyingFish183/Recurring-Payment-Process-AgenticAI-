import { Router } from "express";
import { z } from "zod";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma";
import { authenticate, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { env } from "../config/env";
import { AppError } from "../utils/errors";

export const masterDataRouter = Router();

masterDataRouter.use(authenticate);

/** F&A + Chief Accountant manage vendors / banks / contracts. */
const MASTER_EDITOR = ["FA", "CA"] as const;

const pagination = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

function encryptAccount(plain: string): { enc: string; hash: string } {
  const keyHex =
    env.BANK_ACCOUNT_ENCRYPTION_KEY ??
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const key = Buffer.from(keyHex.slice(0, 64), "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: Buffer.concat([iv, tag, encrypted]).toString("base64"),
    hash: createHash("sha256").update(plain).digest("hex"),
  };
}

const bankAccountSelect = {
  id: true,
  vendorId: true,
  bankName: true,
  bankCode: true,
  accountName: true,
  accountNumberHash: true,
  isActive: true,
  verificationStatus: true,
  validFrom: true,
  validTo: true,
  createdAt: true,
} as const;

// ── Stores ───────────────────────────────────────────────────────────────────

masterDataRouter.get(
  "/stores",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = pagination.parse(req.query);
    const [data, totalItems] = await Promise.all([
      prisma.store.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { storeCode: "asc" },
        select: {
          id: true,
          storeCode: true,
          storeName: true,
          costCenterCode: true,
          region: true,
          address: true,
          status: true,
        },
      }),
      prisma.store.count(),
    ]);
    res.json({
      data,
      pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
    });
  }),
);

masterDataRouter.post(
  "/stores",
  requireRole(...MASTER_EDITOR),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        storeCode: z.string().min(1),
        storeName: z.string().min(1),
        costCenterCode: z.string().optional(),
        region: z.string().optional(),
        address: z.string().optional(),
      })
      .parse(req.body);
    const store = await prisma.store.create({ data: body });
    res.status(201).json(store);
  }),
);

// ── Vendors ──────────────────────────────────────────────────────────────────

masterDataRouter.get(
  "/vendors",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = pagination.parse(req.query);
    const [data, totalItems] = await Promise.all([
      prisma.vendor.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { vendorCode: "asc" },
        select: {
          id: true,
          vendorCode: true,
          legalName: true,
          taxId: true,
          vendorType: true,
          riskLevel: true,
          status: true,
          bankAccounts: {
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
            select: bankAccountSelect,
          },
          _count: { select: { contracts: true, paymentLines: true } },
        },
      }),
      prisma.vendor.count(),
    ]);
    res.json({
      data,
      pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) },
    });
  }),
);

masterDataRouter.post(
  "/vendors",
  requireRole(...MASTER_EDITOR),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        vendorCode: z.string().min(1),
        legalName: z.string().min(1),
        taxId: z.string().optional(),
        vendorType: z
          .enum(["LANDLORD", "UTILITY", "SERVICE", "SUPPLIER", "OTHER"])
          .default("OTHER"),
      })
      .parse(req.body);
    const vendor = await prisma.vendor.create({
      data: {
        ...body,
        normalizedName: body.legalName.trim().toLowerCase(),
      },
    });
    res.status(201).json(vendor);
  }),
);

masterDataRouter.delete(
  "/vendors/:id",
  requireRole(...MASTER_EDITOR),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const vendor = await prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new AppError(404, "NOT_FOUND", "Vendor not found");

    const [lineCount, contractCount] = await Promise.all([
      prisma.paymentLine.count({ where: { vendorId: id } }),
      prisma.contract.count({ where: { vendorId: id } }),
    ]);

    if (lineCount > 0 || contractCount > 0) {
      await prisma.$transaction([
        prisma.vendor.update({
          where: { id },
          data: { status: "INACTIVE" },
        }),
        prisma.bankAccount.updateMany({
          where: { vendorId: id },
          data: { isActive: false },
        }),
        prisma.contract.updateMany({
          where: { vendorId: id, status: "ACTIVE" },
          data: { status: "TERMINATED" },
        }),
      ]);
      res.json({
        id,
        deleted: false,
        deactivated: true,
        reason: "Vendor has payment history or contracts — marked INACTIVE",
      });
      return;
    }

    await prisma.$transaction([
      prisma.bankAccount.deleteMany({ where: { vendorId: id } }),
      prisma.vendor.delete({ where: { id } }),
    ]);
    res.json({ id, deleted: true, deactivated: false });
  }),
);

masterDataRouter.get(
  "/vendors/:id/bank-accounts",
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.id);
    const data = await prisma.bankAccount.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
      select: bankAccountSelect,
    });
    res.json({ data });
  }),
);

masterDataRouter.post(
  "/vendors/:id/bank-accounts",
  requireRole(...MASTER_EDITOR),
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.id);
    const body = z
      .object({
        bankName: z.string().min(1),
        bankCode: z.string().optional(),
        accountNumber: z.string().min(4),
        accountName: z.string().min(1),
      })
      .parse(req.body);

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new AppError(404, "NOT_FOUND", "Vendor not found");

    const { enc, hash } = encryptAccount(body.accountNumber);
    const account = await prisma.bankAccount.create({
      data: {
        vendorId,
        bankName: body.bankName,
        bankCode: body.bankCode,
        accountNumberEnc: enc,
        accountNumberHash: hash,
        accountName: body.accountName,
        isActive: true,
        verificationStatus: "UNVERIFIED",
      },
      select: bankAccountSelect,
    });
    res.status(201).json(account);
  }),
);

masterDataRouter.delete(
  "/bank-accounts/:id",
  requireRole(...MASTER_EDITOR),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const account = await prisma.bankAccount.findUnique({ where: { id } });
    if (!account) throw new AppError(404, "NOT_FOUND", "Bank account not found");

    const used = await prisma.paymentLine.count({ where: { bankAccountId: id } });
    if (used > 0) {
      await prisma.bankAccount.update({
        where: { id },
        data: { isActive: false },
      });
      res.json({
        id,
        deleted: false,
        deactivated: true,
        reason: "Account is used on payment lines — deactivated",
      });
      return;
    }

    await prisma.bankAccount.delete({ where: { id } });
    res.json({ id, deleted: true, deactivated: false });
  }),
);

// ── Contracts ────────────────────────────────────────────────────────────────

masterDataRouter.get(
  "/contracts",
  asyncHandler(async (req, res) => {
    const query = pagination
      .extend({
        storeId: z.string().optional(),
        vendorId: z.string().optional(),
        status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).optional(),
      })
      .parse(req.query);

    const where = {
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, totalItems] = await Promise.all([
      prisma.contract.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { contractNumber: "asc" },
        include: {
          store: { select: { id: true, storeCode: true, storeName: true } },
          vendor: { select: { id: true, vendorCode: true, legalName: true } },
        },
      }),
      prisma.contract.count({ where }),
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

masterDataRouter.post(
  "/contracts",
  requireRole(...MASTER_EDITOR),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        contractNumber: z.string().min(1),
        storeId: z.string().min(1),
        vendorId: z.string().min(1),
        contractType: z.enum(["RENT", "SERVICE", "UTILITY", "MAINTENANCE", "OTHER"]),
        startDate: z.coerce.date(),
        endDate: z.coerce.date().optional(),
        baseAmount: z.coerce.number().nonnegative(),
        currency: z.string().default("VND"),
        billingRules: z.record(z.unknown()).optional(),
      })
      .parse(req.body);

    const contract = await prisma.contract.create({
      data: {
        contractNumber: body.contractNumber,
        storeId: body.storeId,
        vendorId: body.vendorId,
        contractType: body.contractType,
        startDate: body.startDate,
        endDate: body.endDate,
        baseAmount: body.baseAmount,
        currency: body.currency,
        billingRules: body.billingRules as object | undefined,
        status: "ACTIVE",
        currentVersion: 1,
      },
      include: {
        store: { select: { id: true, storeCode: true, storeName: true } },
        vendor: { select: { id: true, vendorCode: true, legalName: true } },
      },
    });
    res.status(201).json(contract);
  }),
);

masterDataRouter.delete(
  "/contracts/:id",
  requireRole(...MASTER_EDITOR),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const contract = await prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new AppError(404, "NOT_FOUND", "Contract not found");

    const used = await prisma.paymentLine.count({ where: { contractId: id } });
    if (used > 0) {
      await prisma.contract.update({
        where: { id },
        data: { status: "TERMINATED" },
      });
      res.json({
        id,
        deleted: false,
        deactivated: true,
        reason: "Contract is used on payment lines — marked TERMINATED",
      });
      return;
    }

    await prisma.contract.delete({ where: { id } });
    res.json({ id, deleted: true, deactivated: false });
  }),
);
