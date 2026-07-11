"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import type { UserRole } from "@/lib/types";

const DEMO_ACCOUNTS: Array<{ email: string; role: UserRole }> = [
  { email: "requester@kfc.vn", role: "REQUESTER" },
  { email: "hod@kfc.vn", role: "HOD" },
  { email: "fa@kfc.vn", role: "FA" },
  { email: "ca@kfc.vn", role: "CA" },
  { email: "cashier@kfc.vn", role: "CASHIER" },
];

const DEMO_PASSWORD = "KfcDemo2026!";

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("requester@kfc.vn");
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(email.trim(), password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setPending(false);
    }
  }

  function fillAccount(accountEmail: string) {
    setEmail(accountEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(135deg,#1a1a1a_0%,#2b1014_45%,#e4002b_140%)]"
      />
      <div
        aria-hidden
        className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-kfc/30 blur-3xl"
      />

      <div className="relative mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="text-white">
          <p className="font-display text-5xl font-bold tracking-tight sm:text-6xl">
            KFC
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Recurring Payments
          </h1>
          <p className="mt-3 max-w-md text-base text-white/75">
            Sign in with your work email to enter the payment workflow
            (Requester → HOD → F&amp;A → CA → Cashier).
          </p>
        </div>

        <div className="rounded border border-white/15 bg-white p-6 text-ink shadow-lg">
          <h2 className="font-display text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Email and password required</p>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                className="w-full rounded border border-line bg-paper px-3 py-2.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="requester@kfc.vn"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                className="w-full rounded border border-line bg-paper px-3 py-2.5"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error ? (
              <p className="rounded bg-red-50 px-3 py-2 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded bg-kfc px-4 py-2.5 text-sm font-semibold text-white hover:bg-kfc-dark disabled:opacity-60"
            >
              {pending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 border-t border-line pt-4">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">
              Demo accounts
            </p>
            <p className="mt-1 text-sm text-muted">
              Password for all:{" "}
              <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-ink">
                {DEMO_PASSWORD}
              </code>
            </p>
            <ul className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    onClick={() => fillAccount(a.email)}
                    className="flex w-full items-center justify-between rounded border border-line px-3 py-2 text-left text-sm hover:border-kfc"
                  >
                    <span>
                      <strong className="font-mono text-xs sm:text-sm">
                        {a.email}
                      </strong>
                      <span className="text-muted">
                        {" "}
                        · {ROLE_LABELS[a.role].title}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-kfc">Use</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
