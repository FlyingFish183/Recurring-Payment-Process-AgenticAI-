import { createHash } from "node:crypto";
import type { Prisma, RiskLevel, ValidationSeverity, ValidationType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  looksLikeDateOnly,
  parseInvoiceFromText,
  scrubStructuredFields,
} from "../utils/parseInvoiceText";

const CONTRACT_AMOUNT_TOLERANCE = 0.15; // 15% either side
const AMOUNT_ANOMALY_MULTIPLIER = 3;
/** Flag if new amount is >50% off store+vendor paid history average (either side) */
const HISTORY_AMOUNT_TOLERANCE = 0.5;
/** Or >2.5× / <1/2.5× the historical average */
const HISTORY_AMOUNT_MULTIPLIER = 2.5;

/** Map payment-line expense → expected contract types. */
const EXPENSE_TO_CONTRACT_TYPES: Record<string, string[]> = {
  RENT: ["RENT"],
  ELECTRICITY: ["UTILITY"],
  WATER: ["UTILITY"],
  SERVICE_FEE: ["SERVICE"],
  MAINTENANCE: ["MAINTENANCE", "SERVICE"],
  OTHER: ["OTHER", "SERVICE", "RENT", "UTILITY", "MAINTENANCE"],
};

type RuleFinding = {
  lineId: string | null;
  validationType: ValidationType;
  severity: ValidationSeverity;
  message: string;
  recommendedAction?: string;
  evidence?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function strField(fields: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!fields) return null;
  for (const key of keys) {
    const v = fields[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const tokensA = na.split(" ").filter((t) => t.length > 2);
  const tokensB = new Set(nb.split(" ").filter((t) => t.length > 2));
  if (tokensA.length === 0 || tokensB.size === 0) return false;
  const overlap = tokensA.filter((t) => tokensB.has(t)).length;
  return overlap / Math.min(tokensA.length, tokensB.size) >= 0.6;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function hashAccount(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/** Compare calendar dates only (ignore timezone time-of-day). */
function dateOnlyUtc(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Pull bank account candidates from labeled OCR fields only (not tax IDs / amounts). */
function extractAccountCandidates(
  rawText: string | null,
  fields: Record<string, unknown> | null,
  excludeDigits: string[] = [],
): string[] {
  const out = new Set<string>();
  const excluded = new Set(excludeDigits.map(digitsOnly).filter((d) => d.length >= 8));

  /** Unlabeled / ambiguous digits — respect exclude list (invoice #, vendor tax ID). */
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const d = digitsOnly(raw);
    if (d.length < 8 || d.length > 20) return;
    if (excluded.has(d)) return;
    out.add(d);
  };

  /**
   * Explicitly labeled account numbers always win.
   * (12-digit STK was previously dropped because tax-ID heuristics also matched it.)
   */
  const addLabeled = (raw: string | null | undefined) => {
    if (!raw) return;
    const d = digitsOnly(raw);
    if (d.length < 8 || d.length > 20) return;
    out.add(d);
  };

  const fromFields = strField(
    fields,
    "bankAccount",
    "accountNumber",
    "bankAccountNumber",
    "stk",
  );
  if (fromFields) addLabeled(fromFields);

  if (rawText) {
    for (const m of rawText.matchAll(
      /(?:account\s*(?:no\.?|number|#)|a\/c\s*(?:no\.?|#)?|stk|số\s*tài\s*khoản|beneficiary(?:\s*account)?)\s*[.:]*\s*([\d\s-]{8,22})/gi,
    )) {
      addLabeled(m[1]);
    }
    // Label on its own line, digits on the next ("Account No.:" then "0011…")
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length - 1; i++) {
      if (
        /^(?:account\s*(?:no\.?|number|#)|a\/c\s*(?:no\.?|#)?|stk|số\s*tài\s*khoản|beneficiary(?:\s*account)?)\s*[.:]*\s*$/i.test(
          lines[i]!,
        )
      ) {
        addLabeled(lines[i + 1]);
      }
    }
  }

  return [...out];
}

function extractTaxIdCandidates(rawText: string | null, fields: Record<string, unknown> | null): string[] {
  const out = new Set<string>();
  const fromFields = strField(fields, "taxId", "sellerTaxId", "mst", "vatNumber");
  if (fromFields) {
    const d = digitsOnly(fromFields);
    if (d.length >= 10) out.add(d);
  }

  // Digits explicitly labeled as bank accounts must not become tax IDs
  const accountDigits = new Set(
    extractAccountCandidates(rawText, fields, []).map(digitsOnly),
  );

  if (rawText) {
    for (const m of rawText.matchAll(
      /(?:tax\s*id|mst|vat\s*(?:no|number)?)\s*[.:]*\s*(\d[\d\s-]{8,14}\d)/gi,
    )) {
      const d = digitsOnly(m[1]);
      if (!accountDigits.has(d)) out.add(d);
    }
    // Only grab unlabeled 10–13 digit runs that are not already a labeled account
    for (const m of rawText.matchAll(/\b(\d{10,13})\b/g)) {
      const d = m[1]!;
      if (!accountDigits.has(d)) out.add(d);
    }
  }
  return [...out];
}

function lineStatusFromSeverity(severity: ValidationSeverity): "PASS" | "WARNING" | "HIGH_RISK" | "BLOCKED" {
  if (severity === "BLOCKING") return "BLOCKED";
  if (severity === "HIGH") return "HIGH_RISK";
  if (severity === "WARNING") return "WARNING";
  return "PASS";
}

function riskFromFindings(findings: RuleFinding[]): RiskLevel {
  if (findings.some((f) => f.severity === "BLOCKING")) return "HIGH";
  if (findings.some((f) => f.severity === "HIGH")) return "HIGH";
  if (findings.some((f) => f.severity === "WARNING")) return "MEDIUM";
  return "LOW";
}

function severityRank(s: ValidationSeverity): number {
  return { INFO: 0, WARNING: 1, HIGH: 2, BLOCKING: 3 }[s];
}

/**
 * Deterministic validation rules after OCR fill.
 * No LLM — compare extracted fields vs vendor / bank / contract / history.
 */
export async function analyzePaymentRequest(requestId: string) {
  const request = await prisma.paymentRequest.findUnique({
    where: { id: requestId },
    include: {
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          vendor: true,
          contract: true,
          bankAccount: true,
          documents: {
            include: { extractions: { orderBy: { createdAt: "desc" }, take: 1 } },
          },
        },
      },
      documents: {
        include: { extractions: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });

  if (!request) {
    throw new Error(`Payment request not found: ${requestId}`);
  }

  await prisma.validationResult.deleteMany({ where: { requestId } });

  const findings: RuleFinding[] = [];

  const vendorIds = [...new Set(request.lines.map((l) => l.vendorId))];
  const historyLines =
    vendorIds.length === 0
      ? []
      : await prisma.paymentLine.findMany({
          where: {
            vendorId: { in: vendorIds },
            request: {
              storeId: request.storeId,
              id: { not: requestId },
              status: { in: ["PAID", "POSTED", "APPROVED", "PAYMENT_PROCESSING"] },
            },
          },
          select: { vendorId: true, grossAmount: true },
        });

  const historyAvgByVendor = new Map<string, { avg: number; count: number }>();
  const historySums = new Map<string, { sum: number; count: number }>();
  for (const h of historyLines) {
    const prev = historySums.get(h.vendorId) ?? { sum: 0, count: 0 };
    prev.sum += Number(h.grossAmount);
    prev.count += 1;
    historySums.set(h.vendorId, prev);
  }
  for (const [vendorId, { sum, count }] of historySums) {
    if (count > 0) historyAvgByVendor.set(vendorId, { avg: sum / count, count });
  }

  const invoiceNumbers = request.lines
    .map((l) => l.invoiceNumber?.trim())
    .filter((n): n is string => Boolean(n));

  const duplicateLines =
    invoiceNumbers.length === 0
      ? []
      : await prisma.paymentLine.findMany({
          where: {
            invoiceNumber: { in: invoiceNumbers },
            requestId: { not: requestId },
            request: { status: { notIn: ["CANCELLED", "DRAFT"] } },
          },
          include: {
            request: {
              select: { requestNumber: true, paymentPeriod: true, status: true },
            },
          },
          take: 50,
        });

  const duplicatesByInvoice = new Map<string, typeof duplicateLines>();
  for (const dup of duplicateLines) {
    if (!dup.invoiceNumber) continue;
    const key = dup.invoiceNumber.trim().toUpperCase();
    const list = duplicatesByInvoice.get(key) ?? [];
    list.push(dup);
    duplicatesByInvoice.set(key, list);
  }

  // Master data for bank / contract rules (vendor + store scoped)
  const [vendorBanks, storeContracts] = await Promise.all([
    vendorIds.length === 0
      ? Promise.resolve([])
      : prisma.bankAccount.findMany({
          where: { vendorId: { in: vendorIds } },
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
          },
        }),
    vendorIds.length === 0
      ? Promise.resolve([])
      : prisma.contract.findMany({
          where: {
            storeId: request.storeId,
            vendorId: { in: vendorIds },
          },
          select: {
            id: true,
            vendorId: true,
            storeId: true,
            contractNumber: true,
            contractType: true,
            baseAmount: true,
            currency: true,
            startDate: true,
            endDate: true,
            status: true,
          },
        }),
  ]);

  const banksByVendor = new Map<string, typeof vendorBanks>();
  for (const b of vendorBanks) {
    const list = banksByVendor.get(b.vendorId) ?? [];
    list.push(b);
    banksByVendor.set(b.vendorId, list);
  }
  const contractsByVendor = new Map<string, typeof storeContracts>();
  for (const c of storeContracts) {
    const list = contractsByVendor.get(c.vendorId) ?? [];
    list.push(c);
    contractsByVendor.set(c.vendorId, list);
  }

  // Intra-request duplicate invoice numbers
  const seenInRequest = new Map<string, string>();
  for (const line of request.lines) {
    const inv = line.invoiceNumber?.trim().toUpperCase();
    if (!inv) continue;
    const prev = seenInRequest.get(inv);
    if (prev) {
      findings.push({
        lineId: line.id,
        validationType: "DUPLICATE",
        severity: "BLOCKING",
        message: `Invoice ${line.invoiceNumber} appears on multiple lines in this request.`,
        recommendedAction: "Remove the duplicate line or correct the invoice number",
        evidence: { otherLineId: prev, invoiceNumber: line.invoiceNumber },
      });
    } else {
      seenInRequest.set(inv, line.id);
    }
  }

  for (const line of request.lines) {
    const lineDoc =
      line.documents[0] ?? request.documents.find((d) => d.lineId === line.id) ?? null;
    const extraction = lineDoc?.extractions[0] ?? null;
    const storedFields = asRecord(extraction?.structuredFields) ?? {};
    const rawText = extraction?.rawText ?? null;
    // Prefer live OCR parse — clears stale bugs (e.g. date stored as sellerName)
    const fromText = rawText ? parseInvoiceFromText(rawText) : {};
    const fields = scrubStructuredFields({ ...storedFields, ...fromText });

    let extractedSeller =
      strField(fields, "sellerName", "vendorName", "supplierName") ?? null;
    if (
      extractedSeller &&
      (looksLikeDateOnly(extractedSeller) || /^INV[- ]?\d+/i.test(extractedSeller))
    ) {
      extractedSeller = null;
    }
    const extractedTaxIds = extractTaxIdCandidates(rawText, fields);
    const extractedBankName = strField(fields, "bankName", "bank");

    // Backfill invoice date on the line when OCR has it but the row was never updated
    const parsedInvoiceDate =
      typeof fields.invoiceDate === "string" ? fields.invoiceDate : null;
    if (!line.invoiceDate && parsedInvoiceDate) {
      const iso = parsedInvoiceDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) {
        const filled = new Date(
          Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])),
        );
        await prisma.paymentLine.update({
          where: { id: line.id },
          data: { invoiceDate: filled },
        });
        line.invoiceDate = filled;
      }
    }

    // Persist cleaned structured fields so UI stops showing the date as seller
    if (extraction && rawText) {
      await prisma.documentExtraction.update({
        where: { id: extraction.id },
        data: {
          structuredFields: fields as Prisma.InputJsonValue,
        },
      });
    }

    // --- DOCUMENT_COMPLETENESS ---
    if (!extraction || extraction.status === "FAILED") {
      findings.push({
        lineId: line.id,
        validationType: "DOCUMENT_COMPLETENESS",
        severity: "HIGH",
        message: "Invoice extraction failed or missing for this line.",
        recommendedAction: "Re-upload the invoice or re-run extract",
        evidence: { extractionStatus: extraction?.status ?? "MISSING" },
      });
    } else {
      const missing: string[] = [];
      if (!line.invoiceNumber?.trim()) missing.push("invoiceNumber");
      if (!line.invoiceDate) missing.push("invoiceDate");
      if (Number(line.grossAmount) <= 0) missing.push("grossAmount");
      if (missing.length > 0) {
        findings.push({
          lineId: line.id,
          validationType: "DOCUMENT_COMPLETENESS",
          severity: missing.includes("grossAmount") ? "HIGH" : "WARNING",
          message: `OCR incomplete — missing: ${missing.join(", ")}.`,
          recommendedAction: "Check invoice quality or enter fields manually",
          evidence: { missing },
        });
      }
    }

    // --- DUPLICATE (cross-request) ---
    const invKey = line.invoiceNumber?.trim().toUpperCase();
    if (invKey) {
      const dups = duplicatesByInvoice.get(invKey) ?? [];
      if (dups.length > 0) {
        findings.push({
          lineId: line.id,
          validationType: "DUPLICATE",
          severity: "BLOCKING",
          message: `Invoice ${line.invoiceNumber} was already processed on ${dups
            .map((d) => d.request.requestNumber)
            .join(", ")}.`,
          recommendedAction: "Confirm this is not a duplicate payment",
          evidence: {
            prior: dups.map((d) => ({
              requestNumber: d.request.requestNumber,
              paymentPeriod: d.request.paymentPeriod,
              status: d.request.status,
              grossAmount: Number(d.grossAmount),
            })),
          },
        });
      }
    }

    // --- VENDOR_MATCH ---
    const vendor = line.vendor;
    const excludeFromBank = [
      // Only hard-exclude known non-account identifiers — not every 10–13 digit OCR run
      // (those wrongly swallowed STK like 001151738492 as a "tax ID").
      ...(vendor.taxId ? [vendor.taxId] : []),
      ...(line.invoiceNumber ? [digitsOnly(line.invoiceNumber)] : []),
    ];
    const extractedAccounts = extractAccountCandidates(
      rawText,
      fields,
      excludeFromBank,
    );
    let vendorOk = true;
    const hasSellerSignal = Boolean(extractedSeller) || extractedTaxIds.length > 0;

    if (!hasSellerSignal && (extraction?.status === "SUCCESS" || extraction?.status === "PARTIAL")) {
      findings.push({
        lineId: line.id,
        validationType: "VENDOR_MATCH",
        severity: "WARNING",
        message: `OCR did not extract a seller name or tax ID to verify against "${vendor.legalName}".`,
        recommendedAction: "Confirm the invoice belongs to the selected vendor",
        evidence: { vendorLegalName: vendor.legalName, vendorTaxId: vendor.taxId },
      });
      vendorOk = false;
    }

    if (extractedSeller && !namesMatch(extractedSeller, vendor.legalName)) {
      vendorOk = false;
      findings.push({
        lineId: line.id,
        validationType: "VENDOR_MATCH",
        severity: "HIGH",
        message: `Extracted seller "${extractedSeller}" does not match vendor "${vendor.legalName}".`,
        recommendedAction: "Verify vendor selection against the invoice",
        evidence: {
          extractedSeller,
          vendorLegalName: vendor.legalName,
          vendorCode: vendor.vendorCode,
        },
      });
    }
    if (vendor.taxId && extractedTaxIds.length > 0) {
      const vendorTax = digitsOnly(vendor.taxId);
      const taxHit = extractedTaxIds.some((t) => t === vendorTax || t.endsWith(vendorTax) || vendorTax.endsWith(t));
      if (!taxHit) {
        vendorOk = false;
        findings.push({
          lineId: line.id,
          validationType: "VENDOR_MATCH",
          severity: "HIGH",
          message: `Extracted tax ID does not match vendor tax ID ${vendor.taxId}.`,
          recommendedAction: "Confirm the invoice belongs to this vendor",
          evidence: { vendorTaxId: vendor.taxId, extractedTaxIds },
        });
      }
    }
    if (vendorOk && hasSellerSignal) {
      findings.push({
        lineId: line.id,
        validationType: "VENDOR_MATCH",
        severity: "INFO",
        message: "Vendor matches extracted invoice seller / tax ID.",
        evidence: { extractedSeller, extractedTaxIds },
      });
    }

    // --- BANK_MATCH (linked account + OCR vs vendor master) ---
    const vendorBankList = banksByVendor.get(line.vendorId) ?? [];
    const activeVendorBanks = vendorBankList.filter((b) => b.isActive);
    const bank = line.bankAccount;
    const extractedAccountHashes = extractedAccounts.map((a) => hashAccount(a));

    if (!bank) {
      if (activeVendorBanks.length === 0) {
        findings.push({
          lineId: line.id,
          validationType: "BANK_MATCH",
          severity: "HIGH",
          message: `No bank account linked, and vendor "${vendor.legalName}" has no active bank account in master data.`,
          recommendedAction: "Add a vendor bank account in Master Data, then re-validate",
          evidence: { vendorId: vendor.id, vendorCode: vendor.vendorCode },
        });
      } else {
        const ocrHit = activeVendorBanks.find((b) =>
          extractedAccountHashes.includes(b.accountNumberHash),
        );
        if (ocrHit) {
          findings.push({
            lineId: line.id,
            validationType: "BANK_MATCH",
            severity: "WARNING",
            message: `No bank account linked on the line, but invoice account matches master account at ${ocrHit.bankName} (${ocrHit.accountName}).`,
            recommendedAction: "Link this bank account on the payment line",
            evidence: {
              suggestedBankAccountId: ocrHit.id,
              bankName: ocrHit.bankName,
              accountName: ocrHit.accountName,
            },
          });
        } else if (extractedAccounts.length > 0) {
          findings.push({
            lineId: line.id,
            validationType: "BANK_MATCH",
            severity: "HIGH",
            message: `Invoice bank account does not match any of ${activeVendorBanks.length} active master account(s) for "${vendor.legalName}".`,
            recommendedAction: "Verify beneficiary details or update vendor bank master data",
            evidence: {
              vendorBankCount: activeVendorBanks.length,
              extractedAccountCount: extractedAccounts.length,
            },
          });
        } else {
          findings.push({
            lineId: line.id,
            validationType: "BANK_MATCH",
            severity: "WARNING",
            message: `No bank account linked on the line (${activeVendorBanks.length} master account(s) available for this vendor).`,
            recommendedAction: "Select the correct vendor bank account before approval",
            evidence: {
              availableBankAccountIds: activeVendorBanks.map((b) => b.id),
            },
          });
        }
      }
    } else {
      const masterBank = vendorBankList.find((b) => b.id === bank.id);
      if (!masterBank || masterBank.vendorId !== line.vendorId) {
        findings.push({
          lineId: line.id,
          validationType: "BANK_MATCH",
          severity: "BLOCKING",
          message: "Linked bank account does not belong to the selected vendor.",
          recommendedAction: "Re-select a bank account owned by this vendor",
          evidence: { bankAccountId: bank.id, vendorId: line.vendorId },
        });
      } else {
        if (!masterBank.isActive) {
          findings.push({
            lineId: line.id,
            validationType: "BANK_MATCH",
            severity: "HIGH",
            message: `Linked bank account at ${masterBank.bankName} is inactive in master data.`,
            recommendedAction: "Switch to an active vendor bank account",
            evidence: { bankAccountId: masterBank.id },
          });
        }

        const invDate = line.invoiceDate;
        if (
          invDate &&
          ((masterBank.validFrom && dateOnlyUtc(invDate) < dateOnlyUtc(masterBank.validFrom)) ||
            (masterBank.validTo && dateOnlyUtc(invDate) > dateOnlyUtc(masterBank.validTo)))
        ) {
          findings.push({
            lineId: line.id,
            validationType: "BANK_MATCH",
            severity: "HIGH",
            message: "Invoice date is outside the linked bank account validity period.",
            recommendedAction: "Use a bank account valid for the invoice date",
            evidence: {
              invoiceDate: formatDateOnly(invDate),
              validFrom: masterBank.validFrom
                ? formatDateOnly(masterBank.validFrom)
                : null,
              validTo: masterBank.validTo ? formatDateOnly(masterBank.validTo) : null,
            },
          });
        }

        if (extractedAccounts.length > 0) {
          const hit = extractedAccountHashes.includes(masterBank.accountNumberHash);
          if (!hit) {
            const otherVendorHit = activeVendorBanks.find(
              (b) =>
                b.id !== masterBank.id &&
                extractedAccountHashes.includes(b.accountNumberHash),
            );
            findings.push({
              lineId: line.id,
              validationType: "BANK_MATCH",
              severity: "HIGH",
              message: otherVendorHit
                ? `Extracted account matches a different master account (${otherVendorHit.bankName} / ${otherVendorHit.accountName}), not the linked one.`
                : `Extracted bank account does not match linked account at ${masterBank.bankName}.`,
              recommendedAction: otherVendorHit
                ? "Switch the line to the matching master bank account"
                : "Verify beneficiary account before approval",
              evidence: {
                linkedBankAccountId: masterBank.id,
                bankName: masterBank.bankName,
                accountName: masterBank.accountName,
                suggestedBankAccountId: otherVendorHit?.id,
                extractedAccountCount: extractedAccounts.length,
              },
            });
          } else {
            findings.push({
              lineId: line.id,
              validationType: "BANK_MATCH",
              severity: "INFO",
              message: "Bank account on invoice matches linked vendor account.",
              evidence: { bankName: masterBank.bankName },
            });
          }
        } else if (
          extractedBankName &&
          !normalizeName(extractedBankName).includes(
            normalizeName(masterBank.bankName).split(" ")[0] ?? "",
          )
        ) {
          findings.push({
            lineId: line.id,
            validationType: "BANK_MATCH",
            severity: "WARNING",
            message: `Extracted bank name "${extractedBankName}" may not match ${masterBank.bankName}.`,
            recommendedAction: "Confirm bank details",
            evidence: {
              extractedBankName,
              linkedBankName: masterBank.bankName,
            },
          });
        } else {
          // No account digits on invoice — cannot prove mismatch; linked master is OK
          findings.push({
            lineId: line.id,
            validationType: "BANK_MATCH",
            severity: "INFO",
            message: `OCR did not extract an account number; using linked account at ${masterBank.bankName} (${masterBank.accountName}).`,
            evidence: {
              bankName: masterBank.bankName,
              accountName: masterBank.accountName,
              verification: "master_link_only",
            },
          });
        }

        const extractedAccountName = strField(
          fields,
          "accountName",
          "beneficiaryName",
          "accountHolder",
        );
        if (
          extractedAccountName &&
          !namesMatch(extractedAccountName, masterBank.accountName)
        ) {
          findings.push({
            lineId: line.id,
            validationType: "BANK_MATCH",
            severity: "WARNING",
            message: `Extracted account name "${extractedAccountName}" does not match master "${masterBank.accountName}".`,
            recommendedAction: "Confirm beneficiary name on the invoice",
            evidence: {
              extractedAccountName,
              masterAccountName: masterBank.accountName,
            },
          });
        }
      }
    }

    // --- CONTRACT rules (presence, ownership, type, amount, date) ---
    const vendorContracts = contractsByVendor.get(line.vendorId) ?? [];
    const activeContracts = vendorContracts.filter((c) => c.status === "ACTIVE");
    const expectedTypes =
      EXPENSE_TO_CONTRACT_TYPES[line.expenseType] ?? EXPENSE_TO_CONTRACT_TYPES.OTHER!;
    const typedActive = activeContracts.filter((c) =>
      expectedTypes.includes(c.contractType),
    );
    let contract = line.contract;
    const gross = Number(line.grossAmount);

    type ContractCheck = {
      id: string;
      contractNumber: string;
      contractType: string;
      baseAmount: { toString(): string } | number;
      startDate: Date;
      endDate: Date | null;
      status: string;
      storeId?: string;
      vendorId?: string;
    };

    // If line has no contract, try soft-match for amount/date checks against typed active contracts
    let contractForChecks: ContractCheck | null = contract;
    let contractIsSuggested = false;
    if (!contractForChecks && typedActive.length === 1) {
      contractForChecks = typedActive[0]!;
      contractIsSuggested = true;
    } else if (!contractForChecks && typedActive.length > 1 && gross > 0) {
      contractForChecks = [...typedActive].sort(
        (a, b) =>
          Math.abs(Number(a.baseAmount) - gross) -
          Math.abs(Number(b.baseAmount) - gross),
      )[0]!;
      contractIsSuggested = true;
    }

    if (!contract) {
      if (activeContracts.length === 0) {
        findings.push({
          lineId: line.id,
          validationType: "CONTRACT_AMOUNT",
          severity: "HIGH",
          message: `No contract linked, and no ACTIVE contract for vendor "${vendor.legalName}" at this store.`,
          recommendedAction: "Create/activate a store–vendor contract in Master Data",
          evidence: {
            storeId: request.storeId,
            vendorId: vendor.id,
            expenseType: line.expenseType,
          },
        });
      } else if (typedActive.length === 0) {
        findings.push({
          lineId: line.id,
          validationType: "CONTRACT_AMOUNT",
          severity: "HIGH",
          message: `No contract linked. Vendor has ${activeContracts.length} active contract(s), but none match expense type ${line.expenseType} (expected ${expectedTypes.join("/")}).`,
          recommendedAction: "Link the correct contract or fix contract type in master data",
          evidence: {
            expenseType: line.expenseType,
            expectedContractTypes: expectedTypes,
            activeContractTypes: activeContracts.map((c) => c.contractType),
          },
        });
      } else {
        findings.push({
          lineId: line.id,
          validationType: "CONTRACT_AMOUNT",
          severity: "WARNING",
          message: `No contract linked on the line. ${typedActive.length} matching active contract(s) found for ${line.expenseType}.`,
          recommendedAction: "Link the correct contract so amount/date rules can run fully",
          evidence: {
            suggestedContractId: contractForChecks?.id,
            suggestedContractNumber: contractForChecks?.contractNumber,
            matchingContracts: typedActive.map((c) => ({
              id: c.id,
              contractNumber: c.contractNumber,
              baseAmount: Number(c.baseAmount),
            })),
          },
        });
      }
    } else {
      const masterContract = vendorContracts.find((c) => c.id === contract!.id);
      if (!masterContract) {
        findings.push({
          lineId: line.id,
          validationType: "CONTRACT_AMOUNT",
          severity: "BLOCKING",
          message: "Linked contract is not an active store–vendor contract for this line.",
          recommendedAction: "Re-select a contract for this store and vendor",
          evidence: { contractId: contract.id, storeId: request.storeId, vendorId: line.vendorId },
        });
        contractForChecks = null;
      } else {
        if (masterContract.vendorId !== line.vendorId || masterContract.storeId !== request.storeId) {
          findings.push({
            lineId: line.id,
            validationType: "CONTRACT_AMOUNT",
            severity: "BLOCKING",
            message: "Linked contract does not belong to this store and vendor.",
            recommendedAction: "Fix the contract link before approval",
            evidence: {
              contractNumber: masterContract.contractNumber,
              contractStoreId: masterContract.storeId,
              contractVendorId: masterContract.vendorId,
            },
          });
        }
        if (masterContract.status !== "ACTIVE") {
          findings.push({
            lineId: line.id,
            validationType: "CONTRACT_DATE",
            severity: "HIGH",
            message: `Linked contract ${masterContract.contractNumber} status is ${masterContract.status}, not ACTIVE.`,
            recommendedAction: "Use an ACTIVE contract",
            evidence: { contractNumber: masterContract.contractNumber, status: masterContract.status },
          });
        }
        if (!expectedTypes.includes(masterContract.contractType)) {
          findings.push({
            lineId: line.id,
            validationType: "CONTRACT_AMOUNT",
            severity: "WARNING",
            message: `Contract type ${masterContract.contractType} may not match expense ${line.expenseType} (expected ${expectedTypes.join("/")}).`,
            recommendedAction: "Confirm the correct contract for this expense",
            evidence: {
              contractType: masterContract.contractType,
              expenseType: line.expenseType,
              expectedContractTypes: expectedTypes,
            },
          });
        }
        contractForChecks = masterContract;
      }
    }

    // --- CONTRACT_AMOUNT ---
    if (contractForChecks && gross > 0) {
      const base = Number(contractForChecks.baseAmount);
      if (base > 0) {
        const delta = Math.abs(gross - base) / base;
        if (delta > CONTRACT_AMOUNT_TOLERANCE) {
          findings.push({
            lineId: line.id,
            validationType: "CONTRACT_AMOUNT",
            severity: delta > 0.5 ? "HIGH" : "WARNING",
            message: `Invoice amount ${gross.toLocaleString()} differs ${(delta * 100).toFixed(0)}% from contract ${contractForChecks.contractNumber} base ${base.toLocaleString()}${contractIsSuggested ? " (suggested match)" : ""}.`,
            recommendedAction: "Confirm amount against contract",
            evidence: {
              gross,
              contractBase: base,
              contractNumber: contractForChecks.contractNumber,
              contractId: contractForChecks.id,
              deltaPct: Math.round(delta * 100),
              suggested: contractIsSuggested,
            },
          });
        } else if (contractIsSuggested) {
          findings.push({
            lineId: line.id,
            validationType: "CONTRACT_AMOUNT",
            severity: "INFO",
            message: `Invoice amount is within tolerance of suggested contract ${contractForChecks.contractNumber}.`,
            evidence: {
              gross,
              contractBase: base,
              contractNumber: contractForChecks.contractNumber,
              suggested: true,
            },
          });
        } else {
          findings.push({
            lineId: line.id,
            validationType: "CONTRACT_AMOUNT",
            severity: "INFO",
            message: `Invoice amount matches contract ${contractForChecks.contractNumber} within tolerance.`,
            evidence: {
              gross,
              contractBase: base,
              contractNumber: contractForChecks.contractNumber,
            },
          });
        }
      }
    }

    // --- CONTRACT_DATE ---
    if (contractForChecks && line.invoiceDate) {
      const inv = line.invoiceDate;
      const invDay = dateOnlyUtc(inv);
      const startDay = dateOnlyUtc(contractForChecks.startDate);
      const endDay = contractForChecks.endDate
        ? dateOnlyUtc(contractForChecks.endDate)
        : null;
      if (invDay < startDay || (endDay != null && invDay > endDay)) {
        findings.push({
          lineId: line.id,
          validationType: "CONTRACT_DATE",
          severity: "HIGH",
          message: `Invoice date ${formatDateOnly(inv)} is outside contract ${contractForChecks.contractNumber} period.`,
          recommendedAction: "Check contract validity dates",
          evidence: {
            invoiceDate: formatDateOnly(inv),
            contractStart: formatDateOnly(contractForChecks.startDate),
            contractEnd: contractForChecks.endDate
              ? formatDateOnly(contractForChecks.endDate)
              : null,
            contractNumber: contractForChecks.contractNumber,
            suggested: contractIsSuggested,
          },
        });
      } else {
        findings.push({
          lineId: line.id,
          validationType: "CONTRACT_DATE",
          severity: "INFO",
          message: `Invoice date ${formatDateOnly(inv)} is within contract ${contractForChecks.contractNumber} period.`,
          evidence: {
            invoiceDate: formatDateOnly(inv),
            contractNumber: contractForChecks.contractNumber,
          },
        });
      }
    }

    // --- AMOUNT_ANOMALY (contract + history, both too high and too low) ---
    if (contractForChecks && gross > 0) {
      const base = Number(contractForChecks.baseAmount);
      if (base > 0) {
        if (gross > base * AMOUNT_ANOMALY_MULTIPLIER) {
          findings.push({
            lineId: line.id,
            validationType: "AMOUNT_ANOMALY",
            severity: "HIGH",
            message: `Amount is more than ${AMOUNT_ANOMALY_MULTIPLIER}× the contract base — possible anomaly.`,
            recommendedAction: "HOD should review before approving",
            evidence: { gross, contractBase: base, direction: "above" },
          });
        } else if (gross < base / AMOUNT_ANOMALY_MULTIPLIER) {
          findings.push({
            lineId: line.id,
            validationType: "AMOUNT_ANOMALY",
            severity: "HIGH",
            message: `Amount is far below contract base (${Math.round(base).toLocaleString()}) — possible wrong invoice or currency.`,
            recommendedAction: "Confirm amount and currency against the contract",
            evidence: { gross, contractBase: base, direction: "below" },
          });
        }
      }
    }

    const hist = historyAvgByVendor.get(line.vendorId);
    if (hist && hist.count >= 2 && gross > 0) {
      const deltaRatio = (gross - hist.avg) / hist.avg;
      const absDelta = Math.abs(deltaRatio);
      const overMultiplier = gross > hist.avg * HISTORY_AMOUNT_MULTIPLIER;
      const underMultiplier = gross < hist.avg / HISTORY_AMOUNT_MULTIPLIER;
      const offTolerance = absDelta > HISTORY_AMOUNT_TOLERANCE;
      if (overMultiplier || underMultiplier || offTolerance) {
        const direction = gross >= hist.avg ? "above" : "below";
        findings.push({
          lineId: line.id,
          validationType: "AMOUNT_ANOMALY",
          severity: overMultiplier || underMultiplier ? "HIGH" : "WARNING",
          message: overMultiplier
            ? `Amount is more than ${HISTORY_AMOUNT_MULTIPLIER}× the ${hist.count}-period paid average (${Math.round(hist.avg).toLocaleString()}).`
            : underMultiplier
              ? `Amount is less than 1/${HISTORY_AMOUNT_MULTIPLIER} of the ${hist.count}-period paid average (${Math.round(hist.avg).toLocaleString()}).`
              : `Amount is ${(absDelta * 100).toFixed(0)}% ${direction} the ${hist.count}-period paid average (${Math.round(hist.avg).toLocaleString()}).`,
          recommendedAction: "Compare against prior months for this store and vendor",
          evidence: {
            gross,
            historyAvg: Math.round(hist.avg),
            historyCount: hist.count,
            deltaPct: Math.round(deltaRatio * 100),
            direction,
          },
        });
      }
    }

    // --- TAX_CHECK ---
    const net = Number(line.netAmount);
    const tax = Number(line.taxAmount);
    if (gross > 0 && Math.abs(net + tax - gross) > 1) {
      findings.push({
        lineId: line.id,
        validationType: "TAX_CHECK",
        severity: "WARNING",
        message: `Net (${net}) + tax (${tax}) does not equal gross (${gross}).`,
        recommendedAction: "Recheck OCR amounts",
        evidence: { net, tax, gross },
      });
    }
  }

  // Persist findings + update line statuses
  const lineWorst = new Map<string, ValidationSeverity>();

  for (const finding of findings) {
    await prisma.validationResult.create({
      data: {
        requestId,
        lineId: finding.lineId,
        validationType: finding.validationType,
        severity: finding.severity,
        message: finding.message,
        recommendedAction: finding.recommendedAction,
        evidence: {
          ...(finding.evidence ?? {}),
          engine: "rules",
        } as Prisma.InputJsonValue,
      },
    });

    if (finding.lineId && finding.severity !== "INFO") {
      const prev = lineWorst.get(finding.lineId);
      if (!prev || severityRank(finding.severity) > severityRank(prev)) {
        lineWorst.set(finding.lineId, finding.severity);
      }
    }
  }

  for (const [lineId, severity] of lineWorst) {
    await prisma.paymentLine.update({
      where: { id: lineId },
      data: {
        status: lineStatusFromSeverity(severity),
        riskScore:
          severity === "BLOCKING"
            ? 1
            : severity === "HIGH"
              ? 0.8
              : severity === "WARNING"
                ? 0.5
                : 0.1,
      },
    });
  }

  for (const line of request.lines) {
    if (!lineWorst.has(line.id)) {
      await prisma.paymentLine.update({
        where: { id: line.id },
        data: { status: "PASS", riskScore: 0.1 },
      });
    }
  }

  const actionable = findings.filter((f) => f.severity !== "INFO");
  const blocked = actionable.some((f) => f.severity === "BLOCKING");
  const riskLevel = riskFromFindings(actionable);

  await prisma.paymentRequest.update({
    where: { id: requestId },
    data: { status: "READY", riskLevel },
  });

  console.log(
    `[validate] ${request.requestNumber} risk=${riskLevel} findings=${actionable.length}` +
      (blocked ? " BLOCKED — hold from approval" : "") +
      " (rules)",
  );

  return {
    ok: true as const,
    overallRisk: riskLevel,
    findings: actionable.length,
    blocked,
    summary: blocked
      ? `Blocked: ${actionable.length} finding(s); not sent to approval`
      : `${actionable.length} rule finding(s); risk ${riskLevel}`,
  };
}
