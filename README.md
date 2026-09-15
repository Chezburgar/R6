# Rainbow Six Siege — Browser

A from-scratch browser recreation of Tom Clancy's Rainbow Six Siege (fan project), built with three.js and
deployed as a static site on GitHub Pages. 5 attackers vs 5 defenders, Bomb mode on **Border**, against AI.

**Play:** https://chezburgar.github.io/R6/

## What's in the box
- **Operators** (10, all with real models): Sledge, Thatcher, Ash, Thermite, Lion / Rook, Frost, Kapkan, Mute, Bandit —
  each with their unique gadget, Siege speed/armor ratings, loadouts and secondary gadgets.
- **Weapons** with Siege damage/RPM/magazine values, recoil patterns, fire modes, penetration through soft
  surfaces, damage fall-off and headshot lethality. Real picture-in-picture 2.5x scope, iron sights, red dot.
- **Border**: two floors, 22 rooms, three bomb-site pairs, destructible drywall (bullets, melee, hammer, explosives),
  reinforcements, barricades, hatches, glass, rappel, vaulting, lean, crouch, prone.
- **Match flow**: operator select → 30 s preparation (attackers drone through drone holes, identify and ping;
  defenders reinforce, board up doors and windows plank by plank, place gadgets) → 3 min action →
  plant / defuse → round end, side swap, first-to-N.
- **AI** teammates and opponents: navigation, setup plans (reinforce, barricade, gadgets), entry routes,
  breaching, planting, retakes, callouts, hearing, reaction time and settling accuracy by difficulty.
- **Audio**: fully procedural — layered gunshots (crack / blast / thump / mechanical), distance filtering and delay,
  convolution reverb, footsteps by surface, reloads, explosions, gadgets and UI.

## Controls
WASD move · Shift sprint · C crouch · Z prone · Q / E lean · Space vault (or enter a window while rappelling) ·
F interact / rappel · RMB aim · LMB fire · R reload · B fire mode · V melee · 1 / 2 weapons · 3 unique gadget ·
4 / G secondary gadget · 5 / X drone view · 6 deploy a new drone · M ping · Tab scoreboard · Esc pause

Leaning only works while aiming down sights (Siege rule). Attackers pick up the defuser in operator select; if nobody does it is
assigned at random. Menu music is `assets/audio/menu_theme.mp3` (Menu Music volume in settings).

Drone: WASD drive · Space jump · hold **X** on an enemy to identify them (live red marker for the team) ·
**Z** contextual ping · **5** back to the operator (during the action phase; the preparation phase is played from the drone).

Ctrl is deliberately unbound: in a browser Ctrl+W closes the tab and Ctrl+S / D / F open dialogs, which drops pointer lock.

## Running locally
Any static server works (ES modules need http):
```
npx serve .
```

## Layout
`src/core` engine (assets, input, audio, physics) · `src/map` Border + procedural materials + destruction ·
`src/game` characters, player, bots, weapons, gadgets, match · `src/ui` menus + HUD · `assets/models` optimized GLBs.
