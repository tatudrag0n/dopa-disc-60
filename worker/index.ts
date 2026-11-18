import {
  clearedCookie,
  cookieHeader,
  createIdentity,
  destroyIdentity,
  getIdentity,
  renameIdentity,
} from "./auth";
import { handleActions, type ActionsEnv } from "./actions";
import type { MeResponse } from "../src/shared/types";
import { fail, json, readJson } from "./util";

export interface Env extends ActionsEnv {
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (!url.pathname.startsWith("/api/") && url.pathname !== "/actions") {
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
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && path === "/api/health") {
    return json({ ok: true });
  }

  if (req.method === "GET" && path === "/api/me") {
    const identity = await getIdentity(env, req);
    const payload: MeResponse = { user: identity ? { name: identity.name } : null };
    return json(payload);
  }

  if (req.method === "POST" && path === "/actions") {
    const body = await readJson<unknown>(req);
    return handleActions(env, req, body);
  }

  if (req.method === "POST" && path === "/api/me/name") {
    const body = (await readJson<Record<string, unknown>>(req)) ?? {};

    if (url.searchParams.get("create") === "1") {
      const created = await createIdentity(env, typeof body.name === "string" ? body.name : "");
      if (!created.ok) return fail(created.message, 400);
      return json({ user: { name: created.identity.name } }, 200, cookieHeader(req, created.cookie));
    }

    const identity = await getIdentity(env, req);
    if (!identity) return fail("セッションがありません", 401);
    const result = await renameIdentity(env, req, typeof body.name === "string" ? body.name : "");
    if (!result.ok) return fail(result.message, 400);
    return json({ user: { name: result.identity.name } });
  }

  if (req.method === "POST" && path === "/api/logout") {
    await destroyIdentity(env, req);
    return json({ ok: true }, 200, cookieHeader(req, clearedCookie(req)));
  }

  return fail("Not Found", 404);
}
