import type { UserRole } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/errors";
import { decryptAccountNumber } from "../utils/bankCrypto";
import { buildMonthlyCoverage, COMPULSORY_EXPENSES } from "./coverage";
import { assertSafeSelectSql } from "./sqlSafety";

const SCHEMA_PROMPT = `You are a PostgreSQL text-to-SQL assistant for KFC Vietnam recurring payments.

Return ONLY a single read-only SQL SELECT (or WITH … SELECT). No explanation, no markdown.

Rules:
- PostgreSQL dialect; snake_case table/column names.
- Never use INSERT/UPDATE/DELETE/DDL.
- Never select account_number_enc. For bank accounts: bank_name, bank_code, account_name, account_number_hash, is_active.
- Stores do NOT own bank accounts. Vendor banks link via: stores → contracts → vendors → bank_accounts.
- Prefer explicit columns. Always LIMIT <= 50 unless a small aggregation.
- payment_period is 'YYYY-MM'. Compulsory expense_type values: RENT, ELECTRICITY, WATER, SERVICE_FEE.
- Rent vendors use contracts.contract_type = 'RENT' (landlord). Utility → UTILITY. Service fee → SERVICE.
- Vendor name filters must be fuzzy: NEVER use legal_name = '…'. Use ILIKE with wildcards, e.g.
  WHERE v.legal_name ILIKE '%saigon property%'
  (ignore case, trailing dots, and Co/Ltd suffixes the user may omit).
- Prefer vendor_code when known (exact, case-insensitive).

Schema:
stores(id, store_code, store_name, cost_center_code, region, address, status)
vendors(id, vendor_code, legal_name, tax_id, vendor_type, status, risk_level)
bank_accounts(id, vendor_id, bank_name, bank_code, account_number_hash, account_name, is_active, verification_status)
contracts(id, contract_number, store_id, vendor_id, contract_type, start_date, end_date, base_amount, currency, status)
payment_requests(id, request_number, store_id, requester_id, payment_period, currency, total_amount, status, current_approval_level, risk_level, created_at)
payment_lines(id, request_id, line_number, expense_type, vendor_id, contract_id, bank_account_id, net_amount, tax_amount, gross_amount, currency, invoice_number, invoice_date, status)
validation_results(id, request_id, line_id, validation_type, severity, message, created_at)
approval_steps(id, request_id, sequence_number, role_required, status, actor_id, acted_at)
documents(id, request_id, line_id, file_name, document_type, processing_status)
payment_records(id, line_id, payment_date, paid_amount, payment_method, reference_no, status)

Example — vendor tax ID by name (fuzzy):
SELECT v.vendor_code, v.legal_name, v.tax_id, v.status, v.vendor_type
FROM vendors v
WHERE v.legal_name ILIKE '%saigon property%'
LIMIT 50;

Example — bank accounts for a store's rent vendor:
SELECT s.store_code, s.store_name, v.vendor_code, v.legal_name, c.contract_type,
       ba.bank_name, ba.bank_code, ba.account_name, ba.account_number_hash, ba.is_active
FROM stores s
JOIN contracts c ON c.store_id = s.id AND c.status = 'ACTIVE' AND c.contract_type = 'RENT'
JOIN vendors v ON v.id = c.vendor_id
JOIN bank_accounts ba ON ba.vendor_id = v.id AND ba.is_active = true
WHERE s.store_code = 'CT001'
LIMIT 50;

Example — monthly lines for a store (paid vs not):
SELECT s.store_code, pr.payment_period, pr.request_number, pr.status AS request_status,
       pl.expense_type, pl.status AS line_status, pl.gross_amount, v.legal_name AS vendor
FROM payment_requests pr
JOIN stores s ON s.id = pr.store_id
JOIN payment_lines pl ON pl.request_id = pr.id
JOIN vendors v ON v.id = pl.vendor_id
WHERE pr.payment_period = '2026-06'
  AND s.store_code = 'HN001'
  AND pr.status <> 'CANCELLED'
ORDER BY pl.expense_type
LIMIT 50;`;

const ANSWER_PROMPT = `You are a finance assistant for KFC Vietnam recurring payments (CA / Cashier).
Given the user's question and the query result JSON, write a clear plain-language answer.
Rules:
- 2–8 short sentences or bullet lines. No markdown fences.
- For bank questions: always state bank name, account name, and the full account number when present (finance needs it to transfer).
- For vendor / tax-ID questions: always state legal name, vendor code, and tax ID when present.
- State what was paid / approved / in review / missing / blocked when relevant.
- Mention store code and period (YYYY-MM) when known.
- If rows are empty, say so and suggest checking store code or period.
- Do not invent amounts or statuses not present in the data.
- Currency is VND unless stated otherwise.`;

const EXPENSE_TO_CONTRACT: Record<string, string> = {
  RENT: "RENT",
  ELECTRICITY: "UTILITY",
  WATER: "UTILITY",
  SERVICE_FEE: "SERVICE",
  MAINTENANCE: "MAINTENANCE",
};

function requireOpenAiKey() {
  if (!env.OPENAI_API_KEY) {
    throw new AppError(
      503,
      "CONFIG_ERROR",
      "OPENAI_API_KEY is not configured on the server",
    );
  }
}

async function openaiChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  temperature = 0,
): Promise<string> {
  requireOpenAiKey();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      temperature,
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AppError(
      502,
      "OPENAI_ERROR",
      `OpenAI request failed (${res.status})`,
      { body: errText.slice(0, 500) },
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new AppError(502, "OPENAI_ERROR", "OpenAI returned empty content");
  }
  return content;
}

function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(jsonSafe);
    if (
      typeof (value as { toFixed?: unknown }).toFixed === "function" &&
      typeof (value as { toString?: unknown }).toString === "function"
    ) {
      return String(value);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonSafe(v);
    }
    return out;
  }
  return value;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function detectStoreCode(question: string): string | undefined {
  return question.match(/\b([A-Za-z]{2,4}\d{2,4})\b/)?.[1]?.toUpperCase();
}

function detectExpenseHint(question: string): string | undefined {
  if (/\brent\b|landlord/i.test(question)) return "RENT";
  if (/\belectric/i.test(question)) return "ELECTRICITY";
  if (/\bwater\b/i.test(question)) return "WATER";
  if (/\bservice\b/i.test(question)) return "SERVICE_FEE";
  return undefined;
}

/** Bank / STK questions must not go to monthly coverage (coverage has no bank rows). */
function detectBankIntent(question: string): {
  storeCode?: string;
  expenseHint?: string;
} | null {
  if (!/\b(bank|account|stk|beneficiary|tài\s*khoản)\b/i.test(question)) {
    return null;
  }
  return {
    storeCode: detectStoreCode(question),
    expenseHint: detectExpenseHint(question),
  };
}

/** Vendor master questions (tax ID, vendor code, legal name). */
function detectVendorIntent(question: string): { nameHint: string } | null {
  if (detectBankIntent(question)) return null;

  const wantsVendorInfo =
    /\b(tax\s*id|mst|vat\s*(?:no|number|id)?|vendor\s*code|legal\s*name|vendor\s*(?:info|detail)|nhà\s*cung\s*cấp)\b/i.test(
      question,
    ) || /\bwho\s+is\s+(?:the\s+)?vendor\b/i.test(question);

  if (!wantsVendorInfo) return null;

  // "tax id of the vendor saigon property co" / "vendor Saigon Property Co tax id"
  const afterVendor =
    question.match(
      /\bvendor\s+(?:named\s+|is\s+|called\s+)?(.+?)(?:\s*[?.!]|$)/i,
    )?.[1] ??
    question.match(
      /\b(?:for|of)\s+(?:the\s+)?(?:vendor\s+)?(.+?)(?:\s*[?.!]|$)/i,
    )?.[1];

  let nameHint = (afterVendor ?? question)
    .replace(
      /\b(give\s+me|what\s+is|what's|show|find|get|the|a|an|tax\s*id|mst|vat|vendor\s*code|legal\s*name|vendor|named|called|of|for|please)\b/gi,
      " ",
    )
    .replace(/[?.!,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Keep a meaningful core (drop trailing Co/Ltd noise for contains search)
  nameHint = nameHint
    .replace(/\b(co\.?|ltd\.?|llc|inc\.?|corp\.?|company)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (nameHint.length < 3) return null;
  return { nameHint };
}

function detectCoverageIntent(question: string): {
  period: string;
  storeCode?: string;
} | null {
  // Bank / vendor lookups are handled separately
  if (detectBankIntent(question) || detectVendorIntent(question)) return null;

  const looksLike =
    /\b(paid|unpaid|missing|coverage|not\s+pay|haven'?t\s+pay|what\s+has|what\s+had|outstanding|completeness|compulsory)\b/i.test(
      question,
    ) ||
    /\b(rent|electricity|water|service\s*fee)\b/i.test(question);

  if (!looksLike) return null;

  const period =
    question.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/)?.[0] ?? currentPeriod();
  return { period, storeCode: detectStoreCode(question) };
}

async function narrateAnswer(
  question: string,
  payload: unknown,
): Promise<string> {
  const truncated = JSON.stringify(payload).slice(0, 12_000);
  return openaiChat(
    [
      { role: "system", content: ANSWER_PROMPT },
      {
        role: "user",
        content: `Question: ${question}\n\nData:\n${truncated}`,
      },
    ],
    0.2,
  );
}

async function runBankLookupChat(input: {
  question: string;
  storeCode?: string;
  expenseHint?: string;
}) {
  const contractType = input.expenseHint
    ? EXPENSE_TO_CONTRACT[input.expenseHint]
    : undefined;

  const stores = await prisma.store.findMany({
    where: input.storeCode
      ? { storeCode: { equals: input.storeCode, mode: "insensitive" } }
      : { status: "ACTIVE" },
    take: input.storeCode ? 1 : 20,
    orderBy: { storeCode: "asc" },
    select: {
      id: true,
      storeCode: true,
      storeName: true,
      region: true,
      contracts: {
        where: {
          status: "ACTIVE",
          ...(contractType
            ? { contractType: contractType as "RENT" | "UTILITY" | "SERVICE" | "MAINTENANCE" | "OTHER" }
            : {}),
        },
        select: {
          contractNumber: true,
          contractType: true,
          baseAmount: true,
          vendor: {
            select: {
              vendorCode: true,
              legalName: true,
              taxId: true,
              vendorType: true,
              bankAccounts: {
                where: { isActive: true },
                select: {
                  bankName: true,
                  bankCode: true,
                  accountName: true,
                  accountNumberEnc: true,
                  accountNumberHash: true,
                  verificationStatus: true,
                },
              },
            },
          },
        },
      },
    },
  });

  type BankRow = {
    store_code: string;
    store_name: string;
    contract_number: string;
    contract_type: string;
    vendor_code: string;
    vendor_name: string;
    bank_name: string | null;
    bank_code: string | null;
    account_name: string | null;
    account_number: string | null;
    account_number_hash: string | null;
    verification_status: string | null;
    note: string | null;
  };

  const rows: BankRow[] = [];
  for (const s of stores) {
    for (const c of s.contracts) {
      const banks = c.vendor.bankAccounts;
      if (banks.length === 0) {
        rows.push({
          store_code: s.storeCode,
          store_name: s.storeName,
          contract_number: c.contractNumber,
          contract_type: c.contractType,
          vendor_code: c.vendor.vendorCode,
          vendor_name: c.vendor.legalName,
          bank_name: null,
          bank_code: null,
          account_name: null,
          account_number: null,
          account_number_hash: null,
          verification_status: null,
          note: "Vendor has no active bank account in master data",
        });
        continue;
      }
      for (const b of banks) {
        rows.push({
          store_code: s.storeCode,
          store_name: s.storeName,
          contract_number: c.contractNumber,
          contract_type: c.contractType,
          vendor_code: c.vendor.vendorCode,
          vendor_name: c.vendor.legalName,
          bank_name: b.bankName,
          bank_code: b.bankCode,
          account_name: b.accountName,
          account_number: decryptAccountNumber(b.accountNumberEnc),
          account_number_hash: `${b.accountNumberHash.slice(0, 12)}…`,
          verification_status: b.verificationStatus,
          note: null,
        });
      }
    }
  }

  const answer = await narrateAnswer(input.question, {
    note: "Stores do not own bank accounts; these are vendor accounts linked via active store contracts.",
    storeCode: input.storeCode ?? null,
    expenseHint: input.expenseHint ?? null,
    rowCount: rows.length,
    rows,
  });

  return {
    question: input.question,
    answer,
    mode: "bank" as const,
    sql: null as string | null,
    rowCount: rows.length,
    rows,
    model: env.OPENAI_MODEL,
  };
}

async function runVendorLookupChat(input: {
  question: string;
  nameHint: string;
}) {
  const tokens = input.nameHint
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 6);

  const vendors = await prisma.vendor.findMany({
    where: {
      OR: [
        { legalName: { contains: input.nameHint, mode: "insensitive" } },
        { vendorCode: { contains: input.nameHint, mode: "insensitive" } },
        ...tokens.map((t) => ({
          legalName: { contains: t, mode: "insensitive" as const },
        })),
      ],
    },
    take: 20,
    orderBy: { legalName: "asc" },
    select: {
      vendorCode: true,
      legalName: true,
      taxId: true,
      vendorType: true,
      status: true,
      riskLevel: true,
    },
  });

  // Prefer rows that match more tokens (e.g. both "saigon" and "property")
  const scored = vendors
    .map((v) => {
      const hay = `${v.legalName} ${v.vendorCode}`.toLowerCase();
      const score = tokens.filter((t) => hay.includes(t.toLowerCase())).length;
      return { v, score };
    })
    .sort((a, b) => b.score - a.score);

  const bestScore = scored[0]?.score ?? 0;
  const filtered =
    bestScore > 0 ? scored.filter((s) => s.score === bestScore) : scored;

  const rows = filtered.map(({ v }) => ({
    vendor_code: v.vendorCode,
    legal_name: v.legalName,
    tax_id: v.taxId,
    vendor_type: v.vendorType,
    status: v.status,
    risk_level: v.riskLevel,
  }));

  const answer = await narrateAnswer(input.question, {
    note: "Vendor master lookup uses case-insensitive partial name / code match.",
    nameHint: input.nameHint,
    rowCount: rows.length,
    rows,
  });

  return {
    question: input.question,
    answer,
    mode: "vendor" as const,
    sql: null as string | null,
    rowCount: rows.length,
    rows,
    model: env.OPENAI_MODEL,
  };
}

async function runCoverageChat(input: {
  question: string;
  actorId: string;
  actorRole: UserRole;
  period: string;
  storeCode?: string;
}) {
  const board = await buildMonthlyCoverage({
    period: input.period,
    userId: input.actorId,
    role: input.actorRole,
  });

  let stores = board.stores;
  if (input.storeCode) {
    stores = stores.filter(
      (s) => s.store.storeCode.toUpperCase() === input.storeCode,
    );
  }

  const rows = stores.flatMap((s) =>
    s.cells.map((c) => ({
      store_code: s.store.storeCode,
      store_name: s.store.storeName,
      period: board.period,
      expense_type: c.expenseType,
      status: c.status,
      gross_amount: c.grossAmount,
      vendor: c.vendorName,
      request_number: c.requestNumber,
      completeness: s.completeness,
    })),
  );

  const compact = {
    period: board.period,
    compulsoryExpenses: COMPULSORY_EXPENSES,
    summary: input.storeCode
      ? {
          storeCode: input.storeCode,
          found: stores.length > 0,
          stores: stores.map((s) => ({
            storeCode: s.store.storeCode,
            storeName: s.store.storeName,
            completeness: s.completeness,
            doneCount: s.doneCount,
            missingCount: s.missingCount,
            cells: s.cells.map((c) => ({
              expenseType: c.expenseType,
              status: c.status,
              grossAmount: c.grossAmount,
              vendorName: c.vendorName,
            })),
          })),
        }
      : board.summary,
    sampleRows: rows.slice(0, 40),
  };

  const answer = await narrateAnswer(input.question, compact);

  return {
    question: input.question,
    answer,
    mode: "coverage" as const,
    sql: null as string | null,
    rowCount: rows.length,
    rows: rows.slice(0, 50),
    model: env.OPENAI_MODEL,
  };
}

async function runSqlChat(question: string) {
  const generated = await openaiChat([
    { role: "system", content: SCHEMA_PROMPT },
    { role: "user", content: question },
  ]);
  const sql = assertSafeSelectSql(generated);

  let rows: unknown[];
  try {
    rows = await prisma.$queryRawUnsafe(sql);
  } catch (err) {
    throw new AppError(
      400,
      "SQL_EXEC_ERROR",
      err instanceof Error ? err.message : "Failed to execute generated SQL",
      { sql },
    );
  }

  const safeRows = (Array.isArray(rows) ? rows : []).map((r) => jsonSafe(r));
  const answer = await narrateAnswer(question, {
    sql,
    rowCount: safeRows.length,
    rows: safeRows.slice(0, 40),
  });

  return {
    question,
    answer,
    mode: "sql" as const,
    sql,
    rowCount: safeRows.length,
    rows: safeRows,
    model: env.OPENAI_MODEL,
  };
}

export async function runAnalyticsChat(input: {
  question: string;
  actorId: string;
  actorRole: UserRole;
}) {
  const question = input.question.trim();
  if (question.length < 3) {
    throw new AppError(400, "VALIDATION_ERROR", "Question is too short");
  }
  if (question.length > 2000) {
    throw new AppError(400, "VALIDATION_ERROR", "Question is too long");
  }

  const bank = detectBankIntent(question);
  const vendor = !bank ? detectVendorIntent(question) : null;
  const coverage =
    !bank && !vendor ? detectCoverageIntent(question) : null;

  const result = bank
    ? await runBankLookupChat({
        question,
        storeCode: bank.storeCode,
        expenseHint: bank.expenseHint,
      })
    : vendor
      ? await runVendorLookupChat({
          question,
          nameHint: vendor.nameHint,
        })
      : coverage
        ? await runCoverageChat({
            question,
            actorId: input.actorId,
            actorRole: input.actorRole,
            period: coverage.period,
            storeCode: coverage.storeCode,
          })
        : await runSqlChat(question);

  await prisma.auditEvent.create({
    data: {
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: "ANALYTICS_CHAT_QUERY",
      entityType: "AnalyticsChat",
      payload: {
        question,
        mode: result.mode,
        sql: result.sql,
        rowCount: result.rowCount,
      },
    },
  });

  return result;
}
