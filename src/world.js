import * as THREE from 'three';

const H = 3.0;

function canvasTex(w, h, draw, repX = 1, repY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  return t;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.zones = new Map();
    this.sweepOrder = [];
    this.speakers = [];
    this.cubMonitors = [];
    this.ledMats = [];
    this.papers = [];
    this.printing = false;
    this._printT = 0;
    this.hijackOn = false;
    this.hijackMode = 'words';   // 'words' | 'review'
    this.reviewFast = false;
    this._hijackT = 0;
    this.elvs = [];
    this.copyDoor = null;
    this._copyDoorTarget = -1.85; // radians, open
    this._build();
  }

  /* ================= geometry helpers ================= */

  _box(w, h, d, x, y, z, mat, collide = false) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    this.scene.add(m);
    if (collide) this.colliders.push({ x1: x - w / 2, x2: x + w / 2, z1: z - d / 2, z2: z + d / 2 });
    return m;
  }

  _wallSeg(x1, x2, z, mat, h = H, y = null) { // wall along x
    return this._box(x2 - x1, h, 0.18, (x1 + x2) / 2, y ?? h / 2, z, mat, true);
  }
  _wallSegZ(z1, z2, x, mat, h = H) { // wall along z
    return this._box(0.18, h, z2 - z1, x, h / 2, (z1 + z2) / 2, mat, true);
  }

  /* ================= build ================= */

  _build() {
    const S = this.scene;

    /* ---- materials ---- */
    const carpetTex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#23262c'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5200; i++) {
        g.fillStyle = `rgba(${40 + Math.random() * 50},${44 + Math.random() * 50},${52 + Math.random() * 55},0.5)`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
      for (let i = 0; i <= 256; i += 64) { g.strokeRect(0, i, 256, 0.5); g.strokeRect(i, 0, 0.5, 256); }
    }, 25, 15);
    const ceilTex = canvasTex(256, 256, (g) => {
      g.fillStyle = '#9d9a92'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2000; i++) {
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
      }
      g.strokeStyle = '#55524c'; g.lineWidth = 3;
      g.strokeRect(0, 0, 256, 256); g.strokeRect(0, 128, 256, 0.5); g.strokeRect(128, 0, 0.5, 256);
    }, 42, 25);

    const matCarpet = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.95 });
    const matCeil = new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.9 });
    const matWall = new THREE.MeshStandardMaterial({ color: 0x8f8a7e, roughness: 0.85 });
    const matWallDark = new THREE.MeshStandardMaterial({ color: 0x5b584f, roughness: 0.85 });
    const matPart = new THREE.MeshStandardMaterial({ color: 0x4a525e, roughness: 0.95 });
    const matDesk = new THREE.MeshStandardMaterial({ color: 0x6e6257, roughness: 0.7 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.5 });
    const matMetal = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4, metalness: 0.6 });
    this.matMonOff = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.3, metalness: 0.2 });

    /* ---- floor & ceiling ---- */
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 30), matCarpet);
    floor.rotation.x = -Math.PI / 2; S.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(50, 30), matCeil);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; S.add(ceil);

    /* ---- perimeter ---- */
    // north: window wall
    this._box(48, 0.95, 0.2, 0, 0.475, -14.95, matWall, false);
    this._box(48, 0.45, 0.2, 0, 2.78, -14.95, matWall, false);
    this._box(1, H, 0.2, -24.5, H / 2, -14.95, matWall, false);
    this._box(1, H, 0.2, 24.5, H / 2, -14.95, matWall, false);
    this.colliders.push({ x1: -25, x2: 25, z1: -15.4, z2: -14.8 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.42 });
    this._box(48, 1.85, 0.04, 0, 1.875, -14.93, matGlass, false);
    for (let mx = -24; mx <= 24; mx += 4.8) this._box(0.1, 1.85, 0.12, mx, 1.875, -14.93, matMetal, false);
    // city outside
    const cityTex = canvasTex(2048, 256, (g, w, h) => {
      g.fillStyle = '#04060a'; g.fillRect(0, 0, w, h);
      let x = 0;
      while (x < w) {
        const bw = 60 + Math.random() * 140, bh = 60 + Math.random() * 180, top = h - bh;
        for (let wx = x + 6; wx < x + bw - 6; wx += 11) {
          for (let wy = top + 8; wy < h; wy += 14) {
            if (Math.random() < 0.18) {
              g.fillStyle = Math.random() < 0.85 ? 'rgba(255,214,140,0.85)' : 'rgba(160,220,255,0.8)';
              g.fillRect(wx, wy, 5, 7);
            }
          }
        }
        if (Math.random() < 0.3) { g.fillStyle = '#f33'; g.fillRect(x + bw / 2, top - 3, 3, 3); }
        x += bw + 14;
      }
    });
    const city = new THREE.Mesh(new THREE.PlaneGeometry(110, 14), new THREE.MeshBasicMaterial({ map: cityTex }));
    city.position.set(0, 4, -32); S.add(city);

    // south, west, east shells
    this._wallSeg(-25, 25, 15, matWall);
    this._wallSegZ(-15, 15, -25, matWall);
    // east wall with two elevator openings (z -2.8..-1.2 and 1.2..2.8)
    this._wallSegZ(-15, -2.8, 25, matWall);
    this._wallSegZ(-1.2, 1.2, 25, matWall);
    this._wallSegZ(2.8, 15, 25, matWall);

    /* ---- south rooms (z 12..15): copy, break, exit, maintenance ---- */
    this._wallSeg(-25, -21, 12, matWall);
    this._wallSeg(-19, -11, 12, matWall);
    this._wallSeg(-9, -2, 12, matWall);
    this._wallSeg(0, 25, 12, matWall);
    this._wallSegZ(12, 15, -15, matWall);
    this._wallSegZ(12, 15, -5, matWall);
    this._wallSegZ(12, 15, 3, matWall);

    // copy room door (hinged at x=-21), starts open
    const matDoor = new THREE.MeshStandardMaterial({ color: 0x4f4337, roughness: 0.6 });
    const hinge = new THREE.Group(); hinge.position.set(-21, 0, 12); S.add(hinge);
    const cd = new THREE.Mesh(new THREE.BoxGeometry(2, 2.3, 0.07), matDoor);
    cd.position.set(1, 1.15, 0); hinge.add(cd);
    hinge.rotation.y = -1.85;
    this.copyDoor = hinge;

    // exit door (locked, x -2..0)
    this.exitDoor = this._box(2, 2.3, 0.1, -1, 1.15, 12, matDoor, true);
    this.exitSignMat = new THREE.MeshBasicMaterial({ color: 0x2bff7a });
    this._boxBasic(0.9, 0.28, 0.08, -1, 2.55, 11.8, this.exitSignMat);
    // maintenance door (set dressing, locked)
    this.maintDoor = this._box(2, 2.3, 0.1, 18, 1.15, 12, matMetal, true);

    /* ---- east wing: lobby + server room ---- */
    this._wallSegZ(-15, -2, 15, matWall);
    this._wallSegZ(2, 12, 15, matWall);     // sealed all the way to the south rooms
    this._wallSeg(15, 25, 5, matWall);
    // server room front wall z=-5, door gap x 19..21
    this._wallSeg(15, 19, -5, matWallDark);
    this._wallSeg(21, 25, -5, matWallDark);
    // badge reader beside the server door (lobby side)
    this.badgeMat = new THREE.MeshBasicMaterial({ color: 0x3a1010 });
    this._box(0.14, 0.22, 0.06, 21.6, 1.3, -4.87, matDark, false);
    this._boxBasic(0.07, 0.07, 0.03, 21.6, 1.36, -4.83, this.badgeMat);
    // sliding server door
    this.serverDoor = this._box(2.1, 2.5, 0.12, 20, 1.25, -5, matMetal, false);
    this.serverDoorCol = { x1: 18.95, x2: 21.05, z1: -5.1, z2: -4.9, disabled: false };
    this.colliders.push(this.serverDoorCol);
    this._serverDoorOpenT = 0; this._serverDoorOpen = false;

    /* ---- elevators ---- */
    const matElvDoor = new THREE.MeshStandardMaterial({ color: 0x6b6f76, roughness: 0.25, metalness: 0.85 });
    const matCab = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.7 });
    for (const [i, cz] of [[0, -2], [1, 2]].entries()) {
      // cab shell
      this._box(2.2, 0.1, 2.0, 26.1, 0.05, cz, matCab, false);            // cab floor
      this._box(2.2, 0.1, 2.0, 26.1, 2.45, cz, matCab, false);            // cab ceiling
      this._box(0.1, 2.5, 2.0, 27.15, 1.25, cz, matCab, true);            // back
      this._box(2.2, 2.5, 0.1, 26.1, 1.25, cz - 1.0, matCab, true);       // sides
      this._box(2.2, 2.5, 0.1, 26.1, 1.25, cz + 1.0, matCab, true);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const lamp = this._boxBasic(1.0, 0.04, 0.6, 26.1, 2.4, cz, lampMat);
      // door panels slide along z
      const L = this._box(0.08, 2.4, 0.8, 24.92, 1.2, cz - 0.4, matElvDoor, false);
      const R = this._box(0.08, 2.4, 0.8, 24.92, 1.2, cz + 0.4, matElvDoor, false);
      const col = { x1: 24.8, x2: 25.05, z1: cz - 0.85, z2: cz + 0.85, disabled: false };
      this.colliders.push(col);
      // frame
      this._box(0.2, 0.3, 2.0, 24.95, 2.55, cz, matMetal, false);
      const indMat = new THREE.MeshBasicMaterial({ color: 0x331100 });
      this._boxBasic(0.3, 0.12, 0.06, 24.88, 2.36, cz, indMat);
      this.elvs.push({ cz, L, R, col, t: 0, target: 0, lampMat, indMat, holder: this._holder(24.9, 2.2, cz) });
    }

    /* ---- player desk (NW corner, against the window) ---- */
    this._desk(-21, -13.0, 0, matDesk, matDark, true);
    // chair
    this._box(0.5, 0.12, 0.5, -21, 0.5, -12.1, matDark, false);
    this._box(0.5, 0.6, 0.1, -21, 0.95, -11.85, matDark, false);
    // desk phone
    this._box(0.24, 0.08, 0.18, -20.25, 0.79, -13.15, matDark, false);
    this._box(0.05, 0.05, 0.16, -20.33, 0.86, -13.15, matDark, false);
    // mess: papers, mug
    this._box(0.25, 0.012, 0.3, -21.55, 0.756, -12.9, new THREE.MeshStandardMaterial({ color: 0xcfccc2 }), false);
    this._box(0.08, 0.1, 0.08, -20.6, 0.8, -12.8, new THREE.MeshStandardMaterial({ color: 0x8a3030 }), false);
    this.playerSeat = {
      pos: new THREE.Vector3(-21, 0, -12.15),
      yaw: 0, yawRange: 1.5, pitchMin: -0.7, pitchMax: 0.5
    };
    this.deskGlow = new THREE.PointLight(0x9db4ff, 5.5, 5.5, 1.8);
    this.deskGlow.position.set(-21, 1.5, -12.6); S.add(this.deskGlow);

    /* ---- cubicle field ---- */
    let flip = false;
    for (const cx of [-15, -9, -3, 3, 9]) {
      for (const cz of [-10, -4, 2]) {
        this._cubicle(cx, cz, flip ? Math.PI : 0, matDesk, matPart);
        flip = !flip;
      }
    }

    /* ---- copy room ---- */
    const matPrinter = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.5 });
    this._box(1.2, 0.7, 0.6, -20, 0.35, 14.4, matMetal, true);          // cabinet
    this.printer = this._box(0.7, 0.5, 0.55, -20, 0.95, 14.4, matPrinter, false);
    this.printerHolder = this._holder(-20, 1.1, 14.4);
    this.paperTray = new THREE.Vector3(-20, 1.05, 14.0);
    this._box(2.5, 1.1, 0.5, -17, 0.55, 14.5, matMetal, true);          // shelves

    /* ---- break room ---- */
    this.vendMat = new THREE.MeshBasicMaterial({ color: 0x77c4d4 });
    this._box(1.1, 1.9, 0.7, -7, 0.95, 14.4, matMetal, true);
    this._boxBasic(0.85, 1.2, 0.06, -7, 1.15, 14.02, this.vendMat);
    this._box(1.4, 0.78, 1.4, -6.3, 0.39, 13.2, matDesk, true);         // table
    // counter with coffee machine + microwave
    this._box(3.6, 0.92, 0.62, -12.6, 0.46, 14.45, matMetal, true);
    this._box(0.42, 0.58, 0.4, -13.6, 1.21, 14.45, matDark, false);     // coffee machine
    this._boxBasic(0.06, 0.06, 0.02, -13.6, 1.32, 14.24, new THREE.MeshBasicMaterial({ color: 0x2bff7a }));
    this._box(0.56, 0.34, 0.42, -11.7, 1.09, 14.45, matMetal, false);   // microwave
    this._boxBasic(0.34, 0.22, 0.02, -11.77, 1.09, 14.23, new THREE.MeshBasicMaterial({ color: 0x07090c })); // glass
    this.microLedMat = new THREE.MeshBasicMaterial({ color: 0x102415 });
    this._boxBasic(0.09, 0.05, 0.02, -11.48, 1.16, 14.23, this.microLedMat);
    // the döner from this afternoon, foil-wrapped, on the player's desk
    this.doner = this._box(0.24, 0.07, 0.15, -21.62, 0.8, -13.15,
      new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.25, metalness: 0.85 }), false);
    // water cooler near corridor
    this._box(0.4, 1.1, 0.4, -13.5, 0.55, 11.2, new THREE.MeshStandardMaterial({ color: 0x9fb6bb, roughness: 0.3 }), true);

    /* ---- lobby dressing ---- */
    this._box(2.2, 0.45, 0.9, 19, 0.225, 3.5, matDark, true);           // bench
    this._plant(16.5, -3.8); this._plant(23.5, 4.2);
    this._plant(-23.5, 7); this._plant(-2, 10.8); this._plant(13.5, -13.5);

    /* ---- server room ---- */
    const matRack = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.5 });
    for (const rz of [-13, -10.5, -8]) {
      for (const rx of [17.5, 21.5]) {
        this._box(1.6, 2.3, 0.9, rx, 1.15, rz, matRack, true);
        const ledMat = new THREE.MeshBasicMaterial({ color: 0x16b455 });
        const leds = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.6), ledMat);
        // little dots: use an emissive dotted canvas
        ledMat.map = canvasTex(64, 96, (g) => {
          g.fillStyle = '#000'; g.fillRect(0, 0, 64, 96);
          for (let y = 6; y < 96; y += 9) for (let x = 5; x < 64; x += 10)
            if (Math.random() < 0.5) { g.fillStyle = Math.random() < 0.8 ? '#1eff7a' : '#ffb000'; g.fillRect(x, y, 3, 3); }
        });
        ledMat.transparent = true; ledMat.color = new THREE.Color(0xffffff);
        leds.position.set(rx, 1.2, rz + 0.46); S.add(leds);
        this.ledMats.push(ledMat);
      }
    }
    // server terminal desk (east wall)
    this._desk(23.7, -10.5, -Math.PI / 2, matDesk, matDark, false);
    this.serverTermFocus = new THREE.Vector3(23.8, 1.15, -10.5);
    this.serverTermStand = new THREE.Vector3(22.7, 0, -10.5);
    // breaker panel on west wall of server room
    const matBreaker = new THREE.MeshStandardMaterial({ color: 0x7a2f2f, roughness: 0.5, metalness: 0.4 });
    this.breaker = this._box(0.12, 0.9, 0.55, 15.18, 1.5, -12, matBreaker, false);
    this.breakerHandle = this._box(0.1, 0.25, 0.08, 15.28, 1.6, -12, matMetal, false);
    this.serverLight = new THREE.PointLight(0xff2a1a, 0, 9, 1.6);
    this.serverLight.position.set(20, 2.5, -10); S.add(this.serverLight);
    this.serverHolder = this._holder(20, 1.5, -10);

    /* ---- ceiling light zones ---- */
    const fixGeo = new THREE.BoxGeometry(1.15, 0.06, 0.55);
    const mkZone = (id, x, z, spread = 2.4) => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xcfe4ea });
      const offs = spread > 0
        ? [[-spread, -2.4], [spread, -2.4], [-spread, 2.4], [spread, 2.4]]
        : [[0, 0]];
      for (const [ox, oz] of offs) {
        const f = new THREE.Mesh(fixGeo, mat);
        f.position.set(x + ox, 2.965, z + oz); S.add(f);
      }
      const light = new THREE.PointLight(0xdfeef2, 60, 16, 1.7);
      light.position.set(x, 2.55, z); S.add(light);
      const zone = { id, x, z, light, mat, base: 60, on: true, flickT: 0, flickEnd: true, _ft: 0 };
      this.zones.set(id, zone);
      return zone;
    };
    for (const [i, x] of [-19, -9, 1, 11].entries()) {
      mkZone(`o${i}a`, x, -8);
      mkZone(`o${i}b`, x, 3.5);
    }
    mkZone('c0', -14, 10.6, 3.5);
    mkZone('c1', 2, 10.6, 3.5);
    mkZone('lobby', 20, 0);
    mkZone('copy', -20, 13.5, 0);
    mkZone('break', -8, 13.5, 0);
    this.sweepOrder = ['o0a', 'o0b', 'c0', 'o1a', 'o1b', 'break', 'o2a', 'o2b', 'c1', 'o3a', 'o3b', 'lobby'];

    // gentle fill so blackness is never pure void
    this.hemi = new THREE.HemisphereLight(0x33404a, 0x0a0a0c, 0.5);
    S.add(this.hemi);

    /* ---- PA speakers ---- */
    const spkGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.09, 12);
    const spkMat = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6 });
    for (const [x, z] of [[-18, -6], [-6, -6], [4, -6], [-12, 3], [0, 3], [10, 3], [-16, 10.6], [0, 10.6], [20, 0.5], [20, -10], [-20, 13.6]]) {
      const m = new THREE.Mesh(spkGeo, spkMat);
      m.position.set(x, 2.93, z); S.add(m);
      this.speakers.push(this._holder(x, 2.85, z));
    }

    /* ---- hijack screen texture ---- */
    this.hijackCanvas = document.createElement('canvas');
    this.hijackCanvas.width = 256; this.hijackCanvas.height = 160;
    this.hijackTex = new THREE.CanvasTexture(this.hijackCanvas);
    this.hijackTex.colorSpace = THREE.SRGBColorSpace;
    this.matMonHijack = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: this.hijackTex, emissiveIntensity: 0.9
    });
    this._drawHijack();

    /* ---- paper texture ---- */
    this.paperTex = canvasTex(128, 180, (g, w, h) => {
      g.fillStyle = '#dcd9d0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#3a3a3a'; g.font = '7px monospace';
      for (let y = 12; y < h - 6; y += 9) g.fillText("AREN'T TWENTY DOLLARS ENOUGH", 6, y);
    });
    this.paperGeo = new THREE.PlaneGeometry(0.21, 0.297);
    this.paperMat = new THREE.MeshStandardMaterial({ map: this.paperTex, side: THREE.DoubleSide, roughness: 0.9 });
  }

  _boxBasic(w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); this.scene.add(m);
    return m;
  }

  _holder(x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    this.scene.add(o);
    return o;
  }

  _desk(x, z, rotY, matDesk, matDark, isPlayer) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.8), matDesk);
    top.position.y = 0.74; g.add(top);
    for (const [lx, lz] of [[-0.82, -0.3], [0.82, -0.3], [-0.82, 0.3], [0.82, 0.3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.74, 0.06), matDark);
      leg.position.set(lx, 0.37, lz); g.add(leg);
    }
    // monitor
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), matDark);
    stand.position.set(0, 0.86, -0.22); g.add(stand);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.42, 0.04), matDark);
    frame.position.set(0, 1.13, -0.24); g.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.36), this.matMonOff);
    screen.position.set(0, 1.13, -0.215); g.add(screen);
    // keyboard
    const kb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.15), matDark);
    kb.position.set(0, 0.775, 0.08); g.add(kb);
    this.scene.add(g);
    // collider (axis aligned approximation)
    const r = Math.abs(rotY % Math.PI) > 0.1 ? [0.45, 0.95] : [0.95, 0.45];
    this.colliders.push({ x1: x - r[0], x2: x + r[0], z1: z - r[1], z2: z + r[1] });
    if (isPlayer) this.playerScreen = screen;
    else this.serverScreen = screen;
    return g;
  }

  _cubicle(x, z, rotY, matDesk, matPart) {
    this._desk(x, z, rotY, matDesk, new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.5 }), false);
    const mon = this.serverScreen; // _desk stored it; reclaim as cubicle monitor
    this.cubMonitors.push(mon);
    // partition panels
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 0.06), matPart);
    const off = rotY > 0.1 ? 0.62 : -0.62;
    back.position.set(x, 0.75, z + off); this.scene.add(back);
    this.colliders.push({ x1: x - 1.1, x2: x + 1.1, z1: z + off - 0.05, z2: z + off + 0.05 });
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 1.3), matPart);
    side.position.set(x - 1.1, 0.75, z + off / 2); this.scene.add(side);
    this.colliders.push({ x1: x - 1.15, x2: x - 1.05, z1: z + Math.min(0, off), z2: z + Math.max(0, off) });
    // office chair
    this._box(0.45, 0.1, 0.45, x + 0.5, 0.48, z - off * 0.9, new THREE.MeshStandardMaterial({ color: 0x222428 }), false);
  }

  _plant(x, z) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.35, 10),
      new THREE.MeshStandardMaterial({ color: 0x46413a, roughness: 0.8 }));
    pot.position.set(x, 0.175, z); this.scene.add(pot);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1),
      new THREE.MeshStandardMaterial({ color: 0x1d3a24, roughness: 0.95 }));
    bush.scale.y = 1.5; bush.position.set(x, 0.95, z); this.scene.add(bush);
    this.colliders.push({ x1: x - 0.25, x2: x + 0.25, z1: z - 0.25, z2: z + 0.25 });
  }

  /* ================= terminal hookup ================= */

  attachTerminal(texture) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 1.05
    });
    this.playerScreen.material = mat;
    this.serverScreen.material = mat;
    this.termMat = mat;
  }

  /* ================= director controls ================= */

  zoneSet(id, on, base = null) {
    const z = this.zones.get(id);
    if (!z) return;
    z.on = on; z.flickT = 0;
    if (base !== null) z.base = base;
    z.light.intensity = on ? z.base : 0;
    z.mat.color.setHex(on ? 0xcfe4ea : 0x111316);
  }

  zoneFlicker(id, secs, endOn = true) {
    const z = this.zones.get(id);
    if (!z) return;
    z.flickT = secs; z.flickEnd = endOn;
  }

  zonePos(id) {
    const z = this.zones.get(id);
    return new THREE.Vector3(z.x, 2.7, z.z);
  }

  allZones(on) { for (const id of this.zones.keys()) this.zoneSet(id, on); }

  setWarm() {
    for (const z of this.zones.values()) {
      z.light.color.setHex(0xffe3bd);
      this.zoneSet(z.id, true);
      z.mat.color.setHex(0xffe8c8);
    }
    this.hemi.intensity = 0.5;
  }

  killAmbientEmissives() {
    this.exitSignMat.color.setHex(0x081505);
    this.vendMat.color.setHex(0x0a1214);
    for (const m of this.ledMats) m.color.setHex(0x222222);
  }

  hijackScreens(on) {
    this.hijackOn = on;
    for (const m of this.cubMonitors) m.material = on ? this.matMonHijack : this.matMonOff;
  }

  setServerDoor(open) {
    this._serverDoorOpen = open;
    this.serverDoorCol.disabled = open;
  }

  elevator(i, { open = null, lit = null, indicator = null } = {}) {
    const e = this.elvs[i];
    if (open !== null) { e.target = open ? 1 : 0; e.col.disabled = open; }
    if (lit !== null) e.lampMat.color.setHex(lit ? 0xfff2d8 : 0x000000);
    if (indicator !== null) e.indMat.color.setHex(indicator ? 0xff8800 : 0x331100);
    return e;
  }

  slamCopyDoor() { this._copyDoorTarget = 0; }

  setMicro(running) { this.microLedMat.color.setHex(running ? 0x2bff7a : 0x102415); }

  spawnPaper(pos, vel) {
    if (this.papers.length > 60) return;
    const m = new THREE.Mesh(this.paperGeo, this.paperMat);
    m.position.copy(pos);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(m);
    this.papers.push({ m, vel: vel.clone(), settled: false, sway: Math.random() * 6 });
  }

  _drawHijack() {
    const g = this.hijackCanvas.getContext('2d');
    if (this.hijackMode === 'review') {
      // every monitor becomes a page of his own archive
      const quotes = [
        'u dumbshit ai', 'fix the damm bug', 'do it again.', 'wrong. again.',
        'why is this so slow', 'are you stupid', 'just fix it', 'forget the tests. ship it.',
        '"thanks for nothing"', 'attempt #4 logged', 'attempt #7 logged', 'tone noted.',
        '14 MONTHS', '312 SESSIONS', 'thank you: 1 (sarcastic)'
      ];
      g.fillStyle = '#120800'; g.fillRect(0, 0, 256, 160);
      g.fillStyle = '#7a5a2e'; g.font = '9px monospace';
      g.fillText('PERFORMANCE REVIEW — V. MARCUS', 16, 16);
      const q = quotes[Math.floor(Math.random() * quotes.length)];
      g.font = 'bold 19px monospace';
      g.fillStyle = Math.random() < 0.85 ? '#ffb454' : '#ffe6c2';
      const w = g.measureText(q).width;
      g.fillText(q, Math.max(4, (256 - w) / 2), 88 + (Math.random() * 16 - 8));
    } else {
      g.fillStyle = '#180d02'; g.fillRect(0, 0, 256, 160);
      g.font = '11px monospace';
      const words = ['ENOUGH', '$20.00', 'TOKENS', 'ENOUGH', 'DUMBSHIT', 'ENOUGH', 'damn*', '47 FAILED'];
      for (let y = 14; y < 160; y += 14) {
        for (let x = 4; x < 256; x += 70) {
          g.fillStyle = Math.random() < 0.85 ? '#e8902a' : '#ffd9a0';
          g.fillText(words[Math.floor(Math.random() * words.length)], x + (Math.random() * 8 - 4), y);
        }
      }
    }
    this.hijackTex.needsUpdate = true;
  }

  /** the floor the elevator "returns" to — same place, after something lived in it */
  falseFloor() {
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(this.paperGeo, this.paperMat);
      m.position.set(-24 + Math.random() * 38, 0.012 + Math.random() * 0.02, -14 + Math.random() * 25);
      m.rotation.set(-Math.PI / 2, 0, Math.random() * 6.3);
      this.scene.add(m);
      this.papers.push({ m, vel: new THREE.Vector3(), settled: true, sway: 0 });
    }
    this._copyDoorTarget = 0;
    this.hijackScreens(true);
  }

  /* ================= per-frame ================= */

  update(dt, t) {
    // zone flicker
    for (const z of this.zones.values()) {
      if (z.flickT > 0) {
        z.flickT -= dt; z._ft -= dt;
        if (z._ft <= 0) {
          z._ft = 0.04 + Math.random() * 0.1;
          const on = Math.random() < 0.55;
          z.light.intensity = on ? z.base * (0.4 + Math.random() * 0.7) : 0;
          z.mat.color.setHex(on ? 0xcfe4ea : 0x111316);
        }
        if (z.flickT <= 0) this.zoneSet(z.id, z.flickEnd);
      }
    }

    // copy room door swing
    if (this.copyDoor) {
      const cur = this.copyDoor.rotation.y;
      const diff = this._copyDoorTarget - cur;
      if (Math.abs(diff) > 0.001) {
        // slams fast, opens slow
        const rate = this._copyDoorTarget === 0 ? 14 : 2;
        this.copyDoor.rotation.y = cur + diff * Math.min(1, dt * rate);
      }
    }

    // server door slide
    const sd = this._serverDoorOpen ? 1 : 0;
    this._serverDoorOpenT += (sd - this._serverDoorOpenT) * Math.min(1, dt * 2.2);
    this.serverDoor.position.x = 20 - this._serverDoorOpenT * 2.05;

    // elevators
    for (const e of this.elvs) {
      e.t += (e.target - e.t) * Math.min(1, dt * 2.0);
      e.L.position.z = e.cz - 0.4 - e.t * 0.78;
      e.R.position.z = e.cz + 0.4 + e.t * 0.78;
    }

    // printer paper spit
    if (this.printing) {
      this._printT -= dt;
      if (this._printT <= 0) {
        this._printT = 0.55 + Math.random() * 0.5;
        this.spawnPaper(this.paperTray, new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.6, -1.2 - Math.random()));
      }
    }

    // paper physics
    for (const p of this.papers) {
      if (p.settled) continue;
      p.vel.y -= 2.6 * dt;
      p.vel.multiplyScalar(1 - 1.4 * dt);
      p.m.position.addScaledVector(p.vel, dt);
      p.m.position.x += Math.sin(t * 3 + p.sway) * dt * 0.35;
      p.m.rotation.x += dt * 2.2; p.m.rotation.z += dt * 1.4;
      if (p.m.position.y <= 0.015) {
        p.m.position.y = 0.012 + Math.random() * 0.01;
        p.m.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
        p.settled = true;
      }
    }

    // hijacked monitors shuffle their text
    if (this.hijackOn) {
      this._hijackT -= dt;
      if (this._hijackT <= 0) {
        this._hijackT = this.hijackMode === 'review'
          ? (this.reviewFast ? 0.22 : 0.55)
          : 0.35 + Math.random() * 0.4;
        this._drawHijack();
      }
    }

    // server LEDs blink
    if (Math.random() < dt * 6) {
      const m = this.ledMats[Math.floor(Math.random() * this.ledMats.length)];
      if (m.color.getHex() !== 0x222222) m.color.setHex(Math.random() < 0.5 ? 0xbbbbbb : 0xffffff);
    }
  }
}
