import { useEffect } from "react";
import { BookOpen, Languages, Moon, Sun, Trophy, UserRound, X } from "lucide-react";
import { Leaderboard } from "./Leaderboard";
import { useI18n, type MessageKey } from "../lib/i18n";
import type { Player } from "../lib/usePlayer";

interface Props {
  open: boolean;
  user: Player | null;
  theme: "light" | "dark" | "system";
  refreshKey: number;
  onClose: () => void;
  onToggleTheme: () => void;
  onRequireName: () => void;
}

/** ゲーム画面から開くランキング / つかいかたのシート */
export function InfoSheet({
  open,
  user,
  theme,
  refreshKey,
  onClose,
  onToggleTheme,
  onRequireName,
}: Props) {
  const { t, toggle: toggleLang, lang } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[58] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pop-in flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border-[3px] border-[var(--line)] bg-[var(--surface)] sm:rounded-3xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between gap-2 bg-[var(--violet)] px-4 py-3 text-white">
          <h2 id="sheet-title" className="flex items-center gap-2 text-base font-black">
            <Trophy className="h-5 w-5" /> {t("sheet.ranking")}
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleLang}
              className="flex h-8 items-center gap-1 rounded-full bg-white/20 px-2.5 text-[11px] font-black"
              aria-label={t("lang.label")}
            >
              <Languages className="h-3.5 w-3.5" />
              {lang === "ja" ? "EN" : "JA"}
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/20"
              aria-label={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full bg-white/20"
              aria-label={t("sheet.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <div className="overflow-hidden rounded-2xl border-2 border-[var(--line)]">
            <Leaderboard user={user} onRequireName={onRequireName} refreshKey={refreshKey} showNameCta={false} />
          </div>

          <h3 className="mt-4 flex items-center gap-2 text-sm font-black">
            <BookOpen className="h-4 w-4 text-[var(--pink)]" /> {t("sheet.howto")}
          </h3>
          <ol className="mt-2 space-y-2">
            {([1, 2, 3, 4] as const).map((n) => (
              <li key={n} className="rounded-xl bg-[var(--surface-2)] px-3 py-2">
                <p className="text-xs font-black">
                  {n}. {t(`howto.${n}.title` as MessageKey)}
                </p>
                <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-[var(--muted)]">
                  {t(`howto.${n}.desc` as MessageKey)}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] font-black text-[var(--muted)]">
              <UserRound className="h-3.5 w-3.5" />
              {user ? user.name : t("ranking.needName")}
            </span>
            <button
              type="button"
              onClick={onRequireName}
              className="rounded-full bg-[var(--pink)] px-3 py-1.5 text-[11px] font-black text-white"
            >
              {user ? t("name.change") : t("ranking.setName")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
