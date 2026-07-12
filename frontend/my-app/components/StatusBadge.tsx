"use client";

type Props = { status: string };

const STYLES: Record<string, string> = {
  DRAFT: "bg-paper-2 text-ink",
  EXTRACTING: "bg-amber-50 text-warn",
  READY: "bg-emerald-50 text-ok",
  SUBMITTED: "bg-amber-50 text-warn",
  IN_REVIEW: "bg-amber-50 text-warn",
  APPROVED: "bg-emerald-50 text-ok",
  REJECTED: "bg-red-50 text-danger",
  PAID: "bg-emerald-100 text-ok",
  ACTIVE: "bg-emerald-50 text-ok",
  PASS: "bg-emerald-50 text-ok",
  WARNING: "bg-amber-100 text-warn",
  HIGH_RISK: "bg-red-50 text-danger",
  BLOCKED: "bg-red-100 text-danger",
  SUCCESS: "bg-emerald-50 text-ok",
  FAILED: "bg-red-50 text-danger",
  INFO: "bg-paper-2 text-muted",
  HIGH: "bg-red-100 text-danger",
  BLOCKING: "bg-red-200 text-danger",
  LOW: "bg-emerald-50 text-ok",
  MEDIUM: "bg-amber-100 text-warn",
  COMPLETE: "bg-emerald-50 text-ok",
  PARTIAL: "bg-amber-50 text-warn",
  EMPTY: "bg-paper-2 text-muted",
  NOT_STARTED: "bg-paper-2 text-muted",
  MATCH: "bg-emerald-50 text-ok",
  MISSING: "bg-amber-100 text-warn",
  MISMATCH: "bg-red-100 text-danger",
};

export function StatusBadge({ status }: Props) {
  const key = status.toUpperCase().replaceAll(" ", "_");
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${
        STYLES[key] ?? "bg-paper-2 text-muted"
      }`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
