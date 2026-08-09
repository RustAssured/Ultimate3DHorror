// main.js — COSMIC FALL. State machine, sanity system, and the main loop.
import * as THREE from 'three';
import { clamp, damp, lerp } from './util.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { PostFX } from './postfx.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Stalker } from './creature.js';
import { Relics } from './relics.js';
import { HUD } from './hud.js';
import * as Story from './story.js';

const STATE = { TITLE: 'title', PROLOGUE: 'prologue', PLAY: 'play', PAUSED: 'paused', WIN: 'win', LOSE: 'lose' };

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.uiRoot = document.getElementById('ui');
    this.state = STATE.TITLE;
    this.time = 0;
    this.resolve = 1;
    this.dread = 0.12;
    this.pulse = 0;
    this._pulseT = 0;
    this._graceT = 0;
    this._spawnCd = 0;
    this._echoIndex = 0;
    this._prologueLine = 0;
    this._loseReason = '';
    this._ready = false;
    this._debug = null;

    this._initRenderer();
    this._initScene();
    this._initSystems();
    this._bindUI();
    this._onResize();
    window.addEventListener('resize', () => this._onResize());

    // expose for headless harness
    window.__game = this;
    this._ready = true;
    this._last = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // brightness presets (exposure + fog); index 1 is default. Adjustable in-game.
    this.brightnessLevels = [
      { name: 'DIM', exp: 1.7, fog: 0.022 },
      { name: 'NORMAL', exp: 2.1, fog: 0.017 },
      { name: 'BRIGHT', exp: 2.5, fog: 0.013 },
    ];
    this.brightness = 2; // default to the brightest preset; players can dim it
    this.renderer.toneMappingExposure = this.brightnessLevels[2].exp;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.set(0, 6, 30);
  }

  _initSystems() {
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.hud = new HUD(this.uiRoot);
    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.scene.add(this.player.object);
    this.player.reset(0, 22, this.world);
    this.stalker = new Stalker(this.scene);
    this.relics = new Relics(this.scene, this.world, 6);
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);

    // restore saved brightness preference
    try {
      const b = parseInt(localStorage.getItem('cf_brightness'), 10);
      if (!isNaN(b) && b >= 0 && b < this.brightnessLevels.length) this.brightness = b;
    } catch (e) { /* ignore */ }
    this.setBrightness(this.brightness);

    // optional: swap in a loaded glTF/GLB Warden (e.g. a Meshy export).
    // Configure by setting window.COSMIC_CONFIG before the game boots.
    const cfg = window.COSMIC_CONFIG || {};
    if (cfg.wardenModel) {
      this.player.setWardenModel(cfg.wardenModel, cfg.wardenModelOpts || {});
    }

    this.hud.showTitle(true);
    this.hud.showHUD(false);
  }

  _bindUI() {
    this.hud.startBtn.addEventListener('click', () => this._beginDescent());
    this.hud.resumeBtn.addEventListener('click', () => this._resume());
    this.hud.quitBtn.addEventListener('click', () => this._toTitle());
    this.hud.muteBtn.addEventListener('click', () => {
      this.audio.setMuted(!this.audio.muted);
      this.hud.setMuteLabel(this.audio.muted);
    });
    this.hud.brightBtn.addEventListener('click', () => {
      this.setBrightness((this.brightness + 1) % this.brightnessLevels.length);
    });
    this.hud.endBtn.addEventListener('click', () => this._restart());

    document.addEventListener('pointerlockchange', () => {
      // losing the lock mid-play (Esc) pauses
      if (this.state === STATE.PLAY && !this.input.locked && !this.hud.cardActive()) {
        this._pause();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === STATE.PLAY) this._pause();
        else if (this.state === STATE.PAUSED) this._resume();
      }
      if (e.code === 'KeyF' && this.state === STATE.PLAY && !this.hud.cardActive()) {
        this.player.toggleLantern(this.audio);
      }
    });
  }

  // ---------- transitions ----------
  _beginDescent() {
    this.audio.init();
    this.audio.resume();
    this.audio.startAmbient();
    this.hud.showTitle(false);
    this.hud.setMuteLabel(this.audio.muted);
    this._startPrologue();
  }

  _startPrologue() {
    this.state = STATE.PROLOGUE;
    this._prologueLine = 0;
    this.hud.showCard([Story.PROLOGUE[0]], null);
    this._prologueLine = 1;
  }

  _advancePrologue() {
    if (this._prologueLine < Story.PROLOGUE.length) {
      this.hud.showCard([Story.PROLOGUE[this._prologueLine]], null);
      this._prologueLine++;
    } else {
      this._enterPlay(true);
    }
  }

  _enterPlay(fresh) {
    this.state = STATE.PLAY;
    this.hud.showHUD(true);
    if (fresh) {
      this.hud.toast(Story.HINTS.start, 5);
      this._graceT = 14;
      setTimeout(() => this.hud.fadeControls(), 6000);
    }
    this.input.requestLock();
  }

  setBrightness(i) {
    this.brightness = i;
    const lvl = this.brightnessLevels[i];
    this.renderer.toneMappingExposure = lvl.exp;
    this.world.baseFog = lvl.fog;
    this.hud.setBrightnessLabel(lvl.name);
    try { localStorage.setItem('cf_brightness', String(i)); } catch (e) { /* ignore */ }
  }

  _pause() {
    if (this.state !== STATE.PLAY) return;
    this.state = STATE.PAUSED;
    this.hud.showPause(true);
    this.hud.setBrightnessLabel(this.brightnessLevels[this.brightness].name);
    this.input.exitLock();
  }
  _resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAY;
    this.hud.showPause(false);
    this.input.requestLock();
    this.audio.resume();
  }

  _toTitle() {
    this.state = STATE.TITLE;
    this.hud.showPause(false);
    this.hud.hideEnd();
    this.hud.showHUD(false);
    this.hud.showTitle(true);
    this.input.exitLock();
    this._resetRun();
  }

  _resetRun() {
    this.resolve = 1;
    this.dread = 0.12;
    this._tension = 0;
    this._echoIndex = 0;
    this._graceT = 14;
    this._spawnCd = 0;
    this._stalkerWasActive = false;
    this.player.reset(0, 22, this.world);
    this.stalker.reset();
    this.relics.reset();
    this.postfx.reset();
    this.hud.setObjective('Gather the Echoes');
    this.hud.setEchoes(0, this.relics.total);
    this.hud.setHurt(0);
  }

  _restart() {
    this.hud.hideEnd();
    this._resetRun();
    this._enterPlay(true);
  }

  _win() {
    if (this.state === STATE.WIN) return;
    this.state = STATE.WIN;
    this.hud.showHUD(false);
    this.hud.showEnd(true, 'ASCENT', Story.ENDING_WIN);
    this.audio.beaconHum();
    this.input.exitLock();
  }
  _lose(reason) {
    if (this.state === STATE.LOSE) return;
    this.state = STATE.LOSE;
    this._loseReason = reason;
    this.hud.showHUD(false);
    this.hud.showEnd(false, 'CONSUMED', Story.ENDING_LOSE);
    this.audio.stinger();
    this.postfx.triggerFlash(0.9);
    this.input.exitLock();
  }

  // ---------- sanity / dread model ----------
  _updateSanity(dt) {
    const p = this.player.getPosition();

    // safety = how lit / protected the player is right now
    let safety = 0.12; // dim ambient baseline
    if (this.player.lanternOn) safety += this.player.flicker * 0.55;

    // proximity to lit echoes / beacon
    const near = this.relics.nearestEcho(p);
    // standing in beacon light
    if (this.relics.active) {
      const bd = this.relics.beaconPos.distanceTo(p);
      if (bd < 14) safety += (1 - bd / 14) * 0.6;
    }

    // stalker pressure
    let stalkerPressure = 0;
    if (this.stalker.active) {
      const sd = this.stalker.distanceTo(this.player);
      if (sd < 14) stalkerPressure = clamp((14 - sd) / 14, 0, 1);
    }

    // the Sleeper's gaze: worse when its eye is open and roughly in view/below
    const gaze = this.world.sleeper.awakeness;

    safety = clamp(safety, 0, 1);

    // resolve regenerates in light, drains in dark / under pressure.
    // Darkness alone is a slow bleed (~13s); the Stalker's pressure is the
    // real killer.
    const regen = (safety - 0.42) * 0.14;
    const drain = stalkerPressure * 0.34 + gaze * 0.04;
    this.resolve = clamp(this.resolve + (regen - drain) * dt * 1.8, 0, 1);

    // escalating tension: the Sleeper stirs as you gather Echoes and as the
    // fall goes on — so the dark always comes for you eventually.
    const echoFrac = this.relics.total ? this.relics.collected / this.relics.total : 0;
    this._tension = Math.min(0.4, (this._tension || 0) + dt * 0.004);
    const floor = 0.12 + echoFrac * 0.32 + this._tension;

    // dread combines the floor, low resolve, and immediate threats
    const targetDread = clamp(
      Math.max(floor, floor + (1 - this.resolve) * 0.5) + stalkerPressure * 0.45 + gaze * 0.2,
      0, 1
    );
    this.dread = damp(this.dread, targetDread, 3, dt);

    // heartbeat pulse for the shader breathing
    this._pulseT += dt * (1.0 + this.dread * 1.4);
    this.pulse = Math.max(0, Math.sin(this._pulseT * Math.PI * 2)) ** 3;

    // loss condition: resolve fully gone
    if (this.resolve <= 0.0001) this._lose('resolve');

    return { stalkerPressure, safety };
  }

  _maybeSpawnStalker(dt) {
    this._graceT -= dt;
    if (this._graceT > 0) return;
    // detect a despawn (active -> inactive) and start a re-emergence cooldown
    if (this._stalkerWasActive && !this.stalker.active) {
      this._spawnCd = 7;
      this.hud.toast('The dark draws back… for now.', 3);
    }
    this._stalkerWasActive = this.stalker.active;

    if (!this.stalker.active) {
      this._spawnCd -= dt;
      if (this._spawnCd <= 0 && this.dread > 0.28) {
        this.stalker.spawn(this.player, this.world);
        this.audio.stinger();
        this.hud.toast(Story.HINTS.halfway, 3.5);
      }
    }
  }

  _updateCompass() {
    const p = this.player.getPosition();
    const target = this.relics.nearestEcho(p);
    if (!target) { this.hud.setCompass(0, null, false); return; }
    const to = new THREE.Vector3().subVectors(target.pos, p);
    const worldAngle = Math.atan2(to.x, to.z);
    const camForward = this.player.camYaw + Math.PI;
    let rel = worldAngle - camForward;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    // arrow: 0deg points up (ahead); rotate clockwise for right
    this.hud.setCompass(-rel * 180 / Math.PI, target.dist, !!target.beacon);
  }

  _handleEchoEvents(ev) {
    if (ev.collected != null) {
      this.resolve = clamp(this.resolve + 0.22, 0, 1);
      this.postfx.triggerGlitch(0.55); // the Sleeper feels the chord tighten
      this.hud.setEchoes(ev.collected, this.relics.total);
      const line = Story.ECHOES[this._echoIndex] || 'ECHO — the voice fades.';
      this._echoIndex++;
      this.hud.toast(line, 5);
      if (ev.collected === 1) this.hud.toast(Story.HINTS.firstEcho, 5);
      if (ev.remaining === 0) {
        this.hud.setObjective('REACH THE BEACON');
        this.hud.toast(Story.HINTS.allCollected, 6);
      } else {
        this.hud.setObjective(`Gather the Echoes · ${ev.remaining} left`);
      }
    }
    if (ev.reachedBeacon && this.relics.active) this._win();
  }

  // ---------- main loop ----------
  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.05) dt = 0.05; // clamp spikes
    this.time += dt;

    const playing = this.state === STATE.PLAY;

    // consume canvas clicks (advance cards / relock)
    const clicked = this.input.consumeClick();
    if (clicked) {
      if (this.hud.cardActive()) {
        const wasProlog = this.state === STATE.PROLOGUE;
        this.hud.advanceCard();
        if (!this.hud.cardActive() && wasProlog) this._advancePrologue();
      } else if (this.state === STATE.PLAY && !this.input.locked) {
        this.input.requestLock();
      }
    }
    // space also advances cards
    if (this.input.pressed('Space') && this.hud.cardActive()) {
      const wasProlog = this.state === STATE.PROLOGUE;
      this.hud.advanceCard();
      if (!this.hud.cardActive() && wasProlog) this._advancePrologue();
    }

    // update world always (ambient life continues under menus)
    this.world.update(dt, this.dread);

    if (playing) {
      this._stepPlay(dt);
      if (this._freeCam) this._applyFreeCam();
    } else {
      // keep camera framing alive on menus by gently updating player cam only
      this.player.update(dt, this.input, this.world, this.camera, { allowControl: false });
    }

    // audio + postfx
    this.audio.setDread(this.dread);
    this.audio.update(dt);
    this.hud.update(dt);
    this.postfx.update(dt, { time: this.time, dread: this.dread, pulse: this.pulse });

    this.postfx.render();
  }

  // one simulation step of active gameplay (shared by loop + debug simulator)
  _stepPlay(dt) {
    const step = this.player.update(dt, this.input, this.world, this.camera, { allowControl: !this._freeCam, freeCam: !!this._freeCam });
    if (step.stepped) this.audio.step();

    const s = this._updateSanity(dt);
    const stalkerPressure = s.stalkerPressure;
    this._maybeSpawnStalker(dt);

    // reality tears: brief Mouth-of-Madness glitches as dread mounts
    if (this.dread > 0.5 && Math.random() < dt * (this.dread - 0.45) * 1.6) {
      this.postfx.triggerGlitch(0.35 + Math.random() * 0.5);
    }

    const res = this.stalker.update(dt, this.player, this.world, this.dread, this.camera);
    if (res.caught) this._lose('caught');
    // the world tears harder the closer the thing gets
    if (this.stalker.active) {
      const sd = this.stalker.distanceTo(this.player);
      if (sd < 5) this.postfx.triggerGlitch(dt * (5 - sd) * 0.9);
    }

    const ev = this.relics.update(dt, this.player, this.audio);
    this._handleEchoEvents(ev);

    // fell into the void?
    const pp = this.player.getPosition();
    if (!this.world.inBounds(pp.x, pp.z) && this.world.solidity(pp.x, pp.z) < 0.15) {
      this._lose('void');
    }

    // HUD meters
    this.hud.setResolve(this.resolve);
    this.hud.setFuel(this.player.fuel);
    this.hud.setHurt(clamp((1 - this.resolve) * 0.35 + stalkerPressure * 0.4, 0, 0.6));
    this._updateCompass();
  }

  // deterministic fixed-step advance for headless testing (bypasses rAF throttling)
  _debugSimulate(seconds, dt = 1 / 60) {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      if (this.state !== STATE.PLAY) break;
      this.time += dt;
      this.world.update(dt, this.dread);
      this._stepPlay(dt);
      this.audio.setDread(this.dread);
    }
    return { state: this.state, resolve: this.resolve, dread: this.dread, stalker: this.stalker.active };
  }

  // --- debug free camera for diagnostics ---
  setFreeCam(camPos, target) {
    this._freeCam = true;
    this._freeCamPose = { camPos, target };
    this._applyFreeCam();
  }
  _applyFreeCam() {
    if (!this._freeCamPose) return;
    const { camPos, target } = this._freeCamPose;
    this.camera.position.set(camPos[0], camPos[1], camPos[2]);
    this.camera.lookAt(target[0], target[1], target[2]);
  }
  clearFreeCam() { this._freeCam = false; this._freeCamPose = null; }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h, this.renderer.getPixelRatio());
  }
}

// boot
window.addEventListener('DOMContentLoaded', () => {
  try {
    new Game();
  } catch (err) {
    console.error('Fatal init error', err);
    const o = document.getElementById('fatal');
    if (o) { o.style.display = 'flex'; o.textContent = 'Failed to start: ' + err.message; }
  }
});
