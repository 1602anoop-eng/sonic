// Expressive 2D face drawn on a canvas.
// Each emotion sets brows, eyes, smile, mouth, blush and head tilt.
// The face blends smoothly from one emotion to the next.
// Lip-sync: the mouth opens on each spoken word (browser word events). It is not phoneme-accurate.

const SKIN = '#f0c7a0';
const SKIN_SHADE = '#c98f67';
const SKIN_LIGHT = '#fbe3cb';
const LINE = '#4a3026';
const LIP = '#b8585d';
const LIP_DARK = '#7a2f36';
const MOUTH_IN = '#3d1a1f';
const SCLERA = '#f4efe9';

// Values per emotion. Missing values use NEUTRAL.
//  smile: +1 corners up (smile), -1 corners down (sad)
//  browY: brows up (-) or down (+), browIn: inner ends down (+) or up (-)
//  lid: eyes narrowed (+) or wide open (-)
//  asym: one-sided expression (confused)
//  tilt: head tilt in radians
const NEUTRAL = { smile: 0, browY: 0, browIn: 0, lid: 0, eyeW: 1, mouthW: 1, mouthOpen: 0, blush: 0, asym: 0, tilt: 0 };

export const PRESETS = {
  neutral: {},
  happy: { smile: 1, browY: -0.03, lid: 0.25, mouthW: 1.3, blush: 0.7 },
  excited: { smile: 1, browY: -0.07, lid: -0.1, eyeW: 1.15, mouthW: 1.4, blush: 0.5, mouthOpen: 0.3 },
  sad: { smile: -1, browY: -0.02, browIn: -0.12, lid: 0.2, eyeW: 0.95, mouthW: 0.9, tilt: 0.05 },
  surprised: { browY: -0.12, lid: -0.3, eyeW: 1.2, mouthW: 0.8, mouthOpen: 0.7 },
  angry: { smile: -0.5, browY: -0.03, browIn: 0.1, lid: 0.15, mouthW: 1 },
  confused: { smile: -0.2, browY: -0.02, browIn: -0.05, asym: 1, mouthW: 0.9, tilt: 0.06 },
  focused: { browY: 0.02, browIn: 0.05, lid: 0.2, eyeW: 0.95, mouthW: 0.9 },
  thinking: { smile: 0.1, browY: -0.02, browIn: 0.03, lid: 0.1, mouthW: 0.9, tilt: 0.04 }
};

export class Avatar {
  constructor(canvas, s) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.emotion = null;
    this.open = 0;
    this.pulseAmt = 0;
    this.blinkStart = -1000;
    this.nextBlink = 2000;
    this.gaze = { x: 0, y: 0 };
    this.gazeTarget = { x: 0, y: 0 };
    this.nextGaze = 1500;
    this.p = { ...NEUTRAL };
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

  // Emotion for the current reply (used when expression is 'auto'). null returns to state-based expression.
  setEmotion(name) {
    this.emotion = name && PRESETS[name] ? name : null;
  }

  // Called on every spoken word. Opens the mouth briefly.
  pulse() { this.pulseAmt = 1; }

  frame(t) {
    this.draw(t);
    requestAnimationFrame((nt) => this.frame(nt));
  }

  pickExpression() {
    if (this.expression !== 'auto') return this.expression;
    if (this.emotion && this.state !== 'listening' && this.state !== 'thinking') return this.emotion;
    if (this.state === 'thinking') return 'thinking';
    if (this.state === 'error') return 'confused';
    if (this.state === 'listening') return 'focused';
    return 'neutral';
  }

  draw(t) {
    const { ctx, w, hgt, accent, bg, reduced } = this;
    const name = this.pickExpression();
    const target = { ...NEUTRAL, ...(PRESETS[name] || {}) };
    for (const k of Object.keys(NEUTRAL)) {
      this.p[k] += (target[k] - this.p[k]) * 0.08; // smooth blend between expressions
    }
    const p = this.p;
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
    const blink = bt < 200 ? Math.sin((Math.PI * bt) / 200) : 0; // 0 = open, 1 = closed

    // ----- Mouth: opens on each word while speaking -----
    this.pulseAmt *= 0.88;
    let base = 0;
    if (this.state === 'speaking') base = 0.15 + 0.6 * this.pulseAmt + 0.1 * Math.abs(Math.sin(t / 120));
    else if (this.state === 'listening') base = 0.1 + 0.04 * Math.sin(t / 300);
    else if (this.state === 'thinking') base = 0.05;
    this.open += (base + p.mouthOpen * 0.4 - this.open) * 0.35;
    const o = Math.min(1, Math.max(0, this.open));

    const sway = reduced ? 0 : Math.sin(t / 1800) * 0.025;
    const breath = reduced ? 0 : Math.sin(t / 1200) * R * 0.012;

    ctx.save();
    ctx.translate(w / 2, hgt / 2 + breath);
    ctx.rotate(sway + p.tilt);

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

    // Blush (strength depends on emotion)
    if (p.blush > 0.02) {
      for (const sx of [-1, 1]) {
        const bl = ctx.createRadialGradient(sx * R * 0.5, R * 0.2, 0, sx * R * 0.5, R * 0.2, R * 0.22);
        bl.addColorStop(0, `rgba(240,110,120,${0.45 * p.blush})`);
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
    const eh = R * 0.1;
    for (const sx of [-1, 1]) {
      const ew = R * 0.17 * p.eyeW;
      const cxE = sx * ex + this.gaze.x * R * 0.05;
      const cyE = ey + this.gaze.y * R * 0.04;
      const total = blink + p.lid;
      const openH = Math.min(eh * 1.3, Math.max(eh * 0.12, eh * (1 - total)));

      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cxE, cyE, ew, openH, 0, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = SCLERA;
      ctx.fillRect(cxE - ew, cyE - eh * 1.5, ew * 2, eh * 3);

      // Iris uses the accent colour
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
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(ix - ir * 0.35, iy - ir * 0.35, ir * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Eye outline, upper lash line, eyelid crease
      ctx.beginPath();
      ctx.ellipse(cxE, cyE, ew, openH, 0, 0, Math.PI * 2);
      ctx.lineWidth = R * 0.035;
      ctx.strokeStyle = LINE;
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(cxE, cyE, ew * 1.02, openH * 1.02, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineWidth = R * 0.05;
      ctx.stroke();

      ctx.beginPath();
      ctx.ellipse(cxE, cyE - eh * 0.5, ew * 1.05, eh * 1.1, 0, Math.PI * 1.2, Math.PI * 1.8);
      ctx.lineWidth = R * 0.018;
      ctx.strokeStyle = SKIN_SHADE;
      ctx.stroke();
    }

    // ----- Eyebrows -----
    const by = ey - R * 0.27;
    for (const sx of [-1, 1]) {
      const dOuter = p.browY * R;
      const dInner = (p.browY + p.browIn) * R + (sx < 0 ? -p.asym * R * 0.08 : 0);
      const outerX = sx * (ex + R * 0.17 * 1.2);
      const innerX = sx * (ex - R * 0.17);
      ctx.beginPath();
      ctx.moveTo(outerX, by + dOuter);
      ctx.quadraticCurveTo(sx * ex, by - R * 0.09 - dOuter * 0.5, innerX, by + dInner);
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
    const mw = R * 0.26 * p.mouthW;
    const c = mY - p.smile * R * 0.05; // corner height: smile lifts, sad lowers
    const shiftX = p.asym * R * 0.05;
    const oh = R * 0.2 * o;
    const upTop = mY - R * 0.05;
    const upBot = mY - R * 0.005;

    ctx.save();
    ctx.translate(shiftX, 0);

    if (oh > R * 0.01) {
      ctx.beginPath();
      ctx.moveTo(-mw, c);
      ctx.quadraticCurveTo(0, upBot, mw, c);
      ctx.quadraticCurveTo(0, upBot + oh * 1.1, -mw, c);
      ctx.fillStyle = MOUTH_IN;
      ctx.fill();
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

    // Lip line when closed
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
