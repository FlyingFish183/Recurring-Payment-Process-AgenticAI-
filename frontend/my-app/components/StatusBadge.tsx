"use client";

type Props = { status: string };

const STYLES: Record<string, string> = {
  DRAFT: "bg-paper-2 text-ink",
  READY: "bg-emerald-50 text-ok",
  SUBMITTED: "bg-amber-50 text-warn",
  IN_REVIEW: "bg-amber-50 text-warn",
  APPROVED: "bg-emerald-50 text-ok",
  REJECTED: "bg-red-50 text-danger",
  PAID: "bg-emerald-100 text-ok",
  ACTIVE: "bg-emerald-50 text-ok",
};

export function StatusBadge({ status }: Props) {
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase ${
        STYLES[status] ?? "bg-paper-2 text-muted"
      }`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
