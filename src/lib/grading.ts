/**
 * グレード（ランク）の定義をここに集約する。
 *
 * 以前は「飛距離そのもの」に絶対しきい値（80m で S など）を当てていたが、
 * 飛距離はスピンの効き方次第で 1000m を超えるため、ほぼ全部 S になっていた。
 * いまは「形状・回転・加速度の3要素をどれだけ揃えられたか」で総合ランクを出す。
 */

export type Grade = "S" | "A" | "B" | "C" | "D";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 回転スコアの基準値。これを超えたら満点扱い。 */
export const SPIN_REF = 15000;

/** 回転スコア → 0..1 */
export function normalizeSpin(spin: number): number {
  return clamp01(spin / SPIN_REF);
}

/** 形状の飛び効率 0..100 → グレード */
export function shapeGrade(efficiency: number): Grade {
  if (efficiency >= 82) return "S";
  if (efficiency >= 65) return "A";
  if (efficiency >= 48) return "B";
  return "C";
}

/** 3要素の重み（形状を最も重く見る） */
const W_SHAPE = 0.5;
const W_SPIN = 0.3;
const W_ACCEL = 0.2;

/** 総合ランク。0..1 に正規化した3要素から出す。 */
export function overallGrade(shapeN: number, spinN: number, accelN: number): Grade {
  const v =
    W_SHAPE * clamp01(shapeN) + W_SPIN * clamp01(spinN) + W_ACCEL * clamp01(accelN);
  if (v >= 0.9) return "S";
  if (v >= 0.78) return "A";
  if (v >= 0.62) return "B";
  if (v >= 0.42) return "C";
  return "D";
}
