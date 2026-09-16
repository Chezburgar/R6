import * as THREE from 'three';
import { Input } from '../core/Input.js';
import { Collider } from '../core/Physics.js';
import { flat, getMaterial } from '../map/Materials.js';
import { Gadgets as GadgetDefs, SecondaryGadgets } from '../data/operators.js';

// Every operator ability and secondary gadget: projectiles (frag/stun/smoke/impact/EMP/
// nitro/breaching round), placeables (breach charge, claymore, barbed wire, shield, thermite,
// welcome mat, EDD, jammer, shock wire, armor pack) and instant abilities (hammer, Lion scan).

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const GRAV = 14;

let _gid = 1;
class Entity {
  constructor(mgr, type, owner) { this.mgr = mgr; this.game = mgr.game; this.type = type; this.owner = owner; this.side = owner ? owner.side : 'def'; this.id = _gid++; this.dead = false; this.mesh = null; this.col = null; this.pos = new THREE.Vector3(); this.disabledUntil = 0; this.hp = 1; }
  get disabled() { return this.game.time < this.disabledUntil; }
  addCollider(min, max, opts = {}) { this.col = this.game.world.add(new Collider(min, max, { material: opts.material || 'metal', solid: !!opts.solid, penetrable: !!opts.penetrable, blocksVision: false, blocksNav: !!opts.solid, tag: opts.tag || 'gadget', owner: this })); return this.col; }
  onBullet(dmg, shooter, hit) { this.hp -= dmg; if (this.hp <= 0) this.destroy(shooter); }
  onMelee(ch) { this.destroy(ch); }
  destroy(by) { if (this.dead) return; this.dead = true; if (this.col) this.game.world.remove(this.col); if (this.mesh) this.game.scene.remove(this.mesh); this.onDestroyed && this.onDestroyed(by); if (this.game.net && !this._netGone) { this._netGone = true; this.game.net.onGadgetGone(this, 'destroy'); } }
  replicaDetonate() { this.destroy(); }
  update(dt) {}
}

// ---------- projectiles ----------
class Grenade extends Entity {
  constructor(mgr, type, owner, pos, vel, fuse) {
    super(mgr, type, owner); this.pos.copy(pos); this.vel = vel.clone(); this.fuse = fuse; this.age = 0; this.stuck = false; this.remote = type === 'nitro' || type === 'breachRoundProj' && false;
    const col = type === 'stun' ? 0x2a2a2e : type === 'smoke' ? 0x3a4a3a : type === 'emp' ? 0x2a3a5a : type === 'nitro' ? 0x2a2a2a : type === 'impact' ? 0x3a3a2a : 0x2a3320;
    const geo = type === 'nitro' ? new THREE.BoxGeometry(0.16, 0.06, 0.12) : type === 'breachRoundProj' ? new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8) : new THREE.SphereGeometry(0.055, 12, 10);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.4 })); this.mesh.castShadow = true; this.mesh.position.copy(pos);
    if (type === 'nitro' || type === 'stun' || type === 'emp') { const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: type === 'emp' ? 0x30a0ff : 0xff2020, emissiveIntensity: 3 })); led.position.y = 0.045; this.mesh.add(led); }
    this.game.scene.add(this.mesh); this.spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
    this.radius = type === 'breachRoundProj' ? 0.03 : 0.055;
  }
  update(dt) {
    if (this.dead) return; this.age += dt;
    if (!this.stuck) {
      this.vel.y -= GRAV * dt;
      const step = _v.copy(this.vel).multiplyScalar(dt); const len = step.length();
      if (len > 1e-6) {
        const dir = _v2.copy(step).divideScalar(len);
        const h = this.game.world.raycast(this.pos, dir, len + this.radius, { filter: c => c.solid || c.tag === 'glass' });
        if (h) {
          if (h.collider.tag === 'glass' && h.collider.owner) { this.game.level.breakGlass(h.collider.owner, this.game.effects); }
          else if (this.type === 'nitro' || this.type === 'breachRoundProj' || this.type === 'impact') {
            this.pos.copy(h.point).addScaledVector(h.normal, this.radius * 0.9); this.stuck = true; this.stickNormal = h.normal.clone(); this.stickCol = h.collider; this.vel.set(0, 0, 0);
            if (this.type === 'impact') { this.detonate(); return; }
            if (this.type === 'breachRoundProj') { this.fuse = Math.min(this.fuse, this.age + 0.9); this.game.audio.beep(this.pos, 2200, 0.05, 0.4); }
            // bandit / mute checks
            if (h.collider.owner && this.mgr.wallElectrified(h.collider.owner)) { this.game.effects.shockSparks(this.pos); this.destroy(); return; }
          } else {
            // bounce
            this.pos.copy(h.point).addScaledVector(h.normal, this.radius);
            const vn = this.vel.dot(h.normal); this.vel.addScaledVector(h.normal, -1.8 * vn); this.vel.multiplyScalar(0.45);
            if (this.vel.length() < 0.4) this.vel.set(0, 0, 0);
            if (Math.abs(vn) > 1.5) this.game.audio.impact(this.pos, 'metal');
          }
        } else this.pos.add(step);
      }
      // characters: stun/smoke/frag just pass. resting check
      if (this.vel.lengthSq() < 0.01 && this.grounded !== undefined) {}
      this.mesh.position.copy(this.pos); this.mesh.rotation.x += this.spin.x * dt; this.mesh.rotation.y += this.spin.y * dt;
    } else this.mesh.position.copy(this.pos);
    if (this.type === 'nitro') { if (this.age > 0.3 && this.owner && this.owner.detonateRequested) { this.owner.detonateRequested = false; this.detonate(); } return; }
    if (this.age >= this.fuse) this.detonate();
  }
  detonate() {
    if (this.dead) return;
    const g = this.game; const p = this.pos.clone();
    if (this.mgr.replica) { this.destroy(); return; }
    const net = g.net; if (net) { this._netGone = true; net.onGadgetGone(this, 'det', p); const fxKind = { frag: 'explosion', impact: 'explosion', nitro: 'explosion', breachRoundProj: 'explosion', stun: 'stun', smoke: 'smoke', emp: 'emp' }[this.type]; if (fxKind) net.onFx(fxKind, p, { s: this.type === 'frag' ? 3 : this.type === 'nitro' ? 3.2 : this.type === 'impact' ? 1.6 : 1.5 }); }
    if (this.type === 'breachRoundProj' || this.type === 'nitro') { if (this.mgr.isJammed(p) && this.type === 'breachRoundProj') { this.destroy(); g.audio.emp(p); return; } }
    switch (this.type) {
      case 'frag': g.effects.explosion(p, 3); g.level.explode(p, 1.6, g.effects); g.ballistics.explode(this.owner, p, 5.5, 130, 'explosion'); g.noise && g.noise(this.owner, 200); break;
      case 'impact': g.effects.explosion(p, 1.6); g.level.explode(p, 1.15, g.effects); g.ballistics.explode(this.owner, p, 2.5, 35); this.mgr.destroyGadgetsNear(p, 1.6, this.owner); break;
      case 'nitro': g.effects.explosion(p, 3.2); g.level.explode(p, 1.9, g.effects); g.ballistics.explode(this.owner, p, 5, 150, 'explosion'); this.mgr.destroyGadgetsNear(p, 3, this.owner); break;
      case 'breachRoundProj': g.effects.explosion(p, 1.5); g.level.explode(p, 1.35, g.effects); g.ballistics.explode(this.owner, p, 2.4, 40); this.mgr.destroyGadgetsNear(p, 1.5, this.owner); break;
      case 'stun': g.effects.stunFlash(p); g.audio.explosion(p, 0.5); this.mgr.stunAt(p, 7, this.owner); break;
      case 'smoke': g.effects.smokeCloud(p, 3.2, 11); this.mgr.smokes.push({ pos: p, r: 3.0, until: g.time + 11 }); g.audio.beep(p, 300, 0.4, 0.3); break;
      case 'emp': g.effects.empPulse(p); g.audio.emp(p); this.mgr.empAt(p, 5.2); break;
    }
    this.destroy();
  }
}

// ---------- placeables ----------
class Placed extends Entity {
  // `pre` fields are assigned before build() so subclasses can rely on them in build()
  constructor(mgr, type, owner, pos, normal, pre = null) { super(mgr, type, owner); this.pos.copy(pos); this.normal = normal ? normal.clone() : new THREE.Vector3(0, 1, 0); if (pre) Object.assign(this, pre); this.build(); }
  build() {}
}

class BreachCharge extends Placed {
  build() {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.5, metalness: 0.5 }));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), new THREE.MeshStandardMaterial({ emissive: 0xff3020, emissiveIntensity: 3 })); led.position.z = 0.035; m.add(led);
    m.position.copy(this.pos).addScaledVector(this.normal, 0.035); m.lookAt(m.position.clone().add(this.normal)); this.mesh = m; this.game.scene.add(m);
    this.addCollider(_v.copy(this.pos).subScalar(0.22), _v2.copy(this.pos).addScalar(0.22)); this.hp = 1;
    this.game.audio.beep(this.pos, 3000, 0.06, 0.3);
  }
  update() { if (this.owner && this.owner.detonateRequested && !this.dead) { this.owner.detonateRequested = false; this.detonate(); } }
  detonate() { const p = this.pos.clone().addScaledVector(this.normal, 0.2); this.game.effects.explosion(p, 2.2); if (this.game.net) this.game.net.onFx('explosion', p, { s: 2.2 }); this.game.level.explode(this.pos.clone().addScaledVector(this.normal, -0.05), 1.55, this.game.effects); this.game.ballistics.explode(this.owner, p, 3.4, 90); this.mgr.destroyGadgetsNear(p, 2, this.owner); this.destroy(); }
}

class Claymore extends Placed {
  build() {
    const m = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.04), new THREE.MeshStandardMaterial({ color: 0x3b4a2a, roughness: 0.6 })); body.position.y = 0.1; m.add(body);
    for (const x of [-0.07, 0.07]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1), new THREE.MeshStandardMaterial({ color: 0x222 })); leg.position.set(x, 0.05, 0); m.add(leg); }
    this.dir = this.normal.clone(); this.dir.y = 0; if (this.dir.lengthSq() < 1e-3) this.dir.set(0, 0, 1); this.dir.normalize();
    m.position.copy(this.pos); m.lookAt(m.position.clone().add(this.dir)); this.mesh = m; this.game.scene.add(m);
    // laser line
    const laser = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 3.0), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.5 })); laser.position.set(0, 0.1, 1.5); m.add(laser);
    this.addCollider(_v.copy(this.pos).add(new THREE.Vector3(-0.15, 0, -0.15)), _v2.copy(this.pos).add(new THREE.Vector3(0.15, 0.2, 0.15))); this.hp = 1;
  }
  update() {
    if (this.dead) return;
    for (const ch of this.game.characters) {
      if (ch.dead || ch.side === this.side) continue;
      const d = _v.subVectors(ch.pos, this.pos); const along = d.dot(this.dir); if (along < 0.1 || along > 3.0) continue;
      const lateral = Math.hypot(d.x - this.dir.x * along, d.z - this.dir.z * along); if (lateral > 0.45) continue;
      if (Math.abs(d.y) > 1.0) continue;
      if (!this.game.world.visible(this.pos.clone().add(new THREE.Vector3(0, 0.15, 0)), ch.pos.clone().add(new THREE.Vector3(0, 0.3, 0)))) continue;
      const p = this.pos.clone().add(new THREE.Vector3(0, 0.2, 0));
      this.game.effects.explosion(p, 1.8); this.game.ballistics.explode(this.owner, p, 3.5, 160, 'explosionKill'); this.destroy(); return;
    }
  }
}

class BarbedWire extends Placed {
  build() {
    const m = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: 0x7a7f86, roughness: 0.5, metalness: 0.8 });
    for (let i = 0; i < 9; i++) { const coil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.008, 6, 20), mat); coil.position.set((Math.random() - 0.5) * 1.6, 0.22, (Math.random() - 0.5) * 1.6); coil.rotation.set(Math.random(), Math.random(), Math.random()); m.add(coil); }
    m.position.copy(this.pos); this.mesh = m; this.game.scene.add(m);
    this.addCollider(_v.copy(this.pos).add(new THREE.Vector3(-1, 0, -1)), _v2.copy(this.pos).add(new THREE.Vector3(1, 0.5, 1)), { penetrable: true }); this.hp = 60;
    this.electrified = false;
  }
  onMelee(ch) { this.hp -= 30; if (this.hp <= 0) this.destroy(ch); }
  update() {
    if (this.dead) return;
    for (const ch of this.game.characters) {
      if (ch.dead) continue;
      if (Math.abs(ch.pos.x - this.pos.x) < 1 && Math.abs(ch.pos.z - this.pos.z) < 1 && Math.abs(ch.pos.y - this.pos.y) < 0.6) {
        ch.wire = 0.2;
        if (this.electrified && ch.side !== this.side) { ch.shockT = (ch.shockT || 0) + 0.016; if (ch.shockT > 0.5) { ch.shockT = 0; ch.takeDamage(6, 'limb', this.owner, null, ch.pos, 'shock'); this.game.effects.shockSparks(ch.pos.clone().add(new THREE.Vector3(0, 0.3, 0))); } }
        if (ch.speedNorm > 0.05 && Math.random() < 0.05) this.game.audio.impact(ch.pos, 'metal');
      }
    }
    if (this.electrified && Math.random() < 0.15) this.game.effects.shockSparks(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.2, (Math.random() - 0.5) * 1.6)));
  }
}

class DeployableShield extends Placed {
  build() {
    const dir = this.normal.clone(); dir.y = 0; if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1); dir.normalize(); this.dir = dir;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.95, 0.06), new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.4, metalness: 0.7 })); m.position.copy(this.pos); m.position.y += 0.475; m.lookAt(m.position.clone().add(dir)); m.castShadow = true; this.mesh = m; this.game.scene.add(m);
    const horiz = Math.abs(dir.z) > Math.abs(dir.x);
    const hw = horiz ? 0.55 : 0.05, hd = horiz ? 0.05 : 0.55;
    this.addCollider(_v.set(this.pos.x - hw, this.pos.y, this.pos.z - hd), _v2.set(this.pos.x + hw, this.pos.y + 0.95, this.pos.z + hd), { solid: true, material: 'shield', tag: 'shield' }); this.col.blocksVision = true; this.hp = 1e9;
    this.electrified = false;
  }
  onBullet() {}
}

class ThermiteCharge extends Placed {
  constructor(mgr, type, owner, pos, normal, wall, hatch) { super(mgr, type, owner, pos, normal, { wall, hatch }); this.burning = false; this.burnT = 0; this.armed = true; }
  build() {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6 }));
    m.position.copy(this.pos).addScaledVector(this.normal, 0.03); m.lookAt(m.position.clone().add(this.normal)); this.mesh = m; this.game.scene.add(m);
    this.addCollider(_v.copy(this.pos).subScalar(0.45), _v2.copy(this.pos).addScalar(0.45)); this.hp = 1;
  }
  update(dt) {
    if (this.dead) return;
    if (!this.burning && this.owner && this.owner.detonateRequested) {
      this.owner.detonateRequested = false;
      if (this.mgr.isJammed(this.pos)) { this.game.audio.emp(this.pos); this.game.hud && this.owner.isPlayer && this.game.hud.toast('CHARGE JAMMED'); return; }
      this.burning = true; this.burnT = 0; this.stopSound = this.game.audio.tool('thermite', this.pos, 4.2); this.game.noise && this.game.noise(this.owner, 120);
      if (this.game.net) this.game.net.onFx('thermite', this.pos, { n: [this.normal.x, this.normal.y, this.normal.z] });
    }
    if (this.burning) {
      this.burnT += dt; this.game.effects.thermiteBurn(this.pos.clone().addScaledVector(this.normal, 0.05), this.normal, dt);
      if (this.burnT >= 4.0) {
        const p = this.pos.clone().addScaledVector(this.normal, 0.3);
        this.game.effects.explosion(p, 2.4); if (this.game.net) this.game.net.onFx('explosion', p, { s: 2.4 });
        if (this.wall) { this.wall.breachHole(this.pos, 1.0, 1.1); this.game.level.removeStudsNear(this.pos, 1.1); this.game.level.onWallChanged && this.game.level.onWallChanged(this.wall); }
        if (this.hatch) this.hatch.breach();
        this.game.ballistics.explode(this.owner, p, 3, 70);
        this.destroy();
      }
    }
  }
  onDestroyed() { if (this.stopSound) this.stopSound(); }
}

class WelcomeMat extends Placed {
  build() {
    const dir = this.normal.clone(); dir.y = 0; if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1); dir.normalize(); this.dir = dir;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.03, 0.6), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8, metalness: 0.3 })); m.position.copy(this.pos); m.position.y += 0.015; m.lookAt(m.position.clone().add(dir)); this.mesh = m;
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.04), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.8, roughness: 0.3 })); jaw.position.set(0, 0.04, 0.26); m.add(jaw); const jaw2 = jaw.clone(); jaw2.position.z = -0.26; m.add(jaw2);
    this.game.scene.add(m);
    this.addCollider(_v.copy(this.pos).add(new THREE.Vector3(-0.5, -0.05, -0.5)), _v2.copy(this.pos).add(new THREE.Vector3(0.5, 0.15, 0.5)), { penetrable: true }); this.hp = 1;
  }
  update() {
    if (this.dead) return;
    for (const ch of this.game.characters) {
      if (ch.dead || ch.dbno || ch.side === this.side) continue;
      if (Math.abs(ch.pos.x - this.pos.x) < 0.5 && Math.abs(ch.pos.z - this.pos.z) < 0.5 && Math.abs(ch.pos.y - this.pos.y) < 0.5) {
        ch.goDBNO(this.owner, null); ch.trapped = true; this.game.audio.melee(this.pos, true, 'metal'); this.game.hud && ch.isPlayer && this.game.hud.toast('CAUGHT IN WELCOME MAT');
        this.destroy(); return;
      }
    }
  }
}

class EDD extends Placed {
  constructor(mgr, type, owner, pos, normal, slot) { super(mgr, type, owner, pos, normal, { slot }); }
  build() {
    const s = this.slot; const m = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.06), new THREE.MeshStandardMaterial({ color: 0x3b3f2a, roughness: 0.6 })); m.add(box);
    // device on one side of the frame at 0.5m height, laser across the opening
    const side = s.horizontal ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    m.position.set(s.x, s.y + 0.55, s.z).addScaledVector(side, -s.w / 2 + 0.06);
    const laser = new THREE.Mesh(new THREE.BoxGeometry(s.horizontal ? s.w - 0.1 : 0.004, 0.004, s.horizontal ? 0.004 : s.w - 0.1), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.25 })); laser.position.copy(side).multiplyScalar(s.w / 2 - 0.05); m.add(laser);
    this.mesh = m; this.game.scene.add(m); this.pos.copy(m.position);
    this.addCollider(_v.copy(this.pos).subScalar(0.1), _v2.copy(this.pos).addScalar(0.1)); this.hp = 1;
  }
  update() {
    if (this.dead || this.disabled) return;
    const s = this.slot;
    for (const ch of this.game.characters) {
      if (ch.dead || ch.side === this.side) continue;
      const dx = ch.pos.x - s.x, dz = ch.pos.z - s.z;
      const across = s.horizontal ? Math.abs(dz) : Math.abs(dx), along = s.horizontal ? Math.abs(dx) : Math.abs(dz);
      if (across < 0.35 && along < s.w / 2 + 0.2 && ch.pos.y < s.y + 1.2 && ch.pos.y > s.y - 0.8) {
        const p = new THREE.Vector3(s.x, s.y + 0.6, s.z); this.game.effects.explosion(p, 1.8); this.game.ballistics.explode(this.owner, p, 3.0, 75); this.destroy(); return;
      }
    }
  }
}

class SignalDisruptor extends Placed {
  build() {
    const m = new THREE.Group(); const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.18), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 })); box.position.y = 0.05; m.add(box);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3), new THREE.MeshStandardMaterial({ color: 0x111 })); ant.position.set(0.06, 0.25, 0); m.add(ant);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshStandardMaterial({ emissive: 0x30ff60, emissiveIntensity: 3 })); led.position.set(-0.06, 0.105, 0.06); m.add(led); this.led = led;
    m.position.copy(this.pos); this.mesh = m; this.game.scene.add(m);
    this.addCollider(_v.copy(this.pos).add(new THREE.Vector3(-0.12, 0, -0.1)), _v2.copy(this.pos).add(new THREE.Vector3(0.12, 0.3, 0.1))); this.hp = 1; this.radius = 2.5;
  }
  update() { if (this.led) this.led.material.emissiveIntensity = this.disabled ? 0 : 2 + Math.sin(this.game.time * 6) * 1.5; }
}

class ShockWire extends Placed {
  constructor(mgr, type, owner, pos, normal, target) { super(mgr, type, owner, pos, normal, { target }); if (target.wall) target.wall.electrified++; if (target.hatch) target.hatch.electrified = true; if (target.entity) target.entity.electrified = true; }
  build() {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.1), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.6 }));
    m.position.copy(this.pos).addScaledVector(this.normal, 0.06); m.lookAt(m.position.clone().add(this.normal)); this.mesh = m; this.game.scene.add(m);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), new THREE.MeshStandardMaterial({ emissive: 0x40a0ff, emissiveIntensity: 3 })); led.position.z = 0.05; m.add(led); this.led = led;
    this.addCollider(_v.copy(this.pos).subScalar(0.13), _v2.copy(this.pos).addScalar(0.13)); this.hp = 1;
  }
  update(dt) {
    if (this.dead) return; const on = !this.disabled; if (this.led) this.led.material.emissiveIntensity = on ? 3 : 0;
    if (!on) return;
    const t = this.target;
    if (Math.random() < 0.2) { const p = this.pos.clone(); if (t.wall) { const w = t.wall; p.set(w.horizontal ? w.x0 + Math.random() * w.len : w.center.x, w.y0 + Math.random() * w.h, w.horizontal ? w.center.z : w.z0 + Math.random() * w.len).addScaledVector(this.normal, 0.05); } this.game.effects.shockSparks(p); }
    // attackers touching the wall take damage
    if (t.wall) { for (const ch of this.game.characters) { if (ch.dead || ch.side === this.side) continue; const w = t.wall; const d = w.horizontal ? Math.abs(ch.pos.z - w.center.z) : Math.abs(ch.pos.x - w.center.x); const along = w.horizontal ? ch.pos.x : ch.pos.z; const a0 = w.horizontal ? w.x0 : w.z0, a1 = w.horizontal ? w.x1 : w.z1; if (d < 0.5 && along > a0 && along < a1 && Math.abs(ch.pos.y - w.y0) < 1.5) { ch.shockT = (ch.shockT || 0) + dt; if (ch.shockT > 0.5) { ch.shockT = 0; ch.takeDamage(8, 'limb', this.owner, null, ch.pos, 'shock'); this.game.effects.shockSparks(ch.chestPos(new THREE.Vector3())); } } } }
  }
  onDestroyed() { const t = this.target; if (t.wall) t.wall.electrified = Math.max(0, t.wall.electrified - 1); if (t.hatch) t.hatch.electrified = false; if (t.entity) t.entity.electrified = false; }
}

class ArmorPack extends Placed {
  build() {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.4), new THREE.MeshStandardMaterial({ color: 0x25334a, roughness: 0.8 })); m.position.copy(this.pos); m.position.y += 0.16; m.castShadow = true; this.mesh = m; this.game.scene.add(m);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.42), new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.6 })); strap.position.y = 0.08; m.add(strap);
    this.addCollider(_v.copy(this.pos).add(new THREE.Vector3(-0.25, 0, -0.2)), _v2.copy(this.pos).add(new THREE.Vector3(0.25, 0.32, 0.2)), { penetrable: true }); this.hp = 1e9; this.plates = 5;
  }
  onBullet() {}
  take(ch) { if (this.plates <= 0 || ch.armorPlate || ch.side !== this.side) return false; this.plates--; ch.armorPlate = true; this.game.audio.click('ui'); if (this.plates <= 0) this.destroy(); return true; }
  update() { for (const ch of this.game.characters) { if (!ch.isPlayer && !ch.dead && !ch.armorPlate && ch.side === this.side && ch.pos.distanceTo(this.pos) < 1.4) this.take(ch); } }
}

// ---------- manager ----------
export class GadgetManager {
  constructor(game) {
    this.game = game; this.entities = []; this.smokes = []; this.scans = []; this.equipped = new Map();
    this.hammerT = 0; this.lionState = null;
    this.replica = !!(game.net && game.net.isClient);   // online client: entities are visual mirrors of the host's
  }
  reset() { for (const e of this.entities) e.destroy(); this.entities.length = 0; this.smokes.length = 0; this.scans.length = 0; this.lionState = null; }
  add(e) { this.entities.push(e); return e; }
  update(dt) {
    for (const e of this.entities) if (!e.dead && (!this.replica || e instanceof Grenade)) e.update(dt);
    this.entities = this.entities.filter(e => !e.dead);
    this.smokes = this.smokes.filter(s => s.until > this.game.time);
    if (this.lionState) this._updateLion(dt);
  }
  // ---- queries ----
  isJammed(pos) { for (const e of this.entities) if (e.type === 'mute' && !e.disabled && e.pos.distanceTo(pos) < e.radius) return true; return false; }
  wallElectrified(owner) { return owner && ((owner.electrified > 0) || owner.electrified === true); }
  inSmoke(a, b) { // does the segment a-b pass through smoke?
    for (const s of this.smokes) { const d = segDist(a, b, s.pos); if (d < s.r) return true; } return false;
  }
  destroyGadgetsNear(p, r, by) { for (const e of this.entities) if (!e.dead && e.pos.distanceTo(p) < r && e.type !== 'shield' && e.type !== 'rook') e.destroy(by); }
  stunAt(p, r, by) {
    for (const ch of this.game.characters) {
      if (ch.dead) continue; const eye = ch.eyePos(_v); const d = eye.distanceTo(p); if (d > r) continue;
      if (!this.game.world.visible(p, eye)) continue;
      // facing factor
      const toG = _v2.subVectors(p, eye).normalize(); const f = ch.forward(_v3).dot(toG);
      const intensity = (1 - d / r) * (0.5 + 0.5 * Math.max(0, f));
      if (intensity < 0.15) continue;
      ch.stunned = Math.max(ch.stunned, 1.2 + intensity * 3.4);
      if (ch.isPlayer) { this.game.hud.stun(intensity); this.game.audio.stun(intensity); }
      if (this.game.net) this.game.net.onStun(ch, intensity, 1.2 + intensity * 3.4);
    }
  }
  empAt(p, r) {
    for (const e of this.entities) { if (!e.dead && e.side === 'def' && e.pos.distanceTo(p) < r && (e.type === 'mute' || e.type === 'bandit' || e.type === 'kapkan' || e.type === 'claymore')) { e.disabledUntil = this.game.time + 15; this.game.effects.shockSparks(e.pos); } }
    for (const ch of this.game.characters) if (!ch.dead && ch.side === 'def' && ch.pos.distanceTo(p) < r) { ch.empd = 15; if (this.game.net) this.game.net.onEmp(ch, 15); }
  }
  // Lion scan
  lionScan(ch) {
    if (this._route({ op: 'lion' }, ch)) return true;
    if (this.lionState) return false;
    this.lionState = { owner: ch, t: 0, phase: 'warn', pinged: new Set() };
    this.game.hud.toast('EE-ONE-D SCAN INCOMING'); this.game.audio.scan();
    for (const c of this.game.characters) if (c.side === 'def' && !c.dead && c.isPlayer) this.game.hud.toast('LION SCAN — STAND STILL', 1.5);
    return true;
  }
  _updateLion(dt) {
    const L = this.lionState; L.t += dt;
    if (L.phase === 'warn' && L.t > 1.5) { L.phase = 'scan'; L.t = 0; this.game.audio.scan(); }
    else if (L.phase === 'scan') {
      const hit = []; for (const c of this.game.characters) { if (c.side === 'def' && !c.dead && c.speedNorm > 0.12 && !this.isJammed(c.pos)) { c.pingedUntil = this.game.time + 5; if (!L.pinged.has(c)) hit.push(c); L.pinged.add(c); } }
      if (hit.length && this.game.net) this.game.net.onLionScan('atk', hit);
      if (L.t > 2.0) { L.phase = 'done'; this.lionState = null; }
    }
  }

  // ---- placement API (player & bots) ----
  _route(msg, ch) { const net = this.game.net; if (net && net.isClient && ch === this.game.player.char) { net.sendGadget(msg); return true; } return false; }
  throwGrenade(type, ch, origin, dir, power = 1, fromNet = false) {
    if (!fromNet && this._route({ op: 'throw', kind: type, o: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z], pw: power }, ch)) return null;
    const fuse = type === 'frag' ? 4.0 : type === 'stun' ? 1.8 : type === 'smoke' ? 1.5 : type === 'emp' ? 1.5 : type === 'impact' ? 5 : 99;
    const vel = dir.clone().multiplyScalar((type === 'nitro' ? 9 : 13) * power); vel.y += 1.5;
    const g = new Grenade(this, type, ch, origin.clone().addScaledVector(dir, 0.3), vel, fuse);
    this.add(g); this.game.audio.click('hover');
    if (this.game.net && this.game.net.isHost) this.game.net.onGadgetCreated(g, 'throw', { o2: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z], pw: power });
    return g;
  }
  fireBreachRound(ch, origin, dir, fromNet = false) {
    if (!fromNet && this._route({ op: 'breach', o: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z] }, ch)) return null;
    const g = new Grenade(this, 'breachRoundProj', ch, origin.clone().addScaledVector(dir, 0.4), dir.clone().multiplyScalar(38), 6);
    this.add(g); this.game.audio.gunshot({ cal: '12ga' }, ch.pos, ch.isPlayer);
    if (this.game.net && this.game.net.isHost) this.game.net.onGadgetCreated(g, 'breach', { o2: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z] });
    return g;
  }
  place(type, ch, pos, normal, extra = {}, fromNet = false) {
    if (!fromNet && this.game.net && this.game.net.isClient && ch === this.game.player.char) { const slot = this.equipped.get(ch) || (type === ch.op.gadget ? 'primary' : 'secondary'); this.game.net.sendGadget({ op: 'place', kind: type, p: [pos.x, pos.y, pos.z], n: [normal.x, normal.y, normal.z], x: this.game.net._packExtra(extra), slot }); return { pending: true }; }
    let e = null;
    switch (type) {
      case 'breach': e = new BreachCharge(this, type, ch, pos, normal); break;
      case 'claymore': e = new Claymore(this, type, ch, pos, normal); break;
      case 'barbed': e = new BarbedWire(this, type, ch, pos, normal); break;
      case 'shield': e = new DeployableShield(this, type, ch, pos, normal); break;
      case 'thermite': e = new ThermiteCharge(this, type, ch, pos, normal, extra.wall, extra.hatch); break;
      case 'frost': e = new WelcomeMat(this, type, ch, pos, normal); break;
      case 'kapkan': e = new EDD(this, type, ch, pos, normal, extra.slot); break;
      case 'mute': e = new SignalDisruptor(this, type, ch, pos, normal); break;
      case 'bandit': e = new ShockWire(this, type, ch, pos, normal, extra.target); break;
      case 'rook': e = new ArmorPack(this, type, ch, pos, normal); break;
    }
    if (e) { this.add(e); this.game.audio.click('ui'); if (this.game.net && this.game.net.isHost) this.game.net.onGadgetCreated(e, 'place', { n: [normal.x, normal.y, normal.z], x: this.game.net._packExtra(extra) }); }
    return e;
  }
  hammerSwing(ch, origin, dir) {
    const g = this.game;
    if (this._route({ op: 'hammer', o: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z] }, ch)) { g.audio.melee(ch.pos, false); return true; } const h = g.world.raycast(origin, dir, 2.0, { filter: c => c.solid || c.tag === 'glass' });
    // enemies
    for (const o of g.characters) { if (o === ch || o.dead) continue; const r = o.raycast(origin, dir, 1.9); if (r) { o.takeDamage(o.dbno ? 200 : 100, 'torso', ch, dir, r.point, 'melee'); g.audio.melee(r.point, true, 'flesh'); g.effects.bloodHit(r.point, dir); return true; } }
    if (!h) { g.audio.melee(ch.pos, false); return false; }
    const res = g.level.hammer(h);
    g.audio.melee(h.point, true, h.collider.material); g.effects.impact(h.point, h.normal, h.collider.material);
    if (res === 'wall') { g.effects.wallDebris(h.point, h.normal); g.audio.explosion(h.point, 0.25); }
    g.noise && g.noise(ch, 60);
    return !!res;
  }

  // ---- player input handling for equipped gadgets ----
  onEquip(ch, slot) { this.equipped.set(ch, slot); if (ch.isPlayer) this.game.hud.gadgetSlot(slot); }
  playerUse(player, slot, dt) {
    const C = player.char; const g = this.game; const op = C.op;
    const cam = player.camera; const origin = cam.getWorldPosition(_v).clone(); const dir = cam.getWorldDirection(_v2).clone();
    const isPrimary = slot === 'primary';
    const type = isPrimary ? op.gadget : C.gadget2;
    const usesLeft = isPrimary ? (GadgetDefs[op.gadget].uses - C.gadgetUses) : (SecondaryGadgets[C.gadget2].uses - C.gadget2Uses);
    // remote detonation / cancel with G handled here
    if (Input.hit('gadget') && !isPrimary) { /* toggled off by caller */ }
    if (!Input.fireHit()) { this.hammerT = Math.max(0, this.hammerT - dt); return; }
    // remote detonate first if something is armed
    const armed = this.entities.find(e => e.owner === C && !e.dead && (e.type === 'breach' || e.type === 'nitro' || (e.type === 'thermite' && !e.burning)));
    if (armed && ((type === 'breach' && armed.type === 'breach') || (type === 'nitro' && armed.type === 'nitro') || (type === 'thermite' && armed.type === 'thermite'))) { C.detonateRequested = true; g.audio.click('ui'); if (g.net && g.net.isClient) g.net.sendGadget({ op: 'detonate' }); return; }
    if (usesLeft <= 0) { g.hud.toast('NO GADGETS REMAINING'); return; }
    const consume = () => { if (isPrimary) C.gadgetUses++; else C.gadget2Uses++; g.hud.refreshGadgets(); };
    const surf = g.world.raycast(origin, dir, 2.4, { filter: c => c.solid });
    const floorHit = g.world.raycast(origin, dir, 3.5, { filter: c => c.solid });
    const onFloor = floorHit && floorHit.normal.y > 0.7;
    switch (type) {
      case 'hammer': if (this.hammerT > 0) return; this.hammerT = 0.6; player.melee = 0.5; player._meleeHit = true; setTimeout(() => { if (this.hammerSwing(C, origin, dir)) consume(); }, 180); return;
      case 'emp': case 'frag': case 'stun': case 'smoke': case 'impact': this.throwGrenade(type, C, origin, dir); consume(); g.noise && g.noise(C, 10); return;
      case 'nitro': this.throwGrenade('nitro', C, origin, dir, 0.8); consume(); return;
      case 'breachRound': this.fireBreachRound(C, origin, dir); consume(); return;
      case 'lion': if (this.lionScan(C)) consume(); return;
      case 'breach': if (surf && (surf.collider.tag === 'cell' || surf.collider.tag === 'hatch' || surf.collider.tag === 'barricade') && !(surf.collider.owner && surf.collider.owner.reinforced)) { this.place('breach', C, surf.point, surf.normal); consume(); } else g.hud.toast('PLACE ON A DESTRUCTIBLE SURFACE'); return;
      case 'thermite': if (surf && ((surf.collider.tag === 'reinforcement' || (surf.collider.tag === 'cell' && surf.collider.owner)) || (surf.collider.tag === 'hatch'))) { const wall = surf.collider.tag !== 'hatch' ? surf.collider.owner : null; const hatch = surf.collider.tag === 'hatch' ? surf.collider.owner : null; if ((wall && this.wallElectrified(wall)) || (hatch && hatch.electrified)) { g.effects.shockSparks(surf.point); g.audio.emp(surf.point); g.hud.toast('WALL IS ELECTRIFIED'); return; } this.place('thermite', C, surf.point, surf.normal, { wall, hatch }); consume(); } else g.hud.toast('PLACE ON A REINFORCED WALL OR HATCH'); return;
      case 'claymore': case 'frost': case 'mute': case 'barbed': case 'shield': case 'rook': {
        if (!onFloor) { g.hud.toast('AIM AT THE FLOOR'); return; }
        const p = floorHit.point.clone(); const fwd = C.forwardFlat(_v3).clone();
        if (type === 'frost') { // must be near a doorway/window? R6 allows anywhere; prefer flat floor
        }
        this.place(type, C, p, type === 'barbed' || type === 'mute' || type === 'rook' ? new THREE.Vector3(0, 1, 0) : fwd); consume(); return;
      }
      case 'kapkan': { const slot = this._nearestSlot(C, origin, dir); if (!slot) { g.hud.toast('AIM AT A DOORWAY OR WINDOW'); return; } if (this.entities.some(e => e.type === 'kapkan' && e.slot === slot && !e.dead)) { g.hud.toast('ALREADY TRAPPED'); return; } this.place('kapkan', C, new THREE.Vector3(slot.x, slot.y, slot.z), new THREE.Vector3(0, 1, 0), { slot }); consume(); return; }
      case 'bandit': {
        if (!surf) { g.hud.toast('AIM AT A REINFORCED WALL, HATCH OR WIRE'); return; }
        const c = surf.collider; let target = null;
        if (c.tag === 'reinforcement' || (c.tag === 'cell' && c.owner && c.owner.reinforced)) target = { wall: c.owner };
        else if (c.tag === 'hatch' && c.owner && c.owner.reinforced) target = { hatch: c.owner };
        else if (c.tag === 'gadget' && c.owner && (c.owner.type === 'barbed' || c.owner.type === 'shield')) target = { entity: c.owner };
        if (!target) { g.hud.toast('AIM AT A REINFORCED WALL, HATCH OR WIRE'); return; }
        if (this.entities.some(e => e.type === 'bandit' && !e.dead && ((target.wall && e.target.wall === target.wall) || (target.hatch && e.target.hatch === target.hatch) || (target.entity && e.target.entity === target.entity)))) { g.hud.toast('ALREADY ELECTRIFIED'); return; }
        this.place('bandit', C, surf.point, surf.normal, { target }); consume(); return;
      }
    }
  }
  _nearestSlot(ch, origin, dir) {
    let best = null, bd = 9;
    for (const s of this.game.level.barricadeSlots) {
      if (s.barricade.alive()) continue;
      const c = new THREE.Vector3(s.x, s.y + s.h / 2, s.z); const d = c.distanceTo(origin); if (d > 3) continue;
      const to = c.clone().sub(origin).normalize(); if (to.dot(dir) < 0.75) continue;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
}

function segDist(a, b, p) {
  const ab = _v.subVectors(b, a); const t = Math.max(0, Math.min(1, _v2.subVectors(p, a).dot(ab) / (ab.lengthSq() || 1)));
  return _v3.copy(a).addScaledVector(ab, t).distanceTo(p);
}
