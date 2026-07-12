/**
 * Client-side OCR text → invoice fields (mirrors backend parseInvoiceText).
 */
export function parseInvoiceFromText(raw: string): Record<string, unknown> {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Record<string, unknown> = {};

  const invMatch = raw.match(/\b(INV[- ]?\d{3,})\b/i);
  if (invMatch) out.invoiceNumber = invMatch[1].replace(/\s+/g, "");

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];

    if (!out.invoiceNumber && /^invoice\b/i.test(cur) && next && /INV|\d{4,}/i.test(next)) {
      const m = next.match(/\b(INV[- ]?\d+|\d{4,})\b/i);
      if (m) out.invoiceNumber = m[1].replace(/\s+/g, "");
    }

    if (
      /issued\s*date|invoice\s*date|ngay\s*lap/i.test(cur) ||
      (/^date$/i.test(cur) && next && /^\d{1,2}[\/\-]\d{1,2}/.test(next))
    ) {
      const dateSrc = /[\/\-]/.test(cur) ? cur : next;
      const d = dateSrc?.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
      if (d) {
        const a = Number(d[1]);
        const b = Number(d[2]);
        let y = Number(d[3]);
        if (y < 100) y += 2000;
        const month = a > 12 ? b : a;
        const day = a > 12 ? a : b;
        out.invoiceDate = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }

    if (/balance\s*due|amount\s*due|grand\s*total|total\s*amount|^total$/i.test(cur)) {
      const moneyLine = /[\d]/.test(cur) ? cur : next;
      const amount = parseLooseMoney(moneyLine);
      if (amount != null) out.totalAmount = amount;
    }

    const sameLine = cur.match(
      /(?:balance\s*due|total(?:\s*amount)?|amount\s*due)\s*[:.]?\s*([€$£]?\s*[\d.,]+)/i,
    );
    if (sameLine) {
      const amount = parseLooseMoney(sameLine[1]);
      if (amount != null) out.totalAmount = amount;
    }

    if (/^tax$|vat|thuế/i.test(cur)) {
      const moneyLine = /[\d]/.test(cur) ? cur : next;
      const amount = parseLooseMoney(moneyLine);
      if (amount != null) out.taxAmount = amount;
    }
  }

  const billToIdx = lines.findIndex((l) => /bill\s*to/i.test(l));
  if (billToIdx > 1) {
    const candidate = lines[billToIdx - 1];
    if (candidate && !/invoice|service|date/i.test(candidate)) {
      out.sellerName = candidate;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/^from$/i.test(lines[i]) && lines[i + 1]) {
      out.sellerName = lines[i + 1];
      break;
    }
  }

  const taxMatch = raw.match(/(?:tax\s*id|mst|vat\s*(?:no|number)?)\s*[:.]?\s*(\d[\d\s-]{8,14}\d)/i);
  if (taxMatch) out.taxId = taxMatch[1].replace(/\D/g, "");

  if (typeof out.totalAmount === "number") {
    const tax = typeof out.taxAmount === "number" ? out.taxAmount : 0;
    out.netAmount = Math.max(0, out.totalAmount - tax);
    out.grossAmount = out.totalAmount;
  }

  return out;
}

function parseLooseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, "").match(/([€$£])?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[2]);
  return Number.isFinite(n) ? n : null;
}
