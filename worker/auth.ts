import { NAME_MAX, NAME_MIN, validateName } from "../src/shared/types";
import { buildCookie, getCookie, isHttps, randomToken } from "./util";

export interface AuthEnv {
  DOPA_KV: KVNamespace;
}

/** セッションから復元したプレイヤー */
export interface Identity {
  /** ランキング上の内部 ID */
  uid: string;
  /** 表示名 */
  name: string;
}

interface SessionRecord {
  uid: string;
  name: string;
  exp: number;
}

export const SESSION_COOKIE = "dopa_sess";

/** セッションの有効期間（30日） */
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

function sessionKey(token: string): string {
  return `sess:${token}`;
}

/** Cookie からセッションを引く。無効・期限切れなら null。 */
export async function getIdentity(env: AuthEnv, req: Request): Promise<Identity | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const session = (await env.DOPA_KV.get(sessionKey(token), "json")) as SessionRecord | null;
  if (!session) return null;
  if (session.exp < Date.now()) {
    await env.DOPA_KV.delete(sessionKey(token));
    return null;
  }
  return { uid: session.uid, name: session.name };
}

/**
 * 新しいプレイヤーセッションを発行する。
 * ログインは無く、名前を決めた時点でこの Cookie が名札になる。
 */
export async function createIdentity(
  env: AuthEnv,
  rawName: string,
): Promise<{ ok: true; identity: Identity; cookie: string } | { ok: false; message: string }> {
  const name = rawName.trim().normalize("NFKC");
  const error = validateName(name);
  if (error) return { ok: false, message: error };

  const token = randomToken(32);
  const identity: Identity = { uid: `p_${randomToken(12)}`, name };
  const session: SessionRecord = {
    uid: identity.uid,
    name: identity.name,
    exp: Date.now() + SESSION_TTL_SEC * 1000,
  };
  await env.DOPA_KV.put(sessionKey(token), JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SEC,
  });
  return {
    ok: true,
    identity,
    cookie: buildCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SEC }),
  };
}

/** 表示名の変更 */
export async function renameIdentity(
  env: AuthEnv,
  req: Request,
  rawName: string,
): Promise<{ ok: true; identity: Identity } | { ok: false; message: string }> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return { ok: false, message: "セッションがありません" };
  const session = (await env.DOPA_KV.get(sessionKey(token), "json")) as SessionRecord | null;
  if (!session) return { ok: false, message: "セッションがありません" };

  const name = rawName.trim().normalize("NFKC");
  const error = validateName(name);
  if (error) return { ok: false, message: error };

  const next: SessionRecord = { ...session, name };
  const ttl = Math.max(60, Math.floor((session.exp - Date.now()) / 1000));
  await env.DOPA_KV.put(sessionKey(token), JSON.stringify(next), { expirationTtl: ttl });
  return { ok: true, identity: { uid: session.uid, name } };
}

export async function destroyIdentity(env: AuthEnv, req: Request): Promise<void> {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await env.DOPA_KV.delete(sessionKey(token));
}

export function clearedCookie(req: Request): string {
  return buildCookie(SESSION_COOKIE, "", { clear: true, secure: isHttps(req) });
}

/** 本番 (https) では Secure を付け、ローカル http では外す */
export function cookieHeader(req: Request, cookie: string): Record<string, string> {
  return { "set-cookie": isHttps(req) ? cookie : cookie.replace("; Secure", "") };
}

export { NAME_MIN, NAME_MAX };
