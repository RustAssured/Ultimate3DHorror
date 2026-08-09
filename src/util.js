// util.js — math, seeded RNG, value noise / fbm. No dependencies.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;
export const rad = (d) => (d * Math.PI) / 180;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded RNG helper with convenience methods.
export class RNG {
  constructor(seed = 1337) {
    this.next = mulberry32(seed);
  }
  float(a = 0, b = 1) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.float(a, b + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  // point on a disc of given radius (uniform)
  disc(radius) {
    const r = radius * Math.sqrt(this.next());
    const a = this.next() * TAU;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }
}

// 2D value noise with smooth interpolation, tileable-ish via hashing.
export class ValueNoise {
  constructor(seed = 1) {
    const rng = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  _grad(ix, iy) {
    return this.perm[(ix + this.perm[iy & 255]) & 255] / 255;
  }
  noise2(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const u = smoothstep(fx), v = smoothstep(fy);
    const a = this._grad(ix, iy);
    const b = this._grad(ix + 1, iy);
    const c = this._grad(ix, iy + 1);
    const d = this._grad(ix + 1, iy + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1; // [-1,1]
  }
  fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lac;
    }
    return sum / norm; // [-1,1]
  }
}
