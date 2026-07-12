"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AnalyticsChat } from "@/components/AnalyticsChat";
import { useAuth } from "@/lib/auth";
import { canAccess, NAV_ITEMS, ROLE_LABELS } from "@/lib/roles";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Loading workspace…
      </div>
    );
  }

  const nav = NAV_ITEMS.filter((item) => canAccess(user.role, item));
  const roleMeta = ROLE_LABELS[user.role];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-ink text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold tracking-tight text-kfc">
              KFC
            </span>
            <span className="text-sm font-medium text-white/80">
              Recurring Payments
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="rounded bg-white/10 px-3 py-1.5">
              <span className="text-white/60">Acting as </span>
              <strong>{roleMeta.title}</strong>
              <span className="text-white/50"> · {user.displayName}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="rounded bg-kfc px-3 py-1.5 font-medium hover:bg-kfc-dark"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6"
        >
          {nav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : item.href === "/payment-requests"
                  ? pathname === "/payment-requests" ||
                    /^\/payment-requests\/[^/]+$/.test(pathname)
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded px-3 py-2 text-sm whitespace-nowrap ${
                  active
                    ? "bg-kfc text-white"
                    : "text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      <AnalyticsChat />
    </div>
  );
}
