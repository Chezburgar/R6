import * as THREE from 'three';
import { getSprite } from '../map/Materials.js';

// GPU-driven stateless particles: each particle is written once (position, velocity,
// birth, life, size, colour) and integrated in the vertex shader. Ring buffers per
// texture/blend mode. Tracers, muzzle flashes and short-lived lights are pooled meshes.

const VERT = `
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iData; // birth, life, size0, size1
attribute vec4 iColor; attribute float iRot; attribute float iGrav;
uniform float uTime; uniform float uAspect;
varying vec2 vUv; varying vec4 vColor; varying float vLife;
void main(){
  float age = uTime - iData.x; float t = clamp(age / iData.y, 0.0, 1.0);
  vLife = t; vUv = uv; vColor = iColor;
  if (age < 0.0 || age > iData.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = iPos + iVel * age + vec3(0.0, -0.5 * iGrav * age * age, 0.0);
  // drag
  p -= iVel * (age * age) * 0.25 * (1.0 - iGrav * 0.02);
  float size = mix(iData.z, iData.w, t);
  float c = cos(iRot + age * iRot * 0.5), s = sin(iRot + age * iRot * 0.5);
  vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += corner;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uMap; uniform float uFadeIn; uniform float uFadeOut;
varying vec2 vUv; varying vec4 vColor; varying float vLife;
void main(){
  vec4 tex = texture2D(uMap, vUv);
  float a = smoothstep(0.0, uFadeIn, vLife) * (1.0 - smoothstep(1.0 - uFadeOut, 1.0, vLife));
  gl_FragColor = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a * a);
  if (gl_FragColor.a < 0.005) discard;
}`;

class ParticleSystem {
  constructor(scene, texture, max, { additive = false, fadeIn = 0.05, fadeOut = 0.5, depthWrite = false } = {}) {
    this.max = max; this.next = 0;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index; geo.attributes.position = quad.attributes.position; geo.attributes.uv = quad.attributes.uv;
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.iRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); this.iGrav = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.iPos, this.iVel, this.iData, this.iColor, this.iRot, this.iGrav]) a.setUsage(THREE.DynamicDrawUsage);
    // all dead initially
    for (let i = 0; i < max; i++) { this.iData.setXYZW(i, -1000, 1, 0, 0); }
    geo.setAttribute('iPos', this.iPos); geo.setAttribute('iVel', this.iVel); geo.setAttribute('iData', this.iData); geo.setAttribute('iColor', this.iColor); geo.setAttribute('iRot', this.iRot); geo.setAttribute('iGrav', this.iGrav);
    geo.instanceCount = max;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: { value: 0 }, uMap: { value: texture }, uFadeIn: { value: fadeIn }, uFadeOut: { value: fadeOut }, uAspect: { value: 1 } }, transparent: true, depthWrite, depthTest: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 20 : 10;
    scene.add(this.mesh);
    this.dirty = false;
  }
  emit(p, v, life, size0, size1, r, g, b, a, grav = 0, rot = 0, time = 0) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.iPos.setXYZ(i, p.x, p.y, p.z); this.iVel.setXYZ(i, v.x, v.y, v.z); this.iData.setXYZW(i, time, life, size0, size1); this.iColor.setXYZW(i, r, g, b, a); this.iRot.setX(i, rot); this.iGrav.setX(i, grav);
    this.dirty = true;
  }
  update(time) { this.mat.uniforms.uTime.value = time; if (this.dirty) { for (const a of [this.iPos, this.iVel, this.iData, this.iColor, this.iRot, this.iGrav]) a.needsUpdate = true; this.dirty = false; } }
}

export class Effects {
  constructor(scene, level, audio) {
    this.scene = scene; this.level = level; this.audio = audio; this.time = 0;
    this.dust = new ParticleSystem(scene, getSprite('dust'), 1200, { fadeIn: 0.1, fadeOut: 0.6 });
    this.smoke = new ParticleSystem(scene, getSprite('smoke'), 600, { fadeIn: 0.25, fadeOut: 0.5 });
    this.spark = new ParticleSystem(scene, getSprite('spark'), 1500, { additive: true, fadeIn: 0.0, fadeOut: 0.7 });
    this.glow = new ParticleSystem(scene, getSprite('glow'), 300, { additive: true, fadeIn: 0.0, fadeOut: 0.8 });
    this.debris = new ParticleSystem(scene, getSprite('dust'), 800, { fadeIn: 0.0, fadeOut: 0.2, depthWrite: false });
    this.blood = new ParticleSystem(scene, getSprite('dust'), 400, { fadeIn: 0.0, fadeOut: 0.5 });
    this.flashTex = getSprite('flash');
    // pooled tracers
    this.tracers = []; this.tracerPool = [];
    const tg = new THREE.PlaneGeometry(1, 1); tg.translate(0.5, 0, 0);
    this.tracerMat = new THREE.MeshBasicMaterial({ map: getSprite('glow'), color: 0xffe6b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(tg, this.tracerMat.clone()); m.visible = false; m.frustumCulled = false; m.renderOrder = 21; scene.add(m); this.tracerPool.push(m); }
    // muzzle flash sprites + lights
    this.flashes = [];
    for (let i = 0; i < 10; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.visible = false; s.renderOrder = 22; scene.add(s); const l = new THREE.PointLight(0xffb060, 0, 7, 2); l.visible = false; scene.add(l); this.flashes.push({ s, l, t: 0, dur: 0 }); }
    this.lights = []; for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffa040, 0, 14, 2); l.visible = false; scene.add(l); this.lights.push({ l, t: 0, dur: 0, i0: 0 }); }
    // shockwave rings
    this.rings = []; const rg = new THREE.RingGeometry(0.6, 1, 48);
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); m.visible = false; scene.add(m); this.rings.push({ m, t: 0 }); }
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.camera = null;
  }

  update(dt, camera) {
    this.time += dt; this.camera = camera;
    for (const ps of [this.dust, this.smoke, this.spark, this.glow, this.debris, this.blood]) ps.update(this.time);
    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]; t.age += dt;
      if (t.age > t.life) { t.mesh.visible = false; this.tracerPool.push(t.mesh); this.tracers.splice(i, 1); continue; }
      const k = t.age / t.life; const head = Math.min(t.len, t.speed * t.age); const tail = Math.max(0, head - t.segLen);
      t.mesh.position.copy(t.origin).addScaledVector(t.dir, tail);
      // cylindrical billboard: x along dir, y toward camera
      this._v.subVectors(camera.position, t.mesh.position); this._v2.crossVectors(t.dir, this._v).normalize(); // up-ish
      const m = t.mesh.matrix; t.mesh.matrixAutoUpdate = false;
      const z = this._v.crossVectors(this._v2, t.dir).normalize();
      m.makeBasis(t.dir, this._v2, z); m.setPosition(t.mesh.position); m.scale(new THREE.Vector3(head - tail, 0.035, 1));
      t.mesh.material.opacity = 0.9 * (1 - k * k);
      t.mesh.visible = head > tail + 0.01;
    }
    for (const f of this.flashes) { if (!f.s.visible) continue; f.t += dt; if (f.t > f.dur) { f.s.visible = false; f.l.visible = false; f.l.intensity = 0; } else { const k = 1 - f.t / f.dur; f.s.material.opacity = k; f.l.intensity = f.i0 * k; } }
    for (const L of this.lights) { if (!L.l.visible) continue; L.t += dt; if (L.t > L.dur) { L.l.visible = false; } else { L.l.intensity = L.i0 * (1 - L.t / L.dur); } }
    for (const r of this.rings) { if (!r.m.visible) continue; r.t += dt; const k = r.t / 0.45; if (k > 1) { r.m.visible = false; continue; } const s = 0.5 + k * r.size; r.m.scale.set(s, s, s); r.m.material.opacity = 0.5 * (1 - k); }
  }

  // ---------- emitters ----------
  muzzleFlash(pos, dir, size = 1, viewmodel = false) {
    const f = this.flashes.find(f => !f.s.visible) || this.flashes[0];
    f.s.position.copy(pos).addScaledVector(dir, 0.06 * size); f.s.scale.setScalar((0.22 + Math.random() * 0.12) * size); f.s.material.rotation = Math.random() * Math.PI * 2; f.s.material.opacity = 1; f.s.visible = true;
    f.l.position.copy(pos).addScaledVector(dir, 0.25); f.l.intensity = 0; f.i0 = 18 * size; f.l.visible = true; f.t = 0; f.dur = 0.055;
    if (viewmodel) { f.s.layers.set(1); f.s.renderOrder = 30; } else f.s.layers.set(0);
    // smoke wisp + sparks
    for (let i = 0; i < 3; i++) { this._v.copy(dir).multiplyScalar(1.2 + Math.random()).add(this._v2.set((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6)); this.smoke.emit(pos, this._v, 0.7 + Math.random() * 0.5, 0.08 * size, 0.5 * size, 0.55, 0.55, 0.55, 0.28, 0, Math.random() * 6, this.time); }
    for (let i = 0; i < 4; i++) { this._v.copy(dir).multiplyScalar(6 + Math.random() * 10).add(this._v2.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4)); this.spark.emit(pos, this._v, 0.08 + Math.random() * 0.1, 0.03, 0.005, 1, 0.8, 0.4, 1, 9, 0, this.time); }
  }

  tracer(origin, dir, length, viewmodel = false) {
    if (!this.tracerPool.length) return;
    const mesh = this.tracerPool.pop(); mesh.visible = true;
    mesh.layers.set(0);
    const speed = 420;
    this.tracers.push({ mesh, origin: origin.clone(), dir: dir.clone(), len: length, speed, segLen: 2.4, age: 0, life: Math.min(0.5, length / speed + 0.03) });
  }

  impact(point, normal, material) {
    const p = this._v.copy(point).addScaledVector(normal, 0.02);
    const M = material;
    const dustCol = M === 'drywall' ? [0.85, 0.82, 0.76] : M === 'wood' || M === 'barricade' || M === 'plank' ? [0.55, 0.4, 0.25] : M === 'dirt' ? [0.5, 0.42, 0.3] : M === 'metal' || M === 'reinforced' || M === 'shield' ? [0.6, 0.6, 0.62] : [0.62, 0.6, 0.57];
    const n = M === 'metal' || M === 'reinforced' || M === 'shield' ? 2 : 6;
    for (let i = 0; i < n; i++) { this._v2.copy(normal).multiplyScalar(0.8 + Math.random() * 1.4).add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6 + 0.4, (Math.random() - 0.5) * 1.6)); this.dust.emit(p, this._v2, 0.5 + Math.random() * 0.5, 0.05, 0.28, dustCol[0], dustCol[1], dustCol[2], 0.5, 1.2, Math.random() * 6, this.time); }
    if (M === 'metal' || M === 'reinforced' || M === 'shield' || M === 'concrete' || M === 'tile' || M === 'brick') {
      for (let i = 0; i < 8; i++) { this._v2.copy(normal).multiplyScalar(1 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5)); this.spark.emit(p, this._v2, 0.15 + Math.random() * 0.3, 0.02, 0.004, 1, 0.75, 0.35, 1, 12, 0, this.time); }
    }
    for (let i = 0; i < 4; i++) { this._v2.copy(normal).multiplyScalar(1 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2)); this.debris.emit(p, this._v2, 0.6 + Math.random() * 0.6, 0.02, 0.015, dustCol[0] * 0.6, dustCol[1] * 0.6, dustCol[2] * 0.6, 1, 9.8, Math.random() * 6, this.time); }
    this.audio.impact(point, M);
  }

  bloodHit(point, dir) {
    for (let i = 0; i < 14; i++) { this._v2.copy(dir).multiplyScalar(0.5 + Math.random() * 2.5).add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)); this.blood.emit(point, this._v2, 0.35 + Math.random() * 0.4, 0.03, 0.12, 0.45, 0.02, 0.02, 0.85, 6, Math.random() * 6, this.time); }
    // decal behind
    const h = this.level.world.raycast(point, dir, 2.5, { filter: c => c.solid });
    if (h) this.level.addBlood(h.point, h.normal, 0.35 + Math.random() * 0.4);
  }

  shellEject(pos, right, up, fwd) {
    this._v2.copy(right).multiplyScalar(1.6 + Math.random()).addScaledVector(up, 1.2 + Math.random() * 0.8).addScaledVector(fwd, -0.4 + Math.random() * 0.3);
    this.debris.emit(pos, this._v2, 1.2, 0.014, 0.012, 0.85, 0.65, 0.25, 1, 9.8, 8 + Math.random() * 10, this.time);
  }

  explosion(pos, radius = 3, opts = {}) {
    const p = pos;
    const f = this.flashes.find(f => !f.s.visible) || this.flashes[0];
    f.s.position.copy(p); f.s.scale.setScalar(radius * 1.2); f.s.material.opacity = 1; f.s.visible = true; f.s.layers.set(0); f.l.position.copy(p).add(new THREE.Vector3(0, 0.6, 0)); f.i0 = 120; f.l.visible = true; f.t = 0; f.dur = 0.12; f.l.distance = radius * 6;
    const L = this.lights.find(l => !l.l.visible) || this.lights[0]; L.l.position.copy(p).add(new THREE.Vector3(0, 0.8, 0)); L.l.visible = true; L.t = 0; L.dur = 0.7; L.i0 = 60; L.l.distance = radius * 5; L.l.color.setHex(0xff9040);
    const ring = this.rings.find(r => !r.m.visible); if (ring) { ring.m.position.copy(p).add(new THREE.Vector3(0, 0.3, 0)); ring.m.rotation.x = -Math.PI / 2; ring.m.visible = true; ring.t = 0; ring.size = radius * 2.5; }
    for (let i = 0; i < 26; i++) { this._v2.set((Math.random() - 0.5) * 2, Math.random() * 1.5 + 0.2, (Math.random() - 0.5) * 2).multiplyScalar(radius * 0.9); this.smoke.emit(p, this._v2, 1.8 + Math.random() * 1.8, radius * 0.25, radius * 1.1, 0.22, 0.2, 0.18, 0.7, -0.6, Math.random() * 6, this.time); }
    for (let i = 0; i < 20; i++) { this._v2.set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2).multiplyScalar(radius); this.glow.emit(p, this._v2, 0.25 + Math.random() * 0.3, radius * 0.4, radius * 0.9, 1, 0.55, 0.2, 0.9, 0, Math.random() * 6, this.time); }
    for (let i = 0; i < 90; i++) { this._v2.set((Math.random() - 0.5) * 2, Math.random() * 1.6, (Math.random() - 0.5) * 2).multiplyScalar(radius * 3.5); this.spark.emit(p, this._v2, 0.4 + Math.random() * 0.8, 0.04, 0.01, 1, 0.7, 0.3, 1, 12, 0, this.time); }
    for (let i = 0; i < 50; i++) { this._v2.set((Math.random() - 0.5) * 2, Math.random() * 2 + 0.3, (Math.random() - 0.5) * 2).multiplyScalar(radius * 2.2); this.debris.emit(p, this._v2, 1 + Math.random() * 1.5, 0.05, 0.03, 0.25, 0.22, 0.2, 1, 9.8, Math.random() * 12, this.time); }
    this.audio.explosion(p, radius / 3);
  }

  wallDebris(center, normal, mat = 'drywall') {
    const col = mat === 'drywall' ? [0.82, 0.8, 0.75] : [0.55, 0.4, 0.25];
    for (let i = 0; i < 10; i++) { this._v2.set((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2).multiplyScalar(1.8).addScaledVector(normal, (Math.random() - 0.5) * 3); this.debris.emit(center, this._v2, 1 + Math.random(), 0.06, 0.05, col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 1, 9.8, Math.random() * 10, this.time); }
    for (let i = 0; i < 8; i++) { this._v2.set((Math.random() - 0.5) * 1.5, Math.random() * 0.8, (Math.random() - 0.5) * 1.5); this.dust.emit(center, this._v2, 1.2 + Math.random(), 0.2, 0.9, col[0], col[1], col[2], 0.45, 0.5, Math.random() * 6, this.time); }
  }

  glassShatter(center, horizontal) {
    for (let i = 0; i < 30; i++) { this._v2.set(horizontal ? (Math.random() - 0.5) * 2 : (Math.random() - 0.5) * 3, Math.random() * 1.5 - 0.5, horizontal ? (Math.random() - 0.5) * 3 : (Math.random() - 0.5) * 2); const p = this._v.copy(center).add(new THREE.Vector3(horizontal ? (Math.random() - 0.5) * 1.4 : 0, (Math.random() - 0.5) * 1.3, horizontal ? 0 : (Math.random() - 0.5) * 1.4)); this.spark.emit(p, this._v2, 0.8 + Math.random() * 0.8, 0.05, 0.03, 0.8, 0.9, 1, 0.9, 9.8, Math.random() * 12, this.time); }
    this.audio.glass(center);
  }

  smokeCloud(pos, radius, duration) {
    for (let i = 0; i < 40; i++) {
      this._v2.set((Math.random() - 0.5), Math.random() * 0.5, (Math.random() - 0.5)).multiplyScalar(radius * 0.35);
      const p = this._v.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * radius, Math.random() * radius * 0.6, (Math.random() - 0.5) * radius));
      this.smoke.emit(p, this._v2, duration * (0.7 + Math.random() * 0.3), radius * 0.4, radius * 1.3, 0.75, 0.75, 0.75, 0.95, -0.02, Math.random() * 6, this.time + Math.random() * 0.8);
    }
  }
  thermiteBurn(pos, normal, dt) {
    for (let i = 0; i < 6; i++) { this._v2.copy(normal).multiplyScalar(0.5 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)); const p = this._v.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 1.6).multiply(new THREE.Vector3(1 - Math.abs(normal.x), 1, 1 - Math.abs(normal.z)))); this.spark.emit(p, this._v2, 0.3 + Math.random() * 0.5, 0.05, 0.01, 1, 0.9, 0.6, 1, 8, 0, this.time); }
    for (let i = 0; i < 2; i++) { this._v2.set((Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4); this.smoke.emit(pos, this._v2, 1.5, 0.3, 1.0, 0.3, 0.3, 0.3, 0.5, -0.1, Math.random() * 6, this.time); }
    for (let i = 0; i < 2; i++) { this.glow.emit(pos, this._v2.set(0, 0.2, 0), 0.2, 0.8, 1.6, 1, 0.6, 0.2, 0.7, 0, 0, this.time); }
  }
  shockSparks(pos) {
    for (let i = 0; i < 3; i++) { this._v2.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3); this.spark.emit(pos, this._v2, 0.15 + Math.random() * 0.2, 0.05, 0.01, 0.5, 0.7, 1, 1, 4, 0, this.time); }
  }
  empPulse(pos) {
    const ring = this.rings.find(r => !r.m.visible); if (ring) { ring.m.position.copy(pos); ring.m.rotation.x = -Math.PI / 2; ring.m.visible = true; ring.t = 0; ring.size = 11; ring.m.material.color.setHex(0x80c0ff); }
    for (let i = 0; i < 60; i++) { this._v2.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(6); this.spark.emit(pos, this._v2, 0.4 + Math.random() * 0.4, 0.06, 0.01, 0.4, 0.7, 1, 1, 0, 0, this.time); }
    const L = this.lights.find(l => !l.l.visible) || this.lights[0]; L.l.position.copy(pos); L.l.visible = true; L.t = 0; L.dur = 0.5; L.i0 = 50; L.l.distance = 12; L.l.color.setHex(0x70b0ff);
  }
  stunFlash(pos) {
    const f = this.flashes.find(f => !f.s.visible) || this.flashes[0];
    f.s.position.copy(pos); f.s.scale.setScalar(3); f.s.material.opacity = 1; f.s.visible = true; f.s.layers.set(0); f.l.position.copy(pos); f.i0 = 200; f.l.visible = true; f.t = 0; f.dur = 0.25; f.l.distance = 20;
  }
}
