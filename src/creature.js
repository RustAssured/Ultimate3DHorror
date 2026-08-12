// creature.js — the Stalker (v2). A procedurally-grown organism rendered with
// physically-based, lit flesh: one continuous body (implicit bulges/craters),
// tapered tentacle tubes with secondary motion, real layered eyes, a mouth
// that is a cavity, and multi-scale wet-skin shading. No external assets.
import * as THREE from 'three';
import { RNG, clamp, damp, TAU } from './util.js';
import { loadGLTF, normalizeToHeight, patchLivingFlesh } from './models.js';
import { MeshyRig, MONSTER2_RIG } from './meshyrig.js';

const STATE = { DORMANT: 0, STALK: 1, HUNT: 2, REPELLED: 3 };

// shared GLSL: cheap 3D value noise + fbm
const NOISE3 = `
float hash31(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  float n000=hash31(i+vec3(0.,0.,0.)), n100=hash31(i+vec3(1.,0.,0.));
  float n010=hash31(i+vec3(0.,1.,0.)), n110=hash31(i+vec3(1.,1.,0.));
  float n001=hash31(i+vec3(0.,0.,1.)), n101=hash31(i+vec3(1.,0.,1.));
  float n011=hash31(i+vec3(0.,1.,1.)), n111=hash31(i+vec3(1.,1.,1.));
  return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y),
             mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z)*2.0-1.0;
}
float fbm3(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5;} return s; }
`;

export class Stalker {
  constructor(scene) {
    this.scene = scene;
    this.rng = new RNG(90210);
    this.group = new THREE.Group();
    this.pos = new THREE.Vector3(0, -50, 0);
    this.state = STATE.DORMANT;
    this.menace = 0;
    this.materialize = 0;
    this.active = false;
    this.catchDist = 1.9;
    this._t = 0;
    this.tentacles = [];
    this.eyes = [];
    this._lookTarget = new THREE.Vector3(0, 2, 5);
    this._build();
    scene.add(this.group);
    this.group.visible = false;

    // optional: use a loaded Meshy body (+ rig) as the creature instead of the
    // procedural organism. Configured via window.COSMIC_CONFIG.stalkerModel.
    this.usingMeshy = false; this._meshyMats = []; this._livingU = [];
    const mp = (typeof window !== 'undefined' && window.COSMIC_CONFIG && window.COSMIC_CONFIG.stalkerModel);
    if (mp) this._loadMeshy(mp);
  }

  async _loadMeshy(path) {
    try {
      const gltf = await loadGLTF(path);
      const { root } = normalizeToHeight(gltf.scene, 3.4);
      root.position.y = 0; // stand on the ground
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.frustumCulled = false;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { m.transparent = true; this._meshyMats.push(m); this._livingU.push(patchLivingFlesh(m)); });
        }
      });
      // dim the bright bake so it reads as a dark creature revealed by the lantern
      this._livingU.forEach((u) => { u.uDark.value = 0.5; });
      this.group.add(root);
      this.meshyBody = root;
      this.meshyRig = new MeshyRig(root, MONSTER2_RIG);
      // hide the procedural organism
      this.body.visible = false;
      if (this.mouth) this.mouth.visible = false;
      for (const e of this.eyes) e.group.visible = false;
      for (const t of this.tentacles) t.mesh.visible = false;
      this.usingMeshy = true;
    } catch (e) {
      console.warn('Stalker model failed to load, using procedural creature:', e.message);
    }
  }

  // ---- physically-based wet-flesh material (patched MeshPhysicalMaterial) ----
  _makeFlesh() {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x2c0812, roughness: 0.62, metalness: 0.0,
      clearcoat: 0.45, clearcoatRoughness: 0.55,
      sheen: 0.3, sheenColor: new THREE.Color(0xd45f7f), sheenRoughness: 0.6,
      transparent: true, side: THREE.DoubleSide,
    });
    const u = {
      uTime: { value: 0 }, uMenace: { value: 0 }, uMat: { value: 1 },
      uRim: { value: new THREE.Color(0xff2f7a) }, uDeep: { value: new THREE.Color(0x1c0208) },
    };
    mat.userData.u = u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = `uniform float uTime,uMenace; varying vec3 vObj;\n${NOISE3}\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vObj = position;
        float d = fbm3(position*1.3 + vec3(0.0,0.0,uTime*0.25)) * (0.09 + uMenace*0.16);
        d += fbm3(position*3.7 + 11.0) * 0.035;
        transformed += normal * d;
      `);
      // recompute a perturbed normal for lighting from the noise gradient
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        float e=0.15;
        float nx=fbm3((position+vec3(e,0.,0.))*2.0)-fbm3((position-vec3(e,0.,0.))*2.0);
        float ny=fbm3((position+vec3(0.,e,0.))*2.0)-fbm3((position-vec3(0.,e,0.))*2.0);
        float nz=fbm3((position+vec3(0.,0.,e))*2.0)-fbm3((position-vec3(0.,0.,e))*2.0);
        objectNormal = normalize(objectNormal - vec3(nx,ny,nz)*0.4*(0.5+uMenace));
      `);
      shader.fragmentShader = `uniform float uTime,uMenace,uMat; uniform vec3 uRim,uDeep; varying vec3 vObj;\n${NOISE3}\n` + shader.fragmentShader;
      // wet/dry roughness zones
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        float wet = fbm3(vObj*2.2 + vec3(0.0,0.0,uTime*0.15));
        roughnessFactor = mix(0.12, 0.72, smoothstep(-0.25,0.35,wet));
      `);
      // blood-deep tint + veins + fake AO in crevices + materialize alpha
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float veins = fbm3(vObj*5.0 + 3.0);
        float ao = smoothstep(-0.35, 0.35, fbm3(vObj*1.6));
        diffuseColor.rgb = mix(uDeep, diffuseColor.rgb, 0.45 + 0.55*veins);
        diffuseColor.rgb *= 0.5 + 0.5*ao;
        diffuseColor.a *= uMat;
      `);
      // subsurface backscatter rim (view-dependent) added to emissive
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)),0.0,1.0), 3.0);
        totalEmissiveRadiance += uRim * fres * (0.08 + uMenace*0.22) * uMat;
      `);
    };
    if (!this._fleshMats) this._fleshMats = [];
    this._fleshMats.push(mat);
    return mat;
  }

  _setFleshUniform(name, value) {
    for (const m of this._fleshMats) if (m.userData.u[name]) m.userData.u[name].value = value;
  }

  _build() {
    this.flesh = this._makeFlesh();

    // ---------- continuous body: icosphere sculpted with bulges + craters ----------
    const geo = new THREE.IcosahedronGeometry(1, 6);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    // anatomy: outward bulges (muscle sacs) and inward craters (eye sockets, mouth)
    const bulges = [];
    for (let i = 0; i < 9; i++) {
      bulges.push({ dir: new THREE.Vector3(this.rng.float(-1, 1), this.rng.float(-0.6, 1), this.rng.float(-1, 1)).normalize(), amp: this.rng.float(0.15, 0.4), sp: this.rng.float(0.5, 1.3) });
    }
    const craters = [
      { dir: new THREE.Vector3(0, 0.1, 1).normalize(), amp: 0.5, sp: 3.0 },   // mouth
      { dir: new THREE.Vector3(0.4, 0.5, 0.8).normalize(), amp: 0.22, sp: 5 },
      { dir: new THREE.Vector3(-0.4, 0.6, 0.7).normalize(), amp: 0.22, sp: 5 },
    ];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const dir = v.clone().normalize();
      let r = 1;
      for (const b of bulges) { const d = dir.dot(b.dir); if (d > 0) r += b.amp * Math.pow(d, b.sp); }
      for (const c of craters) { const d = dir.dot(c.dir); if (d > 0) r -= c.amp * Math.pow(d, c.sp); }
      v.copy(dir).multiplyScalar(r);
      v.y *= 1.35; // elongate
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    this.body = new THREE.Mesh(geo, this.flesh);
    this.body.position.y = 2.0;
    this.body.castShadow = true;
    this.group.add(this.body);

    // ---------- mouth as a cavity ----------
    this._buildMouth();

    // ---------- tentacles: tapered tubes with secondary motion ----------
    this._buildTentacles();

    // ---------- eyes ----------
    this._buildEyes();

    // ---------- lighting: deep throat glow + faint overall self-illum ----------
    this.throatGlow = new THREE.PointLight(0xff5a2a, 0, 8, 2);
    this.throatGlow.position.set(0, 2.15, 1.15);
    this.group.add(this.throatGlow);
    this.eyeLight = new THREE.PointLight(0xff2a5a, 0, 10, 2);
    this.eyeLight.position.set(0, 2.4, 0.6);
    this.group.add(this.eyeLight);
  }

  _buildMouth() {
    const m = new THREE.Group();
    m.position.set(0, 2.05, 1.15);
    // lip / gum ring
    const gumMat = new THREE.MeshPhysicalMaterial({ color: 0x5a0e1e, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2, sheen: 0.6, sheenColor: new THREE.Color(0xff6a8a) });
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.16, 12, 24), gumMat);
    lip.scale.set(1, 0.85, 0.6);
    m.add(lip);
    // cavity (soft dark) + throat (near-black)
    const cavity = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 16), new THREE.MeshStandardMaterial({ color: 0x2a0409, roughness: 0.5 }));
    cavity.scale.set(1, 0.85, 0.9); cavity.position.z = -0.15; m.add(cavity);
    const throat = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), new THREE.MeshBasicMaterial({ color: 0x0a0002 }));
    throat.position.z = -0.4; m.add(throat);
    // parametric teeth: varied length / tilt / wear, some behind others
    const toothMat = new THREE.MeshPhysicalMaterial({ color: 0xcabfa6, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const rr = 0.44 + this.rng.float(-0.03, 0.03);
      const len = this.rng.float(0.14, 0.34);
      const wear = this.rng.float(0.6, 1);
      const geo = new THREE.ConeGeometry(0.05 * wear, len, 5);
      geo.translate(0, len / 2, 0);
      const t = new THREE.Mesh(geo, toothMat);
      t.position.set(Math.cos(a) * rr, Math.sin(a) * rr * 0.85, this.rng.float(-0.02, 0.06));
      // point inward toward the throat
      t.rotation.z = -a - Math.PI / 2;
      t.rotation.x = this.rng.float(0.9, 1.3) + Math.sin(a) * 0.1;
      t.rotation.y = this.rng.float(-0.2, 0.2);
      t.scale.setScalar(this.rng.float(0.8, 1.2));
      m.add(t);
      t.userData.baseScale = t.scale.x;
    }
    this.mouth = m;
    this.mouthTeeth = m.children.filter((c) => c.geometry && c.geometry.type === 'ConeGeometry');
    this.group.add(m);
  }

  _buildTentacles() {
    const NODES = 8, RINGS = 10, RADIAL = 7;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      const baseR = 0.75 + this.rng.float(0, 0.2);
      const origin = new THREE.Vector3(Math.cos(a) * baseR, 1.55 + this.rng.float(-0.2, 0.2), Math.sin(a) * baseR);
      const outDir = new THREE.Vector3(Math.cos(a), -0.2, Math.sin(a)).normalize();
      const len = this.rng.float(2.4, 3.6);
      // node chain state (positions + velocities for secondary motion)
      const nodes = [];
      for (let n = 0; n < NODES; n++) {
        const pos = origin.clone().addScaledVector(outDir, (n / (NODES - 1)) * len);
        nodes.push({ pos: pos.clone(), prev: pos.clone(), rest: pos.clone() });
      }
      // tube geometry (rebuilt each frame)
      const geo = new THREE.BufferGeometry();
      const verts = (RINGS + 1) * RADIAL;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
      const idx = [];
      for (let r = 0; r < RINGS; r++) {
        for (let s = 0; s < RADIAL; s++) {
          const a0 = r * RADIAL + s, a1 = r * RADIAL + (s + 1) % RADIAL;
          const b0 = (r + 1) * RADIAL + s, b1 = (r + 1) * RADIAL + (s + 1) % RADIAL;
          idx.push(a0, b0, a1, a1, b0, b1);
        }
      }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, this.flesh);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.tentacles.push({ nodes, mesh, geo, origin, outDir, len, a, phase: this.rng.float(0, TAU), RINGS, RADIAL, NODES });
    }
  }

  _buildEyes() {
    const scleraMat = new THREE.MeshStandardMaterial({ color: 0xd9c9b0, roughness: 0.35 });
    const corneaMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.18, transmission: 0.0 });
    const count = 10;
    for (let i = 0; i < count; i++) {
      const eg = new THREE.Group();
      const a = this.rng.float(0, TAU), b = this.rng.float(0.15, Math.PI * 0.55);
      const rad = 1.15;
      const dir = new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b) * 1.3, Math.sin(b) * Math.sin(a) * 0.8 + 0.35).normalize();
      const size = this.rng.float(0.11, 0.22);
      eg.position.copy(dir).multiplyScalar(1.05).add(new THREE.Vector3(0, 2.0, 0));
      // sclera
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 14), scleraMat);
      eg.add(sclera);
      // iris (procedural radial fibers, faintly self-lit)
      const irisMat = new THREE.ShaderMaterial({
        transparent: true,
        uniforms: { uCol: { value: new THREE.Color().setHSL(this.rng.float(0.02, 0.14), 0.9, 0.4) }, uMat: { value: 1 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: `varying vec2 vUv; uniform vec3 uCol; uniform float uMat;
          void main(){ vec2 c=vUv-0.5; float r=length(c)*2.0; float ang=atan(c.y,c.x);
            float fib=0.5+0.5*sin(ang*22.0 + r*6.0); float ring=smoothstep(0.9,0.55,r);
            vec3 col=mix(uCol*0.3, uCol, fib)*ring; float pupil=smoothstep(0.32,0.28,r);
            col=mix(col, vec3(0.0), pupil); gl_FragColor=vec4(col, ring*uMat);} `,
      });
      const iris = new THREE.Mesh(new THREE.CircleGeometry(size * 0.72, 24), irisMat);
      iris.position.z = size * 0.72; eg.add(iris);
      // cornea dome
      const cornea = new THREE.Mesh(new THREE.SphereGeometry(size * 0.95, 16, 12, 0, TAU, 0, Math.PI * 0.55), corneaMat);
      cornea.rotation.x = -Math.PI / 2; cornea.position.z = size * 0.55; eg.add(cornea);
      // lid (flesh) — some eyes half-overgrown
      const overgrown = this.rng.chance(0.3);
      if (overgrown) {
        const lid = new THREE.Mesh(new THREE.SphereGeometry(size * 1.05, 14, 10, 0, TAU, 0, Math.PI * 0.55), this.flesh);
        lid.rotation.x = this.rng.float(-1, 1); lid.position.z = size * 0.2; eg.add(lid);
      }
      eg.lookAt(eg.position.clone().add(dir));
      this.group.add(eg);
      this.eyes.push({ group: eg, iris, irisMat, sclera, size, dir, saccade: this.rng.float(0, 4), look: dir.clone(), blink: this.rng.float(0, 6), tracks: this.rng.chance(0.5) });
    }
  }

  // ---------------- lifecycle ----------------
  reset() {
    this.state = STATE.DORMANT; this.menace = 0; this.materialize = 0;
    this.active = false; this.group.visible = false; this.pos.set(0, -50, 0);
  }

  spawn(player, world) {
    const r = world.radius * 0.8;
    const behind = player.facing + Math.PI;
    const x = Math.cos(behind + (Math.random() - 0.5)) * r;
    const z = Math.sin(behind + (Math.random() - 0.5)) * r;
    this.pos.set(x, world.heightAt(x, z), z);
    this.state = STATE.STALK; this.active = true; this.group.visible = true;
    this.materialize = 0.05; this.menace = 0.3;
  }

  update(dt, player, world, dread, camera) {
    if (!this.active) { this.group.visible = false; return { caught: false }; }
    this._t += dt;
    const pl = player.getPosition();
    const toPlayer = new THREE.Vector3().subVectors(pl, this.pos); toPlayer.y = 0;
    const dist = toPlayer.length(); toPlayer.normalize();

    let burning = false;
    if (player.lanternOn) {
      const facingDir = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
      const toCreature = new THREE.Vector3().subVectors(this.pos, pl); toCreature.y = 0;
      const d2 = toCreature.length(); toCreature.normalize();
      if (d2 < 22 && facingDir.dot(toCreature) > 0.62) burning = true;
    }
    if (burning) {
      this.state = STATE.REPELLED;
      this.menace = clamp(this.menace - dt * 0.9, 0, 1);
      this.materialize = clamp(this.materialize - dt * 1.2, 0, 1);
    } else {
      this.menace = clamp(this.menace + dt * (0.05 + dread * 0.28), 0, 1);
      this.materialize = clamp(this.materialize + dt * 0.5, 0, 1);
      this.state = dread > 0.6 || dist < 10 ? STATE.HUNT : STATE.STALK;
    }
    let speed;
    if (this.state === STATE.REPELLED) speed = -3.4;
    else if (this.state === STATE.HUNT) speed = 2.2 + dread * 3.2 + this.menace * 1.5;
    else speed = dist > 16 ? 2.4 : 0.7;
    this.pos.addScaledVector(toPlayer, speed * dt);

    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > world.radius + 12) { this.pos.x *= (world.radius + 12) / rr; this.pos.z *= (world.radius + 12) / rr; }
    const gy = world.heightAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, gy + Math.sin(this._t * 1.5) * 0.15, 6, dt);
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

    // eyes look toward the player (in group-local space)
    this._lookTarget.copy(pl);
    this._animateVisual(dt);

    if (this.state === STATE.REPELLED && this.materialize <= 0.02 && dist > 18) this.active = false;
    const caught = dist < this.catchDist && this.materialize > 0.4;
    return { caught };
  }

  _animateVisual(dt) {
    const vis = this.materialize;
    const flick = 0.7 + Math.sin(this._t * 20) * 0.3;

    // --- Meshy body path: drive the loaded model + rig instead of procedural ---
    if (this.usingMeshy && this.meshyRig) {
      const t = this._t;
      for (const u of this._livingU) { u.uTime.value = t; u.uMenace.value = this.menace; u.uMat.value = vis; }
      for (const m of this._meshyMats) m.opacity = vis;
      this.meshyRig.update(dt, { menace: this.menace, materialize: vis, lookTarget: this._lookTarget });
      this.throatGlow.intensity = vis * (0.3 + this.menace * 1.4) * (0.85 + Math.sin(t * 5) * 0.15);
      this.eyeLight.intensity = vis * (0.6 + this.menace * 2.6) * flick;
      this.group.visible = vis > 0.02;
      return;
    }

    this._setFleshUniform('uTime', this._t);
    this._setFleshUniform('uMenace', this.menace);
    this._setFleshUniform('uMat', vis);

    // body breathing
    this.body.scale.set(1, 1 + Math.sin(this._t * 2.4) * 0.05 * (0.5 + this.menace), 1);

    // mouth breathes; teeth grow out with menace
    if (this.mouth) {
      this.mouth.scale.setScalar(1 + Math.sin(this._t * 1.8) * 0.1 * (0.4 + this.menace));
      for (const t of this.mouthTeeth) t.scale.y = t.userData.baseScale * (0.5 + this.menace * 0.7 + Math.sin(this._t * 3 + t.position.x) * 0.05);
    }

    // tentacles: spring dynamics + rebuild tubes
    for (const T of this.tentacles) this._updateTentacle(T, dt);

    // eyes: saccades, blink, tracking
    for (const e of this.eyes) this._updateEye(e, dt, vis);

    // lights (kept low — the scene light should reveal the flesh, not self-glow)
    this.throatGlow.intensity = vis * (0.2 + this.menace * 1.0) * (0.85 + Math.sin(this._t * 5) * 0.15);
    this.eyeLight.intensity = vis * (0.5 + this.menace * 2.2) * flick;
    this.group.visible = vis > 0.02;
  }

  _updateTentacle(T, dt) {
    const { nodes, origin, outDir, len, NODES, RINGS, RADIAL } = T;
    // target rest pose: a curl driven by a travelling wave + menace + gravity
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(outDir, up).normalize();
    for (let n = 0; n < NODES; n++) {
      const f = n / (NODES - 1);
      const wave = Math.sin(this._t * 2.4 + T.phase + f * 4.0);
      const curl = (0.4 + this.menace * 0.7);
      const target = origin.clone()
        .addScaledVector(outDir, f * len)
        .addScaledVector(side, wave * curl * f * 1.2)
        .addScaledVector(up, -f * f * (0.8 + this.menace * 0.6) + Math.sin(this._t * 3 + f * 6) * 0.15 * f);
      nodes[n].rest.copy(target);
    }
    // integrate with lag/overshoot (verlet-ish), base is fixed
    nodes[0].pos.copy(nodes[0].rest);
    for (let n = 1; n < NODES; n++) {
      const nd = nodes[n];
      const vel = nd.pos.clone().sub(nd.prev).multiplyScalar(0.86); // damping
      nd.prev.copy(nd.pos);
      nd.pos.add(vel);
      // spring toward rest, weaker toward the tip (more lag)
      const k = 12 * (1 - f2(n, NODES) * 0.45);
      nd.pos.lerp(nd.rest, clamp(k * dt, 0, 1));
    }
    this._rebuildTube(T);
  }

  _rebuildTube(T) {
    const { nodes, geo, mesh, RINGS, RADIAL, NODES } = T;
    // resample node polyline into RINGS+1 points via a Catmull-Rom curve
    const curve = new THREE.CatmullRomCurve3(nodes.map((n) => n.pos));
    const pos = geo.attributes.position.array;
    const nrm = geo.attributes.normal.array;
    const up = new THREE.Vector3(0, 1, 0);
    let ptr = 0;
    const prevPoint = new THREE.Vector3();
    for (let r = 0; r <= RINGS; r++) {
      const tt = r / RINGS;
      const center = curve.getPoint(tt);
      const tan = curve.getTangent(tt).normalize();
      const nx = new THREE.Vector3().crossVectors(tan, up).normalize();
      if (nx.lengthSq() < 1e-4) nx.set(1, 0, 0);
      const ny = new THREE.Vector3().crossVectors(tan, nx).normalize();
      const radius = 0.16 * (1 - tt * 0.85) + 0.02;
      for (let s = 0; s < RADIAL; s++) {
        const ang = (s / RADIAL) * TAU;
        const dir = nx.clone().multiplyScalar(Math.cos(ang)).addScaledVector(ny, Math.sin(ang));
        const vx = center.x + dir.x * radius, vy = center.y + dir.y * radius, vz = center.z + dir.z * radius;
        pos[ptr] = vx; pos[ptr + 1] = vy; pos[ptr + 2] = vz;
        nrm[ptr] = dir.x; nrm[ptr + 1] = dir.y; nrm[ptr + 2] = dir.z;
        ptr += 3;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  _updateEye(e, dt, vis) {
    e.irisMat.uniforms.uMat.value = vis;
    // blink (scale the sclera/iris briefly)
    e.blink -= dt;
    let blinkS = 1;
    if (e.blink < 0) { if (e.blink < -0.12) e.blink = 2 + Math.random() * 5; else blinkS = 0.15; }
    e.group.scale.y = blinkS;
    // saccades: occasionally re-aim the look direction
    e.saccade -= dt;
    if (e.saccade < 0) {
      e.saccade = 0.6 + Math.random() * 2.5;
      if (e.tracks) {
        // look toward the player, with a little jitter
        const local = this.group.worldToLocal(this._lookTarget.clone());
        e.look.copy(local).sub(e.group.position).normalize().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2)).normalize();
      } else {
        e.look.set((Math.random() - 0.5), (Math.random() - 0.5), Math.random() * 0.6 + 0.3).normalize();
      }
    }
    // ease the eye toward its look direction
    const tgt = e.group.position.clone().add(e.look);
    const cur = new THREE.Vector3(0, 0, 1).applyQuaternion(e.group.quaternion).add(e.group.position);
    cur.lerp(tgt, clamp(dt * 6, 0, 1));
    e.group.lookAt(cur);
  }

  labUpdate(dt, { materialize = 1, menace = 0.6, yaw = 0, lookTarget = null } = {}) {
    this._t += dt;
    this.active = true;
    this.materialize = materialize;
    this.menace = menace;
    this.pos.set(0, 0, 0);
    this.group.position.set(0, 0, 0);
    this.group.rotation.y = yaw;
    if (lookTarget) this._lookTarget.copy(lookTarget);
    this._animateVisual(dt);
  }

  distanceTo(player) {
    if (!this.active) return Infinity;
    return this.pos.distanceTo(player.getPosition());
  }
}

// helper: normalized index fraction
function f2(n, N) { return n / (N - 1); }
