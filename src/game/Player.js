import * as THREE from 'three';
import { Input } from '../core/Input.js';
import { Assets } from '../core/Assets.js';
import { Character, Stance, EYE_HEIGHT, BODY_HEIGHT } from './Character.js';
import { WeaponModels } from '../data/weapons.js';
import { speedFor } from '../data/operators.js';
import { getSprite } from '../map/Materials.js';

// Local player: first-person controller, view model (weapon + operator arms), sights and
// the picture-in-picture scope, rappel, vault, interactions and the preparation-phase drone.

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const VM_LAYER = 1;
const HW = 0.26;
const ARM_BONE_IDS = [9, 10, 11, 12, 14, 15, 16, 17];

const SCOPE_VERT = `varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const SCOPE_FRAG = `
uniform sampler2D uTex; uniform vec2 uRes; uniform vec2 uCenter; uniform float uLensPx; uniform float uAlign; uniform float uReticle;
void main(){
  vec2 px = gl_FragCoord.xy; vec2 d = (px - uCenter) / uLensPx;      // -0.5..0.5 across lens
  vec2 uv = 0.5 + d * 0.96;
  vec3 col = texture2D(uTex, clamp(uv, 0.001, 0.999)).rgb;
  float r = length(d) * 2.0;
  // chromatic edge
  float ca = smoothstep(0.55, 1.0, r) * 0.006;
  col.r = texture2D(uTex, clamp(uv + vec2(ca, 0.0), 0.001, 0.999)).r; col.b = texture2D(uTex, clamp(uv - vec2(ca, 0.0), 0.001, 0.999)).b;
  // vignette + misalignment shadow
  float vig = 1.0 - smoothstep(0.72, 1.02, r + uAlign * 0.6);
  col *= vig;
  // reticle: fine crosshair with centre dot and mil posts
  vec2 sc = (px - uRes * 0.5);
  float line = 0.0;
  float t = 1.1;
  if (abs(sc.y) < t && abs(sc.x) > 6.0 && abs(sc.x) < uLensPx * 0.42) line = 1.0;
  if (abs(sc.x) < t && abs(sc.y) > 6.0 && abs(sc.y) < uLensPx * 0.42) line = 1.0;
  if (abs(sc.y) < 5.0 && abs(sc.x) < 1.2 && sc.y < 0.0) line = 1.0; // small post
  float dot = 1.0 - smoothstep(1.2, 2.4, length(sc));
  vec3 ret = mix(vec3(0.02), vec3(1.0, 0.15, 0.1), dot);
  col = mix(col, ret, max(line * uReticle, dot * uReticle));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Player {
  constructor(game, op, side) {
    this.game = game; this.op = op; this.side = side;
    this.char = new Character(game, op, side, true);
    this.char.onDamaged = (dmg, attacker, dir) => this.onDamaged(dmg, attacker, dir);
    this.camera = game.camera;
    this.sens = 0.0022; this.adsSensMult = 0.75;
    this.vmFov = 55;
    this.yaw = 0; this.pitch = 0;
    this.recoilPitch = 0; this.recoilYaw = 0; this.recoilVel = 0;
    this.adsBlend = 0; this.sprintBlend = 0; this.lowerBlend = 1;
    this.bobT = 0; this.sway = new THREE.Vector2(); this.swayVel = new THREE.Vector2();
    this.kickPos = new THREE.Vector3(); this.kickRot = new THREE.Vector3();
    this.vel = new THREE.Vector3(); this.grounded = true;
    this.crouchToggle = false; this.proneToggle = false;
    this.interaction = null; this.interactT = 0; this.interactDur = 0;
    this.melee = 0; this.vault = null; this.rappel = null;
    this.drone = null; this.usingDrone = false;
    this.gadgetMode = false; this.gadget2Mode = false;
    this.switchT = 0; this.pendingWeapon = -1;
    this.dead = false;
    this.headBob = new THREE.Vector3();
    this.camShake = 0; this.landBump = 0; this.fovKick = 0;
    this.stunVision = 0; this.lastStep = 0;
    this._buildViewModel();
    this._buildArms();
    this._buildScope();
  }

  // ---------- view model ----------
  _buildViewModel() {
    this.vm = new THREE.Group(); this.vm.name = 'viewmodel'; this.camera.add(this.vm);
    this.vmWeapons = new Map();
    this.redDot = new THREE.Sprite(new THREE.SpriteMaterial({ map: getSprite('reticleDot'), color: 0xff3020, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.redDot.scale.setScalar(0.012); this.redDot.layers.set(VM_LAYER); this.redDot.renderOrder = 40; this.redDot.visible = false; this.camera.add(this.redDot);
  }
  _vmFor(w) {
    if (this.vmWeapons.has(w.id)) return this.vmWeapons.get(w.id);
    const M = WeaponModels[w.def.model];
    const scene = Assets.cloneStatic(M.key);
    const g = new THREE.Group(); g.add(scene); scene.scale.setScalar(M.scale);
    scene.traverse(o => { if (o.isMesh) { o.layers.set(VM_LAYER); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });
    g.userData.model = M; g.userData.inner = scene; g.visible = false; this.vm.add(g);
    // scope lens
    if (M.scope) {
      const lens = new THREE.Mesh(new THREE.CircleGeometry(M.scope.radius, 40), this.scopeMat);
      lens.position.set(M.scope.lens[0], M.scope.lens[1], M.scope.lens[2]); lens.rotation.y = Math.PI / 2; lens.layers.set(VM_LAYER); lens.renderOrder = 35; lens.frustumCulled = false;
      scene.add(lens); g.userData.lens = lens; lens.visible = false;
      // glass cover on objective for reflections
      const obj = new THREE.Mesh(new THREE.CircleGeometry(M.scope.radius * 1.1, 32), new THREE.MeshPhysicalMaterial({ color: 0x224466, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35 }));
      obj.position.set(M.scope.objective[0], M.scope.objective[1], M.scope.objective[2]); obj.rotation.y = -Math.PI / 2; obj.layers.set(VM_LAYER); scene.add(obj);
    }
    this.vmWeapons.set(w.id, g);
    return g;
  }
  _buildScope() {
    this.scopeRT = new THREE.WebGLRenderTarget(1024, 1024, { samples: 2 });
    this.scopeRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.scopeCam = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
    this.scopeMat = new THREE.ShaderMaterial({ vertexShader: SCOPE_VERT, fragmentShader: SCOPE_FRAG, uniforms: { uTex: { value: this.scopeRT.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uCenter: { value: new THREE.Vector2() }, uLensPx: { value: 100 }, uAlign: { value: 0 }, uReticle: { value: 1 } } });
    this.scopeMat.toneMapped = false;
  }
  setScopeRes(n) { if (this.scopeRT.width === n) return; this.scopeRT.setSize(n, n); }
  _buildArms() {
    const c = Assets.cloneSkinned(this.op.model); if (!c) return;
    this.arms = c.scene; this.arms.name = 'fparms';
    this.arms.traverse(o => {
      if (o.isSkinnedMesh) {
        o.layers.set(VM_LAYER); o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true;
        const mat = o.material.clone(); if (this.op.tint) mat.color.setHex(this.op.tint);
        mat.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vArm;')
            .replace('#include <skinbase_vertex>', '#include <skinbase_vertex>\n{ float a = 0.0; vec4 si = skinIndex; vec4 sw = skinWeight;\n' + ARM_BONE_IDS.map(id => `a += (abs(si.x-${id}.0)<0.5?sw.x:0.0)+(abs(si.y-${id}.0)<0.5?sw.y:0.0)+(abs(si.z-${id}.0)<0.5?sw.z:0.0)+(abs(si.w-${id}.0)<0.5?sw.w:0.0);`).join('\n') + '\nvArm = a; }');
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vArm;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vArm < 0.55) discard;');
        };
        mat.customProgramCacheKey = () => 'fparms';
        o.material = mat; this.armsMesh = o;
      }
    });
    this.armBones = {}; this.arms.traverse(o => { if (o.isBone) this.armBones[o.name] = o; });
    this.armMixer = new THREE.AnimationMixer(this.arms);
    const clip = c.animations.find(a => a.name === 'restpose'); if (clip) { const a = this.armMixer.clipAction(clip); a.play(); a.timeScale = 0; a.time = 0.03; this.armMixer.update(0.01); }
    this.armLen = { left: { upper: this.armBones.LeftForeArm.position.length(), lower: this.armBones.LeftHand.position.length() }, right: { upper: this.armBones.RightForeArm.position.length(), lower: this.armBones.RightHand.position.length() } };
    this.game.scene.add(this.arms);
    this.arms.visible = false;
  }

  setWeapons(ws) { this.char.setWeapons(ws); for (const w of ws) this._vmFor(w); this._showWeapon(); }
  _showWeapon() { for (const [, g] of this.vmWeapons) g.visible = false; const w = this.char.weapon; if (w) this._vmFor(w).visible = true; }

  // ---------- spawn / state ----------
  spawn(pos, yaw) {
    this.char.reset(pos, yaw); this.yaw = yaw; this.pitch = 0; this.vel.set(0, 0, 0); this.dead = false; this.recoilPitch = this.recoilYaw = 0; this.adsBlend = 0;
    this.crouchToggle = false; this.proneToggle = false; this.interaction = null; this.rappel = null; this.vault = null; this.usingDrone = false; this.gadgetMode = false; this.gadget2Mode = false;
    this.char.setVisible(false); this._showWeapon();
    if (this.arms) this.arms.visible = true;
  }

  get alive() { return this.char.alive && !this.char.dead; }

  // ---------- main update ----------
  update(dt) {
    const C = this.char; const g = this.game;
    C.stunned = Math.max(0, C.stunned - dt);
    if (this.drone) { this.drone.mesh.visible = !this.usingDrone; if (!this.usingDrone) this.drone.update(dt, false); }
    if (this.usingDrone && this.drone) { this.drone.update(dt); this._placeCameraDrone(); this._hideVM(true); return; }
    if (this.usingCam && this.camView && !C.dead && !C.dbno) { this._camUpdate(dt); this._hideVM(true); return; }
    if (this.usingCam) this.exitCam();
    this._hideVM(false);
    if (C.dead) { this._deadCamera(dt); return; }
    // --- look ---
    const w = C.weapon;
    const zoom = w ? (this.adsBlend > 0.5 ? (w.def.zoom > 1 ? w.def.zoom * 0.54 : 1.0) : 1) : 1;
    let sens = this.sens * (this.adsBlend > 0.5 ? this.adsSensMult / Math.max(1, zoom) : 1);
    if (C.stunned > 0) sens *= 0.4;
    if (!C.dbno && !this.interaction) {
      this.yaw -= Input.mouse.dx * sens; this.pitch -= Input.mouse.dy * sens * (this.invertY ? -1 : 1);
      this.swayVel.x += -Input.mouse.dx * 0.00035; this.swayVel.y += -Input.mouse.dy * 0.00035;
    }
    if (this.rappel) {
      // yaw clamp toward the wall
      const base = Math.atan2(-this.rappel.normal.x, -this.rappel.normal.z); // facing into the wall
      let d = this.yaw - base; d = Math.atan2(Math.sin(d), Math.cos(d)); d = Math.max(-1.5, Math.min(1.5, d)); this.yaw = base + d;
    }
    // floor work (planting / defusing): the view settles onto the device
    if (this.interaction && this.interaction.crouch && this.interaction.hand) { const hp = this.interaction.hand(_v3); const dx = hp.x - this.camera.position.x, dy = hp.y - this.camera.position.y, dz = hp.z - this.camera.position.z; const wantYaw = Math.atan2(-dx, -dz); let dyaw = wantYaw - this.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); this.yaw += dyaw * Math.min(1, dt * 6); const wantPitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)) + 0.15, -1.0, 0.1); this.pitch = THREE.MathUtils.damp(this.pitch, wantPitch, 6, dt); }
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    // recoil recovery
    const rec = w ? w.def.recoil.rec : 20;
    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, rec * 0.35, dt);
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, rec * 0.35, dt);
    C.yaw = this.yaw + this.recoilYaw; C.pitch = this.pitch + this.recoilPitch;

    // --- stance & movement ---
    if (!C.dbno && !this.rappel && !this.vault) this._stances(dt); else if (this.rappel) { C.stance = Stance.STAND; }
    if (this.rappel) this._rappelMove(dt); else if (this.vault) this._vaultMove(dt); else this._move(dt);

    // --- weapons / actions ---
    if (!C.dbno) this._actions(dt); else this._dbnoUpdate(dt);
    for (const wp of C.weapons) wp.update(dt);
    this._interactions(dt);

    // --- camera & view model ---
    this._placeCamera(dt);
    this._updateViewModel(dt);
    C.updateBody(dt, this.camera);
    if (this.arms) this._updateArms(dt);
    C.setVisible(false);
  }

  _stances(dt) {
    const C = this.char;
    if (this.interaction && this.interaction.crouch) { if (C.stance === Stance.STAND) this._tryStance(Stance.CROUCH); }
    else if (Input.hit('crouch')) { if (C.stance === Stance.CROUCH) this._tryStance(Stance.STAND); else this._tryStance(Stance.CROUCH); }
    if (Input.hit('prone')) { if (C.stance === Stance.PRONE) this._tryStance(Stance.CROUCH); else this._tryStance(Stance.PRONE); }
    const wantSprint = Input.down('sprint') && C.stance === Stance.STAND && !Input.aim() && (Input.down('forward')) && !this.interaction && !C.trapped;
    C.sprinting = wantSprint;
    // lean
    const lt = (C.sprinting || this.adsBlend < 0.35 || this.gadgetMode || this.gadget2Mode) ? 0 : (Input.down('leanL') ? 1 : 0) - (Input.down('leanR') ? 1 : 0);
    C.leanTarget = lt; C.lean = THREE.MathUtils.damp(C.lean, lt, 14, dt);
  }
  _tryStance(s) {
    const C = this.char; const h = BODY_HEIGHT[s];
    if (h > BODY_HEIGHT[C.stance]) {
      _v.set(C.pos.x - HW + 0.02, C.pos.y + 0.05, C.pos.z - HW + 0.02); _v2.set(C.pos.x + HW - 0.02, C.pos.y + h, C.pos.z + HW - 0.02);
      if (this.game.world.overlaps(_v, _v2)) return false;
    }
    C.stance = s; return true;
  }

  _move(dt) {
    const C = this.char; const W = this.game.world;
    const speedBase = 3.2 * speedFor(this.op);
    let speed = speedBase;
    if (C.sprinting) speed *= 1.55; if (C.stance === Stance.CROUCH) speed *= 0.5; if (C.stance === Stance.PRONE) speed *= 0.28;
    if (this.adsBlend > 0.3) speed *= 0.62; if (this.interaction) speed = 0; if (C.trapped) speed = 0; if (C.wire > 0) speed *= 0.5; if (C.dbno) speed = 1.0;
    if (C.stunned > 0) speed *= 0.7;
    const f = (Input.down('forward') ? 1 : 0) - (Input.down('back') ? 1 : 0), r = (Input.down('right') ? 1 : 0) - (Input.down('left') ? 1 : 0);
    const fwd = C.forwardFlat(_v), right = C.right(_v2);
    const wish = _v3.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, r);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    if (C.sprinting && f <= 0) C.sprinting = false;
    const accel = this.grounded ? 26 : 4;
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wish.x, accel * 0.45, dt); this.vel.z = THREE.MathUtils.damp(this.vel.z, wish.z, accel * 0.45, dt);
    this.vel.y -= 22 * dt;
    if (this.vel.y < -25) this.vel.y = -25;
    const h = C.dbno ? 0.6 : BODY_HEIGHT[C.stance];
    const delta = _v.set(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    const res = W.moveBox(C.pos, HW, h, delta, 0.42, c => !(c.tag === 'gadget' && !c.solid));
    if (res.grounded) { if (!this.grounded && this.vel.y < -6) this.landBump = Math.min(1, -this.vel.y / 14); this.vel.y = Math.max(this.vel.y, 0); }
    this.grounded = res.grounded; C.grounded = res.grounded; C.surface = res.groundMat || 'concrete';
    const sp = Math.hypot(this.vel.x, this.vel.z);
    C.speedNorm = Math.min(1, sp / (speedBase * 1.55)); C.moving = sp > 0.2 ? 1 : 0;
    // vault
    if (Input.hit('jump') && this.grounded && !C.dbno && C.stance !== Stance.PRONE && !this.interaction) this._tryVault();
    // rappel attach
    if (Input.hit('interact') && this.side === 'atk' && !this.interaction && !C.dbno && this.grounded) {
      const r = this.game.level.findRappelWall(C.pos, C.forwardFlat(_v));
      if (r && !this.game.level.isInterior(C.pos)) { this._startRappel(r); }
    }
    // out of bounds safety
    if (C.pos.y < -5) { C.pos.y = 0.1; this.vel.set(0, 0, 0); }
    this.bobT += dt * (C.sprinting ? 9.5 : 7.5) * (sp > 0.3 ? 1 : 0);
  }

  _tryVault() {
    const C = this.char; const W = this.game.world;
    const fwd = C.forwardFlat(new THREE.Vector3());
    // obstacle in front between knee and chest height?
    const o = C.pos.clone(); o.y += 0.5;
    const h = W.raycast(o, fwd, 1.1, { filter: c => c.solid });
    if (!h) return false;
    const top = h.collider.max.y; const height = top - C.pos.y;
    if (height < 0.35 || height > 1.35) return false;
    // landing spot beyond: check clearance over the obstacle
    const land = C.pos.clone().addScaledVector(fwd, h.dist + 0.9);
    _v.set(land.x - HW + 0.02, top + 0.05, land.z - HW + 0.02); _v2.set(land.x + HW - 0.02, top + 1.2, land.z + HW - 0.02);
    if (W.overlaps(_v, _v2)) return false;
    const groundY = W.groundAt(land.x, top + 0.5, land.z, 4);
    if (groundY === null) return false;
    land.y = groundY;
    this.vault = { start: C.pos.clone(), mid: new THREE.Vector3(C.pos.x + fwd.x * (h.dist + 0.35), top + 0.05, C.pos.z + fwd.z * (h.dist + 0.35)), end: land, t: 0, dur: 0.55 + height * 0.35 };
    C.vaulting = true; C.sprinting = false;
    return true;
  }
  _vaultMove(dt) {
    const v = this.vault; const C = this.char; v.t += dt; const k = Math.min(1, v.t / v.dur);
    if (k < 0.5) { const s = k / 0.5; C.pos.lerpVectors(v.start, v.mid, s); C.pos.y = v.start.y + (v.mid.y - v.start.y) * Math.sin(s * Math.PI / 2); }
    else { const s = (k - 0.5) / 0.5; C.pos.lerpVectors(v.mid, v.end, s); C.pos.y = v.mid.y + (v.end.y - v.mid.y) * (s * s); }
    C.speedNorm = 0.5;
    if (k >= 1) { this.vault = null; C.vaulting = false; this.vel.set(0, 0, 0); }
  }

  _startRappel(r) {
    const C = this.char; const w = r.wall;
    // snap to wall face
    const n = r.normal;
    const face = w.horizontal ? w.z0 + n.z * (w.t / 2 + 0.45) : w.x0 + n.x * (w.t / 2 + 0.45);
    if (w.horizontal) C.pos.z = face; else C.pos.x = face;
    this.rappel = { wall: w, normal: n.clone(), face, inverted: false };
    this.yaw = Math.atan2(-(-n.x), -(-n.z)); // face into wall: forward = -n
    this.yaw = Math.atan2(n.x, n.z); // forward(-sin yaw, -cos yaw) = -n
    C.stance = Stance.STAND; this.vel.set(0, 0, 0);
    this.game.hud && this.game.hud.toast('RAPPELLING — F TO DETACH, SPACE TO ENTER');
  }
  _rappelMove(dt) {
    const C = this.char; const R = this.rappel; const w = R.wall; const W = this.game.world;
    const up = (Input.down('forward') ? 1 : 0) - (Input.down('back') ? 1 : 0);
    const side = (Input.down('right') ? 1 : 0) - (Input.down('left') ? 1 : 0);
    const sp = 1.6;
    // along-wall axis
    const along = w.horizontal ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const rightDir = C.right(_v); const sgn = Math.sign(rightDir.dot(along)) || 1;
    const d = new THREE.Vector3().copy(along).multiplyScalar(side * sgn * sp * dt); d.y = up * sp * dt;
    const maxY = w.y0 + w.h + 3.2 + 0.4, minY = 0.05;
    const nextY = Math.max(minY, Math.min(maxY, C.pos.y + d.y));
    const a0 = w.horizontal ? w.x0 + 0.4 : w.z0 + 0.4, a1 = w.horizontal ? w.x1 - 0.4 : w.z1 - 0.4;
    const nextA = Math.max(a0, Math.min(a1, (w.horizontal ? C.pos.x : C.pos.z) + (w.horizontal ? d.x : d.z)));
    if (w.horizontal) C.pos.x = nextA; else C.pos.z = nextA;
    C.pos.y = nextY; C.speedNorm = (Math.abs(up) + Math.abs(side)) > 0 ? 0.3 : 0; C.grounded = true;
    // window entry: an opening at this height on this wall?
    const slot = this.game.level.barricadeSlots.find(s => s.exterior && Math.abs((w.horizontal ? s.x : s.z) - nextA) < s.w / 2 + 0.3 && C.pos.y + 1.2 > s.y && C.pos.y + 1.2 < s.y + s.h + 0.4 && Math.abs((w.horizontal ? s.z : s.x) - (w.horizontal ? w.z0 : w.x0)) < 0.5);
    this.rappelSlot = slot && !slot.barricade.alive() ? slot : null;
    if (this.rappelSlot) this.game.hud.prompt('SPACE', 'ENTER THROUGH WINDOW'); else this.game.hud.prompt('F', 'DETACH');
    if (Input.hit('jump') && this.rappelSlot) {
      const s = this.rappelSlot; const inward = R.normal.clone().negate();
      C.pos.set(s.x + inward.x * 1.0, s.y + 0.02, s.z + inward.z * 1.0);
      const gy = W.groundAt(C.pos.x, C.pos.y + 1, C.pos.z, 4); if (gy !== null) C.pos.y = gy;
      this.rappel = null; this.vel.set(0, 0, 0); return;
    }
    if (Input.hit('interact')) { this.rappel = null; this.vel.set(0, 0, 0); if (w.horizontal) C.pos.z += R.normal.z * 0.3; else C.pos.x += R.normal.x * 0.3; }
    if (nextY <= minY + 0.01 && up < 0) { this.rappel = null; }
  }

  // ---------- actions ----------
  _actions(dt) {
    const C = this.char; const w = C.weapon; const g = this.game;
    if (this.interaction) return;
    // weapon switching
    if (Input.hit('slot1')) this._switchTo(0);
    if (Input.hit('slot2')) this._switchTo(1);
    if (Input.mouse.wheel) this._switchTo(C.weaponIndex === 0 ? 1 : 0);
    if (Input.hit('slot3')) { this.gadgetMode = !this.gadgetMode; this.gadget2Mode = false; g.gadgets.onEquip(C, this.gadgetMode ? 'primary' : null); this.adsBlend = 0; this.game.audio.click('hover'); }
    if (Input.hit('slot4') || Input.hit('gadget')) { this.gadget2Mode = !this.gadget2Mode; this.gadgetMode = false; g.gadgets.onEquip(C, this.gadget2Mode ? 'secondary' : null); this.adsBlend = 0; this.game.audio.click('hover'); }
    if (this.switchT > 0) { this.switchT -= dt; if (this.switchT <= 0 && this.pendingWeapon >= 0) { C.switchWeapon(this.pendingWeapon); this.pendingWeapon = -1; this._showWeapon(); } }
    if (!w) return;
    // ADS
    const wantAds = Input.aim() && !C.sprinting && !this.gadgetMode && !this.gadget2Mode && !w.reloading && this.switchT <= 0 && this.melee <= 0 && !C.trapped;
    const adsSpeed = 1 / Math.max(0.12, w.def.ads);
    this.adsBlend = THREE.MathUtils.clamp(this.adsBlend + (wantAds ? 1 : -1.3) * dt * adsSpeed, 0, 1);
    C.ads = this.adsBlend;
    if (Input.hit('reload') && !this.gadgetMode && !this.gadget2Mode) { if (w.startReload()) g.audio.reload(w.isShotgun && !w.def.magReload ? 'shotgun' : (w.reloadEmpty ? 'empty' : 'tactical'), C.pos, true, w.reloadTotal); }
    if (Input.hit('fireMode') && w.cycleMode()) { g.audio.click('ui'); g.hud.toast(w.mode.toUpperCase() + ' FIRE'); }
    if (Input.hit('melee') && this.melee <= 0) this._melee();
    if (this.melee > 0) { this.melee -= dt; if (this.melee < 0.36 && !this._meleeHit) { this._meleeHit = true; this._meleeResolve(); } }
    // gadgets
    if (this.gadgetMode || this.gadget2Mode) { g.gadgets.playerUse(this, this.gadgetMode ? 'primary' : 'secondary', dt); return; }
    // fire
    const firing = w.auto ? Input.fire() : Input.fireHit();
    const prepLock = g.match.phase === 'prep' && this.side === 'atk';
    if (firing && !prepLock && this.melee <= 0 && this.switchT <= 0 && !C.sprinting && !C.trapped) {
      if (w.reloading && w.isShotgun) w.interruptReload();
      const origin = this.camera.getWorldPosition(_v); const dir = this.camera.getWorldDirection(_v2);
      const moving = C.speedNorm > 0.15;
      const fired = w.tryFire(g, origin, dir, { ads: this.adsBlend > 0.6, moving, stance: C.stance, viewmodel: true });
      if (fired) this._onShot(w);
    } else if (Input.fire() && C.sprinting) { C.sprinting = false; }
  }
  _switchTo(i) {
    const C = this.char; if (!C.weapons[i]) return;
    const gadgetOut = this.gadgetMode || this.gadget2Mode;
    if (gadgetOut) { this.gadgetMode = this.gadget2Mode = false; this.game.gadgets.onEquip(C, null); }
    if (this.switchT > 0) { this.pendingWeapon = i === C.weaponIndex ? -1 : i; return; }   // re-target or cancel a swap in progress
    if (i === C.weaponIndex) { if (gadgetOut) { this.switchT = 0.25; this.pendingWeapon = -1; this.game.audio.click('hover'); } return; }
    this.pendingWeapon = i; this.switchT = 0.42; this.adsBlend = 0; this.game.audio.click('hover');
    if (C.weapon) C.weapon.interruptReload();
  }
  _onShot(w) {
    const g = this.game; const C = this.char;
    // camera recoil
    this.recoilPitch += w.kick.v * Math.PI / 180; this.recoilYaw += w.kick.h * Math.PI / 180;
    this.kickPos.z += 0.028 * (w.isShotgun ? 2.2 : 1) * (w.def.cls === 'pistol' ? 0.8 : 1); this.kickRot.x += 0.05 * (w.isShotgun ? 2 : 1); this.kickRot.z += (Math.random() - 0.5) * 0.02;
    this.camShake = Math.min(1, this.camShake + 0.25);
    // effects at the muzzle
    const M = WeaponModels[w.def.model]; const vmg = this._vmFor(w); const inner = vmg.userData.inner;
    const mz = _v.set(M.muzzle[0], M.muzzle[1], M.muzzle[2]); inner.localToWorld(mz);
    const dir = this.camera.getWorldDirection(_v2);
    g.effects.muzzleFlash(mz, dir, w.def.flash, true);
    const ej = _v3.set(M.eject[0], M.eject[1], M.eject[2]); inner.localToWorld(ej);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    if (!w.isShotgun || w.def.modes[0] === 'semi') g.effects.shellEject(ej, right, up, dir);
    g.audio.gunshot({ cal: w.def.cal }, C.pos, true);
    g.noise && g.noise(C, 60);
    g.onPlayerShot && g.onPlayerShot(w);
  }
  _melee() {
    this.melee = 0.55; this._meleeHit = false; this.adsBlend = 0; this.game.audio.melee(this.char.pos, false);
  }
  _meleeResolve() {
    const g = this.game; const C = this.char;
    const origin = this.camera.getWorldPosition(_v); const dir = this.camera.getWorldDirection(_v2);
    // enemies first
    let best = null;
    for (const ch of g.characters) { if (ch === C || ch.dead) continue; const r = ch.raycast(origin, dir, 1.7); if (r && (!best || r.dist < best.r.dist)) best = { ch, r }; }
    if (best) { best.ch.takeDamage(best.ch.dbno ? 200 : 100, 'torso', C, dir, best.r.point, 'melee'); g.audio.melee(best.r.point, true, 'flesh'); g.effects.bloodHit(best.r.point, dir); return; }
    const h = g.world.raycast(origin, dir, 1.8, { filter: c => c.solid || c.tag === 'glass' || c.tag === 'gadget' || c.tag === 'barricade' });
    if (h) {
      if (h.collider.tag === 'gadget' && h.collider.owner && h.collider.owner.onMelee) { h.collider.owner.onMelee(C); g.audio.melee(h.point, true, 'metal'); return; }
      const res = g.level.melee(h, g.effects); g.audio.melee(h.point, true, h.collider.material); g.effects.impact(h.point, h.normal, h.collider.material);
      if (res === 'wall') g.effects.wallDebris(h.point, h.normal);
    }
  }
  _dbnoUpdate(dt) {
    const C = this.char; C.ads = 0; this.adsBlend = 0;
    C.dbnoTimer += dt;
  }

  // ---------- interactions (F) ----------
  _interactions(dt) {
    const C = this.char; const g = this.game; const hud = g.hud;
    if (this.interaction) {
      this.interactT += dt; hud.progress(this.interactT / this.interactDur, this.interaction.label);
      if (this.interaction.progress) this.interaction.progress(Math.min(1, this.interactT / this.interactDur), dt);
      const ok = Input.down('interact') || this.interaction.sticky;
      if (!ok || C.dead || C.dbno) { this._cancelInteraction(); return; }
      if (this.interactT >= this.interactDur) { const it = this.interaction; this.interaction = null; hud.progress(-1); it.done(); }
      return;
    }
    if (C.dead || this.rappel || this.usingDrone) return;
    const opts = g.getInteractions(C, this.camera);
    hud.prompt(null);
    if (!opts.length) return;
    const it = opts[0];
    hud.prompt('F', it.label + (it.dur ? '' : ''));
    if (Input.hit('interact') && !C.dbno) {
      if (it.dur > 0) { this.interaction = it; this.interactT = 0; this.interactDur = it.dur; this.adsBlend = 0; it.start && it.start(); }
      else it.done();
    }
  }
  _cancelInteraction() { const it = this.interaction; this.interaction = null; this.game.hud.progress(-1); it && it.cancel && it.cancel(); }

  // ---------- camera ----------
  _placeCamera(dt) {
    const C = this.char; const cam = this.camera;
    const eye = C.eyePos(_v);
    // smooth eye height changes (stance)
    this._eyeY = this._eyeY === undefined ? eye.y : THREE.MathUtils.damp(this._eyeY, eye.y, 12, dt);
    if (Math.abs(this._eyeY - eye.y) > 1.2) this._eyeY = eye.y;
    eye.y = this._eyeY;
    // head bob
    const sp = C.speedNorm; const bobAmt = (C.sprinting ? 0.026 : 0.012) * (sp > 0.1 ? 1 : 0) * (1 - this.adsBlend * 0.75);
    this.headBob.set(Math.sin(this.bobT) * bobAmt * 0.6, Math.abs(Math.cos(this.bobT)) * bobAmt, 0);
    this.landBump = THREE.MathUtils.damp(this.landBump, 0, 8, dt);
    this.camShake = THREE.MathUtils.damp(this.camShake, 0, 12, dt);
    eye.y += this.headBob.y - this.landBump * 0.18;
    if (this.rappel) { eye.y = C.pos.y + 1.5; }
    cam.position.copy(eye);
    const roll = C.lean * 0.2 + this.headBob.x * 0.4 + (Math.random() - 0.5) * this.camShake * 0.01;
    cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = C.yaw; cam.rotation.x = C.pitch + (Math.random() - 0.5) * this.camShake * 0.012; cam.rotation.z = roll;
    // fov: base + ads zoom
    const w = C.weapon; const base = this.game.settings.fov;
    const zoomed = w && w.def.zoom > 1 ? base / (w.def.zoom * 0.54) : base * 0.92;
    const targetFov = base + (zoomed - base) * this.adsBlend * (C.sprinting ? 0 : 1) + (C.sprinting ? 4 : 0);
    this.fovKick = THREE.MathUtils.damp(this.fovKick, 0, 10, dt);
    cam.fov = THREE.MathUtils.damp(cam.fov, targetFov + this.fovKick, 18, dt); cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
  _deadCamera(dt) {
    const C = this.char; const cam = this.camera;
    this._deathT = (this._deathT || 0) + dt;
    if (this._deathT > 3.2 && this._spectate(dt)) return;
    // camera settles at head of the fallen body
    const head = C.bones ? C.bones.Head.getWorldPosition(_v) : C.pos.clone();
    const target = _v2.set(head.x, Math.max(C.pos.y + 0.25, head.y + 0.15), head.z);
    cam.position.lerp(target, Math.min(1, dt * 4));
    cam.rotation.z = THREE.MathUtils.damp(cam.rotation.z, 0.6, 3, dt); cam.rotation.x = THREE.MathUtils.damp(cam.rotation.x, -0.2, 3, dt);
    cam.updateMatrixWorld(true);
    this._hideVM(true);
  }
  // Third-person over-the-shoulder view of a living teammate; LMB / RMB (or A / D) switch.
  _spectate(dt) {
    const g = this.game; const cam = this.camera; const hud = g.hud;
    const mates = g.characters.filter(c => c !== this.char && c.side === this.side && !c.dead);
    if (!mates.length) { this.specTarget = null; hud.spectate && hud.spectate(null); return false; }
    if (!this.specTarget || this.specTarget.dead || !mates.includes(this.specTarget)) { this.specIdx = 0; this.specTarget = mates[0]; this._specPos = null; }
    if (Input.fireHit() || Input.hit('right')) { this.specIdx = (mates.indexOf(this.specTarget) + 1) % mates.length; this.specTarget = mates[this.specIdx]; this._specPos = null; g.audio.click('hover'); }
    if (Input.aimHit() || Input.hit('left')) { this.specIdx = (mates.indexOf(this.specTarget) - 1 + mates.length) % mates.length; this.specTarget = mates[this.specIdx]; this._specPos = null; g.audio.click('hover'); }
    const T = this.specTarget; const eye = T.eyePos(_v); const fwd = T.forward(_v2); const right = T.right(_v3);
    const desired = new THREE.Vector3().copy(eye).addScaledVector(fwd, -1.8).addScaledVector(right, 0.42); desired.y += 0.3;
    const dir = desired.clone().sub(eye); const len = dir.length(); dir.normalize();
    const h = g.world.raycast(eye, dir, len + 0.25, { filter: c => c.solid && c.blocksVision !== false });
    if (h) desired.copy(eye).addScaledVector(dir, Math.max(0.35, h.dist - 0.25));
    if (!this._specPos) this._specPos = desired.clone(); else this._specPos.lerp(desired, Math.min(1, dt * 9));
    cam.position.copy(this._specPos); cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = T.yaw; cam.rotation.x = T.pitch;
    cam.fov = THREE.MathUtils.damp(cam.fov, g.settings.fov, 8, dt); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    this._hideVM(true); hud.spectate && hud.spectate(T);
    return true;
  }
  // ---------- defender security cameras ----------
  enterCam(idx) {
    const cams = this.game.level.cameras.filter(c => c.alive); if (!cams.length) { this.game.hud.toast('NO CAMERAS ONLINE', 1.5); return false; }
    const cam = cams[((idx % cams.length) + cams.length) % cams.length];
    this.usingCam = true; this.camView = { cam, yaw: cam.yaw, pitch: cam.pitch, intel: new ObsIntel(this.game), get hover() { return this.intel.hover; }, get scanT() { return this.intel.scanT; }, get scanFrac() { return this.intel.scanFrac; }, jammed: false, isCam: true, get name() { return this.cam.name; } };
    this.game.hud.drone(true); this.game.audio.click('ui'); return true;
  }
  exitCam() { this.usingCam = false; this.camView = null; this.game.hud.drone(false); }
  _camUpdate(dt) {
    const V = this.camView; const g = this.game; const cams = g.level.cameras.filter(c => c.alive);
    if (!V.cam.alive) { const next = cams[0]; if (!next) { this.exitCam(); g.hud.toast('CAMERA DESTROYED', 1.5); return; } V.cam = next; V.yaw = next.yaw; V.pitch = next.pitch; g.hud.toast('CAMERA DESTROYED — SWITCHING', 1.5); }
    if (Input.hit('leanR') || Input.fireHit()) { const i = cams.indexOf(V.cam); V.cam = cams[(i + 1) % cams.length]; V.yaw = V.cam.yaw; V.pitch = V.cam.pitch; g.audio.click('hover'); }
    if (Input.hit('leanL') || Input.aimHit()) { const i = cams.indexOf(V.cam); V.cam = cams[(i - 1 + cams.length) % cams.length]; V.yaw = V.cam.yaw; V.pitch = V.cam.pitch; g.audio.click('hover'); }
    const sens = 0.0018; V.yaw -= Input.mouse.dx * sens; V.pitch -= Input.mouse.dy * sens;
    // a mounted camera only pans so far
    let dy = V.yaw - V.cam.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); dy = THREE.MathUtils.clamp(dy, -0.85, 0.85); V.yaw = V.cam.yaw + dy;
    V.pitch = THREE.MathUtils.clamp(V.pitch, -1.0, 0.25);
    const cam = this.camera; cam.position.copy(V.cam.pos); cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = V.yaw; cam.rotation.x = V.pitch; cam.fov = THREE.MathUtils.damp(cam.fov, 78, 10, dt); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const dir = _v2.set(-Math.sin(V.yaw) * Math.cos(V.pitch), Math.sin(V.pitch), -Math.cos(V.yaw) * Math.cos(V.pitch));
    V.intel.update(dt, cam.position, dir, false, this.char);
  }
  _placeCameraDrone() { const d = this.drone; const cam = this.camera; d.mesh.visible = false; cam.position.copy(d.pos); cam.position.y += 0.2; cam.rotation.set(0, 0, 0, 'YXZ'); cam.rotation.y = d.yaw; cam.rotation.x = d.pitch; cam.fov = THREE.MathUtils.damp(cam.fov, 82, 10, 0.016); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); }
  _hideVM(hide) { this.vm.visible = !hide; if (this.arms) this.arms.visible = !hide && !this.char.dead; if (hide) this.redDot.visible = false; }

  // ---------- view model placement ----------
  _updateViewModel(dt) {
    const C = this.char; const w = C.weapon; if (!w) return;
    const g = this._vmFor(w); const M = g.userData.model; const inner = g.userData.inner;
    // sway (mouse lag) + bob
    this.swayVel.multiplyScalar(Math.max(0, 1 - dt * 10)); this.sway.addScaledVector(this.swayVel, dt * 60);
    this.sway.multiplyScalar(Math.max(0, 1 - dt * 9));
    this.sway.x = THREE.MathUtils.clamp(this.sway.x, -0.05, 0.05); this.sway.y = THREE.MathUtils.clamp(this.sway.y, -0.05, 0.05);
    this.kickPos.multiplyScalar(Math.max(0, 1 - dt * 14)); this.kickRot.multiplyScalar(Math.max(0, 1 - dt * 14));
    const sp = C.speedNorm;
    const bob = (sp > 0.1 ? 1 : 0) * (C.sprinting ? 0.022 : 0.009) * (1 - this.adsBlend * 0.85);
    const bobX = Math.sin(this.bobT) * bob, bobY = Math.abs(Math.cos(this.bobT)) * bob * 0.7;
    // poses (camera space): hip vs ads
    const s = M.scale;
    const hip = new THREE.Vector3(M.hip.pos[0], M.hip.pos[1], M.hip.pos[2]);
    const sight = new THREE.Vector3(M.sight[0], M.sight[1], M.sight[2]).multiplyScalar(s);
    // rotation: model -X -> camera -Z
    const rotBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    const rotAds = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), M.adsPitch || 0).multiply(rotBase);
    const eyeRelief = M.scope ? 0.1 : 0.14;
    const adsPos = new THREE.Vector3(0, 0, -eyeRelief).sub(sight.clone().applyQuaternion(rotAds));
    // sprint pose: lowered, rotated
    const sprintPos = new THREE.Vector3(0.12, -0.28, -0.36), sprintRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0.55, 0.2)).multiply(rotBase);
    this.sprintBlend = THREE.MathUtils.damp(this.sprintBlend, C.sprinting ? 1 : 0, 10, dt);
    // reload / switch / melee lowering
    let lower = 0; if (w.reloading) lower = 0.5 + 0.5 * Math.sin(Math.min(1, w.reloadTimer / Math.max(0.1, w.reloadTotal)) * Math.PI); if (this.switchT > 0) lower = 1; if (this.melee > 0) lower = 0.8;
    if (C.dbno) lower = 1;
    if (this.gadgetMode || this.gadget2Mode) lower = Math.max(lower, 0.85);   // gadget in hand: weapon slung low
    if (this.interaction) lower = Math.max(lower, 0.75);   // hands busy (barricading, reinforcing, planting): weapon swung down to the right
    this.lowerBlend = THREE.MathUtils.damp(this.lowerBlend, lower, 12, dt);
    const a = this.adsBlend * (1 - this.sprintBlend);
    const pos = hip.clone().lerp(adsPos, smooth(a));
    const rot = rotBase.clone().slerp(rotAds, smooth(a));
    pos.lerp(sprintPos, this.sprintBlend); rot.slerp(sprintRot, this.sprintBlend);
    // lowered pose
    pos.y -= this.lowerBlend * 0.22; pos.x += this.lowerBlend * 0.04;
    const lowRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5 * this.lowerBlend, 0.15 * this.lowerBlend, 0.1 * this.lowerBlend)); rot.premultiply(lowRot);
    // sway & bob & kick
    const swayMult = 1 - a * 0.7;
    pos.x += (this.sway.x + bobX) * swayMult; pos.y += (this.sway.y + bobY) * swayMult; pos.z += this.kickPos.z;
    pos.x += this.kickPos.x;
    const swayRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.sway.y * 1.6 * swayMult + this.kickRot.x, -this.sway.x * 1.6 * swayMult, this.sway.x * 0.8 * swayMult + this.kickRot.z + bobX * 0.5));
    rot.premultiply(swayRot);
    // lean tilt
    const leanRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), C.lean * 0.12 * (1 - a)); rot.premultiply(leanRot);
    g.position.copy(pos); g.quaternion.copy(rot);
    g.updateMatrixWorld(true);
    // keep the view-model camera in sync so lens projection uses this frame's transform
    const vc = this.game.vmCamera; vc.position.copy(this.camera.position); vc.quaternion.copy(this.camera.quaternion); vc.fov = this.vmFov; vc.updateProjectionMatrix(); vc.updateMatrixWorld(true); this._vmCamera = vc;
    // scope
    const lens = g.userData.lens;
    this.scopeActive = !!(M.scope && this.adsBlend > 0.55 && this.sprintBlend < 0.2);
    if (lens) {
      lens.visible = this.scopeActive;
      if (this.scopeActive) {
        // lens centre in screen pixels
        const lp = lens.getWorldPosition(_v3).clone(); const ndc = lp.project(this._vmCamera || this.camera);
        // gl_FragCoord is in the composer's buffer pixels, which may differ from renderer size × DPR
        const rt = this.game.composer && this.game.composer.renderTarget1; const size = this.game.renderer.getSize(new THREE.Vector2()); const dpr = this.game.renderer.getPixelRatio();
        const W = rt ? rt.width : size.x * dpr, H = rt ? rt.height : size.y * dpr;
        const u = this.scopeMat.uniforms;
        u.uRes.value.set(W, H);
        u.uCenter.value.set((ndc.x * 0.5 + 0.5) * W, (ndc.y * 0.5 + 0.5) * H);
        // projected lens radius: use a point offset by radius along camera up
        const edge = lens.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, M.scope.radius * s, 0).applyQuaternion(this.camera.quaternion)); const e = edge.project(this._vmCamera || this.camera);
        u.uLensPx.value = Math.abs(e.y - ndc.y) * 0.5 * H * 2;
        u.uAlign.value = Math.min(1, Math.hypot(ndc.x, ndc.y) * 3);
        u.uReticle.value = 1;
      }
    }
    // red dot
    if (M.reddot) {
      const show = this.adsBlend > 0.9 && this.sprintBlend < 0.1;
      this.redDot.visible = show;
      if (show) { const wp = _v3.set(M.reddot.window[0], M.reddot.window[1], M.reddot.window[2]); inner.localToWorld(wp); const dz = wp.distanceTo(this.camera.position); this.redDot.position.set(0, 0, -dz); this.redDot.scale.setScalar(0.004 * dz + 0.0035); }
    } else this.redDot.visible = false;
  }

  // ---------- first-person arms ----------
  _updateArms(dt) {
    const C = this.char; const w = C.weapon; const A = this.arms; if (!A || !w) return;
    A.visible = !C.dead && this.vm.visible;
    if (!A.visible) return;
    // Body under the camera. The rig's arms are short, so the first-person body is scaled up and
    // bladed (support shoulder forward) so both hands can reach the grips.
    const cam = this.camera; const SCALE = 1.28, SHOULDER_H = 1.40, BLADE = 0.55;
    A.scale.setScalar(SCALE);
    A.position.copy(cam.position); A.position.y -= 0.26 + SHOULDER_H * SCALE - this.headBob.y * 0.5;
    const fwd = C.forwardFlat(_v); A.position.addScaledVector(fwd, 0.02);
    const right = C.right(_v2); A.position.addScaledVector(right, 0.03);
    A.rotation.set(0, C.yaw + Math.PI + BLADE, 0);
    // working with the support hand (barricade planks): the short rig arm can't reach the work, so the
    // unseen body leans in toward it and the hand is kept up at eye level where the camera sees it
    let handGoal = null;
    if (this.interaction && this.interaction.hand) { handGoal = this.interaction.hand(new THREE.Vector3()); handGoal.y = this.interaction.crouch ? Math.max(handGoal.y, cam.position.y - 0.62) : Math.min(handGoal.y, cam.position.y - 0.14); const d = handGoal.clone().sub(cam.position); d.y = 0; const reach = Math.max(0, d.length() - 0.42); this._leanIn = THREE.MathUtils.damp(this._leanIn || 0, Math.min(0.5, reach), 10, dt); if (d.lengthSq() > 1e-4) A.position.addScaledVector(d.normalize(), this._leanIn); }
    else this._leanIn = THREE.MathUtils.damp(this._leanIn || 0, 0, 10, dt);
    A.updateMatrixWorld(true);
    const B = this.armBones;
    // reset arm chain to rest then IK
    for (const n of ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'Spine', 'Spine01', 'Spine02', 'neck']) { const b = B[n]; if (b && C.restQuats[n]) b.quaternion.copy(C.restQuats[n]); }
    // spine pitch
    for (const [name, f] of [['Spine02', 0.3], ['Spine01', 0.3], ['Spine', 0.3]]) { const b = B[name]; _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -C.pitch * f); b.quaternion.multiply(_q); }
    A.updateMatrixWorld(true);
    const g = this._vmFor(w); const M = g.userData.model; const inner = g.userData.inner;
    for (const side of ['left', 'right']) {
      const [uN, lN, hN] = side === 'left' ? ['LeftArm', 'LeftForeArm', 'LeftHand'] : ['RightArm', 'RightForeArm', 'RightHand'];
      const gp = side === 'left' ? M.gripL : M.gripR;
      const target = new THREE.Vector3(gp[0], gp[1], gp[2]); inner.localToWorld(target);
      if (side === 'left' && handGoal) { this._handT = this._handT || target.clone(); this._handT.lerp(handGoal, Math.min(1, dt * 14)); target.copy(this._handT); } else if (side === 'left') this._handT = null;
      const up = B[uN]; up.getWorldPosition(_v3);
      const hint = new THREE.Vector3().copy(_v3).addScaledVector(right, side === 'left' ? -0.5 : 0.7).addScaledVector(fwd, -0.1); hint.y -= 0.8;
      C._twoBone(up, B[lN], B[hN], target, hint, this.armLen[side].upper, this.armLen[side].lower);
      const wq = inner.getWorldQuaternion(new THREE.Quaternion());
      const along = new THREE.Vector3(-1, 0, 0).applyQuaternion(wq), wup = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
      const yAxis = side === 'right' ? along.clone().multiplyScalar(0.35).addScaledVector(wup, -1).normalize() : along.clone().addScaledVector(wup, -0.35).normalize();
      const zAxis = new THREE.Vector3().crossVectors(yAxis, side === 'left' ? wup.clone().negate() : wup).normalize();
      const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
      _m.makeBasis(xAxis, yAxis, zAxis); _q.setFromRotationMatrix(_m);
      const hand = B[hN]; hand.parent.getWorldQuaternion(_q2i); _q2i.invert(); hand.quaternion.copy(_q2i).multiply(_q); hand.updateMatrixWorld(true);
    }
  }

  // ---------- damage feedback ----------
  onDamaged(dmg, attacker, dir) {
    const hud = this.game.hud; if (!hud) return;
    hud.damage(dmg, attacker ? attacker.pos : null, this.char);
    this.camShake = Math.min(1, this.camShake + dmg / 60);
  }

  // Render hook: draws the scope render target before the main pass.
  renderScope(renderer, scene) {
    if (!this.scopeActive) return;
    const cam = this.scopeCam; const main = this.camera; const w = this.char.weapon; const M = WeaponModels[w.def.model];
    cam.position.copy(main.getWorldPosition(_v)); cam.quaternion.copy(main.getWorldQuaternion(_q));
    // magnification relative to the base FOV
    cam.fov = this.game.settings.fov / (M.scope.mag * 1.0) / 1.15; cam.aspect = 1; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    cam.layers.set(0);
    const old = renderer.getRenderTarget();
    renderer.setRenderTarget(this.scopeRT); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(old);
  }

  dispose() { this.camera.remove(this.vm); if (this.arms) this.game.scene.remove(this.arms); this.camera.remove(this.redDot); }
}
const _q2i = new THREE.Quaternion();
function smooth(t) { return t * t * (3 - 2 * t); }

const SCAN_TIME = 1.1;   // seconds the reticle must stay on an enemy to identify them

// Identify / ping logic shared by drones and security cameras.
class ObsIntel {
  constructor(game) { this.game = game; this.hover = null; this.scanT = 0; this.scanCooldown = 0; this._tick = 0; this.pingT = -9; }
  get scanFrac() { return Math.min(1, this.scanT / SCAN_TIME); }
  update(dt, origin, dir, jammed, me) {
    const g = this.game; let hover = null, hd = 32;
    for (const ch of g.characters) { if (ch.side === me.side || ch.dead) continue; const r = ch.raycast(origin, dir, hd); if (r && r.dist < hd && g.world.visible(origin, r.point)) { hover = ch; hd = r.dist; } }
    this.hover = hover; this.scanCooldown = Math.max(0, this.scanCooldown - dt);
    if (Input.down('scan') && hover && !jammed && this.scanCooldown <= 0) {
      this.scanT += dt; this._tick += dt;
      if (this._tick > 0.13) { this._tick = 0; g.audio.scanTick(this.scanT / SCAN_TIME); }
      if (this.scanT >= SCAN_TIME) { g.identify(hover, me); this.scanT = 0; this.scanCooldown = 0.9; }
    } else { this.scanT = Math.max(0, this.scanT - dt * 2.5); this._tick = 0; }
    if (Input.hit('ping') && g.time - this.pingT > 0.6 && !jammed) { this.pingT = g.time; g.ping(origin.clone(), dir.clone(), me); }
  }
}

// Attacker drone: driven during the preparation phase, and again from the operator later (5 / X).
export class Drone {
  constructor(game, pos, yaw) {
    this.game = game; this.pos = pos.clone(); this.yaw = yaw; this.pitch = -0.1; this.vel = new THREE.Vector3(); this.grounded = true;
    this.mesh = new THREE.Group();
    // Shadow Rover model: +X is the lens side, ~1.9 m long in the file → 30 cm rover facing -Z
    const model = Assets.cloneStatic('prop_drone');
    if (model) { model.scale.setScalar(0.16); model.rotation.y = Math.PI / 2; model.position.y = 0.05; model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } }); this.mesh.add(model); }
    else { const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.6 })); this.mesh.add(body); }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x30c0ff, emissiveIntensity: 3 })); eye.position.set(0, 0.07, -0.16); this.mesh.add(eye);
    this.mesh.position.copy(pos); game.scene.add(this.mesh);
    this.light = new THREE.PointLight(0x30c0ff, 1.2, 2.5, 2); this.light.position.set(0, 0.1, -0.1); this.mesh.add(this.light);
    this.dead = false; this.jammed = false; this.intel = new ObsIntel(game);
  }
  // driven = the player is looking through it; otherwise it just sits (or finishes its throw) and keeps its mesh in place
  update(dt, driven = true) {
    const sens = 0.0022; if (driven) { this.yaw -= Input.mouse.dx * sens; this.pitch = THREE.MathUtils.clamp(this.pitch - Input.mouse.dy * sens, -1.2, 1.2); }
    const f = driven ? (Input.down('forward') ? 1 : 0) - (Input.down('back') ? 1 : 0) : 0, r = driven ? (Input.down('right') ? 1 : 0) - (Input.down('left') ? 1 : 0) : 0;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, r); if (wish.lengthSq()) wish.normalize().multiplyScalar(this.jammed ? 0 : 4.2);
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wish.x, 12, dt); this.vel.z = THREE.MathUtils.damp(this.vel.z, wish.z, 12, dt);
    this.vel.y -= 20 * dt;
    if (driven && Input.hit('jump') && this.grounded) this.vel.y = 4.2;
    const res = this.game.world.moveBox(this.pos, 0.13, 0.26, new THREE.Vector3(this.vel.x * dt, this.vel.y * dt, this.vel.z * dt), 0.22);
    if (res.grounded) this.vel.y = Math.max(0, this.vel.y); this.grounded = res.grounded;
    this.mesh.position.copy(this.pos); this.mesh.position.y += 0.02; this.mesh.rotation.y = this.yaw;
    const jam = this.game.gadgets.isJammed(this.pos); this.jammed = jam;
    // a little body rock while driving
    const sp = Math.hypot(this.vel.x, this.vel.z); this.mesh.rotation.z = Math.sin(this.game.time * 22) * 0.02 * Math.min(1, sp / 3); this.mesh.rotation.x = -Math.min(0.06, (this.vel.y > 0.5 ? 0.06 : 0)) + (this.grounded ? 0 : 0.05);
    if (driven) this._intel(dt);
  }
  // Identify (hold X on an enemy) and contextual ping (Z) from the drone camera.
  _intel(dt) {
    const origin = _v.copy(this.pos); origin.y += 0.2;
    const dir = _v2.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    if (!this.intel) this.intel = new ObsIntel(this.game);
    this.intel.update(dt, origin, dir, this.jammed, this.game.player.char);
  }
  get hover() { return this.intel ? this.intel.hover : null; }
  get scanT() { return this.intel ? this.intel.scanT : 0; }
  get scanFrac() { return this.intel ? this.intel.scanFrac : 0; }
  dispose() { this.game.scene.remove(this.mesh); }
}
