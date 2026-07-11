"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatVnd } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import type { Paginated, PaymentRequest } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

export default function DashboardPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<Paginated<PaymentRequest>>(
          "/payment-requests?pageSize=50",
        );
        if (!cancelled) setRequests(res.data);
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
  }, []);

  const stats = useMemo(() => {
    const draft = requests.filter((r) => r.status === "DRAFT").length;
    const inFlight = requests.filter((r) =>
      ["SUBMITTED", "IN_REVIEW", "READY"].includes(r.status),
    ).length;
    const totalAmount = requests.reduce(
      (sum, r) => sum + Number(r.totalAmount || 0),
      0,
    );
    return { draft, inFlight, total: requests.length, totalAmount };
  }, [requests]);

  if (!user) return null;
  const meta = ROLE_LABELS[user.role];
  const recent = requests.slice(0, 5);

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm font-semibold tracking-wide text-kfc uppercase">
          Dashboard
        </p>
        <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">
          Welcome, {user.displayName}
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Signed in as <strong className="text-ink">{meta.title}</strong> (
          {meta.team}). Phase 1 covers payment inbox, draft requests, and master
          data.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Requests visible", value: String(stats.total) },
          { label: "Drafts", value: String(stats.draft) },
          { label: "In flight", value: String(stats.inFlight) },
          { label: "Listed total", value: formatVnd(stats.totalAmount) },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded border border-line bg-surface px-4 py-4"
          >
            <div className="text-xs font-semibold tracking-wide text-muted uppercase">
              {card.label}
            </div>
            <div className="font-display mt-2 text-3xl font-semibold tabular-nums">
              {loading ? "…" : card.value}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/payment-requests"
          className="rounded border border-line bg-surface px-4 py-5 transition hover:border-kfc"
        >
          <div className="font-display text-xl font-semibold">Payment Inbox</div>
          <p className="mt-1 text-sm text-muted">
            Filter and open payment requests by store, period, and status.
          </p>
        </Link>
        {user.role === "REQUESTER" ? (
          <Link
            href="/payment-requests/new"
            className="rounded border border-kfc bg-kfc px-4 py-5 text-white transition hover:bg-kfc-dark"
          >
            <div className="font-display text-xl font-semibold">
              Create request
            </div>
            <p className="mt-1 text-sm text-white/80">
              Start a DRAFT for one store and payment period.
            </p>
          </Link>
        ) : (
          <div className="rounded border border-dashed border-line bg-paper-2 px-4 py-5 text-muted">
            <div className="font-display text-xl font-semibold text-ink/50">
              Create request
            </div>
            <p className="mt-1 text-sm">Requester role only.</p>
          </div>
        )}
        {user.role === "FA" ? (
          <Link
            href="/master-data"
            className="rounded border border-line bg-surface px-4 py-5 transition hover:border-kfc"
          >
            <div className="font-display text-xl font-semibold">Master data</div>
            <p className="mt-1 text-sm text-muted">
              Stores, vendors, bank accounts, and contracts.
            </p>
          </Link>
        ) : (
          <div className="rounded border border-dashed border-line bg-paper-2 px-4 py-5 text-muted">
            <div className="font-display text-xl font-semibold text-ink/50">
              Master data
            </div>
            <p className="mt-1 text-sm">F&amp;A role only.</p>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold">Recent requests</h2>
          <Link href="/payment-requests" className="text-sm font-medium text-kfc">
            View all
          </Link>
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
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted">
                    Loading…
                  </td>
                </tr>
              ) : recent.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted">
                    No payment requests yet. Create a DRAFT to get started.
                  </td>
                </tr>
              ) : (
                recent.map((r) => (
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
                      {r.store?.storeCode ?? r.storeId}
                    </td>
                    <td className="px-3 py-2.5">{r.paymentPeriod}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatVnd(r.totalAmount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
