import * as THREE from 'three';
import { AudioMgr } from './audiomgr.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Bodycam } from './bodycam.js';
import { Terminal } from './terminal.js';
import { Hud } from './hud.js';
import { Interact } from './interact.js';
import { Director } from './director.js';
import { IS_MOBILE, TouchControls } from './mobile.js';

const PIXEL_CAP = 1.5; // mobile needs the same cap or monitor text turns to mush
if (IS_MOBILE) document.body.classList.add('mobile');

const renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_CAP));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x05060a, 0.022);

// phones subtend a much smaller visual angle than a monitor — pull the lens in
const camera = new THREE.PerspectiveCamera(IS_MOBILE ? 82 : 96, window.innerWidth / window.innerHeight, 0.05, 120);
scene.add(camera); // camera carries the flashlight + phone prop

const audio = new AudioMgr(camera);
audio.scene = scene;
const world = new World(scene);
const player = new Player(camera);
if (IS_MOBILE) player.zoomFov = 26; // small screen: the lens digs in deeper to read text
const terminal = new Terminal();
world.attachTerminal(terminal.texture);
const hud = new Hud();
const bodycam = new Bodycam(renderer, scene, camera);
const interact = new Interact(camera, hud);
const director = new Director({ scene, world, player, terminal, audio, hud, interact, bodycam });
const turbo = Number(new URLSearchParams(location.search).get('turbo'));
if (turbo > 0) director.timeScale = turbo;
window.__director = director; // debug handle

/* ---------- boot / loading ---------- */

const bootEl = document.getElementById('boot');
const goBtn = document.getElementById('gobtn');
let started = false;

audio.load(p => { goBtn.textContent = `LOADING AUDIO ${Math.round(p * 100)}%`; })
  .then(() => {
    bootEl.classList.remove('loading');
    goBtn.textContent = '▶ PLAY FOOTAGE';
  })
  .catch(err => {
    console.error(err);
    goBtn.textContent = 'AUDIO FAILED TO LOAD — serve over http://';
  });

let touch = null;

bootEl.addEventListener('click', async () => {
  if (started || bootEl.classList.contains('loading')) return;
  started = true;
  await audio.ctx().resume();
  bootEl.style.transition = 'opacity 1.5s';
  bootEl.style.opacity = 0;
  setTimeout(() => bootEl.remove(), 1600);
  if (IS_MOBILE) {
    touch = new TouchControls(player, director, interact);
    document.getElementById('paperclose').textContent = '[ACT] put it down';
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => { });
    }
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => { });
    }
  } else if (renderer.domElement.requestPointerLock) {
    renderer.domElement.requestPointerLock();
  }
  director.run().catch(e => {
    console.error(e);
    // the story script must never die holding the player's controls
    player.inputEnabled = true;
    interact.enabled = true;
  });
});

/* ---------- pause on pointer-lock loss ---------- */

const pauseEl = document.getElementById('pause');
let paused = false;
document.addEventListener('pointerlockchange', () => {
  if (!started || IS_MOBILE) return;
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && !director.phase.startsWith('end')) {
    paused = true;
    pauseEl.classList.add('on');
    audio.ctx().suspend();
  }
});
pauseEl.addEventListener('click', () => {
  pauseEl.classList.remove('on');
  paused = false;
  audio.ctx().resume();
  if (!IS_MOBILE && renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
});
// mobile: pause when the tab goes to background
document.addEventListener('visibilitychange', () => {
  if (!started || !IS_MOBILE) return;
  if (document.hidden) { paused = true; audio.ctx().suspend(); }
  else { paused = false; audio.ctx().resume(); }
});

/* ---------- input routing ---------- */

document.addEventListener('keydown', e => {
  if (!started || paused) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // newsletter form
  if (e.code === 'KeyE') { interact.trigger(); }
  if (e.code === 'KeyF' && player.flashAllowed && !director.typing) {
    player.setFlash(!player.flashOn);
    audio.play2D('key_click', { volume: 0.35, rate: 1.5 });
  }
  if (e.code === 'Space') e.preventDefault();
  director.onKey(e);
});

/* ---------- resize ---------- */

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  bodycam.setSize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio, PIXEL_CAP));
}
window.addEventListener('resize', onResize);
onResize();

/* ---------- footsteps ---------- */

player.onFootstep = () => {
  audio.play2D('footstep', { volume: 0.18 + Math.random() * 0.1, rate: 0.85 + Math.random() * 0.3 });
};

/* ---------- main loop ---------- */

const clock = new THREE.Clock();
let elapsed = 0;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (paused) return;
  elapsed += dt;

  player.update(dt);
  bodycam.zoom = player.zoom;
  world.update(dt, elapsed);
  terminal.update(dt);
  if (started) {
    director.update(dt);
    audio.update(dt);
    interact.update();
    if (touch) touch.update();
  }
  bodycam.update(dt, elapsed);
}
loop();
