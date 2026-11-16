/** プレイ前の確認（Turnstile のチェックボックス）とプレイ券の受け渡し */

let provider: (() => Promise<string>) | null = null;
let ticket: string | null = null;

/**
 * 確認 UI のハンドラを登録する。null を渡すと解除。
 * ここで返した Turnstile トークンを使ってサーバーからプレイ券をもらう。
 */
export function registerPlayTokenProvider(fn: (() => Promise<string>) | null) {
  provider = fn;
}

/**
 * プレイ開始前に呼ぶ。確認 UI を出してトークンを取得し、
 * サーバーで検証してプレイ券を受け取る。失敗したら false。
 */
export async function requestPlayTicket(): Promise<boolean> {
  let token = "";
  try {
    token = provider ? await provider() : "";
  } catch {
    return false;
  }

  try {
    const res = await fetch("/api/play-ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: token }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: { ticket?: string } };
    ticket = json.data?.ticket ?? null;
    return Boolean(ticket);
  } catch {
    return false;
  }
}

/** スコア送信時に使う。1回使ったら無効になる。 */
export function takePlayTicket(): string {
  const t = ticket;
  ticket = null;
  return t ?? "";
}
