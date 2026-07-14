import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  parseInvoiceFromText,
  scrubStructuredFields,
} from "../utils/parseInvoiceText";
import { applyLineFieldUpdates, fieldsFromStructured } from "./lineFill";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Enrich DocumentExtraction.structuredFields from OCR rawText and
 * auto-fill linked PaymentLine amounts / invoice #.
 */
export async function fillLinesFromExtractions(requestId: string) {
  const docs = await prisma.document.findMany({
    where: { requestId, lineId: { not: null } },
    include: {
      extractions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const updates = [];

  for (const doc of docs) {
    const extraction = doc.extractions[0];
    if (!extraction || !doc.lineId) continue;

    const existing = asRecord(extraction.structuredFields) ?? {};
    scrubStructuredFields(existing);
    const fromText = extraction.rawText
      ? parseInvoiceFromText(extraction.rawText)
      : {};
    // Prefer freshly parsed OCR fields over stale structured blobs
    const structured = scrubStructuredFields({ ...existing, ...fromText });

    await prisma.documentExtraction.update({
      where: { id: extraction.id },
      data: { structuredFields: structured as Prisma.InputJsonValue },
    });

    const update = fieldsFromStructured(doc.lineId, structured);
    if (update) updates.push(update);
  }

  if (updates.length === 0) return 0;
  return applyLineFieldUpdates(updates);
}

/** If lines still have 0 amounts but OCR text exists, fill them (fixes stale totals). */
export async function ensureRequestAmountsFilled(requestId: string) {
  const lines = await prisma.paymentLine.findMany({
    where: { requestId },
    select: { id: true, grossAmount: true },
  });
  const needsFill = lines.some((l) => Number(l.grossAmount) === 0);
  if (!needsFill) return 0;

  const hasExtraction = await prisma.documentExtraction.findFirst({
    where: {
      document: { requestId },
      status: { in: ["SUCCESS", "PARTIAL"] },
      rawText: { not: null },
    },
    select: { id: true },
  });
  if (!hasExtraction) return 0;

  return fillLinesFromExtractions(requestId);
}
