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
4 boss portraits (4) · 5 sector parallax sets (3 sectors × 3 layers = 9) · 6 shop dressing (1) ·
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
| D | §5 runtime parallax layers (3 sectors × deep/structure/debris) + §6 shop | 10 |
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

Full-composition pieces — title, emblems, every §3/§4 portrait, each backdrop
layer, shop — stay **one request each**: each needs full-frame resolution and
its own ground/alpha contract. Judgment call throughout: group only while
per-subject resolution stays comfortably above its read size.

For Batch B, **composition is universal across all pantheons** and rendering
style is consistent within each pantheon. First generate one non-deliverable
global composition anchor shared by all 15 cards, enforcing: the same apparent
56–64 px ornamental border thickness on all four sides; the same inner aperture
and margins; the same waist-up crop and head/torso scale; crown/top of head at
roughly 15–20% of canvas height, chin at 42–47%, shoulders spanning 65–75% of
canvas width; and every god's head angle and gaze turned toward **screen-left**
(the viewer's left). Props may sit beside or behind the bust but must not shrink,
duplicate, obscure or displace the subject. Then generate one non-deliverable
style anchor for each pantheon (Olympus, Asgard, Kemet, Celestial Court, Fifth
Sun). Use the global anchor for border/crop/pose and the pantheon anchor for
brushwork, facial simplification, value structure, outline system, materials and
tradition-specific ornament. The final 15 portraits remain separate full 2:3
requests. Reject any card whose frame band, bust scale or facing direction
visibly differs in an equal-size contact sheet.

The coordinator then: verifies all **84 delivered files** (36 direct + 48
template rows), enforces the filename and destination convention below,
spot-checks grounds and slice quality (a bad ground or a subject clipped by
slicing goes back to its subagent for a re-gen), and runs the embed step once
at the end.

**HOLD-flagged rows must be SKIPPED until their flag clears**: 33.7 (edict —
counts as one of the 84; gen only the style the owner picks, A, B, or C) and
34.6 (solar barque — additive, 84th file, gen once the ultimate roster is
ratified). A batch run before either flag clears delivers 82 files; clearing
only the edict flag brings the run to 83.

**COMBAT-SPRITE SIMPLICITY (Sections 8–9).** The first boss/elite field-sprite
gens came back too detailed for in-game size — over bloom, fine ornament reads
as noise. The sprite templates now steer toward bold, simple, few-large-shapes
output; when checking results, glance at each sprite near its in-game size and
re-gen any that read as texture rather than a shape, asking for fewer, larger,
flatter shapes. STORYBOOK portraits are exempt — that layer is allowed
intricacy.

Output convention:
- **Filename**: `<prompt#>[-<row#>]-<slug>.png`, e.g. `16-odin.png`,
  `33-1-mjolnir.png`, `30-10-huginn-muninn.png`.
- **Destination**: Section 8–9 combat sprites → `art/sprites/` — and the
  player ship additionally saved as the live slot name `ship.png` (other live
  slots: `enemy-pop`, `enemy-gun`, `enemy-mid`, `enemy-boss` — fill these from
  the matching #32 rows: popcorn, gunship, carrier-or-mid pick, boss). Section
  5 runtime layers → `art/backdrops/` under the exact live slot names given in
  §5. All other STORYBOOK assets (Sections 1–4 and 6–7) → `art/gen/` (staging;
  engine wiring is a separate pass).
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

### 1b. GAME OVER keyart

```
Painted illustration, storybook style: the aftermath of hubris — a small
broken ship silhouette sinking downward through dark water, its faint cyan
glow guttering out, while a thin stream of gold coins it carried scatters
upward away from it toward a distant uncaring crowned silhouette high above.
Game-native gilded iconography only: crown, coins, one small ship — no motifs
from any real-world mythology. CRITICAL COMPOSITION: the central band (middle
50% of the height) stays very dark and quiet for large text overlay;
concentrate detail at the extreme top and bottom. Somber, reliquary, never
gory. Palette: near-black ground #05080b, cold dim teal #6fa9b8 dominant, a
guttering cyan #5fe6ff glint on the ship, sparse gold #ffd766 coins, warm
near-black outline #231A20 with outer contours 3x interior weight, restrained
gold-leaf grain. Deliver: PNG, 9:16 portrait (1080x1920), on a near-black
#05080b ground — never white or light gray. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions, no pure black #000000, no gore or skulls, no text or lettering,
no busy particle noise, no bright detail in the center band, no watermark.
```

### 1c. VICTORY keyart — the king is felled

```
Painted illustration, storybook style: a colossal gaunt crowned figure of
hardened gold breaking apart from below — great cracked golden shards
drifting outward and UP off the top edge — while an unbroken torrent of
freed gold coins pours down both sides toward a small bright triumphant ship
rising through the middle distance on a column of cyan-white light.
Game-native gilded iconography only: crown, coins, light, one ship. CRITICAL
COMPOSITION: the central vertical column (middle 40% of the width) holds only
the small ship and its light — keep it dark enough for text overlay above and
below the ship; all gold detail at the edges and top. Triumphant, sacred,
gleaming. Palette: near-black ground #05080b, gold #ffd766 dominant at the
edges, cyan #5fe6ff and white on the ship's column of light, warm near-black
outline #231A20 with outer contours 3x interior weight, restrained gold-leaf
grain. Deliver: PNG, 9:16 portrait (1080x1920), on a near-black #05080b
ground — never white or light gray. Negative: no photorealism, no airbrushed
or plastic gradients, no glossy 3D render, no mixed mythological traditions,
no pure black #000000, no text or lettering, no busy particle noise, no
bright detail over the text zones, no watermark.
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

**Universal composition invariant for all 15 prompts:** use the same 56–64 px
outer ornamental frame band on every edge and the same waist-up bust scale:
head top at 15–20% of canvas height, chin at 42–47%, shoulders at 65–75% of
canvas width. Every god turns both head and gaze toward **screen-left / the
viewer's left**. Tradition changes the ornament and interior rendering, never
the border thickness, crop, occupied area or facing direction. Treat this
invariant as part of every fenced prompt below.

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
prop) planted forward; saturated deep sea-teal/turquoise scalp hair and beard
matching #4fe0e0, with only restrained pale sea-foam tips and highlights — never
predominantly white, ivory, gray or blond; humble rope-and-leather harness with one
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
Painted card portrait, storybook style: Ares, waist-up, alone, holding one notched
spear (his one iconic prop); battered bronze breastplate over humble patched
cloth, imperfect asymmetry — one missing cheek-guard. His Corinthian helmet
frames a clearly human face: keep both eyes deliberately recessed in natural
helmet shadow, matching the shadowed-eye treatment of the other Olympus cards;
the brow, nose and stern mouth remain readable at card size. Do not add glowing
eyes or expose the eyes more brightly than the face. Drawn in the
manner of Greek black-figure pottery and marble frieze; broad painted planes.
Must read by silhouette + spear + accent color at thumbnail size. Keep the
background almost entirely empty near-black #05080b, matching the other Olympus
cards, with no secondary silhouettes or figures. Palette: blood-red accent #ff5a6e,
gold #ffd766 on the helm crest, warm near-black outline #231A20 with the outer
contour 3x the weight of interior lines, restrained gold-leaf grain. Sacred and
terrible, never gory. Deliver: PNG, 2:3 portrait, on a transparent or near-black
#05080b ground — never white or light gray. Negative: no photorealism, no
airbrushed or plastic gradients, no glossy 3D render, no mixed mythological
traditions (Greek only), no pure black #000000, no gore, no text or lettering, no
busy particle noise, no wraiths, no silhouettes behind him, no extra figures, no
shield, no watermark.
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
asymmetry — the twin's outline is subtly wrong. Both faces use clearly open,
readable human eyes with visible lids, irises and pupils — never black slits or
blank bars — while staying simplified to the carved-wood style. Must read
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
His focused face has two clearly open, readable eyes with visible lids, irises
and pupils — never black slits or blank bars — plus a braced grin. Impossible
scale: the hammerhead reads far too
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
end vanishes past the card edge at impossible scale; show the main Wukong alone,
with no tiny hair-clone figures; drawn in the manner of Ming dynasty
court scroll painting — gold on jade, drifting cloud bands, a small imperial
seal-stamp in one corner. Humble pilgrim's cloth and rope belt under one gilded
shoulder plate, phoenix-feather cap, imperfect asymmetry — a torn cap feather.
Face irreverent, with two clearly open readable monkey eyes: visible lids,
irises and pupils, never black slits, bars or closed marks. Must read by
silhouette + staff + accent color at
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
marks. Impossible scale conveyed by the sentinel nearly filling the frame.
CARD-FAMILY INVARIANT: render this in the exact Olympus portrait language used
by Zeus through Ares — the same rectangular Greek meander border, black-figure
line economy, marble-and-bronze planar shading, dark value hierarchy and
restrained grain. Talos is a boss subject inside that established card system,
not a separate polished concept-art style.
Imperfect asymmetry — one cracked plate weeping a thread of
ichor-light. Broad painted planes, sacred and ceremonial, a reliquary that
fights. Must read as a flat silhouette at thumbnail size. Palette: near-black
ground #05080b, molten bronze-gold (hotter and redder than loot gold #ffd766)
dominant, danger red #ff5a6e in the core-eye
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
ceremonial menace, never gory — she is a verdict, not a monster. Impossible
scale conveyed by the tri-beast coil nearly filling the frame.
CARD-FAMILY INVARIANT: render this in the exact Kemet portrait language used by
Ra and Anubis — the same rectangular tomb-wall border construction, strict flat
profile geometry, lapis-and-gold value hierarchy, papyrus grain and 2-3-mark eye
treatment. Ammit is a boss subject inside that established card system, not a
separate decorative poster style.
Imperfect asymmetry — one chipped gilded scale-pan. Broad painted planes. Must
read as a flat silhouette at thumbnail size. Palette: near-black ground #05080b,
bruised magenta dominant with sickly green undertones on the beast, gold #ffd766
on the scales only, warm near-black outline
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
that tradition and no other. CARD-FAMILY INVARIANT: render this in the exact
Olympus portrait language used by Zeus through Ares — the same rectangular Greek
meander border, black-figure line economy, marble-and-bronze planar shading,
dark value hierarchy and restrained grain. Midas is a boss subject inside that
established card system, not a separate gilded poster style. Impossible scale
conveyed by the figure and hoard
nearly filling the frame. Imperfect asymmetry — one shoulder fully petrified and cracking, coins
spilling loose. Broad painted planes; avaricious, starving, tragic — a king
drowned in his own wealth, never grimy. Must read as a flat silhouette at
thumbnail size. Palette: near-black ground #05080b, gold #ffd766 utterly
dominant, a warm rose #ff5a6e accent in the shadows and grasping-hand glow, warm
near-black outline #231A20 with the outer contour
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

## Section 5 — Runtime sector parallax layers (3 sectors × deep/structure/debris)

Each sector is one staged living environment built from three simultaneous,
independently choreographed textures. The renderer scrolls every texture with
`fract(v_uv)`, so **every image must tile seamlessly top-to-bottom**. These are
not sequential scenes and must contain no baked approach/passage/threshold
landmarks. The level creates its journey by changing layer opacity, speed and
darkness across the wave arc.

**Shared contract (treat as part of every prompt):** Painted backdrop layer for
a vertical bullet-hell playfield, storybook style. Deliver exactly one PNG,
9:16 portrait, 1080×1920. Extreme dark value range; nothing above a dim
mid-tone. Preserve the middle 50% of the width as quiet negative space for the
player and dense glowing bullets. Put structural weight at the side edges. Use
large flat painted masses, minimal localized texture and no false lanes. The
top edge must continue perfectly into the bottom edge when vertically repeated.
No text or watermark. No photorealism, airbrushed/plastic gradients, glossy 3D,
mixed mythological traditions, bright central detail, busy particle noise or
white/light ground.

For **deep** layers: opaque near-black atmospheric ground, no alpha, no
structures or landmarks. For **structure** and **debris** layers: isolate the
painted subjects over perfectly flat solid `#00ff00` chroma green — no gradient,
shadow, texture or spill in the green and no green in the subjects — then remove
the green to deliver a transparent RGBA PNG. Transparent corners and center are
mandatory. Do not leave green pixels in the delivered file.

### 26. SECTOR 1 — THE BRONZE COAST / TALOS

Greek only: carved marble frieze and black-figure pottery manner. Dim
desaturated bronze, marble-ivory, sea-green and moss; faint restrained gold
`#ffd766`; warm near-black painted outlines `#231A20`.

#### 26.1 DEEP — `art/backdrops/s1-deep.png`

```
Paint an opaque deep-atmosphere layer for THE BRONZE COAST: moonless sea haze,
subtle horizon-free swells and faint cold sea glow suspended in near-black
#05080b. It should feel like open water at night without depicting a shoreline,
ship, island, architecture, statue or landmark. Keep the center quiet and dark.
Make the top and bottom edges match perfectly for seamless vertical repetition.
Apply the Section 5 shared contract. Deliver opaque RGB/RGBA PNG with no
transparent pixels at art/backdrops/s1-deep.png.
```

#### 26.2 STRUCTURE — `art/backdrops/s1-structure.png`

```
Paint a transparent structure layer for THE BRONZE COAST: fragmented bronze
colonnades, cropped colossus limbs and pieces of guarded-island marble
architecture forming two sparse irregular edge banks. Keep every form confined
to the outer left and right quarters; nothing spans the playfield and the center
50% stays completely empty. No intact character, ship, gate or single dominant
landmark. Shapes must continue seamlessly from top to bottom. Generate over a
perfectly flat solid #00ff00 chroma ground for removal, with no green in the
painted subjects. Apply the Section 5 shared contract. Remove chroma and deliver
transparent RGBA PNG at art/backdrops/s1-structure.png.
```

#### 26.3 DEBRIS — `art/backdrops/s1-debris.png`

```
Paint a transparent sparse debris layer for THE BRONZE COAST: a few tiny pieces
of wreck-gold, salt-spray curls and dim ember flecks drifting mainly along the
outer edges. Keep density very low, vary spacing broadly and leave the center
50% completely empty; no ships, hulls, silhouettes, large objects or particle
wall. The distribution must continue seamlessly top-to-bottom. Generate over a
perfectly flat solid #00ff00 chroma ground for removal, with no green in the
subjects. Apply the Section 5 shared contract. Remove chroma and deliver
transparent RGBA PNG at art/backdrops/s1-debris.png.
```

### 27. SECTOR 2 — THE RIVER OF NIGHT / AMMIT

Egyptian only: tomb-wall painting and papyrus manner, flat profile forms and
gold leaf on lapis. Dim lapis, oxidized turquoise and tomb-gold `#e8c46a`;
warm near-black painted outlines `#231A20`.

#### 27.1 DEEP — `art/backdrops/s2-deep.png`

```
Paint an opaque deep-atmosphere layer for THE RIVER OF NIGHT: lapis-black Duat
darkness with a broad nearly black central river channel, faint flat ripples and
subtle blue depth at the far side edges. No banks, reeds, architecture,
guardians, boats, symbols or landmark. Keep the center exceptionally quiet and
dark. Make the top and bottom edges match perfectly for seamless vertical
repetition. Apply the Section 5 shared contract. Deliver opaque RGB/RGBA PNG
with no transparent pixels at art/backdrops/s2-deep.png.
```

#### 27.2 STRUCTURE — `art/backdrops/s2-structure.png`

```
Paint a transparent structure layer for THE RIVER OF NIGHT: broken tomb-wall
riverbanks, cropped pylon fragments and occasional partial seated guardians in
flat Egyptian profile, arranged as sparse edge banks. Confine everything to the
outer left and right quarters so the center 50% remains a completely empty dark
river channel. No spanning gate, Hall of Judgment doorway, scales centerpiece
or single dominant landmark. Shapes must continue seamlessly top-to-bottom.
Generate over a perfectly flat solid #00ff00 chroma ground for removal, with no
green in the subjects. Apply the Section 5 shared contract. Remove chroma and
deliver transparent RGBA PNG at art/backdrops/s2-structure.png.
```

#### 27.3 DEBRIS — `art/backdrops/s2-debris.png`

```
Paint a transparent sparse debris layer for THE RIVER OF NIGHT: a few small
papyrus scraps, tomb-dust wisps and dim gold-leaf flecks drifting near the side
edges. Keep density very low and the center 50% completely empty; no boats,
human figures, hieroglyph text, symbols, large objects or particle wall. The
distribution must continue seamlessly top-to-bottom. Generate over a perfectly
flat solid #00ff00 chroma ground for removal, with no green in the subjects.
Apply the Section 5 shared contract. Remove chroma and deliver transparent RGBA
PNG at art/backdrops/s2-debris.png.
```

### 28. SECTOR 3 — THE GILDED COURT / MIDAS

Chinese imperial only: Ming court-scroll manner, cloud bands, gold-on-jade,
curtains and palace lattice. Dim jade and imperial violet `#c99aff`, restrained
gold `#ffd766`; warm near-black painted outlines `#231A20`.

#### 28.1 DEEP — `art/backdrops/s3-deep.png`

```
Paint an opaque deep-atmosphere layer for THE GILDED COURT: a violet-black cloud
void with broad dim cloud currents and barely visible vertical depth in
near-black #05080b. It should suggest impossible altitude without a horizon,
palace, terrace, stairs, lanterns, throne or landmark. Keep the center quiet and
dark. Make the top and bottom edges match perfectly for seamless vertical
repetition. Apply the Section 5 shared contract. Deliver opaque RGB/RGBA PNG
with no transparent pixels at art/backdrops/s3-deep.png.
```

#### 28.2 STRUCTURE — `art/backdrops/s3-structure.png`

```
Paint a transparent structure layer for THE GILDED COURT: stacked cropped jade
balustrades, hanging curtain edges and fragments of imperial palace lattice,
arranged as sparse asymmetric side architecture. Confine every form to the
outer left and right quarters; the center 50% stays completely empty. No stairs,
censer, dais, throne, readable edict, spanning arch or single dominant landmark.
Shapes must continue seamlessly top-to-bottom. Generate over a perfectly flat
solid #00ff00 chroma ground for removal, with no green in the subjects. Apply
the Section 5 shared contract. Remove chroma and deliver transparent RGBA PNG at
art/backdrops/s3-structure.png.
```

#### 28.3 DEBRIS — `art/backdrops/s3-debris.png`

```
Paint a transparent sparse debris layer for THE GILDED COURT: a few tiny coin
glints, torn unreadable edict-paper scraps and faint gilded dust drifting near
the outer edges. Keep density very low and the center 50% completely empty; no
readable writing, treasure heaps, figures, large objects or particle wall. The
distribution must continue seamlessly top-to-bottom. Generate over a perfectly
flat solid #00ff00 chroma ground for removal, with no green in the subjects.
Apply the Section 5 shared contract. Remove chroma and deliver transparent RGBA
PNG at art/backdrops/s3-debris.png.
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
outline; the interior is quiet dark mid-tone planes, with gilded-myth armor
resolved into a restrained hierarchy of broad beveled plates and inset shapes.
Keep the outer silhouette bold and instantly legible, then add a moderate
authored detail tier: a handful of large armor panels, one clear central motif,
at most a few bounded seams or trim lines and restrained material highlights.
Use smooth flat color regions with no etched surface texture. It should feel like a
polished action-game sprite, not a bare geometric icon and not a miniature
painting. Sacred and ceremonial menace, never gory. Silhouette must
read instantly at small sprite size over a black field under additive bloom. Deliver: PNG, 1:1 square, sprite centered, on a fully
TRANSPARENT ground — never white, never light gray, no backdrop of any kind.
Negative: no photorealism, no airbrushed or plastic gradients, no glossy 3D
render, no mixed mythological traditions, no ink outline, no paper grain, no
photoreal panel detail, no cool cyan or blue-white rim (that is the player's
family), no gore, no text or lettering, no busy particle noise, no background,
no watermark.
```

**Section 32 detail tiers:** rows 32.1–32.10 use roughly 3–6 major interior
shapes after the silhouette. Boss/elite rows 32.11–32.18 use roughly 5–9 broad
major plates/forms, at most two depth tiers, one strong central emblem or face
read, and only 2–4 internal seam/trim lines. Match the clean detail density of
a polished arcade action-game sprite sheet: smooth large color blocks, readable
construction, no etched textures. Near in-game size they must collapse into one
clean silhouette plus 2–4 readable internal masses. Never reduce a boss to an
empty symbol, and never add hairline filigree, individual coin/scale/feather
detail, texture noise or uncontrolled bloom.

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
rings, telegraphs, and pure-motion FX. **Carve-out (owner 2026-07-19):**
symbolic identity-marks and the burn flame are generated after all — see
**Section 10** (rune sheet, status-mark sheet, flame flipbook). **Engine
retints, not gens:** Wukong's hair-clones and Loki's Shadow-Twin are tinted
copies of the player ship (#31).

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
detail suggested in broad dark shapes only. Keep it bold and simple — a few
large clean shapes, smooth quiet surfaces, no fine engraving or filigree; the
weapon should read in one glance at game size. Silhouette must read instantly at
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
| 33.10 | GREEN DRAGON CRESCENT of Guan Yu — a single cleaving crescent blade cut from the guandao's head: one deep jade crescent with a dragon-spine ridge along its back edge and a small gold collar at the tang; unmistakably ONE curved blade (never a double-axe — that silhouette is the labrys) | cleaving profile, crescent horns leading | jade #3be089 blending to white along the cutting edge, gold #ffd766 collar glint | ~44 pixels; also rendered colossal for CRESCENT MOON SWEEP and as the linked blade-segments of the GREEN DRAGON ASCENDS ultimate |
| 33.11 | HUNT ARROW of Artemis — her everyday arrow-needle: slim straight shaft, small bright head, two short fletches; the humble sibling of the Loosed Arrow (33.8), clearly the same fletcher's work at a third the size | nose UP, vertical | silver-white body, moon-blue rim | ~24 pixels tall, very slim — flies 3-4 per volley |
| 33.12 | ANKH BOLT of Anubis — a small thrown ankh, loop leading: the cross-arms are the fins, the loop is the head; a judgment cast at the living | loop UP, vertical | warm amber #e8c46a blending gold at the loop | ~28 pixels tall |
| 33.13 | RUNE-BOLT of Odin — one heavy blunt bolt of dark iron carved with a single stave-rune glowing along its length; slow, weighty, inevitable | nose UP, vertical | steel-blue #8fb4d8 body, the carved rune line glowing pale gold | ~34 pixels tall, thick |
| 33.14 | HEARTSEEKER of Aphrodite — a slow seeking heart: one plump stylized heart shape with two small trailing silk ribbons, votive and ornamental, never a cartoon valentine | point DOWN (it weaves), ribbons trailing up | hot magenta #ff77c8 blending white at the cleft | ~36 pixels |

### 34. Owned-entity sprite template

Player-summoned combatants. The engine draws a small breathing **cyan heart-gem**
at each entity's center (the friend-or-foe marker, BOONS.md §5) plus any halo —
so like the player ship, the sprite's center must stay dark and quiet.

```
Game sprite for a vertical bullet-hell, strict top-down view seen from directly
above, nose or head pointing UP (it fights FOR the player): {SUBJECT}. {BODY}.
THE EDGE IS LIGHT: the silhouette is carried by a self-luminous rim-glow in the
body hue given above; there is NO drawn outline; the interior is quiet dark
mid-tone planes. Keep it bold and simple — a few large clean shapes, broad
masses rather than feather-by-feather or ornament detail; it should read in
one glance at game size. CRITICAL: the exact center of the body must stay dark, empty
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
| 34.5 | SKY SERPENT head — the head of Quetzalcoatl's bullet-devouring hazard serpent | a flat codex-styled feathered serpent head, jaws open forward, streaming quetzal plumes swept back, turquoise #5affc0 body over obsidian dark planes |
| 34.5b | SKY SERPENT body segment — one repeatable coil segment continuing the head (34.5): same girth at its joints, feather ridge along the top edge, plume tufts at the trailing joint; MUST tile seamlessly nose-to-tail with copies of itself (gen with 34.5 as reference for continuity) | turquoise #5affc0 over obsidian planes, feather ridge highlights |
| 34.5c | SKY SERPENT tail tip — the tapering final segment ending in a long quetzal plume fan (continuity with 34.5/34.5b) | turquoise #5affc0, plume fan brightest at the tips |
| 34.7 | GREEN DRAGON head — the head of Guan Yu's ascended blade-dragon (GREEN DRAGON ASCENDS ultimate): a Chinese dragon head in flat profile, jaws open, antler prongs swept back, mane flowing into where the crescent blade-segments (33.10) trail behind | jade #3be089 over dark planes, gold #ffd766 antler + eye glints |
| 34.6 | SOLAR BARQUE of Ra — the sun-god's night-boat crossing the top of the field (NOON OF THE DUAT ultimate; HOLD CLEARED — roster ratified + built) | a long low reed-boat in flat Egyptian profile, upswept prow and stern, a blazing sun-disc amidships, gold-leaf hull bands over dark planes, solar #ffe89a rim blending white at the disc; wide horizontal silhouette, reads while sweeping laterally |

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
| 32.14 | AMMIT — field sprite of the devourer of hearts (boss) | a flat-profile tri-beast coil — crocodile jaws, lion forequarters, hippo bulk — closing around one dark empty central void; NO judgment scales, balance, pans, weights or other prop | `#ff5ae0` (bruised magenta with a sickly green undertone) |
| 32.15 | ASSESSOR — a jackal judgment-emitter orbiting AMMIT (retinue, spawns as a pair) | a jackal-masked censer node ringed by a thin counter-rotating judgment wheel of tally-notches | `#ff5ae0` |
| 32.16 | TRIBUTE BEARER — a porter of MIDAS's stolen gold (retinue) | a stooped hooded bearer hauling an open urn that visibly drinks coin-motes inward | `#ff8a5a` (warm amber — NEVER loot-gold #ffd766; only the urn's swallowed motes may glint gold) |
| 32.17 | GILDED COURTIER — an orbiting noble of MIDAS's Gilded Court (retinue) | a slim masked courtier slab, half-petrified in hardening gold, court-robe fanned into a stiff ceremonial silhouette | `#ff8a5a` |
| 32.18 | UNWEIGHED HEART — a soul-heart of AMMIT's tipping scales (retinue) | one large, slow, votive stylized heart bound in linen bandage-bands, rising | `#ff5ae0` |

(TALOS's orbiting RIVETS and BRONZE SPLINTERS stay procedural — too small to
carry authored art.)

---

## Section 10 — Glyph & flame sheets (owner 2026-07-19: "did we image gen some of the status stuff eg runes… or being on fire")

Symbolic identity-marks earn authored art even at 10–20px — they are SYMBOLS
whose whole job is to be read and counted, unlike motion-FX which stay
procedural. All three prompts are **sheet gens** (one image, evenly-spaced
grid, generous margins, fully separated cells, transparent ground) sliced into
individual files after. Marks must be **near-solid flat shapes with no
gradients and no fine interior detail** — they render tiny, over enemies,
under bloom; the engine tints and glows them, so deliver them as crisp
light-on-transparent stamps. Procedural fallback stays live until wired.

### 35. Rune sheet — Odin's NINE NIGHTS

```
Sprite sheet for a vertical bullet-hell, 3x3 grid on a fully TRANSPARENT
ground: nine distinct carved Norse runes in the Elder Futhark style — angular,
stave-based, no curves, each built from 2-4 bold straight strokes as if
chisel-carved. Each rune is a single near-solid flat glowing mark, pale gold,
no gradients, no outline, no decoration, no background; every rune clearly
different from the others at a glance. These render at ~12 pixels tall on
enemy hulls in-game: maximum boldness, zero fine detail. Even spacing, wide
margins, nothing touching cell edges. Negative: no photorealism, no 3D, no
texture, no knotwork ornament, no text or lettering other than the rune
shapes themselves, no watermark, no background of any kind.
```

Deliver sliced as `35-1-rune.png` … `35-9-rune.png` (order = carve order; the
9th is THE NINTH RUNE and may be ~15% bolder than the rest).

### 36. Status-mark sheet — identity glyphs

```
Sprite sheet for a vertical bullet-hell, single row of SIX cells on a fully
TRANSPARENT ground, each cell one flat symbolic mark, near-solid, no
gradients, no outlines, no backgrounds, built to read at ~14 pixels: (1) a
tiny balance scales tipping LEFT, gold; (2) the same scales LEVEL, gold; (3)
the same scales tipping RIGHT harder, gold — three tip-states of one scales
glyph, identical construction, only the beam angle changes; (4) a triskele of
three tiny curved daggers radiating from a center point, green; (5) one
crisp right-angle corner bracket like a picture-frame corner, amber; (6) a
small square imperial seal-stamp mark with one notch, violet. Even spacing,
wide margins, nothing touching cell edges. Negative: no photorealism, no 3D,
no texture, no fine interior detail, no text, no watermark, no background.
```

Deliver sliced as `36-1-scales-a.png`, `36-2-scales-b.png`,
`36-3-scales-c.png` (Anubis THE WEIGHING tip-states), `36-4-triskele.png`
(Loki MISCHIEF), `36-5-bracket.png` (MARKED corner, engine places 4 rotated
copies), `36-6-seal.png` (Jade seal brand).

### 36b. The Verdict stamp — Anubis' devour

```
Single sprite for a vertical bullet-hell on a fully TRANSPARENT ground: a
jackal head in strict flat Egyptian profile, jaws open wide about to snap
shut — one near-solid silhouette, black body with a single gold eye-line and
a gold collar band, drawn like a tomb-wall glyph: bold, flat, no gradients,
no texture, no background. It flashes over a devoured foe for a fifth of a
second at ~80 pixels: silhouette carries everything. Negative: no
photorealism, no 3D, no gore, no fine detail, no text, no watermark, no
background.
```

Deliver as `36-7-verdict-jackal.png`; the engine scales it up over the foe
and snaps the jaw shut (two-frame rotation of the lower jaw is acceptable as
a second cell `36-8-verdict-jackal-shut.png` if one gen produces both).

### 37. Flame flipbook — BURN / on-fire

```
Sprite sheet for a vertical bullet-hell, single row of SIX cells on a fully
TRANSPARENT ground: one small flame tongue in six consecutive animation
frames — a looping cycle of the same flame licking upward, frame to frame the
tip sways and a spark detaches and dies. Bold simple flame silhouette,
near-solid: white-yellow core filling most of the body, brief red-orange tip,
no gradients beyond that two-tone read, no smoke, no glow halo (the engine
adds bloom), no background. Each flame ~5x wider margins than its body;
frames identical in size and base position so they cycle cleanly at 12
frames per second. Built to read at ~16 pixels tall. Negative: no
photorealism, no 3D, no texture, no embers cloud, no text, no watermark, no
background.
```

Deliver sliced as `37-1-flame.png` … `37-6-flame.png`; the engine cycles
~12Hz at the UNDERFOOT status zone (§4 BOONS.md), and may stack 2-3 offset
copies for heavily burning or boss-scale foes.
