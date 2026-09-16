import * as THREE from 'three';
import { icon } from './Icons.js';
import { Operators, OperatorById, Gadgets as GadgetDefs, SecondaryGadgets, healthFor } from '../data/operators.js';
import { Weapons } from '../data/weapons.js';
import { Presets } from '../game/Match.js';
import { SITES } from '../map/BorderMap.js';
import { Character } from '../game/Character.js';
import { Weapon } from '../game/Weapon.js';
import { AudioEngine } from '../core/AudioEngine.js';
import { Input } from '../core/Input.js';
import { Net } from '../net/Net.js';
import { getSprite } from '../map/Materials.js';

// Front-end: home / play (custom game) / operators / shop / settings, the 3D menu backdrop
// with posed operators, and the in-match operator select.

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

export const Skins = [
  { id: 'default', name: 'DEFAULT', color: 0xffffff, metal: 1.0, rough: 1.0 },
  { id: 'blackice', name: 'BLACK ICE', color: 0x7fb8ff, metal: 1.0, rough: 0.6, sub: 'LEGENDARY' },
  { id: 'tan', name: 'DESERT TAN', color: 0xd7b078, metal: 0.4, rough: 1.0 },
  { id: 'woodland', name: 'WOODLAND', color: 0x6f9a55, metal: 0.4, rough: 1.0 },
  { id: 'arctic', name: 'ARCTIC', color: 0xe8ecf2, metal: 0.3, rough: 1.0 },
  { id: 'crimson', name: 'CRIMSON', color: 0xc8322a, metal: 0.8, rough: 0.7 },
  { id: 'gold', name: 'GOLD PLATE', color: 0xffc44d, metal: 1.0, rough: 0.35, sub: 'LEGENDARY' },
  { id: 'carbon', name: 'CARBON', color: 0x2a2d33, metal: 1.0, rough: 0.5 },
];

export class Menu {
  constructor(app, root) {
    this.app = app; this.root = root; this.page = 'home';
    this.settings = app.settings;
    this.el = el('div', 'screen'); this.el.id = 'menu'; root.appendChild(this.el);
    this.selectedOp = 'sledge';
    this.loadouts = app.settings.loadouts || {};
    this.build();
  }
  hide() { this.el.classList.add('hidden'); }
  showPage(p) { this.el.classList.remove('hidden'); this.page = p; this.render(); }

  build() { this.render(); }

  topbar(active) {
    const s = this.settings;
    return `<div class="topbar"><div class="logo"><span class="tc">TOM CLANCY'S</span><span class="r6">RAINBOW<em>SIX</em>SIEGE</span></div>
      <nav>${['play', 'online', 'operators', 'shop'].map(p => `<button data-page="${p}" class="${active === p ? 'active' : ''}">${p.toUpperCase()}</button>`).join('')}</nav>
      <div class="right"><div class="wallet"><span class="cur">${icon('renown')}<span>${s.renown.toLocaleString()}</span></span><span class="cur">${icon('credits')}<span>${s.credits.toLocaleString()}</span></span></div><div class="avatar">${s.name.slice(0, 1).toUpperCase()}</div><button class="gear" data-action="settings" title="Settings">${icon('gear')}</button></div></div>
      <div class="subhead">${s.name.toUpperCase()}'S CUSTOM GAME</div>`;
  }

  render() {
    const p = this.page;
    let body = this.topbar(p);
    if (p === 'home') body += this.homeHTML();
    else if (p === 'play') body += this.playHTML();
    else if (p === 'operators') body += this.opsHTML();
    else if (p === 'shop') body += this.shopHTML();
    else if (p === 'online') body += this.onlineHTML();
    body += `<div class="bottom-hint"><span><b>ESC</b>BACK</span><span><b>ENTER</b>SELECT</span></div><div class="ver">R6 BROWSER · BUILD 1.0</div>`;
    this.el.innerHTML = body;
    this.bind();
    this.app.menuScene && this.app.menuScene.setMode(p === 'operators' ? 'operator' : 'trio', this.selectedOp);
  }

  homeHTML() {
    return `<div class="h1">HOME</div>
      <div class="tiles">
        <button class="tile big" data-page="play"><span class="corner">${icon('corner')}</span>MATCHMAKING</button>
        <button class="tile sq" data-action="controls" title="Controls">${icon('controller')}</button>
        <button class="tile sq" data-page="operators" title="Operators">${icon('ops')}</button>
        <button class="tile sq" data-action="settings" title="Settings">${icon('gear')}</button>
        <button class="tile sq" data-action="stats" title="Career">${icon('cup')}</button>
        <button class="tile wide" data-page="online"><small>PLAY</small>ONLINE</button>
        <button class="tile news" data-page="play"><div class="ghost">SIEGE<br>BORDER</div><div class="plus">+</div></button>
      </div>`;
  }

  playHTML() {
    const s = this.settings; const g = s.game;
    const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${g[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return `<div class="h1">PLAY</div>
      <div class="play-wrap">
        <div class="panel"><h3>CUSTOM GAME — BOMB</h3>
          <div class="setting"><span class="label">Playlist</span>${seg('preset', [['casual', 'Quick'], ['ranked', 'Ranked'], ['quick', 'Lightning']])}</div>
          <div class="setting"><span class="label">Starting side</span>${seg('side', [['atk', 'Attack'], ['def', 'Defend']])}</div>
          <div class="setting"><span class="label">Bomb site</span>${seg('site', [['random', 'Random'], ...SITES.map(x => [x.id, x.rooms[0].toUpperCase()])])}</div>
          <div class="setting"><span class="label">AI difficulty</span>${seg('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}</div>
          <div class="setting"><span class="label">Format</span><span class="value">${Presets[g.preset].name} · FIRST TO ${Presets[g.preset].roundsToWin} · SWAP AFTER ${Presets[g.preset].swapAfter}</span></div>
        </div>
        <div class="panel"><h3>MAP</h3><div class="map-card"><canvas id="map-preview"></canvas><small>BOMB · 5 V 5</small><span style="position:relative">BORDER</span></div>
          <div style="margin-top:12px" class="label">ROUND STRUCTURE</div>
          <div class="value" style="font-size:13px;line-height:1.7;color:#c5c9d1">PREP ${Presets[g.preset].prepTime}s · ACTION ${Presets[g.preset].actionTime}s · DEFUSER ${Presets[g.preset].bombTime}s<br>5 ATTACKERS vs 5 DEFENDERS · AI TEAMMATES & OPPONENTS</div>
        </div>
        <div class="play-actions"><button class="btn" data-page="operators">LOADOUTS</button><button class="btn primary" data-action="start">START MATCH</button></div>
      </div>`;
  }

  onlineHTML() {
    const s = this.settings; const g = s.game; const me = Net.isHost ? 'host' : Net.id;
    const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${g[key] === v ? 'on' : ''}" ${Net.isClient ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
    const roster = Net.players.map(p => `<div class="lp ${p.side} ${p.id === me ? 'me' : ''}" data-pid="${p.id}"><span class="side">${p.side === 'atk' ? 'ATK' : 'DEF'}</span><span class="nm">${p.name}${p.host ? ' <small>HOST</small>' : ''}${p.id === me ? ' <small>YOU</small>' : ''}</span><span class="sw">${p.id === me ? 'SWITCH SIDE' : ''}</span></div>`).join('');
    const atk = Net.players.filter(p => p.side === 'atk').length, def = Net.players.filter(p => p.side === 'def').length;
    return `<div class="h1">ONLINE</div>
      <div class="play-wrap">
        <div class="panel"><h3>${Net.online ? (Net.isHost ? 'ROOM ' + Net.code : 'ROOM ' + Net.code + ' — JOINED') : 'PLAY WITH FRIENDS'}</h3>
          ${Net.online ? '' : `<div class="setting"><span class="label">Your name</span><input type="text" id="on-name" value="${s.name}" maxlength="16" style="width:160px"></div>
          <div class="setting"><span class="label">Host a room</span><button class="btn primary" data-action="host">CREATE ROOM</button></div>
          <div class="setting"><span class="label">Join a room</span><span><input type="text" id="on-code" placeholder="CODE" maxlength="5" style="width:110px;text-transform:uppercase;letter-spacing:.3em"> <button class="btn" data-action="join">JOIN</button></span></div>
          <div class="value" style="font-size:12px;line-height:1.6;color:#8a8f99;margin-top:10px">Peer-to-peer over WebRTC. The host runs the match; give friends the 5-letter code. Up to 10 players, empty slots are filled with AI.</div>`}
          ${Net.online ? `<div class="value" style="font-size:12px;color:#9fd8ff;margin-bottom:8px" id="on-status">${this.netStatus || ''}</div>
          <div class="lobby">${roster || '<div class="value">waiting for the room…</div>'}</div>
          <div class="value" style="font-size:12px;color:#8a8f99;margin-top:6px">${atk} attacker${atk === 1 ? '' : 's'} · ${def} defender${def === 1 ? '' : 's'} · AI fills the rest</div>
          <div class="play-actions" style="margin-top:14px">${Net.isHost ? '<button class="btn primary" data-action="startOnline">START MATCH</button>' : '<span class="value">waiting for the host to start</span>'}<button class="btn danger" data-action="leaveRoom">LEAVE ROOM</button></div>` : ''}
        </div>
        <div class="panel"><h3>MATCH SETTINGS ${Net.isClient ? '(HOST)' : ''}</h3>
          <div class="setting"><span class="label">Playlist</span>${seg('preset', [['casual', 'Quick'], ['ranked', 'Ranked'], ['quick', 'Lightning']])}</div>
          <div class="setting"><span class="label">Bomb site</span>${seg('site', [['random', 'Random'], ...SITES.map(x => [x.id, x.rooms[0].toUpperCase()])])}</div>
          <div class="setting"><span class="label">AI difficulty</span>${seg('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']])}</div>
          <div class="setting"><span class="label">Format</span><span class="value">${Presets[g.preset].name} · FIRST TO ${Presets[g.preset].roundsToWin} · SWAP AFTER ${Presets[g.preset].swapAfter}</span></div>
        </div>
      </div>`;
  }
  opsHTML() {
    const op = OperatorById[this.selectedOp];
    const grid = side => `<div class="ops-grid">${Operators.filter(o => o.side === side).map(o => `<button class="opbtn ${o.id === this.selectedOp ? 'sel' : ''}" data-op="${o.id}" title="${o.name}">${icon(o.icon)}</button>`).join('')}${Array.from({ length: Math.max(0, 8 - Operators.filter(o => o.side === side).length) }).map(() => `<div class="opbtn locked" style="opacity:.25"></div>`).join('')}</div>`;
    return `<div class="ops-left">
        <div class="ops-header">OPERATOR ROSTER</div>
        <div class="ops-cols"><div class="ops-col"><h4>${icon('atk')} ATTACKERS</h4>${grid('atk')}</div><div class="ops-col"><h4>${icon('def')} DEFENDERS</h4>${grid('def')}</div></div>
      </div>${this.opPanelHTML(op)}
      <div class="ops-actions"><button class="btn" data-page="home">BACK</button><button class="btn primary" data-page="play">PLAY</button></div>`;
  }
  opPanelHTML(op, extra = '') {
    const lo = this.loadoutFor(op.id); const gd = GadgetDefs[op.gadget];
    const pips = n => `<div class="pips">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
    const seg = (key, opts) => `<div class="seg" data-lo="${key}">${opts.map(v => `<button data-v="${v}" class="${lo[key] === v ? 'on' : ''}">${(Weapons[v] ? Weapons[v].name : (SecondaryGadgets[v] ? SecondaryGadgets[v].name : v))}</button>`).join('')}</div>`;
    return `<div class="ops-right">
        <div class="name">${op.name}<small>${op.real} · ${op.ctu}</small></div>
        <div class="side">${icon(op.side)} ${op.side === 'atk' ? 'ATK' : 'DEF'}</div>
        <div class="gadget"><div class="gi">${icon(op.icon)}</div><h5>${gd.name}</h5><p>${gd.desc}</p></div>
        <div class="stats"><div class="st"><span>SPEED</span>${pips(op.speed)}</div><div class="st"><span>HEALTH</span>${pips(op.armor)}</div><div class="st"><span>HP</span><span style="color:#fff;font-size:13px;letter-spacing:.1em">${healthFor(op)}</span></div></div>
        <div class="loadout"><div class="lo"><span class="k">PRIMARY</span>${seg('primary', op.primaries)}</div><div class="lo"><span class="k">SECONDARY</span>${seg('secondary', op.secondaries)}</div><div class="lo"><span class="k">GADGET</span>${seg('gadget2', op.gadgets2)}</div></div>
        ${extra}
      </div>`;
  }
  loadoutFor(id) { const op = OperatorById[id]; if (!this.loadouts[id]) this.loadouts[id] = { primary: op.primaries[0], secondary: op.secondaries[0], gadget2: op.gadgets2[0] }; return this.loadouts[id]; }

  shopHTML() {
    const s = this.settings;
    return `<div class="h1">SHOP — WEAPON SKINS</div>
      <div class="shop-wrap">${Skins.map(k => `<div class="skin ${s.skin === k.id ? 'on' : ''}" data-skin="${k.id}"><div class="sw" style="background:linear-gradient(135deg,#${k.color.toString(16).padStart(6, '0')} 0%,#111 120%)"></div><small>${k.sub || 'UNIVERSAL'}</small><span>${k.name}</span></div>`).join('')}</div>`;
  }

  bind() {
    const E = this.el;
    E.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => { AudioEngine.click('ui'); this.showPage(b.dataset.page); }));
    E.querySelectorAll('button,.tile,.skin,.opbtn').forEach(b => b.addEventListener('mouseenter', () => AudioEngine.click('hover')));
    E.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => { AudioEngine.click('ui'); this.action(b.dataset.action); }));
    E.querySelectorAll('[data-seg]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (b.disabled) return; AudioEngine.click('ui'); this.settings.game[seg.dataset.seg] = b.dataset.v; this.app.saveSettings(); if (Net.isHost) Net.setSettings(this.settings.game); this.render(); })));
    E.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => { AudioEngine.click('ui'); this.selectedOp = b.dataset.op; this.render(); }));
    E.querySelectorAll('[data-lo]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { AudioEngine.click('ui'); this.loadoutFor(this.selectedOp)[seg.dataset.lo] = b.dataset.v; this.settings.loadouts = this.loadouts; this.app.saveSettings(); this.render(); })));
    E.querySelectorAll('.lp.me').forEach(b => b.addEventListener('click', () => { const me = Net.players.find(p => p.id === (Net.isHost ? 'host' : Net.id)); if (me) Net.setSide(me.id, me.side === 'atk' ? 'def' : 'atk'); }));
    E.querySelectorAll('[data-skin]').forEach(b => b.addEventListener('click', () => { AudioEngine.click('ui'); this.settings.skin = b.dataset.skin; this.app.saveSettings(); this.render(); this.app.menuScene && this.app.menuScene.applySkin(); }));
    const mp = E.querySelector('#map-preview'); if (mp) this.drawMapPreview(mp);
  }
  action(a) {
    if (a === 'start') this.app.startMatch();
    else if (a === 'host') { const n = this.el.querySelector('#on-name'); if (n) { this.settings.name = n.value || 'Host'; this.app.saveSettings(); } this.app.hostRoom(); }
    else if (a === 'join') { const n = this.el.querySelector('#on-name'), c = this.el.querySelector('#on-code'); if (n) { this.settings.name = n.value || 'Player'; this.app.saveSettings(); } this.app.joinRoom(c ? c.value : ''); }
    else if (a === 'leaveRoom') { Net.leave(); this.render(); }
    else if (a === 'startOnline') this.app.startOnlineMatch();
    else if (a === 'settings') this.app.openSettings();
    else if (a === 'controls') this.app.openControls();
    else if (a === 'credits') this.app.overlay('UBISOFT CLUB', `<p style="font-family:var(--font);line-height:1.6;color:#c5c9d1">A browser recreation of Tom Clancy's Rainbow Six Siege built for this project. Operators and weapons are rendered from the supplied models; everything else — Border, destruction, ballistics, AI and audio — is generated at runtime.</p><p style="font-family:var(--font);line-height:1.6;color:#c5c9d1">Rainbow Six Siege is a trademark of Ubisoft Entertainment. This is a fan project.</p>`);
    else if (a === 'stats') { const s = this.settings.career; this.app.overlay('CAREER', `<div class="grid"><div><div class="label">MATCHES</div><div class="value">${s.matches}</div></div><div><div class="label">WINS</div><div class="value">${s.wins}</div></div><div><div class="label">KILLS</div><div class="value">${s.kills}</div></div><div><div class="label">DEATHS</div><div class="value">${s.deaths}</div></div><div><div class="label">HEADSHOTS</div><div class="value">${s.headshots}</div></div><div><div class="label">K/D</div><div class="value">${(s.kills / Math.max(1, s.deaths)).toFixed(2)}</div></div></div>`); }
  }

  drawMapPreview(c) {
    c.width = 400; c.height = 200; const x = c.getContext('2d');
    x.fillStyle = '#0e1116'; x.fillRect(0, 0, 400, 200);
    const K = 1.25; const sx = 400 / 50, sz = 200 / 37, ox = 4, oz = 4;
    x.strokeStyle = 'rgba(255,255,255,.25)'; x.lineWidth = 1;
    const rooms = [[0, 0, 10, 8], [0, 8, 4, 14], [4, 8, 10, 14], [0, 14, 10, 22], [10, 0, 20, 8], [10, 8, 20, 14], [10, 14, 18, 22], [18, 14, 24, 22], [24, 14, 32, 22], [20, 0, 32, 8], [20, 8, 26, 14], [26, 8, 32, 14]];
    for (const [a0, b0, c0, d0] of rooms) { const a = a0 * K, b = b0 * K, cc = c0 * K, d = d0 * K; x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect((a + ox) * sx, (b + oz) * sz, (cc - a) * sx, (d - b) * sz); x.strokeRect((a + ox) * sx, (b + oz) * sz, (cc - a) * sx, (d - b) * sz); }
    x.fillStyle = 'rgba(233,131,43,.8)'; x.fillRect((5 * K + ox) * sx - 4, (4 * K + oz) * sz - 4, 8, 8); x.fillRect((2 * K + ox) * sx - 4, (11 * K + oz) * sz - 4, 8, 8);
    x.fillStyle = '#fff'; x.font = 'bold 10px Barlow Condensed, sans-serif'; x.fillText('TELLERS', (1 * K + ox) * sx, (2 * K + oz) * sz); x.fillText('CUSTOMS', (22 * K + ox) * sx, (2 * K + oz) * sz); x.fillText('LOBBY', (12 * K + ox) * sx, (2 * K + oz) * sz);
  }
}

// ---------------------------------------------------------------------------------------------
// 3D backdrop: night skyline + posed operators (trio for home, single for the operator screen)
export class MenuScene {
  constructor(app) {
    this.app = app; this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x070a10);
    this.scene.fog = new THREE.FogExp2(0x070a10, 0.03);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 200);
    this.camera.position.set(0.6, 1.35, 4.2); this.camera.lookAt(0.6, 1.15, 0);
    this.time = 0; this.mode = 'trio';
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.fake = { audio: { footstep() {} }, time: 0, noise: null, effects: null, onDBNO: null, onDeath: null };
    this._lights(); this._skyline(); this._bokeh(); this._ground();
    this.chars = []; this.single = null;
    this._buildTrio();
  }
  _lights() {
    // studio-style night key light (cool white from the front-left), blue rim from the city behind, soft fills
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x7f9bd8, 0x1a1c22, 1.5));
    const key = new THREE.DirectionalLight(0xe8f0ff, 4.6); key.position.set(-2.2, 4.2, 4.5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; s.add(key);
    const fill = new THREE.DirectionalLight(0xbfd0f0, 1.6); fill.position.set(3.5, 2, 3); s.add(fill);
    const rim = new THREE.DirectionalLight(0x5c9dff, 5.0); rim.position.set(-3, 3.5, -5); s.add(rim);
    const rim2 = new THREE.DirectionalLight(0xffc890, 2.2); rim2.position.set(4, 2.5, -4); s.add(rim2);
    const warm = new THREE.PointLight(0xffb070, 14, 12, 2); warm.position.set(3.5, 2.5, 1.5); s.add(warm);
    const cool = new THREE.PointLight(0x3b62c8, 22, 14, 2); cool.position.set(-3, 1.6, 2.0); s.add(cool);
  }
  // out-of-focus city lights behind the operators
  _bokeh() {
    const g = new THREE.Group(); const tex = getSprite('glow');
    for (let i = 0; i < 90; i++) {
      const warmC = Math.random() < 0.55;
      const col = warmC ? new THREE.Color().setHSL(0.08 + Math.random() * 0.06, 0.9, 0.55 + Math.random() * 0.2) : new THREE.Color().setHSL(0.55 + Math.random() * 0.1, 0.8, 0.6 + Math.random() * 0.2);
      const m = new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, opacity: 0.25 + Math.random() * 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const sp = new THREE.Sprite(m); const z = -18 - Math.random() * 40; const sc = (0.5 + Math.random() * 1.6) * (1 + (-z - 18) / 40);
      sp.position.set((Math.random() - 0.5) * 70, -0.5 + Math.random() * 14, z); sp.scale.setScalar(sc); g.add(sp);
    }
    this.scene.add(g); this.bokeh = g;
  }
  _skyline() {
    const g = new THREE.Group(); const winTex = this._windowTexture();
    for (let i = 0; i < 70; i++) {
      const w = 2 + Math.random() * 6, h = 6 + Math.random() * 30, d = 2 + Math.random() * 6;
      const x = (Math.random() - 0.5) * 120, z = -25 - Math.random() * 70;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.9, emissiveMap: winTex, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0.9 }));
      m.position.set(x, h / 2 - 1, z); g.add(m);
    }
    // ground glow strip (city lights reflection)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), new THREE.MeshBasicMaterial({ color: 0x1a2a55, transparent: true, opacity: 0.35 })); glow.rotation.x = -Math.PI / 2; glow.position.set(0, -0.99, -50); g.add(glow);
    this.scene.add(g); this.skyline = g;
  }
  _windowTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 64, 128);
    for (let j = 0; j < 32; j++) for (let i = 0; i < 8; i++) { if (Math.random() < 0.45) { x.fillStyle = `rgba(255,${200 + Math.random() * 55 | 0},${140 + Math.random() * 100 | 0},${0.5 + Math.random() * 0.5})`; x.fillRect(i * 8 + 2, j * 4 + 1, 4, 2); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 3); return t;
  }
  _ground() {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x0c0f15, roughness: 0.35, metalness: 0.2 })); m.rotation.x = -Math.PI / 2; m.receiveShadow = true; this.scene.add(m);
    // wet reflection hint
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(3, 32), new THREE.MeshStandardMaterial({ color: 0x0a0d14, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.6 })); puddle.rotation.x = -Math.PI / 2; puddle.position.set(-1, 0.002, 0.5); this.scene.add(puddle);
  }
  _makeChar(opId, x, z, yaw, primary) {
    const op = OperatorById[opId]; const c = new Character(this.fake, op, op.side, false);
    c.setWeapons([new Weapon(primary, c)]); c.pos.set(x, 0, z); c.yaw = yaw; c.pitch = -0.05; c.lowReady = c.lowReadyTarget = 1;
    this.group.add(c.root); return c;
  }
  _buildTrio() {
    for (const c of this.chars) this.group.remove(c.root); this.chars = [];
    const s = this.app.settings;
    // like the home screen: the centre operator closest to the camera, flanked by two slightly behind
    const picks = ['thatcher', 'ash', 'rook'];
    const lo = id => (s.loadouts && s.loadouts[id] && s.loadouts[id].primary) || OperatorById[id].primaries[0];
    this.chars.push(this._makeChar(picks[0], -0.3, -0.25, Math.PI - 0.28, lo(picks[0])));
    this.chars.push(this._makeChar(picks[1], 0.85, 0.3, Math.PI + 0.04, lo(picks[1])));
    this.chars.push(this._makeChar(picks[2], 2.0, -0.35, Math.PI + 0.3, lo(picks[2])));
    this.chars[1].pitch = -0.02; this.applySkin();
  }
  setMode(mode, opId) {
    this.mode = mode;
    if (mode === 'operator') {
      if (this.single && this.single.op.id !== opId) { this.group.remove(this.single.root); this.single = null; }
      if (!this.single) { const s = this.app.settings; const lo = (s.loadouts && s.loadouts[opId] && s.loadouts[opId].primary) || OperatorById[opId].primaries[0]; this.single = this._makeChar(opId, 0, 0, Math.PI + 0.35, lo); }
      for (const c of this.chars) c.root.visible = false; this.single.root.visible = true;
    } else { for (const c of this.chars) c.root.visible = true; if (this.single) this.single.root.visible = false; }
    this.applySkin();
  }
  applySkin() {
    const skin = Skins.find(k => k.id === this.app.settings.skin) || Skins[0];
    const apply = c => { if (!c.tpWeapon) return; c.tpWeapon.traverse(o => { if (o.isMesh) { if (!o.userData.skinMat) { o.material = o.material.clone(); o.userData.skinMat = true; } o.material.color.setHex(skin.color); o.material.metalness = skin.metal; o.material.roughness = skin.rough; } }); };
    for (const c of this.chars) apply(c); if (this.single) apply(this.single);
  }
  update(dt, w, h) {
    this.time += dt; this.fake.time = this.time;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.mode === 'operator') {
      // frame the single operator at the right of the screen, upper body
      const aspectShift = Math.max(0.2, (w / h - 1.2) * 0.5);
      this.camera.position.set(-0.55 - aspectShift * 0.4, 1.35, 2.35); this.camera.lookAt(-0.05 - aspectShift * 0.4, 1.2, 0);
      if (this.single) { this.single.yaw = Math.PI + 0.35 + Math.sin(this.time * 0.3) * 0.05; this.single.updateBody(dt, this.camera); }
    } else {
      // waist-up framing with a slow drift
      const wide = Math.max(0, (w / h - 1.6)) * 0.3;
      this.camera.position.set(0.86 + Math.sin(this.time * 0.11) * 0.04, 1.36 + Math.sin(this.time * 0.17) * 0.015, 2.75 + wide); this.camera.lookAt(0.86, 1.28, 0);
      this.chars.forEach((c, i) => { c.pitch = -0.03 + Math.sin(this.time * 0.5 + i) * 0.01; c.yaw += Math.sin(this.time * 0.23 + i * 2) * 0.0004; c.updateBody(dt, this.camera); });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// In-match operator select (with countdown). Reuses the operator panel markup.
export class OperatorSelect {
  constructor(app, root, menu) { this.app = app; this.root = root; this.menu = menu; this.el = el('div', 'screen hidden'); root.appendChild(this.el); this.timer = 0; this.onDone = null; }
  open(side, takenIds, current, onDone, seconds = 25) {
    this.side = side; this.taken = new Set(takenIds); this.sel = current || Operators.find(o => o.side === side && !this.taken.has(o.id)).id; this.onDone = onDone; this.timer = seconds; this.takeDefuser = false; this.el.classList.remove('hidden'); this.render();
    this.app.menuScene.setMode('operator', this.sel);
  }
  close() { this.el.classList.add('hidden'); }
  render() {
    const op = OperatorById[this.sel]; const M = this.app.game && this.app.game.match;
    const grid = side => `<div class="ops-grid">${Operators.filter(o => o.side === side).map(o => `<button class="opbtn ${o.id === this.sel ? 'sel' : ''} ${(side !== this.side || this.taken.has(o.id)) ? 'taken' : ''}" data-op="${o.id}" title="${o.name}">${icon(o.icon)}</button>`).join('')}</div>`;
    const bots = this.app.game ? this.app.game.teamPreview(this.side) : [];
    this.el.innerHTML = `${this.menu.topbar('operators')}
      <div class="timerbar">${Math.ceil(this.timer)}<small>OPERATOR SELECT</small></div>
      <div class="ops-left"><div class="ops-header">${this.side === 'atk' ? 'CHOOSE YOUR ATTACKER' : 'CHOOSE YOUR DEFENDER'}${M ? ` — ROUND ${M.round + 1}` : ''}</div>
        <div class="ops-cols"><div class="ops-col"><h4>${icon('atk')} ATTACKERS</h4>${grid('atk')}</div><div class="ops-col"><h4>${icon('def')} DEFENDERS</h4>${grid('def')}</div></div></div>
      ${this.menu.opPanelHTML(op)}
      <div class="ops-ai"><div class="team">YOUR TEAM &nbsp;${bots.map(b => `<div class="mini ${b.you ? 'you' : ''}" title="${b.name}">${icon(b.icon)}</div>`).join('')}</div></div>
      <div class="ops-actions">${this.side === 'atk' ? `<button class="btn defuser-btn ${this.takeDefuser ? 'on' : ''}" data-action="defuser" title="Carry the defuser this round">${icon('defuser')}<span>${this.takeDefuser ? 'CARRYING THE DEFUSER' : 'PICK UP DEFUSER'}</span></button>` : ''}<button class="btn primary" data-action="ready">READY</button></div>`;
    this.el.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => { const o = OperatorById[b.dataset.op]; if (o.side !== this.side || this.taken.has(o.id)) return; AudioEngine.click('ui'); this.sel = o.id; this.render(); this.app.menuScene.setMode('operator', this.sel); }));
    this.el.querySelectorAll('[data-lo]').forEach(seg => seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { AudioEngine.click('ui'); this.menu.loadoutFor(this.sel)[seg.dataset.lo] = b.dataset.v; this.app.settings.loadouts = this.menu.loadouts; this.app.saveSettings(); this.render(); })));
    this.el.querySelector('[data-action=ready]').addEventListener('click', () => { AudioEngine.click('ui'); this.finish(); });
    const db = this.el.querySelector('[data-action=defuser]'); if (db) db.addEventListener('click', () => { AudioEngine.click('ui'); this.takeDefuser = !this.takeDefuser; this.render(); });
    this.el.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => AudioEngine.click('hover')));
  }
  update(dt) {
    if (this.el.classList.contains('hidden')) return;
    const prev = Math.ceil(this.timer); this.timer -= dt;
    if (Math.ceil(this.timer) !== prev) { const t = this.el.querySelector('.timerbar'); if (t) t.firstChild.textContent = Math.max(0, Math.ceil(this.timer)); }
    if (this.timer <= 0) this.finish();
  }
  finish() { if (this.el.classList.contains('hidden')) return; this.close(); const cb = this.onDone; this.onDone = null; cb && cb(this.sel, this.menu.loadoutFor(this.sel), { defuser: !!this.takeDefuser }); }
}
