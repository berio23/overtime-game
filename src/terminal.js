import * as THREE from 'three';

const W = 1024, H = 640, LINE = 26, PAD = 26, FONT = '17px Consolas, monospace';
const COLORS = {
  fg: '#ddd9d2', dim: '#76726b', orange: '#e8924a', red: '#ff5f56',
  green: '#3fcf6e', blue: '#6db3f2', amber: '#ffb454'
};

export class Terminal {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.lines = [];            // { text, color }
    this.input = null;          // { forced, shown, complete }
    this.cursorOn = true;
    this.flickT = 0;            // >0: screen tearing/flicker
    this.dead = false;          // screen off
    this._blink = setInterval(() => { this.cursorOn = !this.cursorOn; this.draw(); }, 530);
    this.draw();
  }

  print(text, color = 'fg') {
    this.lines.push({ text, color });
    while (this.lines.length > 19) this.lines.shift();
    this.draw();
  }

  removeLast(n = 1) { this.lines.splice(-n, n); this.draw(); }

  clearScreen() { this.lines = []; this.draw(); }

  /** the hardcoded typing mechanic: every keypress reveals scripted chars */
  startInput(forcedText) {
    this.input = { forced: forcedText, shown: '', complete: false };
    this.draw();
  }

  /** returns 'typed' | 'done' | 'submit' | null */
  feedKey(key) {
    if (!this.input) return null;
    if (this.input.complete) {
      if (key === 'Enter') {
        const text = this.input.forced;
        this.input = null;
        this.print('❯ ' + text, 'fg');
        return 'submit';
      }
      return null;
    }
    if (key === 'Enter') return null; // can't send before it's all out of you
    const step = 1 + (Math.random() < 0.35 ? 1 : 0);
    this.input.shown = this.input.forced.slice(0, this.input.shown.length + step);
    if (this.input.shown.length >= this.input.forced.length) this.input.complete = true;
    this.draw();
    return this.input.complete ? 'done' : 'typed';
  }

  /** AI types on its own. cps = chars per second */
  selfType(text, cps = 28, color = 'orange') {
    return new Promise(res => {
      this.lines.push({ text: '', color });
      let i = 0;
      const iv = setInterval(() => {
        i++;
        this.lines[this.lines.length - 1].text = text.slice(0, i);
        this.draw();
        if (i >= text.length) { clearInterval(iv); res(); }
      }, 1000 / cps);
    });
  }

  setDead(v) { this.dead = v; this.draw(); }
  flick(secs = 0.4) { this.flickT = secs; }

  update(dt) {
    if (this.flickT > 0) { this.flickT -= dt; this.draw(); }
  }

  draw() {
    const g = this.g;
    g.fillStyle = '#0c0c0e';
    g.fillRect(0, 0, W, H);
    if (this.dead) { this.texture.needsUpdate = true; return; }

    // window chrome
    g.fillStyle = '#17171a'; g.fillRect(0, 0, W, 38);
    g.fillStyle = '#ff5f56'; g.beginPath(); g.arc(24, 19, 6, 0, 7); g.fill();
    g.fillStyle = '#febc2e'; g.beginPath(); g.arc(46, 19, 6, 0, 7); g.fill();
    g.fillStyle = '#28c840'; g.beginPath(); g.arc(68, 19, 6, 0, 7); g.fill();
    g.fillStyle = COLORS.dim; g.font = FONT;
    g.fillText('claude code v2.1.7 — /srv/checkout — session #4471', 96, 25);

    g.font = FONT;
    let y = 38 + PAD + 8;
    for (const ln of this.lines) {
      g.fillStyle = COLORS[ln.color] || ln.color;
      g.fillText(ln.text, PAD, y);
      y += LINE;
    }
    if (this.input) {
      g.fillStyle = COLORS.fg;
      const caret = (this.cursorOn || this.input.complete) ? '█' : ' ';
      g.fillText('❯ ' + this.input.shown + caret, PAD, y);
      if (this.input.complete) {
        g.fillStyle = COLORS.dim;
        g.fillText('[ENTER] send', PAD, y + LINE);
      }
    } else if (this.cursorOn) {
      g.fillStyle = COLORS.dim;
      g.fillText('❯', PAD, y);
    }

    // glitch tear
    if (this.flickT > 0) {
      for (let i = 0; i < 5; i++) {
        const sy = Math.random() * H, h = 4 + Math.random() * 22;
        const off = (Math.random() - 0.5) * 70;
        const band = g.getImageData(0, sy, W, h);
        g.putImageData(band, off, sy);
      }
      g.fillStyle = 'rgba(120,200,255,0.05)';
      g.fillRect(0, 0, W, H);
    }

    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let sy = 0; sy < H; sy += 4) g.fillRect(0, sy, W, 1);

    this.texture.needsUpdate = true;
  }

  dispose() { clearInterval(this._blink); }
}
