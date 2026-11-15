import {
  clearedCookie,
  cookieHeader,
  createIdentity,
  destroyIdentity,
  getIdentity,
  renameIdentity,
} from "./auth";
import { getLeaderboard, submitScore, type ScoreEnv } from "./scores";
import { turnstileEnabled, verifyTurnstile, type TurnstileEnv } from "./turnstile";
import { SCORE_RANGES, type ConfigResponse, type MeResponse, type ScoreRange } from "../src/shared/types";
import { clientKey, fail, json, readJson } from "./util";

export interface Env extends ScoreEnv, TurnstileEnv {
  ASSETS: Fetcher;
  /** Turnstile のサイトキー（公開情報） */
  TURNSTILE_SITEKEY?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(req);
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          allow: "GET, POST, OPTIONS",
          "access-control-allow-origin": url.origin,
          "access-control-allow-headers": "content-type",
        },
      });
    }

    try {
      return await route(req, env, url);
    } catch (err) {
      console.error("unhandled", err instanceof Error ? err.stack : String(err));
      return fail("サーバーでエラーが発生しました", 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/api";

  if (req.method === "GET" && path === "/api/health") {
    return json({ ok: true, turnstile: turnstileEnabled(env) });
  }

  if (req.method === "GET" && path === "/api/config") {
    const payload: ConfigResponse = {
      turnstileSiteKey: turnstileEnabled(env) ? (env.TURNSTILE_SITEKEY ?? null) : null,
    };
    return json(payload);
  }

  if (req.method === "GET" && path === "/api/me") {
    const identity = await getIdentity(env, req);
    const payload: MeResponse = { user: identity ? { name: identity.name } : null };
    return json(payload);
  }

  if (req.method === "GET" && path === "/api/leaderboard") {
    const identity = await getIdentity(env, req);
    const raw = url.searchParams.get("range") ?? "all";
    const range: ScoreRange = (SCORE_RANGES as string[]).includes(raw)
      ? (raw as ScoreRange)
      : "all";
    const limit = Number(url.searchParams.get("limit") ?? "50");
    return getLeaderboard(env, range, Number.isFinite(limit) ? limit : 50, identity);
  }

  if (req.method === "POST") {
    if (path === "/api/me/name") {
      const body = (await readJson<{ name?: string }>(req)) ?? {};
      const identity = await getIdentity(env, req);
      if (!identity) return fail("セッションがありません", 401);
      const result = await renameIdentity(env, req, typeof body.name === "string" ? body.name : "");
      if (!result.ok) return fail(result.message, 400);
      return json({ user: { name: result.identity.name } });
    }

    if (path === "/api/logout") {
      await destroyIdentity(env, req);
      return json({ ok: true }, 200, cookieHeader(req, clearedCookie(req)));
    }

    if (path === "/api/scores") {
      const body = (await readJson<Record<string, unknown>>(req)) ?? {};

      // ログインはさせない。ボット判定だけ通してもらう。
      const turnstileToken =
        typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
      if (!(await verifyTurnstile(env, turnstileToken, clientKey(req)))) {
        return fail("ボット判定に失敗しました。ページを再読み込みしてお試しください", 403);
      }

      let identity = await getIdentity(env, req);
      let newCookie: string | null = null;

      if (!identity) {
        // 初回は名前だけ決めてもらう（パスワード不要）
        const name = typeof body.name === "string" ? body.name : "";
        if (!name) return fail("名前を入力してください", 400);
        const created = await createIdentity(env, name);
        if (!created.ok) return fail(created.message, 400);
        identity = created.identity;
        newCookie = created.cookie;
      }

      const res = await submitScore(env, identity, body);
      if (!newCookie) return res;
      const headers = new Headers(res.headers);
      headers.set("set-cookie", cookieHeader(req, newCookie)["set-cookie"]);
      return new Response(res.body, { status: res.status, headers });
    }
  }

  return fail("Not Found", 404);
}
