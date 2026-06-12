import * as THREE from 'three';

const EYE = 1.52, SEAT_EYE = 1.18, RADIUS = 0.34;

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;            // smoothed (camera)
    this.tYaw = 0; this.tPitch = 0;          // target (mouse)
    this.mode = 'seated';                    // 'seated' | 'free' | 'focus'
    this.seatCfg = null;
    this.focusTarget = null;
    this.colliders = [];
    this.keys = {};
    this.bobT = 0; this.bobPhase = 0;
    this.speedMul = 1;
    this.onFootstep = null;
    this.inputEnabled = true;
    this.eye = EYE;
    this.baseFov = camera.fov;
    this.zoomFov = 36;         // FOV at full digital zoom
    this.zoom = 0;             // 0..1, smoothed
    this.zoomTarget = 0;

    // phone flashlight
    this.flashAllowed = false;
    this.flashOn = false;
    this.flashJam = 0;         // seconds of stutter (the AI leaning on it)
    this.flashBase = 46;
    this.flash = new THREE.SpotLight(0xcfe0ff, 0, 24, 0.62, 0.6, 1.4);
    this.flash.position.set(0.14, -0.16, 0.1);
    camera.add(this.flash);
    this._flashTgt = new THREE.Object3D();
    this._flashTgt.position.set(0, -0.08, -4);
    camera.add(this._flashTgt);
    this.flash.target = this._flashTgt;
    // the phone itself, held low in frame
    const pg = new THREE.Group();
    pg.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.16, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.35, metalness: 0.5 })));
    this.phoneScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.145),
      new THREE.MeshBasicMaterial({ color: 0x16222e }));
    this.phoneScreen.position.z = 0.0065;
    pg.add(this.phoneScreen);
    pg.position.set(0.17, -0.175, -0.38);
    pg.rotation.set(-0.55, 0.16, 0.1);
    pg.visible = false;
    camera.add(pg);
    this.phoneProp = pg;

    document.addEventListener('mousedown', e => {
      if (document.pointerLockElement == null || !this.inputEnabled) return;
      if (e.button === 2) this.zoomTarget = 1;
    });
    document.addEventListener('mouseup', e => { if (e.button === 2) this.zoomTarget = 0; });
    document.addEventListener('contextmenu', e => e.preventDefault());

    this.touchMove = { x: 0, y: 0 };   // analog stick, set by TouchControls

    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement == null || !this.inputEnabled) return;
      this.look(e.movementX, e.movementY);
    });
    document.addEventListener('keydown', e => { this.keys[e.code] = true; });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  seat(cfg) {
    // cfg: { pos:Vector3, yaw, yawRange, pitchMin, pitchMax }
    this.mode = 'seated';
    this.seatCfg = cfg;
    this.pos.copy(cfg.pos);
    this.yaw = this.tYaw = cfg.yaw;
    this.pitch = this.tPitch = -0.12;
    this.eye = SEAT_EYE;
  }

  stand() {
    this.mode = 'free';
    this.seatCfg = null;
    this.eye = EYE;
  }

  /** shared by mouse (movementXY) and touch drag deltas */
  look(dx, dy) {
    if (!this.inputEnabled) return;
    const s = 0.0021 * (1 - this.zoom * 0.68);   // steadier hand while zoomed
    this.tYaw -= dx * s;
    this.tPitch -= dy * s;
    this.tPitch = THREE.MathUtils.clamp(this.tPitch, -1.35, 1.35);
    if (this.mode === 'seated' && this.seatCfg) {
      const c = this.seatCfg;
      this.tYaw = THREE.MathUtils.clamp(this.tYaw, c.yaw - c.yawRange, c.yaw + c.yawRange);
      this.tPitch = THREE.MathUtils.clamp(this.tPitch, c.pitchMin, c.pitchMax);
    }
  }

  setFlash(on) {
    this.flashOn = on;
    this.phoneProp.visible = on;
    this.flash.intensity = on ? this.flashBase : 0;
  }

  /** soft-locks the view onto a world point (terminal focus) */
  focusOn(point) {
    this.mode = 'focus';
    this.focusTarget = point.clone();
  }
  unfocus() { this.mode = 'free'; this.focusTarget = null; }

  update(dt) {
    // bodycam mount lag — the lens trails the head
    const k = 1 - Math.exp(-dt * 13);
    if (this.mode === 'focus' && this.focusTarget) {
      const d = this.focusTarget.clone().sub(this.pos.clone().setY(this.pos.y + this.eye));
      const ty = Math.atan2(-d.x, -d.z);
      const tp = Math.atan2(d.y, Math.hypot(d.x, d.z));
      // unwrap yaw to nearest
      let dy = ty - this.tYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.tYaw += dy * Math.min(1, dt * 4);
      this.tPitch += (tp - this.tPitch) * Math.min(1, dt * 4);
    }
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;

    let speed = 0, strafe = 0;
    if (this.mode === 'free' && this.inputEnabled) {
      let f = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
      let s = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
      let mag = 1, touchRun = false;
      const run = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
      const tm = this.touchMove;
      if (f === 0 && s === 0 && Math.hypot(tm.x, tm.y) > 0.12) {
        f = -tm.y; s = tm.x;
        mag = Math.min(1, Math.hypot(tm.x, tm.y));
        touchRun = mag > 0.92;   // pushing the stick to its edge = run
      }
      const v = (run || touchRun ? 3.6 : 2.3) * this.speedMul * (mag < 1 ? Math.max(0.35, mag) : 1);
      if (f !== 0 || s !== 0) {
        const len = Math.hypot(f, s);
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const dx = (-sin * f / len + cos * s / len) * v * dt;
        const dz = (-cos * f / len - sin * s / len) * v * dt;
        this._move(dx, dz);
        speed = v; strafe = s;
      }
    }

    // head bob
    if (speed > 0.1) {
      const prev = this.bobT;
      this.bobT += dt * speed * 3.4;
      if (Math.floor(this.bobT / Math.PI) !== Math.floor(prev / Math.PI) && this.onFootstep) this.onFootstep();
    } else {
      this.bobT += (Math.PI * Math.round(this.bobT / Math.PI) - this.bobT) * Math.min(1, dt * 6);
    }
    const bobAmt = speed > 0.1 ? 0.028 : 0.004;
    const bobY = Math.sin(this.bobT * 2) * bobAmt;
    const roll = Math.sin(this.bobT) * bobAmt * 0.55 + strafe * -0.012;
    // idle breathing sway
    const t = performance.now() / 1000;
    const swayY = Math.sin(t * 1.1) * 0.006, swayR = Math.sin(t * 0.7) * 0.004;

    // flashlight stutter when something is interfering with it
    if (this.flashJam > 0) {
      this.flashJam -= dt;
      if (this.flashOn) {
        this.flash.intensity = Math.random() < 0.55 ? this.flashBase * Math.random() : 0;
        this.phoneScreen.material.color.setHex(Math.random() < 0.5 ? 0x16222e : 0x050608);
      }
      if (this.flashJam <= 0 && this.flashOn) {
        this.flash.intensity = this.flashBase;
        this.phoneScreen.material.color.setHex(0x16222e);
      }
    }

    // digital zoom + lean-in
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 9);
    const fov = this.baseFov - (this.baseFov - this.zoomFov) * this.zoom;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const lean = (this.mode === 'seated' ? 0.34 : 0.12) * this.zoom;
    const lx = -Math.sin(this.yaw) * Math.cos(this.pitch) * lean;
    const lz = -Math.cos(this.yaw) * Math.cos(this.pitch) * lean;

    this.camera.position.set(this.pos.x + lx, this.pos.y + this.eye + bobY + swayY, this.pos.z + lz);
    this.camera.rotation.set(this.pitch, this.yaw, roll + swayR);
  }

  _move(dx, dz) {
    this.pos.x += dx;
    this.pos.z += dz;
    this._resolve();
    this._resolve(); // second pass settles corners
  }

  /** circle vs AABB: push out along the actual penetration normal */
  _resolve() {
    for (const c of this.colliders) {
      if (c.disabled) continue;
      const nx = THREE.MathUtils.clamp(this.pos.x, c.x1, c.x2);
      const nz = THREE.MathUtils.clamp(this.pos.z, c.z1, c.z2);
      const ddx = this.pos.x - nx, ddz = this.pos.z - nz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2), push = (RADIUS - d) / d;
        this.pos.x += ddx * push;
        this.pos.z += ddz * push;
      } else {
        // center ended up inside the box: exit through the nearest face
        const px1 = this.pos.x - c.x1, px2 = c.x2 - this.pos.x;
        const pz1 = this.pos.z - c.z1, pz2 = c.z2 - this.pos.z;
        const m = Math.min(px1, px2, pz1, pz2);
        if (m === px1) this.pos.x = c.x1 - RADIUS;
        else if (m === px2) this.pos.x = c.x2 + RADIUS;
        else if (m === pz1) this.pos.z = c.z1 - RADIUS;
        else this.pos.z = c.z2 + RADIUS;
      }
    }
  }
}
