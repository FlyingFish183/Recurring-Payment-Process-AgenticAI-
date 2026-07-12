import type { ExpenseType, PaymentRequestStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { accessibleStoreIds } from "./storeScope";
import type { UserRole } from "@prisma/client";

/** Compulsory recurring expenses every store should cover each month. */
export const COMPULSORY_EXPENSES: ExpenseType[] = [
  "RENT",
  "ELECTRICITY",
  "WATER",
  "SERVICE_FEE",
];

export type CoverageCellStatus =
  | "MISSING"
  | "DRAFT"
  | "EXTRACTING"
  | "BLOCKED"
  | "IN_REVIEW"
  | "APPROVED"
  | "PAID"
  | "REJECTED";

function cellStatusFromRequest(
  requestStatus: PaymentRequestStatus,
  lineStatus: string,
  hasBlocking: boolean,
): CoverageCellStatus {
  if (lineStatus === "BLOCKED" || hasBlocking) return "BLOCKED";
  if (requestStatus === "PAID" || lineStatus === "PAID") return "PAID";
  if (
    requestStatus === "APPROVED" ||
    requestStatus === "POSTING" ||
    requestStatus === "POSTED" ||
    requestStatus === "PAYMENT_PROCESSING"
  ) {
    return "APPROVED";
  }
  if (requestStatus === "IN_REVIEW" || requestStatus === "SUBMITTED") {
    return "IN_REVIEW";
  }
  if (requestStatus === "REJECTED" || requestStatus === "CANCELLED") {
    return "REJECTED";
  }
  if (requestStatus === "EXTRACTING") return "EXTRACTING";
  if (requestStatus === "CHANGES_REQUESTED" || requestStatus === "READY") {
    return hasBlocking ? "BLOCKED" : "DRAFT";
  }
  if (requestStatus === "DRAFT") return "DRAFT";
  return "DRAFT";
}

export async function listCoveragePeriods(): Promise<string[]> {
  const now = new Date();
  const generated: string[] = [];
  // Last 12 months + next month — no DB round-trip
  for (let i = -1; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    generated.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return [...new Set(generated)].sort().reverse();
}

export async function buildMonthlyCoverage(input: {
  period: string;
  userId: string;
  role: UserRole;
}) {
  const storeIds = await accessibleStoreIds(input.userId, input.role);

  const [stores, requests] = await Promise.all([
    prisma.store.findMany({
      where: {
        status: "ACTIVE",
        ...(storeIds ? { id: { in: storeIds } } : {}),
      },
      orderBy: [{ region: "asc" }, { storeCode: "asc" }],
      select: {
        id: true,
        storeCode: true,
        storeName: true,
        region: true,
      },
    }),
    prisma.paymentRequest.findMany({
      where: {
        paymentPeriod: input.period,
        ...(storeIds ? { storeId: { in: storeIds } } : {}),
        status: { not: "CANCELLED" },
      },
      select: {
        id: true,
        storeId: true,
        requestNumber: true,
        status: true,
        lines: {
          where: { expenseType: { in: COMPULSORY_EXPENSES } },
          select: {
            id: true,
            expenseType: true,
            status: true,
            grossAmount: true,
            invoiceNumber: true,
            vendor: { select: { vendorCode: true, legalName: true } },
          },
        },
        validationResults: {
          where: { severity: "BLOCKING" },
          select: { lineId: true, id: true },
        },
      },
    }),
  ]);

  const byStore = new Map<string, typeof requests>();
  for (const req of requests) {
    const list = byStore.get(req.storeId) ?? [];
    list.push(req);
    byStore.set(req.storeId, list);
  }

  const storeRows = stores.map((store) => {
    const storeReqs = byStore.get(store.id) ?? [];
    const cells = COMPULSORY_EXPENSES.map((expenseType) => {
      // Prefer the "best" line for this expense (paid > approved > in review > …)
      type Cand = {
        status: CoverageCellStatus;
        requestId: string;
        requestNumber: string;
        requestStatus: PaymentRequestStatus;
        lineId: string;
        invoiceNumber: string | null;
        grossAmount: number;
        vendorName: string | null;
        rank: number;
      };
      const rankOf = (s: CoverageCellStatus): number =>
        (
          {
            PAID: 70,
            APPROVED: 60,
            IN_REVIEW: 50,
            EXTRACTING: 40,
            DRAFT: 30,
            BLOCKED: 20,
            REJECTED: 10,
            MISSING: 0,
          } as Record<CoverageCellStatus, number>
        )[s];

      const candidates: Cand[] = [];
      for (const req of storeReqs) {
        const blockingLineIds = new Set(
          req.validationResults
            .filter((v) => v.lineId)
            .map((v) => v.lineId as string),
        );
        const requestBlocked = req.validationResults.some((v) => !v.lineId);
        for (const line of req.lines) {
          if (line.expenseType !== expenseType) continue;
          const hasBlocking =
            requestBlocked ||
            blockingLineIds.has(line.id) ||
            line.status === "BLOCKED";
          const status = cellStatusFromRequest(
            req.status,
            line.status,
            hasBlocking,
          );
          candidates.push({
            status,
            requestId: req.id,
            requestNumber: req.requestNumber,
            requestStatus: req.status,
            lineId: line.id,
            invoiceNumber: line.invoiceNumber,
            grossAmount: Number(line.grossAmount),
            vendorName: line.vendor?.legalName ?? null,
            rank: rankOf(status),
          });
        }
      }

      if (candidates.length === 0) {
        return {
          expenseType,
          status: "MISSING" as CoverageCellStatus,
          requestId: null,
          requestNumber: null,
          requestStatus: null,
          lineId: null,
          invoiceNumber: null,
          grossAmount: null,
          vendorName: null,
        };
      }

      candidates.sort((a, b) => b.rank - a.rank);
      const best = candidates[0]!;
      return {
        expenseType,
        status: best.status,
        requestId: best.requestId,
        requestNumber: best.requestNumber,
        requestStatus: best.requestStatus,
        lineId: best.lineId,
        invoiceNumber: best.invoiceNumber,
        grossAmount: best.grossAmount,
        vendorName: best.vendorName,
      };
    });

    const done = cells.filter((c) => c.status === "PAID" || c.status === "APPROVED").length;
    const missing = cells.filter((c) => c.status === "MISSING").length;
    const blocked = cells.some((c) => c.status === "BLOCKED");
    const completeness =
      missing === 0 && !blocked && done === COMPULSORY_EXPENSES.length
        ? "COMPLETE"
        : missing === COMPULSORY_EXPENSES.length
          ? "EMPTY"
          : "PARTIAL";

    return {
      store,
      cells,
      completeness,
      doneCount: done,
      missingCount: missing,
    };
  });

  const summary = {
    stores: storeRows.length,
    complete: storeRows.filter((s) => s.completeness === "COMPLETE").length,
    partial: storeRows.filter((s) => s.completeness === "PARTIAL").length,
    missing: storeRows.filter((s) => s.completeness === "EMPTY").length,
  };

  return {
    period: input.period,
    compulsoryExpenses: COMPULSORY_EXPENSES,
    stores: storeRows,
    summary,
  };
}
