import { useCallback, useEffect, useState } from "react";
import { fetchMe, logout as apiLogout } from "./api";

export interface AuthUser {
  name: string;
  via: "cloudflare-access" | "account";
}

export interface AuthState {
  user: AuthUser | null;
  /** Cloudflare Access 配下か */
  accessEnabled: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessEnabled, setAccessEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUser(me.user);
      setAccessEnabled(me.accessEnabled);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      /* セッションが既に無い場合も成功扱い */
    }
    setUser(null);
    await refresh();
  }, [refresh]);

  return { user, accessEnabled, loading, refresh, signOut, setUser };
}
