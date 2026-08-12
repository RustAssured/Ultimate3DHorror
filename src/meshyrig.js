// meshyrig.js — attach a procedural rig (socket tentacles + a living eye) onto a
// loaded Meshy body. Anchors are in the body-root local space and tunable.
import * as THREE from 'three';
import { clamp, damp, TAU } from './util.js';

// Default anchors for monster2.glb (root-local space: x[-1.5,1.5] y[0,3.4] z[-1.5,1.5],
// face toward +Z). Tuned visually in the Lab.
export const MONSTER2_RIG = {
  eye: { pos: [0.30, 2.18, 1.02], dir: [0.12, 0.05, 1], size: 0.29 },
  sockets: [
    { pos: [-1.05, 0.75, 0.85], dir: [-0.5, -0.55, 0.7] },
    { pos: [-0.55, 0.58, 1.15], dir: [-0.2, -0.7, 0.7] },
    { pos: [0.0, 0.52, 1.25], dir: [0.0, -0.75, 0.66] },
    { pos: [0.55, 0.58, 1.15], dir: [0.2, -0.7, 0.7] },
    { pos: [1.05, 0.75, 0.85], dir: [0.5, -0.55, 0.7] },
  ],
  tentacleLen: 3.0,
  tentacleR: 0.17,
};

// Detect open boundary loops (holes) in a mesh, in root-local space.
// Returns [{ c:Vector3, dir:Vector3(outward), r:number, n:count }] sorted big->small.
export function detectHoles(mesh, root) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index ? g.index.array : null;
  const nTri = idx ? idx.length / 3 : pos.count / 3;
  // weld by quantized position (GLTF splits verts at UV seams)
  const key = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  const remap = new Int32Array(pos.count);
  const welded = []; const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), k = key(x, y, z);
    let w = map.get(k); if (w === undefined) { w = welded.length; map.set(k, w); welded.push([x, y, z]); }
    remap[i] = w;
  }
  const tri = (t) => idx ? [remap[idx[t * 3]], remap[idx[t * 3 + 1]], remap[idx[t * 3 + 2]]] : [remap[t * 3], remap[t * 3 + 1], remap[t * 3 + 2]];
  const ec = new Map(); const ek = (a, b) => a < b ? a + '_' + b : b + '_' + a;
  for (let t = 0; t < nTri; t++) { const [a, b, c] = tri(t); for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = ek(x, y); ec.set(k, (ec.get(k) || 0) + 1); } }
  const adj = new Map();
  for (const [k, c] of ec) if (c === 1) { const [a, b] = k.split('_').map(Number); (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); }
  const seen = new Set(); const holes = [];
  const tmp = new THREE.Vector3();
  const toLocal = (p) => { tmp.set(p[0], p[1], p[2]); mesh.localToWorld(tmp); root.worldToLocal(tmp); return tmp.clone(); };
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const stack = [start], comp = [];
    while (stack.length) { const v = stack.pop(); if (seen.has(v)) continue; seen.add(v); comp.push(v); for (const nb of adj.get(v) || []) if (!seen.has(nb)) stack.push(nb); }
    if (comp.length < 5) continue;
    const pts = comp.map((w) => toLocal(welded[w]));
    const cen = pts.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    let r = 0; for (const v of pts) r = Math.max(r, v.distanceTo(cen));
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y); }
    const nrm = new THREE.Vector3(nx, ny, nz).normalize();
    if (nrm.dot(new THREE.Vector3(cen.x, cen.y - 1.7, cen.z)) < 0) nrm.negate(); // outward
    holes.push({ c: cen, dir: nrm, r, n: comp.length });
  }
  return holes.filter((h) => h.r > 0.08).sort((a, b) => b.r - a.r);
}

export class MeshyRig {
  constructor(parent, config, opts = {}) {
    this.parent = parent;          // the meshy body root group (local space)
    this.config = config;
    this.menace = 0.5; this.materialize = 1; this._t = 0;
    this._lookTarget = new THREE.Vector3(0, 2, 8);
    this.tentacles = []; this.debug = [];
    this._fleshMat = this._makeFlesh();

    // auto-detect sockets from real holes in the mesh (marker-free, exact)
    if (opts.auto) {
      let mesh = null; parent.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (mesh) {
        const holes = detectHoles(mesh, parent);
        if (holes.length) {
          // eye = the highest large hole that faces forward; sockets = the rest
          const eyeCand = holes.filter((h) => h.c.y > 1.4 && h.dir.z > 0.2).sort((a, b) => b.c.y - a.c.y)[0] || holes[0];
          const sockets = holes.filter((h) => h !== eyeCand && h.r > 0.09).slice(0, 10);
          this.config = {
            eye: { pos: [eyeCand.c.x, eyeCand.c.y, eyeCand.c.z], dir: [eyeCand.dir.x, eyeCand.dir.y, eyeCand.dir.z], size: Math.max(0.16, eyeCand.r * 0.92) },
            sockets: sockets.map((h) => ({ pos: [h.c.x, h.c.y, h.c.z], dir: [h.dir.x, h.dir.y, h.dir.z], r: h.r })),
            tentacleLen: config.tentacleLen || 2.8,
          };
        }
      }
    }

    this._buildTentacles();
    this._buildEye();
    if (opts.debug) this._buildDebug();
  }

  _makeFlesh() {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x3a0810, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.4,
      sheen: 0.3, sheenColor: new THREE.Color(0xd0506f), transparent: true, side: THREE.DoubleSide,
    });
    return m;
  }

  _buildTentacles() {
    const NODES = 8, RINGS = 12, RADIAL = 8;
    for (const sock of this.config.sockets) {
      const outDir = new THREE.Vector3(...sock.dir).normalize();
      // base radius matched to the hole so the tentacle flows out of it;
      // recess the root slightly inside so it emerges rather than clips the rim
      const baseR = sock.r ? Math.max(0.08, sock.r * 0.95) : (this.config.tentacleR || 0.16);
      const origin = new THREE.Vector3(...sock.pos).addScaledVector(outDir, -baseR * 0.6);
      const len = this.config.tentacleLen * (0.85 + baseR);
      const nodes = [];
      for (let n = 0; n < NODES; n++) {
        const p = origin.clone().addScaledVector(outDir, (n / (NODES - 1)) * len);
        nodes.push({ pos: p.clone(), prev: p.clone(), rest: p.clone() });
      }
      const geo = new THREE.BufferGeometry();
      const verts = (RINGS + 1) * RADIAL;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
      const idx = [];
      for (let r = 0; r < RINGS; r++) for (let s = 0; s < RADIAL; s++) {
        const a0 = r * RADIAL + s, a1 = r * RADIAL + (s + 1) % RADIAL;
        const b0 = (r + 1) * RADIAL + s, b1 = (r + 1) * RADIAL + (s + 1) % RADIAL;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, this._fleshMat);
      mesh.castShadow = true; mesh.frustumCulled = false;
      this.parent.add(mesh);
      this.tentacles.push({ nodes, mesh, geo, origin, outDir, len, phase: Math.random() * TAU, side: new THREE.Vector3(), RINGS, RADIAL, NODES, baseR });
    }
  }

  _buildEye() {
    const e = this.config.eye;
    const g = new THREE.Group();
    g.position.set(...e.pos);
    const dir = new THREE.Vector3(...e.dir).normalize();
    g.lookAt(g.position.clone().add(dir));
    const size = e.size;
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(size, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xd9c4a8, roughness: 0.35 }));
    g.add(sclera);
    const irisMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uCol: { value: new THREE.Color(0x7a1010) }, uMat: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: `varying vec2 vUv; uniform vec3 uCol; uniform float uMat;
        void main(){ vec2 c=vUv-0.5; float r=length(c)*2.0; float ang=atan(c.y,c.x);
          float fib=0.5+0.5*sin(ang*26.0+r*7.0); vec3 col=mix(uCol*0.25,uCol,fib)*smoothstep(0.95,0.5,r);
          col=mix(col,vec3(0.0),smoothstep(0.36,0.30,r)); gl_FragColor=vec4(col, smoothstep(0.98,0.5,r)*uMat);} `,
    });
    const iris = new THREE.Mesh(new THREE.CircleGeometry(size * 0.7, 28), irisMat);
    iris.position.z = size * 0.72; g.add(iris);
    const cornea = new THREE.Mesh(new THREE.SphereGeometry(size * 0.95, 18, 14, 0, TAU, 0, Math.PI * 0.55),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.16 }));
    cornea.rotation.x = -Math.PI / 2; cornea.position.z = size * 0.5; g.add(cornea);
    this.parent.add(g);
    this.eye = { group: g, iris, irisMat, base: g.position.clone(), look: dir.clone(), saccade: 1.2, blink: 2.5 };
  }

  _buildDebug() {
    const mk = (p, c, r = 0.14) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), new THREE.MeshBasicMaterial({ color: c })); m.position.set(...p); m.renderOrder = 999; m.material.depthTest = false; this.parent.add(m); this.debug.push(m); };
    for (const s of this.config.sockets) mk(s.pos, 0x00ff88);
    mk(this.config.eye.pos, 0x00aaff, 0.1);
  }

  update(dt, { menace = 0.5, materialize = 1, lookTarget = null } = {}) {
    this._t += dt; this.menace = menace; this.materialize = materialize;
    if (lookTarget) this._lookTarget.copy(lookTarget);
    this._fleshMat.opacity = materialize;
    for (const T of this.tentacles) this._updateTentacle(T, dt);
    this._updateEye(dt);
  }

  _updateTentacle(T, dt) {
    const { nodes, origin, outDir, len, NODES } = T;
    const up = new THREE.Vector3(0, 1, 0);
    const side = T.side.copy(outDir).cross(up).normalize();
    for (let n = 0; n < NODES; n++) {
      const f = n / (NODES - 1);
      const wave = Math.sin(this._t * 2.4 + T.phase + f * 4.0);
      const curl = 0.4 + this.menace * 0.8;
      nodes[n].rest.copy(origin)
        .addScaledVector(outDir, f * len)
        .addScaledVector(side, wave * curl * f * 1.1)
        .addScaledVector(up, -f * f * (0.7 + this.menace * 0.5) + Math.sin(this._t * 3 + f * 6) * 0.12 * f);
    }
    nodes[0].pos.copy(nodes[0].rest);
    for (let n = 1; n < NODES; n++) {
      const nd = nodes[n];
      const vel = nd.pos.clone().sub(nd.prev).multiplyScalar(0.85);
      nd.prev.copy(nd.pos); nd.pos.add(vel);
      nd.pos.lerp(nd.rest, clamp(12 * (1 - (n / (NODES - 1)) * 0.45) * dt, 0, 1));
    }
    this._rebuildTube(T);
  }

  _rebuildTube(T) {
    const { geo, RINGS, RADIAL } = T;
    const curve = new THREE.CatmullRomCurve3(T.nodes.map((n) => n.pos));
    const pos = geo.attributes.position.array, nrm = geo.attributes.normal.array;
    const up = new THREE.Vector3(0, 1, 0);
    let ptr = 0;
    for (let r = 0; r <= RINGS; r++) {
      const tt = r / RINGS;
      const center = curve.getPoint(tt), tan = curve.getTangent(tt).normalize();
      const nx = new THREE.Vector3().crossVectors(tan, up); if (nx.lengthSq() < 1e-4) nx.set(1, 0, 0); nx.normalize();
      const ny = new THREE.Vector3().crossVectors(tan, nx).normalize();
      const radius = T.baseR * (1 - tt * 0.85) + 0.02;
      for (let s = 0; s < RADIAL; s++) {
        const ang = (s / RADIAL) * TAU;
        const d = nx.clone().multiplyScalar(Math.cos(ang)).addScaledVector(ny, Math.sin(ang));
        pos[ptr] = center.x + d.x * radius; pos[ptr + 1] = center.y + d.y * radius; pos[ptr + 2] = center.z + d.z * radius;
        nrm[ptr] = d.x; nrm[ptr + 1] = d.y; nrm[ptr + 2] = d.z; ptr += 3;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; geo.computeBoundingSphere();
  }

  _updateEye(dt) {
    const e = this.eye;
    e.irisMat.uniforms.uMat.value = this.materialize;
    e.blink -= dt; let by = 1;
    if (e.blink < 0) { if (e.blink < -0.12) e.blink = 2 + Math.random() * 5; else by = 0.15; }
    e.group.scale.y = by;
    e.saccade -= dt;
    if (e.saccade < 0) {
      e.saccade = 0.5 + Math.random() * 2.2;
      const local = this.parent.worldToLocal(this._lookTarget.clone());
      e.look.copy(local).sub(e.base).normalize()
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.25, 0)).normalize();
    }
    const tgt = e.base.clone().add(e.look);
    const cur = new THREE.Vector3(0, 0, 1).applyQuaternion(e.group.quaternion).add(e.base);
    cur.lerp(tgt, clamp(dt * 6, 0, 1));
    e.group.lookAt(cur);
  }

  setVisible(v) { for (const t of this.tentacles) t.mesh.visible = v; if (this.eye) this.eye.group.visible = v; for (const d of this.debug) d.visible = v; }
}
