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
- **Match flow**: operator select → 45 s preparation (drone for attackers, setup for defenders) → 3 min action →
  plant / defuse → round end, side swap, first-to-N.
- **AI** teammates and opponents: navigation, setup plans (reinforce, barricade, gadgets), entry routes,
  breaching, planting, retakes, callouts, hearing, reaction time and settling accuracy by difficulty.
- **Audio**: fully procedural — layered gunshots (crack / blast / thump / mechanical), distance filtering and delay,
  convolution reverb, footsteps by surface, reloads, explosions, gadgets and UI.

## Controls
WASD move · Shift sprint · C crouch · Z / Ctrl prone · Q / E lean · Space vault (or enter a window while rappelling) ·
F interact / rappel · RMB aim · LMB fire · R reload · B fire mode · V melee · 1 / 2 weapons · 3 unique gadget ·
4 / G secondary gadget · X drone (prep) · Tab scoreboard · Esc pause

## Running locally
Any static server works (ES modules need http):
```
npx serve .
```

## Layout
`src/core` engine (assets, input, audio, physics) · `src/map` Border + procedural materials + destruction ·
`src/game` characters, player, bots, weapons, gadgets, match · `src/ui` menus + HUD · `assets/models` optimized GLBs.
