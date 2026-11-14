/** Worker 共通ユーティリティ */

export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
} as const;

export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extra) new Headers(extra).forEach((v, k) => headers.set(k, v));
  return new Response(JSON.stringify(data), { status, headers });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text || text.length > 4096) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Cookie ヘッダーから 1 件取り出す */
export function getCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

export function buildCookie(
  name: string,
  value: string,
  opts: { maxAge?: number; secure?: boolean; clear?: boolean } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.secure !== false) parts.push("Secure");
  parts.push(`Max-Age=${opts.clear ? 0 : (opts.maxAge ?? 60 * 60 * 24 * 30)}`);
  return parts.join("; ");
}

export function isHttps(req: Request): boolean {
  return new URL(req.url).protocol === "https:";
}

/** クライアント IP（レート制限用） */
export function clientKey(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 期間の開始時刻 (epoch ms) を返す。日本時間 (UTC+9) 基準。
 * - today: その日の 00:00 JST
 * - week:  月曜 00:00 JST
 */
export function rangeWindowStart(range: "all" | "today" | "week", now = Date.now()): number {
  if (range === "all") return 0;
  const JST = 9 * 60 * 60 * 1000;
  const jstNow = new Date(now + JST);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const d = jstNow.getUTCDate();
  if (range === "today") {
    return Date.UTC(y, m, d) - JST;
  }
  // 月曜始まり
  const dow = jstNow.getUTCDay(); // 0=日
  const back = (dow + 6) % 7;
  return Date.UTC(y, m, d - back) - JST;
}
