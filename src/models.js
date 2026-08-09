// models.js — optional glTF/GLB model loading (e.g. Meshy exports).
// The game runs fully on its procedural rigs; if a model path is configured
// in COSMIC_CONFIG, it is loaded and swapped in, with graceful fallback.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

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
    this.object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.actions = {};
    this.current = null;
    // map logical states to clip names (configurable per model)
    this.clipMap = Object.assign({ idle: null, walk: null, run: null }, clips);

    for (const clip of gltf.animations || []) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    // if no explicit mapping, guess by common names
    const names = gltf.animations.map((c) => c.name.toLowerCase());
    const find = (kw) => gltf.animations.find((c) => c.name.toLowerCase().includes(kw));
    if (!this.clipMap.idle) this.clipMap.idle = (find('idle') || gltf.animations[0] || {}).name || null;
    if (!this.clipMap.walk) this.clipMap.walk = (find('walk') || {}).name || this.clipMap.idle;
    if (!this.clipMap.run) this.clipMap.run = (find('run') || {}).name || this.clipMap.walk;

    this.play('idle');
  }

  play(state) {
    const name = this.clipMap[state];
    if (!name || !this.actions[name] || this.current === name) return;
    const next = this.actions[name];
    if (this.current && this.actions[this.current]) {
      this.actions[this.current].fadeOut(0.2);
    }
    next.reset().fadeIn(0.2).play();
    this.current = name;
  }

  // drive from the controller each frame
  update(dt, { moving, sprinting } = {}) {
    if (moving) this.play(sprinting ? 'run' : 'walk');
    else this.play('idle');
    this.mixer.update(dt);
  }

  setYaw(y) { this.object.rotation.y = y; }
}
