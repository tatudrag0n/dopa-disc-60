import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, Sparkles, Zap } from "lucide-react";
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
import { ROT_MAX } from "../shared/types";

type Phase = "draw" | "spin" | "fly";

interface Props {
  /** 飛び終わったら結果を渡す */
  onFinish: (result: PlayResult) => void;
  /** ゲームを抜ける */
  onExit: () => void;
  /** この値が変わると最初からやり直す */
  resetKey: number;
  /** 自己ベスト（HUD 表示用） */
  best?: number;
}

interface Hud {
  phase: Phase;
  shapeScore: number;
  rot: number;
  mom: number;
}

const HUD_INTERVAL_MS = 70;

export function DiscGame({ onFinish, onExit, resetKey, best = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 描画・入力で共有する可変状態（再レンダリングさせない）
  const phase = useRef<Phase>("draw");
  const pts = useRef<Pt[]>([]);
  const shape = useRef<ShapeAnalysis | null>(null);
  const spin = useRef<SpinState>({ rot: 0, mom: 0, spinAngle: 0 });
  const disc = useRef<Pt>({ x: 0, y: 0 });
  const drawing = useRef(false);
  const lastAngle = useRef(0);
  const lastTime = useRef(0);
  const lastMoveTime = useRef(0);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const flight = useRef<{ start: number; dur: number; dist: number } | null>(null);
  const scroll = useRef(0);
  const hudAt = useRef(0);
  const finished = useRef(false);

  const [hud, setHud] = useState<Hud>({ phase: "draw", shapeScore: 0, rot: 0, mom: 0 });

  const center = useCallback(() => {
    const { w, h } = size.current;
    return { x: w / 2, y: h * 0.6 };
  }, []);

  /* ---------------- 描画 ---------------- */

  const drawDisc = useCallback(
    (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
      const s = shape.current;
      ctx.save();
      ctx.translate(x, y);

      // 影
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(0, r * 0.9, r * 1.1, r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();

      // 本体（側面のドーム）
      const grad = ctx.createLinearGradient(-r, -r * 0.6, r, r * 0.5);
      grad.addColorStop(0, "#ff9a00");
      grad.addColorStop(0.45, "#ff2e8a");
      grad.addColorStop(1, "#7b2eff");
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(-r * 0.6, -r * 0.56, 0, -r * 0.56);
      ctx.quadraticCurveTo(r * 0.6, -r * 0.56, r, 0);
      ctx.quadraticCurveTo(r * 0.6, r * 0.22, 0, r * 0.22);
      ctx.quadraticCurveTo(-r * 0.6, r * 0.22, -r, 0);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // ハイライト
      ctx.beginPath();
      ctx.moveTo(-r * 0.78, -r * 0.1);
      ctx.quadraticCurveTo(-r * 0.3, -r * 0.5, r * 0.2, -r * 0.42);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = Math.max(2, r * 0.07);
      ctx.lineCap = "round";
      ctx.stroke();

      // 回転が分かるライン
      ctx.save();
      ctx.rotate(spin.current.spinAngle);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(2, r * 0.05);
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, 0);
      ctx.lineTo(r * 0.8, 0);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.beginPath();
      ctx.arc(r * 0.62, 0, Math.max(2.5, r * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 描いた形の歪みを縁に反映
      if (s && s.avg > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        s.pts.forEach((p, i) => {
          const a = Math.atan2(p.y - s.cy, p.x - s.cx) + spin.current.spinAngle;
          const rr = (Math.hypot(p.x - s.cx, p.y - s.cy) / s.avg) * r;
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr * 0.24;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();
      }

      ctx.restore();
    },
    [],
  );

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = size.current;
    if (w === 0 || h === 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 空
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    sky.addColorStop(0, "#0f7bff");
    sky.addColorStop(0.45, "#38a9ff");
    sky.addColorStop(0.8, "#8fd6ff");
    sky.addColorStop(1, "#cdf1dd");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 地面
    const groundTop = h * 0.58;
    const g = ctx.createLinearGradient(0, groundTop, 0, h);
    g.addColorStop(0, "#3ff07a");
    g.addColorStop(0.55, "#1fd463");
    g.addColorStop(1, "#0fb04a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, groundTop + 18);
    ctx.quadraticCurveTo(w / 2, groundTop - 26, w, groundTop + 18);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // 地面のスクロール（飛んでいるときだけ動く＝距離感）
    if (scroll.current > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 3;
      const gap = 64;
      const offset = scroll.current % gap;
      for (let x = -offset; x < w + gap; x += gap) {
        const t = (x / w) * 2 - 1;
        const y = groundTop + 44 + Math.abs(t) * 26;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 26, y + 22);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 地平線
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundTop);
    ctx.lineTo(w, groundTop);
    ctx.stroke();

    // 描いた線
    if (pts.current.length > 1) {
      ctx.strokeStyle = phase.current === "draw" ? "#ffffff" : "rgba(255,255,255,0.35)";
      ctx.lineWidth = phase.current === "draw" ? 6 : 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.current.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    // 円盤
    if (shape.current) {
      const r = Math.max(30, Math.min(84, shape.current.avg * 0.85));
      const pos = phase.current === "draw" ? center() : disc.current;
      const scale = flight.current ? 1 - 0.22 * flightRatio() : 1;
      drawDisc(ctx, pos.x, pos.y, r * scale);
    }

    // 回転リング（スピン中のガイド）と回転量ゲージ
    if (phase.current === "spin" && shape.current) {
      const c = disc.current;
      const ringR = Math.max(58, Math.min(120, shape.current.avg * 1.25));
      const ratio = Math.min(1, spin.current.rot / ROT_MAX);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.setLineDash([7, 12]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // 回転量は上から時計回りのアークで示す
      if (ratio > 0) {
        ctx.setLineDash([]);
        ctx.lineWidth = 7;
        ctx.lineCap = "round";
        ctx.strokeStyle = ratio >= 0.99 ? "#ffd400" : "#ff2e8a";
        ctx.beginPath();
        ctx.arc(c.x, c.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [center, drawDisc]);

  const flightRatio = useCallback(() => {
    const f = flight.current;
    if (!f) return 0;
    return Math.min(1, (performance.now() - f.start) / f.dur);
  }, []);

  /* ---------------- ゲーム進行 ---------------- */

  const finishPlay = useCallback(() => {
    if (finished.current || !shape.current) return;
    finished.current = true;
    const result = resolvePlay(shape.current.score, spin.current);
    try {
      navigator.vibrate?.(result.distance > 100 ? [30, 40, 60] : 25);
    } catch {
      /* 非対応環境は無視 */
    }
    onFinish(result);
  }, [onFinish]);

  const launch = useCallback(() => {
    if (phase.current !== "spin" || !shape.current || flight.current) return;
    const { h } = size.current;
    const result = resolvePlay(shape.current.score, spin.current);
    const dur = 1150 + result.distance * 8;
    const start = performance.now();

    const from = { ...disc.current };
    const to = { x: from.x, y: Math.max(h * 0.16, from.y - h * 0.28) };
    flight.current = { start, dur, dist: result.distance };
    phase.current = "fly";
    scroll.current = 0;

    try {
      navigator.vibrate?.(18);
    } catch {
      /* noop */
    }

    const anim = () => {
      const p = Math.min(1, (performance.now() - start) / dur);
      const e = easeOut(p);
      disc.current = {
        x: from.x + Math.sin(p * 7) * 5,
        y: from.y + (to.y - from.y) * e,
      };
      scroll.current += (6 + result.distance * 0.9) * (1 - p * 0.5);
      spin.current = { ...spin.current, spinAngle: spin.current.spinAngle + 0.42 };
      render();
      if (p < 1) requestAnimationFrame(anim);
      else finishPlay();
    };
    requestAnimationFrame(anim);
  }, [finishPlay, render]);

  const evaluateShape = useCallback(() => {
    const analysis = analyzeShape(pts.current);
    if (!analysis) {
      pts.current = [];
      render();
      return;
    }
    shape.current = analysis;
    phase.current = "spin";
    disc.current = { x: analysis.cx, y: Math.max(analysis.cy, size.current.h * 0.42) };
    spin.current = { rot: 0, mom: 0, spinAngle: 0 };
    try {
      navigator.vibrate?.(15);
    } catch {
      /* noop */
    }
    setHud({ phase: "spin", shapeScore: analysis.score, rot: 0, mom: 0 });
    render();
  }, [render]);

  const retry = useCallback(() => {
    phase.current = "draw";
    pts.current = [];
    shape.current = null;
    spin.current = { rot: 0, mom: 0, spinAngle: 0 };
    flight.current = null;
    scroll.current = 0;
    finished.current = false;
    disc.current = center();
    setHud({ phase: "draw", shapeScore: 0, rot: 0, mom: 0 });
    render();
  }, [center, render]);

  /* ---------------- 入力 ---------------- */

  const pointFromEvent = useCallback((e: PointerEvent): Pt => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (e: PointerEvent) => {
      if (phase.current === "fly") return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 合成イベントや既に解放済みのポインタでは失敗するので無視 */
      }
      const p = pointFromEvent(e);

      if (phase.current === "draw") {
        drawing.current = true;
        pts.current = [p];
        render();
        return;
      }

      // spin
      const c = disc.current;
      lastAngle.current = Math.atan2(p.y - c.y, p.x - c.x);
      lastTime.current = performance.now();
      lastMoveTime.current = lastTime.current;
      drawing.current = true;
      disc.current = { ...disc.current, x: c.x };
    };

    const onMove = (e: PointerEvent) => {
      if (!drawing.current || phase.current === "fly") return;
      e.preventDefault();
      const p = pointFromEvent(e);

      if (phase.current === "draw") {
        pts.current.push(p);
        render();
        return;
      }

      const c = disc.current;
      const now = performance.now();
      const angle = Math.atan2(p.y - c.y, p.x - c.x);
      const da = normalizeAngle(angle - lastAngle.current);
      const dt = now - lastTime.current;
      lastAngle.current = angle;
      lastTime.current = now;
      lastMoveTime.current = now;

      spin.current = stepSpin(spin.current, da, dt, shape.current?.clean ?? 0);
      render();

      // 上まで運んだら飛ぶ（原作の「そのまま上までスワイプ」）
      if (p.y < size.current.h * 0.13) {
        launch();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!drawing.current) return;
      drawing.current = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (phase.current === "draw") {
        evaluateShape();
        return;
      }
      // 画面の上のほうで離した / 十分に勢いがあるなら飛ばす
      const p = pointFromEvent(e);
      const upper = p.y < size.current.h * 0.46;
      if (upper || spin.current.mom >= 55) launch();
    };

    const onCancel = () => {
      drawing.current = false;
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
    };
  }, [evaluateShape, launch, pointFromEvent, render]);

  // キーボード操作（PC）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onExit();
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (phase.current === "spin") launch();
        if (phase.current === "draw" && pts.current.length > 16) evaluateShape();
      }
      if (e.key.toLowerCase() === "r") retry();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [evaluateShape, launch, onExit, retry]);

  /* ---------------- ライフサイクル ---------------- */

  // リサイズ
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const apply = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (phase.current === "draw" || !shape.current) disc.current = center();
      render();
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [center, render]);

  // リセット
  useEffect(() => {
    retry();
  }, [resetKey, retry]);

  // スピン中の勢い減衰 + HUD 更新ループ
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;

      if (phase.current === "spin") {
        if (now - lastMoveTime.current > 90) {
          spin.current = decaySpin(spin.current, dt);
        }
        if (now - hudAt.current > HUD_INTERVAL_MS) {
          hudAt.current = now;
          setHud({
            phase: phase.current,
            shapeScore: shape.current?.score ?? 0,
            rot: Math.round(spin.current.rot),
            mom: Math.round(spin.current.mom),
          });
        }
        render();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [render]);

  // ページスクロール抑止（ゲーム中）
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /* ---------------- 見た目 ---------------- */

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 z-50 select-none overflow-hidden bg-[#0f7bff]"
      style={{ touchAction: "none", WebkitUserSelect: "none" }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* 上部 HUD */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={onExit}
          className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-white/90 text-[#12122b] shadow-lg ring-2 ring-black/10 transition active:scale-95"
          aria-label="ゲームをやめる"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-black tracking-wider text-[#12122b] shadow">
            {phaseLabel(hud.phase)}
          </span>
          {best > 0 && (
            <span className="rounded-full bg-black/35 px-3 py-1 text-[11px] font-black text-white backdrop-blur">
              BEST {best.toFixed(1)}m
            </span>
          )}
        </div>
      </div>

      {/* 下部 HUD */}
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <p className="rounded-full bg-black/45 px-4 py-2 text-center text-sm font-bold text-white backdrop-blur-md">
          {helpText(hud.phase, hud.mom)}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Pill label="形" value={hud.phase === "draw" ? "—" : `${hud.shapeScore}%`} />
          <Pill label="回転" value={hud.phase === "draw" ? "—" : `${hud.rot}`} />
          <Pill
            label="勢い"
            value={hud.phase === "draw" ? "—" : `${hud.mom}%`}
            meter={hud.mom / 100}
          />
        </div>

        {hud.phase === "spin" && (
          <button
            type="button"
            onClick={launch}
            className="mt-1 flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-[var(--pink)] px-6 py-4 text-lg font-black text-white shadow-[0_6px_0_#12122b] transition active:translate-y-1 active:shadow-[0_2px_0_#12122b]"
          >
            <Zap className="h-5 w-5" />
            飛ばす
            {hud.mom < 20 && <span className="text-xs font-bold opacity-70">（勢い不足）</span>}
          </button>
        )}

        {hud.phase === "draw" && (
          <div className="flex items-center gap-2 text-[11px] font-bold text-white/80">
            <Sparkles className="h-3.5 w-3.5" />
            1筆で円を描くほど高スコア
          </div>
        )}
      </div>

      {/* リセット（デバッグ兼救済） */}
      <button
        type="button"
        onClick={retry}
        className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/60 text-[#12122b] backdrop-blur transition active:scale-95"
        aria-label="やり直す"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
    </div>
  );
}

function Pill({ label, value, meter }: { label: string; value: string; meter?: number }) {
  return (
    <div className="relative overflow-hidden rounded-full bg-white/95 px-3 py-1.5 text-xs font-black text-[#12122b] shadow">
      {meter !== undefined && (
        <span
          className="absolute inset-y-0 left-0 bg-[#ffd400]/70 transition-[width] duration-100"
          style={{ width: `${Math.min(100, Math.max(0, meter * 100))}%` }}
          aria-hidden="true"
        />
      )}
      <span className="relative">
        {label} <b className="text-[#ff2e8a]">{value}</b>
      </span>
    </div>
  );
}

function phaseLabel(phase: Phase): string {
  if (phase === "draw") return "STEP 1 / 2";
  if (phase === "spin") return "STEP 2 / 2";
  return "FLYING";
}

function helpText(phase: Phase, mom: number): string {
  if (phase === "draw") return "円盤の形を1筆で描いてね";
  if (phase === "spin") {
    if (mom >= 55) return "いい勢い！そのまま上へスワイプ";
    if (mom >= 20) return "ぐるっと回して上へスワイプ！（ボタンでもOK）";
    return "円盤のまわりをぐるぐる回して勢いをつけよう";
  }
  return "ビュッと飛んでる！";
}

function easeOut(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}
