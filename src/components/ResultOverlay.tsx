import { useEffect, useMemo, useRef, useState } from "react";
import { Home, Loader2, LogIn, RotateCcw, Trophy } from "lucide-react";
import { ApiError, submitScore } from "../lib/api";
import { distanceComment, improvementHint, shapeComment, type PlayResult } from "../game/engine";
import type { AuthUser } from "../lib/useAuth";

interface Props {
  result: PlayResult;
  user: AuthUser | null;
  accessEnabled: boolean;
  personalBest: number;
  onRetry: () => void;
  onHome: () => void;
  onRequireAuth: () => void;
  /** 投稿が成功したら呼ぶ（ランキング再取得用） */
  onSubmitted: (info: { rank: number; isNewPersonalBest: boolean }) => void;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; rank: number; isNew: boolean }
  | { kind: "error"; message: string }
  | { kind: "guest" };

export function ResultOverlay({
  result,
  user,
  accessEnabled,
  personalBest,
  onRetry,
  onHome,
  onRequireAuth,
  onSubmitted,
}: Props) {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [display, setDisplay] = useState(0);
  const submittedRef = useRef(false);

  // 数字のカウントアップ
  useEffect(() => {
    const target = result.distance;
    const start = performance.now();
    const dur = 750;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.distance]);

  // ログイン済みなら自動でランキングへ投稿
  useEffect(() => {
    if (submittedRef.current) return;
    if (!user) {
      setState({ kind: "guest" });
      return;
    }
    submittedRef.current = true;
    setState({ kind: "submitting" });
    void (async () => {
      try {
        const res = await submitScore({
          shapeScore: result.shapeScore,
          rot: result.rot,
          mom: result.mom,
        });
        setState({ kind: "done", rank: res.rank, isNew: res.isNewPersonalBest });
        onSubmitted({ rank: res.rank, isNewPersonalBest: res.isNewPersonalBest });
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof ApiError ? err.message : "投稿に失敗しました",
        });
      }
    })();
  }, [user, result, onSubmitted]);

  const isBest = result.distance > personalBest;
  const comment = useMemo(() => distanceComment(result.distance), [result.distance]);
  const hint = useMemo(() => improvementHint(result), [result]);

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-title"
    >
      <div className="pop-in my-auto w-full max-w-md rounded-3xl border-[3px] border-[var(--line)] bg-[var(--surface)] p-5 shadow-[8px_8px_0_var(--line)] sm:p-7">
        <p className="text-center text-[10px] font-black tracking-[0.3em] text-[var(--pink)]">
          RESULT
        </p>

        <h2 id="result-title" className="mt-1 text-center text-sm font-black text-[var(--muted)]">
          {comment}
        </h2>

        <p
          className="display-font mt-1 text-center text-[clamp(3.4rem,17vw,5.2rem)] font-black leading-none text-[var(--pink)] tabular-nums"
          aria-live="polite"
        >
          {display.toFixed(1)}
          <span className="text-[clamp(1.2rem,6vw,1.8rem)] text-[var(--muted)]">m</span>
        </p>

        {isBest && (
          <p className="pop mx-auto mt-2 w-fit rounded-full bg-[var(--yellow)] px-3 py-1 text-xs font-black text-[#1c1030]">
            自己ベスト更新！
          </p>
        )}

        {/* 内訳 */}
        <div className="mt-4 space-y-2 rounded-2xl bg-[var(--surface-2)] p-3">
          <StatRow label="形" value={result.shapeScore} max={100} unit="%" note={shapeComment(result.shapeScore)} />
          <StatRow label="回転" value={result.rot} max={250} unit="" />
          <StatRow label="勢い" value={result.mom} max={100} unit="%" />
        </div>

        <p className="mt-2 rounded-lg bg-soft-yellow px-3 py-1.5 text-center text-[11px] font-black">
          {hint}
        </p>

        {/* 投稿ステータス */}
        <div className="mt-3 min-h-[44px]" aria-live="polite">
          {state.kind === "submitting" && (
            <p className="flex items-center justify-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-xs font-black text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> ランキングに登録中…
            </p>
          )}

          {state.kind === "done" && (
            <p className="flex items-center justify-center gap-2 rounded-xl bg-[var(--green)] px-3 py-2.5 text-xs font-black text-white">
              <Trophy className="h-4 w-4" />
              {state.rank > 0 ? `ランキング ${state.rank}位 に登録しました` : "ランキングに登録しました"}
            </p>
          )}

          {state.kind === "error" && (
            <p className="rounded-xl bg-[var(--danger)] px-3 py-2.5 text-center text-xs font-black text-white">
              {state.message}
            </p>
          )}

          {state.kind === "guest" && (
            <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2.5">
              <p className="text-center text-[11px] font-bold text-[var(--muted)]">
                {accessEnabled
                  ? "ランキング登録には Cloudflare Access の認証が必要です"
                  : "ランキングに登録するにはログインしてください"}
              </p>
              <button
                type="button"
                onClick={onRequireAuth}
                className="btn-3d mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--violet)] py-2 text-xs font-black text-white"
              >
                <LogIn className="h-4 w-4" />
                {accessEnabled ? "認証する" : "ログイン / 新規登録"}
              </button>
            </div>
          )}
        </div>

        {/* アクション */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="btn-3d play-btn flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-black"
          >
            <RotateCcw className="h-4 w-4" /> もう一度
          </button>
          <button
            type="button"
            onClick={onHome}
            className="btn-3d flex items-center justify-center gap-2 rounded-xl bg-[var(--surface-2)] py-3.5 text-sm font-black"
          >
            <Home className="h-4 w-4" /> ホーム
          </button>
        </div>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  max,
  unit,
  note,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  note?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-[11px] font-black text-[var(--muted)]">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--yellow)] via-[var(--pink)] to-[var(--violet)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right text-xs font-black tabular-nums">
        {Math.round(value)}
        {unit}
      </span>
      {note && (
        <span className="hidden w-20 shrink-0 text-right text-[10px] font-bold text-[var(--muted)] sm:block">
          {note}
        </span>
      )}
    </div>
  );
}
