# Art standard: Gilded Myth — Two Layers

HUBRIS is a portrait (1080×1920) neon-additive bullet-hell roguelite. Its art
lives in two layers that never blur into each other. This document governs both
and, on every rule, says which layer it binds.

- **COMBAT layer** — bullets, ships, enemies, bosses, hazards, VFX, the Vaunt
  pulse. Additive neon: *light, not paint*. Rendered on WebGL2 with additive
  `ONE,ONE` blending, threshold+gaussian **bloom**, and a chromatic composite,
  over a **pure-black clear**. No ink outlines, no paper grain, no painted
  texture on anything that moves in combat. Ever.
- **STORYBOOK layer** — boon-card god portraits, title art, sector cards,
  pantheon emblems, shop dressing, backdrops. This is where the *Hallowed
  Storybook* painting style lives: painted planes, a warm near-black contour,
  restrained grain, gilded-myth iconography.

**AUTHORED COMBAT SPRITES (third clause).** Combat entities may be authored or
generated images — but only if they are built to live *inside* the additive
field. A sprite obeys combat law, never storybook law: **self-luminous rim-glow
in place of the `#231A20` ink outline** (ink outlines are STORYBOOK-only),
transparent ground, **no paper grain**, silhouette readable at actual in-game
size (the player ship renders ~60–80px on the 1080-wide field; popcorn smaller).
The **faction color law is absolute**: player ship = cool cyan/white family;
enemy sprites = warm/hostile family carrying their archetype accent. The
**center of the player ship stays visually quiet** — the bright hitbox dot is
drawn separately by the engine and must read on top of it. Painted matter is
allowed on a sprite only as **dark mid-tone body planes**; the read comes from
the glow rim. If an authored sprite needs an outline, a texture, or a second
look to parse, it is a storybook asset in the wrong layer — redesign it.

**The bridge.** Two things unify the layers: the **shared palette anchors**
(§4) and one sentence — **illustrated matter, luminous energy.** Anything that
depicts a *god, place, or relic* is painted (STORYBOOK). Anything that depicts
*energy, danger, or gameplay* is additive light (COMBAT). When in doubt, ask
which of those two a pixel is, and obey the matching layer.

---

## 1. Core visual promise

**(Both layers.)** Every screen should feel like a gilded myth-scroll torn open
mid-apocalypse: sacred illustration lit from within by a firestorm of neon
danmaku. Not grimy, not gore — **reliquary, not charnel-house**. Draw from
temple, tomb, frieze, runestone, and imperial scroll; never generic skulls or
splatter.

Three promises, in priority order:

1. **Sacred, not grimy.** Gods and places are treasures — burnished, ceremonial,
   made of gold-leaf, lapis, jade, obsidian, carved stone and cold iron.
2. **Human scale against impossible scale.** A small, legible ship against
   immense divinity: a god's hand, a temple gate, a serpent that fills the sky.
3. **Beautiful at rest; legible in chaos.** The STORYBOOK layer may be intricate.
   The COMBAT layer, and every readability rule in §7, always wins when bullets
   are on screen. Combat information is never sacrificed to illustration.

---

## 2. Shape language

**Ships & player (COMBAT).** The player ship reads as a single crisp additive
silhouette with a bright center dot — that dot *is* the 4px hitbox and must
never be visually buried. Identify allied fire and clones by that same cool
silhouette family. No ink outlines; shape is carried by luminance falloff — or,
on an authored sprite, by its self-luminous rim (doctrine, third clause).

**Enemies & bosses (COMBAT).** Sharply distinct additive shapes — spires, wings,
hooks, coils, shields, slabs. Never "same hull, different tint" as the primary
tell. The roster reads by shape first: AEGIS shield-plate, WEAVER tether,
GILDED MIMIC (masquerades as gold — deliberately), CARRIER hulk, BLINK moth.
Bosses get **one iconic silhouette + one secondary motif**: TALOS — bronze
sentinel ring + molten core, with a single glowing ankle-nail weak point in his
finale; AMMIT — tri-beast coil + tipped judgment scales; MIDAS (the gilded king)
— gaunt crowned silhouette + a heaped, hungry hoard dragging at his feet.

**God portraits, emblems, cards (STORYBOOK).** Slightly warped, hand-drawn
geometry; straight lines are rare and purposeful. Each god must be knowable as a
**black silhouette + one iconic prop**: Zeus/bolt, Artemis/bow,
Ra/solar-disc, Anubis/scales, Odin/spear-and-ravens, Thor/hammer, Wukong/staff,
Quetzalcoatl/feathered coil.

**Hard silhouette gate (both layers).** If a combat unit cannot be recognized as
a flat shape at **15% of screen height**, redesign it. If a god portrait cannot
be told apart by **accent color + one prop** at boon-card size (**306×470
logical**, thumbnail-small on screen), redesign it.

---

## 3. Linework and rendering

**COMBAT layer.** No ink linework at all. Procedural forms are pure emissive
gradients from the atlas: light centers, saturated rims, transparent falloff.
Authored sprites (doctrine, third clause) carry their edge as a **self-luminous
rim-glow** around dark mid-tone body planes — never a stroked contour. Never
ink-outline a bullet, ship, or FX — additive over black does the drawing. Never
apply grain or paper texture to anything in the playfield.

**STORYBOOK layer.** Use a **warm near-black outline, `#231A20`** — never pure
black (pure black is the COMBAT layer's exclusive floor). Outer contour = **3×**
the weight of interior lines. Interior detail *suggests* form; do not trace every
edge. Lighting is painted in **broad planes** — no glossy realism, no airbrushed
plastic gradients. Add **restrained** paper/gold-leaf grain to painted surfaces
only; never to type, iconography, or anything that will overlay live combat.

---

## 4. Color system

Additive neon needs darkness. Everything is engineered so glowing marks read
over a near-black field.

**Shared palette anchors (both layers) — the bridge colors:**

| Role | Hex | Use |
| --- | --- | --- |
| Base (near-black) | `#05080b`–`#0a0f14` | STORYBOOK backdrops; COMBAT clears to true `#000`. |
| UI cyan | `#5fe6ff` | HUD, menu chrome, player-owned energy. |
| Gold | `#ffd766` | **Sacred currency** — gold, loot, Vaunt, duo cards, epic borders. |
| Danger red | `#ff5a6e` | Enemy fire, warnings, GAME OVER. |
| Dim teal | `#6fa9b8` | Secondary text, quiet dressing. |
| Ivory | `#e8f4f7` / `#bfeaf2` | Common-tier text, neutral highlights. |
| Rarity borders | common `#e8f4f7` · rare `#7fd0ff` · epic `#ffd766` | Card rims. |

**Per-pantheon families (STORYBOOK) — never mix two traditions in one image.**
Accents are the god colors from `Run.GODS`; use them as the luminous accent
against that pantheon's base/midtone.

| Pantheon | Tradition | Materials & motifs | God accents (from `Run.GODS`) |
| --- | --- | --- | --- |
| **OLYMPUS** | Marble frieze, black-figure pottery | Laurel, column, terracotta, sea-foam, veined marble | Zeus `#9fd8ff` · Artemis `#b6ff5a` · Aphrodite `#ff77c8` · Ares `#ff5a6e` |
| **KEMET** | Papyrus & tomb-wall painting | Flat profile poses, gold-leaf on lapis, hieroglyph bands, sun-disc | Ra `#ffe89a` · Anubis `#e8c46a` |
| **ASGARD** | Runestone knotwork, carved wood | Interlace, cold iron, weathered timber, frost, spear/raven/hammer | Loki `#8cff5a` · Odin `#cfd6e0` · Thor `#8fb4d8` · Heimdall `#ffe3c2` (dawn-gold; horn + prism) |
| **CELESTIAL COURT** | Ming court scroll painting | Gold-on-jade, cloud bands, imperial seals, edict talismans, judgment curtain | Wukong `#ff6a3d` · Guan Yu `#3be089` (crescent blade, Red Hare) · Jade Emperor `#c99aff` (edicts, imperial violet) |
| **FIFTH SUN** | Codex glyph flatness | Feathered serpents, obsidian, turquoise, stepped glyphs, flat blocked color | Quetzalcoatl `#5affc0` |

(Guan Yu and the Jade Emperor are color-reserved; when they ship, hold these
accents so their cards land beside Wukong without re-theming.)

**Combat color LAW (COMBAT layer — non-negotiable, the engine already obeys it):**

- **Player attacks** — a cool **cyan/white** family. Everything you own reads cool.
- **Enemy attacks** — a single high-contrast **warm/magenta/red** danger family.
- **Interactables & loot** — **gold or ivory**, *never* enemy-red. Gold is sacred
  currency; it must never read as a threat, and a threat must never read as gold
  (the GILDED MIMIC weaponizes exactly this — it is the one sanctioned exception).
- **Boss "unavoidable" attacks** — reserve a **white-hot core + danger-color rim**.

**Sector-affix mood (STORYBOOK backdrops only).** Affixes may tint the backdrop
and card dressing but **never** the combat law: GILDED — warmer gold wash;
SWARM — cooler, busier midground; DENSE VEIL — deeper, hazier near-black;
VOLATILE — ember flecks in the backdrop; NIGHT MARKET — lantern-gold pools.
Player fire stays cyan and enemy fire stays warm under every affix.

---

## 5. Characters (god portraits)

**(STORYBOOK layer.)** Faces read in **2–3 marks**: eyes, brow, mouth/nose
shadow. Costume mixes three things:

1. a **humble material** (cloth, leather, patched bronze),
2. **one mythic marker** drawn strictly from the god's own pantheon tradition
   (§4) — halo-disc, relic, divine weapon, ceremonial mask,
3. **one accent** — the god's `Run.GODS` color, and nothing else fights it.

Favor **imperfect asymmetry** — a dropped pauldron, uneven hem, chipped gold-leaf,
mismatched greaves. No pristine fantasy armor; everything shows a story. A portrait
must survive at boon-card size: silhouette + prop + accent carry it before any
face detail resolves.

---

## 6. Animation

**COMBAT layer.** Motion is danmaku, so restraint is the whole discipline —
constant motion is visual noise. Build enemy actions in three beats: **calm
anticipation → violent readable action → held recovery**. Telegraphs hold a
**stable shape** before firing (see §7). Use **2–4-frame impact holds** on major
hits, with a *very brief* screen shake only on **player-relevant** impacts.
Displacement gods (Thor, Terror) get real spring-damped lurch — but the
bullet field stays readable through it.

**STORYBOOK layer.** Card and title art are near-still; favor strong single
keyframes and gentle idle drift (a slow bloom pulse on the accent, a breathing
halo) over animation. Never animate a portrait so hard it competes with the
playfield behind a frozen menu.

---

## 7. VFX and bullet-hell readability

**(COMBAT layer — the hard gate. This is where the style survives gameplay or
collapses.)** Every hazard needs a **clear source, a visible trajectory, and a
distinct impact/end state.**

- **Telegraphs** hold a **calm, stable shape** before firing — do not flicker or
  aggressively pulse a telegraph.
- **Projectiles** are simple graphic shapes — beads, leaves, blades, tears,
  flames, feathers — never noisy particle mush. Keep **centers light, rims
  saturated** so the collision space is visually intuitive.
- **Portrait discipline.** The field is tall and narrow; threats mostly descend.
  Keep vertical lanes readable; never let a wide backdrop element imply a false
  safe lane.
- **Backdrops stay near-black and desaturate under density.** Any STORYBOOK
  backdrop bleeding into the playfield must dim/desaturate as bullet count rises.
  **Grain never enters the playfield combat area.**
- **The one-second freeze-frame test.** Freeze a busy encounter: a new player
  must identify **player, enemy threats, safe floor, boss, and loot within one
  second.** If not, cut backdrop detail or bullet-shape noise until they can.

---

## 8. Environments & backdrops

**(STORYBOOK layer, composited behind COMBAT.)** A sector is a continuous
geographic journey through **three authored destinations**, not a single
near-black texture with different decoration on top. The full-field plates
loaded as `sN-scene1`, `sN-scene2`, and `sN-scene3` are the primary environment
contract. The old `deep / structure / debris` parallax set may remain as
fallback and atmospheric support, but it must never replace destination art.

Use *Jamestown* as the pacing model: the camera advances at a steady physical
speed while the route itself supplies novelty. A new place is earned through
travel and staging, never announced by accelerating or shoving the whole world.
At runtime the three plates are laid into one physical vertical strip with broad
feathered overlaps. The whole strip advances through the viewport at one capped
world speed; wave progress only unlocks more route. There is no full-frame
dissolve, crop-pan, wipe, jump cut, or fast-forward between places. Plates are
clamped rather than tiled. Never re-enable UV wrapping for destination art.

Each sector has a legible route:

- **SECTOR 1 — THE BRONZE COAST / TALOS:** shattered fleet graveyard →
  flooded bronze colonnade → volcanic Talos forge-island.
- **SECTOR 2 — THE RIVER OF NIGHT / AMMIT:** dead-reed delta → processional
  avenue of kings → monumental hall of scales.
- **SECTOR 3 — THE GILDED COURT / MIDAS:** suspended cloud garden → jade
  causeway → stacked imperial throne terraces.

Those destinations must be unmistakably different in silhouette, floor
material, side architecture, weather, and accent palette while still sharing
geographic connective tissue with their neighbors. The bottom of one plate
should plausibly lead toward the top of the next. The level arc controls when
each destination appears:

- **opener:** establish destination one and its traversal language;
- **build:** introduce route-specific side masses and weather;
- **feature:** pass one memorable environmental set-piece at normal speed;
- **mid-level arrival:** destination two becomes fully readable;
- **breather:** provide the clearest scenic view and widest visual rest;
- **crescendo:** enter destination three with greater scale and danger;
- **boss threshold:** arrive at a specific arena belonging to destination three.

Backdrops are allowed real color and readable ground. Do **not** reduce the
world to different shades of black. Keep values below projectile cores, but use
deep teal water, lapis stone, oxidized bronze, ember orange, jade, violet cloth,
papyrus ochre, and other sector-specific mids so the player knows where they are
at a glance. The middle 45–50% remains compositionally quiet for play, but it is
still a material surface—not an empty void.

- Build from clean, confident color planes and a hierarchy of major silhouettes.
  Richness comes from **meaningful object and action marks**: oars cutting white
  wakes, a hull seam, a chipped column, grouped reeds, banner folds, court
  inlays, or a few broad ripples. Do not use blanket texture as a substitute for
  art direction.
- Prefer flattened stage-like depth, slightly warped silhouettes, matte painted
  planes, and the STORYBOOK contour law from §3: a warm near-black outer contour
  roughly 3× the interior line weight. Avoid clean vector geometry and avoid
  pseudo-3D isometric-diorama rendering.
- The quiet combat channel should contain one broad, uninterrupted material
  plane with only a handful of low-contrast current, fissure, or inlay marks.
  Edge landmarks use the same clean-plane and selective-detail law as their
  destination plate. Give them strong silhouettes and a few meaningful seams,
  chips, bands, inlays, or folds; do not switch back to dense material rendering
  merely because they sit in the foreground. Their density still falls away
  decisively before the combat channel.
- Avoid cinematic matte-painting density, glossy 3D materials, photoreal
  micro-texture, global grain, all-over mottling, full-surface scratches, tiny
  repeated machinery, volumetric clutter, and busy particles.
- Foreground elements are used sparingly and never conceal enemies or bullets.
- A physical foreground landmark constrains **player movement only**. It never
  intercepts player fire, enemy fire, or boss fire, and its own scroll never
  pushes or snaps the player; collision only rejects movement into its complete
  rectangular no-go volume. That exact volume must be visibly outlined while it
  is on screen.
- Treat sacred imagery with **specificity** — borrow structure and symbolism from
  **one** chosen tradition (§4), never a magpie mix of "cool" symbols.

**Environment style north star.** Aim for the graphic, hand-drawn mythic clarity
of *33 Immortals* without copying its specific designs: flattened stage-like
depth, bold silhouette shapes, restrained interior linework, and confident
color blocking. Its lesson is clarity and authored shape—not darkness.

---

## 9. UI

HUBRIS's UI is currently canvas-drawn text and cards (see `js/run.js`). The
target look adapts the gilded-myth vocabulary without demanding a rewrite: think
**cloisonné, not parchment** — burnished metal frames, enamel-in-gold panels,
seal-stamps, edict talismans, stained-glass geometry rendered as flat
neon-on-panel.

- **UI stays flatter and crisper than illustrated art.** Neon-cyan chrome, gold
  accents, semi-opaque near-black panels (`rgba(8,16,22,0.92)`), rounded rims.
- **Body text is modern and readable** — a clean monospace/sans, never a
  decorative face. Legibility beats flavor for anything the player reads under
  pressure.
- **Icons read as silhouettes first**; add texture only after the mechanic is
  clear.
- Rarity is carried by border color alone (§4): common ivory, rare cyan, epic
  gold; duo cards get the rainbow rim + gold bloom. Keep it consistent — the
  border *is* the rarity language.

---

## 10. Codex operationalization

Art is generated by OpenAI Codex from text prompts, so every asset ships as a
filled-in template. **State the layer.** Codex produces **STORYBOOK** assets
(portraits, cards, emblems, backdrops, title art) and, under the third clause of
the doctrine, **AUTHORED COMBAT SPRITES** (player ship, enemy hulls, and — since
the 2026-07-18 kit rework — **signature projectiles and owned entities**:
Mjölnir, Gungnir, the ravens, the labrys, edict tablets and kin; see
`art/PROMPTS.md` §9) — rim-glow, transparent ground, faction color law, no ink,
no grain. Dense bullet streams, telegraphs and FX remain procedural in
`js/gl.js` and never go to Codex.

### 10.1 Prompt template

```
SUBJECT:      <who/what — one god, place, or relic>
LAYER:        STORYBOOK (painted illustration)
PANTHEON:     <OLYMPUS | KEMET | ASGARD | CELESTIAL COURT | FIFTH SUN>
STYLE TOKENS: <that pantheon's tradition + materials/motifs from §4 — ONE tradition only>
PALETTE:      near-black ground (#05080b); accent <god hex from Run.GODS>;
              gold #ffd766 for any relic/currency; warm near-black outline #231A20
              (outer contour 3x interior weight); broad painted planes; restrained gold-leaf grain
COMPOSITION:  <framing, scale contrast, one iconic prop, silhouette-legible>
ASPECT:       <see delivery spec §10.3>
NEGATIVE:     no photorealism, no airbrushed/plastic gradients, no glossy 3D render,
              no mixed pantheon traditions, no pure-black (reserve #000 for combat),
              no outlines on energy/FX, no text, no busy particle mush, no grain in any
              area that will overlay live bullets
```

### 10.2 Worked examples

**A. Guan Yu boon-card portrait**
```
SUBJECT:      Guan Yu, jade-armored war-general, calm at rest, gripping a crescent
              guandao; the Red Hare's silhouette behind him
LAYER:        STORYBOOK
PANTHEON:     CELESTIAL COURT
STYLE TOKENS: Ming court scroll painting, gold-on-jade, drifting cloud bands, an
              imperial seal-stamp in the corner, flowing robe over practical armor
PALETTE:      near-black ground; jade-green accent #3be089; gold #ffd766 on the
              blade and seal; warm outline #231A20, outer contour 3x; broad planes
COMPOSITION:  waist-up, slight low angle for scale; crescent blade the one iconic
              prop; readable as silhouette + green accent at 306x470
ASPECT:       2:3 portrait, transparent or near-black background
NEGATIVE:     (template negatives) + no European/Norse motifs, no photoreal skin
```

**B. NIGHT MARKET sector backdrop (CELESTIAL COURT mood)**
```
SUBJECT:      a sunken imperial market-temple at night, lantern-lit, one colossal
              seated jade god as the landmark
LAYER:        STORYBOOK (backdrop, composites behind live combat)
PANTHEON:     CELESTIAL COURT
STYLE TOKENS: Ming scroll, cloud bands, gold-on-jade, hanging edict talismans,
              lantern-gold pools (NIGHT MARKET affix mood)
PALETTE:      deep near-black; low contrast; lantern gold #ffd766 pools; muted jade
              midtones; keep everything dim so neon bullets sing over it
COMPOSITION:  large dark masses, one central landmark, clear vertical lanes for a
              portrait playfield; nothing bright in the mid-playfield zone
ASPECT:       9:16 portrait (1080x1920)
NEGATIVE:     (template negatives) + nothing that implies a false safe lane, no
              bright foreground occluding the play area, must desaturate under density
```

**C. ASGARD pantheon emblem**
```
SUBJECT:      Asgard pantheon sigil — interlaced ravens around a spear
LAYER:        STORYBOOK (emblem)
PANTHEON:     ASGARD
STYLE TOKENS: runestone knotwork, carved cold iron, weathered timber grain
PALETTE:      near-black ground; iron accent #cfd6e0; a thread of gold #ffd766;
              warm outline #231A20, outer contour 3x
COMPOSITION:  centered, radially balanced, reads as a flat silhouette at small size
ASPECT:       1:1 square, transparent background
NEGATIVE:     (template negatives) + no Greek/Egyptian motifs, no color gradients
```

### 10.3 Delivery spec

- **Format:** PNG. Transparent background preferred for portraits/emblems;
  otherwise a **near-black** ground (`#05080b`) — every asset must composite
  cleanly over the game's near-black field. **Never deliver a pure-white or
  light-gray ground** (it will bloom-blow the additive composite).
- **Boon-card portraits:** 2:3 portrait, sized to sit in the **306×470** logical
  card; must be silhouette-legible at that size.
- **Sector backdrops:** 9:16 portrait, authored at **1080×1920**; dim, low
  contrast, one landmark, clear vertical lanes.
- **Pantheon emblems / upgrade icons:** 1:1 square, transparent, silhouette-first.
- **Title / end art:** 9:16, near-black ground, gold-forward.
- **Authored combat sprites:** 1:1 square, **transparent ground mandatory**,
  top-down orientation (nose up for the player ship); rim-glow edge, no ink
  outline, no grain; must survive at in-game size (~60–80px player ship,
  smaller for popcorn).
- Every delivered asset states its **layer** and **pantheon** in the filename or
  sidecar note, so nothing mixed-tradition slips into a card row.
