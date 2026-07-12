import { prisma } from "../lib/prisma";

export type LineFieldUpdate = {
  lineId: string;
  netAmount?: number | null;
  taxAmount?: number | null;
  grossAmount?: number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
};

function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Map XML / structured extraction fields onto a payment line. */
export function fieldsFromStructured(
  lineId: string,
  structured: Record<string, unknown> | null | undefined,
): LineFieldUpdate | null {
  if (!structured) return null;

  const gross =
    parseMoney(structured.totalAmount) ??
    parseMoney(structured.TotalAmount) ??
    parseMoney(structured.grossAmount) ??
    parseMoney(structured.TgTTTBSo);
  const tax =
    parseMoney(structured.taxAmount) ??
    parseMoney(structured.TaxAmount) ??
    parseMoney(structured.TgThue) ??
    0;
  const net =
    parseMoney(structured.netAmount) ??
    (gross != null ? Math.max(0, gross - (tax ?? 0)) : null);

  const invoiceNumber =
    (typeof structured.invoiceNumber === "string" && structured.invoiceNumber) ||
    (typeof structured.InvoiceNumber === "string" && structured.InvoiceNumber) ||
    (typeof structured.SHDon === "string" && structured.SHDon) ||
    null;

  const invoiceDate =
    (typeof structured.invoiceDate === "string" && structured.invoiceDate) ||
    (typeof structured.InvoiceDate === "string" && structured.InvoiceDate) ||
    (typeof structured.NLap === "string" && structured.NLap) ||
    null;

  if (net == null && gross == null && !invoiceNumber && !invoiceDate) return null;

  return {
    lineId,
    netAmount: net,
    taxAmount: tax ?? 0,
    grossAmount: gross ?? (net != null ? net + (tax ?? 0) : null),
    invoiceNumber,
    invoiceDate,
  };
}

export async function applyLineFieldUpdates(updates: LineFieldUpdate[]) {
  if (updates.length === 0) return 0;

  let applied = 0;
  const touchedRequestIds = new Set<string>();

  for (const update of updates) {
    const line = await prisma.paymentLine.findUnique({
      where: { id: update.lineId },
      select: { id: true, requestId: true },
    });
    if (!line) continue;

    const tax = update.taxAmount ?? 0;
    let net = update.netAmount ?? null;
    let gross = update.grossAmount ?? null;

    if (net == null && gross != null) net = Math.max(0, gross - tax);
    if (gross == null && net != null) gross = net + tax;

    const date = parseDate(update.invoiceDate);
    const hasMoney = (net != null && Number.isFinite(net)) || (gross != null && Number.isFinite(gross));
    const hasInvoice = Boolean(update.invoiceNumber || date);
    if (!hasMoney && !hasInvoice) continue;

    await prisma.paymentLine.update({
      where: { id: line.id },
      data: {
        source: "AI_PROPOSED",
        status: "EXTRACTED",
        ...(net != null && Number.isFinite(net) ? { netAmount: net } : {}),
        ...(Number.isFinite(tax) ? { taxAmount: tax } : {}),
        ...(gross != null && Number.isFinite(gross) ? { grossAmount: gross } : {}),
        ...(update.invoiceNumber
          ? { invoiceNumber: update.invoiceNumber.slice(0, 120) }
          : {}),
        ...(date ? { invoiceDate: date } : {}),
      },
    });
    touchedRequestIds.add(line.requestId);
    applied += 1;
  }

  for (const requestId of touchedRequestIds) {
    const agg = await prisma.paymentLine.aggregate({
      where: { requestId, status: { not: "REJECTED" } },
      _sum: { grossAmount: true },
    });
    await prisma.paymentRequest.update({
      where: { id: requestId },
      data: { totalAmount: agg._sum.grossAmount ?? 0 },
    });
  }

  return applied;
}
