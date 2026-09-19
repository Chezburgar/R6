import * as THREE from 'three';
import { Match, DefensePlan, AttackPlan } from '../game/Match.js';
import { Bot } from '../game/Bot.js';
import { Stance } from '../game/Character.js';
import { Input } from '../core/Input.js';
import { Operators, OperatorById } from '../data/operators.js';
import { maskOp, HOSTAGE_OP, COURIER_OP, SPEAKERS } from './Story.js';
import { AllyBot, HVTBot, GuardBot, HostageBot, CampaignDefensePlan, GuardPlan } from './CampaignBots.js';

// Campaign mission controller. Replaces the round state machine of a Bomb match with a scripted,
// linear mission: intro fly-over → (preparation) → action → objectives → mission end. Bots, the HUD
// and interactions keep reading the same Match fields (phase, site, timeLeft, playerSide...), so the
// match systems work unchanged; the mission script drives objectives, markers, radio and win / loss.

const _v = new THREE.Vector3();
const SUB_SPEED = 0.05;   // seconds per character of subtitle

export class CampaignMatch extends Match {
  constructor(game, settings, mission, difficulty) {
    super(game, { name: mission.name, roundsToWin: 1, swapAfter: 99, prepTime: mission.prepTime || 0, actionTime: 600, bombTime: 45, plantTime: 7, defuseTime: 7, side: mission.side, site: mission.site || 'random', difficulty });
    this.mission = mission; this.difficulty = difficulty || 'normal'; this.isCampaign = true;
    this.objectives = mission.objectives.map(o => ({ ...o, state: 'pending', progress: 0 }));
    this.markers = [];          // objective markers drawn by the HUD: { key, cls, pos, label, dist }
    this.subs = []; this.cur = null; this.fired = new Set();
    this.stats = { time: 0, allyDeaths: 0, playerDowned: 0, hostageHit: 0, identified: 0, kills: 0 };
    this.result = null; this.cinematic = false; this.countdown = false; this.timerLabel = ''; this.lockDrone = false; this.droneHint = null; this.prepExitHint = null;
    this.deadT = 0; this._contact = false;
  }

  // ---------- objectives ----------
  obj(id) { return this.objectives.find(o => o.id === id); }
  activate(id) { const o = this.obj(id); if (o && o.state === 'pending') { o.state = 'active'; this._refresh(); } }
  progress(id, n) { const o = this.obj(id); if (!o || o.state === 'done') return; o.progress = n; if (o.count && n >= o.count) this.complete(id); else this._refresh(); }
  complete(id) {
    const o = this.obj(id); if (!o || o.state === 'done') return false;
    o.state = 'done'; if (o.count) o.progress = o.count;
    this.game.hud.objectiveDone(o.text); this.game.audio.objective && this.game.audio.objective();
    this._refresh(); return true;
  }
  get allDone() { return this.objectives.every(o => o.state === 'done'); }
  _refresh() {
    const g = this.game; g.hud.objectives(this.objectives);
    const active = this.objectives.find(o => o.state === 'active') || this.objectives.find(o => o.state === 'pending');
    g.hud.phase(this.mission.code + ' — ' + this.mission.name, active ? active.text.toUpperCase() : 'MISSION COMPLETE');
  }
  marker(key, cls, pos, label, on = true) {
    const i = this.markers.findIndex(m => m.key === key);
    if (!on) { if (i >= 0) this.markers.splice(i, 1); return; }
    if (i >= 0) { this.markers[i].pos.copy(pos); this.markers[i].label = label; return; }
    this.markers.push({ key, cls, pos: pos.clone(), label });
  }

  // ---------- radio ----------
  say(key, force = false) {
    if (!force && this.fired.has(key)) return; this.fired.add(key);
    const lines = this.mission.dialogue[key]; if (!lines) return;
    for (const [who, text] of lines) this.subs.push({ who: SPEAKERS[who] || who.toUpperCase(), text, t: 1.6 + text.length * SUB_SPEED });
  }
  _subsUpdate(dt) {
    const g = this.game;
    if (!this.cur) { const n = this.subs.shift(); if (n) { this.cur = n; g.hud.subtitle(n.who, n.text); g.audio.radio && g.audio.radio(); } return; }
    this.cur.t -= dt; if (this.cur.t <= 0) { this.cur = null; g.hud.subtitle(null); }
  }

  // ---------- roster ----------
  _enemyDiff() {
    const order = ['easy', 'normal', 'hard']; let i = order.indexOf(this.mission.enemyDiff || 'normal');
    if (this.difficulty === 'easy') i--; if (this.difficulty === 'hard') i++;
    return order[Math.max(0, Math.min(2, i))];
  }
  _roster(opId, loadout) {
    const m = this.mission; const g = this.game; const side = m.side; const enemySide = side === 'atk' ? 'def' : 'atk';
    const lo = id => g.app.menu.loadoutFor(id); const diff = this._enemyDiff();
    const allies = m.allies.filter(id => id !== opId).map(id => ({ op: OperatorById[id], loadout: lo(id), diff: 'normal', cls: side === 'atk' ? AllyBot : Bot }));
    // the player took one of the scripted teammates: fill the slot with another operator of the side
    const pool = Operators.filter(o => o.side === side && o.id !== opId && !allies.some(a => a.op.id === o.id));
    while (allies.length < m.allies.length && pool.length) { const o = pool.shift(); allies.push({ op: o, loadout: lo(o.id), diff: 'normal', cls: side === 'atk' ? AllyBot : Bot }); }
    const enemyPool = Operators.filter(o => o.side === enemySide);
    const enemies = [];
    const EnemyCls = m.type === 'hvt' ? GuardBot : Bot;
    for (let i = 0; i < m.enemies; i++) { const base = enemyPool[(i + Math.floor(Math.random() * 2)) % enemyPool.length]; enemies.push({ op: maskOp(base.id), loadout: lo(base.id), diff, noDBNO: true, kind: 'enemy', cls: EnemyCls }); }
    const extras = [];
    if (m.type === 'hvt') extras.push({ kind: 'hvt', op: COURIER_OP, loadout: lo('kapkan'), diff, noDBNO: true, health: 240, cls: HVTBot, args: [m.hvtRooms.map(n => this._room(n))] });
    if (m.type === 'hostage') extras.push({ kind: 'hostage', op: HOSTAGE_OP, loadout: null, noTarget: true, noDBNO: true, cls: HostageBot });
    return { player: { op: OperatorById[opId], loadout, side }, allies, enemies, extras };
  }
  _room(name) { return this.game.level.rooms.find(r => r.name === name); }

  // ---------- mission start ----------
  startMission(pick) {
    const g = this.game; const m = this.mission;
    this.round = 1; this.planted = false; this.defuser = null; this.defuserDropped = null; this.reinforcementsLeft = 10;
    g.resetLevel(); g.gadgets.reset();
    g.setTimeOfDay(m.tod);
    const sites = g.level.sites; this.site = m.site && m.site !== 'random' ? sites.find(s => s.id === m.site) : sites[Math.floor(Math.random() * sites.length)];
    this.atkSpawnIdx = (m.spawn === undefined || m.spawn === 'random') ? Math.floor(Math.random() * g.level.spawns.atk.length) : m.spawn;
    for (const b of this.site.bombs) { b.planted = false; b.device = null; b.disabled = false; }
    g.setupTeamsCampaign(this._roster(pick.op, pick.loadout));
    this.hvt = g.extras.find(b => b.char.campaignKind === 'hvt') || null;
    this.hostage = g.extras.find(b => b.char.campaignKind === 'hostage') || null;
    this.script = Scripts[m.type](this);
    this.script.setup();
    this._spawn();
    if (m.timeLimit) { this.countdown = true; this.timeLeft = m.timeLimit; this.timerLabel = 'DEVICE'; } else { this.countdown = false; this.timeLeft = 0; this.timerLabel = 'MISSION TIME'; }
    this.objectives.forEach(o => { o.state = 'pending'; o.progress = 0; }); this.activate(this.objectives[0].id);
    g.hud.refreshGadgets();
    this._intro();
  }
  _spawn() {
    const g = this.game; const L = g.level; const m = this.mission; const P = g.player;
    const spawn = L.spawns.atk[this.atkSpawnIdx]; this.atkSpawn = spawn;
    const faceCenter = p => Math.atan2(-(L.center.x - p.x), -(L.center.z - p.z));
    const put = (ch, p, yaw) => { if (ch.isPlayer) P.spawn(p, yaw); else ch.bot.spawn(p, yaw); ch.gadgetUses = 0; ch.gadget2Uses = 0; ch.hasDefuser = false; };
    let i = 0;
    for (const c of g.characters) {
      if (c.campaignKind === 'enemy' || c.campaignKind === 'hvt' || c.campaignKind === 'hostage') continue;
      if (m.side === 'atk') { const p = spawn.points[i++ % spawn.points.length]; put(c, p, faceCenter(p)); }
      else { const p = g.findClearSpot(this.site.defSpawns[i++ % this.site.defSpawns.length]); put(c, p, Math.random() * Math.PI * 2); }
    }
    this.script.spawnEnemies();
    g.hud.refreshGadgets(); g.applyQuality(); g.warmup();
    P.dronesLeft = 2; g.pings.length = 0;
    if (m.side === 'atk' && (m.prepTime || m.type === 'recon')) g.enterDrone(spawn.pos);
    g.hud.drone(P.usingDrone); g.audio.ambience(false);
  }
  // put a bot in a room (nearest clear spot to a random point inside it)
  placeIn(bot, room, yaw) {
    const g = this.game; const p = new THREE.Vector3(room.center.x, room.min.y, room.center.z);
    const q = g.nav.randomWalkableNear(p, Math.min(room.max.x - room.min.x, room.max.z - room.min.z) * 0.35) || p;
    bot.spawn(g.findClearSpot(q), yaw !== undefined ? yaw : Math.random() * Math.PI * 2);
    bot.char.gadgetUses = 0; bot.char.gadget2Uses = 0;
  }
  // park a bot out of the world until its wave is called
  park(bot) { const C = bot.char; C.hidden = true; C.dead = true; C.alive = false; C.pos.set(0, -60, 0); C.setVisible(false); C.root.position.copy(C.pos); }
  unpark(bot, p, yaw) { const C = bot.char; C.hidden = false; bot.spawn(p, yaw); bot.atkPlan = null; bot.enterAt = 0; bot.rallyDone = true; C.gadgetUses = 0; C.gadget2Uses = 0; }

  // ---------- intro fly-over ----------
  _intro() {
    const g = this.game; const L = g.level; const m = this.mission; const c = L.center;
    const dirs = [[1, 0], [-1, 0], [0, -1]]; const d = dirs[this.atkSpawnIdx] || [0, -1];
    this.introFrom = new THREE.Vector3(c.x + d[0] * 52 + d[1] * 14, 15, c.z + d[1] * 52 - d[0] * 14);
    this.introTo = new THREE.Vector3(c.x + d[0] * 30 - d[1] * 10, 8.5, c.z + d[1] * 30 + d[0] * 10);
    this.cinematic = true; this.introT = 0; this.phase = 'intro';
    g.hud.show(false); g.hud.titleCard(m.code, m.name, `${m.location} · ${m.clock} LOCAL`);
    g.player._hideVM(true); this.game.camera.fov = 58; this.game.camera.updateProjectionMatrix();
  }
  _introUpdate(dt) {
    const g = this.game; const cam = g.camera; this.introT += dt;
    const k = Math.min(1, this.introT / 6.5); const e = k * k * (3 - 2 * k);
    cam.position.lerpVectors(this.introFrom, this.introTo, e); cam.lookAt(g.level.center.x, 2.5, g.level.center.z); cam.updateMatrixWorld(true);
    g.player._hideVM(true); g.hud.titleProgress(k);
    if (this.introT > 6.5 || (this.introT > 1.0 && (Input.fireHit() || Input.hit('jump') || Input.hit('interact')))) this._beginPlay();
  }
  _beginPlay() {
    const g = this.game; const m = this.mission;
    this.cinematic = false; g.hud.show(true); g.hud.titleCard(null);
    g.camera.fov = g.settings.fov; g.camera.updateProjectionMatrix();
    if (m.prepTime) { this.phase = 'prep'; this.timeLeft = this.countdown ? this.timeLeft : m.prepTime; this.prepLeft = m.prepTime; this.timerLabel = this.countdown ? 'DEVICE' : 'PREPARATION'; g.hud.big(this.playerSide === 'atk' ? 'DRONE PHASE' : 'FORTIFY THE SITE', m.name, 3); }
    else this._startAction();
    this._refresh(); this.say('start');
    this.script.begin && this.script.begin();
  }
  _startAction() {
    const g = this.game; this.phase = 'action';
    if (!this.countdown) this.timerLabel = 'MISSION TIME';
    if (this.script.action) this.script.action(); else g.onActionPhase();
    if (this.lockDrone) { g.player.usingDrone = !!g.player.drone; g.hud.drone(g.player.usingDrone); }
    this.say('action');
  }

  // ---------- frame ----------
  update(dt) {
    if (this.phase === 'none' || this.phase === 'ended') return;
    if (this.cinematic) { this._introUpdate(dt); return; }
    const g = this.game;
    this.stats.time += dt; this._subsUpdate(dt);
    if (this.phase === 'prep') {
      this.prepLeft -= dt; if (this.countdown) this.timeLeft -= dt; else this.timeLeft = this.prepLeft;
      if (this.prepLeft <= 0) { this.complete('fortify'); this._startAction(); }
    } else if (this.countdown) { this.timeLeft -= dt; if (this.timeLeft <= 0) { this.timeLeft = 0; this.script.timeout && this.script.timeout(); } }
    else this.timeLeft = this.stats.time;
    if (this.countdown && this.timeLeft < 60) this.say('oneMinute');
    this._fail(dt); if (this.phase === 'ended') return;
    this.script.update(dt);
  }
  _fail(dt) {
    const P = this.game.player.char;
    if (P.dead) { this.deadT += dt; if (this.deadT > 3.2) this.end(false, 'KILLED IN ACTION'); }
    if (this.hostage && this.hostage.char.dead) this.end(false, 'THE HOSTAGE WAS KILLED');
  }
  // the player's view point (drone, camera or operator eye) for line-of-sight objectives
  viewPoint() { const P = this.game.player; if (P.usingDrone && P.drone) { const p = P.drone.pos.clone(); p.y += 0.2; return p; } return this.game.camera.position.clone(); }
  // target: a Vector3 or a character; ignore: a collider that must not block the view (the object itself)
  canSee(target, maxDist = 14, ignore = null) {
    const eye = this.viewPoint(); const p = target.clone ? target.clone() : target.chestPos(new THREE.Vector3());
    if (eye.distanceTo(p) > maxDist) return false;
    const dir = _v.subVectors(p, eye).normalize(); const fwd = this.game.camera.getWorldDirection(new THREE.Vector3());
    if (fwd.dot(dir) < 0.35) return false;
    return this.game.world.visible(eye, p, ignore ? c => c !== ignore : null);
  }
  enemiesAlive() { return this.game.characters.filter(c => c.side !== this.playerSide && !c.dead && !c.hidden && c.campaignKind !== 'hostage'); }
  enemiesDead() { return this.game.characters.filter(c => c.side !== this.playerSide && c.dead && !c.hidden); }
  playerNear(p, r) { const P = this.game.player; if (P.usingDrone) return false; return P.char.pos.distanceTo(p) < r; }
  inRoom(p, r) { return p.x >= r.min.x && p.x <= r.max.x && p.z >= r.min.z && p.z <= r.max.z && p.y >= r.min.y - 0.6 && p.y < r.max.y; }

  // ---------- events from Game ----------
  onDeath(victim, killer) {
    if (victim.side === this.playerSide && !victim.isPlayer && victim.campaignKind !== 'hostage') this.stats.allyDeaths++;
    if (killer && killer.isPlayer && victim.side !== this.playerSide) this.stats.kills++;
    if (victim.side !== this.playerSide && !this._contact) { this._contact = true; this.say('contact'); }
    this.script.onDeath && this.script.onDeath(victim, killer);
  }
  onDBNO(victim) { if (victim.isPlayer) this.stats.playerDowned++; }
  onIdentify(ch) { if (ch.side !== this.playerSide && !ch.identified) { ch.identified = true; this.stats.identified++; this.script.onIdentify && this.script.onIdentify(ch); } }
  onPlayerDamaged() { if (!this._contact) { this._contact = true; this.say('contact'); } }
  interactions(C) { return this.script.interactions ? this.script.interactions(C) : []; }
  // the Bomb-mode plant / defuse never applies in a mission
  canPlant() { return null; }
  canDefuse() { return false; }
  teamPreview() { const m = this.mission; return [{ name: 'YOU', icon: OperatorById[m.featured].icon, you: true }, ...m.allies.map(id => ({ name: OperatorById[id].name, icon: OperatorById[id].icon, you: false }))]; }

  // ---------- end ----------
  end(success, reason) {
    if (this.phase === 'ended') return;
    const g = this.game; this.phase = 'ended';
    const stars = success ? this._stars() : 0;
    this.result = { success, reason, time: this.stats.time, par: this.mission.par, kills: this.stats.kills, stars, bonus: success && this._bonus(), mission: this.mission, allyDeaths: this.stats.allyDeaths, downed: this.stats.playerDowned, shots: g.stats.shots || 0, hits: g.stats.hits || 0, headshots: g.stats.headshots };
    g.hud.subtitle(null); g.hud.prompt(null); g.hud.progress(-1);
    g.hud.big(success ? 'MISSION COMPLETE' : 'MISSION FAILED', reason, 4);
    g.audio.roundStinger(success);
    if (g.player.interaction) g.player._cancelInteraction();
    setTimeout(() => { if (g.app.game === g) g.app.campaignEnd(this.result); }, 3200);
  }
  _bonus() {
    const b = this.mission.bonus; if (!b) return false;
    switch (b.id) {
      case 'identifyAll': return this.stats.identified >= this.mission.enemies;
      case 'noAllyLoss': return this.stats.allyDeaths === 0;
      case 'notDowned': return this.stats.playerDowned === 0;
      case 'hostageUnharmed': return this.stats.hostageHit === 0;
    }
    return false;
  }
  _stars() { let s = 1; if (this.stats.time <= this.mission.par) s++; if (this._bonus()) s++; return s; }
}

// ---------------------------------------------------------------------------------------------
// Mission scripts. Each returns { setup, spawnEnemies, begin?, action?, update, interactions?, onDeath?, onIdentify?, timeout? }

const Scripts = {
  // Drone-only intel run: identify hostiles, find the device, drive the drone back out.
  recon(M) {
    const g = M.game; const m = M.mission; let device = null, jammedSaid = false;
    return {
      setup() {
        const rooms = ['Tellers', 'Bathroom', 'Lobby', 'Main Hallway', 'Ventilation Room', 'Workshop', 'Waiting Room'].map(n => M._room(n));
        g.defensePlan = new CampaignDefensePlan(g, M.site, rooms, 3); g.attackPlan = new AttackPlan(g, M.site);
        M.lockDrone = true; M.droneHint = 'RECON — IDENTIFY HOSTILES · LOCATE THE DEVICE'; M.prepExitHint = 'STAY ON THE DRONE — RECON ONLY';
        const b = M.site.bombs[0]; b.device = M._bombDevice(b); device = b;
      },
      spawnEnemies() {
        const rooms = ['Tellers', 'Bathroom', 'Lobby', 'Main Hallway', 'Ventilation Room', 'Workshop'].map(n => M._room(n));
        g.enemies.forEach((b, i) => M.placeIn(b, rooms[i % rooms.length]));
      },
      begin() { M.activate('device'); },
      update() {
        const P = g.player; const d = P.drone;
        if (d && !jammedSaid && d.jammed) { jammedSaid = true; M.say('jammed'); }
        if (M.obj('device').state !== 'done' && d && P.usingDrone) { const p = device.pos.clone(); p.y += 0.6; if (M.canSee(p, 7, device.device.userData.col)) { M.complete('device'); M.say('device'); M.marker('device', 'obj', p, 'DEVICE'); } }
        if (M.obj('identify').state === 'done' && M.obj('device').state === 'done' && M.obj('exfil').state === 'pending') { M.activate('exfil'); M.say('exfil'); M.marker('home', 'obj', M.atkSpawn.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 'EXFIL'); }
        if (M.obj('exfil').state === 'active' && d && !g.level.isInterior(d.pos) && d.pos.distanceTo(M.atkSpawn.pos) < 22) { M.complete('exfil'); M.end(true, 'INTEL DELIVERED'); }
      },
      onIdentify() {
        M.progress('identify', M.stats.identified);
        if (M.stats.identified === 1) M.say('identify1');
        if (M.stats.identified >= 4) M.say('identify');
        if (M.stats.identified >= m.enemies) M.say('identifyAll');
      },
    };
  },

  // Clear the ground floor.
  assault(M) {
    const g = M.game; const m = M.mission; let rooms;
    return {
      setup() {
        rooms = m.enemyRooms.map(n => M._room(n));
        g.defensePlan = new CampaignDefensePlan(g, M.site, rooms, 3); g.attackPlan = new AttackPlan(g, M.site);
      },
      spawnEnemies() { g.enemies.forEach((b, i) => M.placeIn(b, rooms[i % rooms.length])); },
      update() {
        const P = g.player;
        if (M.obj('breach').state !== 'done' && !P.usingDrone && g.level.isInterior(P.char.pos)) { M.complete('breach'); M.activate('clear'); M.say('breach'); }
        const dead = M.enemiesDead().length; const total = g.enemies.length;
        if (M.obj('clear').state !== 'done') { M.progress('clear', dead); if (dead >= Math.ceil(total / 2)) M.say('half'); if (dead === total - 1) M.say('lastOne'); }
        if (dead >= total) { M.complete('breach'); M.complete('clear'); M.say('complete'); M.end(true, 'GROUND FLOOR CLEARED'); }
      },
    };
  },

  // Fortify, then repel three waves of attackers.
  defend(M) {
    const g = M.game; const m = M.mission; let wave = 0, waveT = 0, waveActive = false;
    const spawnWave = () => {
      wave++; waveActive = true; const n = m.waves[wave - 1]; const L = g.level;
      const sp = L.spawns.atk[Math.floor(Math.random() * L.spawns.atk.length)];
      const faceCenter = p => Math.atan2(-(L.center.x - p.x), -(L.center.z - p.z));
      g.enemies.slice(0, n).forEach((b, i) => { const p = sp.points[i % sp.points.length].clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)); M.unpark(b, p, faceCenter(p)); b.enterAt = 0; });
      M.activate('wave' + wave); M.timerLabel = 'WAVE ' + wave + ' / ' + m.waves.length;
      g.hud.big('WAVE ' + wave, n + ' HOSTILES — ' + sp.name, 3); g.audio.click('ui');
      M.marker('wave', 'enemyping', sp.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), sp.name); setTimeout(() => M.marker('wave', '', sp.pos, '', false), 9000);
    };
    return {
      setup() { g.defensePlan = new DefensePlan(g, M.site); g.attackPlan = new AttackPlan(g, M.site); },
      spawnEnemies() { for (const b of g.enemies) M.park(b); },
      action() { g.onActionPhase(); waveT = 14; },
      update(dt) {
        if (M.phase !== 'action') return;
        if (!waveActive) { waveT -= dt; if (waveT <= 0) { if (wave >= m.waves.length) { M.end(true, 'STATION HELD'); } else spawnWave(); } return; }
        if (M.enemiesAlive().length === 0) { waveActive = false; M.complete('wave' + wave); M.say('wave' + wave); waveT = wave >= m.waves.length ? 2.5 : 12; M.timerLabel = 'RESET'; }
      },
      onDeath(victim, killer) { if (killer && killer.side === 'atk' && victim.side === 'def' && !M.fired.has('contact')) M.say('contact'); },
    };
  },

  // Find and kill the courier, take the detonator, get out.
  hvt(M) {
    const g = M.game; const m = M.mission; let patrol, exfil, body = null;
    return {
      setup() {
        patrol = m.patrol.map(n => M._room(n));
        g.defensePlan = new GuardPlan(g, M.hvt.char, 5); g.attackPlan = new AttackPlan(g, M.site);
        // half the detail shadows the courier, the rest patrol the floor
        g.enemies.forEach((b, i) => { if (i % 2 === 0) b.ward = M.hvt.char; else b.patrolRooms = patrol; });
        exfil = g.level.spawns.atk[0].pos.clone();
      },
      spawnEnemies() {
        const start = m.hvtRooms.map(n => M._room(n))[Math.floor(Math.random() * m.hvtRooms.length)];
        M.placeIn(M.hvt, start);
        g.enemies.forEach((b, i) => M.placeIn(b, i % 2 === 0 ? start : patrol[i % patrol.length]));
        M.hvt.moveT = 20 + Math.random() * 10;
      },
      update() {
        const H = M.hvt.char;
        if (M.obj('locate').state !== 'done') { if (H.pingedUntil > g.time || H.scanned > g.time || M.canSee(H, 16)) { M.complete('locate'); M.activate('eliminate'); M.say('locate'); } }
        if (M.obj('locate').state === 'done' && !H.dead) { const p = H.chestPos(new THREE.Vector3()); p.y += 0.5; M.marker('hvt', 'scan', p, 'COURIER'); }
        if (H.dead && M.obj('eliminate').state !== 'done') { M.complete('locate'); M.complete('eliminate'); M.activate('recover'); M.say('eliminate'); body = H.pos.clone(); M.marker('hvt', '', body, '', false); M.marker('body', 'obj', body.clone().add(new THREE.Vector3(0, 0.5, 0)), 'DETONATOR'); }
        if (M.obj('exfil').state === 'active') { M.marker('exfil', 'obj', exfil.clone().add(new THREE.Vector3(0, 0.8, 0)), 'EXFIL'); if (M.playerNear(exfil, 5)) { M.complete('exfil'); M.say('exfil'); M.end(true, 'DETONATOR RECOVERED'); } }
      },
      interactions(C) {
        if (!C.isPlayer || !body || M.obj('recover').state !== 'active' || C.pos.distanceTo(body) > 1.9) return [];
        return [{ label: 'RECOVER DETONATOR', dur: 2.5, crouch: true, hand: (o) => o.copy(body).add(new THREE.Vector3(0, 0.25, 0)), start: () => { C._recStop = g.audio.tool('defuse', body, 2.5); }, done: () => { M.complete('recover'); M.activate('exfil'); M.say('recover'); M.marker('body', '', body, '', false); C.score += 100; }, cancel: () => { C._recStop && C._recStop(); } }];
      },
    };
  },

  // Locate, secure and extract the hostage.
  hostage(M) {
    const g = M.game; const m = M.mission; let patrol, cell, extract;
    return {
      setup() {
        patrol = m.patrol.map(n => M._room(n));
        cell = m.hostageRooms.map(n => M._room(n))[Math.floor(Math.random() * m.hostageRooms.length)];
        // two guards fortify the cell (and the room next to it) during the drone phase, the rest patrol
        const adj = g.level.rooms.filter(r => r !== cell && r.floor === cell.floor).sort((a, b) => a.center.distanceTo(cell.center) - b.center.distanceTo(cell.center))[0];
        g.defensePlan = new CampaignDefensePlan(g, { ...M.site, rooms: [cell, adj], center: cell.center.clone() }, patrol, 2);
        g.attackPlan = new AttackPlan(g, M.site);
        extract = g.level.spawns.atk[1].pos.clone();
        M.droneHint = 'DRONE PHASE — LOCATE THE HOSTAGE';
      },
      spawnEnemies() {
        M.placeIn(M.hostage, cell); M.hostage.char.onDamaged = () => { M.stats.hostageHit++; M.say('hostageHit'); };
        g.enemies.forEach((b, i) => M.placeIn(b, i < 2 ? cell : patrol[i % patrol.length]));
      },
      update() {
        const H = M.hostage; const HC = H.char; const P = g.player;
        if (M.obj('locate').state !== 'done' && M.canSee(HC, 14)) { M.complete('locate'); M.activate('secure'); M.say('locate'); }
        if (M.obj('locate').state === 'done' && !H.secured) { const p = HC.chestPos(new THREE.Vector3()); p.y += 0.5; M.marker('hostage', 'obj', p, 'HOSTAGE'); }
        if (M.obj('extract').state === 'active') {
          M.marker('extract', 'obj', extract.clone().add(new THREE.Vector3(0, 0.8, 0)), 'EXTRACTION');
          if (!P.usingDrone && P.char.pos.distanceTo(extract) < 6 && HC.pos.distanceTo(extract) < 7) { M.complete('extract'); M.say('extract'); M.end(true, 'HOSTAGE EXTRACTED'); }
        }
      },
      interactions(C) {
        const H = M.hostage; if (!C.isPlayer || H.secured || H.char.dead || C.pos.distanceTo(H.char.pos) > 1.8 || M.phase === 'prep') return [];
        return [{ label: 'SECURE HOSTAGE', dur: 3, hand: (o) => H.char.chestPos(o), done: () => { H.secured = true; M.complete('locate'); M.complete('secure'); M.activate('extract'); M.say('secure'); M.marker('hostage', '', H.char.pos, '', false); C.score += 150; } }];
      },
    };
  },

  // Disable both canisters before the timer runs out.
  defuse(M) {
    const g = M.game; const m = M.mission; const disabled = new Set();
    return {
      setup() {
        g.defensePlan = new DefensePlan(g, M.site); g.attackPlan = new AttackPlan(g, M.site);
        for (const b of M.site.bombs) { b.device = M._bombDevice(b); b.armed = true; }
        M.droneHint = 'DRONE PHASE — FIND A WAY INTO THE SITE';
        M.obj('deviceA').text = 'Disable canister A — ' + M.site.rooms[0].name; M.obj('deviceB').text = 'Disable canister B — ' + M.site.rooms[1].name;
      },
      spawnEnemies() {
        const pts = M.site.defSpawns; const near = g.level.rooms.filter(r => r.floor === M.site.rooms[0].floor && !M.site.rooms.includes(r) && r.center.distanceTo(M.site.center) < 16);
        g.enemies.forEach((b, i) => { if (i < 6) { b.spawn(g.findClearSpot(pts[i % pts.length]), Math.random() * Math.PI * 2); } else M.placeIn(b, near[i % near.length] || M.site.rooms[0]); });
      },
      update() {
        const P = g.player; const site = M.site;
        for (const b of site.bombs) { const p = b.pos.clone(); p.y += 0.9; M.marker('bomb' + b.label, b.armed ? 'obj' : 'done', p, b.armed ? 'CANISTER ' + b.label : 'DISABLED'); }
        if (M.obj('reach').state !== 'done' && !P.usingDrone && site.rooms.some(r => M.inRoom(P.char.pos, r))) { M.complete('reach'); M.activate('deviceA'); M.activate('deviceB'); M.say('reach'); }
        if (site.bombs.every(b => !b.armed)) { M.complete('reach'); M.end(true, 'DEVICE DISABLED'); }
      },
      timeout() {
        const site = M.site; for (const b of site.bombs) if (b.armed) { const p = b.pos.clone(); p.y += 0.5; g.effects.explosion(p, 7); g.level.explode(p, 3.5, g.effects); g.ballistics.explode(null, p, 12, 400, 'explosionKill'); }
        M.say('fail'); M.end(false, 'THE DEVICE DETONATED');
      },
      interactions(C) {
        if (!C.isPlayer || C.dbno || M.phase === 'prep') return [];
        const out = [];
        for (const b of M.site.bombs) {
          if (!b.armed || C.pos.distanceTo(b.pos) > 1.7) continue;
          const hand = (o) => { b.device.localToWorld(o.set(0.28, 0.6, 0.2)); o.y += Math.abs(Math.sin(g.time * 9)) * 0.04; return o; };
          out.push({ label: 'DISABLE CANISTER ' + b.label, dur: 7, crouch: true, hand, start: () => { b._stop = g.audio.tool('defuse', b.pos, 7); g.noise(C, 30); }, done: () => { b.armed = false; b.device.userData.led.material.emissiveIntensity = 0; b.device.userData.light.intensity = 0; b.device.userData.led.material.emissive.setHex(0x20c040); b.device.userData.led.material.emissiveIntensity = 3; M.complete('device' + b.label); M.say('device' + b.label); C.score += 200; }, cancel: () => { b._stop && b._stop(); } });
          break;
        }
        return out;
      },
    };
  },
};
