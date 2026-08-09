// postfx.js — EffectComposer pipeline with a 1980s analog-horror grade.
// render -> bloom (halation) -> analog film pass -> output.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// The look: gate weave, chromatic bleed, halation, film grain, scanlines/VHS
// tracking, dust & scratches, a teal-amber split-tone grade with crushed
// blacks, and reality-glitch bursts — all driven by dread.
const AnalogShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDread: { value: 0 },       // 0..1
    uFlash: { value: 0 },       // damage flash 0..1
    uGlitch: { value: 0 },      // reality-tear burst 0..1
    uAberration: { value: 0.0012 },
    uVignette: { value: 1.18 },
    uGrain: { value: 0.05 },
    uPulse: { value: 0 },       // heartbeat lens breathing
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uDread, uFlash, uGlitch, uAberration, uVignette, uGrain, uPulse;
    uniform vec2 uResolution;

    float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
    float hash1(float x){ return fract(sin(x*127.1)*43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);
      float t = uTime;

      // --- gate weave: the whole frame jitters like a film projector ---
      vec2 weave = vec2(sin(t*7.3)*0.0006 + sin(t*2.1)*0.0004, cos(t*5.7)*0.0006);
      uv += weave;

      // --- VHS tracking: horizontal band that tears sideways, worse with dread/glitch ---
      float band = smoothstep(0.0, 0.06, abs(fract(uv.y*1.3 - t*0.15) - 0.5));
      float trackAmt = (0.002 + uDread*0.004 + uGlitch*0.03);
      float jump = (hash1(floor(t*12.0)) - 0.5);
      uv.x += (1.0 - band) * trackAmt * jump * 6.0;

      // --- reality tear: block displacement (Mouth of Madness) ---
      if (uGlitch > 0.001) {
        float blockY = floor(uv.y * 24.0);
        float g = hash1(blockY + floor(t*20.0));
        if (g > 1.0 - uGlitch*0.8) {
          uv.x += (hash1(blockY*3.1 + t) - 0.5) * 0.08 * uGlitch;
        }
      }

      // lens breathing with heartbeat + dread
      float warp = (uPulse*0.008 + uDread*0.005) * dist;
      uv -= center * warp;

      // --- chromatic bleed: RGB split toward edges, biased horizontal (analog) ---
      float ab = (uAberration + uDread*0.0025 + uGlitch*0.01) * (0.5 + dist*1.8);
      vec2 dir = normalize(center + 1e-5);
      vec2 hbias = vec2(1.4, 0.6);
      float r = texture2D(tDiffuse, uv - dir*ab*hbias).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv + dir*ab*hbias).b;
      vec3 col = vec3(r,g,b);

      // --- halation: bleed bright areas warm ---
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col += pow(max(lum-0.6,0.0),1.5) * vec3(0.9,0.55,0.3) * 0.5;

      // --- desaturate with dread, then teal-amber split-tone grade ---
      col = mix(col, vec3(lum), uDread*0.38);
      vec3 shadowTint = vec3(0.10,0.22,0.28);   // teal shadows
      vec3 highTint   = vec3(1.06,0.92,0.70);   // amber highlights
      col *= mix(shadowTint*2.0, highTint, smoothstep(0.0,0.8,lum));
      col = pow(max(col,0.0), vec3(1.10));       // contrast
      col = (col - 0.5) * 1.08 + 0.5;            // more contrast
      col = max(col, 0.0);
      // crush blacks
      col = max(col - 0.02, 0.0) * 1.02;

      // --- scanlines + interlace shimmer ---
      float scan = 0.94 + 0.06*sin(uv.y*uResolution.y*1.4 + t*2.0);
      col *= scan;
      col *= 0.985 + 0.015*sin(uv.y*uResolution.y*0.5 - t*10.0);

      // --- vignette ---
      float vig = smoothstep(0.92, uVignette, dist);
      col *= 1.0 - vig*(0.55 + uDread*0.28);
      col -= dist*dist*uDread*0.22;

      // --- film grain (animated) ---
      float gr = hash(uv*uResolution + fract(t)*vec2(37.0,17.0));
      col += (gr-0.5) * (uGrain + uDread*0.09);

      // --- dust specks + occasional vertical scratches ---
      float scWhen = hash1(floor(t*3.0));           // a scratch only some seconds
      if (scWhen > 0.62) {
        float scratchX = hash1(floor(t*3.0)+7.0);
        if (abs(uv.x - scratchX) < 0.0011) col += 0.18 * (scWhen);
      }
      float dust = hash(floor(uv*vec2(220.0,140.0)) + floor(t*18.0));
      if (dust > 0.9975) col += 0.45;

      // --- reality tear: brief colour inversion flashes ---
      if (uGlitch > 0.6 && hash1(floor(t*24.0)) > 0.5) col = 1.0 - col;

      // --- red damage flash ---
      col = mix(col, vec3(0.6,0.02,0.02), uFlash);

      gl_FragColor = vec4(max(col,0.0), 1.0);
    }
  `,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // bloom doubles as film halation
    this.bloom = new UnrealBloomPass(size.clone(), 0.85, 0.7, 0.68);
    this.composer.addPass(this.bloom);

    this.analog = new ShaderPass(AnalogShader);
    this.analog.uniforms.uResolution.value.copy(size);
    this.composer.addPass(this.analog);

    this.composer.addPass(new OutputPass());

    this._flash = 0;
    this._glitch = 0;
    this.setSize(size.x, size.y, renderer.getPixelRatio());
  }

  setCamera(camera) { this.composer.passes[0].camera = camera; }

  setSize(w, h, pr = 1) {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.analog.uniforms.uResolution.value.set(w * pr, h * pr);
    this.bloom.setSize(w, h);
  }

  triggerFlash(amount = 1) { this._flash = Math.min(1, this._flash + amount); }
  triggerGlitch(amount = 1) { this._glitch = Math.min(1, this._glitch + amount); }

  reset() {
    this._flash = 0;
    this._glitch = 0;
    this.analog.uniforms.uFlash.value = 0;
    this.analog.uniforms.uDread.value = 0;
    this.analog.uniforms.uGlitch.value = 0;
  }

  update(dt, { time, dread, pulse = 0 } = {}) {
    const u = this.analog.uniforms;
    u.uTime.value = time;
    u.uDread.value = dread;
    u.uPulse.value = pulse;
    u.uAberration.value = 0.0011 + dread * 0.0018;

    this._flash = Math.max(0, this._flash - dt * 2.2);
    u.uFlash.value = this._flash;

    // glitch decays fast; also random ambient micro-glitches at high dread
    this._glitch = Math.max(0, this._glitch - dt * 3.0);
    u.uGlitch.value = this._glitch;

    // halation/bloom breathes with dread
    this.bloom.strength = 0.7 + dread * 0.6;
  }

  render() { this.composer.render(); }
}
