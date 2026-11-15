/**
 * ゲーム本体（GameApp.tsx）の文言辞書。
 *
 * GameApp はモジュール直下のヘルパーからも文言を出すので、
 * React の外から使える `tr()` と、再レンダリング用の `useI18n()` の両方を用意する。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ja" | "en";

const STORAGE_KEY = "dopa_lang";

/** id: [日本語, English] */
const DICT = {
  "app.title": ["フライングディスク", "Flying Disc"],
  "app.tagline": ["描いた形が、そのままディスクになる。", "The shape you draw becomes the disc."],

  "stat.shape": ["形状", "Shape"],
  "stat.spin": ["回転", "Spin"],
  "stat.accel": ["加速度", "Accel"],
  "stat.distance": ["飛距離", "Distance"],

  "start": ["スタート", "Start"],
  "howto": ["遊び方を見る", "How to play"],
  "top5": ["ランキング", "Ranking"],
  "noRecords": ["最初の一投で記録を作ろう。", "Make a throw to set the first record."],
  "best": ["自己ベスト", "Personal best"],
  "newRecord": ["自己ベスト更新", "New personal best"],
  "loadingBest": [
    "ベスト記録を読み込み中だよ。通信がつながったら再表示するよ。",
    "Loading your best record. It will appear when the connection is back.",
  ],

  "step1": ["1 描く", "1 Draw"],
  "step2": ["2 投げる", "2 Throw"],
  "step3": ["3 結果", "3 Result"],

  "drawHint": ["形を1筆で描いて", "Draw the shape in one stroke"],
  "drawSub": ["丸いほど、よく飛ぶ", "Rounder shapes fly further"],
  "drawBubble": ["1筆で ひと回り", "One stroke, one loop"],
  "drawSmall": ["もう少し大きく、1周描いてみよう", "Try a bit larger, one full loop"],

  "aimBubble": ["下で回して → 上までスワイプ", "Spin below → swipe up"],
  "aimHint": ["回して、そのまま上までスワイプ", "Keep spinning, then swipe up"],
  "aimIdle": [
    "形の歪みと表面のラインが回り出したら勢いあり",
    "When the shape and line start spinning, you have power",
  ],
  "aimSpinning": [
    "描いた形の歪みと表面のラインが{dir}に回っているよ",
    "The shape and line are spinning {dir}",
  ],
  "aimDecay": [
    "勢いが抜ける前に、そのまま上まで持っていこう",
    "Get it to the top before the power drains",
  ],
  "toThrow": ["投げるへ進む", "Continue to throw"],
  "seeResult": ["結果を見る", "See result"],

  "again": ["もう一度投げる", "Throw again"],
  "backToTitle": ["タイトルに戻る", "Back to title"],

  "scoreIsDistance": ["スコア = 飛距離のみ", "Score = distance only"],
  "grade": ["グレード", "Grade"],
  "formula": ["飛距離 = 形状 × 回転 × 加速度", "Distance = shape × spin × accel"],
  "point": ["点", "pts"],
  "rankUnit": ["位", ""],

  "mute": ["ミュートする", "Mute"],
  "unmute": ["音を出す", "Unmute"],
  "progress": ["進み具合", "Progress"],
  "netRetry": ["通信をもう一度試してね", "Please check your connection and try again"],

  "grade.almost": ["ほぼ真円", "Almost a circle"],
  "grade.veryClean": ["とても綺麗", "Very clean"],
  "grade.decent": ["まずまず", "Decent"],
  "grade.roundMore": ["もう少し丸く", "Round it a bit more"],
  "grade.wobble": ["ゆがみあり", "A bit lopsided"],

  "spin.decisive": ["決め手", "Decisive"],
  "spin.great": ["よく回った", "Great spin"],
  "spin.ok": ["まずまず", "Decent"],
  "spin.weak": ["弱め", "Weak"],

  "accel.sharp": ["キレのある投げ", "Sharp throw"],
  "accel.fast": ["はやい", "Fast"],
  "accel.justRight": ["ちょうどいい", "Just right"],
  "accel.slow": ["ゆっくり", "Slow"],

  "app.titleLine1": ["フライング", "Flying"],
  "app.titleLine2": ["ディスク", "Disc"],
  "gradeLine": ["グレード {g}", "Grade {g}"],
  "spin.more": ["もう少し速く・綺麗に回してみよう", "Spin a bit faster and cleaner"],
  "accel.more": ["もっと勢いよく", "More power"],
  "accel.fastClean": ["速く・綺麗に", "Fast and clean"],
  "savePending": [
    "今回のベスト記録は保存待ちだよ。もう一度試してみよう。",
    "This record is still pending. Please try again.",
  ],
  "dir.cw": ["時計回り", "clockwise"],
  "dir.ccw": ["反時計回り", "counter-clockwise"],
  "flying": ["飛んでいます…", "In flight…"],
  "howto.step1": [
    "STEP 1：1筆で1つの形を描きます。描いた形がそのままディスクになります。",
    "STEP 1: Draw one continuous shape. Your drawing becomes the disc.",
  ],
  "howto.step2": [
    "STEP 2：下で回して、その勢いのまま上までスワイプで発射します。回転は「今の速さ × 綺麗さ」だけで決まります。止まると勢いが抜けていきます。",
    "STEP 2: Spin below, then swipe up to launch. Spin is decided by current speed x cleanliness. If you stop, the power drains.",
  ],
  "howto.resultNote": [
    "飛距離 = 形状 × 回転 × 加速度。スコア = 飛距離のみです。",
    "Distance = shape x spin x accel. Score equals distance.",
  ],
  "howtoClose": ["遊び方をとじる", "Close how to play"],
  "shapeWeak.symmetry": ["左右非対称", "Asymmetric"],
  "shapeWeak.roundness": ["縁がざらつく", "Rough rim"],
  "shapeWeak.fill": ["面積が足りない", "Too little area"],
  "shapeWeak.balance": ["重心が偏る", "Off-centre mass"],
  "shapeWeak.none": ["まとまった形", "Well-formed"],
  "rankShort": ["ランク", "Rank"],
  "rankingTitle": ["ランキング", "Ranking"],
  "close": ["閉じる", "Close"],
  "gate.title": ["名前を決めてスタート", "Pick a name to start"],
  "gate.desc": [
    "パスワードは不要です。ランキングに表示される名前だけ決めてください。",
    "No password needed. Just pick the name shown on the ranking.",
  ],
  "gate.placeholder": ["2〜16文字", "2-16 characters"],
  "gate.start": ["この名前ではじめる", "Start with this name"],
  "gate.checking": ["確認中…", "Checking…"],
  "gate.bot": ["ボット判定: Cloudflare Turnstile", "Bot check: Cloudflare Turnstile"],
  "gate.errShort": ["名前は2文字以上にしてください", "Use at least 2 characters"],
  "gate.errBot": [
    "ボット判定に失敗しました。ページを再読み込みしてお試しください",
    "The bot check failed. Please reload the page.",
  ],
  "gate.errNet": [
    "通信できませんでした。電波の良い場所でもう一度お試しください",
    "Could not connect. Please try again.",
  ],
  "gate.errOther": ["登録に失敗しました。もう一度お試しください", "Registration failed. Please try again."],
  "float.ranking": ["ランキング", "Ranking"],} as const;

export type MessageId = keyof typeof DICT;

let currentLang: Lang = "ja";

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

function format(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_m, key: string) => String(vars[key] ?? ""));
}

/** React の外（モジュール直下のヘルパー）から使う翻訳 */
export function tr(id: MessageId, vars?: Record<string, string | number>): string {
  const entry = DICT[id];
  return format(entry[currentLang === "ja" ? 0 : 1], vars);
}

/** 順位の表記（1位 / #1） */
export function rankLabel(n: number): string {
  return currentLang === "ja" ? `${n}位` : `#${n}`;
}

export function getLang(): Lang {
  return currentLang;
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
  t: (id: MessageId, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = detectLang();
    currentLang = initial;
    return initial;
  });

  useEffect(() => {
    currentLang = lang;
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* noop */
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    currentLang = next;
    setLangState(next);
  }, []);

  const toggle = useCallback(() => {
    setLangState((prev) => {
      const next = prev === "ja" ? "en" : "ja";
      currentLang = next;
      return next;
    });
  }, []);

  const t = useCallback(
    (id: MessageId, vars?: Record<string, string | number>) => {
      const entry = DICT[id];
      return format(entry[lang === "ja" ? 0 : 1], vars);
    },
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
