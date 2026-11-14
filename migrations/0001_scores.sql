-- ランキング用スキーマ
--   bests : ユーザーごとの全期間ベスト（1ユーザー1行）
--   plays : 直近のプレイ履歴（今日/今週の集計用。古いものは間引く）
--
-- KV の read-modify-write は同時投稿で記録が消えるため D1 に移行した。

CREATE TABLE IF NOT EXISTS bests (
  uid         TEXT PRIMARY KEY,
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  distance    REAL NOT NULL,
  shape_score REAL NOT NULL,
  rot         REAL NOT NULL,
  mom         REAL NOT NULL,
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bests_distance ON bests (distance DESC);

CREATE TABLE IF NOT EXISTS plays (
  id          TEXT PRIMARY KEY,
  uid         TEXT NOT NULL,
  name        TEXT NOT NULL,
  distance    REAL NOT NULL,
  shape_score REAL NOT NULL,
  rot         REAL NOT NULL,
  mom         REAL NOT NULL,
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plays_ts_distance ON plays (ts, distance DESC);
CREATE INDEX IF NOT EXISTS idx_plays_uid ON plays (uid, ts);
