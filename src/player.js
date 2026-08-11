// player.js — the Warden: procedural rig, third-person controller, lantern.
import * as THREE from 'three';
import { clamp, damp, lerp, TAU } from './util.js';
import { loadGLTF, CharacterModel } from './models.js';
import { textureLib } from './textures.js';

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

    this.model = null;   // optional loaded glTF character (Meshy etc.)

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
    // materials
    const fab = textureLib().fabric.clone(); fab.needsUpdate = true; fab.repeat.set(3, 4);
    const coat = this._mat(0x14171f, { roughness: 0.96, bumpMap: fab, bumpScale: 0.015 });
    const coatLit = this._mat(0x20252f, { roughness: 0.92, bumpMap: fab, bumpScale: 0.012 });
    const leather = this._mat(0x2a2118, { roughness: 0.8, metalness: 0.05 });
    const metal = this._mat(0x39414e, { metalness: 0.75, roughness: 0.35 });
    const boot = this._mat(0x0c0e13, { roughness: 0.7 });
    const skin = this._mat(0x8f847a, { roughness: 0.85 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this._mats = { coat, coatLit, leather, metal, boot, skin };

    const body = new THREE.Group();
    this.rig.add(body);
    this.bodyGroup = body;

    // ---------- legs: hip -> knee -> foot (two-bone) ----------
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0.16 * side, 0.92, 0);
      // thigh
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.34, 4, 8), coat);
      thigh.position.y = -0.25; hip.add(thigh);
      // knee joint
      const knee = new THREE.Group();
      knee.position.y = -0.46; hip.add(knee);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 4, 8), coat);
      shin.position.y = -0.24; knee.add(shin);
      // boot
      const foot = new THREE.Group(); foot.position.y = -0.44; knee.add(foot);
      const bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.34), boot);
      bootMesh.position.set(0, -0.02, 0.06); foot.add(bootMesh);
      body.add(hip);
      return { hip, knee, foot };
    };
    const L = mkLeg(-1), R = mkLeg(1);
    this.hipL = L.hip; this.kneeL = L.knee; this.footL = L.foot;
    this.hipR = R.hip; this.kneeR = R.knee; this.footR = R.foot;

    // ---------- pelvis / coat skirt ----------
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 0.5, 12, 1, true), coat);
    skirt.position.y = 1.06; body.add(skirt);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 8, 20), leather);
    belt.position.y = 1.02; belt.rotation.x = Math.PI / 2; body.add(belt);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.03), metal);
    buckle.position.set(0, 1.02, 0.26); body.add(buckle);

    // ---------- torso / chest ----------
    const chest = new THREE.Group(); chest.position.y = 1.28; body.add(chest); this.chest = chest;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.62, 12), coatLit);
    chest.add(torso);
    // coat lapels (two angled boxes)
    for (const s of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.04), coat);
      lapel.position.set(0.08 * s, 0.02, 0.2); lapel.rotation.z = 0.18 * s; chest.add(lapel);
    }
    // strap across chest + small buckles
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.03), leather);
    strap.position.set(0.02, 0, 0.22); strap.rotation.z = 0.5; chest.add(strap);

    // ---------- shoulders / pauldrons ----------
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 10, 0, TAU, 0, Math.PI * 0.55), coat);
    shoulders.position.y = 1.6; shoulders.scale.set(1.15, 0.7, 1.05); body.add(shoulders);
    for (const s of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), leather);
      pauldron.position.set(0.3 * s, 1.56, 0); pauldron.scale.set(1, 0.7, 1); body.add(pauldron);
    }

    // ---------- head + hood + respirator ----------
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 14), skin);
    head.position.y = 1.84; head.scale.set(1, 1.15, 1); body.add(head); this.head = head;
    // draped hood: a lathe-like shell open at the front
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12, 0, TAU, 0, Math.PI * 0.62), coat);
    hood.position.set(0, 1.86, -0.02); hood.scale.set(1.05, 1.2, 1.15); body.add(hood); this.hood = hood;
    const hoodPeak = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 12), coat);
    hoodPeak.position.set(0, 2.02, -0.08); hoodPeak.rotation.x = -0.3; body.add(hoodPeak);
    // dark void where the face is
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), dark);
    face.position.set(0, 1.83, 0.06); face.scale.set(1, 1.1, 0.7); body.add(face);
    // respirator: a small cylinder + two glowing filter eyes
    const mask = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), metal);
    mask.position.set(0, 1.78, 0.13); mask.rotation.x = Math.PI / 2; body.add(mask);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x7fe3ff });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), eyeMat);
      eye.position.set(0.05 * s, 1.86, 0.12); body.add(eye);
    }

    // ---------- arms: shoulder -> elbow -> hand (two-bone) ----------
    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.3 * side, 1.56, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.28, 4, 8), coat);
      upper.position.y = -0.19; shoulder.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.36; shoulder.add(elbow);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.26, 4, 8), coatLit);
      fore.position.y = -0.17; elbow.add(fore);
      const hand = new THREE.Group(); hand.position.y = -0.34; elbow.add(hand);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.05), leather);
      hand.add(palm);
      body.add(shoulder);
      return { shoulder, elbow, hand };
    };
    const AL = mkArm(-1), AR = mkArm(1);
    this.shoulderL = AL.shoulder; this.elbowL = AL.elbow; this.handL = AL.hand;
    this.shoulderR = AR.shoulder; this.elbowR = AR.elbow; this.handR = AR.hand;

    // ---------- cape ----------
    const capeGeo = new THREE.PlaneGeometry(0.6, 0.95, 6, 8);
    this.cape = new THREE.Mesh(capeGeo, new THREE.MeshStandardMaterial({ color: 0x0f1219, roughness: 0.98, side: THREE.DoubleSide }));
    this.cape.position.set(0, 1.5, -0.16); body.add(this.cape);
    this._capeGeo = capeGeo;

    this.rig.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
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
    this.glow = new THREE.PointLight(0xffcaa0, 95, 38, 1.7);
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

    // mount lantern in the right hand
    this.handR.add(g);
    g.position.set(0.03, -0.12, 0.05);
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

  // Swap the procedural rig for a loaded glTF/GLB character (e.g. a Meshy model).
  // Falls back silently to the procedural rig on any error.
  async setWardenModel(url, opts = {}) {
    try {
      const gltf = await loadGLTF(url);
      this.model = new CharacterModel(gltf, { targetHeight: opts.height || 1.9, clips: opts.clips || {} });
      // reparent the lantern out of the (now hidden) procedural arm so its
      // light/beam survive, then hide the procedural body
      this.rig.add(this.lantern);
      this.lantern.position.set(0.34, 1.15, 0.28);
      this.bodyGroup.visible = false;
      this.rig.add(this.model.object);
      return true;
    } catch (err) {
      console.warn('Warden model failed to load, using procedural rig:', err.message);
      this.model = null;
      return false;
    }
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

    // ---- animation ----
    if (this.model) {
      // loaded glTF character: drive its animation state machine
      this.model.update(dt, { moving: this.moving, sprinting });
    } else {
      this._animateRig(dt, maxSpeed);
    }

    // footstep detection
    let stepped = false;
    this._stepDist += this.speed * dt;
    const stepLen = sprinting ? 1.35 : 1.05;
    if (this.moving && this._stepDist >= stepLen) {
      this._stepDist = 0;
      stepped = true;
    }

    // ---- lantern ----
    this._updateLantern(dt);

    // ---- position third-person camera ----
    if (!opts.freeCam) this._updateCamera(dt, camera, world);

    return { stepped };
  }

  _updateLantern(dt) {
    // fuel + flicker
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
    this.glow.intensity = 95 * gi;
    this.beam.intensity = 300 * gi;
    if (this.fill) this.fill.intensity = 14 + gi * 20;
    this.lanternCore.visible = this.lanternOn;
    this.lanternCore.material.color.setRGB(gi, gi * 0.8, gi * 0.48);

    const lanternWorld = new THREE.Vector3();
    this.lantern.getWorldPosition(lanternWorld);
    const aimDir = new THREE.Vector3(Math.sin(this.facing), -0.18, Math.cos(this.facing)).normalize();
    this.beamTarget.position.copy(lanternWorld).addScaledVector(aimDir, 10);

    if (this.beamCone) {
      this.beamCone.position.copy(lanternWorld);
      this.beamCone.quaternion.setFromUnitVectors(this._beamDown, aimDir);
      this.beamCone.material.uniforms.uTime.value += dt;
      this.beamCone.material.uniforms.uOpacity.value = this.lanternOn ? 0.42 * gi : 0;
      this.beamCone.visible = this.lanternOn && gi > 0.01;
    }
  }

  // Drive the rig in isolation (Character Lab): no world, no camera.
  labUpdate(dt, { speed = 0, facing = Math.PI } = {}) {
    this.speed = speed;
    this.moving = speed > 0.4;
    this.facing = facing;
    this.rig.rotation.y = this.facing;
    this.object.position.copy(this.pos);
    if (this.model) this.model.update(dt, { moving: this.moving, sprinting: speed > 5 });
    else this._animateRig(dt, 7.2);
    this._updateLantern(dt);
  }

  _animateRig(dt, maxSpeed) {
    const stride = clamp(this.speed / (maxSpeed || 1), 0, 1);
    this._walkPhase += dt * (5 + this.speed * 1.7);
    const p = this._walkPhase;
    this._idleT = (this._idleT || 0) + dt;
    const it = this._idleT;
    const legAmp = 0.12 + stride * 0.75;
    const kneeAmp = 0.25 + stride * 1.5;

    // legs (hip swing + knee bend to clear the ground)
    this.hipL.rotation.x = Math.sin(p) * legAmp;
    this.hipR.rotation.x = Math.sin(p + Math.PI) * legAmp;
    this.kneeL.rotation.x = Math.max(0, -Math.sin(p)) * kneeAmp;
    this.kneeR.rotation.x = Math.max(0, -Math.sin(p + Math.PI)) * kneeAmp;
    this.footL.rotation.x = -this.hipL.rotation.x * 0.4;
    this.footR.rotation.x = -this.hipR.rotation.x * 0.4;

    // left arm swings; right arm holds the lantern raised in front
    const armAmp = 0.1 + stride * 0.55;
    this.shoulderL.rotation.x = Math.sin(p + Math.PI) * armAmp;
    this.elbowL.rotation.x = -(0.25 + Math.max(0, Math.sin(p + Math.PI)) * 0.5);
    const rSway = Math.sin(p) * 0.05 * stride + Math.sin(it * 1.6) * 0.02;
    this.shoulderR.rotation.set(-0.62 + rSway, 0, -0.12);
    this.elbowR.rotation.x = -1.0 + rSway * 0.5;

    // torso: forward lean + counter-rotation + breathing
    this.chest.rotation.y = Math.sin(p) * 0.06 * stride;
    this.chest.rotation.x = 0.03 + stride * 0.06;
    this.chest.scale.y = 1 + Math.sin(it * 1.8) * 0.02;

    // body bob
    this.bodyGroup.position.y = Math.abs(Math.sin(p)) * stride * 0.05 + Math.sin(it * 1.6) * 0.008;

    // hood + cape sway (with a light cloth wave on the cape)
    this.hood.rotation.x = 0.04 + Math.sin(it * 1.2) * 0.025;
    this.cape.rotation.x = -(0.12 + stride * 0.5) + Math.max(0, Math.sin(p * 2)) * 0.06 * stride;
    this.cape.rotation.z = Math.sin(it * 1.5) * 0.04;
    const cp = this._capeGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i);
      const wave = Math.sin(it * 3 + x * 6 + y * 3) * 0.02 * (0.5 - y); // more at hem
      cp.setZ(i, wave);
    }
    cp.needsUpdate = true;
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
