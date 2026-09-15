import * as THREE from 'three';

// Layered navigation grid. Each (x,z) cell may hold several nodes at different
// ground heights (1F, 2F, stairs). Nodes link to 8 neighbours when the height step is
// walkable (<= STEP) and there is standing clearance; one-way "drop" links let bots
// fall through open hatches / off ledges. Cells are re-sampled when destruction opens
// walls, hatches or barricades change.

const RES = 0.5;
const STEP = 0.42;
const CLEAR_H = 1.65;
const HALF = 0.16;  // clearance probe half-width: cells beside a 0.16 m wall and 1 m doorways stay walkable
const _ed = new THREE.Vector3(), _eo = new THREE.Vector3();

export class NavGrid {
  constructor(world, bounds, floorYs) {
    this.world = world;
    this.min = new THREE.Vector3(bounds.min.x, 0, bounds.min.z);
    this.nx = Math.ceil((bounds.max.x - bounds.min.x) / RES); this.nz = Math.ceil((bounds.max.z - bounds.min.z) / RES);
    this.floorYs = floorYs;
    this.cells = new Array(this.nx * this.nz);   // each: array of nodes {y, walkable}
    this.dirty = new Set();
    this._id = 0;
    this._pathCache = new Map();
    this.buildAll();
    world.onChange = (c) => this.invalidate(c);
  }
  idx(ix, iz) { return iz * this.nx + ix; }
  cellOf(x, z) { return [Math.floor((x - this.min.x) / RES), Math.floor((z - this.min.z) / RES)]; }
  center(ix, iz) { return [this.min.x + (ix + 0.5) * RES, this.min.z + (iz + 0.5) * RES]; }

  buildAll() {
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) this.sample(ix, iz);
  }

  // Sample ground layers at a cell: cast down from each floor's ceiling
  sample(ix, iz) {
    const [x, z] = this.center(ix, iz);
    const nodes = [];
    const tops = [];
    for (let f = this.floorYs.length - 1; f >= 0; f--) tops.push(this.floorYs[f] + 2.6);
    tops.push(this.floorYs[this.floorYs.length - 1] + 6.6); // roof
    const o = new THREE.Vector3(), d = new THREE.Vector3(0, -1, 0);
    const min = new THREE.Vector3(), max = new THREE.Vector3();
    for (const top of tops) {
      o.set(x, top, z);
      let cursor = top; let guard = 0;
      while (guard++ < 4) {
        const h = this.world.raycast(o, d, cursor + 3, { filter: c => c.solid });
        if (!h) break;
        if (h.inside) { o.set(x, h.collider.min.y - 0.05, z); cursor = o.y; continue; }   // started inside a box: skip below it
        const y = h.point.y;
        if (!nodes.some(n => Math.abs(n.y - y) < 0.05)) {
          // clearance check: box from just above step height to head height (steps / low ledges are walkable)
          min.set(x - HALF, y + STEP, z - HALF); max.set(x + HALF, y + CLEAR_H, z + HALF);
          const blocked = this.world.overlaps(min, max, c => c.solid && c.blocksNav !== false);
          // tops of props (tables, crates, vehicles) are not walking surfaces
          const onProp = h.collider.tag === 'prop' || h.collider.tag === 'rail' || h.collider.tag === 'gadget' || h.collider.tag === 'shield';
          const walkable = !blocked && !onProp;
          // edge mask: which of the 4 orthogonal neighbours can be reached without crossing a wall/prop
          let edges = 0, bars = 0;
          if (walkable) {
            for (let k = 0; k < 4; k++) {
              const dx = k === 0 ? 1 : k === 1 ? -1 : 0, dz = k === 2 ? 1 : k === 3 ? -1 : 0;
              _ed.set(dx, 0, dz); let open = true, bar = false;
              for (const hh of [0.45, 1.25]) {
                _eo.set(x, y + hh, z);
                if (this.world.raycast(_eo, _ed, RES + 0.12, { filter: c => c.solid && c.blocksNav !== false })) { open = false; break; }
                if (!bar && this.world.raycast(_eo, _ed, RES + 0.12, { filter: c => c.tag === 'barricade' })) bar = true;
              }
              if (open) { edges |= (1 << k); if (bar) bars |= (1 << k); }
            }
          }
          nodes.push({ y, walkable, edges, bars, mat: h.collider.material, ix, iz, id: this._id++ });
        }
        // continue below this surface
        o.set(x, y - 0.3, z); cursor = y - 0.3;
        if (y < 0.05) break;
      }
    }
    nodes.sort((a, b) => b.y - a.y);
    this.cells[this.idx(ix, iz)] = nodes;
    return nodes;
  }

  invalidate(c) {
    const [x0, z0] = this.cellOf(c.min.x - RES, c.min.z - RES); const [x1, z1] = this.cellOf(c.max.x + RES, c.max.z + RES);
    for (let iz = Math.max(0, z0); iz <= Math.min(this.nz - 1, z1); iz++) for (let ix = Math.max(0, x0); ix <= Math.min(this.nx - 1, x1); ix++) this.dirty.add(this.idx(ix, iz));
    this._pathCache.clear();
  }
  flush() {
    if (!this.dirty.size) return;
    for (const i of this.dirty) { const ix = i % this.nx, iz = (i / this.nx) | 0; this.sample(ix, iz); }
    this.dirty.clear();
  }

  // nearest walkable node to a world point
  nearest(p, maxR = 3) {
    const [cx, cz] = this.cellOf(p.x, p.z);
    let best = null, bestD = Infinity;
    const r = Math.ceil(maxR / RES);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const ix = cx + dx, iz = cz + dz; if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) continue;
      const nodes = this.cells[this.idx(ix, iz)]; if (!nodes) continue;
      for (const n of nodes) {
        if (!n.walkable) continue;
        const dy = n.y - p.y; if (dy > 1.0 || dy < -1.2) continue;
        const d = dx * dx + dz * dz + dy * dy * 8;
        if (d < bestD) { bestD = d; best = n; }
      }
    }
    return best;
  }

  neighbors(n, out, side = 'atk') {
    out.length = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const ix = n.ix + dx, iz = n.iz + dz; if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) continue;
      const nodes = this.cells[this.idx(ix, iz)]; if (!nodes) continue;
      // edge bits: 0:+x 1:-x 2:+z 3:-z
      const bx = dx ? (dx > 0 ? 1 : 2) : 0, bz = dz ? (dz > 0 ? 4 : 8) : 0;
      if (bx && !(n.edges & bx)) continue;
      if (bz && !(n.edges & bz)) continue;
      // barricaded edge: defenders never cross, attackers pay to breach
      const barred = (bx && (n.bars & bx)) || (bz && (n.bars & bz));
      if (barred && (side === 'def' || (dx && dz))) continue;
      const barCost = barred ? 14 : 0;
      for (const m of nodes) {
        if (!m.walkable) continue;
        const dy = m.y - n.y;
        if (dy > STEP) continue;
        if (dy < -STEP) { if (dy < -3.6 || (dx && dz)) continue; out.push({ n: m, cost: 2.5 + Math.abs(dy), drop: true }); continue; }
        if (dx && dz) {
          // no corner cutting: both orthogonal neighbours must be walkable at similar height and open toward m
          const a = this.cells[this.idx(n.ix + dx, n.iz)], b = this.cells[this.idx(n.ix, n.iz + dz)];
          const qa = a && a.find(q => q.walkable && Math.abs(q.y - n.y) <= STEP), qb = b && b.find(q => q.walkable && Math.abs(q.y - n.y) <= STEP);
          if (!qa || !qb) continue;
          if (!(qa.edges & bz) || !(qb.edges & bx)) continue;
          out.push({ n: m, cost: 1.414 + Math.abs(dy) * 1.5 });
        } else out.push({ n: m, cost: 1 + Math.abs(dy) * 1.5 + barCost });
      }
    }
    return out;
  }

  // A* from world point a to b. Returns array of Vector3 (or null).
  findPath(a, b, side = 'atk', maxNodes = 6000) {
    this.flush();
    const start = this.nearest(a, 2.5), goal = this.nearest(b, 3.5);
    if (!start || !goal) return null;
    if (start === goal) return [new THREE.Vector3(b.x, goal.y, b.z)];
    const key = side + ':' + start.id + ':' + goal.id;
    const cached = this._pathCache.get(key); if (cached) return cached.map(v => v.clone());
    const open = new MinHeap(); const g = new Map(); const came = new Map();
    const h = n => Math.hypot(n.ix - goal.ix, n.iz - goal.iz) + Math.abs(n.y - goal.y) * 2;
    g.set(start.id, 0); open.push(start, h(start));
    const closed = new Set(); const nb = []; let expanded = 0;
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) break;
      if (closed.has(cur.id)) continue; closed.add(cur.id);
      if (++expanded > maxNodes) return null;
      this.neighbors(cur, nb, side);
      for (let i = 0; i < nb.length; i++) {
        const e = nb[i]; const m = e.n; if (closed.has(m.id)) continue;
        const ng = g.get(cur.id) + e.cost;
        if (ng < (g.has(m.id) ? g.get(m.id) : Infinity)) { g.set(m.id, ng); came.set(m.id, cur); open.push(m, ng + h(m)); }
      }
    }
    if (!came.has(goal.id)) return null;
    const path = []; let n = goal;
    while (n && n !== start) { path.push(n); n = came.get(n.id); }
    path.push(start); path.reverse();
    // string-pull: drop intermediate nodes with clear straight lines
    const pts = path.map(n => { const [x, z] = this.center(n.ix, n.iz); return new THREE.Vector3(x, n.y, z); });
    const simplified = this.simplify(pts);
    simplified[simplified.length - 1].set(b.x, goal.y, b.z);
    if (this._pathCache.size > 400) this._pathCache.clear();
    this._pathCache.set(key, simplified.map(v => v.clone()));
    return simplified;
  }

  simplify(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]]; let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) { if (Math.abs(pts[j].y - pts[i].y) < 0.3 && this.clear(pts[i], pts[j])) break; }
      out.push(pts[j]); i = j;
    }
    return out;
  }
  // walkable node in the exact cell containing p, at a similar height
  walkableAt(p, y) {
    const [ix, iz] = this.cellOf(p.x, p.z); if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return null;
    const nodes = this.cells[this.idx(ix, iz)]; if (!nodes) return null;
    for (const n of nodes) if (n.walkable && Math.abs(n.y - y) <= 0.3) return n;
    return null;
  }
  // straight-line walkability between two points at similar height (body-width swept)
  clear(a, b) {
    const d = a.distanceTo(b); const n = Math.ceil(d / (RES * 0.5)); const p = new THREE.Vector3();
    const dir = new THREE.Vector3().subVectors(b, a); dir.y = 0; const len = dir.length(); if (len < 1e-3) return true; dir.divideScalar(len);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let k = 1; k < n; k++) {
      p.lerpVectors(a, b, k / n);
      if (!this.walkableAt(p, a.y)) return false;
      p.addScaledVector(side, 0.25); if (!this.walkableAt(p, a.y)) return false;
      p.addScaledVector(side, -0.5); if (!this.walkableAt(p, a.y)) return false;
    }
    // swept rays at knee & chest height for props (centre and both shoulders)
    const o = new THREE.Vector3();
    for (const lat of [0, 0.3, -0.3]) for (const h of [0.5, 1.3]) {
      o.copy(a).addScaledVector(side, lat); o.y = a.y + h;
      if (this.world.raycast(o, dir, len, { filter: c => c.solid && c.blocksNav !== false })) return false;
    }
    return true;
  }

  randomWalkableNear(p, r) {
    for (let k = 0; k < 20; k++) {
      const q = new THREE.Vector3(p.x + (Math.random() - 0.5) * 2 * r, p.y, p.z + (Math.random() - 0.5) * 2 * r);
      const n = this.nearest(q, 0.5); if (n) { const [x, z] = this.center(n.ix, n.iz); return new THREE.Vector3(x, n.y, z); }
    }
    return null;
  }
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v, p) { const a = this.a; a.push({ v, p }); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j].p <= a[i].p) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].p < a[m].p) m = l; if (r < a.length && a[r].p < a[m].p) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top.v; }
}
