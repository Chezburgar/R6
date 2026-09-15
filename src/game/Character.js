import * as THREE from 'three';
import { Assets } from '../core/Assets.js';
import { WeaponModels } from '../data/weapons.js';
import { healthFor } from '../data/operators.js';

// A Character is the shared body for the local player and bots: skinned operator model,
// animation state machine, procedural aiming/leaning/crouching, two-bone arm IK onto the
// held weapon, hitboxes for ballistics, health / DBNO / death.

const ARM_BONES = { left: ['LeftArm', 'LeftForeArm', 'LeftHand'], right: ['RightArm', 'RightForeArm', 'RightHand'] };
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _m = new THREE.Matrix4();

export const Stance = { STAND: 0, CROUCH: 1, PRONE: 2 };
export const EYE_HEIGHT = { 0: 1.62, 1: 1.08, 2: 0.42 };
export const BODY_HEIGHT = { 0: 1.78, 1: 1.25, 2: 0.55 };

function worldQuat(bone, out) { return bone.getWorldQuaternion(out); }
function setWorldQuat(bone, q) {
  // local = inverse(parentWorld) * q
  if (bone.parent) { bone.parent.getWorldQuaternion(_q2); _q2.invert(); bone.quaternion.copy(_q2).multiply(q); } else bone.quaternion.copy(q);
  bone.updateMatrixWorld(true);
}

export class Character {
  constructor(game, op, side, isPlayer = false) {
    this.game = game; this.op = op; this.side = side; this.isPlayer = isPlayer;
    this.name = op.name;
    this.maxHealth = healthFor(op); this.health = this.maxHealth;
    this.armorPlate = false; this.rookPlateMult = 1;
    this.alive = true; this.dbno = false; this.dbnoHealth = 0; this.dead = false;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.lean = 0; this.leanTarget = 0;
    this.stance = Stance.STAND; this.sprinting = false; this.ads = 0; this.moving = 0; this.speedNorm = 0;
    this.grounded = true;
    this.kills = 0; this.deaths = 0; this.assists = 0; this.score = 0;
    this.weapons = []; this.weaponIndex = 0;
    this.gadgetUses = 0; this.gadget2Uses = 0;
    this.stunned = 0; this.empd = 0; this.trapped = false; this.wire = 0; this.jammed = false;
    this.root = new THREE.Group(); this.root.name = 'char:' + op.id;
    this.lastHitBy = null; this.lastHitTime = 0; this.lastDamager = null;
    this.hitboxes = []; this._hbStale = true;
    this.visibleTP = true;
    this.footTimer = 0; this.surface = 'concrete';
    this.hasDefuser = false; this.planting = 0; this.interacting = null;
    this.scanned = 0; this.pingedUntil = 0;
    this.reviveProgress = 0; this.reviver = null;
    this.tags = new Set();
    this.lowReady = 0; this.lowReadyTarget = 0;   // 1 = weapon held at low-ready (idle), 0 = shouldered/aiming
    this._build();
  }

  _build() {
    const c = Assets.cloneSkinned(this.op.model);
    if (!c) { this.model = null; return; }
    this.model = c.scene; this.root.add(this.model);
    this.model.traverse(o => {
      if (o.isSkinnedMesh) {
        this.skinned = o; o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
        if (this.op.tint) { o.material = o.material.clone(); o.material.color.setHex(this.op.tint); }
      }
      if (o.isBone) this[`b_${o.name}`] = o;
    });
    this.bones = {}; this.model.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = {}; for (const a of c.animations) this.clips[a.name] = a;
    // strip root motion (hips XZ) from locomotion clips so the body stays under the controller
    for (const name of ['Walking', 'Running', 'Run_and_Shoot', 'restpose']) { const clip = this.clips[name]; if (!clip) continue; for (const t of clip.tracks) { if (t.name.endsWith('Hips.position')) { const v = t.values; for (let i = 0; i < v.length; i += 3) { v[i] = 0; v[i + 2] = v[i + 2] * 0; } } } }
    const act = (name, loop = true) => { const clip = this.clips[name]; if (!clip) return null; const a = this.mixer.clipAction(clip); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.enabled = true; return a; };
    this.actions = { idle: act('restpose'), walk: act('Walking'), run: act('Running'), vault: act('Jump_Over_Obstacle_2', false), dieF: act('Shot_and_Fall_Forward', false), dieB: act('Shot_in_the_Back_and_Fall', false), dieS: act('Side_Shot', false) };
    for (const k in this.actions) { const a = this.actions[k]; if (!a) continue; a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0); }
    if (this.actions.idle) { this.actions.idle.timeScale = 0; this.actions.idle.time = 0.03; }
    this.model.updateMatrixWorld(true);
    // rest-pose bone lengths
    this.boneLen = {};
    for (const side of ['left', 'right']) { const [u, l, h] = ARM_BONES[side].map(n => this.bones[n]); this.boneLen[side] = { upper: l.position.length(), lower: h.position.length() }; }
    this.legLen = { thigh: this.bones.LeftLeg.position.length(), shin: this.bones.LeftFoot.position.length() };
    this.hipsRestY = this.bones.Hips.position.y;
    this.restQuats = {}; for (const n in this.bones) this.restQuats[n] = this.bones[n].quaternion.clone();
    // third-person weapon holder
    this.weaponHolder = new THREE.Group(); this.root.add(this.weaponHolder);
    this.tpWeapon = null;
  }

  // ---------- weapons ----------
  setWeapons(list) { this.weapons = list; this.weaponIndex = 0; this._refreshTPWeapon(); }
  get weapon() { return this.weapons[this.weaponIndex]; }
  switchWeapon(i) { if (i === this.weaponIndex || !this.weapons[i]) return false; this.weaponIndex = i; this._refreshTPWeapon(); return true; }
  _refreshTPWeapon() {
    if (this.tpWeapon) { this.weaponHolder.remove(this.tpWeapon); this.tpWeapon = null; }
    const w = this.weapon; if (!w) return;
    const M = WeaponModels[w.def.model];
    const scene = Assets.cloneStatic(M.key);
    if (!scene) return;
    scene.scale.setScalar(M.scale);
    scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    this.tpWeapon = scene; this.weaponHolder.add(scene); this.tpModel = M;
    this.tpWeapon.visible = this.visibleTP;
  }

  // ---------- transforms ----------
  eyeHeight() { return EYE_HEIGHT[this.stance]; }
  bodyHeight() { return BODY_HEIGHT[this.stance]; }
  eyePos(out = new THREE.Vector3()) {
    out.copy(this.pos); out.y += this.eyeHeight();
    if (this.dbno) out.y = this.pos.y + 0.55;
    // lean shifts the head sideways
    if (this.lean) { const s = Math.sin(this.yaw), c = Math.cos(this.yaw); out.x -= c * this.lean * 0.55; out.z += s * this.lean * 0.55; }
    return out;
  }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  forwardFlat(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  right(out = new THREE.Vector3()) { return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  headPos(out = new THREE.Vector3()) { if (this.bones && this.bones.Head) { this.bones.Head.getWorldPosition(out); out.y += 0.06; return out; } return this.eyePos(out); }
  chestPos(out = new THREE.Vector3()) { if (this.bones && this.bones.Spine) { return this.bones.Spine.getWorldPosition(out); } out.copy(this.pos); out.y += 1.2; return out; }

  // ---------- per-frame body update ----------
  updateBody(dt, camera) {
    if (!this.model) return;
    this.lowReady += (this.lowReadyTarget - this.lowReady) * Math.min(1, dt * 6);
    this.root.position.copy(this.pos);
    // face movement/aim direction. Third person body faces aim yaw.
    this.root.rotation.set(0, this.yaw + Math.PI, 0);
    const A = this.actions;
    if (this.dead || this.dbno) {
      this.mixer.update(dt);
      if (this.dbno) { this._applyDBNO(dt); if (!this.reviver) { this.bleedT = (this.bleedT || 0) + dt; this.dbnoHealth -= dt * (20 / 45); if (this.dbnoHealth <= 0) this.die(this.lastDamager, null, false); } }
      this._placeWeapon(); this._armIK();
      this._hbStale = true;
      return;
    }
    // locomotion blend
    const sp = this.speedNorm; // 0..1 (1 = sprint)
    let wIdle = 1, wWalk = 0, wRun = 0;
    if (sp > 0.02) { if (sp < 0.55) { wWalk = sp / 0.55; wIdle = 1 - wWalk; } else { wRun = (sp - 0.55) / 0.45; wWalk = 1 - wRun; wIdle = 0; } }
    if (this.stance === Stance.PRONE) { wIdle = 1; wWalk = wRun = 0; }
    const k = Math.min(1, dt * 10);
    const blend = (a, w) => { if (a) a.setEffectiveWeight(a.getEffectiveWeight() + (w - a.getEffectiveWeight()) * k); };
    blend(A.idle, wIdle); blend(A.walk, wWalk); blend(A.run, wRun);
    if (A.walk) A.walk.timeScale = 0.9 + sp * 0.6; if (A.run) A.run.timeScale = 0.85 + sp * 0.35;
    if (this.vaulting) { blend(A.vault, 1); } else if (A.vault && A.vault.getEffectiveWeight() > 0) { blend(A.vault, 0); }
    this.mixer.update(dt);
    // procedural layers
    this._applyStance(dt);
    this._applyAim();
    this._placeWeapon();
    this._armIK();
    this.root.updateMatrixWorld(true);
    this._hbStale = true;
    // footsteps
    if (sp > 0.05 && this.grounded && this.stance !== Stance.PRONE) {
      this.footTimer -= dt * (0.7 + sp * 1.3) * (this.stance === Stance.CROUCH ? 0.7 : 1);
      if (this.footTimer <= 0) { this.footTimer = 0.5; this.game.audio.footstep(this.pos, this.surface, sp, this.isPlayer); this.game.noise && this.game.noise(this, sp > 0.6 ? 16 : 7); }
    } else this.footTimer = Math.min(this.footTimer, 0.2);
  }

  _applyStance(dt) {
    const B = this.bones; const hips = B.Hips;
    const targetDrop = this.stance === Stance.CROUCH ? 0.5 : this.stance === Stance.PRONE ? 0.65 : 0;
    this.crouchDrop = this.crouchDrop === undefined ? targetDrop : this.crouchDrop + (targetDrop - this.crouchDrop) * Math.min(1, dt * 9);
    const drop = this.crouchDrop;
    if (this.stance === Stance.PRONE) {
      // lie flat: pitch the whole model forward
      const t = Math.min(1, drop / 0.65);
      this.model.rotation.x = Math.PI / 2 * t; this.model.position.set(0, 0.22 * t, -0.9 * t);
      hips.position.y = this.hipsRestY;
      return;
    }
    this.model.rotation.x = 0; this.model.position.set(0, 0, 0);
    if (drop > 0.01) {
      hips.position.y = this.hipsRestY - drop;
      hips.position.z = -drop * 0.25;
      // leg IK: keep feet on the ground under the hips, knees forward
      this.model.updateMatrixWorld(true);
      for (const side of ['Left', 'Right']) {
        const up = B[side + 'UpLeg'], lo = B[side + 'Leg'], ft = B[side + 'Foot'];
        up.getWorldPosition(_v); // hip joint
        const footTarget = _v3.set(_v.x, this.pos.y + 0.08, _v.z);
        // knee hint: forward of the character
        const hint = _v2.copy(footTarget).addScaledVector(this.forwardFlat(new THREE.Vector3()), 1.5); hint.y += 0.6;
        this._twoBone(up, lo, ft, footTarget, hint, this.legLen.thigh, this.legLen.shin);
      }
    } else { hips.position.y = this.hipsRestY; hips.position.z = 0; }
  }

  _applyAim() {
    const B = this.bones;
    // distribute pitch across the spine, plus lean roll
    const pitch = this.pitch;
    const axisR = new THREE.Vector3(1, 0, 0); // model faces +Z: pitching up = rotate about +X negative
    const roll = -this.lean * 0.32;
    for (const [name, f] of [['Spine02', 0.25], ['Spine01', 0.3], ['Spine', 0.3], ['neck', 0.15]]) {
      const b = B[name]; if (!b) continue;
      _q.setFromAxisAngle(axisR, -pitch * f); b.quaternion.multiply(_q);
      if (roll) { _q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll * (name === 'neck' ? 0.4 : 0.35)); b.quaternion.multiply(_q); }
    }
    if (this.lean) { B.Hips.position.x = -this.lean * 0.12; }
    this.model.updateMatrixWorld(true);
  }

  _applyDBNO(dt) {
    // crawl pose: model lies on its side (end frame of Side_Shot), lowered
    this.model.rotation.x = 0; this.model.position.set(0, 0, 0);
  }

  // Weapon socket: in front of the chest, oriented along the aim direction.
  _placeWeapon() {
    if (!this.tpWeapon) return;
    const M = this.tpModel; const B = this.bones;
    // socket in root space: root rotation is yaw+PI, so root +Z = character forward and root -X = character right.
    const fwd = _v.set(0, 0, 1), right = _v2.set(-1, 0, 0);
    const chestY = this.dbno ? 0.45 : (this.stance === Stance.PRONE ? 0.45 : 1.32 - (this.crouchDrop || 0) * 0.85);
    const lr = this.lowReady;
    const pitch = this.dead ? 0 : this.pitch * (1 - lr) + (-0.55) * lr;
    const yawOff = 0.75 * lr;
    const pos = _v3.set(0, chestY, 0).addScaledVector(fwd, (0.22 - 0.08 * lr) * Math.cos(pitch)).addScaledVector(right, 0.16 - 0.1 * lr);
    pos.y += 0.22 * Math.sin(pitch) - 0.08 - 0.16 * lr;
    if (this.lean) { pos.x += this.lean * 0.12; }
    if (this.dead) { // drop weapon near hand
      this.weaponHolder.position.set(0.3, 0.05, 0.2); this.weaponHolder.rotation.set(0, 0.6, Math.PI / 2 * 0.9);
      this.tpWeapon.position.set(0, 0, 0); this.tpWeapon.rotation.set(0, Math.PI / 2, 0); return;
    }
    this.weaponHolder.position.copy(pos);
    // weapon model: muzzle at -X. We want muzzle along root -Z: rotate Y by -90deg? (-X → -Z requires rotation about Y by -90°: R_y(-90) maps (-1,0,0) to (0,0,-1)... R_y(θ): x' = x cosθ + z sinθ, z' = -x sinθ + z cosθ. For θ=-90°: x'= -z, z'= x. (-1,0,0) → (0,0,-1). ✓
    this.weaponHolder.rotation.set(0, 0, 0);
    this.weaponHolder.rotateY(yawOff);                        // low-ready: muzzle swings across the body
    this.weaponHolder.rotateX(-pitch * (this.dbno ? 0 : 1)); // pitch about the right axis (root -X)
    this.weaponHolder.rotateY(Math.PI / 2);                  // model muzzle (-X) -> root +Z (forward)
    this.tpWeapon.position.set(0, 0, 0); this.tpWeapon.rotation.set(0, 0, 0);
    if (M.adsPitch && this.ads > 0.5) this.tpWeapon.rotation.z = M.adsPitch * 0.5;
    this.weaponHolder.updateMatrixWorld(true);
  }

  // world-space grip points of the held weapon
  gripWorld(which, out) {
    const M = this.tpModel; const g = which === 'left' ? M.gripL : M.gripR;
    out.set(g[0], g[1], g[2]); return this.tpWeapon.localToWorld(out);
  }
  muzzleWorld(out = new THREE.Vector3()) { if (!this.tpWeapon) return this.eyePos(out); const M = this.tpModel; out.set(M.muzzle[0], M.muzzle[1], M.muzzle[2]); return this.tpWeapon.localToWorld(out); }

  _armIK() {
    if (!this.tpWeapon || !this.model) return;
    if (this.stance === Stance.PRONE && !this.dead) { /* keep animated */ }
    const B = this.bones;
    this.model.updateMatrixWorld(true);
    const fwd = this.forwardFlat(new THREE.Vector3()); const right = this.right(new THREE.Vector3());
    for (const side of ['left', 'right']) {
      const [uN, lN, hN] = ARM_BONES[side]; const up = B[uN], lo = B[lN], hand = B[hN];
      const target = this.gripWorld(side, new THREE.Vector3());
      if (this.dead) continue;
      // elbow hint: down and outward
      up.getWorldPosition(_v);
      const hint = new THREE.Vector3().copy(_v).addScaledVector(right, side === 'left' ? -0.6 : 0.8).addScaledVector(fwd, -0.2); hint.y -= 0.9;
      this._twoBone(up, lo, hand, target, hint, this.boneLen[side].upper, this.boneLen[side].lower);
      // hand orientation: point the hand (+Y toward child) along the weapon, palm inward
      const wq = this.tpWeapon.getWorldQuaternion(new THREE.Quaternion());
      const along = new THREE.Vector3(-1, 0, 0).applyQuaternion(wq);        // muzzle direction
      const wup = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
      let yAxis;
      if (side === 'right') yAxis = along.clone().multiplyScalar(0.35).addScaledVector(wup, -1).normalize();
      else yAxis = along.clone().multiplyScalar(1).addScaledVector(wup, -0.35).normalize();
      const zAxis = new THREE.Vector3().crossVectors(yAxis, side === 'left' ? wup.clone().negate() : wup).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
      _m.makeBasis(xAxis, yAxis, zAxis); _q.setFromRotationMatrix(_m);
      setWorldQuat(hand, _q);
    }
  }

  // Generic two-bone IK in world space.
  _twoBone(up, lo, end, target, hint, l1, l2) {
    const a = up.getWorldPosition(new THREE.Vector3()), b = lo.getWorldPosition(new THREE.Vector3()), c = end.getWorldPosition(new THREE.Vector3());
    const ws = up.getWorldScale(new THREE.Vector3()).x; l1 *= ws; l2 *= ws;
    const toT = new THREE.Vector3().subVectors(target, a); let d = toT.length(); if (d < 1e-4) return;
    d = Math.min(d, (l1 + l2) * 0.995); toT.normalize();
    const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const pole = new THREE.Vector3().subVectors(hint, a); pole.addScaledVector(toT, -pole.dot(toT)); if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0).addScaledVector(toT, toT.y); pole.normalize();
    const elbow = new THREE.Vector3().copy(a).addScaledVector(toT, l1 * cosA).addScaledVector(pole, l1 * sinA);
    // rotate upper
    const curU = new THREE.Vector3().subVectors(b, a).normalize(); const desU = new THREE.Vector3().subVectors(elbow, a).normalize();
    const uq = up.getWorldQuaternion(new THREE.Quaternion()); const dq = new THREE.Quaternion().setFromUnitVectors(curU, desU); uq.premultiply(dq); setWorldQuat(up, uq);
    // rotate lower
    lo.getWorldPosition(b); end.getWorldPosition(c);
    const curL = new THREE.Vector3().subVectors(c, b).normalize(); const desL = new THREE.Vector3().subVectors(target, b).normalize();
    const lq = lo.getWorldQuaternion(new THREE.Quaternion()); dq.setFromUnitVectors(curL, desL); lq.premultiply(dq); setWorldQuat(lo, lq);
  }

  // ---------- hitboxes ----------
  updateHitboxes() {
    if (!this._hbStale || !this.bones) return;
    this._hbStale = false;
    const B = this.bones; const hb = this.hitboxes; hb.length = 0;
    const P = n => B[n].getWorldPosition(new THREE.Vector3());
    const head = P('Head'); head.y += 0.07;
    hb.push({ zone: 'head', type: 'sphere', c: head, r: 0.135 });
    const hips = P('Hips'); const neck = P('neck');
    hb.push({ zone: 'torso', type: 'capsule', a: hips, b: neck, r: 0.21 });
    for (const s of ['Left', 'Right']) {
      hb.push({ zone: 'limb', type: 'capsule', a: P(s + 'Arm'), b: P(s + 'ForeArm'), r: 0.07 });
      hb.push({ zone: 'limb', type: 'capsule', a: P(s + 'ForeArm'), b: P(s + 'Hand'), r: 0.06 });
      hb.push({ zone: 'limb', type: 'capsule', a: P(s + 'UpLeg'), b: P(s + 'Leg'), r: 0.1 });
      hb.push({ zone: 'limb', type: 'capsule', a: P(s + 'Leg'), b: P(s + 'Foot'), r: 0.08 });
    }
    // coarse bounds
    this.boundsMin = new THREE.Vector3(Infinity, Infinity, Infinity); this.boundsMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const h of hb) { const pts = h.type === 'sphere' ? [h.c] : [h.a, h.b]; for (const p of pts) { this.boundsMin.min(p); this.boundsMax.max(p); } }
    this.boundsMin.subScalar(0.25); this.boundsMax.addScalar(0.25);
  }
  // ray test: returns {dist, zone, point} or null
  raycast(origin, dir, maxDist) {
    this.updateHitboxes();
    if (!this.boundsMin) return null;
    // slab test vs bounds
    let tmin = 0, tmax = maxDist;
    for (const k of ['x', 'y', 'z']) { const inv = 1 / (dir[k] || 1e-9); let t1 = (this.boundsMin[k] - origin[k]) * inv, t2 = (this.boundsMax[k] - origin[k]) * inv; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return null; }
    let best = null;
    for (const h of this.hitboxes) {
      let t = -1;
      if (h.type === 'sphere') t = raySphere(origin, dir, h.c, h.r); else t = rayCapsule(origin, dir, h.a, h.b, h.r);
      if (t >= 0 && t <= maxDist && (!best || t < best.dist)) best = { dist: t, zone: h.zone, point: new THREE.Vector3().copy(origin).addScaledVector(dir, t) };
    }
    return best;
  }

  // ---------- damage ----------
  takeDamage(amount, zone, attacker, dir, point, kind = 'bullet') {
    if (!this.alive || this.dead) return 0;
    let dmg = amount;
    if (zone === 'head' && kind === 'bullet') dmg = 9999;
    else if (zone === 'limb') dmg *= 0.75;
    if (this.armorPlate && zone !== 'head') dmg *= 0.8;
    if (this.dbno) {
      this.dbnoHealth -= dmg; this.lastDamager = attacker;
      if (this.dbnoHealth <= 0) this.die(attacker, dir, zone === 'head');
      return dmg;
    }
    this.health -= dmg; this.lastHitBy = attacker; this.lastHitTime = this.game.time; this.lastDamager = attacker;
    if (attacker && attacker !== this) { attacker.damageDealt = (attacker.damageDealt || 0) + Math.min(dmg, this.health + dmg); }
    if (this.health <= 0) {
      const lethal = (zone === 'head' && kind === 'bullet') || kind === 'explosion' && dmg > 90;
      if (this.armorPlate && zone !== 'head') { this.armorPlate = false; this.goDBNO(attacker, dir); }
      else if (lethal || kind === 'explosionKill') this.die(attacker, dir, zone === 'head');
      else this.goDBNO(attacker, dir);
    }
    this.onDamaged && this.onDamaged(dmg, attacker, dir, zone);
    return dmg;
  }
  goDBNO(attacker, dir) {
    if (this.dbno) return;
    this.dbno = true; this.dbnoHealth = 20; this.health = 0; this.dbnoTimer = 0; this.bleedT = 0;
    this.ads = 0; this.sprinting = false;
    this._playDeathAnim(dir, true);
    this.game.onDBNO && this.game.onDBNO(this, attacker);
  }
  revive() {
    if (!this.dbno || this.dead) return;
    this.dbno = false; this.health = 50; this.trapped = false;
    if (this.actions) { for (const k of ['dieF', 'dieB', 'dieS']) { const a = this.actions[k]; if (a) { a.setEffectiveWeight(0); a.stop(); } } if (this.actions.idle) { this.actions.idle.setEffectiveWeight(1); this.actions.idle.play(); } }
    this.game.onRevived && this.game.onRevived(this);
  }
  die(attacker, dir, headshot = false) {
    if (this.dead) return;
    this.dead = true; this.alive = false; this.health = 0; this.deaths++;
    const wasDBNO = this.dbno; this.dbno = false;
    if (!wasDBNO) this._playDeathAnim(dir, false);
    if (attacker && attacker !== this && attacker.side !== this.side) { attacker.kills++; attacker.score += 100; }
    this.game.onDeath && this.game.onDeath(this, attacker, headshot);
  }
  _playDeathAnim(dir, dbno) {
    if (!this.actions) return;
    const fwd = this.forwardFlat(new THREE.Vector3());
    let key = 'dieB';
    if (dir) { const d = fwd.dot(dir); const r = this.right(new THREE.Vector3()).dot(dir); if (Math.abs(r) > 0.7) key = 'dieS'; else if (d > 0) key = 'dieB'; else key = 'dieF'; }
    if (dbno) key = 'dieS';
    for (const k of ['idle', 'walk', 'run', 'vault']) { const a = this.actions[k]; if (a) a.setEffectiveWeight(0); }
    const a = this.actions[key]; if (a) { a.reset(); a.setEffectiveWeight(1); a.timeScale = dbno ? 1.4 : 1.15; a.play(); }
  }

  reset(pos, yaw) {
    this.alive = true; this.dead = false; this.dbno = false; this.health = this.maxHealth; this.armorPlate = false;
    this.pos.copy(pos); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.lean = 0; this.stance = Stance.STAND; this.ads = 0; this.speedNorm = 0; this.sprinting = false;
    this.stunned = 0; this.empd = 0; this.trapped = false; this.wire = 0; this.hasDefuser = false; this.planting = 0; this.interacting = null; this.scanned = 0; this.pingedUntil = 0; this.vaulting = false;
    this.gadgetUses = 0; this.gadget2Uses = 0; this.reviveProgress = 0; this.tags.clear();
    if (this.actions) { for (const k in this.actions) { const a = this.actions[k]; if (!a) continue; a.stop(); a.reset(); a.setEffectiveWeight(k === 'idle' ? 1 : 0); a.play(); } if (this.actions.idle) { this.actions.idle.timeScale = 0; this.actions.idle.time = 0.03; } }
    for (const w of this.weapons) w.reset();
    this.weaponIndex = 0; this._refreshTPWeapon();
  }
  setVisible(v) { this.visibleTP = v; if (this.model) this.model.visible = v; if (this.tpWeapon) this.tpWeapon.visible = v; }
}

function raySphere(o, d, c, r) {
  const oc = _v.subVectors(o, c); const b = oc.dot(d); const cc = oc.dot(oc) - r * r; const disc = b * b - cc; if (disc < 0) return -1; const t = -b - Math.sqrt(disc); return t >= 0 ? t : (-b + Math.sqrt(disc) >= 0 ? 0 : -1);
}
function rayCapsule(o, d, a, b, r) {
  // sample closest approach along the segment (robust & cheap): test sphere at closest segment point iteratively
  const ab = _v.subVectors(b, a); const len = ab.length(); if (len < 1e-5) return raySphere(o, d, a, r); ab.divideScalar(len);
  // solve for t along ray minimizing distance to the segment
  const ao = _v2.subVectors(o, a);
  const dDotAb = d.dot(ab); const aoDotAb = ao.dot(ab); const aoDotD = ao.dot(d);
  const denom = 1 - dDotAb * dDotAb;
  let t, s;
  if (Math.abs(denom) < 1e-6) { t = -aoDotD; s = aoDotAb; } else { t = (dDotAb * aoDotAb - aoDotD) / denom; s = aoDotAb + t * dDotAb; }
  s = Math.max(0, Math.min(len, s));
  const c = _v3.copy(a).addScaledVector(ab, s);
  return raySphere(o, d, c, r);
}
