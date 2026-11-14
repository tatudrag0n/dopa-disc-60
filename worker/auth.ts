import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  NAME_MAX,
  NAME_MIN,
  validateName,
  validatePassword,
} from "../src/shared/types";
import { getAccessIdentity, displayNameFromEmail, accessConfigured } from "./access";
import {
  buildCookie,
  fromBase64,
  getCookie,
  isHttps,
  randomToken,
  sha256Hex,
  toBase64,
} from "./util";

export interface AuthEnv {
  DOPA_KV: KVNamespace;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/** 認証済みの身元 */
export interface Identity {
  /** ランキング上の内部 ID */
  uid: string;
  /** 表示名 */
  name: string;
  via: "cloudflare-access" | "account";
}

interface UserRecord {
  id: string;
  name: string;
  nameLower: string;
  salt: string;
  hash: string;
  iter: number;
  createdAt: number;
}

interface SessionRecord {
  uid: string;
  name: string;
  via: "cloudflare-access" | "account";
  exp: number;
}

export const SESSION_COOKIE = "dopa_sess";
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 日

/**
 * PBKDF2 の反復回数。
 * Cloudflare Workers の本番環境では 100,000 を超えると NotSupportedError に
 * なるため、上限ちょうどで固定する（ローカルでは検出できない）。
 */
const PBKDF2_ITERS = 100_000;

function userKey(nameLower: string): string {
  return `user:${nameLower}`;
}

async function derive(password: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    key,
    256,
  );
  return toBase64(bits);
}

/** タイミング差を減らすための比較 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function registerUser(
  env: AuthEnv,
  rawName: string,
  password: string,
): Promise<{ ok: true; identity: Identity } | { ok: false; message: string }> {
  const name = rawName.trim().normalize("NFKC");
  const nameError = validateName(name);
  if (nameError) return { ok: false, message: nameError };
  const pwError = validatePassword(password);
  if (pwError) return { ok: false, message: pwError };

  const nameLower = name.toLowerCase();
  const existing = await env.DOPA_KV.get(userKey(nameLower), "json");
  if (existing) return { ok: false, message: "この名前はすでに使われています" };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERS);
  const record: UserRecord = {
    id: randomToken(12),
    name,
    nameLower,
    salt: toBase64(salt),
    hash,
    iter: PBKDF2_ITERS,
    createdAt: Date.now(),
  };
  await env.DOPA_KV.put(userKey(nameLower), JSON.stringify(record));
  return { ok: true, identity: { uid: `u_${record.id}`, name: record.name, via: "account" } };
}

export async function loginUser(
  env: AuthEnv,
  rawName: string,
  password: string,
): Promise<{ ok: true; identity: Identity } | { ok: false; message: string }> {
  const name = rawName.trim().normalize("NFKC");
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { ok: false, message: "名前またはパスワードが違います" };
  }
  if (password.length < 1 || password.length > PASSWORD_MAX || password.length < PASSWORD_MIN) {
    return { ok: false, message: "名前またはパスワードが違います" };
  }
  const record = (await env.DOPA_KV.get(userKey(name.toLowerCase()), "json")) as UserRecord | null;
  if (!record) return { ok: false, message: "名前またはパスワードが違います" };

  // 反復回数が上限を超える記録は検証しない（壊れたデータ対策）
  if (record.iter > PBKDF2_ITERS) return { ok: false, message: "名前またはパスワードが違います" };

  const hash = await derive(password, fromBase64(record.salt), record.iter);
  if (!safeEqual(hash, record.hash)) {
    return { ok: false, message: "名前またはパスワードが違います" };
  }
  return { ok: true, identity: { uid: `u_${record.id}`, name: record.name, via: "account" } };
}

export async function createSession(
  env: AuthEnv,
  identity: Identity,
): Promise<{ token: string; setCookie: string; secure: boolean }> {
  const token = randomToken(32);
  const session: SessionRecord = {
    uid: identity.uid,
    name: identity.name,
    via: identity.via,
    exp: Date.now() + SESSION_TTL_SEC * 1000,
  };
  await env.DOPA_KV.put(`sess:${token}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SEC,
  });
  return { token, setCookie: buildCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SEC }), secure: true };
}

export function clearedCookie(req: Request): string {
  return buildCookie(SESSION_COOKIE, "", { clear: true, secure: isHttps(req) });
}

export async function destroySession(env: AuthEnv, req: Request): Promise<void> {
  const token = getCookie(req, SESSION_COOKIE);
  if (token) await env.DOPA_KV.delete(`sess:${token}`);
}

/**
 * リクエストの身元を解決する。
 * Cloudflare Access が有効なら Access の身元を最優先し、
 * なければ内蔵アカウントのセッションを見る。
 */
export async function resolveIdentity(env: AuthEnv, req: Request): Promise<Identity | null> {
  if (accessConfigured(env)) {
    const access = await getAccessIdentity(req, env);
    if (access) {
      const emailKey = await sha256Hex(access.email.toLowerCase());
      return {
        uid: `a_${emailKey.slice(0, 24)}`,
        name: displayNameFromEmail(access.email),
        via: "cloudflare-access",
      };
    }
    // Access 配下ではあるが JWT が無い/不正 → 未認証として扱う
    if (req.headers.get("cf-access-jwt-assertion")) return null;
  }

  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const session = (await env.DOPA_KV.get(`sess:${token}`, "json")) as SessionRecord | null;
  if (!session) return null;
  if (session.exp < Date.now()) {
    await env.DOPA_KV.delete(`sess:${token}`);
    return null;
  }
  return { uid: session.uid, name: session.name, via: session.via };
}

/** セッション Cookie を発行するレスポンスヘッダー */
export function sessionHeaders(req: Request, cookie: string): HeadersInit {
  const headers: Record<string, string> = { "set-cookie": cookie };
  if (!isHttps(req)) {
    // ローカル開発 (http) では Secure を外す
    headers["set-cookie"] = cookie.replace("; Secure", "");
  }
  return headers;
}
