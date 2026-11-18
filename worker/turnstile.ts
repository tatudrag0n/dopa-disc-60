/**
 * Cloudflare Turnstile（ボット判定）— 現在は無効化している。
 *
 * ゲームにボット判定は不要なので、常に「無効」として扱う。
 * - turnstileEnabled() は常に false
 *   → /api/config が siteKey=null を返し、フロント側はウィジェットを出さず空トークンで進む
 * - verifyTurnstile() は常に true
 *
 * 再び有効にしたい場合は、元の実装（git履歴）に戻し、
 * `npx wrangler secret put TURNSTILE_SECRET` でシークレットを登録する。
 */

export interface TurnstileEnv {
  TURNSTILE_SECRET?: string;
}

export function turnstileEnabled(_env: TurnstileEnv): boolean {
  return false;
}

export async function verifyTurnstile(
  _env: TurnstileEnv,
  _token: string | undefined,
  _remoteIp?: string,
): Promise<boolean> {
  return true;
}
