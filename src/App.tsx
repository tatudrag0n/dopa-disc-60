import { useCallback, useEffect, useState } from "react";
import GameApp from "./GameApp";
import { ApiError, claimName, fetchConfig, fetchMe } from "./lib/session";
import { useTurnstile } from "./lib/turnstile";
import { NAME_MAX } from "./shared/types";

/**
 * ゲーム本体は GameApp（オリジナルの実装をそのまま使用）。
 * ここでは「最初に名前を決める + ボット判定」だけを前段に置く。
 */
export default function App() {
  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turnstile = useTurnstile(siteKey, "ja");

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
        setError("名前は2文字以上にしてください");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        let token = "";
        try {
          token = await turnstile.execute();
        } catch {
          setError("ボット判定に失敗しました。ページを再読み込みしてお試しください");
          setBusy(false);
          return;
        }
        const res = await claimName(trimmed, token);
        if (res.user) {
          setUser(res.user);
          try {
            localStorage.setItem("dopa_name", res.user.name);
          } catch {
            /* noop */
          }
        }
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 403
            ? "ボット判定に失敗しました。ページを再読み込みしてお試しください"
            : "登録に失敗しました。通信状況を確認してください",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, name, turnstile],
  );

  return (
    <>
      <GameApp />

      {checked && !user && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#14103a]/55 p-4 backdrop-blur-sm">
          <form
            onSubmit={start}
            className="w-full max-w-sm rounded-3xl border-2 border-[var(--line)] bg-[var(--surface)] p-5 shadow-xl"
          >
            <p className="text-center text-[11px] font-black tracking-[0.2em] text-[var(--accent)]">
              PLAYER NAME
            </p>
            <h1 className="mt-1 text-center text-xl font-black text-[var(--ink)]">
              名前を決めてスタート
            </h1>
            <p className="mt-2 text-center text-xs font-bold leading-relaxed text-[var(--muted)]">
              パスワードは不要です。ランキングに表示される名前だけ決めてください。
            </p>

            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={NAME_MAX}
              autoFocus
              aria-label="プレイヤー名"
              placeholder="2〜16文字"
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
              {busy ? "確認中…" : "この名前ではじめる"}
            </button>

            <p className="mt-3 text-center text-[10px] font-bold text-[var(--muted)]">
              ボット判定: Cloudflare Turnstile
            </p>

            <div ref={turnstile.containerRef} className="mt-1 flex justify-center" />
          </form>
        </div>
      )}
    </>
  );
}
