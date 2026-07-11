"use client";

import { formatVnd } from "@/lib/format";
import type { Document, PaymentLine } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

type Props = {
  lines: PaymentLine[];
  documents: Document[];
  selectedLineId: string | null;
  onSelectLine: (lineId: string) => void;
  canUpload: boolean;
  uploading: boolean;
  uploadFile: File | null;
  onUploadFileChange: (file: File | null) => void;
  onUpload: () => void;
  emptyHint?: string;
};

function formatIcon(format: string): string {
  if (format === "XML") return "XML";
  if (format === "PDF") return "PDF";
  if (format === "IMAGE") return "IMG";
  return "DOC";
}

function LineDocuments({ docs }: { docs: Document[] }) {
  if (docs.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-3">
      {docs.map((doc) => (
        <li
          key={doc.id}
          className="min-w-[12rem] max-w-xs overflow-hidden rounded border border-line bg-paper"
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
                className="max-h-48 w-full object-contain"
              />
            </a>
          ) : doc.fileFormat === "PDF" && doc.viewUrl ? (
            <a
              href={doc.viewUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-28 items-center justify-center bg-ink/5 text-sm font-semibold text-kfc hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Open PDF
            </a>
          ) : (
            <div className="flex h-16 items-center justify-center bg-ink/5">
              <span className="rounded bg-ink px-2 py-1 text-[10px] font-bold tracking-wide text-white">
                {formatIcon(doc.fileFormat)}
              </span>
            </div>
          )}
          <div className="flex items-start justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{doc.fileName}</div>
              <div className="text-xs text-muted">
                {doc.fileFormat} · {doc.documentType.replaceAll("_", " ")}
              </div>
            </div>
            <StatusBadge status={doc.processingStatus} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PaymentLineGrid({
  lines,
  documents,
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
        const selected = selectedLineId === line.id;
        const needsUpload = docs.length === 0;

        return (
          <li key={line.id}>
            <button
              type="button"
              onClick={() => onSelectLine(line.id)}
              className={`w-full rounded border px-4 py-3 text-left transition ${
                selected
                  ? "border-kfc bg-red-50/40 ring-1 ring-kfc/30"
                  : "border-line bg-surface hover:border-kfc/50"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold tracking-wide text-muted uppercase">
                    Line {line.lineNumber}
                  </div>
                  <div className="mt-0.5 font-display text-lg font-semibold">
                    {line.expenseType.replaceAll("_", " ")}
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    {line.vendor?.legalName ?? line.vendorId}
                    {line.invoiceNumber ? ` · Inv ${line.invoiceNumber}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium tabular-nums">
                    {formatVnd(line.grossAmount)}
                  </div>
                  <div className="mt-1">
                    <StatusBadge status={line.status} />
                  </div>
                </div>
              </div>

              <LineDocuments docs={docs} />

              {needsUpload && !selected ? (
                <p className="mt-3 text-xs text-muted">
                  No document yet — click this line to upload.
                </p>
              ) : null}
            </button>

            {selected && canUpload && needsUpload ? (
              <div className="mt-2 rounded border border-dashed border-kfc/40 bg-surface px-4 py-3">
                <p className="text-sm font-medium">Upload document for this line</p>
                <p className="mt-0.5 text-xs text-muted">
                  XML e-invoice, PDF, or image
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    accept=".xml,.pdf,image/*,application/pdf,application/xml,text/xml"
                    className="max-w-full text-sm"
                    onChange={(e) =>
                      onUploadFileChange(e.target.files?.[0] ?? null)
                    }
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

            {selected && docs.length > 0 ? (
              <p className="mt-2 text-xs text-muted">
                Document already attached to this line.
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
