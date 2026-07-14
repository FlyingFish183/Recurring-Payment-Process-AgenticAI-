"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatVnd } from "@/lib/format";
import type {
  BankAccount,
  Contract,
  Paginated,
  Store,
  UserRole,
  Vendor,
} from "@/lib/types";

type Tab = "vendors" | "contracts" | "stores";

const EDITORS = new Set<UserRole>(["FA", "CA"]);

const VENDOR_TYPES = ["LANDLORD", "UTILITY", "SERVICE", "SUPPLIER", "OTHER"] as const;
const CONTRACT_TYPES = ["RENT", "SERVICE", "UTILITY", "MAINTENANCE", "OTHER"] as const;

type DeleteResult = {
  id: string;
  deleted: boolean;
  deactivated?: boolean;
  reason?: string;
};

export default function MasterDataPage() {
  const { user } = useAuth();
  const canEdit = Boolean(user && EDITORS.has(user.role));

  const [tab, setTab] = useState<Tab>("vendors");
  const [stores, setStores] = useState<Store[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [vendorForm, setVendorForm] = useState({
    vendorCode: "",
    legalName: "",
    taxId: "",
    vendorType: "OTHER" as (typeof VENDOR_TYPES)[number],
  });
  const [bankForm, setBankForm] = useState({
    bankName: "",
    bankCode: "",
    accountNumber: "",
    accountName: "",
  });
  const [contractForm, setContractForm] = useState({
    contractNumber: "",
    storeId: "",
    vendorId: "",
    contractType: "RENT" as (typeof CONTRACT_TYPES)[number],
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    baseAmount: "",
  });

  const reload = useCallback(async () => {
    const [s, v, c] = await Promise.all([
      api<Paginated<Store>>("/stores?pageSize=100"),
      api<Paginated<Vendor>>("/vendors?pageSize=100"),
      api<Paginated<Contract>>("/contracts?pageSize=100"),
    ]);
    setStores(s.data);
    setVendors(v.data);
    setContracts(c.data);
    setContractForm((f) => ({
      ...f,
      storeId: f.storeId || s.data[0]?.id || "",
      vendorId: f.vendorId || v.data[0]?.id || "",
    }));
  }, []);

  useEffect(() => {
    if (!user || !canEdit) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await reload();
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
  }, [user, canEdit, reload]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="rounded border border-line bg-surface p-6">
        <h1 className="font-display text-3xl font-bold">Master data</h1>
        <p className="mt-2 text-muted">
          Switch to <strong>F&amp;A</strong> or <strong>Chief Accountant</strong>{" "}
          to manage vendors, bank accounts, and contracts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold tracking-wide text-kfc uppercase">
          F&amp;A / CA
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Master data
        </h1>
        <p className="mt-1 text-sm text-muted">
          Add or remove vendors, bank accounts, and store contracts.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Master data sections">
        {(
          [
            ["vendors", `Vendors (${vendors.length})`],
            ["contracts", `Contracts (${contracts.length})`],
            ["stores", `Stores (${stores.length})`],
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
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded bg-emerald-50 px-3 py-2 text-sm text-ok" role="status">
          {notice}
        </p>
      ) : null}
      {loading ? <p className="text-muted">Loading…</p> : null}

      {!loading && tab === "vendors" ? (
        <div className="space-y-4">
          <form
            className="grid gap-3 rounded border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/vendors", {
                  method: "POST",
                  body: JSON.stringify({
                    vendorCode: vendorForm.vendorCode.trim(),
                    legalName: vendorForm.legalName.trim(),
                    taxId: vendorForm.taxId.trim() || undefined,
                    vendorType: vendorForm.vendorType,
                  }),
                });
                setVendorForm({
                  vendorCode: "",
                  legalName: "",
                  taxId: "",
                  vendorType: "OTHER",
                });
                setNotice("Vendor created");
              });
            }}
          >
            <Field
              label="Vendor code"
              value={vendorForm.vendorCode}
              onChange={(v) => setVendorForm((f) => ({ ...f, vendorCode: v }))}
              required
            />
            <Field
              label="Legal name"
              value={vendorForm.legalName}
              onChange={(v) => setVendorForm((f) => ({ ...f, legalName: v }))}
              required
            />
            <Field
              label="Tax ID"
              value={vendorForm.taxId}
              onChange={(v) => setVendorForm((f) => ({ ...f, taxId: v }))}
            />
            <label className="text-sm">
              <span className="mb-1 block font-medium">Type</span>
              <select
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={vendorForm.vendorType}
                onChange={(e) =>
                  setVendorForm((f) => ({
                    ...f,
                    vendorType: e.target.value as (typeof VENDOR_TYPES)[number],
                  }))
                }
              >
                {VENDOR_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded bg-kfc px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Add vendor
              </button>
            </div>
          </form>

          <div className="space-y-3">
            {vendors.length === 0 ? (
              <p className="text-sm text-muted">No vendors yet.</p>
            ) : (
              vendors.map((v) => {
                const open = expandedVendorId === v.id;
                const banks = v.bankAccounts ?? [];
                return (
                  <section
                    key={v.id}
                    className="rounded border border-line bg-surface"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <button
                          type="button"
                          className="text-left font-semibold hover:text-kfc"
                          onClick={() =>
                            setExpandedVendorId(open ? null : v.id)
                          }
                        >
                          {v.vendorCode} — {v.legalName}
                        </button>
                        <p className="mt-0.5 text-xs text-muted">
                          {v.vendorType} · tax {v.taxId ?? "—"} ·{" "}
                          {banks.length} bank account
                          {banks.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={v.status} />
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-50"
                          onClick={() => {
                            if (
                              !confirm(
                                `Delete vendor ${v.vendorCode}? If it has history it will be deactivated instead.`,
                              )
                            ) {
                              return;
                            }
                            void run(async () => {
                              const res = await api<DeleteResult>(
                                `/vendors/${v.id}`,
                                { method: "DELETE" },
                              );
                              setNotice(
                                res.deleted
                                  ? "Vendor deleted"
                                  : res.reason ?? "Vendor deactivated",
                              );
                              if (expandedVendorId === v.id) {
                                setExpandedVendorId(null);
                              }
                            });
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {open ? (
                      <div className="border-t border-line bg-paper/60 px-4 py-4">
                        <h3 className="text-sm font-semibold">Bank accounts</h3>
                        <ul className="mt-2 space-y-2">
                          {banks.length === 0 ? (
                            <li className="text-xs text-muted">No active accounts</li>
                          ) : (
                            banks.map((b: BankAccount) => (
                              <li
                                key={b.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-surface px-3 py-2 text-sm"
                              >
                                <div>
                                  <div className="font-medium">
                                    {b.bankName}
                                    {b.bankCode ? ` (${b.bankCode})` : ""}
                                  </div>
                  <div className="text-xs text-muted">
                    {b.accountName} · {b.accountNumber ?? "—"}
                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-danger disabled:opacity-50"
                                  onClick={() => {
                                    if (!confirm("Remove this bank account?")) {
                                      return;
                                    }
                                    void run(async () => {
                                      const res = await api<DeleteResult>(
                                        `/bank-accounts/${b.id}`,
                                        { method: "DELETE" },
                                      );
                                      setNotice(
                                        res.deleted
                                          ? "Bank account deleted"
                                          : res.reason ?? "Bank account deactivated",
                                      );
                                    });
                                  }}
                                >
                                  Delete
                                </button>
                              </li>
                            ))
                          )}
                        </ul>

                        <form
                          className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void run(async () => {
                              await api(`/vendors/${v.id}/bank-accounts`, {
                                method: "POST",
                                body: JSON.stringify({
                                  bankName: bankForm.bankName.trim(),
                                  bankCode: bankForm.bankCode.trim() || undefined,
                                  accountNumber: bankForm.accountNumber.trim(),
                                  accountName: bankForm.accountName.trim(),
                                }),
                              });
                              setBankForm({
                                bankName: "",
                                bankCode: "",
                                accountNumber: "",
                                accountName: "",
                              });
                              setNotice("Bank account added");
                            });
                          }}
                        >
                          <Field
                            label="Bank name"
                            value={bankForm.bankName}
                            onChange={(val) =>
                              setBankForm((f) => ({ ...f, bankName: val }))
                            }
                            required
                          />
                          <Field
                            label="Bank code"
                            value={bankForm.bankCode}
                            onChange={(val) =>
                              setBankForm((f) => ({ ...f, bankCode: val }))
                            }
                          />
                          <Field
                            label="Account number"
                            value={bankForm.accountNumber}
                            onChange={(val) =>
                              setBankForm((f) => ({ ...f, accountNumber: val }))
                            }
                            required
                          />
                          <Field
                            label="Account name"
                            value={bankForm.accountName}
                            onChange={(val) =>
                              setBankForm((f) => ({ ...f, accountName: val }))
                            }
                            required
                          />
                          <div className="flex items-end">
                            <button
                              type="submit"
                              disabled={busy}
                              className="w-full rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              Add bank
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : null}
                  </section>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {!loading && tab === "contracts" ? (
        <div className="space-y-4">
          <form
            className="grid gap-3 rounded border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/contracts", {
                  method: "POST",
                  body: JSON.stringify({
                    contractNumber: contractForm.contractNumber.trim(),
                    storeId: contractForm.storeId,
                    vendorId: contractForm.vendorId,
                    contractType: contractForm.contractType,
                    startDate: contractForm.startDate,
                    endDate: contractForm.endDate || undefined,
                    baseAmount: Number(contractForm.baseAmount),
                    currency: "VND",
                  }),
                });
                setContractForm((f) => ({
                  ...f,
                  contractNumber: "",
                  baseAmount: "",
                  endDate: "",
                }));
                setNotice("Contract created");
              });
            }}
          >
            <Field
              label="Contract number"
              value={contractForm.contractNumber}
              onChange={(v) =>
                setContractForm((f) => ({ ...f, contractNumber: v }))
              }
              required
            />
            <label className="text-sm">
              <span className="mb-1 block font-medium">Store</span>
              <select
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={contractForm.storeId}
                onChange={(e) =>
                  setContractForm((f) => ({ ...f, storeId: e.target.value }))
                }
                required
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.storeCode} — {s.storeName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Vendor</span>
              <select
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={contractForm.vendorId}
                onChange={(e) =>
                  setContractForm((f) => ({ ...f, vendorId: e.target.value }))
                }
                required
              >
                {vendors
                  .filter((v) => v.status === "ACTIVE")
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vendorCode} — {v.legalName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Type</span>
              <select
                className="w-full rounded border border-line bg-paper px-3 py-2"
                value={contractForm.contractType}
                onChange={(e) =>
                  setContractForm((f) => ({
                    ...f,
                    contractType: e.target
                      .value as (typeof CONTRACT_TYPES)[number],
                  }))
                }
              >
                {CONTRACT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Start date"
              type="date"
              value={contractForm.startDate}
              onChange={(v) =>
                setContractForm((f) => ({ ...f, startDate: v }))
              }
              required
            />
            <Field
              label="End date"
              type="date"
              value={contractForm.endDate}
              onChange={(v) => setContractForm((f) => ({ ...f, endDate: v }))}
            />
            <Field
              label="Base amount (VND)"
              value={contractForm.baseAmount}
              onChange={(v) =>
                setContractForm((f) => ({ ...f, baseAmount: v }))
              }
              required
            />
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy || !contractForm.storeId || !contractForm.vendorId}
                className="w-full rounded bg-kfc px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Add contract
              </button>
            </div>
          </form>

          <Table
            headers={[
              "Contract",
              "Store",
              "Vendor",
              "Type",
              "Base amount",
              "Status",
              "",
            ]}
            rows={contracts.map((c) => [
              c.contractNumber,
              c.store?.storeCode ?? c.storeId,
              c.vendor?.vendorCode ?? c.vendorId,
              c.contractType,
              formatVnd(c.baseAmount),
              <StatusBadge key={`${c.id}-st`} status={c.status} />,
              <button
                key={`${c.id}-del`}
                type="button"
                disabled={busy}
                className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-danger disabled:opacity-50"
                onClick={() => {
                  if (
                    !confirm(
                      `Delete contract ${c.contractNumber}? In-use contracts are terminated instead.`,
                    )
                  ) {
                    return;
                  }
                  void run(async () => {
                    const res = await api<DeleteResult>(`/contracts/${c.id}`, {
                      method: "DELETE",
                    });
                    setNotice(
                      res.deleted
                        ? "Contract deleted"
                        : res.reason ?? "Contract terminated",
                    );
                  });
                }}
              >
                Delete
              </button>,
            ])}
          />
        </div>
      ) : null}

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
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        type={type}
        className="w-full rounded border border-line bg-paper px-3 py-2"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
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
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} className="px-3 py-2 font-semibold">
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
