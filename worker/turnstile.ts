/**
 * Cloudflare Turnstile（ボット判定）。
 *
 * TURNSTILE_SECRET が未設定ならチェックをスキップする（ローカル開発用）。
 * ログインは行わず、「人間かどうか」だけをここで確認する。
 */

export interface TurnstileEnv {
  TURNSTILE_SECRET?: string;
}

interface SiteVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
}

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(env: TurnstileEnv): boolean {
  return Boolean(env.TURNSTILE_SECRET);
}

/**
 * トークンを検証する。設定が無ければ常に true。
 * ネットワーク障害時は false（安全側）に倒す。
 */
export async function verifyTurnstile(
  env: TurnstileEnv,
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  if (!turnstileEnabled(env)) return true;
  if (!token || typeof token !== "string" || token.length > 4096) return false;

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET as string);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body: form });
    if (!res.ok) return false;
    const data = (await res.json()) as SiteVerifyResponse;
    return data.success === true;
  } catch {
    return false;
  }
}
