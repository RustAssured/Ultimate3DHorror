// hud.js — DOM heads-up display, narrative cards, and menus.
// Builds its own DOM under a root element so index.html stays minimal.

export class HUD {
  constructor(root) {
    this.root = root;
    this._card = { active: false, lines: [], line: 0, chars: 0, speed: 42, cb: null, hold: 0 };
    this._toast = { text: '', t: 0 };
    this._build();
  }

  _el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || this.root).appendChild(e);
    return e;
  }

  _build() {
    // ---- in-game HUD ----
    this.hud = this._el('div', 'hud hidden');

    // reticle
    this.reticle = this._el('div', 'reticle', this.hud);

    // top-left: objective + echo count
    const tl = this._el('div', 'panel top-left', this.hud);
    this.objectiveEl = this._el('div', 'objective', tl, 'Gather the Echoes');
    this.echoEl = this._el('div', 'echoes', tl, 'Echoes 0 / 6');

    // bottom-left: meters
    const bl = this._el('div', 'panel bottom-left', this.hud);
    this._el('div', 'meter-label', bl, 'RESOLVE');
    const rw = this._el('div', 'meter', bl);
    this.resolveBar = this._el('div', 'bar resolve', rw);
    this._el('div', 'meter-label', bl, 'LANTERN');
    const lw = this._el('div', 'meter', bl);
    this.fuelBar = this._el('div', 'bar fuel', lw);

    // bottom-center: compass to nearest objective
    this.compass = this._el('div', 'compass', this.hud, '<span class="arrow">▲</span><span class="cdist"></span>');
    this.compassArrow = this.compass.querySelector('.arrow');
    this.compassDist = this.compass.querySelector('.cdist');

    // controls hint (fades)
    this.controls = this._el('div', 'controls-hint', this.hud,
      'WASD move · Mouse look · Shift sprint · F lantern · Esc pause');

    // damage vignette (red pulse handled mostly in shader; this is a subtle DOM layer)
    this.hurt = this._el('div', 'hurt-overlay', this.hud);

    // ---- narrative card ----
    this.cardWrap = this._el('div', 'card-wrap hidden');
    this.cardText = this._el('div', 'card-text', this.cardWrap);
    this.cardHint = this._el('div', 'card-hint', this.cardWrap, 'click / space to continue');

    // ---- toast (subtitle line) ----
    this.toastEl = this._el('div', 'toast hidden');

    // ---- Title menu ----
    this.title = this._el('div', 'screen title-screen');
    this._el('div', 'game-title', this.title, 'COSMIC&nbsp;FALL');
    this._el('div', 'game-sub', this.title, 'A descent into the falling dark');
    this.startBtn = this._el('button', 'btn primary', this.title, 'DESCEND');
    this._el('div', 'title-controls', this.title,
      'WASD move · Mouse look · Shift sprint · F lantern · Esc pause<br>Best played with sound on, in the dark.');
    this._el('div', 'credit', this.title, 'A one-session procedural horror · no assets, no engine');

    // ---- Pause menu ----
    this.pause = this._el('div', 'screen pause-screen hidden');
    this._el('div', 'screen-title', this.pause, 'PAUSED');
    this.resumeBtn = this._el('button', 'btn', this.pause, 'RESUME');
    this.muteBtn = this._el('button', 'btn', this.pause, 'SOUND: ON');
    this.quitBtn = this._el('button', 'btn', this.pause, 'ABANDON THE FALL');

    // ---- End screen ----
    this.end = this._el('div', 'screen end-screen hidden');
    this.endTitle = this._el('div', 'screen-title', this.end, '');
    this.endText = this._el('div', 'end-text', this.end, '');
    this.endBtn = this._el('button', 'btn primary', this.end, 'AGAIN');
  }

  // ---------- HUD API ----------
  showHUD(on) { this.hud.classList.toggle('hidden', !on); }

  setObjective(text) { this.objectiveEl.textContent = text; }
  setEchoes(n, total) { this.echoEl.textContent = `Echoes ${n} / ${total}`; }
  setResolve(v) {
    const pct = Math.round(v * 100);
    this.resolveBar.style.width = pct + '%';
    this.resolveBar.classList.toggle('low', v < 0.3);
  }
  setFuel(v) {
    this.fuelBar.style.width = Math.round(v * 100) + '%';
    this.fuelBar.classList.toggle('low', v < 0.22);
  }
  setHurt(a) { this.hurt.style.opacity = a; }
  fadeControls() { this.controls.classList.add('fade'); }

  // compass: angleDeg = bearing to target relative to camera forward (0 = ahead)
  setCompass(angleDeg, dist, beacon) {
    this.compassArrow.style.transform = `rotate(${angleDeg}deg)`;
    this.compassArrow.style.color = beacon ? '#9fe0ff' : '#ffd76a';
    this.compassDist.textContent = dist != null ? `${Math.round(dist)}m` : '';
  }

  toast(text, dur = 3.2) { this._toast = { text, t: dur }; this.toastEl.textContent = text; this.toastEl.classList.remove('hidden'); }

  // ---------- narrative card ----------
  showCard(lines, cb) {
    this._card = { active: true, lines: Array.isArray(lines) ? lines : [lines], line: 0, chars: 0, speed: 42, cb: cb || null, hold: 0, done: false };
    this.cardWrap.classList.remove('hidden');
    this.cardText.textContent = '';
    this.cardHint.style.opacity = 0;
  }
  cardActive() { return this._card.active; }
  // advance on click/space: finish typing current, or close
  advanceCard() {
    const c = this._card;
    if (!c.active) return;
    const full = c.lines.join('\n');
    if (c.chars < full.length) {
      c.chars = full.length; // reveal all
      this.cardText.textContent = full;
      this.cardHint.style.opacity = 1;
      c.done = true;
    } else {
      this._closeCard();
    }
  }
  _closeCard() {
    this._card.active = false;
    this.cardWrap.classList.add('hidden');
    const cb = this._card.cb;
    this._card.cb = null;
    if (cb) cb();
  }

  // ---------- screens ----------
  showTitle(on) { this.title.classList.toggle('hidden', !on); }
  showPause(on) { this.pause.classList.toggle('hidden', !on); }
  showEnd(win, titleText, lines) {
    this.end.classList.remove('hidden');
    this.endTitle.textContent = titleText;
    this.endTitle.style.color = win ? '#bfe6ff' : '#ff6a6a';
    this.endText.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    this.end.classList.toggle('win', win);
    this.end.classList.toggle('lose', !win);
  }
  hideEnd() { this.end.classList.add('hidden'); }
  setMuteLabel(muted) { this.muteBtn.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON'; }

  // ---------- per-frame ----------
  update(dt) {
    // typewriter
    const c = this._card;
    if (c.active && !c.done) {
      const full = c.lines.join('\n');
      c.chars = Math.min(full.length, c.chars + c.speed * dt);
      this.cardText.textContent = full.slice(0, Math.floor(c.chars));
      if (Math.floor(c.chars) >= full.length) {
        c.done = true;
        this.cardHint.style.opacity = 1;
      }
    }
    // toast fade
    if (this._toast.t > 0) {
      this._toast.t -= dt;
      const a = Math.min(1, this._toast.t);
      this.toastEl.style.opacity = a;
      if (this._toast.t <= 0) this.toastEl.classList.add('hidden');
    }
  }
}
