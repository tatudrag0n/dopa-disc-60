import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Trophy, RotateCcw, Home, ArrowRight, RotateCw, Sparkles, Share2, Download } from 'lucide-react';
import { getLang, rankLabel, tr, useI18n } from './lib/i18n';
import { buildShareText, buildXIntentUrl, downloadShareFile, renderResultShareImage, type ShareResultInput } from './lib/shareResult';
import { analyzeDisc, minimumEnclosingCircle } from './lib/discPhysics';
import { normalizeSpin, overallGrade, shapeGrade } from './lib/grading';
import { gameAudio, type SfxName } from './lib/gameAudio';
import { requestPlayTicket, takePlayTicket } from './lib/playGate';
import { clampSpeed, computeRealtimeSpin, distanceFor } from './shared/scoring';
import { ownsPointer } from './shared/pointer';

type Screen = 'start' | 'playing' | 'result';
type ScoreRow = { best: number; total?: number; rank: string; playedAt: string; name?: string; isMe?: boolean };
type Phase = 'draw' | 'aim' | 'flying' | 'landed';
type ShapeWeakest = 'wobble' | 'roughness' | 'balance' | 'area' | 'closure' | 'none'
type ThrowResult = { distance: number; total: number; shapeGrade: string; shapeWeakest?: ShapeWeakest; shapePhysics?: import('./lib/discPhysics').DiscPhysics; balance: number; spin: number; spinSpeed: number; spinCleanliness: number; swipeSpeed: number; swipeNorm: number; isRecord?: boolean };
type Pt = { x: number; y: number };

async function callApi(action: string, args: Record<string, unknown>) {
  const res = await fetch('actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, args }) });
  if (!res.ok) throw new Error(`${tr('netRetry')} (${res.status})`);
  const json = await res.json();
  if (json?.error) throw new Error(String(json.error));
  return json.data;
}
function randomWind() {
  const dir = Math.random() < 0.5 ? -1 : 1;
  const speed = Math.round((0.5 + Math.random() * 3.5) * 10) / 10;
  return dir * speed;
}
function fmt(m: number) { return `${m.toFixed(1)}m`; }
function fmtScore(m: number) { return `${m.toFixed(1)}${tr('point')}`; }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const wrapAngle = (a: number) => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};
function pseudo(i: number, seed = 1) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const CTA = 'calm-btn flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-8 py-4 text-[18px] font-black text-white';
function swipeLabel(norm: number) { return norm >= 0.75 ? tr('accel.fast') : norm >= 0.45 ? tr('accel.justRight') : tr('accel.slow'); }
/** Web Share API で「ファイル付き」を共有できるか（スマホの共有シート） */
function canShareFiles(file: File): boolean {
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try { return nav.canShare({ files: [file] }); } catch { return false; }
}
function mobileFileShareSupported(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
    if (typeof File === 'undefined') return false;
    const probe = new File([new Uint8Array([137, 80, 78, 71])], 'disc-result.png', { type: 'image/png' });
    return canShareFiles(probe);
  } catch { return false; }
}
function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError');
}
function shapeWeakLabel(w?: ShapeWeakest) {
  switch (w) {
    case 'wobble': return tr('shapeWeak.wobble');
    case 'roughness': return tr('shapeWeak.roughness');
    case 'area': return tr('shapeWeak.area');
    case 'balance': return tr('shapeWeak.balance');
    default: return tr('shapeWeak.none');
  }
}
function gradeForBalance(balance: number) {
  return shapeGrade(balance);
}
function circlePoints(): Pt[] {
  return Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
}
function resampleClosedLoop(raw: Pt[], count = 48): Pt[] {
  if (raw.length === 0) return [];
  const closed = [...raw, raw[0]];
  const cum: number[] = [0];
  for (let i = 1; i < closed.length; i++) cum.push(cum[i - 1] + Math.hypot(closed[i].x - closed[i - 1].x, closed[i].y - closed[i - 1].y));
  const total = cum[cum.length - 1] || 1;
  const out: Pt[] = [];
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const seg = Math.max(1, cum[i] - cum[i - 1]);
    const t = clamp((target - cum[i - 1]) / seg, 0, 1);
    out.push({ x: closed[i - 1].x + (closed[i].x - closed[i - 1].x) * t, y: closed[i - 1].y + (closed[i].y - closed[i - 1].y) * t });
  }
  return out;
}
function analyzeShape(raw: Pt[]) {
  const n = raw.length;
  // 見た目の中心＝最小外接円の中心を原点にし、その半径で正規化する。
  // 打点の単純平均だと、ゆっくり描いた側に点が寄って原点がずれてしまう。
  const mec = minimumEnclosingCircle(raw);
  const centered = raw.map((p) => ({ x: p.x - mec.x, y: p.y - mec.y }));
  const maxD = Math.max(1, mec.r);
  // Keep the traced outline exactly as drawn — only centre it, scale it
  // to a common size, and resample it evenly. No circular correction.
  const normalized = centered.map((p) => ({ x: p.x / maxD, y: p.y / maxD }));
  const points = resampleClosedLoop(normalized, 48);
  const gap = Math.hypot(raw[0].x - raw[n - 1].x, raw[0].y - raw[n - 1].y) / maxD;

  // 形状を物理量として評価する（丸さだけでは決めない）。
  // 面積・周長・断面二次モーメントの主軸・重心の偏りから揚抗比を出し、
  // それを飛び効率として使う。
  const physics = analyzeDisc(points);

  // 閉じていない形は空気が漏れる → 効率を落とす
  const closureLoss = clamp(gap / 0.25, 0, 1) * 40;
  const balance = Math.round(clamp(physics.efficiency - closureLoss, 5, 100));
  const grade = gradeForBalance(balance);

  const xs = raw.map((q) => q.x);
  const ys = raw.map((q) => q.y);
  const bboxW = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const bboxH = Math.max(1, Math.max(...ys) - Math.min(...ys));
  return { points, balance, grade, drawnRadius: maxD, bboxW, bboxH, physics };
}

export default function App() {
  useI18n(); // 言語の切り替えで再描画させるために購読する
  const meName = typeof window !== 'undefined' ? (window as unknown as { __dopaMe?: string }).__dopaMe : undefined;
  const isMe = (n?: string) => Boolean(meName) && n === meName;
  const [screen, setScreen] = useState<Screen>('start');
  const [muted, setMuted] = useState(false);
  const [highScores, setHighScores] = useState<ScoreRow[]>([]);
  const [myRecord, setMyRecord] = useState<ScoreRow | null>(null);
  const [apiNote, setApiNote] = useState('');
  const [best, setBest] = useState(0);
  const [phase, setPhase] = useState<Phase>('draw');
  const [wind, setWind] = useState(0);
  const [lastThrow, setLastThrow] = useState<ThrowResult | null>(null);
  const [showHow, setShowHow] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [result, setResult] = useState<{ best: number; total: number; rank: string; throw: ThrowResult | null }>({ best: 0, total: 0, rank: 'D', throw: null });
  const [landedRecord, setLandedRecord] = useState(false);
  const [displayedTotal, setDisplayedTotal] = useState(0);
  const [rankShown, setRankShown] = useState(false);
  const [shapeLocked, setShapeLocked] = useState(false);
  const [shapeBalance, setShapeBalance] = useState(0);
  const [shapeGrade, setShapeGrade] = useState('C');
  const [shapeSize, setShapeSize] = useState(0);
  const [aimX, setAimX] = useState(0);
  const [aimY, setAimY] = useState(0);
  const [swipeSpeedShown, setSwipeSpeedShown] = useState(0);
  const [spinShown, setSpinShown] = useState(0);
  const [spinSpeedShown, setSpinSpeedShown] = useState(0);
  const [spinCleanlinessShown, setSpinCleanlinessShown] = useState(0);
  const [spinHint, setSpinHint] = useState('');
  const [spinDir, setSpinDir] = useState(0);
  const [momentumLive, setMomentumLive] = useState(false);
  const [drawHint, setDrawHint] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [shareBusy, setShareBusy] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const audioRef = useRef<{ ctx: AudioContext | null; muted: boolean }>({ ctx: null, muted: false });
  const discRef = useRef({ z: 0, y: 0.4, x: 0, vz: 0, vy: 0, vx: 0, active: false, rot: 0, trail: [] as { z: number; y: number; x: number }[] });
  const rollRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, active: false });
  const camRef = useRef(0);
  const camPushRef = useRef(0);
  const shakeRef = useRef({ amp: 0, t: 0 });
  const zoomRef = useRef(1);
  const windRef = useRef(0);
  const phaseRef = useRef<Phase>('draw');
  const runIdRef = useRef(0);
  const landedAtRef = useRef(0);
  const landedXRef = useRef(0);
  const shapeRef = useRef<{ points: Pt[]; balance: number; grade: string; drawnRadius: number; bboxW: number; bboxH: number; physics?: import('./lib/discPhysics').DiscPhysics }>({ points: circlePoints(), balance: 100, grade: 'S', drawnRadius: 70, bboxW: 140, bboxH: 140 });
  // pointerId: 最初に触れた指。2本目以降の指のイベントは無視する
  const strokeRef = useRef<{ active: boolean; pts: Pt[]; pointerId: number | null }>({ active: false, pts: [], pointerId: null });
  const aimRef = useRef({ x: 0, y: 0, active: false, pointerId: null as number | null, lastX: 0, lastY: 0, startY: 0, hist: [] as { x: number; y: number; t: number }[], vx: 0, vy: 0, discRot: 0, trail: [] as { x: number; y: number }[] });
  const spinRef = useRef({ active: false, pointerId: null as number | null, pts: [] as { x: number; y: number; t: number }[], startTime: 0, lastMoveAt: 0, speed: 0, cleanliness: 0, spin: 0 });
  const flightRef = useRef({ balance: 100, grade: 'C', spin: 0, spinSigned: 0, spinSpeed: 0, spinCleanliness: 0, swipeSpeed: 0, swipeNorm: 0, desiredDistance: 0, wobble: 0 });
  const drawRotRef = useRef(0);
  const globalBestRef = useRef(0);
  const dustRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; max: number; r: number }[]>([]);
  const confettiRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number }[]>([]);
  const flashRef = useRef(0);

  const setPhaseBoth = useCallback((p: Phase) => { phaseRef.current = p; setPhase(p); }, []);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current.ctx) {
      try { audioRef.current.ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { audioRef.current.ctx = null; }
    }
    if (audioRef.current.ctx?.state === 'suspended') audioRef.current.ctx.resume().catch(() => {});
  }, []);
  const tone = useCallback((freq: number, end: number, dur: number, type: OscillatorType, gain = 0.05, delay = 0) => {
    if (audioRef.current.muted) return;
    ensureAudio();
    const ctx = audioRef.current.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, end), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  }, [ensureAudio]);
  const sfx = useCallback((name: SfxName, param = 0) => {
    gameAudio.sfx(name, param);
  }, []);

  const loadScores = useCallback(async () => {
    try {
      const data = await callApi('records.list', { collection: 'flying_disc_distance_scores' });
      const rows: ScoreRow[] = (data?.records || []).map((r: any) => r.value as ScoreRow).filter((v: any) => typeof v?.best === 'number').sort((a: ScoreRow, b: ScoreRow) => (b.total ?? b.best) - (a.total ?? a.best)).slice(0, 50);
      setHighScores(rows); setApiNote('');
      // 自己ベストは本人の行から取る（ランキング1位ではない）。旧レスポンスなら名前で拾う
      const mine = (data?.myRecord as ScoreRow | null) ?? rows.find((r: ScoreRow) => r.isMe || isMe(r.name)) ?? null;
      setMyRecord(mine);
      if (rows.length) globalBestRef.current = rows[0].total ?? rows[0].best;
    } catch { setApiNote(tr('loadingBest')); }
  }, [meName]);
  useEffect(() => { loadScores(); }, [loadScores]);
  // 名前変更など、外から表示を作り直したいとき
  useEffect(() => {
    const onRefresh = () => { void loadScores(); };
    window.addEventListener('dopa:refresh-scores', onRefresh);
    return () => window.removeEventListener('dopa:refresh-scores', onRefresh);
  }, [loadScores]);

  useEffect(() => {
    if (screen !== 'result') return;
    setDisplayedTotal(0); setRankShown(false);
    const target = result.total;
    if (target <= 0) { setRankShown(true); return; }
    const start = performance.now();
    const dur = 1100;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayedTotal(target * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else { setRankShown(true); }
    };
    raf = requestAnimationFrame(step);
    const rankTimer = window.setTimeout(() => setRankShown(true), dur + 80);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(rankTimer); };
  }, [screen, result.total]);

  useEffect(() => {
    if (screen !== 'playing' || phase !== 'landed') return;
    const t = window.setTimeout(() => { nextButtonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60);
    return () => window.clearTimeout(t);
  }, [screen, phase]);

  const setupThrow = useCallback(() => {
    discRef.current = { z: 0, y: 0.4, x: 0, vz: 0, vy: 0, vx: 0, active: false, rot: 0, trail: [] };
    rollRef.current = { x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, active: false };
    camRef.current = 0;
    dustRef.current = [];
    shapeRef.current = { points: circlePoints(), balance: 100, grade: 'S', drawnRadius: 70, bboxW: 140, bboxH: 140 };
    strokeRef.current = { active: false, pts: [], pointerId: null };
    aimRef.current = { x: 0, y: 0, active: false, pointerId: null, lastX: 0, lastY: 0, startY: 0, hist: [], vx: 0, vy: 0, discRot: 0, trail: [] };
    spinRef.current = { active: false, pointerId: null, pts: [], startTime: 0, lastMoveAt: 0, speed: 0, cleanliness: 0, spin: 0 };
    flightRef.current = { balance: 100, grade: 'C', spin: 0, spinSigned: 0, spinSpeed: 0, spinCleanliness: 0, swipeSpeed: 0, swipeNorm: 0, desiredDistance: 0, wobble: 0 };
    setShapeLocked(false); setShapeBalance(0); setShapeGrade('C'); setShapeSize(0); setAimX(0); setAimY(0); setSwipeSpeedShown(0); setSpinShown(0); setSpinSpeedShown(0); setSpinCleanlinessShown(0); setMomentumLive(false); setSpinHint(''); setDrawHint('');
  }, []);

  const finalizeShape = useCallback(() => {
    const pts = strokeRef.current.pts;
    strokeRef.current.active = false;
    strokeRef.current.pointerId = null;
    if (pts.length < 8) { strokeRef.current.pts = []; setDrawHint(tr('drawSmall')); return; }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len < 60) { strokeRef.current.pts = []; setDrawHint(tr('drawSmall')); return; }
    const analyzed = analyzeShape(pts);
    shapeRef.current = { points: analyzed.points, balance: analyzed.balance, grade: analyzed.grade, drawnRadius: analyzed.drawnRadius, bboxW: analyzed.bboxW, bboxH: analyzed.bboxH, physics: analyzed.physics };
    setShapeBalance(analyzed.balance); setShapeGrade(analyzed.grade); setShapeSize(Math.round(analyzed.drawnRadius * 2)); setShapeLocked(true); gameAudio.sfx('shapeDone'); setDrawHint('');
    sfx('bonus');
    try { navigator.vibrate?.(12); } catch {}
  }, [sfx]);

  const updateLiveSpin = useCallback(() => {
    const s = spinRef.current;
    if (!s.active) return;
    const r = computeRealtimeSpin(s.pts);
    if (!r) return;
    // Smooth the spin so it never jumps: ease toward the freshly measured
    // (signed) value instead of replacing it. Sign carries the direction.
    s.spin = s.spin + (r.spin - s.spin) * 0.35;
    s.speed = s.speed + (r.speed - s.speed) * 0.35;
    s.cleanliness = r.cleanliness;
    s.lastMoveAt = performance.now();
    setSpinSpeedShown(s.speed * 1000);
    setSpinCleanlinessShown(r.cleanliness);
    setSpinShown(Math.abs(s.spin));
    if (Math.abs(s.spin) > 60) setSpinDir(r.direction);
    setMomentumLive(true);
  }, []);

  useEffect(() => {
    if (screen !== 'playing' || phase !== 'aim') return;
    const id = window.setInterval(() => {
      const s = spinRef.current;
      if (Math.abs(s.spin) <= 0) { setMomentumLive(false); return; }
      const idleMs = performance.now() - (s.lastMoveAt || 0);
      if (idleMs < 260) return;
      const factor = Math.pow(0.72, 0.1);
      s.spin = s.spin * factor;
      s.speed = Math.max(0, s.speed * factor);
      setSpinShown(Math.abs(s.spin));
      setSpinSpeedShown(s.speed * 1000);
      setMomentumLive(false);
      if (Math.abs(s.spin) < 1) { s.spin = 0; s.speed = 0; setSpinShown(0); setSpinSpeedShown(0); }
    }, 100);
    return () => window.clearInterval(id);
  }, [screen, phase]);

  const startGame = useCallback(async () => {
    // プレイ前に毎回ロボット確認（Turnstile）を通す
    const allowed = await requestPlayTicket();
    if (!allowed) {
      // 無言で止まると「押しても何も起きない」に見えるので理由を出す
      setApiNote(tr('playBlocked'));
      return;
    }
    setApiNote('');
    ensureAudio(); gameAudio.start(); sfx('click');
    runIdRef.current = Date.now();
    landedAtRef.current = 0; landedXRef.current = 0;
    const w = randomWind(); windRef.current = w;
    setWind(w); setLastThrow(null); setBest(0); setLandedRecord(false); setDisplayedTotal(0); setRankShown(false); confettiRef.current = []; setPhaseBoth('draw');
    setIsNewBest(false); setScreen('playing');
    setShareNote(''); setShareBusy(false);
    setupThrow();
  }, [ensureAudio, sfx, setPhaseBoth, setupThrow]);

  const goToAim = useCallback(() => {
    if (!shapeLocked) return;
    sfx('click');
    const w = wrapRef.current?.clientWidth || 400;
    const h = wrapRef.current?.clientHeight || 480;
    const startX = w / 2;
    const startY = h * 0.62;
    aimRef.current.x = startX;
    aimRef.current.y = startY;
    aimRef.current.lastX = startX;
    aimRef.current.lastY = startY;
    aimRef.current.startY = startY;
    aimRef.current.hist = [{ x: startX, y: startY, t: performance.now() }];
    aimRef.current.trail = [];
    aimRef.current.vx = 0; aimRef.current.vy = 0;
    aimRef.current.discRot = 0;
    spinRef.current = { active: false, pointerId: null, pts: [], startTime: 0, lastMoveAt: 0, speed: 0, cleanliness: 0, spin: 0 };
    setSpinShown(0); setSpinSpeedShown(0); setSpinCleanlinessShown(0); setMomentumLive(false); setSpinHint(''); setSpinDir(0);
    setAimX(0); setAimY(0.24);
    setPhaseBoth('aim');
  }, [sfx, setPhaseBoth, shapeLocked]);

  const finishGame = useCallback(async () => {
    const t = lastThrow;
    if (!t) return;
    const finalBest = t.distance;
    const finalTotal = t.total;
    const prevTotal = myRecord ? (myRecord.total ?? myRecord.best) : 0;
    const newBest = finalTotal > prevTotal && finalTotal > 0;
    setIsNewBest(newBest);
    const overall = overallGrade(
    clamp(t.balance / 100, 0, 1),
    normalizeSpin(t.spin),
    clamp(t.swipeNorm, 0, 1),
  );
  setResult({ best: finalBest, total: finalTotal, rank: overall, throw: t });
    setScreen('result');
    try {
      if (finalTotal > 0) {
        const key = `distance-${runIdRef.current}-${finalTotal}`;
        await callApi('records.create', { collection: 'flying_disc_distance_scores', value: { best: finalBest, total: finalTotal, rank: overall, playedAt: new Date().toISOString(), telemetry: { balance: t.balance, spin: t.spin, swipeNorm: t.swipeNorm } }, idempotency_key: key, play_ticket: takePlayTicket() });
        await loadScores();
      }
    } catch { setApiNote(tr('savePending')); }
    if (newBest) sfx('best');
  }, [myRecord, loadScores, sfx, lastThrow]);

  const onLand = useCallback((distance: number) => {
    const f = flightRef.current;
    const rounded = Math.round((f.desiredDistance > 0 ? f.desiredDistance : distance) * 10) / 10;
    const total = rounded;
    const isRecord = globalBestRef.current > 0 ? total > globalBestRef.current : false;
    if (isRecord) globalBestRef.current = total;
    setLandedRecord(isRecord);
    if (isRecord) {
      const colors = ['#ffe600', '#ffffff', '#00e676', '#00e5ff', '#ff2e88', '#a100ff'];
      confettiRef.current = Array.from({ length: 42 }, (_, i) => ({ x: (pseudo(i, 21) - 0.5) * 220, y: -20 - pseudo(i, 23) * 60, vx: (pseudo(i, 29) - 0.5) * 1.6, vy: 1.2 + pseudo(i, 31) * 1.8, life: 0, max: 1.1 + pseudo(i, 37) * 0.7, color: colors[i % colors.length], size: 3 + pseudo(i, 41) * 4, rot: pseudo(i, 43) * 6, vr: (pseudo(i, 47) - 0.5) * 0.3 }));
      setTimeout(() => sfx('best'), 260);
    }
    const rec: ThrowResult = { distance: rounded, total, shapeGrade: f.grade, shapeWeakest: shapeRef.current.physics?.weakest, shapePhysics: shapeRef.current.physics, balance: Math.round(f.balance), spin: f.spin, spinSpeed: f.spinSpeed, spinCleanliness: f.spinCleanliness, swipeSpeed: f.swipeSpeed, swipeNorm: f.swipeNorm, isRecord };
    setLastThrow(rec);
    setBest(rounded);
    setPhaseBoth('landed');
    sfx('land');
    try { navigator.vibrate?.(18); } catch {}
  }, [sfx, setPhaseBoth]);

  const launch = useCallback((spinValue: number, spinSpeed: number, spinCleanliness: number, rawSpeed: number, dirX: number) => {
    if (phaseRef.current !== 'aim') return;
    const shape = shapeRef.current;
    const grade = gradeForBalance(shape.balance);
    const swipeNorm = clamp((rawSpeed - 0.35) / 1.8, 0.05, 1);
    // Distance uses the spin magnitude; the signed value is kept for the
    // visible rotation so flight keeps the drawing direction.
    const desiredDistance = distanceFor(shape.balance, Math.abs(spinValue), swipeNorm);
    flightRef.current = { balance: shape.balance, grade, spin: Math.abs(spinValue), spinSigned: spinValue, spinSpeed, spinCleanliness, swipeSpeed: rawSpeed, swipeNorm, desiredDistance, wobble: 100 - shape.balance };
    setSwipeSpeedShown(rawSpeed);
    const w = wrapRef.current?.clientWidth || 400;
    const h = wrapRef.current?.clientHeight || 480;
    const aimXNorm = clamp((aimRef.current.x / Math.max(1, w)) * 2 - 1, -1, 1);
    const aimYNorm = clamp((aimRef.current.y / Math.max(1, h)) * 2 - 1, -1, 1);
    const d = discRef.current;
    d.active = true; d.trail = []; d.z = 0; d.y = 0.4 + aimYNorm * 0.12; d.x = aimXNorm * 0.4;
    d.vz = desiredDistance / 1.52;
    d.vy = 3.6;
    d.vx = 0;
    void dirX;
    aimRef.current.active = false;
    camPushRef.current = 11 + Math.min(24, desiredDistance * 0.24);
    zoomRef.current = 1 + Math.min(0.38, desiredDistance * 0.0045 + swipeNorm * 0.13);
    flashRef.current = 1;
    shakeRef.current = { amp: 4.6 + Math.min(6.5, desiredDistance * 0.07 + swipeNorm * 2.4), t: 0 };
    setPhaseBoth('flying'); sfx('throw');
    try { navigator.vibrate?.(10); } catch {}
  }, [sfx, setPhaseBoth]);

  useEffect(() => {
    if (screen !== 'playing') return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let raf = 0; let last = performance.now();
    const resize = () => {
      const w = wrapRef.current?.clientWidth || 400; const h = wrapRef.current?.clientHeight || 480;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); if (wrapRef.current) ro.observe(wrapRef.current);

    // ——— The disc IS the traced outline. One single silhouette, drawn
    // from the player's own stroke — never corrected back to a circle.
    // A tiny downward offset gives just a hint of thickness; the
    // outline itself stays exactly as drawn, in the same side-on view
    // as the ground.
    const tracePath = (pts: Pt[], ox: number, oy: number, scale: number) => {
      const n = pts.length;
      if (n < 3) return;
      const at = (i: number) => pts[((i % n) + n) % n];
      ctx.beginPath();
      ctx.moveTo(ox + at(0).x * scale, oy + at(0).y * scale);
      for (let i = 0; i < n; i++) {
        const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
        const c1x = ox + (p1.x + (p2.x - p0.x) / 6) * scale;
        const c1y = oy + (p1.y + (p2.y - p0.y) / 6) * scale;
        const c2x = ox + (p2.x - (p3.x - p1.x) / 6) * scale;
        const c2y = oy + (p2.y - (p3.y - p1.y) / 6) * scale;
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ox + p2.x * scale, oy + p2.y * scale);
      }
      ctx.closePath();
    };
    const pointOnTrace = (pts: Pt[], angle: number, scale: number) => {
      let best = pts[0]; let bestDiff = Infinity;
      for (const p of pts) {
        const a = Math.atan2(p.y, p.x);
        const diff = Math.abs(wrapAngle(a - angle));
        if (diff < bestDiff) { bestDiff = diff; best = p; }
      }
      return { x: best.x * scale, y: best.y * scale };
    };
    const drawShapeDisc = (pts: Pt[], x: number, y: number, scale: number, _rot = 0, _tilt = 0.62, spinIntensity = 0, wobble = 0) => {
      void _tilt;
      const outline = pts && pts.length >= 3 ? pts : circlePoints();
      const hw = Math.max(12, scale);
      const spin = clamp(spinIntensity, 0, 1);
      // Axis wobble: a tiny in-plane jitter only. Never a flip or tumble —
      // clean circles get ~0, distorted circles get a few degrees at most.
      const wobbleAngle = Math.sin(performance.now() / 110) * clamp(wobble, 0, 1) * 0.06;
      const thickness = Math.max(2, Math.min(4.5, hw * 0.09));
      // Spin trail — dashed copies of the same traced outline, rotating
      // with the disc so the trail never floats apart from the body.
      if (spin > 0.03) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(_rot);
        ctx.lineCap = 'round';
        for (let k = 0; k < 2; k++) {
          const s = 1.18 + k * 0.18;
          tracePath(outline, 0, 0, hw * s);
          ctx.strokeStyle = k === 0 ? `rgba(0,229,255,${0.16 + spin * 0.34})` : `rgba(255,46,136,${0.14 + spin * 0.30})`;
          ctx.lineWidth = 1.4 + spin * 1.6;
          ctx.setLineDash([10 + spin * 14, 9 - spin * 4]);
          ctx.lineDashOffset = -_rot * (26 + k * 14);
          ctx.stroke();
        }
        ctx.restore();
      }
      // Soft motion ghost — the same outline, one silhouette only,
      // rotating with the disc.
      if (spin > 0.05) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(_rot);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        tracePath(outline, 0, 0, hw * 1.04);
        ctx.strokeStyle = `rgba(255,46,136,${0.14 + spin * 0.24})`;
        ctx.lineWidth = Math.max(2, hw * 0.07 + spin * 3.2);
        ctx.stroke();
        ctx.restore();
      }
      // Hint of thickness: the same (rotating) outline nudged straight
      // down a few px, so the edge stays grounded while the shape spins.
      ctx.save();
      ctx.translate(x, y + thickness);
      ctx.rotate(_rot + wobbleAngle);
      tracePath(outline, 0, 0, hw);
      ctx.fillStyle = '#d1007a';
      ctx.fill();
      ctx.restore();
      // The whole disc rotates here — outline, distortion, surface
      // pattern and markers all share this one rotation, flat in plane.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(_rot + wobbleAngle);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const ys = outline.map((p) => p.y * hw);
      const top = Math.min(...ys); const bottom = Math.max(...ys);
      const body = ctx.createLinearGradient(0, top, 0, bottom);
      body.addColorStop(0, '#fff066');
      body.addColorStop(0.38, '#ff8a1f');
      body.addColorStop(0.72, '#ff2e88');
      body.addColorStop(1, '#a100ff');
      tracePath(outline, 0, 0, hw);
      ctx.fillStyle = body; ctx.fill();
      ctx.strokeStyle = 'rgba(120,0,120,.55)'; ctx.lineWidth = Math.max(1.4, hw * 0.035); ctx.stroke();
      // Soft highlight clipped to the drawn shape — no second plate.
      ctx.save();
      tracePath(outline, 0, 0, hw);
      ctx.clip();
      const hl = ctx.createLinearGradient(0, top, 0, top + (bottom - top) * 0.55);
      hl.addColorStop(0, 'rgba(255,255,255,.45)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.fillRect(-hw - 4, top - 2, hw * 2 + 8, (bottom - top) * 0.55 + 2);
      ctx.restore();
      // Surface pattern, clipped to the drawn shape and rotating with
      // it: a directional half-tint, one bold wedge, and one spoke from
      // the centre to the edge. No dots or markers — a distorted outline
      // plus this asymmetric pattern make the body rotation unmistakable.
      ctx.save();
      tracePath(outline, 0, 0, hw);
      ctx.clip();
      const sideGrad = ctx.createLinearGradient(-hw, 0, hw, 0);
      sideGrad.addColorStop(0, 'rgba(0,229,255,.42)');
      sideGrad.addColorStop(0.5, 'rgba(255,255,255,0)');
      sideGrad.addColorStop(1, 'rgba(161,0,255,.28)');
      ctx.fillStyle = sideGrad;
      ctx.fillRect(-hw - 4, -hw - 4, hw * 2 + 8, hw * 2 + 8);
      const edge0 = pointOnTrace(outline, 0, hw);
      const edgeA = pointOnTrace(outline, -0.58, hw);
      const edgeB = pointOnTrace(outline, 0.58, hw);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(edgeA.x, edgeA.y);
      ctx.lineTo(edge0.x, edge0.y);
      ctx.lineTo(edgeB.x, edgeB.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(edge0.x, edge0.y);
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = Math.max(2.5, hw * 0.13);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(edge0.x, edge0.y);
      ctx.strokeStyle = 'rgba(0,229,255,.95)';
      ctx.lineWidth = Math.max(1.2, hw * 0.045);
      ctx.stroke();
      ctx.restore();
      // No dots or markers on the disc — rotation is read from the
      // rotating outline and the surface pattern above, flat in plane.
      ctx.restore();
    };

    // Smooth stroke: midpoint quadratic — no jagged polyline.
    const drawSmoothStroke = (pts: Pt[], width: number) => {
      if (pts.length < 2) return;
      ctx.save();
      ctx.strokeStyle = '#ff2e88';
      ctx.lineWidth = width;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(255,46,136,.45)'; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 2;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
      ctx.restore();
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.033, (now - last) / 1000); last = now;
      if (flashRef.current > 0) flashRef.current = Math.max(0, flashRef.current - dt * 2.2);
      // One integrated spin angle per phase, advanced from the measured
      // spin — never rebuilt from the clock, so speed changes smoothly
      // and direction never flips on its own. Full spin = 12 rad/s.
      if (phaseRef.current === 'aim') {
        aimRef.current.discRot += ((spinRef.current.spin / 2500) * 12) * dt;
      }
      if (phaseRef.current === 'draw' && shapeLocked) {
        drawRotRef.current += 0.7 * dt;
      }
      const w = wrapRef.current?.clientWidth || 400; const h = wrapRef.current?.clientHeight || 480;
      const horizonY = h * 0.18;
      const cx = w / 2;
      const d = discRef.current;

      if (d.active) {
        const wind = windRef.current;
        const wobbleAmt = (flightRef.current.wobble / 100) * 2.6;
        const drag = 0.24;
        d.vz += (-drag * d.vz + wind * 0.55) * dt;
        d.vy += Math.sin(d.z * 0.9) * wobbleAmt * 0.35 * dt;
        d.vy += -3.8 * dt;
        d.z += d.vz * dt;
        d.y += d.vy * dt;
        d.x += d.vx * dt;
        // Flight keeps the spin it launched with: same direction, same
        // speed proportional to the drawn spin, flat in its own plane.
        d.rot += ((flightRef.current.spinSigned / 2500) * 12) * dt;
        d.trail.push({ z: d.z, y: Math.max(0, d.y), x: d.x }); const maxTrail = 28; if (d.trail.length > maxTrail) d.trail.shift();
        if (d.y <= 0 && d.vy < 0) {
          d.y = 0; d.active = false; landedAtRef.current = Math.max(0, d.z); landedXRef.current = d.x;
          rollRef.current = { x: 0, y: 0, vx: 22, vy: 78, rot: d.rot, spin: ((flightRef.current.spinSigned / 2500) * 12) * 0.4, active: true };
          dustRef.current = Array.from({ length: 16 }, (_, i) => ({
            x: landedXRef.current, y: 0, vx: (pseudo(i, 3) - 0.5) * 3.4, vy: pseudo(i, 7) * 2.2 + 0.4,
            life: 0, max: 0.55 + pseudo(i, 11) * 0.45, r: 2 + pseudo(i, 13) * 3.2,
          }));
          onLand(Math.max(0, d.z));
        }
      }
      if (rollRef.current.active) {
        const r = rollRef.current;
        r.x += r.vx * dt;
        r.vx *= Math.exp(-2.2 * dt);
        r.y += r.vy * dt;
        r.vy -= 340 * dt;
        r.rot += r.spin * dt;
        r.spin *= Math.exp(-3.2 * dt);
        if (r.y <= 0) {
          r.y = 0;
          if (Math.abs(r.vy) > 34) { r.vy = -r.vy * 0.42; }
          else { r.vy = 0; }
        }
        if (Math.abs(r.vx) < 0.6 && Math.abs(r.spin) < 0.08 && r.y === 0 && r.vy === 0) {
          r.active = false; r.vx = 0; r.spin = 0;
        }
      }
      dustRef.current = dustRef.current.map(p => ({ ...p, life: p.life + dt, x: p.x + p.vx * dt, y: p.y + p.vy * dt, vy: p.vy - 2.4 * dt })).filter(p => p.life < p.max);
      confettiRef.current = confettiRef.current.map(p => ({ ...p, life: p.life + dt, x: p.x + p.vx * dt * 28, y: p.y + p.vy * dt * 28, vy: p.vy + 1.6 * dt, rot: p.rot + p.vr })).filter(p => p.life < p.max);

      const horizonCurve = h * 0.022;
      const curveAt = (x: number, strength = 1) => {
        const u = clamp((x - cx) / Math.max(1, w / 2), -1, 1);
        return -horizonCurve * strength * (1 - u * u);
      };
      const horizonAt = (x: number) => horizonCenter + curveAt(x, 1);
      const drawCurvedLine = (baseY: number, strength: number) => {
        ctx.beginPath();
        for (let x = -4; x <= w + 4; x += 16) {
          const y = baseY + curveAt(x, strength);
          if (x === -4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      const focusZ = d.active ? d.z : phaseRef.current === 'landed' ? landedAtRef.current : 0;
      camPushRef.current *= Math.pow(0.12, dt);
      if (camPushRef.current < 0.05) camPushRef.current = 0;
      const speedBoost = d.active ? Math.min(26, Math.max(0, d.vz) * 0.32) : 0;
      camRef.current = Math.max(0, focusZ + camPushRef.current + speedBoost);
      const speed01ForZoom = d.active ? clamp(d.vz / 55, 0, 1) : 0;
      const targetZoom = d.active ? 1.16 + speed01ForZoom * 0.24 : 1;
      zoomRef.current += (targetZoom - zoomRef.current) * Math.min(1, dt * (d.active ? 9 : 2.2));
      if (Math.abs(zoomRef.current - 1) < 0.005 && !d.active) zoomRef.current = 1;
      if (shakeRef.current.amp > 0.05) {
        shakeRef.current.t += dt;
        shakeRef.current.amp *= Math.pow(0.02, dt);
        const sh = shakeRef.current;
        const shakeX = Math.sin(sh.t * 68) * sh.amp;
        const shakeY = Math.cos(sh.t * 53) * sh.amp * 0.7;
        canvas.style.transform = `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px)`;
      } else if (canvas.style.transform) {
        canvas.style.transform = '';
        shakeRef.current.amp = 0;
      }
      const viewRange = 110;
      const horizonCenter = horizonY;
      const horizonEdge = horizonCenter;
      const groundY = h * 0.78;
      const project = (z: number, y: number, x: number) => {
        const rel = z - camRef.current;
        const depth = 55 / (55 + Math.max(0, rel));
        const t = clamp(rel / viewRange, 0, 1);
        const gy = rel <= -50 ? h + 200 : horizonY + (groundY - horizonY) * (55 / (rel + 55));
        const px = w / 2 + x * w * 0.42;
        const py = gy - y * (h * 0.16) * depth;
        const half = w * 0.5;
        return { x: px, y: py, depth, t, groundY: gy, half, curveSag: 0, horizon: horizonCenter };
      };

      const zoomNow = zoomRef.current;
      ctx.save();
      ctx.translate(cx, h * 0.46);
      ctx.scale(zoomNow, zoomNow);
      ctx.translate(-cx, -h * 0.46);
      // Clear sky — fresh blue-green air, no banding.
      const skyT = d.active || phaseRef.current === 'landed' ? clamp((d.active ? d.z : landedAtRef.current) / Math.max(1, flightRef.current.desiredDistance || 40), 0, 1) : 0;
      const skyTopR = Math.round(0 + skyT * 4);
      const skyTopG = Math.round(110 - skyT * 12);
      const skyTopB = Math.round(255);
      const skyBotR = Math.round(140 - skyT * 10);
      const skyBotG = Math.round(232 - skyT * 8);
      const skyBotB = Math.round(255);
      const grad = ctx.createLinearGradient(0, 0, 0, horizonEdge);
      grad.addColorStop(0, `rgb(${skyTopR},${skyTopG},${skyTopB})`); grad.addColorStop(1, `rgb(${skyBotR},${skyBotG},${skyBotB})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, horizonAt(w));
      for (let x = w; x >= 0; x -= 16) ctx.lineTo(x, horizonAt(x));
      ctx.closePath(); ctx.fill();
      // Sun — soft, high, never competing with the disc.
      ctx.save();
      const sunX = w * 0.84; const sunY = h * 0.055;
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 46);
      sunGlow.addColorStop(0, 'rgba(255,230,0,.98)'); sunGlow.addColorStop(0.45, 'rgba(255,230,0,.42)'); sunGlow.addColorStop(1, 'rgba(255,230,0,0)');
      ctx.fillStyle = sunGlow; ctx.beginPath(); ctx.arc(sunX, sunY, 46, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe600'; ctx.beginPath(); ctx.arc(sunX, sunY, 12, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // A few soft clouds drifting with the camera — parallel, calm.
      for (let i = 0; i < 3; i++) {
        const baseX = pseudo(i, 91) * w;
        const drift = ((baseX - camRef.current * 0.6) % (w + 160) + w + 160) % (w + 160) - 80;
        const cy2 = h * (0.04 + pseudo(i, 93) * 0.08);
        ctx.fillStyle = 'rgba(255,255,255,.78)';
        ctx.beginPath();
        ctx.ellipse(drift, cy2, 26 + pseudo(i, 95) * 14, 7, 0, 0, Math.PI * 2);
        ctx.ellipse(drift + 16, cy2 + 2, 18, 5.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ground — parallel view, never narrowing. Teal-green lawn.
      const fg = ctx.createLinearGradient(0, h, 0, horizonCenter);
      fg.addColorStop(0, '#00a844'); fg.addColorStop(0.48, '#00d96a'); fg.addColorStop(1, '#b8ff4d');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(0, horizonAt(0));
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, horizonAt(x));
      ctx.lineTo(w, h); ctx.lineTo(0, h);
      ctx.closePath(); ctx.fill();
      // Gentle mowing stripes — parallel bands, subtle.
      for (let i = 0; i < 4; i++) {
        const ly = horizonCenter + ((h - horizonCenter) * (i + 0.5)) / 4.5;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,.05)' : 'rgba(0,60,30,.05)';
        ctx.beginPath();
        ctx.moveTo(0, ly);
        for (let x = 0; x <= w; x += 16) ctx.lineTo(x, ly + curveAt(x, 0.55));
        for (let x = w; x >= 0; x -= 16) ctx.lineTo(x, ly + ((h - horizonCenter) / 4.5) + curveAt(x, 0.55));
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.6;
      drawCurvedLine(horizonEdge, 1);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        const ly = horizonCenter + ((h - horizonCenter) * i) / 5;
        const strength = 0.7 * (1 - ((ly - horizonCenter) / Math.max(1, h - horizonCenter)) * 0.6);
        drawCurvedLine(ly, strength);
      }

      // Flowing ground texture — short grass streaks streaming with speed.
      const flowSpeed = d.active ? clamp(d.vz / 55, 0, 1) : 0;
      if (flowSpeed > 0.05) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,255,255,${0.10 + flowSpeed * 0.22})`;
        ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        for (let i = 0; i < 22; i++) {
          const sx = pseudo(i, 101) * w;
          const sy = horizonCenter + pseudo(i, 103) * (h - horizonCenter - 18);
          const len = 14 + flowSpeed * 34 + pseudo(i, 107) * 12;
          const off = (now * (0.25 + flowSpeed * 0.9) + pseudo(i, 109) * 240) % (h + 40);
          const y2 = horizonCenter + ((sy - horizonCenter + off) % (h - horizonCenter));
          ctx.beginPath(); ctx.moveTo(sx, y2); ctx.lineTo(sx, y2 + len); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.textAlign = 'center';
      for (let i = 0; i < 42; i++) {
        const worldZ = Math.floor(camRef.current / 4) * 4 + i * 4 - 4;
        if (worldZ < 0) continue;
        const worldX = (pseudo(i, 5) - 0.5) * 1.9;
        const p = project(worldZ, 0, worldX);
        if (p.x < -20 || p.x > w + 20) continue;
        if (p.groundY < horizonCenter + 4) continue;
        const s = (4 + pseudo(i, 13) * 4) * (0.35 + 0.65 * p.depth);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(11,107,51,.22)' : 'rgba(255,255,255,.16)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.groundY + curveAt(p.x, 0.6), s * 1.6, s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const firstMark = Math.max(0, Math.floor((camRef.current - 20) / 10) * 10);
      for (let m = firstMark; m <= camRef.current + viewRange; m += 10) {
        const p = project(m, 0, 0);
        if (p.groundY < horizonCenter + 4 || p.groundY > h + 2) continue;
        const isMajor = m % 20 === 0;
        ctx.strokeStyle = isMajor ? 'rgba(255,255,255,.88)' : 'rgba(255,255,255,.52)';
        ctx.lineWidth = isMajor ? 1.6 : 1;
        ctx.beginPath();
        for (let x = -4; x <= w + 4; x += 16) {
          const y = p.groundY + curveAt(x, 0.25 + 0.75 * p.t);
          if (x === -4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.fillStyle = isMajor ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.62)';
        ctx.font = '700 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${m}m`, 8, p.groundY - 5);
        ctx.textAlign = 'center';
      }

      if (phaseRef.current === 'landed') {
        const p = project(landedAtRef.current, 0, landedXRef.current);
        const flagGroundY = p.groundY + curveAt(p.x, 0.6);
        if (flagGroundY > horizonY + 8) {
          const flagScale = 0.3 + 0.7 * p.depth;
          ctx.strokeStyle = 'rgba(30,42,36,.55)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(p.x, flagGroundY); ctx.lineTo(p.x, flagGroundY - 52 * flagScale - 12); ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.moveTo(p.x, flagGroundY - 52 * flagScale - 12); ctx.lineTo(p.x + 22 * flagScale + 6, flagGroundY - 45 * flagScale - 10); ctx.lineTo(p.x, flagGroundY - 38 * flagScale - 8); ctx.closePath(); ctx.fill();
        }
      }
      if (dustRef.current.length) {
        const base = project(landedAtRef.current, 0, landedXRef.current);
        dustRef.current.forEach(pt => {
          const a = 1 - pt.life / pt.max;
          ctx.fillStyle = `rgba(255,255,255,${0.28 * a})`;
          ctx.beginPath(); ctx.arc(base.x + pt.x * 8, base.groundY - pt.y * 10 - 2, pt.r * (1 + pt.life * 0.4), 0, Math.PI * 2); ctx.fill();
        });
      }
      // Flight trail — follows the same arc as the disc.
      if (d.trail.length > 1) {
        for (let i = 1; i < d.trail.length; i++) {
          const a = { x: w / 2 + d.trail[i - 1].x * w * 0.42, y: h * 0.38 - Math.max(0, d.trail[i - 1].y) * (h * 0.09) };
          const b = { x: w / 2 + d.trail[i].x * w * 0.42, y: h * 0.38 - Math.max(0, d.trail[i].y) * (h * 0.09) };
          const t = i / d.trail.length;
          ctx.strokeStyle = `rgba(0,229,255,${t * 0.75})`; ctx.lineWidth = 1.8 + t * 1.6;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      if (confettiRef.current.length) {
        confettiRef.current.forEach(p => {
          const a = 1 - p.life / p.max;
          ctx.save(); ctx.translate(cx + p.x, h * 0.32 + p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, a);
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        });
        ctx.globalAlpha = 1;
      }

      if (phaseRef.current === 'draw') {
        const centerY = h * 0.44;
        const stroke = strokeRef.current;
        if (stroke.pts.length > 1) drawSmoothStroke(stroke.pts, 11);
        if (shapeLocked) {
          const bob = Math.sin(now / 520) * 3;
          // Drawn size → disc size, kept natural against the ground.
          const previewScale = clamp(shapeRef.current.drawnRadius * 0.36, 14, 44);
          drawShapeDisc(shapeRef.current.points, cx, centerY + bob, previewScale, drawRotRef.current, 0.92, 0.18, 0);
        } else if (stroke.pts.length < 2) {
          // Gentle guide — one faint circle, so the first stroke feels invited.
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 1.6; ctx.setLineDash([6, 8]);
          ctx.beginPath(); ctx.arc(cx, centerY, 62, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }

      if (phaseRef.current === 'aim') {
        if (!aimRef.current.x || !aimRef.current.y) { aimRef.current.x = cx; aimRef.current.y = h * 0.62; }
        const discX = aimRef.current.x;
        const discY = aimRef.current.y;
        {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,.55)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          ctx.beginPath(); ctx.arc(cx, h * 0.62, 72, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          const stroke = spinRef.current.pts;
          if (stroke.length > 1) drawSmoothStroke(stroke, 9);
        }
        {
          const launchY = h * 0.10;
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,.14)';
          ctx.fillRect(0, 0, w, launchY);
          ctx.strokeStyle = 'rgba(255,255,255,.9)';
          ctx.lineWidth = 2;
          ctx.setLineDash([10, 8]);
          ctx.beginPath(); ctx.moveTo(0, launchY); ctx.lineTo(w, launchY); ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
          const spin = spinRef.current.spin;
          const spinVisual = Math.min(1, Math.abs(spin) / 2500);
          const trail = aimRef.current.trail;
          if (trail.length > 1) {
            for (let i = 1; i < trail.length; i++) {
              const t = i / trail.length;
              ctx.strokeStyle = `rgba(255,255,255,${0.10 + spinVisual * 0.35 * t})`;
              ctx.lineWidth = 1.5 + t * (2 + spinVisual * 3);
              ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
            }
          }
          if (Math.abs(spin) > 0) {
            const glowR = clamp(shapeRef.current.drawnRadius * 0.36, 14, 44) + 12 + spinVisual * 36 + Math.sin(now / 140) * 4;
            const glow = ctx.createRadialGradient(discX, discY, 8, discX, discY, glowR);
            glow.addColorStop(0, `rgba(255,230,0,${0.28 + spinVisual * 0.38})`);
            glow.addColorStop(0.55, `rgba(255,46,136,${0.12 + spinVisual * 0.26})`);
            glow.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(discX, discY, glowR, 0, Math.PI * 2); ctx.fill();
          }
          // Wobble comes from spin cleanliness, not shape: a clean spin
          // stays steady, a messy spin wobbles only a little, sideways.
          const wobblePx = Math.abs(spin) > 0 ? ((100 - spinRef.current.cleanliness) / 100) * 2.5 : 0;
          const shakeX = Math.sin(now / 60) * wobblePx;
          const aimScale = clamp(shapeRef.current.drawnRadius * 0.36, 14, 44);
          drawShapeDisc(shapeRef.current.points, discX + shakeX, discY, aimScale, aimRef.current.discRot, 0.62, spinVisual, Math.abs(spin) > 0 ? (100 - spinRef.current.cleanliness) / 100 : 0);
        }
      }

      if ((phaseRef.current === 'flying' || phaseRef.current === 'landed') && (d.active || phaseRef.current === 'landed')) {
        if (phaseRef.current === 'flying') {
          const gp = project(d.z, 0, d.x);
          const discX = w / 2 + d.x * w * 0.42;
          // Slightly above centre, with breathing room — disc never shrinks.
          const fp = { x: discX, y: h * 0.38 - Math.max(0, d.y) * (h * 0.09) };
          const radius = clamp(shapeRef.current.drawnRadius * 0.36, 14, 44);
          const tilt = clamp(0.60 + Math.sin(d.z * 0.22) * 0.06, 0.52, 0.68);
          const wobblePx = ((100 - flightRef.current.spinCleanliness) / 100) * 2;
          const shakeX = Math.sin(now / 48) * wobblePx;
          ctx.save(); ctx.translate(gp.x, gp.groundY + 3); ctx.scale(1, 0.24);
          const flightShadow = ctx.createRadialGradient(0, 0, 1, 0, 0, radius + 6);
          flightShadow.addColorStop(0, 'rgba(20,40,28,.28)'); flightShadow.addColorStop(0.6, 'rgba(20,40,28,.10)'); flightShadow.addColorStop(1, 'rgba(20,40,28,0)');
          ctx.fillStyle = flightShadow; ctx.beginPath(); ctx.arc(0, 0, radius + 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          ctx.strokeStyle = 'rgba(20,40,28,.22)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(gp.x, gp.groundY + 2); ctx.lineTo(fp.x + shakeX, fp.y); ctx.stroke();
          const speed01 = clamp(d.vz / 55, 0, 1);
          if (speed01 > 0.18) {
            const lineCount = 6 + Math.round(speed01 * 10);
            ctx.save();
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            for (let i = 0; i < lineCount; i++) {
              ctx.strokeStyle = i % 2 === 0 ? `rgba(0,229,255,${0.35 + speed01 * 0.45})` : `rgba(255,46,136,${0.35 + speed01 * 0.45})`;
              const leftSide = i % 2 === 0;
              const edgeW = w * 0.17;
              const sx = leftSide ? pseudo(i, 61) * edgeW : w - pseudo(i, 61) * edgeW;
              const sy = ((pseudo(i, 67) * h + now * (0.55 + speed01 * 0.95)) % (h + 60)) - 30;
              const len = 26 + speed01 * 52 + pseudo(i, 71) * 18;
              ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + len); ctx.stroke();
            }
            ctx.restore();
          }
          drawShapeDisc(shapeRef.current.points, fp.x + shakeX, fp.y, radius, d.rot, tilt, clamp(flightRef.current.spin / 2500, 0, 1), (100 - flightRef.current.spinCleanliness) / 100);
        } else if (phaseRef.current === 'landed') {
          const landRadius = clamp(shapeRef.current.drawnRadius * 0.36, 14, 44);
          const landTilt = 0.60;
          // Landed disc stays visible — settles a little lower, rolls, stops.
          const landX = clamp(w / 2 + landedXRef.current * w * 0.42 + rollRef.current.x, landRadius + 6, w - landRadius - 6);
          const landY = h * 0.46 - rollRef.current.y;
          const landWobble = ((100 - flightRef.current.spinCleanliness) / 100) * 1.5;
          const landShakeX = Math.sin(now / 60) * landWobble * (rollRef.current.active ? 1 : 0.25);
          ctx.save(); ctx.translate(landX, landY + landRadius * 0.26 + 10); ctx.scale(1, 0.24);
          const landShadow = ctx.createRadialGradient(0, 0, 1, 0, 0, landRadius + 6);
          landShadow.addColorStop(0, 'rgba(20,40,28,.28)'); landShadow.addColorStop(0.6, 'rgba(20,40,28,.10)'); landShadow.addColorStop(1, 'rgba(20,40,28,0)');
          ctx.fillStyle = landShadow; ctx.beginPath(); ctx.arc(0, 0, landRadius + 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
          drawShapeDisc(shapeRef.current.points, landX + landShakeX, landY, landRadius, rollRef.current.rot, landTilt, clamp(Math.abs(rollRef.current.spin) / 6, 0, 0.35), (100 - flightRef.current.spinCleanliness) / 100);
        }
      }
      if (flashRef.current > 0) {
        const f = flashRef.current;
        const flashGrad = ctx.createRadialGradient(cx, h * 0.38, 10, cx, h * 0.38, Math.max(w, h) * 0.75);
        flashGrad.addColorStop(0, `rgba(255,255,255,${0.55 * f})`);
        flashGrad.addColorStop(0.45, `rgba(255,230,0,${0.22 * f})`);
        flashGrad.addColorStop(1, `rgba(255,46,136,${0.10 * f})`);
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [screen, onLand]);

  const posFromEvent = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const onDown = (e: React.PointerEvent) => {
    if (screen !== 'playing') return;
    if (phase === 'landed') { finishGame(); return; }
    // すでに1本目の指で操作中なら、2本目の指では何も始めない
    // （描画や回転の状態を上書きして座標が飛ぶのを防ぐ）
    if (phase === 'draw' && strokeRef.current.active) return;
    if (phase === 'aim' && (aimRef.current.active || spinRef.current.active)) return;
    ensureAudio();
    const p = posFromEvent(e); const now = performance.now();
    const h = wrapRef.current?.clientHeight || 480;
    if (phase === 'draw') {
      if (shapeLocked) return;
      strokeRef.current = { active: true, pts: [p], pointerId: e.pointerId };
      setDrawHint('');
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (phase === 'aim') {
      const w = wrapRef.current?.clientWidth || 400;
      spinRef.current = { ...spinRef.current, active: true, pointerId: e.pointerId, pts: [{ x: p.x, y: p.y, t: now }], startTime: now, lastMoveAt: now };
      aimRef.current.active = true;
      aimRef.current.pointerId = e.pointerId;
      aimRef.current.x = p.x;
      aimRef.current.y = p.y;
      aimRef.current.lastX = p.x;
      aimRef.current.lastY = p.y;
      aimRef.current.startY = p.y;
      aimRef.current.hist = [{ x: p.x, y: p.y, t: now }];
      aimRef.current.trail = [{ x: p.x, y: p.y }];
      aimRef.current.vx = 0; aimRef.current.vy = 0;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setSpinHint('');
      setAimX(clamp((p.x / Math.max(1, w)) * 2 - 1, -1, 1));
      setAimY(clamp((p.y / Math.max(1, h)) * 2 - 1, -1, 1));
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const p = posFromEvent(e); const now = performance.now();
    const w = wrapRef.current?.clientWidth || 400;
    const h = wrapRef.current?.clientHeight || 480;
    if (phase === 'draw') {
      const st = strokeRef.current;
      if (!st.active || !ownsPointer(st.pointerId, e.pointerId)) return;
      const lastPt = st.pts[st.pts.length - 1];
      if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) > 2.5) st.pts.push(p);
      return;
    }
    if (phase === 'aim') {
      const s = spinRef.current;
      // 操作中の指以外（2本目以降）の move は座標も回転も動かさない
      if (aimRef.current.active && !ownsPointer(aimRef.current.pointerId, e.pointerId)) return;
      const inSpinZone = p.y > h * 0.42;
      if (s.active && inSpinZone) {
        const lastPt = s.pts[s.pts.length - 1];
        if (!lastPt || Math.hypot(p.x - lastPt.x, p.y - lastPt.y) > 2.5) {
          s.pts.push({ x: p.x, y: p.y, t: now });
          if (s.pts.length > 240) s.pts.splice(0, s.pts.length - 240);
          updateLiveSpin();
        }
      }
      const a = aimRef.current; if (!a.active) return;
      const dx = p.x - a.lastX;
      const dy = p.y - a.lastY;
      const stepDist = Math.hypot(dx, dy);
      a.x = clamp(p.x, 28, Math.max(29, w - 28));
      a.y = clamp(p.y, 28, Math.max(29, h - 28));
      a.lastX = p.x; a.lastY = p.y;
      setAimX(clamp((a.x / Math.max(1, w)) * 2 - 1, -1, 1));
      setAimY(clamp((a.y / Math.max(1, h)) * 2 - 1, -1, 1));
      a.trail.push({ x: a.x, y: a.y });
      if (a.trail.length > 20) a.trail.shift();
      a.hist.push({ x: p.x, y: p.y, t: now });
      a.hist = a.hist.filter(q => now - q.t <= 220);
      const launchY = h * 0.10;
      if (p.y <= launchY && a.startY > h * 0.30) {
        const recent = a.hist.filter(q => now - q.t <= 160);
        let speed = 0; let dirX = 0;
        if (recent.length >= 2) {
          const first = recent[0]; const lastP = recent[recent.length - 1];
          const ddx = lastP.x - first.x; const ddy = lastP.y - first.y;
          const dist = Math.hypot(ddx, ddy);
          const dtMs = Math.max(1, lastP.t - first.t);
          speed = clampSpeed(dist / dtMs);
          if (dist > 1) dirX = ddx / dist;
        } else {
          speed = clampSpeed(stepDist / Math.max(1, 16));
          if (stepDist > 1) dirX = dx / stepDist;
        }
        a.active = false;
        launch(spinRef.current.spin, spinRef.current.speed, spinRef.current.cleanliness, speed, dirX);
      }
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (phase === 'draw') {
      const st = strokeRef.current;
      if (!st.active || !ownsPointer(st.pointerId, e.pointerId)) return;
      finalizeShape();
      return;
    }
    if (phase === 'aim') {
      const s = spinRef.current;
      const a = aimRef.current;
      if (!ownsPointer(a.pointerId, e.pointerId) && !ownsPointer(s.pointerId, e.pointerId)) return;
      if (s.active) {
        s.active = false;
        s.lastMoveAt = performance.now();
        if (s.pts.length < 10 || Math.abs(s.spin) <= 0) {
          setSpinHint(tr('spin.more'));
        } else {
          setSpinHint(tr('aimDecay'));
        }
      }
      aimRef.current.active = false;
      aimRef.current.pointerId = null;
    }
  };
  const toggleMute = () => { const next = !muted; setMuted(next); audioRef.current.muted = next; gameAudio.setMuted(next); if (!next) gameAudio.start(); if (!next) { ensureAudio(); tone(660, 840, 0.14, 'sine', 0.04); } };

  // ——— 結果のシェア（X / 画像保存）
  const shareInput = useCallback((): ShareResultInput | null => {
    const t = result.throw;
    if (!t) return null;
    return {
      distance: t.distance,
      rank: result.rank,
      shapeGrade: t.shapeGrade,
      spin: t.spin,
      accelLabel: swipeLabel(t.swipeNorm),
      isRecord: isNewBest,
    };
  }, [result, isNewBest]);

  const shareToX = useCallback(async () => {
    if (shareBusy) return;
    const input = shareInput();
    if (!input) return;
    const lang = getLang();
    const text = buildShareText(input, lang);
    const nativeShare = mobileFileShareSupported();
    setShareBusy(true); setShareNote('');
    // PC ブラウザ等では「画像を保存 → X の投稿画面を開く」。
    // ポップアップブロックを避けるため、クリックと同じ流れで先に開いておく。
    if (!nativeShare) window.open(buildXIntentUrl(text), '_blank', 'noopener,noreferrer');
    try {
      const { file } = await renderResultShareImage(shapeRef.current.points, input, lang);
      if (nativeShare) {
        try {
          await navigator.share({ text, files: [file] });
          setShareNote(tr('share.done'));
        } catch (err) {
          // 共有シートを閉じただけ（キャンセル）は何も出さない
          if (!isAbortError(err)) {
            // ファイル共有が拒否された（iOS 等）→ 画像保存＋X の投稿画面へ
            downloadShareFile(file);
            window.open(buildXIntentUrl(text), '_blank', 'noopener,noreferrer');
            setShareNote(tr('share.savedForX'));
          }
        }
      } else {
        downloadShareFile(file);
        setShareNote(tr('share.savedForX'));
      }
    } catch (err) {
      // 共有シートを閉じただけ（キャンセル）はエラー表示にしない
      if (!isAbortError(err)) setShareNote(tr('share.failed'));
    } finally {
      setShareBusy(false);
    }
  }, [shareBusy, shareInput]);

  const saveResultImage = useCallback(async () => {
    if (shareBusy) return;
    const input = shareInput();
    if (!input) return;
    setShareBusy(true); setShareNote('');
    try {
      const { file } = await renderResultShareImage(shapeRef.current.points, input, getLang());
      downloadShareFile(file);
      setShareNote(tr('share.saved'));
    } catch {
      setShareNote(tr('share.failed'));
    } finally {
      setShareBusy(false);
    }
  }, [shareBusy, shareInput]);

  const bestTotalDisplay = myRecord ? (myRecord.total ?? myRecord.best) : 0;
  const bestDistDisplay = myRecord ? myRecord.best : 0;
  const stepIndex = screen === 'result' ? 2 : phase === 'draw' ? 0 : phase === 'landed' ? 2 : 1;
  const steps = [tr('step1'), tr('step2'), tr('step3')];
  const spinPct = Math.min(100, (spinShown / 2500) * 100);
  const spinHot = spinShown > 1200;
  void best; void wind; void aimX; void aimY; void swipeSpeedShown; void spinSpeedShown; void spinCleanlinessShown; void shapeBalance; void shapeGrade; void shapeSize;
  const resultFactors = result.throw ? (() => {
    const shapeN = clamp(result.throw.balance / 100, 0, 1);
    const spinN = normalizeSpin(result.throw.spin);
    const accelN = clamp(result.throw.swipeNorm, 0, 1);
    const list = [
      { label: tr('stat.shape'), value: tr('gradeLine', { g: result.throw.shapeGrade }), pct: shapeN * 100, note: shapeWeakLabel(result.throw.shapeWeakest) },
      { label: tr('stat.spin'), value: `${Math.round(result.throw.spin).toLocaleString('ja-JP')}`, pct: spinN * 100, note: spinN >= 0.7 ? tr('spin.great') : spinN >= 0.4 ? tr('grade.decent') : tr('accel.fastClean') },
      { label: tr('stat.accel'), value: swipeLabel(result.throw.swipeNorm), pct: accelN * 100, note: accelN >= 0.7 ? tr('accel.sharp') : accelN >= 0.4 ? tr('accel.justRight') : tr('accel.more') },
    ];
    const bestIdx = [shapeN, spinN, accelN].indexOf(Math.max(shapeN, spinN, accelN));

    const ph = result.throw.shapePhysics;
    const shapeParams = ph
      ? [
          { label: tr('param.symmetry'), v: ph.wobble },
          { label: tr('param.area'), v: ph.fill },
          { label: tr('param.smoothness'), v: ph.smoothness },
          { label: tr('param.balance'), v: ph.balance },
        ]
      : [];
    const glide = ph ? ph.glide : 0;

    return { list, bestIdx, shapeParams, glide };
  })() : null;

  return (
    <div data-safe-area-inset-root style={{ boxSizing: 'border-box', paddingTop: 'var(--safe-area-inset-top)', minHeight: '100vh', background: 'var(--bg)' }} className="overflow-x-clip">
      <div className="flex min-h-[calc(100vh-var(--safe-area-inset-top))] w-full max-w-none flex-col bg-[var(--bg)]">
        {screen === 'start' && (
          <main className="mx-auto flex w-full max-w-[600px] flex-1 flex-col px-6 pb-8 pt-6">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-black tracking-tight">{tr('app.title')}</span>
              <button onClick={toggleMute} aria-label={muted ? tr('unmute') : tr('mute')} className="ghost-btn rounded-full border border-[var(--line)] bg-[var(--surface)] p-2.5">{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            </div>
            <div className="mt-10 text-center">
              <h1 className="text-[clamp(40px,12vw,56px)] font-black leading-[1.08] tracking-tight">{tr('app.titleLine1')}<br /><span className="text-[var(--accent)]">{tr('app.titleLine2')}</span></h1>
              <p className="mx-auto mt-4 max-w-[300px] text-[15px] font-bold leading-relaxed text-[var(--muted)]">{tr('app.tagline')}</p>
            </div>
            <div aria-hidden="true" className="floaty mx-auto mt-10">
              <div className="relative flex h-[34px] w-[138px] items-center justify-center rounded-[50%] bg-gradient-to-b from-[#fff066] via-[#ff2e88] to-[#a100ff] shadow-[0_10px_18px_rgba(255,46,136,.38)] ring-1 ring-black/10">
                <div className="h-[8px] w-[84px] rounded-full bg-white/60" />
              </div>
              <div className="mx-auto mt-2 h-[6px] w-[96px] rounded-full bg-black/10 blur-[2px]" />
            </div>
            <div className="mt-8 flex items-center justify-center gap-2 text-[12px] font-black text-[var(--muted)]">
              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[var(--accent)]">{tr('stat.shape')}</span><span aria-hidden="true">×</span>
              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[var(--accent)]">{tr('stat.spin')}</span><span aria-hidden="true">×</span>
              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[var(--accent)]">{tr('stat.accel')}</span><span aria-hidden="true">=</span>
              <span className="text-[var(--ink)]">{tr('stat.distance')}</span>
            </div>
            <div className="mt-4 rounded-[24px] border border-[var(--line)] bg-[var(--surface)] p-5 text-center shadow-[0_10px_28px_rgba(22,48,42,.07)]">
              <p className="flex items-center justify-center gap-1.5 text-xs font-bold tracking-widest text-[var(--muted)]"><Trophy size={14} className="text-[var(--accent)]" /> {tr('best')}</p>
              <p className="mt-2 bg-gradient-to-r from-[#ff6a00] via-[#ff2e88] to-[#a100ff] bg-clip-text text-[44px] font-black leading-none text-transparent">{bestTotalDisplay > 0 ? fmtScore(bestTotalDisplay) : '—'}</p>
              {bestTotalDisplay > 0 && <p className="mt-2 text-xs font-bold text-[var(--muted)]">{myRecord?.rank ? `${tr('rankShort')} ${myRecord.rank} ・ ` : ''}{fmt(bestDistDisplay)}</p>}
            </div>
            {meName && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 shadow-sm">
                <p className="min-w-0 truncate text-[13px] font-bold text-[var(--muted)]">
                  {tr('playingAs')} <span className="font-black text-[var(--ink)]">{meName}</span>
                </p>
                <button
                  type="button"
                  onClick={() => { window.dispatchEvent(new CustomEvent('dopa:open-rename')); }}
                  className="shrink-0 rounded-full border-2 border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-[12px] font-black text-[var(--ink)] shadow-sm transition active:translate-y-0.5"
                >
                  {tr('rename')}
                </button>
              </div>
            )}
            <button onClick={startGame} className={`${CTA} mt-6 w-full py-5 text-[22px]`}>{tr('start')}</button>
            {apiNote && <p role="status" className="mt-2 text-center text-xs font-bold text-amber-700">{apiNote}</p>}
            <button onClick={() => setShowHow(v => !v)} className="ghost-btn mt-4 rounded-full bg-[var(--surface)] py-3 text-sm font-bold">{showHow ? tr('howtoClose') : tr('howto')}</button>
            {showHow && <div className="pop-in mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-[13px] leading-7">{tr('howto.step1')}<br />{tr('howto.step2')}<br />{tr('howto.resultNote')}</div>}
            <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-black"><Trophy size={17} className="text-[var(--accent)]" /> {tr('top5')}</h2>
              {highScores.length === 0 ? <p className="mt-3 text-sm text-[var(--muted)]">{tr('noRecords')}</p> : <ol className="mt-3 max-h-[42dvh] space-y-2 overflow-y-auto overscroll-contain pr-1">{highScores.map((r, i) => <li key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${(r.isMe ?? isMe(r.name)) ? "bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]" : "bg-[var(--surface-2)]"}`}><span className="font-black">{rankLabel(i + 1)} <span className="ml-1 text-xs text-[var(--muted)]">{r.name}</span> {r.rank && <span className="ml-1 text-[var(--accent)]">{r.rank}</span>}</span><span className="font-black">{fmtScore(r.total ?? r.best)}</span><span className="text-xs text-[var(--muted)]">{fmt(r.best)}</span></li>)}</ol>}
              {apiNote && <p className="mt-2 text-xs text-amber-700">{apiNote}</p>}
            </section>
          </main>
        )}

        {screen === 'playing' && (
          <main className="flex h-[calc(100dvh-var(--safe-area-inset-top))] flex-1 flex-col overflow-hidden">
            <header data-safe-area-sticky-top style={{ top: 'var(--safe-area-inset-top)' }} className="sticky z-20 mx-auto w-full max-w-[640px] shrink-0 bg-[var(--bg)] px-4 pb-3 pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-black tracking-tight">{tr('app.title')}</span>
                <button onClick={toggleMute} aria-label={muted ? tr('unmute') : tr('mute')} className="ghost-btn rounded-full border border-[var(--line)] bg-[var(--surface)] p-2">{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
              </div>
              <nav aria-label={tr("progress")} className="mt-3 flex items-center gap-1.5">
                {steps.map((label, i) => {
                  const done = i < stepIndex;
                  const active = i === stepIndex;
                  return (
                    <React.Fragment key={label}>
                      <span className={`flex-1 rounded-full px-2 py-1.5 text-center text-[12px] font-black transition-colors ${active ? 'bg-[var(--accent)] text-white shadow-[0_6px_14px_rgba(255,46,136,.35)]' : done ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-[var(--surface)] text-[var(--muted)]'}`}>{label}</span>
                      {i < steps.length - 1 && <span aria-hidden="true" className="text-[var(--muted)]">›</span>}
                    </React.Fragment>
                  );
                })}
              </nav>
            </header>

            <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden rounded-b-[24px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.4)]">
              <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className="absolute inset-0 block h-full w-full touch-none select-none" />
              {phase === 'landed' && landedRecord && (
                <div className="pointer-events-none absolute inset-x-0 top-4 z-30 flex justify-center">
                  <div className="record-pop rounded-full bg-white px-5 py-2 text-center shadow-lg">
                    <p className="text-[17px] font-black leading-none text-[var(--accent)]">NEW RECORD</p>
                  </div>
                </div>
              )}
              {phase === 'draw' && !shapeLocked && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center"><span className="rounded-full bg-white/85 px-3 py-1 text-[12px] font-black text-[var(--ink)] shadow-sm backdrop-blur">{tr('drawBubble')}</span></div>
              )}
              {phase === 'aim' && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center"><span className="rounded-full bg-white/85 px-3 py-1 text-[12px] font-black text-[var(--ink)] shadow-sm backdrop-blur">{tr('aimBubble')}</span></div>
              )}
            </div>

            <div className="shrink-0 border-t border-[var(--line)] bg-[var(--surface)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4">
              {phase === 'draw' && !shapeLocked && (
                <div className="text-center">
                  <p className="text-[17px] font-black">{tr('drawHint')}</p>
                  {drawHint ? <p className="mt-1 text-[13px] font-bold text-amber-700">{drawHint}</p> : <p className="mt-1 text-[12px] font-bold text-[var(--muted)]">{tr('drawSub')}</p>}
                </div>
              )}
              {phase === 'draw' && shapeLocked && (
                <button onClick={goToAim} className={`${CTA} w-full py-4`}>{tr('toThrow')} <ArrowRight size={18} /></button>
              )}
              {phase === 'aim' && (
                <div>
                  <p className="flex items-center justify-center gap-2 text-center text-[17px] font-black"><RotateCw size={22} className={`shrink-0 ${spinShown > 0 ? 'text-[#ff2e88]' : 'text-[var(--muted)]'} animate-spin`} style={{ animationDuration: spinShown > 0 ? `${Math.max(0.22, 1.15 - (spinPct / 100) * 0.95)}s` : '1.2s', animationPlayState: spinShown > 0 || momentumLive ? 'running' : 'paused', animationDirection: spinDir < 0 ? 'reverse' : 'normal' }} aria-hidden="true" />{tr('aimHint')}</p>
                  <p className="mt-1 text-center text-[12px] font-bold text-[var(--muted)]">{spinShown > 0 ? tr('aimSpinning', { dir: spinDir < 0 ? tr('dir.ccw') : tr('dir.cw') }) : tr('aimIdle')}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="w-10 shrink-0 text-[13px] font-black text-[var(--muted)]">{tr('stat.spin')}</span>
                    <div className={`h-3 flex-1 overflow-hidden rounded-full bg-black/10 ${spinHot ? 'gauge-glow' : ''}`}>
                      <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${spinPct}%`, background: momentumLive ? 'linear-gradient(90deg,#00e5ff,#ff2e88,#a100ff)' : spinShown > 0 ? '#00e5ff' : 'transparent' }} />
                    </div>
                    <span className={`w-16 shrink-0 text-right text-[13px] font-black tabular-nums ${spinHot ? 'text-[#ff2e88]' : momentumLive ? 'text-[#ff2e88]' : 'text-[var(--muted)]'}`}>{spinShown > 0 ? Math.round(spinShown).toLocaleString('ja-JP') : '—'}</span>
                  </div>
                  {spinHint && <p className="mt-2 text-center text-[12px] font-bold text-amber-700">{spinHint}</p>}
                </div>
              )}
              {phase === 'flying' && (
                <p className="py-2 text-center text-[17px] font-black">{tr('flying')}</p>
              )}
              {phase === 'landed' && lastThrow && (
                <div>
                  <p className="text-center text-[15px] font-black text-[var(--muted)]">{fmt(lastThrow.distance)} <span className="text-[var(--muted)]">= {fmtScore(lastThrow.total)}</span></p>
                  <button ref={nextButtonRef} onClick={finishGame} className={`${CTA} mt-3 w-full py-4`}>{tr('seeResult')} <ArrowRight size={18} /></button>
                </div>
              )}
            </div>
          </main>
        )}

        {screen === 'result' && result.throw && (
          <main className="mx-auto flex w-full max-w-[600px] flex-1 flex-col px-5 pb-8 pt-6">
            <header className="flex items-center justify-between">
              <span className="text-[15px] font-black tracking-tight">{tr('app.title')}</span>
              <nav aria-label={tr("progress")} className="flex items-center gap-1.5">
                {steps.map((label, i) => (
                  <React.Fragment key={label}>
                    <span className={`rounded-full px-2 py-1 text-center text-[11px] font-black ${i === 2 ? 'bg-[var(--accent)] text-white' : 'bg-[var(--accent-soft)] text-[var(--accent)]'}`}>{label}</span>
                    {i < steps.length - 1 && <span aria-hidden="true" className="text-[var(--muted)]">›</span>}
                  </React.Fragment>
                ))}
              </nav>
            </header>
            <div className="mt-8 text-center">
              <p className="text-xs font-bold tracking-[0.22em] text-[var(--muted)]">FLYING DISTANCE</p>
              <p className="mt-2 bg-gradient-to-r from-[#ff6a00] via-[#ff2e88] to-[#a100ff] bg-clip-text text-[clamp(56px,17vw,76px)] font-black leading-none tracking-tight text-transparent">{displayedTotal.toFixed(1)}<span className="text-[24px]">m</span></p>
              <p className="mt-2 text-sm font-bold text-[var(--muted)]">{tr("scoreIsDistance")} ・ {fmtScore(result.total)}</p>
              {rankShown && <div className="rank-bang mt-4 text-[56px] font-black leading-none text-[var(--accent)]">{result.rank}</div>}
              {!rankShown && <div className="mt-4 h-[56px]" aria-hidden="true" />}
              {isNewBest && <p className="mx-auto mt-3 flex w-fit items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-black text-[var(--accent)] shadow-sm"><Sparkles size={15} /> {tr('newRecord')}</p>}
            </div>

            <div className="mt-6 overflow-hidden rounded-[20px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_10px_28px_rgba(22,48,42,.07)]">
              <div className="border-b border-[var(--line)] px-4 py-3"><p className="text-[12px] font-black tracking-widest text-[var(--muted)]">{tr('formula')}</p></div>
              <div className="divide-y divide-[var(--line)]">
                {resultFactors?.list.map((f, i) => (
                  <div key={f.label} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-black">{f.label}{i === resultFactors.bestIdx && <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-black text-[var(--accent)]">{tr('spin.decisive')}</span>}</span>
                      <span className="text-sm font-black tabular-nums">{f.value}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-gradient-to-r from-[#00e5ff] via-[#ff2e88] to-[#a100ff]" style={{ width: `${Math.max(6, f.pct)}%` }} /></div>
                      <span className="w-[86px] shrink-0 text-right text-[12px] font-bold text-[var(--muted)]">{f.note}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {resultFactors && resultFactors.shapeParams.length > 0 && (
          <div className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <h3 className="text-sm font-black">{tr('param.title')}</h3>
            <div className="mt-2 space-y-2">
              {resultFactors.shapeParams.map((p) => (
                <div key={p.label} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[11px] font-bold text-[var(--muted)]">{p.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#00e5ff] to-[#ff2e88]"
                      style={{ width: `${Math.round(p.v * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] font-black tabular-nums">
                    {Math.round(p.v * 100)}%
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-bold text-[var(--muted)]">{tr('param.glide')}</span>
                <span className="text-sm font-black tabular-nums">{resultFactors.glide.toFixed(1)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-auto pt-8">
              <div className="mb-4 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_10px_28px_rgba(22,48,42,.07)]">
                <p className="text-[12px] font-black tracking-widest text-[var(--muted)]">{tr('share.title')}</p>
                <div className="mt-3 flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={shareToX}
                    disabled={shareBusy}
                    className={`${CTA} min-w-0 flex-1 py-3.5 text-[16px] disabled:opacity-60`}
                  >
                    <Share2 size={18} /> {shareBusy ? tr('share.busy') : tr('share.x')}
                  </button>
                  <button
                    type="button"
                    onClick={saveResultImage}
                    disabled={shareBusy}
                    className="ghost-btn flex shrink-0 items-center justify-center gap-2 rounded-full border-2 border-[var(--line)] bg-[var(--surface-2)] px-4 py-3.5 text-[14px] font-black disabled:opacity-60"
                  >
                    <Download size={17} /> {tr('share.save')}
                  </button>
                </div>
                {shareNote && <p role="status" className="mt-2 text-center text-[12px] font-bold leading-relaxed text-[var(--accent)]">{shareNote}</p>}
              </div>
              <button onClick={startGame} className={`${CTA} w-full py-5 text-[20px]`}><RotateCcw size={20} /> {tr('again')}</button>
              <button onClick={() => setScreen('start')} className="ghost-btn mx-auto mt-3 flex items-center justify-center gap-2 rounded-full bg-[var(--surface)] px-6 py-3 font-bold"><Home size={18} /> {tr('backToTitle')}</button>
            </div>
            {apiNote && <p className="mt-3 text-center text-xs text-amber-700">{apiNote}</p>}
          </main>
        )}
      </div>
    </div>
  );
}
