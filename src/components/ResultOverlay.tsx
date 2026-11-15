import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, Share2, ShieldCheck, Trophy, UserRound } from "lucide-react";
import { ApiError, submitScore } from "../lib/api";
import type { PlayResult } from "../game/engine";
import { distanceCommentKey, improvementHintKey, shapeCommentKey } from "../lib/texts";
import { useI18n } from "../lib/i18n";
import { useTurnstile } from "../lib/turnstile";
import { NAME_MAX, NAME_MIN } from "../shared/types";
import type { Player } from "../lib/usePlayer";

const SHARE_URL = "https://discgame.mct-official.com/";

interface Props {
  result: PlayResult;
  user: Player | null;
  siteKey: string | null;
  personalBest: number;
  onRetry: () => void;
  onOpenRanking: () => void;
  onPlayerCreated: (name: string) => void;
  onSubmitted: () => void;
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "submitting" }
  | { kind: "done"; rank: number }
  | { kind: "error"; message: string };

export function ResultOverlay({
  result,
  user,
  siteKey,
  personalBest,
  onRetry,
  onOpenRanking,
  onPlayerCreated,
  onSubmitted,
}: Props) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [display, setDisplay] = useState(0);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const { containerRef: turnstileRef, execute: executeTurnstile } = useTurnstile(siteKey, lang);

  // 数字のカウントアップ
  useEffect(() => {
    const target = result.distance;
    const start = performance.now();
    const dur = 750;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / dur);
      setDisplay(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.distance]);

  const doSubmit = useCallback(
    async (playerName?: string) => {
      setState({ kind: "checking" });
      let token = "";
      try {
        token = await executeTurnstile();
      } catch {
        setState({ kind: "error", message: t("error.botFailed") });
        return;
      }
      setState({ kind: "submitting" });
      try {
        const res = await submitScore({
          shapeScore: result.shapeScore,
          rot: result.rot,
          mom: result.mom,
          name: playerName,
          turnstileToken: token,
        });
        setState({ kind: "done", rank: res.rank });
        if (playerName) onPlayerCreated(playerName);
        onSubmitted();
      } catch (err) {
        setState({ kind: "error", message: describeError(err) });
      }
    },
    [executeTurnstile, onPlayerCreated, onSubmitted, result, t, lang],
  );

  /** サーバーのメッセージは日本語なので、状態コードで英語に寄せる */
  function describeError(err: unknown): string {
    if (!(err instanceof ApiError)) return t("error.generic");
    if (err.status === 0) return t("error.network");
    if (err.status === 403) return t("error.botFailed");
    if (err.status === 429) return t("error.rateLimit");
    if (err.status === 401 || err.status === 400) {
      return lang === "ja" ? err.message : t("error.nameRequired");
    }
    return lang === "ja" ? err.message : t("error.generic");
  }

  // 名前を決めているプレイヤーは自動で投稿する
  useEffect(() => {
    if (!user || submittedRef.current) return;
    submittedRef.current = true;
    void doSubmit();
  }, [user, doSubmit]);

  const isBest = result.distance > personalBest;
  const comment = t(distanceCommentKey(result.distance));
  const hint = t(improvementHintKey(result));

  function validateName(value: string): string | null {
    const n = value.trim();
    if (n.length < NAME_MIN) return t("name.err.short", { min: NAME_MIN });
    if (n.length > NAME_MAX) return t("name.err.long", { max: NAME_MAX });
    if (!/^[\p{L}\p{N}_\-. 　]+$/u.test(n)) return t("name.err.chars");
    return null;
  }

  function startWithName(e: React.FormEvent) {
    e.preventDefault();
    const error = validateName(name);
    if (error) {
      setNameError(error);
      return;
    }
    setNameError(null);
    submittedRef.current = true;
    void doSubmit(name.trim());
  }

  async function share() {
    const text = t("result.shareText", { v: result.distance.toFixed(1) });
    try {
      if (navigator.share) {
        await navigator.share({ title: t("app.title"), text, url: SHARE_URL });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${SHARE_URL}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* キャンセルは無視 */
    }
  }

  const busy = state.kind === "checking" || state.kind === "submitting";

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center overflow-y-auto bg-black/55 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-title"
    >
      <div className="pop-in my-auto w-full max-w-md rounded-3xl border-[3px] border-[var(--line)] bg-[var(--surface)] p-5 shadow-[8px_8px_0_var(--line)] sm:p-7">
        <div className="relative">
          <p className="text-center text-[10px] font-black tracking-[0.3em] text-[var(--pink)]">
            {t("result.title")}
          </p>
          <button
            type="button"
            onClick={() => void share()}
            className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full border-2 border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-black transition active:scale-95"
            aria-label={t("result.share")}
          >
            {copied ? (
              <Check className="h-3 w-3 text-[var(--green)]" />
            ) : (
              <Share2 className="h-3 w-3" />
            )}
            {copied ? t("result.copied") : t("result.share")}
          </button>
        </div>

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
            {t("result.best")}
          </p>
        )}

        <div className="mt-4 space-y-2 rounded-2xl bg-[var(--surface-2)] p-3">
          <StatRow
            label={t("game.stat.shape")}
            value={result.shapeScore}
            max={100}
            unit="%"
            note={t(shapeCommentKey(result.shapeScore))}
          />
          <StatRow label={t("game.stat.rot")} value={result.rot} max={250} unit="" />
          <StatRow label={t("game.stat.mom")} value={result.mom} max={100} unit="%" />
        </div>

        <p className="mt-2 rounded-lg bg-soft-yellow px-3 py-1.5 text-center text-[11px] font-black">
          {hint}
        </p>

        {/* 名前が未設定なら、ここで決めてもらう（パスワード不要） */}
        {!user && (
          <form onSubmit={startWithName} className="mt-3 rounded-2xl bg-[var(--surface-2)] p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-black text-[var(--muted)]">
              <UserRound className="h-3.5 w-3.5" /> {t("result.needName")}
            </p>
            <div className="mt-2 flex gap-2">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                maxLength={NAME_MAX}
                placeholder={t("name.placeholder")}
                aria-label={t("name.label")}
                className="min-w-0 flex-1 rounded-xl border-2 border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-sm font-bold text-[var(--ink)] outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="btn-3d play-btn shrink-0 rounded-xl px-4 py-2.5 text-sm font-black"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("name.start")}
              </button>
            </div>
            {nameError && (
              <p className="mt-2 rounded-lg bg-[var(--danger)] px-2 py-1.5 text-[11px] font-black text-white">
                {nameError}
              </p>
            )}
          </form>
        )}

        <div className="mt-3 min-h-[44px]" aria-live="polite">
          {(state.kind === "checking" || state.kind === "submitting") && (
            <p className="flex items-center justify-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-xs font-black text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {state.kind === "checking" ? t("result.botCheck") : t("result.submitting")}
            </p>
          )}

          {state.kind === "done" && (
            <p className="flex items-center justify-center gap-2 rounded-xl bg-[var(--green)] px-3 py-2.5 text-xs font-black text-white">
              <Trophy className="h-4 w-4" />
              {state.rank > 0
                ? t("result.ranked", { n: state.rank })
                : t("result.rankedNoRank")}
            </p>
          )}

          {state.kind === "error" && (
            <div className="rounded-xl bg-[var(--danger)] px-3 py-2 text-center">
              <p className="text-xs font-black text-white">{state.message}</p>
              {user && (
                <button
                  type="button"
                  onClick={() => void doSubmit()}
                  className="mt-1.5 rounded-full bg-white/25 px-3 py-1 text-[11px] font-black text-white"
                >
                  {t("common.retry")}
                </button>
              )}
            </div>
          )}

          {state.kind === "idle" && !user && (
            <p className="flex items-center justify-center gap-1.5 text-[10px] font-bold text-[var(--muted)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Cloudflare Turnstile
            </p>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="btn-3d play-btn flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-black"
          >
            <RotateCcw className="h-4 w-4" /> {t("result.retry")}
          </button>
          <button
            type="button"
            onClick={onOpenRanking}
            className="btn-3d flex items-center justify-center gap-2 rounded-xl bg-[var(--surface-2)] py-3.5 text-sm font-black"
          >
            <Trophy className="h-4 w-4" /> {t("sheet.ranking")}
          </button>
        </div>

        {/* Turnstile のウィジェット（通常は不可視） */}
        <div ref={turnstileRef} className="mt-2 flex justify-center" />
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
      <span className="w-12 shrink-0 text-[11px] font-black text-[var(--muted)]">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--yellow)] via-[var(--pink)] to-[var(--violet)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-xs font-black tabular-nums">
        {Math.round(value)}
        {unit}
      </span>
      {note && (
        <span className="hidden w-24 shrink-0 text-right text-[10px] font-bold text-[var(--muted)] sm:block">
          {note}
        </span>
      )}
    </div>
  );
}
