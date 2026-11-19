/**
 * 結果画面の X（Twitter）共有まわり。
 *
 * - シェア文面（buildShareText）と intent URL（buildXIntentUrl）は DOM に触らない純粋関数。
 *   テスト（Node）からもそのまま呼べる。
 * - 結果カード画像（renderResultShareImage）だけが Canvas を使う 1200×630 の PNG 生成。
 *
 * 画像は「左に文字・右にプレイヤーが描いたディスク」の1枚で、X のカードでも
 * 縦に切れない 1200×630（1.91:1）に合わせている。
 */

import type { Lang } from "./i18n";

export const SITE_URL = "https://discgame.mct-official.com";
export const SITE_HOST = "discgame.mct-official.com";
export const SHARE_IMAGE_WIDTH = 1200;
export const SHARE_IMAGE_HEIGHT = 630;
export const SHARE_FILE_NAME = "disc-result.png";

const ACCENT_A = "#ff6a00";
const ACCENT_B = "#ff2e88";
const ACCENT_C = "#a100ff";

export type SharePoint = { x: number; y: number };

export interface ShareResultInput {
  /** 飛距離（m）。890.5 のように小数1桁で出す */
  distance: number;
  /** 総合ランク S / A / B / C / D */
  rank: string;
  /** 形状グレード S / A / B / C */
  shapeGrade: string;
  /** 回転スコア（生の数値） */
  spin: number;
  /** 加速度の評価（すでに翻訳済みのラベル） */
  accelLabel: string;
  /** 自己ベスト更新なら true */
  isRecord?: boolean;
}

const FONT_STACK =
  '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",system-ui,-apple-system,"Segoe UI",sans-serif';

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}

function formatDistance(distance: number): string {
  return `${distance.toFixed(1)}m`;
}

function formatSpin(spin: number, lang: Lang): string {
  return Math.round(spin).toLocaleString(lang === "ja" ? "ja-JP" : "en-US");
}

/**
 * X に流す文章。日英どちらも「記録 → 内訳 → ハッシュタグ → URL」の順。
 * X は URL を 23 文字として数えるので、本文は短く保つ（テストで長さも見ている）。
 */
export function buildShareText(input: ShareResultInput, lang: Lang): string {
  const distance = formatDistance(input.distance);
  const spin = formatSpin(input.spin, lang);

  if (lang === "ja") {
    const lines = [
      input.isRecord ? "自己ベスト更新！" : null,
      `飛距離 ${distance}（ランク ${input.rank}）`,
      `形状 ${input.shapeGrade} ・ 回転 ${spin} ・ 加速度 ${input.accelLabel}`,
      "#フライングディスク",
      SITE_URL,
    ];
    return lines.filter((line): line is string => Boolean(line)).join("\n");
  }

  const lines = [
    input.isRecord ? "New personal best!" : null,
    `${distance} (Rank ${input.rank})`,
    `Shape ${input.shapeGrade} · Spin ${spin} · Accel ${input.accelLabel}`,
    "#FlyingDisc",
    SITE_URL,
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

/** X の投稿画面（intent）を開く URL。 */
export function buildXIntentUrl(text: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

/** 結果カード画像のキャプション類（言語ごと） */
function shareLabels(lang: Lang) {
  return lang === "ja"
    ? {
        title: "フライングディスク",
        kicker: "FLYING DISTANCE",
        rankLabel: "ランク",
        shape: "形状",
        spin: "回転",
        accel: "加速度",
        record: "自己ベスト更新！",
      }
    : {
        title: "Flying Disc",
        kicker: "FLYING DISTANCE",
        rankLabel: "RANK",
        shape: "Shape",
        spin: "Spin",
        accel: "Accel",
        record: "NEW PERSONAL BEST!",
      };
}

function circlePoints(): SharePoint[] {
  return Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
}

/** GameApp と同じ平滑化（Catmull-Rom → bezier）で輪郭を描く */
function tracePath(
  ctx: CanvasRenderingContext2D,
  pts: SharePoint[],
  ox: number,
  oy: number,
  scale: number,
) {
  const n = pts.length;
  if (n < 3) return;
  const at = (i: number) => pts[((i % n) + n) % n];
  ctx.beginPath();
  ctx.moveTo(ox + at(0).x * scale, oy + at(0).y * scale);
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = ox + (p1.x + (p2.x - p0.x) / 6) * scale;
    const c1y = oy + (p1.y + (p2.y - p0.y) / 6) * scale;
    const c2x = ox + (p2.x - (p3.x - p1.x) / 6) * scale;
    const c2y = oy + (p2.y - (p3.y - p1.y) / 6) * scale;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ox + p2.x * scale, oy + p2.y * scale);
  }
  ctx.closePath();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#fff8e7");
  bg.addColorStop(0.42, "#ffe9f3");
  bg.addColorStop(1, "#f1e6ff");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const sun = ctx.createRadialGradient(w * 0.06, h * 0.1, 0, w * 0.06, h * 0.1, w * 0.55);
  sun.addColorStop(0, "rgba(255,106,0,.32)");
  sun.addColorStop(1, "rgba(255,106,0,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);

  const violet = ctx.createRadialGradient(w * 0.98, h * 1.02, 0, w * 0.98, h * 1.02, w * 0.62);
  violet.addColorStop(0, "rgba(161,0,255,.26)");
  violet.addColorStop(1, "rgba(161,0,255,0)");
  ctx.fillStyle = violet;
  ctx.fillRect(0, 0, w, h);

  const bar = ctx.createLinearGradient(0, 0, w, 0);
  bar.addColorStop(0, ACCENT_A);
  bar.addColorStop(0.55, ACCENT_B);
  bar.addColorStop(1, ACCENT_C);
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, w, 10);
}

/** プレイヤーが描いた形を、厚み・グラデーション・回転ライン付きで描く */
function drawDrawnDisc(
  ctx: CanvasRenderingContext2D,
  points: SharePoint[],
  cx: number,
  cy: number,
  radius: number,
) {
  const outline = points.length >= 3 ? points : circlePoints();

  // 床の影
  ctx.save();
  const shadow = ctx.createRadialGradient(cx, cy + radius * 0.98, radius * 0.1, cx, cy + radius * 0.98, radius * 1.02);
  shadow.addColorStop(0, "rgba(70,10,70,.30)");
  shadow.addColorStop(1, "rgba(70,10,70,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(cx, cy + radius * 0.98, radius * 0.92, radius * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 厚み（下にずらした同じ輪郭）
  const thickness = Math.max(8, radius * 0.055);
  ctx.save();
  ctx.translate(0, thickness);
  tracePath(ctx, outline, cx, cy, radius);
  const side = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
  side.addColorStop(0, "#c2188f");
  side.addColorStop(1, "#6f00a8");
  ctx.fillStyle = side;
  ctx.fill();
  ctx.restore();

  // 本体
  tracePath(ctx, outline, cx, cy, radius);
  const body = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
  body.addColorStop(0, "#fff066");
  body.addColorStop(0.38, "#ff8a1f");
  body.addColorStop(0.72, "#ff2e88");
  body.addColorStop(1, ACCENT_C);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, radius * 0.026);
  ctx.strokeStyle = "rgba(120,0,120,.45)";
  ctx.stroke();

  // 表面（ハイライト＋回転ライン）は輪郭の内側だけ
  ctx.save();
  tracePath(ctx, outline, cx, cy, radius);
  ctx.clip();

  const hl = ctx.createRadialGradient(
    cx - radius * 0.34,
    cy - radius * 0.44,
    radius * 0.04,
    cx - radius * 0.2,
    cy - radius * 0.3,
    radius * 1.0,
  );
  hl.addColorStop(0, "rgba(255,255,255,.78)");
  hl.addColorStop(0.45, "rgba(255,255,255,.18)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hl;
  ctx.fillRect(cx - radius * 1.4, cy - radius * 1.4, radius * 2.8, radius * 2.8);

  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,.60)";
  ctx.lineWidth = Math.max(4, radius * 0.024);
  for (let k = 0; k < 3; k++) {
    const r = radius * (0.34 + k * 0.23);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI * 0.88 + k * 0.16, -Math.PI * 0.18 + k * 0.16);
    ctx.stroke();
  }

  ctx.setLineDash([radius * 0.1, radius * 0.075]);
  ctx.strokeStyle = "rgba(255,255,255,.45)";
  ctx.lineWidth = Math.max(3, radius * 0.018);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.84, Math.PI * 0.08, Math.PI * 0.72);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * 結果カード PNG を作る。ブラウザ（Canvas と File がある環境）専用。
 */
export async function renderResultShareImage(
  points: SharePoint[],
  input: ShareResultInput,
  lang: Lang,
): Promise<{ blob: Blob; file: File }> {
  if (typeof document === "undefined") {
    throw new Error("renderResultShareImage needs a browser canvas");
  }
  const labels = shareLabels(lang);
  const w = SHARE_IMAGE_WIDTH;
  const h = SHARE_IMAGE_HEIGHT;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas is not available");

  drawBackground(ctx, w, h);

  // 右のディスクの奧に置く柔らかいリング（文字より先に引いて、カードに色がのらないように）
  const halo = ctx.createRadialGradient(918, 300, 205 * 0.78, 918, 300, 205 * 1.38);
  halo.addColorStop(0, "rgba(255,46,136,0)");
  halo.addColorStop(0.55, "rgba(255,46,136,.22)");
  halo.addColorStop(1, "rgba(255,46,136,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(918, 300, 205 * 1.38, 0, Math.PI * 2);
  ctx.fill();

  const left = 72;

  // タイトル
  ctx.fillStyle = "#2a1740";
  ctx.font = font(900, 40);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(labels.title, left, 104);

  // FLYING DISTANCE（字間を少し開ける）
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  try {
    spaced.letterSpacing = "7px";
  } catch {
    /* 未対応ブラウザはそのまま */
  }
  ctx.fillStyle = "#8a7a9a";
  ctx.font = font(800, 19);
  ctx.fillText(labels.kicker, left, 140);
  try {
    spaced.letterSpacing = "0px";
  } catch {
    /* noop */
  }

  // 飛距離（大きく、アクセントのグラデーション）
  const distFont = font(900, 132);
  ctx.font = distFont;
  const distText = input.distance.toFixed(1);
  const distWidth = ctx.measureText(distText).width;
  const distGrad = ctx.createLinearGradient(left, 190, left + distWidth + 40, 330);
  distGrad.addColorStop(0, ACCENT_A);
  distGrad.addColorStop(0.55, ACCENT_B);
  distGrad.addColorStop(1, ACCENT_C);
  ctx.fillStyle = distGrad;
  ctx.fillText(distText, left, 300);
  const mFont = font(900, 54);
  ctx.font = mFont;
  ctx.fillStyle = "#2a1740";
  ctx.fillText("m", left + distWidth + 6, 300);

  // ランクバッジ
  const badgeR = 46;
  const badgeCx = Math.min(left + distWidth + 40 + 22 + badgeR, 700);
  const badgeCy = 246;
  const badgeGrad = ctx.createLinearGradient(badgeCx - badgeR, badgeCy - badgeR, badgeCx + badgeR, badgeCy + badgeR);
  badgeGrad.addColorStop(0, ACCENT_A);
  badgeGrad.addColorStop(0.55, ACCENT_B);
  badgeGrad.addColorStop(1, ACCENT_C);
  ctx.beginPath();
  ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = badgeGrad;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = font(900, 15);
  ctx.fillText(labels.rankLabel, badgeCx, badgeCy - 12);
  ctx.font = font(900, 46);
  ctx.fillText(input.rank, badgeCx, badgeCy + 30);
  ctx.textAlign = "left";

  // 自己ベスト更新バッジ
  if (input.isRecord) {
    const pillW = 300;
    const pillH = 46;
    const pillY = 322;
    roundRect(ctx, left, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = "rgba(255,255,255,.94)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,46,136,.35)";
    ctx.stroke();
    ctx.fillStyle = ACCENT_B;
    ctx.font = font(900, 22);
    ctx.textAlign = "center";
    ctx.fillText(labels.record, left + pillW / 2, pillY + 31);
    ctx.textAlign = "left";
  }

  // 形状・回転・加速度の3項目
  const cards = [
    { label: labels.shape, value: input.shapeGrade },
    { label: labels.spin, value: formatSpin(input.spin, lang) },
    { label: labels.accel, value: input.accelLabel },
  ];
  const cardW = 196;
  const cardH = 84;
  const cardGap = 12;
  const cardY = 408;
  cards.forEach((card, i) => {
    const x = left + i * (cardW + cardGap);
    roundRect(ctx, x, cardY, cardW, cardH, 20);
    ctx.fillStyle = "rgba(255,255,255,.82)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(42,23,64,.10)";
    ctx.stroke();

    ctx.fillStyle = "#8a7a9a";
    ctx.font = font(800, 17);
    ctx.fillText(card.label, x + 20, cardY + 31);

    ctx.fillStyle = "#2a1740";
    const valueFont = font(900, card.value.length > 8 ? 21 : 30);
    ctx.font = valueFont;
    ctx.fillText(card.value, x + 20, cardY + 67);
  });

  // サイトURL
  ctx.fillStyle = ACCENT_B;
  ctx.beginPath();
  ctx.arc(left + 5, 566, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6d5c80";
  ctx.font = font(700, 23);
  ctx.fillText(SITE_HOST, left + 22, 574);

  // 右側のディスク（実際に描いた形）
  drawDrawnDisc(ctx, points, 918, 300, 205);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
  if (!blob) throw new Error("Could not encode the share image");
  const file = new File([blob], SHARE_FILE_NAME, { type: "image/png" });
  return { blob, file };
}

/** 画像を端末に保存する（ダウンロード）。ブラウザ専用。 */
export function downloadShareFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name || SHARE_FILE_NAME;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
