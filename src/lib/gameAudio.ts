/**
 * ゲームの音響エンジン（WebAudio で手続き的に生成する）。
 *
 * 音声ファイルを持たないので、
 *  - ダウンロードが増えない
 *  - ループの継ぎ目が完全に無い
 *  - 回転数などに応じて音を変化させられる
 *
 * BGM は 16 ステップ × 4 小節（Am → F → C → G）のチップチューン。
 * SFX はレイヤーを重ねて作る（ノイズ + トーン + フィルタ）。
 */

export type SfxName =
  | "click"
  | "throw"
  | "land"
  | "best"
  | "bonus"
  | "drawStart"
  | "drawTick"
  | "shapeDone"
  | "spinTick"
  | "grade";

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 4 小節ぶんのコード進行（MIDI ノート） */
const PROGRESSION: number[][] = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [48, 52, 55], // C
  [55, 59, 62], // G
];

const BASS_ROOTS = [45, 41, 36, 43]; // A2, F2, C2, G2

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private muted = false;
  private bgmTimer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private running = false;

  /** 拍の長さ（秒）。132 BPM の 16 分音符 */
  private readonly stepDur = 60 / 132 / 4;

  /* ---------------- 初期化 ---------------- */

  ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 1;
      master.connect(ctx.destination);

      const bgm = ctx.createGain();
      bgm.gain.value = 0.32;
      bgm.connect(master);

      const sfx = ctx.createGain();
      sfx.gain.value = 0.7;
      sfx.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.bgmGain = bgm;
      this.sfxGain = sfx;
      this.noise = this.makeNoise(ctx);
      return ctx;
    } catch {
      return null;
    }
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(next: boolean) {
    this.muted = next;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(next ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  isMuted() {
    return this.muted;
  }

  /* ---------------- 音の部品 ---------------- */

  private tone(
    out: AudioNode,
    type: OscillatorType,
    from: number,
    to: number,
    dur: number,
    gain: number,
    when = 0,
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  private noiseBurst(
    out: AudioNode,
    dur: number,
    gain: number,
    filter: BiquadFilterType,
    freq: number,
    freqTo?: number,
    when = 0,
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, freqTo), t + dur);
    f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /* ---------------- SFX ---------------- */

  sfx(name: SfxName, param = 0) {
    const ctx = this.ensure();
    const out = this.sfxGain;
    if (!ctx || !out || this.muted) return;
    void ctx;

    switch (name) {
      case "click":
        this.tone(out, "sine", 620, 780, 0.07, 0.05);
        this.noiseBurst(out, 0.04, 0.02, "highpass", 3000);
        break;

      case "drawStart":
        this.noiseBurst(out, 0.18, 0.05, "bandpass", 900, 2400);
        this.tone(out, "sine", 320, 620, 0.16, 0.04);
        break;

      case "drawTick":
        this.tone(out, "square", 1500 + param * 600, 1800 + param * 600, 0.03, 0.012);
        break;

      case "shapeDone":
        [0, 4, 7].forEach((s, i) =>
          this.tone(out, "triangle", midi(72 + s), midi(72 + s) * 1.01, 0.18, 0.05, i * 0.05),
        );
        this.noiseBurst(out, 0.14, 0.03, "highpass", 4000);
        break;

      case "spinTick":
        // param 0..1 で音程が上がる（回転が乗るほど高く）
        this.tone(out, "square", 900 + param * 1500, 1100 + param * 1700, 0.035, 0.018);
        break;

      case "throw":
        // うなり + 空気を切る音
        this.noiseBurst(out, 0.5, 0.11, "bandpass", 500, 3200);
        this.tone(out, "sine", 240, 1100, 0.26, 0.07);
        this.tone(out, "triangle", 520, 1500, 0.2, 0.035, 0.02);
        this.tone(out, "sine", 150, 420, 0.18, 0.03, 0.01);
        break;

      case "land":
        this.tone(out, "sine", 220, 70, 0.3, 0.1);
        this.tone(out, "triangle", 520, 300, 0.16, 0.04, 0.02);
        this.noiseBurst(out, 0.22, 0.06, "lowpass", 1400, 300);
        break;

      case "best":
        // ファンファーレ（上行アルペジオ + きらめき）
        [72, 76, 79, 84, 88].forEach((m, i) =>
          this.tone(out, "triangle", midi(m), midi(m) * 1.005, 0.34, 0.055, i * 0.075),
        );
        [96, 100, 103].forEach((m, i) =>
          this.tone(out, "sine", midi(m), midi(m) * 1.02, 0.22, 0.03, 0.36 + i * 0.05),
        );
        this.noiseBurst(out, 0.4, 0.05, "highpass", 6000, 9000);
        break;

      case "bonus":
        this.tone(out, "sine", midi(76), midi(83), 0.14, 0.05);
        this.tone(out, "sine", midi(83), midi(88), 0.16, 0.045, 0.07);
        this.noiseBurst(out, 0.12, 0.025, "highpass", 5200);
        break;

      case "grade":
        // param = 0:S, 1:A, 2:B, 3:C
        if (param === 0) {
          [72, 79, 84].forEach((m, i) =>
            this.tone(out, "triangle", midi(m), midi(m), 0.5, 0.06, i * 0.06),
          );
        } else if (param === 1) {
          [69, 76].forEach((m, i) =>
            this.tone(out, "triangle", midi(m), midi(m), 0.4, 0.05, i * 0.06),
          );
        } else if (param === 2) {
          this.tone(out, "triangle", midi(67), midi(67), 0.34, 0.045);
        } else {
          this.tone(out, "sine", midi(64), midi(62), 0.3, 0.04);
        }
        break;
    }
  }

  /* ---------------- BGM ---------------- */

  start() {
    const ctx = this.ensure();
    if (!ctx || this.running) return;
    this.running = true;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.08;
    this.bgmTimer = window.setInterval(() => this.scheduler(), 40);
  }

  stop() {
    this.running = false;
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private scheduler() {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    // 0.25 秒先まで刻む
    while (this.nextTime < ctx.currentTime + 0.25) {
      this.scheduleStep(this.step, this.nextTime);
      this.step = (this.step + 1) % 64;
      this.nextTime += this.stepDur;
    }
  }

  private scheduleStep(step: number, when: number) {
    const ctx = this.ctx;
    const out = this.bgmGain;
    if (!ctx || !out) return;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = PROGRESSION[bar];
    const at = when - ctx.currentTime;

    // キック（4つ打ち）
    if (s % 4 === 0) this.tone(out, "sine", 140, 46, 0.15, 0.5, at);
    // スネア
    if (s === 4 || s === 12) this.noiseBurst(out, 0.13, 0.13, "bandpass", 1800, 900, at);
    // ハイハット（8分、オフビートは弱く）
    if (s % 2 === 0) this.noiseBurst(out, 0.03, s % 4 === 2 ? 0.05 : 0.03, "highpass", 8000, undefined, at);
    // ベース（8分）
    if (s % 2 === 0) {
      const root = BASS_ROOTS[bar] + (s === 14 ? 7 : 0);
      this.tone(out, "triangle", midi(root), midi(root), this.stepDur * 1.7, 0.18, at);
    }
    // アルペジオ（16分）
    const toneIdx = s % 3;
    const arp = chord[toneIdx] + 12;
    this.tone(out, "square", midi(arp), midi(arp), this.stepDur * 0.85, 0.045, at);
    // コードの刻み（小節頭）
    if (s === 0) {
      chord.forEach((m) => this.tone(out, "sawtooth", midi(m), midi(m), 0.42, 0.035, at));
    }
    // 4小節目の後半でリード（盛り上げ）
    if (bar === 3 && s >= 8) {
      const lead = [76, 79, 83, 86, 83, 79, 76, 79][s - 8] ?? 76;
      this.tone(out, "square", midi(lead), midi(lead) * 1.002, this.stepDur * 0.9, 0.05, at);
    }
  }
}

export const gameAudio = new GameAudio();
