// creature.js — the Stalker: a grotesque writhing flesh-mass that glides toward
// the Warden through the dark. Wet From-Beyond shader, breathing displacement,
// many eyes. The lantern beam burns it back; darkness and dread embolden it.
import * as THREE from 'three';
import { clamp, damp, TAU } from './util.js';

const STATE = { DORMANT: 0, STALK: 1, HUNT: 2, REPELLED: 3 };

export class Stalker {
  constructor(scene) {
    this.scene = scene;
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
    this._build();
    scene.add(this.group);
    this.group.visible = false;
  }

  _build() {
    // --- wet flesh shader: fresnel rim, breathing displacement, pulsing veins ---
    this.fleshMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uMenace: { value: 0 },
        uMat: { value: 0 },              // materialize 0..1
        uDeep: { value: new THREE.Color(0x2a0510) },  // dark wet meat
        uRim: { value: new THREE.Color(0xff2f8a) },   // From Beyond magenta
      },
      vertexShader: /* glsl */`
        uniform float uTime, uMenace;
        varying vec3 vN; varying vec3 vView; varying float vD;
        float wn(vec3 p){
          return sin(p.x*1.7+uTime*1.3)*sin(p.y*1.9-uTime*1.1)*sin(p.z*2.1+uTime*0.7);
        }
        void main(){
          vec3 p = position;
          float d = wn(position*1.4) * (0.16 + uMenace*0.26);
          d += wn(position*3.1 + 5.0) * 0.06;
          p += normal * d;
          vD = d;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform float uTime, uMenace, uMat;
        uniform vec3 uDeep, uRim;
        varying vec3 vN; varying vec3 vView; varying float vD;
        void main(){
          float fres = pow(1.0 - max(dot(normalize(vN), normalize(vView)), 0.0), 2.4);
          vec3 col = mix(uDeep, uRim, fres);
          float pulse = 0.5 + 0.5*sin(uTime*3.0 + vD*12.0);
          col += uRim * pulse * (0.12 + uMenace*0.45) * fres;   // throbbing veins
          col += vec3(1.0) * pow(fres, 5.0) * 0.35;             // wet specular
          float a = uMat * (0.5 + fres*0.65);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
    });

    // core mass: a lumpy blob
    const bodyGeo = new THREE.IcosahedronGeometry(1.0, 4);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const len = Math.hypot(x, y, z);
      const lump = 1 + Math.sin(x * 3) * 0.12 + Math.sin(y * 4 + 1) * 0.1 + Math.sin(z * 3.5) * 0.12;
      bp.setXYZ(i, (x / len) * lump, (y / len) * lump * 1.35, (z / len) * lump);
    }
    bodyGeo.computeVertexNormals();
    this.body = new THREE.Mesh(bodyGeo, this.fleshMat);
    this.body.scale.setScalar(1.15);
    this.body.position.y = 2.0;
    this.group.add(this.body);

    // a hunched "head" lobe
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 3), this.fleshMat);
    head.position.set(0, 3.05, 0.25);
    this.group.add(head);

    // writhing tentacle limbs
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const len = 1.6 + (i % 2) * 0.7;
      const tGeo = new THREE.ConeGeometry(0.16, len, 6, 4, true);
      tGeo.translate(0, -len / 2, 0);
      const t = new THREE.Mesh(tGeo, this.fleshMat);
      t.position.set(Math.cos(a) * 0.7, 1.7, Math.sin(a) * 0.7);
      t.userData = { a, phase: Math.random() * TAU, len };
      this.group.add(t);
      this.tentacles.push(t);
    }

    // many glowing eyes scattered over the mass
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe23a, transparent: true, opacity: 0 });
    for (let i = 0; i < 9; i++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.07 + Math.random() * 0.05, 8, 8), this.eyeMat);
      const a = Math.random() * TAU, b = Math.random() * Math.PI;
      const r = 1.25;
      e.position.set(Math.sin(b) * Math.cos(a) * r, 2.0 + Math.cos(b) * r * 1.2, Math.sin(b) * Math.sin(a) * r + 0.2);
      e.userData = { blink: Math.random() * 5 };
      this.group.add(e);
      this.eyes.push(e);
    }
    // the big central eye
    this.mainEye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3b24, transparent: true, opacity: 0 }));
    this.mainEye.position.set(0, 3.05, 0.75);
    this.group.add(this.mainEye);

    // self-illumination so it reads in pitch black
    this.eyeLight = new THREE.PointLight(0xff2a5a, 0, 11, 2);
    this.eyeLight.position.y = 2.4;
    this.group.add(this.eyeLight);
  }

  reset() {
    this.state = STATE.DORMANT;
    this.menace = 0;
    this.materialize = 0;
    this.active = false;
    this.group.visible = false;
    this.pos.set(0, -50, 0);
  }

  spawn(player, world) {
    const r = world.radius * 0.8;
    const behind = player.facing + Math.PI;
    const x = Math.cos(behind + (Math.random() - 0.5)) * r;
    const z = Math.sin(behind + (Math.random() - 0.5)) * r;
    this.pos.set(x, world.heightAt(x, z), z);
    this.state = STATE.STALK;
    this.active = true;
    this.group.visible = true;
    this.materialize = 0.05;
    this.menace = 0.3;
  }

  update(dt, player, world, dread, camera) {
    if (!this.active) { this.group.visible = false; return { caught: false }; }
    this._t += dt;
    const p = player.getPosition();
    const toPlayer = new THREE.Vector3().subVectors(p, this.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();

    // Is the lantern beam hitting it?
    let burning = false;
    if (player.lanternOn) {
      const facingDir = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
      const toCreature = new THREE.Vector3().subVectors(this.pos, p); toCreature.y = 0;
      const d2 = toCreature.length();
      toCreature.normalize();
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
    if (rr > world.radius + 12) {
      this.pos.x *= (world.radius + 12) / rr;
      this.pos.z *= (world.radius + 12) / rr;
    }

    const gy = world.heightAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, gy + Math.sin(this._t * 1.5) * 0.15, 6, dt);
    this.group.position.copy(this.pos);
    this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

    // --- grotesque animation ---
    const vis = this.materialize;
    const flick = 0.7 + Math.sin(this._t * 20) * 0.3;
    this.fleshMat.uniforms.uTime.value = this._t;
    this.fleshMat.uniforms.uMenace.value = this.menace;
    this.fleshMat.uniforms.uMat.value = vis;
    this.body.rotation.z = Math.sin(this._t * 1.7) * 0.06;
    this.body.scale.y = 1.15 + Math.sin(this._t * 3.0) * 0.06 * (0.5 + this.menace); // breathing

    for (const t of this.tentacles) {
      t.rotation.x = Math.sin(this._t * 2.4 + t.userData.phase) * (0.4 + this.menace * 0.5);
      t.rotation.z = Math.cos(this._t * 1.9 + t.userData.phase) * (0.35 + this.menace * 0.5);
    }
    this.eyeMat.opacity = vis;
    for (const e of this.eyes) {
      const bl = Math.sin(this._t * 2.0 + e.userData.blink);
      e.scale.setScalar(bl > -0.9 ? 1 : 0.1); // occasional blink
    }
    this.mainEye.material.opacity = vis;
    this.mainEye.scale.setScalar(1 + Math.sin(this._t * 4) * 0.08);

    this.eyeLight.intensity = vis * (14 + this.menace * 34) * flick;
    this.group.visible = vis > 0.02;

    if (this.state === STATE.REPELLED && this.materialize <= 0.02 && dist > 18) this.active = false;

    const caught = dist < this.catchDist && vis > 0.4;
    return { caught };
  }

  distanceTo(player) {
    if (!this.active) return Infinity;
    return this.pos.distanceTo(player.getPosition());
  }
}
