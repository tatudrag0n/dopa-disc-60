import { useCallback, useEffect, useState } from "react";
import { fetchConfig, fetchMe } from "./api";

export interface Player {
  name: string;
}

export interface PlayerState {
  user: Player | null;
  /** Turnstile のサイトキー（無効なら null） */
  siteKey: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: Player | null) => void;
}

export function usePlayer(): PlayerState {
  const [user, setUser] = useState<Player | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [me, config] = await Promise.all([
        fetchMe().catch(() => ({ user: null })),
        fetchConfig().catch(() => ({ turnstileSiteKey: null })),
      ]);
      setUser(me.user);
      setSiteKey(config.turnstileSiteKey);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { user, siteKey, loading, refresh, setUser };
}
