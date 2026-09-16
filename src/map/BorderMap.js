import * as THREE from 'three';
import { Level, FLOOR_H } from './Level.js';
import { getMaterial, flat, glassMaterial } from './Materials.js';
import { Collider } from '../core/Physics.js';

// BORDER — a two-storey border-crossing office. 32m x 22m footprint.
// Bomb sites: 1F Tellers/Bathroom, 1F Customs Inspection/Supply Room, 2F Armory Lockers/Archives.

const WALL_H = 3.2;
const F1 = 0, F2 = FLOOR_H;
const win = (at, w = 1.5, y = 1.0, h = 1.5) => ({ at, w, y, h, kind: 'window' });
const door = (at, w = 1.0, h = 2.2) => ({ at, w, y: 0, h, kind: 'door' });
const arch = (at, w, h = 2.6) => ({ at, w, y: 0, h, kind: 'arch' });
const garage = (at, w = 3.5, h = 2.8) => ({ at, w, y: 0, h, kind: 'garage' });
const dhole = (at) => ({ at, w: 0.5, y: 0, h: 0.36, kind: 'drone' });   // drone hole at floor level

export const SITES = [
  { id: 'tellers', name: '1F TELLERS / BATHROOM', rooms: ['Tellers', 'Bathroom'], floor: 0 },
  { id: 'customs', name: '1F CUSTOMS INSPECTION / SUPPLY ROOM', rooms: ['Customs Inspection', 'Supply Room'], floor: 0 },
  { id: 'armory', name: '2F ARMORY LOCKERS / ARCHIVES', rooms: ['Armory Lockers', 'Archives'], floor: 1 },
];

export function buildBorder(world, scene) {
  const L = new Level(world, scene);
  L.interiorBounds.set(new THREE.Vector3(0, -1, 0), new THREE.Vector3(32, 7, 22));

  // ---------------- rooms ----------------
  const R = (name, f, x0, z0, x1, z1, o) => L.room(name, f, x0, z0, x1, z1, o);
  // 1F
  R('Tellers', 0, 0, 0, 10, 8, { floorMat: 'tile', wallMat: 'plaster' });
  R('Bathroom', 0, 0, 8, 4, 14, { floorMat: 'tileDark', wallMat: 'plasterBlue' });
  R('Ventilation Room', 0, 4, 8, 10, 14, { floorMat: 'concrete', wallMat: 'concrete' });
  R('Workshop', 0, 0, 14, 10, 22, { floorMat: 'concrete', wallMat: 'plasterGreen' });
  R('Lobby', 0, 10, 0, 20, 8, { floorMat: 'tile', wallMat: 'plaster' });
  R('Main Hallway', 0, 10, 8, 20, 14, { floorMat: 'tile', wallMat: 'plaster' });
  R('Waiting Room', 0, 10, 14, 18, 22, { floorMat: 'tile', wallMat: 'plasterGreen' });
  R('Detention', 0, 18, 14, 24, 22, { floorMat: 'concrete', wallMat: 'plasterBlue' });
  R('Exit Hallway', 0, 24, 14, 32, 22, { floorMat: 'tileDark', wallMat: 'plaster' });
  R('Customs Inspection', 0, 20, 0, 32, 8, { floorMat: 'concrete', wallMat: 'plaster' });
  R('Supply Room', 0, 20, 8, 26, 14, { floorMat: 'concrete', wallMat: 'plasterGreen' });
  R('Passport Check', 0, 26, 8, 32, 14, { floorMat: 'tile', wallMat: 'plasterBlue' });
  // 2F
  R('Armory Lockers', 1, 0, 0, 10, 8, { floorMat: 'tileDark', wallMat: 'plasterGreen' });
  R('Archives', 1, 0, 8, 10, 14, { floorMat: 'carpet', wallMat: 'plaster' });
  R('Break Room', 1, 0, 14, 10, 22, { floorMat: 'tile', wallMat: 'plasterBlue' });
  R('Offices', 1, 10, 0, 20, 8, { floorMat: 'carpet', wallMat: 'plaster' });
  R('Upper Hallway', 1, 10, 8, 20, 14, { floorMat: 'tileDark', wallMat: 'plaster' });
  R('Security Room', 1, 10, 14, 18, 22, { floorMat: 'carpet', wallMat: 'plasterBlue' });
  R('Fountain', 1, 18, 14, 24, 22, { floorMat: 'tile', wallMat: 'plaster' });
  R('Upper Exit', 1, 24, 14, 32, 22, { floorMat: 'tileDark', wallMat: 'plaster' });
  R('Kitchen', 1, 20, 0, 32, 8, { floorMat: 'tile', wallMat: 'plaster' });
  R('East Hallway', 1, 20, 8, 32, 14, { floorMat: 'tileDark', wallMat: 'plasterGreen' });

  // ---------------- ground & floors ----------------
  L.box([-40, -1.2, -40], [72, 0, 62], 'dirt', { uvScale: 0.25, tag: 'floor', physMat: 'dirt', floor: 0 });
  // asphalt road south and east
  L.box([-40, -0.01, -14], [72, 0.02, -3], 'asphalt', { uvScale: 0.25, tag: 'floor', physMat: 'concrete', floor: 0 });
  L.box([36, -0.01, -14], [46, 0.02, 40], 'asphalt', { uvScale: 0.25, tag: 'floor', physMat: 'concrete', floor: 0 });
  L.box([-14, -0.01, -14], [-4, 0.02, 40], 'asphalt', { uvScale: 0.25, tag: 'floor', physMat: 'concrete', floor: 0 });
  // pavement apron around the building
  L.box([-2, -0.005, -2], [34, 0.03, 24], 'concrete', { uvScale: 0.5, tag: 'floor', physMat: 'concrete', floor: 0 });
  // 1F floors per room
  const floorMatOf = r => r.floorMat;
  for (const r of L.rooms.filter(r => r.floor === 0)) L.box([r.min.x, 0.03, r.min.z], [r.max.x, 0.06, r.max.z], floorMatOf(r), { uvScale: 0.5, tag: 'floor', physMat: floorMatOf(r) === 'tile' || floorMatOf(r) === 'tileDark' ? 'tile' : floorMatOf(r), floor: 0 });
  // 2F slabs with hatches and stairwells
  const hatches = [
    { x: 3, z: 6, size: 1.2, hatch: true },        // Armory -> Tellers
    { x: 8, z: 12, size: 1.2, hatch: true },       // Archives -> Vent Room
    { x: 21, z: 19, size: 1.2, hatch: true },      // Fountain -> Detention
    { x: 26, z: 4, size: 1.2, hatch: true },       // Kitchen -> Customs
    { x: 14, z: 19.5, size: 1.2, hatch: true },    // Security -> Waiting
    { x: 29, z: 11, size: 1.2, hatch: true },      // East Hallway -> Passport
  ];
  const mainStairHole = { x0: 10.4, z0: 10.1, x1: 15.6, z1: 11.9 };
  const eastStairHole = { x0: 30.1, z0: 14.4, x1: 31.9, z1: 19.6 };
  for (const r of L.rooms.filter(r => r.floor === 1)) {
    const holes = hatches.filter(h => h.x > r.min.x && h.x < r.max.x && h.z > r.min.z && h.z < r.max.z);
    if (r.name === 'Upper Hallway') holes.push(mainStairHole);
    if (r.name === 'Upper Exit') holes.push(eastStairHole);
    L.floorSlab(r.min.x, r.min.z, r.max.x, r.max.z, F2, 0.2, r.floorMat, 'ceiling', { holes, floor: 1, physMat: r.floorMat === 'carpet' ? 'carpet' : (r.floorMat.startsWith('tile') ? 'tile' : 'concrete') });
  }
  // roof
  L.floorSlab(0, 0, 32, 22, F2 + WALL_H + 0.2, 0.2, 'roof', 'ceiling', { floor: 2 });
  // parapet
  L.box([-0.2, F2 + WALL_H + 0.2, -0.2], [32.2, F2 + WALL_H + 0.9, 0.2], 'concrete', { uvScale: 0.5 });
  L.box([-0.2, F2 + WALL_H + 0.2, 21.8], [32.2, F2 + WALL_H + 0.9, 22.2], 'concrete', { uvScale: 0.5 });
  L.box([-0.2, F2 + WALL_H + 0.2, -0.2], [0.2, F2 + WALL_H + 0.9, 22.2], 'concrete', { uvScale: 0.5 });
  L.box([31.8, F2 + WALL_H + 0.2, -0.2], [32.2, F2 + WALL_H + 0.9, 22.2], 'concrete', { uvScale: 0.5 });
  // stair railings on 2F
  L.railing(mainStairHole.x0, mainStairHole.z0, mainStairHole.x1, mainStairHole.z1, F2, 'nws');
  L.railing(eastStairHole.x0, eastStairHole.z0, eastStairHole.x1, eastStairHole.z1, F2, 'sw');

  // ---------------- exterior walls ----------------
  const EXT = (x0, z0, x1, z1, floor, openings, outward) => L.hardWall(x0, z0, x1, z1, floor ? F2 : F1, WALL_H, 'concrete', { openings, exterior: true, floor, outward, uvScale: 0.5, skin: floor ? 'plasterBlue' : 'plaster' });
  // 1F
  EXT(0, 0, 32, 0, 0, [win(2), dhole(4.6), win(6), dhole(11.5), door(14, 2, 2.5), dhole(19.5), win(23), dhole(26.5), win(28)], -1);   // south
  EXT(0, 22, 32, 22, 0, [win(2), dhole(4.6), win(6.5), dhole(10.5), door(13), dhole(17), win(20.5), dhole(24.5), door(27)], 1);   // north
  EXT(0, 0, 0, 22, 0, [win(2), dhole(4), win(5), dhole(8), win(10.5, 1, 1.4, 0.8), dhole(14.5), door(17), dhole(19.5)], -1);   // west
  EXT(32, 0, 32, 22, 0, [garage(2), dhole(7.5), win(10), dhole(13.5), dhole(17.5), door(20.5)], 1);   // east
  // 2F
  EXT(0, 0, 32, 0, 1, [win(2), win(6), win(12), win(17), win(23), win(28)], -1);
  EXT(0, 22, 32, 22, 1, [win(2), win(6.5), win(13.5), win(20.5), win(27)], 1);
  EXT(0, 0, 0, 22, 1, [win(3), win(10.5), win(17)], -1);
  EXT(32, 0, 32, 22, 1, [win(3), win(10.5), win(17)], 1);

  // ---------------- interior walls ----------------
  const SOFT = (x0, z0, x1, z1, floor, openings, mat = 'plaster') => L.softWall(x0, z0, x1, z1, floor ? F2 : F1, WALL_H, { openings, floor, material: mat });
  const HARD = (x0, z0, x1, z1, floor, openings) => L.hardWall(x0, z0, x1, z1, floor ? F2 : F1, WALL_H, 'concrete', { openings, floor, thickness: 0.3, uvScale: 0.5 });
  // 1F
  SOFT(10, 0, 10, 8, 0, [door(3)]);                                  // Tellers | Lobby
  SOFT(0, 8, 10, 8, 0, [door(1.5), door(6.5)]);                      // Tellers | Bathroom/Vent
  SOFT(4, 8, 4, 14, 0, [door(2.5)], 'plasterBlue');                  // Bathroom | Vent
  SOFT(10, 8, 10, 14, 0, [door(4.5)]);                               // Vent | Main Hallway
  SOFT(0, 14, 10, 14, 0, [door(5.5)], 'plasterGreen');               // Vent/Bath | Workshop
  SOFT(10, 14, 10, 22, 0, [door(3.5)], 'plasterGreen');              // Workshop | Waiting
  SOFT(10, 8, 20, 8, 0, [arch(2.5, 5)]);                             // Lobby | Main Hallway
  HARD(20, 0, 20, 8, 0, [dhole(1.2), door(3.5, 1.5, 2.4)]);          // Lobby | Customs
  SOFT(10, 14, 18, 14, 0, [door(1.5)], 'plasterGreen');              // Main Hallway | Waiting
  SOFT(20, 8, 20, 14, 0, [door(2.5)]);                               // Main Hallway | Supply
  SOFT(18, 14, 18, 22, 0, [door(2.5)], 'plasterBlue');               // Waiting | Detention
  HARD(24, 14, 24, 22, 0, [dhole(1.5), door(4.5)]);                  // Detention | Exit Hallway
  SOFT(20, 8, 32, 8, 0, [door(2.5), door(8.5)]);                     // Customs | Supply/Passport
  SOFT(26, 8, 26, 14, 0, [door(1.5)], 'plasterGreen');               // Supply | Passport
  SOFT(18, 14, 32, 14, 0, [door(3.5), door(9.5)], 'plasterBlue');    // Supply/Passport | Detention/Exit
  // 2F
  SOFT(10, 0, 10, 8, 1, [door(4.5)], 'plasterGreen');                // Armory | Offices
  SOFT(0, 8, 10, 8, 1, [door(4.5)], 'plasterGreen');                 // Armory | Archives
  SOFT(10, 8, 10, 14, 1, [door(0.75)]);                              // Archives | Upper Hallway
  SOFT(0, 14, 10, 14, 1, [door(3.5)], 'plasterBlue');                // Archives | Break Room
  SOFT(10, 14, 10, 22, 1, [door(3.5)], 'plasterBlue');               // Break | Security
  SOFT(10, 8, 20, 8, 1, [door(1, 1.5)]);                             // Offices | Upper Hallway
  HARD(20, 0, 20, 8, 1, [door(2.5)]);                                // Offices | Kitchen
  SOFT(10, 14, 18, 14, 1, [door(4.5)], 'plasterBlue');               // Upper Hallway | Security
  SOFT(20, 8, 20, 14, 1, [door(2, 2, 2.4)], 'plasterGreen');         // Upper Hallway | East Hallway
  SOFT(20, 8, 32, 8, 1, [door(4.5)]);                                // Kitchen | East Hallway
  SOFT(18, 14, 32, 14, 1, [door(2.5), door(9.5)]);                   // East Hallway | Fountain/Upper Exit
  SOFT(18, 14, 18, 22, 1, [door(2.5)], 'plasterBlue');               // Security | Fountain
  HARD(24, 14, 24, 22, 1, [door(3.5)]);                              // Fountain | Upper Exit

  // ---------------- stairs ----------------
  L.stairs(10.4, 11.0, 'x+', 1.8, FLOOR_H, F1, { floor: 0 });       // main stairs (Main Hallway -> Upper Hallway)
  L.stairs(31.0, 14.4, 'z+', 1.8, FLOOR_H, F1, { floor: 0 });       // east stairs (Exit Hallway -> Upper Exit)

  // ---------------- props ----------------
  props(L);

  // ---------------- lights ----------------
  const warm = 0xffd9a8, cool = 0xcfe3ff, neon = 0xd9f2ff;
  const roomLight = (name, color = warm, intensity = 22, dist = 11) => { intensity *= 0.55;
    const r = L.rooms.find(r => r.name === name); const y = r.min.y + WALL_H - 0.25;
    const w = r.max.x - r.min.x, d = r.max.z - r.min.z;
    if (w * d > 60) { L.light(r.min.x + w * 0.3, y, r.min.z + d * 0.5, color, intensity * 0.8, dist); L.light(r.min.x + w * 0.7, y, r.min.z + d * 0.5, color, intensity * 0.8, dist); }
    else L.light(r.center.x, y, r.center.z, color, intensity, dist);
  };
  roomLight('Tellers', warm, 26); roomLight('Bathroom', neon, 14, 8); roomLight('Ventilation Room', cool, 14, 9); roomLight('Workshop', warm, 22);
  roomLight('Lobby', warm, 26); roomLight('Main Hallway', warm, 18); roomLight('Waiting Room', neon, 20); roomLight('Detention', cool, 14);
  roomLight('Exit Hallway', warm, 18); roomLight('Customs Inspection', neon, 26); roomLight('Supply Room', warm, 16); roomLight('Passport Check', warm, 16);
  roomLight('Armory Lockers', cool, 22); roomLight('Archives', warm, 18); roomLight('Break Room', warm, 20); roomLight('Offices', neon, 22);
  roomLight('Upper Hallway', warm, 16); roomLight('Security Room', cool, 16); roomLight('Fountain', warm, 18); roomLight('Upper Exit', warm, 16);
  roomLight('Kitchen', neon, 22); roomLight('East Hallway', warm, 16);

  // ---------------- spawns & sites ----------------
  // security cameras: two outside covering the main approaches, the rest in hallways (Siege gives defenders a handful)
  const camAt = (x, y, z, tx, tz, name, floor = 0, pitch = -0.32) => L.securityCam(x, y, z, Math.atan2(-(tx - x), -(tz - z)), name, { floor, pitch });
  camAt(32.45, 2.95, 5.6, 40, 8, 'EAST GARAGE', 0, -0.25);
  camAt(15.0, 2.95, -0.45, 16, -8, 'SOUTH ENTRANCE', 0, -0.25);
  camAt(-0.45, 2.95, 15.8, -8, 17, 'WEST PARKING', 0, -0.25);
  camAt(19.6, 3.0, 0.45, 13, 5, 'LOBBY');
  camAt(10.45, 3.0, 13.6, 16, 10.5, 'MAIN HALLWAY');
  camAt(19.6, F2 + 3.0, 8.45, 13, 12, 'UPPER HALLWAY', 1);
  camAt(31.55, F2 + 3.0, 8.45, 25, 12, 'EAST HALLWAY', 1);
  L.spawns.atk = [
    { name: 'EAST VEHICLE ENTRANCE', pos: new THREE.Vector3(44, 0, 6), points: [[44, 0, 4], [45, 0, 7], [43, 0, 9], [46, 0, 3], [44, 0, 11]] },
    { name: 'WEST PARKING', pos: new THREE.Vector3(-11, 0, 11), points: [[-11, 0, 9], [-12, 0, 12], [-10, 0, 14], [-13, 0, 7], [-11, 0, 16]] },
    { name: 'SOUTH ROAD', pos: new THREE.Vector3(16, 0, -12), points: [[16, 0, -12], [13, 0, -11], [19, 0, -11], [15, 0, -9], [21, 0, -12]] },
  ];
  for (const s of L.spawns.atk) s.points = s.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const roomByName = n => L.rooms.find(r => r.name === n);
  L.sites = SITES.map(s => {
    const rooms = s.rooms.map(roomByName);
    const bombs = rooms.map((r, i) => ({ label: i === 0 ? 'A' : 'B', room: r, pos: new THREE.Vector3(r.center.x + (i === 0 ? 1.2 : -1.2), r.min.y, r.center.z + (i === 0 ? -1 : 1)), zone: { min: new THREE.Vector3(r.min.x + 0.5, r.min.y - 0.5, r.min.z + 0.5), max: new THREE.Vector3(r.max.x - 0.5, r.min.y + 2.5, r.max.z - 0.5) } }));
    // defender spawn points inside/near the site
    const pts = [];
    for (const r of rooms) { pts.push(new THREE.Vector3(r.center.x - 1.5, r.min.y, r.center.z - 1.5), new THREE.Vector3(r.center.x + 1.5, r.min.y, r.center.z + 1.5), new THREE.Vector3(r.center.x, r.min.y, r.center.z + 2)); }
    return { ...s, rooms, bombs, defSpawns: pts, center: new THREE.Vector3().addVectors(rooms[0].center, rooms[1].center).multiplyScalar(0.5) };
  });

  L.finalize();
  return L;
}

// ---------------------------------------------------------------------------------------------
function props(L) {
  const wood = 'wood', woodL = 'woodLight', metal = 'metal';
  const P = (min, max, mat, o = {}) => L.box(min, max, mat, { uvScale: 1, tag: 'prop', penetrable: o.pen !== undefined ? o.pen : (mat === wood || mat === woodL || mat === 'plank' || mat === 'fabric' || mat === 'paper'), penMult: 0.6, blocksVision: o.blocksVision, ...o });
  const desk = (x, z, rot = 0, mon = true) => {
    const w = rot ? 0.75 : 1.5, d = rot ? 1.5 : 0.75;
    P([x - w / 2, 0.68, z - d / 2], [x + w / 2, 0.76, z + d / 2], woodL);
    P([x - w / 2 + 0.05, 0, z - d / 2 + 0.05], [x - w / 2 + 0.11, 0.68, z + d / 2 - 0.05], metal, { collide: false });
    P([x + w / 2 - 0.11, 0, z - d / 2 + 0.05], [x + w / 2 - 0.05, 0.68, z + d / 2 - 0.05], metal, { collide: false });
    P([x - w / 2, 0, z - d / 2], [x + w / 2, 0.68, z + d / 2], woodL, { visible: false, blocksVision: false });
    if (mon) { const mm = flat(0x0e1116, 0.3, 0.6, { emissive: new THREE.Color(0x2a6cff), emissiveIntensity: 0.9 }); L.box([x - 0.25, 0.78, z - 0.05], [x + 0.25, 1.1, z + 0.02], 'metal', { material: mm, matVariant: 'mon', collide: false }); }
    // chair
    P([x - 0.25, 0.42, z + (rot ? 0 : 0.7) - 0.25], [x + 0.25, 0.48, z + (rot ? 0 : 0.7) + 0.25], 'fabric', { collide: false });
    P([x - 0.25, 0.48, z + (rot ? 0 : 0.7) + 0.2], [x + 0.25, 0.95, z + (rot ? 0 : 0.7) + 0.26], 'fabric', { collide: false });
    P([x - 0.25, 0, z + (rot ? 0 : 0.7) - 0.25], [x + 0.25, 0.45, z + (rot ? 0 : 0.7) + 0.25], 'fabric', { visible: false, blocksVision: false });
  };
  const shelf = (x0, z0, x1, z1, h = 2.0, mat = metal) => {
    P([x0, 0, z0], [x1, h, z1], mat, { visible: false, blocksVision: false, pen: true, penMult: 0.5 });
    const horiz = (x1 - x0) > (z1 - z0);
    for (let k = 0; k <= 4; k++) { const y = k * (h / 4); P([x0, y, z0], [x1, y + 0.04, z1], mat, { collide: false }); }
    P([x0, 0, z0], [x0 + 0.04, h, z1], mat, { collide: false }); P([x1 - 0.04, 0, z0], [x1, h, z1], mat, { collide: false });
    if (horiz) P([x0, 0, z1 - 0.03], [x1, h, z1], mat, { collide: false }); else P([x0, 0, z0], [x0 + 0.03, h, z1], mat, { collide: false });
    // boxes on shelves
    for (let k = 0; k < 4; k++) for (let b = 0; b < 3; b++) { const y = k * (h / 4) + 0.05; const t = (b + 0.5) / 3; const bx = horiz ? x0 + t * (x1 - x0) : (x0 + x1) / 2, bz = horiz ? (z0 + z1) / 2 : z0 + t * (z1 - z0); const s = 0.12 + ((k * 7 + b * 3) % 5) * 0.03; if ((k + b) % 3 === 0) continue; P([bx - s, y, bz - s], [bx + s, y + s * 1.6, bz + s], 'paper', { collide: false }); }
  };
  const locker = (x, z, n, alongX) => { for (let i = 0; i < n; i++) { const ox = alongX ? i * 0.5 : 0, oz = alongX ? 0 : i * 0.5; P([x + ox, 0, z + oz], [x + ox + (alongX ? 0.48 : 0.5), 1.9, z + oz + (alongX ? 0.5 : 0.48)], metal); } };
  const crate = (x, z, s = 0.9, h = 0.9, mat = wood) => P([x - s / 2, 0, z - s / 2], [x + s / 2, h, z + s / 2], mat);
  const pillar = (x, z, f = 0) => L.box([x - 0.25, f ? FLOOR_H : 0, z - 0.25], [x + 0.25, (f ? FLOOR_H : 0) + WALL_H, z + 0.25], 'concrete', { uvScale: 0.5, tag: 'wall' });
  const counter = (x0, z0, x1, z1, h = 1.1, glassTop = false) => {
    P([x0, 0, z0], [x1, h, z1], wood);
    if (glassTop) { const horiz = (x1 - x0) > (z1 - z0); const gx0 = horiz ? x0 : (x0 + x1) / 2 - 0.01, gx1 = horiz ? x1 : (x0 + x1) / 2 + 0.01, gz0 = horiz ? (z0 + z1) / 2 - 0.01 : z0, gz1 = horiz ? (z0 + z1) / 2 + 0.01 : z1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(gx1 - gx0, 0.9, gz1 - gz0), glassMaterial()); m.position.set((gx0 + gx1) / 2, h + 0.45, (gz0 + gz1) / 2); L.dynamicGroup.add(m);
      const col = L.world.add(new Collider(new THREE.Vector3(gx0 - 0.01, h, gz0 - 0.01), new THREE.Vector3(gx1 + 0.01, h + 0.9, gz1 + 0.01), { material: 'glass', penetrable: true, penMult: 0.97, blocksVision: false, tag: 'glass', floor: 0 }));
      const pane = { mesh: m, col, broken: false, center: new THREE.Vector3((gx0 + gx1) / 2, h + 0.45, (gz0 + gz1) / 2), horizontal: horiz }; col.owner = pane; L.glass.push(pane); }
  };
  const painting = (x, y, z, w, h, facing) => { const t = 0.04; const min = facing === 'x' ? [x, y, z - w / 2] : [x - w / 2, y, z]; const max = facing === 'x' ? [x + t, y + h, z + w / 2] : [x + w / 2, y + h, z + t]; L.box(min, max, 'paper', { uvScale: 1, collide: false }); L.box(facing === 'x' ? [x - 0.01, y - 0.04, z - w / 2 - 0.04] : [x - w / 2 - 0.04, y - 0.04, z - 0.01], facing === 'x' ? [x + t + 0.01, y + h + 0.04, z + w / 2 + 0.04] : [x + w / 2 + 0.04, y + h + 0.04, z + t + 0.01], 'wood', { uvScale: 1, collide: false }); };
  const papers = (x0, z0, x1, z1, n, y = 0.062) => { for (let i = 0; i < n; i++) { const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), getMaterial('paper')); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * Math.PI; m.position.set(x, y + Math.random() * 0.004, z); m.receiveShadow = true; L.group.add(m); } };
  const lamp = (x, z, y) => { const m = L.box([x - 0.2, y, z - 0.2], [x + 0.2, y + 0.02, z + 0.2], 'metal', { collide: false }); };
  const fan = (x, z, y) => { L.box([x - 0.04, y - 0.3, z - 0.04], [x + 0.04, y, z + 0.04], 'metal', { collide: false }); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; const g = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.14), flat(0x3a2a1a, 0.6, 0.1)); g.position.set(x + Math.cos(a) * 0.5, y - 0.3, z + Math.sin(a) * 0.5); g.rotation.y = -a; L.group.add(g); } };
  const bars = (x0, z0, x1, z1, h = 2.4) => { const horiz = (x1 - x0) > (z1 - z0); const len = horiz ? x1 - x0 : z1 - z0; const n = Math.floor(len / 0.15); for (let i = 0; i <= n; i++) { const t = i / n; const x = horiz ? x0 + t * len : x0, z = horiz ? z0 : z0 + t * len; L.box([x - 0.02, 0, z - 0.02], [x + 0.02, h, z + 0.02], 'metal', { uvScale: 1, tag: 'prop', blocksVision: false, penetrable: true, penMult: 0.98 }); } L.box(horiz ? [x0, h, z0 - 0.03] : [x0 - 0.03, h, z0], horiz ? [x1, h + 0.06, z0 + 0.03] : [x0 + 0.03, h + 0.06, z1], 'metal', { collide: false }); };
  const vehicle = (x, z, alongX, color) => {
    const w = alongX ? 4.6 : 1.9, d = alongX ? 1.9 : 4.6; const m = flat(color, 0.4, 0.6);
    L.box([x - w / 2, 0.35, z - d / 2], [x + w / 2, 0.95, z + d / 2], 'metal', { material: m, matVariant: 'car' + color, uvScale: 1, tag: 'prop', physMat: 'metal' });
    L.box([x - w / 2 + (alongX ? 1.2 : 0.15), 0.95, z - d / 2 + (alongX ? 0.15 : 1.2)], [x + w / 2 - (alongX ? 1.0 : 0.15), 1.5, z + d / 2 - (alongX ? 0.15 : 1.0)], 'metal', { material: flat(0x1a1d22, 0.2, 0.5), matVariant: 'glassy', uvScale: 1, tag: 'prop', physMat: 'metal' });
    for (const [ox, oz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) { const wx = alongX ? ox : oz, wz = alongX ? oz : ox; L.box([x + wx - 0.35, 0, z + wz - 0.15], [x + wx + 0.35, 0.7, z + wz + 0.15], 'metal', { material: flat(0x111111, 0.9, 0), matVariant: 'tyre', collide: false }); }
  };
  const barrier = (x, z, alongX) => { const w = alongX ? 2.0 : 0.5, d = alongX ? 0.5 : 2.0; L.box([x - w / 2, 0, z - d / 2], [x + w / 2, 0.85, z + d / 2], 'concrete', { uvScale: 1, tag: 'prop' }); };
  const container = (x, z, alongX, color) => { const w = alongX ? 6 : 2.4, d = alongX ? 2.4 : 6; L.box([x - w / 2, 0, z - d / 2], [x + w / 2, 2.6, z + d / 2], 'metal', { material: getMaterial('roof', { color }), matVariant: 'cont' + color, uvScale: 0.5, tag: 'prop', physMat: 'metal' }); };
  const fence = (x0, z0, x1, z1) => { const horiz = (x1 - x0) > (z1 - z0); const len = horiz ? x1 - x0 : z1 - z0; const n = Math.ceil(len / 3); for (let i = 0; i <= n; i++) { const t = i / n; const x = horiz ? x0 + t * len : x0, z = horiz ? z0 : z0 + t * len; L.box([x - 0.04, 0, z - 0.04], [x + 0.04, 2.2, z + 0.04], 'metal', { uvScale: 1, tag: 'prop', blocksVision: false }); } const min = horiz ? [x0, 0, z0 - 0.02] : [x0 - 0.02, 0, z0], max = horiz ? [x1, 2.1, z0 + 0.02] : [x0 + 0.02, 2.1, z1]; const m = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], 2.1, max[2] - min[2]), flat(0x9aa0a8, 0.6, 0.6, { transparent: true, opacity: 0.35 })); m.position.set((min[0] + max[0]) / 2, 1.05, (min[2] + max[2]) / 2); L.group.add(m); L.world.add(new Collider(new THREE.Vector3(...min), new THREE.Vector3(...max), { material: 'metal', blocksVision: false, penetrable: true, penMult: 0.95, tag: 'prop' })); };

  // ---- 1F ----
  // Tellers: counter with glass, desks, cabinet, safe, shelves, painting, papers, fan
  counter(1.0, 5.6, 8.6, 6.4, 1.1, true);
  desk(2.5, 3.2); desk(5.2, 3.2); desk(7.6, 2.2, 1);
  P([8.4, 0, 0.4], [9.7, 2.1, 1.6], metal, { material: flat(0xd9b53a, 0.5, 0.6), matVariant: 'cab' }); // yellow display cabinet
  P([0.3, 0, 6.9], [1.1, 1.2, 7.7], metal); // safe
  shelf(3.0, 7.4, 6.5, 7.9, 2.0, wood);
  painting(0.36, 1.3, 3.5, 1.6, 1.0, 'x');
  papers(0.5, 0.5, 9.5, 5.2, 40); fan(5, 4, 3.0);
  lamp(5, 4, 3.05);
  // Bathroom: stalls + sinks
  P([0.3, 0, 12.0], [2.3, 0.85, 12.8], 'tileDark'); // sinks
  for (let i = 0; i < 3; i++) { P([2.4, 0, 8.4 + i * 1.3], [2.44, 2.0, 9.6 + i * 1.3], metal, { pen: true, penMult: 0.8 }); P([0.4, 0.4, 8.6 + i * 1.3], [1.0, 0.8, 9.3 + i * 1.3], 'tileDark'); }
  P([2.44, 0, 8.4], [3.9, 0.02, 12.3], 'tileDark', { collide: false });
  // Vent room: AC units, ducts
  P([4.6, 0, 8.6], [7.4, 1.6, 10.2], metal); P([8.0, 0, 8.6], [9.6, 1.6, 10.2], metal);
  P([4.4, 2.5, 12.6], [9.8, 3.0, 13.2], metal, { collide: false }); P([6.8, 1.6, 8.8], [7.4, 2.5, 9.4], metal, { collide: false });
  crate(5.2, 12.6, 0.8, 0.8); crate(8.8, 12.0, 0.7, 0.7);
  // Workshop
  P([0.5, 0, 14.6], [4.5, 0.95, 15.5], wood); P([0.5, 0, 20.5], [3.5, 0.95, 21.5], wood);
  shelf(6.5, 21.4, 9.5, 21.9, 2.2, metal); crate(7.8, 16.5, 1.0, 1.0); crate(8.7, 17.6, 0.8, 0.8); crate(7.6, 19.2, 1.1, 0.6, wood);
  P([5.0, 0, 17.2], [5.8, 0.75, 18.0], metal); // toolbox cart
  // Lobby
  pillar(13, 4); pillar(17, 4);
  P([11.5, 0, 6.2], [14.5, 0.9, 6.9], wood); // reception desk
  P([15.5, 0, 6.3], [16.1, 1.9, 6.7], metal, { material: flat(0x14181e, 0.35, 0.6, { emissive: new THREE.Color(0x2a6cff), emissiveIntensity: 0.12 }), matVariant: 'kiosk' });
  P([10.6, 0.4, 1.0], [12.6, 0.85, 2.0], 'fabric'); P([17.4, 0.4, 1.0], [19.4, 0.85, 2.0], 'fabric');  // sofas
  P([10.6, 0, 1.0], [12.6, 0.4, 2.0], 'fabric', { visible: false }); P([17.4, 0, 1.0], [19.4, 0.4, 2.0], 'fabric', { visible: false });
  painting(11.5, 1.4, 7.62, 2.4, 1.0, 'z');
  // Main Hallway: benches
  P([17.5, 0.45, 12.0], [19.5, 0.5, 12.5], wood); P([17.5, 0, 12.0], [19.5, 0.45, 12.5], wood, { visible: false });
  // Waiting room: rows of chairs, vending machine
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const x = 11.2 + c * 1.1, z = 15.5 + r * 1.9; P([x, 0.42, z], [x + 0.9, 0.48, z + 0.5], 'fabric', { collide: false }); P([x, 0.48, z + 0.42], [x + 0.9, 0.95, z + 0.5], 'fabric', { collide: false }); P([x, 0, z], [x + 0.9, 0.45, z + 0.5], 'fabric', { visible: false, blocksVision: false }); }
  P([16.8, 0, 21.0], [17.8, 1.9, 21.7], metal, { material: flat(0x8b1c1c, 0.5, 0.4, { emissive: new THREE.Color(0xff5030), emissiveIntensity: 0.4 }), matVariant: 'vend' });
  // Detention: cells with bars
  bars(21.0, 14.4, 21.0, 21.6); bars(21.0, 18.0, 23.9, 18.0);
  P([22.2, 0, 14.6], [23.8, 0.5, 15.4], wood); P([22.2, 0, 20.6], [23.8, 0.5, 21.4], wood);
  P([18.4, 0, 20.6], [20.4, 0.9, 21.5], wood); // guard desk
  // Exit hallway: lockers, benches
  locker(24.4, 21.4, 8, true); P([25.0, 0.45, 15.0], [27.0, 0.5, 15.5], wood); P([25.0, 0, 15.0], [27.0, 0.45, 15.5], wood, { visible: false });
  // Customs Inspection: tables, x-ray, crates, conveyor
  P([21.0, 0, 5.0], [26.0, 0.9, 6.2], metal); P([27.0, 0, 5.0], [31.0, 0.9, 6.2], metal);
  P([22.0, 0, 1.0], [24.5, 1.9, 2.6], metal, { material: flat(0xc8c8cc, 0.4, 0.7), matVariant: 'xray' });
  crate(29.5, 1.6, 1.2, 1.2); crate(30.7, 2.9, 0.9, 0.9); crate(28.2, 2.4, 0.8, 1.4);
  P([25.0, 0.7, 1.4], [27.6, 0.8, 2.1], metal); P([25.0, 0, 1.4], [27.6, 0.7, 2.1], metal, { visible: false });
  // Supply room: shelves
  shelf(20.4, 9.0, 20.9, 13.6, 2.2, metal); shelf(21.8, 9.4, 22.3, 12.4, 2.2, metal); shelf(24.6, 9.6, 25.1, 13.6, 2.2, metal);
  crate(23.4, 13.0, 0.8, 0.8);
  // Passport check: booths
  for (let i = 0; i < 2; i++) { const x = 27 + i * 2.6; counter(x, 10.0, x + 1.4, 11.0, 1.1, true); }
  P([30.8, 0, 12.6], [31.6, 1.4, 13.6], metal);
  // ---- 2F ----
  const F = FLOOR_H;
  const P2 = (min, max, mat, o = {}) => P([min[0], F + min[1], min[2]], [max[0], F + max[1], max[2]], mat, { ...o, floor: 1 });
  // Armory lockers: locker rows, racks
  for (let i = 0; i < 4; i++) P2([0.6 + i * 0.5, 0, 0.5], [1.06 + i * 0.5, 1.9, 1.0], metal);
  for (let i = 0; i < 6; i++) { P2([3.5 + i * 0.5, 0, 3.6], [3.96 + i * 0.5, 1.9, 4.1], metal); P2([3.5 + i * 0.5, 0, 4.1], [3.96 + i * 0.5, 1.9, 4.6], metal); }
  P2([8.0, 0, 0.6], [8.9, 1.0, 4.6], wood); P2([0.4, 0.45, 6.6], [3.0, 0.5, 7.1], wood); P2([0.4, 0, 6.6], [3.0, 0.45, 7.1], wood, { visible: false });
  // Archives: filing cabinets & shelves
  for (let i = 0; i < 3; i++) { P2([1.0 + i * 2.6, 0, 9.0], [1.5 + i * 2.6, 2.0, 12.6], metal, { pen: true, penMult: 0.5 }); }
  P2([1.0, 0, 13.0], [9.0, 1.3, 13.5], metal);
  // Break room
  P2([3.0, 0.72, 17.0], [5.6, 0.78, 18.4], wood); P2([3.0, 0, 17.0], [5.6, 0.72, 18.4], wood, { visible: false });
  P2([0.4, 0, 20.8], [3.4, 0.9, 21.6], wood); P2([8.6, 0, 20.4], [9.6, 1.9, 21.6], metal); // counter, fridge
  for (const [x, z] of [[2.6, 16.6], [6.0, 16.6], [2.6, 18.8], [6.0, 18.8]]) { P2([x - 0.22, 0.42, z - 0.22], [x + 0.22, 0.47, z + 0.22], 'fabric', { collide: false }); P2([x - 0.22, 0, z - 0.22], [x + 0.22, 0.42, z + 0.22], 'fabric', { visible: false }); }
  // Offices: desks + partitions
  const desk2 = (x, z, rot) => { const w = rot ? 0.75 : 1.5, d = rot ? 1.5 : 0.75; P2([x - w / 2, 0.68, z - d / 2], [x + w / 2, 0.76, z + d / 2], woodL); P2([x - w / 2, 0, z - d / 2], [x + w / 2, 0.68, z + d / 2], woodL, { visible: false, blocksVision: false }); const mm = flat(0x0e1116, 0.3, 0.6, { emissive: new THREE.Color(0x2a6cff), emissiveIntensity: 0.9 }); L.box([x - 0.25, F + 0.78, z - 0.05], [x + 0.25, F + 1.1, z + 0.02], 'metal', { material: mm, matVariant: 'mon', collide: false }); };
  desk2(12, 2.5); desk2(15, 2.5); desk2(18, 2.5); desk2(12, 6); desk2(15, 6); desk2(18, 6);
  P2([13.5, 0, 1.4], [13.56, 1.5, 7.2], 'fabric', { pen: true, penMult: 0.7 }); P2([16.5, 0, 1.4], [16.56, 1.5, 7.2], 'fabric', { pen: true, penMult: 0.7 });
  // Upper hallway: bench
  P2([18.0, 0.45, 13.0], [19.6, 0.5, 13.5], wood); P2([18.0, 0, 13.0], [19.6, 0.45, 13.5], wood, { visible: false });
  // Security room: monitor wall + desk + racks
  P2([10.5, 0, 21.3], [17.5, 1.9, 21.7], metal, { material: flat(0x0e1116, 0.3, 0.6, { emissive: new THREE.Color(0x55b0ff), emissiveIntensity: 0.7 }), matVariant: 'monwall' });
  P2([11.5, 0.72, 19.0], [16.5, 0.78, 19.8], woodL); P2([11.5, 0, 19.0], [16.5, 0.72, 19.8], woodL, { visible: false, blocksVision: false });
  P2([10.4, 0, 14.4], [11.2, 2.0, 17.4], metal); P2([16.8, 0, 14.4], [17.6, 2.0, 16.4], metal);
  // Fountain
  P2([20.0, 0, 16.6], [22.4, 0.6, 19.0], 'tile'); P2([20.6, 0.6, 17.2], [21.8, 0.7, 18.4], 'tile', { material: flat(0x3a6d8a, 0.05, 0.1, { transparent: true, opacity: 0.7 }), matVariant: 'water', collide: false });
  P2([18.4, 0, 14.4], [19.2, 0.6, 15.6], 'tile'); P2([22.8, 0, 20.6], [23.6, 0.6, 21.6], 'tile');
  P2([18.4, 0.45, 20.5], [20.0, 0.5, 21.0], wood); P2([18.4, 0, 20.5], [20.0, 0.45, 21.0], wood, { visible: false });
  // Upper exit: lockers
  locker(24.4, 14.4, 6, true);
  // Kitchen
  P2([20.5, 0, 0.5], [26.0, 0.9, 1.3], 'tileDark'); P2([27.0, 0, 0.5], [31.5, 0.9, 1.3], 'tileDark'); P2([30.6, 0, 6.6], [31.6, 1.9, 7.6], metal);
  P2([22.5, 0.72, 4.5], [25.5, 0.78, 6.0], wood); P2([22.5, 0, 4.5], [25.5, 0.72, 6.0], wood, { visible: false, blocksVision: false });
  P2([28.0, 0.72, 4.5], [31.0, 0.78, 6.0], wood); P2([28.0, 0, 4.5], [31.0, 0.72, 6.0], wood, { visible: false, blocksVision: false });
  // East hallway
  P2([20.4, 0.45, 12.5], [23.0, 0.5, 13.0], wood); P2([20.4, 0, 12.5], [23.0, 0.45, 13.0], wood, { visible: false });

  // ---- exterior ----
  vehicle(40, 14, false, 0x2b3b52); vehicle(40, 22, false, 0xc9c3b6); vehicle(38, 4, true, 0x6a1f1f);
  vehicle(-8, 6, false, 0x1f3a2a); vehicle(-8, 16, false, 0x8a8a8a);
  vehicle(10, -8, true, 0x3d3d44); vehicle(22, -8, true, 0xb8b0a0);
  barrier(-3, 1, false); barrier(-3, 5, false); barrier(35, 10, false); barrier(35, 16, false); barrier(8, -3.5, true); barrier(24, -3.5, true);
  container(44, 30, true, 0x8a3a2a); container(-12, 28, true, 0x2a4a7a); container(6, 30, true, 0x3a6a3a);
  fence(-4, 26, 34, 26); fence(-4, 26, -4, 40); fence(34, 26, 34, 40);
  crate(36, 20, 1.2, 1.2); crate(-5, 20, 1.2, 1.2); crate(2, -5, 1.0, 1.0);
  // guard booth (south)
  L.box([28.5, 0, -6], [31.5, 2.6, -3.5], 'concrete', { uvScale: 0.5, tag: 'prop' });
  // lamp posts
  for (const [x, z] of [[-6, 0], [-6, 22], [38, 0], [38, 24], [10, -10], [26, -10], [16, 30]]) { L.box([x - 0.1, 0, z - 0.1], [x + 0.1, 6, z + 0.1], 'metal', { uvScale: 1, tag: 'prop' }); L.light(x, 5.8, z, 0xffe0b0, 30, 18, { fw: 0.5, fd: 0.5, emissive: 1.2 }); }
}
