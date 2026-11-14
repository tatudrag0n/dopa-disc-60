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

/** ランキングに残す最大件数 */
const MAX_ENTRIES = 200;

/** 1 分あたりの投稿上限 */
const RATE_LIMIT_PER_MIN = 12;

interface StoredEntry extends ScoreEntry {
  /** 内部ユーザー ID（外部には出さない） */
  uid: string;
}

interface LeaderboardDoc {
  windowStart: number;
  updatedAt: number;
  plays: number;
  entries: StoredEntry[];
}

function lbKey(range: ScoreRange): string {
  return `lb:${range}`;
}

function ubKey(range: ScoreRange, uid: string): string {
  return `ub:${range}:${uid}`;
}

/** 外部公開用に uid を落とす */
function publicEntry(e: StoredEntry): ScoreEntry {
  const { uid: _uid, ...rest } = e;
  return rest;
}

function emptyDoc(range: ScoreRange): LeaderboardDoc {
  return { windowStart: rangeWindowStart(range), updatedAt: 0, plays: 0, entries: [] };
}

async function readDoc(env: AuthEnv, range: ScoreRange): Promise<LeaderboardDoc> {
  const doc = (await env.DOPA_KV.get(lbKey(range), "json")) as LeaderboardDoc | null;
  if (!doc) return emptyDoc(range);
  // 期間が切り替わっていたらリセット（today / week のみ）
  if (range !== "all" && doc.windowStart !== rangeWindowStart(range)) {
    return emptyDoc(range);
  }
  if (!Array.isArray(doc.entries)) return emptyDoc(range);
  return doc;
}

function sortEntries(entries: StoredEntry[]): StoredEntry[] {
  return entries.sort((a, b) => b.distance - a.distance || a.ts - b.ts);
}

export async function getLeaderboard(
  env: AuthEnv,
  range: ScoreRange,
  limit: number,
  identity: Identity | null,
): Promise<Response> {
  const doc = await readDoc(env, range);
  const entries = sortEntries(doc.entries.slice());

  let me: LeaderboardResponse["me"] = null;
  if (identity) {
    const mine = (await env.DOPA_KV.get(ubKey(range, identity.uid), "json")) as StoredEntry | null;
    if (mine) {
      const idx = entries.findIndex((e) => e.id === mine.id);
      me = { entry: publicEntry(mine), rank: idx >= 0 ? idx + 1 : -1 };
    }
  }

  const payload: LeaderboardResponse = {
    range,
    entries: entries.slice(0, clamp(limit, 1, MAX_ENTRIES)).map(publicEntry),
    me,
    totalPlays: doc.plays,
    updatedAt: doc.updatedAt,
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
  env: AuthEnv,
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
  const entry: StoredEntry = {
    id: randomToken(9),
    uid: identity.uid,
    name: identity.name,
    distance,
    shapeScore: Math.round(play.shapeScore * 10) / 10,
    rot: Math.round(play.rot * 10) / 10,
    mom: Math.round(play.mom * 10) / 10,
    ts: now,
  };

  // 全期間の自己ベスト
  const previousBest = Number((await env.DOPA_KV.get(`pb:${identity.uid}`)) ?? "0");
  const isNewPersonalBest = distance > previousBest;
  if (isNewPersonalBest) {
    await env.DOPA_KV.put(`pb:${identity.uid}`, String(distance));
  }

  // 各期間のランキングへ反映（1 人 1 行・ベストのみ）
  let rank = -1;
  const ranges: ScoreRange[] = ["all", "today", "week"];
  for (const range of ranges) {
    const doc = await readDoc(env, range);
    const existing = doc.entries.find((e) => e.uid === identity.uid);
    const myBest = (await env.DOPA_KV.get(ubKey(range, identity.uid), "json")) as StoredEntry | null;

    doc.plays += 1;
    // 同じ人が更新した場合は、その期間のベストだけを残す
    if (myBest && distance <= myBest.distance) {
      // ベスト更新なし → プレイ数だけ加算
      if (range !== "all" || existing) {
        doc.updatedAt = now;
        await env.DOPA_KV.put(lbKey(range), JSON.stringify(doc));
      }
      if (range === "all") {
        rank = doc.entries.findIndex((e) => e.uid === identity.uid) + 1;
        if (rank === 0) rank = -1;
      }
      continue;
    }

    // 同じ人は 1 行だけ。エントリ ID は初回のものを引き継ぐ。
    const stored: StoredEntry = existing ? { ...entry, id: existing.id } : entry;
    if (existing) Object.assign(existing, stored);
    else doc.entries.push(stored);

    doc.entries = sortEntries(doc.entries).slice(0, MAX_ENTRIES);
    doc.updatedAt = now;
    await env.DOPA_KV.put(lbKey(range), JSON.stringify(doc));
    await env.DOPA_KV.put(ubKey(range, identity.uid), JSON.stringify(stored), {
      expirationTtl: range === "all" ? undefined : 60 * 60 * 24 * 60,
    });

    if (range === "all") {
      const idx = doc.entries.findIndex((e) => e.uid === identity.uid);
      rank = idx >= 0 ? idx + 1 : -1;
    }
  }

  const payload: SubmitResponse = {
    entry: publicEntry(entry),
    rank,
    personalBest: Math.max(previousBest, distance),
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
