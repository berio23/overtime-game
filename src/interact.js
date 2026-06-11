import * as THREE from 'three';

export class Interact {
  constructor(camera, hud) {
    this.camera = camera;
    this.hud = hud;
    this.ray = new THREE.Raycaster();
    this.ray.far = 2.8;
    this.items = [];          // { mesh, label, fn, enabled, once }
    this.current = null;
    this.enabled = true;
  }

  /** mesh can be invisible hitbox; label may be a fn returning string */
  add(mesh, label, fn, opts = {}) {
    const item = { mesh, label, fn, enabled: opts.enabled ?? true, once: opts.once ?? false };
    mesh.userData.interactItem = item;
    this.items.push(item);
    return item;
  }

  /** big invisible box around a small prop so the raycast can't miss */
  static hitbox(scene, x, y, z, w, h, d) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  }

  update() {
    this.current = null;
    if (!this.enabled) { this.hud.prompt(null); this.hud.crosshair(false); return; }
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const meshes = this.items.filter(i => i.enabled).map(i => i.mesh);
    const hits = this.ray.intersectObjects(meshes, false);
    if (hits.length) {
      this.current = hits[0].object.userData.interactItem;
      const label = typeof this.current.label === 'function' ? this.current.label() : this.current.label;
      this.hud.prompt(`[E] ${label}`);
      this.hud.crosshair(false);
    } else {
      this.hud.prompt(null);
      this.hud.crosshair(true);
    }
  }

  trigger() {
    if (!this.current || !this.enabled) return;
    const it = this.current;
    if (it.once) it.enabled = false;
    it.fn(it);
  }
}
