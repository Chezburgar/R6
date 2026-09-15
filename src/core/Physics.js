import * as THREE from 'three';

// Axis-aligned collision world. Everything static in the level is an AABB
// (walls, cells of destructible walls, props, stairs steps). A uniform grid gives
// fast broadphase for movement and 3D-DDA raycasts.

let _cid = 1;
export class Collider {
  constructor(min, max, opts = {}) {
    this.id = _cid++;
    this.min = min.clone ? min.clone() : new THREE.Vector3(min[0], min[1], min[2]);
    this.max = max.clone ? max.clone() : new THREE.Vector3(max[0], max[1], max[2]);
    this.material = opts.material || 'concrete';
    this.solid = opts.solid !== undefined ? opts.solid : true;
    this.penetrable = !!opts.penetrable;         // bullets pass through with damage loss
    this.penMult = opts.penMult !== undefined ? opts.penMult : 0.7;
    this.blocksVision = opts.blocksVision !== undefined ? opts.blocksVision : true;
    this.blocksNav = opts.blocksNav !== undefined ? opts.blocksNav : this.solid;
    this.owner = opts.owner || null;
    this.tag = opts.tag || '';
    this.enabled = true;
    this._cells = [];
    this._stamp = 0;
    this.floor = opts.floor !== undefined ? opts.floor : -1;
  }
  containsPoint(p) {
    return p.x >= this.min.x && p.x <= this.max.x && p.y >= this.min.y && p.y <= this.max.y && p.z >= this.min.z && p.z <= this.max.z;
  }
  center(out = new THREE.Vector3()) { return out.addVectors(this.min, this.max).multiplyScalar(0.5); }
}

const _tmpMin = new THREE.Vector3(), _tmpMax = new THREE.Vector3();

export class World {
  constructor(cellSize = 2) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.colliders = new Set();
    this._rayStamp = 1;
    this.onChange = null; // (collider, added:boolean) — used by nav to invalidate
  }

  _key(ix, iy, iz) { return ((ix + 512) << 20) | ((iy + 64) << 10) | (iz + 512); }
  _range(min, max) {
    const s = this.cellSize;
    return [Math.floor(min.x / s), Math.floor(min.y / s), Math.floor(min.z / s), Math.floor(max.x / s), Math.floor(max.y / s), Math.floor(max.z / s)];
  }

  add(c) {
    if (this.colliders.has(c)) return c;
    this.colliders.add(c);
    const [x0, y0, z0, x1, y1, z1] = this._range(c.min, c.max);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = this._key(x, y, z);
      let arr = this.grid.get(k);
      if (!arr) { arr = []; this.grid.set(k, arr); }
      arr.push(c); c._cells.push(k);
    }
    this.onChange && this.onChange(c, true);
    return c;
  }

  remove(c) {
    if (!this.colliders.has(c)) return;
    this.colliders.delete(c);
    for (const k of c._cells) {
      const arr = this.grid.get(k);
      if (arr) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); if (!arr.length) this.grid.delete(k); }
    }
    c._cells.length = 0;
    this.onChange && this.onChange(c, false);
  }

  // Colliders whose AABB overlaps [min,max]. Optional filter(c) => bool.
  query(min, max, out = [], filter = null) {
    out.length = 0;
    const stamp = ++this._rayStamp;
    const [x0, y0, z0, x1, y1, z1] = this._range(min, max);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const arr = this.grid.get(this._key(x, y, z));
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (c._stamp === stamp || !c.enabled) continue;
        c._stamp = stamp;
        if (c.max.x <= min.x || c.min.x >= max.x || c.max.y <= min.y || c.min.y >= max.y || c.max.z <= min.z || c.min.z >= max.z) continue;
        if (filter && !filter(c)) continue;
        out.push(c);
      }
    }
    return out;
  }

  overlaps(min, max, filter = null) {
    const stamp = ++this._rayStamp;
    const [x0, y0, z0, x1, y1, z1] = this._range(min, max);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const arr = this.grid.get(this._key(x, y, z));
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (c._stamp === stamp || !c.enabled || !c.solid) continue;
        c._stamp = stamp;
        if (c.max.x <= min.x || c.min.x >= max.x || c.max.y <= min.y || c.min.y >= max.y || c.max.z <= min.z || c.min.z >= max.z) continue;
        if (filter && !filter(c)) continue;
        return c;
      }
    }
    return null;
  }

  // Ray vs AABB slab test. Returns t or -1.
  static rayBox(o, d, invD, min, max, maxT) {
    let tmin = 0, tmax = maxT, nAxis = -1, nSign = 0;
    for (let a = 0; a < 3; a++) {
      const k = a === 0 ? 'x' : a === 1 ? 'y' : 'z';
      const inv = invD[k];
      let t1 = (min[k] - o[k]) * inv, t2 = (max[k] - o[k]) * inv;
      let sign = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
      if (t1 > tmin) { tmin = t1; nAxis = a; nSign = sign; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    return { t: tmin, axis: nAxis, sign: nSign, inside: nAxis === -1 };
  }

  // Raycast through the grid. opts: { filter(c)=>bool, ignore:Collider }
  // Returns { point, normal, dist, collider } or null.
  raycast(origin, dir, maxDist = 100, opts = null) {
    const s = this.cellSize;
    const filter = opts && opts.filter;
    const inv = { x: 1 / (dir.x || 1e-9), y: 1 / (dir.y || 1e-9), z: 1 / (dir.z || 1e-9) };
    let ix = Math.floor(origin.x / s), iy = Math.floor(origin.y / s), iz = Math.floor(origin.z / s);
    const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(s * inv.x), tDeltaY = Math.abs(s * inv.y), tDeltaZ = Math.abs(s * inv.z);
    // distance to the next cell boundary per axis; an axis the ray doesn't move along never steps
    let tMaxX = Math.abs(dir.x) < 1e-8 ? Infinity : ((stepX > 0 ? (ix + 1) * s : ix * s) - origin.x) * inv.x;
    let tMaxY = Math.abs(dir.y) < 1e-8 ? Infinity : ((stepY > 0 ? (iy + 1) * s : iy * s) - origin.y) * inv.y;
    let tMaxZ = Math.abs(dir.z) < 1e-8 ? Infinity : ((stepZ > 0 ? (iz + 1) * s : iz * s) - origin.z) * inv.z;
    const stamp = ++this._rayStamp;
    let best = null, bestT = maxDist;
    let t = 0;
    let guard = 0;
    while (t <= maxDist && guard++ < 400) {
      const arr = this.grid.get(this._key(ix, iy, iz));
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c._stamp === stamp || !c.enabled) continue;
          c._stamp = stamp;
          if (filter && !filter(c)) continue;
          const h = World.rayBox(origin, dir, inv, c.min, c.max, bestT);
          if (h && h.t < bestT) { bestT = h.t; best = { c, h }; }
        }
      }
      // advance
      if (tMaxX < tMaxY && tMaxX < tMaxZ) { t = tMaxX; ix += stepX; tMaxX += tDeltaX; }
      else if (tMaxY < tMaxZ) { t = tMaxY; iy += stepY; tMaxY += tDeltaY; }
      else { t = tMaxZ; iz += stepZ; tMaxZ += tDeltaZ; }
      if (best && bestT <= t) break;
    }
    if (!best) return null;
    const point = new THREE.Vector3().copy(origin).addScaledVector(dir, bestT);
    const normal = new THREE.Vector3();
    if (best.h.axis === 0) normal.set(best.h.sign, 0, 0); else if (best.h.axis === 1) normal.set(0, best.h.sign, 0); else normal.set(0, 0, best.h.sign);
    return { point, normal, dist: bestT, collider: best.c, inside: best.h.inside };
  }

  // Bullet trace: continues through penetrable colliders, returning every surface hit
  // in order with remaining damage multiplier. Stops at first non-penetrable.
  trace(origin, dir, maxDist, opts = null) {
    const hits = [];
    let o = origin.clone(), remaining = maxDist, mult = 1, guard = 0;
    const ignore = new Set();
    while (remaining > 0 && guard++ < 6) {
      const h = this.raycast(o, dir, remaining, { filter: c => !ignore.has(c) && (!opts || !opts.filter || opts.filter(c)) });
      if (!h) break;
      hits.push({ ...h, mult, entry: true });
      if (!h.collider.penetrable) break;
      mult *= h.collider.penMult;
      ignore.add(h.collider);
      // exit point: walk to the far side of the box
      const inv = { x: 1 / (dir.x || 1e-9), y: 1 / (dir.y || 1e-9), z: 1 / (dir.z || 1e-9) };
      let tExit = Infinity;
      for (const k of ['x', 'y', 'z']) {
        const t1 = (h.collider.min[k] - h.point[k]) * inv[k], t2 = (h.collider.max[k] - h.point[k]) * inv[k];
        const tf = Math.max(t1, t2); if (tf < tExit) tExit = tf;
      }
      const thickness = Math.max(0.01, tExit);
      const exit = h.point.clone().addScaledVector(dir, thickness + 0.002);
      hits.push({ point: exit, normal: dir.clone().negate(), dist: h.dist + thickness, collider: h.collider, mult, entry: false });
      remaining -= h.dist + thickness + 0.002;
      o = exit;
      if (mult < 0.15) break;
    }
    return hits;
  }

  // Line of sight test: true if nothing that blocks vision lies between a and b.
  visible(a, b, extraFilter = null) {
    const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); if (len < 1e-4) return true; d.divideScalar(len);
    const h = this.raycast(a, d, len, { filter: c => c.blocksVision && (!extraFilter || extraFilter(c)) });
    return !h;
  }

  // Ground height under a point (top of the highest solid below within maxDrop).
  groundAt(x, y, z, maxDrop = 4) {
    const o = new THREE.Vector3(x, y, z);
    const h = this.raycast(o, new THREE.Vector3(0, -1, 0), maxDrop, { filter: c => c.solid });
    return h ? h.point.y : null;
  }

  // Move an AABB (feet position `pos`, half width hw, height h) by delta with sliding,
  // step-up and ground detection. Mutates pos. Returns {grounded, hitWall, groundCollider}.
  moveBox(pos, hw, h, delta, stepHeight = 0.4, filter = null) {
    const res = { grounded: false, hitWall: false, ground: null, groundMat: 'concrete' };
    const q = this._q || (this._q = []);
    const eps = 0.001;
    const f = c => c.solid && (!filter || filter(c));
    // --- horizontal (X then Z), with step-up ---
    for (const axis of ['x', 'z']) {
      let d = delta[axis]; if (Math.abs(d) < 1e-7) continue;
      const tryMove = (yOff) => {
        _tmpMin.set(pos.x - hw, pos.y + yOff + eps, pos.z - hw); _tmpMax.set(pos.x + hw, pos.y + yOff + h - eps, pos.z + hw);
        _tmpMin[axis] += Math.min(0, d); _tmpMax[axis] += Math.max(0, d);
        this.query(_tmpMin, _tmpMax, q, f);
        let allowed = d;
        for (let i = 0; i < q.length; i++) {
          const c = q[i];
          // must overlap in the other two axes already
          const oa = axis === 'x' ? 'z' : 'x';
          if (c.max[oa] <= pos[oa] - hw + eps || c.min[oa] >= pos[oa] + hw - eps) continue;
          if (c.max.y <= pos.y + yOff + eps || c.min.y >= pos.y + yOff + h - eps) continue;
          // already interpenetrating along this axis (spawned inside a prop, etc.): don't block, let it slide out
          if (c.max[axis] > pos[axis] - hw + eps && c.min[axis] < pos[axis] + hw - eps) continue;
          if (d > 0) { const lim = c.min[axis] - hw - eps - pos[axis]; if (lim < allowed) allowed = Math.max(0, lim); }
          else { const lim = c.max[axis] + hw + eps - pos[axis]; if (lim > allowed) allowed = Math.min(0, lim); }
        }
        return allowed;
      };
      let allowed = tryMove(0);
      if (Math.abs(allowed) < Math.abs(d) - 1e-5) {
        // blocked — attempt step up
        const up = tryMove(stepHeight);
        if (Math.abs(up) > Math.abs(allowed) + 1e-4) {
          // check there is ground within stepHeight after moving
          const nx = pos.x + (axis === 'x' ? up : 0), nz = pos.z + (axis === 'z' ? up : 0);
          _tmpMin.set(nx - hw, pos.y + eps, nz - hw); _tmpMax.set(nx + hw, pos.y + stepHeight + eps, nz + hw);
          this.query(_tmpMin, _tmpMax, q, f);
          let top = -Infinity;
          for (let i = 0; i < q.length; i++) if (q[i].max.y > top && q[i].max.y <= pos.y + stepHeight + eps) top = q[i].max.y;
          // also require headroom at new height
          _tmpMin.set(nx - hw, top + eps, nz - hw); _tmpMax.set(nx + hw, top + h - eps, nz + hw);
          if (top > -Infinity && !this.overlaps(_tmpMin, _tmpMax, f)) {
            pos[axis] += up; pos.y = top + eps; continue;
          }
        }
        res.hitWall = true;
      }
      pos[axis] += allowed;
    }
    // --- vertical ---
    let dy = delta.y;
    if (Math.abs(dy) > 1e-7) {
      _tmpMin.set(pos.x - hw + eps, pos.y + Math.min(0, dy), pos.z - hw + eps); _tmpMax.set(pos.x + hw - eps, pos.y + h + Math.max(0, dy), pos.z + hw - eps);
      this.query(_tmpMin, _tmpMax, q, f);
      let allowed = dy;
      for (let i = 0; i < q.length; i++) {
        const c = q[i];
        if (c.max.x <= pos.x - hw + eps || c.min.x >= pos.x + hw - eps || c.max.z <= pos.z - hw + eps || c.min.z >= pos.z + hw - eps) continue;
        if (dy < 0) { if (c.max.y <= pos.y + eps) { const lim = c.max.y - pos.y; if (lim > allowed) { allowed = lim; res.ground = c; } } }
        else { if (c.min.y >= pos.y + h - eps) { const lim = c.min.y - (pos.y + h) - eps; if (lim < allowed) allowed = Math.max(0, lim); } }
      }
      if (dy < 0 && allowed > dy + 1e-6) { res.grounded = true; if (res.ground) res.groundMat = res.ground.material; }
      pos.y += allowed;
    }
    if (!res.grounded) {
      // probe just below feet
      _tmpMin.set(pos.x - hw + eps, pos.y - 0.05, pos.z - hw + eps); _tmpMax.set(pos.x + hw - eps, pos.y + 0.02, pos.z + hw - eps);
      this.query(_tmpMin, _tmpMax, q, f);
      for (let i = 0; i < q.length; i++) { const c = q[i]; if (c.max.y <= pos.y + 0.02 && c.max.y >= pos.y - 0.05) { res.grounded = true; res.ground = c; res.groundMat = c.material; break; } }
    }
    return res;
  }
}

export const Materials = {
  concrete: { pen: false, mult: 0 },
  brick: { pen: false, mult: 0 },
  drywall: { pen: true, mult: 0.7 },
  wood: { pen: true, mult: 0.6 },
  barricade: { pen: true, mult: 0.6 },
  metal: { pen: false, mult: 0 },
  reinforced: { pen: false, mult: 0 },
  glass: { pen: true, mult: 0.95 },
  dirt: { pen: false, mult: 0 },
  tile: { pen: false, mult: 0 },
  carpet: { pen: false, mult: 0 },
  shield: { pen: false, mult: 0 },
};
