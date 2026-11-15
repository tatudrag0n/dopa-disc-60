/**
 * ディスク形状の物理評価。
 *
 * 「円に近いほど偉い」ではなく、回転する平板として何が効くかで評価する。
 *
 * 回転する円盤がぶれるのは、平面形が回転対称でないため
 * 空力中心が回転に伴って動き、ロール方向の周期的なトルクが立つから。
 * その大きさは半径方向の分布 r(θ) の**低次ハーモニクス**で決まる。
 *  - n=1（片側が膨らむ）→ 激しくぶれる
 *  - n=2（楕円）        → ぶれやすい
 *  - n=3,4,6（多角形）  → 回転対称なので比較的安定
 *  - n≥5（細かい凹凸）  → ぶれより抗力（ざらつき）に効く
 *
 * そこで r(θ) をフーリエ分解し、
 *   低次（n=1,2） → ぐらつき（wobble）
 *   高次（n≥5）   → 面のざらつき（抗力）
 * として分離して評価する。円はその一例（全次数ゼロ）にすぎない。
 */

export interface Pt {
  x: number;
  y: number;
}

export type WeakPoint = "wobble" | "roughness" | "balance" | "area" | "closure" | "none";

export interface DiscPhysics {
  area: number;
  perimeter: number;
  radius: number;
  /** 等周比 4πA/P²（1 = 真円）。抗力の目安 */
  roundness: number;
  /** 半径方向の低次非対称（n=1,2）の強さ。0 が理想 */
  wobbleAmount: number;
  /** 面のざらつき（n≥5 の高周波成分） */
  roughnessAmount: number;
  /** ぶれにくさ 1..0 */
  wobble: number;
  /** 滑らかさ 1..0 */
  smoothness: number;
  /** 重心の偏り 0..1 */
  offset: number;
  /** 質量バランス 1-offset */
  balance: number;
  /** 外接円に対する面積の充填率 0..1 */
  fill: number;
  /** 面積の妥当さ 1..0（小さすぎ・大きすぎを減点） */
  areaFactor: number;
  /** 揚力係数（近似） */
  lift: number;
  /** 抗力係数（近似） */
  drag: number;
  /** 揚抗比 L/D */
  glide: number;
  /** 飛び効率 0..100 */
  efficiency: number;
  weakest: WeakPoint;
  grade: "S" | "A" | "B" | "C";
  /** デバッグ・表示用: 半径分布のハーモニクス振幅（平均半径で正規化） */
  harmonics: number[];
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function polygonArea(pts: Pt[]): number {
  let a2 = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a2 += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a2) / 2;
}

function centroidOf(pts: Pt[]): Pt {
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (a2 === 0) return { x: 0, y: 0 };
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

function perimeterOf(pts: Pt[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/**
 * 重心まわりの半径分布をフーリエ分解し、各次数の振幅（平均半径で正規化）を返す。
 * 形状を等角度でサンプリングし直してから分解する。
 */
function radiusHarmonics(pts: Pt[], centroid: Pt, count = 64, maxOrder = 8): number[] {
  const samples: number[] = [];
  for (let i = 0; i < count; i += 1) {
    // ポリゴンを周長で等分割してサンプリング
    const t = (i / count) * pts.length;
    const i0 = Math.floor(t) % pts.length;
    const i1 = (i0 + 1) % pts.length;
    const f = t - Math.floor(t);
    const x = pts[i0].x + (pts[i1].x - pts[i0].x) * f - centroid.x;
    const y = pts[i0].y + (pts[i1].y - pts[i0].y) * f - centroid.y;
    samples.push(Math.hypot(x, y));
  }
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  if (mean < 1e-9) return new Array(maxOrder + 1).fill(0);

  const amps: number[] = [0]; // n=0 は平均半径なので 0 として扱う
  for (let n = 1; n <= maxOrder; n += 1) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const th = (i / samples.length) * Math.PI * 2;
      re += samples[i] * Math.cos(n * th);
      im += samples[i] * Math.sin(n * th);
    }
    re /= samples.length;
    im /= samples.length;
    amps.push((Math.hypot(re, im) * 2) / mean);
  }
  return amps;
}

/**
 * 形状を物理量として評価する。
 * @param pts 閉じた多角形（重心まわり・最大径 1 程度に正規化済みを想定）
 */
export function analyzeDisc(pts: Pt[]): DiscPhysics {
  const centroid = centroidOf(pts);
  const area = Math.max(1e-9, polygonArea(pts));
  const perimeter = Math.max(1e-6, perimeterOf(pts));
  const radius = Math.sqrt(area / Math.PI);
  const roundness = clamp((4 * Math.PI * area) / (perimeter * perimeter), 0, 1);

  // --- 半径分布のハーモニクス ---
  const h = radiusHarmonics(pts, centroid);
  const lowOrder = (h[1] ?? 0) * 1.6 + (h[2] ?? 0) * 1.0; // ぐらつきに効く
  const highOrder = (h[5] ?? 0) + (h[6] ?? 0) + (h[7] ?? 0) + (h[8] ?? 0); // ざらつき
  const wobbleAmount = clamp(lowOrder, 0, 2);
  const roughnessAmount = clamp(highOrder, 0, 2);
  const wobble = clamp(1 - wobbleAmount, 0, 1);
  const smoothness = clamp(1 - roughnessAmount * 2.2, 0, 1);

  // --- 重心の偏り ---
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 1e-6;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    const d = Math.hypot(p.x - centroid.x, p.y - centroid.y);
    if (d > maxR) maxR = d;
  }
  const boxR = Math.max(1e-6, Math.hypot(maxX - minX, maxY - minY) / 2);
  const offset = clamp(
    Math.hypot(centroid.x - (minX + maxX) / 2, centroid.y - (minY + maxY) / 2) / boxR,
    0,
    1,
  );
  const balance = 1 - offset;

  // --- 面積の妥当さ（小さすぎると揚力不足、外接円を超えることはない） ---
  const fill = clamp(area / (Math.PI * maxR * maxR), 0, 1);
  const areaFactor = clamp(0.35 + 0.65 * fill, 0, 1);

  // --- 揚力・抗力 ---
  // 揚力: 面積と、回転対称で滑らかなこと
  // 抗力: 等周比の悪化（ざらつき）＋高次ハーモニクス＋非対称
  const lift = 0.95 * areaFactor * (0.55 + 0.45 * smoothness);
  const drag =
    0.08 +
    0.28 * (1 - roundness) +
    0.22 * (1 - smoothness) +
    0.20 * wobbleAmount * 0.5 +
    0.10 * offset;
  const glide = lift / Math.max(0.05, drag);

  const idealGlide = 0.95 / 0.08;
  const glideNorm = clamp(glide / idealGlide, 0, 1);

  // 掛け算で効かせる（足し算だと下限がついてどんな形でも高得点になる）
  const efficiency = Math.round(
    clamp(Math.sqrt(glideNorm) * (0.55 + 0.45 * balance) * (0.35 + 0.65 * wobble) * 100, 3, 100),
  );

  // 最も弱い要素
  const factors: [WeakPoint, number][] = [
    ["wobble", wobble],
    ["roughness", smoothness],
    ["balance", balance],
    ["area", areaFactor],
  ];
  factors.sort((a, b) => a[1] - b[1]);
  const weakest: WeakPoint = factors[0][1] >= 0.8 ? "none" : factors[0][0];

  const grade: DiscPhysics["grade"] =
    efficiency >= 82 ? "S" : efficiency >= 65 ? "A" : efficiency >= 45 ? "B" : "C";

  return {
    area,
    perimeter,
    radius,
    roundness,
    wobbleAmount,
    roughnessAmount,
    wobble,
    smoothness,
    offset,
    balance,
    fill,
    areaFactor,
    lift,
    drag,
    glide,
    efficiency,
    weakest,
    grade,
    harmonics: h,
  };
}
