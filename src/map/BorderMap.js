import * as THREE from 'three';
import { Level, FLOOR_H } from './Level.js';
import { getMaterial, flat, glassMaterial } from './Materials.js';
import { Collider } from '../core/Physics.js';

// BORDER — a two-storey border-crossing office. 40 m x 27.5 m footprint (the original 32 x 22 layout
// scaled by 1.25 so rooms have Siege-like space), stucco outside, plastered inside.
// Bomb sites: 1F Tellers/Bathroom, 1F Customs Inspection/Supply Room, 2F Armory Lockers/Archives.

const K = 1.25;                          // layout scale vs. the first draft
const S = v => v * K;
const WALL_H = 3.2;
const F1 = 0, F2 = FLOOR_H;
const BW = S(32), BD = S(22);             // building width / depth
const win = (at, w = 1.5, y = 1.0, h = 1.5) => ({ at, w, y, h, kind: 'window' });
const door = (at, w = 1.1, h = 2.2) => ({ at, w, y: 0, h, kind: 'door' });
const arch = (at, w, h = 2.6) => ({ at, w, y: 0, h, kind: 'arch' });
const garage = (at, w = 4.0, h = 2.8) => ({ at, w, y: 0, h, kind: 'garage' });
const dhole = (at) => ({ at, w: 0.5, y: 0, h: 0.36, kind: 'drone' });   // drone hole at floor level

export const SITES = [
  { id: 'tellers', name: '1F TELLERS / BATHROOM', rooms: ['Tellers', 'Bathroom'], floor: 0 },
  { id: 'customs', name: '1F CUSTOMS INSPECTION / SUPPLY ROOM', rooms: ['Customs Inspection', 'Supply Room'], floor: 0 },
  { id: 'armory', name: '2F ARMORY LOCKERS / ARCHIVES', rooms: ['Armory Lockers', 'Archives'], floor: 1 },
];

export function buildBorder(world, scene) {
  const L = new Level(world, scene);
  L.interiorBounds.set(new THREE.Vector3(0, -1, 0), new THREE.Vector3(BW, 7, BD));
  L.center = new THREE.Vector3(BW / 2, 0, BD / 2);

  // ---------------- rooms ----------------
  const R = (name, f, x0, z0, x1, z1, o) => L.room(name, f, S(x0), S(z0), S(x1), S(z1), o);
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
  const room = n => L.rooms.find(r => r.name === n);

  // ---------------- ground & floors ----------------
  L.box([-60, -1.2, -60], [100, 0, 100], 'dirt', { uvScale: 0.25, tag: 'floor', physMat: 'dirt', floor: 0 });
  // grass beyond the roads / north of the fence
  for (const [x0, z0, x1, z1] of [[-60, 33, 100, 100], [-60, -60, -19, 33], [58, -60, 100, 33]]) L.box([x0, -0.006, z0], [x1, 0.012, z1], 'grass', { uvScale: 0.4, tag: 'floor', physMat: 'dirt', floor: 0, collide: false });
  // asphalt: south road, east and west roads
  L.box([-40, -0.01, -17], [80, 0.02, -4], 'asphalt', { uvScale: 0.25, tag: 'floor', physMat: 'concrete', floor: 0 });
  L.box([45, -0.01, -17], [57, 0.02, 48], 'asphalt', { uvScale: 0.25, tag: 'floor', physMat: 'concrete', floor: 0 });
  L.box([-17, -0.01, -17], [-5, 0.02, 48], 'asphalt', { uvScale: 0.25, tag: 'floor', physMat: 'concrete', floor: 0 });
  // pavement apron around the building, with a curb
  L.box([-2.5, -0.005, -2.5], [BW + 2.5, 0.03, BD + 2.5], 'concrete', { uvScale: 0.5, tag: 'floor', physMat: 'concrete', floor: 0 });
  const curb = (x0, z0, x1, z1) => L.box([x0, 0.03, z0], [x1, 0.13, z1], 'concrete', { uvScale: 1, tag: 'floor', physMat: 'concrete', floor: 0, matVariant: 'curb', matOverrides: { color: 0xb9b6ad } });
  curb(-2.5, -2.5, BW + 2.5, -2.3); curb(-2.5, BD + 2.3, BW + 2.5, BD + 2.5); curb(-2.5, -2.5, -2.3, BD + 2.5); curb(BW + 2.3, -2.5, BW + 2.5, BD + 2.5);
  // 1F floors per room
  for (const r of L.rooms.filter(r => r.floor === 0)) L.box([r.min.x, 0.03, r.min.z], [r.max.x, 0.06, r.max.z], r.floorMat, { uvScale: 0.5, tag: 'floor', physMat: r.floorMat === 'tile' || r.floorMat === 'tileDark' ? 'tile' : r.floorMat, floor: 0 });
  // 2F slabs with hatches and stairwells
  const hatches = [
    { x: S(3), z: S(6), size: 1.2, hatch: true },        // Armory -> Tellers
    { x: S(8), z: S(12), size: 1.2, hatch: true },       // Archives -> Vent Room
    { x: 28.6, z: 26.2, size: 1.2, hatch: true },        // Fountain -> Detention
    { x: S(26), z: S(4), size: 1.2, hatch: true },       // Kitchen -> Customs
    { x: S(14), z: S(19.5), size: 1.2, hatch: true },    // Security -> Waiting
    { x: S(29), z: S(11), size: 1.2, hatch: true },      // East Hallway -> Passport
  ];
  const STAIR_RUN = 17 * 0.3, STAIR_W = 2.0;
  const mainStair = { x: S(10.4), z: S(11.0) };                 // ascends +x in the Main Hallway
  const eastStair = { x: S(31.0), z: S(14.4) };                 // ascends +z in the Exit Hallway
  const mainStairHole = { x0: mainStair.x, z0: mainStair.z - STAIR_W / 2, x1: mainStair.x + STAIR_RUN + 0.1, z1: mainStair.z + STAIR_W / 2 };
  const eastStairHole = { x0: eastStair.x - STAIR_W / 2, z0: eastStair.z, x1: eastStair.x + STAIR_W / 2, z1: eastStair.z + STAIR_RUN + 0.1 };
  for (const r of L.rooms.filter(r => r.floor === 1)) {
    const holes = hatches.filter(h => h.x > r.min.x && h.x < r.max.x && h.z > r.min.z && h.z < r.max.z);
    if (r.name === 'Upper Hallway') holes.push(mainStairHole);
    if (r.name === 'Upper Exit') holes.push(eastStairHole);
    L.floorSlab(r.min.x, r.min.z, r.max.x, r.max.z, F2, 0.2, r.floorMat, 'ceiling', { holes, floor: 1, physMat: r.floorMat === 'carpet' ? 'carpet' : (r.floorMat.startsWith('tile') ? 'tile' : 'concrete') });
  }
  // roof, parapet, rooftop units
  L.floorSlab(0, 0, BW, BD, F2 + WALL_H + 0.2, 0.2, 'roof', 'ceiling', { floor: 2 });
  L.box([-0.2, F2 + WALL_H + 0.2, -0.2], [BW + 0.2, F2 + WALL_H + 0.9, 0.2], 'stucco', { uvScale: 0.5 });
  L.box([-0.2, F2 + WALL_H + 0.2, BD - 0.2], [BW + 0.2, F2 + WALL_H + 0.9, BD + 0.2], 'stucco', { uvScale: 0.5 });
  L.box([-0.2, F2 + WALL_H + 0.2, -0.2], [0.2, F2 + WALL_H + 0.9, BD + 0.2], 'stucco', { uvScale: 0.5 });
  L.box([BW - 0.2, F2 + WALL_H + 0.2, -0.2], [BW + 0.2, F2 + WALL_H + 0.9, BD + 0.2], 'stucco', { uvScale: 0.5 });
  for (const [x, z, w, d] of [[8, 6, 2.4, 1.6], [30, 20, 3, 2], [22, 12, 1.4, 1.4]]) L.box([x, F2 + WALL_H + 0.4, z], [x + w, F2 + WALL_H + 1.4, z + d], 'metal', { uvScale: 1 });
  // stair railings on 2F
  L.railing(mainStairHole.x0, mainStairHole.z0, mainStairHole.x1, mainStairHole.z1, F2, 'nws');
  L.railing(eastStairHole.x0, eastStairHole.z0, eastStairHole.x1, eastStairHole.z1, F2, 'swe');

  // ---------------- exterior walls ----------------
  // sandy stucco outside, plaster inside; a dark base band and a trim line between the floors
  const EXT = (x0, z0, x1, z1, floor, openings, outward) => L.hardWall(S(x0), S(z0), S(x1), S(z1), floor ? F2 : F1, WALL_H, 'stucco', { openings: openings.map(o => ({ ...o, at: S(o.at) })), exterior: true, floor, outward, uvScale: 0.5, skin: floor ? 'plasterBlue' : 'plaster' });
  // 1F
  EXT(0, 0, 32, 0, 0, [win(2), dhole(4.6), win(6), dhole(11.5), door(14, 2, 2.5), dhole(19), win(23), dhole(26.5), win(28)], -1);   // south
  EXT(0, 22, 32, 22, 0, [win(2), dhole(4.6), win(6.5), dhole(10.5), door(13), dhole(17), win(20.5), dhole(24.5), door(27)], 1);      // north
  EXT(0, 0, 0, 22, 0, [win(2), dhole(4), win(5), dhole(6.9), win(10.5, 1, 1.4, 0.8), dhole(14.5), door(17), dhole(19.5)], -1);        // west
  EXT(32, 0, 32, 22, 0, [garage(2), dhole(7.1), win(10), dhole(13.1), dhole(17.5), door(20.5)], 1);                                  // east
  // 2F
  EXT(0, 0, 32, 0, 1, [win(2), win(6), win(12), win(17), win(23), win(28)], -1);
  EXT(0, 22, 32, 22, 1, [win(2), win(6.5), win(13.5), win(20.5), win(27)], 1);
  EXT(0, 0, 0, 22, 1, [win(3), win(10.5), win(17)], -1);
  EXT(32, 0, 32, 22, 1, [win(3), win(10.5), win(17)], 1);
  // base band, floor-line trim and pilasters
  const band = (x0, z0, x1, z1, y0, y1, t) => L.box([Math.min(x0, x1) - t, y0, Math.min(z0, z1) - t], [Math.max(x0, x1) + t, y1, Math.max(z0, z1) + t], 'concrete', { uvScale: 0.5, collide: false, matVariant: 'band', matOverrides: { color: 0x7d6a5a } });
  for (const [x0, z0, x1, z1] of [[0, 0, BW, 0], [0, BD, BW, BD], [0, 0, 0, BD], [BW, 0, BW, BD]]) { band(x0, z0, x1, z1, 0, 0.55, 0.2); band(x0, z0, x1, z1, F2 - 0.12, F2 + 0.16, 0.2); }
  for (const x of [S(10), S(20)]) { L.box([x - 0.25, 0.55, -0.24], [x + 0.25, F2 + WALL_H, 0.0], 'stucco', { uvScale: 0.5, collide: false }); L.box([x - 0.25, 0.55, BD], [x + 0.25, F2 + WALL_H, BD + 0.24], 'stucco', { uvScale: 0.5, collide: false }); }

  // ---------------- interior walls ----------------
  const SOFT = (x0, z0, x1, z1, floor, openings, mat = 'plaster') => L.softWall(S(x0), S(z0), S(x1), S(z1), floor ? F2 : F1, WALL_H, { openings: openings.map(o => ({ ...o, at: S(o.at) })), floor, material: mat });
  const HARD = (x0, z0, x1, z1, floor, openings) => L.hardWall(S(x0), S(z0), S(x1), S(z1), floor ? F2 : F1, WALL_H, 'concrete', { openings: openings.map(o => ({ ...o, at: S(o.at) })), floor, thickness: 0.3, uvScale: 0.5 });
  // 1F
  SOFT(10, 0, 10, 8, 0, [door(3)]);                                  // Tellers | Lobby
  SOFT(0, 8, 10, 8, 0, [door(1.5), door(6.5)]);                      // Tellers | Bathroom/Vent
  SOFT(4, 8, 4, 14, 0, [door(2.5)], 'plasterBlue');                  // Bathroom | Vent
  SOFT(10, 8, 10, 14, 0, [door(4.5)]);                               // Vent | Main Hallway
  SOFT(0, 14, 10, 14, 0, [door(5.5)], 'plasterGreen');               // Vent/Bath | Workshop
  SOFT(10, 14, 10, 22, 0, [door(3.5)], 'plasterGreen');              // Workshop | Waiting
  SOFT(10, 8, 20, 8, 0, [arch(2.5, 6.25)]);                          // Lobby | Main Hallway
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
  L.stairs(mainStair.x, mainStair.z, 'x+', STAIR_W, FLOOR_H, F1, { floor: 0 });   // Main Hallway -> Upper Hallway
  L.stairs(eastStair.x, eastStair.z, 'z+', STAIR_W, FLOOR_H, F1, { floor: 0 });   // Exit Hallway -> Upper Exit

  // ---------------- props & dressing ----------------
  props(L, room);
  dressing(L);

  // ---------------- lights ----------------
  const warm = 0xffd9a8, cool = 0xcfe3ff, neon = 0xd9f2ff;
  const roomLight = (name, color = warm, intensity = 22, dist = 12) => { intensity *= 0.6;
    const r = room(name); const y = r.min.y + WALL_H - 0.25;
    const w = r.max.x - r.min.x, d = r.max.z - r.min.z;
    if (w * d > 90) { L.light(r.min.x + w * 0.3, y, r.min.z + d * 0.5, color, intensity * 0.85, dist); L.light(r.min.x + w * 0.7, y, r.min.z + d * 0.5, color, intensity * 0.85, dist); }
    else L.light(r.center.x, y, r.center.z, color, intensity, dist);
  };
  roomLight('Tellers', warm, 28); roomLight('Bathroom', neon, 14, 9); roomLight('Ventilation Room', cool, 14, 10); roomLight('Workshop', warm, 24);
  roomLight('Lobby', warm, 28); roomLight('Main Hallway', warm, 20); roomLight('Waiting Room', neon, 22); roomLight('Detention', cool, 15);
  roomLight('Exit Hallway', warm, 20); roomLight('Customs Inspection', neon, 28); roomLight('Supply Room', warm, 17); roomLight('Passport Check', warm, 17);
  roomLight('Armory Lockers', cool, 24); roomLight('Archives', warm, 19); roomLight('Break Room', warm, 22); roomLight('Offices', neon, 24);
  roomLight('Upper Hallway', warm, 18); roomLight('Security Room', cool, 17); roomLight('Fountain', warm, 19); roomLight('Upper Exit', warm, 17);
  roomLight('Kitchen', neon, 24); roomLight('East Hallway', warm, 17);

  // ---------------- cameras, spawns & sites ----------------
  const camAt = (x, y, z, tx, tz, name, floor = 0, pitch = -0.32) => L.securityCam(x, y, z, Math.atan2(-(tx - x), -(tz - z)), name, { floor, pitch });
  camAt(BW + 0.45, 2.95, S(5.6), BW + 10, S(8), 'EAST GARAGE', 0, -0.25);
  camAt(S(15.0), 2.95, -0.45, S(16), -8, 'SOUTH ENTRANCE', 0, -0.25);
  camAt(-0.45, 2.95, S(15.8), -8, S(17), 'WEST PARKING', 0, -0.25);
  camAt(S(20) - 0.4, 3.0, 0.45, S(13), S(5), 'LOBBY');
  camAt(S(10) + 0.45, 3.0, S(14) - 0.4, S(16), S(10.5), 'MAIN HALLWAY');
  camAt(S(20) - 0.4, F2 + 3.0, S(8) + 0.45, S(13), S(12), 'UPPER HALLWAY', 1);
  camAt(BW - 0.45, F2 + 3.0, S(8) + 0.45, S(25), S(12), 'EAST HALLWAY', 1);
  L.spawns.atk = [
    { name: 'EAST VEHICLE ENTRANCE', pos: new THREE.Vector3(53, 0, 7), points: [[53, 0, 5], [54, 0, 8], [52, 0, 10], [55, 0, 4], [53, 0, 12]] },
    { name: 'WEST PARKING', pos: new THREE.Vector3(-13, 0, 14), points: [[-13, 0, 12], [-14, 0, 15], [-12, 0, 17], [-15, 0, 10], [-13, 0, 19]] },
    { name: 'SOUTH ROAD', pos: new THREE.Vector3(20, 0, -14), points: [[20, 0, -14], [17, 0, -13], [23, 0, -13], [19, 0, -11], [25, 0, -14]] },
  ];
  for (const s of L.spawns.atk) s.points = s.points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  L.sites = SITES.map(s => {
    const rooms = s.rooms.map(room);
    const bombs = rooms.map((r, i) => ({ label: i === 0 ? 'A' : 'B', room: r, pos: new THREE.Vector3(r.center.x + (i === 0 ? 1.5 : -1.5), r.min.y, r.center.z + (i === 0 ? -1.2 : 1.2)), zone: { min: new THREE.Vector3(r.min.x + 0.5, r.min.y - 0.5, r.min.z + 0.5), max: new THREE.Vector3(r.max.x - 0.5, r.min.y + 2.5, r.max.z - 0.5) } }));
    const pts = [];
    for (const r of rooms) { pts.push(new THREE.Vector3(r.center.x - 1.8, r.min.y, r.center.z - 1.8), new THREE.Vector3(r.center.x + 1.8, r.min.y, r.center.z + 1.8), new THREE.Vector3(r.center.x, r.min.y, r.center.z + 2.4)); }
    return { ...s, rooms, bombs, defSpawns: pts, center: new THREE.Vector3().addVectors(rooms[0].center, rooms[1].center).multiplyScalar(0.5) };
  });

  L.finalize();
  return L;
}

// ---------------------------------------------------------------------------------------------
// Props are placed relative to their room's walls so the layout can be rescaled without anything floating.
function props(L, room) {
  const wood = 'wood', woodL = 'woodLight', metal = 'metal';
  const P = (min, max, mat, o = {}) => L.box(min, max, mat, { uvScale: 1, tag: 'prop', penetrable: o.pen !== undefined ? o.pen : (mat === wood || mat === woodL || mat === 'plank' || mat === 'fabric' || mat === 'paper'), penMult: 0.6, blocksVision: o.blocksVision, ...o });
  const IN = 0.22;   // clearance from a wall centreline to sit flush against the plaster
  const desk = (x, z, y, rot = 0, mon = true) => {
    const w = rot ? 0.75 : 1.5, d = rot ? 1.5 : 0.75;
    P([x - w / 2, y + 0.68, z - d / 2], [x + w / 2, y + 0.76, z + d / 2], woodL);
    P([x - w / 2 + 0.05, y, z - d / 2 + 0.05], [x - w / 2 + 0.11, y + 0.68, z + d / 2 - 0.05], metal, { collide: false });
    P([x + w / 2 - 0.11, y, z - d / 2 + 0.05], [x + w / 2 - 0.05, y + 0.68, z + d / 2 - 0.05], metal, { collide: false });
    P([x - w / 2, y, z - d / 2], [x + w / 2, y + 0.68, z + d / 2], woodL, { visible: false, blocksVision: false });
    if (mon) { const mm = flat(0x0e1116, 0.3, 0.6, { emissive: new THREE.Color(0x2a6cff), emissiveIntensity: 0.9 }); L.box([x - 0.25, y + 0.78, z - 0.05], [x + 0.25, y + 1.1, z + 0.02], 'metal', { material: mm, matVariant: 'mon', collide: false }); L.box([x - 0.03, y + 0.76, z - 0.03], [x + 0.03, y + 0.8, z + 0.03], 'metal', { collide: false }); }
    const cz = z + (rot ? 0 : 0.72);
    P([x - 0.25, y + 0.42, cz - 0.25], [x + 0.25, y + 0.48, cz + 0.25], 'fabric', { collide: false });
    P([x - 0.25, y + 0.48, cz + 0.2], [x + 0.25, y + 0.95, cz + 0.26], 'fabric', { collide: false });
    P([x - 0.25, y, cz - 0.25], [x + 0.25, y + 0.45, cz + 0.25], 'fabric', { visible: false, blocksVision: false });
  };
  const shelf = (x0, z0, x1, z1, y, h = 2.0, mat = metal) => {
    P([x0, y, z0], [x1, y + h, z1], mat, { visible: false, blocksVision: false, pen: true, penMult: 0.5 });
    const horiz = (x1 - x0) > (z1 - z0);
    for (let k = 0; k <= 4; k++) { const yy = y + k * (h / 4); P([x0, yy, z0], [x1, yy + 0.04, z1], mat, { collide: false }); }
    P([x0, y, z0], [x0 + 0.04, y + h, z1], mat, { collide: false }); P([x1 - 0.04, y, z0], [x1, y + h, z1], mat, { collide: false });
    if (horiz) P([x0, y, z1 - 0.03], [x1, y + h, z1], mat, { collide: false }); else P([x0, y, z0], [x0 + 0.03, y + h, z1], mat, { collide: false });
    for (let k = 0; k < 4; k++) for (let b = 0; b < 3; b++) { const yy = y + k * (h / 4) + 0.05; const t = (b + 0.5) / 3; const bx = horiz ? x0 + t * (x1 - x0) : (x0 + x1) / 2, bz = horiz ? (z0 + z1) / 2 : z0 + t * (z1 - z0); const s = 0.12 + ((k * 7 + b * 3) % 5) * 0.03; if ((k + b) % 3 === 0) continue; P([bx - s, yy, bz - s], [bx + s, yy + s * 1.6, bz + s], 'paper', { collide: false }); }
  };
  const locker = (x, z, y, n, alongX) => { for (let i = 0; i < n; i++) { const ox = alongX ? i * 0.5 : 0, oz = alongX ? 0 : i * 0.5; P([x + ox, y, z + oz], [x + ox + (alongX ? 0.48 : 0.5), y + 1.9, z + oz + (alongX ? 0.5 : 0.48)], metal); L.box([x + ox + (alongX ? 0.22 : 0.5), y + 1.1, z + oz + (alongX ? 0.5 : 0.22)], [x + ox + (alongX ? 0.26 : 0.52), y + 1.2, z + oz + (alongX ? 0.52 : 0.26)], 'metal', { collide: false, matVariant: 'dark', matOverrides: { color: 0x444444 } }); } };
  const crate = (x, z, y, s = 0.9, h = 0.9, mat = wood) => P([x - s / 2, y, z - s / 2], [x + s / 2, y + h, z + s / 2], mat);
  const pillar = (x, z, f = 0) => L.box([x - 0.25, f ? FLOOR_H : 0, z - 0.25], [x + 0.25, (f ? FLOOR_H : 0) + WALL_H, z + 0.25], 'concrete', { uvScale: 0.5, tag: 'wall' });
  const counter = (x0, z0, x1, z1, y, h = 1.1, glassTop = false) => {
    P([x0, y, z0], [x1, y + h, z1], wood); L.box([x0 - 0.03, y + h, z0 - 0.03], [x1 + 0.03, y + h + 0.04, z1 + 0.03], 'woodLight', { collide: false, uvScale: 1 });
    if (glassTop) { const horiz = (x1 - x0) > (z1 - z0); const gx0 = horiz ? x0 : (x0 + x1) / 2 - 0.01, gx1 = horiz ? x1 : (x0 + x1) / 2 + 0.01, gz0 = horiz ? (z0 + z1) / 2 - 0.01 : z0, gz1 = horiz ? (z0 + z1) / 2 + 0.01 : z1;
      const m = new THREE.Mesh(new THREE.BoxGeometry(gx1 - gx0, 0.9, gz1 - gz0), glassMaterial()); m.position.set((gx0 + gx1) / 2, y + h + 0.45, (gz0 + gz1) / 2); L.dynamicGroup.add(m);
      const col = L.world.add(new Collider(new THREE.Vector3(gx0 - 0.01, y + h, gz0 - 0.01), new THREE.Vector3(gx1 + 0.01, y + h + 0.9, gz1 + 0.01), { material: 'glass', penetrable: true, penMult: 0.97, blocksVision: false, tag: 'glass', floor: y > 1 ? 1 : 0 }));
      const pane = { mesh: m, col, broken: false, center: new THREE.Vector3((gx0 + gx1) / 2, y + h + 0.45, (gz0 + gz1) / 2), horizontal: horiz }; col.owner = pane; L.glass.push(pane); }
  };
  const painting = (x, y, z, w, h, facing) => { const t = 0.04; const min = facing === 'x' ? [x, y, z - w / 2] : [x - w / 2, y, z]; const max = facing === 'x' ? [x + t, y + h, z + w / 2] : [x + w / 2, y + h, z + t]; L.box(min, max, 'paper', { uvScale: 1, collide: false }); L.box(facing === 'x' ? [x - 0.01, y - 0.04, z - w / 2 - 0.04] : [x - w / 2 - 0.04, y - 0.04, z - 0.01], facing === 'x' ? [x + t + 0.01, y + h + 0.04, z + w / 2 + 0.04] : [x + w / 2 + 0.04, y + h + 0.04, z + t + 0.01], 'wood', { uvScale: 1, collide: false }); };
  const papers = (x0, z0, x1, z1, n, y = 0.062) => { for (let i = 0; i < n; i++) { const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), getMaterial('paper')); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * Math.PI; m.position.set(x, y + Math.random() * 0.004, z); m.receiveShadow = true; L.group.add(m); } };
  const fan = (x, z, y) => { L.box([x - 0.04, y - 0.3, z - 0.04], [x + 0.04, y, z + 0.04], 'metal', { collide: false }); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; const g = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.14), flat(0x3a2a1a, 0.6, 0.1)); g.position.set(x + Math.cos(a) * 0.5, y - 0.3, z + Math.sin(a) * 0.5); g.rotation.y = -a; L.group.add(g); } };
  const bars = (x0, z0, x1, z1, h = 2.4) => { const horiz = (x1 - x0) > (z1 - z0); const len = horiz ? x1 - x0 : z1 - z0; const n = Math.floor(len / 0.15); for (let i = 0; i <= n; i++) { const t = i / n; const x = horiz ? x0 + t * len : x0, z = horiz ? z0 : z0 + t * len; L.box([x - 0.02, 0, z - 0.02], [x + 0.02, h, z + 0.02], 'metal', { uvScale: 1, tag: 'prop', blocksVision: false, penetrable: true, penMult: 0.98 }); } L.box(horiz ? [x0, h, z0 - 0.03] : [x0 - 0.03, h, z0], horiz ? [x1, h + 0.06, z0 + 0.03] : [x0 + 0.03, h + 0.06, z1], 'metal', { collide: false }); L.box(horiz ? [x0, 0, z0 - 0.03] : [x0 - 0.03, 0, z0], horiz ? [x1, 0.06, z0 + 0.03] : [x0 + 0.03, 0.06, z1], 'metal', { collide: false }); };
  const table = (x0, z0, x1, z1, y, mat = wood) => { P([x0, y + 0.72, z0], [x1, y + 0.78, z1], mat); P([x0, y, z0], [x1, y + 0.72, z1], mat, { visible: false, blocksVision: false }); for (const [lx, lz] of [[x0 + 0.06, z0 + 0.06], [x1 - 0.12, z0 + 0.06], [x0 + 0.06, z1 - 0.12], [x1 - 0.12, z1 - 0.12]]) P([lx, y, lz], [lx + 0.06, y + 0.72, lz + 0.06], metal, { collide: false }); };
  const bench = (x0, z0, x1, z1, y) => { P([x0, y + 0.45, z0], [x1, y + 0.5, z1], wood); P([x0, y, z0], [x1, y + 0.45, z1], wood, { visible: false }); for (const [lx, lz] of [[x0 + 0.05, z0 + 0.05], [x1 - 0.1, z1 - 0.1]]) P([lx, y, lz], [lx + 0.05, y + 0.45, lz + 0.05], metal, { collide: false }); };
  const sofa = (x0, z0, x1, z1, y, backAt = 'n') => { P([x0, y + 0.4, z0], [x1, y + 0.85, z1], 'fabric'); P([x0, y, z0], [x1, y + 0.4, z1], 'fabric', { visible: false }); const b = backAt === 'n' ? [x0, y + 0.85, z1 - 0.18, x1, y + 1.05, z1] : [x0, y + 0.85, z0, x1, y + 1.05, z0 + 0.18]; P([b[0], b[1], b[2]], [b[3], b[4], b[5]], 'fabric', { collide: false }); };
  const chairRow = (x, z, y, n, dx) => { for (let c = 0; c < n; c++) { const cx = x + c * dx; P([cx, y + 0.42, z], [cx + 0.9, y + 0.48, z + 0.5], 'fabric', { collide: false }); P([cx, y + 0.48, z + 0.42], [cx + 0.9, y + 0.95, z + 0.5], 'fabric', { collide: false }); P([cx, y, z], [cx + 0.9, y + 0.45, z + 0.5], 'fabric', { visible: false, blocksVision: false }); for (const lx of [cx + 0.05, cx + 0.82]) P([lx, y, z + 0.05], [lx + 0.04, y + 0.42, z + 0.09], metal, { collide: false }); } };
  const vending = (x, z, y, facing = 'n') => { P([x, y, z], [x + 1.0, y + 1.9, z + 0.75], metal, { material: flat(0x8b1c1c, 0.5, 0.4), matVariant: 'vend' }); const fz = facing === 'n' ? [z + 0.75, z + 0.77] : [z - 0.02, z]; L.box([x + 0.1, y + 0.6, fz[0]], [x + 0.75, y + 1.7, fz[1]], 'metal', { material: flat(0x0e1116, 0.2, 0.5, { emissive: new THREE.Color(0xffb060), emissiveIntensity: 0.5 }), matVariant: 'vendglass', collide: false }); };
  const extinguisher = (x, y, z, facing) => { const d = facing === 'x+' ? [x, x + 0.16] : facing === 'x-' ? [x - 0.16, x] : [x - 0.08, x + 0.08]; const zz = facing === 'z+' ? [z, z + 0.16] : facing === 'z-' ? [z - 0.16, z] : [z - 0.08, z + 0.08]; L.box([d[0], y, zz[0]], [d[1], y + 0.55, zz[1]], 'metal', { collide: false, matVariant: 'red', matOverrides: { color: 0xc42a2a } }); L.box([d[0] - 0.05, y + 0.6, zz[0] - 0.05], [d[1] + 0.05, y + 0.62, zz[1] + 0.05], 'metal', { collide: false, matVariant: 'dark', matOverrides: { color: 0x444444 } }); };
  const vehicle = (x, z, alongX, color) => {
    const w = alongX ? 4.6 : 1.9, d = alongX ? 1.9 : 4.6; const m = flat(color, 0.4, 0.6);
    L.box([x - w / 2, 0.35, z - d / 2], [x + w / 2, 0.95, z + d / 2], 'metal', { material: m, matVariant: 'car' + color, uvScale: 1, tag: 'prop', physMat: 'metal' });
    L.box([x - w / 2 + (alongX ? 1.2 : 0.15), 0.95, z - d / 2 + (alongX ? 0.15 : 1.2)], [x + w / 2 - (alongX ? 1.0 : 0.15), 1.5, z + d / 2 - (alongX ? 0.15 : 1.0)], 'metal', { material: flat(0x1a1d22, 0.2, 0.5), matVariant: 'glassy', uvScale: 1, tag: 'prop', physMat: 'metal' });
    for (const [ox, oz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) { const wx = alongX ? ox : oz, wz = alongX ? oz : ox; L.box([x + wx - 0.35, 0, z + wz - 0.15], [x + wx + 0.35, 0.7, z + wz + 0.15], 'metal', { material: flat(0x111111, 0.9, 0), matVariant: 'tyre', collide: false }); }
    // lights
    const fr = alongX ? [x + w / 2 - 0.02, x + w / 2 + 0.01] : [x - 0.6, x + 0.6]; const fz = alongX ? [z - 0.6, z + 0.6] : [z + d / 2 - 0.02, z + d / 2 + 0.01];
    L.box([fr[0], 0.6, fz[0]], [fr[1], 0.75, fz[1]], 'metal', { collide: false, matVariant: 'lamp', matOverrides: { color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.3 } });
  };
  const barrier = (x, z, alongX) => { const w = alongX ? 2.0 : 0.5, d = alongX ? 0.5 : 2.0; L.box([x - w / 2, 0, z - d / 2], [x + w / 2, 0.85, z + d / 2], 'concrete', { uvScale: 1, tag: 'prop' }); L.box([x - w / 2, 0.85, z - d / 2], [x + w / 2, 0.9, z + d / 2], 'concrete', { collide: false, matVariant: 'band', matOverrides: { color: 0x7d6a5a } }); };
  const container = (x, z, alongX, color) => { const w = alongX ? 6 : 2.4, d = alongX ? 2.4 : 6; L.box([x - w / 2, 0, z - d / 2], [x + w / 2, 2.6, z + d / 2], 'metal', { material: getMaterial('roof', { color }), matVariant: 'cont' + color, uvScale: 0.5, tag: 'prop', physMat: 'metal' }); };
  const fence = (x0, z0, x1, z1) => { const horiz = (x1 - x0) > (z1 - z0); const len = horiz ? x1 - x0 : z1 - z0; const n = Math.ceil(len / 3); for (let i = 0; i <= n; i++) { const t = i / n; const x = horiz ? x0 + t * len : x0, z = horiz ? z0 : z0 + t * len; L.box([x - 0.04, 0, z - 0.04], [x + 0.04, 2.2, z + 0.04], 'metal', { uvScale: 1, tag: 'prop', blocksVision: false }); } const min = horiz ? [x0, 0, z0 - 0.02] : [x0 - 0.02, 0, z0], max = horiz ? [x1, 2.1, z0 + 0.02] : [x0 + 0.02, 2.1, z1]; const m = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], 2.1, max[2] - min[2]), flat(0x9aa0a8, 0.6, 0.6, { transparent: true, opacity: 0.35 })); m.position.set((min[0] + max[0]) / 2, 1.05, (min[2] + max[2]) / 2); L.group.add(m); L.world.add(new Collider(new THREE.Vector3(...min), new THREE.Vector3(...max), { material: 'metal', blocksVision: false, penetrable: true, penMult: 0.95, tag: 'prop' })); };
  const sandbags = (x, z, alongX, n = 3) => { for (let i = 0; i < n; i++) { const w = alongX ? 1.8 - i * 0.2 : 0.6, d = alongX ? 0.6 : 1.8 - i * 0.2; L.box([x - w / 2, i * 0.28, z - d / 2], [x + w / 2, i * 0.28 + 0.3, z + d / 2], 'fabric', { uvScale: 1, tag: 'prop', penetrable: true, penMult: 0.3, matVariant: 'sand', matOverrides: { color: 0xa89a78 } }); } };
  const bollard = (x, z) => L.box([x - 0.08, 0, z - 0.08], [x + 0.08, 0.9, z + 0.08], 'metal', { uvScale: 1, tag: 'prop', blocksVision: false });
  const dumpster = (x, z) => { L.box([x - 0.9, 0, z - 0.6], [x + 0.9, 1.2, z + 0.6], 'metal', { uvScale: 1, tag: 'prop', matVariant: 'green', matOverrides: { color: 0x3b6a3a } }); L.box([x - 0.92, 1.2, z - 0.62], [x + 0.92, 1.32, z + 0.62], 'metal', { collide: false, matVariant: 'lid', matOverrides: { color: 0x2a2a2a } }); };

  // ---- 1F ----
  let r = room('Tellers'); const x0 = r.min.x + IN, x1 = r.max.x - IN, z0 = r.min.z + IN, z1 = r.max.z - IN;
  counter(x0 + 0.8, z1 - 3.0, x1 - 1.8, z1 - 2.2, 0, 1.1, true);                       // teller counter with glass
  desk(x0 + 2.6, z0 + 3.4, 0); desk(x0 + 5.4, z0 + 3.4, 0); desk(x1 - 2.4, z0 + 2.4, 0, 1);
  P([x1 - 1.4, 0, z0], [x1 - 0.1, 2.1, z0 + 1.2], metal, { material: flat(0xd9b53a, 0.5, 0.6), matVariant: 'cab' });   // yellow display cabinet
  P([x0, 0, z1 - 1.6], [x0 + 0.8, 1.2, z1 - 0.8], metal);                                 // safe
  shelf(x0 + 3.2, z1 - 0.5, x0 + 7.0, z1, 0, 2.0, wood);
  painting(x0 + 5.4, 1.3, r.min.z + 0.19, 1.6, 1.0, 'z');
  papers(x0 + 0.5, z0 + 0.5, x1 - 0.5, z1 - 3.4, 40); fan(r.center.x, r.center.z, 3.0);
  // Bathroom: stalls + sinks
  r = room('Bathroom');
  P([r.min.x + IN, 0, r.max.z - IN - 0.8], [r.min.x + IN + 2.2, 0.85, r.max.z - IN], 'tileDark');
  for (let i = 0; i < 3; i++) { const zz = r.min.z + 0.5 + i * 1.5; P([r.min.x + 2.5, 0, zz], [r.min.x + 2.54, 2.0, zz + 1.2], metal, { pen: true, penMult: 0.8 }); P([r.min.x + IN, 0.4, zz + 0.2], [r.min.x + IN + 0.6, 0.8, zz + 0.9], 'tileDark'); }
  P([r.min.x + 2.54, 0, r.min.z + 0.5], [r.max.x - IN, 0.02, r.min.z + 5.0], 'tileDark', { collide: false });
  for (const zz of [r.max.z - 1.2, r.max.z - 2.0]) L.box([r.min.x + 0.2, 1.2, zz - 0.35], [r.min.x + 0.22, 1.9, zz + 0.35], 'metal', { collide: false, matVariant: 'mirror', matOverrides: { color: 0xdde6ee, metalness: 1, roughness: 0.05 } });
  // Vent room: AC units, ducts
  r = room('Ventilation Room');
  P([r.min.x + 0.4, 0, r.min.z + 0.7], [r.min.x + 2.8, 1.6, r.min.z + 2.5], metal); P([r.max.x - 2.5, 0, r.min.z + 0.7], [r.max.x - 0.4, 1.6, r.min.z + 2.5], metal);
  P([r.min.x + 0.4, 2.5, r.max.z - 1.0], [r.max.x - 0.4, 3.0, r.max.z - 0.4], metal, { collide: false }); P([r.min.x + 2.8, 1.6, r.min.z + 1.0], [r.min.x + 3.5, 2.5, r.min.z + 1.7], metal, { collide: false });
  for (let i = 0; i < 4; i++) L.box([r.min.x + 0.6 + i * 1.6, 2.6, r.min.z + 0.2], [r.min.x + 1.4 + i * 1.6, 3.0, r.min.z + 0.22], 'metal', { collide: false, matVariant: 'grille', matOverrides: { color: 0x555555 } });   // wall grilles
  crate(r.min.x + 1.2, r.max.z - 1.6, 0, 0.8, 0.8); crate(r.max.x - 1.4, r.max.z - 2.4, 0, 0.7, 0.7);
  // Workshop
  r = room('Workshop');
  P([r.min.x + IN, 0, r.min.z + 0.8], [r.min.x + 4.6, 0.95, r.min.z + 1.7], wood); P([r.min.x + IN, 0, r.max.z - 1.8], [r.min.x + 3.6, 0.95, r.max.z - 0.8], wood);
  shelf(r.max.x - 0.5, r.max.z - 4.0, r.max.x - 0.08, r.max.z - 0.3, 0, 2.2, metal); crate(r.min.x + 7.8, r.min.z + 2.5, 0, 1.0, 1.0); crate(r.min.x + 9.2, r.min.z + 3.8, 0, 0.8, 0.8); crate(r.min.x + 7.5, r.min.z + 6.2, 0, 1.1, 0.6, wood);
  P([r.min.x + 5.5, 0, r.min.z + 4.2], [r.min.x + 6.3, 0.75, r.min.z + 5.0], metal);   // toolbox cart
  for (let i = 0; i < 5; i++) L.box([r.min.x + 0.6 + i * 0.7, 1.4, r.min.z + 0.19], [r.min.x + 1.1 + i * 0.7, 1.9, r.min.z + 0.22], 'metal', { collide: false, matVariant: 'tools', matOverrides: { color: 0x3a3a3a } });   // pegboard tools
  // Lobby
  r = room('Lobby');
  pillar(r.min.x + 3.75, r.min.z + 5); pillar(r.max.x - 3.75, r.min.z + 5);
  P([r.min.x + 1.2, 0, r.max.z - 2.2], [r.min.x + 5.0, 0.9, r.max.z - 1.4], wood);   // reception desk
  P([r.min.x + 6.2, 0, r.max.z - 2.1], [r.min.x + 6.8, 1.9, r.max.z - 1.6], metal, { material: flat(0x14181e, 0.35, 0.6, { emissive: new THREE.Color(0x2a6cff), emissiveIntensity: 0.12 }), matVariant: 'kiosk' });
  sofa(r.min.x + 0.7, r.min.z + 1.2, r.min.x + 3.2, r.min.z + 2.2, 0, 's'); sofa(r.max.x - 3.2, r.min.z + 1.2, r.max.x - 0.7, r.min.z + 2.2, 0, 's');
  P([r.min.x + 3.5, 0.4, r.min.z + 1.3], [r.min.x + 4.4, 0.45, r.min.z + 2.1], woodL, { collide: false }); P([r.min.x + 3.5, 0, r.min.z + 1.3], [r.min.x + 4.4, 0.4, r.min.z + 2.1], woodL, { visible: false });   // coffee table
  painting(r.min.x + 1.4, 1.4, r.max.z - 0.19, 2.4, 1.0, 'z');
  vending(r.max.x - 1.3, r.max.z - 1.0, 0, 's');
  // Main Hallway
  r = room('Main Hallway');
  bench(r.max.x - 2.8, r.max.z - 0.75, r.max.x - 0.6, r.max.z - 0.25, 0);
  extinguisher(r.max.x - 0.2, 0.9, r.min.z + 3.0, 'x-');
  // Waiting room: rows of chairs, vending machine
  r = room('Waiting Room');
  for (let row = 0; row < 3; row++) chairRow(r.min.x + 1.4, r.min.z + 2.4 + row * 2.3, 0, 5, 1.15);
  vending(r.max.x - 1.6, r.max.z - 1.0, 0, 's');
  L.box([r.min.x + 0.19, 1.5, r.min.z + 0.7], [r.min.x + 0.21, 2.1, r.min.z + 2.7], 'paper', { collide: false, uvScale: 1 });   // notice board
  // Detention: cells with bars
  r = room('Detention');
  bars(r.min.x + 3.3, r.center.z, r.min.x + 3.3, r.max.z - 0.3); bars(r.min.x + 0.3, r.center.z, r.min.x + 3.3, r.center.z);
  P([r.min.x + 0.5, 0, r.max.z - 1.3], [r.min.x + 2.9, 0.5, r.max.z - 0.5], wood);                      // cell bunk
  P([r.min.x + 4.0, 0, r.min.z + 5.5], [r.min.x + 6.5, 0.9, r.min.z + 6.4], wood);                     // guard desk
  bench(r.min.x + 0.6, r.min.z + 0.3, r.min.x + 3.0, r.min.z + 0.8, 0); bench(r.min.x + 4.5, r.min.z + 0.3, r.min.x + 7.0, r.min.z + 0.8, 0);
  // Exit hallway: lockers, benches
  r = room('Exit Hallway');
  locker(r.min.x + 5.3, r.max.z - 0.72, 0, 9, true); bench(r.min.x + 1.0, r.min.z + 0.3, r.min.x + 3.4, r.min.z + 0.8, 0);
  extinguisher(r.min.x + 0.2, 0.9, r.min.z + 3.5, 'x+');
  // Customs Inspection: tables, x-ray, crates, conveyor
  r = room('Customs Inspection');
  P([r.min.x + 1.0, 0, r.min.z + 6.2], [r.min.x + 7.0, 0.9, r.min.z + 7.6], metal); P([r.max.x - 6.2, 0, r.min.z + 6.2], [r.max.x - 1.0, 0.9, r.min.z + 7.6], metal);
  P([r.min.x + 2.4, 0, r.min.z + 1.0], [r.min.x + 5.6, 1.9, r.min.z + 2.8], metal, { material: flat(0xc8c8cc, 0.4, 0.7), matVariant: 'xray' });
  P([r.min.x + 6.0, 0.7, r.min.z + 1.5], [r.min.x + 9.6, 0.8, r.min.z + 2.3], metal); P([r.min.x + 6.0, 0, r.min.z + 1.5], [r.min.x + 9.6, 0.7, r.min.z + 2.3], metal, { visible: false });   // conveyor
  crate(r.max.x - 1.7, r.max.z - 1.7, 0, 1.2, 1.2); crate(r.max.x - 3.0, r.min.z + 1.6, 0, 0.9, 0.9); crate(r.max.x - 1.6, r.min.z + 1.4, 0, 0.8, 1.4);
  for (let i = 0; i < 3; i++) L.box([r.min.x + 10.4 + i * 1.2, 2.5, r.min.z + 0.19], [r.min.x + 11.2 + i * 1.2, 3.0, r.min.z + 0.21], 'paper', { collide: false, uvScale: 1 });   // posters
  // Supply room: shelves
  r = room('Supply Room');
  shelf(r.min.x + 0.5, r.min.z + 4.6, r.min.x + 1.0, r.max.z - 0.3, 0, 2.2, metal); shelf(r.min.x + 2.4, r.min.z + 1.6, r.min.x + 2.9, r.max.z - 1.6, 0, 2.2, metal); shelf(r.max.x - 2.4, r.min.z + 2.0, r.max.x - 1.9, r.max.z - 0.5, 0, 2.2, metal);
  crate(r.min.x + 4.3, r.max.z - 0.9, 0, 0.8, 0.8);
  // Passport check: booths
  r = room('Passport Check');
  for (let i = 0; i < 2; i++) { const bx = r.min.x + 0.8 + i * 3.4; counter(bx, r.min.z + 2.5, bx + 1.6, r.min.z + 3.7, 0, 1.1, true); }
  P([r.max.x - 1.4, 0, r.max.z - 1.6], [r.max.x - 0.4, 1.4, r.max.z - 0.5], metal);
  for (let i = 0; i < 2; i++) L.box([r.min.x + 1.2 + i * 3.4, 2.2, r.min.z + 2.0], [r.min.x + 2.0 + i * 3.4, 2.5, r.min.z + 2.04], 'metal', { collide: false, matVariant: 'signblue', matOverrides: { color: 0x1f4fa0, emissive: 0x1f4fa0, emissiveIntensity: 0.4 } });   // lane signs
  // ---- 2F ----
  const F = FLOOR_H;
  r = room('Armory Lockers');
  locker(r.min.x + 0.6, r.min.z + IN, F, 5, true); locker(r.min.x + 4.4, r.min.z + 4.4, F, 7, true); locker(r.min.x + 4.4, r.min.z + 4.9, F, 7, true);
  P([r.max.x - 1.4, F, r.min.z + 0.8], [r.max.x - 0.5, F + 1.0, r.min.z + 5.0], wood); bench(r.min.x + 0.5, r.max.z - 1.4, r.min.x + 3.6, r.max.z - 0.9, F);
  for (let i = 0; i < 6; i++) if (i !== 3) L.box([r.min.x + 0.5 + i * 1.6, F + 1.3, r.max.z - 0.22], [r.min.x + 1.2 + i * 1.6, F + 2.3, r.max.z - 0.19], 'metal', { collide: false, matVariant: 'rack', matOverrides: { color: 0x2f3338 } });   // weapon racks
  r = room('Archives');
  for (let i = 0; i < 3; i++) { P([r.min.x + 1.2 + i * 3.2, F, r.min.z + 1.2], [r.min.x + 1.8 + i * 3.2, F + 2.0, r.max.z - 1.6], metal, { pen: true, penMult: 0.5 }); }
  P([r.min.x + 1.2, F, r.max.z - 0.9], [r.min.x + 3.8, F + 1.3, r.max.z - 0.4], metal); P([r.min.x + 6.2, F, r.max.z - 0.9], [r.max.x - 1.2, F + 1.3, r.max.z - 0.4], metal);
  r = room('Break Room');
  table(r.min.x + 3.6, r.min.z + 4.2, r.min.x + 6.4, r.min.z + 5.8, F);
  P([r.min.x + IN, F, r.max.z - 1.2], [r.min.x + 4.0, F + 0.9, r.max.z - 0.4], wood); P([r.max.x - 1.4, F, r.max.z - 1.5], [r.max.x - 0.4, F + 1.9, r.max.z - 0.4], metal, { matVariant: 'fridge', matOverrides: { color: 0xd8dadd } });
  for (const [x, z] of [[3.1, 3.7], [6.9, 3.7], [3.1, 6.3], [6.9, 6.3]]) { P([r.min.x + x - 0.22, F + 0.42, r.min.z + z - 0.22], [r.min.x + x + 0.22, F + 0.47, r.min.z + z + 0.22], 'fabric', { collide: false }); P([r.min.x + x - 0.22, F, r.min.z + z - 0.22], [r.min.x + x + 0.22, F + 0.42, r.min.z + z + 0.22], 'fabric', { visible: false }); }
  vending(r.min.x + 5.0, r.max.z - 1.0, F, 's');
  r = room('Offices');
  for (const [x, z] of [[2.5, 3.1], [6.25, 3.1], [10, 3.1], [2.5, 7.5], [6.25, 7.5], [10, 7.5]]) desk(r.min.x + x, r.min.z + z, F);
  for (const x of [4.4, 8.1]) P([r.min.x + x, F, r.min.z + 1.6], [r.min.x + x + 0.06, F + 1.5, r.min.z + 9.0], 'fabric', { pen: true, penMult: 0.7 });
  P([r.max.x - 0.9, F, r.min.z + 0.5], [r.max.x - 0.3, F + 1.5, r.min.z + 1.7], metal);   // filing cabinet
  r = room('Upper Hallway');
  bench(r.max.x - 2.6, r.max.z - 0.75, r.max.x - 0.6, r.max.z - 0.25, F); extinguisher(r.max.x - 0.2, F + 0.9, r.min.z + 1.0, 'x-');
  r = room('Security Room');
  P([r.min.x + 0.5, F, r.max.z - 0.7], [r.max.x - 0.5, F + 2.2, r.max.z - 0.3], metal, { matVariant: 'console', matOverrides: { color: 0x2a2e34 } });
  for (let row = 0; row < 2; row++) for (let i = 0; i < 6; i++) { const sx = r.min.x + 0.8 + i * 1.45; L.box([sx, F + 0.75 + row * 0.7, r.max.z - 0.72], [sx + 1.2, F + 1.35 + row * 0.7, r.max.z - 0.7], 'metal', { collide: false, matVariant: 'screen' + ((i + row) % 3), material: flat(0x0a0f18, 0.25, 0.5, { emissive: new THREE.Color([0x55b0ff, 0x3d8fd8, 0x7fc3ff][(i + row) % 3]), emissiveIntensity: 0.55 }) }); }
  table(r.min.x + 1.6, r.max.z - 5.6, r.max.x - 1.6, r.max.z - 4.6, F, woodL); for (let i = 0; i < 4; i++) L.box([r.min.x + 2.2 + i * 1.6, F + 0.8, r.max.z - 5.2], [r.min.x + 2.7 + i * 1.6, F + 1.1, r.max.z - 5.15], 'metal', { collide: false, matVariant: 'mon', material: flat(0x0e1116, 0.3, 0.6, { emissive: new THREE.Color(0x2a6cff), emissiveIntensity: 0.9 }) });
  P([r.min.x + IN, F, r.min.z + 0.5], [r.min.x + 1.0, F + 2.0, r.min.z + 4.2], metal); P([r.max.x - 1.0, F, r.min.z + 0.5], [r.max.x - IN, F + 2.0, r.min.z + 3.0], metal);
  r = room('Fountain');
  P([r.center.x - 1.5, F, r.center.z - 1.5], [r.center.x + 1.5, F + 0.6, r.center.z + 1.5], 'tile'); P([r.center.x - 0.9, F + 0.6, r.center.z - 0.9], [r.center.x + 0.9, F + 0.7, r.center.z + 0.9], 'tile', { material: flat(0x3a6d8a, 0.05, 0.1, { transparent: true, opacity: 0.7 }), matVariant: 'water', collide: false });
  L.box([r.center.x - 0.15, F + 0.6, r.center.z - 0.15], [r.center.x + 0.15, F + 1.3, r.center.z + 0.15], 'tile', { collide: false });
  P([r.min.x + 0.5, F, r.min.z + 0.5], [r.min.x + 1.3, F + 0.6, r.min.z + 2.0], 'tile'); P([r.max.x - 1.3, F, r.min.z + 0.5], [r.max.x - 0.5, F + 0.6, r.min.z + 1.8], 'tile');   // planters
  bench(r.min.x + 0.5, r.max.z - 1.1, r.min.x + 2.6, r.max.z - 0.6, F);
  r = room('Upper Exit');
  locker(r.min.x + 0.6, r.min.z + IN, F, 7, true);
  r = room('Kitchen');
  P([r.min.x + 0.6, F, r.min.z + IN], [r.min.x + 7.5, F + 0.9, r.min.z + 1.1], 'tileDark'); P([r.max.x - 5.6, F, r.min.z + IN], [r.max.x - 0.6, F + 0.9, r.min.z + 1.1], 'tileDark'); P([r.max.x - 1.4, F, r.max.z - 1.4], [r.max.x - 0.4, F + 1.9, r.max.z - 0.4], metal, { matVariant: 'fridge', matOverrides: { color: 0xd8dadd } });
  L.box([r.min.x + 0.6, F + 1.5, r.min.z + 0.19], [r.max.x - 0.6, F + 2.2, r.min.z + 0.5], 'woodLight', { collide: false, uvScale: 1 });   // upper cabinets
  for (const x of [3.0, 10.0]) { table(r.min.x + x, r.min.z + 5.5, r.min.x + x + 3.0, r.min.z + 7.3, F); for (const [cx, cz] of [[x + 0.6, 4.9], [x + 2.4, 4.9], [x + 0.6, 7.9], [x + 2.4, 7.9]]) { P([r.min.x + cx - 0.22, F + 0.42, r.min.z + cz - 0.22], [r.min.x + cx + 0.22, F + 0.47, r.min.z + cz + 0.22], 'fabric', { collide: false }); P([r.min.x + cx - 0.22, F, r.min.z + cz - 0.22], [r.min.x + cx + 0.22, F + 0.42, r.min.z + cz + 0.22], 'fabric', { visible: false }); } }
  r = room('East Hallway');
  bench(r.min.x + 3.8, r.max.z - 0.75, r.min.x + 6.8, r.max.z - 0.25, F); extinguisher(r.max.x - 0.2, F + 0.9, r.min.z + 4.0, 'x-');

  // ---- exterior ----
  // east: vehicle entrance with a canopy, parked cars, jersey barriers, containers
  const canopyY = 3.5;
  L.box([BW, canopyY, S(1.2)], [BW + 6, canopyY + 0.25, S(8.5)], 'metal', { uvScale: 0.5, matVariant: 'canopy', matOverrides: { color: 0x6b6f75 } });
  for (const z of [S(1.6), S(8.1)]) L.box([BW + 5.5, 0, z - 0.2], [BW + 5.9, canopyY, z + 0.2], 'metal', { uvScale: 1, tag: 'prop' });
  L.textSign('CUSTOMS  ·  VEHICLES', BW + 0.05, 3.1, S(4.5), 'x+', { w: 3.2, h: 0.5, bg: '#26221c', fg: '#f0d9a0', emissive: 0.5 });
  vehicle(50, 16, false, 0x2b3b52); vehicle(50, 26, false, 0xc9c3b6); vehicle(47, 4, true, 0x6a1f1f); vehicle(52, 34, false, 0x3a4a3a);
  barrier(43.5, 12, false); barrier(43.5, 19, false); container(55, 40, true, 0x8a3a2a);
  sandbags(BW + 3, S(11), true); dumpster(BW + 3.5, S(19));
  // south: main entrance with awning, sign, bollards, zebra crossing, bus shelter, guard booth
  L.box([S(14) - 1.2, 2.75, -1.6], [S(16) + 1.2, 2.9, 0], 'metal', { uvScale: 0.5, collide: false, matVariant: 'canopy', matOverrides: { color: 0x6b6f75 } });
  for (const x of [S(14) - 1.0, S(16) + 1.0]) L.box([x - 0.06, 0, -1.5], [x + 0.06, 2.75, -1.38], 'metal', { uvScale: 1, tag: 'prop' });
  L.textSign('BORDER CONTROL', S(15), 3.4, -0.05, 'z-', { w: 4.2, h: 0.62, bg: '#1b2432', fg: '#f4f4f4', emissive: 0.55 });
  for (let x = 2; x < BW - 1; x += 3.2) bollard(x, -2.0);
  for (let i = 0; i < 6; i++) L.box([S(15) - 1.6 + i * 0.6, 0.02, -4.0], [S(15) - 1.2 + i * 0.6, 0.03, -2.6], 'concrete', { collide: false, matVariant: 'paint', matOverrides: { color: 0xe8e8e8 } });   // zebra
  L.box([6, 0, -6.4], [10, 0.08, -4.6], 'concrete', { uvScale: 1, tag: 'prop' }); L.box([6, 2.4, -6.6], [10, 2.55, -4.4], 'metal', { uvScale: 0.5, collide: false, matVariant: 'canopy', matOverrides: { color: 0x6b6f75 } });
  for (const x of [6.1, 9.9]) L.box([x - 0.05, 0, -6.5], [x + 0.05, 2.4, -6.4], 'metal', { uvScale: 1, tag: 'prop' });
  bench(6.4, -6.2, 9.6, -5.7, 0.08); L.textSign('BUS', 8, 2.15, -6.62, 'z-', { w: 1.2, h: 0.4, bg: '#1d3a6a', fg: '#ffffff', emissive: 0.4 });
  L.box([35, 0, -7], [38.5, 2.6, -4.2], 'stucco', { uvScale: 0.5, tag: 'prop' }); L.box([34.8, 2.6, -7.2], [38.7, 2.8, -4.0], 'metal', { uvScale: 0.5, collide: false, matVariant: 'canopy', matOverrides: { color: 0x6b6f75 } });   // guard booth
  vehicle(12, -10, true, 0x3d3d44); vehicle(28, -10, true, 0xb8b0a0);
  barrier(10, -3.4, true); barrier(30, -3.4, true);
  // west: parking, containers, dumpster
  vehicle(-9.5, 6, false, 0x1f3a2a); vehicle(-9.5, 20, false, 0x8a8a8a); vehicle(-9.5, 27, false, 0x6e5a3a);
  barrier(-3.8, 1, false); barrier(-3.8, 6, false); container(-15, 36, true, 0x2a4a7a);
  dumpster(-4.5, 24); sandbags(-4, 12, false);
  // north: yard with fence, containers, crates
  fence(-5, 32, BW + 5, 32); fence(-5, 32, -5, 46); fence(BW + 5, 32, BW + 5, 46);
  container(8, 37, true, 0x3a6a3a); container(28, 38, true, 0x8a3a2a); crate(18, 36, 0, 1.2, 1.2); crate(19.5, 36.5, 0, 0.9, 0.9);
  // trees (off the spawns and approaches)
  for (const [x, z, h, r2, s] of [[-8, -21, 6.5, 2.4, 1], [-21, 2, 7, 2.6, 2], [-22, 24, 6, 2.2, 3], [62, -8, 6.5, 2.4, 4], [61, 14, 7, 2.8, 5], [61, 30, 6, 2.3, 6], [-22, 42, 7, 2.6, 7], [18, 50, 8, 3.0, 8], [40, 43, 6.5, 2.4, 9], [4, -21, 5.5, 2.0, 10], [30, -21, 6, 2.3, 11]]) L.tree(x, z, h, r2, s);
  // road markings
  for (let x = -38; x < 78; x += 4) L.box([x, 0.021, -10.6], [x + 2, 0.026, -10.45], 'concrete', { collide: false, matVariant: 'paint', matOverrides: { color: 0xe8e8e8 } });
  for (let z = -15; z < 46; z += 4) { L.box([50.9, 0.021, z], [51.1, 0.026, z + 2], 'concrete', { collide: false, matVariant: 'paint', matOverrides: { color: 0xe8e8e8 } }); L.box([-11.1, 0.021, z], [-10.9, 0.026, z + 2], 'concrete', { collide: false, matVariant: 'paint', matOverrides: { color: 0xe8e8e8 } }); }
  // lamp posts
  for (const [x, z] of [[-4.2, -4.5], [-4.2, 31], [BW + 4.2, -4.5], [BW + 4.2, 31], [16, -3.6], [26, -3.6], [20, 34]]) { L.box([x - 0.1, 0, z - 0.1], [x + 0.1, 6, z + 0.1], 'metal', { uvScale: 1, tag: 'prop' }); L.box([x - 0.1, 5.9, z - 0.1], [x + 0.7, 6.05, z + 0.1], 'metal', { collide: false }); L.light(x + 0.5, 5.8, z, 0xffe0b0, 30, 18, { fw: 0.5, fd: 0.5, emissive: 1.2 }); }
  // flag poles by the entrance
  for (const x of [S(11), S(19)]) { L.box([x - 0.06, 0, -1.9], [x + 0.06, 7.5, -1.78], 'metal', { uvScale: 1, tag: 'prop', blocksVision: false }); L.box([x + 0.06, 6.2, -1.86], [x + 1.3, 6.9, -1.82], 'fabric', { collide: false, matVariant: 'flag', matOverrides: { color: 0xb02020 } }); }
}

// Wall dressing derived from the openings: room-name plaques over interior doors, exit signs, radiators
// and blinds under exterior windows, and baseboards/cornices in every room.
function dressing(L) {
  for (const r of L.rooms) L.trimRoom(r, { wallH: WALL_H });
  let blind = 0;
  for (const o of L.openings) {
    const n = o.horizontal ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    if (o.kind === 'door' || o.kind === 'arch' || o.kind === 'garage') {
      for (const s of [1, -1]) {
        const p = new THREE.Vector3(o.x, o.y + 1, o.z).addScaledVector(n, s * 0.8);
        const other = L.roomAt(new THREE.Vector3(o.x, o.y + 1, o.z).addScaledVector(n, -s * 0.8));
        const here = L.roomAt(p);
        if (!here) continue;                                   // outside: no plaque on the street side
        const facing = o.horizontal ? (s > 0 ? 'z+' : 'z-') : (s > 0 ? 'x+' : 'x-');
        const sp = new THREE.Vector3(o.x, o.y + o.h + 0.24, o.z).addScaledVector(n, s * (o.exterior ? 0.2 : 0.1));
        if (o.exterior) L.textSign('EXIT', sp.x, sp.y, sp.z, facing, { w: 0.55, h: 0.2, bg: '#0f3d1e', fg: '#c8ffd0', emissive: 0.9, size: 0.62 });
        else if (other && other !== here) L.textSign(other.name.toUpperCase(), sp.x, sp.y, sp.z, facing, { w: Math.min(1.6, 0.35 + other.name.length * 0.085), h: 0.2, bg: '#1d2129', fg: '#e9ecf1', emissive: 0.2, size: 0.55 });
      }
    }
    if (o.kind === 'window' && o.exterior) {
      // radiator below, blinds on every other window (inside face)
      const inward = L.center.clone().sub(new THREE.Vector3(o.x, 0, o.z)); inward.y = 0; const s = Math.sign(inward.dot(n)) || 1;
      const face = new THREE.Vector3(o.x, 0, o.z).addScaledVector(n, s * 0.26);
      const w = o.w - 0.2;
      const rad = o.horizontal ? [[face.x - w / 2, o.y - 0.7, face.z - 0.06], [face.x + w / 2, o.y - 0.12, face.z + 0.06]] : [[face.x - 0.06, o.y - 0.7, face.z - w / 2], [face.x + 0.06, o.y - 0.12, face.z + w / 2]];
      if (o.y > 0.75) { L.box(rad[0], rad[1], 'metal', { collide: false, uvScale: 1, matVariant: 'rad', matOverrides: { color: 0xbfc3c8 } }); for (let k = 0; k < 6; k++) { const t = -w / 2 + 0.1 + k * (w - 0.2) / 5; const fin = o.horizontal ? [[face.x + t - 0.02, o.y - 0.68, face.z - 0.075], [face.x + t + 0.02, o.y - 0.14, face.z + 0.075]] : [[face.x - 0.075, o.y - 0.68, face.z + t - 0.02], [face.x + 0.075, o.y - 0.14, face.z + t + 0.02]]; L.box(fin[0], fin[1], 'metal', { collide: false, uvScale: 1, matVariant: 'rad', matOverrides: { color: 0xbfc3c8 } }); } }
      if (blind++ % 2 === 0) { const f2 = new THREE.Vector3(o.x, 0, o.z).addScaledVector(n, s * 0.23); for (let k = 0; k < 10; k++) { const yy = o.y + 0.05 + k * (o.h - 0.1) / 10; const b = o.horizontal ? [[f2.x - w / 2, yy, f2.z - 0.01], [f2.x + w / 2, yy + 0.05, f2.z + 0.01]] : [[f2.x - 0.01, yy, f2.z - w / 2], [f2.x + 0.01, yy + 0.05, f2.z + w / 2]]; L.box(b[0], b[1], 'fabric', { collide: false, uvScale: 1, matVariant: 'blind', matOverrides: { color: 0xd8d2c4 } }); } }
    }
  }
}
