import type { Document, DocumentExtraction, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  parseInvoiceFromText,
  scrubStructuredFields,
} from "../utils/parseInvoiceText";
import { applyLineFieldUpdates, fieldsFromStructured } from "./lineFill";
import { downloadFromS3 } from "./s3";
import { extractTextWithTextract } from "./textract";

export type ExtractDocumentResult = {
  documentId: string;
  extraction: DocumentExtraction | null;
  ok: boolean;
  error?: string;
};

function xmlToStructuredFields(raw: string): Record<string, unknown> {
  const pick = (tag: string) => {
    const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
    return re.exec(raw)?.[1]?.trim() ?? null;
  };

  return {
    sellerName: pick("SellerLegalName") ?? pick("NBan") ?? pick("SellerName"),
    buyerName: pick("BuyerLegalName") ?? pick("NMua") ?? pick("BuyerName"),
    invoiceNumber: pick("InvoiceNumber") ?? pick("SHDon") ?? pick("InvNo"),
    invoiceDate: pick("InvoiceDate") ?? pick("NLap") ?? pick("InvDate"),
    totalAmount: pick("TotalAmount") ?? pick("TgTTTBSo") ?? pick("Total"),
    taxAmount: pick("TaxAmount") ?? pick("TgThue") ?? pick("VAT"),
    currency: pick("CurrencyCode") ?? pick("DVTTe") ?? "VND",
  };
}

async function extractXmlDocument(doc: Document): Promise<DocumentExtraction> {
  const buf = await downloadFromS3(doc.storageUri);
  const rawText = buf.toString("utf8");
  const structuredFields = xmlToStructuredFields(rawText);

  return prisma.documentExtraction.create({
    data: {
      documentId: doc.id,
      engine: "xml-parser",
      extractionMethod: "XML_RAW",
      rawText,
      structuredFields: structuredFields as Prisma.InputJsonValue,
      pageData: { pages: [{ page: 1, lines: rawText.split(/\r?\n/).slice(0, 200) }] } as Prisma.InputJsonValue,
      confidenceOverall: 1,
      status: "SUCCESS",
    },
  });
}

async function extractWithTextract(doc: Document): Promise<DocumentExtraction> {
  const result = await extractTextWithTextract(doc.storageUri, doc.fileFormat);
  const parsedFields = parseInvoiceFromText(result.rawText);
  const structuredFields = scrubStructuredFields({
    ...result.structuredFields,
    ...parsedFields,
  });

  return prisma.documentExtraction.create({
    data: {
      documentId: doc.id,
      engine: result.engine,
      extractionMethod: result.extractionMethod,
      rawText: result.rawText,
      structuredFields: structuredFields as Prisma.InputJsonValue,
      pageData: result.pageData as Prisma.InputJsonValue,
      confidenceOverall: result.confidenceOverall ?? undefined,
      status: result.rawText.trim() ? "SUCCESS" : "PARTIAL",
    },
  });
}

/** Extract one document and update its processingStatus. */
export async function extractDocument(doc: Document): Promise<ExtractDocumentResult> {
  await prisma.document.update({
    where: { id: doc.id },
    data: { processingStatus: "PROCESSING" },
  });

  try {
    let extraction: DocumentExtraction;

    if (doc.fileFormat === "XML") {
      extraction = await extractXmlDocument(doc);
    } else if (doc.fileFormat === "PDF" || doc.fileFormat === "IMAGE") {
      extraction = await extractWithTextract(doc);
    } else {
      throw new Error(`Unsupported file format: ${doc.fileFormat}`);
    }

    await prisma.document.update({
      where: { id: doc.id },
      data: { processingStatus: "EXTRACTED" },
    });

    // Auto-fill payment line amounts / invoice # from structured extraction when possible
    if (doc.lineId && extraction.structuredFields) {
      const structured =
        extraction.structuredFields && typeof extraction.structuredFields === "object"
          ? (extraction.structuredFields as Record<string, unknown>)
          : null;
      const update = fieldsFromStructured(doc.lineId, structured);
      if (update) await applyLineFieldUpdates([update]);
    }

    return { documentId: doc.id, extraction, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await prisma.documentExtraction.create({
      data: {
        documentId: doc.id,
        engine: doc.fileFormat === "XML" ? "xml-parser" : "textract",
        extractionMethod: "ERROR",
        rawText: null,
        structuredFields: { error: message } as Prisma.InputJsonValue,
        status: "FAILED",
      },
    });

    await prisma.document.update({
      where: { id: doc.id },
      data: { processingStatus: "FAILED" },
    });

    return { documentId: doc.id, extraction: null, ok: false, error: message };
  }
}

/**
 * Process pending documents on a payment request.
 * Always ends with request READY so HOD can review (FAILED docs stay FAILED).
 */
export async function extractDocumentsForRequest(requestId: string) {
  const pending = await prisma.document.findMany({
    where: {
      requestId,
      processingStatus: { in: ["QUEUED", "UPLOADED", "PROCESSING", "FAILED"] },
    },
    orderBy: { createdAt: "asc" },
  });

  const results: ExtractDocumentResult[] = [];
  for (const doc of pending) {
    console.log(`[extract] ${doc.fileName} (${doc.fileFormat})`);
    results.push(await extractDocument(doc));
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  return { results, okCount, failCount, total: results.length };
}
