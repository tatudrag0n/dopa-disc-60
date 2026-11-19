/**
 * スコア計算の共通部分。
 *
 * クライアント（GameApp）と Worker（サーバー側の検証）が同じ式を使う。
 * クライアントから届いた飛距離を、同じ式で組み立て直して突き合わせるため、
 * ここに一本化している（DOM に依存しない純粋な計算だけを置く）。
 */

/**
 * 指の回転速度の上限（px/ms）。
 * 実機で指を回して到達できるのはおよそ 2〜3 px/ms。4.5 はかなり速い指でも
 * 届く範囲で、2 本指の座標飛びのような異常値はここで頭打ちになる。
 */
export const SPIN_MAX_PX_PER_MS = 4.5;

/** spin の上限（4.5 px/ms × きれいさ 100 × 2500 = 11,250） */
export const SPIN_MAX = 11_250;

/**
 * これ以上は物理的にあり得ない飛距離（m）。
 * spin 上限・形 S・加速最大でも約 1,083m なので、1,500m は十分な余裕を残しつつ
 * 2,000m 級の異常値を弾ける。
 */
export const MAX_SCORE_M = 1_500;

/** 速度を上限内に収める（NaN / 負値は 0） */
export function clampSpeed(speedPxPerMs: number): number {
  if (!Number.isFinite(speedPxPerMs) || speedPxPerMs <= 0) return 0;
  return Math.min(SPIN_MAX_PX_PER_MS, speedPxPerMs);
}

/** 回転速度と「絵のきれいさ」から spin を出す（上限つき） */
export function spinFromLap(speedPxPerMs: number, cleanliness: number): number {
  const clean = Number.isFinite(cleanliness) ? Math.max(0, Math.min(100, cleanliness)) : 0;
  return Math.min(SPIN_MAX, clampSpeed(speedPxPerMs) * (clean / 100) * 2500);
}

const wrapAngle = (a: number) => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};

/**
 * なぞった点の並びから回転（spin）を測る。
 * 2 本目の指が混ざると点が飛んで速度が異常になるため、速度は
 * SPIN_MAX_PX_PER_MS で頭打ちにしている。
 */
export function computeRealtimeSpin(
  pts: { x: number; y: number; t: number }[],
): { speed: number; cleanliness: number; spin: number; direction: number } | null {
  if (pts.length < 10) return null;
  const windowPts = pts.slice(Math.max(0, pts.length - 48));
  if (windowPts.length < 10) return null;
  let len = 0;
  for (let i = 1; i < windowPts.length; i++)
    len += Math.hypot(windowPts[i]!.x - windowPts[i - 1]!.x, windowPts[i]!.y - windowPts[i - 1]!.y);
  const durationMs = Math.max(1, windowPts[windowPts.length - 1]!.t - windowPts[0]!.t);
  if (durationMs < 30 || len < 20) return null;
  const speedPxPerMs = clampSpeed(len / durationMs);
  const cx = windowPts.reduce((s, p) => s + p.x, 0) / windowPts.length;
  const cy = windowPts.reduce((s, p) => s + p.y, 0) / windowPts.length;
  const radii = windowPts.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const meanR = radii.reduce((s, v) => s + v, 0) / radii.length;
  if (meanR < 12) return { speed: speedPxPerMs, cleanliness: 5, spin: 0, direction: 0 };
  const mean = meanR;
  const variance = radii.reduce((s, v) => s + (v - mean) * (v - mean), 0) / radii.length;
  const cv = mean > 0.05 ? Math.sqrt(variance) / mean : 1;
  let turning = 0;
  let prevAngle: number | null = null;
  for (let i = 1; i < windowPts.length; i++) {
    const a = Math.atan2(windowPts[i]!.y - windowPts[i - 1]!.y, windowPts[i]!.x - windowPts[i - 1]!.x);
    if (prevAngle !== null) turning += Math.abs(wrapAngle(a - prevAngle));
    prevAngle = a;
  }
  // Signed rotation around the circle's centre, in screen coordinates
  // (y points down, so a positive sum is clockwise on screen). This is
  // the disc's own spin direction: clockwise drawing -> clockwise spin.
  let signedTurn = 0;
  let prevCentreAngle: number | null = null;
  for (const p of windowPts) {
    const a = Math.atan2(p.y - cy, p.x - cx);
    if (prevCentreAngle !== null) signedTurn += wrapAngle(a - prevCentreAngle);
    prevCentreAngle = a;
  }
  const direction = signedTurn >= 0 ? 1 : -1;
  // If the finger keeps reversing, the signed turn cancels out — that is
  // not a clean spin, so it lowers cleanliness instead of counting as speed.
  const directionConsistency = turning > 0.01 ? Math.abs(signedTurn) / turning : 0;
  const expectedTurning = len / Math.max(1, meanR);
  const turnRatio = Math.max(0, Math.min(1, turning / Math.max(0.01, expectedTurning)));
  const cleanliness = Math.round(
    Math.max(5, Math.min(100, 100 - cv * 220 - (1 - turnRatio) * 55 - (1 - directionConsistency) * 40)),
  );
  const spin = spinFromLap(speedPxPerMs, cleanliness) * direction;
  return { speed: speedPxPerMs, cleanliness, spin, direction };
}

/** 形・spin・加速から飛距離を求める（クライアント表示とサーバー検証で共通） */
export function distanceFor(shapeBalance: number, spin: number, swipeNorm: number): number {
  const balance = Number.isFinite(shapeBalance) ? Math.max(0, Math.min(100, shapeBalance)) : 0;
  const spinMagnitude = Number.isFinite(spin) ? Math.max(0, spin) : 0;
  const swipe = Number.isFinite(swipeNorm) ? Math.max(0, Math.min(1, swipeNorm)) : 0;
  const shapeF = 0.25 + 0.75 * (balance / 100);
  const spinF = 0.15 + spinMagnitude / 1000;
  const accelF = 0.2 + 0.8 * swipe;
  return Math.round(95 * shapeF * spinF * accelF * 10) / 10;
}
