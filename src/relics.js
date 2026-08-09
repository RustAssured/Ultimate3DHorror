// relics.js — Echoes (collectible lore shards) and the Beacon (the exit).
import * as THREE from 'three';
import { RNG, TAU, clamp } from './util.js';

export class Relics {
  constructor(scene, world, count = 6, seed = 55123) {
    this.scene = scene;
    this.world = world;
    this.rng = new RNG(seed);
    this.echoes = [];
    this.collected = 0;
    this.total = count;
    this._t = 0;
    this._buildEchoes(count);
    this._buildBeacon();
  }

  _buildEchoes(count) {
    const placed = [];
    let tries = 0;
    while (this.echoes.length < count && tries < 500) {
      tries++;
      const p = this.rng.disc(this.world.radius - 10);
      if (!this.world.inBounds(p.x, p.z)) continue;
      if (Math.hypot(p.x, p.z) < 10) continue; // not on top of spawn/beacon
      if (placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 16)) continue;
      placed.push(p);

      const group = new THREE.Group();
      const y = this.world.heightAt(p.x, p.z) + 1.4;
      group.position.set(p.x, y, p.z);

      // glowing crystal shard (octahedron)
      const hue = this.rng.pick([0x54b0ff, 0x9a6bff, 0x33e0c8, 0xffd76a]);
      const coreMat = new THREE.MeshBasicMaterial({ color: hue });
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), coreMat);
      core.scale.y = 1.7;
      group.add(core);

      // halo
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 16, 16),
        new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      group.add(halo);

      const light = new THREE.PointLight(hue, 34, 15, 2);
      group.add(light);

      // faint rising particles
      this.scene.add(group);
      this.echoes.push({
        group, core, halo, light, hue,
        pos: new THREE.Vector3(p.x, y, p.z),
        baseY: y, phase: this.rng.float(0, TAU), collected: false,
      });
    }
    this.total = this.echoes.length;
  }

  _buildBeacon() {
    const g = new THREE.Group();
    g.position.set(0, this.world.heightAt(0, 0), 0);

    // obelisk base
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0d1119, roughness: 0.8, metalness: 0.3 });
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 6, 6), baseMat);
    obelisk.position.y = 3;
    g.add(obelisk);

    // dormant crystal at the top
    this.crystalMat = new THREE.MeshBasicMaterial({ color: 0x24303f });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), this.crystalMat);
    crystal.position.y = 6.6; crystal.scale.y = 1.5;
    g.add(crystal);
    this.crystal = crystal;

    // light beam column (hidden until active)
    this.beamCol = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 2.2, 120, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    this.beamCol.position.y = 60;
    g.add(this.beamCol);

    // ground ring
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(2.4, 3.0, 40),
      new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.1;
    g.add(this.ring);

    this.beaconLight = new THREE.PointLight(0x9fd8ff, 0, 70, 1.8);
    this.beaconLight.position.y = 6.6;
    g.add(this.beaconLight);

    this.scene.add(g);
    this.beacon = g;
    this.active = false;
    this.beaconPos = new THREE.Vector3(0, this.world.heightAt(0, 0), 0);
  }

  activateBeacon(audio) {
    if (this.active) return;
    this.active = true;
    if (audio) audio.beaconHum();
  }

  // Returns events for the game to react to.
  update(dt, player, audio) {
    this._t += dt;
    const pp = player.getPosition();
    const events = { collected: null, reachedBeacon: false, remaining: this.total - this.collected };

    for (const e of this.echoes) {
      if (e.collected) continue;
      e.group.position.y = e.baseY + Math.sin(this._t * 1.5 + e.phase) * 0.25;
      e.core.rotation.y += dt * 1.2;
      e.core.rotation.x += dt * 0.4;
      e.halo.material.opacity = 0.1 + Math.sin(this._t * 2 + e.phase) * 0.05;
      const d = Math.hypot(pp.x - e.pos.x, pp.z - e.pos.z);
      if (d < 2.2) {
        e.collected = true;
        this.collected++;
        e.group.visible = false;
        if (audio) audio.pickup();
        events.collected = this.collected;
        events.remaining = this.total - this.collected;
        if (this.collected >= this.total) this.activateBeacon(audio);
      }
    }

    // beacon visuals
    if (this.active) {
      const pulse = 0.55 + Math.sin(this._t * 2) * 0.2;
      this.beamCol.material.opacity = 0.16 * pulse + 0.08;
      this.ring.material.opacity = 0.5 * pulse;
      this.ring.scale.setScalar(1 + Math.sin(this._t * 1.3) * 0.05);
      this.beaconLight.intensity = 45 + pulse * 45;
      this.crystalMat.color.setHSL(0.55, 1, 0.6 + pulse * 0.2);
      this.crystal.rotation.y += dt * 0.8;
      const d = Math.hypot(pp.x - this.beaconPos.x, pp.z - this.beaconPos.z);
      if (d < 3.2) events.reachedBeacon = true;
    } else {
      // dormant crystal glimmer scaled by how many collected
      const frac = this.collected / this.total;
      this.crystalMat.color.setHSL(0.55, 0.6, 0.16 + frac * 0.3);
      this.crystal.rotation.y += dt * 0.2;
    }

    return events;
  }

  reset() {
    for (const e of this.echoes) { e.collected = false; e.group.visible = true; }
    this.collected = 0;
    this.active = false;
    this.beamCol.material.opacity = 0;
    this.ring.material.opacity = 0;
    this.beaconLight.intensity = 0;
  }

  // nearest uncollected echo position (for the objective marker/compass)
  nearestEcho(from) {
    let best = null, bd = Infinity;
    for (const e of this.echoes) {
      if (e.collected) continue;
      const d = e.pos.distanceTo(from);
      if (d < bd) { bd = d; best = e; }
    }
    if (this.active) return { pos: this.beaconPos, dist: this.beaconPos.distanceTo(from), beacon: true };
    return best ? { pos: best.pos, dist: bd, beacon: false } : null;
  }
}
