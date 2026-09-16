import * as THREE from 'three';
import { Operators } from '../data/operators.js';
import { wallTouchesRoom } from './Bot.js';
import { Collider } from '../core/Physics.js';
import { Assets } from '../core/Assets.js';

// Round/match state machine: operator select → preparation → action → planted → round end.
// Also owns the defuser, reinforcement budget and the team-level AI plans for the round.

export const Presets = {
  casual: { name: 'QUICK MATCH', roundsToWin: 3, swapAfter: 2, prepTime: 30, actionTime: 180, bombTime: 45, plantTime: 7, defuseTime: 7 },
  ranked: { name: 'RANKED', roundsToWin: 4, swapAfter: 3, prepTime: 30, actionTime: 180, bombTime: 45, plantTime: 7, defuseTime: 7 },
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
  startRound(net = null) {
    const g = this.game;
    this.round++; this.planted = false; this.defuser = null; this.defuserDropped = null; this.reinforcementsLeft = 10; this.winner = null; this.reason = '';
    g.resetLevel(); g.gadgets.reset();
    // site: chosen or random (online: the host's pick arrives with the round)
    const sites = g.level.sites; this.site = net && net.site ? sites.find(s => s.id === net.site) : (this.s.site && this.s.site !== 'random' ? sites.find(s => s.id === this.s.site) : sites[Math.floor(Math.random() * sites.length)]);
    this.atkSpawnIdx = net && net.spawn !== undefined ? net.spawn : Math.floor(Math.random() * g.level.spawns.atk.length);
    this.site.bombs.forEach(b => { b.planted = false; b.device = this._bombDevice(b); });
    g.defensePlan = new DefensePlan(g, this.site); g.attackPlan = new AttackPlan(g, this.site);
    g.spawnAll();
    // the defuser: whoever picked it up in operator select, otherwise a random attacker
    const atk = g.characters.filter(c => c.side === 'atk');
    const pl = atk.find(c => c.isPlayer);
    let holder = net && net.defuserNid !== undefined ? atk.find(c => c.nid === net.defuserNid) : null;
    if (!holder && !(net && g.net && g.net.isClient)) { const wants = atk.filter(c => c.isPlayer ? g.playerWantsDefuser : c.wantsDefuser); holder = wants.length ? wants[Math.floor(Math.random() * wants.length)] : atk[Math.floor(Math.random() * atk.length)]; }
    if (holder) holder.hasDefuser = true; this.defuserNid = holder ? holder.nid : -1;
    g.hud.refreshGadgets();
    this.phase = 'prep'; this.timeLeft = this.s.prepTime;
    g.hud.phase('PREPARATION PHASE', this.site.name);
    g.hud.big(this.playerSide === 'atk' ? 'LOCATE THE OBJECTIVE' : 'SECURE THE SITE', this.playerSide === 'atk' ? 'ATTACKERS' : 'DEFENDERS', 3);
    g.audio.click('ui');
  }

  update(dt) {
    const g = this.game;
    if (g.net && g.net.isClient) return;   // phases, timers and outcomes arrive from the host
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
    const holder = g.characters.find(c => c.side === 'atk' && c.hasDefuser);
    if (holder && this.playerSide === 'atk') g.hud.toast(holder.isPlayer ? 'YOU ARE CARRYING THE DEFUSER' : holder.name + ' IS CARRYING THE DEFUSER', 3);
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
    const b = this.canPlant(ch); if (!b) { this.cancelPlant(ch); return false; }
    if (!ch.planting) { ch.plantSound = this.game.audio.tool('plant', ch.pos, this.s.plantTime); this.game.noise && this.game.noise(ch, 40); this.placeDevice(ch); }
    ch.planting += dt;
    if (ch.planting >= this.s.plantTime) { this._plant(ch, b); ch.planting = 0; return true; }
    return false;
  }
  cancelPlant(ch) { ch.planting = 0; if (ch.plantDevice) { this.game.scene.remove(ch.plantDevice); ch.plantDevice = null; } }
  // the defuser case set down on the floor in front of the planter while they arm it
  placeDevice(ch) {
    if (ch.plantDevice) return ch.plantDevice;
    const fwd = ch.forwardFlat(new THREE.Vector3()); const p = ch.pos.clone().addScaledVector(fwd, 0.62);
    const gy = this.game.world.groundAt(p.x, p.y + 0.8, p.z, 2); if (gy !== null) p.y = gy;
    const m = this._defuserMesh(p, ch.yaw + Math.PI / 2); this.game.scene.add(m); ch.plantDevice = m; return m;
  }
  _plant(ch, b) {
    const g = this.game; b.planted = true; ch.hasDefuser = false; this.planted = true; this.phase = 'planted'; this.timeLeft = this.s.bombTime;
    const pos = ch.plantDevice ? ch.plantDevice.position.clone() : ch.pos.clone(); const yaw = ch.plantDevice ? ch.plantDevice.rotation.y : ch.yaw;
    if (ch.plantDevice) { g.scene.remove(ch.plantDevice); ch.plantDevice = null; }
    this.defuser = { pos, planter: ch, mesh: this._defuserMesh(pos, yaw), progress: 0 };
    g.scene.add(this.defuser.mesh);
    if (g.net) g.net.onPlant(ch, pos, yaw, b.label, this.timeLeft);
    g.hud.phase('DEFUSER PLANTED', 'BOMB ' + b.label + ' — ' + b.room.name.toUpperCase());
    g.hud.big(this.playerSide === 'atk' ? 'DEFUSER PLANTED' : 'DEFUSER PLANTED', this.playerSide === 'atk' ? 'DEFEND THE DEFUSER' : 'DISABLE THE DEFUSER', 3);
    g.audio.beep(pos, 3200, 0.3, 0.6); g.noise && g.noise(ch, 80);
    if (ch.isPlayer) ch.score += 100;
    for (const c of g.characters) if (c.bot) { c.bot.stop(); c.bot.stateT = 99; }
  }
  // The bomb itself: a hard case with a canister, warning stripes and a blinking red light, sitting in the site.
  _bombDevice(b) {
    const g = this.game; const gr = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55, metalness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.35, metalness: 0.9 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.6, metalness: 0.1, emissive: 0x5a4000, emissiveIntensity: 0.4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 0.55), dark); box.position.y = 0.21; box.castShadow = true; box.receiveShadow = true; gr.add(box);
    for (const x of [-0.3, 0.3]) { const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.44, 0.57), stripe); band.position.set(x, 0.21, 0); gr.add(band); }
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.5), steel); lid.position.y = 0.45; gr.add(lid);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 20), steel); can.rotation.z = Math.PI / 2; can.position.set(0.05, 0.62, 0); can.castShadow = true; gr.add(can);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 20), dark); cap.rotation.z = Math.PI / 2; cap.position.set(-0.22, 0.62, 0); gr.add(cap);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.04), new THREE.MeshStandardMaterial({ color: 0x0b1420, emissive: 0x1f6fd0, emissiveIntensity: 1.2 })); panel.position.set(0.28, 0.6, 0.2); panel.rotation.x = -0.35; gr.add(panel);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 10), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 4 })); led.position.set(0.42, 0.5, 0.22); gr.add(led); gr.userData.led = led;
    const light = new THREE.PointLight(0xff3020, 1.2, 3.5, 2); light.position.set(0.4, 0.7, 0.2); gr.add(light); gr.userData.light = light;
    for (const z of [-0.2, 0.2]) { const wire = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0xaa2020, roughness: 0.7 })); wire.position.set(-0.35, 0.48, z); wire.rotation.y = Math.PI / 2; gr.add(wire); }
    // "A" / "B" stencil on the lid
    const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d'); x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#e8e8e8'; x.font = 'bold 96px Barlow Condensed, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(b.label, 64, 70);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: tex, transparent: true })); tag.rotation.x = -Math.PI / 2; tag.position.set(-0.28, 0.485, 0); gr.add(tag);
    gr.position.copy(b.pos); gr.position.y += 0.01; gr.rotation.y = b.label === 'A' ? 0.4 : -0.6; gr.scale.setScalar(1.3);
    g.level.dynamicGroup.add(gr);
    // solid so it blocks movement and bullets like a prop
    const hw = 0.62, hd = 0.4; gr.userData.col = g.world.add(new Collider(new THREE.Vector3(b.pos.x - hw, b.pos.y, b.pos.z - hd), new THREE.Vector3(b.pos.x + hw, b.pos.y + 0.98, b.pos.z + hd), { material: 'metal', tag: 'prop', floor: b.room.floor }));
    return gr;
  }
  // The defuser case (Meshy "Defuser Countdown" model, ~1.9 m in the file → 53 cm case, handle up).
  _defuserMesh(pos, yaw = 0) {
    const gr = new THREE.Group();
    const model = Assets.cloneStatic('prop_defuser');
    if (model) { model.scale.setScalar(0.28); model.position.y = 0.094; model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } }); gr.add(model); }
    else { const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.45, metalness: 0.6 })); box.position.y = 0.1; gr.add(box); }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 4 })); led.position.set(0.12, 0.2, 0.08); gr.add(led); gr.userData.led = led;
    gr.position.copy(pos); gr.rotation.y = yaw; gr.userData.keypad = new THREE.Vector3(0.05, 0.19, 0.02);   // local point the hands work on
    return gr;
  }
  // world-space point on the device the operator's hand works on
  defuserHandPoint(mesh, out) { return mesh.localToWorld(out.copy(mesh.userData.keypad)); }
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
    if (this.game.net) this.game.net.onDropped(pos);
    this.game.hud.toast('DEFUSER DROPPED');
  }
  pickupDefuser(ch) { if (!this.defuserDropped || ch.side !== 'atk' || ch.dead || ch.dbno) return false; this.game.scene.remove(this.defuserDropped.mesh); this.defuserDropped = null; ch.hasDefuser = true; this.game.audio.click('ui'); if (ch.isPlayer) this.game.hud.toast('DEFUSER PICKED UP'); if (this.game.net) this.game.net.onPickup(ch); return true; }

  reinforce(wall, ch) { if (this.reinforcementsLeft <= 0 || wall.reinforced) return false; if (wall.reinforce()) { this.reinforcementsLeft--; this.game.hud.refreshGadgets(); return true; } return false; }

  // ----- round end -----
  endRound(team, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    const g = this.game;
    if (g.net && g.net.isHost) g.net.onRoundEnd(this.sideOfTeam(team), reason);
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
  // online client: the host says the round is over and operator select begins
  netNextRound() { if (this.phase !== 'opselect') this._nextRound(); }
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
    for (const r of rooms) { const y = r.min.y; const ins = 1.1; const cs = [[r.min.x + ins, r.min.z + ins], [r.max.x - ins, r.min.z + ins], [r.min.x + ins, r.max.z - ins], [r.max.x - ins, r.max.z - ins]]; for (const [x, z] of cs) { const p = new THREE.Vector3(x, y, z); const n = game.nav.nearest(p, 1.5); if (n) { const [nx, nz] = game.nav.center(n.ix, n.iz); const doors = this.slots.filter(s => s.kind === 'door' && s.x >= r.min.x - 0.3 && s.x <= r.max.x + 0.3 && s.z >= r.min.z - 0.3 && s.z <= r.max.z + 0.3 && !s._keepOpen); const tgt = doors.length ? doors.slice().sort((a, b) => Math.hypot(a.x - nx, a.z - nz) - Math.hypot(b.x - nx, b.z - nz))[Math.min(doors.length - 1, 1)] : null; const yaw = tgt ? Math.atan2(-(tgt.x - nx), -(tgt.z - nz)) : Math.atan2(-(r.center.x - nx), -(r.center.z - nz)); this.holds.push({ pos: new THREE.Vector3(nx, n.y, nz), yaw, room: r }); } } }
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
    const inward = new THREE.Vector3(L.center.x - s.x, 0, L.center.z - s.z); inward.y = 0; inward.normalize();
    // stage beside the opening, against the wall, out of the line of fire through it
    const along = s.horizontal ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1); const sideSign = Math.random() < 0.5 ? -1 : 1;
    const outside = out.clone().addScaledVector(inward, -1.3).addScaledVector(along, sideSign * (s.w / 2 + 1.6)); const insidePt = out.clone().addScaledVector(inward, 1.5);
    const bombIdx = Math.floor(Math.random() * 2);
    const bomb = this.site.bombs[bombIdx];
    const route = [outside, insidePt, bomb.pos.clone()];
    bot.role = Math.random() < 0.3 ? 'rusher' : 'entry';
    return { route, stage: 0, bombIdx, entry: s };
  }
}
