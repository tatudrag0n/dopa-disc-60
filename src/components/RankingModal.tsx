import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { tr, useI18n } from "../lib/i18n";

interface Row {
  name: string;
  best: number;
  total: number;
  rank: string;
  playedAt: string;
}

interface Props {
  open: boolean;
  me: string | null;
  onClose: () => void;
}

/** 全プレイヤーのランキング（上位 20 件） */
export function RankingModal({ open, me, onClose }: Props) {
  useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setError(false);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "records.list", args: {} }),
        });
        const data = (await res.json()) as { records?: { value: Row }[] };
        if (!cancelled) setRows((data.records ?? []).map((r) => r.value));
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const medal = ["🥇", "🥈", "🥉"];

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-[#14103a]/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl border-2 border-[var(--line)] bg-[var(--surface)] shadow-xl">
        <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-[#ff6a00] via-[var(--accent)] to-[var(--accent-deep)] px-4 py-3 text-white">
          <h2 className="text-base font-black">{tr("rankingTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/25"
            aria-label={tr("close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {rows === null && !error && (
            <p className="py-8 text-center text-sm font-bold text-[var(--muted)]">{tr("flying")}</p>
          )}
          {error && (
            <p className="py-8 text-center text-sm font-bold text-[var(--accent)]">
              {tr("netRetry")}
            </p>
          )}
          {rows !== null && rows.length === 0 && (
            <p className="py-8 text-center text-sm font-bold text-[var(--muted)]">
              {tr("noRecords")}
            </p>
          )}

          {rows !== null && rows.length > 0 && (
            <ol className="space-y-1.5">
              {rows.map((r, i) => {
                const isMe = me !== null && r.name === me;
                return (
                  <li
                    key={`${r.name}-${i}`}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                      isMe ? "bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]" : "bg-[var(--bg)]"
                    }`}
                  >
                    <span className="w-7 shrink-0 text-center text-sm font-black text-[var(--muted)]">
                      {i < 3 ? medal[i] : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-black text-[var(--ink)]">
                      {r.name}
                    </span>
                    <span className="shrink-0 rounded-md bg-[var(--surface)] px-1.5 py-0.5 text-[11px] font-black text-[var(--accent)]">
                      {r.rank}
                    </span>
                    <span className="w-20 shrink-0 text-right text-sm font-black tabular-nums text-[var(--ink)]">
                      {r.total.toFixed(1)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] font-bold text-[var(--muted)]">
                      {r.best.toFixed(1)}m
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="border-t-2 border-[var(--line)] px-4 py-2.5 text-center text-[11px] font-bold text-[var(--muted)]">
          {tr("scoreIsDistance")}
        </div>
      </div>
    </div>
  );
}
