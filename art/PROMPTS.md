# HUBRIS — Codex Art Prompt Manifest

Generation prompts for every generated asset, built from `ART.md`.
Each prompt is **fully self-contained** — paste one fenced block into Codex with
no other context. Every prompt ends with the standard negative tokens and the
ground/delivery constraint. Sections 1–7 are STORYBOOK-layer painted assets;
Sections 8–9 are **AUTHORED COMBAT SPRITES** under the doctrine's third clause —
rim-glow instead of ink, transparent ground, faction color law. Dense bullet
streams, telegraphs and FX remain procedural in-engine and are never generated;
**signature projectiles and owned entities** (Section 9) are the sanctioned
exception (owner call 2026-07-18, BOONS.md §12) — the procedural draw stays the
live fallback until each sprite is wired in.

Sections: 1 title keyart · 2 pantheon emblems (5) · 3 god card portraits (15) ·
4 boss portraits (4) · 5 sector journeys (3 routes × 3 legs = 9) · 6 shop dressing (1) ·
7 charm-relic icon batch (1 template × 15 subjects) ·
8 combat sprites (1 player ship + 1 enemy template × 18 subjects) ·
9 signature player-side sprites (2 templates × 14 subjects).

## Batch run (one agentic Codex session, subagent-orchestrated)

**STEP ZERO — read `ART.md` (repo root) in full before generating anything.
This applies to the coordinator AND to every subagent it spawns** (put the
instruction in each subagent's task). ART.md is the binding art doctrine — the
two-layer system, the color law, the third-clause sprite rules, THE DETAIL
BUDGET. The fenced prompts below are self-contained so a block can be pasted
into a bare image model, but an agentic session does more than paste: it
judges outputs, rejects, and re-gens — and it cannot do that without the
doctrine loaded. (This step was missing from the first run; the boss/elite
sprites came back over-detailed because no one was holding ART.md while
judging them.)

To generate the whole manifest in one session: the top-level session acts as
**coordinator only** — it does not generate images itself. Spin up **one `sol`
subagent per batch, on high reasoning effort, all batches in parallel**:

| Batch | Scope | Images |
| --- | --- | --- |
| A | §1 title + §2 emblems | 6 |
| B | §3 god portraits | 15 |
| C | §4 boss portraits | 4 |
| D | §5 sector journeys (3 legs each, SEQUENTIAL with reference-image continuity — see §5 intro) + §6 shop | 10 |
| E | §7 relic icon template ×15 rows | 15 |
| F | §8 player ship + enemy template ×18 rows | 19 |
| G | §9 projectile template ×9 rows | 9 |
| H | §9 owned-entity template ×5 rows | 5 |

**Group related subjects into shared gen requests** — one image containing a
family renders far more consistently than the same subjects genned separately.
For the templated batches, substitute each row's values into the
`{PLACEHOLDERS}`, then combine sibling rows into a single **sheet request**: an
evenly-spaced grid of the subjects on one transparent (or near-black, per the
delivery spec) ground, every subject fully separated with clear margins, no
overlaps — then slice the sheet into the individual per-subject PNGs named
below. Suggested groupings:

- E: all 15 relic icons as one grid sheet (or 5 pantheon-grouped sheets).
- F: regular foes (32.1–32.10) as one sheet; boss/elite field sprites
  (32.11–32.18) as a second; the player ship ALONE (its quiet-center rule
  must not share a frame with hostile rims).
- G: the Ares armory (33.3–33.6) as one sheet; the Norse pair Mjölnir +
  Gungnir (33.1–33.2) as another; edict + Loosed Arrow (33.7–33.8) together;
  the Ruyi staff (33.9) alone (needs the full frame height).
- H: all 5 owned entities as one sheet.

Full-composition pieces — title, emblems, every §3/§4 portrait, backdrops,
shop — stay **one request each**: each is a distinct painting and sheet cells
would cost too much resolution. Judgment call throughout: group only while
per-subject resolution stays comfortably above its read size.

The coordinator then: verifies all **82 delivered files** (35 direct + 47
template rows), enforces the filename and destination convention below,
spot-checks grounds and slice quality (a bad ground or a subject clipped by
slicing goes back to its subagent for a re-gen), and runs the embed step once
at the end.

**HOLD-flagged rows must be SKIPPED until their flag clears**: 33.7 (edict —
counts as one of the 82; gen only the style the owner picks, A, B, or C) and
34.6 (solar barque — additive, 83rd file, gen once the ultimate roster is
ratified). A batch run before the flags clear delivers 81 files.

**COMBAT-SPRITE SIMPLICITY (Sections 8–9).** The first boss/elite field-sprite
gens came back far too detailed — at in-game size over bloom, ornament reads
as noise, not craft. The templates' MAXIMUM SIMPLICITY clauses exist to stop
that; treat them as hard constraints, not flavor. Coordinator QA: view every
Section 8–9 output scaled to its in-game read size (~60–100px for bosses,
smaller for popcorn) — if it reads as texture instead of a shape, reject and
re-gen with "SIMPLER: fewer, larger, flatter shapes" appended. STORYBOOK
portraits are exempt — that layer is allowed intricacy.

Output convention:
- **Filename**: `<prompt#>[-<row#>]-<slug>.png`, e.g. `16-odin.png`,
  `33-1-mjolnir.png`, `30-10-huginn-muninn.png`.
- **Destination**: Section 8–9 combat sprites → `art/sprites/` — and the
  player ship additionally saved as the live slot name `ship.png` (other live
  slots: `enemy-pop`, `enemy-gun`, `enemy-mid`, `enemy-boss` — fill these from
  the matching #32 rows: popcorn, gunship, carrier-or-mid pick, boss). All
  STORYBOOK assets (Sections 1–7) → `art/gen/` (staging; engine wiring is a
  separate pass).
- After combat sprites land, run `bash art/embed-sprites.sh` so `file://`
  Chrome picks them up.
- Honor each block's own delivery line (aspect, transparent vs near-black
  ground); reject any output with a white or light ground and re-generate.

---

## Section 1 — Title keyart

### 1. HUBRIS title backdrop

```
Painted illustration, storybook style: a night ocean of darkness with a rising wake
of gold — drifting gold coins, gilded shards and soft bloom-lit motes curling upward
in two side currents, converging toward a distant small glowing ship far below a
colossal dark crowned silhouette at the very top edge. Game-native gilded
iconography only: crown, coins, light — no motifs from any real-world mythology.
CRITICAL COMPOSITION: the central vertical column (middle 50% of the width) must
stay almost empty and very dark for text overlay; concentrate all gold detail along
the left and right edges and the extreme top and bottom. Extreme dark value range
overall. Palette: near-black ground #05080b, gold accent #ffd766, faint cyan glints
#5fe6ff, warm near-black outline #231A20 with outer contours 3x the weight of
interior lines, broad painted planes, restrained gold-leaf grain on painted shapes
only. Deliver: PNG, 9:16 portrait (1080x1920), on a near-black #05080b ground —
never white or light gray. Negative: no photorealism, no airbrushed or plastic
gradients, no glossy 3D render, no mixed mythological traditions, no pure black
#000000, no text or lettering, no busy particle noise, no bright detail in the
center column, no watermark.
```

---

## Section 2 — Pantheon emblems (1:1, silhouette-first)

### 2. OLYMPUS emblem

```
Painted emblem, storybook style: a circular sigil of a laurel wreath around a
marble column capital, drawn in the manner of Greek black-figure pottery and carved
marble frieze — flat, decorative, ceremonial. Must read as a flat black silhouette
at very small size; radially balanced, centered. Palette: warm near-black outline
#231A20 with the outer contour 3x the weight of interior lines, ivory-marble fill
#e8f4f7, a single thread of gold #ffd766, broad flat planes, restrained gold-leaf
grain. Deliver: PNG, 1:1 square, on a transparent ground (or near-black #05080b) —
never white or light gray. Negative: no photorealism, no airbrushed or plastic
gradients, no glossy 3D render, no mixed mythological traditions (Greek motifs
only), no pure black #000000, no text or lettering, no busy particle noise, no
watermark.
```

### 3. KEMET emblem

```
Painted emblem, storybook style: a circular sigil of a winged sun-disc above a
scarab, drawn in the manner of Egyptian tomb-wall painting and papyrus — flat
profile forms, gold leaf on lapis, hieroglyphic decorative banding around the rim.
Must read as a flat black silhouette at very small size; radially balanced,
centered. Palette: warm near-black outline #231A20 with the outer contour 3x the
weight of interior lines, lapis-blue deep fill, gold #ffd766 and warm gold #ffe89a
accents, broad flat planes, restrained gold-leaf grain. Deliver: PNG, 1:1 square,
on a transparent ground (or near-black #05080b) — never white or light gray.
Negative: no photorealism, no airbrushed or plastic gradients, no glossy 3D render,
no mixed mythological traditions (Egyptian motifs only), no pure black #000000, no
text or lettering, no busy particle noise, no watermark.
```

### 4. ASGARD emblem

```
Painted emblem, storybook style: a circular sigil of two interlaced ravens knotted
around a downward spear, drawn in the manner of Norse runestone knotwork and carved
weathered wood — interlace bands, cold iron, frost-worn timber. Must read as a flat
black silhouette at very small size; radially balanced, centered. Palette: warm
near-black outline #231A20 with the outer contour 3x the weight of interior lines,
cold-iron fill #cfd6e0, frost-blue undertone #8fb4d8, one thread of gold #ffd766,
broad flat planes, restrained grain like worn stone. Deliver: PNG, 1:1 square, on
a transparent ground (or near-black #05080b) — never white or light gray. Negative:
no photorealism, no airbrushed or plastic gradients, no glossy 3D render, no mixed
mythological traditions (Norse motifs only), no pure black #000000, no text or
lettering, no busy particle noise, no watermark.
```

### 5. CELESTIAL COURT emblem

```
Painted emblem, storybook style: a circular sigil of an imperial seal-stamp square
wreathed in stylized cloud bands, drawn in the manner of Ming dynasty court scroll
painting — gold on jade, enamel-flat, ceremonial. Must read as a flat black
silhouette at very small size; radially balanced, centered. Palette: warm
near-black outline #231A20 with the outer contour 3x the weight of interior lines,
jade-green fill #3be089, imperial violet undertone #c99aff, gold #ffd766 seal
lines, broad flat planes, restrained gold-leaf grain. Deliver: PNG, 1:1 square, on
a transparent ground (or near-black #05080b) — never white or light gray. Negative:
no photorealism, no airbrushed or plastic gradients, no glossy 3D render, no mixed
mythological traditions (Chinese imperial motifs only), no pure black #000000, no
text or lettering, no busy particle noise, no watermark.
```

### 6. FIFTH SUN emblem

```
Painted emblem, storybook style: a circular sigil of a feathered serpent coiled
around a stepped sun glyph, drawn in the manner of Mesoamerican codex illustration
— flat blocked color, glyphic geometry, obsidian and turquoise. Must read as a
flat black silhouette at very small size; radially balanced, centered. Palette:
warm near-black outline #231A20 with the outer contour 3x the weight of interior
lines, turquoise fill #5affc0, obsidian near-black masses, gold #ffd766 sun rays,
broad flat planes, restrained grain like bark-paper. Deliver: PNG, 1:1 square, on
a transparent ground (or near-black #05080b) — never white or light gray. Negative:
no photorealism, no airbrushed or plastic gradients, no glossy 3D render, no mixed
mythological traditions (Mesoamerican motifs only), no pure black #000000, no text
or lettering, no busy particle noise, no watermark.
```

---

## Section 3 — God card portraits (2:3, must read at 306×470)

### 7. ZEUS — the Stormbreaker

```
Painted card portrait, storybook style: Zeus, storm-father of Olympus, waist-up,
gripping a jagged forked lightning bolt (his one iconic prop) as chained arcs leap
between his fingers; marble-white beard and laurel crown, humble weathered cloth
chiton under one bronze pauldron, imperfect asymmetry — a chipped laurel leaf.
Drawn in the manner of Greek black-figure pottery and carved marble frieze; broad
painted planes; face read in 2-3 marks (eyes, brow, mouth shadow). He looms at
impossible scale, storm clouds breaking small and low behind him. Must read by
silhouette + bolt + accent color alone at thumbnail size. Palette: near-black
ground #05080b, storm-blue accent #9fd8ff, gold #ffd766 on the laurel, warm
near-black outline #231A20 with the outer contour 3x the weight of interior lines,
restrained gold-leaf grain. Deliver: PNG, 2:3 portrait, on a transparent or
near-black #05080b ground — never white or light gray. Negative: no photorealism,
no airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions (Greek only), no pure black #000000, no text or lettering, no busy
particle noise, no watermark.
```

### 8. POSEIDON — Lord of Tides

```
Painted card portrait, storybook style: Poseidon, waist-up, rising from a curling
tidal wall that sweeps upward carrying flecks of gold; his trident (the one iconic
prop) planted forward; sea-foam beard, humble rope-and-leather harness with one
barnacled bronze cuff, imperfect asymmetry — a cracked trident tine. Drawn in the
manner of Greek black-figure pottery and marble frieze; broad painted planes; face
in 2-3 marks. Impossible scale: a tiny ship silhouette dwarfed low in the wave.
Must read by silhouette + trident + accent color at thumbnail size. Palette:
near-black ground #05080b, sea-teal accent #4fe0e0, gold #ffd766 in the wave's
freight, warm near-black outline #231A20 with the outer contour 3x the weight of
interior lines, restrained gold-leaf grain. Deliver: PNG, 2:3 portrait, on a
transparent or near-black #05080b ground — never white or light gray. Negative: no
photorealism, no airbrushed or plastic gradients, no glossy 3D render, no mixed
mythological traditions (Greek only), no pure black #000000, no text or lettering,
no busy particle noise, no watermark.
```

### 9. ARTEMIS — the Huntress

```
Painted card portrait, storybook style: Artemis, waist-up, drawing a silver bow
with a single glowing marking-arrow nocked (her one iconic prop), one eye sighted
down the shaft; crescent-moon circlet, humble hunting leathers and cloth wrap with
one gilded quiver strap, imperfect asymmetry — an uneven fletching. Drawn in the
manner of Greek black-figure pottery and marble frieze; broad painted planes; face
in 2-3 marks, calm and precise. Must read by silhouette + bow + accent color at
thumbnail size. Palette: near-black ground #05080b, moon-green accent #b6ff5a,
gold #ffd766 on the quiver, warm near-black outline #231A20 with the outer contour
3x the weight of interior lines, restrained gold-leaf grain. Deliver: PNG, 2:3
portrait, on a transparent or near-black #05080b ground — never white or light
gray. Negative: no photorealism, no airbrushed or plastic gradients, no glossy 3D
render, no mixed mythological traditions (Greek only), no pure black #000000, no
text or lettering, no busy particle noise, no watermark.
```

### 10. APHRODITE — the Beguiling

```
Painted card portrait, storybook style: Aphrodite, waist-up, releasing a single
dove that trails a heart-shaped charm sigil (her iconic motif); loose painted hair,
humble draped linen with one gilded shell brooch, imperfect asymmetry — a slipped
shoulder fold. Drawn in the manner of Greek black-figure pottery and marble
frieze; broad painted planes; face in 2-3 marks, a knowing half-smile. Must read
by silhouette + dove + accent color at thumbnail size. Palette: near-black ground
#05080b, rose accent #ff77c8, gold #ffd766 on the brooch, warm near-black outline
#231A20 with the outer contour 3x the weight of interior lines, restrained
gold-leaf grain. Deliver: PNG, 2:3 portrait, on a transparent or near-black
#05080b ground — never white or light gray. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions (Greek only), no pure black #000000, no text or lettering, no busy
particle noise, no watermark.
```

### 11. ARES — God of War

```
Painted card portrait, storybook style: Ares, waist-up, helm-shadowed, flanked by
Phobos and Deimos — two thin dread-wraiths of smoke rising at his shoulders (his
iconic motif); battered bronze breastplate over humble patched cloth, imperfect
asymmetry — one missing cheek-guard, a notched spear haft. Drawn in the manner of
Greek black-figure pottery and marble frieze; broad painted planes; face in 2-3
marks, eyes lit from below. Must read by silhouette + twin wraiths + accent color
at thumbnail size. Palette: near-black ground #05080b, blood-red accent #ff5a6e,
gold #ffd766 on the helm crest, warm near-black outline #231A20 with the outer
contour 3x the weight of interior lines, restrained gold-leaf grain. Sacred and
terrible, never gory. Deliver: PNG, 2:3 portrait, on a transparent or near-black
#05080b ground — never white or light gray. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions (Greek only), no pure black #000000, no gore, no text or lettering, no
busy particle noise, no watermark.
```

### 12. HEIMDALL — the Watchman

```
Painted card portrait, storybook style: Heimdall the ever-watching, waist-up,
raising the Gjallarhorn to his lips while his other hand holds a shard of prism
splitting one ray of dawn into a small rainbow fan (his iconic props — horn and
prism); far-seeing pale eyes, dawn-gold mail, weathered watch-cloak, imperfect
asymmetry — one horn-strap frayed. Drawn in the manner of Norse runestone
knotwork and carved wood; broad painted planes; face in 2-3 marks, vigilant and
calm. Must read by silhouette + horn + rainbow shard at thumbnail size. Palette:
near-black ground #05080b, dawn-gold accent #ffe3c2, a thin refracted rainbow
thread on the prism only, gold #ffd766 on the horn rim, warm near-black outline
#231A20 with the outer contour 3x the weight of interior lines, restrained
gold-leaf grain. Deliver: PNG, 2:3 portrait, on a transparent or near-black
#05080b ground — never white or light gray. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions (Norse only), no pure black #000000, no text or lettering, no busy
particle noise, no watermark.
```

### 13. RA — the Radiant

```
Painted card portrait, storybook style: Ra, falcon-headed, in strict flat profile
pose in the manner of Egyptian tomb-wall painting and papyrus — flat blocked
forms, gold leaf on lapis, a hieroglyph band along one edge. His iconic motif: the
solar disc behind his head emitting one focused descending beam of light. Humble
linen kilt with one gold pectoral collar, imperfect asymmetry — a worn edge of
gold leaf flaking. Impossible scale: the disc fills the frame's upper third. Face
in 2-3 marks (falcon eye, brow line, beak shadow). Must read by silhouette + sun
disc + accent color at thumbnail size. Palette: near-black ground #05080b, solar
accent #ffe89a, gold #ffd766 leaf, lapis-blue deeps, warm near-black outline
#231A20 with the outer contour 3x the weight of interior lines, restrained
gold-leaf grain. Deliver: PNG, 2:3 portrait, on a transparent or near-black
#05080b ground — never white or light gray. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions (Egyptian only), no pure black #000000, no text or lettering, no busy
particle noise, no watermark.
```

### 14. ANUBIS — Weigher of Hearts

```
Painted card portrait, storybook style: Anubis, jackal-headed, in strict flat
profile pose in the manner of Egyptian tomb-wall painting and papyrus — flat
blocked forms, gold leaf on lapis. His iconic prop: the golden scales of judgment
held before him, one pan dipping; behind, the faint columns of the Hall of
Judgment. Humble linen wrap with one gold ankh pendant, imperfect asymmetry — one
chipped scale pan. Face in 2-3 marks (jackal eye, ear line, muzzle shadow). Must
read by silhouette + scales + accent color at thumbnail size. Palette: near-black
ground #05080b, tomb-gold accent #e8c46a, gold #ffd766 on the scales, lapis
deeps, warm near-black outline #231A20 with the outer contour 3x the weight of
interior lines, restrained gold-leaf grain. Sacred and solemn, never grim.
Deliver: PNG, 2:3 portrait, on a transparent or near-black #05080b ground — never
white or light gray. Negative: no photorealism, no airbrushed or plastic
gradients, no glossy 3D render, no mixed mythological traditions (Egyptian only),
no pure black #000000, no gore, no text or lettering, no busy particle noise, no
watermark.
```

### 15. LOKI — the Trickster

```
Painted card portrait, storybook style: Loki, waist-up, grinning sideways as a
second identical shadow-twin of himself peels away from his outline like smoke
(his iconic motif — the decoy); drawn in the manner of Norse runestone knotwork
and carved weathered wood — interlace borders, cold iron, frost. Humble stitched
leathers and a patched wool hood with one gilded serpent clasp, imperfect
asymmetry — the twin's outline is subtly wrong. Face in 2-3 marks, sly. Must read
by silhouette + doubled figure + accent color at thumbnail size. Palette:
near-black ground #05080b, venom-green accent #8cff5a, gold #ffd766 on the clasp,
warm near-black outline #231A20 with the outer contour 3x the weight of interior
lines, restrained grain like worn wood. Deliver: PNG, 2:3 portrait, on a
transparent or near-black #05080b ground — never white or light gray. Negative:
no photorealism, no airbrushed or plastic gradients, no glossy 3D render, no
mixed mythological traditions (Norse only), no pure black #000000, no text or
lettering, no busy particle noise, no watermark.
```

### 16. ODIN — the Allfather

```
Painted card portrait, storybook style: Odin, waist-up, one-eyed beneath a deep
hood, leveling Gungnir the never-missing spear (his one iconic prop) while
Huginn and Muninn, two ravens, circle his shoulders; drawn in the manner of Norse
runestone knotwork and carved weathered wood — interlace bands frame the card.
Humble traveler's wool cloak with one cold-iron torc, imperfect asymmetry — the
empty eye, a frayed hem. Face in 2-3 marks: one bright eye, brow, beard shadow.
Impossible scale: the spear's line runs beyond both card edges. Must read by
silhouette + spear + ravens + accent color at thumbnail size. Palette: near-black
ground #05080b, iron-gray accent #cfd6e0, gold #ffd766 on the torc, warm
near-black outline #231A20 with the outer contour 3x the weight of interior
lines, restrained grain like worn stone. Deliver: PNG, 2:3 portrait, on a
transparent or near-black #05080b ground — never white or light gray. Negative:
no photorealism, no airbrushed or plastic gradients, no glossy 3D render, no
mixed mythological traditions (Norse only), no pure black #000000, no text or
lettering, no busy particle noise, no watermark.
```

### 17. THOR — the Thunderer

```
Painted card portrait, storybook style: Thor, waist-up, mid-catch as Mjölnir the
returning hammer (his one iconic prop) flies back to his gauntleted hand, motion
carved as a knotwork arc; drawn in the manner of Norse runestone carving and
weathered wood — pure force, deliberately NO lightning. Humble quilted wool and
leather under the belt Megingjörð, imperfect asymmetry — one split gauntlet seam.
Face in 2-3 marks, braced grin. Impossible scale: the hammerhead reads far too
massive for any hand. Must read by silhouette + hammer + accent color at
thumbnail size. Palette: near-black ground #05080b, storm-iron accent #8fb4d8,
gold #ffd766 on the belt, warm near-black outline #231A20 with the outer contour
3x the weight of interior lines, restrained grain like worn stone. Deliver: PNG,
2:3 portrait, on a transparent or near-black #05080b ground — never white or
light gray. Negative: no photorealism, no airbrushed or plastic gradients, no
glossy 3D render, no mixed mythological traditions (Norse only), no lightning
bolts, no pure black #000000, no text or lettering, no busy particle noise, no
watermark.
```

### 18. WUKONG — the Monkey King

```
Painted card portrait, storybook style: Sun Wukong, waist-up, shouldering the
Ruyi Jingu Bang — a colossal gold-banded staff (his one iconic prop) whose upper
end vanishes past the card edge at impossible scale — while two tiny hair-clone
duplicates of himself perch on the shaft; drawn in the manner of Ming dynasty
court scroll painting — gold on jade, drifting cloud bands, a small imperial
seal-stamp in one corner. Humble pilgrim's cloth and rope belt under one gilded
shoulder plate, phoenix-feather cap, imperfect asymmetry — a torn cap feather.
Face in 2-3 marks, irreverent. Must read by silhouette + staff + accent color at
thumbnail size. Palette: near-black ground #05080b, ember-orange accent #ff6a3d,
gold #ffd766 staff bands, jade undertones, warm near-black outline #231A20 with
the outer contour 3x the weight of interior lines, restrained gold-leaf grain.
Deliver: PNG, 2:3 portrait, on a transparent or near-black #05080b ground —
never white or light gray. Negative: no photorealism, no airbrushed or plastic
gradients, no glossy 3D render, no mixed mythological traditions (Chinese
imperial only), no pure black #000000, no text or lettering, no busy particle
noise, no watermark.
```

### 19. GUAN YU — Saint of War

```
Painted card portrait, storybook style: Guan Yu, red-faced saint of war, waist-up
at a slight low angle for scale, calm at rest, both hands on the upright Green
Dragon Crescent Blade — a long guandao with a dragon-ornamented crescent head
(his one iconic prop); the Red Hare, his crimson horse, a dark silhouette behind
his shoulder. Long flowing black beard, jade-lacquered armor plates over humble
quilted cloth, imperfect asymmetry — one worn cord-wrapped grip. Drawn in the
manner of Ming dynasty court scroll painting — gold on jade, drifting cloud
bands, an imperial seal-stamp in one corner. Face in 2-3 marks: heavy brow,
steady eyes, beard shadow; dignified, never snarling. Must read by silhouette +
crescent blade + accent color alone at thumbnail size. Palette: near-black ground
#05080b, jade-green accent #3be089, gold #ffd766 on the blade collar and seal,
warm near-black outline #231A20 with the outer contour 3x the weight of interior
lines, broad painted planes, restrained gold-leaf grain. Deliver: PNG, 2:3
portrait, on a transparent or near-black #05080b ground — never white or light
gray. Negative: no photorealism, no airbrushed or plastic gradients, no glossy 3D
render, no mixed mythological traditions (Chinese imperial only), no pure black
#000000, no gore, no text or lettering, no busy particle noise, no watermark.
```

### 20. JADE EMPEROR — Lord of the Celestial Bureaucracy

```
Painted card portrait, storybook style: the Jade Emperor enthroned at impossible
scale, seen frontally through a parted judgment curtain of hanging bead-strands;
his face serene and half-veiled by the flat-topped imperial crown with hanging
jade pendants (his iconic motif); edict talismans — long vertical paper charms
with seal-stamps — drift down around the throne. Drawn in the manner of Ming
dynasty court scroll painting — gold on jade, cloud bands beneath the throne,
imperial seals. Ceremonial robe painted in broad flat planes over one humble
detail: plain worn prayer beads in his hand; imperfect asymmetry — one pendant
strand swings out of line. Face in 2-3 marks, remote and just. Must read by
silhouette + curtain-and-crown + accent color at thumbnail size. Palette:
near-black ground #05080b, imperial-violet accent #c99aff, gold #ffd766 on seals
and crown, jade undertones, warm near-black outline #231A20 with the outer
contour 3x the weight of interior lines, restrained gold-leaf grain. Deliver:
PNG, 2:3 portrait, on a transparent or near-black #05080b ground — never white
or light gray. Negative: no photorealism, no airbrushed or plastic gradients, no
glossy 3D render, no mixed mythological traditions (Chinese imperial only), no
pure black #000000, no legible text or lettering (talisman marks stay abstract),
no busy particle noise, no watermark.
```

### 21. QUETZALCOATL — the Plumed Serpent

```
Painted card portrait, storybook style: Quetzalcoatl as a great feathered serpent
coiling through the whole card at impossible scale, head low and near, jaws calm,
long quetzal plumes streaming (his iconic motif); its winding body swallows a
drifting line of tiny bullet-beads that turn to gold flecks in its wake. Drawn in
the manner of Mesoamerican codex illustration — flat blocked color, glyphic
geometry, stepped-fret border along one edge, obsidian and turquoise. Imperfect
asymmetry — one bent plume. Eye read in 2-3 marks. Must read by silhouette +
plumed coil + accent color at thumbnail size. Palette: near-black ground #05080b,
turquoise accent #5affc0, gold #ffd766 flecks, obsidian masses, warm near-black
outline #231A20 with the outer contour 3x the weight of interior lines, broad
flat planes, restrained grain like bark-paper. Deliver: PNG, 2:3 portrait, on a
transparent or near-black #05080b ground — never white or light gray. Negative:
no photorealism, no airbrushed or plastic gradients, no glossy 3D render, no
mixed mythological traditions (Mesoamerican only), no pure black #000000, no
text or lettering, no busy particle noise, no watermark.
```

---

## Section 4 — Boss portraits (2:3, game-native, tradition-neutral)

### 22. TALOS — the bronze sentinel

```
Painted card portrait, storybook style: TALOS, the colossal bronze automaton of
Greek myth — one iconic silhouette (a ring-shaped bronze sentinel frame, the
giant's guarding circuit) plus one secondary motif (a single molten core-eye,
the ichor-vein plug at its center); burnished molten-bronze plates over dark
iron, drawn in the manner of Greek black-figure pottery and cast bronze votive
figures, ceremonial engraving, no face — the core-eye is the face, read in 2-3
marks. Human scale against impossible scale: a tiny glowing ship silhouette
dwarfed beneath it. Imperfect asymmetry — one cracked plate weeping a thread of
ichor-light. Broad painted planes, sacred and ceremonial, a reliquary that
fights. Must read as a flat silhouette at thumbnail size. Palette: near-black
ground #05080b, molten bronze-gold (hotter and redder than loot gold #ffd766)
dominant, cyan glints #5fe6ff on the ship, danger red #ff5a6e in the core-eye
only, warm near-black outline #231A20 with the outer contour 3x the weight of
interior lines, restrained gold-leaf grain. Deliver: PNG, 2:3 portrait, on a
transparent or near-black #05080b ground — never white or light gray. Negative:
no photorealism, no airbrushed or plastic gradients, no glossy 3D render, no
mixed mythological traditions (Greek only), no pure black #000000, no text or
lettering, no busy particle noise, no watermark.
```

### 23. AMMIT — devourer of hearts

```
Painted card portrait, storybook style: AMMIT the devourer of hearts, the
composite beast of Kemet judgment — crocodile jaws, lion forequarters, hippo
hindquarters — coiled around a set of golden judgment scales (iconic silhouette:
the tri-beast coil; secondary motif: the scales with one pan tipped); drawn in
strict flat profile in the manner of Egyptian tomb-wall painting and papyrus,
flat blocked color, hieroglyphic banding at the frame edge. Sacred and
ceremonial menace, never gory — she is a verdict, not a monster. Human scale
against impossible scale: a tiny glowing ship silhouette small before her jaws.
Imperfect asymmetry — one chipped gilded scale-pan. Broad painted planes. Must
read as a flat silhouette at thumbnail size. Palette: near-black ground #05080b,
bruised magenta dominant with sickly green undertones on the beast, gold #ffd766
on the scales only, cyan glints #5fe6ff on the ship, warm near-black outline
#231A20 with the outer contour 3x the weight of interior lines, restrained
gold-leaf grain. Deliver: PNG, 2:3 portrait, on a transparent or near-black
#05080b ground — never white or light gray. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions (Egyptian only), no gore, no pure black #000000, no text or
lettering, no busy particle noise, no watermark.
```

### 24. MIDAS — the gilded king (final boss)

```
Painted card portrait, storybook style: MIDAS, the gilded king — a gaunt, hollow-
eyed monarch whose curse has consumed him. One iconic silhouette (a lean crowned
figure, robes and skin half-turned to hardened gold, reaching with one open,
grasping hand) plus one secondary motif (a heaped, hungry HOARD of coins and
treasure dragging at his feet and rising around him, some of it flowing UP toward
his grasping hand as if he is drinking it in). Read in 2-3 marks: sunken eye,
grasping hand, the crown. Drawn in the Greek votive tradition — a temple-offering
plaque / archaic Hellenic king, laurel and chiton turned to metal — belonging to
that tradition and no other. Human scale against impossible scale: a minute
glowing ship rising toward him from the bottom edge, small beside the mountain of
gold. Imperfect asymmetry — one shoulder fully petrified and cracking, coins
spilling loose. Broad painted planes; avaricious, starving, tragic — a king
drowned in his own wealth, never grimy. Must read as a flat silhouette at
thumbnail size. Palette: near-black ground #05080b, gold #ffd766 utterly
dominant, a warm rose #ff5a6e accent in the shadows and grasping-hand glow, faint
cyan #5fe6ff on the ship, warm near-black outline #231A20 with the outer contour
3x the weight of interior lines, restrained gold-leaf grain. Deliver: PNG, 2:3
portrait, on a transparent or near-black #05080b ground — never white or light
gray. Negative: no photorealism, no airbrushed or plastic gradients, no glossy
3D render, no mixed mythological traditions, no pure black #000000, no text or
lettering, no busy particle noise, no watermark.
```

### 25. THE APOSTATE — renegade elite

```
Painted card portrait, storybook style: THE APOSTATE, a hooded renegade duelist
who wields two stolen god-gifts at once — design it strictly god-agnostic: in
each hand a shrouded, unidentifiable relic wrapped in cloth and chains, one
glowing cool, one glowing warm, neither showing any recognizable mythological
symbol. Iconic silhouette: a lean asymmetric figure under a torn ceremonial
mantle sewn from mismatched sacred vestments (secondary motif: the mismatched
halves — two different hems, two different shoulder ornaments, deliberately from
no nameable tradition). Face hidden except 2-3 marks: a lit eye, a jaw shadow.
Human-scale figure, but the two relic-glows cast impossible long light. Broad
painted planes; a thief of the sacred, not a ghoul. Must read as a flat
silhouette at thumbnail size. Palette: near-black ground #05080b, ivory #e8f4f7
vestments, gold #ffd766 chain and trim, one cool cyan #5fe6ff glow and one warm
red #ff5a6e glow, warm near-black outline #231A20 with the outer contour 3x the
weight of interior lines, restrained gold-leaf grain. Deliver: PNG, 2:3
portrait, on a transparent or near-black #05080b ground — never white or light
gray. Negative: no photorealism, no airbrushed or plastic gradients, no glossy
3D render, no identifiable mythological symbols or mixed traditions, no pure
black #000000, no text or lettering, no busy particle noise, no watermark.
```

---

## Section 5 — Sector journeys (9:16 ×3 legs each; scrolls behind dense bullet fields)

**A sector is a JOURNEY, not a wallpaper** (owner ruling 2026-07-19, ART.md §8).
Each sector's backdrop is a continuous painted route in three vertically-seamed
**legs** — approach → passage → threshold — that the engine scrolls slowly
downscreen across the sector, arriving at the boss's doorstep. Per sector,
generate **three 9:16 images sequentially in one subagent**: gen leg 1, then
feed each finished leg back as a reference image when genning the next so
style, palette and bank-lines stay continuous; the TOP ~10% of leg N must
compositionally continue into the BOTTOM ~10% of leg N+1 (the seam), since the
scroll runs bottom-to-top through legs 1→2→3. Every leg individually obeys the
shared contract below.

**Shared contract (applies to all nine leg images — treat as part of every
prompt):** Painted backdrop for a vertical bullet-hell playfield, storybook
style. CRITICAL: sits BEHIND a dense field of glowing bullets and must never
steal reads — extreme dark value range (nothing above a dim mid-tone), ALL
detail pressed against the left and right screen edges, the entire center
column (middle 50% of the width) kept nearly empty near-black darkness. One
landmark per leg. Large flat painted masses first, minimal localized texture,
low contrast, no stripes or lanes implying a safe path. Near-black base
#05080b, warm near-black outline #231A20 soft and heavy, no grain in the
central play area. Deliver: PNG, 9:16 portrait (1080x1920), on a near-black
#05080b ground — never white or light gray. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions, no pure black #000000, no bright detail in the center column, no
text or lettering, no busy particle noise, no watermark.

### 26. SECTOR 1 journey — THE BRONZE COAST (arrival: TALOS)

Greek only: carved marble frieze and black-figure pottery manner. Dim
desaturated marble-ivory, sea-green and moss midtones; faintest gold #ffd766
threads on wreck-gold and relief.

```
LEG 1 (approach): open night sea — long dark swells, drifting wreck-gold and
splintered hulls of offering-ships along the left and right edges, a faint
star-band high up. Landmark: one half-sunken bronze colossus hand breaking the
water at an edge.
LEG 2 (passage): bronze-littered shallows — reefs of broken colossus fragments
(a face, a greave, a shield) pressed against both edges, shallow water glinting
dimly between them. Landmark: a toppled bronze head lying on a reef.
LEG 3 (threshold): the marble cliffs of the guarded island — broken columns
and laurel relief climbing both edges toward a colossal ruined temple gate
spanning the top edge (TALOS's circuit). Landmark: the gate.
```

### 27. SECTOR 2 journey — THE RIVER OF NIGHT (arrival: AMMIT)

Egyptian only: tomb-wall painting and papyrus manner — flat profile forms,
hieroglyph bands, gold leaf on lapis. Dim lapis-blue and tomb-gold #e8c46a
midtones. The river IS the playfield: the dark water is the empty center
column, the banks carry all detail at the edges.

```
LEG 1 (approach): down the Nile at dusk — reed and papyrus banks on both
edges, small dark fishing skiffs beached, a pylon gate silhouette at one edge.
Landmark: the first pylon gate.
LEG 2 (passage): the river enters the Duat — banks become tomb walls with flat
fresco profiles and hieroglyph bands, gates of the hours of night passing at
the edges, colossal seated guardian statues flanking. Landmark: the paired
guardians.
LEG 3 (threshold): the narrowing approach to the Hall of Judgment — the banks
close in, columns and scales iconography on both edges, gold-leaf judgment
scenes, the hall's doorway darkness spanning the top edge where the river ends.
Landmark: the hall doorway.
```

### 28. SECTOR 3 journey — ASCENT OF THE GILDED COURT (arrival: MIDAS)

Chinese imperial only: Ming dynasty court scroll manner — cloud bands,
gold-on-jade, hanging curtains, edict banners. Dim jade and imperial-violet
#c99aff midtones, restrained gold #ffd766 threads; each leg is more gold-choked
than the last (the scroll ascends, so this journey reads as CLIMBING).

```
LEG 1 (approach): the cloud-borne outer terraces — balustrade tiers emerging
from drifting cloud bands at both edges, distant lantern glints. Landmark: the
first great terrace stair at an edge.
LEG 2 (passage): the middle court — hanging judgment curtains and long
vertical edict banners at both edges, gold-on-jade balustrades stacking
higher, coins and treasure beginning to heap in the edge shadows. Landmark: a
colossal gilded censer.
LEG 3 (threshold): the throne approach — the richest and darkest tier, curtain
layers parting at the edges, treasure heaped and hardening to gold, the empty
throne dais silhouette spanning the very top edge. Landmark: the dais.
```

---

## Section 6 — Shop dressing

### 29. BLACK MARKET backdrop

```
Painted screen dressing, storybook style: a clandestine night-market shopfront
seen head-on — a dark stall framed by burnished metal, cloisonné enamel panels,
hanging paper lanterns pooling warm gold light, wax-sealed parcels and coin
stacks along the bottom edge, a drawn curtain behind. Gilded-myth market
atmosphere, gold-on-dark, ceremonial and slightly illicit; game-native dressing
belonging to no single real-world mythology (generic lanterns, seals, coins,
cloth — no identifiable religious symbols). COMPOSITION: all detail forms a
frame around the edges; the center 60% of the image stays dim, flat and empty so
shop cards and text render over it. Extreme dark value range; lantern-gold
pools are the only warmth. Broad painted planes, warm near-black outline #231A20
with the outer contour 3x the weight of interior lines, restrained gold-leaf
grain on the frame only — none in the empty center. Palette: near-black base
#05080b, gold #ffd766 dominant accent, dim teal #6fa9b8 shadows, a faint cyan
#5fe6ff glint. Deliver: PNG, 9:16 portrait (1080x1920), on a near-black #05080b
ground — never white or light gray. Negative: no photorealism, no airbrushed or
plastic gradients, no glossy 3D render, no mixed mythological traditions, no
identifiable religious symbols, no pure black #000000, no bright detail in the
center, no text or lettering, no busy particle noise, no watermark.
```

---

## Section 7 — Charm-relic icon batch (template × 15)

### 30. Charm-relic icon template

One templated prompt; generate 15 icons by substituting `{SUBJECT}`, `{TRADITION}`
and `{ACCENT}` from the table below. Icons are small passive relics — one object,
no figures.

```
Painted inventory icon, storybook style: {SUBJECT} — a single small sacred relic,
centered, floating, shown alone with no figures and no background scene. Drawn in
the manner of {TRADITION}; flat decorative rendering, broad painted planes, the
object reads as a bold flat silhouette FIRST at very small size, texture only
inside that silhouette. One humble material plus one gilded detail; imperfect
asymmetry — a worn edge, a chip, a frayed thread. Palette: accent color {ACCENT},
gold #ffd766 for the gilded detail, warm near-black outline #231A20 with the
outer contour 3x the weight of interior lines, restrained gold-leaf grain.
Deliver: PNG, 1:1 square, on a transparent ground (or near-black #05080b) —
never white or light gray. Negative: no photorealism, no airbrushed or plastic
gradients, no glossy 3D render, no mixed mythological traditions, no pure black
#000000, no text or lettering, no busy particle noise, no figures or hands, no
watermark.
```

Substitutions:

| # | `{SUBJECT}` | `{TRADITION}` | `{ACCENT}` |
| --- | --- | --- | --- |
| 30.1 | EAGLE FEATHER of Zeus — a storm-charged eagle feather crackling faintly | Greek black-figure pottery and carved marble frieze | `#9fd8ff` |
| 30.2 | PEARL OF THE DEEP of Poseidon — a huge pearl wrapped in kelp and rope | Greek black-figure pottery and carved marble frieze | `#4fe0e0` |
| 30.3 | SILVER FLETCHING of Artemis — a single arrow fletching of moonlit feather | Greek black-figure pottery and carved marble frieze | `#b6ff5a` |
| 30.4 | DOVE TOKEN of Aphrodite — a small carved dove charm on a silk cord | Greek black-figure pottery and carved marble frieze | `#ff77c8` |
| 30.5 | SPEAR SPLINTER of Ares — a broken spearhead fragment bound in leather | Greek black-figure pottery and carved marble frieze | `#ff5a6e` |
| 30.6 | WATCHMAN'S EYE of Heimdall — an unblinking eye of dawn-glass set in a horn-rim bezel | Norse runestone knotwork and carved wood | `#ffe3c2` |
| 30.7 | SUNSTONE of Ra — a faceted stone holding a captive sliver of sunlight | Egyptian tomb-wall painting and papyrus, gold leaf on lapis | `#ffe89a` |
| 30.8 | HEART SCARAB of Anubis — a lapis scarab amulet inlaid with gold | Egyptian tomb-wall painting and papyrus, gold leaf on lapis | `#e8c46a` |
| 30.9 | TANGLED THREAD of Loki — an impossibly knotted loop of green thread | Norse runestone knotwork and carved weathered wood | `#8cff5a` |
| 30.10 | HUGINN & MUNINN of Odin — two black raven charms perched on one cold-iron ring, wings folded | Norse runestone knotwork and carved weathered wood | `#cfd6e0` |
| 30.11 | HAMMER SHARD of Thor — a chipped fragment of hammerhead iron, humming | Norse runestone knotwork and carved weathered wood | `#8fb4d8` |
| 30.12 | GOLDEN HAIR of Wukong — a single stiff golden monkey hair, faintly glowing | Ming dynasty court scroll painting, gold on jade | `#ff6a3d` |
| 30.13 | OATH TABLET of Guan Yu — a small jade tablet carved with an abstract oath seal | Ming dynasty court scroll painting, gold on jade | `#3be089` |
| 30.14 | IMPERIAL SEAL of the Jade Emperor — a violet-jade seal-stamp with gold base | Ming dynasty court scroll painting, gold on jade | `#c99aff` |
| 30.15 | PLUMED CREST of Quetzalcoatl — a fan of quetzal plumes set in turquoise | Mesoamerican codex illustration, obsidian and turquoise | `#5affc0` |

---

## Section 8 — Combat sprites (AUTHORED COMBAT SPRITES, third clause)

These are **not** storybook paintings. They live inside the additive bloom
field: self-luminous rim-glow instead of any ink outline, dark mid-tone body
planes inside the rim, transparent ground, no grain. Faction color law is
absolute: player = cool cyan/white; enemies = warm/hostile family + archetype
accent. Gold reads as loot, never as a threat — the Gilded Mimic is the one
sanctioned exception.

### 31. THE PLAYER SHIP

```
Game sprite for a vertical bullet-hell, strict top-down view seen from directly
above, nose pointing UP: the player vessel — a small consecrated skiff, a
reliquary-craft of the gods, not a sci-fi fighter. A compact, aggressive,
near-symmetric dart-shaped hull of dark gold-and-ivory plates built around a
recessed relic core; slim consecrated prow, two short swept wing-fins, twin
engine glows at the tail. THE EDGE IS LIGHT: the entire silhouette is carried by
a self-luminous rim-glow in cool cyan #5fe6ff blending to white at the prow and
engine tips — there is NO drawn outline; the hull interior is quiet dark
mid-tone planes only. CRITICAL: the exact center of the hull must stay dark,
empty and visually quiet — the game engine draws a bright hitbox dot on top of
it. Gold #ffd766 is permitted only as a single thin trim accent line along the
plating; no other warm color anywhere. Silhouette must read instantly at 64
pixels tall. Designed to glow under additive bloom over a black field. Deliver:
PNG, 1:1 square, sprite centered, on a fully TRANSPARENT ground — never white,
never light gray, no backdrop of any kind. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions, no ink outline, no paper grain, no photoreal panel detail, nothing
bright in the hull center, no warm or red lighting, no text or lettering, no
busy particle noise, no background, no watermark.
```

### 32. Enemy-sprite template

One templated prompt; generate each foe by substituting `{SUBJECT}`,
`{SILHOUETTE MOTIF}` and `{ACCENT}` from the table below. All enemies share the
hostile rim family; only the accent and silhouette change.

```
Game sprite for a vertical bullet-hell, strict top-down view seen from directly
above, facing DOWN toward the player below: {SUBJECT}. Silhouette built on one
sharply distinct motif — {SILHOUETTE MOTIF} — following a shape language of
spires, wings, hooks, horns, slabs and coils; it must be recognizable as a flat
shape alone, never "same hull, different tint". THE EDGE IS LIGHT: the entire
silhouette is carried by a self-luminous hostile rim-glow in a warm
red-magenta family tinted with the accent color {ACCENT}; there is NO drawn
outline; the interior is quiet dark mid-tone planes only, gilded-myth armor
suggested in broad dark shapes. MAXIMUM SIMPLICITY: compose the whole sprite
from at most 8 large flat shapes; no panel lines, no greebles, no engraved
texture, no ornament — any element that will not survive at final sprite size
must be omitted entirely. Sacred and ceremonial menace, never gory. Silhouette
must read instantly at small sprite size over a black field under additive
bloom. Deliver: PNG, 1:1 square, sprite centered, on a fully
TRANSPARENT ground — never white, never light gray, no backdrop of any kind.
Negative: no photorealism, no airbrushed or plastic gradients, no glossy 3D
render, no mixed mythological traditions, no ink outline, no paper grain, no
photoreal panel detail, no cool cyan or blue-white rim (that is the player's
family), no gore, no text or lettering, no busy particle noise, no background,
no watermark.
```

---

## Section 9 — Signature player-side sprites (AUTHORED COMBAT SPRITES, third clause)

Added 2026-07-18 with the kit rework (BOONS.md §2). The rework turned several
god weapons into **big, low-count signature objects** — a returning hammer, a
never-missing spear, ravens, a whirling labrys, scroll-edicts — and those earn
authored art where a 200-count bullet stream never will. Same third-clause
rules as Section 8: rim-glow instead of ink, dark mid-tone interior, transparent
ground, no grain. **Color law**: the player default is cool cyan/white, but a
signature keeps its GOD's body hue where BOONS.md assigns one — Ares' War-Heat
reds and the dread-wraiths are sanctioned god-hue exceptions (BOONS.md §2/§5),
so the per-subject RIM column is authoritative and overrides the "no warm
color" negative for those rows.

**What still never gets generated:** dense base streams (arrows, javelins fly
3+ per volley but are listed below because their silhouettes exceed what the
procedural atlas draws well — gen them small-readable), beams, the tidal wall,
the Bifröst band and dawn-seam, the Skyfall column, splinter shards, coil
rings, rune glyphs, status glyphs, all telegraphs and FX. **Engine retints,
not gens:** Wukong's hair-clones and Loki's Shadow-Twin are tinted copies of
the player ship (#31).

### 33. Signature projectile template

One templated prompt; generate each weapon by substituting `{SUBJECT}`,
`{ORIENTATION}`, `{RIM}` and `{READ SIZE}` from the table below.

```
Game sprite for a vertical bullet-hell: {SUBJECT} — a signature divine weapon
fired BY the player, shown alone as a single object, no figures, no hands, no
scene, {ORIENTATION}. This is a sacred relic-weapon of the gods: reliquary
craftsmanship, ceremonial, mythic — never sci-fi, never a machine. THE EDGE IS
LIGHT: the silhouette is carried by a self-luminous rim-glow in {RIM}; there is
NO drawn outline; the interior is quiet dark mid-tone planes with gilded-myth
detail suggested in broad dark shapes only. MAXIMUM SIMPLICITY: at most 8 large
flat shapes; no engraving, no filigree, no ornament smaller than the read size
below — omit it entirely rather than render it smaller. Silhouette must read instantly at
{READ SIZE} over a black field under additive bloom. Deliver: PNG, 1:1 square,
sprite centered, on a fully TRANSPARENT ground — never white, never light gray,
no backdrop of any kind. Negative: no photorealism, no airbrushed or plastic
gradients, no glossy 3D render, no mixed mythological traditions, no ink
outline, no paper grain, no figures or hands, no text or lettering, no busy
particle noise, no background, no watermark.
```

Substitutions:

| # | `{SUBJECT}` | `{ORIENTATION}` | `{RIM}` | `{READ SIZE}` |
| --- | --- | --- | --- | --- |
| 33.1 | MJÖLNIR, Thor's returning war-hammer — a massive square-cut iron head far too big for its short knot-carved haft | side profile, mid-tumble | storm-iron #8fb4d8 blending to white on the head's leading edges | ~48 pixels |
| 33.2 | GUNGNIR, Odin's never-missing spear — a long dark ash shaft with a narrow knotwork-etched iron head | nose UP, vertical | cold-iron #cfd6e0 blending to white at the point | ~96 pixels tall, slim |
| 33.3 | THE LABRYS of Ares — a double-headed bronze war-axe, two mirrored crescent heads on a short haft, unmistakable vs any single-crescent blade | spinning profile, radially symmetric | deep arterial red #ff5a6e with a bronze glint on the twin edges (sanctioned red — ignore any no-warm-color instinct) | ~40 pixels |
| 33.4 | AKONTIA of Ares — a slim thrown war-javelin with a small bronze leaf-point | nose UP, vertical | ember red, dark and smouldering (sanctioned red) | ~44 pixels tall, very slim |
| 33.5 | XIPHOS of Ares — a leaf-bladed short sword with the classic waisted swell profile, short cross-guard | nose UP, vertical | arterial red #ff5a6e with a bronze hilt glint (sanctioned red) | ~44 pixels tall |
| 33.6 | DORU BUNDLE of Ares — three hoplite spears braided into one heavy bolt, broad bronze heads staggered | nose UP, vertical | white-hot core with a red rim (sanctioned red) | ~56 pixels tall |
| 33.7 | **[HOLD — owner picking style A/B/C from in-game renders; gen ONLY the winner]** Style A (spec default): IMPERIAL EDICT of the Jade Emperor — a small rectangular scroll-talisman: violet tablet, thin gold border, one red seal-dot near the head, abstract vertical script ticks | nose UP, long axis vertical | imperial violet #c99aff with the gold #ffd766 border carrying the edge | ~40 pixels tall — the game's ONLY rectangular projectile; the right-angle corners are the read |
| 33.7-B | (alternate, gen only if picked) IMPERIAL EDICT — a long thin vertical edict BANNER unfurled mid-flight, trailing like a ribbon: violet silk, gold end-rods, one red seal-dot, abstract script ticks streaming | nose UP, ribbon trailing down | imperial violet #c99aff, gold #ffd766 end-rods | ~56 pixels tall, very slim — motion is the read |
| 33.7-C | (alternate, gen only if picked) IMPERIAL EDICT — a square imperial SEAL-STAMP chop flying face-first: bronze-backed violet seal block, carved gold seal-script face, red ink edge | face DOWN toward travel, square silhouette | imperial violet #c99aff, gold #ffd766 seal face | ~34 pixels — the crisp square is the read |
| 33.8 | THE LOOSED ARROW of Artemis — a great moon-silver hunting arrow, bright white head, two long trailing fletches | nose UP, vertical | moon-silver blending to white at the head | ~64 pixels tall |
| 33.9 | RUYI JINGU BANG, Wukong's wish-fulfilling staff — one long, perfectly straight dark-iron staff with thick burnished gold bands at both ends and a hairline gold seam down its length | vertical, full length filling the frame | gold #ffd766 on the bands, warm-white edge light down the dark shaft | must read as a clean hard-edged rectangle at any height — it is slammed down as a pillar |

### 34. Owned-entity sprite template

Player-summoned combatants. The engine draws a small breathing **cyan heart-gem**
at each entity's center (the friend-or-foe marker, BOONS.md §5) plus any halo —
so like the player ship, the sprite's center must stay dark and quiet.

```
Game sprite for a vertical bullet-hell, strict top-down view seen from directly
above, nose or head pointing UP (it fights FOR the player): {SUBJECT}. {BODY}.
THE EDGE IS LIGHT: the silhouette is carried by a self-luminous rim-glow in the
body hue given above; there is NO drawn outline; the interior is quiet dark
mid-tone planes. CRITICAL: the exact center of the body must stay dark, empty
and visually quiet — the game engine draws a small glowing heart-gem there and
it must read on top. Sacred and ceremonial, never cute, never gory. Silhouette
must read instantly at small sprite size over a black field under additive
bloom. Deliver: PNG, 1:1 square, sprite centered, on a fully TRANSPARENT ground
— never white, never light gray, no backdrop of any kind. Negative: no
photorealism, no airbrushed or plastic gradients, no glossy 3D render, no mixed
mythological traditions, no ink outline, no paper grain, no text or lettering,
no busy particle noise, no background, no watermark.
```

Substitutions:

| # | `{SUBJECT}` | `{BODY}` |
| --- | --- | --- |
| 34.1 | HUGINN / MUNINN — one of Odin's twin ravens in a hunting dive (generate once; the engine mirrors and reuses it for the pair) | near-black feathered body, wings swept back mid-dive, a cold-iron #cfd6e0 sheen along the feather edges; the engine adds the gold kill-count halo |
| 34.2 | PHOBOS & DEIMOS — one dread-wraith of Ares (generate once for the pair) | a thin vertical wraith of smoke and dread, hooded suggestion of a head, tattered trailing hem, dread-red #ff5a6e body (sanctioned god hue) |
| 34.3 | THUNDER-COURT STORM-CLOUD — one of the Jade Emperor's twin Leigong judgment clouds | a wide dark roiling cumulus slab, deep violet-black puffs edged in imperial violet #c99aff, a gold #ffd766 lightning under-flicker glowing in its belly |
| 34.4 | ZHAOYAOJING — the demon-revealing mirror of MIRROR REFLECTION | a small round burnished bronze disc hung frontally like an icon, gold #ffd766 rim, a faint cold gleam crossing its polished face, short mounting tassel below |
| 34.5 | SKY SERPENT head — the head of Quetzalcoatl's bullet-devouring hazard serpent | a flat codex-styled feathered serpent head, jaws open forward, streaming quetzal plumes swept back, turquoise #5affc0 body over obsidian dark planes (the engine draws the trailing coil procedurally) |
| 34.6 | **[HOLD — gen once the ultimate roster is ratified]** SOLAR BARQUE of Ra — the sun-god's night-boat crossing the top of the field (NOON OF THE DUAT ultimate) | a long low reed-boat in flat Egyptian profile, upswept prow and stern, a blazing sun-disc amidships, gold-leaf hull bands over dark planes, solar #ffe89a rim blending white at the disc; wide horizontal silhouette, reads while sweeping laterally |

Substitutions:

| # | `{SUBJECT}` | `{SILHOUETTE MOTIF}` | `{ACCENT}` |
| --- | --- | --- | --- |
| 32.1 | POPCORN drone — a tiny expendable swarm craft | a single small barbed dart, almost all rim | `#ff5a6e` |
| 32.2 | GUNSHIP — a mid-weight gun platform | a blunt horned slab with two under-slung cannon prongs | `#ff5a6e` |
| 32.3 | AEGIS SHIELDBEARER — a warded escort | a wide flat consecrated shield slab carried across its whole front edge, small body behind | `#ff8a5a` |
| 32.4 | WEAVER — one node of a tethered pair | a slender vertical spindle with two hook-arms reaching sideways toward its absent twin | `#ff5ae0` |
| 32.5 | GILDED MIMIC — a predator disguised as treasure (sanctioned exception: it must read as GOLD LOOT until it moves) | a plump faceted gold nugget-coin cluster, rim-glow in loot-gold #ffd766 with only a hairline hostile magenta seam hinting at the jaws | `#ffd766` |
| 32.6 | SPLITTER — a craft that breaks into copies | a segmented diamond visibly seamed down the middle into two mirrored halves | `#ff5a6e` |
| 32.7 | CHORUS ACOLYTE — a healer tending elites | a robed bell-shaped censer form with two thin raised prayer-prongs | `#ff77c8` |
| 32.8 | CARRIER HULK — a slow escort-spawning mass | a huge broken reliquary slab with open hangar notches along both flanks | `#ff8a5a` |
| 32.9 | BLINK MOTH — a teleporting skirmisher | two wide serrated moth wings around a barely-there body | `#ff5ae0` |
| 32.10 | BULLET GARDENER — a seeder of bullet gardens | a coiled thorned planter form trailing three seed-pod stems | `#ff77c8` |
| 32.11 | TALOS — field sprite of the bronze sentinel boss | a great open bronze ring with a single molten core-eye hub at its center | `#ff8a5a` |
| 32.12 | MIDAS — field sprite of the gilded king (final boss) | a gaunt crowned figure half-turned to gold, one grasping hand, a heaped hoard dragging at his feet | `#ffd766` (white-hot core reserved for its unavoidable attacks) |
| 32.13 | THE APOSTATE — field sprite of the renegade elite | a lean asymmetric duelist dart carrying two mismatched relic pods, one glowing warm and one cool (its stolen boons — the sole enemy permitted a cool glint) | `#ff5ae0` |
| 32.14 | AMMIT — field sprite of the devourer of hearts (boss) | a flat-profile tri-beast coil — crocodile jaws, lion forequarters, hippo bulk — wrapped around a set of tipped golden judgment scales (gold on the scales only, never on the beast) | `#ff5ae0` (bruised magenta with a sickly green undertone) |
| 32.15 | ASSESSOR — a jackal judgment-emitter orbiting AMMIT (retinue, spawns as a pair) | a jackal-masked censer node ringed by a thin counter-rotating judgment wheel of tally-notches | `#ff5ae0` |
| 32.16 | TRIBUTE BEARER — a porter of MIDAS's stolen gold (retinue) | a stooped hooded bearer hauling an open urn that visibly drinks coin-motes inward | `#ff8a5a` (warm amber — NEVER loot-gold #ffd766; only the urn's swallowed motes may glint gold) |
| 32.17 | GILDED COURTIER — an orbiting noble of MIDAS's Gilded Court (retinue) | a slim masked courtier slab, half-petrified in hardening gold, court-robe fanned into a stiff ceremonial silhouette | `#ff8a5a` |
| 32.18 | UNWEIGHED HEART — a soul-heart of AMMIT's tipping scales (retinue) | one large, slow, votive stylized heart bound in linen bandage-bands, rising | `#ff5ae0` |

(TALOS's orbiting RIVETS and BRONZE SPLINTERS stay procedural — too small to
carry authored art.)
