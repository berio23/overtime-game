/** Touch controls: left = floating move-stick, right = look drag, buttons for the rest. */
export const IS_MOBILE =
  (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) ||
  ('ontouchstart' in window && navigator.maxTouchPoints > 0);

const KEYS = 'abcdefghijklmnopqrstuvwxyz';

export class TouchControls {
  constructor(player, director, interact) {
    this.player = player;
    this.director = director;
    this.interact = interact;
    this.moveId = null; this.lookId = null;
    this.moveOrigin = { x: 0, y: 0 };
    this.lookLast = { x: 0, y: 0 };
    this._buildDom();
    this._bind();
  }

  _buildDom() {
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div id="stick"><div id="nub"></div></div>
      <div id="tbtns">
        <div class="tbtn" id="t-act">ACT</div>
        <div class="tbtn" id="t-light">LIGHT</div>
        <div class="tbtn" id="t-stand">STAND</div>
        <div class="tbtn" id="t-zoom">ZOOM</div>
      </div>
      <div class="tbtn big" id="t-type">TYPE</div>`;
    document.body.appendChild(root);
    this.stick = document.getElementById('stick');
    this.nub = document.getElementById('nub');
    this.typeBtn = document.getElementById('t-type');
  }

  _press(code, key) {
    document.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
    // matching keyup, or the key latches in player.keys and the character walks itself
    document.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
  }

  _bind() {
    const isButton = el => el && el.closest && el.closest('.tbtn');

    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || isButton(e.target)) return;
      if (e.clientX < window.innerWidth * 0.42 && this.moveId === null) {
        this.moveId = e.pointerId;
        this.moveOrigin = { x: e.clientX, y: e.clientY };
        this.stick.style.display = 'block';
        this.stick.style.left = (e.clientX - 60) + 'px';
        this.stick.style.top = (e.clientY - 60) + 'px';
        this.nub.style.transform = 'translate(0px,0px)';
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lookLast = { x: e.clientX, y: e.clientY };
      }
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch') return;
      if (e.pointerId === this.moveId) {
        let dx = e.clientX - this.moveOrigin.x, dy = e.clientY - this.moveOrigin.y;
        const d = Math.hypot(dx, dy), max = 55;
        if (d > max) { dx = dx / d * max; dy = dy / d * max; }
        this.nub.style.transform = `translate(${dx}px,${dy}px)`;
        this.player.touchMove.x = dx / max;
        this.player.touchMove.y = dy / max;
      } else if (e.pointerId === this.lookId) {
        this.player.look((e.clientX - this.lookLast.x) * 2.4, (e.clientY - this.lookLast.y) * 2.4);
        this.lookLast = { x: e.clientX, y: e.clientY };
      }
    }, { passive: false });

    const endPointer = e => {
      if (e.pointerId === this.moveId) {
        this.moveId = null;
        this.player.touchMove.x = this.player.touchMove.y = 0;
        this.stick.style.display = 'none';
      } else if (e.pointerId === this.lookId) {
        this.lookId = null;
      }
    };
    document.addEventListener('pointerup', endPointer);
    document.addEventListener('pointercancel', endPointer);

    const tap = (id, fn) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(true); }, { passive: false });
      el.addEventListener('pointerup', e => { e.preventDefault(); e.stopPropagation(); fn(false); }, { passive: false });
      el.addEventListener('pointercancel', () => fn(false));
    };
    tap('t-act', down => { if (down) this._press('KeyE', 'e'); });
    tap('t-light', down => { if (down) this._press('KeyF', 'f'); });
    tap('t-stand', down => { if (down) this._press('Space', ' '); });
    tap('t-zoom', down => { this.player.zoomTarget = down ? 1 : 0; });
    tap('t-type', down => {
      if (!down || !this.director.typing) return;
      const inp = this.director.terminal.input;
      if (inp && inp.complete) this._press('Enter', 'Enter');
      else {
        const k = KEYS[Math.floor(Math.random() * KEYS.length)];
        this._press('Key' + k.toUpperCase(), k);
      }
    });
  }

  update() {
    const typing = !!this.director.typing;
    this.typeBtn.style.display = typing ? 'flex' : 'none';
    if (typing) {
      const inp = this.director.terminal.input;
      this.typeBtn.textContent = inp && inp.complete ? 'SEND ⏎' : 'TYPE';
      this.typeBtn.classList.toggle('send', !!(inp && inp.complete));
    }
  }
}
