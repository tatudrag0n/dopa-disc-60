import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ja" | "en";

const STORAGE_KEY = "dopa_lang";

/** 日本語を正とする。en は同じキーを必ず持つ。 */
const ja = {
  "app.title": "フライングディスク",
  "app.docTitle": "フライングディスク - ドパ仕様",
  "theme.toDark": "ダークテーマに切り替え",
  "theme.toLight": "ライトテーマに切り替え",
  "app.titleLine1": "フライング",
  "app.titleLine2": "ディスク",
  "app.tagline": "描いて、回して、飛ばす",
  "app.heroLead":
    "1筆で描いた形がそのまま円盤になる。円盤をぐるっと回して勢いをつけ、上へスワイプすれば飛び出す。飛距離は",
  "app.heroLeadTail": "で決まる。スマホもPCもそのまま遊べます。",
  "app.formula": "形 × 回転 × 勢い",

  "nav.home": "ホーム",
  "nav.play": "あそぶ",
  "nav.ranking": "ランキング",
  "nav.howto": "つかいかた",

  "common.play": "あそぶ",
  "common.ranking": "ランキング",
  "common.back": "もどる",
  "common.close": "閉じる",
  "common.loading": "読み込み中…",
  "common.retry": "再試行",
  "common.reload": "再読み込み",

  "hero.best": "あなたの自己ベスト",
  "hero.diagram": "描く → 回す → 飛ばす",

  "play.heading": "あそぶ",
  "play.step1.title": "描く",
  "play.step1.desc": "円盤になる形を1筆で。きれいな円ほど高スコア。",
  "play.step2.title": "回す",
  "play.step2.desc": "円盤のまわりをぐるぐる。回転と勢いが伸びる。",
  "play.step3.title": "飛ばす",
  "play.step3.desc": "上へスワイプ、または「飛ばす」ボタン。",
  "play.start": "ゲームをはじめる",
  "play.keyboardHint": "PC ではマウスドラッグ + Space キーでも遊べます",

  "ranking.heading": "ランキング",
  "ranking.range.all": "歴代",
  "ranking.range.today": "今日",
  "ranking.range.week": "今週",
  "ranking.titleOf": "{range}ランキング",
  "ranking.players": "{n}人",
  "ranking.yourBest": "あなたのベスト",
  "ranking.outOfRange": "圏外",
  "ranking.rank": "{n}位",
  "ranking.empty.title": "まだ記録がありません",
  "ranking.empty.desc": "1位になって名前を刻もう。",
  "ranking.needName": "名前を決めると記録できます",
  "ranking.setName": "名前を決める",
  "ranking.you": "YOU",

  "howto.heading": "つかいかた",
  "howto.1.title": "円盤の形を描く",
  "howto.1.desc":
    "指（またはマウス）で1筆の円を描きます。円に近いほど「形」のスコアが上がります。大きすぎ・小さすぎは減点。25% 未満だとほぼ飛びません。",
  "howto.2.title": "回して勢いをつける",
  "howto.2.desc":
    "円盤のまわりをぐるぐる回すと「回転」と「勢い」が上がります。勢いは時間とともに減るので、回し終わったらすぐ飛ばしましょう。",
  "howto.3.title": "飛ばす",
  "howto.3.desc":
    "上方向へスワイプするか、「飛ばす」ボタンを押します。PC では Space / Enter でも飛びます。R でやり直し、Esc でゲームを終了。",
  "howto.4.title": "ランキングに登録",
  "howto.4.desc":
    "スコアは自動でランキングに登録されます。飛距離はサーバー側で再計算されるため、改造しても記録は伸びません。",

  "footer.tag": "描いて、回して、飛ばす",

  "game.step1": "STEP 1 / 2",
  "game.step2": "STEP 2 / 2",
  "game.flying": "FLYING",
  "game.best": "BEST {v}m",
  "game.drawHint": "円盤の形を1筆で描いてね",
  "game.spinHintHigh": "いい勢い！そのまま上へスワイプ",
  "game.spinHintMid": "ぐるっと回して上へスワイプ！（ボタンでもOK）",
  "game.spinHintLow": "円盤のまわりをぐるぐる回して勢いをつけよう",
  "game.flyHint": "ビュッと飛んでる！",
  "game.throw": "飛ばす",
  "game.lowMomentum": "（勢い不足）",
  "game.drawTip": "1筆で円を描くほど高スコア",
  "game.stat.shape": "形",
  "game.stat.rot": "回転",
  "game.stat.mom": "勢い",
  "game.quit": "ゲームをやめる",
  "game.reset": "やり直す",

  "result.title": "結果",
  "result.best": "自己ベスト更新！",
  "result.share": "シェア",
  "result.copied": "コピー済み",
  "result.shareText": "フライングディスクで {v}m 飛ばした！",
  "result.submitting": "ランキングに登録中…",
  "result.ranked": "ランキング {n}位 に登録しました",
  "result.rankedNoRank": "ランキングに登録しました",
  "result.needName": "ランキングに載せる名前を決めてください",
  "result.retry": "もう一度",
  "result.home": "ホーム",
  "result.botCheck": "ボット判定中…",

  "name.title": "名前を決めよう",
  "name.desc": "パスワードは不要です。ランキングに表示される名前だけ決めてください。",
  "name.label": "プレイヤー名",
  "name.placeholder": "2〜16文字",
  "name.start": "この名前ではじめる",
  "name.change": "名前を変更",
  "name.rename.title": "名前を変更",
  "name.rename.desc": "ランキングの表示名が変わります。過去の記録もこの名前になります。",
  "name.save": "保存する",
  "name.err.short": "名前は{min}文字以上にしてください",
  "name.err.long": "名前は{max}文字以内にしてください",
  "name.err.chars": "名前に使えない文字が含まれています",

  "comment.shape.perfect": "完璧な円！",
  "comment.shape.great": "かなりきれい",
  "comment.shape.good": "いい感じ",
  "comment.shape.ok": "もう少し円く",
  "comment.shape.poor": "ゆがみ気味",
  "comment.shape.bad": "ぐにゃぐにゃ",

  "comment.dist.big": "人類級のビッグスロー！",
  "comment.dist.huge": "とんでもない飛距離",
  "comment.dist.nice": "ナイススロー！",
  "comment.dist.ok": "いい飛び",
  "comment.dist.low": "もう少し勢いを",
  "comment.dist.veryLow": "くるっと回して勢いを",

  "hint.allGood": "三拍子そろってる。あとは再現あるのみ",
  "hint.shapeClose": "形はあと少し。円をきれいに閉じると伸びる",
  "hint.shapeWeak": "形がネック。もっと円に近い1筆を意識しよう",
  "hint.rotClose": "回転をあと少し。もう1〜2回転させると伸びる",
  "hint.rotWeak": "回転が足りない。円盤のまわりを長く回そう",
  "hint.momClose": "勢いが少し落ちた。回し終えたらすぐ飛ばそう",
  "hint.momWeak": "勢いが足りない。素早く回して上へスワイプ",

  "error.generic": "エラーが発生しました",
  "error.network": "ネットワークに接続できませんでした",
  "error.botFailed": "ボット判定に失敗しました。ページを再読み込みしてお試しください",
  "error.rateLimit": "投稿が多すぎます。少し待ってから再挑戦してください",
  "error.nameRequired": "名前を入力してください",

  "lang.label": "English",
} as const;

export type MessageKey = keyof typeof ja;

const en: Record<MessageKey, string> = {
  "app.title": "Flying Disc",
  "app.docTitle": "Flying Disc - DOPA SPEC",
  "theme.toDark": "Switch to dark theme",
  "theme.toLight": "Switch to light theme",
  "app.titleLine1": "Flying",
  "app.titleLine2": "Disc",
  "app.tagline": "Draw it. Spin it. Launch it.",
  "app.heroLead":
    "Your one-stroke drawing becomes the disc. Spin it around to build power, then swipe up to launch. Distance is",
  "app.heroLeadTail": ". Works on phones and desktops, right in the browser.",
  "app.formula": "shape × spin × power",

  "nav.home": "Home",
  "nav.play": "Play",
  "nav.ranking": "Ranking",
  "nav.howto": "How to",

  "common.play": "Play",
  "common.ranking": "Ranking",
  "common.back": "Back",
  "common.close": "Close",
  "common.loading": "Loading…",
  "common.retry": "Retry",
  "common.reload": "Reload",

  "hero.best": "Your personal best",
  "hero.diagram": "DRAW → SPIN → FLY",

  "play.heading": "Play",
  "play.step1.title": "Draw",
  "play.step1.desc": "Sketch the disc in one stroke. A rounder shape scores higher.",
  "play.step2.title": "Spin",
  "play.step2.desc": "Circle around the disc to build spin and power.",
  "play.step3.title": "Launch",
  "play.step3.desc": "Swipe up, or hit the launch button.",
  "play.start": "Start the game",
  "play.keyboardHint": "On desktop you can drag with the mouse and press Space",

  "ranking.heading": "Ranking",
  "ranking.range.all": "All time",
  "ranking.range.today": "Today",
  "ranking.range.week": "This week",
  "ranking.titleOf": "{range} ranking",
  "ranking.players": "{n} players",
  "ranking.yourBest": "Your best",
  "ranking.outOfRange": "Unranked",
  "ranking.rank": "#{n}",
  "ranking.empty.title": "No records yet",
  "ranking.empty.desc": "Claim the top spot.",
  "ranking.needName": "Pick a name to get on the board",
  "ranking.setName": "Pick a name",
  "ranking.you": "YOU",

  "howto.heading": "How to play",
  "howto.1.title": "Draw the disc",
  "howto.1.desc":
    "Draw a single circle with your finger or mouse. Rounder shapes score higher; too big or too small is penalised. Below 25% the disc barely flies.",
  "howto.2.title": "Build up spin",
  "howto.2.desc":
    "Circle around the disc to raise spin and power. Power drains over time, so launch soon after your last spin.",
  "howto.3.title": "Launch",
  "howto.3.desc":
    "Swipe upward or press the launch button. On desktop, Space / Enter also launches. R restarts and Esc quits the game.",
  "howto.4.title": "Get ranked",
  "howto.4.desc":
    "Scores are posted automatically. Distance is recalculated on the server, so editing the request won't get you further.",

  "footer.tag": "Draw it. Spin it. Launch it.",

  "game.step1": "STEP 1 / 2",
  "game.step2": "STEP 2 / 2",
  "game.flying": "FLYING",
  "game.best": "BEST {v}m",
  "game.drawHint": "Draw the disc in one stroke",
  "game.spinHintHigh": "Great power! Swipe up now",
  "game.spinHintMid": "Spin around, then swipe up (or use the button)",
  "game.spinHintLow": "Circle around the disc to build power",
  "game.flyHint": "It's flying!",
  "game.throw": "Launch",
  "game.lowMomentum": "(low power)",
  "game.drawTip": "A rounder one-stroke circle scores higher",
  "game.stat.shape": "Shape",
  "game.stat.rot": "Spin",
  "game.stat.mom": "Power",
  "game.quit": "Quit the game",
  "game.reset": "Start over",

  "result.title": "RESULT",
  "result.best": "New personal best!",
  "result.share": "Share",
  "result.copied": "Copied",
  "result.shareText": "I threw the flying disc {v}m!",
  "result.submitting": "Posting to the ranking…",
  "result.ranked": "Posted — you're #{n} on the board",
  "result.rankedNoRank": "Posted to the ranking",
  "result.needName": "Pick the name shown on the ranking",
  "result.retry": "Play again",
  "result.home": "Home",
  "result.botCheck": "Checking you're human…",

  "name.title": "Pick a name",
  "name.desc": "No password needed. Just choose the name shown on the ranking.",
  "name.label": "Player name",
  "name.placeholder": "2–16 characters",
  "name.start": "Start with this name",
  "name.change": "Change name",
  "name.rename.title": "Change your name",
  "name.rename.desc": "This changes your display name on the ranking, including past records.",
  "name.save": "Save",
  "name.err.short": "Use at least {min} characters",
  "name.err.long": "Use at most {max} characters",
  "name.err.chars": "That name contains unsupported characters",

  "comment.shape.perfect": "Perfect circle!",
  "comment.shape.great": "Really clean",
  "comment.shape.good": "Nice shape",
  "comment.shape.ok": "Round it a bit more",
  "comment.shape.poor": "A little lopsided",
  "comment.shape.bad": "Very wobbly",

  "comment.dist.big": "An all-time monster throw!",
  "comment.dist.huge": "Enormous distance",
  "comment.dist.nice": "Nice throw!",
  "comment.dist.ok": "Good flight",
  "comment.dist.low": "A bit more power",
  "comment.dist.veryLow": "Spin it round for power",

  "hint.allGood": "All three dials are up. Now repeat it",
  "hint.shapeClose": "Shape is close — close the circle cleanly to gain",
  "hint.shapeWeak": "Shape is the bottleneck — aim for a rounder stroke",
  "hint.rotClose": "Spin is close — one or two more turns will do it",
  "hint.rotWeak": "Not enough spin — circle the disc for longer",
  "hint.momClose": "Power dropped — launch right after your last spin",
  "hint.momWeak": "Not enough power — spin fast and swipe up",

  "error.generic": "Something went wrong",
  "error.network": "Could not reach the network",
  "error.botFailed": "The human check failed. Please reload and try again.",
  "error.rateLimit": "Too many submissions. Please wait a moment.",
  "error.nameRequired": "Please enter a name.",

  "lang.label": "日本語",
};

const messages: Record<Lang, Record<MessageKey, string>> = { ja, en };

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "ja" || saved === "en") return saved;
  } catch {
    /* noop */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.toLowerCase().startsWith("ja") ? "ja" : "en";
}

type Vars = Record<string, string | number>;

function format(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? `{${key}}`));
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
  t: (key: MessageKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = messages[lang]["app.docTitle"];
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* noop */
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggle = useCallback(() => setLangState((prev) => (prev === "ja" ? "en" : "ja")), []);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => format(messages[lang][key] ?? key, vars),
    [lang],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang, toggle, t }), [lang, setLang, toggle, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
