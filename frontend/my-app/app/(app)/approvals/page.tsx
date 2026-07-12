"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatVnd } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import type { PendingApprovalStep, UserRole } from "@/lib/types";

const ROLE_ORDER: UserRole[] = ["HOD", "FA", "CA", "CASHIER"];

export default function ApprovalsPage() {
  const { user } = useAuth();
  const [steps, setSteps] = useState<PendingApprovalStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ data: PendingApprovalStep[]; count: number }>(
        "/approvals/pending",
      );
      setSteps(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(
    stepId: string,
    action: "approve" | "reject" | "request_changes",
  ) {
    const note = comments[stepId]?.trim() ?? "";
    if ((action === "reject" || action === "request_changes") && !note) {
      setError("Add a comment before reject / request changes.");
      return;
    }
    setActingId(stepId);
    setError(null);
    try {
      await api(`/approvals/steps/${stepId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, comments: note || undefined }),
      });
      setComments((c) => {
        const next = { ...c };
        delete next[stepId];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActingId(null);
    }
  }

  if (!user) return null;
  const meta = ROLE_LABELS[user.role];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold tracking-wide text-kfc uppercase">
          Approval queue
        </p>
        <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">
          Pending for {meta.title}
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Chain: HOD → F&amp;A → CA → Cashier. You only see requests waiting at
          your step.
        </p>
        <ol className="mt-3 flex flex-wrap gap-2">
          {ROLE_ORDER.map((role, i) => (
            <li
              key={role}
              className={`rounded px-2.5 py-1 text-xs font-semibold ${
                role === user.role
                  ? "bg-kfc text-white"
                  : "bg-paper-2 text-muted"
              }`}
            >
              {i + 1}. {ROLE_LABELS[role].title}
            </li>
          ))}
        </ol>
      </div>

      {error ? (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-muted">Loading queue…</p>
      ) : steps.length === 0 ? (
        <div className="rounded border border-dashed border-line bg-surface px-4 py-12 text-center text-muted">
          No requests waiting on {meta.title} right now.
        </div>
      ) : (
        <ul className="space-y-4">
          {steps.map((step) => {
            const req = step.request;
            const blocked =
              (req.validationResults?.length ?? 0) > 0 ||
              (req.lines ?? []).some((l) => l.status === "BLOCKED");
            return (
              <li
                key={step.id}
                className={`rounded border bg-surface p-4 ${
                  blocked ? "border-red-300" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/payment-requests/${req.id}`}
                      className="font-display text-2xl font-semibold text-kfc hover:underline"
                    >
                      {req.requestNumber}
                    </Link>
                    <p className="mt-1 text-sm text-muted">
                      {req.store?.storeCode} · {req.store?.storeName} ·{" "}
                      {req.paymentPeriod}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      From {req.requester?.displayName ?? "requester"} ·{" "}
                      {req.lines?.length ?? req._count?.lines ?? 0} lines ·{" "}
                      {formatVnd(req.totalAmount)}
                    </p>
                    {blocked ? (
                      <p className="mt-2 text-sm font-medium text-danger">
                        Blocking validation — approve disabled (reject / request
                        changes only)
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={req.status} />
                    <StatusBadge status={req.riskLevel} />
                    {blocked ? <StatusBadge status="BLOCKING" /> : null}
                    <span className="text-xs text-muted">
                      Step {step.sequenceNumber}/4 · {step.roleRequired}
                    </span>
                  </div>
                </div>

                {req.lines && req.lines.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {req.lines.map((line) => (
                      <li
                        key={line.id}
                        className="rounded border border-line bg-paper px-2 py-1 text-xs text-muted"
                      >
                        {line.expenseType.replaceAll("_", " ")} ·{" "}
                        {line.vendor?.legalName ?? "—"} ·{" "}
                        {formatVnd(line.grossAmount)}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                  <label className="min-w-[16rem] flex-1 text-sm">
                    <span className="mb-1 block font-medium">Comment</span>
                    <input
                      className="w-full rounded border border-line bg-paper px-3 py-2"
                      placeholder="Required for reject / changes"
                      value={comments[step.id] ?? ""}
                      onChange={(e) =>
                        setComments((c) => ({ ...c, [step.id]: e.target.value }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    disabled={actingId === step.id || blocked}
                    onClick={() => void act(step.id, "approve")}
                    className="rounded bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={actingId === step.id}
                    onClick={() => void act(step.id, "request_changes")}
                    className="rounded border border-amber-400 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-warn disabled:opacity-60"
                  >
                    Request changes
                  </button>
                  <button
                    type="button"
                    disabled={actingId === step.id}
                    onClick={() => void act(step.id, "reject")}
                    className="rounded border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-danger disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
