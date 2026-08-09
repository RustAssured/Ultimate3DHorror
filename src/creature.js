// creature.js — the Stalker. Glides toward the Warden through the dark.
// The lantern beam burns it back; darkness and dread embolden it.
import * as THREE from 'three';
import { clamp, damp, TAU } from './util.js';

const STATE = { DORMANT: 0, STALK: 1, HUNT: 2, REPELLED: 3 };

export class Stalker {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.pos = new THREE.Vector3(0, -50, 0);
    this.state = STATE.DORMANT;
    this.menace = 0;         // 0..1 aggression
    this.materialize = 0;    // 0 hidden .. 1 fully present
    this.active = false;
    this.catchDist = 1.7;
    this._t = 0;
    this._build();
    scene.add(this.group);
    this.group.visible = false;
  }

  _build() {
    // Tall, ragged wraith: a stretched body + tattered shoulders + glowing eyes.
    const bodyMat = new THREE.MeshBasicMaterial({
      color: 0x05060a, transparent: true, opacity: 0.0, depthWrite: false,
    });
    this.bodyMat = bodyMat;

    const bodyGeo = new THREE.ConeGeometry(0.7, 3.4, 10, 4, true);
    // ripple the cone for a tattered silhouette
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i);
      const f = (y + 1.7) / 3.4;
      const w = 1 + Math.sin(i * 2.3) * 0.12 * f;
      bp.setX(i, bp.getX(i) * w);
      bp.setZ(i, bp.getZ(i) * w);
    }
    bodyGeo.computeVertexNormals();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.7;
    this.group.add(body);
    this.body = body;

    // hollow head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), bodyMat);
    head.position.y = 3.1; head.scale.set(0.9, 1.1, 0.9);
    this.group.add(head);

    // two glowing eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b24, transparent: true, opacity: 0 });
    this.eyeMat = eyeMat;
    this.eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
    this.eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
    this.eyeL.position.set(-0.14, 3.15, 0.34);
    this.eyeR.position.set(0.14, 3.15, 0.34);
    this.group.add(this.eyeL, this.eyeR);

    // tattered arms
    const armMat = bodyMat;
    this.armL = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.6, 6), armMat);
    this.armR = new THREE.Mesh(new THREE.ConeGeometry(0.14, 1.6, 6), armMat);
    this.armL.position.set(-0.5, 2.3, 0); this.armL.rotation.z = 0.5;
    this.armR.position.set(0.5, 2.3, 0); this.armR.rotation.z = -0.5;
    this.group.add(this.armL, this.armR);

    // faint red rim light so it self-illuminates in pitch black
    this.eyeLight = new THREE.PointLight(0xff2a1a, 0, 10, 2);
    this.eyeLight.position.y = 3.1;
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

  // spawn at the island edge, away from where the player looks
  spawn(player, world) {
    const a = Math.random() * TAU;
    const r = world.radius * 0.8;
    let x = Math.cos(a) * r, z = Math.sin(a) * r;
    // bias to spawn behind the player
    const behind = player.facing + Math.PI;
    x = Math.cos(behind + (Math.random() - 0.5)) * r;
    z = Math.sin(behind + (Math.random() - 0.5)) * r;
    this.pos.set(x, world.heightAt(x, z), z);
    this.state = STATE.STALK;
    this.active = true;
    this.group.visible = true;
    this.materialize = 0.05;
    this.menace = 0.3;
  }

  // dread 0..1. Returns { caught:boolean }
  update(dt, player, world, dread, camera) {
    if (!this.active) { this.group.visible = false; return { caught: false }; }
    this._t += dt;
    const p = player.getPosition();
    const toPlayer = new THREE.Vector3().subVectors(p, this.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();

    // Is the lantern beam hitting it? (lantern on + within forward cone)
    let burning = false;
    if (player.lanternOn) {
      const facingDir = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
      const toCreature = new THREE.Vector3().subVectors(this.pos, p); toCreature.y = 0;
      const d2 = toCreature.length();
      toCreature.normalize();
      const dotf = facingDir.dot(toCreature);
      if (d2 < 22 && dotf > 0.62) burning = true; // in the beam cone
    }

    // state logic
    if (burning) {
      this.state = STATE.REPELLED;
      this.menace = clamp(this.menace - dt * 0.9, 0, 1);
      this.materialize = clamp(this.materialize - dt * 1.2, 0, 1);
    } else {
      this.menace = clamp(this.menace + dt * (0.05 + dread * 0.28), 0, 1);
      this.materialize = clamp(this.materialize + dt * 0.5, 0, 1);
      this.state = dread > 0.6 || dist < 10 ? STATE.HUNT : STATE.STALK;
    }

    // movement speed
    let speed;
    if (this.state === STATE.REPELLED) {
      speed = -3.4; // retreat
    } else if (this.state === STATE.HUNT) {
      speed = 2.2 + dread * 3.2 + this.menace * 1.5;
    } else {
      // stalk: hover at a distance, close slowly
      speed = dist > 16 ? 2.4 : 0.7;
    }

    // integrate toward/away player
    this.pos.addScaledVector(toPlayer, speed * dt);

    // keep near the island (don't drift into the far void)
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > world.radius + 12) {
      this.pos.x *= (world.radius + 12) / rr;
      this.pos.z *= (world.radius + 12) / rr;
    }

    // glide over terrain with a hover + sway
    const gy = world.heightAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, gy + 0.1 + Math.sin(this._t * 1.5) * 0.15, 6, dt);
    this.group.position.copy(this.pos);

    // face the player
    this.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);

    // writhe
    this.armL.rotation.z = 0.5 + Math.sin(this._t * 3) * 0.3;
    this.armR.rotation.z = -0.5 - Math.sin(this._t * 3 + 1) * 0.3;
    this.body.rotation.z = Math.sin(this._t * 1.7) * 0.05;

    // visuals from materialize
    const vis = this.materialize;
    this.bodyMat.opacity = 0.15 + vis * 0.8;
    this.eyeMat.opacity = vis;
    this.eyeLight.intensity = vis * (14 + this.menace * 30);
    const flick = 0.7 + Math.sin(this._t * 20) * 0.3;
    this.eyeLight.intensity *= flick;
    this.group.visible = vis > 0.02;

    // if fully repelled and far, go dormant
    if (this.state === STATE.REPELLED && this.materialize <= 0.02 && dist > 18) {
      this.active = false;
    }

    const caught = dist < this.catchDist && vis > 0.4;
    return { caught };
  }

  distanceTo(player) {
    if (!this.active) return Infinity;
    return this.pos.distanceTo(player.getPosition());
  }
}
