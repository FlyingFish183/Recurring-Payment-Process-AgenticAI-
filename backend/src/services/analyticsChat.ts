import type { UserRole } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/errors";
import { buildMonthlyCoverage, COMPULSORY_EXPENSES } from "./coverage";
import { assertSafeSelectSql } from "./sqlSafety";

const SCHEMA_PROMPT = `You are a PostgreSQL text-to-SQL assistant for KFC Vietnam recurring payments.

Return ONLY a single read-only SQL SELECT (or WITH … SELECT). No explanation, no markdown.

Rules:
- PostgreSQL dialect; snake_case table/column names.
- Never use INSERT/UPDATE/DELETE/DDL.
- Never select account_number_enc. For bank accounts: bank_name, bank_code, account_name, account_number_hash, is_active.
- Stores do NOT own bank accounts. Path: stores → contracts → vendors → bank_accounts.
- Prefer explicit columns. Always LIMIT <= 50 unless a small aggregation.
- payment_period is 'YYYY-MM'. Compulsory expense_type values: RENT, ELECTRICITY, WATER, SERVICE_FEE.
- "Paid" ≈ payment_requests.status = 'PAID' OR payment_lines.status = 'PAID'.
- "Approved / ready to pay" ≈ status IN ('APPROVED','POSTING','POSTED','PAYMENT_PROCESSING').
- "Not paid / outstanding" ≈ status not in ('PAID','CANCELLED') or missing compulsory lines.

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

Example — monthly lines for a store (paid vs not):
SELECT s.store_code, pr.payment_period, pr.request_number, pr.status AS request_status,
       pl.expense_type, pl.status AS line_status, pl.gross_amount, v.legal_name AS vendor
FROM payment_requests pr
JOIN stores s ON s.id = pr.store_id
JOIN payment_lines pl ON pl.request_id = pr.id
JOIN vendors v ON v.id = pl.vendor_id
WHERE pr.payment_period = '2026-06'
  AND (s.store_code = 'HN01' OR s.id = 'xxx')
  AND pr.status <> 'CANCELLED'
ORDER BY pl.expense_type
LIMIT 50;`;

const ANSWER_PROMPT = `You are a finance assistant for KFC Vietnam recurring payments (CA / Cashier).
Given the user's question and the query result JSON, write a clear plain-language answer.
Rules:
- 2–8 short sentences or bullet lines. No markdown fences.
- State what was paid / approved / in review / missing / blocked when relevant.
- Mention store code and period (YYYY-MM) when known.
- If rows are empty, say so and suggest checking store code or period.
- Do not invent amounts or statuses not present in the data.
- Currency is VND unless stated otherwise.`;

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

function detectCoverageIntent(question: string): {
  period: string;
  storeCode?: string;
} | null {
  const looksLike =
    /\b(paid|unpaid|missing|coverage|not\s+pay|haven'?t\s+pay|what\s+has|what\s+had|outstanding|completeness|compulsory)\b/i.test(
      question,
    ) ||
    /\b(rent|electricity|water|service\s*fee)\b/i.test(question);

  if (!looksLike) return null;

  const period =
    question.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/)?.[0] ?? currentPeriod();
  const storeCode = question.match(/\b([A-Za-z]{2,4}\d{2,4})\b/)?.[1]?.toUpperCase();
  return { period, storeCode };
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

  const coverage = detectCoverageIntent(question);
  const result = coverage
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
