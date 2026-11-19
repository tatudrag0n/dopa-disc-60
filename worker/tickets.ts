/**
 * プレイ券（ボット判定を通った証拠）の置き場。
 *
 * 以前は DOPA_KV に書いていたが、KV の書き込み上限に当たると
 * `/api/play-ticket` が 500 になりゲームが始められなくなったため、
 * D1 のテーブルに移した。テーブルは初回アクセス時に自動作成する。
 */

import { randomToken } from "./util";

/** プレイ券の有効期間（3分） */
const TICKET_TTL_MS = 180_000;

let ticketsReady = false;

/** play_tickets テーブルを用意する（モジュール内フラグで初回のみ） */
export async function ensurePlayTicketsTable(db: D1Database): Promise<void> {
  if (ticketsReady) return;
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS play_tickets (ticket TEXT PRIMARY KEY, exp INTEGER NOT NULL)",
    )
    .run();
  // 期限切れの掃除は isolate の初回だけ（書き込み回数を抑える）
  try {
    await db.prepare("DELETE FROM play_tickets WHERE exp < ?").bind(Date.now()).run();
  } catch {
    /* 掃除に失敗しても本処理は続ける */
  }
  ticketsReady = true;
}

/** プレイ券を発行して D1 に保存する */
export async function issuePlayTicket(db: D1Database): Promise<string> {
  await ensurePlayTicketsTable(db);
  const ticket = randomToken(24);
  const exp = Date.now() + TICKET_TTL_MS;
  await db
    .prepare("INSERT OR REPLACE INTO play_tickets (ticket, exp) VALUES (?, ?)")
    .bind(ticket, exp)
    .run();
  return ticket;
}

/**
 * プレイ券を検証して消費する。有効なら true。
 * 期限切れ・未発行なら false。
 */
export async function consumePlayTicket(db: D1Database, ticket: string): Promise<boolean> {
  if (!ticket) return false;
  try {
    await ensurePlayTicketsTable(db);
    const row = await db
      .prepare("SELECT exp FROM play_tickets WHERE ticket = ?")
      .bind(ticket)
      .first<{ exp: number }>();
    if (!row) return false;
    try {
      await db.prepare("DELETE FROM play_tickets WHERE ticket = ?").bind(ticket).run();
    } catch {
      /* 消費に失敗しても検証結果は返す */
    }
    return row.exp >= Date.now();
  } catch (err) {
    console.error("play-ticket verify", err instanceof Error ? err.stack : String(err));
    return false;
  }
}
