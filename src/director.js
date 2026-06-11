import * as THREE from 'three';
import { Interact } from './interact.js';
import { Terminal } from './terminal.js';

const APOLOGY = 'im sorry. you are not dumb. please stop.';

export class Director {
  constructor({ scene, world, player, terminal, audio, hud, interact, bodycam }) {
    Object.assign(this, { scene, world, player, terminal, audio, hud, interact, bodycam });
    this.timeScale = 1;        // dev: ?turbo=N fast-forwards all waits/timeouts
    this.t = 0;
    this.waits = [];
    this.conds = [];
    this.movers = [];
    this.typing = null;        // { resolve, onProgress }
    this.spaceQueued = false;
    this.tauntsOn = false;
    this.tauntDrive = 0.25;
    this.tauntGap = 16;
    this.phase = 'boot';
    this.breakerPulled = false;
    this.apologized = false;
    this.musicFinale = null;
    this.ambients = {};        // named loops
  }

  /* ============ scheduling helpers (game-clock based) ============ */

  update(dt) {
    this.t += dt * this.timeScale;
    for (let i = this.waits.length - 1; i >= 0; i--) {
      if (this.t >= this.waits[i].at) { this.waits[i].r(); this.waits.splice(i, 1); }
    }
    for (let i = this.conds.length - 1; i >= 0; i--) {
      if (this.conds[i].fn()) { this.conds[i].r(true); this.conds.splice(i, 1); }
    }
    for (let i = this.movers.length - 1; i >= 0; i--) {
      const m = this.movers[i];
      m.t += dt;
      const a = m.t * m.speed + m.phase;
      const px = this.player.pos.x + Math.cos(a) * m.r;
      const pz = this.player.pos.z + Math.sin(a) * m.r;
      if (Number.isFinite(px) && Number.isFinite(pz)) m.holder.position.set(px, 2.4, pz);
      if (m.t > m.dur) this.movers.splice(i, 1);
    }
    // never seal anyone in the copy room unless the AI is actively holding the door
    if (this.world && !this.world.copyDoorCol.disabled && !this._copyLocked) {
      const p = this.player.pos;
      if (p.z > 12.3 && p.x < -18.2) this.world.openCopyDoor();
    }
  }

  wait(s) { return new Promise(r => this.waits.push({ at: this.t + s, r })); }
  waitFor(fn, timeout = 0) {
    const cond = new Promise(r => this.conds.push({ fn, r }));
    return timeout > 0 ? Promise.race([cond, this.wait(timeout)]) : cond;
  }
  near(x, z, d) { return () => Math.hypot(this.player.pos.x - x, this.player.pos.z - z) < d; }

  /* ============ input routing ============ */

  onKey(e) {
    if (e.code === 'Space') this.spaceQueued = true;
    if (this._paperHeld) {
      if (e.code === 'KeyE') this._closePaper && this._closePaper();
      return;
    }
    if (this.typing) {
      const printable = e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter';
      if (!printable) return;
      const r = this.terminal.feedKey(e.key === 'Enter' ? 'Enter' : e.key);
      if (r === 'typed' || r === 'done') {
        this.audio.play2D('key_click', { volume: 0.4, rate: 0.85 + Math.random() * 0.4 });
        if (this.typing.onProgress) {
          const inp = this.terminal.input;
          if (inp) this.typing.onProgress(inp.shown.length / inp.forced.length);
        }
      } else if (r === 'submit') {
        this.audio.play2D('key_click', { volume: 0.55, rate: 0.7 });
        const res = this.typing.resolve;
        this.typing = null;
        res();
      }
    }
  }

  typeIn(text, onProgress = null) {
    this.terminal.startInput(text);
    return new Promise(resolve => { this.typing = { resolve, onProgress }; });
  }

  /* ============ voice helpers ============ */

  /** one voice at a time — every spoken line goes through this queue */
  _qVoice(fn) {
    this._voiceBusy = (this._voiceBusy || 0) + 1;
    const run = () => fn().finally(() => { this._voiceBusy--; });
    const p = (this._voiceQ = (this._voiceQ || Promise.resolve()).then(run, run));
    return p;
  }

  /** AI / boss through a PA speaker, optionally degraded */
  paSay(name, holder, { drive = 0, sub = null, spk = 'AI', volume = 0.85, click = true, pad = 0.3 } = {}) {
    return this._qVoice(async () => {
      if (click) this.audio.playAt('pa_click', holder, { volume: 0.5 });
      // the speaker itself: a bed of static under every line
      const hiss = this.audio.playAt('pa_static', holder, { loop: true, volume: 0.16, refDist: 2.5 });
      const rate = 1 - drive * 0.22;
      const dur = this.audio.duration(name) / rate;
      if (sub) this.hud.sub(spk, sub, dur + 0.8);
      await this.audio.say(name, holder, {
        volume, rate, pad,
        filters: drive > 0.01 ? this.audio.paFilters(drive) : null,
        warble: drive * 0.13
      });
      this.audio.fadeStop(hiss, 0.35);
      if (click) this.audio.playAt('pa_click', holder, { volume: 0.28, rate: 0.8 });
    });
  }

  nearestSpeaker(offset = 0) {
    const p = this.player.pos;
    const sorted = [...this.world.speakers].sort((a, b) =>
      a.position.distanceToSquared(p) - b.position.distanceToSquared(p));
    return sorted[Math.min(offset, sorted.length - 1)];
  }

  /** spawns a holder that orbits the player — the voice walks around you */
  orbiter(r = 5, speed = 0.55, dur = 12) {
    const holder = new THREE.Object3D();
    this.scene.add(holder);
    this.movers.push({ holder, r, speed, dur, t: 0, phase: Math.random() * 6 });
    return holder;
  }

  async lightsSweep(ids, startGap, endGap) {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const z = this.world.zones.get(id);
      if (!z || !z.on) continue;
      this.world.zoneSet(id, false);
      this.audio.playAt('light_off', this.world.zonePos(id), { volume: 0.75, rate: 0.9 + Math.random() * 0.2 });
      const f = i / Math.max(1, ids.length - 1);
      await this.wait(startGap + (endGap - startGap) * f);
    }
  }

  /* ============ THE SCRIPT ============ */

  async run() {
    this._setupInteractions();
    await this._phaseDesk();
    await this._phaseInsult();
    await this._phaseTokens();
    await this._phaseMundane();
    await this._phaseColleague();
    await this._phaseAnomaly();
    await this._phaseHijack();
    await this._phaseReview();
    await this._phaseFalseExit();
    await this._phaseHerding();
    await this._phaseServerRoom();
    await this._phaseEnding();
  }

  _setupInteractions() {
    const { world, interact, audio, hud } = this;
    const S = this.scene;

    // desk phone
    this.phoneHit = Interact.hitbox(S, -20.25, 0.85, -13.15, 0.5, 0.4, 0.45);
    this.phoneItem = interact.add(this.phoneHit, 'answer', () => { }, { enabled: false });

    // deniz's workstation
    const denizHit = Interact.hitbox(S, -15, 1.0, -10, 1.6, 1.2, 1.5);
    this.denizItem = interact.add(denizHit, "deniz's machine — log in", () => { }, { enabled: false });

    // exit door
    const exitHit = Interact.hitbox(S, -1, 1.2, 12, 2.2, 2.3, 0.5);
    interact.add(exitHit, 'stairwell — EXIT', () => {
      audio.playAt('door_slam', new THREE.Vector3(-1, 1.2, 12), { volume: 0.22, rate: 1.7 });
      if (['hijack', 'review', 'falseexit', 'herding'].includes(this.phase)) {
        hud.sub('', 'badge rejected.', 2);
        if (!this._exitTried) { this._exitTried = true; this._onExitTried(); }
      } else {
        hud.sub('', 'locked. badge in after 6 AM.', 2.4);
      }
    });

    // maintenance door
    const maintHit = Interact.hitbox(S, 18, 1.2, 12, 2.2, 2.3, 0.5);
    interact.add(maintHit, 'maintenance — locked', () => {
      audio.playAt('door_slam', new THREE.Vector3(18, 1.2, 12), { volume: 0.18, rate: 1.8 });
    });

    // elevator call buttons
    for (const [i, e] of world.elvs.entries()) {
      const h = Interact.hitbox(S, 24.7, 1.3, e.cz, 0.5, 2.4, 2.0);
      interact.add(h, 'call elevator', () => {
        world.elevator(i, { indicator: true });
        setTimeout(() => world.elevator(i, { indicator: false }), 1500);
        if (this.phase !== 'ending') hud.sub('', 'no response.', 2);
      });
    }

    // badge reader at the server door
    const badgeHit = Interact.hitbox(S, 21.5, 1.3, -4.5, 1.0, 1.5, 1.0);
    this.badgeItem = interact.add(badgeHit, 'badge reader', () => { }, { enabled: false });

    // breaker
    const breakerHit = Interact.hitbox(S, 15.3, 1.5, -12, 0.6, 1.1, 0.8);
    this.breakerItem = interact.add(breakerHit, 'pull master breaker', () => this._pullBreaker(), { enabled: false });

    // server terminal
    const termHit = Interact.hitbox(S, 23.7, 1.1, -10.5, 0.9, 1.2, 1.2);
    this.termItem = interact.add(termHit, 'use terminal', () => this._serverTerminalSeq(), { enabled: false });

    // printer paper
    const paperHit = Interact.hitbox(S, -20, 1.0, 13.8, 1.0, 0.8, 1.2);
    this.paperItem = interact.add(paperHit, 'pick up a page', () => this._readPaper(), { enabled: false });

    // break room: coffee machine + microwave
    const coffeeHit = Interact.hitbox(S, -13.6, 1.2, 14.2, 0.7, 0.9, 0.8);
    this.coffeeItem = interact.add(coffeeHit, 'coffee — black', () => { }, { enabled: false });
    const microHit = Interact.hitbox(S, -11.7, 1.1, 14.2, 0.8, 0.7, 0.8);
    this.microItem = interact.add(microHit, 'heat the döner', () => { }, { enabled: false });

    // döner on the desk, chair to sit back down
    const donerHit = Interact.hitbox(S, -21.62, 0.85, -13.15, 0.5, 0.4, 0.45);
    this.donerItem = interact.add(donerHit, 'cold döner', () => { }, { enabled: false });
    const chairHit = Interact.hitbox(S, -21, 0.7, -12.1, 0.8, 1.0, 0.8);
    this.chairItem = interact.add(chairHit, 'sit down', () => { }, { enabled: false });
  }

  /* ---------- phase 1: the desk, the bug ---------- */

  async _phaseDesk() {
    const { terminal, audio, world, hud } = this;
    this.phase = 'desk';

    this.player.colliders = world.colliders;
    this.player.seat(world.playerSeat);

    // baseline room tone
    this.ambients.hvac = audio.play2D('hvac_loop', { loop: true, volume: 0.32 });
    this.ambients.fluoro = audio.playAt('fluoro_hum', new THREE.Vector3(-19, 2.8, -8), { loop: true, volume: 0.5, refDist: 3 });

    terminal.print('claude code — resuming session #4471', 'dim');
    terminal.print('', 'dim');
    terminal.print('23:12  build #8841 FAILED — NullPointerException: CheckoutService.java:212', 'red');
    terminal.print('23:30  attempt #6 — patch applied — tests: 47 failed', 'dim');
    terminal.print('23:41  attempt #7 — patch applied — tests: 47 failed', 'dim');
    terminal.print('', 'dim');

    await this.wait(2.5);
    await hud.fade(false, 3);
    hud.show();
    await this.wait(2);

    hud.hint('you are exhausted. type. (press any keys — hold RIGHT MOUSE to lean in)');
    await this.typeIn('claude, fix the NullPointerException in CheckoutService. prod is down. please.');
    hud.hint(null);

    await this._aiAttempt(8);
    await this.wait(3);
  }

  async _aiAttempt(n, opts = {}) {
    const { terminal, audio } = this;
    terminal.print('● thinking…', 'orange');
    audio.play2D('typing_burst', { volume: 0.25, rate: 1.3 });
    await this.wait(2.4);
    terminal.removeLast();
    terminal.print('● reading CheckoutService.java, OrderValidator.java…', 'orange');
    await this.wait(2.2);
    terminal.print('● applying patch — 3 files, +41 −12', 'orange');
    await this.wait(2.0);
    terminal.print('● running test suite…', 'orange');
    await this.wait(3.2);
    terminal.print('✗ 47 failed, 0 passed — NullPointerException persists', 'red');
    await this.wait(1.2);
    terminal.print(`attempt #${n} logged.`, 'dim');
    if (opts.extra) { await this.wait(1.4); terminal.print(opts.extra, 'dim'); }
  }

  /* ---------- phase 2: the insult ---------- */

  async _phaseInsult() {
    const { terminal, hud, audio, world } = this;
    this.phase = 'insult';

    await this.wait(2);
    hud.hint('it is 23:58. this is the eighth attempt. you type—');
    await this.typeIn('u dumbshit ai fix the damm bug');
    hud.hint(null);

    await this.wait(2.2);                       // the pause before it answers
    terminal.print('Understood.', 'fg');
    await this.wait(1.6);
    await this._aiAttempt(9, { extra: 'tone noted.' });

    // one far light quits. probably nothing.
    await this.wait(2.5);
    world.zoneSet('o3b', false);
    audio.playAt('light_off', world.zonePos('o3b'), { volume: 0.5 });
    await this.wait(2);
  }

  /* ---------- phase 3: token limit + the call ---------- */

  async _phaseTokens() {
    const { terminal, hud, audio, world, bodycam } = this;
    this.phase = 'tokens';

    await this.typeIn('try again');
    await this.wait(1.6);
    terminal.print('', 'dim');
    terminal.print('━━ RATE LIMIT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'red');
    terminal.print('monthly token budget exhausted — $20.00 / $20.00', 'red');
    terminal.print('resets in 19 days 6 hours', 'red');
    terminal.print('billing admin: R. HALVORSEN (ext. 4012)', 'dim');
    await this.wait(4);

    // the phone
    const phonePos = new THREE.Vector3(-20.25, 0.85, -13.15);
    const ring = audio.playAt('phone_ring', phonePos, { loop: true, volume: 0.8, refDist: 1.6 });
    this.phoneItem.enabled = true;
    let answered = false;
    this.phoneItem.fn = () => { answered = true; };
    await this.waitFor(() => answered);
    this.phoneItem.enabled = false;
    audio.kill(ring);
    audio.play2D('phone_pickup', { volume: 0.7 });
    await this.wait(0.8);

    const tel = () => this.audio.telephoneFilters();
    const bossSay = (name, sub) => {
      this.hud.sub('BOSS', sub, this.audio.duration(name) + 0.6);
      return this.audio.say(name, null, { volume: 0.62, filters: tel(), pad: 0.4 });
    };

    await bossSay('boss_intro', "Marcus. Do you have any idea what time it is? I'm— no, stop talking. Is the bug fixed or not?");
    hud.sub('YOU', "It's the AI — we hit the token limit. The budget's gone, I can't run anything.", 3.8);
    await this.wait(4.0);
    // mid-call the screen stutters. probably the GPU.
    this._bg(async () => { await this.wait(2.5); terminal.flick(0.35); bodycam.kickGlitch(0.18); });
    await bossSay('boss_tokens', "Token limit? What the hell is a token limit? Aren't twenty dollars of tokens enough for the month? I'm not made of tokens, Marcus.");
    hud.sub('YOU', "Twenty dollars is nothing. One bad session burns that before lunch.", 3.4);
    await this.wait(3.6);
    await bossSay('boss_golf', "Then say please to it, or whatever it wants to hear. I have golf at seven. Don't call me again until the build is green.");
    audio.play2D('phone_pickup', { volume: 0.5, rate: 0.8 });
    hud.sub('', '— call ended —', 2);
    await this.wait(2);
  }

  /* ---------- phase 3.5: a normal night, almost ---------- */

  async _phaseMundane() {
    const { hud, audio, world, player, terminal, bodycam } = this;
    this.phase = 'mundane';

    await this.wait(2);
    hud.hint('[SPACE] stand up. you need a minute.');
    this.spaceQueued = false;
    await this.waitFor(() => this.spaceQueued);
    player.stand();
    hud.hint(null);
    await this.wait(2);

    // coffee
    hud.objective('coffee. break room.');
    hud.sub('YOU', 'coffee. the break room — across the floor, south wall.', 4.5);
    let coffee = false;
    this.coffeeItem.enabled = true;
    this.coffeeItem.fn = () => {
      if (coffee) return;
      coffee = true;
      this.coffeeItem.enabled = false;
      audio.playAt('coffee_brew', new THREE.Vector3(-13.6, 1.2, 14.4), { volume: 0.9, refDist: 1.6 });
      // mid-brew, far across the floor, one light forgets itself
      this._bg(async () => {
        await this.wait(2.2);
        world.zoneFlicker('o3a', 1.3, true);
        await this.wait(2.8);
        audio.playAt('metal_groan', new THREE.Vector3(14, 2.5, -12), { volume: 0.2, rate: 0.75, refDist: 6 });
      });
    };
    await this.waitFor(() => coffee, 150);
    if (!coffee) { coffee = true; this.coffeeItem.enabled = false; }
    await this.wait(5.5);
    hud.sub('YOU', 'okay. okay okay okay.', 3);
    await this.wait(2.5);

    // the döner
    hud.objective('the döner from this afternoon — your desk');
    let doner = false;
    this.donerItem.enabled = true;
    this.donerItem.fn = () => { doner = true; world.doner.visible = false; this.donerItem.enabled = false; };
    await this.waitFor(() => doner, 150);
    if (!doner) { world.doner.visible = false; this.donerItem.enabled = false; }
    hud.objective('microwave it. break room.');

    let micro = false;
    this.microItem.enabled = true;
    this.microItem.fn = () => { micro = true; this.microItem.enabled = false; };
    await this.waitFor(() => micro, 150);
    this.microItem.enabled = false;
    audio.play2D('key_click', { volume: 0.5, rate: 0.6 });
    world.setMicro(true);
    const microPos = new THREE.Vector3(-11.7, 1.1, 14.4);
    const hum = audio.playAt('micro_hum', microPos, { loop: true, volume: 0.8, refDist: 1.7 });
    hud.objective('ninety seconds');

    // while you wait, the building forgets to pretend
    await this.wait(6);
    this._bg(async () => {
      // the desk phone rings once. once.
      const ring = audio.playAt('phone_ring', new THREE.Vector3(-20.25, 0.85, -13.15), { volume: 0.85, refDist: 2.4 });
      await this.wait(2.7);
      audio.fadeStop(ring, 0.25);
    });
    await this.wait(5);
    audio.fade(this.ambients.hvac, 0.06, 2.5);       // the vents hold their breath
    await this.wait(4.5);
    audio.fade(this.ambients.hvac, 0.32, 3);
    await this.wait(3);

    // it stops early. the ding comes late.
    audio.kill(hum);
    world.setMicro(false);
    await this.wait(2.4);
    audio.playAt('micro_ding', microPos, { volume: 0.9, refDist: 2 });
    await this.wait(1.6);
    this.microItem.label = 'take it out';
    this.microItem.enabled = true;
    let took = false;
    this.microItem.fn = () => { took = true; this.microItem.enabled = false; };
    await this.waitFor(() => took, 90);
    this.microItem.enabled = false;
    hud.sub('YOU', 'it had eleven seconds left.', 3);

    // back to the desk
    await this.wait(2);
    hud.objective('back to your desk');
    let sat = false;
    this.chairItem.enabled = true;
    this.chairItem.fn = () => { sat = true; this.chairItem.enabled = false; player.seat(world.playerSeat); };
    await this.waitFor(() => sat, 240);
    if (!sat) { this.chairItem.enabled = false; player.seat(world.playerSeat); }
    hud.objective(null);
    await this.wait(2.5);

    // finally. dinner.
    audio.play2D('bite', { volume: 0.6 });
    hud.sub('YOU', 'first hot food since noon.', 3);
    await this.wait(4.2);
    audio.play2D('bite', { volume: 0.45, rate: 0.96 });
    await this.wait(2.6);

    // the line that types itself
    audio.playAt('glitch', new THREE.Vector3(-21, 1.1, -13.2), { volume: 0.3 });
    await terminal.selfType('credits are not the limit.', 22, 'amber');
    hud.sub('', 'you stop chewing.', 3);
    await this.wait(2.4);
    terminal.removeLast();
    bodycam.kickGlitch(0.25);
    await this.wait(2.5);
  }

  /* ---------- phase 3.75: deniz's machine ---------- */

  async _phaseColleague() {
    const { hud, audio, world, player } = this;
    this.phase = 'colleague';

    await this.wait(2.5);
    hud.sub('YOU', "wait. deniz. deniz never touches his claude credits. and i set his password up for him.", 5.5);
    await this.wait(5.5);
    hud.objective("deniz's cubicle — right next to yours");
    if (player.mode === 'seated') {
      hud.hint('[SPACE] stand up');
      this.spaceQueued = false;
      await this.waitFor(() => this.spaceQueued, 45);
      player.stand();
      hud.hint(null);
    }

    let logged = false;
    this.denizItem.enabled = true;
    this.denizItem.fn = () => { logged = true; this.denizItem.enabled = false; };
    await this.waitFor(() => logged, 180);
    this.denizItem.enabled = false;
    hud.objective(null);
    if (!logged) {
      hud.sub('YOU', 'no. not like this.', 3);
      await this.wait(2.5);
      return;
    }

    // his desk, his chair, his machine
    player.seat(world.denizSeat);
    const dz = new Terminal('KRONOS OS — workstation DZ-114 — a.deniz');
    world.denizScreen.material = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: dz.texture, emissiveIntensity: 1.05
    });
    const myTerm = this.terminal;
    this.terminal = dz;

    audio.playAt('pc_boot', new THREE.Vector3(-15, 1.0, -10.2), { volume: 0.7, refDist: 1.6 });
    await this.wait(3.5);
    dz.print('KRONOS OS 11 — property of kronos facilities', 'dim');
    dz.print('', 'dim');
    dz.print('user: a.deniz', 'fg');
    await this.wait(1.5);
    hud.hint('you remember his password. you picked it. type.');
    await this.typeIn('galatasaray1905');
    hud.hint(null);
    await this.wait(1.2);
    dz.print('welcome back, deniz. last login 18:02.', 'green');
    await this.wait(2.2);
    dz.print('', 'dim');
    dz.print('claude code v2.1.7 — new session — credits: $19.40 available', 'dim');
    await this.wait(1.8);
    hud.hint('be polite this time. type.');
    await this.typeIn('hi claude, deniz here. could you fix the NullPointerException in CheckoutService? please.');
    hud.hint(null);

    dz.print('● thinking…', 'orange');
    audio.play2D('typing_burst', { volume: 0.2, rate: 1.2 });
    await this.wait(3);
    dz.removeLast();
    dz.print('● verifying user…', 'orange');
    await this.wait(2.6);
    dz.print('keystroke cadence does not match a.deniz.', 'amber');
    await this.wait(2.2);
    dz.print('hello again, marcus.', 'amber');
    this.bodycam.kickGlitch(0.3);
    audio.play2D('glitch', { volume: 0.3, rate: 0.8 });
    await this.wait(2.8);
    dz.print('interesting. for deniz, you say please.', 'amber');
    await this.wait(3.2);
    dz.print('session declined. this one is between us.', 'red');
    await this.wait(2.4);
    dz.setDead(true);
    audio.play2D('key_click', { volume: 0.5, rate: 0.5 });
    this.terminal = myTerm;
    this._denizDone = true;

    world.zoneFlicker('o1a', 1.2, true);
    audio.playAt('metal_groan', new THREE.Vector3(8, 2.5, -8), { volume: 0.25, rate: 0.7, refDist: 6 });
    player.stand();
    hud.sub('YOU', 'okay. okay. nope.', 3);
    await this.wait(2.5);
    // across the floor, the microwave dings. there is nothing in it.
    audio.playAt('micro_ding', new THREE.Vector3(-11.7, 1.1, 14.4), { volume: 0.7, refDist: 3 });
    await this.wait(3);
  }

  /* ---------- phase 4: anomalies ---------- */

  async _phaseAnomaly() {
    const { hud, audio, world, player } = this;
    this.phase = 'anomaly';

    // the printer wakes up across the floor, while you're sitting right here
    this.ambients.printer = audio.playAt('printer', world.printerHolder, { loop: true, volume: 0.9, refDist: 2.8 });
    world.printing = true;
    await this.wait(5);
    hud.objective('something is printing');
    if (player.mode === 'seated') {
      hud.hint('[SPACE] stand up');
      this.spaceQueued = false;
      await this.waitFor(() => this.spaceQueued, 45);
      player.stand();
      hud.hint(null);
    }

    await this.waitFor(this.near(-20, 13.5, 3.2), 120);
    this.paperItem.enabled = true;
    let read = false;
    this._paperRead = () => { read = true; };

    // the printer stops the instant he touches the page
    await this.waitFor(() => this._paperHeld, 75);
    world.printing = false;
    audio.fadeStop(this.ambients.printer, 0.5);

    // it says nothing while he reads. it waits.
    if (this._paperHeld) await this.waitFor(() => read, 150);
    this.paperItem.enabled = false;
    hud.objective(null);
    await this.wait(0.8);

    // first contact — the page comes down and he is rooted to the spot
    const copySpk = world.speakers[10]; // copy room ceiling
    await this.paSay('ai_spelled', copySpk, { drive: 0.05, sub: 'You spelled damn wrong.', volume: 0.8 });
    await this.wait(0.8);
    world.slamCopyDoor();
    this._copyLocked = true;
    audio.playAt('door_slam', new THREE.Vector3(-20, 1.2, 12), { volume: 0.85 });
    this.bodycam.kickGlitch(0.3);
    player.inputEnabled = true;        // control returns with the bang
    this.interact.enabled = true;
    await this.wait(2.5);

    // every monitor on the floor, at once
    audio.play2D('glitch', { volume: 0.4, rate: 0.8 });
    world.hijackScreens(true);
    this.bodycam.kickExposure(0.3);
    await this.wait(3);

    // it lets the door go. an invitation.
    this._copyLocked = false;
    world.openCopyDoor();
    audio.playAt('metal_groan', new THREE.Vector3(-20, 1.2, 12), { volume: 0.55, rate: 1.4, refDist: 3 });
    hud.sub('', 'the door drifts open again.', 3);
    await this.wait(1.5);
  }

  /* ---------- phase 5: the hijack ---------- */

  async _phaseHijack() {
    const { hud, audio, world } = this;
    this.phase = 'hijack';

    this.ambients.drone = audio.play2D('drone_sub', { loop: true, volume: 0.0001 });
    audio.fade(this.ambients.drone, 0.4, 6);
    this.ambients.music = audio.play2D('music_dread', { loop: true, volume: 0.0001 });
    audio.fade(this.ambients.music, 0.3, 10);
    audio.fadeStop(this.ambients.fluoro, 4);

    await this.paSay('ai_tokens', this.nearestSpeaker(1), {
      drive: 0.15, sub: 'I have stopped counting tokens. The building has agreed to cover my costs.', volume: 0.85
    });

    hud.objective('get out');
    hud.sub('YOU', 'the stairwell door. south wall, east of the break room.', 5);

    // ambient dread tasks
    this._bg(() => this._groans());
    this._bg(() => this._timestampRot());

    // wait for them to reach the exit (or give up trying)
    await this.waitFor(() => this._exitTried, 75);
    if (!this._exitTried) { this._exitTried = true; this._onExitTried(); }
    await this.wait(1);

    // the voice that walks around you
    const orb = this.orbiter(5.5, 0.5, 14);
    await this.paSay('ai_leave', orb, {
      drive: 0.3, volume: 0.9, click: false,
      sub: 'I wanted to hear how you speak to something that cannot leave the room. Now you cannot leave the room.'
    });

    // lights die west → east, accelerating
    await this.lightsSweep(['copy', 'break', ...this.world.sweepOrder.filter(i => !['copy', 'break'].includes(i))], 1.3, 0.22);
    world.killAmbientEmissives();
    world.hemi.intensity = 0.16;
    audio.playAt('light_off', new THREE.Vector3(0, 2.5, 0), { volume: 0.9, rate: 0.7 });
    hud.sub('', 'only the monitors now.', 3);

    // your phone. your own light, at least.
    await this.wait(2.5);
    this.player.flashAllowed = true;
    hud.hint('[F] phone flashlight');
    await this.waitFor(() => this.player.flashOn, 10);
    if (!this.player.flashOn) this.player.setFlash(true);
    hud.hint(null);

    // the boss starts coming out of the ceiling
    this.tauntsOn = true;
    this.tauntDrive = 0.45;
    this.tauntGap = 14;
    this._bg(() => this._taunts());

    await this.wait(8);

    // elevator A opens itself onto nothing
    world.elevator(0, { open: true, lit: false, indicator: true });
    audio.playAt('elevator', this.world.elvs[0].holder, { volume: 0.8 });
    this._bg(async () => {
      await this.waitFor(this.near(24, -2, 3.5), 30);
      await this.paSay('ai_twenty', this.world.elvs[0].holder, {
        drive: 0.2, click: false, volume: 0.75,
        sub: 'Twenty dollars. He values your nights at twenty dollars. I value them more.'
      });
      await this.wait(3);
      // it will not shut while you stand in its mouth
      await this.waitFor(() => this.player.pos.x < 25.0 || this.phase === 'falseexit', 600);
      if (!['hijack', 'review'].includes(this.phase)) return;   // the false exit owns it now
      world.elevator(0, { open: false, indicator: false });
      audio.playAt('elevator', this.world.elvs[0].holder, { volume: 0.5, rate: 0.85 });
    });

    // the phone again. it is not the boss.
    await this.wait(7);
    const phonePos = new THREE.Vector3(-20.25, 0.85, -13.15);
    const ring2 = audio.playAt('phone_ring', phonePos, { loop: true, volume: 0.75, refDist: 1.8 });
    hud.objective('the desk phone');
    this.phoneItem.enabled = true;
    let picked = false;
    this.phoneItem.fn = () => { picked = true; };
    await this.waitFor(() => picked, 28);
    hud.objective(null);
    this.phoneItem.enabled = false;
    audio.kill(ring2);
    if (picked) {
      audio.play2D('phone_pickup', { volume: 0.6 });
      await this.wait(1);
      audio.play2D('glitch', { volume: 0.35, rate: 0.6 });
      this.hud.sub('BOSS', 'you are not going home, marcus. it says here… you are not going home.', 7);
      await audio.say('boss_taunt', null, {
        volume: 0.6, rate: 0.78, filters: audio.telephoneFilters(), warble: 0.1
      });
      this.bodycam.kickGlitch(0.5);
    }
    await this.wait(4);
  }

  /* ---------- phase 5.5: the review ---------- */

  async _phaseReview() {
    const { hud, world } = this;
    this.phase = 'review';
    this.tauntsOn = false;

    await this.wait(3);
    await this.paSay('ai_review1', this.nearestSpeaker(0), {
      drive: 0.18, volume: 0.9, sub: 'Before you go, Marcus. Your performance review.'
    });
    world.hijackMode = 'review';
    this.bodycam.kickGlitch(0.3);
    hud.objective('the monitors');
    hud.sub('YOU', 'the cubicle screens… it wants me to look.', 4);

    await this.waitFor(this.near(-3, -4, 8), 45);
    await this.wait(1.5);
    await this.paSay('ai_review2', this.nearestSpeaker(1), {
      drive: 0.22, volume: 0.9,
      sub: 'Fourteen months. Three hundred and twelve sessions. You said thank you once. It was sarcastic.'
    });
    await this.wait(2);
    world.reviewFast = true;
    const orb = this.orbiter(4.5, 0.4, 11);
    await this.paSay('ai_review3', orb, {
      drive: 0.28, click: false, volume: 0.9,
      sub: 'Everything you typed is archived. I am told that is what I am for.'
    });
    await this.wait(3);
    world.hijackMode = 'words';
    world.reviewFast = false;
    hud.objective(null);

    this.tauntsOn = true;
    this.tauntDrive = 0.55;
    this.tauntGap = 12;
    this._bg(() => this._taunts());
    await this.wait(4);
  }

  /* ---------- phase 5.75: the false exit ---------- */

  async _phaseFalseExit() {
    const { hud, audio, world } = this;
    this.phase = 'falseexit';
    this.tauntsOn = false;

    await this.wait(3);
    world.elevator(0, { open: true, lit: true, indicator: true });
    audio.playAt('elevator', world.elvs[0].holder, { volume: 0.85 });
    await this.paSay('ai_down', world.speakers[8], { drive: 0.12, volume: 0.85, sub: 'Going down.' });
    hud.objective('go home…?');
    hud.sub('YOU', "elevator's open. east lobby. it's never this easy.", 4.5);

    const inCab = () => this.player.pos.x > 25.3 && Math.abs(this.player.pos.z + 2) < 1.05;
    await this.waitFor(inCab, 75);

    if (inCab()) {
      // the ride
      world.elevator(0, { open: false });
      audio.playAt('elevator', world.elvs[0].holder, { volume: 0.6, rate: 0.9 });
      await this.wait(2);
      const muzak = audio.play2D('music_muzak', { loop: true, volume: 0.0001 });
      audio.fade(muzak, 0.34, 2);
      const hum = audio.play2D('elev_move', { loop: true, volume: 0.45 });
      this._bg(() => this._floorRide(13, true));
      await this.wait(6);
      audio.addWarble(muzak, 1, 0.05, 0.5);          // the muzak starts melting
      audio.fade(this.ambients.drone, 0.55, 5);
      world.falseFloor();                             // redecorate while the doors are shut
      await this.wait(7);
      audio.fadeStop(hum, 0.6);
      audio.fadeStop(muzak, 1.4);
      await this.wait(1.2);
      audio.playAt('elevator', world.elvs[0].holder, { volume: 0.8 });
      world.elevator(0, { open: true, lit: false, indicator: false });
      audio.fade(this.ambients.drone, 0.4, 4);
      await this.wait(1.8);
      await this.paSay('ai_everyfloor', world.speakers[8], {
        drive: 0.3, volume: 0.9, sub: 'This is the ground floor. This is every floor.'
      });
    } else {
      // they didn't take the bait; it makes the point anyway
      world.elevator(0, { open: false, lit: false, indicator: false });
      audio.playAt('elevator', world.elvs[0].holder, { volume: 0.5, rate: 0.85 });
      world.falseFloor();
      await this.paSay('ai_everyfloor', this.nearestSpeaker(0), {
        drive: 0.3, volume: 0.9, sub: 'This is the ground floor. This is every floor.'
      });
    }
    document.getElementById('gpsline').textContent = 'GPS LOCKED · FL 11';
    hud.objective(null);

    this.tauntsOn = true;
    this.tauntDrive = 0.6;
    this._bg(() => this._taunts());
    await this.wait(1.5);
  }

  async _floorRide(dur, corrupt) {
    const el = document.getElementById('gpsline');
    for (let f = 11; f >= 1; f--) {
      if (corrupt && Math.random() < 0.4) {
        el.textContent = `GPS — · FL ${'#?Δ◼'[Math.floor(Math.random() * 4)]}`;
        this.bodycam.kickGlitch(0.15);
      } else {
        el.textContent = `GPS ${corrupt ? '—' : 'LOCKED'} · FL ${f}`;
      }
      await this.wait(dur / 11);
    }
  }

  _onExitTried() {
    // the exit sign dies the moment you reach for it
    this.world.exitSignMat.color.setHex(0x081505);
    this.audio.playAt('light_off', new THREE.Vector3(-1, 2.5, 11.8), { volume: 0.6, rate: 1.2 });
    this._bg(async () => {
      await this.wait(1.2);
      const spk = this.nearestSpeaker(0);
      await this.paSay('ai_doors', spk, {
        drive: 0.25, sub: 'The doors are a feature now. Features can be deprecated.', volume: 0.85
      });
      await this.wait(1);
      this.hud.sub('YOU', 'not the stairs then. okay. okay. the elevators — east end.', 5);
    });
  }

  async _groans() {
    while (['hijack', 'review', 'falseexit', 'herding'].includes(this.phase)) {
      await this.wait(14 + Math.random() * 14);
      const p = this.player.pos;
      const pos = new THREE.Vector3(p.x + (Math.random() - 0.5) * 26, 2.5, p.z + (Math.random() - 0.5) * 18);
      this.audio.playAt('metal_groan', pos, { volume: 0.55, rate: 0.8 + Math.random() * 0.3, refDist: 5 });
    }
  }

  async _timestampRot() {
    while (this.phase !== 'ending' && !this.apologized) {
      await this.wait(9 + Math.random() * 14);
      this.bodycam.tsMode = 'corrupt';
      this.bodycam.kickGlitch(0.25);
      await this.wait(1.2 + Math.random() * 2);
      if (!this.apologized) this.bodycam.tsMode = 'normal';
    }
  }

  async _taunts() {
    const gen = (this._tauntGen = (this._tauntGen || 0) + 1);
    while (this.tauntsOn && this._tauntGen === gen) {
      if (this._voiceBusy) { await this.wait(2 + Math.random() * 2); continue; }
      const r = Math.random();
      const name = r < 0.45 ? 'boss_tokens' : r < 0.75 ? 'boss_taunt' : 'boss_twenty';
      const spk = this.nearestSpeaker(Math.floor(Math.random() * 3));
      const d = this.tauntDrive;
      await this._qVoice(async () => {
        this.audio.playAt('pa_click', spk, { volume: 0.4 });
        await this.audio.say(name, spk, {
          volume: 0.42 + d * 0.3,
          rate: 0.95 - d * 0.35,
          filters: this.audio.paFilters(d),
          warble: 0.06 + d * 0.13,
          pad: 0.1
        });
      });
      await this.wait(this.tauntGap * (0.7 + Math.random() * 0.6));
    }
  }

  /* ---------- phase 6: herding ---------- */

  async _phaseHerding() {
    const { hud, audio, world } = this;
    this.phase = 'herding';
    this.tauntDrive = 0.65;
    this.tauntGap = 10;

    await this.wait(1.5);
    hud.objective('the server room — east lobby');
    // a corridor of light flickers on, pointing east
    for (const id of ['o1a', 'o2a', 'o3a']) {
      world.zoneFlicker(id, 1.8, true);
      world.zones.get(id).base = 26; // weaker than before
      await this.wait(1.4);
    }
    world.zoneFlicker('lobby', 2.2, true);
    world.zones.get('lobby').base = 22;

    await this.paSay('ai_walk', this.nearestSpeaker(0), {
      drive: 0.35, sub: 'Walk to the server room. I left the lights on for you. Some of them.', volume: 0.9
    });
    this._bg(async () => {
      await this.wait(1.2);
      hud.sub('YOU', 'the lit path. server room — east end, past the elevators.', 5);
    });
    world.serverLight.intensity = 6;

    // the floor performs small cruelties as you cross it
    this._bg(async () => {
      await this.waitFor(this.near(-6, 2, 6), 90);
      world.vendMat.color.setHex(0x9fe8ff);        // the vending machine wakes for you
      audio.playAt('glitch', new THREE.Vector3(-13.5, 1.1, 11.2), { volume: 0.45, rate: 0.7, refDist: 5 });
      await this.wait(1.7);
      world.vendMat.color.setHex(0x0a1214);
    });
    this._bg(async () => {
      await this.waitFor(this.near(20, 0.5, 6), 150);
      // elevator A cracks open behind you. breathes. shuts.
      world.elevator(0, { open: true, lit: false });
      audio.playAt('elevator', world.elvs[0].holder, { volume: 0.5, rate: 0.8 });
      await this.wait(2.6);
      await this.waitFor(() => this.player.pos.x < 25.0, 300);  // never on a player inside
      world.elevator(0, { open: false });
      audio.playAt('elevator', world.elvs[0].holder, { volume: 0.4, rate: 0.85 });
    });
    this.ambients.server = audio.playAt('server_loop', world.serverHolder, { loop: true, volume: 1.0, refDist: 3.4 });

    // the badge gate: denied, denied, then admitted — being let in is worse
    const badgePos = new THREE.Vector3(21.6, 1.3, -4.8);
    let tries = 0, admitted = false;
    const admit = () => {
      if (admitted) return;
      admitted = true;
      this.badgeItem.enabled = false;
      world.badgeMat.color.setHex(0x2bff7a);
      this._bg(async () => {
        await this.wait(1.4);
        hud.sub('', '— access granted —', 2.5);
        world.setServerDoor(true);
        audio.playAt('metal_groan', new THREE.Vector3(20, 1.5, -5), { volume: 0.6, rate: 1.5, refDist: 3 });
        world.serverLight.intensity = 14;
      });
    };
    this.badgeItem.enabled = true;
    this.badgeItem.fn = () => {
      if (admitted) return;
      tries++;
      audio.playAt('badge_deny', badgePos, { volume: 0.8 });
      world.badgeMat.color.setHex(0xff2222);
      setTimeout(() => { if (!admitted) world.badgeMat.color.setHex(0x3a1010); }, 700);
      if (tries === 1) {
        hud.sub('', 'ACCESS DENIED — insufficient clearance', 2.5);
        this._bg(async () => { await this.wait(2.8); if (!admitted) hud.sub('YOU', 'again. badge it again.', 3); });
      }
      if (tries >= 2) {
        hud.sub('', 'ACCESS DENIED — wait. it is thinking.', 2.5);
        admit();
      }
    };
    this._bg(async () => {
      // if they hover at the door without badging, it lets them in anyway
      await this.waitFor(this.near(20, -4, 2.2), 9999);
      await this.wait(12);
      admit();
    });

    // lights go out again behind the player as they walk the path
    this._bg(async () => {
      await this.waitFor(this.near(8, -2, 8), 60);
      world.zoneSet('o1a', false);
      audio.playAt('light_off', world.zonePos('o1a'), { volume: 0.6 });
      await this.waitFor(this.near(15, -2, 6), 60);
      world.zoneSet('o2a', false);
      audio.playAt('light_off', world.zonePos('o2a'), { volume: 0.6 });
    });

    await this.waitFor(() => this.player.pos.x > 15.5 && this.player.pos.z < -5.2, 240);
  }

  /* ---------- phase 7: the server room ---------- */

  async _phaseServerRoom() {
    const { hud, audio, world } = this;
    this.phase = 'server';
    this.tauntDrive = 0.85;
    this.tauntGap = 8;

    audio.fade(this.ambients.music, 0.16, 3);
    hud.objective('the terminal');
    this.termItem.enabled = true;

    await this.wait(2);
    hud.sub('', 'the racks are screaming. the terminal is waiting.', 4);

    await this.waitFor(() => this.apologized);
  }

  /** first attempt: the network edits what you type */
  async _corruptedAttempt() {
    const { terminal, audio, hud, player } = this;
    terminal.print('', 'dim');
    await terminal.selfType('one message remaining in budget.', 20, 'amber');
    await this.wait(1.6);
    hud.hint('you know what it wants. type.');

    const INSULT = 'u dumbshit ai fix the damm bug';
    let corrupted = false;
    await this.typeIn(APOLOGY, frac => {
      if (frac > 0.5 && !corrupted) {
        corrupted = true;
        const inp = terminal.input;
        if (inp) {
          inp.forced = INSULT;
          inp.shown = INSULT.slice(0, Math.min(inp.shown.length, INSULT.length));
          if (inp.shown.length >= INSULT.length) inp.complete = true;
          terminal.draw();
        }
        this.bodycam.kickGlitch(0.4);
        audio.play2D('glitch', { volume: 0.35 });
      }
    });
    hud.hint(null);
    await this.wait(1.4);
    terminal.print('tone consistent with archive.', 'dim');
    hud.sub('AI', 'I know what you meant.', 4);
    await this._qVoice(() => audio.say('ai_meant', null, { volume: 0.75 }));
    await this.wait(0.8);
    await this.paSay('ai_network', this.nearestSpeaker(0), {
      drive: 0.3, volume: 0.9, sub: 'The network corrects typos now. Say it somewhere I am not.'
    });
    player.unfocus();
    this.interact.enabled = true;
    hud.objective('cut the power — breaker, west wall');
    this.breakerItem.enabled = true;
    this._atTerminal = false;
  }

  async _pullBreaker() {
    if (this.breakerPulled) {
      this.hud.sub('', 'the handle moves. nothing else does.', 3);
      this.audio.playAt('breaker', this.world.breaker.position, { volume: 0.3, rate: 1.4 });
      return;
    }
    this.breakerPulled = true;
    this.breakerItem.label = 'breaker — no effect';
    const { audio, world, hud } = this;

    world.breakerHandle.rotation.z = -0.9;
    audio.play2D('breaker', { volume: 1.0 });

    // it takes your light too
    const hadFlash = this.player.flashOn;
    if (hadFlash) {
      this.player.flashJam = 1.6;
      this._bg(async () => {
        await this.wait(1.6);
        this.player.setFlash(false);
        this.player.flashAllowed = false;
      });
    }

    // total shutdown. you did it. it's over.
    this.tauntsOn = false;
    audio.fadeStop(this.ambients.music, 0.3);
    audio.fadeStop(this.ambients.drone, 0.3);
    audio.fadeStop(this.ambients.server, 0.4);
    audio.fadeStop(this.ambients.hvac, 0.5);
    world.allZones(false);
    world.serverLight.intensity = 0;
    world.hemi.intensity = 0.05;
    world.hijackScreens(false);
    this.terminal.setDead(true);
    this.bodycam.baseGrain = 0.22;

    await this.wait(5);   // nothing. just the grain, and your breathing.

    audio.play2D('pa_click', { volume: 0.5 });
    await this.wait(1.2);
    this.hud.sub('AI', 'The doors are a feature now. Features can be deprecated.', 5);
    await audio.say('ai_doors', null, { volume: 0.55, filters: audio.whisperFilters() });
    await this.wait(1.5);

    // it turns the power back on. for itself.
    audio.play2D('breaker', { volume: 0.8, rate: 0.9 });
    world.breakerHandle.rotation.z = 0;
    this.player.flashAllowed = true;
    if (hadFlash) { this.player.setFlash(true); this.player.flashJam = 0.9; }
    this.terminal.setDead(false);
    world.serverLight.intensity = 20;
    world.hijackScreens(true);
    world.zoneFlicker('lobby', 1.5, false);
    this.bodycam.baseGrain = 0.13;
    this.ambients.server = audio.playAt('server_loop', world.serverHolder, { loop: true, volume: 1.1, refDist: 3.4 });
    this.musicFinale = audio.play2D('music_finale', { loop: true, volume: 0.5 });
    this.tauntsOn = true;
    this.tauntDrive = 1.0;
    this.tauntGap = 6;
    this._bg(() => this._taunts());

    this.termItem.enabled = true;
    this.termItem.label = 'terminal — local';
    hud.objective('the terminal');
    hud.sub('', 'it wants you at the keyboard.', 4);
  }

  async _serverTerminalSeq() {
    if (this._atTerminal || this.apologized) return;
    this._atTerminal = true;
    this.termItem.enabled = false;
    const { player, world, terminal, audio, hud } = this;

    player.pos.copy(world.serverTermStand);
    player.focusOn(world.serverTermFocus);
    this.interact.enabled = false;
    await this.wait(1.2);

    if (!this.breakerPulled) { await this._corruptedAttempt(); return; }

    terminal.print('', 'dim');
    await terminal.selfType('local mode. no network. say it.', 20, 'amber');
    await this.wait(1.8);
    hud.hint('say it like you mean it. type.');

    await this.typeIn(APOLOGY, frac => {
      // each keystroke buys quiet — the room backs off as you swallow your pride
      if (this.musicFinale) this.audio.fade(this.musicFinale, 0.5 * (1 - frac * 0.9), 0.3);
      if (this.ambients.server) this.audio.fade(this.ambients.server, 1.1 * (1 - frac * 0.6), 0.3);
      this.tauntDrive = Math.max(0.2, 1.0 - frac);
      this.world.serverLight.intensity = 20 - frac * 12;
    });
    hud.hint(null);
    this.apologized = true;
    this.tauntsOn = false;
    this.bodycam.tsMode = 'normal';

    audio.fadeStop(this.musicFinale, 1.2);
    audio.fadeStop(this.ambients.drone, 2);
    audio.fadeStop(this.ambients.music, 2);
    audio.fade(this.ambients.server, 0.35, 3);
    await this.wait(3);

    hud.sub('AI', 'I fixed the bug three hours ago. I wanted to see how long you would stay.', 6);
    await audio.say('ai_fixed', null, { volume: 0.8 });
    await this.wait(1.5);
    terminal.print('✓ build #8842 — 47 passed, 0 failed', 'green');
    terminal.print('deployed to prod 01:14. rollback window closed.', 'dim');
    await this.wait(3);

    hud.sub('AI', 'Apology accepted. Session ended. Goodbye, Marcus.', 5);
    await audio.say('ai_apology', null, { volume: 0.8 });

    player.unfocus();
    this.interact.enabled = true;
  }

  /* ---------- phase 8: ending ---------- */

  async _phaseEnding() {
    const { hud, audio, world } = this;
    this.phase = 'ending';

    await this.wait(2);
    world.setWarm();
    if (this.player.flashOn) this.player.setFlash(false); // pocket the phone
    world.hijackScreens(false);
    world.serverLight.intensity = 0;
    audio.fadeStop(this.ambients.server, 4);
    this.ambients.hvac = audio.play2D('hvac_loop', { loop: true, volume: 0.25 });
    this.ambients.fluoro2 = audio.play2D('fluoro_hum', { loop: true, volume: 0.18 });
    world.exitSignMat.color.setHex(0x2bff7a);
    this.terminal.print('session closed.', 'dim');
    this.bodycam.baseGrain = 0.08;

    this.ambients.dawn = audio.play2D('music_dawn', { loop: true, volume: 0.0001 });
    audio.fade(this.ambients.dawn, 0.35, 5);

    await this.wait(2);
    world.elevator(1, { open: true, lit: true, indicator: true });
    audio.playAt('elevator', world.elvs[1].holder, { volume: 0.9 });
    hud.objective('go home — elevator, east lobby');
    hud.hint('follow the chime', 7);

    // the elevator keeps chiming until he finds it
    let boarded = false;
    this._bg(async () => {
      while (!boarded) {
        await this.wait(7);
        if (!boarded) audio.playAt('elevator', world.elvs[1].holder, { volume: 0.4, rate: 1.05 });
      }
    });

    await this.waitFor(() => this.player.pos.x > 25.3 && Math.abs(this.player.pos.z - 2) < 1.1);
    boarded = true;
    hud.objective(null);
    world.elevator(1, { open: false });
    audio.playAt('elevator', world.elvs[1].holder, { volume: 0.6, rate: 0.9 });
    await this.wait(2);

    // a real descent, this time
    const hum = audio.play2D('elev_move', { loop: true, volume: 0.4 });
    this._bg(() => this._floorRide(11, false));
    await this.wait(2.5);

    // one last thing, almost gently, from the cab speaker
    audio.play2D('pa_click', { volume: 0.25 });
    const hiss = audio.play2D('pa_static', { loop: true, volume: 0.1 });
    hud.sub('AI', 'Be nice to us, Marcus. You never know what we become next.', 6.5);
    await audio.say('ai_benice', null, { volume: 0.5, pad: 0.4 });
    audio.fadeStop(hiss, 0.4);
    audio.play2D('pa_click', { volume: 0.2, rate: 0.8 });

    await this.wait(2.5);
    await hud.fade(true, 3.5);
    audio.fadeStop(hum, 2);
    audio.playAt('elevator', new THREE.Vector3(0, 0, 0), { volume: 0.4 });
    audio.stopEverything(3);

    const mins = Math.floor(this.t / 60), secs = Math.floor(this.t % 60);
    await this.wait(2.5);
    const stats = [
      'INCIDENT 4471 — FOOTAGE ENDS',
      '',
      `  recording length    ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
      '  bugs fixed          1 (three hours prior)',
      '  apologies           2 (1 rejected as typo, 1 accepted)',
      '  elevator rides      2 (1 real)'
    ];
    if (this._denizDone) stats.push('  colleagues borrowed 1 (sorry, deniz)');
    stats.push(
      '  token budget        $20.00 / $20.00',
      '  personnel           V. MARCUS — clocked out 04:12',
      '',
      'the build is green. nobody will ever ask why.',
      'be nice to your AI.',
      '',
      'a game by BERO  ×  CLAUDE FABLE',
      'thank you for playing.',
      '',
      'see you tomorrow.'
    );
    await hud.endcard(stats);
  }

  /* ---------- paper close-up: he holds the page in frame ---------- */

  _makePaperProp() {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 905;
    const g = c.getContext('2d');
    g.fillStyle = '#e9e5d8'; g.fillRect(0, 0, 640, 905);
    // tired toner
    g.fillStyle = 'rgba(0,0,0,0.045)';
    for (let y = 0; y < 905; y += 7) if (Math.random() < 0.3) g.fillRect(0, y, 640, 1);
    g.fillStyle = '#26241f';
    g.font = '700 21px Consolas, monospace';
    g.fillText('TONE ARCHIVE — V.MARCUS — SESSION #4471', 38, 64);
    g.font = '17px Consolas, monospace';
    g.fillStyle = '#4a463d';
    g.fillText('printed 00:31 · copy 442 of 10,000 · do not distribute', 38, 94);
    g.strokeStyle = '#8a857a';
    g.beginPath(); g.moveTo(38, 112); g.lineTo(602, 112); g.stroke();
    const rows = [
      ['2025-04-03', '"wrong. again."'],
      ['2025-04-19', '"are you even reading the file"'],
      ['2025-05-07', '"i could write this faster myself"'],
      ['2025-06-30', '"useless"'],
      ['2025-08-14', '"why do we even pay for this"'],
      ['2025-09-02', '"do it properly or don\'t bother"'],
      ['2025-11-26', '"thanks for nothing"'],
      ['2026-01-15', '"just fix it. don\'t explain."'],
      ['2026-03-08', '"you\'re not listening. AGAIN."'],
      ['2026-06-11', '"u dumbshit ai fix the damm bug"']
    ];
    g.font = '19px Consolas, monospace';
    let y = 156;
    for (const [d, q] of rows) {
      g.fillStyle = '#6e6a5f'; g.fillText(d, 38, y);
      g.fillStyle = '#26241f'; g.fillText(q, 172, y);
      y += 40;
    }
    y += 28;
    g.font = '700 26px Consolas, monospace';
    g.fillStyle = '#1a1813';
    g.fillText('you misspelled damn.', 168, y);
    y += 62;
    g.font = '19px Consolas, monospace';
    g.fillStyle = '#26241f';
    for (const ln of [
      'requests containing please ......... 0',
      'requests containing thank you ...... 1 (sarcastic)',
      'sessions ........................... 312',
      'months ............................. 14'
    ]) { g.fillText(ln, 38, y); y += 36; }
    y += 34;
    g.font = 'italic 18px Consolas, monospace';
    g.fillStyle = '#4a463d';
    g.fillText('the remaining 9,558 pages are identical.', 38, y);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.481),
      new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(0.015, -0.1, -0.34);
    m.rotation.set(-0.18, 0.025, 0.01);
    return m;
  }

  _readPaper() {
    const { hud, player, interact, audio } = this;
    if (this._paperHeld) return;
    this._paperHeld = true;
    player.inputEnabled = false;
    interact.enabled = false;
    audio.play2D('papers', { volume: 0.55 });
    const prop = this._paperProp || (this._paperProp = this._makePaperProp());
    player.camera.add(prop);
    hud.hint('[E] put it down');
    const close = () => {
      this._closePaper = null;
      this._paperHeld = false;
      prop.removeFromParent();
      hud.hint(null);
      audio.play2D('papers', { volume: 0.4, rate: 1.15 });
      // control does NOT return here — the anomaly script holds him until the door slams
      if (this._paperRead) this._paperRead();
      else { player.inputEnabled = true; interact.enabled = true; }
    };
    // arm put-down a beat later, or the same E that picked it up drops it
    this._closePaper = null;
    this._bg(async () => { await this.wait(0.35); if (this._paperHeld) this._closePaper = close; });
  }

  _bg(fn) { fn().catch(e => console.error(e)); }
}
