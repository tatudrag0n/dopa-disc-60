-- KV の書き込み上限（無料枠 1,000 writes/日）で API が 500 になっていたため、
-- セッションとプレイ券の保存先を D1 に移す。
--
-- Worker 側でも初回アクセス時に CREATE TABLE IF NOT EXISTS を実行して
-- テーブルを保証しているので、本マイグレーション未適用でも動く。

-- 名前札（Cookie の dopa_sess と 1:1）
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  uid   TEXT NOT NULL,
  name  TEXT NOT NULL,
  exp   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions (exp);

-- プレイ前に発行する一発券（スコア投稿時に消費する）
CREATE TABLE IF NOT EXISTS play_tickets (
  ticket TEXT PRIMARY KEY,
  exp    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_play_tickets_exp ON play_tickets (exp);
