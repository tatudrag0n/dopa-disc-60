/**
 * Cloudflare Turnstile の薄いラッパー。
 * サイトキーが無い（＝サーバーで無効）ときは空トークンで即解決する。
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id?: string) => void;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const done = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile not available"));
    };
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => reject(new Error("turnstile load failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", done);
    script.addEventListener("error", () => reject(new Error("turnstile load failed")));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

interface Pending {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timer: number;
}

const EXECUTE_TIMEOUT_MS = 25_000;

export function useTurnstile(
  siteKey: string | null,
  language: string,
  opts: { visible?: boolean } = {},
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const [ready, setReady] = useState(!siteKey);

  useEffect(() => {
    if (!siteKey) {
      setReady(true);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const api = await loadScript();
        if (cancelled) return;
        const el = containerRef.current;
        if (!el) return;
        if (widgetId.current) return;

        widgetId.current = api.render(el, {
          sitekey: siteKey,
          execution: "execute",
          appearance: opts.visible ? "always" : "interaction-only",
          size: "flexible",
          theme: "auto",
          language,
          "error-callback": () => {
            pending.current?.reject(new Error("turnstile-error"));
            pending.current = null;
          },
          "timeout-callback": () => {
            pending.current?.reject(new Error("turnstile-timeout"));
            pending.current = null;
          },
          callback: (token: string) => {
            const p = pending.current;
            if (!p) return;
            window.clearTimeout(p.timer);
            pending.current = null;
            p.resolve(token);
          },
        });
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [siteKey, language]);

  /** トークンを取得する。サイトキーが無ければ空文字。 */
  /** ウィジェットの描画完了を待つ（モーダルを開いた直後はまだ無いことがある） */
  const waitForWidget = useCallback(async (timeoutMs = 8000): Promise<string | null> => {
    const started = Date.now();
    while (!widgetId.current) {
      if (Date.now() - started > timeoutMs) return null;
      if (!siteKey) return "";
      await new Promise((r) => window.setTimeout(r, 100));
    }
    return widgetId.current;
  }, [siteKey]);

  const execute = useCallback(async (): Promise<string> => {
    if (!siteKey) return "";
    const id = await waitForWidget();
    if (id === null) throw new Error("turnstile-not-ready");
    const api = window.turnstile;
    if (!api) throw new Error("turnstile-not-ready");

    // 前回の使い捨てトークンを破棄してから実行する
    try {
      api.reset(id);
    } catch {
      /* noop */
    }

    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.current = null;
        reject(new Error("turnstile-timeout"));
      }, EXECUTE_TIMEOUT_MS);
      pending.current = { resolve, reject, timer };
      try {
        api.execute(id);
      } catch (err) {
        window.clearTimeout(timer);
        pending.current = null;
        reject(err instanceof Error ? err : new Error("turnstile-failed"));
      }
    });
  }, [siteKey]);

  return { containerRef, ready, execute, enabled: Boolean(siteKey) };
}
