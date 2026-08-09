// audio.js — fully procedural WebAudio. No asset files.
// A layered dread engine: sub drone, airy pad, wind noise bed, heartbeat that
// quickens with dread, whisper swells, plus one-shot SFX.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.dread = 0;      // 0..1 drives heartbeat + whisper intensity
    this.muted = false;
    this._hbTime = 0;
    this._whisperTime = 3;
    this._started = false;
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);
    this.enabled = true;
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (e) { /* ignore */ }
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.linearRampToValueAtTime(m ? 0.0 : 0.9, t + 0.4);
    }
  }

  // Start the persistent ambient beds. Idempotent.
  startAmbient() {
    if (!this.enabled || this._started) return;
    this._started = true;
    const ctx = this.ctx;

    // fade master in
    this.master.gain.setValueAtTime(0.0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.9, ctx.currentTime + 2.5);

    // --- Sub drone: two detuned oscillators ---
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.18;
    droneGain.connect(this.master);
    [40, 40.4, 60.2].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.25 : 0.5;
      o.connect(g).connect(droneGain);
      o.start();
    });
    // slow LFO on drone volume
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.08;
    lfo.connect(lfoGain).connect(droneGain.gain);
    lfo.start();
    this.droneGain = droneGain;

    // --- Wind: filtered noise ---
    const noiseBuf = this._noiseBuffer(4);
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuf;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 500;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windFilter).connect(windGain).connect(this.master);
    wind.start();
    // slow filter sweep for "breathing" wind
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.05;
    const windLfoG = ctx.createGain();
    windLfoG.gain.value = 300;
    windLfo.connect(windLfoG).connect(windFilter.frequency);
    windLfo.start();
    this.windGain = windGain;
    this.windFilter = windFilter;

    // --- High shimmer pad (adds unease) ---
    const pad = ctx.createGain();
    pad.gain.value = 0.0;
    pad.connect(this.master);
    [220, 277, 330].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.2;
      o.connect(g).connect(pad);
      o.start();
    });
    this.padGain = pad;
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // brown-ish noise
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  setDread(d) { this.dread = Math.max(0, Math.min(1, d)); }

  // pad + wind intensify with dread
  update(dt) {
    if (!this.enabled || !this._started || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    if (this.padGain) {
      const target = 0.015 + this.dread * 0.09;
      this.padGain.gain.setTargetAtTime(target, t, 0.5);
    }
    if (this.windGain) {
      this.windGain.gain.setTargetAtTime(0.04 + this.dread * 0.06, t, 0.5);
    }

    // heartbeat: interval shrinks as dread rises
    this._hbTime -= dt;
    if (this._hbTime <= 0) {
      const bpm = 52 + this.dread * 78;         // 52 -> 130
      const interval = 60 / bpm;
      this._heartbeat(0.12 + this.dread * 0.4);
      // double-thump
      setTimeout(() => this._heartbeat(0.08 + this.dread * 0.3), interval * 260);
      this._hbTime = interval;
    }

    // whispers: random swells when dread is high
    this._whisperTime -= dt;
    if (this._whisperTime <= 0) {
      if (this.dread > 0.35 && Math.random() < 0.6) this._whisper();
      this._whisperTime = 2 + Math.random() * 4 * (1.2 - this.dread);
    }
  }

  _heartbeat(vol) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  _whisper() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200 + Math.random() * 1400;
    bp.Q.value = 6;
    const g = ctx.createGain();
    const dur = 0.8 + Math.random() * 1.2;
    const vol = 0.05 + this.dread * 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    // formant wobble
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4 + Math.random() * 6;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 400;
    lfo.connect(lfoG).connect(bp.frequency);
    lfo.start(t);
    lfo.stop(t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  // ---- one-shot SFX ----
  _tone(freq, dur, type = 'sine', vol = 0.2, glideTo = null) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  pickup() {
    // ethereal ascending chime
    this._tone(523.25, 0.5, 'sine', 0.18, 784);
    this._tone(659.25, 0.7, 'triangle', 0.12, 987);
  }

  stinger() {
    // horror stab
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.6);
    this._tone(160, 0.6, 'sawtooth', 0.3, 40);
  }

  beaconHum() {
    this._tone(196, 1.6, 'sine', 0.16, 294);
    this._tone(294, 1.6, 'sine', 0.1, 392);
  }

  step() {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.15);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.14);
  }
}
