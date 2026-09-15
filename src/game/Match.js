import * as THREE from 'three';
import { Operators } from '../data/operators.js';
import { wallTouchesRoom } from './Bot.js';

// Round/match state machine: operator select → preparation → action → planted → round end.
// Also owns the defuser, reinforcement budget and the team-level AI plans for the round.

export const Presets = {
  casual: { name: 'QUICK MATCH', roundsToWin: 3, swapAfter: 2, prepTime: 45, actionTime: 180, bombTime: 45, plantTime: 7, defuseTime: 7 },
  ranked: { name: 'RANKED', roundsToWin: 4, swapAfter: 3, prepTime: 45, actionTime: 180, bombTime: 45, plantTime: 7, defuseTime: 7 },
  quick: { name: 'LIGHTNING', roundsToWin: 2, swapAfter: 1, prepTime: 20, actionTime: 120, bombTime: 40, plantTime: 6, defuseTime: 6 },
};

export class Match {
  constructor(game, settings) {
    this.game = game; this.s = settings;
    this.phase = 'none'; this.round = 0; this.timeLeft = 0;
    this.score = { A: 0, B: 0 };   // A = player's team
    this.playerSide = settings.side || 'atk';
    this.reinforcementsLeft = 10;
    this.site = null; this.defuser = null; this.defuserDropped = null; this.planted = false;
    this.feed = [];
    this.winner = null; this.reason = '';
    this.roundEndT = 0;
    this.history = [];
  }
  get atkTeam() { return this.playerSide === 'atk' ? 'A' : 'B'; }
  get defTeam() { return this.playerSide === 'def' ? 'A' : 'B'; }
  sideOfTeam(t) { return t === 'A' ? this.playerSide : (this.playerSide === 'atk' ? 'def' : 'atk'); }
  scoreFor(side) { return side === this.playerSide ? this.score.A : this.score.B; }

  // Called after operator select each round.
  startRound() {
    const g = this.game;
    this.round++; this.planted = false; this.defuser = null; this.defuserDropped = null; this.reinforcementsLeft = 10; this.winner = null; this.reason = '';
    g.resetLevel(); g.gadgets.reset();
    // site: chosen or random
    const sites = g.level.sites; this.site = this.s.site && this.s.site !== 'random' ? sites.find(s => s.id === this.s.site) : sites[Math.floor(Math.random() * sites.length)];
    this.site.bombs.forEach(b => b.planted = false);
    g.defensePlan = new DefensePlan(g, this.site); g.attackPlan = new AttackPlan(g, this.site);
    g.spawnAll();
    this.phase = 'prep'; this.timeLeft = this.s.prepTime;
    g.hud.phase('PREPARATION PHASE', this.site.name);
    g.hud.big(this.playerSide === 'atk' ? 'LOCATE THE OBJECTIVE' : 'SECURE THE SITE', this.playerSide === 'atk' ? 'ATTACKERS' : 'DEFENDERS', 3);
    g.audio.click('ui');
  }

  update(dt) {
    const g = this.game;
    if (this.phase === 'prep') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this._startAction();
    } else if (this.phase === 'action') {
      this.timeLeft -= dt;
      this._checkElimination();
      if (this.phase === 'action' && this.timeLeft <= 0) this.endRound(this.defTeam, 'TIME RAN OUT');
    } else if (this.phase === 'planted') {
      this.timeLeft -= dt;
      this._tick(dt);
      // defenders eliminated after plant → attackers win
      const defAlive = g.characters.some(c => c.side === 'def' && !c.dead);
      if (!defAlive) this.endRound(this.atkTeam, 'ALL DEFENDERS ELIMINATED');
      else if (this.timeLeft <= 0) { const p = this.defuser.pos.clone(); g.effects.explosion(p, 6); g.level.explode(p, 3, g.effects); g.ballistics.explode(null, p, 9, 300, 'explosionKill'); this.endRound(this.atkTeam, 'DEFUSER DETONATED'); }
    } else if (this.phase === 'roundEnd') {
      this.roundEndT -= dt;
      if (this.roundEndT <= 0) this._nextRound();
    }
  }
  _tick(dt) {
    this._tickT = (this._tickT || 0) - dt;
    if (this._tickT <= 0) { const urg = 1 - this.timeLeft / this.s.bombTime; this._tickT = Math.max(0.12, 1.0 - urg * 0.85); this.game.audio.bombTick(this.defuser.pos, urg); }
  }
  _startAction() {
    const g = this.game;
    this.phase = 'action'; this.timeLeft = this.s.actionTime;
    g.onActionPhase();
    g.hud.phase('ACTION PHASE', this.site.name);
    g.hud.big(this.playerSide === 'atk' ? 'PLANT THE DEFUSER' : 'DEFEND THE OBJECTIVE', this.site.name, 3);
    // defuser holder: player if attacking, else random bot
    const atk = g.characters.filter(c => c.side === 'atk' && !c.dead);
    // like Siege, the defuser goes to a random attacker (the player half the time so it stays hands-on)
    const pl = atk.find(c => c.isPlayer); const holder = (pl && Math.random() < 0.5) ? pl : atk[Math.floor(Math.random() * atk.length)];
    if (holder) { holder.hasDefuser = true; if (holder.isPlayer) g.hud.toast('YOU ARE CARRYING THE DEFUSER'); }
  }
  _checkElimination() {
    const g = this.game;
    const atkAlive = g.characters.some(c => c.side === 'atk' && !c.dead);
    const defAlive = g.characters.some(c => c.side === 'def' && !c.dead);
    if (!atkAlive) this.endRound(this.defTeam, 'ALL ATTACKERS ELIMINATED');
    else if (!defAlive) this.endRound(this.atkTeam, 'ALL DEFENDERS ELIMINATED');
  }

  // ----- defuser -----
  plantTarget(ch) { return this.site.bombs.find(b => !b.planted) ? this.site.bombs.slice().sort((a, b) => a.pos.distanceTo(ch.pos) - b.pos.distanceTo(ch.pos))[0] : null; }
  inZone(p, z) { return p.x >= z.min.x && p.x <= z.max.x && p.z >= z.min.z && p.z <= z.max.z && p.y >= z.min.y && p.y <= z.max.y; }
  canPlant(ch) { if (this.phase !== 'action' || !ch.hasDefuser || ch.dbno) return null; for (const b of this.site.bombs) if (this.inZone(ch.pos, b.zone)) return b; return null; }
  plantProgress(ch, dt) {
    const b = this.canPlant(ch); if (!b) { ch.planting = 0; return false; }
    if (!ch.planting) { ch.plantSound = this.game.audio.tool('plant', ch.pos, this.s.plantTime); this.game.noise && this.game.noise(ch, 40); }
    ch.planting += dt;
    if (ch.planting >= this.s.plantTime) { this._plant(ch, b); ch.planting = 0; return true; }
    return false;
  }
  cancelPlant(ch) { ch.planting = 0; }
  _plant(ch, b) {
    const g = this.game; b.planted = true; ch.hasDefuser = false; this.planted = true; this.phase = 'planted'; this.timeLeft = this.s.bombTime;
    const pos = ch.pos.clone(); this.defuser = { pos, planter: ch, mesh: this._defuserMesh(pos), progress: 0 };
    g.scene.add(this.defuser.mesh);
    g.hud.phase('DEFUSER PLANTED', 'BOMB ' + b.label + ' — ' + b.room.name.toUpperCase());
    g.hud.big(this.playerSide === 'atk' ? 'DEFUSER PLANTED' : 'DEFUSER PLANTED', this.playerSide === 'atk' ? 'DEFEND THE DEFUSER' : 'DISABLE THE DEFUSER', 3);
    g.audio.beep(pos, 3200, 0.3, 0.6); g.noise && g.noise(ch, 80);
    if (ch.isPlayer) ch.score += 100;
    for (const c of g.characters) if (c.bot) { c.bot.stop(); c.bot.stateT = 99; }
  }
  _defuserMesh(pos) {
    const gr = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.45, metalness: 0.6 })); box.position.y = 0.1; gr.add(box);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x30c0ff, emissiveIntensity: 1.6 })); screen.position.set(-0.08, 0.21, 0); gr.add(screen);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshStandardMaterial({ emissive: 0xff2020, emissiveIntensity: 4 })); led.position.set(0.15, 0.22, 0.1); gr.add(led); gr.userData.led = led;
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35), new THREE.MeshStandardMaterial({ color: 0x111 })); ant.position.set(0.2, 0.35, -0.12); gr.add(ant);
    gr.position.copy(pos); box.castShadow = true;
    return gr;
  }
  canDefuse(ch) { return this.phase === 'planted' && ch.side === 'def' && !ch.dbno && this.defuser && ch.pos.distanceTo(this.defuser.pos) < 1.6; }
  defuseProgress(ch, dt) {
    if (!this.canDefuse(ch)) { ch.defusing = 0; return false; }
    if (!ch.defusing) { this.game.audio.tool('defuse', this.defuser.pos, this.s.defuseTime); }
    ch.defusing = (ch.defusing || 0) + dt;
    if (ch.defusing >= this.s.defuseTime) { ch.defusing = 0; if (ch.isPlayer) ch.score += 100; this.endRound(this.defTeam, 'DEFUSER DISABLED'); return true; }
    return false;
  }
  dropDefuser(ch) {
    if (!ch.hasDefuser) return; ch.hasDefuser = false;
    const pos = ch.pos.clone(); const mesh = this._defuserMesh(pos); this.game.scene.add(mesh);
    this.defuserDropped = { pos, mesh };
    this.game.hud.toast('DEFUSER DROPPED');
  }
  pickupDefuser(ch) { if (!this.defuserDropped || ch.side !== 'atk' || ch.dead || ch.dbno) return false; this.game.scene.remove(this.defuserDropped.mesh); this.defuserDropped = null; ch.hasDefuser = true; this.game.audio.click('ui'); if (ch.isPlayer) this.game.hud.toast('DEFUSER PICKED UP'); return true; }

  reinforce(wall, ch) { if (this.reinforcementsLeft <= 0 || wall.reinforced) return false; if (wall.reinforce()) { this.reinforcementsLeft--; this.game.hud.refreshGadgets(); return true; } return false; }

  // ----- round end -----
  endRound(team, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    const g = this.game;
    this.score[team]++; this.winner = team; this.reason = reason;
    this.history.push({ round: this.round, winner: team, reason, playerSide: this.playerSide });
    const playerWon = team === 'A';
    this.phase = 'roundEnd'; this.roundEndT = 7;
    if (this.defuser) { g.scene.remove(this.defuser.mesh); }
    if (this.defuserDropped) g.scene.remove(this.defuserDropped.mesh);
    g.onRoundEnd(playerWon, reason);
    g.audio.roundStinger(playerWon);
    const done = this.score.A >= this.s.roundsToWin || this.score.B >= this.s.roundsToWin;
    if (done) { this.phase = 'matchEnd'; setTimeout(() => g.onMatchEnd(this.score.A > this.score.B), 5000); }
  }
  _nextRound() {
    // side swap at the end of each half
    if (this.round % this.s.swapAfter === 0) { this.playerSide = this.playerSide === 'atk' ? 'def' : 'atk'; this.game.onSideSwap(); }
    this.phase = 'opselect';
    this.game.onOperatorSelect();
  }
}

// ---------------------------------------------------------------------------------------------
// Team plans

export class DefensePlan {
  constructor(game, site) {
    this.game = game; this.site = site; const L = game.level;
    const rooms = site.rooms;
    // candidate reinforcements: soft walls touching a site room but not both site rooms
    const cand = L.softWalls.filter(w => { const a = wallTouchesRoom(w, rooms[0]), b = wallTouchesRoom(w, rooms[1]); return (a || b) && !(a && b) && w.reinforceable && !w.reinforced; });
    cand.sort((a, b) => b.len - a.len);
    this.walls = cand.slice(0, 10);
    // barricade slots belonging to site rooms
    this.slots = L.barricadeSlots.filter(s => rooms.some(r => Math.abs(s.floor - r.floor) < 0.5 && s.x >= r.min.x - 0.3 && s.x <= r.max.x + 0.3 && s.z >= r.min.z - 0.3 && s.z <= r.max.z + 0.3));
    this.doorSlots = this.slots.filter(s => s.kind === 'door'); this.windowSlots = this.slots.filter(s => s.kind === 'window');
    // leave the door between the two site rooms (and one interior door) open so defenders can rotate
    for (const s of this.doorSlots) { const inBoth = rooms.every(r => s.x >= r.min.x - 0.3 && s.x <= r.max.x + 0.3 && s.z >= r.min.z - 0.3 && s.z <= r.max.z + 0.3); if (inBoth) s._keepOpen = true; }
    const interior = this.doorSlots.filter(s => !s.exterior && !s._keepOpen); if (interior.length) interior[interior.length - 1]._keepOpen = true;
    this.wallIdx = 0; this.slotIdx = 0; this.holdIdx = 0;
    // hold spots: room corners
    this.holds = [];
    for (const r of rooms) { const y = r.min.y; const ins = 1.1; const cs = [[r.min.x + ins, r.min.z + ins], [r.max.x - ins, r.min.z + ins], [r.min.x + ins, r.max.z - ins], [r.max.x - ins, r.max.z - ins]]; for (const [x, z] of cs) { const p = new THREE.Vector3(x, y, z); const n = game.nav.nearest(p, 1.5); if (n) { const [nx, nz] = game.nav.center(n.ix, n.iz); this.holds.push({ pos: new THREE.Vector3(nx, n.y, nz), yaw: Math.atan2(-(r.center.x - nx), -(r.center.z - nz)), room: r }); } } }
    // roam spots: adjacent rooms centers
    this.roams = L.rooms.filter(r => !rooms.includes(r) && r.floor === rooms[0].floor && r.center.distanceTo(site.center) < 18).map(r => ({ pos: game.nav.randomWalkableNear(r.center, 2) || r.center.clone(), yaw: Math.atan2(-(site.center.x - r.center.x), -(site.center.z - r.center.z)), room: r }));
  }
  // build the task list for one bot
  take(bot) {
    const tasks = []; const op = bot.op; const C = bot.char; const g = this.game;
    const inside = (w) => { // a point 1m inside the site room from the wall
      const room = this.site.rooms.find(r => wallTouchesRoom(w, r)) || this.site.rooms[0];
      const n = w.normal.clone(); const side = Math.sign(room.center.clone().sub(w.center).dot(n)) || 1;
      const p = w.center.clone().addScaledVector(n, side * 1.0); p.y = w.y0; return p;
    };
    const perBot = Math.ceil(this.walls.length / 4);
    for (let k = 0; k < perBot && this.wallIdx < this.walls.length; k++) { const w = this.walls[this.wallIdx++]; tasks.push({ type: 'reinforce', wall: w, pos: inside(w) }); }
    const nearSlots = this.slots.filter(s => !s.barricade.alive() && !s._taken && !s._keepOpen).sort((a, b) => Math.hypot(a.x - C.pos.x, a.z - C.pos.z) - Math.hypot(b.x - C.pos.x, b.z - C.pos.z)).slice(0, 3);
    for (const s of nearSlots) { s._taken = true; const room = this.site.rooms.find(r => s.x >= r.min.x - 0.3 && s.x <= r.max.x + 0.3 && s.z >= r.min.z - 0.3 && s.z <= r.max.z + 0.3) || this.site.rooms[0]; const dir = room.center.clone().sub(new THREE.Vector3(s.x, s.y, s.z)); dir.y = 0; dir.normalize(); const p = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(dir, 0.9); tasks.push({ type: 'barricade', slot: s, pos: p }); }
    // unique gadgets
    const r0 = this.site.rooms[0];
    switch (op.gadget) {
      case 'rook': tasks.unshift({ type: 'gadget', pos: g.nav.randomWalkableNear(r0.center, 1.5) || r0.center.clone() }); break;
      case 'mute': for (const w of this.walls.slice(0, 2)) tasks.push({ type: 'gadget', pos: inside(w).addScaledVector(w.normal, 0.2) }); for (const s of this.doorSlots.slice(0, 2)) { const room = this.site.rooms[0]; const dir = room.center.clone().sub(new THREE.Vector3(s.x, s.y, s.z)); dir.y = 0; dir.normalize(); tasks.push({ type: 'gadget', pos: new THREE.Vector3(s.x, s.y, s.z).addScaledVector(dir, 1.0) }); } break;
      case 'kapkan': for (const s of this.doorSlots.slice(0, 5)) { const room = this.site.rooms[0]; const dir = room.center.clone().sub(new THREE.Vector3(s.x, s.y, s.z)); dir.y = 0; dir.normalize(); tasks.push({ type: 'gadget', slot: s, pos: new THREE.Vector3(s.x, s.y, s.z).addScaledVector(dir, 1.0) }); } break;
      case 'frost': for (const s of [...this.windowSlots, ...this.doorSlots].slice(0, 3)) { const room = this.site.rooms[0]; const dir = room.center.clone().sub(new THREE.Vector3(s.x, s.y, s.z)); dir.y = 0; dir.normalize(); tasks.push({ type: 'gadget', pos: new THREE.Vector3(s.x, s.y, s.z).addScaledVector(dir, 0.8), normal: dir }); } break;
      case 'bandit': for (const w of this.walls.slice(0, 4)) tasks.push({ type: 'gadget', wall: w, pos: inside(w) }); break;
    }
    // secondary gadgets
    if (C.gadget2 === 'barbed') for (const s of this.doorSlots.slice(0, 2)) { const room = this.site.rooms[0]; const dir = room.center.clone().sub(new THREE.Vector3(s.x, s.y, s.z)); dir.y = 0; dir.normalize(); tasks.push({ type: 'gadget2', pos: new THREE.Vector3(s.x, s.y, s.z).addScaledVector(dir, 1.3) }); }
    if (C.gadget2 === 'shield') { const h = this.holds[(this.holdIdx) % this.holds.length]; if (h) tasks.push({ type: 'gadget2', pos: h.pos.clone().addScaledVector(new THREE.Vector3(-Math.sin(h.yaw), 0, -Math.cos(h.yaw)), 1.0), normal: new THREE.Vector3(-Math.sin(h.yaw), 0, -Math.cos(h.yaw)) }); }
    bot.role = (op.id === 'bandit' || op.id === 'frost') && this.roams.length ? 'roamer' : 'anchor';
    return tasks;
  }
  holdSpot(bot) {
    if (bot.role === 'roamer' && this.roams.length) { const r = this.roams[Math.floor(Math.random() * this.roams.length)]; return r; }
    const h = this.holds[this.holdIdx++ % this.holds.length] || { pos: this.site.center.clone(), yaw: 0 };
    return h;
  }
}

export class AttackPlan {
  constructor(game, site) {
    this.game = game; this.site = site; const L = game.level;
    // exterior openings on the site floor (or ground floor for 2F sites), nearest the site
    const floor = 0;
    const ext = L.barricadeSlots.filter(s => s.exterior && s.floor === floor).map(s => ({ s, d: Math.hypot(s.x - site.center.x, s.z - site.center.z) })).sort((a, b) => a.d - b.d);
    this.entries = ext.slice(0, 4).map(e => e.s);
    this.idx = 0;
  }
  assign(bot) {
    const L = this.game.level; const C = bot.char;
    const s = this.entries[this.idx++ % this.entries.length];
    // point outside the opening
    const out = new THREE.Vector3(s.x, s.y, s.z);
    const inward = new THREE.Vector3(16 - s.x, 0, 11 - s.z); inward.y = 0; inward.normalize();
    const outside = out.clone().addScaledVector(inward, -2.2); const insidePt = out.clone().addScaledVector(inward, 1.5);
    const bombIdx = Math.floor(Math.random() * 2);
    const bomb = this.site.bombs[bombIdx];
    const route = [outside, insidePt, bomb.pos.clone()];
    bot.role = Math.random() < 0.3 ? 'rusher' : 'entry';
    return { route, stage: 0, bombIdx, entry: s };
  }
}
