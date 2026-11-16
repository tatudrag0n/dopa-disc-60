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

## 形の評価（物理ベース）

`src/lib/discPhysics.ts` が、描いた閉曲線を「回転する平板」として評価する。
**円である必要はない。** 円は「対称性がすべての次数でゼロ」という一例にすぎない。

回転する円盤がぶれるのは、平面形が回転対称でないために空力中心が回り込み、
ロール方向の周期的なトルクが立つから。その大きさは半径分布 r(θ) の
**低次ハーモニクス**で決まる。

そこで重心まわりの半径分布をフーリエ分解し、次数ごとに分けて評価する。

| 成分 | 効くもの | 扱い |
| --- | --- | --- |
| n=1（片側が膨らむ） | ぐらつき | 大きく減点 |
| n=2（楕円） | ぐらつき | 減点 |
| n=3,4,6（多角形） | 回転対称なので安定 | 減点なし |
| n≥5（細かい凹凸） | 面のざらつき＝抗力 | 抗力として減点 |

加えて **最小外接円（smallest enclosing circle）** を求め、その中心を「見た目の中心」として
面積重心とのズレを**質量バランス**として評価する（外接矩形の中心だと三角形のような
「見た目は中心なのに矩形中心がずれる」形を不当に減点してしまうため）。
この外接円の中心は**正規化の原点にも使う**（打点の単純平均だと、ゆっくり描いた側に
点が寄って原点がずれてしまう）。
周長（等周比）は縁の滑らかさとして抗力に効かせ、面積は揚力と質量の両方に効いて
相殺するので、極端に細いスリバーだけを減点する。
揚力係数 CL / 抗力係数 CD を近似して **揚抗比 L/D** を出す。
理想的な円（L/D ≈ 11.9）を 1 として正規化し、
`sqrt(glideNorm) × バランス × ぐらつき` の**掛け算**で飛び効率 0–100 を求める。
（足し算にすると下限がついて、どんな形でも高得点になってしまう）

結果画面には **形状パラメータ**（回転対称性 / 面積（充填率） / 縁の滑らかさ / 質量バランス / 揚抗比 L/D）
をバー付きで表示し、「形状」欄には**最も弱い要素**（ぐらつく / 縁がざらつく / 面積が足りない / 重心が偏る）を出す。

### 実測

| 形 | 効率 | グレード | 弱点 |
| --- | --- | --- | --- |
| 真円 | 100 | S | なし |
| 塊（ゆるい円） | 87 | S | なし |
| 八角形 | 81 | A | なし |
| 手描きの円（ゆらぎ3%） | 74 | A | なし |
| 六角形 | 70 | A | なし |
| 楕円 1.4:1 | 69 | A | なし |
| 角丸の正方形 | 63 | B | 面積が足りない |
| 五角形 | 58 | B | 縁がざらつく |
| 楕円 2:1 | 56 | B | ぐらつく |
| 五芒星 | 28 | C | 縁がざらつく |

円が最良なのは事実だが、**八角形・六角形・楕円1.4:1 のような非円形でも A が取れる**。
## グレード（ランク）

`src/lib/grading.ts` に集約。

**総合ランク**は、飛距離そのものではなく **3要素をどれだけ揃えられたか**で決める。

```
overall = 0.5 × 形状 + 0.3 × 回転 + 0.2 × 加速度   (各 0..1)
S ≥ 0.90 / A ≥ 0.78 / B ≥ 0.62 / C ≥ 0.42 / D
```

以前は「飛距離 80m 以上で S」という絶対しきい値だったが、飛距離はスピンの効き方で
1000m を超えるため**ほぼ全部 S** になっていた。

- 形状 = 物理評価の飛び効率 / 100
- 回転 = スピン値 / 15000（`SPIN_REF`。実測 8,000〜13,000 に合わせた）
- 加速度 = スワイプの速さ 0..1

**形状グレード**は飛び効率 0..100 から: S ≥ 82 / A ≥ 65 / B ≥ 48 / C。
`discPhysics.ts` もこの関数を使う（しきい値の二重管理をやめた）。

保存済みの記録は、そのとき付いたグレードをそのまま表示する。
旧方式で保存された記録は再現できないためグレードを空にしてあり、空のときは表示しない。
## 音（BGM / 効果音）

`src/lib/gameAudio.ts` が **WebAudio で手続き的に音を生成**する。音声ファイルは持たない。

- ダウンロードが増えない
- ループの継ぎ目が完全に無い（シーケンサで刻むため）
- 回転量などに応じて音を変化させられる

**BGM**: 132 BPM / 16分音符、4小節ループ（Am → F → C → G）。
キック（4つ打ち）・スネア・ハイハット・ベース・アルペジオ・コード刻みで構成し、
4小節目の後半にリードを重ねて盛り上げる。`ensure()` → `start()` で開始し、
`setMuted()` でミュートに追従する。

**SFX**: `click` / `drawStart` / `drawTick` / `shapeDone` / `spinTick` / `throw` /
`land` / `best` / `bonus` / `grade` の 10 種。それぞれトーンとノイズを重ねて作る。
`spinTick` は引数で音程が上がる（回転が乗るほど高くなる）。

自動再生ポリシーがあるため、BGM は「スタート」ボタン（ユーザー操作）で開始する。

## SEO

- タイトル / description / keywords / canonical / OGP / Twitter Card / JSON-LD（VideoGame）
- `public/robots.txt`（`/api/` と `/actions` は除外）、`public/sitemap.xml`
- JS 無効時のために `<noscript>` で説明と遊び方を出している
  （常時表示の隠しテキストはクローキング扱いになり得るので使わない）
- SPA なので、インデックスを早めたい場合は Search Console で sitemap.xml を送信する