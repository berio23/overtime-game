const $ = id => document.getElementById(id);

const MOBILE_MAP = [
  ['[SPACE]', '[STAND]'], ['[F]', '[LIGHT]'], ['[E]', '[ACT]'],
  ['press any keys', 'tap TYPE'], ['hold RIGHT MOUSE to lean in', 'hold ZOOM to lean in'],
  ['type.', 'tap TYPE.']
];

export class Hud {
  constructor() {
    this.subEl = $('subtitle');
    this.subSpk = this.subEl.querySelector('.spk');
    this.subTxt = this.subEl.querySelector('.txt');
    this.objEl = $('objective');
    this.promptEl = $('prompt');
    this.hintEl = $('hint');
    this.fadeEl = $('fade');
    this.dotEl = $('dot');
    this._subToken = 0;
    this.mobile = false;
  }

  _m(text) {
    if (!this.mobile || !text) return text;
    for (const [a, b] of MOBILE_MAP) text = text.split(a).join(b);
    return text;
  }

  show() { $('hud').classList.add('on'); }

  /** speaker: 'BOSS' | 'AI' | 'YOU' | '' */
  sub(speaker, text, secs = 3) {
    const tok = ++this._subToken;
    this.subEl.className = speaker === 'BOSS' ? 'boss' : speaker === 'AI' ? 'ai' : speaker === 'YOU' ? 'you' : '';
    this.subSpk.textContent = speaker === 'YOU' ? '' : speaker;
    this.subTxt.textContent = text;
    this.subEl.style.opacity = 1;
    setTimeout(() => { if (tok === this._subToken) this.subEl.style.opacity = 0; }, secs * 1000);
  }
  clearSub() { this._subToken++; this.subEl.style.opacity = 0; }

  objective(text) {
    if (!text) { this.objEl.style.opacity = 0; return; }
    this.objEl.textContent = text;
    this.objEl.style.opacity = 0.9;
  }

  hint(text, secs = 0) {
    if (!text) { this.hintEl.style.opacity = 0; return; }
    this.hintEl.textContent = this._m(text);
    this.hintEl.style.opacity = 0.85;
    if (secs > 0) setTimeout(() => { this.hintEl.style.opacity = 0; }, secs * 1000);
  }

  prompt(text) {
    if (!text) { this.promptEl.style.opacity = 0; return; }
    this.promptEl.textContent = this._m(text);
    this.promptEl.style.opacity = 1;
  }

  crosshair(on) { this.dotEl.style.opacity = on ? 0.7 : 0; }

  fade(toBlack, secs = 2) {
    this.fadeEl.style.transition = `opacity ${secs}s`;
    this.fadeEl.style.opacity = toBlack ? 1 : 0;
    return new Promise(r => setTimeout(r, secs * 1000));
  }

  paper(html, on) {
    if (on) $('paper').innerHTML = html;
    $('paperview').classList.toggle('on', on);
  }
  paperOpen() { return $('paperview').classList.contains('on'); }

  async endcard(lines) {
    $('endcard').classList.add('on');
    const pre = $('endtext');
    pre.textContent = '';
    for (const ln of lines) {
      for (let i = 0; i <= ln.length; i++) {
        pre.textContent = pre.textContent.split('\n').slice(0, -1).concat(ln.slice(0, i)).join('\n');
        await new Promise(r => setTimeout(r, ln.startsWith(' ') ? 4 : 14));
      }
      pre.textContent += '\n';
      await new Promise(r => setTimeout(r, 260));
    }
    pre.innerHTML += '<span class="cursor">█</span>';
  }
}
