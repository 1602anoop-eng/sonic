// Animated Jarvis face drawn on a canvas.
// States: idle, listening, thinking, speaking, error.
// The mouth opens and closes while Jarvis is speaking. This is a simulated sync, not real phoneme analysis.

const THEMES = {
  cyan: ['#00e5ff', '#0b0f1a'],
  violet: ['#a78bfa', '#120a1f'],
  green: ['#34d399', '#06140f'],
  amber: ['#fbbf24', '#1a1204']
};

export class Avatar {
  constructor(canvas, s) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.open = 0.05;
    this.blinkStart = -1000;
    this.nextBlink = 2000;
    this.theme = s.avatarTheme;
    this.reduced = s.reducedMotion;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame(t => this.frame(t));
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width;
    this.h = r.height;
  }

  setState(s) { this.state = s; }

  update(s) {
    this.theme = s.avatarTheme;
    this.reduced = s.reducedMotion;
  }

  frame(t) {
    this.draw(t);
    requestAnimationFrame(nt => this.frame(nt));
  }

  draw(t) {
    const { ctx, w, h } = this;
    const [accent, bg] = THEMES[this.theme] || THEMES.cyan;
    ctx.clearRect(0, 0, w, h);

    // Blink schedule (off in reduced-motion mode)
    if (!this.reduced && t > this.nextBlink) {
      this.blinkStart = t;
      this.nextBlink = t + 2000 + Math.random() * 3000;
    }
    const blinking = !this.reduced && t - this.blinkStart < 150;
    const eyeScale = blinking ? 0.1 : 1;

    // Mouth target depends on state
    let target = 0.05;
    if (this.state === 'speaking') target = 0.3 + 0.35 * Math.abs(Math.sin(t / 90)) + 0.1 * Math.random();
    if (this.state === 'listening') target = 0.12 + 0.05 * Math.sin(t / 300);
    if (this.state === 'thinking') target = 0.08;
    this.open += (target - this.open) * 0.3;

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.38;

    // Face
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.state === 'error' ? '#f87171' : accent;
    ctx.stroke();

    // Listening pulse ring
    if (this.state === 'listening') {
      ctx.beginPath();
      ctx.arc(cx, cy, R + 8 + 4 * Math.sin(t / 200), 0, Math.PI * 2);
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Eyes (look up-left while thinking)
    const ex = R * 0.38;
    const ey = cy - R * 0.15;
    const er = R * 0.12;
    const look = this.state === 'thinking' ? -R * 0.08 : 0;
    ctx.fillStyle = accent;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + sx * ex + look, ey, er, er * eyeScale, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mouth
    ctx.beginPath();
    ctx.ellipse(cx, cy + R * 0.38, R * 0.35, Math.max(2, R * 0.44 * this.open), 0, 0, Math.PI * 2);
    ctx.fill();

    // Thinking dots
    if (this.state === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const a = (Math.sin(t / 200 + i) + 1) / 2;
        ctx.globalAlpha = 0.3 + 0.7 * a;
        ctx.beginPath();
        ctx.arc(cx + R * 0.5 + i * R * 0.12, cy - R * 0.75, R * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
}
