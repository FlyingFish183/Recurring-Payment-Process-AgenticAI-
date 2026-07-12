"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import type { ApprovalStep, PaymentRequest, UserRole } from "@/lib/types";

const CHAIN: UserRole[] = ["HOD", "FA", "CA", "CASHIER"];
const SIGNING_ROLES = new Set<UserRole>(["CA", "CASHIER"]);

type SignatureVerify = {
  stepId: string;
  signed: boolean;
  valid: boolean;
  reason?: string;
  algorithm?: string;
  contentHash?: string;
};

type Props = {
  request: PaymentRequest;
  onUpdated: () => void;
};

export function ApprovalPanel({ request, onUpdated }: Props) {
  const { user } = useAuth();
  const [comments, setComments] = useState("");
  const [confirmSignature, setConfirmSignature] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sigStatus, setSigStatus] = useState<Record<string, SignatureVerify>>({});

  const steps = request.approvalSteps ?? [];
  const current = steps.find(
    (s) =>
      s.status === "PENDING" &&
      s.sequenceNumber === request.currentApprovalLevel,
  );

  const needsDigitalSign =
    Boolean(user && SIGNING_ROLES.has(user.role)) &&
    Boolean(current && SIGNING_ROLES.has(current.roleRequired));

  const canResubmitAfterChanges =
    user?.role === "REQUESTER" &&
    user.id === request.requesterId &&
    request.status === "CHANGES_REQUESTED";

  const hasBlocking =
    (request.validationResults ?? []).some((v) => v.severity === "BLOCKING") ||
    (request.lines ?? []).some((l) => l.status === "BLOCKED");

  const heldForBlocking = request.status === "READY" && hasBlocking;

  const canAct =
    user &&
    current &&
    request.status === "IN_REVIEW" &&
    current.roleRequired === user.role &&
    !hasBlocking;

  const signatureKeys = steps
    .filter(
      (s) =>
        s.status === "APPROVED" &&
        s.signatureHash &&
        SIGNING_ROLES.has(s.roleRequired),
    )
    .map((s) => `${s.id}:${s.signatureHash}`)
    .join("|");

  useEffect(() => {
    const signed = steps.filter(
      (s) =>
        s.status === "APPROVED" &&
        s.signatureHash &&
        SIGNING_ROLES.has(s.roleRequired),
    );
    if (signed.length === 0) {
      setSigStatus({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, SignatureVerify> = {};
      await Promise.all(
        signed.map(async (s) => {
          try {
            const res = await api<SignatureVerify>(
              `/approvals/steps/${s.id}/signature`,
            );
            next[s.id] = res;
          } catch {
            next[s.id] = {
              stepId: s.id,
              signed: true,
              valid: false,
              reason: "Could not verify",
            };
          }
        }),
      );
      if (!cancelled) setSigStatus(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-verify when signature payloads change
  }, [request.id, signatureKeys]);

  async function resubmitToHod() {
    setBusy(true);
    setError(null);
    try {
      await api(`/payment-requests/${request.id}/submit-for-approval`, {
        method: "POST",
        body: JSON.stringify({ comments: comments || undefined }),
      });
      setComments("");
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resubmit failed");
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "approve" | "reject" | "request_changes") {
    if (!current) return;
    if ((action === "reject" || action === "request_changes") && !comments.trim()) {
      setError("Comment required for reject / request changes");
      return;
    }
    if (action === "approve" && needsDigitalSign && !confirmSignature) {
      setError("Confirm digital signature to approve as CA / Cashier");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/approvals/steps/${current.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action,
          comments: comments || undefined,
          confirmSignature:
            action === "approve" && needsDigitalSign ? true : undefined,
        }),
      });
      setComments("");
      setConfirmSignature(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function stepForRole(role: UserRole): ApprovalStep | undefined {
    return steps.find((s) => s.roleRequired === role);
  }

  return (
    <section className="space-y-4 rounded border border-line bg-surface p-5">
      <div>
        <h2 className="font-display text-2xl font-semibold">Approval chain</h2>
        <p className="mt-1 text-sm text-muted">
          HOD → F&amp;A → Chief Accountant → Cashier
        </p>
      </div>

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {CHAIN.map((role, i) => {
          const step = stepForRole(role);
          const isCurrent =
            request.status === "IN_REVIEW" &&
            request.currentApprovalLevel === i + 1;
          const status = step?.status ?? (steps.length ? "—" : "NOT STARTED");
          const sig = step ? sigStatus[step.id] : undefined;
          return (
            <li
              key={role}
              className={`rounded border px-3 py-3 ${
                isCurrent
                  ? "border-kfc bg-red-50/50 ring-1 ring-kfc/30"
                  : status === "APPROVED"
                    ? "border-emerald-200 bg-emerald-50/50"
                    : status === "REJECTED" || status === "CHANGES_REQUESTED"
                      ? "border-amber-300 bg-amber-50/50"
                      : "border-line bg-paper"
              }`}
            >
              <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                Step {i + 1}
                {SIGNING_ROLES.has(role) ? " · Sign" : ""}
              </div>
              <div className="mt-0.5 font-medium">{ROLE_LABELS[role].title}</div>
              <div className="mt-2">
                <StatusBadge status={String(status)} />
              </div>
              {step?.actor ? (
                <p className="mt-2 text-xs text-muted">
                  {step.actor.displayName}
                  {step.actedAt
                    ? ` · ${new Date(step.actedAt).toLocaleString()}`
                    : ""}
                </p>
              ) : isCurrent ? (
                <p className="mt-2 text-xs font-medium text-kfc">Waiting now</p>
              ) : null}
              {sig?.signed ? (
                <p
                  className={`mt-1 text-[11px] font-medium ${
                    sig.valid ? "text-emerald-700" : "text-danger"
                  }`}
                  title={sig.contentHash ? `hash ${sig.contentHash.slice(0, 16)}…` : sig.reason}
                >
                  {sig.valid
                    ? `Signature OK${sig.algorithm ? ` · ${sig.algorithm}` : ""}`
                    : `Signature invalid${sig.reason ? ` — ${sig.reason}` : ""}`}
                </p>
              ) : step?.signedAt && SIGNING_ROLES.has(role) ? (
                <p className="mt-1 text-[11px] text-muted">Verifying signature…</p>
              ) : null}
              {step?.comments ? (
                <p className="mt-1 line-clamp-2 text-xs text-muted">
                  “{step.comments}”
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {heldForBlocking ? (
        <div
          className="rounded border border-red-300 bg-red-50 px-4 py-3"
          role="alert"
        >
          <p className="text-sm font-semibold text-danger">
            Held — blocking validation
          </p>
          <p className="mt-1 text-sm text-ink">
            This request stays out of the approval chain until blocking issues
            (e.g. duplicate invoice) are fixed. Re-run extract after correcting
            lines or invoices.
          </p>
        </div>
      ) : null}

      {canResubmitAfterChanges ? (
        <div className="rounded border border-kfc/30 bg-red-50/40 px-4 py-3">
          <p className="text-sm font-medium">
            Changes were requested — resubmit to send back to HOD.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[14rem] flex-1 text-sm">
              <span className="mb-1 block font-medium">Note (optional)</span>
              <input
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resubmitToHod()}
              className="rounded bg-kfc px-4 py-2.5 text-sm font-semibold text-white hover:bg-kfc-dark disabled:opacity-60"
            >
              {busy ? "Resubmitting…" : "Resubmit to HOD"}
            </button>
          </div>
        </div>
      ) : null}

      {request.status === "EXTRACTING" ||
      (request.status === "READY" && !heldForBlocking) ? (
        <p className="text-sm text-muted">
          {request.status === "EXTRACTING"
            ? "Extracting invoices — when finished (and not blocked), this request goes to HOD automatically."
            : "Routing to HOD…"}
        </p>
      ) : null}

      {request.status === "IN_REVIEW" && hasBlocking ? (
        <div
          className="rounded border border-red-300 bg-red-50 px-4 py-3"
          role="alert"
        >
          <p className="text-sm font-semibold text-danger">
            Approval locked — blocking findings
          </p>
          <p className="mt-1 text-sm text-ink">
            Approvers cannot approve until duplicates / blocked lines are
            resolved. They may still reject or request changes.
          </p>
        </div>
      ) : null}

      {request.status === "IN_REVIEW" && hasBlocking && user && current && current.roleRequired === user.role ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold">
            Your step — approve disabled while blocked
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[14rem] flex-1 text-sm">
              <span className="mb-1 block font-medium">Comment</span>
              <input
                className="w-full rounded border border-line bg-paper px-3 py-2"
                placeholder="Required for reject / changes"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("request_changes")}
              className="rounded border border-amber-400 bg-white px-4 py-2.5 text-sm font-semibold text-warn disabled:opacity-60"
            >
              Request changes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("reject")}
              className="rounded border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-danger disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}

      {canAct ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold">
            Your action required — {ROLE_LABELS[user!.role].title}
          </p>
          {needsDigitalSign ? (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmSignature}
                onChange={(e) => setConfirmSignature(e.target.checked)}
              />
              <span>
                I digitally sign this approval. My identity, role, and the
                request amount/period will be bound into a verifiable signature
                record.
              </span>
            </label>
          ) : null}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-[14rem] flex-1 text-sm">
              <span className="mb-1 block font-medium">Comment</span>
              <input
                className="w-full rounded border border-line bg-paper px-3 py-2"
                placeholder="Required for reject / changes"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || (needsDigitalSign && !confirmSignature)}
              onClick={() => void act("approve")}
              className="rounded bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {needsDigitalSign ? "Sign & approve" : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("request_changes")}
              className="rounded border border-amber-400 bg-white px-4 py-2.5 text-sm font-semibold text-warn disabled:opacity-60"
            >
              Request changes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("reject")}
              className="rounded border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-danger disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}

      {!canResubmitAfterChanges && !canAct && steps.length === 0 ? (
        <p className="text-sm text-muted">
          After the requester submits, extract runs and the request is sent to
          HOD automatically.
        </p>
      ) : null}
    </section>
  );
}
