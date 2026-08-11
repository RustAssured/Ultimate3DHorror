// textures.js — procedural canvas-baked textures (grime, rust, fabric) used as
// roughness/bump maps to give surfaces material detail. No image files.
import * as THREE from 'three';
import { ValueNoise } from './util.js';

// Grayscale fbm noise baked to a tiling CanvasTexture.
export function noiseTexture({ size = 256, scale = 6, octaves = 5, contrast = 1, seed = 1, lo = 0.15, hi = 1.0 } = {}) {
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = new ValueNoise(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = n.fbm((x / size) * scale, (y / size) * scale, octaves) * 0.5 + 0.5;
      v = Math.pow(Math.max(0, v), contrast);
      v = lo + (hi - lo) * v;
      const c = Math.max(0, Math.min(255, Math.floor(v * 255)));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Streaky rust: vertical smears over noise.
export function rustTexture(seed = 7, size = 256) {
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = new ValueNoise(seed);
  const n2 = new ValueNoise(seed ^ 0x1234);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const base = n.fbm((x / size) * 5, (y / size) * 5, 4) * 0.5 + 0.5;
      const streak = n2.fbm((x / size) * 18, (y / size) * 2, 3) * 0.5 + 0.5; // vertical
      let v = base * 0.6 + streak * 0.5;
      v = Math.max(0, Math.min(1, v));
      const c = Math.floor((0.2 + v * 0.8) * 255);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// A shared library so we bake each texture only once.
let _lib = null;
export function textureLib() {
  if (_lib) return _lib;
  _lib = {
    grime: noiseTexture({ seed: 11, scale: 7, octaves: 5, contrast: 1.3, lo: 0.25 }),
    grimeFine: noiseTexture({ seed: 23, scale: 22, octaves: 4, contrast: 1.1, lo: 0.35 }),
    rust: rustTexture(7),
    fabric: noiseTexture({ seed: 41, scale: 40, octaves: 3, contrast: 1.0, lo: 0.4, hi: 0.9 }),
  };
  return _lib;
}
