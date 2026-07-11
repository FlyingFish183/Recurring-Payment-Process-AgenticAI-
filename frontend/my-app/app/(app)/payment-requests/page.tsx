"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatVnd } from "@/lib/format";
import type { Paginated, PaymentRequest, Store } from "@/lib/types";

export default function PaymentInboxPage() {
  const { user } = useAuth();
  const [stores, setStores] = useState<Store[]>([]);
  const [data, setData] = useState<PaymentRequest[]>([]);
  const [storeId, setStoreId] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Paginated<Store>>("/stores?pageSize=100")
      .then((res) => setStores(res.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ pageSize: "50" });
        if (storeId) params.set("storeId", storeId);
        if (period) params.set("paymentPeriod", period);
        if (status) params.set("status", status);
        const res = await api<Paginated<PaymentRequest>>(
          `/payment-requests?${params}`,
        );
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId, period, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-wide text-kfc uppercase">
            Inbox
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight">
            Payment requests
          </h1>
        </div>
        {user?.role === "REQUESTER" ? (
          <Link
            href="/payment-requests/new"
            className="rounded bg-kfc px-4 py-2.5 text-sm font-semibold text-white hover:bg-kfc-dark"
          >
            New request
          </Link>
        ) : null}
      </div>

      <div className="grid gap-3 rounded border border-line bg-surface p-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-muted">Store</span>
          <select
            className="w-full rounded border border-line bg-paper px-3 py-2"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.storeCode} — {s.storeName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-muted">Period</span>
          <input
            type="month"
            className="w-full rounded border border-line bg-paper px-3 py-2"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-muted">Status</span>
          <select
            className="w-full rounded border border-line bg-paper px-3 py-2"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            {[
              "DRAFT",
              "READY",
              "SUBMITTED",
              "IN_REVIEW",
              "APPROVED",
              "REJECTED",
              "PAID",
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded border border-line bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-paper-2 text-xs tracking-wide text-muted uppercase">
            <tr>
              <th className="px-3 py-2">Request</th>
              <th className="px-3 py-2">Store</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2">Requester</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Risk</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  Loading inbox…
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  No requests match these filters.
                </td>
              </tr>
            ) : (
              data.map((r) => (
                <tr key={r.id} className="border-b border-line/70 last:border-0">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/payment-requests/${r.id}`}
                      className="font-medium text-kfc hover:underline"
                    >
                      {r.requestNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.store?.storeCode} · {r.store?.storeName}
                  </td>
                  <td className="px-3 py-2.5">{r.paymentPeriod}</td>
                  <td className="px-3 py-2.5">
                    {r.requester?.displayName ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatVnd(r.totalAmount)}
                  </td>
                  <td className="px-3 py-2.5">{r.riskLevel}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
