import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trophy, UserRound } from "lucide-react";
import { ApiError, fetchLeaderboard } from "../lib/api";
import { SCORE_RANGES, type LeaderboardResponse, type ScoreRange } from "../shared/types";
import { useI18n } from "../lib/i18n";
import type { Player } from "../lib/usePlayer";

interface Props {
  user: Player | null;
  onRequireName: () => void;
  /** この値が変わると再取得する（スコア更新時） */
  refreshKey?: number;
  limit?: number;
  /** 親側に名前の導線がある場合は下部の CTA を出さない */
  showNameCta?: boolean;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({
  user,
  onRequireName,
  refreshKey = 0,
  limit = 50,
  showNameCta = true,
}: Props) {
  const { t } = useI18n();
  const [range, setRange] = useState<ScoreRange>("all");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (r: ScoreRange) => {
      setLoading(true);
      setError(null);
      try {
        setData(await fetchLeaderboard(r, limit));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t("error.network"));
      } finally {
        setLoading(false);
      }
    },
    [limit, t],
  );

  useEffect(() => {
    void load(range);
  }, [range, load, refreshKey]);

  const entries = data?.entries ?? [];
  const myId = data?.me?.entry.id ?? null;
  const rangeLabel = t(`ranking.range.${range}` as "ranking.range.all");

  return (
    <section aria-labelledby="leaderboard-title" className="card overflow-hidden rounded-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--violet)] px-4 py-3 text-white sm:px-5">
        <h2
          id="leaderboard-title"
          className="flex items-center gap-2 text-base font-black sm:text-lg"
        >
          <Trophy className="h-5 w-5" /> {t("ranking.titleOf", { range: rangeLabel })}
        </h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black">
            {t("ranking.players", { n: entries.length })}
          </span>
          <button
            type="button"
            onClick={() => void load(range)}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/20 transition hover:bg-white/30"
            aria-label={t("common.reload")}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
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
            {t(`ranking.range.${r}` as "ranking.range.all")}
          </button>
        ))}
      </div>

      {data?.me && (
        <div className="flex items-center justify-between gap-3 border-y-2 border-dashed border-[var(--line)] px-4 py-2.5 line-soft">
          <span className="text-xs font-black text-[var(--muted)]">{t("ranking.yourBest")}</span>
          <span className="flex items-center gap-2 text-sm font-black">
            <b className="text-[var(--pink)]">{data.me.entry.distance.toFixed(1)}m</b>
            <span className="rounded-full bg-[var(--yellow)] px-2 py-0.5 text-[11px] text-[#1c1030]">
              {data.me.rank > 0
                ? t("ranking.rank", { n: data.me.rank })
                : t("ranking.outOfRange")}
            </span>
          </span>
        </div>
      )}

      {/* トップ3の表彰台 */}
      {entries.length > 0 && (
        <div className="grid grid-cols-3 items-end gap-1.5 bg-[var(--surface-2)] px-2 pb-0 pt-4">
          {[1, 0, 2].map((idx) => {
            const e = entries[idx];
            if (!e) return <div key={`gap-${idx}`} aria-hidden="true" />;
            const isMe = e.id === myId;
            const top = idx === 0;
            return (
              <div
                key={e.id}
                className={`flex flex-col items-center gap-0.5 rounded-t-xl border-2 border-b-0 border-[var(--line)] px-1 pb-2 ${
                  top ? "pt-7" : idx === 1 ? "pt-4" : "pt-2"
                } ${isMe ? "bg-[var(--yellow)]" : "bg-[var(--surface)]"}`}
              >
                <span className={top ? "text-2xl" : "text-lg"} aria-hidden="true">
                  {MEDALS[idx]}
                </span>
                <span
                  className={`w-full truncate text-center text-[11px] font-black ${
                    isMe ? "text-[#1c1030]" : ""
                  }`}
                >
                  {e.name}
                </span>
                <span
                  className={`font-black tabular-nums ${top ? "text-base" : "text-sm"} ${
                    isMe ? "text-[#1c1030]" : "text-[var(--pink)]"
                  }`}
                >
                  {e.distance.toFixed(1)}
                  <span className="text-[9px]">m</span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="max-h-[420px] overflow-y-auto overscroll-contain">
        {loading && entries.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm font-bold text-[var(--muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading")}
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
              {t("common.retry")}
            </button>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-black">{t("ranking.empty.title")}</p>
            <p className="mt-1 text-xs font-bold text-[var(--muted)]">
              {t("ranking.empty.desc")}
            </p>
          </div>
        )}

        {entries.length > 3 && (
          <ol className="divide-y-2 divide-dashed divide-soft">
            {entries.slice(3).map((entry, i) => {
              const isMe = entry.id === myId;
              return (
                <li
                  key={entry.id}
                  className={`flex items-center gap-3 px-3 py-2.5 sm:px-4 ${
                    isMe ? "bg-soft-yellow-strong" : ""
                  }`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-xs font-black text-[var(--muted)]">
                    {i + 4}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-black">
                      {entry.name}
                      {isMe && (
                        <span className="shrink-0 rounded bg-[var(--pink)] px-1.5 py-0.5 text-[9px] font-black text-white">
                          {t("ranking.you")}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] font-bold text-[var(--muted)]">
                      {t("game.stat.shape")} {Math.round(entry.shapeScore)}% ・{" "}
                      {t("game.stat.rot")} {Math.round(entry.rot)} ・ {t("game.stat.mom")}{" "}
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

      {!user && showNameCta && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 line-soft">
          <p className="text-xs font-bold text-[var(--muted)]">{t("ranking.needName")}</p>
          <button
            type="button"
            onClick={onRequireName}
            className="flex items-center gap-1.5 rounded-full bg-[var(--pink)] px-3 py-1.5 text-xs font-black text-white"
          >
            <UserRound className="h-3.5 w-3.5" /> {t("ranking.setName")}
          </button>
        </div>
      )}
    </section>
  );
}
