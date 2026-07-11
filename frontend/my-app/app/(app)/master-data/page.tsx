"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatVnd } from "@/lib/format";
import type { Contract, Paginated, Store, Vendor } from "@/lib/types";

type Tab = "stores" | "vendors" | "contracts";

export default function MasterDataPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("stores");
  const [stores, setStores] = useState<Store[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && user.role !== "FA") {
      setError("Master data is available to F&A only.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [s, v, c] = await Promise.all([
          api<Paginated<Store>>("/stores?pageSize=100"),
          api<Paginated<Vendor>>("/vendors?pageSize=100"),
          api<Paginated<Contract>>("/contracts?pageSize=100"),
        ]);
        if (!cancelled) {
          setStores(s.data);
          setVendors(v.data);
          setContracts(c.data);
        }
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
  }, [user]);

  if (user?.role !== "FA") {
    return (
      <div className="rounded border border-line bg-surface p-6">
        <h1 className="font-display text-3xl font-bold">Master data</h1>
        <p className="mt-2 text-muted">
          Switch to the <strong>F&amp;A</strong> role to manage stores, vendors,
          and contracts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold tracking-wide text-kfc uppercase">
          F&amp;A
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Master data
        </h1>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Master data sections">
        {(
          [
            ["stores", `Stores (${stores.length})`],
            ["vendors", `Vendors (${vendors.length})`],
            ["contracts", `Contracts (${contracts.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded px-3 py-2 text-sm font-semibold ${
              tab === key
                ? "bg-kfc text-white"
                : "border border-line bg-surface text-ink hover:border-kfc"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-muted">Loading…</p> : null}

      {!loading && tab === "stores" ? (
        <Table
          headers={["Code", "Name", "Region", "Cost center", "Status"]}
          rows={stores.map((s) => [
            s.storeCode,
            s.storeName,
            s.region ?? "—",
            s.costCenterCode ?? "—",
            <StatusBadge key={s.id} status={s.status} />,
          ])}
        />
      ) : null}

      {!loading && tab === "vendors" ? (
        <Table
          headers={["Code", "Legal name", "Type", "Tax ID", "Risk", "Banks"]}
          rows={vendors.map((v) => [
            v.vendorCode,
            v.legalName,
            v.vendorType,
            v.taxId ?? "—",
            v.riskLevel,
            String(v.bankAccounts?.length ?? 0),
          ])}
        />
      ) : null}

      {!loading && tab === "contracts" ? (
        <Table
          headers={["Contract", "Store", "Vendor", "Type", "Base amount", "Status"]}
          rows={contracts.map((c) => [
            c.contractNumber,
            c.store?.storeCode ?? c.storeId,
            c.vendor?.vendorCode ?? c.vendorId,
            c.contractType,
            formatVnd(c.baseAmount),
            <StatusBadge key={c.id} status={c.status} />,
          ])}
        />
      ) : null}
    </div>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded border border-line bg-surface">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-line bg-paper-2 text-xs tracking-wide text-muted uppercase">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={headers.length}
                className="px-3 py-8 text-center text-muted"
              >
                No rows
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b border-line/70 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2.5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
