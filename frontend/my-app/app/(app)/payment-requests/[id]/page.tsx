"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApprovalPanel } from "@/components/ApprovalPanel";
import { PaymentLineGrid } from "@/components/PaymentLineGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { api, apiForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatVnd } from "@/lib/format";
import type {
  Document,
  ExpenseType,
  Paginated,
  PaymentRequest,
  Vendor,
} from "@/lib/types";

const EXPENSE_TYPES: ExpenseType[] = [
  "RENT",
  "ELECTRICITY",
  "WATER",
  "SERVICE_FEE",
  "MAINTENANCE",
  "OTHER",
];

const EDITABLE_STATUSES = new Set([
  "DRAFT",
  "CHANGES_REQUESTED",
  "EXTRACTING",
  "READY",
]);

export default function PaymentRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user } = useAuth();
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  const [expenseType, setExpenseType] = useState<ExpenseType>("RENT");
  const [vendorId, setVendorId] = useState("");
  const [description, setDescription] = useState("");
  const [newLineFile, setNewLineFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lineUploadFile, setLineUploadFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [req, vendorRes] = await Promise.all([
        api<PaymentRequest>(`/payment-requests/${id}`),
        api<Paginated<Vendor>>("/vendors?pageSize=100"),
      ]);
      setRequest(req);
      setVendors(vendorRes.data);
      setVendorId((current) => current || vendorRes.data[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadForLine(lineId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("documentType", "E_INVOICE");
    form.append("lineId", lineId);
    await apiForm<Document>(`/payment-requests/${id}/documents`, form);
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!request) return;
    if (!newLineFile) {
      setError("Attach an invoice file for this line.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const result = await api<{ line: { id: string } }>(
        `/payment-requests/${request.id}/lines`,
        {
          method: "POST",
          body: JSON.stringify({
            expenseType,
            vendorId,
            description: description || undefined,
          }),
        },
      );

      await uploadForLine(result.line.id, newLineFile);

      setDescription("");
      setNewLineFile(null);
      setSelectedLineId(result.line.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add line");
    } finally {
      setAdding(false);
    }
  }

  async function uploadToSelectedLine() {
    if (!selectedLineId || !lineUploadFile) return;
    setUploading(true);
    setError(null);
    try {
      await uploadForLine(selectedLineId, lineUploadFile);
      setLineUploadFile(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function submitForProcessing() {
    if (!request) return;
    setSubmitting(true);
    setError(null);
    try {
      await api(`/payment-requests/${request.id}/submit`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !request) {
    return <p className="text-muted">Loading request…</p>;
  }
  if (!request) {
    return (
      <p className="text-danger" role="alert">
        {error ?? "Request not found"}
      </p>
    );
  }

  const lines = request.lines ?? [];
  const documents = request.documents ?? [];
  const sumLines = lines.reduce((s, l) => s + Number(l.grossAmount), 0);
  const canEdit =
    user?.role === "REQUESTER" && EDITABLE_STATUSES.has(request.status);
  const canRerunExtract =
    user?.role === "REQUESTER" &&
    ["DRAFT", "READY", "CHANGES_REQUESTED", "EXTRACTING"].includes(request.status) &&
    lines.length > 0;

  const validations = request.validationResults ?? [];
  const actionableValidations = validations.filter((v) => v.severity !== "INFO");
  const highCount = actionableValidations.filter(
    (v) => v.severity === "HIGH" || v.severity === "BLOCKING",
  ).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/payment-requests"
            className="text-sm font-medium text-kfc hover:underline"
          >
            ← Inbox
          </Link>
          <h1 className="font-display mt-2 text-4xl font-bold tracking-tight">
            {request.requestNumber}
          </h1>
          <p className="mt-1 text-muted">
            {request.store?.storeCode} · {request.store?.storeName} · period{" "}
            {request.paymentPeriod}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={request.status} />
          {request.riskLevel ? (
            <StatusBadge status={request.riskLevel} />
          ) : null}
          {canRerunExtract ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submitForProcessing()}
              className="rounded border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:border-kfc/50 disabled:opacity-60"
            >
              {submitting ? "Extracting…" : "Re-run extract"}
            </button>
          ) : null}
          <div className="text-right">
            <div className="text-xs font-semibold tracking-wide text-muted uppercase">
              Total
            </div>
            <div className="font-display text-3xl font-semibold tabular-nums">
              {formatVnd(request.totalAmount)}
            </div>
            <div className="text-xs text-muted">
              {lines.length} line{lines.length === 1 ? "" : "s"} ·{" "}
              {formatVnd(sumLines)}
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {request.status === "EXTRACTING" ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-warn">
          Extraction still running — risk and validation update when the worker
          finishes. Use Re-run extract if it stalls.
        </p>
      ) : null}

      {request.status !== "EXTRACTING" && actionableValidations.length > 0 ? (
        <section
          className={`rounded border px-4 py-3 ${
            highCount > 0
              ? "border-red-300 bg-red-50"
              : "border-amber-300 bg-amber-50"
          }`}
          role="alert"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-semibold">
              {highCount > 0 ? "High-risk findings" : "Validation warnings"}
            </h2>
            <StatusBadge status={request.riskLevel} />
            <span className="text-sm text-muted">
              {actionableValidations.length} alert
              {actionableValidations.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {actionableValidations.slice(0, 8).map((f) => (
              <li
                key={f.id}
                className="rounded border border-white/70 bg-white/80 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={f.severity} />
                  <span className="font-semibold">
                    {f.validationType.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-1 text-ink">{f.message}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ApprovalPanel request={request} onUpdated={() => void load()} />

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">Payment lines</h2>
          <p className="mt-1 text-sm text-muted">
            Click a line to compare OCR against the selected vendor and review
            validation alerts.
          </p>
        </div>
        <PaymentLineGrid
          lines={lines}
          documents={documents}
          validations={validations}
          selectedLineId={selectedLineId}
          onSelectLine={setSelectedLineId}
          canUpload={canEdit}
          uploading={uploading}
          uploadFile={lineUploadFile}
          onUploadFileChange={setLineUploadFile}
          onUpload={() => void uploadToSelectedLine()}
          emptyHint="No lines yet. Add one below."
        />
      </section>

      {canEdit ? (
        <section className="rounded border border-line bg-surface p-5">
          <h3 className="font-display text-xl font-semibold">Add another line</h3>
          <p className="mt-1 text-sm text-muted">
            Expense type, vendor, description, and invoice file only — amounts
            are filled from OCR after processing.
          </p>
          <form
            onSubmit={(e) => void addLine(e)}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Expense type</span>
              <select
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={expenseType}
                onChange={(e) => setExpenseType(e.target.value as ExpenseType)}
              >
                {EXPENSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Vendor</span>
              <select
                required
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              >
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vendorCode} — {v.legalName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Description</span>
              <input
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">
                Invoice file (required) — XML / PDF / image
              </span>
              <input
                required
                type="file"
                accept=".xml,.pdf,image/*,application/pdf,application/xml,text/xml"
                className="w-full rounded border border-line bg-paper px-3 py-2"
                onChange={(e) => setNewLineFile(e.target.files?.[0] ?? null)}
              />
              {newLineFile ? (
                <span className="mt-1 block text-xs text-muted">
                  Selected: {newLineFile.name}
                </span>
              ) : null}
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={adding}
                className="rounded bg-kfc px-4 py-2.5 text-sm font-semibold text-white hover:bg-kfc-dark disabled:opacity-60"
              >
                {adding ? "Saving & uploading…" : "Add line"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
