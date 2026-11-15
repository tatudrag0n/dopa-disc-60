# フライングディスク - ドパ仕様

1筆で描いた形がそのまま円盤になる。円盤を回して勢いをつけ、上へスワイプすると飛ぶ。
飛距離は **形 × 回転 × 勢い** で決まる。スマホも PC もそのまま遊べて、
スコアは Cloudflare 上のランキングに記録される。

- 本番: <https://discgame.mct-official.com>
- リポジトリ: <https://github.com/tatudrag0n/dopa-disc-60>

## できること

| 機能 | 内容 |
| --- | --- |
| スマホ / PC 対応 UI | Pointer Events で指・マウス・ペンを同一処理。`100dvh` + セーフエリア対応、モバイルは下部タブ、PC は上部ナビ |
| 日本語 / 英語 | ブラウザ言語を自動判定。ヘッダーの `EN` / `JA` で即時切り替え |
| ゲーム | 描く → 回す → 飛ばす の 3 ステップ。形の円らしさ・閉じ具合・大きさを評価 |
| ランキング | 歴代 / 今日 / 今週 の 3 区分。上位 200 件を Cloudflare D1 に保持 |
| ログイン不要 | パスワードもアカウントも無し。初回に**名前を決めるだけ**で端末に紐づく（30日） |
| ボット判定 | Cloudflare Turnstile。スコア投稿時のみ検証し、遊ぶこと自体は誰でも可能 |
| 不正対策 | 飛距離は**サーバー側で再計算**。クライアントの申告値は使わない |
| PWA | マニフェスト + アイコン。ホーム画面に追加可能 |
| テーマ | ライト / ダーク / OS 追従 |

## 構成

```
index.html               Vite エントリ
src/
  App.tsx                画面全体（ヒーロー / ランキング / 使い方）
  game/engine.ts         ゲームロジック（純粋関数・採点）
  game/DiscGame.tsx      Canvas 描画と操作
  components/            ランキング・結果画面・名前変更ダイアログ
  lib/i18n.tsx           日本語 / 英語の辞書と Provider
  lib/turnstile.ts       Turnstile ウィジェットのラッパー
  lib/usePlayer.ts       名前（セッション）と設定の取得
  shared/types.ts        クライアントとワーカー共通の型と定数
worker/
  index.ts               ルーター（/api/*）
  auth.ts                名前だけのセッション（Cookie + KV）
  turnstile.ts           ボット判定
  scores.ts              ランキングの読み書き（D1）とレート制限
  util.ts                Cookie・KV・日付ユーティリティ
migrations/
  0001_scores.sql        D1 スキーマ
```

- フロント: Vite + React 18 + TypeScript + Tailwind CSS 3
- バックエンド: Cloudflare Workers（Static Assets + D1 + KV + Turnstile）
  - ランキング = D1（同時投稿でも記録が消えない）
  - セッション / レート制限 = KV（TTL 任せで消えてよいデータ）

### なぜランキングが D1 なのか

最初は KV に 1 つの JSON ドキュメントとしてランキングを持たせていたが、
**read-modify-write の競合でスコアが消失した**（同時に 4 件投稿すると最後の 1 件しか残らない）。
D1 なら `INSERT` と `ON CONFLICT DO UPDATE` が原子的に効くため、同時投稿でも記録が落ちない。

### 認証をやめた理由

当初 Cloudflare Access（Zero Trust + ワンタイムPIN）で全体を保護していたが、
「遊ぶのにメール認証が要る」のは重すぎるため撤去した。
いまは **名前を決めるだけ**で投稿でき、人間かどうかは Turnstile で判定する。

## ローカル開発

```bash
npm install
npm run dev        # http://localhost:5173 （/api は wrangler dev にプロキシ）
npm run worker:dev # http://127.0.0.1:8787
```

`TURNSTILE_SECRET` が未設定ならボット判定はスキップされるので、ローカルではそのままでよい。

> Windows で `wrangler dev` が
> `CreateDirectory: アクセスが拒否されました; path = miniflare-email-store`
> で落ちる場合は、`--persist-to` で書き込み可能なディレクトリを指定する。
> それでも直らない環境では、本番デプロイ後に API を叩いて検証している。

型チェックとビルド:

```bash
npm run typecheck
npm run build
```

## デプロイ

```bash
npm run deploy     # build + wrangler deploy
```

初回のみ、KV と D1 を作成し `wrangler.jsonc` の ID を差し替える。

```bash
npx wrangler kv namespace create DOPA_KV
npx wrangler d1 create dopa-disc
npx wrangler d1 execute dopa-disc --remote --file migrations/0001_scores.sql
```

配信先は `wrangler.jsonc` の `routes`（現在 `discgame.mct-official.com`）。

## Cloudflare Turnstile（ボット判定）

| 項目 | 値 |
| --- | --- |
| ウィジェット名 | `dopa-disc-60` |
| モード | Managed |
| 対象ドメイン | `discgame.mct-official.com`, `localhost`, `127.0.0.1` |
| サイトキー | `wrangler.jsonc` の `vars.TURNSTILE_SITEKEY`（公開情報） |
| シークレット | `npx wrangler secret put TURNSTILE_SECRET` |

ウィジェットは `execution: "execute"` + `appearance: "interaction-only"` で読み込み、
スコア投稿の直前にだけトークンを作る。つまり**プレイ中は何も出ない**。
`TURNSTILE_SECRET` を消せばボット判定は無効になり、誰でも投稿できる。

> 検証を自動化するときは Cloudflare のテストキーが使える。
> サイトキー `1x00000000000000000000AA` / シークレット `1x0000000000000000000000000000000AA`
> は常に成功する。実キーのままだとヘッドレスブラウザは弾かれる。

## API

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/health` | 死活確認（Turnstile 有効/無効も返す） |
| GET | `/api/config` | Turnstile のサイトキー |
| GET | `/api/me` | 名前が決まっていれば `{ user: { name } }` |
| POST | `/api/me/name` | `{ name }` で表示名を変更 |
| POST | `/api/logout` | セッション破棄（名前を忘れる） |
| GET | `/api/leaderboard?range=all\|today\|week&limit=50` | ランキング取得 |
| POST | `/api/scores` | `{ shapeScore, rot, mom, name?, turnstileToken? }` を投稿 |

初回投稿時は `name` が必須で、成功すると `dopa_sess` Cookie が発行される。
2 回目以降は Cookie から名前が引き継がれる。

## ゲームバランス

`src/shared/types.ts` の定数がクライアントとワーカーで共有される。

```
accel    = clamp(mom / 60 + rot / 1200, 0.4, 2.2)
distance = clamp((shapeScore/100) * (rot/100) * accel * 42, 8, 180)
```

- `shapeScore` 0–100（円らしさ × 閉じ具合 × 大きさ）
- `rot` 0–250（1 回転あたり約 45 点。最大まで 5〜6 回転）
- `mom` 0–100（回す速さで上昇、止まると減衰）

サーバーは同じ式で距離を確定するため、通信内容を書き換えても記録は伸びません。
投稿は 1 分あたり 12 回までに制限しています。

## ハマりどころ（実際に踏んだもの）

- **Tailwind v3 は `bg-[var(--x)]/40` を生成せず黙って捨てる。** 半透明にしたい箇所は
  `color-mix` を使ったユーティリティ（`.line-soft` / `.bg-soft-yellow` など）で代替している。
- **wrangler の `compatibility_date` が未来日だと起動しない**（`future and unsupported`）。
- **wrangler 4.15x は `@cloudflare/workers-types@^5` を要求する**（v4 だと npm install が競合）。
- かつて Cloudflare Access を使っていた名残で、Access の JWKS は `key_ops` が空配列で返り、
  そのまま `crypto.subtle.importKey("jwk", ...)` に渡すと DataError になる。
  Access を再導入する場合は `kty` / `n` / `e` / `alg` だけを取り出して import すること。

## ライセンス

MIT
