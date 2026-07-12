import { AppError } from "../utils/errors";

/** Tables the analytics chat may touch. */
export const ALLOWED_TABLES = new Set([
  "stores",
  "vendors",
  "bank_accounts",
  "contracts",
  "payment_requests",
  "payment_lines",
  "validation_results",
  "approval_steps",
  "documents",
  "document_extractions",
  "journal_entries",
  "journal_entry_lines",
  "payment_records",
]);

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|execute|exec|merge|replace|comment|vacuum|analyze|listen|notify|load|outfile|dumpfile|pg_sleep|set_config|pg_read_file|lo_import|into\s+outfile)\b/i;

const SENSITIVE_COLUMNS = /\b(account_number_enc|password|jwt|secret|token)\b/i;

/**
 * Validate LLM SQL: single read-only SELECT/WITH, allowlisted tables, no secrets.
 * Appends LIMIT 50 when missing.
 */
export function assertSafeSelectSql(raw: string): string {
  let sql = raw.trim();
  if (!sql) {
    throw new AppError(400, "VALIDATION_ERROR", "Empty SQL from model");
  }

  // Strip markdown fences if the model wraps them
  sql = sql
    .replace(/^```(?:sql)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Single statement only
  sql = sql.replace(/;+\s*$/, "");
  if (sql.includes(";")) {
    throw new AppError(400, "UNSAFE_SQL", "Multiple SQL statements are not allowed");
  }

  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new AppError(400, "UNSAFE_SQL", "Only SELECT / WITH … SELECT queries are allowed");
  }

  if (FORBIDDEN.test(sql)) {
    throw new AppError(400, "UNSAFE_SQL", "Query contains forbidden keywords");
  }

  if (SENSITIVE_COLUMNS.test(sql)) {
    throw new AppError(
      400,
      "UNSAFE_SQL",
      "Query may not select encrypted or secret columns (e.g. account_number_enc)",
    );
  }

  // Rough FROM / JOIN table extraction (identifiers after FROM/JOIN)
  const tableRefs = [
    ...sql.matchAll(/\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi),
  ].map((m) => m[1]!.toLowerCase());

  if (tableRefs.length === 0) {
    throw new AppError(400, "UNSAFE_SQL", "Could not determine tables in query");
  }

  for (const t of tableRefs) {
    if (!ALLOWED_TABLES.has(t)) {
      throw new AppError(400, "UNSAFE_SQL", `Table "${t}" is not allowed for analytics chat`);
    }
  }

  if (!/\blimit\s+\d+/i.test(sql)) {
    sql = `${sql} LIMIT 50`;
  } else {
    const lim = sql.match(/\blimit\s+(\d+)/i);
    if (lim && Number(lim[1]) > 100) {
      sql = sql.replace(/\blimit\s+\d+/i, "LIMIT 100");
    }
  }

  return sql;
}
