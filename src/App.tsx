import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Disc3,
  Github,
  Home,
  Languages,
  Moon,
  Play,
  Sun,
  Trophy,
  UserRound,
  Zap,
} from "lucide-react";
import { DiscGame } from "./game/DiscGame";
import type { PlayResult } from "./game/engine";
import { Leaderboard } from "./components/Leaderboard";
import { NameDialog } from "./components/NameDialog";
import { ResultOverlay } from "./components/ResultOverlay";
import { usePlayer } from "./lib/usePlayer";
import { useTheme } from "./lib/theme";
import { useI18n, type MessageKey } from "./lib/i18n";
import { DIST_MAX } from "./shared/types";

const BEST_KEY = "dopa_best_v2";

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

export default function App() {
  const { user, siteKey, loading, refresh, setUser } = usePlayer();
  const { lang, toggle: toggleLang, t } = useI18n();
  const { theme, toggle } = useTheme();

  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const [best, setBest] = useState(readBest);
  const [prevBest, setPrevBest] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    document.body.classList.toggle("dopa-locked", playing || result !== null);
    return () => document.body.classList.remove("dopa-locked");
  }, [playing, result]);

  const startGame = useCallback(() => {
    setResult(null);
    setResetKey((k) => k + 1);
    setPlaying(true);
    requestAnimationFrame(() => {
      document.getElementById("play")?.scrollIntoView({ block: "start" });
    });
  }, []);

  const handleFinish = useCallback(
    (r: PlayResult) => {
      setPrevBest(best);
      setResult(r);
      setBest((prev) => {
        if (r.distance > prev) {
          try {
            localStorage.setItem(BEST_KEY, String(r.distance));
          } catch {
            /* noop */
          }
          return r.distance;
        }
        return prev;
      });
    },
    [best],
  );

  const handleRetry = useCallback(() => {
    setResult(null);
    setResetKey((k) => k + 1);
  }, []);

  const handleHome = useCallback(() => {
    setResult(null);
    setPlaying(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleSubmitted = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void refresh();
  }, [refresh]);

  const bestRatio = useMemo(() => Math.min(100, (best / DIST_MAX) * 100), [best]);

  const navItems: { id: string; label: MessageKey; icon: typeof Home }[] = [
    { id: "home", label: "nav.home", icon: Home },
    { id: "play", label: "nav.play", icon: Play },
    { id: "ranking", label: "nav.ranking", icon: Trophy },
    { id: "howto", label: "nav.howto", icon: BookOpen },
  ];

  return (
    <div
      className="min-h-[100dvh] w-full overflow-x-clip bg-[var(--bg)] text-[var(--ink)]"
      style={{
        paddingTop: "var(--safe-area-inset-top)",
        paddingLeft: "var(--safe-area-inset-left)",
        paddingRight: "var(--safe-area-inset-right)",
      }}
    >
      {/* ---------------- ヘッダー ---------------- */}
      <header className="sticky top-0 z-40 border-b-[3px] border-[var(--line)] bg-[var(--bg)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3">
          <a href="#home" className="flex min-w-0 items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--yellow)] text-[#1c1030] shadow-[3px_3px_0_var(--line)] sm:h-10 sm:w-10">
              <Disc3 className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="hidden text-[10px] font-black tracking-[0.22em] text-[var(--pink)] sm:block">
                DOPA DISC
              </span>
              <span className="block truncate whitespace-nowrap text-[13px] font-black sm:text-base">
                {t("app.title")}
              </span>
            </span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label="navigation">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="rounded-full px-3 py-1.5 text-xs font-black text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                {t(item.label)}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleLang}
              className="flex h-9 items-center gap-1 rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-2.5 text-[11px] font-black"
              aria-label={t("lang.label")}
            >
              <Languages className="h-3.5 w-3.5" />
              {lang === "ja" ? "EN" : "JA"}
            </button>

            <button
              type="button"
              onClick={toggle}
              className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--surface)]"
              aria-label={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {loading ? (
              <span className="h-9 w-16 animate-pulse rounded-full bg-[var(--surface-2)]" />
            ) : user ? (
              <button
                type="button"
                onClick={() => setRenameOpen(true)}
                className="flex max-w-[5.5rem] items-center gap-1 rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 sm:max-w-[9rem] sm:gap-1.5 sm:px-2.5"
                aria-label={t("name.change")}
              >
                <UserRound className="h-3.5 w-3.5 shrink-0 text-[var(--pink)]" />
                <span className="truncate text-[11px] font-black sm:text-xs">{user.name}</span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pb-16 sm:pt-10">
        {/* ---------------- ヒーロー ---------------- */}
        <section id="home" className="scroll-mt-20">
          <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-[var(--cyan)] px-3 py-1 text-[11px] font-black text-[#0b1622] ring-2 ring-[var(--line)]">
                <Zap className="h-3.5 w-3.5" /> {t("app.tagline")}
              </p>

              <h1 className="display-font mt-4 text-[clamp(2.3rem,8.5vw,4.2rem)] font-black leading-[1.02]">
                {t("app.titleLine1")}
                <span className="block text-[var(--pink)]">{t("app.titleLine2")}</span>
              </h1>

              <p className="mt-4 max-w-lg text-sm font-bold leading-relaxed text-[var(--muted)] sm:text-base">
                {t("app.heroLead")}
                <span className="mx-1 rounded-md bg-[var(--yellow)] px-1.5 py-0.5 text-[#1c1030]">
                  {t("app.formula")}
                </span>
                {t("app.heroLeadTail")}
              </p>

              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={startGame}
                  className="btn-3d play-btn flex min-h-[60px] items-center justify-center gap-3 rounded-2xl px-7 text-lg font-black sm:min-h-[64px] sm:text-xl"
                >
                  <Play className="h-6 w-6" /> {t("common.play")}
                </button>

                <a
                  href="#ranking"
                  className="btn-3d flex min-h-[60px] items-center justify-center gap-2 rounded-2xl bg-[var(--surface)] px-6 text-base font-black sm:min-h-[64px]"
                >
                  <Trophy className="h-5 w-5" /> {t("common.ranking")}
                </a>
              </div>

              {best > 0 && (
                <div className="mt-5 rounded-2xl border-2 border-[var(--line)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black tracking-wider text-[var(--muted)]">
                      {t("hero.best")}
                    </span>
                    <span className="text-lg font-black tabular-nums text-[var(--pink)]">
                      {best.toFixed(1)}m
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--yellow)] via-[var(--pink)] to-[var(--violet)]"
                      style={{ width: `${bestRatio}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="relative mx-auto w-full max-w-sm">
              <div className="relative aspect-square overflow-hidden rounded-[32px] border-[3px] border-[var(--line)] bg-gradient-to-b from-[#0f7bff] via-[#38a9ff] to-[#3ff07a] shadow-[8px_8px_0_var(--line)]">
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-[#3ff07a] to-[#0fb04a]" />
                <div className="absolute inset-x-0 top-[58%] h-px bg-white/60" />
                <div className="floaty absolute left-1/2 top-[54%] -translate-x-1/2 -translate-y-1/2">
                  <div className="relative h-24 w-48 sm:h-28 sm:w-56">
                    <div className="absolute inset-x-4 bottom-0 h-4 rounded-[50%] bg-black/25 blur-[2px]" />
                    <div className="absolute inset-x-0 top-2 h-[62%] rounded-[50%] bg-gradient-to-br from-[#ff9a00] via-[#ff2e8a] to-[#7b2eff] shadow-[0_14px_26px_rgba(0,0,0,.3)]" />
                    <div className="absolute inset-x-3 top-1 h-[46%] rounded-[50%] bg-gradient-to-b from-white/45 to-transparent" />
                    <div className="absolute inset-x-0 top-[52%] h-2 rounded-[50%] bg-[#7b2eff]/70" />
                    <div className="absolute inset-x-7 top-[34%] h-[3px] rounded-full bg-white/90" />
                    <div className="absolute right-11 top-[31%] h-2 w-2 rounded-full bg-white" />
                  </div>
                </div>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-3 py-1 text-[10px] font-black tracking-widest text-white backdrop-blur">
                  {t("hero.diagram")}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- あそぶ ---------------- */}
        <section id="play" className="scroll-mt-20 pt-12">
          <SectionHeading icon={<Play className="h-5 w-5" />} title={t("play.heading")} />
          <div className="card mt-3 overflow-hidden rounded-3xl">
            <div className="grid gap-0 sm:grid-cols-3">
              {(
                [
                  { n: "01", k: "play.step1" },
                  { n: "02", k: "play.step2" },
                  { n: "03", k: "play.step3" },
                ] as const
              ).map((s) => (
                <div key={s.n} className="p-4 sm:p-5">
                  <p className="text-2xl font-black text-[var(--pink)]">{s.n}</p>
                  <h3 className="mt-1 text-base font-black">{t(`${s.k}.title` as MessageKey)}</h3>
                  <p className="mt-1 text-xs font-bold leading-relaxed text-[var(--muted)]">
                    {t(`${s.k}.desc` as MessageKey)}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t-2 border-dashed border-[var(--line)] bg-[var(--surface-2)] p-4 line-soft">
              <button
                type="button"
                onClick={startGame}
                className="btn-3d play-btn flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-black"
              >
                <Play className="h-5 w-5" /> {t("play.start")}
              </button>
              <p className="mt-2 text-center text-[11px] font-bold text-[var(--muted)]">
                {t("play.keyboardHint")}
              </p>
            </div>
          </div>
        </section>

        {/* ---------------- ランキング ---------------- */}
        <section id="ranking" className="scroll-mt-20 pt-12">
          <SectionHeading icon={<Trophy className="h-5 w-5" />} title={t("ranking.heading")} />
          <div className="mt-3">
            <Leaderboard
              user={user}
              onRequireName={() => setRenameOpen(false)}
              refreshKey={refreshKey}
            />
          </div>
        </section>

        {/* ---------------- つかいかた ---------------- */}
        <section id="howto" className="scroll-mt-20 pt-12">
          <SectionHeading icon={<BookOpen className="h-5 w-5" />} title={t("howto.heading")} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {([1, 2, 3, 4] as const).map((n) => {
              const colors = ["bg-[var(--pink)]", "bg-[var(--violet)]", "bg-[var(--cyan)]", "bg-[var(--yellow)]"];
              const textColors = ["", "", "text-[#0b1622]", "text-[#1c1030]"];
              return (
                <article key={n} className="card rounded-2xl p-4">
                  <h3 className="flex items-center gap-2 text-sm font-black">
                    <span
                      className={`grid h-6 w-6 place-items-center rounded-full text-[11px] text-white ${colors[n - 1]} ${textColors[n - 1]}`}
                    >
                      {n}
                    </span>
                    {t(`howto.${n}.title` as MessageKey)}
                  </h3>
                  <p className="mt-2 text-xs font-bold leading-relaxed text-[var(--muted)]">
                    {t(`howto.${n}.desc` as MessageKey)}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 pb-24 pt-2 text-center sm:px-6 sm:pb-10">
        <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-bold text-[var(--muted)]">
          <span>{t("app.title")}</span>
          <span aria-hidden="true">・</span>
          <span>Cloudflare Turnstile</span>
          <span aria-hidden="true">・</span>
          <a
            href="https://github.com/tatudrag0n/dopa-disc-60"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 underline decoration-dotted"
          >
            <Github className="h-3.5 w-3.5" /> GitHub
          </a>
        </div>
      </footer>

      {/* ---------------- モバイル下部ナビ ---------------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-[var(--line)] bg-[var(--bg)] md:hidden"
        style={{ paddingBottom: "var(--safe-area-inset-bottom)" }}
        aria-label="navigation"
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-black text-[var(--muted)] transition active:text-[var(--pink)]"
              >
                <Icon className="h-5 w-5" />
                {t(item.label)}
              </a>
            );
          })}
        </div>
      </nav>

      {/* ---------------- オーバーレイ類 ---------------- */}
      {playing && (
        <DiscGame
          onFinish={handleFinish}
          onExit={() => {
            setResult(null);
            setPlaying(false);
          }}
          resetKey={resetKey}
          best={best}
        />
      )}

      {result && (
        <ResultOverlay
          result={result}
          user={user}
          siteKey={siteKey}
          personalBest={prevBest}
          onRetry={handleRetry}
          onHome={handleHome}
          onPlayerCreated={(name) => {
            setUser({ name });
          }}
          onSubmitted={handleSubmitted}
        />
      )}

      <NameDialog
        open={renameOpen}
        initialName={user?.name ?? ""}
        onClose={() => setRenameOpen(false)}
        onSaved={(name) => {
          setUser({ name });
          void refresh();
        }}
      />
    </div>
  );
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-xl font-black sm:text-2xl">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--surface-2)] text-[var(--pink)]">
        {icon}
      </span>
      {title}
    </h2>
  );
}
