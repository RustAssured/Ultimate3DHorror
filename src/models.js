// models.js — optional glTF/GLB model loading (e.g. Meshy exports).
// The game runs fully on its procedural rigs; if a model path is configured
// in COSMIC_CONFIG, it is loaded and swapped in, with graceful fallback.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

// Compact 3D noise for the living-skin shader patch.
const NOISE3 = `
float h31(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn3(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0; }
float fb3(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vn3(p); p*=2.03; a*=0.5;} return s; }
`;

// Patch a loaded (baked) material so it BREATHES, glistens wet, throbs veins,
// and grows grosser/infected with `menace` — all on top of the existing PBR
// maps. Returns a uniforms object to drive per-frame.
export function patchLivingFlesh(material, opts = {}) {
  const u = {
    uTime: { value: 0 }, uMenace: { value: 0.5 }, uMat: { value: 1 },
    uWet: { value: opts.wet ?? 1 }, uGross: { value: opts.gross ?? 1 },
    uDark: { value: opts.dark ?? 1 },   // overall albedo scale (dim it in-game)
    uVein: { value: new THREE.Color(opts.vein || 0x4a0006) },
  };
  material.transparent = true;
  material.userData.living = u;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = `uniform float uTime,uMenace; varying vec3 vLp;\n${NOISE3}\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vLp = position;
      float breathe = sin(uTime*1.6)*0.02 + sin(uTime*0.73+2.0)*0.012;
      float writhe = fb3(position*2.0 + vec3(0.0,0.0,uTime*0.25)) * 0.02 * (0.4 + uMenace);
      transformed += normal * (breathe + writhe);
    `);
    shader.fragmentShader = `uniform float uTime,uMenace,uMat,uWet,uGross,uDark; uniform vec3 uVein; varying vec3 vLp;\n${NOISE3}\n` + shader.fragmentShader;
    // wet glisten: lower roughness in slowly-moving wet zones
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      float wet = smoothstep(0.15, 0.65, fb3(vLp*3.0 + vec3(0.0,uTime*0.3,0.0)));
      roughnessFactor = mix(roughnessFactor, 0.10, wet * uWet * (0.4 + uMenace*0.6));
    `);
    // grime / infection darkening + blood push + materialize alpha
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float grime = smoothstep(0.0, 0.6, fb3(vLp*5.0 + 3.0));
      diffuseColor.rgb *= mix(1.0, 0.62, grime * uGross * uMenace);
      float blood = smoothstep(0.45, 0.9, fb3(vLp*8.0 + 1.0));
      diffuseColor.rgb += uVein * blood * uGross * (0.2 + uMenace*0.8);
      diffuseColor.rgb *= uDark;
      diffuseColor.a *= uMat;
    `);
    // subsurface backscatter rim + throbbing vein glow
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)),0.0,1.0), 3.0);
      float throb = 0.5 + 0.5*sin(uTime*3.0 + fb3(vLp*5.0)*10.0);
      totalEmissiveRadiance += vec3(0.5,0.03,0.06) * fres * (0.08 + uMenace*0.35) * throb * uMat;
    `);
  };
  material.needsUpdate = true;
  return u;
}

// Load a .glb / .gltf. Resolves to the gltf object { scene, animations, ... }.
export function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

// Center a model on the ground and scale it to a target height (metres).
// Returns { root, size } — root is an Object3D you can add to the scene.
export function normalizeToHeight(object3d, targetHeight = 1.9) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = size.y > 1e-4 ? targetHeight / size.y : 1;
  object3d.scale.setScalar(scale);
  // recompute and drop feet to y=0, centre on x/z
  const box2 = new THREE.Box3().setFromObject(object3d);
  const min = box2.min, max = box2.max;
  object3d.position.x -= (min.x + max.x) / 2;
  object3d.position.z -= (min.z + max.z) / 2;
  object3d.position.y -= min.y;
  const root = new THREE.Group();
  root.add(object3d);
  return { root, size };
}

// Wrap a loaded character gltf so the existing controller can drive it:
// position, yaw, and an animation state machine (idle / walk / run).
export class CharacterModel {
  constructor(gltf, { targetHeight = 1.9, clips = {} } = {}) {
    const { root } = normalizeToHeight(gltf.scene, targetHeight);
    this.object = root;                 // add this to the scene / player rig
    // skinned-mesh shadow casting is very expensive on CPU renderers; skip it
    this.object.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });

    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.actions = {};
    this.current = null;
    // map logical states to clip names (configurable per model)
    this.clipMap = Object.assign({ idle: null, walk: null, run: null }, clips);

    for (const clip of gltf.animations || []) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    // if no explicit mapping, guess by common names
    const find = (kw) => gltf.animations.find((c) => c.name.toLowerCase().includes(kw));
    this.hasIdle = !!find('idle');
    if (!this.clipMap.idle) this.clipMap.idle = (find('idle') || gltf.animations[0] || {}).name || null;
    if (!this.clipMap.walk) this.clipMap.walk = (find('walk') || find('run') || gltf.animations[0] || {}).name || this.clipMap.idle;
    if (!this.clipMap.run) this.clipMap.run = (find('run') || {}).name || this.clipMap.walk;

    this.play(this.hasIdle ? 'idle' : 'walk');
  }

  play(state) {
    const name = this.clipMap[state];
    if (!name || !this.actions[name] || this.current === name) return;
    const next = this.actions[name];
    if (this.current && this.actions[this.current]) this.actions[this.current].fadeOut(0.2);
    next.reset().fadeIn(0.2).play();
    this.current = name;
  }

  // drive from the controller each frame
  update(dt, { moving, sprinting } = {}) {
    if (moving) {
      this.play(sprinting ? 'run' : 'walk');
      const a = this.actions[this.current];
      if (a) { a.paused = false; a.timeScale = sprinting ? 1.5 : 1.0; }
    } else if (this.hasIdle) {
      this.play('idle');
    } else {
      // single-clip model (e.g. only a walk cycle): freeze it when standing still
      this.play('walk');
      const a = this.actions[this.current];
      if (a) a.paused = true;
    }
    this.mixer.update(dt);
  }

  setYaw(y) { this.object.rotation.y = y; }
}
