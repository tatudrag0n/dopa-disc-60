/**
 * ディスク形状の物理評価。
 *
 * 描いた閉曲線を「円盤の平面形（planform）」とみなし、次の物理量を求める:
 *  - 面積 A / 周長 P / 等価半径 R
 *  - 重心（面積重心）と、図形中心からのずれ（質量バランス）
 *  - 断面二次モーメント（重心まわり）とその主軸 → 回転対称性
 *  - 等周比 4πA/P²（縁の滑らかさ・円盤らしさ）
 *
 * そこから揚力係数 CL / 抗力係数 CD を見積もり、揚抗比 L/D を
 * 形状の「飛び効率」として使う。丸さだけでは判断しない。
 */

export interface Pt {
  x: number;
  y: number;
}

export interface DiscPhysics {
  /** 正規化面積（maxD=1 基準） */
  area: number;
  /** 周長 */
  perimeter: number;
  /** 等価半径 sqrt(A/π) */
  radius: number;
  /** 等周比 4πA/P²（1 = 真円） */
  roundness: number;
  /** 回転対称性 λmin/λmax（1 = 真円、小さいほど細長い） */
  symmetry: number;
  /** 重心の偏り（0 = 中心、1 = 大きく偏る） */
  offset: number;
  /** 質量バランス 1-offset（1 が良い） */
  balance: number;
  /** 外接円に対する面積充填率（1 = むだなく満たす） */
  fill: number;
  /** 揚力係数（近似） */
  lift: number;
  /** 抗力係数（近似） */
  drag: number;
  /** 揚抗比 L/D */
  glide: number;
  /** 飛び効率 0..100（distanceFor に渡す値） */
  efficiency: number;
  /** 最も弱い要素 */
  weakest: "symmetry" | "roundness" | "fill" | "balance" | "none";
  /** グレード */
  grade: "S" | "A" | "B" | "C";
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** 多角形の面積・重心・断面二次モーメント（原点まわり） */
function polygonMoments(pts: Pt[]) {
  const n = pts.length;
  let a2 = 0; // 2A
  let cx = 0;
  let cy = 0;
  let ixx = 0;
  let iyy = 0;
  let ixy = 0;

  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    ixx += (p.y * p.y + p.y * q.y + q.y * q.y) * cross;
    iyy += (p.x * p.x + p.x * q.x + q.x * q.x) * cross;
    ixy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * cross;
  }

  const area = a2 / 2;
  const centroid = area === 0 ? { x: 0, y: 0 } : { x: cx / (3 * a2), y: cy / (3 * a2) };

  // 重心まわりへ平行軸の定理で移す
  const Ixx = (ixx / 12) - area * centroid.y * centroid.y;
  const Iyy = (iyy / 12) - area * centroid.x * centroid.x;
  const Ixy = (ixy / 24) - area * centroid.x * centroid.y;

  return { area, centroid, Ixx, Iyy, Ixy };
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
 * 形状を物理量として評価する。
 * @param pts 閉じた多角形（重心を原点に、最大径で正規化済みを想定）
 */
export function analyzeDisc(pts: Pt[]): DiscPhysics {
  const { area: signedArea, centroid, Ixx, Iyy, Ixy } = polygonMoments(pts);
  const area = Math.abs(signedArea);
  const perimeter = Math.max(1e-6, perimeterOf(pts));
  const radius = Math.sqrt(Math.max(area, 1e-9) / Math.PI);

  // 縁の滑らかさ（等周比）。真円で 1、ぎざぎざ/細長いほど小さい
  const roundness = clamp((4 * Math.PI * area) / (perimeter * perimeter), 0, 1);

  // 断面二次モーメントの主値 → 回転対称性
  const mean = (Ixx + Iyy) / 2;
  const diff = Math.hypot((Ixx - Iyy) / 2, Ixy);
  const lMax = mean + diff;
  const lMin = mean - diff;
  const symmetry = lMax > 1e-9 ? clamp(lMin / lMax, 0, 1) : 0;

  // 重心の偏り（図形の外接矩形中心からのずれ）。ぶれる原因
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const boxCx = (minX + maxX) / 2;
  const boxCy = (minY + maxY) / 2;
  const boxR = Math.max(1e-6, Math.hypot(maxX - minX, maxY - minY) / 2);
  const offset = clamp(Math.hypot(centroid.x - boxCx, centroid.y - boxCy) / boxR, 0, 1);
  const balance = 1 - offset;

  // 最小外接円（重心からの最大半径）に対する面積充填率。
  // すかすかの形は揚力を生まない。
  let maxR = 1e-6;
  for (const p of pts) {
    const d = Math.hypot(p.x - centroid.x, p.y - centroid.y);
    if (d > maxR) maxR = d;
  }
  const fill = clamp(area / (Math.PI * maxR * maxR), 0, 1);

  // 揚力・抗力の近似
  //   揚力: 平面形が回転対称で、円盤らしく、面積が詰まっているほど大きい
  //   抗力: ざらつき・細長さ・すかすかさで増える
  const symFactor = 0.45 + 0.55 * symmetry;
  const lift = 0.95 * symFactor * (0.5 + 0.5 * roundness) * (0.35 + 0.65 * fill);
  const drag =
    0.08 +
    0.32 * (1 - roundness) +
    0.20 * (1 - fill) +
    0.16 * (1 - symmetry) +
    0.10 * offset;
  const glide = lift / Math.max(0.05, drag);

  // 理想的な円盤での L/D を 1 として正規化し、
  // 揚抗比を主軸に、バランスと対称性を“掛け算のペナルティ”として効かせる。
  // （足し算にすると、どんな形でも下限がついて星形でも高得点になってしまう）
  const idealGlide = 0.95 / 0.08;
  const glideNorm = clamp(glide / idealGlide, 0, 1);
  const efficiency = Math.round(
    clamp(Math.sqrt(glideNorm) * (0.55 + 0.45 * balance) * (0.6 + 0.4 * symmetry) * 100, 3, 100),
  );

  // 最も弱い要素を特定する（結果画面のヒント用）
  const factors: [DiscPhysics["weakest"], number][] = [
    ["symmetry", symmetry],
    ["roundness", roundness],
    ["fill", fill],
    ["balance", balance],
  ];
  factors.sort((a, b) => a[1] - b[1]);
  // どの要素も十分なら「弱点なし」
  const weakest: DiscPhysics["weakest"] = factors[0][1] >= 0.85 ? "none" : factors[0][0];

  const grade: DiscPhysics["grade"] =
    efficiency >= 82 ? "S" : efficiency >= 65 ? "A" : efficiency >= 48 ? "B" : "C";

  return {
    area,
    perimeter,
    radius,
    roundness,
    symmetry,
    offset,
    balance,
    fill,
    lift,
    drag,
    glide,
    efficiency,
    weakest,
    grade,
  };
}
