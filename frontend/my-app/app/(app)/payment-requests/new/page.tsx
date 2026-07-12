"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, apiForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type {
  Document,
  ExpenseType,
  Paginated,
  PaymentRequest,
  Store,
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

type LineDraft = {
  key: string;
  expenseType: ExpenseType;
  vendorId: string;
  description: string;
  file: File | null;
};

function newLineDraft(vendorId = ""): LineDraft {
  return {
    key: crypto.randomUUID(),
    expenseType: "RENT",
    vendorId,
    description: "",
    file: null,
  };
}

export default function NewPaymentRequestPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [storeId, setStoreId] = useState("");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [lines, setLines] = useState<LineDraft[]>([newLineDraft()]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== "REQUESTER") {
      router.replace("/payment-requests");
    }
  }, [user, router]);

  useEffect(() => {
    void Promise.all([
      api<Paginated<Store>>("/stores?pageSize=100"),
      api<Paginated<Vendor>>("/vendors?pageSize=100"),
    ])
      .then(([storeRes, vendorRes]) => {
        setStores(storeRes.data);
        setVendors(vendorRes.data);
        if (storeRes.data[0]) setStoreId(storeRes.data[0].id);
        const firstVendor = vendorRes.data[0]?.id ?? "";
        setLines((prev) =>
          prev.map((line) =>
            line.vendorId ? line : { ...line, vendorId: firstVendor },
          ),
        );
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load form data"),
      );
  }, []);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      newLineDraft(vendors[0]?.id ?? prev[0]?.vendorId ?? ""),
    ]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || lines.length === 0) return;

    for (const line of lines) {
      if (!line.vendorId) {
        setError("Each line needs a vendor.");
        return;
      }
      if (!line.file) {
        setError("Each line needs an invoice file (XML, PDF, or image).");
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    setProgress("Saving payment request…");

    try {
      const created = await api<PaymentRequest>("/payment-requests", {
        method: "POST",
        body: JSON.stringify({
          storeId,
          paymentPeriod: period,
          lines: lines.map((line) => ({
            expenseType: line.expenseType,
            vendorId: line.vendorId,
            description: line.description || undefined,
          })),
        }),
      });

      const createdLines = created.lines ?? [];
      for (let i = 0; i < lines.length; i++) {
        const file = lines[i].file;
        const lineId = createdLines[i]?.id;
        if (!file || !lineId) continue;
        setProgress(`Uploading invoice ${i + 1} of ${lines.length}…`);
        const form = new FormData();
        form.append("file", file);
        form.append("documentType", "E_INVOICE");
        form.append("lineId", lineId);
        await apiForm<Document>(`/payment-requests/${created.id}/documents`, form);
      }

      setProgress("Queuing extract & auto-fill…");
      await api(`/payment-requests/${created.id}/submit`, { method: "POST" });

      router.push(`/payment-requests/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/payment-requests"
          className="text-sm font-medium text-kfc hover:underline"
        >
          ← Inbox
        </Link>
        <p className="mt-3 text-sm font-semibold tracking-wide text-kfc uppercase">
          Requester
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          New payment request
        </h1>
        <p className="mt-2 text-muted">
          Enter expense type, vendor, description, and the invoice file. Amounts
          and invoice number are filled automatically after submit.
        </p>
      </div>

      <form onSubmit={(e) => void onSubmit(e)} className="space-y-6">
        <section className="space-y-4 rounded border border-line bg-surface p-5">
          <h2 className="font-display text-xl font-semibold">Request details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Store</span>
              <select
                required
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.storeCode} — {s.storeName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Payment period</span>
              <input
                required
                type="month"
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Payment lines</h2>
              <p className="mt-1 text-sm text-muted">
                Invoice file required per line — OCR fills amounts and invoice #.
              </p>
            </div>
            <button
              type="button"
              onClick={addLine}
              className="rounded border border-line bg-surface px-3 py-2 text-sm font-semibold hover:border-kfc/50"
            >
              + Add line
            </button>
          </div>

          <ul className="space-y-4">
            {lines.map((line, index) => (
              <li
                key={line.key}
                className="rounded border border-line bg-surface p-5"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">
                    Line {index + 1}
                  </h3>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeLine(line.key)}
                      className="text-sm font-medium text-danger hover:underline"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Expense type</span>
                    <select
                      className="w-full rounded border border-line bg-paper px-3 py-2"
                      value={line.expenseType}
                      onChange={(e) =>
                        updateLine(line.key, {
                          expenseType: e.target.value as ExpenseType,
                        })
                      }
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
                      value={line.vendorId}
                      onChange={(e) =>
                        updateLine(line.key, { vendorId: e.target.value })
                      }
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
                      value={line.description}
                      onChange={(e) =>
                        updateLine(line.key, { description: e.target.value })
                      }
                      placeholder="Optional note for approvers"
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
                      onChange={(e) =>
                        updateLine(line.key, {
                          file: e.target.files?.[0] ?? null,
                        })
                      }
                    />
                    {line.file ? (
                      <span className="mt-1 block text-xs text-muted">
                        Selected: {line.file.name}
                      </span>
                    ) : null}
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {error ? (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {progress ? <p className="text-sm text-muted">{progress}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-sm text-muted">
            {lines.length} line{lines.length === 1 ? "" : "s"} · OCR then auto-sends
            to HOD
          </p>
          <button
            type="submit"
            disabled={submitting || !storeId || vendors.length === 0}
            className="rounded bg-kfc px-5 py-2.5 text-sm font-semibold text-white hover:bg-kfc-dark disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit request"}
          </button>
        </div>
      </form>
    </div>
  );
}
