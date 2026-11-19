import { useCallback, useEffect, useRef, useState } from "react";
import GameApp from "./GameApp";
import { PlayGate } from "./components/PlayGate";
import { registerPlayTokenProvider, configurePlayGate } from "./lib/playGate";
import { ApiError, claimName, fetchConfig, fetchMe, renamePlayer } from "./lib/session";
import { tr, useI18n } from "./lib/i18n";
import { useTurnstile } from "./lib/turnstile";
import { NAME_MAX } from "./shared/types";

/**
 * ゲーム本体は GameApp（オリジナル実装をほぼそのまま使用）。
 * ここでは「名前を決める + ボット判定」と「名前の変更」「言語切替」だけを載せる。
 * ランキングはゲーム本体のスタート画面（旧スコア TOP 5 の場所）に常時表示している。
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

  // 名前変更
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // プレイ前確認（Turnstile）
  const [gateOpen, setGateOpen] = useState(false);
  const gateResolve = useRef<((token: string) => void) | null>(null);
  const gateReject = useRef<(() => void) | null>(null);

  useEffect(() => {
    registerPlayTokenProvider(
      () =>
        new Promise<string>((resolve, reject) => {
          gateResolve.current = resolve;
          gateReject.current = reject;
          setGateOpen(true);
        }),
    );
    return () => registerPlayTokenProvider(null);
  }, []);

  const finishGate = (ok: boolean, token = "") => {
    setGateOpen(false);
    const ok$ = gateResolve.current;
    const ng$ = gateReject.current;
    gateResolve.current = null;
    gateReject.current = null;
    if (ok) ok$?.(token);
    else ng$?.();
  };

  const turnstile = useTurnstile(siteKey, lang);

  // ゲーム側が「自分の行」をハイライトできるように名前を渡す
  useEffect(() => {
    (window as unknown as { __dopaMe?: string }).__dopaMe = user?.name;
  }, [user]);

  useEffect(() => {
    void (async () => {
      const [me, cfg] = await Promise.all([
        fetchMe().catch(() => null),
        fetchConfig().catch(() => null),
      ]);
      if (me?.user) setUser(me.user);
      const key = cfg?.turnstileSiteKey ?? null;
      setSiteKey(key);
      // Turnstile 無効（siteKey=null）なら、スタート前の確認・券取得をしない
      configurePlayGate(Boolean(key));
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

  const openRename = useCallback(() => {
    setRenameValue(user?.name ?? "");
    setRenameError(null);
    setRenameOpen(true);
  }, [user]);

  // タイトル画面（GameApp）の「名前変更」ボタンからも開けるようにする
  useEffect(() => {
    const onOpen = () => openRename();
    window.addEventListener("dopa:open-rename", onOpen);
    return () => window.removeEventListener("dopa:open-rename", onOpen);
  }, [openRename]);

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (renameBusy) return;
    const trimmed = renameValue.trim();
    if (trimmed.length < 2) {
      setRenameError(tr("rename.short"));
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      const res = await renamePlayer(trimmed);
      if (res.user) {
        setUser(res.user);
        setRenameOpen(false);
        // ゲーム側のランキング表示（自分の行・自己ベスト）を即時に更新する
        window.dispatchEvent(new CustomEvent("dopa:refresh-scores"));
      }
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : tr("rename.failed"));
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <>
      <GameApp />

      <PlayGate
        open={gateOpen}
        siteKey={siteKey}
        lang={lang}
        onDone={(token) => finishGate(true, token)}
        onFail={() => finishGate(false)}
      />

      {/* 言語切替 */}
      <button
        type="button"
        onClick={toggleLang}
        className="fixed right-2 z-[60] rounded-full border-2 border-[var(--line)] bg-[var(--surface)]/95 px-2.5 py-1.5 text-[11px] font-black text-[var(--ink)] shadow-md backdrop-blur"
        style={{ bottom: "calc(2rem + env(safe-area-inset-bottom))" }}
        aria-label={lang === "ja" ? "English" : "日本語"}
      >
        {lang === "ja" ? "EN" : "JA"}
      </button>

      {/* 名前変更（ログイン後のみ） */}
      {checked && user && (
        <button
          type="button"
          onClick={openRename}
          className="fixed left-2 z-[60] rounded-full border-2 border-[var(--line)] bg-[var(--surface)]/95 px-2.5 py-1.5 text-[11px] font-black text-[var(--ink)] shadow-md backdrop-blur"
          style={{ bottom: "calc(2rem + env(safe-area-inset-bottom))" }}
        >
          {tr("rename")}
        </button>
      )}

      {renameOpen && user && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#14103a]/55 p-4 backdrop-blur-sm">
          <form
            onSubmit={submitRename}
            className="w-full max-w-sm rounded-3xl border-2 border-[var(--line)] bg-[var(--surface)] p-5 shadow-xl"
          >
            <p className="text-[11px] font-black tracking-[0.2em] text-[var(--accent)]">
              CHANGE NAME
            </p>
            <h2 className="mt-1 text-center text-xl font-black text-[var(--ink)]">{tr("rename.title")}</h2>
            <p className="mt-2 text-center text-xs font-bold leading-relaxed text-[var(--muted)]">
              {tr("rename.desc")}
            </p>

            <input
              value={renameValue}
              onChange={(e) => {
                setRenameValue(e.target.value);
                setRenameError(null);
              }}
              maxLength={NAME_MAX}
              autoFocus
              aria-label={tr("rename.label")}
              placeholder={tr("rename.label")}
              className="mt-4 w-full rounded-xl border-2 border-[var(--line)] bg-[var(--bg)] px-3 py-3 text-center text-base font-black text-[var(--ink)] outline-none"
            />

            <div aria-live="polite" className="mt-2 min-h-[18px]">
              {renameError && (
                <p className="rounded-lg bg-[var(--accent)] px-2 py-1.5 text-center text-[11px] font-black text-white">
                  {renameError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={renameBusy}
              className="mt-2 w-full rounded-xl bg-[var(--accent)] py-3.5 text-base font-black text-white shadow-[0_5px_0_var(--accent-deep)] transition active:translate-y-1 active:shadow-none disabled:opacity-60"
            >
              {renameBusy ? tr("rename.busy") : tr("rename.submit")}
            </button>
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="mt-2 w-full rounded-xl py-3 text-sm font-black text-[var(--muted)]"
            >
              {tr("rename.cancel")}
            </button>
          </form>
        </div>
      )}

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
