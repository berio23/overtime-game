import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const BodycamShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.10 },
    uCA: { value: 0.012 },
    uVig: { value: 1.15 },
    uDist: { value: 0.16 },
    uGlitch: { value: 0 },
    uExposure: { value: 1.0 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uCA, uVig, uDist, uGlitch, uExposure;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
    void main(){
      vec2 uv = vUv;
      // digital tear rows when the AI leans on the signal
      if(uGlitch > 0.001){
        float row = floor(uv.y*36.0);
        float n = hash(vec2(row, floor(uTime*14.0)));
        if(n < uGlitch*0.55) uv.x = fract(uv.x + (hash(vec2(row, 7.0))-0.5)*0.2*uGlitch);
      }
      // wide-lens barrel distortion
      vec2 c = uv - 0.5;
      float r2 = dot(c,c);
      vec2 duv = 0.5 + c*(1.0 + uDist*r2 + uDist*0.55*r2*r2);
      if(duv.x<0.0||duv.x>1.0||duv.y<0.0||duv.y>1.0){ gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
      vec2 dir = duv - 0.5;
      float ca = uCA*(0.4 + r2*2.4);
      vec3 col;
      col.r = texture2D(tDiffuse, duv + dir*ca).r;
      col.g = texture2D(tDiffuse, duv).g;
      col.b = texture2D(tDiffuse, duv - dir*ca).b;
      col *= uExposure;
      // cheap-sensor look: lifted blacks, mild desat
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, vec3(lum), 0.13);
      col = col*0.95 + 0.012;
      // grain, heavier in shadow
      float g = hash(vUv*vec2(1923.0,1087.0) + fract(uTime)*vec2(13.7,91.3)) - 0.5;
      col += g * uGrain * (0.35 + 1.0*(1.0 - clamp(lum*2.4, 0.0, 1.0)));
      // vignette
      col *= smoothstep(0.92, 0.30, length(c)*uVig);
      if(uGlitch > 0.15){
        float q = 9.0 - uGlitch*5.0;
        col = floor(col*q)/q;
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `
};

export class Bodycam {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(BodycamShader);
    this.composer.addPass(this.pass);
    this.glitch = 0;            // target glitch amount, decays
    this.exposureKick = 0;      // brief auto-exposure pumps
    this.baseGrain = 0.10;
    this.zoom = 0;              // mirrored from player each frame
    this.zoomEl = document.getElementById('zoomind');

    this.tsEl = document.getElementById('ts');
    this.hudEl = document.getElementById('hud');
    this.t0 = new Date('2026-06-11T23:47:02');
    this.elapsed = 0;
    this.tsMode = 'normal';     // 'normal' | 'corrupt' | 'dead'
  }

  setSize(w, h, pr) {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(pr);
  }

  kickGlitch(amount = 0.6) { this.glitch = Math.max(this.glitch, amount); }
  kickExposure(amount = 0.35) { this.exposureKick = Math.max(this.exposureKick, amount); }

  update(dt, t) {
    this.elapsed += dt;
    const u = this.pass.uniforms;
    u.uTime.value = t;
    this.glitch = Math.max(0, this.glitch - dt * 0.9);
    u.uGlitch.value = this.glitch;
    this.exposureKick = Math.max(0, this.exposureKick - dt * 0.8);
    u.uExposure.value = 1.0 + this.exposureKick + Math.sin(t * 0.7) * 0.02;
    u.uGrain.value = this.baseGrain * (1 + this.zoom * 0.5); // digital zoom amplifies noise
    u.uDist.value = 0.16 * (1 - this.zoom * 0.8);            // crop flattens the lens
    u.uCA.value = 0.012 * (1 - this.zoom * 0.6);
    if (this.zoomEl) {
      const mag = Math.tan(THREE.MathUtils.degToRad(96 / 2)) /
        Math.tan(THREE.MathUtils.degToRad((96 - 60 * this.zoom) / 2));
      this.zoomEl.style.opacity = this.zoom > 0.04 ? 0.9 : 0;
      this.zoomEl.textContent = `ZOOM ${mag.toFixed(1)}×`;
    }

    // timestamp
    if (Math.floor(t * 4) % 2 === 0) {
      if (this.tsMode === 'normal') {
        const d = new Date(this.t0.getTime() + this.elapsed * 1000 * 18); // night moves fast on camera
        const p = n => String(n).padStart(2, '0');
        this.tsEl.firstChild.textContent =
          `2026-06-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      } else if (this.tsMode === 'corrupt') {
        const junk = () => '0123456789?#≠§'[Math.floor(Math.random() * 14)];
        this.tsEl.firstChild.textContent =
          `2026-06-1${junk()} ${junk()}${junk()}:${junk()}${junk()}:${junk()}${junk()}`;
      }
    }
    this.hudEl.classList.toggle('glitch', this.glitch > 0.25);
    this.composer.render();
  }
}
