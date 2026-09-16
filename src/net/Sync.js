import * as THREE from 'three';
import { Net } from './Net.js';
import { Weapons } from '../data/weapons.js';
import { OperatorById } from '../data/operators.js';
import { Stance } from '../game/Character.js';

// Game-side replication. The host runs the full simulation (bots, ballistics, destruction,
// gadgets, match flow) and streams snapshots + events; clients own only their movement/aim and
// send inputs-as-intent (fire, melee, interactions, gadget use). Characters are addressed by
// their index in the shared roster (nid).

const RATE = 1 / 20;
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class NetSync {
  constructor(game) {
    this.game = game; this.acc = 0; this.events = []; this.roster = null; this.me = null;
    this.remoteState = new Map();        // nid -> latest state packet (host: from clients)
    this.smooth = new Map();             // nid -> { pos, yaw, pitch } targets (client)
    this.entityByNid = new Map(); this.nextEntity = 1;
    this.ready = new Map();              // host: pid -> {op, lo, def}
    this._install();
  }
  get isHost() { return Net.isHost; }
  get isClient() { return Net.isClient; }
  get myPid() { return Net.isHost ? 'host' : Net.id; }

  _install() {
    const g = this.game;
    Net.on('s', (d, from) => { if (!this.isHost) return; this.remoteState.set(from, d); });
    Net.on('S', d => this.isClient && this._applySnapshot(d));
    Net.on('E', d => this.isClient && this._applyEvents(d.e));
    Net.on('fire', (d, from) => this.isHost && this._hostFire(d, from));
    Net.on('melee', (d, from) => this.isHost && this._hostMelee(d, from));
    Net.on('act', (d, from) => this.isHost && this._hostAct(d, from));
    Net.on('gad', (d, from) => this.isHost && this._hostGadget(d, from));
    Net.on('intel', (d, from) => this.isHost && this._hostIntel(d, from));
    Net.on('drop', (d, from) => { if (!this.isHost) return; const c = this._charOf(from); if (c) g.match.dropDefuser(c); });
    Net.on('ready', (d, from) => { if (!this.isHost) return; this.ready.set(from, d); this.onReady && this.onReady(); });
    Net.on('leave', pid => { if (!this.isHost) return; const c = this._charOf(pid); if (c && !c.dead) { c.die(null, null, false); this.event({ k: 'toast', txt: c.name + ' LEFT THE MATCH' }); } });
  }

  // ---------- roster ----------
  charByNid(n) { return this.game.characters.find(c => c.nid === n); }
  _charOf(pid) { return this.game.characters.find(c => c.pid === pid); }
  fakeCam(state) {
    const p = new THREE.Vector3(state.p[0], state.p[1] + (state.st === 1 ? 1.08 : state.st === 2 ? 0.42 : 1.62), state.p[2]);
    const d = new THREE.Vector3(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch));
    return { getWorldPosition: o => o.copy(p), getWorldDirection: o => o.copy(d), position: p };
  }

  // ---------- per-frame ----------
  tick(dt) {
    const g = this.game; Net.tick(dt);
    if (this.isHost) {
      // remote humans follow the state their client reported (client-authoritative movement)
      for (const c of g.characters) {
        if (!c.remote || !c.isHuman) continue;
        const s = this.remoteState.get(c.pid); if (!s) continue;
        this._applyState(c, s, dt, false);
        c.updateBody(dt, g.camera);
      }
      this.acc += dt;
      if (this.acc >= RATE) { this.acc -= RATE; this._sendSnapshot(); }
      else if (this.events.length > 12) this._flushEvents();
    } else if (this.isClient) {
      // everyone but me interpolates toward the host's last snapshot
      for (const c of g.characters) {
        if (c === g.player.char) continue;
        const s = this.smooth.get(c.nid); if (!s) continue;
        this._applyState(c, s, dt, true);
        c.updateBody(dt, g.camera);
      }
      this.acc += dt;
      if (this.acc >= RATE) { this.acc -= RATE; this._sendState(); }
    }
  }
  _applyState(c, s, dt, lerp) {
    if (lerp) { const k = Math.min(1, dt * 14); c.pos.x += (s.p[0] - c.pos.x) * k; c.pos.y += (s.p[1] - c.pos.y) * k; c.pos.z += (s.p[2] - c.pos.z) * k; if (c.pos.distanceToSquared(_v.set(s.p[0], s.p[1], s.p[2])) > 9) c.pos.copy(_v); let dy = s.yaw - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); c.yaw += dy * k; c.pitch += (s.pitch - c.pitch) * k; }
    else { c.pos.set(s.p[0], s.p[1], s.p[2]); c.yaw = s.yaw; c.pitch = s.pitch; }
    c.stance = s.st; c.sprinting = !!s.sp; c.lean = s.ln; c.ads = s.ads; c.speedNorm = s.mv; c.lowReadyTarget = s.lr;
    if (c.weaponIndex !== s.w && c.weapons[s.w]) c.switchWeapon(s.w);
    c.grounded = true;
  }
  _sendState() {
    const P = this.game.player; const C = P.char; if (!C) return;
    Net.send({ t: 's', p: [r3(C.pos.x), r3(C.pos.y), r3(C.pos.z)], yaw: r3(C.yaw), pitch: r3(C.pitch), st: C.stance, sp: C.sprinting ? 1 : 0, ln: r2(C.lean), ads: r2(C.ads), w: C.weaponIndex, mv: r2(C.speedNorm), lr: r2(C.lowReadyTarget) });
  }
  _sendSnapshot() {
    const g = this.game; const M = g.match;
    const ch = g.characters.map(c => [c.nid, r3(c.pos.x), r3(c.pos.y), r3(c.pos.z), r3(c.yaw), r3(c.pitch), c.stance, c.sprinting ? 1 : 0, r2(c.lean), r2(c.ads), c.weaponIndex, r2(c.speedNorm), Math.round(c.health), c.dbno ? 1 : 0, c.dead ? 1 : 0, c.hasDefuser ? 1 : 0, r2(c.lowReadyTarget), c.armorPlate ? 1 : 0, Math.round(c.dbnoHealth)]);
    Net.broadcast({ t: 'S', tm: r2(g.time), ph: M.phase, tl: r2(M.timeLeft), sc: { atk: M.scoreFor('atk'), def: M.scoreFor('def') }, rf: M.reinforcementsLeft, ch, e: this.events.length ? this.events : undefined });
    this.events = [];
  }
  _flushEvents() { if (!this.events.length) return; Net.broadcast({ t: 'E', e: this.events }); this.events = []; }
  event(e) { if (this.isHost) this.events.push(e); }

  // ---------- client: apply ----------
  _applySnapshot(d) {
    const g = this.game; const M = g.match; const me = g.player.char;
    M.timeLeft = d.tl; g.time = d.tm; M.reinforcementsLeft = d.rf;
    if (d.ph !== M.phase && (d.ph === 'prep' || d.ph === 'action' || d.ph === 'planted')) { const was = M.phase; M.phase = d.ph; if (d.ph === 'action' && was === 'prep') { g.onActionPhase(); g.hud.phase('ACTION PHASE', M.site.name); g.hud.big(M.playerSide === 'atk' ? 'PLANT THE DEFUSER' : 'DEFEND THE OBJECTIVE', M.site.name, 3); } }
    M.score.A = M.playerSide === 'atk' ? d.sc.atk : d.sc.def; M.score.B = M.playerSide === 'atk' ? d.sc.def : d.sc.atk;
    for (const s of d.ch) {
      const [nid, x, y, z, yaw, pitch, st, sp, ln, ads, w, mv, hp, dbno, dead, def, lr, ap, dh] = s;
      const c = this.charByNid(nid); if (!c) continue;
      // health and life state are the host's word for everyone, including me
      c.health = hp; c.hasDefuser = !!def; c.armorPlate = !!ap; c.dbnoHealth = dh;
      if (dead && !c.dead) this._netDie(c); else if (dbno && !c.dbno && !c.dead) this._netDBNO(c); else if (!dbno && c.dbno && !dead) { c.dbno = false; c.health = hp; if (c.actions) { for (const k of ['dieF', 'dieB', 'dieS']) { const a = c.actions[k]; if (a) { a.setEffectiveWeight(0); a.stop(); } } if (c.actions.idle) { c.actions.idle.setEffectiveWeight(1); c.actions.idle.play(); } } }
      if (c === me) continue;
      this.smooth.set(nid, { p: [x, y, z], yaw, pitch, st, sp, ln, ads, w, mv, lr });
    }
    if (d.e) this._applyEvents(d.e);
  }
  _netDie(c) {
    const g = this.game;
    c.dead = true; c.alive = false; c.health = 0; const wasDBNO = c.dbno; c.dbno = false;
    if (!wasDBNO) c._playDeathAnim(null, false);
    if (c === g.player.char) { g.player.dead = true; g.player._deathT = 0; g.hud.prompt(null); g.hud.progress(-1); if (g.player.interaction) g.player._cancelInteraction(); }
  }
  _netDBNO(c) {
    const g = this.game;
    c.dbno = true; c.dbnoHealth = 20; c.health = 0; c.dbnoTimer = 0; c.ads = 0; c.sprinting = false; c._playDeathAnim(null, true);
    if (c === g.player.char) { g.hud.big('DOWNED', 'CRAWL TO SAFETY — WAIT FOR REVIVE', 3); if (g.player.interaction) g.player._cancelInteraction(); g.player.adsBlend = 0; }
  }
  _applyEvents(list) {
    const g = this.game; const M = g.match; const L = g.level; const me = g.player.char;
    for (const e of list) {
      try {
        switch (e.k) {
          case 'shot': { const c = this.charByNid(e.n); if (!c || c === me) break; const def = Weapons[e.w]; if (!def) break; const o = new THREE.Vector3(...e.o), d = new THREE.Vector3(...e.d); const mz = c.muzzleWorld(new THREE.Vector3()); g.ballistics.shoot(c, o, d, def, { cosmetic: true, tracer: !e.pl, fxOrigin: mz }); if (!e.pl) { g.effects.muzzleFlash(mz, d, def.flash, false); g.audio.gunshot({ cal: def.cal }, mz, false); } break; }
          case 'hit': { const p = new THREE.Vector3(...e.p); g.effects.bloodHit(p, new THREE.Vector3(...e.d)); g.audio.impact(p, 'flesh'); if (e.a === me.nid) g.hud.hitmarker(false, e.z === 'head'); break; }
          case 'dmg': if (e.n === me.nid) { g.hud.damage(e.a, e.fp ? new THREE.Vector3(...e.fp) : null, me); g.player.camShake = Math.min(1, g.player.camShake + e.a / 60); } break;
          case 'death': { const v = this.charByNid(e.v), a = e.a >= 0 ? this.charByNid(e.a) : null; if (v) { if (!v.dead) this._netDie(v); g.hud.feed(a, v, e.w, e.hs); if (v === me) g.hud.big('YOU WERE KILLED', a ? 'BY ' + a.name : '', 3); if (a === me) { g.stats.kills++; if (e.hs) g.stats.headshots++; g.hud.hitmarker(true, e.hs); } } break; }
          case 'dbno': { const v = this.charByNid(e.v), a = e.a >= 0 ? this.charByNid(e.a) : null; if (v) { if (!v.dbno && !v.dead) this._netDBNO(v); g.hud.feed(a, { name: v.name + ' (DOWNED)', side: v.side }, e.w, false); if (a === me) g.hud.hitmarker(true, false); } break; }
          case 'revive': { const c = this.charByNid(e.n); if (c && c === me) g.hud.toast('REVIVED'); break; }
          case 'cell': { const w = L.softWalls[e.w]; if (w) { const cell = w.cells[w.cellIndex(e.i, e.j)]; if (cell && !cell.dead) w.destroyCell(cell); } break; }
          case 'studs': L.removeStudsNear(new THREE.Vector3(...e.p), e.r); break;
          case 'reinf': { const w = L.softWalls[e.w]; if (w && !w.reinforced) w.reinforce(); g.hud.refreshGadgets(); break; }
          case 'bar': { const s = L.barricadeSlots[e.s]; if (!s) break; const b = s.barricade;
            if (e.op === 'begin') { if (!b.building && !b.built) { b.beginBuild(new THREE.Vector3(...e.p), false); b.netBuild = 0; } }
            else if (e.op === 'finish') { if (b.building) b.finish(); else if (!b.built) b.build(new THREE.Vector3(...e.p)); }
            else if (e.op === 'cancel') { if (b.building) b.cancelBuild(); }
            else if (e.op === 'part') { const p = b.parts[e.i]; if (p && !p.dead) { b._killPart(p); L.onBarricadeChunk && L.onBarricadeChunk(p.center, b.inward); b._afterDamage(); } }
            else if (e.op === 'destroy') b.destroy();
            break; }
          case 'glass': { const pane = L.glass[e.i]; if (pane && !pane.broken) L.breakGlass(pane, g.effects); break; }
          case 'hatch': { const h = L.hatches[e.i]; if (!h) break; if (e.reinforced && !h.reinforced) h.reinforce(); if (e.open && !h.open) { h.reinforced = false; h.destroy(); } break; }
          case 'gad': this._clientGadget(e); break;
          case 'phase': { M.phase = e.ph; M.timeLeft = e.tl; break; }
          case 'plant': { const c = this.charByNid(e.n); const pos = new THREE.Vector3(...e.p); M.planted = true; M.phase = 'planted'; M.timeLeft = e.tl; const bomb = M.site.bombs.find(b => b.label === e.b); if (bomb) bomb.planted = true; if (c) { c.hasDefuser = false; M.cancelPlant(c); } if (M.defuser) g.scene.remove(M.defuser.mesh); M.defuser = { pos, planter: c, mesh: M._defuserMesh(pos, e.yaw), progress: 0 }; g.scene.add(M.defuser.mesh); g.hud.phase('DEFUSER PLANTED', 'BOMB ' + e.b); g.hud.big('DEFUSER PLANTED', M.playerSide === 'atk' ? 'DEFEND THE DEFUSER' : 'DISABLE THE DEFUSER', 3); g.audio.beep(pos, 3200, 0.3, 0.6); break; }
          case 'dropped': { const pos = new THREE.Vector3(...e.p); if (M.defuserDropped) g.scene.remove(M.defuserDropped.mesh); const mesh = M._defuserMesh(pos); g.scene.add(mesh); M.defuserDropped = { pos, mesh }; g.hud.toast('DEFUSER DROPPED'); break; }
          case 'pickup': { if (M.defuserDropped) { g.scene.remove(M.defuserDropped.mesh); M.defuserDropped = null; } const c = this.charByNid(e.n); if (c === me) g.hud.toast('DEFUSER PICKED UP'); g.hud.refreshGadgets(); break; }
          case 'end': { const team = e.ws === M.playerSide ? 'A' : 'B'; M.endRound(team, e.why); break; }
          case 'ping': { g.pings.push({ kind: e.kind, pos: new THREE.Vector3(...e.p), t: e.kind === 'enemy' ? 5 : 6, label: e.label || '' }); g.audio.ping(e.kind === 'enemy' ? 'enemy' : 'yellow'); break; }
          case 'ident': { const c = this.charByNid(e.n); if (c) { c.pingedUntil = g.time + 3.5; g.audio.identify(); } break; }
          case 'stun': if (e.n === me.nid) { me.stunned = Math.max(me.stunned, e.d); g.hud.stun(e.i); g.audio.stun(e.i); } break;
          case 'emp': if (e.n === me.nid) { me.empd = Math.max(me.empd, e.d); } break;
          case 'fx': { const p = new THREE.Vector3(...e.p); if (e.f === 'explosion') { g.effects.explosion(p, e.s); g.audio.explosion(p, e.s); } else if (e.f === 'stun') { g.effects.stunFlash(p); g.audio.explosion(p, 0.5); } else if (e.f === 'smoke') { g.effects.smokeCloud(p, 3.2, 11); g.gadgets.smokes.push({ pos: p, r: 3.0, until: g.time + 11 }); } else if (e.f === 'emp') { g.effects.empPulse(p); g.audio.emp(p); } else if (e.f === 'thermite') { g.effects.thermiteBurn && g.effects.thermiteBurn(p, new THREE.Vector3(...e.n)); } else if (e.f === 'melee') { g.audio.melee(p, true, e.m); g.effects.impact(p, new THREE.Vector3(...e.n), e.m); } break; }
          case 'toast': if (e.n === undefined || e.n === me.nid) g.hud.toast(e.txt, e.s || 2.2); break;
          case 'scan': { if (e.side === me.side) { for (const n of e.ns) { const c = this.charByNid(n); if (c) c.pingedUntil = g.time + 5; } g.audio.scan(); } break; }
        }
      } catch (err) { console.warn('[net] event failed', e, err); }
    }
  }

  // ---------- client: send intents ----------
  sendFire(origin, dir, def, opts) { Net.send({ t: 'fire', o: [r3(origin.x), r3(origin.y), r3(origin.z)], d: [r3(dir.x), r3(dir.y), r3(dir.z)], w: def.id || def.name, ads: !!opts.ads, mv: !!opts.moving, st: opts.stance || 0, pl: !!opts.pellet }); }
  sendMelee(origin, dir) { Net.send({ t: 'melee', o: [r3(origin.x), r3(origin.y), r3(origin.z)], d: [r3(dir.x), r3(dir.y), r3(dir.z)] }); }
  sendAct(net, phase) { Net.send({ t: 'act', kind: net[0], tid: net[1], phase }); }
  sendGadget(msg) { Net.send({ t: 'gad', ...msg }); }
  sendIntel(msg) { Net.send({ t: 'intel', ...msg }); }
  sendReady(op, lo, def) { Net.send({ t: 'ready', op, lo, def }); }
  sendDrop() { Net.send({ t: 'drop' }); }

  // ---------- host: handle intents ----------
  _hostFire(d, from) {
    const g = this.game; const c = this._charOf(from); if (!c || c.dead || c.dbno) return;
    if (g.match.phase === 'prep' && c.side === 'atk') return;
    const def = Weapons[d.w]; if (!def) return;
    const o = new THREE.Vector3(...d.o), dir = new THREE.Vector3(...d.d).normalize();
    // keep the origin honest: within a metre of where the host has the body's eyes
    if (o.distanceTo(c.eyePos(_v)) > 1.6) o.copy(c.eyePos(_v));
    g.ballistics.shoot(c, o, dir, def, { tracer: !d.pl, fxOrigin: c.muzzleWorld(new THREE.Vector3()), pellet: d.pl });
    const mz = c.muzzleWorld(new THREE.Vector3()); if (!d.pl) { g.effects.muzzleFlash(mz, dir, def.flash, false); g.audio.gunshot({ cal: def.cal }, mz, false); g.noise && g.noise(c, 60); }
  }
  _hostMelee(d, from) {
    const g = this.game; const c = this._charOf(from); if (!c || c.dead || c.dbno) return;
    const o = new THREE.Vector3(...d.o), dir = new THREE.Vector3(...d.d).normalize();
    let best = null;
    for (const ch of g.characters) { if (ch === c || ch.dead) continue; const r = ch.raycast(o, dir, 1.7); if (r && (!best || r.dist < best.r.dist)) best = { ch, r }; }
    if (best) { best.ch.takeDamage(best.ch.dbno ? 200 : 100, 'torso', c, dir, best.r.point, 'melee'); g.audio.melee(best.r.point, true, 'flesh'); g.effects.bloodHit(best.r.point, dir); return; }
    const h = g.world.raycast(o, dir, 1.8, { filter: x => x.solid || x.tag === 'glass' || x.tag === 'gadget' || x.tag === 'barricade' });
    if (h) {
      if (h.collider.tag === 'gadget' && h.collider.owner && h.collider.owner.onMelee) { h.collider.owner.onMelee(c); return; }
      const res = g.level.melee(h, g.effects); g.audio.melee(h.point, true, h.collider.material); g.effects.impact(h.point, h.normal, h.collider.material);
      this.event({ k: 'fx', f: 'melee', p: [r2(h.point.x), r2(h.point.y), r2(h.point.z)], n: [h.normal.x, h.normal.y, h.normal.z], m: h.collider.material });
      if (res === 'wall') g.effects.wallDebris(h.point, h.normal);
    }
  }
  _hostAct(d, from) {
    const g = this.game; const c = this._charOf(from); if (!c || c.dead) return;
    const s = this.remoteState.get(from); if (!s) return;
    const find = () => { const opts = g.getInteractions(c, this.fakeCam(s), 3.2); return opts.find(o => o.net && o.net[0] === d.kind && String(o.net[1]) === String(d.tid)) || opts.find(o => o.net && o.net[0] === d.kind); };
    if (d.phase === 'start') { const it = find(); if (!it) return; c.netAct = it; it.start && it.start(); return; }
    // done / cancel finish whatever was started (the option may no longer be offered mid-way, e.g. a board being built)
    const it = (c.netAct && c.netAct.net[0] === d.kind) ? c.netAct : find(); c.netAct = null; if (!it) return;
    if (d.phase === 'done') { it.done && it.done(); g.hud.refreshGadgets(); } else it.cancel && it.cancel();
  }
  _hostGadget(d, from) {
    const g = this.game; const c = this._charOf(from); if (!c || c.dead || c.dbno) return;
    const G = g.gadgets; const v = a => new THREE.Vector3(...a);
    if (d.op === 'throw') { G.throwGrenade(d.kind, c, v(d.o), v(d.d), d.pw); c.gadget2Uses++; }
    else if (d.op === 'breach') { G.fireBreachRound(c, v(d.o), v(d.d)); c.gadgetUses++; }
    else if (d.op === 'hammer') { if (G.hammerSwing(c, v(d.o), v(d.d))) c.gadgetUses++; }
    else if (d.op === 'lion') { if (G.lionScan(c)) c.gadgetUses++; }
    else if (d.op === 'place') { const extra = this._resolveExtra(d.x); const e = G.place(d.kind, c, v(d.p), v(d.n), extra); if (e) { if (d.slot === 'primary') c.gadgetUses++; else c.gadget2Uses++; } }
    else if (d.op === 'detonate') { c.detonateRequested = true; }
  }
  _hostIntel(d, from) {
    const g = this.game; const c = this._charOf(from); if (!c) return;
    if (d.op === 'ping') g.ping(new THREE.Vector3(...d.o), new THREE.Vector3(...d.d), c);
    else if (d.op === 'ident') { const t = this.charByNid(d.n); if (t && t.side !== c.side) g.identify(t, c); }
  }
  _resolveExtra(x) {
    const L = this.game.level; const out = {};
    if (!x) return out;
    if (x.wall !== undefined) out.wall = L.softWalls[x.wall];
    if (x.hatch !== undefined) out.hatch = L.hatches[x.hatch];
    if (x.slot !== undefined) out.slot = L.barricadeSlots[x.slot];
    if (x.target) { out.target = {}; if (x.target.wall !== undefined) out.target.wall = L.softWalls[x.target.wall]; if (x.target.hatch !== undefined) out.target.hatch = L.hatches[x.target.hatch]; if (x.target.entity !== undefined) out.target.entity = this.entityByNid.get(x.target.entity); }
    return out;
  }
  _packExtra(extra) {
    const L = this.game.level; const x = {};
    if (!extra) return x;
    if (extra.wall) x.wall = extra.wall.id;
    if (extra.hatch) x.hatch = L.hatches.indexOf(extra.hatch);
    if (extra.slot) x.slot = L.barricadeSlots.indexOf(extra.slot);
    if (extra.target) { x.target = {}; if (extra.target.wall) x.target.wall = extra.target.wall.id; if (extra.target.hatch) x.target.hatch = L.hatches.indexOf(extra.target.hatch); if (extra.target.entity) x.target.entity = extra.target.entity.nid; }
    return x;
  }

  // ---------- host: hooks from game systems ----------
  onShot(shooter, origin, dir, def, opts) { if (!this.isHost) return; this.event({ k: 'shot', n: shooter.nid, o: [r2(origin.x), r2(origin.y), r2(origin.z)], d: [r3(dir.x), r3(dir.y), r3(dir.z)], w: def.id || def.name, pl: opts.pellet ? 1 : 0 }); }
  onHit(target, shooter, point, dir, zone) { if (!this.isHost) return; this.event({ k: 'hit', n: target.nid, a: shooter ? shooter.nid : -1, p: [r2(point.x), r2(point.y), r2(point.z)], d: [r2(dir.x), r2(dir.y), r2(dir.z)], z: zone }); }
  onDamage(victim, dmg, attacker) { if (!this.isHost || !victim.remote) return; this.event({ k: 'dmg', n: victim.nid, a: Math.round(dmg), fp: attacker ? [r2(attacker.pos.x), r2(attacker.pos.y), r2(attacker.pos.z)] : null }); }
  onDeath(victim, killer, headshot, weapon) { this.event({ k: 'death', v: victim.nid, a: killer ? killer.nid : -1, hs: !!headshot, w: weapon || '' }); }
  onDBNO(victim, attacker, weapon) { this.event({ k: 'dbno', v: victim.nid, a: attacker ? attacker.nid : -1, w: weapon || '' }); }
  onRevive(c) { this.event({ k: 'revive', n: c.nid }); }
  onCell(wall, cell) { this.event({ k: 'cell', w: wall.id, i: cell.i, j: cell.j }); }
  onStuds(p, r) { this.event({ k: 'studs', p: [r2(p.x), r2(p.y), r2(p.z)], r }); }
  onReinforce(wall) { this.event({ k: 'reinf', w: wall.id }); }
  onBarricade(b, op, data) { const s = this.game.level.barricadeSlots.indexOf(b.slot); if (s < 0) return; const e = { k: 'bar', s, op }; if (data && data.pos) e.p = [r2(data.pos.x), r2(data.pos.y), r2(data.pos.z)]; if (data && data.i !== undefined) e.i = data.i; this.event(e); }
  onGlass(pane) { this.event({ k: 'glass', i: this.game.level.glass.indexOf(pane) }); }
  onHatch(h) { this.event({ k: 'hatch', i: this.game.level.hatches.indexOf(h), open: h.open ? 1 : 0, reinforced: h.reinforced ? 1 : 0 }); }
  onGadgetCreated(e, op, data) {
    if (!this.isHost) return; e.nid = this.nextEntity++; this.entityByNid.set(e.nid, e);
    const ev = { k: 'gad', op, nid: e.nid, kind: e.type, o: e.owner ? e.owner.nid : -1, p: [r2(e.pos.x), r2(e.pos.y), r2(e.pos.z)] };
    if (data) Object.assign(ev, data);
    this.event(ev);
  }
  onGadgetGone(e, how, pos) { if (!this.isHost || !e.nid) return; this.event({ k: 'gad', op: how, nid: e.nid, kind: e.type, p: pos ? [r2(pos.x), r2(pos.y), r2(pos.z)] : undefined }); }
  onFx(f, p, extra) { const ev = { k: 'fx', f, p: [r2(p.x), r2(p.y), r2(p.z)] }; if (extra) Object.assign(ev, extra); this.event(ev); }
  onPlant(c, pos, yaw, label, tl) { this.event({ k: 'plant', n: c.nid, p: [r2(pos.x), r2(pos.y), r2(pos.z)], yaw: r2(yaw), b: label, tl }); }
  onDropped(pos) { this.event({ k: 'dropped', p: [r2(pos.x), r2(pos.y), r2(pos.z)] }); }
  onPickup(c) { this.event({ k: 'pickup', n: c.nid }); }
  onRoundEnd(winnerSide, why) { this.event({ k: 'end', ws: winnerSide, why }); this._flushEvents(); }
  onPing(kind, pos, label) { this.event({ k: 'ping', kind, p: [r2(pos.x), r2(pos.y), r2(pos.z)], label }); }
  onIdentify(c) { this.event({ k: 'ident', n: c.nid }); }
  onStun(c, intensity, dur) { if (c.remote) this.event({ k: 'stun', n: c.nid, i: r2(intensity), d: r2(dur) }); }
  onEmp(c, dur) { if (c.remote) this.event({ k: 'emp', n: c.nid, d: r2(dur) }); }
  onLionScan(side, chars) { this.event({ k: 'scan', side, ns: chars.map(c => c.nid) }); }
  toast(c, txt) { if (c.remote) this.event({ k: 'toast', n: c.nid, txt }); }

  // ---------- client: gadget replicas ----------
  _clientGadget(e) {
    const g = this.game; const G = g.gadgets; const owner = e.o >= 0 ? this.charByNid(e.o) : null; const v = a => new THREE.Vector3(...a);
    if (e.op === 'throw') { const ent = G.throwGrenade(e.kind, owner, v(e.o2), v(e.d), e.pw, true); if (ent) { ent.nid = e.nid; this.entityByNid.set(e.nid, ent); } }
    else if (e.op === 'breach') { const ent = G.fireBreachRound(owner, v(e.o2), v(e.d), true); if (ent) { ent.nid = e.nid; this.entityByNid.set(e.nid, ent); } }
    else if (e.op === 'place') { const ent = G.place(e.kind, owner, v(e.p), v(e.n), this._resolveExtra(e.x), true); if (ent) { ent.nid = e.nid; this.entityByNid.set(e.nid, ent); } }
    else if (e.op === 'det' || e.op === 'destroy') { const ent = this.entityByNid.get(e.nid); if (ent) { if (e.p) ent.pos.set(...e.p); if (e.op === 'det' && ent.replicaDetonate) ent.replicaDetonate(); else ent.destroy(); this.entityByNid.delete(e.nid); } }
    else if (e.op === 'disable') { const ent = this.entityByNid.get(e.nid); if (ent) ent.disabled = true; }
  }
}
