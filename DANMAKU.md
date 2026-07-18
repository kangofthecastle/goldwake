# HUBRIS — Danmaku Doctrine

The pattern-design standard. ART.md governs how the game looks; this governs how it
*shoots*. Reference class: Danmaku Unlimited 3, Crimzon Clover, CAVE. The failure mode
this document exists to kill: "a lot of bullets" fired individually at the player on
flat cooldowns. That is a shooting gallery, not a danmaku.

**Identity note.** HUBRIS borrows danmaku *craft* — pattern authorship, visual
flair, hectic density — not the danmaku *loop*. The gameplay loop is Jamestown ×
Hades: god-boon drafts, build synergy, the cancel-to-gold economy. Do not import
score-chaining, rank meters, lives/spellcard bonuses, or graze-scoring metas;
graze keeps feeding what it already feeds. When a danmaku convention conflicts
with the roguelite loop, the loop wins — the patterns exist to make the builds
feel incredible, not the other way around.

## The Three Laws

**1. Bullets form shapes, not noise.** The default enemy volley is *unaimed authored
geometry* — a ring with a gap, a mirrored arc pair, a snaking chain, a wall with a
lane. Aimed fire is the *accent*, not the base: at most one aimed element on screen
per beat, and it's fast and thin (needles) so it reads differently from the slow
geometry it threads through. Current code has this inverted (everything aims); flip it.

**2. Fire has rhythm.** Enemies do not drizzle on a cooldown. They fire in *beats*:
pose → windup flash (0.3–0.5s) → volley → rest. Groups syncopate — squadron A's
volley lands while squadron B winds up. Density on screen should breathe: crest,
gap, crest. If a screenshot at any moment looks the same as 3 seconds earlier, the
pattern has no rhythm.

**3. Two speeds minimum.** Every serious pattern layers a slow heavy element (big
ring-shape orbs, 120–200 px/s — the *terrain*) with a fast light element (needles,
380–520 px/s — the *pressure*). One speed = one dodge = boring. The player should be
reading slow geometry while flicking away from fast accents.

Speed is a full spectrum, not two constants: define named tiers (crawl ~90 / slow
~160 / mid ~260 / fast ~420 / whip ~560 px/s, pre-`gSpeed`) selected in the verbs
like size tiers. And use speed *dynamics* — the engine already integrates
accel/angVel: stall-and-bloom rings (flower), bullets that launch fast and decay
into drifting terrain, successive rings fired at stepped speeds so they interleave
into moving lattices, chasers that accelerate down a lane. A pattern whose bullets
all fly at one constant speed forever should be a deliberate choice, not the default.

## Pattern grammar (new Patterns verbs)

All are one-call emitters or tick-advanced like `P.spiral`. All respect
`gCount`/`gSpeed` and the freeze-gate readability rules in ART.md.

| Verb | Shape | Use |
|---|---|---|
| `P.ringGap(x,y,count,speed,{gaps,gapWidth,offset})` | ring with 1–3 missing lanes | zoning; the gap is the dodge, rotate `offset` across successive rings |
| `P.pulse(x,y,{rings,interval,...})` | 2–4 concentric rings, alternating shape/color, spawned over a schedule | boss beats, midship volleys |
| `P.arcWall(x,y,dir,arcWidth,count,speed,{laneAt,laneWidth})` | dense arc with one safe lane | screen-pressure; lane drifts between casts |
| `P.snake(x,y,dir,len,speed,{amp,freq})` | chain of bullets sharing a serpentine path (per-bullet phase offset on angVel sine) | the DU3 "ribbon" look |
| `P.crossfire(xL,xR,y,count,speed)` | two mirrored diagonal streams that cross mid-screen | flanker squadrons |
| `P.wheel(x,y,phase,arms,speed,{gapEvery})` | rotating spoke wheel, arms with periodic gaps | turrets, boss cores |
| `P.rain(count,{speed,drift})` | top-edge curtain, density varies sinusoidally so gaps drift | sector ambience under other patterns |
| `P.burstAimed(x,y,tx,ty,n,{telegraph})` | windup flash on the emitter, then a tight n-shot aimed needle cluster | the accent; always telegraphed |

Composition rule: a wave's pattern = 1 geometry verb + optionally 1 accent. A boss
phase = 2 geometry verbs (different speeds) + 1 accent. Never three geometries at once.

## Fire scripts (the architectural change)

Replace single `fireCd` on enemies with a **fire script**: a looping beat list.

```js
e.script = [
  { t: 0.0, fn: pose },          // stop/slow, windup glow
  { t: 0.4, fn: volleyA },       // geometry
  { t: 0.9, fn: volleyA },       // geometry again, offset rotated
  { t: 1.6, fn: accent },        // aimed needles, telegraphed
  { t: 2.6, loop: true }
];
```

Scripts tick in `update(DT)` (fixed-step, per engine doctrine). Squadron members share
one script clock with a per-index phase offset — that is what makes six ships firing
feel like one instrument. Keep the old `fireCd` path as the degenerate one-beat script.

## Movement grammar

Enemies move on *authored paths*, not just `vy` down or sine wiggle.

- **Swoop entries**: quadratic-curve in from off-screen edge, brake into a hold point,
  volley on the hold, exit along a mirrored curve. (Current darter has a crude version;
  generalize into a path helper any enemy can use.)
- **Formations**: a squadron = one path + per-index offset (trailing column, V, arc).
  Same model, shared script clock. Kill reward scales if you delete the whole formation
  before it exits.
- **Wheels**: 4–6 ships orbit a moving center point, firing spokes outward.
- **Weave-through**: cross the screen diagonally *behind* the fight, firing perpendicular
  snakes — makes the space feel deep.
- **Holds are sacred**: a held enemy firing geometry is the danmaku unit of meaning.
  Popcorn that fires while drifting fires *unaimed* only.

**The path book** — movement is authored from named, reusable paths (a small path
runner: sequence of eased segments — curve-to, hold, orbit, exit — any enemy can
run one, formations run one with per-index offsets). Ban the current defaults: no
enemy may spend its whole life on a straight `vy` drop or a bare sine wiggle.
Starting vocabulary, tuned like the pattern verbs:

| Path | Motion | Feel |
|---|---|---|
| `swoopHold` | curve in from an edge, brake to a hold, volley, mirrored exit | the workhorse |
| `sCurve` | deep S across the full width while descending | crossing traffic |
| `loop` | enter, full loop-de-loop, fire at loop bottom, exit | showmanship popcorn |
| `pendulum` | swing between two hold points, volley at each end | turret with life |
| `orbitPoint` | circle a (moving) center; formation = a rotating wheel | wheels |
| `diveBrake` | fast dive at the player's *former* position, hard brake, unaimed burst, climb out | aggression without aiming |
| `flankRail` | hug a side edge downward, strafe inward at a chosen depth, fire perpendicular | pincer pressure |
| `retreatReturn` | advance, fall back off-pattern when shot (not RNG — at hp threshold), return with a denser volley | enemies that react |

Mirror-symmetric pairs/quads running the same path are the cheapest "wow" in the
genre — default formations to mirrored spawns. Path speed follows the fire script:
slow into the beat, burst out of it; movement and shooting share one rhythm.

## Wave choreography

A wave is a 10–20s *arrangement*, not a spawn list. Each wave recipe declares:
opener (popcorn formation, establishes rhythm) → pressure (midships/turrets with
scripts, geometry on screen) → crest (both overlap for ~4s) → release (exit, gap
before next wave). Waves in the pool get a `song` shape, and successive waves in a
sector must alternate crest direction (left-anchored, right-anchored, center) so
sectors don't blur together.

Midships matter: every 2nd–3rd wave includes at least one large held enemy running a
2-geometry script. The DU3 screens are full of medium ships; HUBRIS currently jumps
from popcorn to boss with almost nothing between.

## Bosses

A boss fight is a *setlist*, not a stat bar. Every boss = **5–6 named phases**
(spellcard style), each announced on the HUD with the boss health bar segmented per
phase. Within a phase the boss runs **2–3 distinct attacks** on its fire script —
so a full fight shows 12–15 different attacks, and no two phases share a geometry
verb as their lead. Early phases may *cycle* their attacks; from mid-fight onward
attacks **layer simultaneously**: a wide unaimed geometry claiming area (rings,
walls, wheels) with an aimed attack threading through it (seeker bursts, tracking
lances) — the ring forces you to route, the aimed shot punishes routing lazily.
Never two aimed attacks at once (unreadable); never area-coverage alone past
mid-fight (walkable). The mix is the fight. Phase transitions are events: full bullet cancel to gold (feeds
the APOTHEOSIS economy), flash, name card, ~1s breath, then the new composition.
Escalate by *complexity*, not just density: early phases single geometry, mid phases
two-speed layers, late phases add the accent + a moving emitter; the final phase is
the boss's signature at maximum articulation. Movement escalates with it — bosses
run the path book too (holds, pendulums, screen-edge rushes between volleys), not a
fixed hover.

Illustrative setlists (implementer tunes; names announced on HUD):

- **TALOS** (bronze sentinel): I *Foundry Breath* — pulse rings on stomp beats;
  II *Piston Lances* — arcWall columns slamming alternate lanes; III *The Bronze
  Wheel* — rotating gap-wheel while pendulum-strafing; IV *Molten Veins* — snake
  ribbons + kunai accents; V *Colossus Falls* — wheel + lances layered, gaps
  tightening, emitter rushing the rails.
- **AMMIT** (devourer of hearts): I *Scent of Sin* — drifting rain + shard petals;
  II *The Jaws* — mirrored crossfire closing like bites; III *Weighing of the
  Heart* — alternating left/right arcWalls (the scales); IV *Heart-Seekers* —
  burstAimed accents through orb terrain; V *Devourer* — jaw arcs + seekers,
  boss lunging between bites; VI (final) *The Second Death* — everything at once,
  one drifting lane.
- **GILDED SOVEREIGN**: gold-lattice identity — interleaved ringGap sequences whose
  gaps spell a drifting lane, gold rain, wheel spokes; 6 phases as the run's finale,
  final phase a full-screen lattice with a single readable path.

## Bullet art & VFX (procedural, in-engine)

Bullets are the protagonist of the screen. The reference look (DU3/CAVE) is **not**
additive glow: it is an opaque glassy body with a near-black outline, a saturated
rim, and a white-hot core. Additive blobs can never pop against bloom — they add
into it and vanish. Structural changes:

- **Render pass**: enemy bullets draw in their own pass with premultiplied-alpha
  blending (or an equivalent dark-backing layer under an additive body) so outlines
  survive over the brightest crest. A soft additive halo may sit *under* the body.
  Acceptance test: freeze the frame at a full crest over a white explosion — every
  bullet silhouette still reads.
- **Sprite families** (procedural atlas painters, `#231A20` outline per ART.md):
  *orb* (glass ball: dark ring outline, saturated body, off-center white specular),
  *ring* (hollow, thick glass rim), *kunai* (oriented needle with edged body and
  bright spine), *shard* (oriented diamond/petal), *pellet* (small hard dot, bright
  rim — the popcorn filler), *star* (4-point spark, slow spin — rare accent/flair).
  Six families, each with a real silhouette; shape = role (orbs slow terrain, kunai
  fast pressure, rings zoning, shards pattern flair, pellets density, stars garnish).
- **Size tiers within families**: at least S / M / L per family (orbs also XL for
  boss anchors, ~2.5× M). A pattern that reads mixes tiers *deliberately* — e.g. an
  XL anchor orb ringed by M orbs with S pellets threading between. Size is
  information: bigger = slower = terrain, smaller = faster = pressure. Never a
  screen of uniform mid-size dots — that's the current look and it reads flat.
  Tier picks live in the pattern verbs (`o.tier`), not ad-hoc radii at call sites,
  so the vocabulary stays consistent across waves.
- **Size**: danmaku bullets are big. Visual radius up ~1.6× current; hitboxes
  unchanged (the gap between visual and hitbox is the graze feel).
- **Life**: slow rotation on orb/ring texture (inner pinwheel), subtle pulse on rims.
  Muzzle flash on the emitter at windup — the telegraph *is* part of the art.
- **Explosions**: layered, not a glow puff — thin expanding shockwave ring + radial
  spark needles + fast-decay core flash + brief embers. Scale layers by enemy tier;
  screen-shake reserved for mid+ kills so it stays meaningful.

## Scale doctrine

Everything on screen is currently under-scaled for the genre (baselines on the
1080×1920 field: player ship 74px visual, base player shot 34px, standard enemy orb
~22–24px, popcorn enemies ~52–62px). Targets:

- **Player ship**: ×1.35 visual (~100px, ≈9% screen width — a presence, not a cursor).
  Hitbox UNCHANGED and tiny; in danmaku the ship is big and the hitbox is the core
  gem. Make the core visibly rendered so the player learns what actually collides.
- **Player fire**: ×1.8–2.2 visual — a bright torrent that owns a lane, with core +
  trail, like the reference blue streams. Hitbox may scale generously (player-favored).
- **Enemy bullets**: ×1.6 visual per the bullet-art section; hitboxes unchanged
  (graze gap).
- **Enemies**: popcorn ×1.25–1.4; the new midship tier is large by design (200–320px);
  bosses already sized.

Tune the final numbers by screenshot against the DU3 references, not by formula —
the acceptance bar is a paused frame that reads at a glance like the genre.

## Tuned variety, not randomness

Variety comes from a curated pattern book, not RNG. Every wave recipe and boss phase
is a *named, hand-tuned arrangement*, playtested at 60Hz. Randomness may choose
**which** arrangement plays, its anchor side (left/center/right mirror), and phase
offsets — it must never generate geometry. No random bullet directions in new
content; retire `P.spray` from enemy fire (god VFX may keep it). If a pattern needs
unpredictability, author it: rotate the gap, drift the lane, alternate the mirror.

## Level design: the sector is the composition

The arrangement principle scales up: a sector is an authored difficulty arc, not N
rolls on a flat wave pool. Wave slots have **roles**, and RNG fills each slot only
from arrangements *tagged* for that role and sector — runs stay varied, the arc
stays authored:

1. **Opener** — light mirrored formation, states the sector's motif.
2. **Build** ×2–3 — standard arrangements, alternating anchors.
3. **Feature** — midship/elite centerpiece.
4. **Breather** — short, sparse, gold-heavy; the valley that makes the next crest
   read. Mandatory: density must breathe at the sector scale, not just inside waves.
5. **Crescendo** — the sector's densest arrangement, previewing the boss's lead verb.
6. **Boss.**

Each sector leans on a distinct subset of verbs/paths/tiers so sectors feel like
different songs: Sector 1 teaches (single geometries, wide gaps, slow tiers);
Sector 2 combines (two-speed layers, flank paths, first snakes); Sector 3 is full
articulation (layered compositions, speed dynamics, tightest gaps). Escalation
across sectors = complexity first, numbers second — same law as rank.

## Environments: the world under the fight

Reference danmaku are never fought over a void — there is a *place* scrolling
underneath: hull plating, station architecture, coastlines, debris weather. The
environment is part of level construction, same as waves:

- **Each sector is a place** with an environment identity (palette, architecture,
  ambient motion) matching its pantheon/motif and its verb lean — the sector should
  be recognizable from a background-only screenshot. Storybook painted backdrops
  (ART.md, Codex prompts 24–26) set the identity; in-engine parallax makes it live.
- **Parallax layers** (2–3): deep field (slow), structure layer (mid — hulls,
  temples, colonnades drifting past), near-debris/particle weather (fast, sparse).
  Procedural now with drop-in slots for painted layers later, same pattern as
  sprites.
- **The background is choreographed with the slot arc**: opener reveals the place;
  feature waves get a set-piece (a structure or huge silhouette crossing under the
  fight); breathers let the environment breathe too (brightest, calmest moment);
  crescendo darkens/accelerates the layers; the boss arrives *from* the
  environment, announced by it (shadow first, then the fight).
- **Readability is law**: the environment loses every conflict with bullets.
  Ground layers stay in the dim band (`#05080b` doctrine, low-saturation), never
  additive-bright, never in the enemy warm/magenta bullet band; big set-pieces
  dim further while a crest is live. The freeze-gate test includes the background.

## Music: the level's pulse

There is currently no music (sfx.js is one-shot synth SFX only). Build a procedural
WebAudio score — same doctrine as sprites/backdrops: synth now, drop-in slots for
authored audio later.

- **Each sector has a theme** in its environment's identity (mode, tempo, timbre
  match the pantheon/place — the sector should be recognizable eyes-closed). Title
  and each boss get their own; boss themes escalate with phases.
- **Layered stems, driven by the slot arc**: pad/drone base, pulse layer, full-kit
  crest layer. Breathers strip to the pad (the calm is audible), builds add pulse,
  crescendos and boss phases run the full stack. Transitions crossfade on wave-slot
  boundaries, never mid-phrase hard cuts.
- **The loop's moments get stings**: APOTHEOSIS opens the filter / lifts the key
  for its duration (the payday should *sound* golden); boss phase transitions get
  the name-card hit; pause ducks everything, the shop is its own quiet variant.
- **Mix law**: gameplay SFX carry information (hits, cancels, warnings) — music
  never masks them; keep the score mid-low band and give SFX the top. Music clock
  is real-time WebAudio scheduling (not the fixed-step sim), paused/ducked with
  game pause.
- **Optional, if cheap**: expose the beat clock so wave scripts can quantize wave
  starts/windups to bar boundaries — choreography that lands on the beat reads as
  intentional even when nobody can say why.

## Damage economy

Danmaku choreography and roguelite damage scaling are in tension: an over-curve
player can delete emitters before a pattern exists. Resolve it by role, not by
nerfing the player:

- **Popcorn is rhythm, never a wall**: dies to a breath of the torrent (≤ ~0.3s of
  focused fire) at *any* power level. Its job is kill-cadence and formation
  spectacle, so its HP never scales far.
- **Midships/elites carry the HP budget**: tuned to survive roughly 60–75% of their
  arrangement under expected on-curve DPS for that sector — the pattern gets its
  stage time, and killing the carrier early is earned, not default.
- **Enemy HP tracks expected player growth** (sector, rank, drafts taken), not flat
  multipliers. Power growth should buy *pace and overkill spectacle*, not skipped
  choreography; a far-over-curve player shreds — let them, the next sector catches it.
- **Interruption is the reward**: killing an emitter ends its future fire but never
  despawns bullets already in flight (no free screen-clears from popcorn kills); a
  midship death cancels *its own* remaining pattern to gold as an explicit payoff.
- **APOTHEOSIS is the danmaku dividend**: cancel-to-gold means the denser the
  screen, the bigger the payday. Tune arrangements so crests are the natural
  APOTHEOSIS moment — the economy must reward sitting in the sauce, not waiting
  it out. Boss phase transitions (full cancel) are scheduled paydays on the same
  curve.
- **Bullets are the threat**: patterns kill, bodies bump. No arrangement may deal
  unavoidable damage — the freeze-gate lane rule applies at every crest, and any
  contact damage stays a minor, readable penalty rather than a hidden killer.

Boss phase HP segments follow the same law: sized to expected sector DPS so each
spellcard gets its stage time, with a generous timeout that advances the phase
anyway (no stalemates) — details in the boss section, implemented in pass B.

## Score as homage: the HUBRIS meter

A light tribute to the genre's score culture that pays out in the loop's own
currency, not a parallel one. Skill = flying closer to danger than you need to —
which is the game's title.

- **HUBRIS meter**: a small multiplier (×1.0 → ×2.0 in steps) on all gold earned.
  Built by graze, point-blank kills, and formation wipes; taking a hit knocks it
  down one step (never to zero — no chain-drop despair). It makes the skill loop
  and the economy the same loop: the way you get rich is the way you show off.
  APOTHEOSIS cashes its cancel-gold at the current multiplier — build hubris in
  the crest, then cash the crest.
- **Named skill events**, announced small with a gold sting: FORMATION WIPE (whole
  formation before exit), PHASE SEIZED (boss phase beaten before its timeout),
  UNTOUCHED (wave cleared hitless). Homage to spellcard captures without the
  scorekeeping.
- **Run tally**: end-of-run (win or death) arcade tally screen — waves, grazes,
  wipes, phases seized, peak HUBRIS — folded into one final number persisted as
  best-in-meta (localStorage). A high score on the title screen, because the
  genre deserves the nod.
- **Bounds (binding)**: no chain timers, no rank meter, nothing gated behind score,
  HUD presence stays small (meter near the gold readout). It flavors the economy;
  it never becomes the game.

## Rank & sector escalation

Rank raises pattern *complexity first*, numbers second: higher sector unlocks extra
script beats, tighter gap widths, faster offset rotation — then +count/+speed. Never
escalate by making aimed fire more frequent; that's the tame-ification vector.

## Readability guardrails (binding, from ART.md)

- Freeze-gate: any paused frame must show parseable shapes with clear dodge reads.
- Enemy bullet families stay warm/magenta band; shape = role (ring-orbs slow,
  needles fast, rounds spiral). Never recolor per-wave for variety's sake.
- Unavoidable-look moments (walls) always carry a visible lane; gap ≥ 3.5× player
  hitbox diameter at spawn distance.
- Bullet pool must absorb worst-case composition (crest of wall + snake + accent +
  player shots) without allocs; verify pool headroom in the smoke test.
