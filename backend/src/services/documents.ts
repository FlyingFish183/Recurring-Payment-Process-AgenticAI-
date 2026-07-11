import type { DocumentType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { buildObjectKey, getPresignedViewUrl, uploadToS3 } from "./s3";
import {
  detectFileFormat,
  s3FolderForFormat,
  sanitizeFilename,
  sha256Buffer,
} from "../utils/files";
import { AppError } from "../utils/errors";

export type DocumentListItem = Prisma.DocumentGetPayload<object>;
export type DocumentWithViewUrl = DocumentListItem & { viewUrl: string | null };

/** Attach a short-lived HTTPS URL so the UI can display/download the file. */
export async function withViewUrl<T extends { storageUri: string }>(
  doc: T,
): Promise<T & { viewUrl: string | null }> {
  const viewUrl = await getPresignedViewUrl(doc.storageUri);
  return { ...doc, viewUrl };
}

export async function withViewUrls<T extends { storageUri: string }>(
  docs: T[],
): Promise<Array<T & { viewUrl: string | null }>> {
  return Promise.all(docs.map((d) => withViewUrl(d)));
}

export type UploadDocumentInput = {
  requestId: string;
  uploadedById: string;
  file: {
    originalname: string;
    mimetype: string;
    buffer: Buffer;
    size: number;
  };
  lineId?: string;
  documentType?: DocumentType;
};

export async function uploadDocumentForRequest(input: UploadDocumentInput) {
  const request = await prisma.paymentRequest.findUnique({
    where: { id: input.requestId },
  });
  if (!request) {
    throw new AppError(404, "NOT_FOUND", "Payment request not found");
  }

  if (input.lineId) {
    const line = await prisma.paymentLine.findFirst({
      where: { id: input.lineId, requestId: input.requestId },
    });
    if (!line) {
      throw new AppError(400, "VALIDATION_ERROR", "lineId does not belong to this request");
    }
  }

  const safeName = sanitizeFilename(input.file.originalname);
  const format = detectFileFormat(safeName, input.file.mimetype);
  // S3 holds the binary; Aurora Document.storageUri stores the object URL.
  // XML = e-invoice · PDF/IMAGE = invoice / supporting scan
  if (format !== "XML" && format !== "PDF" && format !== "IMAGE") {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Only XML (e-invoice), PDF, or image uploads are supported",
    );
  }

  const hash = sha256Buffer(input.file.buffer);
  const folder = s3FolderForFormat(format);
  const key = buildObjectKey(folder, input.requestId, safeName);
  const contentType =
    input.file.mimetype ||
    (format === "XML"
      ? "application/xml"
      : format === "PDF"
        ? "application/pdf"
        : "application/octet-stream");
  const storageUri = await uploadToS3({
    key,
    body: input.file.buffer,
    contentType,
  });

  const documentType: DocumentType = input.documentType ?? "E_INVOICE";

  const document = await prisma.document.create({
    data: {
      requestId: input.requestId,
      lineId: input.lineId,
      fileName: safeName,
      mimeType: input.file.mimetype || "application/octet-stream",
      fileFormat: format,
      storageUri,
      sha256Hash: hash,
      documentType,
      processingStatus: "UPLOADED",
      uploadedById: input.uploadedById,
    },
  });

  // Process queue stub: UPLOADED → QUEUED
  const queued = await prisma.document.update({
    where: { id: document.id },
    data: { processingStatus: "QUEUED" },
  });

  // Move request into EXTRACTING when still draft/ready (lightweight signal)
  if (request.status === "DRAFT" || request.status === "READY") {
    await prisma.paymentRequest.update({
      where: { id: input.requestId },
      data: { status: "EXTRACTING" },
    });
  }

  return queued;
}

export async function queueDocumentProcessing(documentId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new AppError(404, "NOT_FOUND", "Document not found");

  if (doc.processingStatus === "QUEUED" || doc.processingStatus === "PROCESSING") {
    return doc;
  }

  return prisma.document.update({
    where: { id: documentId },
    data: { processingStatus: "QUEUED" },
  });
}
