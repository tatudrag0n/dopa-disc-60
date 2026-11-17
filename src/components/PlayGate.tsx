import { useEffect, useState } from "react";
import { tr, useI18n } from "../lib/i18n";
import { useTurnstile } from "../lib/turnstile";

interface Props {
  open: boolean;
  siteKey: string | null;
  lang: string;
  onDone: (token: string) => void;
  onFail: () => void;
}

/** ウィジェットの中身が現れないまま固まるのを防ぐ */
const WATCHDOG_MS = 10_000;

/**
 * プレイ前に毎回出す確認ダイアログ。
 * Turnstile のチェックボックスを表示し、通ったらトークンを返す。
 */
export function PlayGate({ open, siteKey, lang, onDone, onFail }: Props) {
  useI18n();
  const turnstile = useTurnstile(siteKey, lang, { visible: true, active: open });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    let cancelled = false;

    // 一定時間たってもウィジェットが描画されなければ失敗として扱う
    const watchdog = window.setTimeout(() => {
      if (cancelled) return;
      const el = turnstile.containerRef.current;
      if (!el || !el.querySelector("iframe")) setFailed(true);
    }, WATCHDOG_MS);

    void (async () => {
      try {
        const token = await turnstile.execute();
        if (cancelled) return;
        window.clearTimeout(watchdog);
        onDone(token);
      } catch {
        if (cancelled) return;
        window.clearTimeout(watchdog);
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
    };
    // open と再試行だけで走らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#14103a]/60 p-4 backdrop-blur-sm">
      <div className="pop-in w-full max-w-sm rounded-3xl border-2 border-[var(--line)] bg-[var(--surface)] p-5 text-center shadow-xl">
        <p className="text-[11px] font-black tracking-[0.2em] text-[var(--accent)]">
          {tr("playGate.badge")}
        </p>
        <h2 className="mt-1 text-lg font-black text-[var(--ink)]">{tr("playGate.title")}</h2>
        <p className="mt-1 text-[11px] font-bold leading-relaxed text-[var(--muted)]">
          {tr("playGate.desc")}
        </p>

        <div
          ref={turnstile.containerRef}
          className="mx-auto mt-3 flex min-h-[72px] w-full items-center justify-center"
        />

        <p className="mt-2 text-[10px] font-bold text-[var(--muted)]">{tr("playGate.bot")}</p>

        {failed && (
          <div className="mt-3">
            <p className="rounded-lg bg-[var(--accent)] px-2 py-1.5 text-[11px] font-black text-white">
              {tr("playGate.fail")}
            </p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-[11px] font-black text-white"
              >
                {tr("playGate.retry")}
              </button>
              <button
                type="button"
                onClick={onFail}
                className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[11px] font-black text-[var(--ink)]"
              >
                {tr("close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
