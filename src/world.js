// world.js — the environment: a fractured shard of the fallen station Erebus,
// adrift in the void, with the Sleeper watching from far below.
import * as THREE from 'three';
import { RNG, ValueNoise, clamp, TAU } from './util.js';

const ISLAND_RADIUS = 62;     // playable radius
const EDGE_SOFT = 10;         // falloff band before the void

export class World {
  constructor(scene, seed = 20260809) {
    this.scene = scene;
    this.rng = new RNG(seed);
    this.noise = new ValueNoise(seed);
    this.noise2 = new ValueNoise(seed ^ 0x9e3779b9);
    this.time = 0;
    this.drifters = [];
    this.landmarks = [];
    this.flickerLights = [];
    this.radius = ISLAND_RADIUS;

    this._buildSky(scene);
    this._buildFog(scene);
    this._buildLights(scene);
    this._buildTerrain(scene);
    this._buildMonoliths(scene);
    this._buildDebris(scene);
    this._buildSleeper(scene);
    this._buildParticles(scene);
  }

  // ---------- terrain height field (analytic, matches the mesh) ----------
  heightAt(x, z) {
    const n = this.noise.fbm(x * 0.03, z * 0.03, 4, 2.1, 0.55);
    const ridge = 1 - Math.abs(this.noise2.fbm(x * 0.018, z * 0.018, 3));
    let h = n * 3.2 + ridge * 2.4;
    // gentle bowl toward the centre so the player naturally reads the space
    const r = Math.hypot(x, z);
    h -= Math.max(0, (r - 20)) * 0.04;
    return h;
  }

  // fraction of solidity at (x,z): 1 solid, 0 void. Jagged edge.
  solidity(x, z) {
    const r = Math.hypot(x, z);
    const edgeNoise = this.noise2.fbm(x * 0.06, z * 0.06, 3) * (EDGE_SOFT * 0.9);
    const edge = ISLAND_RADIUS + edgeNoise;
    return clamp((edge - r) / EDGE_SOFT, 0, 1);
  }

  inBounds(x, z) {
    return this.solidity(x, z) > 0.35;
  }

  // ---------- builders ----------
  _buildSky(scene) {
    scene.background = new THREE.Color(0x05060a);
    // Star dome
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = this.rng.float(), v = this.rng.float();
      const theta = u * TAU;
      const phi = Math.acos(2 * v - 1);
      const R = 380;
      pos[i * 3] = R * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = R * Math.cos(phi) * 0.6 + 40; // bias upward
      pos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
      const c = this.rng.float(0.4, 1);
      const tint = this.rng.chance(0.2) ? [0.7, 0.8, 1] : [1, 0.95, 0.85];
      col[i * 3] = c * tint[0];
      col[i * 3 + 1] = c * tint[1];
      col[i * 3 + 2] = c * tint[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    this.stars = new THREE.Points(g, m);
    scene.add(this.stars);
  }

  _buildFog(scene) {
    // sickly teal-green haze — the Carpenter fog that hides everything
    scene.fog = new THREE.FogExp2(0x070c0d, 0.03);
    this.baseFog = 0.03;
  }

  _buildLights(scene) {
    // low, cold ambient (lux) — enough to read silhouettes; lantern does the rest
    this.ambient = new THREE.HemisphereLight(0x2c3f5e, 0x05070e, 1.5);
    scene.add(this.ambient);

    // cold key from "above the rift"
    this.moon = new THREE.DirectionalLight(0x5b7cb0, 1.6);
    this.moon.position.set(-30, 60, -20);
    scene.add(this.moon);

    // the Sleeper's glow from below (added near sleeper build)
  }

  _buildTerrain(scene) {
    const size = (ISLAND_RADIUS + EDGE_SOFT + 8) * 2;
    const seg = 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0x0a1018);
    const cHigh = new THREE.Color(0x263140);
    const cMoss = new THREE.Color(0x14312e);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const s = this.solidity(x, z);
      let y = this.heightAt(x, z);
      if (s <= 0) {
        // drop void verts far down and out so edges look torn
        y = -60 - this.noise.fbm(x * 0.1, z * 0.1) * 30;
      } else if (s < 1) {
        y -= (1 - s) * (18 + this.noise.fbm(x * 0.2, z * 0.2) * 10);
      }
      pos.setY(i, y);
      // vertex color by height + a little moss in crevices
      const t = clamp((y + 4) / 10, 0, 1);
      tmp.copy(cLow).lerp(cHigh, t);
      const moss = clamp(this.noise2.fbm(x * 0.08, z * 0.08, 2) * 0.5 + 0.3, 0, 1);
      tmp.lerp(cMoss, moss * 0.35 * s);
      tmp.multiplyScalar(0.6 + s * 0.4);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.05, flatShading: false,
    });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    scene.add(this.terrain);
  }

  _buildMonoliths(scene) {
    // broken alien pillars — landmarks with faint emissive veins
    const group = new THREE.Group();
    const count = 18;
    const veinColors = [0x2a6cff, 0x8a2be2, 0x1fd6c4];
    for (let i = 0; i < count; i++) {
      const p = this.rng.disc(ISLAND_RADIUS - 8);
      if (!this.inBounds(p.x, p.z)) continue;
      const h = this.rng.float(4, 13);
      const w = this.rng.float(1.2, 3.2);
      const geo = new THREE.BoxGeometry(w, h, w * this.rng.float(0.7, 1.2));
      // taper by shifting top verts inward
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        if (pos.getY(v) > 0) {
          pos.setX(v, pos.getX(v) * 0.55);
          pos.setZ(v, pos.getZ(v) * 0.55);
        }
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0x0c1017, roughness: 0.9, metalness: 0.2 });
      const m = new THREE.Mesh(geo, mat);
      const y = this.heightAt(p.x, p.z);
      m.position.set(p.x, y + h / 2 - 1, p.z);
      m.rotation.y = this.rng.float(0, TAU);
      m.rotation.z = this.rng.float(-0.12, 0.12);
      group.add(m);

      // glowing vein strip
      if (this.rng.chance(0.7)) {
        const vc = this.rng.pick(veinColors);
        const vgeo = new THREE.PlaneGeometry(0.25, h * 0.7);
        const vmat = new THREE.MeshBasicMaterial({ color: vc, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
        const vein = new THREE.Mesh(vgeo, vmat);
        vein.position.copy(m.position);
        vein.position.y = y + h * 0.4;
        vein.rotation.y = m.rotation.y + Math.PI / 2;
        vein.position.x += Math.cos(m.rotation.y) * (w * 0.28);
        vein.position.z += -Math.sin(m.rotation.y) * (w * 0.28);
        group.add(vein);
        this.landmarks.push({ mesh: vein, base: 0.85, color: vc });

        // a faint point light on a few of them so they read as beacons in the dark
        if (this.flickerLights.length < 5) {
          const pl = new THREE.PointLight(vc, 55, 20, 2.0);
          pl.position.copy(vein.position);
          pl.position.y += 1;
          scene.add(pl);
          this.flickerLights.push({ light: pl, base: 55, seed: this.rng.float(0, 10) });
        }
      }
    }
    scene.add(group);
    this.monoliths = group;
  }

  _buildDebris(scene) {
    // slowly drifting rocks/shards around the island
    const group = new THREE.Group();
    const geoPool = [
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.OctahedronGeometry(1, 0),
    ];
    const mat = new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.95, metalness: 0.1, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const a = this.rng.float(0, TAU);
      const r = this.rng.float(20, ISLAND_RADIUS + 30);
      const geo = this.rng.pick(geoPool);
      const m = new THREE.Mesh(geo, mat);
      const s = this.rng.float(0.5, 3);
      m.scale.setScalar(s);
      m.position.set(Math.cos(a) * r, this.rng.float(-14, 16), Math.sin(a) * r);
      m.rotation.set(this.rng.float(0, TAU), this.rng.float(0, TAU), this.rng.float(0, TAU));
      group.add(m);
      this.drifters.push({
        mesh: m,
        spin: new THREE.Vector3(this.rng.float(-0.2, 0.2), this.rng.float(-0.2, 0.2), this.rng.float(-0.2, 0.2)),
        bobAmp: this.rng.float(0.3, 1.4),
        bobSpeed: this.rng.float(0.2, 0.7),
        phase: this.rng.float(0, TAU),
        baseY: m.position.y,
        orbit: this.rng.float(-0.03, 0.03),
        angle: a, radius: r,
      });
    }
    scene.add(group);
    this.debris = group;
  }

  _buildSleeper(scene) {
    // A colossal presence far below — a dark mass with a slowly opening eye.
    const g = new THREE.Group();
    g.position.set(6, -78, -30);

    // body: dark deformed sphere
    const bodyGeo = new THREE.IcosahedronGeometry(46, 3);
    const bp = bodyGeo.attributes.position;
    const nz = new ValueNoise(9182);
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const len = Math.hypot(x, y, z);
      const d = nz.fbm(x * 0.04, z * 0.04 + y * 0.02, 4) * 8;
      const s = (len + d) / len;
      bp.setXYZ(i, x * s, y * s, z * s);
    }
    bodyGeo.computeVertexNormals();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x070a12, roughness: 1, metalness: 0, emissive: 0x0a0417, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    g.add(body);

    // eye: emissive sphere + iris, opens over time via a lid ring scale
    const eyeGeo = new THREE.SphereGeometry(11, 32, 32);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffcf6a });
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0, 8, 40);
    g.add(eye);
    const irisGeo = new THREE.SphereGeometry(5, 24, 24);
    const irisMat = new THREE.MeshBasicMaterial({ color: 0x1a0a00 });
    const iris = new THREE.Mesh(irisGeo, irisMat);
    iris.position.set(0, 8, 50);
    g.add(iris);

    // lids (two dark caps that retract as the eye opens)
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 1, side: THREE.DoubleSide });
    const lidTop = new THREE.Mesh(new THREE.SphereGeometry(11.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
    const lidBot = new THREE.Mesh(new THREE.SphereGeometry(11.6, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lidMat);
    lidTop.position.copy(eye.position);
    lidBot.position.copy(eye.position);
    g.add(lidTop, lidBot);

    // glow from the abyss
    const glow = new THREE.PointLight(0xffb347, 0, 260, 1.2);
    glow.position.set(0, 8, 55);
    g.add(glow);

    scene.add(g);
    this.sleeper = { group: g, eye, iris, glow, lidTop, lidBot, eyeMat, awakeness: 0 };
  }

  _buildParticles(scene) {
    // drifting motes / ash within the play space
    const N = 900;
    const pos = new Float32Array(N * 3);
    const seedv = [];
    for (let i = 0; i < N; i++) {
      const p = this.rng.disc(ISLAND_RADIUS + 6);
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = this.rng.float(0, 24);
      pos[i * 3 + 2] = p.z;
      seedv.push({ sp: this.rng.float(0.2, 0.8), ph: this.rng.float(0, TAU), amp: this.rng.float(0.2, 0.8) });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0x9fb6d6, size: 0.14, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.motes = new THREE.Points(g, m);
    this.motesSeed = seedv;
    scene.add(this.motes);
  }

  // ---------- runtime ----------
  // dread 0..1 gradually wakes the Sleeper and thickens the fog.
  update(dt, dread = 0) {
    this.time += dt;
    const t = this.time;

    // drifting debris
    for (const d of this.drifters) {
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      d.angle += d.orbit * dt;
      d.mesh.position.x = Math.cos(d.angle) * d.radius;
      d.mesh.position.z = Math.sin(d.angle) * d.radius;
      d.mesh.position.y = d.baseY + Math.sin(t * d.bobSpeed + d.phase) * d.bobAmp;
    }

    // flickering landmark lights
    for (const f of this.flickerLights) {
      const flick = 0.7 + Math.sin(t * 9 + f.seed) * 0.15 + Math.sin(t * 23 + f.seed * 2) * 0.1;
      f.light.intensity = f.base * flick;
    }
    for (const lm of this.landmarks) {
      lm.mesh.material.opacity = lm.base * (0.7 + Math.sin(t * 3 + lm.mesh.position.x) * 0.25);
    }

    // motes rise & swirl
    const p = this.motes.geometry.attributes.position;
    for (let i = 0; i < this.motesSeed.length; i++) {
      const s = this.motesSeed[i];
      let y = p.getY(i) + s.sp * dt * 0.6;
      if (y > 26) y = 0;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(t * s.sp + s.ph) * s.amp * dt);
    }
    p.needsUpdate = true;
    this.motes.rotation.y = t * 0.01;

    this.stars.rotation.y = t * 0.005;

    // The Sleeper wakes with dread
    const s = this.sleeper;
    s.awakeness += (dread - s.awakeness) * Math.min(1, dt * 0.6);
    const wake = s.awakeness;
    s.group.rotation.y = t * 0.02;
    s.group.position.y = -78 + Math.sin(t * 0.15) * 2 + wake * 10; // rises slightly
    s.glow.intensity = 40 + wake * 500 + Math.sin(t * 2) * 30 * wake;
    s.eyeMat.color.setHSL(0.09, 1, 0.35 + wake * 0.35);
    // lids retract as it wakes
    const open = 0.15 + wake * 0.85;
    s.lidTop.scale.y = 1 + open; s.lidTop.position.y = 8 + open * 9;
    s.lidBot.scale.y = 1 + open; s.lidBot.position.y = 8 - open * 9;
    s.iris.scale.setScalar(1 - wake * 0.3);

    // fog thickens subtly with dread
    if (this.scene.fog) this.scene.fog.density = this.baseFog + dread * 0.012;
  }

  // world-space position of the Sleeper's eye (for gaze mechanics)
  sleeperEyeWorld(target = new THREE.Vector3()) {
    return this.sleeper.eye.getWorldPosition(target);
  }
}
