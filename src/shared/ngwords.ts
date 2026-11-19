/**
 * 名前のNGワード判定（クライアント・Worker 共有の純粋な実装）。
 *
 * 目的は「差別語・下ネタ・露骨な性的表現・侮蔑語」を名前として登録させないこと。
 * ただし一般の名前を弾きすぎないように、判定の前に見た目をそろえつつ、
 * 語ごとに「どこまで一致したらNGか」を分けている。
 *
 * 正規化:
 *   - NFKC（全角→半角、半角カナ→全角、互換文字の統一）
 *   - 小文字化、カタカナ→ひらがな
 *   - 小書き文字・促音・長音の吸収（ぁ→あ、っ・ーを削除）
 *   - 空白・記号を区切りとして保持し、詰めた形でも判定（「ち ん こ」対策）
 *   - leet 表記（4→a、5→s など）を戻した形でも判定（「a55」「b1tch」対策）
 *   - 同じ文字の繰り返しを縮めた形でも判定（「くそおおお」対策）
 *
 * 一致のしかた:
 *   - contains: 正規化して詰めた文字列のどこかに含まれればNG（はっきりした語）
 *   - edge:     区切りで囲まれた語として現れたときだけNG（短く紛らわしい語）
 *   - latin:    英字は語単位（cassandra の "ass" のような部分一致を拾わない）
 */

export type NgCategory = "sexual" | "profanity" | "discrimination" | "insult";

/** 区切り（空白・記号）を表す内部マーカー。名前には現れない私用領域の文字。 */
const SEP = "\uE000";

const SEP_RUN = new RegExp(`${SEP}+`, "g");
const SEP_EDGE = new RegExp(`^${SEP}+|${SEP}+$`, "g");

/** 全角/半角・大文字小文字をそろえる */
function foldWidthCase(input: string): string {
  return input.normalize("NFKC").toLowerCase();
}

/** カタカナ→ひらがな、小書き・促音・長音の吸収 */
function foldKana(input: string): string {
  return input
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[ぁぃぅぇぉ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 1))
    .replace(/[ゃゅょ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 1))
    .replace(/ゎ/g, "わ")
    .replace(/[っー]/g, "");
}

/** 文字・数字以外を区切りに置き換え、前後の区切りは落とす */
function foldSeparators(input: string): string {
  return input.replace(/[^\p{L}\p{N}]+/gu, SEP).replace(SEP_RUN, SEP).replace(SEP_EDGE, "");
}

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "2": "z",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "g",
  "7": "t",
  "8": "b",
  "9": "g",
};

/** 数字・記号の leet 表記を文字に戻す */
function foldLeet(input: string): string {
  return input.replace(/[0-9@$]/g, (ch) => LEET[ch] ?? (ch === "@" ? "a" : ch === "$" ? "s" : ch));
}

/** 同じ文字の繰り返しを 1 文字に縮める（くそおおお → くそお → くそ） */
function foldRepeats(input: string): string {
  return input.replace(/(.)\1+/g, "$1");
}

/** 判定に使う正規化バリアント（重複は除く） */
function normalizeVariants(raw: string): string[] {
  const folded = foldWidthCase(raw);
  const plain = foldSeparators(foldKana(folded));
  const leet = foldSeparators(foldKana(foldLeet(folded)));
  const candidates = [plain, foldRepeats(plain), leet, foldRepeats(leet)];
  const out: string[] = [];
  for (const candidate of candidates) {
    if (candidate && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

function splitTokens(variant: string): string[] {
  return variant.split(SEP).filter((token) => token.length > 0);
}

/**
 * 1 文字ずつ区切った表記（f.u.c.k / f u c k）をまとめた語。
 * 英字の部分一致を避けつつ、記号や空白を挟んだ回避だけは拾いたいので、
 * 「1文字トークンの連なり」だけを連結した語を作る。
 */
function joinedSingleCharRuns(tokens: string[]): string[] {
  const out: string[] = [];
  let buffer = "";
  for (const token of tokens) {
    if ([...token].length === 1) {
      buffer += token;
      continue;
    }
    if (buffer.length > 1) out.push(buffer);
    buffer = "";
  }
  if (buffer.length > 1) out.push(buffer);
  return out;
}

interface NgEntry {
  word: string;
  category: NgCategory;
}

/**
 * 辞書の語も名前に揃えた正規化を通す（「おっぱい」の「っ」を落とす等）。
 * これをしないと、正規化で消える文字を含む語が永久に一致しなくなる。
 */
function prepare(entries: NgEntry[]): NgEntry[] {
  return entries.map((entry) => ({
    category: entry.category,
    word: foldSeparators(foldKana(foldWidthCase(entry.word))),
  }));
}

/** 詰めた文字列のどこかに含まれたらNG（はっきりした語） */
const JA_CONTAINS: NgEntry[] = prepare([
  // 下ネタ・露骨な性的表現
  { word: "ちんこ", category: "sexual" },
  { word: "ちんぽ", category: "sexual" },
  { word: "ちんちん", category: "sexual" },
  { word: "まんこ", category: "sexual" },
  { word: "おめこ", category: "sexual" },
  { word: "まんぐり", category: "sexual" },
  { word: "せくす", category: "sexual" },
  { word: "すけべ", category: "sexual" },
  { word: "おなに", category: "sexual" },
  { word: "ふぇら", category: "sexual" },
  { word: "ぱいずり", category: "sexual" },
  { word: "おっぱい", category: "sexual" },
  { word: "ちくび", category: "sexual" },
  { word: "きんたま", category: "sexual" },
  { word: "いんもう", category: "sexual" },
  { word: "れいぷ", category: "sexual" },
  { word: "ろりこん", category: "sexual" },
  { word: "しょた", category: "sexual" },
  { word: "わいせつ", category: "sexual" },
  { word: "でりへる", category: "sexual" },
  { word: "せふれ", category: "sexual" },
  { word: "うんこ", category: "profanity" },
  { word: "うんち", category: "profanity" },
  { word: "うんぴ", category: "profanity" },
  { word: "くそ", category: "profanity" },
  // 差別語・障害への侮蔑
  { word: "きちがい", category: "discrimination" },
  { word: "かたわ", category: "discrimination" },
  { word: "つんぼ", category: "discrimination" },
  { word: "めくら", category: "discrimination" },
  { word: "ちんば", category: "discrimination" },
  { word: "しなじん", category: "discrimination" },
  // 侮蔑・暴言（漢字表記）
  { word: "馬鹿", category: "insult" },
  { word: "阿呆", category: "insult" },
  { word: "死ね", category: "insult" },
  { word: "殺す", category: "insult" },
  { word: "消えろ", category: "insult" },
  { word: "畜生", category: "profanity" },
  // 漢字表記の性的表現
  { word: "変態", category: "sexual" },
  { word: "痴漢", category: "sexual" },
  { word: "強姦", category: "sexual" },
  { word: "輪姦", category: "sexual" },
  { word: "売春", category: "sexual" },
  { word: "援交", category: "sexual" },
  // 侮蔑・暴言
  { word: "ばかやろう", category: "insult" },
  { word: "あほんだら", category: "insult" },
  { word: "まぬけ", category: "insult" },
  { word: "きえろ", category: "insult" },
  { word: "ころす", category: "insult" },
  { word: "うざい", category: "insult" },
  { word: "きもい", category: "insult" },
  { word: "くたばれ", category: "insult" },
]);

/**
 * 語の先頭・末尾でもNGにする短い侮蔑語。
 * 「ばか！」「しね」のように単体で使われる語だけをここに置く。
 */
const JA_EDGE_AFFIX: NgEntry[] = prepare([
  { word: "しね", category: "insult" },
  { word: "ばか", category: "insult" },
  { word: "あほ", category: "insult" },
]);

/**
 * 語として単独で現れたときだけNGにする語。
 * 「はげまし」「くずは」「ちびっこ」のような、ほかの言葉の一部になっている
 * 普通の名前を巻き込まないため、部分一致では判定しない。
 */
const JA_EDGE_EXACT: NgEntry[] = prepare([
  { word: "くず", category: "insult" },
  { word: "ごみ", category: "insult" },
  { word: "ぼけ", category: "insult" },
  { word: "でぶ", category: "insult" },
  { word: "ぶす", category: "insult" },
  { word: "はげ", category: "insult" },
  { word: "ちび", category: "insult" },
  { word: "どじ", category: "insult" },
  { word: "うざ", category: "insult" },
]);

/** 英字は語単位でNG（cassandra の "ass" などは拾わない） */
const LATIN_TOKENS: NgEntry[] = prepare([
  { word: "sex", category: "sexual" },
  { word: "sexy", category: "sexual" },
  { word: "penis", category: "sexual" },
  { word: "vagina", category: "sexual" },
  { word: "boob", category: "sexual" },
  { word: "boobs", category: "sexual" },
  { word: "tit", category: "sexual" },
  { word: "tits", category: "sexual" },
  { word: "ass", category: "sexual" },
  { word: "asshole", category: "sexual" },
  { word: "anus", category: "sexual" },
  { word: "anal", category: "sexual" },
  { word: "cum", category: "sexual" },
  { word: "jizz", category: "sexual" },
  { word: "dildo", category: "sexual" },
  { word: "porn", category: "sexual" },
  { word: "porno", category: "sexual" },
  { word: "hentai", category: "sexual" },
  { word: "nude", category: "sexual" },
  { word: "naked", category: "sexual" },
  { word: "rape", category: "sexual" },
  { word: "rapist", category: "sexual" },
  { word: "erotic", category: "sexual" },
  { word: "orgasm", category: "sexual" },
  { word: "masturbate", category: "sexual" },
  { word: "blowjob", category: "sexual" },
  { word: "handjob", category: "sexual" },
  { word: "fuck", category: "profanity" },
  { word: "fucker", category: "profanity" },
  { word: "fucking", category: "profanity" },
  { word: "motherfucker", category: "profanity" },
  { word: "shit", category: "profanity" },
  { word: "bitch", category: "profanity" },
  { word: "bastard", category: "profanity" },
  { word: "whore", category: "profanity" },
  { word: "slut", category: "profanity" },
  { word: "cunt", category: "sexual" },
  { word: "dick", category: "sexual" },
  { word: "cock", category: "sexual" },
  { word: "pussy", category: "sexual" },
  { word: "scrotum", category: "sexual" },
  { word: "incest", category: "sexual" },
  { word: "pedo", category: "sexual" },
  { word: "pedophile", category: "sexual" },
  { word: "lolicon", category: "sexual" },
  { word: "molest", category: "sexual" },
  { word: "horny", category: "sexual" },
  { word: "milf", category: "sexual" },
  { word: "nigger", category: "discrimination" },
  { word: "nigga", category: "discrimination" },
  { word: "faggot", category: "discrimination" },
  { word: "fag", category: "discrimination" },
  { word: "retard", category: "discrimination" },
  { word: "chink", category: "discrimination" },
  { word: "gook", category: "discrimination" },
  { word: "kike", category: "discrimination" },
  { word: "spic", category: "discrimination" },
  { word: "wetback", category: "discrimination" },
  { word: "tranny", category: "discrimination" },
  { word: "dyke", category: "discrimination" },
  { word: "nazi", category: "discrimination" },
  { word: "hitler", category: "discrimination" },
  { word: "kkk", category: "discrimination" },
  { word: "aryan", category: "discrimination" },
  { word: "idiot", category: "insult" },
  { word: "moron", category: "insult" },
  { word: "dumbass", category: "insult" },
  { word: "jackass", category: "insult" },
  { word: "dipshit", category: "insult" },
  { word: "scumbag", category: "insult" },
  { word: "wanker", category: "insult" },
  { word: "twat", category: "insult" },
  { word: "piss", category: "profanity" },
  { word: "turd", category: "profanity" },
]);

/** 詰めた文字列（区切りを飛ばした形）に含まれたらNGの英字の成句 */
const LATIN_PHRASES: NgEntry[] = prepare([
  { word: "fuckyou", category: "profanity" },
  { word: "fuckoff", category: "profanity" },
  { word: "fuckyall", category: "profanity" },
  { word: "sonofabitch", category: "profanity" },
  { word: "killyourself", category: "insult" },
  { word: "heilhitler", category: "discrimination" },
  { word: "siegheil", category: "discrimination" },
  { word: "whitepower", category: "discrimination" },
]);

export interface NgHit {
  /** 一致したNGワード（正規化後の表記） */
  word: string;
  /** 不適切さの種類 */
  category: NgCategory;
}

/** 英字トークンの前後に付いた数字を落とす（fuck123 → fuck） */
function trimDigits(token: string): string {
  return token.replace(/^[0-9]+|[0-9]+$/g, "");
}

/**
 * 名前にNGワードが含まれていれば、最初に見つかったものを返す。
 * 含まれていなければ null。
 */
export function findNgWord(rawName: string): NgHit | null {
  if (typeof rawName !== "string" || rawName.trim() === "") return null;

  for (const variant of normalizeVariants(rawName)) {
    const tokens = splitTokens(variant);
    if (tokens.length === 0) continue;
    const compact = tokens.join("");

    for (const entry of JA_CONTAINS) {
      if (compact.includes(entry.word)) return { word: entry.word, category: entry.category };
    }

    for (const entry of LATIN_PHRASES) {
      if (compact.includes(entry.word)) return { word: entry.word, category: entry.category };
    }

    for (const entry of JA_EDGE_AFFIX) {
      const hit =
        compact === entry.word ||
        tokens.some(
          (token) =>
            token === entry.word || token.startsWith(entry.word) || token.endsWith(entry.word),
        );
      if (hit) return { word: entry.word, category: entry.category };
    }

    for (const entry of JA_EDGE_EXACT) {
      const hit = compact === entry.word || tokens.some((token) => token === entry.word);
      if (hit) return { word: entry.word, category: entry.category };
    }

    const latinTokens = [...tokens, ...joinedSingleCharRuns(tokens)];
    for (const entry of LATIN_TOKENS) {
      if (latinTokens.some((token) => token === entry.word || trimDigits(token) === entry.word)) {
        return { word: entry.word, category: entry.category };
      }
    }
  }

  return null;
}

/** NGワードかどうかだけを知りたいとき */
export function hasNgWord(rawName: string): boolean {
  return findNgWord(rawName) !== null;
}
