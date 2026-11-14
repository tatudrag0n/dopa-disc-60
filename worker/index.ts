import {
  clearedCookie,
  createSession,
  destroySession,
  loginUser,
  registerUser,
  resolveIdentity,
  sessionHeaders,
  type AuthEnv,
  type Identity,
} from "./auth";
import { accessConfigured } from "./access";
import { getLeaderboard, submitScore } from "./scores";
import { SCORE_RANGES, type MeResponse, type ScoreRange } from "../src/shared/types";
import { fail, isHttps, json, readJson } from "./util";

export interface Env extends AuthEnv {
  ASSETS: Fetcher;
  /** 任意: Turnstile を有効にする場合のシークレット */
  TURNSTILE_SECRET?: string;
}

const ROUTES_WITH_BODY = new Set(["/api/auth/register", "/api/auth/login", "/api/scores"]);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // API 以外は静的アセットへ（wrangler の run_worker_first が /api/* のみなので
    // 通常ここには来ないが、直接叩かれた場合の保険）
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
    return json({ ok: true, access: accessConfigured(env) });
  }

  if (req.method === "GET" && path === "/api/me") {
    const identity = await resolveIdentity(env, req);
    const payload: MeResponse = {
      user: identity ? { name: identity.name, via: identity.via } : null,
      accessEnabled: accessConfigured(env),
    };
    return json(payload);
  }

  if (req.method === "GET" && path === "/api/leaderboard") {
    const identity = await resolveIdentity(env, req);
    const raw = url.searchParams.get("range") ?? "all";
    const range: ScoreRange = (SCORE_RANGES as string[]).includes(raw) ? (raw as ScoreRange) : "all";
    const limit = Number(url.searchParams.get("limit") ?? "50");
    return getLeaderboard(env, range, Number.isFinite(limit) ? limit : 50, identity);
  }

  if (req.method === "POST") {
    if (!ROUTES_WITH_BODY.has(path)) return fail("Not Found", 404);
    const body = (await readJson<Record<string, unknown>>(req)) ?? {};

    if (path === "/api/auth/register" || path === "/api/auth/login") {
      // Access 配下では Access の身元が正になるので、パスワード認証は無効化する
      if (accessConfigured(env)) {
        const viaAccess = await resolveIdentity(env, req);
        if (viaAccess?.via === "cloudflare-access") {
          return json(
            { user: { name: viaAccess.name, via: viaAccess.via } },
            200,
            sessionHeaders(req, clearedCookie(req)),
          );
        }
      }
      const name = typeof body.name === "string" ? body.name : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!name || !password) return fail("名前とパスワードを入力してください", 400);

      const result =
        path === "/api/auth/register"
          ? await registerUser(env, name, password)
          : await loginUser(env, name, password);
      if (!result.ok) return fail(result.message, path === "/api/auth/register" ? 409 : 401);

      const session = await createSession(env, result.identity);
      const cookie = isHttps(req) ? session.setCookie : session.setCookie.replace("; Secure", "");
      return json(
        { user: { name: result.identity.name, via: result.identity.via } },
        200,
        { "set-cookie": cookie },
      );
    }

    if (path === "/api/auth/logout") {
      await destroySession(env, req);
      return json({ ok: true }, 200, sessionHeaders(req, clearedCookie(req)));
    }

    if (path === "/api/scores") {
      const identity: Identity | null = await resolveIdentity(env, req);
      if (!identity) {
        return fail(
          accessConfigured(env)
            ? "ランキング登録には Cloudflare Access での認証が必要です"
            : "ランキング登録にはログインが必要です",
          401,
        );
      }
      return submitScore(env, identity, body);
    }
  }

  return fail("Not Found", 404);
}
