import * as THREE from 'three';
import { Character, Stance, BODY_HEIGHT } from './Character.js';
import { speedFor, Gadgets as GadgetDefs, SecondaryGadgets } from '../data/operators.js';
import { WeaponModels } from '../data/weapons.js';
import { BARRICADE_BUILD_TIME } from '../map/Level.js';

// AI operators. Perception (vision cone + LOS + hearing + team callouts), navigation on the
// layered nav grid, combat with reaction time / settling accuracy / burst fire, preparation-
// phase setup (reinforce, barricade, gadgets), attack plans (entry, breach, plant, post-plant)
// and defence plans (anchor / roam / retake).

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const HW = 0.21;   // bots are slightly slimmer than the nav grid's cells so they never wedge in gaps the grid allows

export const Difficulty = {
  easy: { reaction: 0.75, accuracy: 0.42, settle: 1.2, burst: [2, 4], vision: 30, aggression: 0.4 },
  normal: { reaction: 0.45, accuracy: 0.66, settle: 0.7, burst: [3, 6], vision: 40, aggression: 0.65 },
  hard: { reaction: 0.25, accuracy: 0.86, settle: 0.4, burst: [4, 9], vision: 48, aggression: 0.9 },
};

export class Bot {
  constructor(game, op, side, diff = 'normal') {
    this.game = game; this.op = op; this.side = side; this.D = Difficulty[diff] || Difficulty.normal;
    this.char = new Character(game, op, side, false);
    this.char.bot = this;
    this.state = 'idle'; this.stateT = 0;
    this.path = null; this.pathIdx = 0; this.goal = null; this.repathT = 0; this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.target = null; this.lastSeen = new THREE.Vector3(); this.lastSeenT = -99; this.seeT = 0; this.onTargetT = 0; this.perceiveT = Math.random() * 0.15;
    this.aimYaw = 0; this.aimPitch = 0; this.burstLeft = 0; this.burstPause = 0; this.strafeT = 0; this.strafeDir = 0;
    this.vel = new THREE.Vector3(); this.grounded = true;
    this.plan = []; this.planIdx = 0; this.holdSpot = null; this.holdYaw = 0; this.hearPoint = null; this.hearT = 0;
    this.meleeT = 0; this.gadgetT = 0; this.detonateAt = 0; this.thermiteWall = null;
    this.reviveTarget = null; this.crouchHold = Math.random() < 0.4;
    this.wantAds = false; this.role = 'anchor';
  }

  // ---------- lifecycle ----------
  spawn(pos, yaw) { this.rallyDone = false; this.rallyT = 0; this.buildingBar = null; this.char.reset(pos, yaw); this.aimYaw = yaw; this.aimPitch = 0; this.vel.set(0, 0, 0); this.state = 'idle'; this.path = null; this.goal = null; this.target = null; this.plan = []; this.planIdx = 0; this.holdSpot = null; this.stateT = 0; this.reviveTarget = null; this.thermiteWall = null; this.char.setVisible(true); }
  get alive() { return this.char.alive && !this.char.dead; }

  update(dt) {
    const C = this.char; const g = this.game;
    if ((C.dead || C.dbno) && this.buildingBar) { if (this.buildingBar.building) this.buildingBar.cancelBuild(); this.buildingBar.builder = null; this.buildingBar = null; }
    if (C.dead) { C.updateBody(dt, g.camera); return; }
    C.stunned = Math.max(0, C.stunned - dt); C.empd = Math.max(0, C.empd - dt); C.wire = Math.max(0, C.wire - dt);
    this.stateT += dt; this.meleeT = Math.max(0, this.meleeT - dt); this.gadgetT = Math.max(0, this.gadgetT - dt);
    if (C.dbno) { this._dbno(dt); C.updateBody(dt, g.camera); return; }
    this.perceiveT -= dt; if (this.perceiveT <= 0) { this.perceiveT = 0.12; this._perceive(); }
    this._think(dt);
    this._aim(dt);
    this._moveAlongPath(dt);
    this._combat(dt);
    for (const w of C.weapons) w.update(dt);
    C.yaw = this.aimYaw; C.pitch = this.aimPitch; C.ads = this.wantAds ? Math.min(1, C.ads + dt * 4) : Math.max(0, C.ads - dt * 4);
    C.lowReadyTarget = (this.target && g.time - this.lastSeenT < 3) || this.hearT > 0 ? 0 : (C.sprinting ? 0.6 : 1);
    C.updateBody(dt, g.camera);
  }

  // ---------- perception ----------
  _perceive() {
    const C = this.char; const g = this.game; const eye = C.eyePos(_v);
    if (g.match.phase === 'prep') { this.target = null; this.seeT = 0; return; }   // no engagements during preparation
    let best = null, bestD = Infinity;
    const fwd = C.forward(_v2);
    for (const e of g.characters) {
      if (e.side === C.side || e.dead || e === C) continue;
      const d = e.pos.distanceTo(C.pos); if (d > this.D.vision) continue;
      const head = e.headPos(_v3); const to = head.clone().sub(eye).normalize();
      const ang = fwd.dot(to);
      if (d > 2.5 && ang < 0.2) continue;                         // ~78° half-cone
      if (e.dbno && d > 15) continue;
      if (!g.world.visible(eye, head) && !g.world.visible(eye, e.chestPos(new THREE.Vector3()))) continue;
      if (g.gadgets.inSmoke(eye, head)) continue;
      // prone / crouch reduce detection at range
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      if (this.target !== best) { this.seeT = 0; this.onTargetT = 0; }
      this.target = best; this.lastSeen.copy(best.pos); this.lastSeenT = g.time; this.seeT += 0.12;
      g.teamAlert(C.side, best, best.pos);
    } else if (this.target) {
      if (g.time - this.lastSeenT > 4) { this.target = null; this.seeT = 0; }
      else this.seeT = 0;
    }
    // scanned enemies (Lion) are known
    if (!this.target) { for (const e of g.characters) { if (e.side !== C.side && !e.dead && e.pingedUntil > g.time && e.pos.distanceTo(C.pos) < 25) { this.hearPoint = e.pos.clone(); this.hearT = 4; } } }
  }
  hear(pos, loud) { const C = this.char; if (C.dead) return; const d = pos.distanceTo(C.pos); if (d > loud) return; if (!this.target) { this.hearPoint = pos.clone(); this.hearT = 6; } }
  callout(enemy, pos) { if (!this.target && this.char.pos.distanceTo(pos) < 30) { this.hearPoint = pos.clone(); this.hearT = 5; } }

  // ---------- aiming ----------
  _aim(dt) {
    const C = this.char; const g = this.game;
    let wantYaw = this.aimYaw, wantPitch = 0, speed = 6;
    if (this.target && (g.time - this.lastSeenT < 1.5)) {
      const eye = C.eyePos(_v); const zone = (this.D.accuracy > 0.8 && Math.random() < 0.35) ? this.target.headPos(_v2) : this.target.chestPos(_v2);
      // error shrinks the longer the target is tracked; stun ruins it
      this.onTargetT += dt;
      const settle = Math.exp(-this.onTargetT / this.D.settle);
      const err = (1 - this.D.accuracy) * (0.35 + settle * 1.2) + (C.stunned > 0 ? 1.5 : 0) + (this.target.speedNorm > 0.5 ? 0.12 : 0);
      const t = g.time * 3.1 + this.op.id.length;
      zone.x += Math.sin(t) * err * 0.6; zone.y += Math.cos(t * 1.3) * err * 0.35; zone.z += Math.sin(t * 0.7 + 1) * err * 0.6;
      const d = zone.clone().sub(eye); const len = Math.hypot(d.x, d.z);
      wantYaw = Math.atan2(-d.x, -d.z); wantPitch = Math.atan2(d.y, len); speed = 9 + this.D.accuracy * 8;
      this.wantAds = eye.distanceTo(zone) > 9 && this.target && !this.target.dbno;
    } else if (this.target && g.time - this.lastSeenT < 6) {
      const d = this.lastSeen.clone().sub(C.pos); wantYaw = Math.atan2(-d.x, -d.z); wantPitch = 0; this.wantAds = false; this.onTargetT = 0;
    } else {
      this.onTargetT = 0; this.wantAds = false;
      if (this.path && this.pathIdx < this.path.length) { const wp = this.path[this.pathIdx]; const d = wp.clone().sub(C.pos); if (d.lengthSq() > 0.05) wantYaw = Math.atan2(-d.x, -d.z); }
      else if (this.hearPoint && this.hearT > 0) { const d = this.hearPoint.clone().sub(C.pos); wantYaw = Math.atan2(-d.x, -d.z); }
      else if (this.holdSpot) wantYaw = this.holdYaw;
      wantPitch = 0; speed = 4;
    }
    let dy = wantYaw - this.aimYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.aimYaw += dy * Math.min(1, dt * speed); this.aimPitch += (wantPitch - this.aimPitch) * Math.min(1, dt * speed);
    // recoil
    const w = C.weapon; if (w) { this.aimPitch += w.kick.v * 0.6 * Math.PI / 180 * (this.recoilK || 0); this.recoilK = 0; }
    this.aimPitch = THREE.MathUtils.clamp(this.aimPitch, -1.2, 1.2);
  }

  // ---------- combat ----------
  _combat(dt) {
    const C = this.char; const g = this.game; const w = C.weapon; if (!w) return;
    const engaged = this.target && (g.time - this.lastSeenT < 0.4) && this.seeT >= this.D.reaction * (this.target.dbno ? 2 : 1);
    if (w.reloading) return;
    if (w.ammo === 0) { if (w.startReload()) g.audio.reload(w.isShotgun && !w.def.magReload ? 'shotgun' : 'empty', C.pos, false, w.reloadTotal); return; }
    if (!engaged) {
      if (w.ammo < w.def.mag * 0.4 && w.reserve > 0 && !this.target && w.startReload()) g.audio.reload('tactical', C.pos, false, w.reloadTotal);
      this.burstLeft = 0; return;
    }
    // aligned enough?
    const eye = C.eyePos(_v); const zone = this.target.chestPos(_v2); const to = zone.sub(eye).normalize(); const aimDir = C.forward(_v3);
    if (aimDir.dot(to) < 0.985) return;
    if (this.burstPause > 0) { this.burstPause -= dt; return; }
    if (this.burstLeft <= 0) { const [a, b] = this.D.burst; this.burstLeft = a + Math.floor(Math.random() * (b - a + 1)); }
    if (!w.canFire()) return;
    const origin = eye.clone(); const dir = C.forward(new THREE.Vector3());
    const fired = w.tryFire(g, origin, dir, { ads: this.wantAds, moving: C.speedNorm > 0.2, stance: C.stance, viewmodel: false, tracer: true, fxOrigin: C.muzzleWorld(new THREE.Vector3()) });
    if (fired) {
      this.recoilK = 1; this.burstLeft--; if (this.burstLeft <= 0) this.burstPause = 0.15 + Math.random() * 0.3;
      const mz = C.muzzleWorld(new THREE.Vector3()); g.effects.muzzleFlash(mz, dir, w.def.flash, false);
      g.audio.gunshot({ cal: w.def.cal }, mz, false); g.noise && g.noise(C, 60);
      if (!w.auto) this.burstPause = 0.18 + Math.random() * 0.2;
    }
  }

  // ---------- navigation ----------
  moveTo(p, tolerance = 0.6) {
    if (!p) return;
    if (this.goal && this.goal.distanceTo(p) < 0.3 && this.path) return;
    this.goal = p.clone(); this.tolerance = tolerance;
    this.path = this.game.nav.findPath(this.char.pos, p, this.side); this.pathIdx = 0; this.repathT = 2.5 + Math.random();
    if (!this.path) { this.path = [p.clone()]; }
  }
  arrived() { return !this.goal || (this.char.pos.distanceTo(this.goal) < (this.tolerance || 0.6) && (!this.path || this.pathIdx >= this.path.length - 1 || this.char.pos.distanceTo(this.path[this.path.length - 1]) < 0.7)); }
  stop() { this.path = null; this.goal = null; }

  _moveAlongPath(dt) {
    const C = this.char; const g = this.game; const W = g.world;
    const base = 3.2 * speedFor(this.op);
    let wish = _v.set(0, 0, 0); let speed = base;
    const engaged = this.target && g.time - this.lastSeenT < 1;
    if (this.path && this.pathIdx < this.path.length && !C.trapped) {
      let wp = this.path[this.pathIdx];
      const flatD = Math.hypot(wp.x - C.pos.x, wp.z - C.pos.z);
      if (flatD < 0.35 && Math.abs(wp.y - C.pos.y) < 1.2) { this.pathIdx++; if (this.pathIdx >= this.path.length) { this.path = null; } }
      if (this.path) {
        wp = this.path[this.pathIdx]; wish.set(wp.x - C.pos.x, 0, wp.z - C.pos.z); const l = wish.length(); if (l > 1e-3) wish.divideScalar(l);
        // sprint when far from danger
        const sprint = !engaged && this.state !== 'hold' && flatD > 3 && (this.side === 'atk' ? (g.match.timeLeft < 50 || this.D.aggression > 0.8 || this.role === 'rusher') : g.match.phase === 'prep');
        C.sprinting = sprint; if (sprint) speed *= 1.5;
        if (engaged) speed *= 0.75;
        if (C.wire > 0) speed *= 0.5;
        this.repathT -= dt; if (this.repathT <= 0 && this.goal) { const p = g.nav.findPath(C.pos, this.goal, this.side); if (p) { this.path = p; this.pathIdx = 0; } this.repathT = 2.5 + Math.random(); }
      }
    } else C.sprinting = false;
    // strafe while engaged
    if (engaged && !this.path) { this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = 0.6 + Math.random() * 1.2; this.strafeDir = Math.random() < 0.3 ? 0 : (Math.random() < 0.5 ? -1 : 1); } if (this.strafeDir) { const r = C.right(_v2); wish.addScaledVector(r, this.strafeDir); wish.normalize(); speed *= 0.7; } }
    if (C.stance === Stance.CROUCH) speed *= 0.55;
    if (C.ads > 0.5) speed *= 0.7;
    // doorway centring: when about to cross an opening, pull toward its centre line
    if (wish.lengthSq() > 0) {
      for (const s of g.level.barricadeSlots) {
        const dx = s.x - C.pos.x, dz = s.z - C.pos.z; if (Math.abs(dx) > 1.6 || Math.abs(dz) > 1.6 || Math.abs(s.y - C.pos.y) > 1.5) continue;
        if (s.horizontal) { if (Math.abs(wish.z) > 0.5 && Math.sign(wish.z) === Math.sign(dz || 1)) { wish.x += THREE.MathUtils.clamp(dx * 2.5, -1, 1) * 0.9; wish.normalize(); } }
        else { if (Math.abs(wish.x) > 0.5 && Math.sign(wish.x) === Math.sign(dx || 1)) { wish.z += THREE.MathUtils.clamp(dz * 2.5, -1, 1) * 0.9; wish.normalize(); } }
      }
    }
    // steering: avoid walking into walls when path is stale — probe ahead
    if (wish.lengthSq() > 0) {
      const o = C.pos.clone(); o.y += 0.6; let h = W.raycast(o, wish, 0.7, { filter: c => c.solid && c.blocksNav !== false });
      // a half-broken barricade can leave the knee probe clear while boards still block the chest
      if ((!h || h.collider.tag !== 'barricade') && g.level.barricadeSlots.some(s => s.barricade.built && Math.abs(s.x - C.pos.x) < 1.5 && Math.abs(s.z - C.pos.z) < 1.5 && Math.abs(s.y - C.pos.y) < 1.5)) {
        // probe the body's width at knee and chest height so boards beside a half-broken hole get hit too
        const lat = _v2.set(-wish.z, 0, wish.x);
        outer: for (const hy of [0.6, 1.35]) for (const off of [0, -0.19, 0.19]) { o.copy(C.pos).addScaledVector(lat, off); o.y = C.pos.y + hy; const h2 = W.raycast(o, wish, 0.7, { filter: c => c.tag === 'barricade' && c.solid }); if (h2) { h = h2; break outer; } }
      }
      if (h && h.collider.tag !== 'stairs' && h.collider.max.y - C.pos.y > 0.45) { /* blocked: try barricade/glass handling */ this._handleBlock(h); }
    }
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wish.x * speed, 10, dt); this.vel.z = THREE.MathUtils.damp(this.vel.z, wish.z * speed, 10, dt);
    this.vel.y -= 22 * dt;
    const h = BODY_HEIGHT[C.stance];
    const res = W.moveBox(C.pos, HW, h, _v3.set(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt), 0.42, c => !(c.tag === 'gadget' && !c.solid));
    if (res.grounded) this.vel.y = Math.max(this.vel.y, 0);
    this.grounded = res.grounded; C.grounded = res.grounded; C.surface = res.groundMat || 'concrete';
    const sp = Math.hypot(this.vel.x, this.vel.z); C.speedNorm = Math.min(1, sp / (base * 1.5)); C.moving = sp > 0.2 ? 1 : 0;
    // stuck detection
    if (this.path) {
      if (C.pos.distanceTo(this.lastPos) < 0.05 * dt * 60) this.stuckT += dt; else this.stuckT = 0;
      if (this.stuckT > 1.2) {
        this.stuckT = 0; this.stuckCount = (this.stuckCount || 0) + 1;
        this.vel.x += (Math.random() - 0.5) * 3; this.vel.z += (Math.random() - 0.5) * 3;
        if (this.stuckCount >= 2) { // wedged on geometry the grid allowed: snap to the nearest node centre
          const n = g.nav.nearest(C.pos, 1.0); if (n) { const [x, z] = g.nav.center(n.ix, n.iz); C.pos.x = x; C.pos.z = z; } this.stuckCount = 0;
        }
        if (this.goal) { g.nav._pathCache.clear(); const p = g.nav.findPath(C.pos, this.goal, this.side); if (p) { this.path = p; this.pathIdx = 0; } }
      }
    } else this.stuckCount = 0;
    this.lastPos.copy(C.pos);
    if (C.pos.y < -5) { C.pos.y = 0.1; this.vel.set(0, 0, 0); }
  }
  _handleBlock(h) {
    const C = this.char; const g = this.game; const c = h.collider;
    if (c.tag === 'barricade' && c.owner) { if (this.meleeT <= 0) { this.meleeT = 0.7; c.owner.melee(h.point); g.audio.melee(h.point, true, 'wood'); g.effects.impact(h.point, h.normal, 'wood'); g.noise && g.noise(C, 25); } return; }
    if (c.tag === 'glass' && c.owner) { g.level.breakGlass(c.owner, g.effects); return; }
    if (c.tag === 'shield' || (c.tag === 'gadget' && c.solid)) { // vault-less: step around
      if (this.meleeT <= 0) { this.meleeT = 1; this.stuckT = 2; } return;
    }
    if (c.tag === 'cell' && c.owner && this.side === 'atk' && !c.owner.reinforced) {
      // Sledge hammers, others melee through slowly
      if (this.meleeT <= 0) { this.meleeT = this.op.gadget === 'hammer' ? 0.7 : 0.9; if (this.op.gadget === 'hammer' && C.gadgetUses < 25) { if (g.gadgets.hammerSwing(C, C.eyePos(new THREE.Vector3()), C.forward(new THREE.Vector3()))) C.gadgetUses++; } else { g.level.melee(h, g.effects); g.audio.melee(h.point, true, 'drywall'); } }
    }
  }

  // ---------- behaviour ----------
  _think(dt) {
    const g = this.game; const M = g.match; const C = this.char;
    // revive nearby DBNO teammate when safe
    if (!this.target || g.time - this.lastSeenT > 3) {
      if (!this.reviveTarget) { for (const t of g.characters) { if (t.side === C.side && t.dbno && !t.dead && t !== C && t.pos.distanceTo(C.pos) < 12 && !t.reviver) { this.reviveTarget = t; t.reviver = C; break; } } }
      if (this.reviveTarget) { if (this.reviveTarget.dead || !this.reviveTarget.dbno) { this.reviveTarget.reviver = null; this.reviveTarget = null; } else { this._revive(dt); return; } }
    } else if (this.reviveTarget) { this.reviveTarget.reviver = null; this.reviveTarget = null; }
    if (this.hearT > 0) this.hearT -= dt;
    if (M.phase === 'prep') { if (this.side === 'def') this._defPrep(dt); else this._atkPrep(dt); return; }
    if (M.phase === 'action' || M.phase === 'planted') { if (this.side === 'def') this._defAction(dt); else this._atkAction(dt); }
  }

  _revive(dt) {
    const t = this.reviveTarget; const C = this.char;
    if (C.pos.distanceTo(t.pos) > 1.3) { this.moveTo(t.pos, 1.0); C.stance = Stance.STAND; return; }
    this.stop(); C.stance = Stance.CROUCH; t.reviveProgress += dt;
    if (t.reviveProgress >= 5) { t.reviveProgress = 0; t.reviver = null; t.revive(); this.reviveTarget = null; C.stance = Stance.STAND; }
  }
  _dbno(dt) { const C = this.char; C.speedNorm = 0; C.dbnoTimer += dt; }

  // ----- defenders -----
  _defPrep(dt) {
    const g = this.game; const C = this.char;
    if (!this.plan.length && !this.planBuilt) { this.planBuilt = true; this.plan = g.defensePlan.take(this); this.planIdx = 0; }
    const task = this.plan[this.planIdx];
    if (!task) { this._goHold(); return; }
    // a task that can't be reached (blocked spot, boarded door) is skipped instead of eating the whole phase
    if (this._taskIdx !== this.planIdx) { this._taskIdx = this.planIdx; this.taskT = 0; }
    this.taskT = (this.taskT || 0) + dt; if (this.taskT > 14) { if (this.buildingBar) { if (this.buildingBar.building) this.buildingBar.cancelBuild(); this.buildingBar.builder = null; this.buildingBar = null; } this.planIdx++; this.stop(); this.workT = 0; return; }
    if (task.type === 'reinforce') {
      const w = task.wall; if (w.reinforced || g.match.reinforcementsLeft <= 0) { this.planIdx++; return; }
      const p = task.pos; if (C.pos.distanceTo(p) > 1.2) { this.moveTo(p, 0.8); this.workT = 0; return; }
      this.stop(); const d = w.center.clone().sub(C.pos); this.aimYaw = Math.atan2(-d.x, -d.z);
      this.workT = (this.workT || 0) + dt; if (!this.workSound) { this.workSound = g.audio.tool('reinforce', w.center, 5); }
      if (this.workT >= 5) { g.match.reinforce(w, C); this.workT = 0; this.workSound = null; this.planIdx++; }
      return;
    }
    if (task.type === 'barricade') {
      const s = task.slot; const b = s.barricade; if (b.alive() || (b.building && b.builder !== this)) { this.planIdx++; return; }
      const p = task.pos; if (C.pos.distanceTo(p) > 1.3) { this.moveTo(p, 0.9); this.workT = 0; return; }
      this.stop(); const d = new THREE.Vector3(s.x, s.y + 1, s.z).sub(C.pos); this.aimYaw = Math.atan2(-d.x, -d.z); this.aimPitch = 0;
      if (!b.building) { b.beginBuild(C.pos, false); b.builder = this; this.buildingBar = b; this.workT = 0; }
      C.lowReadyTarget = 1;
      this.workT = (this.workT || 0) + dt; b.setProgress(Math.min(1, this.workT / BARRICADE_BUILD_TIME), dt);
      if (this.workT >= BARRICADE_BUILD_TIME) { b.finish(); b.builder = null; this.buildingBar = null; this.workT = 0; this.planIdx++; }
      return;
    }
    if (task.type === 'gadget') {
      const p = task.pos; if (C.pos.distanceTo(p) > 1.4) { this.moveTo(p, 1.0); return; }
      this.stop(); const uses = GadgetDefs[this.op.gadget].uses;
      if (C.gadgetUses < uses) { const ok = this._placeUnique(task); if (ok) C.gadgetUses++; }
      this.planIdx++; return;
    }
    if (task.type === 'gadget2') {
      const p = task.pos; if (C.pos.distanceTo(p) > 1.4) { this.moveTo(p, 1.0); return; }
      this.stop(); if (C.gadget2Uses < SecondaryGadgets[C.gadget2].uses) { g.gadgets.place(C.gadget2, C, p, task.normal || new THREE.Vector3(0, 1, 0)); C.gadget2Uses++; }
      this.planIdx++; return;
    }
    this.planIdx++;
  }
  _placeUnique(task) {
    const g = this.game; const C = this.char; const type = this.op.gadget;
    switch (type) {
      case 'rook': g.gadgets.place('rook', C, task.pos, new THREE.Vector3(0, 1, 0)); return true;
      case 'mute': g.gadgets.place('mute', C, task.pos, new THREE.Vector3(0, 1, 0)); return true;
      case 'frost': g.gadgets.place('frost', C, task.pos, task.normal || new THREE.Vector3(0, 0, 1)); return true;
      case 'kapkan': if (task.slot && !g.gadgets.entities.some(e => e.type === 'kapkan' && e.slot === task.slot)) { g.gadgets.place('kapkan', C, new THREE.Vector3(task.slot.x, task.slot.y, task.slot.z), new THREE.Vector3(0, 1, 0), { slot: task.slot }); return true; } return false;
      case 'bandit': if (task.wall && task.wall.reinforced && !g.gadgets.entities.some(e => e.type === 'bandit' && e.target.wall === task.wall)) { const n = task.wall.normal.clone(); const p = task.wall.center.clone(); const side = Math.sign((C.pos.clone().sub(p)).dot(n)) || 1; p.addScaledVector(n, side * (task.wall.t / 2 + 0.03)); p.y = task.wall.y0 + 0.5; g.gadgets.place('bandit', C, p, n.multiplyScalar(side), { target: { wall: task.wall } }); return true; } return false;
    }
    return false;
  }
  _goHold() {
    const g = this.game; const C = this.char;
    if (!this.holdSpot) { const s = g.defensePlan.holdSpot(this); this.holdSpot = s.pos; this.holdYaw = s.yaw; }
    if (C.pos.distanceTo(this.holdSpot) > 0.8) { this.moveTo(this.holdSpot, 0.6); this.state = 'move'; C.stance = Stance.STAND; }
    else { this.stop(); this.state = 'hold'; if (this.crouchHold && !this.target) C.stance = Stance.CROUCH; }
  }
  _defAction(dt) {
    const g = this.game; const C = this.char; const M = g.match;
    if (M.phase === 'planted' && M.defuser) {
      // retake: nearest defenders go defuse
      const dist = C.pos.distanceTo(M.defuser.pos);
      const nearest = g.characters.filter(c => c.side === 'def' && !c.dead && !c.dbno).sort((a, b) => a.pos.distanceTo(M.defuser.pos) - b.pos.distanceTo(M.defuser.pos))[0];
      if (nearest === C || dist < 6) {
        if (dist > 1.4) { this.moveTo(M.defuser.pos, 1.0); this.state = 'move'; C.stance = Stance.STAND; return; }
        this.stop(); if (!this.target || g.time - this.lastSeenT > 1.5) { C.stance = Stance.CROUCH; M.defuseProgress(C, dt); } return;
      }
      this.moveTo(M.defuser.pos, 4); return;
    }
    // engaged: hold position and fight; if target lost for long, investigate briefly then return
    if (this.target && g.time - this.lastSeenT < 1) { if (this.buildingBar && this.buildingBar.building) { this.buildingBar.cancelBuild(); this.buildingBar.builder = null; this.buildingBar = null; } this.stop(); C.stance = Stance.STAND; this.state = 'engage'; return; }
    // like real defenders, finish the setup (reinforcements, boards, gadgets) into the first part of the action phase while it is quiet
    if (M.phase === 'action' && M.timeLeft > M.s.actionTime - 50 && this.planIdx < this.plan.length && !(this.target && g.time - this.lastSeenT < 6) && this.hearT <= 0) { this._defPrep(dt); return; }
    if (this.target && g.time - this.lastSeenT < 5 && this.D.aggression > 0.5 && this.role === 'roamer') { this.moveTo(this.lastSeen, 1.5); this.state = 'move'; return; }
    if (this.hearPoint && this.hearT > 0 && this.role === 'roamer' && this.hearPoint.distanceTo(C.pos) < 14) { this.moveTo(this.hearPoint, 1.5); this.state = 'move'; C.stance = Stance.STAND; if (this.arrived()) this.hearT = 0; return; }
    // periodically rotate hold spots
    if (this.state === 'hold' && this.stateT > 20 + Math.random() * 20) { this.holdSpot = null; this.stateT = 0; }
    this._goHold();
  }

  // ----- attackers -----
  _atkPrep(dt) { const C = this.char; this.stop(); C.stance = Stance.STAND; }
  _atkAction(dt) {
    const g = this.game; const C = this.char; const M = g.match; const site = M.site;
    if (!this.atkPlan) { this.atkPlan = g.attackPlan.assign(this); }
    const P = this.atkPlan;
    // engaged
    if (this.target && g.time - this.lastSeenT < 1) { this.state = 'engage'; if (C.pos.distanceTo(this.target.pos) > 4 && this.D.aggression > 0.7 && !this.target.dbno) { /* push */ this.moveTo(this.lastSeen, 2.5); } else this.stop(); C.stance = Stance.STAND; return; }
    if (this.target && g.time - this.lastSeenT < 4) { this.moveTo(this.lastSeen, 1.5); return; }
    // gadget opportunities
    this._atkGadgets(dt);
    if (M.phase === 'planted' && M.defuser) {
      // guard the defuser
      if (!this.guardSpot || this.stateT > 12) { this.guardSpot = g.nav.randomWalkableNear(M.defuser.pos, 5) || M.defuser.pos.clone(); this.stateT = 0; }
      if (C.pos.distanceTo(this.guardSpot) > 1) { this.moveTo(this.guardSpot, 0.8); } else { this.stop(); const d = M.defuser.pos.clone().sub(C.pos); if (d.lengthSq() > 1) this.holdYaw = Math.atan2(-d.x, -d.z); C.stance = Stance.CROUCH; this.holdSpot = this.guardSpot; }
      return;
    }
    // planting
    if (C.hasDefuser) {
      const bomb = M.plantTarget(C);
      if (bomb) {
        const inZone = M.inZone(C.pos, bomb.zone);
        if (!inZone) { this.moveTo(bomb.pos, 0.9); this.state = 'move'; return; }
        this.stop(); C.stance = Stance.CROUCH; M.plantProgress(C, dt); return;
      }
    } else if (M.defuserDropped && M.defuserDropped.pos.distanceTo(C.pos) < 25) {
      if (C.pos.distanceTo(M.defuserDropped.pos) > 1.2) { this.moveTo(M.defuserDropped.pos, 0.8); return; }
      M.pickupDefuser(C); return;
    }
    // approach: staged waypoints then site
    if (P.stage < P.route.length) {
      const wp = P.route[P.stage];
      // rally before the final push: wait (up to 12 s) for a teammate to be close unless time is short
      if (P.stage === P.route.length - 1 && M.timeLeft > 60 && !this.rallyDone) {
        const near = g.characters.filter(c => c.side === 'atk' && !c.dead && !c.dbno && c !== C && c.pos.distanceTo(C.pos) < 9).length;
        const atSite = g.characters.some(c => c.side === 'atk' && !c.dead && c !== C && c.pos.distanceTo(site.center) < 8);
        if (near === 0 && !atSite && this.rallyT < 12) { this.rallyT = (this.rallyT || 0) + dt; this.stop(); this.state = 'rally'; C.stance = Stance.CROUCH; return; }
        this.rallyDone = true; C.stance = Stance.STAND;
      }
      if (C.pos.distanceTo(wp) < 1.6) { P.stage++; this.stateT = 0; }
      else { this.moveTo(wp, 1.2); this.state = 'move'; if (this.stateT > 25) { P.stage++; this.stateT = 0; } }
      return;
    }
    // at the site: cover a spot near the bomb
    const bomb = site.bombs[P.bombIdx];
    if (!this.coverSpot || this.stateT > 15) { this.coverSpot = g.nav.randomWalkableNear(bomb.pos, 4) || bomb.pos.clone(); this.stateT = 0; }
    if (C.pos.distanceTo(this.coverSpot) > 1) { this.moveTo(this.coverSpot, 0.8); this.state = 'move'; } else { this.stop(); this.state = 'hold'; this.holdSpot = this.coverSpot; this.holdYaw = this.aimYaw + (Math.random() - 0.5) * 0.02; }
  }
  _atkGadgets(dt) {
    const g = this.game; const C = this.char; const op = this.op; const M = g.match;
    if (this.gadgetT > 0) return;
    const uses = GadgetDefs[op.gadget].uses;
    const site = M.site;
    if (op.gadget === 'lion' && C.gadgetUses < uses && C.pos.distanceTo(site.center) < 22 && !g.gadgets.lionState) { if (g.gadgets.lionScan(C)) { C.gadgetUses++; this.gadgetT = 25; } return; }
    if (op.gadget === 'thermite' && C.gadgetUses < uses) {
      // reinforced wall of the site within 4m, not electrified
      for (const w of g.level.softWalls) { if (!w.reinforced || w.electrified > 0) continue; if (!site.rooms.some(r => wallTouchesRoom(w, r))) continue; const d = wallDistance(w, C.pos); if (d < 3.2 && Math.abs(C.pos.y - w.y0) < 1.5 && !g.gadgets.isJammed(w.center) && !g.gadgets.entities.some(e => e.type === 'thermite' && e.wall === w)) { const n = w.normal.clone(); const side = Math.sign(C.pos.clone().sub(w.center).dot(n)) || 1; const p = w.center.clone().addScaledVector(n, side * (w.t / 2 + 0.05)); p.y = w.y0 + 1.3; const along = w.horizontal ? C.pos.x : C.pos.z; if (w.horizontal) p.x = THREE.MathUtils.clamp(along, w.x0 + 1, w.x1 - 1); else p.z = THREE.MathUtils.clamp(along, w.z0 + 1, w.z1 - 1); g.gadgets.place('thermite', C, p, n.multiplyScalar(side), { wall: w }); C.gadgetUses++; this.gadgetT = 6; setTimeout(() => { C.detonateRequested = true; }, 900); this.stop(); return; } }
    }
    if (op.gadget === 'emp' && C.gadgetUses < uses) {
      for (const e of g.gadgets.entities) { if (e.side === 'def' && (e.type === 'bandit' || e.type === 'mute' || e.type === 'kapkan') && !e.disabled && e.pos.distanceTo(C.pos) < 9 && e.pos.distanceTo(C.pos) > 2.5) { const dir = e.pos.clone().sub(C.eyePos(new THREE.Vector3())).normalize(); g.gadgets.throwGrenade('emp', C, C.eyePos(new THREE.Vector3()), dir, 0.8); C.gadgetUses++; this.gadgetT = 8; return; } }
    }
    if (op.gadget === 'breachRound' && C.gadgetUses < uses) {
      // shoot a barricade ahead within 12m
      const eye = C.eyePos(new THREE.Vector3()); const dir = C.forward(new THREE.Vector3()); const h = g.world.raycast(eye, dir, 12, { filter: c => c.solid });
      if (h && h.collider.tag === 'barricade' && h.dist > 3) { g.gadgets.fireBreachRound(C, eye, dir); C.gadgetUses++; this.gadgetT = 4; return; }
    }
    // secondary: frag/stun into the site when close
    if (C.gadget2 && C.gadget2Uses < SecondaryGadgets[C.gadget2].uses && (C.gadget2 === 'frag' || C.gadget2 === 'stun' || C.gadget2 === 'smoke')) {
      const d = C.pos.distanceTo(site.center);
      if (d < 14 && d > 5 && this.stateT > 2 && Math.random() < 0.03) { const eye = C.eyePos(new THREE.Vector3()); const dir = site.center.clone().add(new THREE.Vector3(0, 1.0, 0)).sub(eye).normalize(); dir.y += 0.25; dir.normalize(); if (g.world.visible(eye, eye.clone().addScaledVector(dir, 3))) { g.gadgets.throwGrenade(C.gadget2, C, eye, dir, 0.9); C.gadget2Uses++; this.gadgetT = 5; } }
    }
  }
}

function wallTouchesRoom(w, r) {
  // the wall must lie on one of the room's edges and overlap it for at least 1 m (not just a corner)
  const eps = 0.3;
  if (Math.abs(w.y0 - r.min.y) >= 1) return false;
  if (w.horizontal) return (Math.abs(w.center.z - r.min.z) < eps || Math.abs(w.center.z - r.max.z) < eps) && (Math.min(w.x1, r.max.x) - Math.max(w.x0, r.min.x)) > 1.0;
  return (Math.abs(w.center.x - r.min.x) < eps || Math.abs(w.center.x - r.max.x) < eps) && (Math.min(w.z1, r.max.z) - Math.max(w.z0, r.min.z)) > 1.0;
}
function wallDistance(w, p) {
  const along = w.horizontal ? p.x : p.z; const a0 = w.horizontal ? w.x0 : w.z0, a1 = w.horizontal ? w.x1 : w.z1;
  const da = along < a0 ? a0 - along : along > a1 ? along - a1 : 0;
  const dn = w.horizontal ? Math.abs(p.z - w.center.z) : Math.abs(p.x - w.center.x);
  const dy = Math.max(0, Math.abs(p.y + 1 - (w.y0 + w.h / 2)) - w.h / 2);
  return Math.hypot(da, dn, dy);
}
export { wallTouchesRoom, wallDistance };
