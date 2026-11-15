import { Trophy } from "lucide-react";
import { rankLabel, tr, useI18n } from "../lib/i18n";
import type { RankRow } from "../lib/useRanking";

interface Props {
  rows: RankRow[];
  me: string | null;
  onOpenFull: () => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const TOP_N = 10;

/**
 * 常時表示のランキング。
 * - 広い画面: 右側に固定サイドバー
 * - 狭い画面: 左下に「自分の順位」を出す小さなチップ（タップで全画面一覧）
 */
export function RankingPanel({ rows, me, onOpenFull }: Props) {
  useI18n();

  const myIndex = me ? rows.findIndex((r) => r.name === me) : -1;
  const mine = myIndex >= 0 ? rows[myIndex] : null;
  const top = rows.slice(0, TOP_N);

  return (
    <>
      {/* デスクトップ: 常時表示のサイドバー */}
      <aside
        aria-label={tr("rankingTitle")}
        className="fixed right-0 top-0 z-[60] hidden h-full w-[320px] flex-col border-l-2 border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur lg:flex"
      >
        <div className="flex items-center gap-2 border-b-2 border-[var(--line)] bg-gradient-to-r from-[#ff6a00] via-[var(--accent)] to-[var(--accent-deep)] px-4 py-3 text-white">
          <Trophy className="h-5 w-5" />
          <h2 className="text-sm font-black">{tr("rankingTitle")}</h2>
        </div>

        {mine && (
          <div className="border-b-2 border-[var(--line)] bg-[var(--accent-soft)] px-4 py-2.5">
            <p className="text-[10px] font-black tracking-wider text-[var(--muted)]">
              {tr("best")}
            </p>
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="text-xl font-black tabular-nums text-[var(--ink)]">
                {mine.total.toFixed(1)}
              </span>
              <span className="text-xs font-black text-[var(--accent)]">
                {rankLabel(myIndex + 1)} / {mine.rank}
              </span>
            </p>
          </div>
        )}

        <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
          {top.length === 0 && (
            <li className="px-3 py-6 text-center text-xs font-bold text-[var(--muted)]">
              {tr("noRecords")}
            </li>
          )}
          {top.map((r, i) => {
            const isMe = me !== null && r.name === me;
            return (
              <li
                key={`${r.name}-${i}`}
                className={`flex items-center gap-2 rounded-xl px-2.5 py-2 ${
                  isMe ? "bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]" : "bg-[var(--surface)]"
                }`}
              >
                <span className="w-6 shrink-0 text-center text-xs font-black text-[var(--muted)]">
                  {i < 3 ? MEDALS[i] : i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-black text-[var(--ink)]">
                  {r.name}
                </span>
                <span className="shrink-0 text-xs font-black tabular-nums text-[var(--ink)]">
                  {r.total.toFixed(1)}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="border-t-2 border-[var(--line)] px-4 py-2 text-center text-[10px] font-bold text-[var(--muted)]">
          {tr("scoreIsDistance")}
        </div>
      </aside>

      {/* モバイル: 常時表示のチップ（タップで全画面一覧） */}
      <button
        type="button"
        onClick={onOpenFull}
        className="fixed left-2 z-[60] flex items-center gap-1.5 rounded-full border-2 border-[var(--line)] bg-[var(--surface)]/95 px-3 py-1.5 text-[11px] font-black text-[var(--ink)] shadow-md backdrop-blur lg:hidden"
        style={{ bottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <Trophy className="h-3.5 w-3.5 text-[var(--accent)]" />
        {mine ? (
          <>
            <span>{rankLabel(myIndex + 1)}</span>
            <span className="tabular-nums text-[var(--accent)]">{mine.total.toFixed(1)}</span>
          </>
        ) : (
          <span>{tr("rankingTitle")}</span>
        )}
      </button>
    </>
  );
}
