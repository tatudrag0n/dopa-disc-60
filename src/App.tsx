import { useCallback, useEffect, useState } from "react";
import { DiscGame } from "./game/DiscGame";
import type { PlayResult } from "./game/engine";
import { InfoSheet } from "./components/InfoSheet";
import { NameDialog } from "./components/NameDialog";
import { ResultOverlay } from "./components/ResultOverlay";
import { usePlayer } from "./lib/usePlayer";
import { useTheme } from "./lib/theme";

const BEST_KEY = "dopa_best_v2";

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

/**
 * サイトを開くとそのままゲームが始まる。
 * ランキングと使い方はゲーム画面の右上から開く。
 */
export default function App() {
  const { user, siteKey, refresh, setUser } = usePlayer();
  const { theme, toggle: toggleTheme } = useTheme();

  const [result, setResult] = useState<PlayResult | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [best, setBest] = useState(readBest);
  const [prevBest, setPrevBest] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    document.body.classList.add("dopa-locked");
    return () => document.body.classList.remove("dopa-locked");
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

  const handleSubmitted = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void refresh();
  }, [refresh]);

  return (
    <>
      <DiscGame
        onFinish={handleFinish}
        resetKey={resetKey}
        best={best}
        onOpenRanking={() => setSheetOpen(true)}
      />

      {result && (
        <ResultOverlay
          result={result}
          user={user}
          siteKey={siteKey}
          personalBest={prevBest}
          onRetry={handleRetry}
          onOpenRanking={() => {
            setResult(null);
            setResetKey((k) => k + 1);
            setSheetOpen(true);
          }}
          onPlayerCreated={(name) => setUser({ name })}
          onSubmitted={handleSubmitted}
        />
      )}

      <InfoSheet
        open={sheetOpen}
        user={user}
        theme={theme}
        refreshKey={refreshKey}
        onClose={() => setSheetOpen(false)}
        onToggleTheme={toggleTheme}
        onRequireName={() => {
          setSheetOpen(false);
          setRenameOpen(true);
        }}
      />

      <NameDialog
        open={renameOpen}
        initialName={user?.name ?? ""}
        onClose={() => setRenameOpen(false)}
        onSaved={(name) => {
          setUser({ name });
          void refresh();
        }}
      />
    </>
  );
}
