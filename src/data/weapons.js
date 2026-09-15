// Weapon definitions. Stats follow Siege's live values (damage, RPM, magazine, ADS time)
// as closely as public data allows; model-space geometry maps each named weapon onto one
// of the four supplied GLB models (muzzle at -X, stock at +X, up +Y, right side -Z).

export const WeaponModels = {
  ar: {
    key: 'wpn_ar', scale: 0.44,
    muzzle: [-0.95, 0.125, 0.01], eject: [0.05, 0.2, -0.07],
    sight: [0.56, 0.313, 0.01], adsPitch: 0.0,
    scope: { lens: [0.405, 0.312, 0.01], radius: 0.052, mag: 2.5, objective: [-0.26, 0.328, 0.01] },
    gripR: [0.2, -0.2, 0.0], gripL: [-0.22, 0.06, 0.0],
    hip: { pos: [0.15, -0.13, -0.38], rot: [0, 0, 0] },
    length: 1.9,
  },
  smg: {
    key: 'wpn_smg', scale: 0.36,
    muzzle: [-0.95, 0.25, 0.0], eject: [0.0, 0.32, -0.07],
    sight: [0.5, 0.447, 0.0], adsPitch: 0.0,
    gripR: [0.22, -0.16, 0.0], gripL: [-0.32, 0.17, 0.0],
    hip: { pos: [0.14, -0.13, -0.34], rot: [0, 0, 0] },
    length: 1.9,
  },
  shotgun: {
    key: 'wpn_shotgun', scale: 0.53,
    muzzle: [-0.95, 0.06, 0.0], eject: [0.15, 0.15, -0.06],
    sight: [0.46, 0.275, 0.0], adsPitch: 0.092,
    gripR: [0.42, -0.07, 0.0], gripL: [-0.3, 0.0, 0.0],
    hip: { pos: [0.15, -0.14, -0.35], rot: [0, 0, 0] },
    length: 1.9,
  },
  pistol: {
    key: 'wpn_pistol', scale: 0.105,
    muzzle: [-0.93, 0.30, 0.0], eject: [0.25, 0.42, -0.1],
    sight: [0.9, 0.63, 0.0], adsPitch: 0.0,
    reddot: { window: [0.25, 0.63, 0.0] },
    gripR: [0.62, -0.35, 0.0], gripL: [0.5, -0.3, 0.14],
    hip: { pos: [0.13, -0.12, -0.30], rot: [0, 0, 0] },
    length: 1.9,
  },
};

// caliber → audio profile; class → behaviour
export const Weapons = {
  // --- assault rifles (AR model, 2.5x optic) ---
  L85A2:  { name: 'L85A2', cls: 'ar', model: 'ar', dmg: 47, rpm: 670, mag: 30, reserve: 150, reloadT: 2.7, reloadE: 3.3, ads: 0.32, zoom: 2.5, modes: ['auto', 'semi'], cal: '556', recoil: { v: 0.58, h: 0.22, ramp: 1.08, first: 1.35, rec: 22 }, spread: 2.4, fall: [25, 40, 0.6], pen: true, flash: 1.0 },
  AR33:   { name: 'AR33', cls: 'ar', model: 'ar', dmg: 41, rpm: 749, mag: 25, reserve: 150, reloadT: 2.6, reloadE: 3.2, ads: 0.3, zoom: 2.5, modes: ['auto', 'semi'], cal: '556', recoil: { v: 0.5, h: 0.2, ramp: 1.07, first: 1.3, rec: 24 }, spread: 2.3, fall: [25, 40, 0.6], pen: true, flash: 1.0 },
  'R4-C': { name: 'R4-C', cls: 'ar', model: 'ar', dmg: 39, rpm: 860, mag: 30, reserve: 150, reloadT: 2.5, reloadE: 3.1, ads: 0.3, zoom: 2.5, modes: ['auto', 'semi'], cal: '556', recoil: { v: 0.62, h: 0.26, ramp: 1.1, first: 1.3, rec: 24 }, spread: 2.5, fall: [25, 40, 0.6], pen: true, flash: 1.0 },
  '556XI': { name: '556XI', cls: 'ar', model: 'ar', dmg: 47, rpm: 690, mag: 30, reserve: 150, reloadT: 2.7, reloadE: 3.3, ads: 0.32, zoom: 2.5, modes: ['auto', 'semi'], cal: '556', recoil: { v: 0.6, h: 0.24, ramp: 1.08, first: 1.35, rec: 22 }, spread: 2.4, fall: [25, 40, 0.6], pen: true, flash: 1.0 },
  V308:   { name: 'V308', cls: 'ar', model: 'ar', dmg: 44, rpm: 700, mag: 50, reserve: 150, reloadT: 3.0, reloadE: 3.6, ads: 0.34, zoom: 2.5, modes: ['auto', 'semi'], cal: '762', recoil: { v: 0.66, h: 0.26, ramp: 1.08, first: 1.4, rec: 20 }, spread: 2.6, fall: [25, 40, 0.6], pen: true, flash: 1.1 },
  // --- submachine guns (SMG model, iron sights) ---
  MP5:    { name: 'MP5', cls: 'smg', model: 'smg', dmg: 27, rpm: 800, mag: 30, reserve: 180, reloadT: 2.3, reloadE: 2.8, ads: 0.26, zoom: 1.0, modes: ['auto', 'semi'], cal: '9mm', recoil: { v: 0.36, h: 0.16, ramp: 1.06, first: 1.2, rec: 26 }, spread: 2.0, fall: [18, 28, 0.6], pen: true, flash: 0.75 },
  '9MM C1': { name: '9MM C1', cls: 'smg', model: 'smg', dmg: 36, rpm: 575, mag: 34, reserve: 170, reloadT: 2.4, reloadE: 2.9, ads: 0.26, zoom: 1.0, modes: ['auto', 'semi'], cal: '9mm', recoil: { v: 0.42, h: 0.18, ramp: 1.06, first: 1.25, rec: 26 }, spread: 2.0, fall: [18, 28, 0.6], pen: true, flash: 0.75 },
  '9X19VSN': { name: '9x19VSN', cls: 'smg', model: 'smg', dmg: 34, rpm: 750, mag: 30, reserve: 180, reloadT: 2.3, reloadE: 2.8, ads: 0.26, zoom: 1.0, modes: ['auto', 'semi'], cal: '9mm', recoil: { v: 0.4, h: 0.18, ramp: 1.06, first: 1.25, rec: 26 }, spread: 2.0, fall: [18, 28, 0.6], pen: true, flash: 0.75 },
  MP5K:   { name: 'MP5K', cls: 'smg', model: 'smg', dmg: 30, rpm: 800, mag: 30, reserve: 180, reloadT: 2.2, reloadE: 2.7, ads: 0.24, zoom: 1.0, modes: ['auto', 'semi'], cal: '9mm', recoil: { v: 0.38, h: 0.2, ramp: 1.07, first: 1.2, rec: 26 }, spread: 2.1, fall: [18, 28, 0.6], pen: true, flash: 0.75 },
  MP7:    { name: 'MP7', cls: 'smg', model: 'smg', dmg: 32, rpm: 900, mag: 30, reserve: 180, reloadT: 2.2, reloadE: 2.7, ads: 0.24, zoom: 1.0, modes: ['auto', 'semi'], cal: '9mm', recoil: { v: 0.4, h: 0.22, ramp: 1.08, first: 1.2, rec: 26 }, spread: 2.1, fall: [18, 28, 0.6], pen: true, flash: 0.75 },
  // --- shotguns (pump model) ---
  M590A1: { name: 'M590A1', cls: 'shotgun', model: 'shotgun', dmg: 22, pellets: 8, rpm: 85, mag: 7, reserve: 42, reloadT: 0.55, reloadE: 0.55, ads: 0.3, zoom: 1.0, modes: ['pump'], cal: '12ga', recoil: { v: 2.6, h: 0.6, ramp: 1.0, first: 1.0, rec: 14 }, spread: 3.4, adsSpread: 2.2, fall: [5, 14, 0.15], pen: true, flash: 1.4, pumpT: 0.7 },
  'SUPER 90': { name: 'SUPER 90', cls: 'shotgun', model: 'shotgun', dmg: 18, pellets: 8, rpm: 220, mag: 8, reserve: 48, reloadT: 0.5, reloadE: 0.5, ads: 0.3, zoom: 1.0, modes: ['semi'], cal: '12ga', recoil: { v: 2.2, h: 0.5, ramp: 1.0, first: 1.0, rec: 16 }, spread: 3.4, adsSpread: 2.4, fall: [5, 14, 0.15], pen: true, flash: 1.4 },
  'SASG-12': { name: 'SASG-12', cls: 'shotgun', model: 'shotgun', dmg: 20, pellets: 8, rpm: 240, mag: 10, reserve: 40, reloadT: 2.6, reloadE: 3.0, ads: 0.3, zoom: 1.0, modes: ['semi'], cal: '12ga', recoil: { v: 2.2, h: 0.5, ramp: 1.0, first: 1.0, rec: 16 }, spread: 3.6, adsSpread: 2.5, fall: [5, 14, 0.15], pen: true, flash: 1.4, magReload: true },
  M1014:  { name: 'M1014', cls: 'shotgun', model: 'shotgun', dmg: 19, pellets: 8, rpm: 220, mag: 8, reserve: 48, reloadT: 0.5, reloadE: 0.5, ads: 0.3, zoom: 1.0, modes: ['semi'], cal: '12ga', recoil: { v: 2.2, h: 0.5, ramp: 1.0, first: 1.0, rec: 16 }, spread: 3.4, adsSpread: 2.4, fall: [5, 14, 0.15], pen: true, flash: 1.4 },
  M870:   { name: 'M870', cls: 'shotgun', model: 'shotgun', dmg: 26, pellets: 8, rpm: 85, mag: 7, reserve: 42, reloadT: 0.55, reloadE: 0.55, ads: 0.3, zoom: 1.0, modes: ['pump'], cal: '12ga', recoil: { v: 2.8, h: 0.6, ramp: 1.0, first: 1.0, rec: 14 }, spread: 3.2, adsSpread: 2.1, fall: [5, 14, 0.15], pen: true, flash: 1.4, pumpT: 0.7 },
  'SG-CQB': { name: 'SG-CQB', cls: 'shotgun', model: 'shotgun', dmg: 24, pellets: 8, rpm: 85, mag: 7, reserve: 42, reloadT: 0.55, reloadE: 0.55, ads: 0.3, zoom: 1.0, modes: ['pump'], cal: '12ga', recoil: { v: 2.6, h: 0.6, ramp: 1.0, first: 1.0, rec: 14 }, spread: 3.4, adsSpread: 2.2, fall: [5, 14, 0.15], pen: true, flash: 1.4, pumpT: 0.7 },
  // --- pistols (red-dot pistol model) ---
  'P226 MK 25': { name: 'P226 MK 25', cls: 'pistol', model: 'pistol', dmg: 50, rpm: 450, mag: 15, reserve: 60, reloadT: 1.5, reloadE: 1.9, ads: 0.2, zoom: 1.0, modes: ['semi'], cal: 'pistol', recoil: { v: 1.4, h: 0.3, ramp: 1.0, first: 1.0, rec: 30 }, spread: 1.6, fall: [12, 25, 0.6], pen: true, flash: 0.7 },
  '5.7 USG': { name: '5.7 USG', cls: 'pistol', model: 'pistol', dmg: 42, rpm: 450, mag: 20, reserve: 80, reloadT: 1.5, reloadE: 1.9, ads: 0.2, zoom: 1.0, modes: ['semi'], cal: 'pistol', recoil: { v: 1.2, h: 0.28, ramp: 1.0, first: 1.0, rec: 30 }, spread: 1.5, fall: [12, 25, 0.6], pen: true, flash: 0.7 },
  P9:     { name: 'P9', cls: 'pistol', model: 'pistol', dmg: 45, rpm: 450, mag: 16, reserve: 64, reloadT: 1.5, reloadE: 1.9, ads: 0.2, zoom: 1.0, modes: ['semi'], cal: 'pistol', recoil: { v: 1.3, h: 0.3, ramp: 1.0, first: 1.0, rec: 30 }, spread: 1.6, fall: [12, 25, 0.6], pen: true, flash: 0.7 },
  P12:    { name: 'P12', cls: 'pistol', model: 'pistol', dmg: 44, rpm: 450, mag: 15, reserve: 60, reloadT: 1.5, reloadE: 1.9, ads: 0.2, zoom: 1.0, modes: ['semi'], cal: 'pistol', recoil: { v: 1.3, h: 0.3, ramp: 1.0, first: 1.0, rec: 30 }, spread: 1.6, fall: [12, 25, 0.6], pen: true, flash: 0.7 },
  PMM:    { name: 'PMM', cls: 'pistol', model: 'pistol', dmg: 61, rpm: 400, mag: 8, reserve: 40, reloadT: 1.4, reloadE: 1.8, ads: 0.2, zoom: 1.0, modes: ['semi'], cal: 'pistol', recoil: { v: 1.6, h: 0.35, ramp: 1.0, first: 1.0, rec: 28 }, spread: 1.7, fall: [12, 25, 0.6], pen: true, flash: 0.75 },
  'MK1 9MM': { name: 'MK1 9mm', cls: 'pistol', model: 'pistol', dmg: 48, rpm: 450, mag: 13, reserve: 52, reloadT: 1.5, reloadE: 1.9, ads: 0.2, zoom: 1.0, modes: ['semi'], cal: 'pistol', recoil: { v: 1.4, h: 0.3, ramp: 1.0, first: 1.0, rec: 30 }, spread: 1.6, fall: [12, 25, 0.6], pen: true, flash: 0.7 },
};
for (const k in Weapons) Weapons[k].id = k;

export const HitZones = { head: 1000, torso: 1.0, limb: 0.75 };
