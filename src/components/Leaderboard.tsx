import { useCallback, useEffect, useState } from "react";
import { Crown, Loader2, LogIn, RefreshCw, Trophy } from "lucide-react";
import { ApiError, fetchLeaderboard } from "../lib/api";
import { RANGE_LABEL, SCORE_RANGES, type LeaderboardResponse, type ScoreRange } from "../shared/types";
import type { AuthUser } from "../lib/useAuth";

interface Props {
  user: AuthUser | null;
  onRequireAuth: () => void;
  /** この値が変わると再取得する（スコア更新時） */
  refreshKey?: number;
  limit?: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({ user, onRequireAuth, refreshKey = 0, limit = 50 }: Props) {
  const [range, setRange] = useState<ScoreRange>("all");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (r: ScoreRange) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchLeaderboard(r, limit);
        setData(res);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "ランキングの取得に失敗しました");
      } finally {
        setLoading(false);
      }
    },
    [limit],
  );

  useEffect(() => {
    void load(range);
  }, [range, load, refreshKey]);

  const entries = data?.entries ?? [];
  const myId = data?.me?.entry.id ?? null;

  return (
    <section aria-labelledby="leaderboard-title" className="card rounded-3xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--violet)] px-4 py-3 text-white sm:px-5">
        <h2 id="leaderboard-title" className="flex items-center gap-2 text-base font-black sm:text-lg">
          <Trophy className="h-5 w-5" /> ランキング
        </h2>
        <button
          type="button"
          onClick={() => void load(range)}
          className="grid h-8 w-8 place-items-center rounded-full bg-white/20 transition hover:bg-white/30"
          aria-label="再読み込み"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex gap-1.5 bg-[var(--surface-2)] px-3 py-2.5 sm:px-4" role="tablist">
        {SCORE_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={range === r}
            onClick={() => setRange(r)}
            className={`flex-1 rounded-full border-2 border-[var(--line)] px-3 py-1.5 text-xs font-black transition sm:text-sm ${
              range === r
                ? "bg-[var(--pink)] text-white"
                : "bg-[var(--surface)] text-[var(--muted)]"
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      {data?.me && (
        <div className="flex items-center justify-between gap-3 border-y-2 border-dashed line-soft bg-[var(--surface-2)] px-4 py-2.5">
          <span className="text-xs font-black text-[var(--muted)]">あなたのベスト</span>
          <span className="flex items-center gap-2 text-sm font-black">
            <b className="text-[var(--pink)]">{data.me.entry.distance.toFixed(1)}m</b>
            <span className="rounded-full bg-[var(--yellow)] px-2 py-0.5 text-[11px] text-[#1c1030]">
              {data.me.rank > 0 ? `${data.me.rank}位` : "圏外"}
            </span>
          </span>
        </div>
      )}

      <div className="max-h-[420px] overflow-y-auto overscroll-contain">
        {loading && entries.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm font-bold text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> 読み込み中…
          </div>
        )}

        {error && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
            <button
              type="button"
              onClick={() => void load(range)}
              className="btn-3d mt-3 rounded-xl bg-[var(--surface-2)] px-4 py-2 text-xs font-black"
            >
              再試行
            </button>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-black">まだ記録がありません</p>
            <p className="mt-1 text-xs font-bold text-[var(--muted)]">
              1位になって名前を刻もう。
            </p>
          </div>
        )}

        {entries.length > 0 && (
          <ol className="divide-y-2 divide-dashed divide-soft">
            {entries.map((entry, i) => {
              const isMe = entry.id === myId;
              return (
                <li
                  key={entry.id}
                  className={`flex items-center gap-3 px-3 py-2.5 sm:px-4 ${
                    isMe ? "bg-soft-yellow-strong" : ""
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${
                      i < 3
                        ? "bg-[var(--surface-2)] text-base"
                        : "bg-[var(--surface-2)] text-[var(--muted)]"
                    }`}
                    aria-label={`${i + 1}位`}
                  >
                    {i < 3 ? MEDALS[i] : i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-black">
                      {entry.name}
                      {isMe && (
                        <span className="shrink-0 rounded bg-[var(--pink)] px-1.5 py-0.5 text-[9px] font-black text-white">
                          YOU
                        </span>
                      )}
                      {i === 0 && <Crown className="h-3.5 w-3.5 shrink-0 text-[var(--yellow)]" />}
                    </p>
                    <p className="text-[10px] font-bold text-[var(--muted)]">
                      形 {Math.round(entry.shapeScore)}% ・ 回転 {Math.round(entry.rot)} ・ 勢い{" "}
                      {Math.round(entry.mom)}%
                    </p>
                  </div>

                  <span className="shrink-0 text-right text-sm font-black tabular-nums text-[var(--pink)]">
                    {entry.distance.toFixed(1)}
                    <span className="text-[10px] text-[var(--muted)]">m</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {!user && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-dashed line-soft bg-[var(--surface-2)] px-4 py-3">
          <p className="text-xs font-bold text-[var(--muted)]">
            ログインすると記録を登録できます
          </p>
          <button
            type="button"
            onClick={onRequireAuth}
            className="flex items-center gap-1.5 rounded-full bg-[var(--pink)] px-3 py-1.5 text-xs font-black text-white"
          >
            <LogIn className="h-3.5 w-3.5" /> ログイン
          </button>
        </div>
      )}
    </section>
  );
}
