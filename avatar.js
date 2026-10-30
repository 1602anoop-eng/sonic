// Natural-looking 2D face drawn on a canvas.
// Details: skin shading, eyes with iris and highlight, eyelids that blink, eye glances,
// eyebrows, nose, lips with teeth, blush for happy, gentle head sway and breathing.
// Lip-sync: the mouth opens on each spoken word when the browser sends word events.
// It is not phoneme-accurate. It is also not photo-realistic like a 3D model.

const SKIN = '#f0c7a0';
const SKIN_SHADE = '#c98f67';
const SKIN_LIGHT = '#fbe3cb';
const LINE = '#4a3026';
const LIP = '#b8585d';
const LIP_DARK = '#7a2f36';
const MOUTH_IN = '#3d1a1f';
const SCLERA = '#f4efe9';

export class Avatar {
  constructor(canvas, s) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.open = 0;
    this.pulseAmt = 0;
    this.blinkStart = -1000;
    this.nextBlink = 2000;
    this.gaze = { x: 0, y: 0 };
    this.gazeTarget = { x: 0, y: 0 };
    this.nextGaze = 1500;
    this.update(s);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame((t) => this.frame(t));
  }

  update(s) {
    this.accent = s.accent;
    this.bg = s.avatarBg;
    this.expression = s.expression;
    this.reduced = s.reducedMotion;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width;
    this.hgt = r.height;
  }

  setState(s) { this.state = s; }

  // Called on every spoken word. Opens the mouth briefly.
  pulse() { this.pulseAmt = 1; }

  frame(t) {
    this.draw(t);
    requestAnimationFrame((nt) => this.frame(nt));
  }

  pickExpression() {
    if (this.expression !== 'auto') return this.expression;
    if (this.state === 'thinking') return 'focused';
    if (this.state === 'error') return 'confused';
    if (this.state === 'speaking') return 'happy';
    return 'neutral';
  }

  draw(t) {
    const { ctx, w, hgt, accent, bg, reduced } = this;
    const expr = this.pickExpression();
    const R = Math.min(w, hgt) * 0.36;
    ctx.clearRect(0, 0, w, hgt);

    // ----- Timing: blink, glance -----
    if (!reduced) {
      if (t > this.nextBlink) {
        this.blinkStart = t;
        this.nextBlink = t + 2500 + Math.random() * 3000;
      }
      if (t > this.nextGaze) {
        this.gazeTarget = { x: (Math.random() - 0.5) * 1.0, y: (Math.random() - 0.5) * 0.5 };
        this.nextGaze = t + 1200 + Math.random() * 2500;
      }
    }
    if (this.state === 'thinking') this.gazeTarget = { x: -0.7, y: -0.5 };
    this.gaze.x += (this.gazeTarget.x - this.gaze.x) * 0.08;
    this.gaze.y += (this.gazeTarget.y - this.gaze.y) * 0.08;

    const bt = t - this.blinkStart;
    let lid = bt < 200 ? Math.sin((Math.PI * bt) / 200) : 0; // 0 = eyes open, 1 = closed
    if (expr === 'happy') lid = Math.max(lid, 0.3);
    if (expr === 'focused') lid = Math.max(lid, 0.2);

    // ----- Mouth: opens on each word while speaking -----
    this.pulseAmt *= 0.88;
    let target = 0;
    if (this.state === 'speaking') target = 0.15 + 0.6 * this.pulseAmt + 0.1 * Math.abs(Math.sin(t / 120));
    else if (this.state === 'listening') target = 0.1 + 0.04 * Math.sin(t / 300);
    else if (this.state === 'thinking') target = 0.05;
    this.open += (target - this.open) * 0.35;
    const o = Math.min(1, Math.max(0, this.open));

    const sway = reduced ? 0 : Math.sin(t / 1800) * 0.025;
    const breath = reduced ? 0 : Math.sin(t / 1200) * R * 0.012;

    ctx.save();
    ctx.translate(w / 2, hgt / 2 + breath);
    ctx.rotate(sway);

    // Backdrop disc with accent ring
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.22, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.state === 'error' ? '#f87171' : accent;
    ctx.stroke();

    if (this.state === 'listening') {
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.34 + 4 * Math.sin(t / 200), 0, Math.PI * 2);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Soft shadow under the head
    const sh = ctx.createRadialGradient(0, R * 1.05, 0, 0, R * 1.05, R * 0.9);
    sh.addColorStop(0, 'rgba(0,0,0,0.35)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(0, R * 1.05, R * 0.9, R * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Face with light from top-left and shade at the edge
    const fg = ctx.createRadialGradient(-R * 0.25, -R * 0.35, R * 0.1, 0, 0, R * 1.05);
    fg.addColorStop(0, SKIN_LIGHT);
    fg.addColorStop(0.6, SKIN);
    fg.addColorStop(1, SKIN_SHADE);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 0.88, R, 0, 0, Math.PI * 2);
    ctx.fill();

    // Blush when happy
    if (expr === 'happy') {
      for (const sx of [-1, 1]) {
        const bl = ctx.createRadialGradient(sx * R * 0.5, R * 0.2, 0, sx * R * 0.5, R * 0.2, R * 0.22);
        bl.addColorStop(0, 'rgba(240,110,120,0.45)');
        bl.addColorStop(1, 'rgba(240,110,120,0)');
        ctx.fillStyle = bl;
        ctx.beginPath();
        ctx.arc(sx * R * 0.5, R * 0.2, R * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ----- Eyes -----
    const ex = R * 0.36;
    const ey = -R * 0.12;
    const ew = R * 0.17;
    const eh = R * 0.1;
    for (const sx of [-1, 1]) {
      const cxE = sx * ex + this.gaze.x * R * 0.05;
      const cyE = ey + this.gaze.y * R * 0.04;
      const openH = Math.max(eh * 0.12, eh * (1 - lid));

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cxE, cyE, ew, openH, 0, 0, Math.PI * 2);
      ctx.clip();

      // Eye white
      ctx.fillStyle = SCLERA;
      ctx.fillRect(cxE - ew, cyE - eh, ew * 2, eh * 2);

      // Iris (uses the accent colour) and pupil
      const ir = eh * 0.85;
      const ix = cxE + this.gaze.x * ew * 0.25;
      const iy = cyE + this.gaze.y * eh * 0.25;
      const ig = ctx.createRadialGradient(ix, iy, ir * 0.2, ix, iy, ir);
      ig.addColorStop(0, accent);
      ig.addColorStop(1, '#1b2a33');
      ctx.fillStyle = ig;
      ctx.beginPath();
      ctx.arc(ix, iy, ir, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0c0c10';
      ctx.beginPath();
      ctx.arc(ix, iy, ir * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // Eye highlight
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(ix - ir * 0.35, iy - ir * 0.35, ir * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Eye outline
      ctx.beginPath();
      ctx.ellipse(cxE, cyE, ew, openH, 0, 0, Math.PI * 2);
      ctx.lineWidth = R * 0.035;
      ctx.strokeStyle = LINE;
      ctx.stroke();

      // Upper lash line (thicker on the top half)
      ctx.beginPath();
      ctx.ellipse(cxE, cyE, ew * 1.02, openH * 1.02, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineWidth = R * 0.05;
      ctx.stroke();

      // Eyelid crease
      ctx.beginPath();
      ctx.ellipse(cxE, cyE - eh * 0.5, ew * 1.05, eh * 1.1, 0, Math.PI * 1.2, Math.PI * 1.8);
      ctx.lineWidth = R * 0.018;
      ctx.strokeStyle = SKIN_SHADE;
      ctx.stroke();
    }

    // ----- Eyebrows (move with the expression) -----
    const by = ey - R * 0.27;
    for (const sx of [-1, 1]) {
      let dOuter = 0;
      let dInner = 0;
      let arch = 0;
      if (expr === 'happy') { dOuter = -R * 0.03; arch = -R * 0.03; }
      if (expr === 'focused') { dInner = R * 0.05; arch = -R * 0.02; }
      if (expr === 'confused') { dInner = sx < 0 ? -R * 0.08 : R * 0.02; }
      const outerX = sx * (ex + ew * 1.2);
      const innerX = sx * (ex - ew * 1.0);
      ctx.beginPath();
      ctx.moveTo(outerX, by + dOuter);
      ctx.quadraticCurveTo(sx * ex, by - R * 0.09 + arch, innerX, by + dInner);
      ctx.lineWidth = R * 0.055;
      ctx.lineCap = 'round';
      ctx.strokeStyle = LINE;
      ctx.stroke();
    }

    // ----- Nose -----
    ctx.beginPath();
    ctx.moveTo(R * 0.02, R * 0.08);
    ctx.quadraticCurveTo(R * 0.1, R * 0.2, R * 0.06, R * 0.3);
    ctx.quadraticCurveTo(0, R * 0.36, -R * 0.06, R * 0.3);
    ctx.lineWidth = R * 0.03;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(120,70,50,0.5)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(90,45,30,0.4)';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * R * 0.075, R * 0.31, R * 0.03, R * 0.018, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ----- Mouth and lips -----
    const mY = R * 0.52;
    const mw = R * (expr === 'happy' ? 0.36 : 0.26);
    const corner = expr === 'happy' ? -R * 0.05 : 0;
    const shiftX = expr === 'confused' ? R * 0.05 : 0;
    const oh = R * 0.2 * o;
    const c = mY + corner;
    const upTop = mY - R * 0.05;
    const upBot = mY - R * 0.005;

    ctx.save();
    ctx.translate(shiftX, 0);

    // Inside of the mouth (only when open)
    if (oh > R * 0.01) {
      ctx.beginPath();
      ctx.moveTo(-mw, c);
      ctx.quadraticCurveTo(0, upBot, mw, c);
      ctx.quadraticCurveTo(0, upBot + oh * 1.1, -mw, c);
      ctx.fillStyle = MOUTH_IN;
      ctx.fill();
      // Upper teeth
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#f5f1ea';
      ctx.fillRect(-mw, upBot - R * 0.01, mw * 2, oh * 0.45 + R * 0.01);
      ctx.restore();
    }

    // Upper lip
    ctx.beginPath();
    ctx.moveTo(-mw, c);
    ctx.quadraticCurveTo(-mw * 0.5, upTop, 0, upTop + R * 0.005);
    ctx.quadraticCurveTo(mw * 0.5, upTop, mw, c);
    ctx.quadraticCurveTo(0, upBot, -mw, c);
    ctx.fillStyle = LIP;
    ctx.fill();

    // Lower lip (moves down when the mouth opens)
    ctx.beginPath();
    ctx.moveTo(-mw, c);
    ctx.quadraticCurveTo(0, upBot + oh * 1.1 + R * 0.11, mw, c);
    ctx.quadraticCurveTo(0, upBot + oh * 1.1, -mw, c);
    ctx.fillStyle = LIP;
    ctx.fill();

    // Lip line when the mouth is closed
    ctx.beginPath();
    ctx.moveTo(-mw, c);
    ctx.quadraticCurveTo(0, upBot, mw, c);
    ctx.lineWidth = R * 0.02;
    ctx.strokeStyle = LIP_DARK;
    ctx.stroke();
    ctx.restore();

    // Thinking dots
    if (this.state === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const a = (Math.sin(t / 200 + i) + 1) / 2;
        ctx.globalAlpha = 0.3 + 0.7 * a;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(R * 0.7 + i * R * 0.13, -R * 0.9, R * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}
