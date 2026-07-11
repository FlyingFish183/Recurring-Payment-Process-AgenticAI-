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
  requireRole("FA"),
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
        include: { bankAccounts: { where: { isActive: true }, take: 5 } },
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
  requireRole("FA"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        vendorCode: z.string().min(1),
        legalName: z.string().min(1),
        taxId: z.string().optional(),
        vendorType: z.enum(["LANDLORD", "UTILITY", "SERVICE", "SUPPLIER", "OTHER"]).default("OTHER"),
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

masterDataRouter.get(
  "/vendors/:id/bank-accounts",
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.id);
    const data = await prisma.bankAccount.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
      select: {
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
        // never return accountNumberEnc decrypted
      },
    });
    res.json({ data });
  }),
);

masterDataRouter.post(
  "/vendors/:id/bank-accounts",
  requireRole("FA"),
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
      select: {
        id: true,
        vendorId: true,
        bankName: true,
        bankCode: true,
        accountName: true,
        accountNumberHash: true,
        isActive: true,
        verificationStatus: true,
      },
    });
    res.status(201).json(account);
  }),
);

// ── Contracts ────────────────────────────────────────────────────────────────

masterDataRouter.get(
  "/contracts",
  asyncHandler(async (req, res) => {
    const query = pagination.extend({
      storeId: z.string().optional(),
      status: z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]).optional(),
    }).parse(req.query);

    const where = {
      ...(query.storeId ? { storeId: query.storeId } : {}),
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
  requireRole("FA"),
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
    });
    res.status(201).json(contract);
  }),
);
