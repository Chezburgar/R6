import * as THREE from 'three';
import { Assets } from './core/Assets.js';
import { Input } from './core/Input.js';
import { AudioEngine } from './core/AudioEngine.js';
import { Menu, MenuScene, OperatorSelect } from './ui/Menu.js';
import { Game } from './game/Game.js';
import { Operators, OperatorById } from './data/operators.js';
import { getMaterial } from './map/Materials.js';

const MANIFEST = {
  wpn_ar: 'assets/models/weapons/ar.glb', wpn_smg: 'assets/models/weapons/smg.glb', wpn_shotgun: 'assets/models/weapons/shotgun.glb', wpn_pistol: 'assets/models/weapons/pistol.glb',
  op_sledge: 'assets/models/operators/sledge.glb', op_thatcher: 'assets/models/operators/thatcher.glb', op_ash: 'assets/models/operators/ash.glb', op_thermite: 'assets/models/operators/thermite.glb', op_lion: 'assets/models/operators/lion.glb',
  prop_drone: 'assets/models/props/drone.glb', prop_defuser: 'assets/models/props/defuser.glb',
  op_rook: 'assets/models/operators/rook.glb', op_frost: 'assets/models/operators/frost.glb', op_kapkan: 'assets/models/operators/kapkan.glb', op_bandit: 'assets/models/operators/bandit.glb',
};
const TIPS = ['Headshots are lethal regardless of health.', 'Reinforce walls during the preparation phase — you have 10 per team.', 'Soft walls can be shot through. Bullets lose damage with every surface they penetrate.', 'Hold F on a soft wall as a defender to reinforce it. Thermite burns through reinforcements.', 'Downed operators can be revived by teammates — finish them or cover the body.', 'Attackers can rappel exterior walls: press F facing a wall from outside.', 'Bandit\'s shock wire destroys Thermite charges on contact. Thatcher\'s EMP disables it.', 'Lean with Q and E to peek corners without exposing your body.', 'Press B to switch fire mode. Semi-auto is easier to control at range.', 'The defuser must be planted inside a bomb site. Defenders have 45 seconds to disable it.'];

const DEFAULTS = {
  name: 'Operator', renown: 148560, credits: 1200, sens: 6, adsSens: 75, fov: 74, shadows: 'high', bloom: true, master: 0.8, sfx: 1, ui: 0.7, ambience: 0.6, music: 0.6, invertY: false, skin: 'default', quality: 'high', showFps: false,
  game: { preset: 'casual', side: 'atk', site: 'random', difficulty: 'normal' }, loadouts: {}, career: { matches: 0, wins: 0, kills: 0, deaths: 0, headshots: 0 },
};

class App {
  constructor() {
    this.canvas = document.getElementById('gl'); this.uiRoot = document.getElementById('ui');
    this.settings = this.loadSettings();
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(this.pixelRatioFor(this.settings.quality));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92; r.outputColorSpace = THREE.SRGBColorSpace;
    this.clock = new THREE.Clock(); this.game = null; this.mode = 'boot';
    window.addEventListener('resize', () => this.resize());
    Input.attach(this.canvas);
    Input.onLockChange = (locked) => { if (!locked && this.game && this.mode === 'game' && !this.game.over && this.game.match.phase !== 'opselect' && this.game.match.phase !== 'roundEnd' && this.game.match.phase !== 'matchEnd') this.pause(true); };
    // Chrome swallows the Escape keydown that exits pointer lock, other browsers deliver both: only act once
    window.addEventListener('keydown', e => { if (e.code === 'Escape' && performance.now() - Input.lastLockChange > 150) this.onEscape(); });
  }
  // render scale per preset: performance renders at 85% of CSS pixels, medium 1:1, high/ultra supersample on HiDPI screens
  pixelRatioFor(q) { return q === 'performance' ? Math.min(window.devicePixelRatio, 1) * 0.85 : q === 'ultra' ? Math.min(window.devicePixelRatio, 2) : q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 1); }
  loadSettings() { try { const s = JSON.parse(localStorage.getItem('r6.settings') || '{}'); return { ...DEFAULTS, ...s, game: { ...DEFAULTS.game, ...(s.game || {}) }, career: { ...DEFAULTS.career, ...(s.career || {}) } }; } catch (e) { return { ...DEFAULTS }; } }
  saveSettings() { try { localStorage.setItem('r6.settings', JSON.stringify(this.settings)); } catch (e) {} this.applyAudioSettings(); }
  applyAudioSettings() { const s = this.settings; AudioEngine.setVolume('master', s.master); AudioEngine.setVolume('sfx', s.sfx); AudioEngine.setVolume('ui', s.ui); AudioEngine.setVolume('ambience', s.ambience); AudioEngine.setVolume('music', s.music === undefined ? 0.6 : s.music); }

  async boot() {
    const fill = document.getElementById('boot-fill'), status = document.getElementById('boot-status'), tip = document.getElementById('boot-tip');
    tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    setInterval(() => { tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; }, 6000);
    Assets.onProgress = p => { fill.style.width = (p.done / p.total * 88) + '%'; status.textContent = 'LOADING ' + p.status; };
    await Assets.loadAll(MANIFEST);
    status.textContent = 'GENERATING MATERIALS'; fill.style.width = '92%';
    await new Promise(r => setTimeout(r, 30));
    for (const m of ['concrete', 'plaster', 'plasterGreen', 'plasterBlue', 'drywall', 'wood', 'woodLight', 'plank', 'tile', 'tileDark', 'carpet', 'metal', 'asphalt', 'dirt', 'ceiling', 'roof', 'paper', 'fabric']) { getMaterial(m); }
    fill.style.width = '100%'; status.textContent = 'READY';
    this.menuScene = new MenuScene(this);
    this.menu = new Menu(this, this.uiRoot);
    this.opSelect = new OperatorSelect(this, this.uiRoot, this.menu);
    const boot = document.getElementById('boot');
    const btn = document.createElement('button'); btn.className = 'btn primary start'; btn.textContent = 'PRESS TO START'; boot.querySelector('.boot-inner').appendChild(btn); boot.classList.add('ready');
    let started = false;
    const once = (e) => { if (e.code === 'Enter' || e.code === 'Space') start(); };
    const start = () => { if (started) return; started = true; window.removeEventListener('keydown', once); AudioEngine.init(); this.applyAudioSettings(); AudioEngine.click('ui'); AudioEngine.menuMusic(true); boot.classList.add('out'); setTimeout(() => boot.remove(), 700); this.mode = 'menu'; this.menu.showPage('home'); };
    btn.addEventListener('click', start);
    window.addEventListener('keydown', once);
    this.resize();
    this.loop();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h, false);
    if (this.game) this.game.resize(w, h);
  }

  // ---------- match lifecycle ----------
  startMatch() {
    const gs = this.settings.game;
    if (this.game) { this.game.dispose(); this.game = null; }
    this.menu.hide(); AudioEngine.menuMusic(false);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    this.game = new Game(this, this.settings, gs);
    this.game.resize(window.innerWidth, window.innerHeight);
    this.mode = 'game';
    this.settings.career.matches++; this.saveSettings();
    this.operatorSelectRound();
  }
  operatorSelectRound() {
    const g = this.game; const side = g.match.playerSide;
    g.hud.show(false); Input.unlock(); Input.wantLock = false;
    this.mode = 'opselect';
    const prev = g.playerOp && g.playerOp.side === side ? g.playerOp.id : null;
    this.opSelect.open(side, [], prev, (opId, loadout, extra) => {
      g.setupTeams(opId, loadout);
      g.playerWantsDefuser = !!(extra && extra.defuser);
      g.match.startRound();
      g.hud.show(true); this.mode = 'game'; Input.wantLock = true; Input.lock();
      this.showClickToPlay();
    }, 25);
  }
  showClickToPlay() {
    // pointer lock can only be re-acquired by a user gesture; show a hint until it's locked
    if (Input.locked) return;
    const o = document.createElement('div'); o.className = 'overlay'; o.style.background = 'rgba(0,0,0,.25)'; o.innerHTML = `<div class="box" style="text-align:center;cursor:pointer"><h2 style="margin:0">CLICK TO PLAY</h2><div class="label" style="margin-top:8px">MOUSE LOOK · WASD MOVE · ESC MENU</div></div>`;
    this.uiRoot.appendChild(o); const done = () => { o.remove(); Input.lock(); }; o.addEventListener('click', done);
    const iv = setInterval(() => { if (Input.locked || this.mode !== 'game') { clearInterval(iv); o.remove(); } }, 200);
  }
  roundEnd(playerWon, reason, M) {
    const o = document.createElement('div'); o.className = 'roundend';
    o.innerHTML = `<div class="big ${playerWon ? 'win' : 'lose'}">${playerWon ? 'ROUND WON' : 'ROUND LOST'}</div><div class="why">${reason}</div><div class="sc"><div class="${M.playerSide}"><b>${M.score.A}</b>YOU</div><div class="${M.playerSide === 'atk' ? 'def' : 'atk'}"><b>${M.score.B}</b>ENEMY</div></div>`;
    this.uiRoot.appendChild(o); setTimeout(() => o.remove(), 6500);
  }
  matchEnd(playerWon, M, stats) {
    const c = this.settings.career; c.kills += stats.kills; c.deaths += stats.deaths; c.headshots += stats.headshots; if (playerWon) c.wins++; this.settings.renown += 250 + stats.kills * 40 + (playerWon ? 300 : 0); this.saveSettings();
    Input.unlock(); Input.wantLock = false;
    this.overlay(playerWon ? 'VICTORY' : 'DEFEAT', `<div class="grid"><div><div class="label">FINAL SCORE</div><div class="value">${M.score.A} — ${M.score.B}</div></div><div><div class="label">KILLS / DEATHS</div><div class="value">${stats.kills} / ${stats.deaths}</div></div><div><div class="label">HEADSHOTS</div><div class="value">${stats.headshots}</div></div><div><div class="label">RENOWN EARNED</div><div class="value">+${250 + stats.kills * 40 + (playerWon ? 300 : 0)}</div></div></div>`, [{ label: 'RETURN TO MENU', primary: true, fn: () => this.leaveMatch() }]);
  }
  leaveMatch() { if (this.game) { this.game.dispose(); this.game = null; } Input.unlock(); Input.wantLock = false; this.mode = 'menu'; this.menu.showPage('home'); AudioEngine.menuMusic(true); }

  // ---------- pause / overlays ----------
  onEscape() {
    if (this.mode === 'game' && this.game) { if (this.paused) this.pause(false); else this.pause(true); }
    else if (this.mode === 'menu' && this.menu.page !== 'home') { AudioEngine.click('back'); this.menu.showPage('home'); }
    if (this.currentOverlay && this.mode !== 'game') this.closeOverlay();
  }
  pause(on) {
    if (!this.game) return; this.paused = on; this.game.paused = on;
    if (on) {
      Input.unlock(); Input.wantLock = false;
      this.overlay('PAUSED', `<div class="label">BORDER · ROUND ${this.game.match.round} · ${this.game.match.s.name}</div>`, [
        { label: 'RESUME', primary: true, fn: () => this.pause(false) }, { label: 'SETTINGS', fn: () => { this.closeOverlay(); this.openSettings(() => this.pause(true)); } }, { label: 'CONTROLS', fn: () => { this.closeOverlay(); this.openControls(() => this.pause(true)); } }, { label: 'LEAVE MATCH', danger: true, fn: () => { this.closeOverlay(); this.leaveMatch(); } }]);
    } else { this.closeOverlay(); Input.wantLock = true; Input.lock(); if (!Input.locked) this.showClickToPlay(); }
  }
  overlay(title, html, actions = [{ label: 'CLOSE', primary: true, fn: () => this.closeOverlay() }]) {
    this.closeOverlay();
    const o = document.createElement('div'); o.className = 'overlay'; o.innerHTML = `<div class="box"><h2>${title}</h2>${html}<div class="actions"></div></div>`;
    // a click already in flight (firing when pointer lock dropped) must not land on a button
    o.style.pointerEvents = 'none'; setTimeout(() => { o.style.pointerEvents = ''; }, 450);
    const acts = o.querySelector('.actions'); for (const a of actions) { const b = document.createElement('button'); b.className = 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''); b.textContent = a.label; b.addEventListener('click', () => { AudioEngine.click('ui'); a.fn(); }); acts.appendChild(b); }
    this.uiRoot.appendChild(o); this.currentOverlay = o; return o;
  }
  closeOverlay() { if (this.currentOverlay) { this.currentOverlay.remove(); this.currentOverlay = null; } }
  openSettings(onClose) {
    const s = this.settings;
    const html = `<div class="grid">
      <div><div class="label">PLAYER NAME</div><input type="text" id="s-name" value="${s.name}" maxlength="16"></div>
      <div><div class="label">MOUSE SENSITIVITY <span id="v-sens">${s.sens}</span></div><input type="range" id="s-sens" min="1" max="20" step="0.5" value="${s.sens}"></div>
      <div><div class="label">ADS SENSITIVITY % <span id="v-ads">${s.adsSens}</span></div><input type="range" id="s-ads" min="30" max="120" step="5" value="${s.adsSens}"></div>
      <div><div class="label">FIELD OF VIEW <span id="v-fov">${s.fov}</span></div><input type="range" id="s-fov" min="60" max="95" step="1" value="${s.fov}"></div>
      <div><div class="label">SHADOWS</div><div class="seg" id="s-shadows">${['off', 'medium', 'high', 'ultra'].map(v => `<button data-v="${v}" class="${s.shadows === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div><div class="label">BLOOM</div><div class="seg" id="s-bloom"><button data-v="1" class="${s.bloom ? 'on' : ''}">ON</button><button data-v="0" class="${!s.bloom ? 'on' : ''}">OFF</button></div></div>
      <div><div class="label">QUALITY <span style="color:#8a8f99">(performance: 85% scale, 1k shadows, no bloom/AA)</span></div><div class="seg" id="s-quality">${['performance', 'medium', 'high', 'ultra'].map(v => `<button data-v="${v}" class="${s.quality === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div><div class="label">FPS COUNTER</div><div class="seg" id="s-fps"><button data-v="0" class="${!s.showFps ? 'on' : ''}">OFF</button><button data-v="1" class="${s.showFps ? 'on' : ''}">ON</button></div></div>
      <div><div class="label">INVERT Y</div><div class="seg" id="s-invert"><button data-v="0" class="${!s.invertY ? 'on' : ''}">OFF</button><button data-v="1" class="${s.invertY ? 'on' : ''}">ON</button></div></div>
      <div><div class="label">MASTER VOLUME</div><input type="range" id="s-master" min="0" max="1" step="0.05" value="${s.master}"></div>
      <div><div class="label">EFFECTS VOLUME</div><input type="range" id="s-sfx" min="0" max="1" step="0.05" value="${s.sfx}"></div>
      <div><div class="label">UI VOLUME</div><input type="range" id="s-ui" min="0" max="1" step="0.05" value="${s.ui}"></div>
      <div><div class="label">AMBIENCE VOLUME</div><input type="range" id="s-amb" min="0" max="1" step="0.05" value="${s.ambience}"></div>
      <div><div class="label">MENU MUSIC VOLUME</div><input type="range" id="s-music" min="0" max="1" step="0.05" value="${s.music === undefined ? 0.6 : s.music}"></div>
    </div>`;
    const o = this.overlay('SETTINGS', html, [{ label: 'DONE', primary: true, fn: () => { this.closeOverlay(); this.applySettings(); onClose && onClose(); } }]);
    const q = id => o.querySelector('#' + id);
    q('s-name').addEventListener('input', e => { s.name = e.target.value || 'Operator'; this.saveSettings(); });
    q('s-sens').addEventListener('input', e => { s.sens = +e.target.value; q('v-sens').textContent = s.sens; this.saveSettings(); this.applySettings(); });
    q('s-ads').addEventListener('input', e => { s.adsSens = +e.target.value; q('v-ads').textContent = s.adsSens; this.saveSettings(); this.applySettings(); });
    q('s-fov').addEventListener('input', e => { s.fov = +e.target.value; q('v-fov').textContent = s.fov; this.saveSettings(); this.applySettings(); });
    for (const [id, key, conv] of [['s-shadows', 'shadows', v => v], ['s-bloom', 'bloom', v => v === '1'], ['s-quality', 'quality', v => v], ['s-invert', 'invertY', v => v === '1'], ['s-fps', 'showFps', v => v === '1']]) q(id).querySelectorAll('button').forEach(b => b.addEventListener('click', () => { s[key] = conv(b.dataset.v); q(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); this.saveSettings(); this.applySettings(); }));
    for (const [id, key] of [['s-master', 'master'], ['s-sfx', 'sfx'], ['s-ui', 'ui'], ['s-amb', 'ambience'], ['s-music', 'music']]) q(id).addEventListener('input', e => { s[key] = +e.target.value; this.saveSettings(); });
  }
  applySettings() {
    const s = this.settings; this.renderer.setPixelRatio(this.pixelRatioFor(s.quality)); this.resize();
    if (this.game) { const g = this.game; g.player.sens = 0.00037 * s.sens; g.player.adsSensMult = s.adsSens / 100; g.player.invertY = s.invertY; g.settings = s; g.applyQuality(); }
    this.fpsEl && (this.fpsEl.style.display = s.showFps ? 'block' : 'none');
    if (this.menu && this.mode === 'menu') this.menu.render();
  }
  openControls(onClose) {
    const rows = [['Move', 'W A S D'], ['Sprint', 'SHIFT'], ['Crouch', 'C'], ['Prone', 'Z'], ['Lean', 'Q / E'], ['Vault / Enter window', 'SPACE'], ['Interact / Rappel', 'F'], ['Aim down sights', 'RMB'], ['Fire', 'LMB'], ['Reload', 'R'], ['Fire mode', 'B'], ['Melee', 'V'], ['Primary / Secondary', '1 / 2'], ['Unique gadget', '3'], ['Secondary gadget', '4 / G'], ['Detonate (charge/nitro)', 'LMB'], ['Observation tool (drone view)', '5 / X'], ['Return to operator', '5'], ['Deploy a new drone', '6'], ['Drone: identify enemy', 'HOLD X'], ['Drone: ping', 'Z'], ['Ping (operator)', 'M'], ['Drone: jump', 'SPACE'], ['Scoreboard', 'TAB'], ['Pause', 'ESC']];
    this.overlay('CONTROLS', `<div class="controls-list">${rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>`, [{ label: 'DONE', primary: true, fn: () => { this.closeOverlay(); onClose && onClose(); } }]);
  }

  // ---------- loop ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this._fpsN = (this._fpsN || 0) + 1; this._fpsT = (this._fpsT || 0) + dt; this._fpsMax = Math.max(this._fpsMax || 0, dt);
    if (this._fpsT >= 0.5) { if (!this.fpsEl) { this.fpsEl = document.createElement('div'); this.fpsEl.id = 'fps'; this.fpsEl.style.cssText = 'position:fixed;left:8px;bottom:6px;font:12px monospace;color:#9fd8ff;text-shadow:0 1px 2px #000;pointer-events:none;z-index:50;display:none'; document.body.appendChild(this.fpsEl); this.fpsEl.style.display = this.settings.showFps ? 'block' : 'none'; } this.fpsEl.textContent = `${Math.round(this._fpsN / this._fpsT)} fps · worst ${(this._fpsMax * 1000).toFixed(0)} ms`; this._fpsN = 0; this._fpsT = 0; this._fpsMax = 0; }
    const w = window.innerWidth, h = window.innerHeight;
    if (this.mode === 'menu' || this.mode === 'opselect') {
      this.menuScene.update(dt, w, h);
      this.renderer.setRenderTarget(null); this.renderer.render(this.menuScene.scene, this.menuScene.camera);
      if (this.mode === 'opselect') this.opSelect.update(dt);
    } else if (this.mode === 'game' && this.game) {
      if (this.game.player) { this.game.player.sens = 0.00037 * this.settings.sens; this.game.player.adsSensMult = this.settings.adsSens / 100; }
      this.game.update(dt);
      this.game.render();
    }
    Input.endFrame();
  }
}

const app = new App(); window.app = app; window.R6 = { Input, AudioEngine, Assets }; app.boot();
