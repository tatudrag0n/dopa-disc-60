/**
 * `records.create` の不正スコア対策のテスト。
 *
 * - 1,500m を超える値は 400 で拒否する
 * - telemetry（balance / spin / swipeNorm）があれば、同じ計算式で組み直して照合する
 * - telemetry の無い旧クライアントは従来どおり通す（後方互換）
 * - 異常値が入った既存行は、まともな記録で上書きできる
 */

import test from "node:test";
import assert from "node:assert/strict";
import { handleActions } from "../worker/actions";
import { distanceFor } from "../src/shared/scoring";

const TOKEN = "test-session-token";
const SESSION = { uid: "p_test123456789", name: "たちどら", exp: Date.now() + 86_400_000 };

interface StoredRow {
  uid: string;
  name: string;
  best: number;
  total: number;
  grade: string;
  created_at: number;
}

interface Query {
  sql: string;
  args: unknown[];
}

/** 本番で使う SQL だけを再現した D1 の代用 */
function fakeDb(rows: StoredRow[], queries: Query[]) {
  const make = (sql: string, args: unknown[]) => ({
    bind(...next: unknown[]) {
      return make(sql, next);
    },
    async all<T>() {
      queries.push({ sql, args });
      return { results: [] as T[] };
    },
    async first<T>() {
      queries.push({ sql, args });
      if (sql.includes("FROM sessions WHERE token")) {
        return (args[0] === TOKEN ? SESSION : null) as T | null;
      }
      if (sql.includes("FROM runs WHERE uid = ?")) {
        return (rows.find((row) => row.uid === args[0]) ?? null) as T | null;
      }
      if (sql.includes("COUNT(*)")) {
        const threshold = Number(args[0]);
        return { c: rows.filter((row) => row.total > threshold).length } as T;
      }
      return null as T | null;
    },
    async run() {
      queries.push({ sql, args });
      return { success: true };
    },
  });
  return {
    prepare(sql: string) {
      return make(sql, []);
    },
  };
}

async function create(value: Record<string, unknown>, rows: StoredRow[] = []) {
  const queries: Query[] = [];
  const env = { DB: fakeDb(rows, queries) };
  const req = new Request("https://discgame.example.com/actions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `dopa_sess=${TOKEN}` },
  });
  const res = await handleActions(env as never, req, {
    action: "records.create",
    args: { collection: "flying_disc_distance_scores", value, play_ticket: "" },
  });
  const body = (await res.json()) as { data?: { ok?: boolean }; error?: string };
  return { status: res.status, body, queries };
}

/** 1位「たちどら 890.5m」相当の、計算式と合った記録 */
const LEGIT = (() => {
  const balance = 80;
  const spin = 10_878;
  const swipeNorm = 1;
  return { balance, spin, swipeNorm, distance: distanceFor(balance, spin, swipeNorm) };
})();

test("telemetry と計算式が一致する記録（約 890.5m）は保存できる", async () => {
  assert.ok(LEGIT.distance > 880 && LEGIT.distance < 900, `distance=${LEGIT.distance}`);
  const { status, body } = await create({
    best: LEGIT.distance,
    total: LEGIT.distance,
    rank: "S",
    telemetry: { balance: LEGIT.balance, spin: LEGIT.spin, swipeNorm: LEGIT.swipeNorm },
  });
  assert.equal(status, 200);
  assert.equal(body.data?.ok, true);
});

test("1,500m を超えるスコアは 400 で拒否する", async () => {
  const big = await create({ best: 5618.3, total: 5618.3, rank: "S" });
  assert.equal(big.status, 400);
  assert.match(big.body.error ?? "", /範囲外/);

  const justOver = await create({ best: 1500.1, total: 1500.1, rank: "S" });
  assert.equal(justOver.status, 400);

  const totalOnly = await create({ best: 1200, total: 4000, rank: "S" });
  assert.equal(totalOnly.status, 400);
});

test("telemetry と計算式が大きく食い違う記録は拒否する", async () => {
  // 形 40%・spin 1000・加速 0.3 なら約 26m しか出ないのに 1,200m を主張
  const { status, body } = await create({
    best: 1200,
    total: 1200,
    rank: "S",
    telemetry: { balance: 40, spin: 1000, swipeNorm: 0.3 },
  });
  assert.equal(status, 400);
  assert.match(body.error ?? "", /一致しません/);
});

test("上限内でも計算式より高い値は拒否する", async () => {
  // 全パラメータ最大でも約 1,083m。1,400m は通らない
  const { status } = await create({
    best: 1400,
    total: 1400,
    rank: "S",
    telemetry: { balance: 100, spin: 11250, swipeNorm: 1 },
  });
  assert.equal(status, 400);
});

test("telemetry の各値が上限を超えていたら拒否する", async () => {
  const spinOver = await create({
    best: 1000,
    total: 1000,
    rank: "S",
    telemetry: { balance: 100, spin: 999_999, swipeNorm: 1 },
  });
  assert.equal(spinOver.status, 400);

  const swipeOver = await create({
    best: 1000,
    total: 1000,
    rank: "S",
    telemetry: { balance: 100, spin: 5000, swipeNorm: 8 },
  });
  assert.equal(swipeOver.status, 400);

  const balanceOver = await create({
    best: 1000,
    total: 1000,
    rank: "S",
    telemetry: { balance: 400, spin: 5000, swipeNorm: 1 },
  });
  assert.equal(balanceOver.status, 400);
});

test("telemetry の無い旧クライアントは従来どおり保存できる", async () => {
  const { status, body } = await create({ best: 455.2, total: 455.2, rank: "B" });
  assert.equal(status, 200);
  assert.equal(body.data?.ok, true);
});

test("異常値が残った既存行も、まともな記録で上書きできる", async () => {
  const rows: StoredRow[] = [
    { uid: SESSION.uid, name: SESSION.name, best: 5618.3, total: 5618.3, grade: "S", created_at: 1 },
  ];
  const { status, queries } = await create(
    {
      best: LEGIT.distance,
      total: LEGIT.distance,
      rank: "S",
      telemetry: { balance: LEGIT.balance, spin: LEGIT.spin, swipeNorm: LEGIT.swipeNorm },
    },
    rows,
  );
  assert.equal(status, 200);
  const insert = queries.find((query) => query.sql.includes("INSERT INTO runs"));
  assert.ok(insert);
  assert.match(insert!.sql, /runs\.total > \?/);
  assert.equal(insert!.args[insert!.args.length - 1], 1500);
});
