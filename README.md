# HUBRIS

**HUBRIS** (working title; repo: `goldwake`) is a vertical-monitor
**bullet-hell roguelite** — the neon-additive, bloom-drenched
look of *Danmaku Unlimited 3* crossed with the gold-and-**Vaunt** economy of
*Jamestown: Legend of the Lost Colony*, wrapped in a seeded 3-sector run with
draft cards, shops, sector affixes, and a tiny permanent-unlock meta layer.
Pure static web: no build step, no server, no dependencies. WebGL2 for the
playfield, a 2D canvas for the HUD/menus, and WebAudio for everything you hear.

## How to run

**Double-click `index.html`.** It runs straight from `file://` in any recent
Chrome, Edge, or Firefox — no local server needed.

- Designed for a **portrait monitor**. Press **F11** (Windows) or **⌃⌘F** (macOS)
  for fullscreen; the 1080×1920 playfield scales to fill a portrait screen and
  letterboxes with black pillars on a landscape one.
- If you see a "needs WebGL2" message, update your browser or enable hardware
  acceleration.
- Sound starts on your first keypress (browser autoplay policy). Press **M** to mute.

### Custom sprite art

Drop authored PNGs (per `art/PROMPTS.md` §8; transparent ground, player ship
nose-up, enemies facing down) into `art/sprites/` under their slot names —
`ship.png`, `enemy-pop.png`, `enemy-gun.png`, `enemy-mid.png`, `enemy-boss.png` —
and they replace the procedural sprites on next load, with the procedural atlas
as silent fallback. Over `http://` (and usually Firefox `file://`) that's all;
for **Chrome via `file://`** run `art/embed-sprites.sh` once to embed the PNGs
as data URIs in `js/sprites-data.js`. Bullets, telegraphs and FX are not
overridable — they stay procedural by doctrine.

## Controls

| Key | Action |
| --- | --- |
| **WASD / Arrows** | Move |
| **Shift** (hold) | Focus — slow, precise, tighter fire, shows hitbox ring |
| **Shift** (tap) + direction | **Ghost dodge** — a short dash with brief i-frames (~0.9s cooldown) |
| **Z / Space** (hold) | Attack  ·  also **confirm** in menus / drafts / shops |
| **X** | **SPECIAL** weapon (spends a charge)  ·  also **leave shop / back** in menus |
| **C** | **VAUNT** (when the gauge is full) |
| **Left / Right** | Move the selection in drafts and shops (or click) |
| **P** | Pause |
| **R** | Restart the run (fresh seed) |
| **Esc** | Abandon to title (from a run); title from the end screens |
| **M** | Mute / unmute |

Three offensive tools, distinct roles: **Attack** (Z) is your constant fire — deliberately modest on its own. **Special** (X) is a burst/panic tool on a 3-charge meter (the purple pips beside the vaunt bar) that refills over time and faster on kills; its base form is the **Lance Volley** (fat piercing energy lances). **Vaunt** (C) is the defensive/scoring bullet-cancel. On defense there's also the **Ghost dodge** — tap **Shift** while holding a direction to dash a short hop with brief invulnerability (grazing still counts mid-dash), on a ~0.9s cooldown. The power spike comes from **god boons**, below.

## The run

A **run** is 3 sectors generated from one seed (shown on the end screen). Each
sector is 4–6 semi-random waves drawn from the wave pool, ending in a fixed
anchor boss:

- **Sector 1 → WARDEN** (midfield sentinel, 2 patterns)
- **Sector 2 → WARDEN — REFORGED** (remixed, 3 patterns, much tougher)
- **Sector 3 → GILDED SOVEREIGN** (the 3-phase boss)

Beat the Sovereign for **RUN COMPLETE**, then **DESCEND DEEPER** into an endless
loop (steeper rank, more elites). Difficulty (rank) scales across and within sectors.

Each sector rolls **one affix**, announced on its title card:
**GILDED** (elites drop double gold, +10% enemy HP) · **SWARM** (more popcorn,
frailer) · **DENSE VEIL** (bullets +25%, 15% slower) · **VOLATILE** (enemies burst
into sprays on death) · **NIGHT MARKET** (shop prices −30%). Each sector card also
offers an optional **LABOR** — accept for +1 extra affix and +40% enemy HP, and
clearing that boss pays **3 guaranteed-epic boons + 300 gold**.

**Enemy variety:** beyond popcorn/gunships, watch for **AEGIS SHIELDBEARERS**
(front shield — displace them to break it), **WEAVER PAIRS** (bullet-curtain tether),
**GILDED MIMICS** (disguised as gold — greed bait), **SPLITTERS**, **CHORUS
ACOLYTES** (heal elites — kill first), **CARRIER HULKS** (spawn escorts, shatter into
debris), **BLINK MOTHS**, **BULLET GARDENERS** (kill to cancel their whole garden to
gold), and **THE APOSTATE** (an elite wielding two gods you *didn't* pick; drops a
guaranteed-epic boon). Any enemy may carry an **elite aura**: GILDED, BULWARK, or
FRENZIED.

**Pantheon Communion:** run an attack god + special god from the same pantheon for a
set bonus — **Accord of Olympus** (+1 mult cap, +2s vaunt), **Twilight Oath** (ASGARD:
a life lost auto-fires your special free), **Rite of Two Suns** (KEMET: +10% damage to
status-afflicted foes, +15% gold), **Harmony of Heaven** (CELESTIAL COURT: grazing a
bullet also feeds your special charge).

### The Vaunt loop (core combat)

Your hitbox is the tiny bright dot at your ship's center (radius 4). Kill enemies
→ they drop **gold**, which homes to you (always during Vaunt, and everything on
screen rushes in when a wave clears). Gold feeds the **Vaunt gauge** *and* banks
into your **run wallet**. **Graze** bullets for sparks + gauge. Fill the gauge and
press **X**: a shockwave **cancels every enemy bullet into gold**, shields you
~1.2s, and jumps your multiplier to ×3 (climbing per kill, cap ×5, higher with
upgrades). When the gauge drains you get the **VAUNT BONUS**. No bombs — a full
gauge is your panic button. 3 lives; death spills **25% of your banked wallet** as
re-collectable shards (~4s) and resets your multiplier.

### God boons (the main power source)

Modeled on *Hades*. You have two slots — **attack** and **special**. The **first**
boon in a slot *transforms* the mechanic itself; later cards only scale it.
**Fifteen** transform gods across four pantheons, each with an attack transform, a
special transform, and two mod cards:

- **OLYMPUS** — **ZEUS** (chain lightning / storm bolt), **POSEIDON** (knockback +
  impact / tidal wall that eats bullets into gold), **ARTEMIS** (+18% crit, ×3 /
  Marking arrow), **APHRODITE** (**Charm** foes to your side / charm missile),
  **ARES** (**Bloodlust** — kills stack frenzy fire-rate / **Phobos & Deimos** dread-
  wraiths that inflict **Terror**), **DEMETER** (**Chill** → shatter / Winter Bloom
  that slows every bullet on screen).
- **HELIOPOLIS** — **RA** (attack fuses into a ramping **solar beam** / Solar Flare
  ignites all with **Burn**).
- **DUAT** — **ANUBIS** (**execute** weakened foes for bonus gold / Hall of Judgment
  escalating zone).
- **ASGARD** — **LOKI** (**Confuse** faction-flips the foe's bullets / Shadow-Twin
  decoy that draws all aimed fire), **ODIN** (orbiting ravens / **Gungnir** the
  never-miss piercing spear), **THOR** (**Mjölnir** returning kinetic hammer /
  **Giant's Bane** colossal crush — pure force, never lightning).
- **CELESTIAL COURT** — **WUKONG** (kills spawn **hair-clones** that copy your fire /
  Ruyi Jingu Bang staff pillar that can **Stun**), **GUAN YU** (shots become cleaving
  **crescent blades** that gain power per foe pierced / **Red Hare Charge** — a spectral
  rider carves a lane and hurls foes aside), **JADE EMPEROR** (attacks issue homing
  imperial **edicts** that **Stun** / **Mandate of Heaven** — a judgment curtain descends
  from the top, Weakening all it touches).
- **FIFTH SUN** — **QUETZALCOATL** (serpentine +pierce shots / Sky Serpent that eats
  bullets into your **vaunt gauge**).
**Charms** (passive, one per god) — collected through the run in drafts and shops,
each **CHARM** is tied to a god but **needs no god slot**: it's how the fifteen gods you
*didn't* pick still touch your run. Each is acquirable once (e.g. EAGLE FEATHER +damage
to elites/bosses, SUNSTONE +special recharge, OATH TABLET keeps your multiplier through
death, IMPERIAL SEAL +vaunt bonus). Numeric charms scale with rarity; a few surface per run.

Each god has **four** mod cards (at least one a build-fork), each transform
**levels up** along a ★–★★★★★ tier ladder via own-god pom cards, and 15 gods × pairs
unlock **26 DUO boons** (rainbow one-shot cards; e.g. STORMFATHERS, RAGNARÖK,
FROZEN STORM, ECLIPSE, DEATH SENTENCE, ETERNAL DEVOTION, SWORN BROTHERS, SAINT OF WAR,
TWO THRONES, GODS OF WAR, PEACH BANQUET).

Statuses: **Marked/Weak** (bonus damage taken), **Charm** (fights for you),
**Terror/Shaken** (Ares — flee + take more), **Chill** (slow → shatter), **Burn**
(DoT), **Confuse** (Loki flips the foe's bullets to your side), **Stun** (frozen).
Bosses are immune to full Charm/Terror/Stun and execute. Poseidon, Thor and Terror
shove enemies with real spring-damped **displacement** — visible lurch, wall-slams,
and enemy pile-ups.

Plus scaling cards (attack damage/rate, special damage/charge/recharge) and a few
generic ones (life, hitbox, magnet, gold value, vaunt duration/cap). Rarity is
**Common / Rare / Epic** (white / blue / gold border; ×1 / ×1.5 / ×2.25 magnitude).

### Draft & shop composition

- **After every wave clears**: gameplay freezes and you pick **1 of 3 boon cards**.
- The **wave-1 draft is always three attack transforms** from three different gods
  (the opening-boon moment); an early draft **guarantees a special-transform offer**.
- Once a slot has a god, that god's transform leaves the pool but **other gods
  appear as SWAP cards** (they replace the current one and come one rarity tier
  higher). A god's **mod cards** only appear once you own that god's transform.
- **After each sector boss**: a **shop** — 3 priced boons (rarer skew) plus
  **reroll** (rising cost) and an **extra life**. Spend banked gold; **X** leaves.

### Meta layer (permanent, capped)

Stored in `localStorage`: high score, best sector, career gold, and exactly three
unlocks shown on the title screen — kill the Warden once → **+1 starting life**;
complete a run → **start with 25% Vaunt**; career gold ≥ 40,000 → **+10% base
damage**.

## Architecture

All game math lives in a fixed **1080×1920 logical playfield**; the renderer
scales and letterboxes it. Files load in dependency order via plain `<script>`
tags — each hangs one namespace on `window`.

| File | Namespace | Responsibility |
| --- | --- | --- |
| `index.html` | — | Black fullscreen page; WebGL canvas + overlaid 2D HUD canvas; scripts in order. |
| `js/sfx.js` | `window.SFX` | WebAudio-synthesized SFX (no files). Master → lowpass → compressor; lazy context resumed on first gesture. |
| `js/gl.js` | `window.GL` | WebGL2 renderer. Procedural sprite atlas, instanced additive quad batcher, threshold + separable-gaussian **bloom** at ½/¼ res, chromatic-offset composite (the Vaunt pulse). |
| `js/engine.js` | `window.Engine` | Fixed-timestep loop (60 Hz, dt clamped), keyboard input, preallocated **object pools** (4096 bullets / 256 shots / 128 enemies / 2048 particles / 512 gold), circle collision. |
| `js/patterns.js` | `window.Patterns` | Danmaku emitter toolkit (aimed / fan / ring / spiral / whip / flower / spray), plus global affix scalars (`setGlobal` for DENSE VEIL etc.). |
| `js/run.js` | `window.Run` | **Roguelite structure**: seeded PRNG (mulberry32) + run generation, sector affixes, the **god-boon** draft + shop card UI and composition rules, the god metadata (`Run.GODS`), title / end screens, the localStorage meta layer, and the run-flow state machine. Drives Game; no combat sim. |
| `js/game.js` | `window.Game` | **Combat / stage layer**: player, the **SPECIAL** weapon + charge meter, enemies, bosses, bullets, the **god-boon effects + enemy status system** (chain/knockback/crit/charm/doom/chill), Vaunt, scoring, FX, the wave pool, hazards (rift/wave), and all in-combat HUD. Exposes the `Game.*` API that `run.js` calls (incl. `applyBoon`). |

**Status-effect architecture.** Enemies carry status fields (`doomT/doomDmg`,
`chillStacks/chillT`, `charmMeter/charmed/charmT`, `marked/weak`). Attack hits route
through `hitEnemy → damageEnemy(e, dmg, crit)` (which applies Marked/Weak/crit
multipliers) then `applyAttackGod` (which stacks the status). `updateStatus` ticks
doom bursts, chill decay/shatter and charm/mark/weak timers each frame. **Charmed
foes** skip their `onUpdate` (no enemy fire), are excluded from all enemy→player
collision and from being targeted by shots/hazards, run `updateCharmed` (seek the
nearest foe, fire player-faction shots at it), and expire in a heart-burst. Winter
Bloom uses a per-bullet `timeScale`/`slowT` in `Engine.updateBullet`.

**God entities** are pooled/singletons on `G`: Ra's beam is stateless (per-frame in
`updatePlayer`); Loki's `decoy`, Odin's `gungnir`, and the raven/clone arrays are
small fixed collections; the staff pillar, Anubis judgment zone and Quetzalcoatl
serpent extend the shared `hazards` pool (8 slots). Every enemy aimed pattern
targets `Game.aimPoint()` — which returns the Loki decoy while it lives, else the
player — and Confuse reflects an enemy's aim through itself (`+π`). `Run.GODS` is
the single metadata table (name, epithet, pantheon, color, transform text), so a
future pantheon is a data-only addition.

### Run state machine

```
                        ┌───────────────── R (fresh seed) ───────────────┐
                        │                                                 │
        Z ──►  ┌────────▼─────────┐                                       │
  ┌──────────► │      TITLE       │ ◄─── Esc ───┐                         │
  │            └────────┬─────────┘             │                         │
  │                     │ Z / click             │                         │
  │            ┌────────▼─────────┐             │                         │
  │            │  SECTOR card     │ (affix)     │                         │
  │            └────────┬─────────┘             │                         │
  │                     │                        │                        │
  │            ┌────────▼─────────┐   clear   ┌──┴───────┐   pick   ┌──────┴─────┐
  │            │  PLAYING (wave)  ├──────────►│ CLEARING ├─────────►│   DRAFT    │
  │            └────────┬─────────┘  (gold    └────┬─────┘  1-of-3  └──────┬─────┘
  │                     │            collect)      │                       │
  │        more waves ◄─┴──────────────────────────┘ ◄─────────────────────┘
  │                     │  (last wave done)
  │            ┌────────▼─────────┐   boss    ┌──────────┐
  │            │  PLAYING (boss)  ├──────────►│ CLEARING │
  │            └──────────────────┘  dead     └────┬─────┘
  │                                                │
  │                              sector 1–2 ┌──────┴───────┐ sector 3
  │                                 ┌───────┤   which?     ├────────┐
  │                          ┌──────▼─────┐ └──────────────┘  ┌─────▼──────┐
  │                          │    SHOP    │                    │  COMPLETE  │
  │                          └──────┬─────┘                    └─────┬──────┘
  │                          X/leave │ next sector                   │ Z / Esc
  │                                  └───────► (SECTOR card)          │
  └──────────────────────────────────────────────────────────────────┘
                    (player loses last life, from any PLAYING → GAME OVER → Z retry / Esc title)
```

Menus (`title / sector / draft / shop / complete / over`) freeze the combat sim
entirely — no bullet motion, timers, firing, Vaunt drain, or SFX — while the
frozen field stays visible behind the neon card UI. **Pause** (P) freezes
`playing`/`clearing` the same way.

### Rendering notes

- Depth test **off**, additive blending (`ONE,ONE`) **on**; near-black background
  so additive neon sings. Every sprite is one instanced quad from a boot-time
  procedural atlas; shaders are JS template-string constants.
- Bloom runs on half/quarter-res targets; the composite adds a chromatic split
  that pulses during Vaunt plus a gentle tonemap so highlights roll off.
- Player fire is cool cyan/white, enemy fire warm/magenta, UI neon cyan + gold —
  the screen reads at a glance even when it's full of bullets.
