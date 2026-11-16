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

/**
 * プレイ前に毎回出す確認ダイアログ。
 * Turnstile のチェックボックスを表示し、通ったらトークンを返す。
 */
export function PlayGate({ open, siteKey, lang, onDone, onFail }: Props) {
  useI18n();
  const turnstile = useTurnstile(siteKey, lang, { visible: true });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    let cancelled = false;
    void (async () => {
      try {
        const token = await turnstile.execute();
        if (!cancelled) onDone(token);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // open が変わったときだけ走らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#14103a]/60 p-4 backdrop-blur-sm">
      <div className="pop-in w-full max-w-xs rounded-3xl border-2 border-[var(--line)] bg-[var(--surface)] p-5 text-center shadow-xl">
        <p className="text-[11px] font-black tracking-[0.2em] text-[var(--accent)]">
          {tr("playGate.badge")}
        </p>
        <h2 className="mt-1 text-lg font-black text-[var(--ink)]">{tr("playGate.title")}</h2>
        <p className="mt-1 text-[11px] font-bold leading-relaxed text-[var(--muted)]">
          {tr("playGate.desc")}
        </p>
        <div ref={turnstile.containerRef} className="mt-4 flex justify-center" />
        <p className="mt-2 text-[10px] font-bold text-[var(--muted)]">{tr("playGate.bot")}</p>
        {failed && (
          <div className="mt-3">
            <p className="rounded-lg bg-[var(--accent)] px-2 py-1.5 text-[11px] font-black text-white">
              {tr("playGate.fail")}
            </p>
            <button
              type="button"
              onClick={onFail}
              className="mt-2 rounded-full border border-[var(--line)] bg-[var(--bg)] px-3 py-1 text-[11px] font-black text-[var(--ink)]"
            >
              {tr("close")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
