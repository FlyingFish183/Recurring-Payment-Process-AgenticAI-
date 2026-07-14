"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

const CHAT_ROLES = new Set<UserRole>(["CA", "CASHIER"]);

type ChatRow = Record<string, unknown>;

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      sql?: string | null;
      rows?: ChatRow[];
      error?: boolean;
    };

type QueryResult = {
  question: string;
  answer: string;
  mode: "sql" | "coverage" | "bank" | "vendor";
  sql: string | null;
  rowCount: number;
  rows: ChatRow[];
  model: string;
};

function ResultTable({ rows }: { rows: ChatRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-2 text-xs text-muted">No rows returned.</p>;
  }
  const cols = Object.keys(rows[0]!);
  return (
    <div className="mt-2 max-h-48 overflow-auto rounded border border-line bg-paper">
      <table className="w-full min-w-[16rem] border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-paper-2">
          <tr>
            {cols.map((c) => (
              <th key={c} className="border-b border-line px-2 py-1 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-white/60">
              {cols.map((c) => (
                <td key={c} className="border-b border-line/60 px-2 py-1 align-top">
                  {row[c] == null ? "—" : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnalyticsChat() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Ask in plain English — I’ll answer in text and show supporting data. Try: “What has store HN01 paid vs not paid in 2026-06?” or “bank accounts for store HN01”.",
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  if (!user || !CHAT_ROLES.has(user.role)) return null;

  async function send() {
    const question = input.trim();
    if (!question || busy) return;

    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", text: question },
    ]);
    setInput("");
    setBusy(true);

    try {
      const res = await api<QueryResult>("/chat/query", {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: res.answer,
          sql: res.sql,
          rows: res.rows,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          error: true,
          text: err instanceof Error ? err.message : "Query failed",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Close analytics chat" : "Open analytics chat"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 bottom-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white shadow-lg ring-1 ring-white/20 hover:bg-kfc"
      >
        {open ? (
          <span className="text-xl leading-none" aria-hidden>
            ×
          </span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 10h8M8 14h5M21 12a9 9 0 11-3.2-6.8L21 5v7z"
            />
          </svg>
        )}
      </button>

      {open ? (
        <aside
          className="fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
          aria-label="Analytics chat"
        >
          <header className="flex items-center justify-between border-b border-line bg-ink px-4 py-3 text-white">
            <div>
              <h2 className="font-display text-lg font-semibold">Analytics chat</h2>
              <p className="text-xs text-white/65">
                CA / Cashier · text answer + data
              </p>
            </div>
            <button
              type="button"
              className="rounded px-2 py-1 text-sm text-white/80 hover:bg-white/10"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded px-3 py-2 text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "ml-8 bg-kfc text-white"
                    : msg.error
                      ? "mr-4 bg-red-50 text-danger"
                      : "mr-4 bg-paper text-ink"
                }`}
              >
                <p>{msg.text}</p>
                {msg.role === "assistant" && msg.sql ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted">
                      Show SQL
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-ink/90 p-2 text-[10px] leading-snug text-emerald-200">
                      {msg.sql}
                    </pre>
                  </details>
                ) : null}
                {msg.role === "assistant" && msg.rows && msg.rows.length > 0 ? (
                  <ResultTable rows={msg.rows} />
                ) : null}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form
            className="border-t border-line bg-paper p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="analytics-chat-input">
              Ask a question
            </label>
            <div className="flex gap-2">
              <input
                id="analytics-chat-input"
                className="min-w-0 flex-1 rounded border border-line bg-surface px-3 py-2 text-sm"
                placeholder="e.g. HN01 paid vs unpaid for 2026-06"
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="rounded bg-kfc px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "…" : "Ask"}
              </button>
            </div>
          </form>
        </aside>
      ) : null}
    </>
  );
}
