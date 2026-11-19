import { NAME_MAX, NAME_MIN, validateName } from "../src/shared/types";
import { buildCookie, getCookie, isHttps, randomToken } from "./util";

/**
 * セッション（名前札）の置き場。
 *
 * KV（DOPA_KV）は無料枠の 1 日 1,000 writes に当たると `put()` が例外になり、
 * 名前登録もプレイ開始も 500 になっていた。そのため保存先を D1 の
 * `sessions` テーブルへ移した。テーブルは初回アクセス時に自動作成するので、
 * 本番 DB にマイグレーションを流していなくてもすぐ動く。
 *
 * 旧 KV セッションは読み取りだけフォールバックし、D1 に移してから使う
 * （移行期間中もログアウトされない）。KV への書き込みは一切しない。
 */
export interface AuthEnv {
  DB: D1Database;
  /** 旧セッションの読み取り専用フォールバック。書き込みには使わない。 */
  DOPA_KV?: KVNamespace;
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

let sessionsReady = false;

/** sessions テーブルを用意する（モジュール内フラグで初回のみ） */
export async function ensureSessionsTable(db: D1Database): Promise<void> {
  if (sessionsReady) return;
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL, exp INTEGER NOT NULL)",
    )
    .run();
  try {
    await db.prepare("DELETE FROM sessions WHERE exp < ?").bind(Date.now()).run();
  } catch {
    /* 掃除に失敗しても本処理は続ける */
  }
  sessionsReady = true;
}

/** 旧 KV セッションの読み取り（書き込みはしない） */
async function readLegacySession(env: AuthEnv, token: string): Promise<SessionRecord | null> {
  if (!env.DOPA_KV) return null;
  try {
    const raw = (await env.DOPA_KV.get(sessionKey(token), "json")) as SessionRecord | null;
    if (!raw || typeof raw.uid !== "string" || typeof raw.name !== "string") return null;
    return { uid: raw.uid, name: raw.name, exp: Number(raw.exp) || 0 };
  } catch (err) {
    console.error("legacy session read", err instanceof Error ? err.stack : String(err));
    return null;
  }
}

/** 旧 KV セッションを D1 へ引き継ぐ（KV への書き込みはしない） */
async function adoptSession(env: AuthEnv, token: string, session: SessionRecord): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO sessions (token, uid, name, exp) VALUES (?, ?, ?, ?)",
    )
      .bind(token, session.uid, session.name, session.exp)
      .run();
  } catch (err) {
    console.error("session adopt", err instanceof Error ? err.stack : String(err));
  }
}

/** Cookie からセッションを引く。無効・期限切れなら null。 */
export async function getIdentity(env: AuthEnv, req: Request): Promise<Identity | null> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;

  let session: SessionRecord | null = null;
  try {
    await ensureSessionsTable(env.DB);
    session = await env.DB.prepare("SELECT uid, name, exp FROM sessions WHERE token = ?")
      .bind(token)
      .first<SessionRecord>();
  } catch (err) {
    // 読めなくても /api/me は 500 にせず「未ログイン」として返す
    console.error("session read", err instanceof Error ? err.stack : String(err));
  }

  if (!session) {
    const legacy = await readLegacySession(env, token);
    if (!legacy) return null;
    if (legacy.exp < Date.now()) return null;
    await adoptSession(env, token, legacy);
    return { uid: legacy.uid, name: legacy.name };
  }

  if (session.exp < Date.now()) {
    try {
      await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    } catch {
      /* 期限切れの掃除に失敗しても未ログイン扱いでよい */
    }
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

  await ensureSessionsTable(env.DB);

  const token = randomToken(32);
  const identity: Identity = { uid: `p_${randomToken(12)}`, name };
  const exp = Date.now() + SESSION_TTL_SEC * 1000;
  await env.DB.prepare("INSERT OR REPLACE INTO sessions (token, uid, name, exp) VALUES (?, ?, ?, ?)")
    .bind(token, identity.uid, identity.name, exp)
    .run();
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

  await ensureSessionsTable(env.DB);
  const session = await env.DB.prepare("SELECT uid, name, exp FROM sessions WHERE token = ?")
    .bind(token)
    .first<SessionRecord>();
  if (!session) return { ok: false, message: "セッションがありません" };

  const name = rawName.trim().normalize("NFKC");
  const error = validateName(name);
  if (error) return { ok: false, message: error };

  await env.DB.prepare("UPDATE sessions SET name = ? WHERE token = ?").bind(name, token).run();
  return { ok: true, identity: { uid: session.uid, name } };
}

export async function destroyIdentity(env: AuthEnv, req: Request): Promise<void> {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return;
  try {
    await ensureSessionsTable(env.DB);
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  } catch (err) {
    console.error("session delete", err instanceof Error ? err.stack : String(err));
  }
}

export function clearedCookie(req: Request): string {
  return buildCookie(SESSION_COOKIE, "", { clear: true, secure: isHttps(req) });
}

/** 本番 (https) では Secure を付け、ローカル http では外す */
export function cookieHeader(req: Request, cookie: string): Record<string, string> {
  return { "set-cookie": isHttps(req) ? cookie : cookie.replace("; Secure", "") };
}

export { NAME_MIN, NAME_MAX };
