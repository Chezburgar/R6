import * as THREE from 'three';
import { Weapons } from '../data/weapons.js';

// Weapon state machine (ammo, fire timing, reload, fire modes, recoil pattern) and
// ballistics (hitscan with penetration through soft materials, hit zones, falloff).

const _dir = new THREE.Vector3(), _o = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();

export class Weapon {
  constructor(id, owner) {
    this.def = Weapons[id]; this.id = id; this.owner = owner;
    this.reset();
  }
  reset() {
    const d = this.def;
    this.ammo = d.mag; this.reserve = d.reserve; this.mode = d.modes[0];
    this.reloading = false; this.reloadTimer = 0; this.reloadTotal = 0; this.reloadEmpty = false; this.shellLoop = false;
    this.fireTimer = 0; this.pumpTimer = 0; this.burst = 0; this.burstDecay = 0; this.trigger = false; this.lastShotTime = -10;
    this.kick = { v: 0, h: 0 };
  }
  get isShotgun() { return this.def.cls === 'shotgun'; }
  get auto() { return this.mode === 'auto'; }
  cycleMode() { const m = this.def.modes; if (m.length < 2) return false; this.mode = m[(m.indexOf(this.mode) + 1) % m.length]; return true; }

  update(dt) {
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.pumpTimer = Math.max(0, this.pumpTimer - dt);
    if (this.burst > 0) { this.burstDecay += dt; if (this.burstDecay > 0.22) { this.burst = Math.max(0, this.burst - dt * 12); } }
    if (this.reloading) {
      this.reloadTimer += dt;
      if (this.isShotgun && !this.def.magReload) {
        // shell-by-shell; each shell takes reloadT
        if (this.reloadTimer >= this.def.reloadT) { this.reloadTimer -= this.def.reloadT; if (this.reserve > 0 && this.ammo < this.def.mag) { this.ammo++; this.reserve--; } if (this.ammo >= this.def.mag || this.reserve <= 0 || this.cancelReload) { this.reloading = false; this.cancelReload = false; this.pumpTimer = 0.45; } }
      } else if (this.reloadTimer >= this.reloadTotal) {
        const need = this.def.mag - this.ammo + (this.reloadEmpty ? 0 : 0);
        const take = Math.min(need, this.reserve); this.ammo += take; this.reserve -= take; this.reloading = false;
      }
    }
  }
  startReload() {
    if (this.reloading || this.reserve <= 0 || this.ammo >= this.def.mag) return false;
    this.reloading = true; this.reloadTimer = 0; this.reloadEmpty = this.ammo === 0; this.reloadTotal = this.reloadEmpty ? this.def.reloadE : this.def.reloadT; this.cancelReload = false;
    if (this.isShotgun && !this.def.magReload) this.reloadTotal = this.def.reloadT * Math.min(this.def.mag - this.ammo, this.reserve) + 0.3;
    return true;
  }
  interruptReload() { if (this.reloading && this.isShotgun && !this.def.magReload) this.cancelReload = true; }
  canFire() { return !this.reloading && this.ammo > 0 && this.fireTimer <= 0 && this.pumpTimer <= 0; }

  // Perform one trigger pull. Returns true if a shot was fired.
  tryFire(game, origin, dir, opts = {}) {
    if (!this.canFire()) { if (this.ammo === 0 && !this.reloading && this.fireTimer <= 0) { this.fireTimer = 0.25; game.audio.click && game.audio.click('hover'); } return false; }
    const d = this.def;
    this.ammo--; this.fireTimer = 60 / d.rpm; if (d.pumpT) this.pumpTimer = d.pumpT;
    this.lastShotTime = game.time;
    // recoil pattern
    const first = this.burst < 0.5 ? d.recoil.first : 1;
    const ramp = Math.pow(d.recoil.ramp, Math.min(this.burst, 12));
    const adsMult = opts.ads ? 0.75 : 1.0, stanceMult = opts.stance === 1 ? 0.85 : opts.stance === 2 ? 0.7 : 1;
    this.kick.v = d.recoil.v * first * ramp * adsMult * stanceMult;
    this.kick.h = (Math.random() - 0.5) * 2 * d.recoil.h * ramp * adsMult + (this.burst > 6 ? Math.sin(this.burst * 0.9) * d.recoil.h * 0.6 : 0);
    this.burst += 1; this.burstDecay = 0;
    // spread
    // hip fire in Siege is tight at room range: the data spread is the cone for shotgun pellets, bullets use ~40% of it
    let spread = opts.ads ? (d.adsSpread !== undefined ? d.adsSpread : 0.05) : d.spread * 0.4;
    if (opts.moving) spread *= opts.ads ? 1.5 : 1.25;
    if (opts.stance === 1) spread *= 0.85; if (opts.stance === 2) spread *= 0.7;
    spread += Math.min(this.burst, 10) * (opts.ads ? 0.025 : 0.05);
    const pellets = d.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      randomCone(dir, (pellets > 1 ? d.spread * (opts.ads ? 0.75 : 1) : spread) * Math.PI / 180, _dir);
      game.ballistics.shoot(this.owner, origin, _dir, d, { pellet: pellets > 1, tracer: !(pellets > 1 && i > 2) && (opts.tracer !== false), viewmodel: opts.viewmodel, fxOrigin: opts.fxOrigin });
    }
    return true;
  }
}

function randomCone(dir, angle, out) {
  // uniform within cone of half-angle
  const r = angle * Math.sqrt(Math.random()); const t = Math.random() * Math.PI * 2;
  _u.set(0, 1, 0); if (Math.abs(dir.y) > 0.9) _u.set(1, 0, 0);
  _r.crossVectors(dir, _u).normalize(); _u.crossVectors(_r, dir).normalize();
  out.copy(dir).multiplyScalar(Math.cos(r)).addScaledVector(_r, Math.sin(r) * Math.cos(t)).addScaledVector(_u, Math.sin(r) * Math.sin(t)).normalize();
  return out;
}

export class Ballistics {
  constructor(game) { this.game = game; }

  // Hitscan with penetration. Applies damage, surface effects, decals and sounds.
  shoot(shooter, origin, dir, def, opts = {}) {
    const game = this.game; const world = game.world; const level = game.level; const fx = game.effects;
    const net = game.net; const cosmetic = !!opts.cosmetic;
    // online client: the host resolves my shots; locally only the effects play
    if (net && net.isClient && !cosmetic) { if (shooter === game.player.char) net.sendFire(origin, dir, def, opts); return this.shoot(shooter, origin, dir, def, { ...opts, cosmetic: true }); }
    if (net && net.isHost && !cosmetic) net.onShot(shooter, origin, dir, def, opts);
    const maxDist = 120;
    const hits = world.trace(origin, dir, maxDist, { filter: c => c.solid || c.tag === 'glass' || c.tag === 'shield' || c.tag === 'gadget' || c.tag === 'barricade' });
    // stop distance: first non-penetrable or end of list
    let stopDist = maxDist; let stopHit = null;
    for (const h of hits) { if (h.entry && !h.collider.penetrable) { stopDist = h.dist; stopHit = h; break; } }
    // characters along the ray up to stop distance
    let target = null, tHit = null;
    for (const ch of game.characters) {
      if (ch === shooter || !ch.alive && !ch.dbno || ch.dead) continue;
      if (ch.pos.distanceToSquared(origin) > (stopDist + 3) * (stopDist + 3)) continue;
      // the body may have been pushed after its last pose update (separation, collision): test where it is now
      if (ch.root && ch.root.position.distanceToSquared(ch.pos) > 1e-6) { ch.root.position.copy(ch.pos); ch.root.updateMatrixWorld(true); ch._hbStale = true; }
      const r = ch.raycast(origin, dir, stopDist);
      if (r && (!tHit || r.dist < tHit.dist)) { target = ch; tHit = r; }
    }
    const endDist = tHit ? tHit.dist : stopDist;
    // surface effects for penetrations before the end
    let mult = 1; let gadgetHit = null;
    for (const h of hits) {
      if (h.dist > endDist + 1e-3) break;
      if (h.entry) {
        const c = h.collider;
        if (opts.fxDist === undefined || h.dist < 60) fx.impact(h.point, h.normal, c.material);
        if (cosmetic) { level.addBulletHole(h.point, h.normal, c.material === 'drywall' ? 0.075 : 0.055); if (c.penetrable) mult *= c.penMult; continue; }
        if ((c.tag === 'gadget' || c.tag === 'camera') && c.owner && c.owner.onBullet) { c.owner.onBullet(def.dmg * mult, shooter, h); }
        level.bulletHit(h, fx);
        if (c.tag === 'shield' && c.owner && c.owner.onBullet) c.owner.onBullet(def.dmg, shooter, h);
        if (c.penetrable) mult *= c.penMult;
      }
    }
    // tracer
    if (opts.tracer && fx) { const fo = opts.fxOrigin || origin; fx.tracer(fo, dir, Math.max(0.5, endDist - (opts.fxOrigin ? fo.distanceTo(origin) : 0)), opts.viewmodel); }
    // whizz for local player
    const P = game.player && game.player.char; if (P && shooter !== P && P.alive) {
      const eye = P.eyePos(_o); const t = Math.max(0, Math.min(endDist, _r.subVectors(eye, origin).dot(dir)));
      const dist = _u.copy(origin).addScaledVector(dir, t).distanceTo(eye);
      if (dist < 1.4 && t > 2) game.audio.whizz(_u);
    }
    if (target && tHit && cosmetic) { fx.bloodHit(tHit.point, dir); game.audio.impact(tHit.point, 'flesh'); return { target, zone: tHit.zone, dist: tHit.dist, dmg: 0 }; }
    if (target && tHit) {
      // falloff
      const [f0, f1, fmin] = def.fall; const d = tHit.dist;
      let fm = d <= f0 ? 1 : d >= f1 ? fmin : 1 - (d - f0) / (f1 - f0) * (1 - fmin);
      let dmg = def.dmg * fm * mult;
      if (shooter && shooter.dmgMult) dmg *= shooter.dmgMult;
      const dealt = target.takeDamage(dmg, tHit.zone, shooter, dir, tHit.point, 'bullet');
      if (net) net.onHit(target, shooter, tHit.point, dir, tHit.zone);
      fx.bloodHit(tHit.point, dir);
      game.audio.impact(tHit.point, 'flesh');
      if (shooter === P) game.onPlayerHit && game.onPlayerHit(target, tHit.zone, dealt);
      if (shooter && shooter.onHitTarget) shooter.onHitTarget(target, tHit.zone);
      if (target.side === shooter.side && shooter !== target) { /* team damage */ }
      return { target, zone: tHit.zone, dist: d, dmg: dealt };
    }
    return { target: null, dist: endDist, hit: stopHit };
  }

  // Explosion damage to characters with line-of-sight falloff.
  explode(source, center, radius, maxDmg, kind = 'explosion') {
    const game = this.game;
    for (const ch of game.characters) {
      if (ch.dead) continue;
      const p = ch.chestPos(_o); const d = p.distanceTo(center);
      if (d > radius) continue;
      // occlusion: a solid, non-penetrable surface between blocks most damage
      const dir = _dir.subVectors(p, center).normalize();
      const h = game.world.raycast(center, dir, d, { filter: c => c.solid && !c.penetrable });
      let dmg = maxDmg * (1 - Math.pow(d / radius, 1.5));
      if (h) dmg *= 0.25;
      if (dmg < 2) continue;
      ch.takeDamage(dmg, 'torso', source, dir, p, dmg >= ch.health + 30 ? 'explosionKill' : 'explosion');
    }
  }
}
