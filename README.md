# フライングディスク

描いた形がそのままディスクになる。形状 × 回転 × 加速度で飛距離が決まるブラウザゲーム。
ゲーム本体は **`Dopa+Disc+60+Ok.tar.gz` の `App.tsx` をそのまま使用**しており、
このリポジトリは「配信」と「ランキング／ボット判定」だけを担当する。

- 本番: <https://discgame.mct-official.com>
- リポジトリ: <https://github.com/tatudrag0n/dopa-disc-60>

## 構成

```
index.html               Vite エントリ
src/
  App.tsx                名前入力ゲート（ゲームの前段）
  GameApp.tsx            ゲーム本体（オリジナル実装をほぼそのまま）
  index.css              ゲームの見た目（オリジナル）
  lib/session.ts         名前の登録・取得
  lib/turnstile.ts       Turnstile ウィジェット
  shared/types.ts        共通の型
worker/
  index.ts               ルーター（/api/*, /actions）
  actions.ts             ランキングの読み書き（D1）
  auth.ts                名前だけのセッション（Cookie + KV）
  turnstile.ts           ボット判定
  util.ts                Cookie・KV ユーティリティ
migrations/
  0002_runs.sql          ランキングのスキーマ
```

- フロント: Vite + React 18 + TypeScript + Tailwind CSS 3
- バックエンド: Cloudflare Workers（Static Assets + D1 + KV + Turnstile）

## ゲーム本体をどう載せているか

`src/GameApp.tsx` は元の `App.tsx` とほぼ同一。差分は 2 か所だけ:

1. `ScoreRow` に `name?: string` を追加
2. スコア TOP 5 の各行にプレイヤー名を表示

元の実装はスコア保存に `fetch('actions', { action, args })` を使っていたので、
**Worker 側でその契約を実装**している（`worker/actions.ts`）。ゲームのロジックには触れていない。

## ランキング API（ゲームが呼ぶもの）

| action | 内容 | 戻り値 |
| --- | --- | --- |
| `records.list` | 上位スコア取得 | `{ records: [{ value: { name, best, total, rank, playedAt } }] }` |
| `records.create` | スコア登録 | `{ ok: true, rank }` |

保存先は D1 の `runs` テーブル（1 ユーザー 1 行、`total` が更新されたときだけ書き換え）。
セッション Cookie が無い投稿は 401、1 分 20 回を超える投稿は 429 で拒否する。

## 名前とボット判定

- パスワードもメールも無し。初回に**名前を決めるだけ**で、`dopa_sess` Cookie（30日）が発行される
- 名前の登録時だけ **Cloudflare Turnstile** を検証する
  （`TURNSTILE_SECRET` 未設定ならスキップ）
- 以降のスコア投稿はセッションで認証される

## ローカル開発

```bash
npm install
npm run dev        # http://localhost:5173
npm run worker:dev # http://127.0.0.1:8787
```

> Windows で `wrangler dev` が
> `CreateDirectory: アクセスが拒否されました; path = miniflare-email-store`
> で落ちる場合は `--persist-to` を試す。それでも直らない環境では、デプロイ後に API を叩いて検証している。

```bash
npm run typecheck
npm run build
npm run deploy
```

初回のみ KV / D1 の作成とマイグレーションが必要。

```bash
npx wrangler kv namespace create DOPA_KV
npx wrangler d1 create dopa-disc
npx wrangler d1 execute dopa-disc --remote --file migrations/0002_runs.sql
```

## ハマりどころ（実際に踏んだもの）

- **`--safe-area-inset-top` などの CSS 変数は自前で定義が必要。**
  元の実行環境（ホスト）が注入していたため、無いと
  `calc(100dvh - var(--safe-area-inset-top))` が無効になり、
  ゲーム領域の高さが 0 に潰れて**画面が真っ白**になる。
- **重ねた canvas は `pointer-events: none` を忘れると描けなくなる。**
  上のレイヤーが入力を全部食べる。
- 検証は `document.elementFromPoint()` で「実際にクリックが当たる要素」を
  確かめてからイベントを送る。要素を直接掴んで `dispatchEvent` すると
  ヒットテストを通らないので、実機との差に気づけない。
- Tailwind v3 は `bg-[var(--x)]/40` のような CSS 変数 + アルファの記法を**黙って捨てる**。
- wrangler の `compatibility_date` が未来日だと起動しない。
- wrangler 4.15x は `@cloudflare/workers-types@^5` を要求する。

## 日本語 / 英語

- `src/lib/i18n.tsx` の辞書（約90キー）で全文言を管理
- ブラウザ言語を自動判定し、`localStorage` に保存
- 画面左下のフローティングボタン、または名前入力画面から切り替え
- `GameApp.tsx` は `tr('id')` を呼ぶだけ。React の外（モジュール直下のヘルパー）からも
  `tr()` を使えるよう、言語はモジュール変数と Provider の両方で保持している
- 辞書適用はスクリプトで機械的に行い、**残存する日本語を正規表現でゼロ**にして確認

## ランキング

- スコア保存先は D1 の `runs` テーブル（1ユーザー1行・自己ベスト更新時のみ書き換え）
- ゲームのスタート画面にあるカード（旧「スコア TOP 5」）を「ランキング」に増設し、
  上位50件をその場で常時表示（`max-h-[42dvh]` でスクロール）
- 自分の行はハイライトされる（`window.__dopaMe` 経由でゲーム側に名前を渡す）
- 名前を決めていれば「自己ベスト」カードにスコア・グレード・飛距離が出る

### `/actions` のレスポンス形式（重要）

ゲーム本体の `callApi` は `return json.data` と、**`data` で包まれた応答**を期待する。
包まずに返すと `data` が undefined になり、保存はできているのに画面が空になる。
`worker/actions.ts` は必ず `{ data: ... }` で返すこと。

## ライセンス

MIT
