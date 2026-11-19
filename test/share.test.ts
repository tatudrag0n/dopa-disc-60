/**
 * 結果シェア（シェア文面・X intent URL）のテスト。
 *
 * - 日英それぞれで、飛距離・ランク・3要素・ハッシュタグ・URL が入ること
 * - 自己ベスト更新の有無で先頭行が変わること
 * - X の本文上限（280）に収まること
 * - intent URL が正しく URL エンコードされ、復元できること
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SITE_URL, buildShareText, buildXIntentUrl, type ShareResultInput } from "../src/lib/shareResult";

const base: ShareResultInput = {
  distance: 890.5,
  rank: "A",
  shapeGrade: "A",
  spin: 1234,
  accelLabel: "はやい",
};

test("日本語のシェア文面に記録・内訳・ハッシュタグ・URLが全て入る", () => {
  const text = buildShareText(base, "ja");
  assert.ok(text.includes("飛距離 890.5m"), text);
  assert.ok(text.includes("ランク A"), text);
  assert.ok(text.includes("形状 A"));
  assert.ok(text.includes("回転 1,234"));
  assert.ok(text.includes("加速度 はやい"));
  assert.ok(text.includes("#フライングディスク"));
  assert.ok(text.includes(SITE_URL));
  assert.equal(text.includes("自己ベスト更新"), false, "更新していない日は先頭行を出さない");
});

test("自己ベスト更新時は日本語・英語とも先頭にバッジ文が出る", () => {
  const ja = buildShareText({ ...base, isRecord: true }, "ja");
  assert.ok(ja.startsWith("自己ベスト更新！"), ja);
  assert.equal(ja.split("\n")[0], "自己ベスト更新！");

  const en = buildShareText({ ...base, isRecord: true }, "en");
  assert.ok(en.startsWith("New personal best!"), en);
});

test("英語のシェア文面は英語表記でまとまる", () => {
  const text = buildShareText({ ...base, accelLabel: "Fast" }, "en");
  assert.ok(text.includes("890.5m (Rank A)"), text);
  assert.ok(text.includes("Shape A"));
  assert.ok(text.includes("Spin 1,234"));
  assert.ok(text.includes("Accel Fast"));
  assert.ok(text.includes("#FlyingDisc"));
  assert.ok(text.includes(SITE_URL));
  assert.equal(text.includes("自己ベスト"), false);
  assert.equal(text.includes("#フライングディスク"), false);
});

test("小数1桁・整数の回転がそのまま本文に反映される", () => {
  const text = buildShareText({ ...base, distance: 1083, spin: 11250 }, "ja");
  assert.ok(text.includes("飛距離 1083.0m"), text);
  assert.ok(text.includes("回転 11,250"), text);
});

test("シェア文面は X の本文上限（280）に収まる", () => {
  for (const lang of ["ja", "en"] as const) {
    for (const isRecord of [false, true]) {
      const text = buildShareText({ ...base, isRecord, distance: 1083 }, lang);
      assert.ok(text.length <= 280, `${lang} isRecord=${isRecord}: ${text.length}文字`);
    }
  }
});

test("intent URL は本文を URL エンコードして復元できる", () => {
  const text = buildShareText({ ...base, isRecord: true }, "ja");
  const url = buildXIntentUrl(text);
  assert.ok(url.startsWith("https://x.com/intent/tweet?text="), url);
  assert.equal(url.includes("\n"), false, "生の改行をそのまま入れない");
  assert.ok(url.includes("%0A"), "改行は %0A になる");

  const encoded = url.slice("https://x.com/intent/tweet?text=".length);
  assert.equal(decodeURIComponent(encoded), text);
  assert.equal(encoded.includes("#"), false, "# はフラグメント扱いになるので必ずエンコードする");
  assert.equal(encoded.includes("&"), false);
  assert.equal(encoded.includes(" "), false);
});
