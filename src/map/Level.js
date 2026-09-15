import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Collider } from '../core/Physics.js';
import { getMaterial, flat, glassMaterial, getSprite } from './Materials.js';

// Level construction kit + destruction systems (soft walls, barricades, hatches,
// reinforcements, glass). All static geometry is merged per material for draw-call
// economy; destructible cells live in InstancedMeshes so a hole is a matrix write.

export const CELL = 0.5;            // destructible cell size (m)
export const FLOOR_H = 3.4;         // floor-to-floor
const SOFT_T = 0.16;                // soft wall thickness
const HARD_T = 0.36;                // exterior wall thickness

// Box geometry with UVs scaled to world size so tiling textures stay consistent.
function boxGeometry(w, h, d, uvScale = 1, offset = null) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv; const pos = g.attributes.position; const nrm = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    let u, v;
    if (nx > 0.5) { u = pos.getZ(i); v = pos.getY(i); } else if (ny > 0.5) { u = pos.getX(i); v = pos.getZ(i); } else { u = pos.getX(i); v = pos.getY(i); }
    if (offset) { u += nx > 0.5 ? offset.z : offset.x; v += ny > 0.5 ? offset.z : offset.y; }
    uv.setXY(i, u * uvScale, v * uvScale);
  }
  return g;
}

// Material clone whose UVs come from world position (instanced cells share one unit-box geometry).
const _cellMats = new Map();
function cellMaterial(name) {
  if (_cellMats.has(name)) return _cellMats.get(name);
  const m = getMaterial(name).clone();
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 an = abs(normal);
        vec2 wuv = an.z > 0.5 ? wp.xy : (an.x > 0.5 ? wp.zy : wp.xz);
        wuv *= 0.5;
        #ifdef USE_MAP
          vMapUv = (mapTransform * vec3(wuv, 1.0)).xy;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = (normalMapTransform * vec3(wuv, 1.0)).xy;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = (roughnessMapTransform * vec3(wuv, 1.0)).xy;
        #endif
      }`);
  };
  m.customProgramCacheKey = () => 'cellmat:' + name;
  _cellMats.set(name, m); return m;
}

export class SoftWall {
  // Axis-aligned soft (destructible) wall between (x0,z0)-(x1,z1) at floor y0, height h.
  constructor(level, id, x0, z0, x1, z1, y0, h, opts) {
    this.level = level; this.id = id;
    this.horizontal = Math.abs(x1 - x0) > Math.abs(z1 - z0);   // runs along X
    this.x0 = Math.min(x0, x1); this.x1 = Math.max(x0, x1); this.z0 = Math.min(z0, z1); this.z1 = Math.max(z0, z1);
    this.y0 = y0; this.h = h; this.len = this.horizontal ? this.x1 - this.x0 : this.z1 - this.z0;
    this.t = opts.thickness || SOFT_T;
    this.openings = opts.openings || [];
    this.reinforceable = opts.reinforceable !== false;
    this.reinforced = false;
    this.electrified = 0;      // Bandit batteries attached
    this.jammed = false;
    this.floor = opts.floor || 0;
    this.roomA = opts.roomA; this.roomB = opts.roomB;
    this.nx = Math.ceil(this.len / CELL); this.ny = Math.ceil(h / CELL);
    this.cells = new Array(this.nx * this.ny).fill(null);
    this.alive = 0;
    this.material = opts.material || 'plaster';
    this.materialB = opts.materialB || this.material;
    this.center = new THREE.Vector3((this.x0 + this.x1) / 2, y0 + h / 2, (this.z0 + this.z1) / 2);
    this.normal = this.horizontal ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    this.reinforceMesh = null;
    this.gadgets = [];
  }
  cellIndex(i, j) { return j * this.nx + i; }
  // world center of cell (i along wall, j up)
  cellCenter(i, j, out = new THREE.Vector3()) {
    const a = (i + 0.5) * CELL, y = this.y0 + (j + 0.5) * CELL;
    if (this.horizontal) out.set(this.x0 + a, y, (this.z0 + this.z1) / 2); else out.set((this.x0 + this.x1) / 2, y, this.z0 + a);
    return out;
  }
  inOpening(i, j) {
    const a0 = i * CELL, a1 = a0 + CELL, y0 = j * CELL, y1 = y0 + CELL;
    for (const o of this.openings) { if (a0 >= o.at - 1e-3 && a1 <= o.at + o.w + 1e-3 && y0 >= o.y - 1e-3 && y1 <= o.y + o.h + 1e-3) return true; }
    return false;
  }
  cellAt(point) {
    const a = this.horizontal ? point.x - this.x0 : point.z - this.z0; const y = point.y - this.y0;
    const i = Math.floor(a / CELL), j = Math.floor(y / CELL);
    if (i < 0 || i >= this.nx || j < 0 || j >= this.ny) return null;
    return this.cells[this.cellIndex(i, j)];
  }
  destroyCell(cell, silent = false) {
    if (!cell || cell.dead) return false;
    if (this.reinforced) return false;
    cell.dead = true; this.alive--;
    this.level.world.remove(cell.collider);
    this.level._hideInstance(cell);
    if (!silent) this.level.onCellDestroyed && this.level.onCellDestroyed(this, cell);
    return true;
  }
  // Destroy every cell whose center lies within radius of p (sphere), optionally in a box region.
  destroyRadius(p, r) {
    let n = 0; const c = new THREE.Vector3();
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const cell = this.cells[this.cellIndex(i, j)]; if (!cell || cell.dead) continue;
      this.cellCenter(i, j, c); if (c.distanceTo(p) <= r) { if (this.destroyCell(cell, true)) n++; }
    }
    if (n) this.level.onWallChanged && this.level.onWallChanged(this);
    return n;
  }
  destroyRect(p, halfW, halfH) {
    let n = 0; const c = new THREE.Vector3();
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const cell = this.cells[this.cellIndex(i, j)]; if (!cell || cell.dead) continue;
      this.cellCenter(i, j, c);
      const da = this.horizontal ? Math.abs(c.x - p.x) : Math.abs(c.z - p.z);
      if (da <= halfW + 1e-3 && Math.abs(c.y - p.y) <= halfH + 1e-3) { if (this.destroyCell(cell, true)) n++; }
    }
    if (n) this.level.onWallChanged && this.level.onWallChanged(this);
    return n;
  }
  reinforce() {
    if (this.reinforced || !this.reinforceable) return false;
    this.reinforced = true;
    for (const cell of this.cells) if (cell && !cell.dead) { cell.collider.material = 'reinforced'; cell.collider.penetrable = false; }
    // metal panels + colliders per span between openings (doorways/windows stay open)
    const h = this.h; const spans = []; let cursor = 0;
    for (const o of this.openings.slice().sort((p, q) => p.at - q.at)) { if (o.at > cursor + 0.05) spans.push([cursor, o.at]); cursor = Math.max(cursor, o.at + o.w); }
    if (this.len > cursor + 0.05) spans.push([cursor, this.len]);
    this.reinforceMesh = new THREE.Group(); this.reinforceColliders = [];
    for (const [s0, s1] of spans) {
      const len = s1 - s0; const mid = (s0 + s1) / 2;
      const geo = boxGeometry(this.horizontal ? len : this.t + 0.06, h, this.horizontal ? this.t + 0.06 : len, 0.5);
      const m = new THREE.Mesh(geo, getMaterial('metal')); m.castShadow = true; m.receiveShadow = true;
      m.position.set(this.horizontal ? this.x0 + mid : this.center.x, this.y0 + h / 2, this.horizontal ? this.center.z : this.z0 + mid);
      this.reinforceMesh.add(m);
      const min = new THREE.Vector3(this.horizontal ? this.x0 + s0 : this.center.x - this.t / 2 - 0.03, this.y0, this.horizontal ? this.center.z - this.t / 2 - 0.03 : this.z0 + s0);
      const max = new THREE.Vector3(this.horizontal ? this.x0 + s1 : this.center.x + this.t / 2 + 0.03, this.y0 + h, this.horizontal ? this.center.z + this.t / 2 + 0.03 : this.z0 + s1);
      this.reinforceColliders.push(this.level.world.add(new Collider(min, max, { material: 'reinforced', owner: this, tag: 'reinforcement', floor: this.floor })));
    }
    this.level.dynamicGroup.add(this.reinforceMesh);
    this.level.onWallChanged && this.level.onWallChanged(this);
    return true;
  }
  // Thermite: burn a hole through a reinforced (or soft) wall
  breachHole(p, halfW = 1.0, halfH = 1.1) {
    if (this.reinforced) {
      this.reinforced = false;
      if (this.reinforceMesh) { this.level.dynamicGroup.remove(this.reinforceMesh); this.reinforceMesh.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); this.reinforceMesh = null; }
      if (this.reinforceColliders) { for (const c of this.reinforceColliders) this.level.world.remove(c); this.reinforceColliders = null; }
      for (const cell of this.cells) if (cell && !cell.dead) { cell.collider.material = 'reinforced'; cell.collider.penetrable = false; }
      // re-add a reduced panel: cells outside the hole become 'reinforced' individual cells (keep meshes as metal instances)
      const c = new THREE.Vector3(); let n = 0;
      for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
        const cell = this.cells[this.cellIndex(i, j)]; if (!cell || cell.dead) continue;
        this.cellCenter(i, j, c);
        const da = this.horizontal ? Math.abs(c.x - p.x) : Math.abs(c.z - p.z);
        if (da <= halfW + 1e-3 && Math.abs(c.y - p.y) <= halfH + 1e-3) { cell.dead = true; this.alive--; this.level.world.remove(cell.collider); this.level._hideInstance(cell); n++; }
        else { this.level._setInstanceMaterial(cell, 'metal'); }
      }
      this.reinforced = true;  // remaining cells stay metal & unbreakable
      this.level.onWallChanged && this.level.onWallChanged(this);
      return n;
    }
    return this.destroyRect(p, halfW, halfH);
  }
}

export class Barricade {
  // Wooden planks over a door/window opening. slot: {x,y,z,w,h,horizontal}
  constructor(level, slot) {
    this.level = level; this.slot = slot; this.planks = []; this.hp = 3; this.built = false; this.progress = 0;
  }
  build() {
    if (this.built) return; this.built = true;
    const s = this.slot; const n = 5; const ph = s.h / n;
    for (let k = 0; k < n; k++) {
      const y = s.y + k * ph + ph / 2;
      const w = s.horizontal ? s.w : 0.09, d = s.horizontal ? 0.09 : s.w;
      const geo = boxGeometry(w, ph * 0.92, d, 1);
      const mesh = new THREE.Mesh(geo, getMaterial('plank')); mesh.position.set(s.x, y, s.z); mesh.rotation.z = (Math.random() - 0.5) * 0.02;
      mesh.castShadow = true; mesh.receiveShadow = true; this.level.dynamicGroup.add(mesh);
      const min = new THREE.Vector3(s.x - w / 2, y - ph / 2, s.z - d / 2), max = new THREE.Vector3(s.x + w / 2, y + ph / 2, s.z + d / 2);
      const col = this.level.world.add(new Collider(min, max, { material: 'barricade', penetrable: true, penMult: 0.75, owner: this, tag: 'barricade', floor: s.floor, blocksNav: false }));
      this.planks.push({ mesh, col, hits: 0, dead: false });
    }
    this.level.onBarricadeChanged && this.level.onBarricadeChanged(this);
  }
  alive() { return this.built && this.planks.some(p => !p.dead); }
  _killPlank(p) { if (p.dead) return; p.dead = true; this.level.world.remove(p.col); this.level.dynamicGroup.remove(p.mesh); p.mesh.geometry.dispose(); }
  melee(point) {
    if (!this.alive()) return false;
    this.hp--;
    // break planks closest to hit point first
    const order = this.planks.filter(p => !p.dead).sort((a, b) => Math.abs(a.mesh.position.y - point.y) - Math.abs(b.mesh.position.y - point.y));
    const kill = this.hp <= 0 ? order.length : 2;
    for (let i = 0; i < kill && i < order.length; i++) this._killPlank(order[i]);
    if (!this.alive()) this.destroy();
    else this.level.onBarricadeChanged && this.level.onBarricadeChanged(this);
    return true;
  }
  bullet(col) {
    const p = this.planks.find(p => p.col === col); if (!p || p.dead) return;
    p.hits++; if (p.hits >= 10) { this._killPlank(p); if (!this.alive()) this.destroy(); else this.level.onBarricadeChanged && this.level.onBarricadeChanged(this); }
  }
  destroy() { for (const p of this.planks) this._killPlank(p); this.built = false; this.hp = 3; this.planks = []; this.level.onBarricadeChanged && this.level.onBarricadeChanged(this); }
}

export class Hatch {
  constructor(level, x, z, y, size, floor) {
    this.level = level; this.x = x; this.z = z; this.y = y; this.size = size; this.floor = floor; this.open = false; this.reinforced = false; this.hp = 3;
    const geo = boxGeometry(size, 0.08, size, 1);
    this.mesh = new THREE.Mesh(geo, getMaterial('plank')); this.mesh.position.set(x, y - 0.04, z); this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    level.dynamicGroup.add(this.mesh);
    this.col = level.world.add(new Collider(new THREE.Vector3(x - size / 2, y - 0.1, z - size / 2), new THREE.Vector3(x + size / 2, y, z + size / 2), { material: 'wood', penetrable: true, penMult: 0.6, owner: this, tag: 'hatch', floor }));
    this.center = new THREE.Vector3(x, y, z);
  }
  reinforce() { if (this.open || this.reinforced) return false; this.reinforced = true; this.mesh.material = getMaterial('metal'); this.col.material = 'reinforced'; this.col.penetrable = false; return true; }
  destroy() {
    if (this.open) return false; if (this.reinforced) return false;
    this.open = true; this.level.world.remove(this.col); this.level.dynamicGroup.remove(this.mesh); this.level.onHatchChanged && this.level.onHatchChanged(this); return true;
  }
  breach() { // thermite/hard breach through reinforced
    if (this.open) return false; this.reinforced = false; return this.destroy();
  }
  melee() { if (this.open || this.reinforced) return false; this.hp--; if (this.hp <= 0) return this.destroy(); return true; }
}

export class Level {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.group = new THREE.Group(); this.dynamicGroup = new THREE.Group();
    scene.add(this.group); scene.add(this.dynamicGroup);
    this._static = new Map();      // materialKey -> geometries[]
    this.softWalls = []; this.barricadeSlots = []; this.hatches = []; this.glass = [];
    this.rooms = []; this.sites = []; this.spawns = { atk: [], def: [] };
    this.lights = []; this.rappelWalls = [];
    this.floorYs = [0, FLOOR_H];
    this.bounds = new THREE.Box3();
    this.interiorBounds = new THREE.Box3();
    this._cellInst = null; this._cellMetalInst = null; this._studInst = null;
    this._cellCount = 0; this._studCount = 0;
    this.onCellDestroyed = null; this.onWallChanged = null; this.onBarricadeChanged = null; this.onHatchChanged = null;
    this.decals = [];
    this.emissives = [];
    this.debris = [];
  }

  // ---------- static geometry ----------
  box(min, max, matName, opts = {}) {
    const w = max[0] - min[0], h = max[1] - min[1], d = max[2] - min[2];
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
    if (opts.visible !== false) {
      const geo = boxGeometry(w, h, d, opts.uvScale || 1, { x: cx, y: cy, z: cz });
      geo.translate(cx, cy, cz);
      const key = matName + (opts.matVariant || '');
      if (!this._static.has(key)) this._static.set(key, { mat: opts.material || getMaterial(matName, opts.matOverrides || {}), geos: [] });
      this._static.get(key).geos.push(geo);
    }
    if (opts.collide !== false) {
      const c = new Collider(new THREE.Vector3(min[0], min[1], min[2]), new THREE.Vector3(max[0], max[1], max[2]), {
        material: opts.physMat || matName, penetrable: !!opts.penetrable, penMult: opts.penMult, blocksVision: opts.blocksVision, tag: opts.tag || 'static', floor: opts.floor, blocksNav: opts.blocksNav, owner: opts.owner,
      });
      this.world.add(c); return c;
    }
    return null;
  }

  mesh(m) { this.group.add(m); return m; }

  // A hard (non-destructible) wall along an axis with rectangular openings.
  // openings: [{at, w, y, h, kind}] measured along the wall from (x0,z0).
  hardWall(x0, z0, x1, z1, y0, h, matName, opts = {}) {
    const horizontal = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const t = opts.thickness || HARD_T; const len = horizontal ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const ax = horizontal ? Math.min(x0, x1) : Math.min(z0, z1);
    const cross = horizontal ? z0 : x0;
    const openings = (opts.openings || []).slice().sort((a, b) => a.at - b.at);
    // segments between openings: full height; around openings: below & above
    const inward = -(opts.outward || -1);
    const put = (a0, a1, y0_, y1_) => {
      if (a1 - a0 < 1e-3 || y1_ - y0_ < 1e-3) return;
      const min = horizontal ? [a0, y0_, cross - t / 2] : [cross - t / 2, y0_, a0];
      const max = horizontal ? [a1, y1_, cross + t / 2] : [cross + t / 2, y1_, a1];
      this.box(min, max, matName, { uvScale: opts.uvScale || 0.5, floor: opts.floor, tag: 'wall', physMat: opts.physMat });
      // plastered interior skin on exterior walls (non-colliding, sits just inside the concrete)
      if (opts.skin) {
        const f0 = cross + inward * t / 2, f1 = f0 + inward * 0.02;
        const smin = horizontal ? [a0, y0_, Math.min(f0, f1)] : [Math.min(f0, f1), y0_, a0];
        const smax = horizontal ? [a1, y1_, Math.max(f0, f1)] : [Math.max(f0, f1), y1_, a1];
        this.box(smin, smax, opts.skin, { uvScale: 0.5, collide: false });
      }
    };
    let cursor = 0;
    for (const o of openings) {
      put(ax + cursor, ax + o.at, y0, y0 + h);
      put(ax + o.at, ax + o.at + o.w, y0, y0 + o.y);
      put(ax + o.at, ax + o.at + o.w, y0 + o.y + o.h, y0 + h);
      const cx = horizontal ? ax + o.at + o.w / 2 : cross, cz = horizontal ? cross : ax + o.at + o.w / 2;
      this._registerOpening(o, cx, y0 + o.y, cz, horizontal, opts.floor || 0, t, opts.exterior);
      cursor = o.at + o.w;
    }
    put(ax + cursor, ax + len, y0, y0 + h);
    if (opts.exterior && opts.rappel !== false) this.rappelWalls.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), horizontal, y0, h, t, outward: opts.outward || (horizontal ? -1 : -1) });
  }

  _registerOpening(o, cx, y, cz, horizontal, floor, t, exterior) {
    const slot = { x: cx, y, z: cz, w: o.w, h: o.h, horizontal, floor, kind: o.kind || 'door', exterior: !!exterior };
    if (o.kind === 'window') {
      // glass pane
      const gw = horizontal ? o.w : 0.02, gd = horizontal ? 0.02 : o.w;
      const geo = new THREE.BoxGeometry(gw, o.h, gd); const m = new THREE.Mesh(geo, glassMaterial()); m.position.set(cx, y + o.h / 2, cz); this.dynamicGroup.add(m);
      const col = this.world.add(new Collider(new THREE.Vector3(cx - gw / 2 - 0.01, y, cz - gd / 2 - 0.01), new THREE.Vector3(cx + gw / 2 + 0.01, y + o.h, cz + gd / 2 + 0.01), { material: 'glass', penetrable: true, penMult: 0.97, blocksVision: false, tag: 'glass', floor, solid: true, blocksNav: false }));
      const pane = { mesh: m, col, broken: false, center: new THREE.Vector3(cx, y + o.h / 2, cz), horizontal };
      col.owner = pane; this.glass.push(pane); slot.glass = pane;
      // window frame + sill
      const fw = horizontal ? o.w + 0.1 : t + 0.04, fd = horizontal ? t + 0.04 : o.w + 0.1;
      this.box([cx - fw / 2, y - 0.06, cz - fd / 2], [cx + fw / 2, y, cz + fd / 2], 'plank', { uvScale: 1, floor, tag: 'sill' });
    }
    if (o.kind !== 'garage' && o.kind !== 'arch') { slot.barricade = new Barricade(this, slot); this.barricadeSlots.push(slot); }
    // door frame trim
    if (o.kind === 'door') {
      const fw = horizontal ? 0.08 : t + 0.04, fd = horizontal ? t + 0.04 : 0.08;
      const ox = horizontal ? o.w / 2 + 0.04 : 0, oz = horizontal ? 0 : o.w / 2 + 0.04;
      this.box([cx - ox - fw / 2, y, cz - oz - fd / 2], [cx - ox + fw / 2, y + o.h + 0.06, cz - oz + fd / 2], 'plank', { uvScale: 1, collide: false });
      this.box([cx + ox - fw / 2, y, cz + oz - fd / 2], [cx + ox + fw / 2, y + o.h + 0.06, cz + oz + fd / 2], 'plank', { uvScale: 1, collide: false });
    }
    return slot;
  }

  // Soft, destructible interior wall. Openings snap to the CELL grid.
  softWall(x0, z0, x1, z1, y0, h, opts = {}) {
    const id = this.softWalls.length;
    const wall = new SoftWall(this, id, x0, z0, x1, z1, y0, h, opts);
    this.softWalls.push(wall);
    // studs (visible inside holes)
    const nStuds = Math.floor(wall.len / 0.6);
    for (let k = 1; k < nStuds; k++) {
      const a = k * 0.6; const c = wall.horizontal ? new THREE.Vector3(wall.x0 + a, y0 + h / 2, wall.center.z) : new THREE.Vector3(wall.center.x, y0 + h / 2, wall.z0 + a);
      // skip studs in openings
      if (wall.openings.some(o => a > o.at && a < o.at + o.w)) continue;
      this._pendingStuds = this._pendingStuds || []; this._pendingStuds.push({ wall, c, h });
    }
    return wall;
  }

  // Door/window openings in soft walls also get barricade slots
  _softOpenings(wall) {
    for (const o of wall.openings) {
      const cx = wall.horizontal ? wall.x0 + o.at + o.w / 2 : wall.center.x, cz = wall.horizontal ? wall.center.z : wall.z0 + o.at + o.w / 2;
      this._registerOpening(o, cx, wall.y0 + o.y, cz, wall.horizontal, wall.floor, wall.t, false);
    }
  }

  floorSlab(x0, z0, x1, z1, y, thickness, topMat, bottomMat, opts = {}) {
    // A slab with holes. holes: [{x,z,size,hatch:true}] (square hatch) or [{x0,z0,x1,z1}] (stairwell)
    const holes = (opts.holes || []).map(h => h.size !== undefined ? { x0: h.x - h.size / 2, z0: h.z - h.size / 2, x1: h.x + h.size / 2, z1: h.z + h.size / 2, hatch: h.hatch !== false, x: h.x, z: h.z, size: h.size } : { ...h, hatch: false });
    const rects = [[x0, z0, x1, z1]];
    for (const hole of holes) {
      const hx0 = hole.x0, hx1 = hole.x1, hz0 = hole.z0, hz1 = hole.z1;
      const next = [];
      for (const [a0, b0, a1, b1] of rects) {
        if (hx1 <= a0 || hx0 >= a1 || hz1 <= b0 || hz0 >= b1) { next.push([a0, b0, a1, b1]); continue; }
        if (hz0 > b0) next.push([a0, b0, a1, hz0]);
        if (hz1 < b1) next.push([a0, hz1, a1, b1]);
        if (hx0 > a0) next.push([a0, Math.max(b0, hz0), hx0, Math.min(b1, hz1)]);
        if (hx1 < a1) next.push([hx1, Math.max(b0, hz0), a1, Math.min(b1, hz1)]);
      }
      rects.length = 0; rects.push(...next);
    }
    for (const [a0, b0, a1, b1] of rects) {
      if (a1 - a0 < 1e-3 || b1 - b0 < 1e-3) continue;
      this.box([a0, y - thickness, b0], [a1, y - 0.02, b1], bottomMat, { uvScale: 0.5, floor: opts.floor, tag: 'floor', physMat: opts.physMat || 'concrete' });
      this.box([a0, y - 0.02, b0], [a1, y, b1], topMat, { uvScale: opts.uvScale || 0.5, floor: opts.floor, tag: 'floor', physMat: opts.physMat || topMat });
    }
    for (const hole of holes) { if (hole.hatch) { const h = new Hatch(this, hole.x, hole.z, y, hole.size, opts.floor || 1); this.hatches.push(h); } }
  }

  // Railing around a rectangular floor opening (blocks movement, not vision). sides: subset of 'n','s','e','w'
  railing(x0, z0, x1, z1, y, sides = 'nsew', h = 1.0) {
    const t = 0.06; const mat = flat(0x2a2d33, 0.5, 0.7);
    const add = (min, max) => { this.box(min, max, 'metal', { material: mat, uvScale: 1, blocksVision: false, tag: 'rail', matVariant: 'rail', penetrable: true, penMult: 0.98 }); };
    if (sides.includes('s')) add([x0, y, z0 - t], [x1, y + h, z0 + t]);
    if (sides.includes('n')) add([x0, y, z1 - t], [x1, y + h, z1 + t]);
    if (sides.includes('w')) add([x0 - t, y, z0], [x0 + t, y + h, z1]);
    if (sides.includes('e')) add([x1 - t, y, z0], [x1 + t, y + h, z1]);
  }

  stairs(x, z, dir, width, rise, y0, opts = {}) {
    // dir: 'x+','x-','z+','z-' direction of ascent. Steps 0.2 high x 0.3 deep.
    const stepH = 0.2, stepD = 0.3; const n = Math.round(rise / stepH);
    const mat = opts.material || 'concrete';
    for (let i = 0; i < n; i++) {
      const top = y0 + (i + 1) * stepH; const a0 = i * stepD, a1 = (i + 1) * stepD;
      let min, max;
      if (dir === 'x+') { min = [x + a0, y0 - 0.02, z - width / 2]; max = [x + a1, top, z + width / 2]; }
      else if (dir === 'x-') { min = [x - a1, y0 - 0.02, z - width / 2]; max = [x - a0, top, z + width / 2]; }
      else if (dir === 'z+') { min = [x - width / 2, y0 - 0.02, z + a0]; max = [x + width / 2, top, z + a1]; }
      else { min = [x - width / 2, y0 - 0.02, z - a1]; max = [x + width / 2, top, z - a0]; }
      // step box extends down to y0 for solid look
      this.box(min, max, mat, { uvScale: 1, tag: 'stairs', floor: opts.floor });
    }
    // handrail
    const len = n * stepD;
    const railH = 0.95;
    const railMat = flat(0x2a2d33, 0.5, 0.7);
    const g = new THREE.BoxGeometry(dir[0] === 'x' ? len : 0.05, 0.05, dir[0] === 'z' ? len : 0.05);
    const m = new THREE.Mesh(g, railMat);
    const mid = len / 2; const cy = y0 + rise / 2 + railH;
    if (dir === 'x+') { m.position.set(x + mid, cy, z + width / 2 - 0.05); m.rotation.z = -Math.atan2(rise, len); }
    else if (dir === 'x-') { m.position.set(x - mid, cy, z + width / 2 - 0.05); m.rotation.z = Math.atan2(rise, len); }
    else if (dir === 'z+') { m.position.set(x + width / 2 - 0.05, cy, z + mid); m.rotation.x = Math.atan2(rise, len); }
    else { m.position.set(x + width / 2 - 0.05, cy, z - mid); m.rotation.x = -Math.atan2(rise, len); }
    m.castShadow = true; this.group.add(m);
    return { x, z, dir, len, width };
  }

  light(x, y, z, color, intensity, distance, opts = {}) {
    const l = new THREE.PointLight(color, intensity * 0.8, distance, 2);
    l.position.set(x, y - 0.35, z); l.castShadow = false;
    this.scene.add(l); this.lights.push(l);
    if (opts.fixture !== false) {
      const fix = new THREE.Mesh(new THREE.BoxGeometry(opts.fw || 0.6, 0.06, opts.fd || 0.6), flat(0xffffff, 0.6, 0, { emissive: new THREE.Color(color), emissiveIntensity: opts.emissive || 0.9 }));
      fix.position.set(x, y + 0.08, z); this.group.add(fix); this.emissives.push(fix);
    }
    return l;
  }

  room(name, floor, x0, z0, x1, z1, opts = {}) {
    const y = this.floorYs[floor];
    const r = { name, floor, min: new THREE.Vector3(x0, y, z0), max: new THREE.Vector3(x1, y + FLOOR_H, z1), center: new THREE.Vector3((x0 + x1) / 2, y + 1.2, (z0 + z1) / 2), ...opts };
    this.rooms.push(r); return r;
  }
  roomAt(p) {
    for (const r of this.rooms) if (p.x >= r.min.x && p.x <= r.max.x && p.z >= r.min.z && p.z <= r.max.z && p.y >= r.min.y - 0.5 && p.y < r.max.y) return r;
    return null;
  }
  isInterior(p) { const b = this.interiorBounds; return p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z && p.y < b.max.y; }

  // ---------- finalize: merge static geometry, build instanced cells ----------
  finalize() {
    for (const [key, { mat, geos }] of this._static) {
      if (!geos.length) continue;
      const merged = BufferGeometryUtils.mergeGeometries(geos, false);
      const m = new THREE.Mesh(merged, mat); m.castShadow = true; m.receiveShadow = true; m.name = 'static:' + key;
      this.group.add(m);
      for (const g of geos) g.dispose();
    }
    this._static.clear();

    // soft wall cells → instanced boxes (one per material)
    const cellsByMat = new Map();
    for (const wall of this.softWalls) {
      this._softOpenings(wall);
      for (let j = 0; j < wall.ny; j++) for (let i = 0; i < wall.nx; i++) {
        if (wall.inOpening(i, j)) continue;
        const c = wall.cellCenter(i, j);
        const hw = wall.horizontal ? CELL / 2 : wall.t / 2, hd = wall.horizontal ? wall.t / 2 : CELL / 2;
        const hh = Math.min(CELL, wall.y0 + wall.h - (c.y - CELL / 2)) / 2;
        const cy = c.y - CELL / 2 + hh;
        const col = new Collider(new THREE.Vector3(c.x - hw, cy - hh, c.z - hd), new THREE.Vector3(c.x + hw, cy + hh, c.z + hd), { material: 'drywall', penetrable: true, penMult: 0.72, owner: wall, tag: 'cell', floor: wall.floor });
        this.world.add(col);
        const cell = { wall, i, j, collider: col, dead: false, inst: -1, mat: wall.material, center: new THREE.Vector3(c.x, cy, c.z), hw, hh, hd };
        col.cell = cell;
        wall.cells[wall.cellIndex(i, j)] = cell; wall.alive++;
        if (!cellsByMat.has(wall.material)) cellsByMat.set(wall.material, []);
        cellsByMat.get(wall.material).push(cell);
      }
    }
    this._cellInst = new Map();
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    for (const [matName, cells] of cellsByMat) {
      const inst = new THREE.InstancedMesh(unit, cellMaterial(matName), cells.length);
      inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
      cells.forEach((cell, k) => {
        dummy.position.copy(cell.center); dummy.scale.set(cell.hw * 2, cell.hh * 2, cell.hd * 2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        inst.setMatrixAt(k, dummy.matrix); cell.inst = k; cell.instMesh = inst;
      });
      inst.instanceMatrix.needsUpdate = true; inst.name = 'cells:' + matName;
      this.group.add(inst); this._cellInst.set(matName, inst);
    }
    // metal cells (thermite leftovers) get their own instanced mesh, allocated lazily
    this._metalCells = [];
    // studs
    const studs = this._pendingStuds || [];
    if (studs.length) {
      const sg = new THREE.BoxGeometry(0.05, 1, 0.1);
      const inst = new THREE.InstancedMesh(sg, getMaterial('plank'), studs.length); inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
      studs.forEach((s, k) => { dummy.position.copy(s.c); dummy.scale.set(1, s.h, 1); dummy.rotation.set(0, s.wall.horizontal ? 0 : Math.PI / 2, 0); dummy.updateMatrix(); inst.setMatrixAt(k, dummy.matrix); s.inst = k; });
      inst.instanceMatrix.needsUpdate = true; this.group.add(inst); this._studInst = inst; this._studs = studs;
    }
    // hidden-instance dummy
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    // compute bounds
    this.bounds.setFromObject(this.group);
    // decals
    this._initDecals();
  }

  _hideInstance(cell) {
    if (cell.instMesh && cell.inst >= 0) { cell.instMesh.setMatrixAt(cell.inst, this._zero); cell.instMesh.instanceMatrix.needsUpdate = true; }
    if (cell.metalMesh) { cell.metalMesh.setMatrixAt(cell.metalInst, this._zero); cell.metalMesh.instanceMatrix.needsUpdate = true; }
    // knock out studs inside the hole
    if (this._studs) for (const s of this._studs) { if (s.wall === cell.wall && !s.dead && Math.abs(s.c.x - cell.center.x) < 0.3 && Math.abs(s.c.z - cell.center.z) < 0.3) { /* keep studs for realism unless explosion */ } }
  }
  removeStudsNear(p, r) {
    if (!this._studs) return;
    for (const s of this._studs) { if (s.dead) continue; const dx = s.c.x - p.x, dz = s.c.z - p.z; if (Math.hypot(dx, dz) < r) { s.dead = true; this._studInst.setMatrixAt(s.inst, this._zero); this._studInst.instanceMatrix.needsUpdate = true; } }
  }
  _setInstanceMaterial(cell, matName) {
    if (matName !== 'metal' || cell.metalMesh) return;
    // hide original, add to metal instanced mesh (grow lazily)
    if (cell.instMesh) { cell.instMesh.setMatrixAt(cell.inst, this._zero); cell.instMesh.instanceMatrix.needsUpdate = true; }
    if (!this._metalInst || this._metalCount >= this._metalInst.count) {
      const cap = (this._metalInst ? this._metalInst.count * 2 : 256);
      const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cellMaterial('metal'), cap); inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
      const old = this._metalInst; this._metalCount = this._metalCount || 0;
      if (old) { const m = new THREE.Matrix4(); for (let k = 0; k < this._metalCount; k++) { old.getMatrixAt(k, m); inst.setMatrixAt(k, m); } this.group.remove(old); }
      for (let k = this._metalCount; k < cap; k++) inst.setMatrixAt(k, this._zero);
      this.group.add(inst); this._metalInst = inst;
      for (const c of this._metalCells) c.metalMesh = inst;
    }
    const dummy = new THREE.Object3D(); dummy.position.copy(cell.center); dummy.scale.set(cell.hw * 2 + 0.04, cell.hh * 2, cell.hd * 2 + 0.04); dummy.updateMatrix();
    this._metalInst.setMatrixAt(this._metalCount, dummy.matrix); this._metalInst.instanceMatrix.needsUpdate = true;
    cell.metalMesh = this._metalInst; cell.metalInst = this._metalCount++; this._metalCells.push(cell);
  }

  // ---------- decals ----------
  _initDecals() {
    this.decalMax = 300;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.decalInst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: getSprite('bulletHole'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), this.decalMax);
    this.decalInst.frustumCulled = false; this.decalInst.renderOrder = 5;
    for (let i = 0; i < this.decalMax; i++) this.decalInst.setMatrixAt(i, this._zero);
    this.decalInst.instanceMatrix.needsUpdate = true; this.scene.add(this.decalInst); this._decalNext = 0;
    this.scorchMax = 40;
    this.scorchInst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: getSprite('scorch'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), this.scorchMax);
    this.scorchInst.frustumCulled = false; this.scorchInst.renderOrder = 4;
    for (let i = 0; i < this.scorchMax; i++) this.scorchInst.setMatrixAt(i, this._zero);
    this.scorchInst.instanceMatrix.needsUpdate = true; this.scene.add(this.scorchInst); this._scorchNext = 0;
    this.bloodMax = 60;
    this.bloodInst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: getSprite('blood'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), this.bloodMax);
    this.bloodInst.frustumCulled = false; this.bloodInst.renderOrder = 4;
    for (let i = 0; i < this.bloodMax; i++) this.bloodInst.setMatrixAt(i, this._zero);
    this.bloodInst.instanceMatrix.needsUpdate = true; this.scene.add(this.bloodInst); this._bloodNext = 0;
    this._decalDummy = new THREE.Object3D();
  }
  _placeDecal(inst, idx, point, normal, size) {
    const d = this._decalDummy; d.position.copy(point).addScaledVector(normal, 0.006);
    d.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    d.rotateZ(Math.random() * Math.PI * 2); d.scale.set(size, size, size); d.updateMatrix();
    inst.setMatrixAt(idx, d.matrix); inst.instanceMatrix.needsUpdate = true;
  }
  addBulletHole(point, normal, size = 0.06) { this._placeDecal(this.decalInst, this._decalNext, point, normal, size); this._decalNext = (this._decalNext + 1) % this.decalMax; }
  addScorch(point, normal, size = 1.5) { this._placeDecal(this.scorchInst, this._scorchNext, point, normal, size); this._scorchNext = (this._scorchNext + 1) % this.scorchMax; }
  addBlood(point, normal, size = 0.5) { this._placeDecal(this.bloodInst, this._bloodNext, point, normal, size); this._bloodNext = (this._bloodNext + 1) % this.bloodMax; }

  // ---------- damage / interaction ----------
  // Called for every bullet surface hit.
  bulletHit(hit, effects) {
    const c = hit.collider; const o = c.owner;
    if (c.tag === 'glass' && o && !o.broken) { this.breakGlass(o, effects); return; }
    if (c.tag === 'barricade' && o) { o.bullet(c); }
    if (c.tag === 'cell' || c.tag === 'wall' || c.tag === 'floor' || c.tag === 'static' || c.tag === 'barricade' || c.tag === 'hatch' || c.tag === 'reinforcement' || c.tag === 'stairs' || c.tag === 'prop' || c.tag === 'sill') {
      this.addBulletHole(hit.point, hit.normal, c.material === 'drywall' ? 0.075 : 0.055);
    }
  }
  breakGlass(pane, effects) {
    if (pane.broken) return; pane.broken = true;
    this.world.remove(pane.col); this.dynamicGroup.remove(pane.mesh);
    effects && effects.glassShatter(pane.center, pane.horizontal);
  }
  // Explosion: destroys soft wall cells / hatches / barricades / glass within radius.
  explode(center, radius, effects) {
    const p = center; let destroyed = 0;
    for (const wall of this.softWalls) {
      // quick reject
      const d = wall.horizontal ? Math.abs(p.z - wall.center.z) : Math.abs(p.x - wall.center.x);
      if (d > radius + 0.3) continue;
      const along = wall.horizontal ? p.x : p.z, a0 = wall.horizontal ? wall.x0 : wall.z0, a1 = wall.horizontal ? wall.x1 : wall.z1;
      if (along < a0 - radius || along > a1 + radius) continue;
      if (p.y < wall.y0 - radius || p.y > wall.y0 + wall.h + radius) continue;
      if (wall.reinforced) continue;
      const n = wall.destroyRadius(p, radius * 0.9);
      if (n) { destroyed += n; this.removeStudsNear(p, radius * 0.75); }
    }
    for (const h of this.hatches) if (!h.open && !h.reinforced && h.center.distanceTo(p) < radius + 0.6) h.destroy();
    for (const s of this.barricadeSlots) if (s.barricade && s.barricade.alive() && Math.hypot(s.x - p.x, s.z - p.z) < radius + 0.5 && Math.abs(s.y + s.h / 2 - p.y) < radius + 1) s.barricade.destroy();
    for (const g of this.glass) if (!g.broken && g.center.distanceTo(p) < radius + 2) this.breakGlass(g, effects);
    // scorch decal on nearest surface below/around
    const down = this.world.raycast(p, new THREE.Vector3(0, -1, 0), 3);
    if (down) this.addScorch(down.point, down.normal, radius * 1.4);
    return destroyed;
  }
  // Sledge hammer / melee against a surface
  hammer(hit) {
    const c = hit.collider;
    if (c.tag === 'cell' && c.owner && !c.owner.reinforced) {
      const wall = c.owner; const n = wall.destroyRect(hit.point, 0.55, 0.8); this.removeStudsNear(hit.point, 0.6); return n > 0 ? 'wall' : null;
    }
    if (c.tag === 'barricade' && c.owner) { c.owner.destroy(); return 'barricade'; }
    if (c.tag === 'hatch' && c.owner && !c.owner.reinforced) { c.owner.destroy(); return 'hatch'; }
    if (c.tag === 'glass' && c.owner) { this.breakGlass(c.owner); return 'glass'; }
    return null;
  }
  melee(hit, effects) {
    const c = hit.collider;
    if (c.tag === 'barricade' && c.owner) { c.owner.melee(hit.point); return 'barricade'; }
    if (c.tag === 'glass' && c.owner) { this.breakGlass(c.owner, effects); return 'glass'; }
    if (c.tag === 'hatch' && c.owner) { return c.owner.melee() ? 'hatch' : null; }
    if (c.tag === 'cell' && c.owner && !c.owner.reinforced) {
      // melee punches a single cell after 2 hits
      const cell = c.cell; cell.hits = (cell.hits || 0) + 1;
      if (cell.hits >= 2) { c.owner.destroyCell(cell); this.onWallChanged && this.onWallChanged(c.owner); }
      return 'wall';
    }
    return null;
  }

  // Find a barricade slot / soft wall / hatch the actor is looking at within reach.
  findInteractable(origin, dir, side, reach = 2.2) {
    const h = this.world.raycast(origin, dir, reach, { filter: c => c.solid || c.tag === 'glass' });
    const out = [];
    // barricade slots: near the opening plane (empty opening → no collider, so check geometrically)
    for (const s of this.barricadeSlots) {
      const cx = s.x, cz = s.z; const dx = cx - origin.x, dz = cz - origin.z; const dist = Math.hypot(dx, dz);
      if (dist > reach + s.w / 2) continue;
      if (origin.y < s.y - 0.5 || origin.y > s.y + s.h + 0.5) continue;
      // facing check
      const fx = dir.x, fz = dir.z; const fl = Math.hypot(fx, fz) || 1; const dot = (dx * fx + dz * fz) / (dist * fl + 1e-6);
      if (dot < 0.6) continue;
      const built = s.barricade.alive();
      if (!built && side === 'def') out.push({ type: 'barricade', slot: s, dist });
      if (built && s.barricade.built) out.push({ type: 'barricadeBuilt', slot: s, dist });
    }
    if (h) {
      const c = h.collider;
      if (c.tag === 'cell' && c.owner && side === 'def' && c.owner.reinforceable && !c.owner.reinforced && c.owner.alive === c.owner.cells.filter(x => x).length) out.push({ type: 'reinforce', wall: c.owner, dist: h.dist, point: h.point, normal: h.normal });
      if (c.tag === 'cell' && c.owner && c.owner.reinforced === false && side === 'atk') out.push({ type: 'softwall', wall: c.owner, dist: h.dist, point: h.point, normal: h.normal });
      if ((c.tag === 'reinforcement' || (c.tag === 'cell' && c.owner && c.owner.reinforced)) && side === 'atk') out.push({ type: 'reinforced', wall: c.owner, dist: h.dist, point: h.point, normal: h.normal });
      if (c.tag === 'reinforcement' && side === 'def' && c.owner) out.push({ type: 'reinforcedDef', wall: c.owner, dist: h.dist, point: h.point, normal: h.normal });
      if (c.tag === 'hatch' && c.owner && !c.owner.open) { if (side === 'def' && !c.owner.reinforced) out.push({ type: 'hatchReinforce', hatch: c.owner, dist: h.dist, point: h.point, normal: h.normal }); else out.push({ type: 'hatch', hatch: c.owner, dist: h.dist, point: h.point, normal: h.normal }); }
      if (c.tag === 'barricade' && c.owner) out.push({ type: 'barricadeHit', barricade: c.owner, dist: h.dist, point: h.point, normal: h.normal });
      if (c.solid && (c.tag === 'wall' || c.tag === 'floor' || c.tag === 'static' || c.tag === 'cell' || c.tag === 'prop' || c.tag === 'stairs')) out.push({ type: 'surface', dist: h.dist, point: h.point, normal: h.normal, collider: c });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  // Rappel: find the exterior wall face near a point on the ground outside.
  findRappelWall(pos, dir) {
    for (const w of this.rappelWalls) {
      const dist = w.horizontal ? Math.abs(pos.z - w.z0) : Math.abs(pos.x - w.x0);
      const along = w.horizontal ? pos.x : pos.z; const a0 = w.horizontal ? w.x0 : w.z0, a1 = w.horizontal ? w.x1 : w.z1;
      if (dist < 1.6 && along > a0 + 0.4 && along < a1 - 0.4 && pos.y < w.y0 + 0.6) {
        // must be facing the wall
        const n = w.horizontal ? new THREE.Vector3(0, 0, Math.sign(pos.z - w.z0) || 1) : new THREE.Vector3(Math.sign(pos.x - w.x0) || 1, 0, 0);
        if (dir.dot(n) < -0.35) return { wall: w, normal: n };
      }
    }
    return null;
  }
}
