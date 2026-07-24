# HUBRIS

**HUBRIS** (working title; repo: `goldwake`) is a vertical-monitor
**bullet-hell roguelite** — the neon-additive, bloom-drenched
look of *Danmaku Unlimited 3* crossed with the gold-and-**Apotheosis** economy of
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
- Sound (SFX **and** the procedural music score) starts on your first keypress
  (browser autoplay policy). Press **M** to mute everything.

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
| **C** | **APOTHEOSIS** (when the gauge is full) |
| **Left / Right** | Move the selection in drafts and shops (or click) |
| **P / Esc** | Pause in combat (on the pause screen: Z/P/Esc resume, X abandons to title, **F** toggles **auto-fire**, **H** toggles enemy health bars); Esc also backs out of end screens |
| **R** | Restart the run (fresh seed) |
| **M** | Mute / unmute (music **and** SFX) |

Three offensive tools, distinct roles: **Attack** (Z) is your constant fire — deliberately modest on its own. **Special** (X) is a burst/panic tool on a 3-charge meter (the purple pips beside the apotheosis bar) that refills over time and faster on kills; its base form is the **Lance Volley** (fat piercing energy lances). **Apotheosis** (C) is the defensive/scoring bullet-cancel — and with an attack god equipped, its activation fires that god's **rider** (below). On defense there's also the **Ghost dodge** — tap **Shift** while holding a direction to dash a short hop with brief invulnerability (grazing still counts mid-dash), on a ~0.9s cooldown. The power spike comes from **god boons**, below.

## The run

A **run** is 3 sectors generated from one seed (shown on the end screen). Each
sector is 4–6 semi-random waves drawn from the wave pool, ending in a fixed
anchor boss:

- **Sector 1 → TALOS** (the bronze sentinel — 5 phases; the finale is **THE NAIL**,
  where his body turns immune and only the glowing ankle weak-point can be hurt)
- **Sector 2 → AMMIT** (devourer of hearts — 6 phases of the Weighing of the Heart)
- **Sector 3 → MIDAS** (the gilded king — 6 phases; **steals** gold you haven't yet
  pulled into your magnet, banking it in a visible hoard that erupts as a full jackpot
  on his death, and converting his fire spawns **cursed gold** that gilds you into a
  helpless golden statue if you touch it — invulnerable through the freeze, then bare)

Beat MIDAS for **RUN COMPLETE**, then **DESCEND DEEPER** into an endless
loop (steeper rank, more elites). Difficulty (rank) scales across and within sectors.

Each sector rolls **one affix**, announced on its title card:
**GILDED** (elites drop double gold, +10% enemy HP) · **SWARM** (more popcorn,
frailer) · **DENSE VEIL** (bullets +25%, 15% slower) · **VOLATILE** (enemies burst
into sprays on death) · **NIGHT MARKET** (shop prices −30%). Each sector card also
offers an optional **LABOR** — accept for +1 extra affix and +40% enemy HP, and
clearing that boss pays **3 guaranteed-epic boons + 300 gold**.

**How enemies fight.** Enemies are danmaku actors, not a shooting gallery. Every
non-boss runs an **authored path** from a small path book (swoop-and-hold, S-curves,
loops, pendulums, orbits, dive-brakes, flank-rails, hp-triggered retreats) — nothing
drifts on a straight drop — and a looping **fire script** of timed beats (pose →
windup flash → volley → rest). The default volley is *unaimed authored geometry*
(rings with a gap, arc-walls with a safe lane, snaking ribbons, spoke-wheels); aimed
fire is a rare, telegraphed accent. Squadrons spawn as **mirrored formations** sharing
one script clock with per-index phase offsets, so a whole flight fires like one
instrument. A new **MIDSHIP** tier — large held ships running a two-geometry script —
bridges popcorn and boss; kill one early and its own in-flight pattern cancels to gold.
Waves are hand-tuned **arrangements** filling an authored per-sector arc (opener →
builds → feature → breather → crescendo → boss), with the crest anchor alternating
left/center/right; RNG only picks which arrangement, its mirror, and phase — never the
geometry itself.

**The world under the fight.** Each sector scrolls over a procedural **parallax
environment** matched to its pantheon — a deep field (stars + nebula tint), a
structure layer of large drifting silhouettes (Sector 1 bronze colonnades for
TALOS, Sector 2 KEMET tomb architecture and colossal statuary for AMMIT, Sector 3
a gilded palace lattice for MIDAS), and fast sparse near-debris weather.
The grounds stay in the near-black **dim band** (low-saturation, never additive-bright,
never in the enemy bullet band) and the whole backdrop **dims further as the bullet
count climbs** — readability always beats scenery. The background is choreographed
with the slot arc: the opener eases the structure in, a **feature** wave sends one big
set-piece crossing under the fight, the **breather** is the brightest/calmest moment,
the **crescendo** darkens and accelerates the layers, and the boss arrives *from* the
environment — a huge shadow descends ahead of it, then the layers dim to near-black for
the fight. Painted layers drop in later the same way sprites do (`art/backdrops/<sector>-<layer>.png`
or a `window.BACKDROPS` registry), with the procedural layers as silent fallback.

**The level's pulse.** A procedural WebAudio **score** (`js/music.js`) plays under the
fight — layered stems (pad drone, pulse bass/arp, full-kit crest) on a real-time
lookahead scheduler, with a distinct **theme per sector** (S1 bronze/processional,
S2 KEMET low-and-dark, S3 gilded/regal), a calm title theme, and an escalating boss
theme per sector. The stem stack follows the same slot arc as the waves — breathers
strip to the pad, builds add the pulse, crescendos and boss phases run the full stack,
crossfading on wave boundaries. The whole composition is **seeded off the run seed**, so
the same run always sounds the same. APOTHEOSIS opens a filter and lifts a shimmer layer
(the payday sounds golden), pausing ducks the score, and the shop gets its own quiet pad
variant. The music sits mid-low and **under** the SFX, which always carry the gameplay
information; **M** mutes both.

**Enemy variety:** beyond popcorn/gunships, watch for **AEGIS SHIELDBEARERS**
(front shield — displace them to break it), **WEAVER PAIRS** (bullet-curtain tether),
**GILDED MIMICS** (disguised as gold — greed bait), **SPLITTERS**, **CHORUS
ACOLYTES** (heal elites — kill first), **CARRIER HULKS** (spawn escorts, shatter into
debris), **BLINK MOTHS**, **BULLET GARDENERS** (kill to cancel their whole garden to
gold), and **THE APOSTATE** (an elite wielding two gods you *didn't* pick; drops a
guaranteed-epic boon). Any enemy may carry an **elite aura**: GILDED, BULWARK, or
FRENZIED.

**Pantheon Communion:** run an attack god + special god from the same pantheon for a
set bonus — **Accord of Olympus** (+1 mult cap, +2s apotheosis), **Twilight Oath** (ASGARD:
a life lost auto-fires your special free), **Rite of Two Suns** (KEMET: +10% damage to
status-afflicted foes, +15% gold), **Harmony of Heaven** (CELESTIAL COURT: grazing a
bullet also feeds your special charge).

### The Apotheosis loop (core combat)

Your hitbox is the tiny bright dot at your ship's center (radius 4). Kill enemies
→ they drop **gold**, which homes to you (always during Apotheosis, and everything
on screen rushes in when a wave clears). Gold feeds the **Apotheosis gauge** *and*
banks into your **run wallet**. **Graze** bullets for sparks + gauge. Fill the
gauge and press **C**: a shockwave **cancels every enemy bullet into gold**,
shields you ~1.2s, and jumps your multiplier to ×3 (climbing per kill, cap ×5,
higher with upgrades) — and your **attack god answers with a rider**, a one-shot
god-flavor kicker fired at activation (Zeus strikes every foe with lightning,
Wukong summons his full clone court, Guan Yu
throws a nova of eight crescents, Heimdall Marks everything and shoves the
bullet field back…). When the gauge drains you get the **APOTHEOSIS BONUS**. No
bombs — a full gauge is your panic button. 3 lives; death spills **25% of your
banked wallet** as re-collectable shards (~4s) and resets your multiplier.

### God boons (the main power source)

Modeled on *Hades*. You have two slots — **attack** and **special**. The **first**
boon in a slot *transforms* the mechanic itself; later cards only scale it.
**Fourteen** transform gods across four pantheons, each with an attack transform, a
special transform, and two mod cards:

- **OLYMPUS** — **ZEUS** (chain lightning / **SKYFALL** — an instant lightning column
  down your lane that **Stuns** and forks to neighbours), **ARTEMIS** (**THE HUNT** — silver
  arrows brand the first foe as your **Hunted** and home to it; hits ramp +12% (cap
  +96%), a Hunted kill splinters shards and chains the brand to the next prey / **THE
  LOOSED ARROW** — a piercing, always-**precise** needle that Marks all it strikes, the
  first becoming your Hunted at full ramp), **APHRODITE** (**Charm** foes / **HEARTSEEKER**
  — a slow weaving heart that charms a minion or **Weakens** a boss and melts its bullets
  to gold), **ARES** (**WAR-HEAT** — fighting at the muzzle stokes a proximity meter that
  escalates your metal: javelins → xiphos leaf-blades → a doru bundle + whirling **labrys** /
  **Phobos & Deimos** dread-wraiths that **dive-bomb** foes, sowing **Terror**). Crit is
  retired game-wide → **PRECISION**: telegraphed **weak-point nodes** on boss/elite beats
  that any aimed shot can strike for ×2.5.
- **HELIOPOLIS** — **RA** (**SOLAR LENS** — hold fire on ONE foe to focus the beam through
  4 heat stages up to ×2.5; bosses never cool / Solar Flare ignites all with **Burn**).
- **DUAT** — **ANUBIS** (**Weigher of Hearts** — +25% damage below half health,
  **executes** non-bosses below 25% for bonus gold / **Judgment of Duat** — an
  instant strike on every foe for a share of its missing health).
- **ASGARD** — **LOKI** (**PILFER** — your hits pickpocket a foe (3 marks); on the third,
  snatch the 8 nearest enemy bullets — they flip green, spin 180° and hunt their own kind /
  Shadow-Twin decoy that draws all aimed fire and soaks streams — the twin never attacks:
  the one sanctioned no-damage special), **ODIN** (**NINE NIGHTS** — one heavy rune-bolt;
  every 4th hit carves a permanent **rune** into that foe, each +15% against it forever; the
  ninth seals its doom (gold bolts that Mark) / **Gungnir** the never-miss piercing spear;
  **Huginn & Muninn** migrate to the RAVEN QUILL charm — ravens that dive with any attack),
  **THOR** (**Mjölnir** returning kinetic hammer / **Giant's Bane** colossal crush), **HEIMDALL**
  (**THE BIFRÖST** — on a 6s beat a rainbow bridge forms above you (a dawn-seam warns first);
  shots crossing it refract into **five rays**, foes touching it are **Marked**, focus narrows
  the spectrum / **Gjallarhorn** — a horn blast that wounds and Marks every foe and shoves the
  bullet field away).
- **CELESTIAL COURT** — **WUKONG** (kills spawn **hair-clones** that copy your fire /
  Ruyi Jingu Bang staff pillar that can **Stun**), **GUAN YU** (shots become cleaving
  **crescent blades** that gain power per foe pierced / **Crescent Moon Sweep** — one
  colossal blade sweeps the full field upward, hurling foes aside), **JADE EMPEROR**
  (attacks issue homing imperial **edicts** that **Stun** / **Heaven's Verdict** — a
  volley of homing edicts, one per foe, Stunning each; the strongest takes a
  double-size edict).
- **FIFTH SUN** — **QUETZALCOATL** (**CONSTRICTOR** — three streams braid into a plumed
  helix (pierces 1); hold the braid on ONE body to **COIL** it +10%/bite up to +60%, look
  away and it uncoils / Sky Serpent that eats bullets into your **apotheosis gauge**).
**Charms** (passive, one per god) — collected through the run in drafts and shops,
each **CHARM** is tied to a god but **needs no god slot**: it's how the fifteen gods you
*didn't* pick still touch your run. Each is acquirable once (e.g. EAGLE FEATHER +damage
to elites/bosses, SUNSTONE +special recharge, OATH TABLET keeps your multiplier through
death, IMPERIAL SEAL +apotheosis bonus). Numeric charms scale with rarity; a few surface per run.

Each god has **four** mod cards (at least one a build-fork), each transform
**levels up** along a ★–★★★★★ tier ladder via own-god pom cards, and 15 gods × pairs
unlock **25 DUO boons** (rainbow one-shot cards; e.g. STORMFATHERS, RAGNARÖK,
ECLIPSE, DEATH SENTENCE, ETERNAL DEVOTION, SWORN BROTHERS, SAINT OF WAR,
TWO THRONES, GODS OF WAR, PEACH BANQUET, THE ALLSEEING, HERALD OF RAGNARÖK,
FALSE DAWN).

Statuses: **Marked/Weak** (bonus damage taken), **Charm** (fights for you),
**Terror/Shaken** (Ares — flee + take more), **Burn** (DoT), **Stun** (frozen).
Each reads by **where** its glyph sits (a distinct body zone) and **what** shape it
is, not by hue alone. Thor, Guan Yu
and Terror shove enemies with real spring-damped **displacement** — visible
lurch, wall-slams, and enemy pile-ups.

**VS BOSSES.** Bosses are immune to full Charm, Terror, Stun and execute — but
every such source pays a defined substitute, never nothing: Charm sources
**Weaken** them, Terror sources apply **Shaken** (+damage taken, no flee), Stun
sources deal bonus damage instead, and Anubis' execute line becomes a flat
below-half damage bonus. Unspent multitarget always collapses onto the boss —
chain-lightning jumps with no second target strike the origin again at 50% each,
and per-foe volleys (Verdict edicts, Gungnir storm, hammer cyclone) land every
shot on a lone boss. The Shadow-Twin's boss value is soaking: park it in a
pattern stream and it visibly thins it.

Plus scaling cards (attack damage/rate, special damage/charge/recharge) and a few
generic ones (life, hitbox, magnet, gold value, apotheosis duration/cap). Rarity is
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
unlocks shown on the title screen — kill Talos once → **+1 starting life**;
complete a run → **start with 25% Apotheosis**; career gold ≥ 40,000 → **+10%
base damage**. (Internals keep their legacy `killedWarden`/`goldwake_meta` names
so old saves survive.)

## Architecture

All game math lives in a fixed **1080×1920 logical playfield**; the renderer
scales and letterboxes it. Files load in dependency order via plain `<script>`
tags — each hangs one namespace on `window`.

| File | Namespace | Responsibility |
| --- | --- | --- |
| `index.html` | — | Black fullscreen page; WebGL canvas + overlaid 2D HUD canvas; scripts in order. |
| `js/sfx.js` | `window.SFX` | WebAudio-synthesized SFX (no files). Master → lowpass → compressor; lazy context resumed on first gesture. |
| `js/music.js` | `window.MUSIC` | Procedural WebAudio **score**: layered stems (pad / pulse / crest) on a real-time lookahead scheduler, per-sector + title + per-boss themes seeded off the run seed, driven by the wave-slot arc (`setIntensity`), boss phases (`setBossPhase`), APOTHEOSIS filter-lift, pause duck, and shop pad variant. Shares SFX's AudioContext; sits mid-low and under the SFX. |
| `js/gl.js` | `window.GL` | WebGL2 renderer. Procedural sprite atlas, instanced additive quad batcher, threshold + separable-gaussian **bloom** at ½/¼ res, chromatic-offset composite (the Apotheosis pulse). |
| `js/engine.js` | `window.Engine` | Fixed-timestep loop (60 Hz, dt clamped), keyboard input, preallocated **object pools** (4096 bullets / 256 shots / 128 enemies / 2048 particles / 512 gold), circle collision. |
| `js/patterns.js` | `window.Patterns` | Danmaku emitter toolkit — legacy (aimed / fan / ring / spiral / whip / flower / spray) plus the **authored-geometry verbs** (`ringGap`, `pulse`, `arcWall`, `snake`, `crossfire`, `wheel`, `rain`, `burstAimed`), six bullet **families** (orb / ring / kunai / shard / pellet / star) with **size + speed tiers** (`o.fam` / `o.tier`), and global affix scalars (`setGlobal` for DENSE VEIL etc.). |
| `js/run.js` | `window.Run` | **Roguelite structure**: seeded PRNG (mulberry32) + run generation, sector affixes, the **god-boon** draft + shop card UI and composition rules, the god metadata (`Run.GODS`), title / end screens, the localStorage meta layer, and the run-flow state machine. Drives Game; no combat sim. |
| `js/game.js` | `window.Game` | **Combat / stage layer**: player, the **SPECIAL** weapon + charge meter, enemies, bosses, bullets, the **god-boon effects + enemy status system** (chain/knockback/precision/charm/burn/stun + kit meters: Hunt/War-Heat/runes/coil/Bifröst), Apotheosis, scoring, FX, the wave pool, hazards, and all in-combat HUD. Exposes the `Game.*` API that `run.js` calls (incl. `applyBoon`). |

**Status-effect architecture.** Enemies carry status fields
(`charmMeter/charmed/charmT`, `marked/weak`, `burnT`, `stunT`, `terrorT/shakenT`).
Attack hits route through `hitEnemy → damageEnemy(e, dmg, precise)` (which applies
Marked/Weak/**precise** ×2.5 multipliers — precise is earned only via a **weak-point
node** overlap or `forceCrit`, no RNG) then `applyAttackGod` (which stacks the status
or advances a kit meter: Hunt brand, Odin runes, Quetz coil, Loki mischief).
`updateStatus` ticks burn and charm/mark/weak timers each frame. **Charmed
foes** skip their `onUpdate` (no enemy fire), are excluded from all enemy→player
collision and from being targeted by shots/hazards, run `updateCharmed` (seek the
nearest foe, fire player-faction shots at it), and expire in a heart-burst.
Horn shoves use a per-bullet `timeScale`/`slowT` in
`Engine.updateBullet`.

**God entities** are pooled/singletons on `G`: Ra's beam is stateless (per-frame in
`updatePlayer`); Loki's `decoy`, Odin's `gungnir`, and the raven/clone arrays are
small fixed collections; the staff pillar, Guan Yu's sweep and the Quetzalcoatl
serpent extend the shared `hazards` pool (8 slots). Every enemy aimed pattern
targets `Game.aimPoint()` — which returns the Loki decoy while it lives, else the
player. `Run.GODS` is
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
entirely — no bullet motion, timers, firing, Apotheosis drain, or SFX — while the
frozen field stays visible behind the neon card UI. **Pause** (P or Esc) freezes
`playing`/`clearing` the same way; X from the pause screen abandons to title.

### Rendering notes

- Depth test **off**, additive blending (`ONE,ONE`) **on**; near-black background
  so additive neon sings. Every sprite is one instanced quad from a boot-time
  procedural atlas; shaders are JS template-string constants.
- Bloom runs on half/quarter-res targets; the composite adds a chromatic split
  that pulses during Apotheosis plus a gentle tonemap so highlights roll off.
- Player fire is cool cyan/white, enemy fire warm/magenta, UI neon cyan + gold —
  the screen reads at a glance even when it's full of bullets.
- Enemy bullets are **not** additive glow blobs: they draw in their own
  **premultiplied-over** pass (a dim family-colour halo sits under an opaque glassy
  body with a baked near-black `#231A20` outline), so every bullet silhouette
  survives the brightest bloom crest — freeze a frame over a white explosion and the
  shapes still read. Bullet visuals scale ~1.6× while hitboxes stay tiny; the widened
  gap is the graze feel.
