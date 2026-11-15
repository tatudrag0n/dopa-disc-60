import { useCallback, useEffect, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import {
  analyzeShape,
  decaySpin,
  normalizeAngle,
  resolvePlay,
  stepSpin,
  type PlayResult,
  type Pt,
  type ShapeAnalysis,
  type SpinState,
} from "./engine";
import { useI18n } from "../lib/i18n";

type Phase = "draw" | "spin" | "fly";

interface Props {
  /** 飛び終わったら結果を渡す */
  onFinish: (result: PlayResult) => void;
  /** この値が変わると最初からやり直す */
  resetKey: number;
  /** 自己ベスト（HUD 表示用） */
  best?: number;
  /** ランキングを開く */
  onOpenRanking: () => void;
}

interface Hud {
  phase: Phase;
  shapeScore: number;
  rot: number;
  mom: number;
}

const HUD_INTERVAL_MS = 70;

/** 発射判定: ステージ上端から 12% より上に運んだら飛ぶ（原作と同じ） */
const FLY_THRESHOLD = 0.12;

export function DiscGame({ onFinish, resetKey, best = 0, onOpenRanking }: Props) {
  const { t } = useI18n();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const traceRef = useRef<HTMLCanvasElement | null>(null);
  const discRef = useRef<HTMLCanvasElement | null>(null);

  const phase = useRef<Phase>("draw");
  const pts = useRef<Pt[]>([]);
  const shape = useRef<ShapeAnalysis | null>(null);
  const spin = useRef<SpinState>({ rot: 0, mom: 0, spinAngle: 0 });
  const discPos = useRef<Pt>({ x: 0, y: 0 });
  const drawing = useRef(false);
  const lastAngle = useRef(0);
  const lastTime = useRef(0);
  const lastMoveTime = useRef(0);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const flight = useRef<{ start: number; dur: number } | null>(null);
  const hudAt = useRef(0);
  const finished = useRef(false);

  const [hud, setHud] = useState<Hud>({ phase: "draw", shapeScore: 0, rot: 0, mom: 0 });
  const [message, setMessage] = useState("");

  /** 原作の center(): ステージ中央やや下 */
  const center = useCallback(() => {
    const { w, h } = size.current;
    return { x: w / 2, y: h * 0.58 };
  }, []);

  /* ---------------- 描画（原作 drawDisc / drawTrace の移植） ---------------- */

  const drawDisc = useCallback(() => {
    const canvas = discRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const s = shape.current;
    if (!s) return;

    const pos = discPos.current;
    const baseR = s.avg;
    const r = Math.max(28, Math.min(90, baseR * 0.9));

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // 影
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.85, r * 1.05, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // 本体（側面のドーム）
    const grad = ctx.createLinearGradient(-r, -r * 0.5, r, r * 0.5);
    grad.addColorStop(0, "#ff9a00");
    grad.addColorStop(0.45, "#ff2e8a");
    grad.addColorStop(1, "#7b2eff");
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.quadraticCurveTo(-r * 0.6, -r * 0.55, 0, -r * 0.55);
    ctx.quadraticCurveTo(r * 0.6, -r * 0.55, r, 0);
    ctx.quadraticCurveTo(r * 0.6, r * 0.22, 0, r * 0.22);
    ctx.quadraticCurveTo(-r * 0.6, r * 0.22, -r, 0);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 回転が分かるライン
    ctx.save();
    ctx.rotate(spin.current.spinAngle);
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.82, 0);
    ctx.lineTo(r * 0.82, 0);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.beginPath();
    ctx.arc(r * 0.62, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 描いた形の輪郭
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    s.pts.forEach((p, i) => {
      const a = Math.atan2(p.y - s.cy, p.x - s.cx);
      const rr = Math.hypot(p.x - s.cx, p.y - s.cy);
      const nr = r * (rr / (s.avg || 1));
      const x = Math.cos(a + spin.current.spinAngle) * nr;
      const y = Math.sin(a + spin.current.spinAngle) * nr * 0.22;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }, []);

  const drawTrace = useCallback(() => {
    const canvas = traceRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (pts.current.length < 2) return;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.current.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }, []);

  const clearTrace = useCallback(() => {
    const canvas = traceRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
  }, []);

  /* ---------------- 進行 ---------------- */

  const finishPlay = useCallback(() => {
    if (finished.current || !shape.current) return;
    finished.current = true;
    const result = resolvePlay(shape.current.score, spin.current);
    try {
      navigator.vibrate?.(result.distance > 100 ? [30, 40, 60] : 25);
    } catch {
      /* noop */
    }
    onFinish(result);
  }, [onFinish]);

  const launch = useCallback(() => {
    if (phase.current !== "spin" || !shape.current || flight.current) return;
    const { w, h } = size.current;
    const result = resolvePlay(shape.current.score, spin.current);
    const dur = 1400 + result.distance * 8;
    const start = performance.now();
    flight.current = { start, dur };
    phase.current = "fly";
    setMessage(t("game.flyHint"));
    try {
      navigator.vibrate?.(18);
    } catch {
      /* noop */
    }

    const anim = () => {
      const p = Math.min(1, (performance.now() - start) / dur);
      discPos.current = {
        x: w / 2 + Math.sin(p * 2) * 6,
        y: h * 0.42 - Math.sin(p * Math.PI) * 18,
      };
      spin.current = { ...spin.current, spinAngle: spin.current.spinAngle + 0.35 };
      drawDisc();
      if (p < 1) requestAnimationFrame(anim);
      else finishPlay();
    };
    requestAnimationFrame(anim);
  }, [drawDisc, finishPlay, t]);

  const evaluateShape = useCallback(() => {
    const analysis = analyzeShape(pts.current);
    if (!analysis) {
      pts.current = [];
      drawTrace();
      return;
    }
    shape.current = analysis;
    phase.current = "spin";
    discPos.current = center();
    spin.current = { rot: 0, mom: 0, spinAngle: 0 };
    clearTrace();
    drawDisc();
    setMessage(t("game.spinHint"));
    setHud({ phase: "spin", shapeScore: analysis.score, rot: 0, mom: 0 });
    try {
      navigator.vibrate?.(15);
    } catch {
      /* noop */
    }
  }, [center, clearTrace, drawDisc, drawTrace, t]);

  const retry = useCallback(() => {
    phase.current = "draw";
    pts.current = [];
    shape.current = null;
    spin.current = { rot: 0, mom: 0, spinAngle: 0 };
    flight.current = null;
    finished.current = false;
    discPos.current = center();
    setHud({ phase: "draw", shapeScore: 0, rot: 0, mom: 0 });
    setMessage(t("game.drawHint"));
    clearTrace();
    drawDisc();
  }, [center, clearTrace, drawDisc, t]);

  /* ---------------- 入力 ---------------- */

  // 入力はステージ全体で受ける（円盤レイヤーが上に重なっていても効くように）
  const pointFromEvent = useCallback((e: PointerEvent): Pt => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const rect = stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onDown = (e: PointerEvent) => {
      if (phase.current === "fly") return;
      e.preventDefault();
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        /* 合成イベントでは失敗するので無視 */
      }
      const p = pointFromEvent(e);

      if (phase.current === "draw") {
        drawing.current = true;
        pts.current = [p];
        return;
      }

      const { w, h } = size.current;
      lastAngle.current = Math.atan2(p.y - h * 0.58, p.x - w / 2);
      lastTime.current = performance.now();
      lastMoveTime.current = lastTime.current;
      drawing.current = true;
    };

    const onMove = (e: PointerEvent) => {
      if (!drawing.current || phase.current === "fly") return;
      e.preventDefault();
      const p = pointFromEvent(e);

      if (phase.current === "draw") {
        pts.current.push(p);
        drawTrace();
        return;
      }

      const { w, h } = size.current;
      const now = performance.now();
      const angle = Math.atan2(p.y - h * 0.58, p.x - w / 2);
      const da = normalizeAngle(angle - lastAngle.current);
      const dt = now - lastTime.current;
      lastAngle.current = angle;
      lastTime.current = now;
      lastMoveTime.current = now;

      spin.current = stepSpin(spin.current, da, dt, shape.current?.clean ?? 0);
      discPos.current = { x: p.x, y: p.y };
      drawDisc();

      // 原作と同じく、上端まで運んだら発射
      if (p.y < h * FLY_THRESHOLD) launch();
    };

    const onUp = (e: PointerEvent) => {
      if (!drawing.current) return;
      drawing.current = false;
      try {
        stage.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (phase.current === "draw") evaluateShape();
    };

    const onCancel = () => {
      drawing.current = false;
    };

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onCancel);
    return () => {
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onCancel);
    };
  }, [drawDisc, drawTrace, evaluateShape, launch, pointFromEvent]);

  // キーボード（PC 用の隠し操作。画面には出さない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (phase.current === "spin") launch();
        else if (phase.current === "draw" && pts.current.length > 16) evaluateShape();
      }
      if (e.key.toLowerCase() === "r") retry();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [evaluateShape, launch, retry]);

  /* ---------------- ライフサイクル ---------------- */

  useEffect(() => {
    const stage = stageRef.current;
    const trace = traceRef.current;
    const disc = discRef.current;
    if (!stage || !trace || !disc) return;

    const apply = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: rect.width, h: rect.height, dpr };
      for (const canvas of [trace, disc]) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }
      if (!shape.current) discPos.current = center();
      drawDisc();
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [center, drawDisc]);

  useEffect(() => {
    retry();
  }, [resetKey, retry]);

  // 勢いの減衰 + HUD 更新
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;

      if (phase.current === "spin") {
        if (now - lastMoveTime.current > 90) spin.current = decaySpin(spin.current, dt);
        if (now - hudAt.current > HUD_INTERVAL_MS) {
          hudAt.current = now;
          setHud({
            phase: phase.current,
            shapeScore: shape.current?.score ?? 0,
            rot: Math.round(spin.current.rot),
            mom: Math.round(spin.current.mom),
          });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    document.body.classList.add("dopa-locked");
    return () => document.body.classList.remove("dopa-locked");
  }, []);

  /* ---------------- 見た目（原作のレイアウト） ---------------- */

  const stepLabel =
    hud.phase === "draw" ? t("game.step1") : hud.phase === "spin" ? t("game.step2") : t("game.flying");

  return (
    <div className="game-root">
      <header className="game-header">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="game-title truncate">{t("app.title")}</h1>
          <div className="game-step">{stepLabel}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenRanking}
            className="grid h-7 w-7 place-items-center rounded-full bg-white/25 text-white transition active:scale-95"
            aria-label={t("sheet.ranking")}
          >
            <Trophy className="h-4 w-4" />
          </button>
          <div className="game-best">
            {best > 0 ? t("game.best", { v: best.toFixed(1) }) : "BEST —"}
          </div>
        </div>
      </header>

      <main ref={stageRef} className="game-stage">
        <div className="game-sky" />
        <div className="game-ground" />
        <div className="game-horizon" />
        <canvas ref={traceRef} className="game-canvas" />
        <canvas ref={discRef} className="game-canvas game-disc" />

        <div className="game-info">
          <div className="game-msg">{message}</div>
          <div className="game-stats">
            <div className="game-pill">
              {t("game.stat.shape")} <b>{hud.phase === "draw" ? "—" : `${hud.shapeScore}%`}</b>
            </div>
            <div className="game-pill">
              {t("game.stat.rot")} <b>{hud.phase === "draw" ? "0" : hud.rot}</b>
            </div>
            <div className="game-pill">
              {t("game.stat.mom")} <b>{hud.phase === "draw" ? "0%" : `${hud.mom}%`}</b>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
