import { useEffect, useRef, useState } from "react";
import { Loader2, UserRound, X } from "lucide-react";
import { ApiError, renamePlayer } from "../lib/api";
import { NAME_MAX, NAME_MIN, validateName } from "../shared/types";
import { useI18n } from "../lib/i18n";

interface Props {
  open: boolean;
  initialName: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}

/** 表示名の変更ダイアログ（パスワードは無い） */
export function NameDialog({ open, initialName, onClose, onSaved }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setError(null);
    setBusy(false);
    const id = window.setTimeout(() => inputRef.current?.select(), 60);
    return () => window.clearTimeout(id);
  }, [open, initialName]);

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
    const localError = validateName(name);
    if (localError) {
      setError(localError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await renamePlayer(name);
      if (res.user) onSaved(res.user.name);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("error.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-title"
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
              <UserRound className="h-4 w-4" /> PLAYER NAME
            </p>
            <h2 id="rename-title" className="mt-1 text-xl font-black">
              {t("name.rename.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--surface-2)]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-xs font-bold leading-relaxed text-[var(--muted)]">
          {t("name.rename.desc")}
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs font-black text-[var(--muted)]">{t("name.label")}</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              minLength={NAME_MIN}
              required
              className="mt-1 w-full rounded-xl border-2 border-[var(--line)] bg-[var(--bg)] px-3 py-3 text-base font-bold text-[var(--ink)] outline-none"
              placeholder={t("name.placeholder")}
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
            {busy && <Loader2 className="h-5 w-5 animate-spin" />}
            {t("name.save")}
          </button>
        </form>
      </div>
    </div>
  );
}
