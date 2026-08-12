// lab.js — Character Lab: a standalone studio to inspect and iterate the
// Warden and the monster in isolation (turntable, lighting, animation, sliders).
// Reuses the exact same Player / Stalker classes as the game.
import * as THREE from 'three';
import { PostFX } from './postfx.js';
import { Player } from './player.js';
import { Stalker } from './creature.js';
import { loadGLTF, normalizeToHeight, patchLivingFlesh } from './models.js';
import { MeshyRig, MONSTER2_RIG } from './meshyrig.js';
import { clamp, damp } from './util.js';

class Lab {
  constructor() {
    this.canvas = document.getElementById('lab');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0d12);
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);

    this._buildStudio();

    // subjects (both live in the scene; we show one at a time)
    this.player = new Player(this.scene);
    this.scene.add(this.player.object);   // Player ctor doesn't self-add (the game does)
    this.player.pos.set(0, 0, 0);
    this.player.object.position.set(0, 0, 0);
    this.stalker = new Stalker(this.scene);

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    // state
    this.subject = 'warden';
    this.animSpeed = 0;          // 0 idle, 3.5 walk, 7 run
    this.materialize = 1;
    this.menace = 0.6;
    this.autoRotate = true;
    this.wire = false;
    this.yaw = 0;
    this.camYaw = 0.5; this.camPitch = 0.15; this.camDist = 6;
    this.target = new THREE.Vector3(0, 1.2, 0);
    this._camPos = new THREE.Vector3();

    // optional Meshy-generated body (appears as a toggle once committed)
    this.useMeshy = false; this.meshyBody = null; this._meshyMats = []; this._meshyBaseY = 0.4;
    this._buildUI();
    this._bindOrbit();
    this._tryLoadMeshyBody();
    this._show('warden');
    this._onResize();
    window.addEventListener('resize', () => this._onResize());

    this._last = performance.now();
    window.__lab = this;
    requestAnimationFrame((t) => this._loop(t));
  }

  _buildStudio() {
    // gradient backdrop so dark silhouettes read
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(80, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uTop: { value: new THREE.Color(0x1a2230) }, uBot: { value: new THREE.Color(0x070a0f) } },
        vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'varying vec3 vD; uniform vec3 uTop,uBot; void main(){ float h=vD.y*0.5+0.5; gl_FragColor=vec4(mix(uBot,uTop,smoothstep(0.0,1.0,h)),1.0);} ',
      })
    );
    this.scene.add(sky);

    // key light (physical units)
    this.key = new THREE.SpotLight(0xfff0e0, 1500, 40, Math.PI / 4.5, 0.5, 1.2);
    this.key.position.set(5, 8, 7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0005;
    this.scene.add(this.key);
    this.scene.add(this.key.target);
    // cold rim from behind
    this.rim = new THREE.SpotLight(0x7a96ff, 950, 40, Math.PI / 4, 0.6, 1.2);
    this.rim.position.set(-6, 6, -7);
    this.scene.add(this.rim); this.scene.add(this.rim.target);
    // magenta kicker (From-Beyond vibe)
    this.kick = new THREE.PointLight(0xff2f8a, 220, 22, 1.8);
    this.kick.position.set(-3.5, 2.5, 4);
    this.scene.add(this.kick);
    // soft ambient
    this.scene.add(new THREE.HemisphereLight(0x3a4a63, 0x0d1119, 1.8));

    // ground disc
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(8, 48),
      new THREE.MeshStandardMaterial({ color: 0x11141b, roughness: 0.9, metalness: 0.1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    // grid ring accents
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.0, 64),
      new THREE.MeshBasicMaterial({ color: 0x2b6f8f, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; this.scene.add(ring);
  }

  _show(which) {
    this.subject = which;
    const warden = which === 'warden';
    this.player.object.visible = warden;
    if (!warden) { // douse warden lights while hidden
      this.player.lanternOn = false;
    } else {
      this.player.lanternOn = this.lanternOn !== false;
    }
    this.stalker.active = !warden;
    this.stalker.group.visible = !warden;
    if (!warden) { this.stalker.materialize = this.materialize; }
    this.target.set(0, warden ? 1.15 : 2.2, 0);
    this.camDist = warden ? 5.5 : 8;
    // per-subject studio intensity: flesh is far more reflective than the coat
    this.key.intensity = warden ? 1500 : 240;
    this.rim.intensity = warden ? 950 : 200;
    this.kick.intensity = warden ? 220 : 120;
    if (this.meshyBody) this._applyMeshy();
    this._applyWire();
    this._syncUI();
  }

  _applyWire() {
    const set = (root) => root.traverse((o) => { if (o.isMesh && o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => (m.wireframe = this.wire));
      else o.material.wireframe = this.wire;
    }});
    set(this.subject === 'warden' ? this.player.object : this.stalker.group);
  }

  _buildUI() {
    const root = document.getElementById('ui');
    const panel = document.createElement('div'); panel.className = 'panel'; root.appendChild(panel);
    this._panel = panel;
    const h = (t) => { const e = document.createElement('div'); e.className = 'h'; e.textContent = t; panel.appendChild(e); };
    const btn = (t, fn) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; panel.appendChild(b); return b; };
    const row = () => { const r = document.createElement('div'); r.className = 'row'; panel.appendChild(r); return r; };
    const slider = (label, min, max, val, step, fn) => {
      const wrap = document.createElement('label'); wrap.className = 'sl';
      wrap.innerHTML = `<span>${label}</span>`;
      const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.value = val; i.step = step;
      i.oninput = () => fn(parseFloat(i.value)); wrap.appendChild(i); panel.appendChild(wrap); return i;
    };

    h('SUBJECT');
    const sr = row();
    this._wardenBtn = document.createElement('button'); this._wardenBtn.textContent = 'WARDEN'; this._wardenBtn.onclick = () => this._show('warden'); sr.appendChild(this._wardenBtn);
    this._monBtn = document.createElement('button'); this._monBtn.textContent = 'MONSTER'; this._monBtn.onclick = () => this._show('monster'); sr.appendChild(this._monBtn);

    h('WARDEN ANIMATION');
    const ar = row();
    this._idleBtn = document.createElement('button'); this._idleBtn.textContent = 'IDLE'; this._idleBtn.onclick = () => { this.animSpeed = 0; this._syncUI(); }; ar.appendChild(this._idleBtn);
    this._walkBtn = document.createElement('button'); this._walkBtn.textContent = 'WALK'; this._walkBtn.onclick = () => { this.animSpeed = 3.5; this._syncUI(); }; ar.appendChild(this._walkBtn);
    this._runBtn = document.createElement('button'); this._runBtn.textContent = 'RUN'; this._runBtn.onclick = () => { this.animSpeed = 7; this._syncUI(); }; ar.appendChild(this._runBtn);
    this._lanternBtn = btn('LANTERN: ON', () => { this.lanternOn = !(this.lanternOn !== false); this.player.lanternOn = this.lanternOn; this._syncUI(); });

    h('MONSTER');
    slider('Materialize', 0, 1, 1, 0.01, (v) => { this.materialize = v; });
    slider('Menace', 0, 1, 0.6, 0.01, (v) => { this.menace = v; });

    h('VIEW');
    const vr = row();
    this._rotBtn = document.createElement('button'); this._rotBtn.textContent = 'AUTO-ROTATE: ON'; this._rotBtn.onclick = () => { this.autoRotate = !this.autoRotate; this._syncUI(); }; vr.appendChild(this._rotBtn);
    this._wireBtn = document.createElement('button'); this._wireBtn.textContent = 'WIREFRAME: OFF'; this._wireBtn.onclick = () => { this.wire = !this.wire; this._applyWire(); this._syncUI(); }; vr.appendChild(this._wireBtn);

    const hint = document.createElement('div'); hint.className = 'hint';
    hint.textContent = 'drag to orbit · scroll to zoom';
    panel.appendChild(hint);
    const back = document.createElement('a'); back.href = './index.html'; back.className = 'back'; back.textContent = '← back to game';
    panel.appendChild(back);
  }

  _syncUI() {
    const on = (b, active) => b && b.classList.toggle('active', active);
    on(this._wardenBtn, this.subject === 'warden');
    on(this._monBtn, this.subject === 'monster');
    on(this._idleBtn, this.animSpeed === 0);
    on(this._walkBtn, this.animSpeed === 3.5);
    on(this._runBtn, this.animSpeed === 7);
    if (this._rotBtn) this._rotBtn.textContent = 'AUTO-ROTATE: ' + (this.autoRotate ? 'ON' : 'OFF');
    if (this._wireBtn) this._wireBtn.textContent = 'WIREFRAME: ' + (this.wire ? 'ON' : 'OFF');
    if (this._lanternBtn) this._lanternBtn.textContent = 'LANTERN: ' + ((this.lanternOn !== false) ? 'ON' : 'OFF');
  }

  // Load an optional Meshy-generated body. Gated behind a config path so there
  // is no 404 until a model is actually wired up.
  _tryLoadMeshyBody() {
    const path = (window.COSMIC_CONFIG && window.COSMIC_CONFIG.monsterModel) || window.LAB_MONSTER_MODEL;
    if (!path) return;
    this._loadMeshyBody(path);
  }

  async _loadMeshyBody(path) {
    try {
      const gltf = await loadGLTF(path);
      const { root } = normalizeToHeight(gltf.scene, 3.4);
      root.position.y = this._meshyBaseY;
      this._livingU = [];
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.frustumCulled = false;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { m.transparent = true; this._meshyMats.push(m); this._livingU.push(patchLivingFlesh(m)); });
        }
      });
      root.visible = false;
      this.scene.add(root);
      this.meshyBody = root;
      // attach the procedural rig (socket tentacles + living eye) in body-local space
      this.meshyRig = new MeshyRig(root, MONSTER2_RIG, { debug: !!window.LAB_RIG_DEBUG });
      this._addMeshyToggle();
      // default to showing the freshly-loaded Meshy body
      this.useMeshy = true;
      this._applyMeshy();
      if (this._meshyBtn) { this._meshyBtn.textContent = 'BODY: MESHY'; this._meshyBtn.classList.add('active'); }
      console.log('Meshy body loaded');
    } catch (e) {
      // no monster.glb committed yet — the toggle simply won't appear
    }
  }

  _addMeshyToggle() {
    const b = document.createElement('button');
    b.textContent = 'BODY: PROCEDURAL';
    b.style.marginTop = '10px';
    b.onclick = () => {
      this.useMeshy = !this.useMeshy;
      this._applyMeshy();
      b.textContent = 'BODY: ' + (this.useMeshy ? 'MESHY' : 'PROCEDURAL');
      b.classList.toggle('active', this.useMeshy);
    };
    this._meshyBtn = b;
    this._panel.appendChild(b);
  }

  _applyMeshy() {
    const s = this.stalker;
    const proc = !this.useMeshy;
    // procedural body/eyes/mouth off when the Meshy body drives the look
    s.body.visible = proc;
    if (s.mouth) s.mouth.visible = proc;
    for (const e of s.eyes) e.group.visible = proc;
    // hide the placeholder procedural tentacles when the Meshy rig drives them
    for (const t of s.tentacles) t.mesh.visible = proc;
    if (this.meshyBody) this.meshyBody.visible = this.useMeshy && this.subject === 'monster';
    // the baked PBR bake is brighter than our flesh — soften the studio for it
    if (this.subject === 'monster') {
      this.key.intensity = this.useMeshy ? 90 : 240;
      this.rim.intensity = this.useMeshy ? 70 : 200;
      this.kick.intensity = this.useMeshy ? 60 : 120;
    }
  }

  _bindOrbit() {
    let dragging = false, px = 0, py = 0;
    this.canvas.addEventListener('mousedown', (e) => { dragging = true; px = e.clientX; py = e.clientY; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      this.camYaw -= (e.clientX - px) * 0.006;
      this.camPitch = clamp(this.camPitch + (e.clientY - py) * 0.006, -0.4, 1.2);
      px = e.clientX; py = e.clientY;
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.camDist = clamp(this.camDist + e.deltaY * 0.005, 2.5, 14);
    }, { passive: true });
  }

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    let dt = (now - this._last) / 1000; this._last = now;
    if (dt > 0.05) dt = 0.05;

    if (this.autoRotate) this.yaw += dt * 0.5;

    if (this.subject === 'warden') {
      this.player.fuel = 1; // never run dry in the lab
      this.player.labUpdate(dt, { speed: this.animSpeed, facing: this.yaw });
      // suppress the gameplay god-ray beam; keep the lantern a gentle warm ember
      if (this.player.beamCone) this.player.beamCone.visible = false;
      this.player.beam.intensity = 0;
      this.player.glow.intensity = 16 * (this.player.lanternOn ? this.player.flicker : 0);
    } else {
      this.stalker.labUpdate(dt, { materialize: this.materialize, menace: this.menace, yaw: this.yaw, lookTarget: this.camera.position });
      // drive the optional Meshy body (breathing + materialize fade + spin)
      if (this.useMeshy && this.meshyBody) {
        this.meshyBody.rotation.y = this.yaw;
        for (const m of this._meshyMats) m.opacity = this.materialize;
        // drive the living-skin shader (breathing/wet/veins/gross scale with menace)
        const t = now / 1000;
        for (const u of (this._livingU || [])) { u.uTime.value = t; u.uMenace.value = this.menace; u.uMat.value = this.materialize; }
        // drive the socket tentacles + living eye
        if (this.meshyRig) this.meshyRig.update(dt, { menace: this.menace, materialize: this.materialize, lookTarget: this.camera.position });
      }
    }

    // orbit camera
    const off = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch),
      Math.cos(this.camYaw) * Math.cos(this.camPitch)
    );
    const desired = this.target.clone().addScaledVector(off, this.camDist);
    this._camPos.lerp ? this._camPos.copy(desired) : (this._camPos = desired.clone());
    this.camera.position.copy(desired);
    this.camera.lookAt(this.target);
    this.key.target.position.copy(this.target); this.rim.target.position.copy(this.target);

    this.postfx.update(dt, { time: now / 1000, dread: 0, pulse: 0 });
    this.postfx.render();
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h, this.renderer.getPixelRatio());
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { new Lab(); }
  catch (e) { console.error('Lab init error', e); const o = document.getElementById('fatal'); if (o) { o.style.display = 'flex'; o.textContent = 'Lab failed: ' + e.message; } }
});
