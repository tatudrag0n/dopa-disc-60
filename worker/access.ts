/**
 * Cloudflare Access 連携。
 *
 * Zero Trust で保護されたホスト名の下では、Cloudflare が
 * `Cf-Access-Jwt-Assertion` を付けてリクエストを転送してくる。
 * ここではその JWT を JWKS で **署名検証** してから身元を採用する
 * （ヘッダーをそのまま信じると、Access 未有効時に偽装できてしまうため）。
 *
 * 必要な環境変数:
 *   ACCESS_TEAM_DOMAIN 例: "myteam.cloudflareaccess.com"
 *   ACCESS_AUD          Access アプリケーションの Audience タグ
 *
 * 未設定なら Access は「無効」として扱い、内蔵アカウント認証にフォールバックする。
 */

export interface AccessIdentity {
  email: string;
}

interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000;

// 同一 isolate 内での JWKS キャッシュ
let jwksCache: { keys: JsonWebKey[]; at: number } | null = null;

interface AccessJwtPayload {
  email?: string;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  type?: string;
}

export function accessConfigured(env: AccessEnv): boolean {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

async function fetchJwks(domain: string): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
    cf: { cacheTtl: 3600 },
  } as RequestInit);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: JsonWebKey[] };
  const keys = body.keys ?? [];
  jwksCache = { keys, at: Date.now() };
  return keys;
}

function b64urlToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const s = atob(input.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

function decodeSegment(seg: string): AccessJwtPayload {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg))) as AccessJwtPayload;
}

/**
 * リクエストから Access の身元を取り出す。検証に失敗したら null。
 */
export async function getAccessIdentity(
  req: Request,
  env: AccessEnv,
): Promise<AccessIdentity | null> {
  if (!accessConfigured(env)) return null;
  const jwt = req.headers.get("cf-access-jwt-assertion");
  if (!jwt) return null;

  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [headerSeg, payloadSeg, sigSeg] = parts;

  let header: { alg?: string; kid?: string };
  let payload: AccessJwtPayload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerSeg))) as {
      alg?: string;
      kid?: string;
    };
    payload = decodeSegment(payloadSeg);
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;

  // 時刻・発行者・Audience の検証
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss && !payload.iss.includes(env.ACCESS_TEAM_DOMAIN as string)) return null;

  const aud = payload.aud;
  const audOk = Array.isArray(aud)
    ? aud.includes(env.ACCESS_AUD as string)
    : aud === env.ACCESS_AUD;
  if (!audOk) return null;

  // 署名検証
  let keys: JsonWebKey[];
  try {
    keys = await fetchJwks(env.ACCESS_TEAM_DOMAIN as string);
  } catch {
    return null;
  }
  const candidate = header.kid ? keys.find((k) => (k as { kid?: string }).kid === header.kid) : keys[0];
  if (!candidate) return null;

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      candidate,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(sigSeg),
      new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
    );
  } catch {
    return null;
  }
  if (!verified) return null;

  const email = payload.email ?? payload.sub;
  if (!email) return null;
  return { email };
}

/** メールアドレスから表示名を作る（ローカル部を優先、使えない文字は落とす） */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "player";
  const cleaned = local.replace(/[^\p{L}\p{N}_\-.]/gu, "").slice(0, 16);
  return cleaned.length >= 2 ? cleaned : "player";
}
