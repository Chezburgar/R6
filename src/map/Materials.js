import * as THREE from 'three';

// Procedural texture + material library. Everything is generated on canvases at
// startup (value noise, grain, plank/tile patterns) with Sobel-derived normal maps.

// ---- noise -------------------------------------------------------------------
const _perm = new Uint8Array(512);
(() => { const p = []; for (let i = 0; i < 256; i++) p[i] = i; let seed = 1337; for (let i = 255; i > 0; i--) { seed = (seed * 16807) % 2147483647; const j = seed % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) _perm[i] = p[i & 255]; })();
function hash(x, y) { return _perm[(x & 255) + _perm[y & 255]] / 255; }
function smooth(t) { return t * t * (3 - 2 * t); }
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4, lac = 2, gain = 0.5) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); n += a; a *= gain; f *= lac; } return s / n; }
function rnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// ---- canvas helpers ------------------------------------------------------------
function canvas(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }
function tex(c, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
// Build color + height per pixel from a function, produce color and normal textures.
function generate(size, fn, opts = {}) {
  const c = canvas(size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
  const height = new Float32Array(size * size);
  const rough = opts.rough ? new Float32Array(size * size) : null;
  const out = { r: 0, g: 0, b: 0, h: 0, rough: 0.8 };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    fn(x / size, y / size, out, x, y);
    const i = (y * size + x) * 4;
    d[i] = Math.max(0, Math.min(255, out.r)); d[i + 1] = Math.max(0, Math.min(255, out.g)); d[i + 2] = Math.max(0, Math.min(255, out.b)); d[i + 3] = 255;
    height[y * size + x] = out.h;
    if (rough) rough[y * size + x] = out.rough;
  }
  ctx.putImageData(img, 0, 0);
  // normal map (Sobel, tileable)
  const n = canvas(size), nctx = n.getContext('2d'), nimg = nctx.createImageData(size, size), nd = nimg.data;
  const strength = opts.normalStrength || 2.0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
    const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
    const dy = (height[yd * size + x] - height[yu * size + x]) * strength;
    const len = Math.sqrt(dx * dx + dy * dy + 1);
    const i = (y * size + x) * 4;
    nd[i] = (-dx / len * 0.5 + 0.5) * 255; nd[i + 1] = (-dy / len * 0.5 + 0.5) * 255; nd[i + 2] = (1 / len * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  nctx.putImageData(nimg, 0, 0);
  let roughTex = null;
  if (rough) {
    const r = canvas(size), rctx = r.getContext('2d'), rimg = rctx.createImageData(size, size), rd = rimg.data;
    for (let i = 0; i < size * size; i++) { const v = Math.max(0, Math.min(255, rough[i] * 255)); rd[i * 4] = v; rd[i * 4 + 1] = v; rd[i * 4 + 2] = v; rd[i * 4 + 3] = 255; }
    rctx.putImageData(rimg, 0, 0); roughTex = r;
  }
  return { color: c, normal: n, rough: roughTex };
}

// ---- material recipes --------------------------------------------------------------------
const recipes = {
  concrete: { size: 512, repeat: 0.5, roughness: 0.92, metalness: 0, normalStrength: 2.5, fn: (u, v, o) => {
    const n = fbm(u * 8, v * 8, 5), g = fbm(u * 40 + 3, v * 40 + 7, 3), stain = fbm(u * 3 + 11, v * 3 + 5, 3);
    const base = 128 + (n - 0.5) * 40 + (g - 0.5) * 22 - Math.max(0, stain - 0.6) * 90;
    o.r = base * 1.02; o.g = base; o.b = base * 0.96; o.h = n * 0.6 + g * 0.4;
  } },
  plaster: { size: 512, repeat: 0.5, roughness: 0.85, metalness: 0, normalStrength: 1.2, fn: (u, v, o) => {
    const n = fbm(u * 6, v * 6, 4), g = fbm(u * 60 + 5, v * 60 + 9, 2);
    const grime = Math.pow(v, 3) * 0.5 + Math.max(0, fbm(u * 4 + 20, v * 4 + 3, 3) - 0.55) * 1.4;
    const base = 172 + (n - 0.5) * 18 + (g - 0.5) * 10;
    o.r = (base + 6) * (1 - grime * 0.55); o.g = (base - 2) * (1 - grime * 0.55); o.b = (base - 18) * (1 - grime * 0.5); o.h = g * 0.5 + n * 0.5;
  } },
  plasterGreen: { size: 512, repeat: 0.5, roughness: 0.85, metalness: 0, normalStrength: 1.2, fn: (u, v, o) => {
    const n = fbm(u * 6, v * 6, 4), g = fbm(u * 60 + 5, v * 60 + 9, 2);
    const grime = Math.pow(v, 3) * 0.5 + Math.max(0, fbm(u * 4 + 20, v * 4 + 3, 3) - 0.55) * 1.4;
    const base = 150 + (n - 0.5) * 18 + (g - 0.5) * 10;
    o.r = (base - 30) * (1 - grime * 0.5); o.g = (base - 5) * (1 - grime * 0.5); o.b = (base - 38) * (1 - grime * 0.5); o.h = g * 0.5 + n * 0.5;
  } },
  plasterBlue: { size: 512, repeat: 0.5, roughness: 0.85, metalness: 0, normalStrength: 1.2, fn: (u, v, o) => {
    const n = fbm(u * 6, v * 6, 4), g = fbm(u * 60 + 5, v * 60 + 9, 2);
    const grime = Math.pow(v, 3) * 0.5 + Math.max(0, fbm(u * 4 + 20, v * 4 + 3, 3) - 0.55) * 1.4;
    const base = 150 + (n - 0.5) * 18 + (g - 0.5) * 10;
    o.r = (base - 40) * (1 - grime * 0.5); o.g = (base - 14) * (1 - grime * 0.5); o.b = (base + 12) * (1 - grime * 0.5); o.h = g * 0.5 + n * 0.5;
  } },
  drywall: { size: 256, repeat: 1, roughness: 0.95, metalness: 0, normalStrength: 1.0, fn: (u, v, o) => {
    const g = fbm(u * 50, v * 50, 3), n = fbm(u * 5, v * 5, 3);
    const base = 176 + (g - 0.5) * 16 + (n - 0.5) * 10;
    o.r = base + 4; o.g = base; o.b = base - 8; o.h = g;
  } },
  wood: { size: 512, repeat: 0.5, roughness: 0.7, metalness: 0, normalStrength: 1.6, fn: (u, v, o) => {
    const plankW = 1 / 6; const p = Math.floor(v / plankW); const pv = (v % plankW) / plankW;
    const seedOff = p * 13.7; const grain = fbm(u * 3 + seedOff, v * 90, 4) * 0.6 + fbm(u * 30 + seedOff, v * 6, 2) * 0.4;
    const tint = 0.85 + (hash(p, 3) - 0.5) * 0.3;
    const gap = (pv < 0.03 || pv > 0.97) ? 0.45 : 1; const wear = fbm(u * 8 + seedOff, v * 8, 3);
    const r = (135 + grain * 55) * tint * gap * (0.85 + wear * 0.25), g = (92 + grain * 40) * tint * gap * (0.85 + wear * 0.25), b = (58 + grain * 25) * tint * gap * (0.85 + wear * 0.25);
    o.r = r; o.g = g; o.b = b; o.h = grain * 0.4 + gap * 0.6;
  } },
  woodLight: { size: 512, repeat: 0.5, roughness: 0.65, metalness: 0, normalStrength: 1.4, fn: (u, v, o) => {
    const plankW = 1 / 5; const p = Math.floor(v / plankW); const pv = (v % plankW) / plankW;
    const seedOff = p * 7.3; const grain = fbm(u * 3 + seedOff, v * 80, 4) * 0.6 + fbm(u * 25 + seedOff, v * 5, 2) * 0.4;
    const tint = 0.9 + (hash(p, 9) - 0.5) * 0.2; const gap = (pv < 0.03 || pv > 0.97) ? 0.5 : 1;
    o.r = (178 + grain * 50) * tint * gap; o.g = (140 + grain * 45) * tint * gap; o.b = (96 + grain * 30) * tint * gap; o.h = grain * 0.4 + gap * 0.6;
  } },
  plank: { size: 256, repeat: 1, roughness: 0.8, metalness: 0, normalStrength: 1.6, fn: (u, v, o) => {
    const grain = fbm(u * 2, v * 60, 4) * 0.6 + fbm(u * 20, v * 4, 2) * 0.4;
    o.r = 150 + grain * 50; o.g = 112 + grain * 40; o.b = 72 + grain * 25; o.h = grain;
  } },
  tile: { size: 512, repeat: 0.5, roughness: 0.55, metalness: 0.02, normalStrength: 2.2, fn: (u, v, o) => {
    const n = 4; const tu = (u * n) % 1, tv = (v * n) % 1; const ix = Math.floor(u * n), iy = Math.floor(v * n);
    const grout = (tu < 0.04 || tu > 0.96 || tv < 0.04 || tv > 0.96);
    const mottle = fbm(u * 12 + ix * 3, v * 12 + iy * 7, 3), vein = Math.pow(fbm(u * 5 + ix, v * 25 + iy, 3), 6);
    const light = ((ix + iy) & 1) === 0;
    let base = light ? 208 : 186; base += (mottle - 0.5) * 22 - vein * 60;
    if (grout) { base = 110 + (mottle - 0.5) * 20; }
    o.r = base + (light ? 6 : 2); o.g = base - 2; o.b = base - (light ? 16 : 22); o.h = grout ? 0 : 1 - vein * 0.2; o.rough = grout ? 0.95 : 0.55 + vein * 0.3;
  }, rough: true },
  tileDark: { size: 512, repeat: 0.5, roughness: 0.6, metalness: 0.02, normalStrength: 2.2, fn: (u, v, o) => {
    const n = 5; const tu = (u * n) % 1, tv = (v * n) % 1; const ix = Math.floor(u * n), iy = Math.floor(v * n);
    const grout = (tu < 0.035 || tu > 0.965 || tv < 0.035 || tv > 0.965);
    const mottle = fbm(u * 12 + ix * 3, v * 12 + iy * 7, 3);
    let base = 96 + (mottle - 0.5) * 24; if (grout) base = 70;
    o.r = base - 4; o.g = base; o.b = base + 4; o.h = grout ? 0 : 1; o.rough = grout ? 0.95 : 0.6;
  }, rough: true },
  carpet: { size: 256, repeat: 1, roughness: 1, metalness: 0, normalStrength: 0.8, fn: (u, v, o) => {
    const g = fbm(u * 80, v * 80, 2), n = fbm(u * 6, v * 6, 3);
    const base = 60 + (g - 0.5) * 22 + (n - 0.5) * 14;
    o.r = base * 0.9; o.g = base * 0.95; o.b = base * 1.15; o.h = g;
  } },
  metal: { size: 512, repeat: 1, roughness: 0.45, metalness: 0.9, normalStrength: 2.5, fn: (u, v, o) => {
    const brush = fbm(u * 2, v * 120, 3), n = fbm(u * 10, v * 10, 3);
    let base = 120 + (brush - 0.5) * 30 + (n - 0.5) * 20; let h = brush * 0.3;
    // panel seams + bolts every quarter
    const su = (u * 2) % 1, sv = (v * 2) % 1;
    if (su < 0.02 || sv < 0.02) { base -= 40; h = 0; }
    const bx = ((u * 2) % 1) - 0.09, by = ((v * 2) % 1) - 0.09;
    for (const [ox, oy] of [[0, 0], [0.82, 0], [0, 0.82], [0.82, 0.82]]) { const d = Math.hypot(bx - ox, by - oy); if (d < 0.035) { base += 30; h = 1 - d / 0.035; } }
    o.r = base; o.g = base + 2; o.b = base + 6; o.h = h;
  } },
  asphalt: { size: 512, repeat: 0.25, roughness: 0.95, metalness: 0, normalStrength: 2.0, fn: (u, v, o) => {
    const g = fbm(u * 90, v * 90, 3), n = fbm(u * 6, v * 6, 4), crack = Math.pow(1 - Math.abs(fbm(u * 5 + 40, v * 5 + 2, 4) - 0.5) * 2, 18);
    const base = 62 + (g - 0.5) * 30 + (n - 0.5) * 20 - crack * 30;
    o.r = base; o.g = base; o.b = base + 3; o.h = g * 0.5 - crack * 0.5;
  } },
  dirt: { size: 512, repeat: 0.25, roughness: 1, metalness: 0, normalStrength: 2.0, fn: (u, v, o) => {
    const g = fbm(u * 60, v * 60, 3), n = fbm(u * 5, v * 5, 4), p = fbm(u * 14 + 9, v * 14 + 4, 3);
    const base = 108 + (g - 0.5) * 34 + (n - 0.5) * 30;
    o.r = base * 1.0 + p * 8; o.g = base * 0.86; o.b = base * 0.66; o.h = g * 0.4 + n * 0.6;
  } },
  brick: { size: 512, repeat: 0.5, roughness: 0.9, metalness: 0, normalStrength: 3.0, fn: (u, v, o) => {
    const rows = 12, cols = 6; const row = Math.floor(v * rows); const off = (row & 1) ? 0.5 : 0; const bu = ((u * cols + off) % 1), bv = (v * rows) % 1;
    const mortar = bu < 0.06 || bv < 0.12; const bi = Math.floor(u * cols + off) + row * 7;
    const n = fbm(u * 40, v * 40, 3), t = hash(bi, row) * 0.3;
    let r, g, b, h;
    if (mortar) { r = g = b = 150 + (n - 0.5) * 30; h = 0; } else { r = 150 + t * 60 + (n - 0.5) * 25; g = 92 + t * 40 + (n - 0.5) * 20; b = 72 + t * 25 + (n - 0.5) * 20; h = 1 - n * 0.15; }
    o.r = r; o.g = g; o.b = b; o.h = h;
  } },
  ceiling: { size: 256, repeat: 1, roughness: 0.9, metalness: 0, normalStrength: 1.5, fn: (u, v, o) => {
    const tu = (u * 2) % 1, tv = (v * 2) % 1; const seam = tu < 0.03 || tv < 0.03; const g = fbm(u * 60, v * 60, 3);
    let base = 178 + (g - 0.5) * 24; if (seam) base = 110;
    o.r = base; o.g = base; o.b = base - 6; o.h = seam ? 0 : 1 - g * 0.3;
  } },
  roof: { size: 512, repeat: 0.5, roughness: 0.9, metalness: 0.1, normalStrength: 2.0, fn: (u, v, o) => {
    const g = fbm(u * 50, v * 50, 3), rib = Math.abs(Math.sin(u * Math.PI * 16)); let base = 90 + (g - 0.5) * 20 + rib * 14;
    o.r = base; o.g = base + 2; o.b = base + 6; o.h = rib;
  } },
  paper: { size: 256, repeat: 1, roughness: 0.9, metalness: 0, normalStrength: 0.6, fn: (u, v, o) => {
    const g = fbm(u * 30, v * 30, 2); const lines = ((v * 14) % 1) < 0.08 ? 0.8 : 1; const base = 225 + (g - 0.5) * 16;
    o.r = base * lines; o.g = base * lines; o.b = (base - 8) * lines; o.h = g;
  } },
  fabric: { size: 256, repeat: 1, roughness: 1, metalness: 0, normalStrength: 1.0, fn: (u, v, o) => {
    const g = fbm(u * 70, v * 70, 2), w = (Math.sin(u * 300) + Math.sin(v * 300)) * 0.25 + 0.5; const base = 70 + (g - 0.5) * 20 + w * 10;
    o.r = base * 0.7; o.g = base * 0.75; o.b = base; o.h = w;
  } },
};

const _cache = new Map();
export function getMaterial(name, overrides = {}) {
  const key = name + JSON.stringify(overrides);
  if (_cache.has(key)) return _cache.get(key);
  const R = recipes[name];
  if (!R) { const m = new THREE.MeshStandardMaterial({ color: 0xff00ff }); _cache.set(key, m); return m; }
  let gen = _cache.get('gen:' + name);
  if (!gen) { gen = generate(R.size, R.fn, { normalStrength: R.normalStrength, rough: R.rough }); _cache.set('gen:' + name, gen); }
  const rep = overrides.repeat !== undefined ? overrides.repeat : R.repeat;
  const m = new THREE.MeshStandardMaterial({
    map: tex(gen.color, rep, true), normalMap: tex(gen.normal, rep, false),
    roughness: overrides.roughness !== undefined ? overrides.roughness : R.roughness, metalness: overrides.metalness !== undefined ? overrides.metalness : R.metalness,
    color: overrides.color !== undefined ? overrides.color : 0xffffff,
  });
  if (gen.rough) m.roughnessMap = tex(gen.rough, rep, false);
  m.normalScale.set(overrides.normalScale || 1, overrides.normalScale || 1);
  if (overrides.emissive) { m.emissive = new THREE.Color(overrides.emissive); m.emissiveIntensity = overrides.emissiveIntensity || 1; }
  _cache.set(key, m);
  return m;
}

// Simple flat materials
const _flat = new Map();
export function flat(color, roughness = 0.6, metalness = 0, extra = {}) {
  const key = `${color}|${roughness}|${metalness}|${JSON.stringify(extra)}`;
  if (_flat.has(key)) return _flat.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  _flat.set(key, m); return m;
}
export function glassMaterial() {
  if (_flat.has('glass')) return _flat.get('glass');
  const m = new THREE.MeshPhysicalMaterial({ color: 0xbfd6e0, roughness: 0.05, metalness: 0, transmission: 0.0, transparent: true, opacity: 0.22, reflectivity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  _flat.set('glass', m); return m;
}

// ---- sprites & decals ---------------------------------------------------------------------
function spriteTex(size, fn) { const c = canvas(size); const ctx = c.getContext('2d'); fn(ctx, size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const _sprites = {};
export function getSprite(name) {
  if (_sprites[name]) return _sprites[name];
  let t;
  switch (name) {
    case 'bulletHole': t = spriteTex(64, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(8,8,8,1)'); g.addColorStop(0.25, 'rgba(20,18,16,0.95)'); g.addColorStop(0.45, 'rgba(60,55,50,0.55)'); g.addColorStop(0.7, 'rgba(90,85,80,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); ctx.strokeStyle = 'rgba(30,28,26,0.5)'; ctx.lineWidth = 1; for (let i = 0; i < 5; i++) { const a = Math.random() * Math.PI * 2; ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(a) * s * 0.45, s / 2 + Math.sin(a) * s * 0.45); ctx.stroke(); } }); break;
    case 'scorch': t = spriteTex(128, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(5,5,5,0.95)'); g.addColorStop(0.5, 'rgba(15,12,10,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); }); break;
    case 'blood': t = spriteTex(64, (ctx, s) => { ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0, 0, s, s); for (let i = 0; i < 18; i++) { const r = 2 + Math.random() * 9; const x = s / 2 + (Math.random() - 0.5) * s * 0.7, y = s / 2 + (Math.random() - 0.5) * s * 0.7; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(110,8,8,0.9)'); g.addColorStop(1, 'rgba(90,5,5,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); } }); break;
    case 'flash': t = spriteTex(128, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,250,230,1)'); g.addColorStop(0.2, 'rgba(255,220,150,0.9)'); g.addColorStop(0.5, 'rgba(255,150,60,0.35)'); g.addColorStop(1, 'rgba(255,100,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); ctx.strokeStyle = 'rgba(255,240,200,0.8)'; ctx.lineWidth = 3; for (let i = 0; i < 7; i++) { const a = Math.random() * Math.PI * 2, l = s * (0.25 + Math.random() * 0.25); ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(a) * l, s / 2 + Math.sin(a) * l); ctx.stroke(); } }); break;
    case 'smoke': t = spriteTex(128, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(200,200,200,0.75)'); g.addColorStop(0.4, 'rgba(180,180,180,0.4)'); g.addColorStop(1, 'rgba(160,160,160,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); for (let i = 0; i < 40; i++) { const x = Math.random() * s, y = Math.random() * s, r = 4 + Math.random() * 14; const d = Math.hypot(x - s / 2, y - s / 2) / (s / 2); if (d > 0.9) continue; const gg = ctx.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, `rgba(210,210,210,${0.25 * (1 - d)})`); gg.addColorStop(1, 'rgba(200,200,200,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); } }); break;
    case 'spark': t = spriteTex(32, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.3, 'rgba(255,180,80,0.8)'); g.addColorStop(1, 'rgba(255,120,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); }); break;
    case 'dust': t = spriteTex(64, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(200,190,170,0.6)'); g.addColorStop(0.5, 'rgba(190,180,160,0.25)'); g.addColorStop(1, 'rgba(180,170,150,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); }); break;
    case 'glow': t = spriteTex(64, (ctx, s) => { const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); }); break;
    case 'crack': t = spriteTex(128, (ctx, s) => { ctx.clearRect(0, 0, s, s); ctx.strokeStyle = 'rgba(235,240,245,0.85)'; ctx.lineWidth = 1.2; for (let i = 0; i < 12; i++) { let x = s / 2, y = s / 2, a = Math.random() * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { a += (Math.random() - 0.5) * 1.2; x += Math.cos(a) * s * 0.09; y += Math.sin(a) * s * 0.09; ctx.lineTo(x, y); } ctx.stroke(); } const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.12); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); }); break;
    case 'reticleDot': t = spriteTex(64, (ctx, s) => { ctx.clearRect(0, 0, s, s); const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, 7); g.addColorStop(0, 'rgba(255,40,40,1)'); g.addColorStop(0.5, 'rgba(255,40,40,0.9)'); g.addColorStop(1, 'rgba(255,40,40,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); }); break;
    default: t = spriteTex(16, (ctx, s) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, s, s); });
  }
  _sprites[name] = t; return t;
}

// A tileable "posters/papers" texture for desks
export function paperTexture() { return getMaterial('paper'); }
