import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, LogIn, ShieldCheck, UserPlus, X } from "lucide-react";
import { ApiError, login, register } from "../lib/api";
import { PASSWORD_MIN, NAME_MAX, NAME_MIN } from "../shared/types";
import type { AuthUser } from "../lib/useAuth";

interface Props {
  open: boolean;
  accessEnabled: boolean;
  onClose: () => void;
  onAuthed: (user: AuthUser) => void;
}

type Mode = "login" | "register";

export function AuthDialog({ open, accessEnabled, onClose, onAuthed }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    const t = window.setTimeout(() => nameRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = mode === "login" ? await login(name, password) : await register(name, password);
      if (result.user) {
        onAuthed(result.user);
        onClose();
        setName("");
        setPassword("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pop-in w-full max-w-md rounded-t-3xl border-[3px] border-[var(--line)] bg-[var(--surface)] p-5 sm:rounded-3xl sm:p-6"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-black tracking-[0.2em] text-[var(--pink)]">
              <ShieldCheck className="h-4 w-4" /> RANKING ACCOUNT
            </p>
            <h2 id="auth-title" className="mt-1 text-xl font-black">
              {mode === "login" ? "ログイン" : "アカウント作成"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--surface-2)]"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {accessEnabled ? (
          <div className="mt-5 rounded-2xl border-2 border-[var(--line)] bg-[var(--surface-2)] p-4">
            <p className="text-sm font-black">Cloudflare Access で保護されています</p>
            <p className="mt-1 text-xs font-bold leading-relaxed text-[var(--muted)]">
              このサイトは Cloudflare Zero Trust で認証されています。ページを再読み込みすると
              Access のログイン画面が表示され、認証後にそのままランキングへ参加できます。
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(["login", "register"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex items-center justify-center gap-2 rounded-xl border-2 border-[var(--line)] py-2 text-sm font-black transition ${
                    mode === m
                      ? "bg-[var(--violet)] text-white"
                      : "bg-[var(--surface-2)] text-[var(--muted)]"
                  }`}
                >
                  {m === "login" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                  {m === "login" ? "ログイン" : "新規登録"}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs font-black text-[var(--muted)]">プレイヤー名</span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="username"
                  minLength={NAME_MIN}
                  maxLength={NAME_MAX}
                  required
                  className="mt-1 w-full rounded-xl border-2 border-[var(--line)] bg-[var(--bg)] px-3 py-3 text-base font-bold text-[var(--ink)] outline-none"
                  placeholder="2〜16文字"
                />
              </label>

              <label className="block">
                <span className="text-xs font-black text-[var(--muted)]">パスワード</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={PASSWORD_MIN}
                  required
                  className="mt-1 w-full rounded-xl border-2 border-[var(--line)] bg-[var(--bg)] px-3 py-3 text-base font-bold text-[var(--ink)] outline-none"
                  placeholder={`${PASSWORD_MIN}文字以上`}
                />
              </label>

              <div aria-live="polite" className="min-h-[20px]">
                {error && (
                  <p className="rounded-lg bg-[var(--danger)] px-3 py-2 text-xs font-black text-white">
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="btn-3d play-btn flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-black"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <KeyRound className="h-5 w-5" />
                )}
                {mode === "login" ? "ログインする" : "登録してランキングへ"}
              </button>
            </form>

            <p className="mt-3 text-[11px] font-bold leading-relaxed text-[var(--muted)]">
              パスワードは PBKDF2-SHA256 でハッシュ化して保存します。ランキング投稿にのみ使用し、
              メールアドレスは不要です。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
