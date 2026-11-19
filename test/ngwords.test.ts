/**
 * 名前のNGワードフィルタと名前バリデーションのテスト。
 *
 *   npm test
 *
 * Node の組込みテストランナー（node:test）で動かす。
 * TypeScript のままでは Node が読めないので、scripts/test.mjs が esbuild で
 * まとめてから実行する。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { findNgWord, hasNgWord } from "../src/shared/ngwords";
import { NAME_MAX, validateName, validateNameDetailed } from "../src/shared/types";

/** 不適切なので弾きたい名前（表記ゆれを含む） */
const BLOCKED = [
  // 下ネタ・性的表現
  "ちんこ",
  "チンコ",
  "ちんこまん",
  "ち ん こ",
  "ちーんこ",
  "ちんんこ",
  "まんこ",
  "せっくす",
  "うんこ",
  "ウンコ",
  "くそ",
  "くそおおお",
  "おっぱい",
  // 差別語
  "きちがい",
  "キチガイ",
  "しなじん",
  // 侮蔑語
  "しね",
  "ころす",
  "うざい",
  "ばかやろう",
  "まぬけ",
  // 英字（大文字・全角・leet・区切り）
  "fuck",
  "FUCK",
  "ｆｕｃｋ",
  "f.u.c.k",
  "f u c k",
  "a55",
  "b1tch",
  "bitch",
  "nigger",
  "ＮＩＧＧＥＲ",
  "hentai",
  "fuckyou",
  "fuck you",
  "killyourself",
  "死ね",
  "殺す",
  "変態",
  "馬鹿",
  "fuck123",
  "b1tch.",
  // 本番ランキングに実際に登録されていた不適切な名前（2026-11-19 確認）
  "黒人niggerboy",
  "n1ggerboy",
  "アナルファッカー",
  "アナル",
  "ファック",
  "fuckboy",
  "しこドラ",
  "しこしこ",
  "インポねぎし",
];

/** ふつうの名前。誤検知してはいけない。 */
const ALLOWED = [
  "たつどら",
  "たつどら4",
  "さくら",
  "ハルト",
  "ゆうき",
  "かすみ",
  "あんこ",
  "うんどう",
  "くすり",
  "まんが",
  "さんかく",
  "しんご",
  "ほしねこ", // 真ん中に「しね」を含むが、語として区切られていない
  "はげまし", // 「はげ」を先頭に含むが、長い語の中なので誤検知しない
  "くずは", // 葛葉。「くず」は単独のときだけNG
  "ちびっこ", // 「ちび」を含むが普通の語
  "ばくだん",
  "うんめい",
  "Kaito",
  "Haruto",
  "Cassandra", // 中に "ass" を含む
  "class",
  "classic",
  "Scunthorpe",
  "Disc Master",
  "disc_lover",
  "Player 1",
  // 本番ランキングに実際に登録されていた普通の名前（2026-11-19 確認）
  "たちどら",
  "たつどらごん",
  "いくどら",
  "花丘",
  "外島",
  "ねぎ坊主",
  "けいたん",
  "よしこ", // 「しこ」を含むが語頭ではない
  "ほしこ",
  "たつどらさん",
];

test("不適切な名前はNGと判定される", () => {
  for (const name of BLOCKED) {
    assert.ok(hasNgWord(name), `NG と判定されるべき: ${JSON.stringify(name)}`);
  }
});

test("ふつうの名前はNGと判定されない", () => {
  for (const name of ALLOWED) {
    assert.equal(
      findNgWord(name),
      null,
      `誤検知してはいけない: ${JSON.stringify(name)}`,
    );
  }
});

test("NGワードは種類（category）つきで返る", () => {
  assert.equal(findNgWord("ちんこ")?.category, "sexual");
  assert.equal(findNgWord("くそ")?.category, "profanity");
  assert.equal(findNgWord("きちがい")?.category, "discrimination");
  assert.equal(findNgWord("しね")?.category, "insult");
});

test("空文字・記号だけはNGではない", () => {
  for (const name of ["", "   ", "!!!", "☆☆☆"]) {
    assert.equal(findNgWord(name), null, `NG ではない: ${JSON.stringify(name)}`);
  }
});

test("validateNameDetailed が理由コードを返す", () => {
  assert.deepEqual(validateNameDetailed("あ"), { code: "name.short", message: "名前は2文字以上にしてください" });
  assert.equal(validateNameDetailed("あ".repeat(NAME_MAX + 1))?.code, "name.long");
  assert.equal(validateNameDetailed("ok\u0001name")?.code, "name.chars");
  assert.equal(validateNameDetailed("ちんこ")?.code, "name.ng");
  assert.equal(validateNameDetailed("fuck you")?.code, "name.ng");
  assert.equal(validateNameDetailed("たつどら"), null);
});

test("validateName は NGワードをユーザー向けメッセージで弾く", () => {
  const message = validateName("ちんこ");
  assert.equal(typeof message, "string");
  assert.ok(message && message.includes("使えません"));
  assert.equal(validateName("たつどら"), null);
});
