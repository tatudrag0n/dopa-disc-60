/**
 * クライアントとワーカーで共有する型・定数。
 * ここは DOM にも Workers にも依存しない純粋な TypeScript に保つ。
 */

/** ランキングの集計期間 */
export type ScoreRange = "all" | "today" | "week";

export const SCORE_RANGES: ScoreRange[] = ["all", "today", "week"];

export const RANGE_LABEL: Record<ScoreRange, string> = {
  all: "歴代",
  today: "今日",
  week: "今週",
};

/** 1 プレイ分の結果。クライアントが送ってくる生の値。 */
export interface RawPlay {
  /** 形のきれいさ 0..100 */
  shapeScore: number;
  /** 回転スコア 0..ROT_MAX */
  rot: number;
  /** 勢い 0..100 */
  mom: number;
}

/** サーバーが保存するランキング 1 件 */
export interface ScoreEntry {
  /** サーバー採番の一意 ID */
  id: string;
  /** 表示名 */
  name: string;
  /** 飛距離 (m) — サーバーが再計算した確定値 */
  distance: number;
  shapeScore: number;
  rot: number;
  mom: number;
  /** 登録時刻 (epoch ms) */
  ts: number;
}

export interface LeaderboardResponse {
  range: ScoreRange;
  entries: ScoreEntry[];
  /** ログインユーザーの自己ベスト（この期間） */
  me: { entry: ScoreEntry; rank: number } | null;
  /** 総プレイ数（参考値） */
  totalPlays: number;
  updatedAt: number;
}

export interface MeResponse {
  /** 名前を決めていれば入る（ログインではなく、端末に紐づく名札） */
  user: { name: string } | null;
}

export interface ConfigResponse {
  /** Turnstile のサイトキー。null ならボット判定は無効。 */
  turnstileSiteKey: string | null;
}

export interface SubmitResponse {
  entry: ScoreEntry;
  rank: number;
  personalBest: number;
  isNewPersonalBest: boolean;
}

export interface ApiError {
  error: string;
}

/* ------------------------------------------------------------------ *
 * ゲームバランス定数（クライアント・サーバー共通）
 * ここを変えると両方に効くので、飛距離の整合性が自動的に保たれる。
 * ------------------------------------------------------------------ */

/** 回転スコアの上限（サーバー側の妥当性チェックにも使う） */
export const ROT_MAX = 250;

/** 理論上の最大飛距離 */
export const DIST_MAX = 180;

/** 理論上の最小飛距離 */
export const DIST_MIN = 8;

/** 距離計算の係数 */
const DIST_FACTOR = 42;

/**
 * 飛距離 = 形 × 回転 × 加速度
 * サーバーはこの関数だけで距離を確定させるので、クライアントの
 * 申告値をそのまま信用しない。
 */
export function computeDistance(play: RawPlay): number {
  const shapeScore = clamp(play.shapeScore, 0, 100);
  const rot = clamp(play.rot, 0, ROT_MAX);
  const mom = clamp(play.mom, 0, 100);
  const accel = clamp(mom / 60 + rot / 1200, 0.4, 2.2);
  const raw = (shapeScore / 100) * (rot / 100) * accel * DIST_FACTOR;
  return Math.round(clamp(raw, DIST_MIN, DIST_MAX) * 10) / 10;
}

export function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

/** 名前の正規化ルール（クライアントのバリデーションと一致させる） */
export const NAME_MIN = 2;
export const NAME_MAX = 16;

export function validateName(name: string): string | null {
  const n = name.trim();
  if (n.length < NAME_MIN) return `名前は${NAME_MIN}文字以上にしてください`;
  if (n.length > NAME_MAX) return `名前は${NAME_MAX}文字以内にしてください`;
  if (!/^[\p{L}\p{N}_\-. 　]+$/u.test(n)) return "名前に使えない文字が含まれています";
  return null;
}
