import {
  clamp,
  computeDistance,
  DIST_MAX,
  DIST_MIN,
  type LeaderboardResponse,
  type RawPlay,
  ROT_MAX,
  type ScoreEntry,
  type ScoreRange,
  type SubmitResponse,
} from "../src/shared/types";
import type { AuthEnv, Identity } from "./auth";
import { json, rangeWindowStart, randomToken } from "./util";

/** ランキングに返す最大件数 */
const MAX_ENTRIES = 200;

/** 同時実行時のランキング算出で読み込む最大行数 */
const CANDIDATE_ROWS = 500;

/** plays の保持期間（今日/今週の集計に必要な分だけ残す） */
const PLAY_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

/** 1 分あたりの投稿上限 */
const RATE_LIMIT_PER_MIN = 12;

export interface ScoreEnv extends AuthEnv {
  DB: D1Database;
}

interface Row {
  id: string;
  uid: string;
  name: string;
  distance: number;
  shape_score: number;
  rot: number;
  mom: number;
  ts: number;
}

function toEntry(row: Row): ScoreEntry {
  return {
    id: row.id,
    name: row.name,
    distance: row.distance,
    shapeScore: row.shape_score,
    rot: row.rot,
    mom: row.mom,
    ts: row.ts,
  };
}

export async function getLeaderboard(
  env: ScoreEnv,
  range: ScoreRange,
  limit: number,
  identity: Identity | null,
): Promise<Response> {
  const take = clamp(Math.floor(limit), 1, MAX_ENTRIES);
  const windowStart = rangeWindowStart(range);

  let entries: ScoreEntry[];

  if (range === "all") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM bests ORDER BY distance DESC, ts ASC LIMIT ?",
    )
      .bind(take)
      .all<Row>();
    entries = (results ?? []).map(toEntry);
  } else {
    // 期間内のプレイから、ユーザーごとのベストだけを残す
    const { results } = await env.DB.prepare(
      "SELECT * FROM plays WHERE ts >= ? ORDER BY distance DESC, ts ASC LIMIT ?",
    )
      .bind(windowStart, CANDIDATE_ROWS)
      .all<Row>();

    const seen = new Set<string>();
    entries = [];
    for (const row of results ?? []) {
      if (seen.has(row.uid)) continue;
      seen.add(row.uid);
      entries.push(toEntry(row));
      if (entries.length >= take) break;
    }
  }

  let me: LeaderboardResponse["me"] = null;
  if (identity) {
    const mine =
      range === "all"
        ? await env.DB.prepare("SELECT * FROM bests WHERE uid = ?").bind(identity.uid).first<Row>()
        : await env.DB.prepare(
            "SELECT * FROM plays WHERE uid = ? AND ts >= ? ORDER BY distance DESC LIMIT 1",
          )
            .bind(identity.uid, windowStart)
            .first<Row>();

    if (mine) {
      const idx = entries.findIndex((e) => e.id === mine.id);
      me = { entry: toEntry(mine), rank: idx >= 0 ? idx + 1 : -1 };
    }
  }

  const countRow =
    range === "all"
      ? await env.DB.prepare("SELECT COUNT(*) AS c FROM bests").first<{ c: number }>()
      : await env.DB.prepare("SELECT COUNT(*) AS c FROM plays WHERE ts >= ?")
          .bind(windowStart)
          .first<{ c: number }>();

  const payload: LeaderboardResponse = {
    range,
    entries,
    me,
    totalPlays: Number(countRow?.c ?? 0),
    updatedAt: Date.now(),
  };
  return json(payload);
}

/** レート制限。超過していたら true */
async function rateLimited(env: AuthEnv, identity: Identity): Promise<boolean> {
  const window = Math.floor(Date.now() / 60_000);
  const key = `rl:${identity.uid}:${window}`;
  const current = Number((await env.DOPA_KV.get(key)) ?? "0");
  if (current >= RATE_LIMIT_PER_MIN) return true;
  await env.DOPA_KV.put(key, String(current + 1), { expirationTtl: 120 });
  return false;
}

/**
 * スコア投稿。クライアントの申告距離は一切信用せず、
 * shapeScore / rot / mom からサーバー側で距離を再計算する。
 */
export async function submitScore(
  env: ScoreEnv,
  identity: Identity,
  body: unknown,
): Promise<Response> {
  const play = parsePlay(body);
  if (!play) return json({ error: "スコアの形式が不正です" }, 400);

  if (await rateLimited(env, identity)) {
    return json({ error: "投稿が多すぎます。少し待ってから再挑戦してください" }, 429);
  }

  const distance = computeDistance(play);
  if (distance < DIST_MIN || distance > DIST_MAX) {
    return json({ error: "スコアが範囲外です" }, 400);
  }

  const now = Date.now();
  const previous = await env.DB.prepare("SELECT * FROM bests WHERE uid = ?")
    .bind(identity.uid)
    .first<Row>();
  const isNewPersonalBest = !previous || distance > previous.distance;

  // 個人ベストの行 ID は引き継ぐ（ランキング上の見た目を安定させる）
  const id = previous?.id ?? randomToken(9);
  const entry: ScoreEntry = {
    id,
    name: identity.name,
    distance,
    shapeScore: Math.round(play.shapeScore * 10) / 10,
    rot: Math.round(play.rot * 10) / 10,
    mom: Math.round(play.mom * 10) / 10,
    ts: now,
  };

  // bests の upsert と plays の追記を 1 バッチで実行（原子性を確保）
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO bests (uid, id, name, distance, shape_score, rot, mom, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         name = excluded.name,
         distance = excluded.distance,
         shape_score = excluded.shape_score,
         rot = excluded.rot,
         mom = excluded.mom,
         ts = excluded.ts
       WHERE excluded.distance > bests.distance`,
    ).bind(
      identity.uid,
      id,
      entry.name,
      entry.distance,
      entry.shapeScore,
      entry.rot,
      entry.mom,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO plays (id, uid, name, distance, shape_score, rot, mom, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(randomToken(9), identity.uid, entry.name, entry.distance, entry.shapeScore, entry.rot, entry.mom, now),
  ]);

  // 古い履歴をときどき間引く（全リクエストではやらない）
  if (Math.random() < 0.05) {
    await env.DB.prepare("DELETE FROM plays WHERE ts < ?")
      .bind(now - PLAY_RETENTION_MS)
      .run();
  }

  const better = await env.DB.prepare("SELECT COUNT(*) AS c FROM bests WHERE distance > ?")
    .bind(distance)
    .first<{ c: number }>();
  const rank = Number(better?.c ?? 0) + 1;

  const payload: SubmitResponse = {
    entry,
    rank,
    personalBest: isNewPersonalBest ? distance : (previous?.distance ?? distance),
    isNewPersonalBest,
  };
  return json(payload);
}

function parsePlay(body: unknown): RawPlay | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const shapeScore = Number(b.shapeScore);
  const rot = Number(b.rot);
  const mom = Number(b.mom);
  if (!Number.isFinite(shapeScore) || !Number.isFinite(rot) || !Number.isFinite(mom)) return null;
  if (shapeScore < 0 || shapeScore > 100) return null;
  if (rot < 0 || rot > ROT_MAX) return null;
  if (mom < 0 || mom > 100) return null;
  return { shapeScore, rot, mom };
}
