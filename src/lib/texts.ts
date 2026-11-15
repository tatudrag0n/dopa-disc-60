/**
 * スコアに応じた文言の「キー」を返す。実際の文字列は i18n 側で解決する。
 */

import { DIST_MAX, ROT_MAX, clamp } from "../shared/types";
import type { MessageKey } from "./i18n";

/** 形の評価コメント */
export function shapeCommentKey(score: number): MessageKey {
  if (score >= 92) return "comment.shape.perfect";
  if (score >= 80) return "comment.shape.great";
  if (score >= 65) return "comment.shape.good";
  if (score >= 45) return "comment.shape.ok";
  if (score >= 25) return "comment.shape.poor";
  return "comment.shape.bad";
}

/** 飛距離の評価コメント */
export function distanceCommentKey(distance: number): MessageKey {
  const ratio = distance / DIST_MAX;
  if (ratio >= 0.95) return "comment.dist.big";
  if (ratio >= 0.8) return "comment.dist.huge";
  if (ratio >= 0.6) return "comment.dist.nice";
  if (ratio >= 0.4) return "comment.dist.ok";
  if (ratio >= 0.2) return "comment.dist.low";
  return "comment.dist.veryLow";
}

/**
 * 一番伸びしろの大きい要素を指摘する。
 * 「形 × 回転 × 勢い」のどこが足りないかが分かると、次のプレイが変わる。
 */
export function improvementHintKey(play: {
  shapeScore: number;
  rot: number;
  mom: number;
}): MessageKey {
  const shapeN = clamp(play.shapeScore / 100, 0, 1);
  const rotN = clamp(play.rot / ROT_MAX, 0, 1);
  const momN = clamp(play.mom / 100, 0, 1);
  const weakest = Math.min(shapeN, rotN, momN);

  if (weakest >= 0.9) return "hint.allGood";
  if (weakest === shapeN) return shapeN >= 0.75 ? "hint.shapeClose" : "hint.shapeWeak";
  if (weakest === rotN) return rotN >= 0.55 ? "hint.rotClose" : "hint.rotWeak";
  return momN >= 0.7 ? "hint.momClose" : "hint.momWeak";
}
