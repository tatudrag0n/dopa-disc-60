/**
 * Cloudflare Turnstile のラッパー。
 *
 * - `visible: false`（既定）… 実行時だけ動く不可視ウィジェット（スコア投稿用）
 * - `visible: true` … チェックボックスが常に見えるウィジェット（プレイ前の確認用）
 *
 * サイトキーが無い（＝サーバー側で無効）ときは空トークンで即解決する。
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

/** トークン待ちの上限。Turnstile の challenge は通常数秒で終わる */
const EXECUTE_TIMEOUT_MS = 25_000;
/** ウィジェットが描画されるまでの上限 */
const WIDGET_TIMEOUT_MS = 10_000;

export function useTurnstile(
  siteKey: string | null,
  language: string,
  opts: { visible?: boolean; active?: boolean } = {},
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const [ready, setReady] = useState(!siteKey);

  useEffect(() => {
    // active=false のあいだは描画しない（モーダルが閉じていると容器が無いため）。
    // 開いたときに再実行されるよう、deps に含める。
    if (!siteKey || opts.active === false) {
      setReady(!siteKey);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const api = await loadScript();
        if (cancelled) return;
        const el = containerRef.current;
        if (!el || widgetId.current) return;

        const options: Record<string, unknown> = {
          sitekey: siteKey,
          theme: "auto",
          language,
          callback: (token: string) => {
            tokenRef.current = token;
            const p = pending.current;
            if (!p) return;
            window.clearTimeout(p.timer);
            pending.current = null;
            p.resolve(token);
          },
          "expired-callback": () => {
            tokenRef.current = null;
          },
          "error-callback": () => {
            const p = pending.current;
            if (!p) return;
            window.clearTimeout(p.timer);
            pending.current = null;
            p.reject(new Error("turnstile-error"));
          },
          "timeout-callback": () => {
            const p = pending.current;
            if (!p) return;
            window.clearTimeout(p.timer);
            pending.current = null;
            p.reject(new Error("turnstile-timeout"));
          },
        };

        if (opts.visible) {
          // チェックボックスを常時表示し、描画と同時に自動で判定させる。
          // スマホの狭い画面でも収まるよう compact（150x140）にする。
          options.appearance = "always";
          options.size = "compact";
        } else {
          options.execution = "execute";
          options.appearance = "interaction-only";
        }

        widgetId.current = api.render(el, options);
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // opts.visible はマウント中に変化しない前提
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, language, opts.visible, opts.active]);

  /** ウィジェットの描画完了を待つ */
  const waitForWidget = useCallback(async (): Promise<string | null> => {
    const started = Date.now();
    while (!widgetId.current) {
      if (Date.now() - started > WIDGET_TIMEOUT_MS) return null;
      await new Promise((r) => window.setTimeout(r, 100));
    }
    return widgetId.current;
  }, []);

  /** トークンを取得する。サイトキーが無ければ空文字。 */
  const execute = useCallback(async (): Promise<string> => {
    if (!siteKey) return "";

    const id = await waitForWidget();
    if (id === null) throw new Error("turnstile-not-rendered");

    // 自動判定がすでに終わっていればそのトークンを使う
    if (tokenRef.current) {
      const t = tokenRef.current;
      tokenRef.current = null;
      return t;
    }

    const api = window.turnstile;
    if (!api) throw new Error("turnstile-not-ready");

    const promise = new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.current = null;
        reject(new Error("turnstile-timeout"));
      }, EXECUTE_TIMEOUT_MS);
      pending.current = { resolve, reject, timer };
    });

    // 自動実行中だと execute() が投げることがあるが、その場合もコールバックを待てばよい
    try {
      api.execute(id);
    } catch {
      /* noop */
    }

    return promise;
  }, [siteKey, waitForWidget]);

  return { containerRef, ready, execute, enabled: Boolean(siteKey) };
}
