import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Disc3,
  Github,
  Home,
  LogIn,
  LogOut,
  Moon,
  Play,
  ShieldCheck,
  Sun,
  Trophy,
  UserRound,
  Zap,
} from "lucide-react";
import { DiscGame } from "./game/DiscGame";
import type { PlayResult } from "./game/engine";
import { AuthDialog } from "./components/AuthDialog";
import { Leaderboard } from "./components/Leaderboard";
import { ResultOverlay } from "./components/ResultOverlay";
import { useAuth } from "./lib/useAuth";
import { useTheme } from "./lib/theme";
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
  const { user, accessEnabled, loading, refresh, signOut, setUser } = useAuth();
  const { theme, toggle } = useTheme();

  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState<PlayResult | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [best, setBest] = useState(readBest);
  const [prevBest, setPrevBest] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // ゲーム中はページスクロールを封じる
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

  const handleFinish = useCallback((r: PlayResult) => {
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
  }, [best]);

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
  }, []);

  const bestRatio = useMemo(() => Math.min(100, (best / DIST_MAX) * 100), [best]);

  const navItems = [
    { id: "home", label: "ホーム", icon: Home },
    { id: "play", label: "あそぶ", icon: Play },
    { id: "ranking", label: "ランキング", icon: Trophy },
    { id: "howto", label: "つかいかた", icon: BookOpen },
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
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--yellow)] text-[var(--ink)] shadow-[3px_3px_0_var(--line)] sm:h-10 sm:w-10">
              <Disc3 className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="hidden text-[10px] font-black tracking-[0.22em] text-[var(--pink)] sm:block">
                DOPA DISC
              </span>
              <span className="block truncate whitespace-nowrap text-[13px] font-black sm:text-base">
                フライングディスク
              </span>
            </span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" aria-label="メインナビゲーション">
            {navItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="rounded-full px-3 py-1.5 text-xs font-black text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggle}
              className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--surface)]"
              aria-label={theme === "dark" ? "ライトテーマに切り替え" : "ダークテーマに切り替え"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {loading ? (
              <span className="h-9 w-20 animate-pulse rounded-full bg-[var(--surface-2)]" />
            ) : user ? (
              <div className="flex items-center gap-1.5">
                <span className="flex max-w-[5.5rem] items-center gap-1 rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 sm:max-w-[9rem] sm:gap-1.5 sm:px-2.5">
                  {user.via === "cloudflare-access" ? (
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--green)]" />
                  ) : (
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-[var(--pink)]" />
                  )}
                  <span className="truncate text-[11px] font-black sm:text-xs">{user.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--line)] bg-[var(--surface)]"
                  aria-label="ログアウト"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="flex items-center gap-1.5 rounded-full border-2 border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-black shadow-[3px_3px_0_var(--line)]"
              >
                <LogIn className="h-3.5 w-3.5" /> ログイン
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pb-16 sm:pt-10">
        {/* ---------------- ヒーロー ---------------- */}
        <section id="home" className="scroll-mt-20">
          <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-[var(--cyan)] px-3 py-1 text-[11px] font-black text-[#0b1622] ring-2 ring-[var(--line)]">
                <Zap className="h-3.5 w-3.5" /> 描いて、回して、飛ばす
              </p>

              <h1 className="display-font mt-4 text-[clamp(2.3rem,8.5vw,4.2rem)] font-black leading-[1.02]">
                フライング
                <span className="block text-[var(--pink)]">ディスク</span>
              </h1>

              <p className="mt-4 max-w-lg text-sm font-bold leading-relaxed text-[var(--muted)] sm:text-base">
                1筆で描いた形がそのまま円盤になる。円盤をぐるっと回して勢いをつけ、
                上へスワイプすれば飛び出す。飛距離は
                <span className="mx-1 rounded-md bg-[var(--yellow)] px-1.5 py-0.5 text-[var(--ink)]">
                  形 × 回転 × 勢い
                </span>
                で決まる。スマホもPCもそのまま遊べます。
              </p>

              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={startGame}
                  className="btn-3d play-btn flex min-h-[60px] items-center justify-center gap-3 rounded-2xl px-7 text-lg font-black sm:min-h-[64px] sm:text-xl"
                >
                  <Play className="h-6 w-6" /> あそぶ
                </button>

                <a
                  href="#ranking"
                  className="btn-3d flex min-h-[60px] items-center justify-center gap-2 rounded-2xl bg-[var(--surface)] px-6 text-base font-black sm:min-h-[64px]"
                >
                  <Trophy className="h-5 w-5" /> ランキング
                </a>
              </div>

              {best > 0 && (
                <div className="mt-5 rounded-2xl border-2 border-[var(--line)] bg-[var(--surface)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black tracking-wider text-[var(--muted)]">
                      あなたの自己ベスト
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

            {/* ビジュアル */}
            <div className="relative mx-auto w-full max-w-sm">
              <div className="relative aspect-square overflow-hidden rounded-[32px] border-[3px] border-[var(--line)] bg-gradient-to-b from-[#0f7bff] via-[#38a9ff] to-[#3ff07a] shadow-[8px_8px_0_var(--line)]">
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-[#3ff07a] to-[#0fb04a]" />
                <div className="absolute inset-x-0 top-[58%] h-px bg-white/60" />
                <div className="floaty absolute left-1/2 top-[54%] -translate-x-1/2 -translate-y-1/2">
                  <div className="relative h-24 w-48 sm:h-28 sm:w-56">
                    {/* 円盤の影 */}
                    <div className="absolute inset-x-4 bottom-0 h-4 rounded-[50%] bg-black/25 blur-[2px]" />
                    {/* 円盤本体（側面ドーム） */}
                    <div className="absolute inset-x-0 top-2 h-[62%] rounded-[50%] bg-gradient-to-br from-[#ff9a00] via-[#ff2e8a] to-[#7b2eff] shadow-[0_14px_26px_rgba(0,0,0,.3)]" />
                    {/* 上面ハイライト */}
                    <div className="absolute inset-x-3 top-1 h-[46%] rounded-[50%] bg-gradient-to-b from-white/45 to-transparent" />
                    {/* リム */}
                    <div className="absolute inset-x-0 top-[52%] h-2 rounded-[50%] bg-[#7b2eff]/70" />
                    {/* 表面ライン */}
                    <div className="absolute inset-x-7 top-[34%] h-[3px] rounded-full bg-white/90" />
                    <div className="absolute right-11 top-[31%] h-2 w-2 rounded-full bg-white" />
                  </div>
                </div>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-3 py-1 text-[10px] font-black tracking-widest text-white backdrop-blur">
                  DRAW → SPIN → FLY
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- あそぶ ---------------- */}
        <section id="play" className="scroll-mt-20 pt-12">
          <SectionHeading icon={<Play className="h-5 w-5" />} title="あそぶ" />
          <div className="card mt-3 overflow-hidden rounded-3xl">
            <div className="grid gap-0 sm:grid-cols-3">
              {[
                { n: "01", t: "描く", d: "円盤になる形を1筆で。きれいな円ほど高スコア。" },
                { n: "02", t: "回す", d: "円盤のまわりをぐるぐる。回転と勢いが伸びる。" },
                { n: "03", t: "飛ばす", d: "上へスワイプ、または「飛ばす」ボタン。" },
              ].map((s) => (
                <div key={s.n} className="p-4 sm:p-5">
                  <p className="text-2xl font-black text-[var(--pink)]">{s.n}</p>
                  <h3 className="mt-1 text-base font-black">{s.t}</h3>
                  <p className="mt-1 text-xs font-bold leading-relaxed text-[var(--muted)]">
                    {s.d}
                  </p>
                </div>
              ))}
            </div>
            <div className="border-t-2 border-dashed line-soft bg-[var(--surface-2)] p-4">
              <button
                type="button"
                onClick={startGame}
                className="btn-3d play-btn flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-black"
              >
                <Play className="h-5 w-5" /> ゲームをはじめる
              </button>
              <p className="mt-2 text-center text-[11px] font-bold text-[var(--muted)]">
                PC ではマウスドラッグ + Space キーでも遊べます
              </p>
            </div>
          </div>
        </section>

        {/* ---------------- ランキング ---------------- */}
        <section id="ranking" className="scroll-mt-20 pt-12">
          <SectionHeading icon={<Trophy className="h-5 w-5" />} title="ランキング" />
          <div className="mt-3">
            <Leaderboard
              user={user}
              onRequireAuth={() => setAuthOpen(true)}
              refreshKey={refreshKey}
            />
          </div>
        </section>

        {/* ---------------- つかいかた ---------------- */}
        <section id="howto" className="scroll-mt-20 pt-12">
          <SectionHeading icon={<BookOpen className="h-5 w-5" />} title="つかいかた" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <article className="card rounded-2xl p-4">
              <h3 className="flex items-center gap-2 text-sm font-black">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--pink)] text-[11px] text-white">
                  1
                </span>
                円盤の形を描く
              </h3>
              <p className="mt-2 text-xs font-bold leading-relaxed text-[var(--muted)]">
                指（またはマウス）で1筆の円を描きます。円に近いほど「形」のスコアが上がります。
                大きすぎ・小さすぎは減点。25% 未満だとほぼ飛びません。
              </p>
            </article>

            <article className="card rounded-2xl p-4">
              <h3 className="flex items-center gap-2 text-sm font-black">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--violet)] text-[11px] text-white">
                  2
                </span>
                回して勢いをつける
              </h3>
              <p className="mt-2 text-xs font-bold leading-relaxed text-[var(--muted)]">
                円盤のまわりをぐるぐる回すと「回転」と「勢い」が上がります。
                勢いは時間とともに減るので、回し終わったらすぐ飛ばしましょう。
              </p>
            </article>

            <article className="card rounded-2xl p-4">
              <h3 className="flex items-center gap-2 text-sm font-black">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--cyan)] text-[11px] text-[#0b1622]">
                  3
                </span>
                飛ばす
              </h3>
              <p className="mt-2 text-xs font-bold leading-relaxed text-[var(--muted)]">
                上方向へスワイプするか、「飛ばす」ボタンを押します。PC では Space / Enter
                でも飛びます。<kbd className="rounded bg-[var(--surface-2)] px-1">R</kbd>{" "}
                でやり直し、<kbd className="rounded bg-[var(--surface-2)] px-1">Esc</kbd>{" "}
                でゲームを終了。
              </p>
            </article>

            <article className="card rounded-2xl p-4">
              <h3 className="flex items-center gap-2 text-sm font-black">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--yellow)] text-[11px] text-[#1c1030]">
                  4
                </span>
                ランキングに登録
              </h3>
              <p className="mt-2 text-xs font-bold leading-relaxed text-[var(--muted)]">
                {accessEnabled
                  ? "このサイトは Cloudflare Access で保護されています。認証済みならスコアは自動で登録されます。"
                  : "ログインしていればスコアは自動でランキングに登録されます。飛距離はサーバー側で再計算されるため、改造しても記録は伸びません。"}
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 pb-24 pt-2 text-center sm:px-6 sm:pb-10">
        <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] font-bold text-[var(--muted)]">
          <span>フライングディスク - ドパ仕様</span>
          <span aria-hidden="true">・</span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            {accessEnabled ? "Cloudflare Access 保護" : "Cloudflare Workers"}
          </span>
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
        aria-label="モバイルナビゲーション"
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
                {item.label}
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
          accessEnabled={accessEnabled}
          personalBest={prevBest}
          onRetry={handleRetry}
          onHome={handleHome}
          onRequireAuth={() => setAuthOpen(true)}
          onSubmitted={handleSubmitted}
        />
      )}

      <AuthDialog
        open={authOpen}
        accessEnabled={accessEnabled}
        onClose={() => setAuthOpen(false)}
        onAuthed={(u) => {
          setUser(u);
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
