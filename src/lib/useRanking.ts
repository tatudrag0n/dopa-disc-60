import { useCallback, useEffect, useState } from "react";

export interface RankRow {
  name: string;
  best: number;
  total: number;
  rank: string;
  playedAt: string;
}

interface Result {
  rows: RankRow[];
  loading: boolean;
  error: boolean;
  reload: () => void;
}

/** ランキングを取得する。常時表示用に一定間隔で取り直す。 */
export function useRanking(pollMs = 30_000): Result {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "records.list", args: {} }),
        });
        const json = (await res.json()) as { data?: { records?: { value: RankRow }[] } };
        if (cancelled) return;
        setRows((json.data?.records ?? []).map((r) => r.value));
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    if (pollMs <= 0) return;
    const id = window.setInterval(reload, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, reload]);

  return { rows, loading, error, reload };
}
