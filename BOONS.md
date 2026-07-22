# HUBRIS — Boon Doctrine

The god-kit standard. DANMAKU.md governs how the game *shoots*; ART.md governs how
it *looks*; this governs what your **boons** are and how a transform must feel. The
failure mode this document kills: a god "transform" that is a hidden stat-rider on
the same cyan blobs — no visible change, no new sound, dead against the add-less
bosses. A boon is a **new weapon**, read in one frame by eye and by ear, or it does
not ship.

Binding on `js/game.js` (kit effects, status), `js/run.js` (`GODS`, cards, `STARLINE`),
`js/sfx.js` (voices), `js/gl.js` (procedural draw). Every visual here ships
engine-procedural from the existing atlas first; **signature projectiles and
owned entities may additionally get authored sprites** (owner call 2026-07-18,
art/PROMPTS.md §9 + §12 below) with the procedural draw as the live fallback —
dense streams, FX and status glyphs stay procedural-only.

## 1. The Boon Laws

1. **Every transform is immediately visible.** The moment a god is equipped the
   *projectile itself* changes shape/motion/color — not a number. If a paused frame
   can't tell the transform is on, it isn't done.
2. **Every transform is audible.** Each god's fire has its own **material voice**
   (§6); its special is that same material grown up. Ramps, tiers and heists get a
   distinct event cue. The ear names the projectile at a 200-bullet crest.
3. **No pure stat-riders.** A card that only multiplies a number is a SCALING card and
   is labelled such. A *transform* changes the verb. Star levels grow the **signature**,
   never the base stream (§7 honest-split).
4. **Statuses are shape-first.** Read by **where** a glyph sits and **what** shape it is,
   never by hue alone (§4). Motion is a tell (stun freezes, terror shivers).
5. **Every kit is boss-viable.** TALOS/AMMIT/MIDAS spawn zero adds. Every attack and
   special has a defined, strong lone-boss behaviour — usually its peak (§8).
6. **Owned entities read as yours (§5).** Cyan heart, nose-up; they expire on kit-swap.

---

## 2. Per-god kit sheets

Per god: **ATK**/**SP** (mechanic·numbers · *visual* · voice) · **★** (honest-split) · **CARD**
(DESC / ▸HOW / ★-LINE) · **BOSS** · **RE-ANCHORS**. Colors are **combat** projectile colors
(cyan/white player law where a god has no rework record). Nine kits were reworked (artemis, ares, odin,
loki, quetz, ra, heimdall, the three specials, faction); the rest keep current mechanics,
brought up to the Laws. Owner amendments 2026-07-18: Artemis Hunted chain/sticky, Ares Greek
armory, Odin NINE NIGHTS, Heimdall THE BIFRÖST.

### OLYMPUS

**ZEUS** — chain lightning · storm
- **ATK STORMCALL** (unchanged): streams arc chain-lightning to a 2nd foe within 120px. *Bronze
  crackle jumps.* Voice ELECTRIC (saw + 80Hz ring-mod + hp-noise crackle ~50ms).
- **SP SKYFALL** (REWORKED, specials rec): **instant, no projectile.** Column x = nearest foe within
  140px of `player.x` else `player.x`. Foes with `|x−colX|<55` take `LANCE_DMG*2.4*spDmg*specialR`;
  non-boss → `stunT=max(,0.4)`. Then `chainLightning(primary, LANCE_DMG*0.5…, isStorm)` — inherits +2
  jumps, boss-collapse (unspent forks pile onto origin ×0.5), all zeus mods. *~14 stacked CORE segments
  full-height on colX, ±18px x-jitter/frame, white core in `0.6,0.85,1` haze; forks via arcFx; `flashAll`
  + `addShake(6)`; no lance capsule; clears ~0.22s.* Voice ZEUS CRACK (6ms hp noise + 40Hz sub + saw
  900→180Hz raked, tanh sat).
- **★** atk→chain dmg/hops · sp→SKYFALL strike dmg.
- **CARD SP**: "SKYFALL — a bolt cracks straight down your lane and forks to nearby foes; struck foes are
  Stunned." / ▸ "Instant strike on your column; forks jump to neighbours." / "★★★ ×2.25 strike damage"
- **BOSS** whole column + collapsed forks on the lone body = strong single-target. zeusFork/Chain/Crit ride it unchanged.

**POSEIDON** — REMOVED from the game 2026-07-21 (owner: too gamebreaking)
> DEAD KIT — kept below for history only. POSEIDON (god, THE DELUGE ultimate, PEARL OF THE DEEP charm, all 4 mods, and the WORLD SERPENT / TYPHOON PILLAR / STORM SURGE duos) has been fully excised from js/. Nothing below is live. Retained ids sanitize out of any legacy save (Run.REMOVED_GODS / Game.sanitizeRemovedGods).

**POSEIDON** — knockback+impact · tidal wall
- **ATK** (unchanged): shots knock foes back, spring-damped displacement (lurch, wall-slams, pile-ups).
  **To-code**: add a 2-frame impact hold + KINETIC water-slap per landed shot so the shove is *felt*.
  *Sea-teal round + displacement ripple.* Voice KINETIC + 1.2k water-whoosh.
- **SP TIDAL WALL** (unchanged): wall sweeps up eating enemy bullets to gold. *Teal wall, each eaten bullet
  → coin.* Voice KINETIC slam + rising water.
- **CARD ATK**: "Shots slam foes back — walls, tines, pile-ups." / ▸ "Displacement scales with hits; shove
  into terrain." / "★★★ ×2.25 impact damage"
- **★/BOSS** atk→knockback dmg · sp→wall dmg & eat-count. Wall eats the dense volley to gold; shove = displacement-lite (heavier body).

**ARTEMIS** — THE HUNT · THE LOOSED ARROW (REWORKED, artemis rec + owner chain/sticky amendments 2026-07-18)
- **ATK THE HUNT**: 3 (focus 4) arrow-needles — **kind 9**, faction 0, pierce 1, radius 12, speed
  `SHOT_SPEED`, oriented to velocity. With no Hunted branded, arrows fly STRAIGHT (normal forward spread);
  the first foe hit is branded **Hunted**. Branded: arrows gently home to the Hunted via Jade block
  (`homing, turn=2.2` — weak on purpose; the ramp is the skill). Each hit on the Hunted `+12%` dmg, cap 8
  = `+96%`; stacks hold 3s (refresh on hit). **CHAIN**: killing the Hunted auto-brands the nearest foe and
  CARRIES stacks −1 per hop. **STICKY**: stray hits on non-Hunted foes do NOT re-brand; 3 consecutive hits
  on the same other foe abandon the hunt and re-brand it at 0 (deliberate switch only). **SPLINTER**: a
  Hunted kill bursts `huntStacks` silver shards (small, shard fam) into nearby foes for `0.4×` arrow dmg
  each — deep hunts pay out in crowd damage. State `G.hunted`, `G.huntStacks`, `G.huntSwap` (0-3 counter).
  *Silver-white body + moon-blue rim; a tightening chevron bracket on the Hunted cinches with stacks.*
  Voice BOW thwip + ramp pizzicato (+semitone/stack) + slack-string reset (only on abandon, not on chain).
- **SP THE LOOSED ARROW** (specials rec is authority; owner-amended interlock): kind 4, radius
  14, scale ~64, `vy=-2600` (fastest), `homing, turn=5.0, pierce 999, forceCrit=1` (always **precise** ×2.5),
  `markHit=1`. Target: marked → lowest-HP → boss → up; only re-aims if nothing in a ~40px forward cone.
  Every pierced foe gets `markEnemy` (+25% taken); the FIRST foe struck becomes the Hunted at FULL ramp (8)
  — thread a line, then chain kills down your own Marked trail. *Moon-silver CORE needle + white head +
  2 fletches, vapor trail, visible bank (unified to the player cool-fire law — acid-green rejected; reads
  by silhouette/speed, not hue).* Voice ARTEMIS THWIP (triangle 220→60Hz/30ms + 4kHz fletch, ~80ms, dry).
- **CRIT RETIRED → PRECISION** (§3): delete all RNG crit rolls (`artemisCritChance`, `G.critBonus` roll,
  `huntersEye` always-crit). Keep `damageEnemy`'s crit path, rename read `precise` ×2.5, driven **only** by
  weak-point overlap or `forceCrit`; keeps gold pop + spark + APOTHEOSIS/HUBRIS feed.
- **★** atk→arrow dmg (ramp base) · sp→LOOSED ARROW dmg.
- **CARD ATK**: "Silver arrows brand the first foe hit as your HUNTED and home to it." / ▸ "Hits on the
  Hunted ramp +12% (max +96%); kills chain the hunt to the next prey." / "★★★ ×2.25 arrow damage"
- **BOSS** arrows converge on the lone body, ramp climbs uncontested — Artemis's peak.
- **RE-ANCHORS** SILVER FLETCHING→**PRECISION** (+precise dmg, +15% node size); huntersEye→Marked foes always
  expose a node; deathSentence→max-ramp hit executes <40%; godsOfWar→crescents precise vs Terrified.
  Mods: artemisCrit→HUNTER'S REACH (+2 cap, +0.6 turn); artemisMulti→DEEPER HUNT (0.12→0.18/stack);
  artemisRefund→6+ stacks refund 0.1 charge; artemisSpread→chain hops carry ALL stacks (no −1 decay).
  Optional mod **THE QUIVER**: special banks up to 3 arrows, dump as seeking crits.

**APHRODITE** — Charm · HEARTSEEKER (special REWORKED, specials rec)
- **ATK CHARM** (unchanged): shots charm foes to your side. *Pink shot; charmed hull recolors cyan + rising
  hearts (§4).* Voice CHARM (soft sine chime + minor-3rd gliss, **no noise**).
- **SP HEARTSEEKER**: kind 5, `vy=−900`, `weave=1, homing, turn=3.0, pierce 0`, seeks nearest un-charmed foe.
  Non-boss → `charmEnemy`. **Boss** → `weakStacks` (0..3, +8% taken ea, `weakT=6`; mult `1.10+0.08*stacks`)
  **and** sweeps enemy bullets within 220px to gold. Recast stacks Weaken. *Two GLOW lobes + CORE point =
  heart, magenta, SHARD petals along a weave; boss-hit bullets spiral in → gold.* Voice APHRODITE CHIME-SWELL
  (sine 523/784Hz, 200ms attack, vibrato, light reverb).
- **★** atk→charm shot dmg & duration · sp→charmMissile dmg (`*specialR` — **bug fix** §7) + duration +40% @★★★.
- **CARD SP**: "HEARTSEEKER — a slow heart weaves to the nearest foe." / ▸ "Charms a minion, or Weakens a boss
  (+8%/heart ×3) and melts its bullets to gold." / "★★★ ×2.25 charm damage & +40% duration"
- **BOSS** Weaken-stack + bullet-lull-to-gold is the primary read (no minion).

**ARES** — WAR-HEAT (proximity) · Phobos & Deimos (attack REWORKED, ares rec)
- **ATK WAR-HEAT**: meter `frenzyF` (0..1) → `G.frenzy.stacks=round(frenzyF*10)` (all existing consumers keep
  working). Each step `dist=nearestEnemy(player)` (boss body valid). Bands CLOSE=260/FAR=440px. CLOSE `+0.25/s`;
  beyond FAR (0.4s grace) `−0.18/s`; between = hold. **Proximity alone builds** — no trigger-hold. `frenzyRate()`
  rewritten +6%→**+3%/stack**. Three hard tiers off stacks, payoff in `fireStreams`:

  | Tier | stacks | shape (GREEK ARMORY, owner 2026-07-18) | spread | scale | radius | pierce | color |
  |---|---|---|---|---|---|---|---|
  | CALM | 0–3 | **javelins (akontia)** — slim shaft + small bronze leaf point | 0.30 (0.16 focus) | 44 | 14 | 0 | ember `0.70,0.20,0.15` |
  | HEATED | 4–7 | **xiphos** — leaf-blade short swords (waisted swell profile), converge | ×0.8 | ×1.5 | ×1.35 | 1 | arterial `1.0,0.15,0.12` + bronze hilt glint |
  | FRENZY | 8–10 | **doru bundle** — braided hoplite spears, broad bronze heads | ×0.33 | ×1.9 ctr | ×1.6 | 3 | white core `1.0,0.55,0.35` |

  FRENZY adds **one LABRYS**/volley (replaces war-scythe — a serrated crescent still risked reading as Guan Yu;
  the mirrored double-axe silhouette cannot): spinning double-headed axe, RED `0.78,0.12,0.12` + bronze heads,
  radius 34, pierce 3, travels ~520px (reach so wall/lattice phases can't strand melee). Needs new atlas painters:
  leaf-point javelin, waisted xiphos, labrys twin-head. `prevTier` upward cross → 1-frame red muzzle bloom +
  kindle SFX; backing out re-splays the fan (cooling read). [VARIANT] labrys head geometry + spin trail.
- **SP PHOBOS & DEIMOS** (unchanged): two dread-wraiths dive-bomb, sow **Terror**. Owned-entity law (§5): dread-red
  body, cyan heart, nose-up. Voice FLUTTER dive + terror shudder.
- **VOICE (bespoke, overrides FLUTTER)**: WAR-DRUM bed 70Hz thud every `(0.9−0.5*frenzyF)s` (tempo rises — heat is
  audible before visible); shot growl layered (CALM clean → HEATED saw ~110Hz → FRENZY ~80Hz + hiss, 3 blips merge
  to one thrown-weapon hit); tier-up timpani + noise whoosh 400→3k; tier-down douse downsweep.
- **★** atk→War-Heat shot & labrys dmg · sp→wraith strike dmg.
- **CARD ATK**: "BLOODLUST — fight at the muzzle; a spear's length from a foe stokes War-Heat, back off and it cools." /
  ▸ "HEATED: xiphos blades converge. FRENZY: a doru spear-bundle + whirling labrys." / "★★★ ×2.25 War-Heat damage"
- **BOSS** the war-drum beats hardest in the boss's face — old dead-air becomes the peak. aresDecay halves FAR-drain
  for wall phases; bloodAndFire skips drain while anything burns; addFrenzy redefined `+0.10` (terror-kill duos = gravy).

### KEMET (Heliopolis / Duat)

**RA** — THE LENS solar beam · Solar Flare (attack REWORKED, ra rec)
- **ATK SOLAR LENS**: replace smooth ramp with 4 stepped tiers on continuous held-time on ONE target, same formula
  `tick=BEAM_DPS*mult*atkDmg*dt`:

  | Tier | hold | mult |
  |---|---|---|
  | KINDLE | 0.00–0.60s | ×1.0 |
  | FLARE | 0.60–1.30s | ×1.5 |
  | SOLAR | 1.30–2.00s | ×2.0 |
  | CORONA | ≥2.00s | ×2.5 |

  State `G.ra.hold`, `graceT=0.30`. No/switched target bleeds ONE tier per 0.30s (a dying-then-replaced column
  enemy or adjacent flick inside 0.30s is free). **BOSS LOCK**: boss target → `hold` monotonic, never decays; CORONA
  reachable/held (Ra's boss signature). raRamp charm scales thresholds ×0.556, caps ×2.875. APOTHEOSIS forces CORONA.
  *Primary VARIANT A tightening-lance (render A/B/C §11): 3 STREAK rays muzzle→knot, spread tightens ±10px KINDLE →
  ±2px CORONA (one hard line); knot CORE 30→8px; stage-up RING 26→70px + 6 SPARKs (hard CLICK/rung); 1–4 gold RING
  notch-glyphs ride the beam (occlusion-proof count). **COLOR (owner 2026-07-19: "laser should be way more red"):**
  the ramp runs RED — deep solar red KINDLE → red-orange FLARE → hot red-white SOLAR → white-hot core inside a red
  corona at CORONA, + rotating corona flare. Sun-as-furnace, never honey-gold; the old bronze→amber→white-gold ramp
  is dead. Ra joins Ares as a sanctioned god-hue exception to the cool player-fire law (the notch-glyphs stay gold).*
- **SP SOLAR FLARE** (unchanged): ignites all with **Burn**. Voice white-noise flash swell ~0.5s.
- **VOICE BEAM**: live 3-osc (one/stream) converging detune ±(18−16*frac)c to unison as tier climbs (you *hear* it
  focus); lowpass 600→2500Hz; stage-up ramps root +4 semitones + bell ping; stage-drop warn blip. One oscillator, no per-shot.
- **★** atk→beam DPS (all tiers) · sp→Solar Flare burn dmg.
- **CARD ATK**: "SOLAR LENS — hold fire to fuse three streams into one beam." / ▸ "Burn the SAME foe to focus tighter
  through 4 heat stages, up to ×2.5; count the notches." / "★★★ ×2.25 beam DPS"
- **BOSS** boss-lock trivially holds CORONA — Ra scales hardest vs TALOS/AMMIT/MIDAS.

**ANUBIS** — THE WEIGHING · GATE OF DUAT (REWORKED, owner-ratified 2026-07-19; old attack+special ruled
"things that feel like they should just be extra boons" — invisible math riders demoted to mods)
- **ATK THE WEIGHING**: amber ankh-tipped bolts. Every foe hit accrues `e.scaleW` (+dmg dealt per hit);
  glyph = small gold **scales that visibly tip** with weight (angle ∝ `scaleW/threshold`, threshold =
  `maxhp*K` — trash tips in 2–3 hits, elites take commitment; a stack-mark like Loki's MISCHIEF, not a §4
  status). At tip → **THE VERDICT**: non-boss is **devoured** (jackal-shadow snap FX, execute, +50% bonus
  gold); boss/elite takes a judgment burst (`maxhp*0.02`, floor vs LANCE_DMG scaling) + **Weak** 2 stacks;
  scales reset and re-arm (repeatable on bosses). *Amber bolt; gold scales glyph; verdict = snap silhouette
  + scales-tip ring.* Voice BELL darker; verdict = sub gong + tip-ring. Overlap note: per-enemy accumulator
  like Odin's runes, but Odin studies ONE target forever — Anubis serially sentences everything he touches.
- **SP GATE OF DUAT** (placement owner-ruled 2026-07-19, option 2): a sand-vortex gate tears open **at the
  player's position at cast** (~2.5s; the player is free to move away — the gate stays where opened).
  Placement is the skill: bait foes over a spot, then open the floor under them. Every WOUNDED foe
  (hp < max) is **dragged** toward it (real inward pull via the displacement system; bosses immovable)
  and takes a share of missing HP over the duration (absorbs old Judgment of Duat's identity; per-cast
  boss cap `min(0.05*specialR,0.15)*maxhp` stands); non-bosses that die at the gate pay bonus gold.
  *Sand vortex + soul-wisps spiraling in.* Voice BELL + low sand-roar.
- **MODS (the demoted legacy effects)**: **HEAVY HEART** — foes below half HP tip 2× faster (the old +25%
  below-half, reborn); **FEAST OF THE FAITHFUL** — verdict/gate kill gold +50%.
- **★** atk→verdict burst dmg & tip-rate · sp→gate missing-HP share & pull strength.
- **CARD ATK**: "THE WEIGHING — your hits load the scales on every foe; when they tip, the Verdict devours
  the weak for gold." / ▸ "Bosses take a judgment burst and Weaken instead; scales re-arm." / "★★★ ×2.25 verdict damage"
- **CARD SP**: "GATE OF DUAT — a gate of sand opens below; the wounded are dragged toward judgment." /
  ▸ "Missing-HP damage; kills at the gate pay bonus gold." / "★★★ ×2.25 gate damage"
- **BOSS** repeatable verdicts ≈ a rhythm of judgment bursts + Weak; gate pays its missing-HP share hardest
  late-phase. Phase's final blow keeps §8: apotheosis shard + 50% segment cancel-gold.
- **RE-ANCHORS** deathSentence duo → "precise hits and max-ramp Artemis hits load double weight; a Hunted
  kill tips the next scales instantly"; eternalDevotion unchanged (verdict-devoured rise as charmed ghosts);
  HEART SCARAB charm unchanged.

### ASGARD

**LOKI** — PILFER · Shadow-Twin (attack REWORKED, loki rec; **CONFUSE IS DEAD** — ruling 1)
- **CONFUSE REMOVED game-wide.** Delete the on-hit confuse roll, the AIMX/AIMY aim-reflection (→ plain target), the
  +15% vs-confused rider. Rename freed `confuseT/confuseBudget` → `trickStacks/trickBudget`. Loki's boss self-harm now
  lives **inside Pilfer's boss budget**, not a confuse mechanic.
- **ATK PILFER**: every landed shot +1 **MISCHIEF** to that foe (cap 3, decay 2.5s). At 3 → **PILFERED**: grab the 8
  live enemy bullets nearest the foe within 240px, **biased to bullets already >80px from any emitter** (never whiffs /
  never a panic-clear). Each: `friendly=true`, `srcId=foe`, tint `0.55,1.0,0.35`, reverse 180°, gentle homing (`~2.2 rad/s`)
  to nearest OTHER live enemy. Damage rides existing `flipDmg=2.0*attackR` (no rider). Reset stacks, 1.2s per-foe cooldown.
  *On-foe green TRISKELE of 1/2/3 kunai (stack = shape). On Pilfer: green RING implodes 0.15s, 8 bullets freeze 1 frame +
  white pop, re-tint green, snap 180° with knotwork streaks + home; thin green thread foe→bullets.* Voice reverse-pickpocket
  LIFT (reversed-envelope bandpass pink-noise → bright click on flip; detuned triangle twin-shimmer 880→1320Hz; per-dagger
  metallic clink). ELECTRIC+warble is the base shot; LIFT is the Pilfer event.
- **SP SHADOW-TWIN** (unchanged): decoy draws all aimed fire, soaks streams; **never attacks** (the one sanctioned
  no-damage special). Owned-entity law (§5): green body, cyan heart, nose-up.
- **★** atk→pilfered-dagger dmg (via flipDmg) · sp→twin soak HP/duration.
- **CARD ATK**: "PILFER — your hits pickpocket a foe (3 marks); on the third, snatch the 8 nearest enemy bullets." /
  ▸ "They flip green, spin 180°, and hunt their own kind." / "★★★ ×2.25 dagger damage"
- **BOSS** stacks build on the lone boss from your hits; stolen bullets home back onto it, capped **0.5% maxhp/cast** via
  `trickBudget/consumeBossFlip` — bleeds its own wall, can't be looted to death.
- **RE-ANCHORS** lokiVaunt→"pilfered daggers also charge APOTHEOSIS" (already true, addGauge(0.6)); lokiChance→**PICKPOCKET**
  (Pilfer on 2nd stack, steal 12). DOPPELGANGER deferred (OPEN CALLS).

**ODIN** — NINE NIGHTS · Gungnir (attack REWORKED, owner design 2026-07-18 replacing ÓÐR; ravens → charm)
- **ATK NINE NIGHTS**: the single-target specialist archetype — weak into popcorn, inevitable into anything that
  lives. Stream collapses to **one heavy rune-bolt** (n=1, no spread): dmg `3.2×` base, cadence 0.14, pierce 0,
  radius 16. Every **4th hit** on the same foe CARVES A RUNE into it: `e.runes` 0..9, **permanent for that enemy's
  life** (never decays, never resets — reset only in `newEnemy`; per-enemy, so several foes can each hold carved
  runes; no brand to lose, no streak to protect). Odin's damage vs a foe: `×(1 + 0.15*e.runes)` (+135% at 9).
  **THE NINTH RUNE**: the band ignites — vs that foe his bolts become gold-cored **doom-bolts** (`markHit=true`,
  full +135%); the fight visibly tips from studying to sentencing. ~36 hits ≈ 5s sustained to full on a boss;
  popcorn dies before 2 runes (priced-in archetype cost — Gungnir is the crowd release valve). Ramp axis vs the
  other ramp gods: Artemis = per-hit momentum (resets/chains), Ra = held attention (cools), **Odin = permanent
  per-enemy knowledge**. *Steel-blue `0.8,0.85,0.92` STREAK bolt + NEEDLE spine + faint runic wake; carved runes =
  small gold `1,0.85,0.4` glyphs filling a band arced around the foe's hull (count IS the meter); 9th → band
  ignites gold + 1-frame sigil flash; doom-bolts gain gold core + GRING halo.* Voice heavy dry 'tok' 620→380Hz;
  each carve = stone-chisel chip (2ms noise tick + 1.2kHz ring); ninth = low doom-toll (bell, 180Hz, 0.6s);
  doom-bolts add a sub-thump layer.
- **SP GUNGNIR** (unchanged): never-miss piercing spear.
- **★** atk→bolt dmg (rune mult rides it) · sp→Gungnir dmg.
- **CARD ATK**: "NINE NIGHTS — one heavy bolt; every 4th hit carves a rune into the foe, each +15% against it,
  forever." / ▸ "Runes never fade. The ninth seals its doom: gold bolts that Mark." / "★★★ ×2.25 bolt damage"
- **BOSS** his kingdom: by mid-fight the boss wears the rune-band scar and every bolt lands like judgment. Doom
  Mark feeds Gungnir / THE ALLSEEING. Segment/phase transitions do NOT clear runes (same enemy, same knowledge).
- **RE-ANCHORS** **HUGINN & MUNINN** charm (charmOdin) — lift `updateRavens/drawRavens` out of the attack path, gate on
  `G.charms.charmOdin` so ravens fly with **any** attack. Dive 9→12, interval 1.7→1.4s, scale `atkDmg`, Mark-on-dive
  (`markT 6`). **MEMORY**: +1 dive dmg/8 kills (cap +18); past 30 kills interval→1.0s + fast pairs. *Near-black birds, cyan
  heart (§5), gold RING halo thickens with kills.* Mods odinRaven/RavenMark → **odinFury** (runes carve every 3rd hit,
  not 4th) + **odinSunder** (doom-bolts splash 50% to one foe within 120px). Duos wildHunt→doom-bolts ×2 to Terrified,
  feeds frenzy; theAllseeing→bolt & Gungnir +40% to Marked. (Retired 'shop rerolls half' perk — OPEN CALLS.)

**THOR** — Mjölnir · Giant's Bane
- **ATK MJÖLNIR** (unchanged): returning kinetic hammer, spring-damped displacement (lurch, wall-slams). *Slate hammer arcs
  out and returns; hulls lurch.* Voice KINETIC + **doubleHit** (throw + return).
- **SP GIANT'S BANE** (unchanged): colossal crush — pure force, never lightning. *Huge slate slab-slam + heavy displacement.*
  Voice KINETIC deep slam-faller.
- **★** atk→hammer dmg · sp→crush dmg.
- **CARD ATK**: "A kinetic hammer flies out and returns, slamming foes aside." / ▸ "Hold — hammer loops out and back; displaces on hit." / "★★★ ×2.25 hammer damage"
- **BOSS** crush lands full as heavy displacement-lite + bonus damage.

**HEIMDALL** — THE BIFRÖST · Gjallarhorn (attack REWORKED v2, owner 2026-07-19 — VERTICAL and aimable; the
horizontal band + 5-ray refract fan is DEAD: "I thought it would be just vertical, so I can actually aim it.
I don't want the fan out"; owner picked SPECTRUM LANCE)
- **ATK THE BIFRÖST**: between bridges, ordinary dawn-gold streams. On a fixed cadence (**every 6.0s while
  firing**): **TELEGRAPH** — a thin dotted **dawn-seam** traces bottom→top (~0.5s) at the player's CURRENT
  `x` with a rising bell arpeggio — the aim window: you steer the road by standing where it should lay —
  then the **BRIDGE** solidifies: a full-height vertical rainbow band (~32px), lifetime 4.0s, `x` frozen at
  seam-finish. **SPECTRUM LANCE**: shots fired while the player is INSIDE the band become prismatic lances —
  one bolt, `×1.6` dmg, `pierce +2`, rainbow CORE streak; **no split, no fan**. Step off the bridge and your
  fire is ordinary — planted on a glowing line everyone can see is the commitment, and the skill. **THE
  WATCHMAN SEES**: any foe overlapping the band is **Marked** (`markT 6`), bosses included — lay the road
  through the hull. *Voice BELL; seam = rising arpeggio (3 bells, 5th+8ve); lance = crystalline shimmer
  (throttled 6/s); bridge-fade = soft descending pair.* State: `G.bifrost {t, x, seamT}` — no pooled
  entities; band is a drawn hazard.
- **SP GJALLARHORN** (unchanged): horn blast wounds + **Marks** every foe + shoves the whole field (`timeScale/slowT`).
  *Expanding shockwave, field shoved out.*
- **★** atk→lance dmg · sp→horn dmg & Mark potency.
- **CARD ATK**: "THE BIFRÖST — a rainbow bridge lays down your lane on a beat; fire from the bridge to
  loose spectrum lances." / ▸ "A dawn-seam warns first, at your feet. Foes on the bridge are Marked." /
  "★★★ ×2.25 lance damage"
- **BOSS** park the bridge through the hull → the boss stays Marked while lances pour in; horn shoves its
  wall. [VARIANT] band treatment (dotted-seam density, band shimmer vs glassy). (Deferred mod idea, option-C
  graft: **AT THE POST** — enemy bullets crossing the bridge are slowed while you stand on it.)

### CELESTIAL COURT

**WUKONG** — hair-clones · Ruyi Jingu Bang
- **ATK 72 CHANGES** (unchanged): kills spawn hair-clones copying your fire. Owned-entity law (§5): gold body `1,0.8,0.35`,
  cyan heart, nose-up, fire in the **player's gun voice at −12dB**; cap 3. Voice KINETIC wooden knock (+grain while clone live).
- **SP STAFF PILLAR** (unchanged): Ruyi Jingu Bang pillar that **Stuns**; extends `hazards`. *Gold pillar slams down; stunned foes freeze.*
- **★** atk→clone fire dmg · sp→pillar dmg.
- **CARD ATK**: "Kills may spawn a gold hair-clone that echoes your fire (cap 3, cyan-hearted)." / ▸ "Kill foes to summon; swap gods and clones recall." / "★★★ ×2.25 clone damage"
- **BOSS** first hit summons a clone; every tithe unit refreshes oldest clone +1.5s (cap 7s); each segment-clear rolls a fresh clone (§8).

**GUAN YU** — cleaving crescents · Crescent Moon Sweep
- **ATK CRESCENT BLADES** (unchanged; **honest-pierce** §9): cleaving crescents gain power per foe pierced (existing
  `*attackR`; resets on a clean miss). Assumes §9 dedup — one bite/foe/pass. **To-code**: bright per-pierce brighten step +
  a shing that pitch-drops per pierce. *Jade `3be089` crescent, brightening a step/foe.* Voice BLADE (shing ~2.5k, **−80c/pierce**).
- **SP CRESCENT MOON SWEEP** (unchanged): one colossal blade sweeps the field upward, hurling foes aside. Voice BLADE 0.5s downsweep 2.5k→600.
- **★** atk→crescent dmg (crescent REPLACES the base stream = the signature) · sp→sweep dmg.
- **CARD ATK**: "Shots become crescent blades that cleave." / ▸ "Hold fire down a lane; blades pierce every foe, brightening per hit." / "★★★ ×2.25 crescent damage"
- **BOSS** crescents pierce + stack-brighten on the lone body; sweep hurls + heavy single-target hit.

**JADE EMPEROR** — IMPERIAL EDICTS (fan) · IMPERIAL JUDGEMENT (REWORKED, owner design 2026-07-18)
- **ATK IMPERIAL EDICTS**: the attack IS the edicts now — **5 edicts per volley in a fan** (spread ~0.5 rad; focus ~0.28),
  homing (existing Jade block), each **Stuns** non-bosses. **Clarity fix**: edicts redrawn as *scroll-talismans* — small
  violet `c99aff` rectangular tablet w/ gold border + red seal-dot, oriented to travel, thin trailing script ticks; burst =
  paper-flash. Distinct silhouette (only rectangular projectile in the game); needs one atlas painter (edict tablet).
  Voice BELL (inharmonic partial stack, 1ms strike, ~250ms ring).
- **SP IMPERIAL JUDGEMENT** (replaces Heaven's Verdict; Leigong, the Thunder Court): **two dark storm-clouds** fade in
  flanking the field (upper-left + upper-right, ~90px wide, roiling GLOW + dark CORE puffs, gold under-flicker), duration
  ~6s. Every **0.8s**, alternating clouds hurl a **lightning bolt** at a **RANDOM** live foe — bolt = Zeus-style strike:
  full `chainLightning(target, dmg, …)` arcs to neighbours + brief Stun on non-boss primary. Clouds are owned entities
  (§5: cyan heart glint in the cloud core; expire on kit-swap; despawn fx = dissipate). Recast refreshes duration.
  **MOD — MIRROR REFLECTION** (`jadeMirror`, draftable Jade mod): a bronze **demon-revealing mirror** (zhaoyaojing)
  hangs between the clouds; every bolt now visibly banks off the mirror mid-flight and strikes the **highest-HP foe**
  (random targeting → intelligent). *Mirror = small gold disc, flash on each reflect.* Voice: cloud rumble loop (low
  brown noise, throttled) + ZEUS CRACK variant per bolt (darker, −4 semitones); mirror adds a glass 'ting' pre-strike.
- **★** atk→edict dmg · sp→bolt dmg & cloud duration (+1s @★★★).
- **CARD ATK**: "Five imperial edicts fan out, seek foes, and Stun them." / ▸ "Auto — the fan homes; stunned foes freeze."
  / "★★★ ×2.25 edict damage"
- **CARD SP**: "IMPERIAL JUDGEMENT — the Thunder Court assembles: twin storm-clouds smite random foes with chain
  lightning." / ▸ "Recast to refresh. MIRROR REFLECTION aims every bolt at the strongest foe." / "★★★ ×2.25 bolt damage"
- **BOSS** clouds pour every bolt into the lone body (random collapses to it); with the mirror, guaranteed — plus chain
  collapse. Stun→bonus dmg (immune) unchanged for the attack.
- **RE-ANCHORS** Heaven's Verdict retired; old jade special mods re-point to Judgement (duration/bolt-rate). Duo
  harmonyOfHeaven unchanged (graze→special charge).

### FIFTH SUN

**QUETZALCOATL** — CONSTRICTOR (weave stays the attack) · Sky Serpent (REWORKED, quetz rec; ruling 2)
- **ATK CONSTRICTOR**, three parts: (1) **honest pierce-dedup** (§9): per-shot `s.hitList` cleared in `allocShot`; in
  `collideShots` skip `if s.hitList.indexOf(e)>=0`, push after hit; `maxHits=pierce+1` caps distinct enemies (deletes ~55
  fabricated DPS; base weave dmg UNCHANGED 1.05×SHOT_DMG). (2) **THE COIL**: `e.coilQ` (0..6), `e.coilT`. On a quetz hit
  `coilQ=min(6,+1); coilT=0.9`; applied dmg ×`(1+0.10*coilQ)` (max ×1.60); full uncoil 0.9s after last bite; ~6 bites
  (~1–1.5s) to max; resets on target-swap. (3) **clarity**: lock braid `s.phase=i*(TAU/3)` (delete `Math.random()*6.28`) →
  clean repeatable triple-helix. *Three lime streams `0.4/1.0/0.7` at 120° offsets, plaiting with knot sparks (VFX-only, 0
  dmg). COIL renders on the target: `coilQ` thin lime rings tightening (`radius*1.6`@1 → `*1.0`@6), jade→hot-white; CONSTRICT
  pulse-ring snaps in at max.* Voice SERPENT breathy "fwip" (triangle ~180Hz + 2–3k breath); COIL quantized rising whistle
  0.9k→2.4k/6 stacks; max = hiss + 90Hz crush; uncoil downward slide.
- **SP SKY SERPENT** (unchanged): eats bullets into your **apotheosis gauge**; extends `hazards`.
- **★** atk→weave & coil-multiplied dmg · sp→serpent eat-rate / gauge feed.
- **CARD ATK**: "Your three streams braid into a plumed helix — wider coverage, pierces 1." / ▸ "Hold the braid on ONE body
  to COIL it +10%/bite up to +60%; look away and it uncoils." / "★★★ ×2.25 weave damage"
- **BOSS** COIL is built for the lone boss — hold aim, rings cinch to +60%. Serpent eats the wall to gauge.
- **RE-ANCHORS** PLUMED PIERCE mod → +1 pierce.

---

## 2.5 ULTIMATES — the fifth card type (roster drafted 2026-07-19 under two owner rulings: "meaningful
gameplay differences" + "most of these are still variations of the bullets-turning-to-gold ultimate" —
so each ultimate is a distinct INTERACTION SHAPE, not a distinct payload on the same screen-flash)

**SYSTEM.** Card kind `ultimate`, god-tied, epic rarity, weight ~4. Transforms the **C-key burst slot**;
`G.ultimateGod`, one slot, picking another = swap (same pattern as attack/special). **DEFAULT (empty slot)
= DIVINE INTERVENTION** (freeze→gild, already built). Charge: the existing burst gauge, unchanged
[CONFIRM]. Offered only while the god holds attack or special (kit hooks guaranteed; OFFER PATHING feel)
[CONFIRM]. No star levels first wave [CONFIRM]. Card frame: white-gold double rim (rainbow stays duo-only).
All 15 first wave [CONFIRM]; numbers are tuning baselines.

**The shape law: at most ONE instant full-screen payload (Zeus). Everything else is something you place,
steer, wear, ride, or time.**

| God | Ultimate · shape | Mechanics (baseline) |
|---|---|---|
| ZEUS | **OLYMPIAN STORM** · THE one instant nuke | every live foe struck at once, `LANCE_DMG*4` + Stun 1.2 non-boss; no bullet interaction; the delete button, deliberately unique in shape |
| ~~POSEIDON~~ | ~~**THE DELUGE**~~ | REMOVED from the game 2026-07-21 (owner: too gamebreaking) — dead row, kept for history |
| ARTEMIS | **THE GREAT HUNT** · time you move through | ~1.5s at timeScale ~0.12 with free player movement; every foe your column crosses during the slow is tagged; on resume each tagged foe takes a precise arrow (`forceCrit`, `LANCE_DMG*2.5`) — damage = your flying during the freeze |
| APHRODITE | **ADORATION** · worn aura | a heart-aura clings to the player 5s (r~200): non-boss foes inside it charm one by one (~0.4s dwell); bosses inside accrue Weak stacks — you fly INTO them to convert |
| ARES | **ARISTEIA** · kill contract | 4s pinned FRENZY + doubled volleys; each kill +0.3s (cap 8s); no clear, no safety — runs while you kill |
| RA | **NOON OF THE DUAT** · steered artillery | the solar barque rides the top edge tracking the player's x for 3s, pouring a CORONA-class beam column straight down your lane (`BEAM_DPS*2.5` + Burn) — you aim the sun by flying |
| ANUBIS | **THE FINAL WEIGHING** · the timed verdict | instant but conditional: wounded non-bosses devoured (execute+gold), bosses bitten `missing*0.25` cap `0.2*maxhp`, full-health foes untouched — its whole gameplay is WHEN you press it |
| LOKI | **DOPPELGÄNGER** · the mirror | one perfect owned copy, 6s: fires your attack continuously, casts your special once at mid-life; §5 law (green body, cyan heart) |
| ODIN | **ALLFATHER'S EYE** · the study window | 6s: EVERY Odin hit carves a rune (not every 4th), on any foe — you choose what to learn; zero direct damage, everything after |
| THOR | **GIANT'S END** · the giant boomerang (owner 2026-07-19: orbit "too confusing" — REPLACED) | Mjölnir grows colossal and is THROWN up the player's lane: out-pass to the top edge, brief hang, return-pass back to the hand (~2.2s round trip, ~140px-wide head); foes it touches are hurled aside to the walls (`LANCE_DMG*2` slam), bullets in its path destroyed — one object, two straight readable passes, aimed by where you stand at cast |
| HEIMDALL | **DAWNBREAK** · mode transform | 4s: the whole field is the bridge — every shot a spectrum lance from anywhere, all foes continuously Marked |
| WUKONG | **THE WORLD-PILLAR** · planted cover | the staff PLANTS where you cast it: a stun shockwave rings outward (non-boss Stun 2.5s, boss stagger 0.8), then the pillar STANDS 4s as the game's only bullet-blocking obstacle — cover you position |
| GUAN YU | **GREEN DRAGON ASCENDS** · trailing blade | 3s: a blade-dragon trails your position (~0.3s lag) carving `BEAM_DPS`-class contact ticks through everything — you drag the blade through the crowd |
| JADE | **MANDATE OF HEAVEN** · bullet conversion (ruled 2026-07-18) | freeze 0.3s → gild → gilded bullets fire back (`flipDmg`-class) + gold +25% over default — deliberately the default burst's strict upgrade; the ONLY bullets→gold ultimate |
| QUETZ | **THE FIFTH SUN RISES** · orbiting devourer | the serpent coils AROUND the player 4s eating every bullet its body touches → burst-gauge + gold trickle, zero damage — you steer the orbit through the densest fire for maximum harvest |

- **Shape ledger** (no two alike): nuke · placed zone · time+input · worn aura · kill contract · steered
  artillery · timed verdict · mirror summon · study window · giant boomerang · mode transform · planted
  cover · trailing blade · bullet conversion · orbiting eater. Quetz is the only orbiter (eats bullets);
  Thor throws one aimed round-trip; Ra steers a ranged column, Guan Yu drags a contact body — pairs split
  by verb.
- Only MANDATE touches bullets→gold; only GIANT'S END destroys bullets uncompensated; only FIFTH SUN
  feeds the gauge; only GREAT HUNT touches time.
- Voice: one shared ULT-CAST swell + the god's §6 material accent at ×1.5; stubs until Pass 3.
- §11's ULTIMATES entry remains the ruling-of-record for the card type; this section is the roster.

---

## 3. PRECISION weak-point system (systemic crit)

RNG crit is retired game-wide (artemis rec). Crit is reborn as **PRECISION** — a systemic, aim-earned, god-agnostic weak
point any shot can strike.

- **Where**: authored into existing `patterns.js` **spellcard beats only** on the 3 bosses + elites — no per-trash work.
- **Cadence**: a telegraphed beat exposes a **pulsing node** — ~0.4s pre-flash telegraph, node open ~2s.
- **Payoff**: any faction-0 shot overlapping the node reads **`precise` ×2.5** + bonus gold + the gold pop / spark /
  APOTHEOSIS + HUBRIS feed (old crit machinery, repointed dice→overlap). Shape: a diamond-shard node (not a hue).
- **Reach-ins**: SILVER FLETCHING → +precise dmg & +15% node size; huntersEye → Marked foes always expose a node;
  `forceCrit` (Artemis LOOSED ARROW) always lands precise.
- This is where the crit-starved add-less boss fights get crit back — owned by no god.

---

## 4. Status shape-language

Read **WHERE** (zone) before **WHAT** (shape); hue never carries a status alone. Four disjoint zones around the enemy
(offsets in `e.scale`), drawn in the status-tell block from existing atlas cells; four+ tells coexist with no layout
manager. **Confuse removed** (ruling 1); roster = 7.

| Status | Zone | Shape / motion | Color | Effect |
|---|---|---|---|---|
| MARKED | FRAME (4 corners) | 4 static amber L-brackets, snap inward on re-apply | amber `0.95,0.75,0.2` | +25/+40% taken |
| WEAK | FRAME (lower only) | asymmetric sagging brackets + falling SHARD flakes | grey-violet `0.6,0.5,0.65` | +8%/stack, boss substitute |
| BURN | UNDERFOOT | 3 rising SHARD flame ticks, yellow-core→red-tip, 14Hz | `1,0.85,0.3`→`1,0.3,0.05` | DoT 22/s |
| STUN | CROWN + BODY | 3 SPARK stars overhead **+ body FREEZES** (fire-bob halts) | cyan-white `0.7,0.95,1` | frozen |
| CHARMED | CROWN + BODY | rising pink hearts + **body recolors player cyan**; suppresses hostile tells | hot-pink `1,0.3,0.55` | fights for you |
| TERROR | BODY | 30Hz jitter, sinks + leans away, dark contracting vignette | `0.25,0.02,0.05` | flee, ×1.20 taken |
| SHAKEN | BODY (boss) | half-amp jitter + 2 flickering STREAK cracks, no vignette | — | ×1.10 taken (terror's boss-variant) |

- **Same-zone collision** → fixed priority (stun>charm in CROWN; marked>weak in FRAME); loser demotes to a 6px CORE pip
  upper-right. Disjoint zones = marked+burning+stunned+terrified all render at once.
- **Loki's MISCHIEF** is a stack-mark, not a status: green TRISKELE (§2 Loki), 1/2/3 kunai.
- Each glyph gets a faint dark backing GLOW (opaque-survives-bloom, ART.md). Per-status apply-sting from the synth (§6);
  the two BODY-verb states (stun/terror) carry the loudest audio contrast.
- **Freed by confuse's death**: `confuseT/confuseBudget` → `trickStacks/trickBudget` (Loki Pilfer boss budget); the green
  confuse ring and the purple mirror-chevron brand are both deleted.

### 4a. THE RING BAN — state visual law (owner ruling 2026-07-21, binding)

**State = a SILHOUETTE RIM-LIGHT in the state colour (own draw-cell redrawn ~1.05–1.14× behind the body, alpha-pulsed,
never rotating) + body-zone glyphs/pips.** Persistent plain geometric rings/circles as state/buff/hazard indicators are
**BANNED everywhere** — enemy, player, hazard. Exempt: transient (<0.5s) impact FX; the player hurtbox dot+ring.

- **Standard rim colours:** gilded gold `1,0.82,0.30` · bulwark steel-blue `0.5,0.7,1.0` · frenzied ember `1,0.34,0.16` ·
  shield cyan-steel `0.55,0.85,1.0` · coil jade `0.35→0.9,1.0,0.5→0.95` (→ hot-white at max) · seal gold `1,0.82,0.4` ·
  decoy green `0.4,1.0,0.5` · cursed red `1,0.22,0.13`.
- **Ring replacements are diegetic:** weak-points = diamond/crosshair glyphs you aim at (not haloes); lock-on = converging
  L-corner brackets; stacks = pips/glyphs in a body zone; hazard boundaries = crackle sparks + interior haze / spiral
  streak-arms / directional gradients (readable for dodging, never a clean circle); slows = desaturated ice-blue body cast.
- The single implementation is `drawStateRimA` + `stateRim` (`js/game.js`); the audition flag is retired.

---

## 5. Faction & owned-entity language

**Law: CYAN HEART, NOSE UP.** Every player-summoned entity keeps its GOD body color and gains one unfakeable engine marker.

| | Owned entity | Hostile mimic (Apostate) |
|---|---|---|
| Heart | player-cyan CORE gem `0.7,0.95,1` (the player's own hitbox render), 3Hz breath | RED `1,0.2,0.3`, harsh 12Hz flicker |
| Orientation | nose-UP (rot 0; ±0.25rad bank on strafe; dive states aim at target) | nose-DOWN (rot π, diving at you) |
| Body | keeps god hue (Wukong gold, Loki green, Ares dread-red, Odin slate) | player hull + warm-magenta `1,0.2,0.45` |
| Extra | cyan engine trail | red threat chevron (NEEDLE) overhead |

- Route owned entities through `drawOwned()` tagged `{owned, ownerKit, life}`; mimics through `drawMimic()`. Fixes the
  confirmed collisions (Apostate clones vs Wukong orange, Apostate decoy vs Loki green, wraiths reading as enemies).
- **EXPIRY (universal, ruling 4c)**: `expireOwnedOnSwap()` fires on attack- OR special-god change → ALL owned entities
  RECALL (0.4s fly-up ~300px to player, GLOW implodes to the gem, pool-released). Kills the 7s orphan-clone lie; ravens'
  abrupt `length=0` clear also routes through recall.
- **Deception (sanctioned only)**: Apostate CLONES spawn instantly fake (red heart, nose-down). The Apostate DECOY wears
  the FULL friendly costume 0.6s, then CURDLES (heart cyan→red over 0.15s, nose swings down, chevron fades in) — a fair
  learnable tell (taste flag in OPEN CALLS).
- **Firing voice**: owned entities fire the player's gun voice at −12dB; mimics fire the enemy timbre. Sounds: summon =
  rising triangle 660→990Hz; recall = reversed 880→440Hz; mimic spawn = same rhythm inverted/dirtied (detuned square
  ~300Hz + chuff); decoy curdle = 880→622Hz tritone + ring-mod buzz.

---

## 6. Sound system

**Axis = the material you SEE.** 9 voices → 15 gods; pantheon adds only a register-pitch mult + a special-only reverb tint.
A god's shot and special are the **same material at two scales** (shot tiny/dry, special louder/longer/reverb-sent). No
melodic motifs on shots (mush at 35/s vs the ~2.6k lowpassed score). Code: 9 builder fns + one 15-row VOICE table + one
5-row PANTHEON table + a per-material minInterval/round-robin table. Wire `G.attackGod`→`SFX.shot()`, `G.specialGod`→`SFX.special()`.

| # | Material | Synthesis | Gods (hook) |
|---|---|---|---|
| 1 | ELECTRIC | saw + 80Hz ring-mod + hp-noise crackle ~50ms; SP crackle train | Zeus; Loki (+18c S&H warble) |
| 2 | KINETIC | sine sub 160→38Hz + lowpassed noise slap + 2ms click | Thor (doubleHit); Poseidon (+1.2k water); Wukong (wooden knock, +grain/clone) |
| 3 | BLADE | bandpassed metallic shing ~2.5k, −80c/pierce; SP 0.5s downsweep | Guan Yu |
| 4 | BEAM | sustained sine+saw thru resonant lowpass, rising while held | Ra (§2) |
| 5 | BELL | inharmonic 1/2.4/3.9× stack, ~250ms ring | Jade Emperor; Anubis (dark + gong-ping <50%); Heimdall (seam arpeggio + refract shimmer) |
| 6 | SERPENT | detuned dual-osc ±8c, continuous portamento + breath ~3k | Quetzalcoatl (ruling 2: serpent-on-shot correct) |
| 7 | BOW | plucked transient: 12ms pitch-flick + fast decay + arrow-zip noise | Artemis; Odin (double grain 40ms) |
| 8 | CHARM | soft sine chime + minor-3rd gliss + 5Hz tremolo, **no noise** | Aphrodite |
| 9 | FLUTTER | amp-gated flutter noise + low flap tone + peck tick | Ares (bespoke war-drum/growl overrides — §2) |

- **PANTHEON** register×/rev-send: OLYMPUS ×1.10/0.06 · ASGARD ×0.85/0.04 · KEMET ×1.00/0.10 · COURT ×1.08/0.14 · FIFTH
  ×0.92/0.08. reg multiplies base f0; rev applies to **specials only**.
- **Mix law (verbatim from sfx.js)**: 28ms shot gate; RR pitch `[0,−50c,−90c]` ±4%; shots DRY; shot peak clamped
  0.045–0.055; specials live-synth thru `hub(revSend)/sat()`, 60ms de-dupe. Per-material minInterval overrides for slow
  voices: KINETIC & BLADE = 50ms; BEAM exempt (Ra = one sustained oscillator, no per-shot).
- **COMMUNION STINGS** (5, on set-bonus only): OLYMPUS bronze major-arpeggio · ASGARD low forge/horn drone · KEMET
  filter-sweep-up 400→3k · COURT temple gong · FIFTH wind portamento.
- Reworked gods carry authoritative bespoke event cues in their kit sheet (Ares war-drum, Odin tiers, Loki lift, Ra beam
  ladder, Quetz coil) layered over the base material.

---

## 7. Cards & stars

**THREE-LINE CONTRACT** (universal, fits the ~180px gap): `[RARITY] / NAME + ★-track / ·REALM· / epithet / DESC / ▸HOW
(≤12 words) / ★-LINE`. DESC = the one-liner; ▸HOW = activation-or-stack fragment (drop the zone if none); ★-LINE =
concrete scaled quantity at current tier. SCALING/GENERIC cards render DESC + ▸HOW only (**no ★-line**). Only `levelA/levelS`
draw the full 5-node rail.

**HONEST-SPLIT star rule** (one sentence, all 15): *"attack star → your attack SIGNATURE; special star → your special
SIGNATURE. The base 3-stream is a fixed baseline you grow with ATTACK POWER."* Ladder unchanged **[1.0, 1.5, 2.25, 2.9,
3.5]** — no economy retune (base torrent stays on its own `atkDmg` curve; signatures were tuned against `attackR`).

- **Per-star SIGNATURE bloom**: +8% size / brighter core each tier on the **signature only** — every level-up is visible
  without authoring 15 stepped secondaries.
- **Three code fixes** (close invisible-level-up holes; the base stream is intentionally star-flat, NOT a hole):
  (1) ravens dmg `*= G.attackR`; (2) charmMissile dmg `*= G.specialR` + route charm duration through specialR; (3) confirm
  base stream at `game.js:1830` stays unscaled by attackR, Guan crescent keeps its `*attackR` (crescent REPLACES the stream).
- **STARLINE table** beside `GODS{}`: per god×slot `{qtyLabel, base, secondary}`. `starLine()` prints `★★★  ×2.25 <qtyLabel>
  & <secondary>` from `LADDER[tierOf(cur)]`. `tLevel()` prints now→next.

**DUO GATING (owner 2026-07-19).** A duo card may be OFFERED only when both hold:
1. **EQUIPPED** — each god of the pair occupies one of your god slots (attack / special / ultimate once
   ultimates ship). Per-duo `needSlot` still pins a mechanically-required slot (e.g. serpent duos need
   Quetz on special).
2. **INVESTED** — the run holds ≥1 additional boon from either god of the pair beyond the two slot
   transforms themselves: a star level on their transform, a god-tied mod, or that god's charm.
Duos are a reward for committing to a pairing, not a first-draft lottery. To-code: the duo offer path in
`run.js` (~323) gains an `investedIn(pair)` check (stars above base on the pair's slots + `G.mods` keyed to
either god + `G.charms.charm<God>`). Applies to all 26 duos.

**OFFER PATHING (owner 2026-07-19, binding on every current & future card type).** A god's FIRST offered
boon must be a slot transform — attack, special, or ultimate. Until that god holds one of your slots, every
other boon of theirs (mods, duo participation, star levels) is **locked out** of the pool. Already mostly
enforced (`modEligible` run.js:293 requires the equipped slot; duos gate on the pair; levels on the slot) —
this rule makes it doctrine: extend the same gate to the ULTIMATE slot when it ships, and any new god-tied
card type gates the same way by default. **EXEMPT: charms** — the relic family is deliberately ungated
(once-per-god-per-run, own weight mass) and stays outside upgrade pathing. Duo descs also need a re-anchor sweep — HUNTER'S
EYE / DEATH SENTENCE still say "crit" (→ PRECISION wording), WILD HUNT still assumes ravens-as-attack
(→ doom-bolts ×2 vs Terrified per §2 Odin), TWO THRONES / PEACH BANQUET reference the retired Heaven's
Verdict (→ re-point to IMPERIAL JUDGEMENT in the Jade amendment build).

**Generic-upgrade copy:**
- **ATTACK POWER** (SCALING): DESC "+15% attack damage." ▸ "Stacks — buffs your base stream, not signatures."
- **APEX** (GENERIC, rewritten): DESC "APEX — your APOTHEOSIS multiplier climbs one step." ▸ "Cap ×5 → ×6 (max ×8); +0.25
  each kill while golden." **Never** "HUBRIS ceiling" (collides with the ×1.0–2.0 HUBRIS skill meter) and **never** "×2→×3"
  (wrong numbers). `vcap` raises `G.up.multCap` (default 5, hard-cap 8) which caps `G.mult` the APOTHEOSIS score multiplier.
- **LEVEL-UP** (`levelA/levelS`): epithet "LEVEL UP"; DESC "ODIN ATTACK ★★☆☆☆ → ★★★☆☆"; ★-LINE "×1.5 → ×2.25 bolt damage";
  **rail** `1.0 · 1.5 · [2.25] · 2.9 · 3.5`.

---

## 8. Boss summons & entity viability

Two independent layers; neither is load-bearing alone (satisfies "bosses should summon, but that must NOT be the only fix").

**LAYER 1 — PER-KIT BOSS-MODE REROUTE (the real fix; works with zero adds).** One accumulator `e.dmgTithe += dmg` in
`damageEnemy`; unit = `maxhp*0.025` (rank-independent, ~40 ticks/fight; NAIL/weak-point damage counts). Each unit crossed
fires **continuous** kit events; the existing `bossEnterPhase(transition=true)` (~5–6×/fight, already cancels to gold) fires
**bursty** events.

| Kit | Boss-mode |
|---|---|
| WUKONG | first hit summons a clone; each tithe unit refreshes oldest clone +1.5s (cap 7s); segment-clear rolls a fresh clone |
| ZEUS FIELD (mod) | `spawnZapField` beneath the boss each tithe unit |
| ARES | +1 frenzy/segment-clear; frenzy decays 50% slower in any boss fight (build across the setlist) |
| ANUBIS | phase's final blow pays +50% segment cancel-gold + drops an apotheosis shard (execute→segment) |
| UNIVERSAL fallback | a phase-segment counts as ONE reward-kill for any un-wired kill-fed kit — fires its raw on-kill path once at 1× (Jade Judgement bolt window, Odin raven dive target…) |

**LAYER 2 — FICTION-GATED RETINUE (additive economy, NOT the mechanism).** `killEnemy(reward=true)` already wires every kit
for free. Shared spec: HP dies to ~0.3s of default fire; SHIP_POP tinted to boss palette; mirrored swoopHold from the boss
body, hold ~0.8s, ONE unaimed geometry beat, exit/die. **HARD CAPS: max 3 concurrent, 4s refractory, phase-gated; summons
carry NO boss HP** (can't wall or milk the segment floor). Materialize = RING implode + GLOW pop in boss hue + ~0.2s
spawn-tether. Reads as an ENTITY (dark body, health shimmer), never a bullet; loot-gold never worn by a threat (ART.md).

| Boss / phase | Retinue |
|---|---|
| **TALOS V — THE NAIL** (load-bearing) | **RIVETS**: 2 orbit the immune body r180, each an 8-ring/1.5s, respawn 4s — the ONLY thing feeding kill/damage-fed kits through the ~44s immune finale |
| TALOS II — Hurled Stones (flavor, cuttable) | **BRONZE SPLINTERS**: 20% of boulder-bursts calve 1 splinter (diveBrake, 5-pellet fan; cap 3) |
| **AMMIT II — Forty-Two Confessions** (grafted offload) | **THE ASSESSORS**: two counter-rotating jackal emitters (orbitPoint r~110) each fire **21** (=42); kill one → ring collapses to a lopsided 21 with a drifting gap, respawn 5s; killed-side shots gild to coins; MAG vs ROSE arcs, umbilical to boss |
| AMMIT IV — The Scales Tip | **UNWEIGHED HEARTS**: 1–2 heavy slow soul-hearts rise from the bottom; popping one drops the next heart-arcWall count by 2 |
| **MIDAS II — The Tribute** | **TRIBUTE BEARERS**: 2–3 amber bearers; killing one drops 3 real gold AND subtracts its vacuumed share from `e.hoard` (kill to STARVE the king); warm-amber body, never loot-gold |
| MIDAS III — The Gilded Court | **GILDED COURTIERS**: 2 nobles orbitPoint r200, single wheel-spokes, respawn 5s |

- Sound: one shared retinue MATERIALIZE cue (detuned triangle-pair, minor-third glide, pitched per boss bronze/shade/court);
  retinue death = popcorn pop a third above sector popcorn. Segment-clear layers each fired kit's one-shot over the phase
  gong. THE ASSESSORS earn one bespoke voice (square muzzle chirp vs AMMIT's sine body; death = pitch-bent zap + coin shimmer).

---

## 9. Engine mechanics (settled, ruling 4)

- **(a) PIERCE DEDUP.** Per-shot recent-hit memory: `s.hitList` (reuse array, `length=0` in `allocShot`; in `collideShots`
  skip `if s.hitList.indexOf(e)>=0`, push after hit). Pierce budget `maxHits=pierce+1` stays the per-shot lifetime cap on
  DISTINCT enemies. Kills the frame-rehit exploit (~55 fabricated DPS). Apply to the TALOS nail branch too. **Quetz/Guan Yu
  balance assumes this honest version.**
- **(b) AUTO-FIRE toggle.** Settings/pause option, persisted in `goldwake_meta`, fires as if Z held. **Default OFF.**
- **(c) KIT-SWAP HYGIENE.** Swapping attack/special god expires that kit's live entities (clones, ravens, hazards, decoy,
  wraiths) **immediately** via `expireOwnedOnSwap()` (§5). Universal rule.

---

## 10. Implementation order

**Pass 1 — Foundations (engine + faction + status).** §9 (pierce-dedup, auto-fire, kit-swap hygiene); §5 `drawOwned/drawMimic`
+ `expireOwnedOnSwap` recall; §4 the 4-zone status system + confuse deletion + field renames + weak/charm color split.
Cross-cutting; unblocks everything.

**Pass 2 — Kit reworks.** The 8 reworked kits: Artemis HUNT (Hunted brand, chain/sticky/splinter) + §3 PRECISION, Ares War-Heat, Odin NINE NIGHTS + Huginn&Muninn charm,
Loki PILFER, the three differentiated specials, Quetz CONSTRICTOR + COIL. Then bring the 7 unchanged kits up to code
(Poseidon/Guan Yu feedback, Anubis execute tell…). Heimdall THE BIFRÖST joins the reworked-kit list (owner 2026-07-18).

**Pass 3 — Sound.** §6 material-voice table + 9 builders + pantheon table + mix law; per-god bespoke event cues; Communion
stings; status apply-stings.

**Pass 4 — Cards & boss-adds.** §7 three-line template + STARLINE + the 3 star code-fixes + APEX/generic copy; §8 damage-tithe
reroute + universal fallback + retinues + Assessors.

---

## 11. OPEN CALLS

Implementation proceeds on the default; `[VARIANT]` calls get variant renders for Warren to pick; `[CONFIRM]` = taste
ratification, default proceeds; `[SCOPE]` = content-work confirm.

- **ULTIMATES (owner-ruled 2026-07-18): a NEW BOON CARD TYPE + APOTHEOSIS → DIVINE INTERVENTION.**
  Card kinds become transformA/transformS/mod/charm/**ultimate** (god-tied). The ultimate card TRANSFORMS the C-key
  burst slot (same pattern as attack/special slots). **DEFAULT BURST = DIVINE INTERVENTION** (renames APOTHEOSIS
  everywhere player-facing; legacy `vaunt` internals may stay): **two-beat staging, owner-ruled** — all enemy bullets
  FREEZE on screen (a held shimmer beat, ~0.3s) → then turn to gold (today it converts instantly; the freeze beat is
  new juice). First authored ultimate: **MANDATE OF HEAVEN** (Jade): same freeze → gild, then the gilded bullets
  **fire back at enemies** for heavy damage + bonus gold — a strict upgrade of the default's shape. Still to settle:
  charge economy, rarity/one-per-run, migration of per-attack-god burst riders into ultimate cards, first-wave god
  count. Rename + staging ride the post-Pass-2 amendment build (with Jade's kit). Touches §2 riders, HUBRIS economy,
  every "APOTHEOSIS" string.

- **Artemis** — [VARIANT] arrow accent (default silver-white body + moon-blue rim; a warmer read bends the cyan/white
  player-fire law). · [VARIANT] Hunted indicator (default tightening chevron vs orbiting shard). · [SCOPE] weak-point
  authoring into TALOS/AMMIT/MIDAS + elite spellcards (default acceptable; fallback = generic Marksmanship tier).
- **Ares** — [VARIANT] labrys head geometry + spin trail (2–3 treatments; double-axe silhouette, unmistakable vs Guan Yu). ·
  [CONFIRM] proximity source over graze (default proximity; graze stays HUBRIS's). · [CONFIRM] bands 260/440 +
  fire-not-required (default; watch corner-hug cheese). · [CONFIRM] war-drum mix.
- **Odin** — [VARIANT] rune-band glyph treatment on foes + doom-ignition flash (default gold
  up / steel-blue down). · [CONFIRM] raven scaling = continuous MEMORY (default). · [CONFIRM] drop 'shop rerolls half' (default drop).
- **Loki** — [VARIANT] stolen-bullet feel (default flip + reverse + gentle homing; pure-reverse-outward is cleaner on dense
  walls). · [SCOPE] DOPPELGANGER green-boss capstone (default DEFERRED — not built this pass).
- **Specials** — [VARIANT] the three silhouettes (Zeus column height, Artemis needle proportions, Aphrodite heart geometry).
  · [CONFIRM] Zeus 140px aim-lock vs pure-lane (playtest). · [CONFIRM] THE QUIVER ships now as a mod (default now).
- **Status** — [CONFIRM] keep SHAKEN as terror's boss-variant (default keep). · [CONFIRM] charm recolor to player-cyan
  (default acceptable — cyan = faction law). · [VARIANT] BURN placement (default UNDERFOOT vs shoulders) + WEAK color (default grey-violet).
- **Sound** — [CONFIRM] Loki = ELECTRIC + warble (default) vs a bespoke 10th glitch material. · [CONFIRM] Communion stings
  assume Pantheon Communion ships (default include).
- **Cards** — [CONFIRM] ratify HONEST-SPLIT: leveling ATTACK star grows the god SIGNATURE, NOT the base 3-stream (default
  yes; the alternative forces a full ladder retune + enemy-HP pass). · [VARIANT] signature-bloom +8%/star (eyeball at 5
  stars on a 200-bullet screen). · [CONFIRM] APEX exposes raw numbers ×5→×6 (default yes).
- **Boss summons** — [CONFIRM] AMMIT Assessors REPLACE her 42-ring (default replace vs additive-on-top). · [CONFIRM] Tribute
  Bearers alter the finale math — smaller hoard = smaller jackpot (default bless). · [VARIANT] shared materialize FX +
  Tribute Bearer amber-body-vs-gold-spill. · [CONFIRM] TALOS Bronze Splinters keep or lean-drop (default keep; Rivets non-negotiable).
- **Quetz** — [VARIANT] max-coil ring jade→hot-WHITE (default) vs jade→GOLD (Apotheosis-palette tie).
- **Ra** — [VARIANT] beam width A tightening-lance (recommended default) / B swelling-furnace / C countable-dial. · [CONFIRM]
  notches always-on (default) vs occluded-only. · [CONFIRM] audio detune-collapse + per-stage bell (default) vs chord vs
  both. · [CONFIRM] boss-never-cools (default yes — deliberately makes Ra strongest vs bosses).
- **Faction** — [CONFIRM] Apostate decoy 0.6s curdle (default keep; else instant-red). · [VARIANT] Wukong clone hue gold vs
  amber. · [VARIANT] Ares wraith treatment (cyan-heart-only vs +cyan trail).

**Closed by orchestrator rulings (were flagged, now settled):** confuse/Loki (ruling 1 — confuse dead, Pilfer replaces,
purple mirror-chevron tell dropped) · Quetz role (ruling 2 — CONSTRICTOR/attack, serpent voice on shot correct).

**Conflicts resolved beyond the rulings:** (1) Artemis **special** — attack rec's KILLING ARROW vs specials rec's THE LOOSED
ARROW: the dedicated specials record is authority → **THE LOOSED ARROW**, grafted + owner-amended: pierced foes Marked, first-struck becomes Hunted at full ramp.
(2) **MARKED tell** — specials rec proposed green chevrons, status rec proposed amber L-brackets: the dedicated status record
is authority → **amber L-brackets** globally (the specials rec itself flagged this open).

---

## 12. Art manifest delta (art/PROMPTS.md)

Every decision record self-certifies `artImpact: unchanged` — all kit visuals are procedural. Checking the four portraits
whose *kit identity* changed against what the prompts actually depict:

| Prompt | Depicts | Verdict |
|---|---|---|
| **#9 ARTEMIS** | silver bow + glowing marking-arrow nocked | **UNCHANGED** — bow + arrow are still the props of THE HUNT / THE LOOSED ARROW; mechanic changed, depiction didn't |
| **#11 ARES** | flanked by Phobos & Deimos wraiths + notched spear | **UNCHANGED** — wraiths = the still-current special; the spear covers the new War-Heat javelin→xiphos→doru ladder |
| **#15 LOKI** | shadow-twin decoy peeling off; venom-green accent | **UNCHANGED** — decoy = the still-current special; PILFER depicts no god-prop; green accent still matches |
| **#16 ODIN** | leveling Gungnir + Huginn & Muninn circling | **UNCHANGED** — Gungnir = the still-current special; ravens migrate attack→charm but stay an Odin motif; the heavy rune-bolt is spear-adjacent |

**Digest (updated 2026-07-18, owner call):** the original 32 prompts are still SAFE TO GEN unchanged — no portrait needs an
edit (Heimdall #12's horn-and-prism still covers THE BIFRÖST's refraction identity; Jade #20's drifting edicts still cover
the fan). But "no new painted asset is required" is **superseded**: the rework made several god weapons into big, low-count
signature objects, and those now have authored-sprite prompts. The manifest delta as written into art/PROMPTS.md:

- **§9 NEW — signature player-side sprites (14)**: projectile template #33 × 9 (Mjölnir, Gungnir, labrys, akontia, xiphos,
  doru bundle, edict tablet, Loosed Arrow, Ruyi Jingu Bang pillar-staff — the staff-shape fix) + owned-entity template
  #34 × 5 (raven, dread-wraith, storm-cloud, zhaoyaojing mirror, Sky Serpent head). Ares reds are sanctioned god-hue
  exceptions to the cool player law (§2/§5). Wukong clones + Loki Shadow-Twin = engine retints of the player ship, no gen.
- **§8 extended — 5 enemy rows (32.14–32.18)**: AMMIT field sprite (was a straight gap — TALOS/MIDAS/Apostate had rows,
  she didn't) + the §8-boss retinue: Assessor, Tribute Bearer, Gilded Courtier, Unweighed Heart. Rivets/splinters stay
  procedural (too small).
- **#30.10 edited**: Raven Quill relic icon → HUGINN & MUNINN twin-raven charm (matches the ravens' move to a charm slot).

All new sprites are **drop-in**: procedural draw remains live until each is wired (engine wiring is its own pass, after
the gens exist). The Apostate mimic costume (§5) remains procedural retint/orientation on existing hulls (#25 as-is).
