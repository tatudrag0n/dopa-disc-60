import { getIdentity, type AuthEnv, type Identity } from "./auth";
import { json } from "./util";
import { turnstileEnabled } from "./turnstile";
import { consumePlayTicket } from "./tickets";

export interface ActionsEnv extends AuthEnv {
  TURNSTILE_SECRET?: string;
}

/** 返すランキング件数（ゲーム側は TOP 5 を表示する） */
const TOP_LIMIT = 20;

/** 1 分あたりの投稿上限 */
const RATE_PER_MIN = 20;

interface RunRow {
  uid: string;
  name: string;
  best: number;
  total: number;
  grade: string;
  created_at: number;
}

/** インメモリのレート制限カウンタ（1 分窓） */
const rateBuckets = new Map<string, { window: number; count: number }>();

async function rateLimited(identity: Identity): Promise<boolean> {
  // KV の write は上限に当たると 500 になるので、isolate 内のメモリで
  // ベストエフォートの制限をする（厳密な分散制限ではないが十分）。
  const window = Math.floor(Date.now() / 60_000);
  const key = `${identity.uid}:${window}`;
  try {
    const current = rateBuckets.get(key);
    const count = current && current.window === window ? current.count : 0;
    if (count >= RATE_PER_MIN) return true;
    rateBuckets.set(key, { window, count: count + 1 });
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.window !== window) rateBuckets.delete(k);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * ゲーム本体（GameApp）が呼ぶ `recordApi` の受け口。
 * ゲーム側の実装は変えずに、保存先だけ Cloudflare D1 にする。
 */
export async function handleActions(env: ActionsEnv, req: Request, body: unknown): Promise<Response> {
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const action = typeof payload.action === "string" ? payload.action : "";
  const args =
    payload.args && typeof payload.args === "object"
      ? (payload.args as Record<string, unknown>)
      : {};

  if (action === "records.list") {
    const identity = await getIdentity(env, req);
    const { results } = await env.DB.prepare(
      "SELECT uid, name, best, total, grade, created_at FROM runs ORDER BY total DESC, created_at ASC LIMIT ?",
    )
      .bind(TOP_LIMIT)
      .all<RunRow>();

    // ランキング圏外でも自分の自己ベストを出せるように、本人の行を別に返す
    let myRecord: {
      name: string;
      best: number;
      total: number;
      rank: string;
      playedAt: string;
    } | null = null;

    if (identity) {
      const mine = await env.DB.prepare(
        "SELECT uid, name, best, total, grade, created_at FROM runs WHERE uid = ?",
      )
        .bind(identity.uid)
        .first<RunRow>();
      if (mine) {
        myRecord = {
          name: mine.name,
          best: mine.best,
          total: mine.total,
          rank: mine.grade,
          playedAt: new Date(mine.created_at).toISOString(),
        };
      }
    }

    return json({
      data: {
        records: (results ?? []).map((r) => ({
          value: {
            name: r.name,
            best: r.best,
            total: r.total,
            rank: r.grade,
            playedAt: new Date(r.created_at).toISOString(),
            isMe: identity ? r.uid === identity.uid : false,
          },
        })),
        myRecord,
      },
    });
  }

  if (action === "records.create") {
    const identity = await getIdentity(env, req);
    if (!identity) {
      return json({ error: "名前を決めてから投げてください" }, 401);
    }

    const value =
      args.value && typeof args.value === "object"
        ? (args.value as Record<string, unknown>)
        : {};
    const best = Number(value.best);
    const total = Number(value.total);
    const grade = typeof value.rank === "string" ? value.rank.slice(0, 4) : "D";

    // プレイ券（Turnstile の確認を通った証拠）を検証して消費する（D1 保存）
    if (turnstileEnabled(env)) {
      const ticket = typeof args.play_ticket === "string" ? args.play_ticket : "";
      if (!ticket) return json({ error: "プレイ前の確認が必要です" }, 403);
      if (!(await consumePlayTicket(env.DB, ticket))) {
        return json({ error: "確認の有効期限が切れました。もう一度スタートしてください" }, 403);
      }
    }

    if (!Number.isFinite(best) || !Number.isFinite(total)) {
      return json({ error: "スコアの形式が不正です" }, 400);
    }
    if (best < 0 || best > 100000 || total < 0 || total > 100000) {
      return json({ error: "スコアが範囲外です" }, 400);
    }

    if (await rateLimited(identity)) {
      return json({ error: "投稿が多すぎます。少し待ってから再挑戦してください" }, 429);
    }

    const now = Date.now();
    // 1 人 1 行。自己ベストを更新したときだけ書き換える。
    await env.DB.prepare(
      `INSERT INTO runs (uid, name, best, total, grade, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         name = excluded.name,
         best = excluded.best,
         total = excluded.total,
         grade = excluded.grade,
         created_at = excluded.created_at
       WHERE excluded.total > runs.total`,
    )
      .bind(identity.uid, identity.name, best, total, grade, now)
      .run();

    const better = await env.DB.prepare("SELECT COUNT(*) AS c FROM runs WHERE total > ?")
      .bind(total)
      .first<{ c: number }>();

    return json({ data: { ok: true, rank: Number(better?.c ?? 0) + 1 } });
  }

  return json({ error: `unknown action: ${action}` }, 400);
}
