/**
 * Heuristic parse of Textract/OCR plain text into invoice fields.
 * Handles split layouts like:
 *   Date:
 *   2026-07-11
 * and same-line:
 *   Issued Date: 7/11/2026
 */

const DATE_LABEL =
  /^(?:issued\s*date|invoice\s*date|inv\.?\s*date|ngay\s*lap|ngày\s*lập|date)\s*[:.]?\s*$/i;
const DATE_LABEL_PREFIX =
  /^(?:issued\s*date|invoice\s*date|inv\.?\s*date|ngay\s*lap|ngày\s*lập|date)\s*[:.]?\s*/i;

/** True if the whole string looks like a calendar date (not a company name). */
export function looksLikeDateOnly(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) return true;
  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(v)) return true;
  return false;
}

/** Parse common invoice date formats → YYYY-MM-DD. */
export function parseInvoiceDateString(src: string): string | null {
  const s = src.trim();
  if (!s) return null;

  // ISO: 2026-07-11 or 2026/07/11
  const iso = s.match(/\b(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  // D/M/Y or M/D/Y: 11/07/2026, 7/11/2026, 11-07-26
  const md = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
  if (md) {
    const a = Number(md[1]);
    const b = Number(md[2]);
    let y = Number(md[3]);
    if (y < 100) y += 2000;
    // If first part > 12 it must be day (D/M/Y); else prefer M/D/Y (US demo invoices)
    const dayFirst = a > 12;
    const month = dayFirst ? b : a;
    const day = dayFirst ? a : b;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && y >= 2000) {
      return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

export function parseInvoiceFromText(raw: string): Record<string, unknown> {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Record<string, unknown> = {};

  const invMatch = raw.match(/\b(INV[- ]?\d{3,})\b/i);
  if (invMatch) out.invoiceNumber = invMatch[1].replace(/\s+/g, "");

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    const next = lines[i + 1];

    // Invoice number: "Invoice No.:" / next line, or "Invoice" / INV-…
    if (!out.invoiceNumber) {
      if (
        /^(?:invoice\s*(?:no|number|#)|inv\.?\s*(?:no|#)?|số\s*h[đd]ơn)\s*[:.]?\s*$/i.test(
          cur,
        ) &&
        next
      ) {
        const m = next.match(/\b(INV[- ]?\d+|\d{4,})\b/i);
        if (m) out.invoiceNumber = m[1]!.replace(/\s+/g, "");
      } else if (/^invoice\b/i.test(cur) && next && /INV|\d{4,}/i.test(next)) {
        const m = next.match(/\b(INV[- ]?\d+|\d{4,})\b/i);
        if (m) out.invoiceNumber = m[1]!.replace(/\s+/g, "");
      } else {
        const same = cur.match(
          /(?:invoice\s*(?:no|number|#)|inv\.?\s*(?:no|#)?)\s*[:.]?\s*(INV[- ]?\d+|\d{4,})/i,
        );
        if (same) out.invoiceNumber = same[1]!.replace(/\s+/g, "");
      }
    }

    // Date: label alone, label+value same line, or "Date:" then next line (ISO or M/D/Y)
    if (!out.invoiceDate) {
      if (DATE_LABEL.test(cur) && next) {
        const parsed = parseInvoiceDateString(next);
        if (parsed) out.invoiceDate = parsed;
      } else if (DATE_LABEL_PREFIX.test(cur)) {
        const rest = cur.replace(DATE_LABEL_PREFIX, "").trim();
        const parsed = parseInvoiceDateString(rest || next || "");
        if (parsed) out.invoiceDate = parsed;
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

  // Seller / bill-from — skip labels, dates, invoice #s, addresses, money
  const isFieldLabel = (c: string): boolean =>
    /:\s*$/.test(c) ||
    DATE_LABEL.test(c) ||
    /^(?:invoice(?:\s*(?:no|number|#))?|inv\.?\s*(?:no|#)?|due\s*date|issued\s*date|date|total|tax|vat|qty|description|unit\s*price|bill\s*to|from|service|address|phone|email|website)\b/i.test(
      c,
    );

  const isPlausibleSeller = (candidate: string): boolean => {
    const c = candidate.trim();
    if (!c) return false;
    if (isFieldLabel(c) || looksLikeDateOnly(c)) return false;
    if (/^INV[- ]?\d+/i.test(c)) return false;
    if (!/[A-Za-zÀ-ỹ]/.test(c)) return false;
    if (/^[\d\s.,€$£₫]+$/.test(c)) return false;
    // Skip street / city address lines (vendor is usually a short company name)
    if (
      /\d{2,}/.test(c) &&
      /(?:street|st\.|blvd|boulevard|road|rd\.|district|city|vietnam|ward)/i.test(c)
    ) {
      return false;
    }
    return true;
  };

  const companyScore = (c: string): number => {
    let score = 0;
    if (/\b(?:co\.?|ltd\.?|llc|inc\.?|corp\.?|company|property|jsc|corp)\b/i.test(c)) {
      score += 3;
    }
    if (c.length >= 6 && c.length <= 80) score += 1;
    if (/^[A-Z]/.test(c)) score += 1;
    return score;
  };

  // Prefer company-looking lines above "Bill To" (common unlabeled header layout)
  const billToIdx = lines.findIndex((l) => /bill\s*to/i.test(l));
  if (billToIdx > 0) {
    let best: { line: string; score: number } | null = null;
    for (let j = billToIdx - 1; j >= 0; j--) {
      const candidate = lines[j]!;
      if (!isPlausibleSeller(candidate)) continue;
      const score = companyScore(candidate);
      if (!best || score > best.score) best = { line: candidate, score };
      // Strong company match near the top of the header block — stop early
      if (score >= 3) break;
    }
    if (best) out.sellerName = best.line;
  }

  // Explicit "From:" / "Vendor:" label
  if (!out.sellerName) {
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i]!;
      const next = lines[i + 1];
      const labeled = cur.match(
        /^(?:from|vendor|seller|supplier|nhà\s*cung\s*cấp)\s*[:.]?\s*(.*)$/i,
      );
      if (labeled) {
        const rest = labeled[1]?.trim();
        const pick = rest && isPlausibleSeller(rest) ? rest : next;
        if (pick && isPlausibleSeller(pick)) {
          out.sellerName = pick;
          break;
        }
      }
    }
  }

  // Common Textract layout: "Invoice" then company name on a nearby line
  if (!out.sellerName) {
    for (let i = 0; i < lines.length; i++) {
      if (!/^invoice\b/i.test(lines[i]!)) continue;
      for (let k = 1; k <= 3; k++) {
        const candidate = lines[i + k];
        if (candidate && isPlausibleSeller(candidate)) {
          out.sellerName = candidate;
          break;
        }
      }
      if (out.sellerName) break;
    }
  }

  // Tax ID / MST
  const taxMatch = raw.match(
    /(?:tax\s*id|mst|vat\s*(?:no|number)?)\s*[:.]?\s*(\d[\d\s-]{8,14}\d)/i,
  );
  if (taxMatch) out.taxId = taxMatch[1]!.replace(/\D/g, "");

  // Bank account (labeled) — handles "Account No.:" (dot + colon) same/next line
  const BANK_ACCT_LABEL =
    /^(?:account\s*(?:no\.?|number|#)|a\/c\s*(?:no\.?|#)?|stk|số\s*tài\s*khoản|beneficiary(?:\s*account)?)\s*[.:]*\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    const next = lines[i + 1];
    if (BANK_ACCT_LABEL.test(cur) && next) {
      const d = digitsOnly(next);
      if (d.length >= 8 && d.length <= 20) {
        out.accountNumber = d;
        break;
      }
    }
    // Same line: "Account No.: 001151738492"
    if (!out.accountNumber) {
      const same = cur.match(
        /(?:account\s*(?:no\.?|number|#)|a\/c\s*(?:no\.?|#)?|stk|số\s*tài\s*khoản|beneficiary(?:\s*account)?)\s*[.:]*\s*([\d\s-]{8,22})/i,
      );
      if (same) {
        const d = digitsOnly(same[1]!);
        if (d.length >= 8 && d.length <= 20) out.accountNumber = d;
      }
    }
  }
  if (!out.accountNumber) {
    const acctMatch = raw.match(
      /(?:account\s*(?:no\.?|number|#)|a\/c\s*(?:no\.?|#)?|stk|số\s*tài\s*khoản|beneficiary(?:\s*account)?)\s*[.:]*\s*([\d\s-]{8,22})/i,
    );
    if (acctMatch) out.accountNumber = acctMatch[1]!.replace(/\D/g, "");
  }

  const bankMatch = raw.match(
    /(?:bank|ngân\s*hàng)\s*[.:]*\s*([A-Za-z][A-Za-z0-9 .&-]{2,40})/i,
  );
  if (bankMatch) out.bankName = bankMatch[1]!.trim();

  const acctNameMatch = raw.match(
    /(?:account\s*name|beneficiary\s*name|tên\s*tài\s*khoản)\s*[.:]*\s*([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ0-9 .,&-]{2,60})/i,
  );
  if (acctNameMatch) out.accountName = acctNameMatch[1]!.trim();

  if (typeof out.totalAmount === "number") {
    const tax = typeof out.taxAmount === "number" ? out.taxAmount : 0;
    out.netAmount = Math.max(0, out.totalAmount - tax);
    out.grossAmount = out.totalAmount;
  }

  return out;
}

/**
 * Repair structured fields when a date was wrongly stored as sellerName
 * (legacy OCR bug). Promotes that value to invoiceDate when missing.
 */
export function scrubStructuredFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  if (
    typeof fields.sellerName === "string" &&
    looksLikeDateOnly(fields.sellerName)
  ) {
    if (!fields.invoiceDate) {
      fields.invoiceDate =
        parseInvoiceDateString(fields.sellerName) ?? fields.sellerName.trim();
    }
    delete fields.sellerName;
  }
  if (
    typeof fields.sellerName === "string" &&
    (/^INV[- ]?\d+/i.test(fields.sellerName.trim()) ||
      /:\s*$/.test(fields.sellerName.trim()) ||
      /^(?:due\s*date|invoice(?:\s*(?:no|number|#))?|date)\b/i.test(
        fields.sellerName.trim(),
      ))
  ) {
    delete fields.sellerName;
  }
  return fields;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function parseLooseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.replace(/,/g, "").match(/([€$£])?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[2]);
  return Number.isFinite(n) ? n : null;
}
