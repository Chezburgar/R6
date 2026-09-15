// Operator roster. Only operators with a supplied body model are included
// (5 attackers / 5 defenders). Speed/armor use Siege's 1-3 ratings; health follows the
// current 100/110/125 scheme.

export const Gadgets = {
  hammer:    { name: 'BREACHING HAMMER', desc: 'Uses a Breaching Hammer to breach through destructible surfaces.', uses: 25, kind: 'melee' },
  emp:       { name: 'EMP GRENADE', desc: 'Throws an EMP grenade that disables all electronic gadgets within its radius for 15 seconds.', uses: 3, kind: 'throw' },
  breachRound: { name: 'BREACHING ROUNDS', desc: 'Fires an explosive breaching round from a launcher that destroys soft surfaces on impact.', uses: 2, kind: 'launcher' },
  thermite:  { name: 'EXOTHERMIC CHARGE', desc: 'Places an exothermic charge that burns through reinforced walls and hatches.', uses: 2, kind: 'place' },
  lion:      { name: 'EE-ONE-D', desc: 'Launches a drone scan that detects and outlines any enemy that moves while it is active.', uses: 3, kind: 'active' },
  rook:      { name: 'ARMOR PACK', desc: 'Drops an Armor Pack. Teammates who take a plate absorb more damage and are downed instead of killed by body shots.', uses: 1, kind: 'place' },
  frost:     { name: 'WELCOME MAT', desc: 'Sets a Welcome Mat trap that downs any attacker who steps on it.', uses: 3, kind: 'place' },
  kapkan:    { name: 'ENTRY DENIAL DEVICE', desc: 'Sets a tripwire explosive on a doorway or window that detonates on any attacker who crosses it.', uses: 5, kind: 'place' },
  mute:      { name: 'SIGNAL DISRUPTOR', desc: 'Deploys a jammer that blocks drones and disables attacker explosives within its radius.', uses: 4, kind: 'place' },
  bandit:    { name: 'SHOCK WIRE', desc: 'Electrifies reinforced walls, hatches and barbed wire, destroying gadgets and damaging attackers that touch them.', uses: 4, kind: 'place' },
};

export const SecondaryGadgets = {
  frag:      { name: 'FRAG GRENADE', uses: 2, side: 'atk' },
  stun:      { name: 'STUN GRENADE', uses: 3, side: 'atk' },
  smoke:     { name: 'SMOKE GRENADE', uses: 2, side: 'atk' },
  breach:    { name: 'BREACH CHARGE', uses: 3, side: 'atk' },
  claymore:  { name: 'CLAYMORE', uses: 1, side: 'atk' },
  barbed:    { name: 'BARBED WIRE', uses: 2, side: 'def' },
  nitro:     { name: 'NITRO CELL', uses: 1, side: 'def' },
  impact:    { name: 'IMPACT GRENADE', uses: 2, side: 'def' },
  shield:    { name: 'DEPLOYABLE SHIELD', uses: 1, side: 'def' },
};

export const Operators = [
  // ---------------- attackers ----------------
  { id: 'sledge', name: 'SLEDGE', real: 'Seamus Cowden', side: 'atk', ctu: 'SAS', speed: 2, armor: 2, model: 'op_sledge', gadget: 'hammer',
    primaries: ['L85A2', 'M590A1'], secondaries: ['P226 MK 25'], gadgets2: ['frag', 'stun'], icon: 'hammer' },
  { id: 'thatcher', name: 'THATCHER', real: 'Mike Baker', side: 'atk', ctu: 'SAS', speed: 2, armor: 2, model: 'op_thatcher', gadget: 'emp',
    primaries: ['AR33', 'L85A2', 'M590A1'], secondaries: ['P226 MK 25'], gadgets2: ['breach', 'claymore'], icon: 'emp' },
  { id: 'ash', name: 'ASH', real: 'Eliza Cohen', side: 'atk', ctu: 'FBI SWAT', speed: 3, armor: 1, model: 'op_ash', gadget: 'breachRound',
    primaries: ['R4-C'], secondaries: ['5.7 USG'], gadgets2: ['breach', 'claymore', 'stun'], icon: 'breachRound' },
  { id: 'thermite', name: 'THERMITE', real: 'Jordan Trace', side: 'atk', ctu: 'FBI SWAT', speed: 2, armor: 2, model: 'op_thermite', gadget: 'thermite',
    primaries: ['556XI', 'M1014'], secondaries: ['5.7 USG'], gadgets2: ['smoke', 'stun', 'claymore'], icon: 'thermite' },
  { id: 'lion', name: 'LION', real: 'Olivier Flament', side: 'atk', ctu: 'GIGN', speed: 2, armor: 2, model: 'op_lion', gadget: 'lion',
    primaries: ['V308', 'SG-CQB'], secondaries: ['P9'], gadgets2: ['stun', 'claymore', 'smoke'], icon: 'lion' },
  // ---------------- defenders ----------------
  { id: 'rook', name: 'ROOK', real: 'Julien Nizan', side: 'def', ctu: 'GIGN', speed: 1, armor: 3, model: 'op_rook', gadget: 'rook',
    primaries: ['MP5', 'SG-CQB'], secondaries: ['P9'], gadgets2: ['impact', 'barbed'], icon: 'rook' },
  { id: 'frost', name: 'FROST', real: 'Tina Lin Tsang', side: 'def', ctu: 'JTF2', speed: 2, armor: 2, model: 'op_frost', gadget: 'frost',
    primaries: ['9MM C1', 'SUPER 90'], secondaries: ['MK1 9MM'], gadgets2: ['barbed', 'shield'], icon: 'frost' },
  { id: 'kapkan', name: 'KAPKAN', real: 'Maxim Basuda', side: 'def', ctu: 'SPETSNAZ', speed: 2, armor: 2, model: 'op_kapkan', gadget: 'kapkan',
    primaries: ['9X19VSN', 'SASG-12'], secondaries: ['PMM'], gadgets2: ['impact', 'nitro'], icon: 'kapkan' },
  { id: 'mute', name: 'MUTE', real: 'Mark Chandar', side: 'def', ctu: 'SAS', speed: 1, armor: 3, model: 'op_sledge', tint: 0x5c6f8a, gadget: 'mute',
    primaries: ['MP5K', 'M590A1'], secondaries: ['P226 MK 25'], gadgets2: ['nitro', 'barbed'], icon: 'mute' },
  { id: 'bandit', name: 'BANDIT', real: 'Dominic Brunsmeier', side: 'def', ctu: 'GSG 9', speed: 3, armor: 1, model: 'op_bandit', gadget: 'bandit',
    primaries: ['MP7', 'M870'], secondaries: ['P12'], gadgets2: ['barbed', 'nitro'], icon: 'bandit' },
];
export const OperatorById = Object.fromEntries(Operators.map(o => [o.id, o]));
export function healthFor(op) { return op.armor === 3 ? 125 : op.armor === 2 ? 110 : 100; }
export function speedFor(op) { return op.speed === 3 ? 1.0 : op.speed === 2 ? 0.92 : 0.84; }
