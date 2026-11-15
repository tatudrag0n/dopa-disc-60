# フライングディスク - ドパ仕様

1筆で描いた形がそのまま円盤になる。円盤を回して勢いをつけ、上へスワイプすると飛ぶ。
飛距離は **形 × 回転 × 勢い** で決まる。スマホも PC もそのまま遊べて、
スコアは Cloudflare 上のランキングに記録される。

- 本番: <https://discgame.mct-official.com>
- リポジトリ: <https://github.com/tatudrag0n/dopa-disc-60>
- 旧版（静的 `index.html` のみ）は git 履歴に残っています

## できること

| 機能 | 内容 |
| --- | --- |
| スマホ / PC 対応 UI | Pointer Events で指・マウス・ペンを同一処理。`100dvh` + セーフエリア対応、モバイルは下部タブ、PC は上部ナビ |
| ゲーム | 描く → 回す → 飛ばす の 3 ステップ。形の円らしさ・閉じ具合・大きさを評価 |
| ランキング | 歴代 / 今日 / 今週 の 3 区分。上位 200 件を Cloudflare D1 に保持 |
| 認証 | Cloudflare Access（Zero Trust）連携 + 内蔵アカウント（メール不要） |
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
  components/            認証ダイアログ・ランキング・結果画面
  shared/types.ts        クライアントとワーカー共通の型と定数
  lib/                   API クライアント・認証フック・テーマ
worker/
  index.ts               ルーター（/api/*）
  auth.ts                登録・ログイン・セッション
  access.ts              Cloudflare Access の JWT 検証
  scores.ts              ランキングの読み書き（D1）とレート制限
  util.ts                Cookie・KV・日付ユーティリティ
migrations/
  0001_scores.sql        D1 スキーマ
```

- フロント: Vite + React 18 + TypeScript + Tailwind CSS 3
- バックエンド: Cloudflare Workers（Static Assets + D1 + KV）
  - ランキング = D1（同時投稿でも記録が消えない）
  - セッション / レート制限 = KV（TTL 任せで消えてよいデータ）

### なぜランキングが D1 なのか

最初は KV に 1 つの JSON ドキュメントとしてランキングを持たせていたが、
**read-modify-write の競合でスコアが消失した**（同時に 4 件投稿すると最後の 1 件しか残らない）。
D1 なら `INSERT` と `ON CONFLICT DO UPDATE` が原子的に効くため、
同時投稿でも記録が落ちない。

## ローカル開発

```bash
npm install
npm run dev        # http://localhost:5173 （/api は wrangler dev にプロキシ）
npm run worker:dev # http://127.0.0.1:8787
```

> Windows で `wrangler dev` が
> `CreateDirectory: アクセスが拒否されました; path = miniflare-email-store`
> で落ちる場合は、`--persist-to` で書き込み可能なディレクトリを指定してください。
>
> ```bash
> npx wrangler dev --persist-to C:\path\to\writable\dir
> ```

型チェックとビルド:

```bash
npm run typecheck
npm run build
```

## デプロイ

```bash
npm run deploy     # build + wrangler deploy
```

初回のみ、KV ネームスペースと D1 データベースを作成し、
`wrangler.jsonc` の `id` / `database_id` を差し替えます。

```bash
npx wrangler kv namespace create DOPA_KV
npx wrangler d1 create dopa-disc
npx wrangler d1 execute dopa-disc --remote --file migrations/0001_scores.sql
```

配信先は `wrangler.jsonc` の `routes` で指定します（現在は `discgame.mct-official.com`）。
Cloudflare 側に DNS レコードと証明書が自動で作られます。

CI からデプロイする場合は、リポジトリの Secrets に
`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録し、
Actions の `Deploy to Cloudflare` を手動実行してください。

## Cloudflare Access（Zero Trust）で認証する

**現在このサイトは Cloudflare Access で保護済み**（2026-11-15 設定）。

| 項目 | 値 |
| --- | --- |
| ホスト名 | `discgame.mct-official.com` |
| チームドメイン | `tatudragon0327.cloudflareaccess.com` |
| アプリ名 | `dopa-disc-60 (discgame)` |
| ポリシー | Allow / Include: Everyone（One-time PIN = メール認証） |
| セッション | 24 時間 |

未認証でアクセスすると `tatudragon0327.cloudflareaccess.com` のログイン画面へ 302 で飛び、
メールに届くワンタイムコードを入力すると入場できる。認証後は `Cf-Access-Jwt-Assertion`
が付与され、Worker が **JWKS で署名検証**して身元（メールアドレス）を採用する。

### 設定をやり直す / 別ドメインに付ける場合

```bash
# 1. Access アプリ作成（AUD が返る）
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"dopa-disc-60","domain":"discgame.mct-official.com","type":"self_hosted",
       "session_duration":"24h","allowed_idps":["<one-time PIN の IdP ID>"],
       "auto_redirect_to_identity":true}'

# 2. ポリシー（全員許可）
curl -X POST ".../access/apps/$APP_ID/policies" \
  -d '{"name":"Allow everyone","decision":"allow","precedence":1,
       "include":[{"everyone":{}}]}'

# 3. Worker に秘密を登録（設定すると Access 連携が有効になる）
npx wrangler secret put ACCESS_TEAM_DOMAIN   # tatudragon0327.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # 1 で返った aud
```

`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` が未設定なら Access 連携は自動的に無効になり、
内蔵アカウント認証（PBKDF2 + HttpOnly Cookie）にフォールバックする。
`GET /api/me` の `accessEnabled` で判定できる。

### ハマりどころ（実際に踏んだもの）

- **API トークンは Access の Edit 権限が必要。** Read だけだとアプリ作成が
  `403 auth.forbidden`（code 1010）になる。読み取り系だけ通るので気づきにくい。
- **Cloudflare の JWKS は `key_ops` が空配列で返る。** そのまま
  `crypto.subtle.importKey("jwk", ...)` に渡すと DataError になり、署名検証が必ず失敗する
  （`verified: false` になる）。`kty` / `n` / `e` / `alg` だけを取り出して import すること。
- **サービストークンでテストする場合**、ポリシーの `decision` は `allow` ではなく
  **`non_identity`** にする必要がある。`allow` だとログイン画面の HTML が 200 で返ってくる。
## API

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/health` | 死活確認 |
| GET | `/api/me` | ログイン中の身元と Access 有効/無効 |
| POST | `/api/auth/register` | `{ name, password }` で登録 |
| POST | `/api/auth/login` | `{ name, password }` でログイン |
| POST | `/api/auth/logout` | セッション破棄 |
| GET | `/api/leaderboard?range=all\|today\|week&limit=50` | ランキング取得 |
| POST | `/api/scores` | `{ shapeScore, rot, mom }` を投稿（要ログイン） |

## ゲームバランス

`src/shared/types.ts` の定数がクライアントとワーカーで共有されます。

```
accel    = clamp(mom / 60 + rot / 1200, 0.4, 2.2)
distance = clamp((shapeScore/100) * (rot/100) * accel * 42, 8, 180)
```

- `shapeScore` 0–100（円らしさ × 閉じ具合 × 大きさ）
- `rot` 0–250（1 回転あたり約 45 点。最大まで 5〜6 回転）
- `mom` 0–100（回す速さで上昇、止まると減衰）

サーバーは同じ式で距離を確定するため、通信内容を書き換えても記録は伸びません。
投稿は 1 分あたり 12 回までに制限しています。

## ライセンス

MIT