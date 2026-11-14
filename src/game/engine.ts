/**
 * フライングディスクのゲームロジック（描画に依存しない純粋関数）。
 *
 * 旧作 (dopa_disc_60/index.html) のスコア計算を保ちつつ、
 * 形の「閉じ具合」と「大きさ」も評価に入れて、ぐちゃぐちゃの
 * 落書きが高得点にならないようにしている。
 */

import { clamp, computeDistance, DIST_MAX, ROT_MAX } from "../shared/types";

export interface Pt {
  x: number;
  y: number;
}

export interface ShapeAnalysis {
  /** 重心 */
  cx: number;
  cy: number;
  /** 平均半径 */
  avg: number;
  /** 円らしさ 0..1 */
  clean: number;
  /** 始点と終点の近さ 0..1 */
  closure: number;
  /** 大きさの妥当さ 0..1 */
  size: number;
  /** 総合スコア 0..100 */
  score: number;
  pts: Pt[];
}

/** 形を評価する。点が少なすぎる場合は null。 */
export function analyzeShape(pts: Pt[]): ShapeAnalysis | null {
  if (pts.length < 16) return null;

  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;

  let sumR = 0;
  for (const p of pts) sumR += Math.hypot(p.x - cx, p.y - cy);
  const avg = sumR / pts.length;
  if (avg < 12) return null;

  let variance = 0;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy) - avg;
    variance += d * d;
  }
  const std = Math.sqrt(variance / pts.length);
  const clean = clamp(1 - std / (avg || 1), 0, 1);

  const first = pts[0];
  const last = pts[pts.length - 1];
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const closure = clamp(1 - gap / (avg * 2), 0, 1);

  // 半径 45px 以上で満点、20px 未満は大きく減点
  const size = clamp((avg - 20) / 45, 0, 1);

  const score = Math.round(clean * (0.5 + 0.5 * closure) * (0.55 + 0.45 * size) * 100);

  return { cx, cy, avg, clean, closure, size, score: clamp(score, 0, 100), pts };
}

export interface SpinState {
  /** 回転スコア 0..ROT_MAX */
  rot: number;
  /** 勢い 0..100 */
  mom: number;
  /** 円盤の見た目の角度 */
  spinAngle: number;
}

export const INITIAL_SPIN: SpinState = { rot: 0, mom: 0, spinAngle: 0 };

/**
 * 回転操作 1 フレーム分の更新。
 * @param da   前回からの角度変化 (rad)
 * @param dtMs 前回からの経過時間 (ms)
 */
export function stepSpin(
  state: SpinState,
  da: number,
  dtMs: number,
  clean: number,
): SpinState {
  const dt = clamp(dtMs, 4, 120);
  const angularVel = Math.abs(da) / dt; // rad/ms

  // 回転スコアは「続けて回した分」だけ伸びる。
  // 1回転あたり約 45 点なので、最高値 250 には 5〜6 回転が必要。
  const gain = 0.55 + clamp(clean, 0, 1) * 1.15;
  const rot = clamp(state.rot + Math.abs(da) * gain * 4.2, 0, ROT_MAX);

  // 勢いは短時間で乗るが、離すと減る
  const mom = clamp(state.mom + Math.abs(da) * 10 + angularVel * 45, 0, 100);

  return {
    rot,
    mom,
    spinAngle: state.spinAngle + da,
  };
}

/** 回転が止まったときの自然減衰 */
export function decaySpin(state: SpinState, dtMs: number): SpinState {
  const rate = clamp(dtMs, 0, 500) / 100;
  return {
    ...state,
    mom: clamp(state.mom - rate * 0.9, 0, 100),
  };
}

export interface PlayResult {
  shapeScore: number;
  rot: number;
  mom: number;
  distance: number;
}

/** 飛距離を確定する（サーバーの computeDistance と同一ロジック） */
export function resolvePlay(shapeScore: number, spin: SpinState): PlayResult {
  const rot = Math.round(clamp(spin.rot, 0, ROT_MAX) * 10) / 10;
  const mom = Math.round(clamp(spin.mom, 0, 100) * 10) / 10;
  const distance = computeDistance({ shapeScore, rot, mom });
  return { shapeScore, rot, mom, distance };
}

/** 角度を -π..π に正規化する */
export function normalizeAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** 形の良さに応じた評価コメント */
export function shapeComment(score: number): string {
  if (score >= 92) return "完璧な円！";
  if (score >= 80) return "かなりきれい";
  if (score >= 65) return "いい感じ";
  if (score >= 45) return "もう少し円く";
  if (score >= 25) return "ゆがみ気味";
  return "ぐにゃぐにゃ";
}

/** 飛距離の評価コメント */
export function distanceComment(distance: number): string {
  const ratio = distance / DIST_MAX;
  if (ratio >= 0.95) return "人類級のビッグスロー！";
  if (ratio >= 0.8) return "とんでもない飛距離";
  if (ratio >= 0.6) return "ナイススロー！";
  if (ratio >= 0.4) return "いい飛び";
  if (ratio >= 0.2) return "もう少し勢いを";
  return "くるっと回して勢いを";
}

/**
 * 一番伸びしろの大きい要素を指摘する。
 * 「形 × 回転 × 勢い」のどこが足りないかが分かると、次のプレイが変わる。
 */
export function improvementHint(play: {
  shapeScore: number;
  rot: number;
  mom: number;
}): string {
  const shapeN = clamp(play.shapeScore / 100, 0, 1);
  const rotN = clamp(play.rot / ROT_MAX, 0, 1);
  const momN = clamp(play.mom / 100, 0, 1);
  const weakest = Math.min(shapeN, rotN, momN);

  if (weakest >= 0.9) return "三拍子そろってる。あとは再現あるのみ";
  if (weakest === shapeN) {
    return shapeN >= 0.75
      ? "形はあと少し。円をきれいに閉じると伸びる"
      : "形がネック。もっと円に近い1筆を意識しよう";
  }
  if (weakest === rotN) {
    return rotN >= 0.55
      ? "回転をあと少し。もう1〜2回転させると伸びる"
      : "回転が足りない。円盤のまわりを長く回そう";
  }
  return momN >= 0.7
    ? "勢いが少し落ちた。回し終えたらすぐ飛ばそう"
    : "勢いが足りない。素早く回して上へスワイプ";
}
