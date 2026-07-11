import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { authenticate, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { prisma } from "../lib/prisma";
import {
  queueDocumentProcessing,
  uploadDocumentForRequest,
  withViewUrl,
} from "../services/documents";
import { AppError } from "../utils/errors";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

export const documentRouter = Router();

documentRouter.use(authenticate);

const documentTypeSchema = z
  .enum([
    "E_INVOICE",
    "CONTRACT",
    "CONTRACT_APPENDIX",
    "PAYMENT_NOTICE",
    "ACCEPTANCE_RECORD",
    "UTILITY_BILL",
    "SUPPORTING_SCHEDULE",
    "OTHER",
  ])
  .optional();

/** POST /payment-requests/:id/documents — multipart field `file` */
export const paymentRequestDocumentHandlers = {
  upload: [
    requireRole("REQUESTER"),
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const requestId = String(req.params.id);
      if (!req.file) {
        throw new AppError(400, "VALIDATION_ERROR", "Missing file field (multipart name: file)");
      }

      const meta = z
        .object({
          lineId: z.string().optional(),
          documentType: documentTypeSchema,
        })
        .parse(req.body);

      const document = await uploadDocumentForRequest({
        requestId,
        uploadedById: req.user!.id,
        file: req.file,
        lineId: meta.lineId,
        documentType: meta.documentType,
      });

      res.status(201).json(await withViewUrl(document));
    }),
  ],
};

documentRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        extractions: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!document) throw new AppError(404, "NOT_FOUND", "Document not found");
    res.json(await withViewUrl(document));
  }),
);

documentRouter.post(
  "/:id/process",
  requireRole("REQUESTER", "FA"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const document = await queueDocumentProcessing(id);
    res.json(document);
  }),
);
