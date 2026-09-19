import * as THREE from 'three';
import { Bot, Difficulty } from '../game/Bot.js';
import { DefensePlan } from '../game/Match.js';
import { Stance } from '../game/Character.js';

// Campaign-specific AI on top of the match bots: teammates that move with the player, a patrolling
// high-value target with a bodyguard detail, a hostage that follows once secured, and defence plans
// that spread enemies over a list of rooms instead of one bomb site.

const _v = new THREE.Vector3();

function roomSpot(game, r, shrink = 0.35) {
  const p = new THREE.Vector3(r.center.x, r.min.y, r.center.z);
  return game.nav.randomWalkableNear(p, Math.min(r.max.x - r.min.x, r.max.z - r.min.z) * shrink) || p;
}

// Defence plan for a mission: the first `setupCount` bots fortify the site like a real defence,
// everyone else roams the patrol rooms. Roamers investigate noise and sightings.
export class CampaignDefensePlan extends DefensePlan {
  constructor(game, site, patrolRooms = [], setupCount = 3) { super(game, site); this.patrol = patrolRooms; this.setupCount = setupCount; this.taken = 0; this.pIdx = Math.floor(Math.random() * 100); }
  take(bot) {
    const i = this.taken++;
    if (i < this.setupCount || !this.patrol.length) { const t = super.take(bot); bot.role = 'anchor'; return t; }
    bot.role = 'roamer'; return [];
  }
  holdSpot(bot) {
    if (bot.role === 'roamer' && this.patrol.length) { const r = this.patrol[this.pIdx++ % this.patrol.length]; return { pos: roomSpot(this.game, r), yaw: Math.random() * Math.PI * 2, room: r }; }
    return super.holdSpot(bot);
  }
}

// Bodyguards stay close to whoever they protect (the courier); bots given `patrolRooms` roam those instead.
export class GuardPlan {
  constructor(game, ward, radius = 4) { this.game = game; this.ward = ward; this.radius = radius; }
  take(bot) { bot.role = bot.patrolRooms ? 'roamer' : 'anchor'; return []; }
  holdSpot(bot) {
    if (bot.patrolRooms && bot.patrolRooms.length) { const r = bot.patrolRooms[Math.floor(Math.random() * bot.patrolRooms.length)]; return { pos: roomSpot(this.game, r, 0.3), yaw: Math.random() * Math.PI * 2, room: r }; }
    const w = this.ward.pos; const p = this.game.nav.randomWalkableNear(w, this.radius) || w.clone();
    const d = _v.subVectors(p, w); return { pos: p, yaw: d.lengthSq() > 0.01 ? Math.atan2(-d.x, -d.z) + Math.PI : Math.random() * Math.PI * 2 };
  }
}

// A teammate on the player's side: fights what it sees, otherwise keeps formation on the player
// (or on the nearest living teammate when the player is down). Falls back to the normal attack
// plan when nobody is left to follow.
export class AllyBot extends Bot {
  constructor(game, op, side, diff = 'normal') { super(game, op, side, diff); this.boundLen = 1e9; this.formation = (Math.random() - 0.5) * 1.2; this.followT = 0; }
  // the player leads while they are up (also while droning: the team holds around the body); otherwise the
  // normal attack plan takes over
  _leader() { const P = this.game.player.char; return (!P.dead && !P.dbno) ? P : null; }
  _atkAction(dt) {
    const g = this.game; const C = this.char;
    if (this.target && g.time - this.lastSeenT < 1) { this.state = 'engage'; this.stop(); C.stance = Stance.STAND; return; }
    if (this.target && g.time - this.lastSeenT < 3) { this.stop(); return; }
    this._atkGadgets(dt);
    const L = this._leader();
    if (!L) { super._atkAction(dt); return; }
    const d = Math.hypot(L.pos.x - C.pos.x, L.pos.z - C.pos.z); const dy = Math.abs(L.pos.y - C.pos.y);
    this.followT -= dt;
    if (d > 4.2 || dy > 1.4) {
      if (this.followT <= 0 || !this.goal) { const fwd = L.forwardFlat(_v); const p = L.pos.clone().addScaledVector(fwd, -1.6).addScaledVector(L.right(new THREE.Vector3()), this.formation * 1.5); const q = g.nav.randomWalkableNear(p, 1.2) || L.pos.clone(); this.moveTo(q, 1.0); this.followT = 0.7; }
      this.state = 'move'; C.stance = Stance.STAND;
    } else {
      this.stop(); this.state = 'hold'; this.holdSpot = C.pos; this.holdYaw = L.yaw + this.formation * 0.8;
      C.stance = L.stance === Stance.CROUCH ? Stance.CROUCH : Stance.STAND;
    }
  }
}

// The courier: moves between the upper-floor rooms on a loose schedule, breaks for the next room
// when shot at, and fights back only when it has nowhere to go.
export class HVTBot extends Bot {
  constructor(game, op, side, diff = 'normal', rooms = []) { super(game, op, side, diff); this.rooms = rooms; this.wpIdx = Math.floor(Math.random() * rooms.length); this.moveT = 6 + Math.random() * 6; this.fleeT = 0; this.crouchHold = false; }
  _nextRoom() {
    const r = this.rooms[this.wpIdx++ % this.rooms.length]; if (!r) return;
    const p = roomSpot(this.game, r, 0.3); this.moveTo(p, 1.0); this.holdSpot = p; this.holdYaw = Math.random() * Math.PI * 2; this.room = r;
  }
  _defAction(dt) {
    const g = this.game; const C = this.char;
    const seen = this.target && g.time - this.lastSeenT < 1.2;
    if (seen && this.fleeT <= 0) { this.fleeT = 8; this._nextRoom(); }
    this.fleeT = Math.max(0, this.fleeT - dt);
    if (seen && (this.arrived() || !this.path)) { this.stop(); C.stance = Stance.STAND; this.state = 'engage'; return; }
    this.moveT -= dt;
    if (this.moveT <= 0) { this._nextRoom(); this.moveT = 12 + Math.random() * 10; }
    if (this.goal && !this.arrived()) { this.state = 'move'; C.stance = Stance.STAND; } else { this.stop(); this.state = 'hold'; }
  }
}

// Bodyguard: normal defender that re-evaluates its hold spot whenever it drifts away from its ward.
export class GuardBot extends Bot {
  constructor(game, op, side, diff = 'normal', ward = null) { super(game, op, side, diff); this.ward = ward; }
  _defAction(dt) {
    const w = this.ward; const g = this.game;
    if (w && !w.dead && this.state === 'hold' && this.holdSpot && this.holdSpot.distanceTo(w.pos) > 6) { this.holdSpot = null; this.stateT = 0; }
    if (w && w.dead && this.D.aggression < 0.9) this.D = { ...this.D, aggression: 0.9 };   // the detail hunts once the ward is gone
    super._defAction(dt);
  }
}

// The hostage: unarmed, never fights, kneels where it is held and follows the player (or the nearest
// teammate) at a couple of metres once secured.
export class HostageBot extends Bot {
  constructor(game, op, side) { super(game, op, side, 'easy'); this.D = { ...Difficulty.easy, vision: 0 }; this.secured = false; this.boundLen = 1e9; this.char.name = 'HOSTAGE'; }
  _perceive() { this.target = null; this.seeT = 0; }
  hear() {} callout() {}
  _combat() {}
  _atkGadgets() {}
  _think(dt) {
    const g = this.game; const C = this.char; const P = g.player.char;
    if (!this.secured) { this.stop(); C.stance = Stance.CROUCH; this.state = 'hold'; this.holdSpot = C.pos; return; }
    let L = (!P.dead && !P.dbno && !g.player.usingDrone) ? P : null;
    if (!L) { let bd = Infinity; for (const c of g.characters) { if (c === C || c.side !== this.side || c.dead || c.dbno) continue; const d = c.pos.distanceTo(C.pos); if (d < bd) { bd = d; L = c; } } }
    if (!L) { this.stop(); C.stance = Stance.CROUCH; return; }
    const d = Math.hypot(L.pos.x - C.pos.x, L.pos.z - C.pos.z); const dy = Math.abs(L.pos.y - C.pos.y);
    if (d > 2.4 || dy > 1.4) { this.moveTo(L.pos, 1.6); this.state = 'move'; C.stance = Stance.STAND; }
    else { this.stop(); this.state = 'hold'; this.holdSpot = C.pos; const dd = _v.subVectors(L.pos, C.pos); this.holdYaw = Math.atan2(-dd.x, -dd.z); C.stance = L.stance === Stance.CROUCH ? Stance.CROUCH : Stance.STAND; }
  }
}
