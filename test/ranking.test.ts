/**
 * `records.list` のランキング除外のテスト。
 *
 * フィルタ導入前に保存された不適切な名前が DB に残っていても、
 * ランキングには出さないことを確認する（D1 は最小限のスタブで代用）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { handleActions } from "../worker/actions";

interface Row {
  uid: string;
  name: string;
  best: number;
  total: number;
  grade: string;
  created_at: number;
}

/** total 降順・同時刻なら古い順、という本番の並びをそのまま再現する */
function makeRows(entries: { name: string; total: number }[]): Row[] {
  return entries
    .map((entry, index) => ({
      uid: `p_${index}`,
      name: entry.name,
      best: entry.total,
      total: entry.total,
      grade: "B",
      created_at: 1_700_000_000_000 + index * 1000,
    }))
    .sort((a, b) => b.total - a.total || a.created_at - b.created_at);
}

/** prepare().bind().all() / .first() だけを実装した D1 の代用 */
function fakeDb(rows: Row[], queries: { sql: string; args: unknown[] }[]) {
  return {
    prepare(sql: string) {
      const statement = {
        bind(...args: unknown[]) {
          return {
            async all<T>() {
              queries.push({ sql, args });
              if (!sql.includes("FROM runs ORDER BY total")) return { results: [] as T[] };
              const limit = Math.max(0, Number(args[0] ?? rows.length));
              return { results: rows.slice(0, limit) as T[] };
            },
            async first<T>() {
              queries.push({ sql, args });
              return (rows.find((row) => row.uid === args[0]) ?? null) as T | null;
            },
            async run() {
              return { success: true };
            },
          };
        },
        async all<T>() {
          return { results: rows as T[] };
        },
        async first<T>() {
          return null as T | null;
        },
        async run() {
          return { success: true };
        },
      };
      return statement;
    },
  };
}

async function listRanking(rows: Row[]) {
  const queries: { sql: string; args: unknown[] }[] = [];
  const env = { DB: fakeDb(rows, queries) };
  const req = new Request("https://discgame.example.com/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const res = await handleActions(env as never, req, { action: "records.list" });
  const body = (await res.json()) as {
    data: { records: { value: { name: string; total: number } }[]; myRecord: unknown };
  };
  return { names: body.data.records.map((record) => record.value.name), queries };
}

test("不適切な名前はランキングから消え、残りは順位どおりに詰める", async () => {
  const rows = makeRows([
    { name: "インポねぎし", total: 2095.7 },
    { name: "たちどら", total: 890.5 },
    { name: "黒人niggerboy", total: 660.9 },
    { name: "花丘", total: 533.4 },
    { name: "しこドラ", total: 374 },
    { name: "ちんちん木村", total: 357.6 },
    { name: "外島", total: 347.7 },
    { name: "アナルファッカー", total: 278.3 },
    { name: "ねぎ坊主", total: 238.5 },
  ]);

  const { names } = await listRanking(rows);

  assert.deepEqual(names, ["たちどら", "花丘", "外島", "ねぎ坊主"]);
});

test("1,500m を超える既存スコアはランキングから外れる", async () => {
  const rows = makeRows([
    { name: "あなどら", total: 5618.3 },
    { name: "インポねぎし", total: 2095.7 },
    { name: "たちどら", total: 890.5 },
    { name: "花丘", total: 533.4 },
  ]);

  const { names } = await listRanking(rows);

  assert.deepEqual(names, ["たちどら", "花丘"]);
});

test("NG 名が多くても 20 件そろうまで候補を取る", async () => {
  const entries: { name: string; total: number }[] = [];
  // 上位 30 件のうち 15 件を NG 名にして、20 件の正常な行が残るようにする
  for (let i = 0; i < 30; i += 1) {
    entries.push({
      name: i % 2 === 0 ? `アナル${i}` : `player${i}`,
      total: 1000 - i,
    });
  }
  for (let i = 30; i < 45; i += 1) {
    entries.push({ name: `player${i}`, total: 1000 - i });
  }

  const { names } = await listRanking(makeRows(entries));

  assert.equal(names.length, 20);
  assert.ok(names.every((name) => !name.startsWith("アナル")), "NG 名は含まれない");
  assert.deepEqual(names.slice(0, 3), ["player1", "player3", "player5"]);
});

test("ランキングは 20 件を超えて返さない", async () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({
    name: `player${i}`,
    total: 500 - i,
  }));

  const { names } = await listRanking(makeRows(entries));

  assert.equal(names.length, 20);
});

test("候補の取得件数は表示件数より多く、DB 側で絞っている", async () => {
  const rows = makeRows([{ name: "player1", total: 10 }]);
  const { queries } = await listRanking(rows);
  const listQuery = queries.find((query) => query.sql.includes("FROM runs ORDER BY total"));

  assert.ok(listQuery);
  assert.ok(Number(listQuery.args[0]) > 20, "TOP_LIMIT より多く取る");
});
