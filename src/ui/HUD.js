import * as THREE from 'three';
import { icon } from './Icons.js';
import { Gadgets as GadgetDefs, SecondaryGadgets } from '../data/operators.js';

// In-match HUD (DOM). Everything is driven from Game state each frame in update().
const _v = new THREE.Vector3();
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

export class HUD {
  constructor(game, root) {
    this.game = game;
    const h = this.root = el('div', ''); h.id = 'hud'; root.appendChild(h);
    h.innerHTML = `
      <div class="hud-vignette"></div>
      <div class="hud-lowhp" id="hud-lowhp"></div>
      <div class="hud-stun" id="hud-stun"></div>
      <div class="hud-emp" id="hud-emp"></div>
      <div class="hud-flash" id="hud-flash"></div>
      <div class="dmg-ind" id="hud-dmg"></div>
      <div class="hud-compass" id="hud-compass"><div class="strip" id="hud-compass-strip"></div></div>
      <div id="hud-markers"></div>
      <div class="crosshair" id="hud-cross"><i class="dot"></i><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i></div>
      <div class="hitmarker" id="hud-hit"><i style="transform:rotate(45deg) translate(-7px,-7px)"></i><i style="transform:rotate(-45deg) translate(7px,-7px)"></i><i style="transform:rotate(-45deg) translate(-7px,7px)"></i><i style="transform:rotate(45deg) translate(7px,7px)"></i></div>
      <div class="hud-top"><div class="hud-team" id="hud-teamL"></div><div class="hud-timer" id="hud-timer">0:00<small id="hud-timer-sub">PREP</small></div><div class="hud-team" id="hud-teamR"></div></div>
      <div class="hud-score" id="hud-score" style="position:absolute;left:50%;top:60px;transform:translateX(-50%)"></div>
      <div class="hud-phase" id="hud-phase"></div>
      <div class="hud-objective" id="hud-objective"></div>
      <div class="hud-feed" id="hud-feed"></div>
      <div class="hud-bl"><div class="hud-op" id="hud-op"></div><div class="hud-health"><div class="name" id="hud-name"></div><div class="bar"><i id="hud-hp"></i><i class="armor" id="hud-armor" style="width:0"></i></div><div class="num" id="hud-hpnum"></div></div><div class="hud-gadgets" id="hud-gadgets"></div></div>
      <div class="hud-br"><div class="hud-ammo"><span class="mag" id="hud-mag">30</span><span class="res" id="hud-res">/ 150</span></div><div class="hud-weapon" id="hud-weapon"></div><div class="hud-slots" id="hud-slots"><i></i><i></i></div></div>
      <div class="hud-center"><div class="hud-prompt" id="hud-prompt" style="display:none"></div><div class="hud-progress" id="hud-progress" style="display:none"><i id="hud-progress-fill"></i></div><div class="hud-progress-label" id="hud-progress-label"></div></div>
      <div class="hud-big" id="hud-big" style="display:none"></div>
      <div class="hud-dbno" id="hud-dbno" style="display:none"><div class="t">DOWNED</div><div class="s">WAIT FOR A TEAMMATE TO REVIVE YOU</div></div>
      <div class="hud-drone" id="hud-drone"><div class="frame"></div><div class="noise"></div><div class="label">DRONE CAM<small id="hud-drone-sub">SIGNAL OK</small></div><div class="bat" id="hud-drone-bat"></div>
        <div class="reticle" id="hud-drone-ret"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" class="ring"/><circle cx="32" cy="32" r="22" class="prog" id="hud-drone-prog"/><circle cx="32" cy="32" r="2" class="dot"/></svg><div class="hint" id="hud-drone-hint"></div></div>
        <div class="jam" id="hud-drone-jam">SIGNAL JAMMED</div></div>
      <div class="hud-spec" id="hud-spec" style="display:none"></div>
      <div class="hud-objectives" id="hud-objectives" style="display:none"></div>
      <div class="hud-subtitle" id="hud-subtitle" style="display:none"><b id="hud-sub-who"></b><span id="hud-sub-text"></span></div>
      <div id="scoreboard"></div>
    `;
    this.uiRoot = root; this.titleEl = null;
    this.$ = id => h.querySelector('#' + id);
    this._cache = new Map();
    // DOM writes are the expensive part of the HUD: only touch a node when its content really changed
    this.setHTML = (el, html) => { const k = el.id || el; if (this._cache.get(k) === html) return; this._cache.set(k, html); el.innerHTML = html; };
    this.setText = (el, txt) => { const k = (el.id || '') + ':t'; if (this._cache.get(k) === txt) return; this._cache.set(k, txt); el.textContent = txt; };
    this.toasts = []; this.bigT = 0; this.markers = new Map(); this.dmgInds = [];
    this.promptEl = this.$('hud-prompt'); this.progressEl = this.$('hud-progress'); this.progressFill = this.$('hud-progress-fill'); this.progressLabel = this.$('hud-progress-label');
    this.lastAmmo = -1; this._buildCompass();
    this.dmgRoot = this.$('hud-dmg');
    this.equippedSlot = null;
    this.scoreboardOn = false;
  }
  show(on) { this.root.classList.toggle('on', on); }

  _buildCompass() {
    const strip = this.$('hud-compass-strip'); let html = '';
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let rep = -1; rep <= 1; rep++) for (let a = 0; a < 360; a += 15) { const x = (a + rep * 360) * 2.2; if (names[a]) html += `<span class="card" style="left:${x}px">${names[a]}</span>`; else html += `<span class="min" style="left:${x}px"></span>`; }
    strip.innerHTML = html;
  }

  // ---------- messages ----------
  phase(title, sub) { this.$('hud-phase').textContent = title; this.$('hud-objective').innerHTML = sub ? `<span class="bomb"></span><span>${sub}</span>` : ''; }
  big(text, sub, secs = 3) { const b = this.$('hud-big'); b.innerHTML = `${text}<small>${sub || ''}</small>`; b.style.display = 'block'; this.bigT = secs; }
  toast(text, secs = 2.2) {
    const t = el('div', 'toast', text); this.root.appendChild(t); const rec = { el: t, t: secs }; this.toasts.push(rec);
    this.toasts.forEach((r, i) => { r.el.style.top = (150 + (this.toasts.length - 1 - i) * 36) + 'px'; });
  }
  prompt(key, text) { if (!key) { this.promptEl.style.display = 'none'; return; } this.promptEl.style.display = 'inline-block'; this.promptEl.innerHTML = `<b>${key}</b>${text}`; }
  progress(frac, label) { if (frac < 0) { this.progressEl.style.display = 'none'; this.progressLabel.textContent = ''; return; } this.progressEl.style.display = 'block'; this.progressFill.style.width = (Math.min(1, frac) * 100).toFixed(1) + '%'; this.progressLabel.textContent = label || ''; }
  hitmarker(kill, head) { const h = this.$('hud-hit'); h.classList.remove('show', 'kill'); void h.offsetWidth; if (kill) h.classList.add('kill'); h.classList.add('show'); this.game.audio.hitmarker(kill, head); }
  feed(killer, victim, weapon, headshot) {
    const f = this.$('hud-feed'); const e = el('div', 'feed');
    e.innerHTML = `<span class="a ${killer ? killer.side : ''}">${killer ? killer.name : 'WORLD'}</span><span class="w">${weapon || ''}</span>${headshot ? '<span class="hs"></span>' : ''}<span class="v ${victim.side}">${victim.name}</span>`;
    f.prepend(e); setTimeout(() => e.remove(), 6000); while (f.children.length > 6) f.lastChild.remove();
  }
  damage(dmg, fromPos, char) {
    const f = this.$('hud-flash'); f.style.background = 'rgba(200,30,20,1)'; f.style.opacity = Math.min(0.35, dmg / 120); setTimeout(() => f.style.opacity = 0, 80);
    if (fromPos) { const i = el('i'); this.dmgRoot.appendChild(i); this.dmgInds.push({ el: i, pos: fromPos.clone(), t: 1.6 }); }
  }
  stun(intensity) { const s = this.$('hud-stun'); s.style.transition = 'none'; s.style.opacity = Math.min(1, intensity * 1.2); requestAnimationFrame(() => { s.style.transition = `opacity ${1.5 + intensity * 3}s ease-in`; s.style.opacity = 0; }); }
  drone(on) { this.$('hud-drone').classList.toggle('on', on); this.$('hud-cross').style.opacity = on ? 0 : 1; }
  _droneHud() {
    const g = this.game; const P = g.player; const d = P.usingCam ? P.camView : P.drone; const M = g.match; if (!d) return;
    const prog = this.$('hud-drone-prog'); const C = 2 * Math.PI * 22; prog.style.strokeDasharray = C; prog.style.strokeDashoffset = C * (1 - d.scanFrac);
    const ret = this.$('hud-drone-ret'); ret.classList.toggle('hover', !!d.hover); ret.classList.toggle('scanning', d.scanT > 0.05);
    this.$('hud-drone-hint').textContent = d.jammed ? '' : d.hover ? (d.scanT > 0.05 ? 'IDENTIFYING' : 'HOLD X — IDENTIFY') : '';
    this.$('hud-drone-jam').style.opacity = d.jammed ? 1 : 0;
    if (d.isCam) { const cams = g.level.cameras; this.$('hud-drone').querySelector('.label').firstChild.textContent = 'CAM — ' + d.name; this.$('hud-drone-sub').textContent = 'CAMERAS ONLINE ' + cams.filter(c => c.alive).length + ' / ' + cams.length; this.$('hud-drone-bat').textContent = '5 — RETURN TO OPERATOR · Q / E — NEXT CAMERA · Z — PING'; }
    else { this.$('hud-drone').querySelector('.label').firstChild.textContent = 'DRONE CAM'; this.$('hud-drone-sub').textContent = d.jammed ? 'NO SIGNAL' : 'SIGNAL OK · DRONES ' + P.dronesLeft; this.$('hud-drone-bat').textContent = (M.droneHint || (M.phase === 'prep' ? 'PREPARATION — LOCATE THE OBJECTIVE' : '5 — RETURN TO OPERATOR')) + ' · Z — PING · SPACE — JUMP'; }
  }
  dbno(on) { this.$('hud-dbno').style.display = on ? 'block' : 'none'; }

  // ---------- campaign ----------
  // objective list (top left, under the compass): pending / active / done, with a counter when the objective has one
  objectives(list) {
    const e = this.$('hud-objectives'); if (!list) { e.style.display = 'none'; return; }
    e.style.display = 'block';
    this.setHTML(e, `<div class="h">OBJECTIVES</div>` + list.map(o => `<div class="o ${o.state}"><i></i><span>${o.text}</span>${o.count ? `<small>${Math.min(o.progress, o.count)} / ${o.count}</small>` : ''}</div>`).join(''));
  }
  objectiveDone(text) { this.toast('OBJECTIVE COMPLETE — ' + text.toUpperCase(), 3); }
  // radio line at the bottom of the screen
  subtitle(who, text) {
    const e = this.$('hud-subtitle'); if (!who) { e.style.display = 'none'; return; }
    e.style.display = 'flex'; this.$('hud-sub-who').textContent = who; this.$('hud-sub-text').textContent = text;
  }
  // mission title card over the intro fly-over (lives outside #hud so it shows while the HUD is hidden)
  titleCard(code, name, sub) {
    if (this.titleEl) { this.titleEl.remove(); this.titleEl = null; }
    if (!code) return;
    const t = el('div', 'titlecard', `<div class="code">${code}</div><div class="name">${name}</div><div class="sub">${sub}</div><div class="skip">CLICK OR SPACE — SKIP</div>`);
    this.uiRoot.appendChild(t); this.titleEl = t; this.titleProgress(0);
  }
  // k = 0..1 through the intro: fade the card in, slide the lines in one after another, fade out at the end
  titleProgress(k) {
    const t = this.titleEl; if (!t) return;
    t.style.opacity = k < 0.08 ? k / 0.08 : k > 0.86 ? Math.max(0, (1 - k) / 0.14) : 1;
    t.querySelectorAll('.code, .name, .sub').forEach((e, i) => { const a = Math.max(0, Math.min(1, (k - 0.05 - i * 0.05) / 0.12)); const s = a * (2 - a); e.style.opacity = s; e.style.transform = `translateX(${(1 - s) * -24}px)`; });
  }
  dispose() { this.titleCard(null); this.root.remove(); }
  spectate(target) { const e = this.$('hud-spec'); if (!target) { e.style.display = 'none'; return; } e.style.display = 'block'; this.setHTML(e, `<small>SPECTATING</small>${target.name}<span>LMB / RMB — SWITCH TEAMMATE</span>`); }
  gadgetSlot(slot) { this.equippedSlot = slot; this.refreshGadgets(); }

  refreshGadgets() {
    const C = this.game.player && this.game.player.char; if (!C) return;
    const op = C.op; const gd = GadgetDefs[op.gadget]; const g2 = C.gadget2 ? SecondaryGadgets[C.gadget2] : null;
    const uses = gd.uses - C.gadgetUses, uses2 = g2 ? g2.uses - C.gadget2Uses : 0;
    let html = `<div class="gslot ${this.equippedSlot === 'primary' ? 'sel' : ''} ${uses <= 0 ? 'empty' : ''}" title="${gd.name}"><span class="k">3</span>${icon(op.gadget)}<span class="n">${uses}</span></div>`;
    if (g2) html += `<div class="gslot ${this.equippedSlot === 'secondary' ? 'sel' : ''} ${uses2 <= 0 ? 'empty' : ''}" title="${g2.name}"><span class="k">4</span>${icon(C.gadget2)}<span class="n">${uses2}</span></div>`;
    if (C.side === 'def') html += `<div class="gslot" title="Reinforcements"><span class="k">F</span>${icon('shield')}<span class="n">${this.game.match.reinforcementsLeft}</span></div>`;
    if (C.hasDefuser) html += `<div class="gslot" title="Defuser"><span class="k">F</span>${icon('defuser')}</div>`;
    this.$('hud-gadgets').innerHTML = html;
  }
  setOperator(op) { this.$('hud-op').innerHTML = icon(op.icon); this.$('hud-name').textContent = op.name; this.refreshGadgets(); }

  // ---------- per frame ----------
  update(dt) {
    const g = this.game; const M = g.match; const P = g.player; if (!P) return; const C = P.char;
    // timer
    const t = Math.max(0, M.timeLeft); const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    const te = this.$('hud-timer'); const ts = M.phase === 'planted' || (M.countdown && t < 10) ? t.toFixed(1) : `${mm}:${ss.toString().padStart(2, '0')}`; if (this._cache.get('timer') !== ts) { this._cache.set('timer', ts); te.firstChild.textContent = ts; }
    this.setText(this.$('hud-timer-sub'), M.isCampaign ? (M.phase === 'prep' && !M.countdown ? 'PREPARATION' : M.timerLabel) : M.phase === 'prep' ? 'PREPARATION' : M.phase === 'planted' ? 'DEFUSER' : M.phase === 'action' ? 'ROUND ' + M.round : M.phase === 'roundEnd' ? 'ROUND OVER' : '');
    te.className = 'hud-timer' + (M.phase === 'planted' || (M.countdown && t < 30) ? ' crit' : (t < 30 && M.phase === 'action' && !M.isCampaign) || (M.countdown && t < 60) ? ' warn' : '');
    // teams
    const atk = g.characters.filter(c => c.side === 'atk' && !c.hidden && c.campaignKind !== 'hostage'), def = g.characters.filter(c => c.side === 'def' && !c.hidden);
    const left = M.playerSide === 'atk' ? atk : def, right = M.playerSide === 'atk' ? def : atk;
    const pips = arr => arr.map(c => `<i class="${c.dead ? 'dead' : c.dbno ? 'dbno' : ''} ${c.hasDefuser ? 'defuser' : ''}" title="${c.name}"></i>`).join('');
    const L = this.$('hud-teamL'), R = this.$('hud-teamR'); L.className = 'hud-team ' + M.playerSide; R.className = 'hud-team ' + (M.playerSide === 'atk' ? 'def' : 'atk'); this.setHTML(L, pips(left)); this.setHTML(R, pips(right));
    this.setHTML(this.$('hud-score'), M.isCampaign ? '' : `<b>${M.score.A}</b> — <b>${M.score.B}</b>`);
    // health
    const hp = Math.max(0, C.health); this.$('hud-hp').style.width = (hp / C.maxHealth * 100) + '%'; this.$('hud-armor').style.width = C.armorPlate ? '100%' : '0'; this.$('hud-armor').style.opacity = C.armorPlate ? 0.35 : 0;
    this.setText(this.$('hud-hpnum'), C.dbno ? 'DOWNED' : `${Math.ceil(hp)} / ${C.maxHealth}` + (C.armorPlate ? ' + ARMOR' : ''));
    this.$('hud-lowhp').style.opacity = C.dbno ? 0.9 : hp < 35 && !C.dead ? (1 - hp / 35) * 0.8 : 0;
    this.$('hud-emp').style.opacity = C.empd > 0 ? 0.5 : 0;
    // ammo
    const w = C.weapon;
    if (w) { const mag = this.$('hud-mag'); this.setText(mag, String(w.ammo)); mag.className = 'mag' + (w.ammo === 0 ? ' empty' : w.ammo <= w.def.mag * 0.25 ? ' low' : ''); this.setText(this.$('hud-res'), '/ ' + w.reserve); this.setHTML(this.$('hud-weapon'), `${w.def.name}<span class="hud-mode">${w.def.modes.map(m => `<i class="${m === w.mode ? 'on' : ''}"></i>`).join('')}</span>` + (w.reloading ? ' <b>RELOADING</b>' : '')); this.setHTML(this.$('hud-slots'), C.weapons.slice(0, 2).map((x, i) => `<i class="${i === C.weaponIndex ? 'on' : ''}"></i>`).join('')); }
    // crosshair: hide when ADS or dead
    const cross = this.$('hud-cross'); const spread = w ? (P.adsBlend > 0.5 ? 0 : (4 + C.speedNorm * 6 + (C.stance === 0 ? 2 : 0))) : 4;
    cross.style.opacity = (P.adsBlend > 0.5 || C.dead || P.usingDrone || C.dbno) ? 0 : 1;
    cross.querySelector('.l').style.transform = `translateX(${-9 - spread}px)`; cross.querySelector('.r').style.transform = `translateX(${2 + spread}px)`; cross.querySelector('.t').style.transform = `translateY(${-9 - spread}px)`; cross.querySelector('.b').style.transform = `translateY(${2 + spread}px)`;
    // big message
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) this.$('hud-big').style.display = 'none'; }
    for (let i = this.toasts.length - 1; i >= 0; i--) { const r = this.toasts[i]; r.t -= dt; if (r.t <= 0) { r.el.remove(); this.toasts.splice(i, 1); } else if (r.t < 0.3) r.el.style.opacity = r.t / 0.3; }
    // compass
    const yaw = ((-C.yaw * 180 / Math.PI) % 360 + 360) % 360;
    this.$('hud-compass-strip').style.left = (160 - yaw * 2.2) + 'px';
    // damage indicators
    for (let i = this.dmgInds.length - 1; i >= 0; i--) { const d = this.dmgInds[i]; d.t -= dt; if (d.t <= 0) { d.el.remove(); this.dmgInds.splice(i, 1); continue; } const dx = d.pos.x - C.pos.x, dz = d.pos.z - C.pos.z; const ang = Math.atan2(dx, -dz) - (-C.yaw); d.el.style.transform = `rotate(${-ang * 180 / Math.PI}deg)`; d.el.style.opacity = Math.min(1, d.t); }
    this.dbno(C.dbno && !C.dead);
    if (P.usingDrone || P.usingCam) this._droneHud();
    this._markers();
    if (this.scoreboardOn) this._scoreboard();
  }

  // ---------- world markers ----------
  _markers() {
    const g = this.game; const M = g.match; const cam = g.camera; const root = this.$('hud-markers'); const P = g.player; const C = P.char; const eye = cam.position;
    const W = window.innerWidth, H = window.innerHeight; const used = new Set();
    const place = (key, cls, worldPos, label, dist, force = false) => {
      let m = this.markers.get(key); if (!m) { m = el('div', 'hud-marker ' + cls); m.innerHTML = `<div class="ic" data-l="${label && label.length === 1 ? label : ''}"></div><div class="l"></div><div class="d"></div>`; root.appendChild(m); this.markers.set(key, m); }
      m.className = 'hud-marker ' + cls;
      _v.copy(worldPos).project(cam);
      const behind = _v.z > 1; let x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      if (behind || x < 20 || x > W - 20 || y < 20 || y > H - 20) { if (!force) { m.style.display = 'none'; used.add(key); return; } x = Math.max(24, Math.min(W - 24, behind ? W - x : x)); y = Math.max(24, Math.min(H - 24, behind ? H - 40 : y)); }
      m.style.display = 'block'; m.style.left = x + 'px'; m.style.top = y + 'px';
      m.children[1].textContent = label && label.length > 1 ? label : ''; m.children[2].textContent = dist !== undefined ? Math.round(dist) + 'm' : '';
      m.style.opacity = dist > 40 ? 0.5 : 1; used.add(key);
    };
    if (M.site && !M.isCampaign && (M.phase === 'action' || M.phase === 'prep' || M.phase === 'planted')) {
      if (!(M.phase === 'planted')) for (const b of M.site.bombs) { const p = b.pos.clone(); p.y += 1.0; place('site' + b.label, 'site', p, b.label, p.distanceTo(eye), M.phase === 'action'); }
      if (M.defuser) { const p = M.defuser.pos.clone(); p.y += 0.6; place('defuser', 'defuser', p, 'DEFUSER', p.distanceTo(eye), true); }
      if (M.defuserDropped && C.side === 'atk') { const p = M.defuserDropped.pos.clone(); p.y += 0.6; place('defuserD', 'defuser', p, 'DEFUSER', p.distanceTo(eye), true); }
    }
    // mission objective markers (campaign)
    if (M.markers) for (const mk of M.markers) place('obj:' + mk.key, mk.cls || 'obj', mk.pos, mk.label, mk.pos.distanceTo(eye), true);
    // contextual pings
    g.pings.forEach((pg, i) => { place('ping' + i, pg.kind === 'enemy' ? 'enemyping' : 'ping', pg.pos, pg.label, pg.pos.distanceTo(eye), true); });
    // the player's own drone when viewing from the operator
    if (P.drone && !P.usingDrone && P.side === 'atk') { const p = P.drone.pos.clone(); p.y += 0.4; place('mydrone', 'drone', p, 'DRONE', p.distanceTo(eye), false); }
    for (const ch of g.characters) {
      if (ch === C || ch.dead || ch.hidden) continue;
      if (ch.side === C.side) { const p = ch.headPos(new THREE.Vector3()); p.y += 0.35; place('ally' + ch.uid, 'ally ' + ch.side + (ch.dbno ? ' dbno' : ''), p, ch.name + (ch.dbno ? ' — DOWNED' : ch.hasDefuser ? ' — DEFUSER' : ''), undefined, false); }
      else if (ch.pingedUntil > g.time || (ch.scanned > g.time)) { const p = ch.headPos(new THREE.Vector3()); p.y += 0.35; place('enemy' + ch.uid, 'scan', p, ch.name, p.distanceTo(eye), true); }
    }
    for (const [k, m] of this.markers) if (!used.has(k)) m.style.display = 'none';
  }

  scoreboard(on) { this.scoreboardOn = on; this.$('scoreboard').classList.toggle('on', on); if (on) this._scoreboard(); }
  _scoreboard() {
    const g = this.game; const M = g.match;
    const row = c => `<tr class="${c.isPlayer ? 'me' : ''} ${c.dead ? 'dead' : ''}"><td class="n">${c.name}${c.isPlayer ? ' (YOU)' : ''}</td><td>${c.op.ctu}</td><td>${c.kills}</td><td>${c.deaths}</td><td>${c.score}</td><td>${c.dead ? 'DEAD' : c.dbno ? 'DOWNED' : Math.ceil(c.health) + ' HP'}</td></tr>`;
    const label = side => M.isCampaign ? (side === M.playerSide ? 'RAINBOW' : 'WHITE MASKS') : (side === 'atk' ? 'ATTACKERS' : 'DEFENDERS') + ' — ' + M.scoreFor(side);
    const team = (side) => `<div class="th ${side}">${label(side)}</div><table><tr><th>OPERATOR</th><th>CTU</th><th>K</th><th>D</th><th>SCORE</th><th>STATUS</th></tr>${g.characters.filter(c => c.side === side && !c.hidden).sort((a, b) => b.score - a.score).map(row).join('')}</table>`;
    this.$('scoreboard').innerHTML = `<h2>BORDER — ${M.isCampaign ? M.mission.location : M.site ? M.site.name : ''}<small>${M.isCampaign ? M.mission.code + ' · ' + M.mission.name : 'ROUND ' + M.round + ' · ' + M.s.name}</small></h2>${team(M.playerSide)}${team(M.playerSide === 'atk' ? 'def' : 'atk')}`;
  }
}
