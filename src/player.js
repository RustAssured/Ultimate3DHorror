// player.js — the Warden: procedural rig, third-person controller, lantern.
import * as THREE from 'three';
import { clamp, damp, lerp, TAU } from './util.js';

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.object = new THREE.Group();      // root, positioned in world
    this.rig = new THREE.Group();         // visual body, yaw-rotated to face move dir
    this.object.add(this.rig);

    this.pos = new THREE.Vector3(0, 0, 22);
    this.vel = new THREE.Vector3();
    this.facing = Math.PI;                  // body yaw; face toward island centre
    this.speed = 0;
    this.moving = false;
    this.height = 1.7;

    // camera orbit state (yaw 0 => camera behind player looking toward centre)
    this.camYaw = 0;
    this.camPitch = 0.42;
    this.camDist = 5.6;
    this.camDistTarget = 5.6;

    // lantern
    this.lanternOn = true;
    this.fuel = 1.0;                       // 0..1
    this.flicker = 1;

    this._stepDist = 0;
    this._walkPhase = 0;

    this._buildRig();
    this._buildLantern();

    // soft cool fill that follows the Warden so the avatar always reads
    this.fill = new THREE.PointLight(0x8fb0e0, 18, 9, 2);
    this.fill.position.set(0, 2.6, 0.5);
    this.object.add(this.fill);
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...opts });
  }

  _buildRig() {
    const skin = this._mat(0x9a8f86, { roughness: 0.85 });
    const cloak = this._mat(0x161a24, { roughness: 0.95 });
    const cloakLit = this._mat(0x222838, { roughness: 0.9 });
    const metal = this._mat(0x3a4150, { metalness: 0.6, roughness: 0.4 });

    // hips/root at y=0 is feet; build upward
    const body = new THREE.Group();
    this.rig.add(body);
    this.bodyGroup = body;

    // legs
    this.legL = this._limb(0.22, 0.85, cloak); this.legL.position.set(-0.18, 0.85, 0);
    this.legR = this._limb(0.22, 0.85, cloak); this.legR.position.set(0.18, 0.85, 0);
    body.add(this.legL, this.legR);

    // torso (tapered)
    const torsoGeo = new THREE.CylinderGeometry(0.26, 0.34, 0.75, 10);
    const torso = new THREE.Mesh(torsoGeo, cloakLit);
    torso.position.y = 1.28;
    body.add(torso);

    // hooded shoulders / cloak drape
    const shoulderGeo = new THREE.SphereGeometry(0.42, 12, 8, 0, TAU, 0, Math.PI * 0.6);
    const shoulders = new THREE.Mesh(shoulderGeo, cloak);
    shoulders.position.y = 1.62; shoulders.scale.set(1, 0.7, 1.05);
    body.add(shoulders);

    // head + hood
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), skin);
    head.position.y = 1.86;
    body.add(head);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.42, 12, 1, true), cloak);
    hood.position.y = 1.9; hood.rotation.x = 0.12;
    body.add(hood);
    // shadow under hood so face reads as dark void
    const faceGeo = new THREE.CircleGeometry(0.13, 12);
    const faceMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(0, 1.86, 0.16);
    body.add(face);
    this.head = head;

    // arms
    this.armL = this._limb(0.16, 0.72, cloak); this.armL.position.set(-0.34, 1.58, 0);
    this.armR = this._limb(0.16, 0.72, cloak); this.armR.position.set(0.34, 1.58, 0);
    body.add(this.armL, this.armR);

    // a belt lantern-ring / detail
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 8, 16), metal);
    belt.position.y = 1.0; belt.rotation.x = Math.PI / 2;
    body.add(belt);

    this.rig.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  // a pivoting limb: pivot at top, geometry hangs down
  _limb(radius, length, mat) {
    const pivot = new THREE.Group();
    const geo = new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 8);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = -length / 2;
    pivot.add(m);
    pivot.userData.length = length;
    return pivot;
  }

  _buildLantern() {
    const g = new THREE.Group();
    // lantern body attached to right hand
    const cage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide })
    );
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffdca0 })
    );
    g.add(cage, core);
    this.lanternCore = core;

    // warm glow bulb (physical units: candela)
    this.glow = new THREE.PointLight(0xffcaa0, 140, 40, 1.7);
    g.add(this.glow);

    // directional beam (flashlight) — parented to lantern, aimed forward
    this.beam = new THREE.SpotLight(0xfff0d6, 320, 52, Math.PI / 5.0, 0.4, 1.4);
    this.beam.castShadow = true;
    this.beam.shadow.mapSize.set(1024, 1024);
    this.beam.shadow.camera.near = 0.5;
    this.beam.shadow.camera.far = 42;
    this.beam.shadow.bias = -0.0006;
    this.beamTarget = new THREE.Object3D();
    this.scene.add(this.beamTarget);
    this.beam.target = this.beamTarget;
    g.add(this.beam);

    // mount lantern to right hand (end of right arm)
    this.armR.add(g);
    g.position.set(0, -0.72, 0.12);
    this.lantern = g;

    this._buildBeamCone();
  }

  // Fake volumetric god-ray cone in the beam — the Carpenter fog-in-the-light look.
  _buildBeamCone() {
    const H = 26;              // beam length
    const geo = new THREE.ConeGeometry(4.6, H, 28, 24, true);
    geo.translate(0, -H / 2, 0);   // apex at origin, body along -Y
    this._beamH = H;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.5 },
        uColor: { value: new THREE.Color(0xffe6c0) },
        uH: { value: H },
      },
      vertexShader: /* glsl */`
        varying float vT; varying vec2 vUv;
        uniform float uH;
        void main(){
          vT = clamp(-position.y / uH, 0.0, 1.0);  // 0 apex .. 1 base
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying float vT; varying vec2 vUv;
        uniform float uTime, uOpacity; uniform vec3 uColor;
        float hash(vec2 p){ p=fract(p*vec2(127.1,311.7)); p+=dot(p,p+34.5); return fract(p.x*p.y); }
        void main(){
          // fade along length: bright near source, gone at the end
          float lenFade = pow(1.0 - vT, 1.7);
          // soft edge around the cone circumference (uv.x wraps 0..1)
          float edge = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
          edge = 0.35 + edge*0.65;
          // drifting fog motes in the beam
          float n = hash(floor(vec2(vUv.x*40.0, (vT*10.0 - uTime*0.6))));
          float fog = 0.6 + 0.4*n;
          float a = lenFade * edge * fog * uOpacity;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
    });
    this.beamCone = new THREE.Mesh(geo, mat);
    this.beamCone.frustumCulled = false;
    this.beamCone.renderOrder = 2;
    this.scene.add(this.beamCone);
    this._beamDown = new THREE.Vector3(0, -1, 0);
  }

  reset(x, z, world) {
    this.pos.set(x, world ? world.heightAt(x, z) : 0, z);
    this.vel.set(0, 0, 0);
    this.fuel = 1;
    this.lanternOn = true;
    this.facing = Math.PI;
    this.camYaw = 0;
    this.camPitch = 0.42;
    this.camDist = this.camDistTarget = 5.6;
    this._camPos = null;
    this.object.position.copy(this.pos);
  }

  toggleLantern(audio) {
    this.lanternOn = !this.lanternOn;
    if (audio) audio.step();
  }

  // returns { stepped:boolean } for footstep audio
  update(dt, input, world, camera, opts = {}) {
    const allowControl = opts.allowControl !== false;

    // ---- camera orbit from mouse ----
    if (allowControl && input.locked) {
      const m = input.consumeMouse();
      this.camYaw -= m.x;
      this.camPitch = clamp(this.camPitch - m.y, -0.35, 1.15);
    } else {
      input.consumeMouse();
    }
    const wheel = input.consumeWheel();
    if (wheel) this.camDistTarget = clamp(this.camDistTarget + wheel * 0.006, 3.5, 9);
    this.camDist = damp(this.camDist, this.camDistTarget, 8, dt);

    // ---- movement relative to camera ----
    let ax = 0, az = 0;
    if (allowControl) {
      const mv = input.moveAxis();
      // camera forward on ground plane
      const fwd = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
      const dir = new THREE.Vector3();
      dir.addScaledVector(fwd, -mv.z).addScaledVector(right, mv.x);
      if (dir.lengthSq() > 0.0001) {
        dir.normalize();
        ax = dir.x; az = dir.z;
      }
    }

    const sprinting = allowControl && input.down('ShiftLeft') && (ax || az);
    const maxSpeed = sprinting ? 7.2 : 3.7;
    const accel = 26, friction = 14;

    // integrate horizontal velocity
    const targetVx = ax * maxSpeed, targetVz = az * maxSpeed;
    if (ax || az) {
      this.vel.x = damp(this.vel.x, targetVx, accel * 0.14, dt);
      this.vel.z = damp(this.vel.z, targetVz, accel * 0.14, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, friction * 0.14, dt);
      this.vel.z = damp(this.vel.z, 0, friction * 0.14, dt);
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // ---- ground follow ----
    const groundY = world.heightAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, groundY, 18, dt);

    // ---- face movement direction ----
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.moving = this.speed > 0.4;
    if (this.moving) {
      const desired = Math.atan2(this.vel.x, this.vel.z);
      // shortest-arc damp
      let diff = ((desired - this.facing + Math.PI) % TAU) - Math.PI;
      if (diff < -Math.PI) diff += TAU;
      this.facing += diff * Math.min(1, dt * 12);
    }
    this.rig.rotation.y = this.facing;
    this.object.position.copy(this.pos);

    // ---- limb animation (walk cycle + idle sway) ----
    const stride = clamp(this.speed / maxSpeed, 0, 1);
    this._walkPhase += dt * (6 + this.speed * 1.6);
    const swing = Math.sin(this._walkPhase) * (0.15 + stride * 0.6);
    const swing2 = Math.sin(this._walkPhase + Math.PI) * (0.15 + stride * 0.6);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = swing2;
    this.armL.rotation.x = swing2 * 0.7;
    this.armR.rotation.x = swing * 0.4; // damped: holding lantern
    // gentle vertical bob + breathing when idle
    const bob = Math.abs(Math.sin(this._walkPhase)) * stride * 0.06 + Math.sin(this.object.userData.t = (this.object.userData.t || 0) + dt * 1.6) * 0.01;
    this.bodyGroup.position.y = bob;

    // footstep detection
    let stepped = false;
    this._stepDist += this.speed * dt;
    const stepLen = sprinting ? 1.35 : 1.05;
    if (this.moving && this._stepDist >= stepLen) {
      this._stepDist = 0;
      stepped = true;
    }

    // ---- lantern fuel + flicker ----
    if (this.lanternOn) {
      this.fuel = Math.max(0, this.fuel - dt * 0.018);
      if (this.fuel <= 0) this.lanternOn = false;
    } else {
      this.fuel = Math.min(1, this.fuel + dt * 0.006);
    }
    const lowFuel = this.fuel < 0.22;
    this.flicker = this.lanternOn
      ? (lowFuel ? 0.35 + Math.random() * 0.65 : 0.86 + Math.random() * 0.14)
      : 0;
    const gi = this.lanternOn ? this.flicker : 0;
    this.glow.intensity = 140 * gi;
    this.beam.intensity = 320 * gi;
    // soft fill so the Warden silhouette always reads, brighter with lantern
    if (this.fill) this.fill.intensity = 14 + gi * 22;
    this.lanternCore.visible = this.lanternOn;
    this.lanternCore.material.color.setScalar(0.6 + gi * 0.4);

    // aim beam forward from lantern
    const lanternWorld = new THREE.Vector3();
    this.lantern.getWorldPosition(lanternWorld);
    const aimDir = new THREE.Vector3(Math.sin(this.facing), -0.18, Math.cos(this.facing)).normalize();
    this.beamTarget.position.copy(lanternWorld).addScaledVector(aimDir, 10);

    // volumetric god-ray cone follows the beam
    if (this.beamCone) {
      this.beamCone.position.copy(lanternWorld);
      this.beamCone.quaternion.setFromUnitVectors(this._beamDown, aimDir);
      this.beamCone.material.uniforms.uTime.value = (this.beamCone.material.uniforms.uTime.value + dt);
      this.beamCone.material.uniforms.uOpacity.value = this.lanternOn ? 0.42 * gi : 0;
      this.beamCone.visible = this.lanternOn && gi > 0.01;
    }

    // ---- position third-person camera ----
    if (!opts.freeCam) this._updateCamera(dt, camera, world);

    return { stepped };
  }

  _updateCamera(dt, camera, world) {
    // Over-the-shoulder third-person rig. The Warden faces the dark with the
    // lantern thrown ahead, so a directly-behind camera only sees an unlit back.
    // Offsetting up and to the shoulder shows the lit near-side of the figure
    // and keeps the reticle on the lit ground ahead — the AAA framing.
    const orbit = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch)
    );
    // camera-space right vector (for the shoulder offset)
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const shoulder = 1.15, lift = 0.35;

    const anchor = new THREE.Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z)
      .addScaledVector(right, shoulder);
    // look a touch ahead-and-down so the lantern pool centres under the reticle
    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)).multiplyScalar(-1);
    const lookTarget = new THREE.Vector3(this.pos.x, this.pos.y + 1.15, this.pos.z)
      .addScaledVector(right, shoulder * 0.55)
      .addScaledVector(fwd, 4.0);

    const dist = this.camDist;
    const desired = anchor.clone().addScaledVector(orbit, dist);
    desired.y += lift;
    // simple ground-clip prevention: keep camera above terrain
    const gy = world.heightAt(desired.x, desired.z) + 0.6;
    if (desired.y < gy) desired.y = gy;

    if (!this._camPos) this._camPos = desired.clone();
    this._camPos.x = damp(this._camPos.x, desired.x, 10, dt);
    this._camPos.y = damp(this._camPos.y, desired.y, 10, dt);
    this._camPos.z = damp(this._camPos.z, desired.z, 10, dt);
    camera.position.copy(this._camPos);
    camera.lookAt(lookTarget);
  }

  // convenience getters
  getPosition() { return this.pos; }
  lanternLightLevel() { return this.lanternOn ? this.flicker : 0; }
}
