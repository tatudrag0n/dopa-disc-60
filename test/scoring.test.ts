/**
 * スコア計算と 2 本指（マルチタッチ）対策のテスト。
 *
 * - 2 本目の指が混ざった点列でも、spin と飛距離が上限を超えないこと
 * - 上限値でも 1 位「たちどら 890.5m」は超えられる水準であること
 * - 操作中の指以外のイベントを無視する判定
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCORE_M,
  SPIN_MAX,
  SPIN_MAX_PX_PER_MS,
  computeRealtimeSpin,
  distanceFor,
  spinFromLap,
} from "../src/shared/scoring";
import { ownsPointer } from "../src/shared/pointer";

/** 円を 1 周なぞる、ふつうの指回転（半径 60px・約 1.2px/ms） */
function normalSpinPoints() {
  const radius = 60;
  const stepMs = 10;
  const angular = 12 / radius; // 1 ステップ 12px = 1.2px/ms
  return Array.from({ length: 48 }, (_, i) => {
    const a = i * angular;
    return { x: 200 + Math.cos(a) * radius, y: 300 + Math.sin(a) * radius, t: i * stepMs };
  });
}

/** 2 本の指が交互に触れたときの点列（200px 離れた 2 点を 8ms ごとに往復） */
function twoFingerPoints() {
  return Array.from({ length: 48 }, (_, i) => ({
    x: i % 2 === 0 ? 100 : 300,
    y: i % 2 === 0 ? 200 : 260,
    t: i * 8,
  }));
}

test("ふつうの指回転は上限に張り付かない", () => {
  const r = computeRealtimeSpin(normalSpinPoints());
  assert.ok(r);
  assert.ok(r!.speed > 0.5 && r!.speed < SPIN_MAX_PX_PER_MS, `speed=${r!.speed}`);
  assert.ok(Math.abs(r!.spin) < SPIN_MAX);
  assert.ok(distanceFor(100, Math.abs(r!.spin), 1) < MAX_SCORE_M);
});

test("2 本指で座標が飛んでも spin は上限 11,250 で頭打ち", () => {
  const r = computeRealtimeSpin(twoFingerPoints());
  assert.ok(r);
  assert.equal(r!.speed, SPIN_MAX_PX_PER_MS, "速度は 4.5px/ms で止まる");
  assert.ok(Math.abs(r!.spin) <= SPIN_MAX, `spin=${r!.spin}`);
  assert.ok(Math.abs(r!.spin) > 0, "回転として判定はされる");
});

test("上限いっぱいでも飛距離は約 1,083m で、1位 890.5m は超えられる", () => {
  const d = distanceFor(100, SPIN_MAX, 1);
  assert.equal(d, 1083);
  assert.ok(d > 890.5, "上位の記録は更新できる");
  assert.ok(d < MAX_SCORE_M, "2,000m 級の異常値は出ない");
});

test("spin は速度上限ときれいさで決まり、11,250 を超えない", () => {
  assert.equal(spinFromLap(1.2, 100), 3000);
  assert.equal(spinFromLap(SPIN_MAX_PX_PER_MS, 100), SPIN_MAX);
  assert.equal(spinFromLap(100, 100), SPIN_MAX, "異常な速度も上限で止まる");
  assert.equal(spinFromLap(-3, 100), 0);
});

test("操作中の指以外のイベントは無視する", () => {
  assert.equal(ownsPointer(3, 3), true);
  assert.equal(ownsPointer(3, 4), false, "2 本目の指");
  assert.equal(ownsPointer(null, 3), false, "触れていない状態");
});

test("2 本目の指が触れても、1 本目の描画は途切れず座標も飛ばない", () => {
  let pts: { x: number; y: number }[] = [];
  let active = false;
  let owner: number | null = null;
  const down = (id: number, x: number, y: number) => {
    if (active) return; // onDown のガード
    active = true;
    owner = id;
    pts = [{ x, y }];
  };
  const move = (id: number, x: number, y: number) => {
    if (!active || !ownsPointer(owner, id)) return; // onMove のガード
    pts.push({ x, y });
  };
  const up = (id: number) => {
    if (!active || !ownsPointer(owner, id)) return; // onUp のガード
    active = false;
    owner = null;
  };

  down(1, 100, 100);
  move(1, 110, 100);
  down(2, 500, 500); // 2 本目
  move(2, 520, 520); // 2 本目が動いても混ざらない
  move(1, 120, 100);
  up(2); // 2 本目の離しで描画を終わらせない
  assert.equal(active, true);
  assert.deepEqual(pts, [
    { x: 100, y: 100 },
    { x: 110, y: 100 },
    { x: 120, y: 100 },
  ]);
  up(1);
  assert.equal(active, false);
});
