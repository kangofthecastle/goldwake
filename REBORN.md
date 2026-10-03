# HUBRIS — Reborn

A new implementation on `codex/hubris-reborn`. Open **index.html** to play. No build, package installation, network requests, or server are needed by the game. The prior implementation is preserved at **legacy.html**, including its existing local changes.

## The redesign

- Fourteen gods retain their names. Pick an attack and a separate special before a run; every god has a distinct projectile or behavior.
- Ares starts with two piercing blades and reaches a three-blade, full-damage volley in 1.5 seconds. Heat fades slowly when firing stops.
- Five waves per region, each at least 35–39 seconds, before Talos, Ammit, and Midas. Four formation arrangements change the entry lanes and movement. There are three regions and a complete win/lose/retry flow.
- Minimal, dark environments with original cyan player energy, warm enemy fire, and gold currency. Three new local SVG landmark assets complement animated contours, weather, bridges, and guardian thresholds. Environment density drops during heavy bullet patterns.
- Newly synthesized audio: sparse felt-like keys, sustained harmonics, bass and restrained percussion. Arrangements vary with region and wave intensity. Separate music/effects controls, mute, auto-fire, reduced motion, and gentle difficulty are saved locally.

## Controls

| Action | Keyboard | Standard controller |
| --- | --- | --- |
| Move | WASD / arrows | Left stick / D-pad |
| Focus | Hold Shift | Hold LB / LT |
| Dash | Space | B / Circle |
| Special | X | X / Square |
| Apotheosis | C | Y / Triangle |
| Fire with auto-fire off | Hold Z | Hold A / Cross or RT |
| Pause | Esc / P | Start / Options |
| Choose / menus | Tab, arrows, Enter / Space | D-pad / stick, A / Cross |
| Mute | M | Settings |

Connect a standard-mapped Xbox or PlayStation controller and press a button. Disconnecting it pauses combat. Loss of window focus also pauses. Controller behavior is tested with synthetic Gamepad API input; physical-device feel still needs playtesting.

Your hitbox is the small white dot. Grazing enemy fire builds Apotheosis. At 100 charge, activate it to clear bullets, briefly protect yourself, and gain seven seconds of higher damage and triple score. Special attacks recharge independently and can be banked. Dash has a short invulnerable window and a 0.95-second cooldown.

## Gold and shops

Gold is a run currency, separate from score and Apotheosis charge. Kills drop one gold, guardians drop twelve. Clearing each wave pays twelve; guardians pay fifty-five. Gold homes in and remaining drops are collected at a clear. Losing a life does not delete your wallet. There is no idle income or repeated-clear payout.

Each inter-region shop offers healing, damage, special capacity, an attack god boon, a special god boon, and a passive boon. The displayed price comes from the same function that charges the wallet. God powers replace their respective slot; buying the god already equipped strengthens that slot instead. Free draft boons do not spend gold.

| Purchase | First price | Repeat increase |
| --- | ---: | ---: |
| Restore one life | 70 | 20 |
| +25% base damage | 140 | 60 |
| One special slot, filled (cap 4) | 190 | 80 |
| Attack god boon | 120 | 35 |
| Special god boon | 110 | 35 |
| Passive boon | 95 | 35 |

God/passive offers can each be bought once per shop. One life is restored for free on entry to the next region. In deterministic economic simulations, a perfect first-region clear yields 283 gold; a 70% kill clear yields 238. A passive boon plus damage costs 235, so healing and larger purchases compete with upgrades. These are test scenarios, not a claim of final human-tested balance.

## Source map

- `reborn/core.js`: seeded simulation, gods, waves, collision, run flow, economy.
- `reborn/render.js`: Canvas2D artwork, animation and environmental progression.
- `reborn/assets/*.svg`: newly authored minimal coast, river and court landmarks.
- `reborn/audio.js`: Web Audio score and material effects.
- `reborn/app.js` / `style.css`: menu flow, responsive HUD, settings, input.

The detailed generated environment paintings from the first visual exploration were rejected and are not included or loaded. The final environment assets are code-authored SVGs, not image-generation output.

## Checks

Dependency-free simulation tests:

```sh
node --test reborn/core.test.cjs
```

Optional DOM/controller smoke test (jsdom is only a test dependency; install it outside the game):

```sh
npm install --prefix /tmp/hubris-reborn-tests --no-audit --no-fund jsdom
NODE_PATH=/tmp/hubris-reborn-tests/node_modules node reborn/ui.test.cjs
```

Validated: all fourteen attack/special paths, swept collisions, Ares heat, Thor return damage, duplicate-reward protection, full three-region progression, economic scenarios, keyboard/controller menus and settings. Offline Canvas rendering and Web Audio sampling also ran; the sampled audio had no nonfinite values or clipping.

Live browser visual QA was blocked by the available browser tooling. Physical controllers, real-browser rendering/performance, and subjective sound/balance still require playtesting.
