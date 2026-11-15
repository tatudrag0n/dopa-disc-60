-- ゲーム本体（GameApp）のスコア保存先。
-- 1 ユーザー 1 行で、自己ベスト（total）が更新されたときだけ書き換える。
-- total / best のスケールはゲーム側の採点に合わせている。

CREATE TABLE IF NOT EXISTS runs (
  uid        TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  best       REAL NOT NULL,
  total      REAL NOT NULL,
  grade      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_total ON runs (total DESC);
