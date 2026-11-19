import { getIdentity, type AuthEnv, type Identity } from "./auth";
import { hasNgWord } from "../src/shared/ngwords";
import { distanceFor, MAX_SCORE_M, SPIN_MAX } from "../src/shared/scoring";
import { json } from "./util";
import { turnstileEnabled } from "./turnstile";
import { consumePlayTicket } from "./tickets";

export interface ActionsEnv extends AuthEnv {
  TURNSTILE_SECRET?: string;
}

/** 返すランキング件数（ゲーム側は TOP 5 を表示する） */
const TOP_LIMIT = 20;

/**
 * DB から取る候補の件数。NG 名を除いても TOP_LIMIT 件そろうように多めに取る。
 * 異常な名前が大量に入っても全件走査にならないよう上限を置いている。
 */
const CANDIDATE_LIMIT = TOP_LIMIT * 10;

/**
 * ランキングに載せない名前かどうか。
 * 登録時だけでなく、フィルタ導入前に保存された行にも効かせる。
 */
function isNgName(name: string): boolean {
  return hasNgWord(name);
}

/**
 * ランキング・登録に値するスコアかどうか。
 * 2 本指バグや改造クライアントで出た 2,000m・5,618m のような値は
 * 物理的にあり得ないので、保存済みの行も含めて公開ランキングから外す。
 */
function isPlausibleScore(row: { best: number; total: number }): boolean {
  return (
    Number.isFinite(row.best) &&
    Number.isFinite(row.total) &&
    row.best >= 0 &&
    row.total >= 0 &&
    row.best <= MAX_SCORE_M &&
    row.total <= MAX_SCORE_M
  );
}

/**
 * クライアントが送ってきた telemetry を、同じ計算式で組み直して照合する。
 * telemetry の無い旧クライアントはここでは通す（後方互換）。
 * 問題があればエラーメッセージを返す。
 */
const TELEMETRY_TOLERANCE_M = 5;

function verifyTelemetry(value: Record<string, unknown>, best: number, total: number): string | null {
  const raw = value.telemetry;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return "スコアの検証情報が不正です";
  const t = raw as Record<string, unknown>;
  const balance = Number(t.balance);
  const spin = Number(t.spin);
  const swipeNorm = Number(t.swipeNorm);
  if (!Number.isFinite(balance) || !Number.isFinite(spin) || !Number.isFinite(swipeNorm)) {
    return "スコアの検証情報が不正です";
  }
  if (balance < 0 || balance > 100) return "スコアの検証情報が範囲外です";
  if (Math.abs(spin) > SPIN_MAX) return "スコアの検証情報が範囲外です";
  if (swipeNorm < 0 || swipeNorm > 1) return "スコアの検証情報が範囲外です";

  const expected = distanceFor(balance, Math.abs(spin), swipeNorm);
  const tolerance = Math.max(TELEMETRY_TOLERANCE_M, expected * 0.03);
  if (Math.abs(expected - best) > tolerance || Math.abs(best - total) > tolerance) {
    return "スコアが記録と一致しません";
  }
  return null;
}

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
      .bind(CANDIDATE_LIMIT)
      .all<RunRow>();

    // NG 名・物理的にあり得ないスコアの行はランキングから完全に外す
    // （フィルタ導入前に保存された行にも効かせる）
    const ranking = (results ?? [])
      .filter((r) => !isNgName(r.name) && isPlausibleScore(r))
      .slice(0, TOP_LIMIT);

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
        // 異常値が残っている行は「自己ベスト」としても見せない
        myRecord = isPlausibleScore(mine)
          ? {
              name: mine.name,
              best: mine.best,
              total: mine.total,
              rank: mine.grade,
              playedAt: new Date(mine.created_at).toISOString(),
            }
          : null;
      }
    }

    return json({
      data: {
        records: ranking.map((r) => ({
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
    if (best < 0 || total < 0) {
      return json({ error: "スコアが範囲外です" }, 400);
    }
    // 形 S・spin・加速すべて最大でも約 1,083m。1,500m 超は不正として拒否する。
    if (best > MAX_SCORE_M || total > MAX_SCORE_M) {
      return json({ error: "スコアが範囲外です" }, 400);
    }

    // telemetry があれば、同じ計算式で組み直して大きく乖離していないか見る
    const telemetryError = verifyTelemetry(value, best, total);
    if (telemetryError) {
      return json({ error: telemetryError }, 400);
    }

    if (await rateLimited(identity)) {
      return json({ error: "投稿が多すぎます。少し待ってから再挑戦してください" }, 429);
    }

    const now = Date.now();
    // 1 人 1 行。自己ベストを更新したときだけ書き換える。
    // ただし既存の行が異常値（1,500m 超）の場合は、まともな記録で上書きできる。
    await env.DB.prepare(
      `INSERT INTO runs (uid, name, best, total, grade, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         name = excluded.name,
         best = excluded.best,
         total = excluded.total,
         grade = excluded.grade,
         created_at = excluded.created_at
       WHERE excluded.total > runs.total OR runs.total > ?`,
    )
      .bind(identity.uid, identity.name, best, total, grade, now, MAX_SCORE_M)
      .run();

    const better = await env.DB.prepare("SELECT COUNT(*) AS c FROM runs WHERE total > ?")
      .bind(total)
      .first<{ c: number }>();

    return json({ data: { ok: true, rank: Number(better?.c ?? 0) + 1 } });
  }

  return json({ error: `unknown action: ${action}` }, 400);
}
