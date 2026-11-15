/**
 * フライングディスクのゲームロジック（描画に依存しない純粋関数）。
 *
 * 旧作 (dopa_disc_60/index.html) のスコア計算を保ちつつ、
 * 形の「閉じ具合」と「大きさ」も評価に入れて、ぐちゃぐちゃの
 * 落書きが高得点にならないようにしている。
 */

import { clamp, computeDistance, ROT_MAX } from "../shared/types";

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
