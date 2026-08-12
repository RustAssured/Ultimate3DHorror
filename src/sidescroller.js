// sidescroller.js — COSMIC FALL: 2.5D grotesque-horror side-scroller prototype.
// Reuses the real 3D assets (Dreamwalker player, monster3 horror) on a fixed
// side camera: walk left/right through the dark, the horror emerges from the
// background and hunts you across the frame.
import * as THREE from 'three';
import { PostFX } from './postfx.js';
import { loadGLTF, CharacterModel } from './models.js';
import { Stalker } from './creature.js';
import { RNG, ValueNoise, clamp, damp } from './util.js';

const LEVEL_LEN = 130;   // metres of corridor
const START_X = 8;
const GROUND_Y = 0;
const PLAYER_FIT = 0.34;     // empirical downscale of the animated Dreamwalker
const PLAYER_GROUND = -0.14; // empirical foot-to-floor offset after fit
const CAM_Z = 8.0;           // side-camera distance
const CAM_Y = 1.7;           // side-camera height
const CAM_LOOK_Y = 1.15;     // look target (mid-figure)
const CAM_OFFSET = 2.2;      // push player to the right third; reveal the space behind
const MONSTER_SCALE = 0.72;  // body ~3.4m: looms larger than the 2.4m player
const MONSTER_Y = 0.0;       // vertical placement of the horror
const MONSTER_Z = -1.2;      // sit the horror slightly behind the player plane
const MONSTER_START_GAP = 8; // metres the horror trails at the start (looms at frame-left)

class SideScroller {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ui = document.getElementById('ui');
    this.rng = new RNG(4242);
    this.noise = new ValueNoise(99);

    this.state = 'title';
    this.playerX = START_X;
    this.vx = 0;
    this.facing = 1;              // +1 right, -1 left
    this.dread = 0.12;
    this.monsterX = START_X - MONSTER_START_GAP;
    this.checkpoint = START_X;
    this.time = 0;
    this._flash = 0;
    this.keys = new Set();

    this._initRenderer();
    this._initScene();
    this._buildLevel();
    this._buildLights();
    this._loadPlayer();
    this._initMonster();
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this._buildUI();
    this._bindInput();
    this._onResize();
    window.addEventListener('resize', () => this._onResize());
    window.__ss = this;
    this._last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070c);
    this.scene.fog = new THREE.FogExp2(0x070b10, 0.028);
    this.baseFog = 0.028;
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(START_X - CAM_OFFSET, CAM_Y, CAM_Z);
    this.camera.lookAt(START_X - CAM_OFFSET, CAM_LOOK_Y, 0);
  }

  _buildLevel() {
    // ---- ground: a long grimy strip along X ----
    const gGeo = new THREE.PlaneGeometry(LEVEL_LEN + 60, 24, Math.floor((LEVEL_LEN + 60) / 2), 12);
    gGeo.rotateX(-Math.PI / 2);
    const gp = gGeo.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i);
      gp.setY(i, this.noise.fbm(x * 0.08, z * 0.08, 3) * 0.25 - Math.max(0, Math.abs(z) - 6) * 0.15);
    }
    gGeo.computeVertexNormals();
    const gMat = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 1, metalness: 0.05 });
    const ground = new THREE.Mesh(gGeo, gMat);
    ground.position.set((LEVEL_LEN) / 2, 0, 0);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // ---- back wall / strata (dark, receives light) ----
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(LEVEL_LEN + 60, 40),
      new THREE.MeshStandardMaterial({ color: 0x0c0f15, roughness: 1 })
    );
    wall.position.set(LEVEL_LEN / 2, 12, -9);
    this.scene.add(wall);

    // ---- parallax silhouette layers (jagged wreckage receding into the dark) ----
    this.parallax = [];
    const layerDefs = [
      { z: -6, h: 7, color: 0x0a0d13, n: 26, jag: 3.5 },
      { z: -14, h: 11, color: 0x080b11, n: 20, jag: 5 },
      { z: -24, h: 16, color: 0x06080d, n: 16, jag: 7 },
    ];
    for (const d of layerDefs) {
      const grp = new THREE.Group();
      for (let i = 0; i < d.n; i++) {
        const w = this.rng.float(2, 6);
        const h = d.h * this.rng.float(0.5, 1.2);
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.2),
          new THREE.MeshStandardMaterial({ color: d.color, roughness: 1 }));
        box.position.set(this.rng.float(-10, LEVEL_LEN + 10), h / 2 - 1, d.z + this.rng.float(-1, 1));
        box.rotation.z = this.rng.float(-0.08, 0.08);
        grp.add(box);
      }
      this.scene.add(grp);
      this.parallax.push({ grp, z: d.z });
    }

    // ---- foreground framing pillars (between camera and player) ----
    this.fgGroup = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const px = this.rng.float(0, LEVEL_LEN);
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(this.rng.float(0.3, 0.7), this.rng.float(0.4, 0.9), this.rng.float(6, 11), 7),
        new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 1 }));
      pil.position.set(px, 3, this.rng.float(3.5, 5.5));
      this.fgGroup.add(pil);
    }
    this.scene.add(this.fgGroup);

    // ---- drifting motes ----
    const N = 500; const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = this.rng.float(-10, LEVEL_LEN + 10); pos[i * 3 + 1] = this.rng.float(0, 12); pos[i * 3 + 2] = this.rng.float(-20, 4); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0x9fb6d6, size: 0.06, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.motes);

    // ---- exit beacon at the end ----
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.set(LEVEL_LEN, 18, -2);
    this.scene.add(beam);
    this.exitLight = new THREE.PointLight(0x9fd8ff, 30, 30, 2);
    this.exitLight.position.set(LEVEL_LEN, 4, 0);
    this.scene.add(this.exitLight);
  }

  _buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x1a2536, 0x05070c, 0.5));
    // the player emits their own cold-warm glow (a cosmic-horror aura). Kept at
    // chest height and modest intensity so it lights the WHOLE figure and casts
    // its shadow on the back wall, instead of blooming a hot ball over the head.
    this.playerLight = new THREE.PointLight(0xffc9a0, 26, 20, 2);
    this.playerLight.position.set(START_X, 1.2, 2.2);
    this.playerLight.castShadow = true;
    this.playerLight.shadow.mapSize.set(1024, 1024);
    this.playerLight.shadow.bias = -0.0006;
    this.scene.add(this.playerLight);
    // cool rim from behind so the silhouette separates from the dark strata
    this.rim = new THREE.PointLight(0x5a78c8, 18, 24, 2);
    this.rim.position.set(START_X, 3.2, -4);
    this.scene.add(this.rim);
    // faint front fill so the figure reads as a full body, not a shadow
    this.fill = new THREE.DirectionalLight(0x33507a, 0.4);
    this.fill.position.set(0, 8, 14);
    this.scene.add(this.fill);
  }

  async _loadPlayer() {
    // reuse the Dreamwalker glTF via CharacterModel (walk cycle)
    try {
      const gltf = await loadGLTF('./assets/models/dreamwalker.glb');
      this.player = new CharacterModel(gltf, { targetHeight: 1.85 });
      // The Dreamwalker's walk pose renders far larger than its bind-pose bbox
      // (the rig is authored in cm with an odd bind matrix), and floats off the
      // floor. Bind-pose normalization can't see that, so apply an empirical
      // fit + ground offset tuned against the actual render.
      this.player.object.scale.multiplyScalar(PLAYER_FIT);
      this._playerFootOffset = PLAYER_GROUND;
      this.player.object.position.set(this.playerX, this._playerFootOffset, 0);
      this.scene.add(this.player.object);
    } catch (e) { console.warn('player model failed', e.message); }
  }

  _initMonster() {
    // reuse the Stalker's auto-rigged monster3 visual; drive it manually here
    window.COSMIC_CONFIG = Object.assign({ stalkerModel: './assets/models/monster3.glb' }, window.COSMIC_CONFIG || {});
    this.monster = new Stalker(this.scene);
    this.monster.active = true;
    this.monster.materialize = 0.0;
    this.monster.menace = 0.6;
    this.monster.group.scale.setScalar(MONSTER_SCALE);
    // a hellish red glow travels with the horror so it reads in the dark
    this.monsterLight = new THREE.PointLight(0xff2a12, 0, 16, 2);
    this.monsterLight.position.set(this.monsterX, 1.5, 0.5);
    this.scene.add(this.monsterLight);
    // cold backlight to rim the silhouette
    this.monsterRim = new THREE.PointLight(0x6784d8, 0, 18, 2);
    this.monsterRim.position.set(this.monsterX, 2.6, -3);
    this.scene.add(this.monsterRim);
  }

  _buildUI() {
    const mk = (cls, html) => { const e = document.createElement('div'); e.className = cls; if (html) e.innerHTML = html; this.ui.appendChild(e); return e; };
    this.titleEl = mk('ss-screen', '<div class="ss-title">COSMIC&nbsp;FALL</div><div class="ss-sub">the falling dark · a side-scroll descent</div><button class="ss-btn" id="ss-start">WALK INTO THE DARK</button><div class="ss-controls">← → / A D move · Shift run · it is behind you</div>');
    this.hud = mk('ss-hud hidden', '<div class="ss-dist"></div><div class="ss-hint">reach the light</div>');
    this.distEl = this.hud.querySelector('.ss-dist');
    this.endEl = mk('ss-screen hidden', '<div class="ss-endtitle"></div><button class="ss-btn" id="ss-again">AGAIN</button>');
    this.endTitleEl = this.endEl.querySelector('.ss-endtitle');
    document.getElementById('ss-start').onclick = () => this._start();
    document.getElementById('ss-again').onclick = () => this._restart();
  }

  _bindInput() {
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); if (['ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _start() { this.state = 'play'; this.titleEl.classList.add('hidden'); this.hud.classList.remove('hidden'); }
  _restart() { this.endEl.classList.add('hidden'); this.hud.classList.remove('hidden'); this._resetRun(); this.state = 'play'; }
  _resetRun() { this.playerX = START_X; this.vx = 0; this.dread = 0.12; this.monsterX = START_X - MONSTER_START_GAP; this.checkpoint = START_X; this.monster.materialize = 0; this._deaths = 0; }

  _die() {
    this._flash = 1; this.postfx.triggerFlash(0.9);
    this.playerX = Math.max(START_X, this.checkpoint - 2);
    this.monsterX = this.playerX - MONSTER_START_GAP;
    this.monster.materialize = 0; this.dread = Math.max(0.15, this.dread - 0.3);
  }
  _win() { this.state = 'win'; this.hud.classList.add('hidden'); this.endTitleEl.textContent = 'YOU REACHED THE LIGHT'; this.endTitleEl.style.color = '#bfe6ff'; this.endEl.classList.remove('hidden'); }
  _lose() { this.state = 'lose'; this.hud.classList.add('hidden'); this.endTitleEl.textContent = 'THE DARK TOOK YOU'; this.endTitleEl.style.color = '#ff6a6a'; this.endEl.classList.remove('hidden'); }

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    let dt = (now - this._last) / 1000; this._last = now; if (dt > 0.05) dt = 0.05;
    this.time += dt;

    if (this.state === 'play') this._stepPlay(dt);

    // parallax offset with camera
    for (const p of this.parallax) p.grp.position.x = (this.camera.position.x - START_X) * (p.z / -24) * 0.4;
    this.motes.rotation.z = Math.sin(this.time * 0.1) * 0.02;

    // monster visual (always animate so it looms even pre-start)
    this.monster._t += dt;
    this.monster.group.position.set(this.monsterX, MONSTER_Y, MONSTER_Z);
    // face the player horizontally: model faces +Z, rotate so it looks along ±X
    const toP = Math.sign(this.playerX - this.monsterX) || 1;
    this.monster.group.rotation.y = toP > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.monster._lookTarget.set(this.playerX, 1.6, 0);
    this.monster._animateVisual(dt);
    // hellish glow rides with the horror, brightening as it materialises + rages.
    // Set out in front so it reveals the wet flesh without blowing a hot core.
    this.monsterLight.position.set(this.monsterX, 1.5, MONSTER_Z + 2.0);
    this.monsterLight.intensity = (5 + this.dread * 13) * this.monster.materialize;
    // cool backlight rims the blobby silhouette out of the dark
    this.monsterRim.position.set(this.monsterX, 2.6, MONSTER_Z - 2.2);
    this.monsterRim.intensity = (3 + this.dread * 6) * this.monster.materialize;

    if (this.player) this.player.update(dt, { moving: Math.abs(this.vx) > 0.3, sprinting: this._sprint });

    this.postfx.update(dt, { time: this.time, dread: this.dread, pulse: Math.max(0, Math.sin(this.time * 3)) ** 3 * this.dread });
    this.scene.fog.density = this.baseFog + this.dread * 0.012;
    this.postfx.render();
  }

  _stepPlay(dt) {
    // ---- movement ----
    let dir = 0;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dir += 1;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dir -= 1;
    this._sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const maxV = this._sprint ? 6.5 : 3.6;
    this.vx = damp(this.vx, dir * maxV, 12, dt);
    this.playerX = clamp(this.playerX + this.vx * dt, 0, LEVEL_LEN);
    if (Math.abs(this.vx) > 0.3) this.facing = Math.sign(this.vx);

    // place + orient player (model faces +Z; turn to walk along ±X)
    if (this.player) {
      this.player.object.position.set(this.playerX, this._playerFootOffset || GROUND_Y, 0);
      // model faces +Z; +90° about Y turns it to face +X (walking right)
      this.player.object.rotation.y = this.facing > 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    // ---- camera follows on X, holding the player in the right third ----
    this.camera.position.x = damp(this.camera.position.x, this.playerX - CAM_OFFSET, 6, dt);
    this.camera.position.y = CAM_Y; this.camera.position.z = CAM_Z;
    this.camera.lookAt(this.camera.position.x, CAM_LOOK_Y, 0);
    this.playerLight.position.set(this.playerX, 1.3, 2.2);
    this.rim.position.set(this.playerX, 3.4, -4);

    // ---- checkpoints every 30m ----
    const cp = Math.floor(this.playerX / 30) * 30;
    if (cp > this.checkpoint) this.checkpoint = cp;

    // ---- the horror: emerges from behind, relentless, ramps with dread ----
    this.monster.materialize = clamp(this.monster.materialize + dt * 0.5, 0, 1);
    const gap = this.playerX - this.monsterX;                // >0 => behind you
    let chaseSpeed = 3.5 + this.dread * 2.6;                 // ~your walk; running (6.5) always escapes
    if (gap > 12) chaseSpeed = Math.max(chaseSpeed, 8);      // leash: never let it drop off-screen
    this.monsterX += Math.sign(gap || 1) * chaseSpeed * dt;
    this.monster.menace = clamp(0.5 + this.dread * 0.5, 0, 1);

    // ---- dread rises over time + when the horror looms close ----
    const prox = clamp((16 - Math.abs(gap)) / 16, 0, 1);
    this.dread = clamp(damp(this.dread, 0.2 + prox * 0.7 + Math.min(0.25, this.time * 0.003), 1.5, dt), 0, 1);

    // ---- catch / win ----
    if (Math.abs(gap) < 1.6 && this.monster.materialize > 0.6) {
      this._deaths = (this._deaths || 0) + 1;
      if (this._deaths >= 3) { this._lose(); return; }
      this._die();
    }
    if (this.playerX >= LEVEL_LEN - 1) this._win();

    // HUD
    const pct = Math.round((this.playerX / LEVEL_LEN) * 100);
    this.distEl.textContent = `${pct}%  ·  it is ${Math.max(0, Math.round(gap))}m behind`;
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h, this.renderer.getPixelRatio());
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { new SideScroller(); }
  catch (e) { console.error('sidescroller init error', e); const o = document.getElementById('fatal'); if (o) { o.style.display = 'flex'; o.textContent = 'Failed: ' + e.message; } }
});
