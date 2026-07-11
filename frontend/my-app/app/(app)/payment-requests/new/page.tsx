"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Paginated, PaymentRequest, Store } from "@/lib/types";

export default function NewPaymentRequestPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState("");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== "REQUESTER") {
      router.replace("/payment-requests");
    }
  }, [user, router]);

  useEffect(() => {
    void api<Paginated<Store>>("/stores?pageSize=100")
      .then((res) => {
        setStores(res.data);
        if (res.data[0]) setStoreId(res.data[0].id);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load stores"),
      );
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await api<PaymentRequest>("/payment-requests", {
        method: "POST",
        body: JSON.stringify({ storeId, paymentPeriod: period }),
      });
      router.push(`/payment-requests/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <p className="text-sm font-semibold tracking-wide text-kfc uppercase">
          Requester
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Create payment request
        </h1>
        <p className="mt-2 text-muted">
          Choose the store and period, then add payment lines with optional
          XML / PDF / image documents on the next screen.
        </p>
      </div>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="space-y-4 rounded border border-line bg-surface p-5"
      >
        <label className="block text-sm">
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
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || !storeId}
          className="rounded bg-kfc px-4 py-2.5 text-sm font-semibold text-white hover:bg-kfc-dark disabled:opacity-60"
        >
          {submitting ? "Creating…" : "Create DRAFT"}
        </button>
      </form>
    </div>
  );
}
