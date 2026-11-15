import { useCallback, useEffect, useState } from "react";
import GameApp from "./GameApp";
import { RankingModal } from "./components/RankingModal";
import { ApiError, claimName, fetchConfig, fetchMe } from "./lib/session";
import { tr, useI18n } from "./lib/i18n";
import { useTurnstile } from "./lib/turnstile";
import { NAME_MAX } from "./shared/types";

/**
 * ゲーム本体は GameApp（オリジナル実装をほぼそのまま使用）。
 * ここでは「名前を決める + ボット判定」と「ランキング / 言語切替」の UI を載せる。
 */
export default function App() {
  useI18n();
  const { lang, toggle: toggleLang } = useI18n();

  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rankingOpen, setRankingOpen] = useState(false);

  const turnstile = useTurnstile(siteKey, lang);

  useEffect(() => {
    void (async () => {
      const [me, cfg] = await Promise.all([
        fetchMe().catch(() => null),
        fetchConfig().catch(() => null),
      ]);
      if (me?.user) setUser(me.user);
      setSiteKey(cfg?.turnstileSiteKey ?? null);
      setChecked(true);
    })();
  }, []);

  const start = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      const trimmed = name.trim();
      if (trimmed.length < 2) {
        setError(tr("gate.errShort"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        let token = "";
        try {
          token = await turnstile.execute();
        } catch {
          setError(tr("gate.errBot"));
          setBusy(false);
          return;
        }
        const res = await claimName(trimmed, token);
        if (res.user) setUser(res.user);
        else setError(tr("gate.errOther"));
      } catch (err) {
        console.warn("[register]", err);
        if (err instanceof ApiError) {
          if (err.status === 403) setError(tr("gate.errBot"));
          else if (err.status === 0) setError(tr("gate.errNet"));
          else setError(`${err.message}（${err.status}）`);
        } else {
          setError(tr("gate.errOther"));
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, name, turnstile],
  );

  return (
    <>
      <GameApp />

      {/* ランキング / 言語切替（ゲーム画面の左下に小さく置く） */}
      {user && (
        <div
          className="fixed left-2 z-[65] flex items-center gap-1.5"
          style={{ bottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={() => setRankingOpen(true)}
            className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)]/90 px-2.5 py-1 text-[11px] font-black text-[var(--ink)] shadow-sm backdrop-blur"
          >
            🏆 {tr("float.ranking")}
          </button>
          <button
            type="button"
            onClick={toggleLang}
            className="rounded-full border border-[var(--line)] bg-[var(--surface)]/90 px-2 py-1 text-[11px] font-black text-[var(--ink)] shadow-sm backdrop-blur"
            aria-label={lang === "ja" ? "English" : "日本語"}
          >
            {lang === "ja" ? "EN" : "JA"}
          </button>
        </div>
      )}

      <RankingModal open={rankingOpen} me={user?.name ?? null} onClose={() => setRankingOpen(false)} />

      {checked && !user && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#14103a]/55 p-4 backdrop-blur-sm">
          <form
            onSubmit={start}
            className="w-full max-w-sm rounded-3xl border-2 border-[var(--line)] bg-[var(--surface)] p-5 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <p className="text-[11px] font-black tracking-[0.2em] text-[var(--accent)]">
                PLAYER NAME
              </p>
              <button
                type="button"
                onClick={toggleLang}
                className="rounded-full border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-[11px] font-black text-[var(--ink)]"
              >
                {lang === "ja" ? "EN" : "JA"}
              </button>
            </div>
            <h1 className="mt-1 text-center text-xl font-black text-[var(--ink)]">
              {tr("gate.title")}
            </h1>
            <p className="mt-2 text-center text-xs font-bold leading-relaxed text-[var(--muted)]">
              {tr("gate.desc")}
            </p>

            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={NAME_MAX}
              autoFocus
              aria-label={tr("gate.title")}
              placeholder={tr("gate.placeholder")}
              className="mt-4 w-full rounded-xl border-2 border-[var(--line)] bg-[var(--bg)] px-3 py-3 text-center text-base font-black text-[var(--ink)] outline-none"
            />

            <div aria-live="polite" className="mt-2 min-h-[18px]">
              {error && (
                <p className="rounded-lg bg-[var(--accent)] px-2 py-1.5 text-center text-[11px] font-black text-white">
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-xl bg-[var(--accent)] py-3.5 text-base font-black text-white shadow-[0_5px_0_var(--accent-deep)] transition active:translate-y-1 active:shadow-none disabled:opacity-60"
            >
              {busy ? tr("gate.checking") : tr("gate.start")}
            </button>

            <p className="mt-3 text-center text-[10px] font-bold text-[var(--muted)]">
              {tr("gate.bot")}
            </p>

            <div ref={turnstile.containerRef} className="mt-1 flex justify-center" />
          </form>
        </div>
      )}
    </>
  );
}
