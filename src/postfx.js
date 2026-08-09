// postfx.js — EffectComposer pipeline: render -> bloom -> dread grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// A single grade/distortion pass driven by "dread" and "flash".
const DreadShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDread: { value: 0 },       // 0..1
    uFlash: { value: 0 },       // red damage flash 0..1
    uVignette: { value: 1.2 },
    uAberration: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.03 },
    uPulse: { value: 0 },       // heartbeat pulse for a subtle breathing distortion
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime, uDread, uFlash, uVignette, uAberration, uGrain, uPulse;
    uniform vec2 uResolution;

    float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }

    void main(){
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);

      // subtle lens breathing with heartbeat pulse + dread
      float warp = (uPulse*0.006 + uDread*0.004) * dist;
      uv -= center * warp;

      // chromatic aberration grows toward edges and with dread/aberration
      float ab = (uAberration + uDread*0.0025) * (0.4 + dist*1.6);
      vec2 dir = normalize(center + 1e-5);
      float r = texture2D(tDiffuse, uv - dir*ab).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv + dir*ab).b;
      vec3 col = vec3(r,g,b);

      // color grade: cool shadows, slightly crushed, desaturate with dread
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, vec3(lum), uDread*0.35);
      col *= vec3(0.92, 0.97, 1.06);           // cool tint
      col = pow(max(col, 0.0), vec3(1.06));     // gentle contrast

      // vignette
      float vig = smoothstep(0.95, uVignette, dist);
      col *= 1.0 - vig*(0.55 + uDread*0.25);

      // film grain
      float gr = hash(uv*uResolution + fract(uTime)*vec2(37.0,17.0));
      col += (gr-0.5) * (uGrain + uDread*0.08);

      // pulsing dark edges when dread very high
      col -= dist*dist*uDread*0.25;

      // red damage flash
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

    this.bloom = new UnrealBloomPass(size.clone(), 0.7, 0.6, 0.72);
    this.composer.addPass(this.bloom);

    this.dreadPass = new ShaderPass(DreadShader);
    this.dreadPass.uniforms.uResolution.value.copy(size);
    this.composer.addPass(this.dreadPass);

    this.composer.addPass(new OutputPass());

    this._flash = 0;
    this.setSize(size.x, size.y, renderer.getPixelRatio());
  }

  setCamera(camera) {
    // update render pass camera if the scene camera changes
    this.composer.passes[0].camera = camera;
  }

  setSize(w, h, pr = 1) {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.dreadPass.uniforms.uResolution.value.set(w * pr, h * pr);
    this.bloom.setSize(w, h);
  }

  triggerFlash(amount = 1) {
    this._flash = Math.min(1, this._flash + amount);
  }

  reset() {
    this._flash = 0;
    this.dreadPass.uniforms.uFlash.value = 0;
    this.dreadPass.uniforms.uDread.value = 0;
  }

  update(dt, { time, dread, pulse = 0 } = {}) {
    const u = this.dreadPass.uniforms;
    u.uTime.value = time;
    u.uDread.value = dread;
    u.uPulse.value = pulse;
    // aberration eases with dread
    u.uAberration.value = 0.0009 + dread * 0.0016;
    // decay flash
    this._flash = Math.max(0, this._flash - dt * 2.2);
    u.uFlash.value = this._flash;
    // bloom strength breathes a little with dread
    this.bloom.strength = 0.6 + dread * 0.5;
  }

  render() {
    this.composer.render();
  }
}
