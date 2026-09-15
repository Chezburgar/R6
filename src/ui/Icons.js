// Inline SVG pictograms (operator abilities, gadgets, UI chrome). White-on-tile like Siege.
const S = (body, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const Icons = {
  // operators
  hammer: S('<path d="M14 10h26a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4zm12 20h6v26a3 3 0 0 1-6 0z"/>'),
  emp: S('<circle cx="32" cy="32" r="22" fill="none" stroke="#fff" stroke-width="4"/><path d="M36 14 22 34h10l-4 16 14-22H32z"/>'),
  breachRound: S('<path d="M12 40l24-24 6 6-24 24-8 2zM40 12l4-4 8 8-4 4z"/><circle cx="50" cy="46" r="3"/><circle cx="54" cy="36" r="2"/><circle cx="44" cy="54" r="2"/>'),
  thermite: S('<path d="M32 6c2 10 10 14 10 24a10 10 0 0 1-20 0c0-4 2-7 4-9 0 4 2 6 4 6 2-6-1-12 2-21z"/><rect x="14" y="44" width="36" height="12" rx="2"/>'),
  lion: S('<ellipse cx="32" cy="36" rx="10" ry="6"/><path d="M12 36q0-12 20-12t20 12" fill="none" stroke="#fff" stroke-width="3"/><path d="M8 28q0-16 24-16t24 16" fill="none" stroke="#fff" stroke-width="3" opacity=".6"/><path d="M30 42v10h4V42z"/>'),
  rook: S('<path d="M18 10h28l4 10v30l-18 8-18-8V20z" fill="none" stroke="#fff" stroke-width="4"/><path d="M26 22h12v18H26z"/>'),
  frost: S('<path d="M8 30h48v6H8z"/><path d="M12 30l3-8 3 8zm10 0l3-8 3 8zm10 0l3-8 3 8zm10 0l3-8 3 8zM12 36l3 8 3-8zm10 0l3 8 3-8zm10 0l3 8 3-8zm10 0l3 8 3-8z"/>'),
  kapkan: S('<rect x="8" y="14" width="8" height="36"/><rect x="48" y="14" width="8" height="36"/><path d="M16 32h32" stroke="#fff" stroke-width="3" stroke-dasharray="4 3"/><circle cx="32" cy="32" r="5"/>'),
  mute: S('<circle cx="32" cy="46" r="6"/><path d="M32 40V16" stroke="#fff" stroke-width="4"/><path d="M18 24q14-14 28 0" fill="none" stroke="#fff" stroke-width="3"/><path d="M12 16q20-18 40 0" fill="none" stroke="#fff" stroke-width="3" opacity=".6"/><path d="M14 52 50 12" stroke="#fff" stroke-width="4"/>'),
  bandit: S('<rect x="14" y="16" width="36" height="32" rx="3" fill="none" stroke="#fff" stroke-width="4"/><rect x="50" y="26" width="6" height="12"/><path d="M36 20 24 34h8l-3 12 12-16h-8z"/>'),
  // secondary gadgets
  frag: S('<rect x="26" y="6" width="12" height="8"/><path d="M22 14h20l6 10v18a14 14 0 0 1-32 0V24z"/>'),
  stun: S('<rect x="24" y="6" width="16" height="10"/><rect x="20" y="16" width="24" height="36" rx="6"/><path d="M8 20l6 4M56 20l-6 4M8 44l6-4M56 44l-6-4" stroke="#fff" stroke-width="3"/>'),
  smoke: S('<rect x="22" y="22" width="20" height="34" rx="4"/><rect x="26" y="14" width="12" height="8"/><path d="M14 18q6-10 14-4M50 18q-6-10-14-4" fill="none" stroke="#fff" stroke-width="3"/>'),
  breach: S('<rect x="12" y="12" width="40" height="40" rx="4" fill="none" stroke="#fff" stroke-width="4"/><circle cx="32" cy="32" r="8"/><path d="M32 12v8M32 44v8M12 32h8M44 32h8" stroke="#fff" stroke-width="3"/>'),
  claymore: S('<path d="M12 22h40v20H12z" fill="none" stroke="#fff" stroke-width="4"/><path d="M18 42v10M46 42v10M32 22V12" stroke="#fff" stroke-width="3"/><path d="M6 8l52 24" stroke="#fff" stroke-width="2" stroke-dasharray="3 3"/>'),
  barbed: S('<path d="M6 32c6-14 14-14 20 0s14 14 20 0 12-10 12-10" fill="none" stroke="#fff" stroke-width="3"/><path d="M14 22l4 4M28 42l4-4M44 22l4 4M10 38l-4 4M50 40l4 4" stroke="#fff" stroke-width="3"/>'),
  nitro: S('<rect x="10" y="20" width="44" height="26" rx="3"/><rect x="30" y="12" width="6" height="8"/><circle cx="46" cy="33" r="3" fill="#e2452b"/>'),
  impact: S('<circle cx="32" cy="34" r="16"/><path d="M28 10h8v8h-8z"/><path d="M8 34h6M50 34h6M32 58v-6" stroke="#fff" stroke-width="3"/>'),
  shield: S('<path d="M12 12h40v24l-20 16-20-16z" fill="none" stroke="#fff" stroke-width="4"/><path d="M20 18h24v14l-12 10-12-10z"/>'),
  // sides
  atk: S('<path d="M10 54 44 20l-6-6 10-6 12 12-6 10-6-6-34 34z"/>'),
  def: S('<path d="M32 6l22 8v18c0 14-10 22-22 26C20 54 10 46 10 32V14z" fill="none" stroke="#fff" stroke-width="5"/>'),
  // ui
  gear: S('<path d="M32 20a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm0 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12z"/><path d="M28 4h8l2 8 6 3 8-3 4 7-6 6v6l6 6-4 7-8-3-6 3-2 8h-8l-2-8-6-3-8 3-4-7 6-6v-6l-6-6 4-7 8 3 6-3z" fill="none" stroke="#fff" stroke-width="3"/>'),
  renown: S('<path d="M32 4 56 18v28L32 60 8 46V18z" fill="none" stroke="#fff" stroke-width="5"/><path d="M32 18l10 6v14l-10 6-10-6V24z"/>'),
  credits: S('<circle cx="32" cy="32" r="24" fill="none" stroke="#fff" stroke-width="5"/><path d="M24 22h16v6H30v4h8v6h-8v10h-6z"/>'),
  corner: S('<path d="M8 8h24v6H14v18H8z"/><path d="M40 56H32v-6h2V32h6z"/>'),
  play: S('<path d="M16 8 56 32 16 56z"/>'),
  ops: S('<circle cx="32" cy="18" r="10"/><path d="M12 56c0-14 8-22 20-22s20 8 20 22z"/>'),
  controller: S('<rect x="6" y="20" width="52" height="26" rx="10"/><circle cx="44" cy="30" r="3" fill="#111"/><circle cx="50" cy="36" r="3" fill="#111"/><path d="M14 30h10M19 25v10" stroke="#111" stroke-width="3"/>'),
  cup: S('<path d="M18 8h28v14a14 14 0 0 1-28 0z"/><path d="M12 12h6v8a8 8 0 0 1-6-8zm34 0h6a8 8 0 0 1-6 8z"/><path d="M28 36h8v10h8v6H20v-6h8z"/>'),
  news: S('<rect x="8" y="12" width="48" height="40" rx="3" fill="none" stroke="#fff" stroke-width="4"/><path d="M14 20h20v12H14zm26 0h10v4H40zm0 8h10v4H40zM14 38h36v4H14z"/>'),
  friends: S('<circle cx="22" cy="22" r="8"/><circle cx="42" cy="22" r="8"/><path d="M6 50c0-10 6-16 16-16s16 6 16 16zm20-2c2-8 8-12 16-12s16 6 16 14z"/>'),
  plus: S('<path d="M28 12h8v16h16v8H36v16h-8V36H12v-8h16z"/>'),
  defuser: S('<rect x="10" y="22" width="44" height="26" rx="3" fill="none" stroke="#fff" stroke-width="4"/><rect x="16" y="28" width="16" height="8"/><circle cx="44" cy="32" r="3"/><path d="M40 22v-8h4v8" stroke="#fff" stroke-width="2"/>'),
  drone: S('<circle cx="18" cy="40" r="10" fill="none" stroke="#fff" stroke-width="4"/><circle cx="46" cy="40" r="10" fill="none" stroke="#fff" stroke-width="4"/><rect x="24" y="26" width="16" height="14" rx="3"/><circle cx="32" cy="33" r="3" fill="#30c0ff"/>'),
  hammerSmall: S('<path d="M14 10h26a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4zm12 20h6v26a3 3 0 0 1-6 0z"/>'),
};
export function icon(name) { return Icons[name] || Icons.corner; }
