"use client";

import type { ReactNode } from "react";
import { formatVnd } from "@/lib/format";
import { parseInvoiceFromText } from "@/lib/parseInvoiceText";
import type {
  Document,
  DocumentExtraction,
  PaymentLine,
  ValidationResult,
} from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

type Props = {
  lines: PaymentLine[];
  documents: Document[];
  validations?: ValidationResult[];
  selectedLineId: string | null;
  onSelectLine: (lineId: string | null) => void;
  canUpload: boolean;
  uploading: boolean;
  uploadFile: File | null;
  onUploadFileChange: (file: File | null) => void;
  onUpload: () => void;
  emptyHint?: string;
};

type ExtractedSummary = {
  sellerName?: string;
  taxId?: string;
  invoiceNumber?: string;
  totalAmount?: string;
  netAmount?: string;
  invoiceDate?: string;
  taxAmount?: string;
  currency?: string;
  lineCount?: number;
  preview?: string;
  confidence?: number | null;
  status?: string;
  engine?: string;
};

type MatchTone = "ok" | "warn" | "danger" | "neutral";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickString(
  fields: Record<string, unknown> | null,
  keys: string[],
): string | undefined {
  if (!fields) return undefined;
  for (const key of keys) {
    const v = fields[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
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
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const tokensA = na.split(" ").filter((t) => t.length > 2);
  const tokensB = new Set(nb.split(" ").filter((t) => t.length > 2));
  if (tokensA.length === 0 || tokensB.size === 0) return false;
  const overlap = tokensA.filter((t) => tokensB.has(t)).length;
  return overlap / Math.min(tokensA.length, tokensB.size) >= 0.6;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function latestExtraction(doc: Document | undefined): DocumentExtraction | null {
  return doc?.extractions?.[0] ?? null;
}

function summarizeExtraction(extraction: DocumentExtraction | null): ExtractedSummary | null {
  if (!extraction) return null;
  const fromText = extraction.rawText ? parseInvoiceFromText(extraction.rawText) : {};
  const fields = {
    ...fromText,
    ...(asRecord(extraction.structuredFields) ?? {}),
  };
  const sellerName = pickString(fields, [
    "sellerName",
    "SellerLegalName",
    "vendorName",
    "NBan",
  ]);
  const taxId = pickString(fields, ["taxId", "sellerTaxId", "mst", "vatNumber", "TaxCode"]);
  const invoiceNumber = pickString(fields, [
    "invoiceNumber",
    "InvoiceNumber",
    "InvNo",
    "SHDon",
  ]);
  const totalAmount = pickString(fields, [
    "totalAmount",
    "TotalAmount",
    "grossAmount",
    "TgTTTBSo",
    "Total",
  ]);
  const taxAmount = pickString(fields, ["taxAmount", "TaxAmount", "TgThue", "VAT"]);
  const netAmount = pickString(fields, ["netAmount", "NetAmount"]);
  const invoiceDate = pickString(fields, [
    "invoiceDate",
    "InvoiceDate",
    "InvDate",
    "NLap",
  ]);
  const currency = pickString(fields, ["currency", "CurrencyCode", "DVTTe"]);
  const lineCount =
    typeof fields.lineCount === "number"
      ? fields.lineCount
      : Array.isArray(fields.lines)
        ? fields.lines.length
        : undefined;

  const preview = (extraction.rawText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");

  return {
    sellerName,
    taxId,
    invoiceNumber,
    totalAmount,
    netAmount,
    taxAmount,
    invoiceDate,
    currency,
    lineCount,
    preview: preview || undefined,
    confidence: extraction.confidenceOverall,
    status: extraction.status,
    engine: extraction.engine,
  };
}

function formatIcon(format: string): string {
  if (format === "XML") return "XML";
  if (format === "PDF") return "PDF";
  if (format === "IMAGE") return "IMG";
  return "DOC";
}

function worstSeverity(findings: ValidationResult[]): string | null {
  const order = ["INFO", "WARNING", "HIGH", "BLOCKING"];
  let worst: string | null = null;
  for (const f of findings) {
    if (f.severity === "INFO") continue;
    if (!worst || order.indexOf(f.severity) > order.indexOf(worst)) {
      worst = f.severity;
    }
  }
  return worst;
}

function Field({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: MatchTone;
  hint?: string;
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50/60"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50"
        : tone === "danger"
          ? "border-red-300 bg-red-50"
          : "border-transparent bg-transparent";
  const valueClass =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";

  return (
    <div className={`rounded border px-2 py-1.5 ${toneClass}`}>
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-medium ${valueClass}`}>{value ?? "—"}</div>
      {hint ? <p className="mt-0.5 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}

function ExtractionChips({
  summary,
  findingCount,
  worst,
}: {
  summary: ExtractedSummary;
  findingCount: number;
  worst: string | null;
}) {
  const chips = [
    summary.invoiceNumber ? `Inv ${summary.invoiceNumber}` : null,
    summary.sellerName,
    summary.totalAmount
      ? summary.currency
        ? `${summary.totalAmount} ${summary.currency}`
        : summary.totalAmount
      : null,
    summary.status ? `OCR ${summary.status}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded border border-line bg-paper px-2 py-0.5 text-xs text-muted"
        >
          {chip}
        </span>
      ))}
      {findingCount > 0 && worst ? (
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
            worst === "BLOCKING" || worst === "HIGH"
              ? "bg-red-100 text-danger"
              : "bg-amber-100 text-warn"
          }`}
        >
          {findingCount} alert{findingCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

function LineDocuments({ docs }: { docs: Document[] }) {
  if (docs.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-3">
      {docs.map((doc) => (
        <li
          key={doc.id}
          className="min-w-[10rem] max-w-xs overflow-hidden rounded border border-line bg-paper"
        >
          {doc.fileFormat === "IMAGE" && doc.viewUrl ? (
            <a
              href={doc.viewUrl}
              target="_blank"
              rel="noreferrer"
              className="block bg-ink/5"
              onClick={(e) => e.stopPropagation()}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={doc.viewUrl}
                alt={doc.fileName}
                className="max-h-40 w-full object-contain"
              />
            </a>
          ) : doc.fileFormat === "PDF" && doc.viewUrl ? (
            <a
              href={doc.viewUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-24 items-center justify-center bg-ink/5 text-sm font-semibold text-kfc hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Open PDF
            </a>
          ) : (
            <div className="flex h-14 items-center justify-center bg-ink/5">
              <span className="rounded bg-ink px-2 py-1 text-[10px] font-bold tracking-wide text-white">
                {formatIcon(doc.fileFormat)}
              </span>
            </div>
          )}
          <div className="flex items-start justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{doc.fileName}</div>
              <div className="text-xs text-muted">
                {doc.fileFormat} · {doc.processingStatus}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OcrCompareRow({
  label,
  expected,
  extracted,
  tone,
  note,
}: {
  label: string;
  expected: string;
  extracted: string;
  tone: MatchTone;
  note: string;
}) {
  const border =
    tone === "ok"
      ? "border-emerald-300 bg-emerald-50"
      : tone === "warn"
        ? "border-amber-400 bg-amber-50"
        : tone === "danger"
          ? "border-red-400 bg-red-50"
          : "border-line bg-paper";
  const badge =
    tone === "ok"
      ? "Match"
      : tone === "warn"
        ? "Missing"
        : tone === "danger"
          ? "Mismatch"
          : "—";

  return (
    <div className={`rounded border px-3 py-2.5 ${border}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">
          {label}
        </span>
        <StatusBadge status={badge.toUpperCase().replace(" ", "_")} />
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold tracking-wide text-muted uppercase">
            Selected vendor
          </div>
          <div className="mt-0.5 text-sm font-medium text-ink">{expected}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold tracking-wide text-muted uppercase">
            From OCR
          </div>
          <div
            className={`mt-0.5 text-sm font-medium ${
              tone === "danger"
                ? "text-danger"
                : tone === "warn"
                  ? "text-warn"
                  : "text-ink"
            }`}
          >
            {extracted}
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted">{note}</p>
    </div>
  );
}

function LineDetailPanel({
  line,
  docs,
  extraction,
  summary,
  findings,
  canUpload,
  needsUpload,
  uploading,
  uploadFile,
  onUploadFileChange,
  onUpload,
}: {
  line: PaymentLine;
  docs: Document[];
  extraction: DocumentExtraction | null;
  summary: ExtractedSummary | null;
  findings: ValidationResult[];
  canUpload: boolean;
  needsUpload: boolean;
  uploading: boolean;
  uploadFile: File | null;
  onUploadFileChange: (file: File | null) => void;
  onUpload: () => void;
}) {
  const rawPreview = (extraction?.rawText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12);

  const invoiceNumber = line.invoiceNumber || summary?.invoiceNumber || null;
  const invoiceDate = line.invoiceDate
    ? new Date(line.invoiceDate).toLocaleDateString()
    : summary?.invoiceDate || null;
  const uniqueFindings = findings.filter(
    (f, i, arr) =>
      arr.findIndex(
        (x) => x.validationType === f.validationType && x.message === f.message,
      ) === i,
  );
  const actionable = uniqueFindings.filter((f) => f.severity !== "INFO");
  const infoOnly = uniqueFindings.filter((f) => f.severity === "INFO");

  const vendorName = line.vendor?.legalName ?? "";
  const vendorTax = line.vendor?.taxId ?? "";
  const sellerTone: MatchTone = !summary
    ? "neutral"
    : !summary.sellerName
      ? "warn"
      : vendorName && namesMatch(summary.sellerName, vendorName)
        ? "ok"
        : "danger";
  const taxTone: MatchTone = !summary
    ? "neutral"
    : !summary.taxId
      ? vendorTax
        ? "warn"
        : "neutral"
      : vendorTax &&
          (digitsOnly(summary.taxId) === digitsOnly(vendorTax) ||
            digitsOnly(summary.taxId).endsWith(digitsOnly(vendorTax)))
        ? "ok"
        : "danger";

  const contractBase = line.contract?.baseAmount
    ? Number(line.contract.baseAmount)
    : null;
  const gross = Number(line.grossAmount);
  const amountTone: MatchTone =
    contractBase && contractBase > 0 && gross > 0
      ? Math.abs(gross - contractBase) / contractBase > 0.15
        ? Math.abs(gross - contractBase) / contractBase > 0.5
          ? "danger"
          : "warn"
        : "ok"
      : "neutral";

  return (
    <div className="mt-2 space-y-4 rounded border border-line bg-surface p-4">
      {actionable.length > 0 ? (
        <div
          className={`rounded border px-4 py-3 ${
            actionable.some((f) => f.severity === "BLOCKING" || f.severity === "HIGH")
              ? "border-red-300 bg-red-50"
              : "border-amber-300 bg-amber-50"
          }`}
          role="alert"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold text-ink">
              Validation alerts
            </h3>
            <span className="text-sm text-muted">
              {actionable.length} issue{actionable.length === 1 ? "" : "s"} need review
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {actionable.map((f) => (
              <li
                key={f.id}
                className="rounded border border-white/60 bg-white/70 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={f.severity} />
                  <span className="text-sm font-semibold">
                    {f.validationType.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink">{f.message}</p>
                {f.recommendedAction ? (
                  <p className="mt-1 text-xs font-medium text-muted">
                    → {f.recommendedAction}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : extraction ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-ok">
          No blocking validation issues on this line.
        </div>
      ) : null}

      <div>
        <h3 className="font-display text-lg font-semibold">Line details</h3>
        <p className="mt-0.5 text-sm text-muted">
          Requester selections vs amounts filled from OCR.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Expense" value={line.expenseType.replaceAll("_", " ")} />
        <Field
          label="Vendor"
          value={
            line.vendor
              ? `${line.vendor.vendorCode} — ${line.vendor.legalName}`
              : line.vendorId
          }
        />
        <Field label="Tax ID (master)" value={line.vendor?.taxId ?? "—"} />
        <Field
          label="Gross"
          value={
            gross > 0
              ? formatVnd(line.grossAmount)
              : summary?.totalAmount
                ? formatVnd(Number(summary.totalAmount))
                : "Pending OCR"
          }
          tone={amountTone}
          hint={
            contractBase && amountTone !== "neutral" && amountTone !== "ok"
              ? `Contract base ${formatVnd(contractBase)}`
              : undefined
          }
        />
        <Field
          label="Net"
          value={
            Number(line.netAmount) > 0
              ? formatVnd(line.netAmount)
              : summary?.netAmount
                ? formatVnd(Number(summary.netAmount))
                : summary?.totalAmount
                  ? formatVnd(Number(summary.totalAmount))
                  : "Pending OCR"
          }
        />
        <Field
          label="Tax"
          value={
            Number(line.taxAmount) > 0 || !summary?.taxAmount
              ? formatVnd(line.taxAmount)
              : formatVnd(Number(summary.taxAmount))
          }
        />
        <Field label="Invoice #" value={invoiceNumber ?? "—"} />
        <Field label="Invoice date" value={invoiceDate ?? "—"} />
        <Field label="Contract" value={line.contract?.contractNumber ?? "—"} />
        <Field
          label="Bank"
          value={
            line.bankAccount
              ? `${line.bankAccount.bankName} · ${line.bankAccount.accountName}`
              : "—"
          }
        />
        <Field label="Description" value={line.description ?? "—"} />
      </div>

      {extraction ? (
        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-display text-base font-semibold">
              OCR vs selected vendor
            </h4>
            <div className="flex items-center gap-2">
              <StatusBadge status={extraction.status} />
              <span className="text-xs text-muted">
                {extraction.engine}
                {extraction.confidenceOverall != null
                  ? ` · ${extraction.confidenceOverall.toFixed(0)}% conf`
                  : ""}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <OcrCompareRow
              label="Seller name"
              expected={vendorName || "—"}
              extracted={summary?.sellerName ?? "Not found in OCR"}
              tone={sellerTone}
              note={
                sellerTone === "ok"
                  ? "OCR seller matches the vendor you selected."
                  : sellerTone === "warn"
                    ? "Seller not found on the invoice — cannot auto-verify vendor."
                    : "OCR seller does not match the selected vendor."
              }
            />
            <OcrCompareRow
              label="Tax ID"
              expected={vendorTax || "—"}
              extracted={summary?.taxId ?? "Not found in OCR"}
              tone={taxTone}
              note={
                taxTone === "ok"
                  ? "Tax ID matches vendor master data."
                  : taxTone === "warn"
                    ? "No tax ID extracted — verify manually against the vendor."
                    : "Extracted tax ID does not match the selected vendor."
              }
            />
            {contractBase != null && gross > 0 ? (
              <OcrCompareRow
                label="Amount vs contract"
                expected={formatVnd(contractBase)}
                extracted={formatVnd(gross)}
                tone={amountTone}
                note={
                  amountTone === "ok"
                    ? "Within 15% of contract base."
                    : `Invoice amount differs from contract base ${formatVnd(contractBase)}.`
                }
              />
            ) : null}
          </div>

          {rawPreview.length > 0 ? (
            <div className="rounded border border-line bg-paper px-3 py-2">
              <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                Text preview
              </div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs text-ink">
                {rawPreview.join("\n")}
              </pre>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">
          No extraction yet. Submit the request so the worker can run Textract.
        </p>
      )}

      {infoOnly.length > 0 ? (
        <div className="border-t border-line pt-3">
          <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">
            Passed checks
          </h4>
          <ul className="mt-2 space-y-1">
            {infoOnly.map((f) => (
              <li key={f.id} className="text-xs text-muted">
                {f.validationType.replaceAll("_", " ")} — {f.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <LineDocuments docs={docs} />

      {canUpload && needsUpload ? (
        <div className="rounded border border-dashed border-kfc/40 px-4 py-3">
          <p className="text-sm font-medium">Upload document for this line</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".xml,.pdf,image/*,application/pdf,application/xml,text/xml"
              className="max-w-full text-sm"
              onChange={(e) => onUploadFileChange(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              disabled={uploading || !uploadFile}
              onClick={onUpload}
              className="rounded bg-kfc px-4 py-2 text-sm font-semibold text-white hover:bg-kfc-dark disabled:opacity-60"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PaymentLineGrid({
  lines,
  documents,
  validations = [],
  selectedLineId,
  onSelectLine,
  canUpload,
  uploading,
  uploadFile,
  onUploadFileChange,
  onUpload,
  emptyHint,
}: Props) {
  if (lines.length === 0) {
    return (
      <div className="rounded border border-dashed border-line bg-surface px-4 py-10 text-center text-muted">
        {emptyHint ?? "No payment lines yet."}
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {lines.map((line) => {
        const docs = documents.filter((d) => d.lineId === line.id);
        const primaryDoc = docs[0];
        const extraction = latestExtraction(primaryDoc);
        const summary = summarizeExtraction(extraction);
        const findings = validations.filter(
          (v) => v.lineId === line.id || (v.lineId == null && selectedLineId === line.id),
        );
        const lineFindings = validations.filter((v) => v.lineId === line.id);
        const actionableFindings = lineFindings.filter((v) => v.severity !== "INFO");
        const worst = worstSeverity(lineFindings);
        const selected = selectedLineId === line.id;
        const needsUpload = docs.length === 0;
        const alertBorder =
          worst === "BLOCKING" || worst === "HIGH"
            ? selected
              ? "border-red-500 bg-red-50/50 ring-1 ring-red-300"
              : "border-red-300 bg-red-50/30 hover:border-red-400"
            : worst === "WARNING"
              ? selected
                ? "border-amber-500 bg-amber-50/50 ring-1 ring-amber-300"
                : "border-amber-300 bg-amber-50/30 hover:border-amber-400"
              : selected
                ? "border-kfc bg-red-50/40 ring-1 ring-kfc/30"
                : "border-line bg-surface hover:border-kfc/50";

        return (
          <li key={line.id}>
            <button
              type="button"
              onClick={() => onSelectLine(selected ? null : line.id)}
              aria-expanded={selected}
              className={`w-full rounded border px-4 py-3 text-left transition ${alertBorder}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Line {line.lineNumber}
                    {extraction ? " · extracted" : docs.length ? " · doc attached" : ""}
                  </div>
                  <div className="mt-0.5 font-display text-lg font-semibold">
                    {line.expenseType.replaceAll("_", " ")}
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    {line.vendor?.legalName ?? line.vendorId}
                    {line.invoiceNumber ? ` · Inv ${line.invoiceNumber}` : ""}
                  </div>
                  {summary ? (
                    <ExtractionChips
                      summary={summary}
                      findingCount={actionableFindings.length}
                      worst={worst}
                    />
                  ) : null}
                  {!summary && needsUpload && !selected ? (
                    <p className="mt-2 text-xs text-muted">
                      No document yet — click to upload.
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <div className="font-medium tabular-nums">
                    {Number(line.grossAmount) > 0
                      ? formatVnd(line.grossAmount)
                      : "Pending OCR"}
                  </div>
                  <div className="mt-1 flex flex-col items-end gap-1">
                    <StatusBadge status={line.status} />
                    {worst ? <StatusBadge status={worst} /> : null}
                  </div>
                </div>
              </div>
            </button>

            {selected ? (
              <LineDetailPanel
                line={line}
                docs={docs}
                extraction={extraction}
                summary={summary}
                findings={
                  lineFindings.length
                    ? lineFindings
                    : findings.filter((v) => v.lineId == null).slice(0, 5)
                }
                canUpload={canUpload}
                needsUpload={needsUpload}
                uploading={uploading}
                uploadFile={uploadFile}
                onUploadFileChange={onUploadFileChange}
                onUpload={onUpload}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
