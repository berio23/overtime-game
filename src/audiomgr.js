import * as THREE from 'three';

const FILES = [
  'ai_apology','ai_doors','ai_down','ai_everyfloor','ai_fixed','ai_leave','ai_meant','ai_network',
  'ai_review1','ai_review2','ai_review3','ai_spelled','ai_tokens','ai_twenty','ai_walk',
  'badge_deny','boss_golf','boss_intro','boss_taunt','boss_tokens','boss_twenty',
  'breaker','door_slam','drone_sub','elev_move','elevator','flicker','fluoro_hum','footstep','glitch',
  'music_dawn','music_muzak',
  'coffee_brew','micro_ding','micro_hum',
  'hvac_loop','key_click','light_off','metal_groan','music_dread','music_finale','pa_click',
  'papers','phone_pickup','phone_ring','printer','server_loop','typing_burst'
];

export class AudioMgr {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.buffers = {};
    this.scene = null;          // set by main before playAt() with vector targets
    this.live = new Set();      // every sound we spawned, for cleanup
    this.warbles = [];          // { audio, base, depth, speed, phase } pitch-wobbled voices
    this.t = 0;
  }

  async load(onProgress) {
    const loader = new THREE.AudioLoader();
    let done = 0;
    await Promise.all(FILES.map(n => new Promise((res, rej) => {
      loader.load(`audio/${n}.mp3`, b => {
        this.buffers[n] = b; done++;
        if (onProgress) onProgress(done / FILES.length);
        res();
      }, undefined, rej);
    })));
  }

  ctx() { return this.listener.context; }
  duration(name) { return this.buffers[name] ? this.buffers[name].duration : 0; }

  _wire(a, { volume = 1, rate = 1, loop = false, filters = null, onEnded = null }) {
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    a.setLoop(loop);
    if (filters) a.setFilters(filters);
    if (onEnded) {
      const proto = Object.getPrototypeOf(a);
      a.onEnded = () => { proto.onEnded.call(a); onEnded(); };
    }
    a.play();
    this.live.add(a);
    return a;
  }

  /** non-positional, "in your head / held to ear" */
  play2D(name, opts = {}) {
    const a = new THREE.Audio(this.listener);
    a.setBuffer(this.buffers[name]);
    return this._wire(a, opts);
  }

  /** positional. target: Object3D or Vector3 */
  playAt(name, target, opts = {}) {
    const a = new THREE.PositionalAudio(this.listener);
    // a single non-finite frame in the matrix chain must not abort the render
    const orig = a.updateMatrixWorld.bind(a);
    a.updateMatrixWorld = f => { try { orig(f); } catch (e) { /* skip bad frame */ } };
    a.setBuffer(this.buffers[name]);
    a.setRefDistance(opts.refDist ?? 2);
    a.setRolloffFactor(opts.rolloff ?? 1.5);
    a.setDistanceModel('inverse');
    if (target && target.isObject3D) {
      target.add(a);
    } else {
      const holder = new THREE.Object3D();
      holder.position.copy(target);
      this.scene.add(holder);
      holder.add(a);
      a.userData.holder = holder;
    }
    return this._wire(a, opts);
  }

  fade(a, to, secs) {
    if (!a || !a.gain || !Number.isFinite(to) || !Number.isFinite(secs) || secs <= 0) return;
    try {
      const g = a.gain.gain;
      const now = this.ctx().currentTime;
      const cur = Number.isFinite(g.value) ? g.value : 0;
      g.cancelScheduledValues(now);
      g.setValueAtTime(cur, now);
      g.linearRampToValueAtTime(Math.max(0.0001, to), now + secs);
    } catch (e) {
      // a torn-down node mid-fade must never kill the narrative chain
      try { a.setVolume(Math.max(0.0001, to)); } catch (e2) { /* gone */ }
    }
  }

  fadeStop(a, secs = 1) {
    if (!a) return;
    this.fade(a, 0.0001, secs);
    setTimeout(() => this.kill(a), secs * 1000 + 80);
  }

  kill(a) {
    if (!a) return;
    try { if (a.isPlaying) a.stop(); } catch (e) { /* already gone */ }
    if (a.userData && a.userData.holder) a.userData.holder.removeFromParent();
    else a.removeFromParent();
    this.live.delete(a);
    this.warbles = this.warbles.filter(w => w.audio !== a);
  }

  /** waits for a one-shot to finish (plus optional pad) */
  say(name, target, opts = {}) {
    return new Promise(res => {
      const done = () => setTimeout(res, (opts.pad ?? 0.25) * 1000);
      const o = { ...opts, onEnded: done };
      const a = target ? this.playAt(name, target, o) : this.play2D(name, o);
      if (opts.warble) this.addWarble(a, opts.rate ?? 1, opts.warble);
      if (opts.out) opts.out(a);
    });
  }

  addWarble(audio, base, depth, speed = 0.9) {
    this.warbles.push({ audio, base, depth, speed, phase: Math.random() * 6 });
  }

  /* ---------- filter chains ---------- */

  telephoneFilters() {
    const c = this.ctx();
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320; hp.Q.value = 0.7;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.7;
    const ws = c.createWaveShaper(); ws.curve = this._distCurve(4); ws.oversample = '2x';
    return [hp, ws, lp];
  }

  /** drive 0..1 — PA speaker that gets nastier as the AI leans on it */
  paFilters(drive) {
    const c = this.ctx();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 1100 - drive * 450; bp.Q.value = 0.45 + drive * 0.5;
    const ws = c.createWaveShaper(); ws.curve = this._distCurve(6 + drive * 110); ws.oversample = '2x';
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200 - drive * 1800;
    return [bp, ws, lp];
  }

  whisperFilters() {
    const c = this.ctx();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    return [lp];
  }

  _distCurve(k) {
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  update(dt) {
    this.t += dt;
    for (const w of this.warbles) {
      if (!w.audio.isPlaying) continue;
      const r = w.base + Math.sin(this.t * w.speed + w.phase) * w.depth
        + (Math.random() - 0.5) * w.depth * 0.3;
      try { w.audio.setPlaybackRate(Math.max(0.4, r)); } catch (e) { /* source torn down */ }
    }
    // sweep dead one-shots
    for (const a of this.live) {
      if (!a.isPlaying && !a.getLoop()) this.kill(a);
    }
  }

  stopEverything(fadeSecs = 0.4) {
    for (const a of [...this.live]) this.fadeStop(a, fadeSecs);
  }
}
