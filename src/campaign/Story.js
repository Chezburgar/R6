import { OperatorById } from '../data/operators.js';

// OPERATION KESTREL — the single-player campaign. Six linear missions on Border, each a different
// mission type built on the match systems (drone intel, destruction, AI plans, planting/defusing).
// This file is pure data: story text, objectives, rosters, spawns, timings and radio dialogue.
// The mission logic lives in CampaignMatch.js.

export const CAMPAIGN = {
  title: 'OPERATION KESTREL',
  tagline: 'SIX MISSIONS · ONE CROSSING',
  prologue: [
    'Forty-eight hours ago a White Mask cell seized Checkpoint 9 — a customs station on a remote desert crossing. Traffic was turned back, the station staff are unaccounted for, and thermal imaging shows activity on both floors.',
    'Intelligence believes the station is being used to move a chemical dispersal device across the frontier. The local authorities have pulled back to the highway and requested Rainbow.',
    'Six has cleared the operation. Ten operators are on the ground. You are one of them.',
  ],
  epilogue: [
    'Checkpoint 9 is quiet. The canisters are in a containment truck on the highway, the station staff are home, and the White Masks have lost a cell they spent a year building.',
    'Six\'s debrief is short. "Good work. Get some sleep. There is always another door."',
    'OPERATION KESTREL — COMPLETE',
  ],
};

// Enemy operators: the White Masks wear the defender / attacker bodies with a darker tint. They die
// outright (no DBNO) like Terrorist Hunt targets.
const MASK_TINT = 0x6f747c;
export function maskOp(baseId, name = 'WHITE MASK') { const o = OperatorById[baseId]; return { ...o, id: 'wm_' + o.id, name, ctu: 'WHITE MASKS', tint: MASK_TINT }; }
export const HOSTAGE_OP = { ...OperatorById.lion, id: 'hostage', name: 'HOSTAGE', real: 'Adrian Vale', ctu: 'CUSTOMS CHIEF', speed: 2, armor: 2, tint: 0x8f97a8, icon: 'ops' };
export const COURIER_OP = { ...maskOp('kapkan', 'THE COURIER'), id: 'wm_courier', ctu: 'HIGH-VALUE TARGET', tint: 0x3a3d45 };

// Radio speakers
export const SPEAKERS = { six: 'SIX', thatcher: 'THATCHER', sledge: 'SLEDGE', ash: 'ASH', rook: 'ROOK', lion: 'LION', hostage: 'VALE', overwatch: 'OVERWATCH' };

// Each mission: type drives the CampaignMatch script; objectives are listed in order and shown on the HUD.
// Dialogue keys are events the script fires: start, intro, first objective ids, contact, complete...
export const MISSIONS = [
  {
    id: 'eyes-on', code: 'MISSION 01', name: 'EYES ON', type: 'recon', side: 'atk', tod: 'night', clock: '02:10',
    location: 'CHECKPOINT 9 — SOUTH ROAD', featured: 'lion', allies: [], par: 240,
    summary: 'Drive a drone through the ground floor, identify the hostiles fortifying the station and find the device.',
    brief: [
      'The station has been dark for two days. Before anyone goes through a door, Six wants to know what is waiting inside.',
      'You will run the drone from the south road. The drone holes at the base of the exterior walls are your way in. Hold X on a hostile to identify them for the team, and find the device — thermal puts it on the ground floor.',
      'Do not engage. Stay on the drone; you have a spare if the first one is lost.',
    ],
    intel: ['Six hostiles on the ground floor, fortifying', 'Mute jammers likely near the device', 'No engagement authorised'],
    objectives: [
      { id: 'identify', text: 'Identify 4 hostiles', count: 4 },
      { id: 'device', text: 'Locate the device' },
      { id: 'exfil', text: 'Bring the drone home' },
    ],
    bonus: { id: 'identifyAll', text: 'Identify all 6 hostiles', star: true },
    enemies: 6, enemyDiff: 'normal', site: 'tellers', spawn: 2,
    dialogue: {
      start: [['six', 'Rainbow, this is Six. The station has been dark for two days. I need to know what is waiting for us before anyone goes through a door.'], ['thatcher', 'Drone is up. Keep it quiet — the drone holes on the south wall are your way in.']],
      identify1: [['thatcher', 'Good. That is one. Mark the rest.']],
      identify: [['six', 'Four hostiles marked. Now find the device.']],
      device: [['six', 'That is the device. Do not touch anything — we deal with it when we go in.']],
      identifyAll: [['thatcher', 'Every one of them marked. Nice work.']],
      jammed: [['thatcher', 'Signal is jammed. Mute has the site wired — back the drone out and find another angle.']],
      exfil: [['six', 'That is everything I need. Bring the drone home. We go in at first light.']],
    },
  },
  {
    id: 'breach', code: 'MISSION 02', name: 'BREACH', type: 'assault', side: 'atk', tod: 'dawn', clock: '05:40',
    location: 'CHECKPOINT 9 — GROUND FLOOR', featured: 'sledge', allies: ['thatcher', 'ash'], par: 300,
    summary: 'First light. Breach the ground floor with Thatcher and Ash and clear every hostile you find.',
    brief: [
      'The recon confirmed it: seven White Masks on the ground floor, dug in around Tellers and the Lobby with reinforcements and barricades.',
      'You go in at first light with Thatcher and Ash. Pick your entry — the south doors, the west side, or through a wall of your own making. Clear room by room. Nobody leaves the building.',
      'Watch the drywall. Bullets go through it both ways.',
    ],
    intel: ['Seven hostiles, ground floor', 'Reinforced walls around Tellers', 'Traps on the doorways'],
    objectives: [
      { id: 'breach', text: 'Breach the station' },
      { id: 'clear', text: 'Eliminate all hostiles', count: 7 },
    ],
    bonus: { id: 'noAllyLoss', text: 'No teammates lost', star: true },
    enemies: 7, enemyDiff: 'easy', site: 'tellers', spawn: 2, prepTime: 20, enemyRooms: ['Tellers', 'Lobby', 'Bathroom', 'Ventilation Room', 'Main Hallway', 'Workshop', 'Waiting Room'],
    dialogue: {
      start: [['six', 'Rainbow, you are cleared. Breach the ground floor and clear it. Nobody leaves that building.'], ['sledge', 'Hammer is ready. Say the word and I make a door.']],
      breach: [['thatcher', 'We are in. Slow and quiet — check every corner.']],
      contact: [['ash', 'Contact! Hostiles in the building!']],
      half: [['thatcher', 'Half of them down. Keep pushing.']],
      lastOne: [['six', 'One hostile left. Finish it.']],
      complete: [['six', 'Ground floor is clear. Hold what you have taken — we are moving the team in.']],
    },
  },
  {
    id: 'hold-the-line', code: 'MISSION 03', name: 'HOLD THE LINE', type: 'defend', side: 'def', tod: 'day', clock: '13:25',
    location: 'CHECKPOINT 9 — CUSTOMS INSPECTION', featured: 'rook', allies: ['mute', 'frost', 'kapkan'], par: 420,
    summary: 'Rainbow holds the station now and the White Masks want it back. Fortify Customs Inspection and repel three waves.',
    brief: [
      'The cell pulled back to the hills and they are coming back in force. They want the station — and the device they left inside it.',
      'You have forty-five seconds to fortify Customs Inspection and the Supply Room: reinforce the walls, board the doors, set your traps. Then hold. Three waves. The relief column is an hour out.',
      'Mute, Frost and Kapkan are with you. Rook\'s armor is on the floor for anyone who wants it.',
    ],
    intel: ['Three attack waves, growing in size', 'Breachers will burn through reinforcements', 'Site: Customs Inspection / Supply Room'],
    objectives: [
      { id: 'fortify', text: 'Fortify the site (45 s)' },
      { id: 'wave1', text: 'Repel the first wave' },
      { id: 'wave2', text: 'Repel the second wave' },
      { id: 'wave3', text: 'Repel the third wave' },
    ],
    bonus: { id: 'notDowned', text: 'Never downed', star: true },
    enemies: 6, enemyDiff: 'normal', site: 'customs', waves: [4, 5, 6], prepTime: 45,
    dialogue: {
      start: [['six', 'They are coming back for the station. You have forty-five seconds. Make the site a fortress.'], ['rook', 'Armor is on the floor. Take a plate, everyone.']],
      action: [['overwatch', 'Overwatch to Rainbow — vehicles on the east road. First wave inbound.']],
      wave1: [['six', 'First wave broken. Reload and reset — the next one is bigger.']],
      wave2: [['overwatch', 'Second wave down. Overwatch has movement on the south road — a lot of it.']],
      wave3: [['six', 'That is the last of them. The relief column has the road. Station is ours.']],
      breach: [['rook', 'They are burning through the wall!']],
      contact: [['rook', 'Contact! They are at the doors!']],
    },
  },
  {
    id: 'the-courier', code: 'MISSION 04', name: 'THE COURIER', type: 'hvt', side: 'atk', tod: 'dusk', clock: '18:50',
    location: 'CHECKPOINT 9 — UPPER FLOOR', featured: 'ash', allies: ['lion', 'thermite'], par: 360,
    summary: 'The detonator is with a courier moving between the upper floor rooms under guard. Drop him and recover it.',
    brief: [
      'The counterattack was a distraction. While it ran, a courier slipped back into the station carrying the detonator for the device.',
      'He is on the upper floor, moving between the Offices, the Kitchen and the Archives with a bodyguard detail. He is armoured and he will run when he hears you.',
      'Find him, drop him, take the detonator off the body and get out through the east vehicle entrance. Lion\'s scan will show you where he is moving.',
    ],
    intel: ['One high-value target, armoured', 'Six bodyguards on the upper floor', 'Extraction: east vehicle entrance'],
    objectives: [
      { id: 'locate', text: 'Locate the courier' },
      { id: 'eliminate', text: 'Eliminate the courier' },
      { id: 'recover', text: 'Recover the detonator' },
      { id: 'exfil', text: 'Exfiltrate — east vehicle entrance' },
    ],
    bonus: { id: 'noAllyLoss', text: 'No teammates lost', star: true },
    enemies: 6, enemyDiff: 'normal', site: 'armory', spawn: 0, patrol: ['Offices', 'Kitchen', 'Archives', 'Upper Hallway', 'East Hallway', 'Break Room'], hvtRooms: ['Offices', 'Kitchen', 'Archives', 'Break Room'],
    dialogue: {
      start: [['six', 'The courier is inside with the detonator. He is armoured and he has friends. Find him and end it.'], ['lion', 'I will scan when you are on the stairs. He cannot hide from that.']],
      locate: [['lion', 'There — that is him. He is moving!']],
      contact: [['thermite', 'Bodyguards! Upper floor!']],
      eliminate: [['six', 'Courier is down. Get to the body and take the detonator.']],
      recover: [['six', 'Detonator secured. Get out — east vehicle entrance. Move.']],
      exfil: [['six', 'Rainbow is clear. That is the first time in a month that thing has been in our hands.']],
    },
  },
  {
    id: 'last-call', code: 'MISSION 05', name: 'LAST CALL', type: 'hostage', side: 'atk', tod: 'night', clock: '03:35',
    location: 'CHECKPOINT 9 — UPPER FLOOR', featured: 'thatcher', allies: ['sledge'], par: 360,
    summary: 'The customs chief is alive upstairs. Find him, secure him and walk him out to the west parking lot before dawn.',
    brief: [
      'The White Masks kept one member of the station staff: the customs chief, Adrian Vale. They will execute him at dawn unless the detonator comes back.',
      'He is being held on the upper floor. Drone first — find the room — then go up with Sledge, secure him, and bring him down to the extraction van in the west parking lot.',
      'He is unarmed and he will follow you. Do not lead him into a firefight, and for God\'s sake do not shoot him.',
    ],
    intel: ['Hostage on the upper floor, two guards', 'Five more hostiles patrolling', 'Extraction: west parking lot'],
    objectives: [
      { id: 'locate', text: 'Locate the hostage' },
      { id: 'secure', text: 'Secure the hostage' },
      { id: 'extract', text: 'Extract to the west parking lot' },
    ],
    bonus: { id: 'hostageUnharmed', text: 'Hostage unharmed', star: true },
    enemies: 7, enemyDiff: 'normal', site: 'armory', spawn: 1, prepTime: 30, hostageRooms: ['Archives', 'Break Room', 'Security Room', 'Kitchen'], patrol: ['Offices', 'Upper Hallway', 'East Hallway', 'Fountain', 'Main Hallway', 'Lobby'],
    dialogue: {
      start: [['six', 'Vale is alive and they will kill him at dawn. Find him, get him out. Quietly if you can.'], ['thatcher', 'Drone in first. Let us find the room before we go up the stairs.']],
      locate: [['sledge', 'That is him. Two guards on the door. We go up.']],
      secure: [['hostage', 'Thank God. I can walk — just tell me where.'], ['six', 'Hostage secured. Extraction van is in the west parking lot. Bring him home.']],
      contact: [['sledge', 'Contact! Keep him behind you!']],
      hostageHit: [['hostage', 'I am hit! I am hit!']],
      extract: [['six', 'Vale is in the van. Well done, Rainbow. Get some rest — it is not over yet.']],
    },
  },
  {
    id: 'device', code: 'MISSION 06', name: 'DEVICE', type: 'defuse', side: 'atk', tod: 'dawn', clock: '05:55',
    location: 'CHECKPOINT 9 — BOMB SITE', featured: 'thermite', allies: ['sledge', 'thatcher', 'ash'], par: 300,
    summary: 'The detonator was a decoy. The device is on a timer and the White Masks have pulled everything they have left into the site.',
    brief: [
      'Vale told us what the courier could not: the detonator was a decoy. The device has its own timer and it started running when the station fell.',
      'Two canisters, one site, and every White Mask left in the cell dug in around them. You have until the timer runs out to get in and disable both.',
      'Thermite goes through the reinforcements, Thatcher kills the shock wire, Sledge and Ash make the openings. It is a full assault. Nothing subtle about it.',
    ],
    intel: ['Two armed canisters, one site', 'Eight hostiles, all in or around the site', 'Timer: 5 minutes'],
    objectives: [
      { id: 'reach', text: 'Reach the site' },
      { id: 'deviceA', text: 'Disable canister A' },
      { id: 'deviceB', text: 'Disable canister B' },
    ],
    bonus: { id: 'notDowned', text: 'Never downed', star: true },
    enemies: 8, enemyDiff: 'hard', spawn: 'random', timeLimit: 300, prepTime: 25,
    dialogue: {
      start: [['six', 'Five minutes on the clock. Two canisters. Everything the cell has left is in that site. Go.'], ['thermite', 'Charges are ready. Point me at a wall.']],
      reach: [['thatcher', 'We are at the site. Keep them off whoever is on the canister.']],
      deviceA: [['six', 'Canister A is down. One more.']],
      deviceB: [['six', 'Both canisters disabled. Timer is dead. Rainbow — stand down.']],
      contact: [['ash', 'Contact! They are everywhere!']],
      oneMinute: [['six', 'One minute. Whatever you are doing, do it now.']],
      fail: [['six', 'Timer expired. We lost the station and everyone in it.']],
    },
  },
];
export const MissionById = Object.fromEntries(MISSIONS.map(m => [m.id, m]));
export const DIFFICULTIES = [['easy', 'RECRUIT'], ['normal', 'OPERATOR'], ['hard', 'ELITE']];
