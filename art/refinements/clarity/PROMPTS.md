# Clarity pass — 2026-10-02

Generated with the built-in image generation tool, editing the original sprites with transparent backgrounds. Hades and 33 Immortals inform clear shapes and restrained detail; Jamestown informs the environmental journey. Dead Cells is explicitly excluded from the reference direction.

Originals remain in `art/sprites/`. `art/sprite-overrides.tsv` selects the red hawk and version 3 gunship for the embedded registry. The optional third column preserves normalized dominant sprite span: gunship uses `(330/428)/(1082/1254)` to retain original atlas collision compensation; hawk uses `(959/1254)/(1135/1254)` to retain the previous sentry's maximum visible dimension. Alpha bounds are measured above 24. Prior variants below are retained for comparison. Run `bash art/embed-sprites.sh` after changing that selection.

## Gunship

### Rejected concept: bronze bull (not active)

Input style/edit reference: `gunship-v3.png`. Rejected output: `bronze-bull-v1.png`. Built-in image generation; transparent.

Use case: precise-object-edit. Transform this gunship into an unmistakable bronze BULL automaton for the same minimal top-down shooter. Retain burgundy red flat color language, chipped left horn and two short mounted cannon barrels pointing down. Replace the anonymous central hull with a clearly readable bull head: broad forehead, two sideways ears beneath horns, two small eyes set wide apart, massive blunt square muzzle with TWO obvious dark nostrils. Head faces bottom of canvas. Keep bull anatomy dominant, cannons smaller mounted outside cheeks. Short heavy neck/shoulder plate at top; no wings, fins, spaceship prow, gold chevrons, jewelry or ornament. One horn tip broken, slight asymmetry, stubborn weight and character. SIMPLE 8-12 broad flat color shapes, burgundy red with dull bronze muzzle and horn tips, strong slightly hand-drawn dark contour, single shadow plane, no gradients, metallic gloss, texture, glow, tiny grooves or sci-fi details. Must instantly read as a bull before it reads as a war machine, readable at 80px. Entire character centered on genuine transparent square background, generous margins, fills around 80 percent height. Single game sprite, no text or scenery.

### Version 3: simpler, with character

Input: `art/refinements/clarity/gunship-v2.png`. Output: `art/refinements/clarity/gunship-v3.png`. Built-in image generation, transparent background.

Edit this exact top-down game enemy sprite into a simpler, characterful version in the same minimal red and burgundy visual language. Keep recognizable squat hull, two horns and two downward-facing cannons. It should feel like a stubborn battered little war machine, not a symmetrical fancy AI emblem. Give the left horn a blunt broken tip and the right horn a slight outward crook; make one cannon housing slightly wider with a single rough repair band, other cannon plain. Keep both muzzle centers pointing down clearly. Remove gold skull/face/crest, all decorative gold chevrons, filigree and most cannon rings. No face or eyes. Use only a few large flat burgundy, muted red and dull bronze shapes, confident slightly irregular hand-drawn contours and a single shadow plane. Personality through purposeful asymmetry, heavy proportions and two visible chips, NOT added ornament or random details. No photoreal bevels, gradients, texture, glow, tiny lines, background, text. Single complete sprite on transparent square canvas, generous padding, occupies around 85 percent of canvas height.

### Version 2

Input: `art/sprites/32-2-gunship.png`.
Output: `art/refinements/clarity/gunship-v2.png`.

Use case: precise-object-edit. Edit target: the supplied HUBRIS enemy gunship sprite. Create a better, clearer version for the SAME top-down vertical bullet-hell game. Keep its recognizable bilateral horned silhouette, two forward cannons aimed straight DOWN, dark burgundy armored body, restrained bronze details and narrow crimson luminous edge. Improve execution toward the bold, clean hand-drawn shapes and controlled flat shading of Hades and 33 Immortals, while preserving this game's existing minimal visual language. NOT pixel art. Make it immediately read as a small flying bronze war machine: one simple armor plate above, two distinct cannon barrels below, horns/swept fins at the upper shoulders. Remove the tiny central skull-like ornament and yellow outer halo, reduce fussy seams to 3 or4 meaningful broad facets. Clean confident edges, dark body planes with readable warm highlights, crisp restrained red edge light, no soft airbrushed glow cloud. Cannons must visually belong to the hull and have two clearly visible dark muzzle openings pointed down. Orthographic straight overhead, centered, symmetric, no perspective tilt. Single static idle enemy sprite; no bullets, smoke, text, background, frame or additional objects. Genuine transparent background. Square canvas; full ship occupies approximately75% of height and55% width with clear margins. Do not crop horns or barrels.

## Sentry

### Recognizable identity: red hawk

Input style reference: `sentry-v3.png`. Active output: `red-hawk-v1.png`. Built-in image generation; transparent.

Use case: style-transfer. Input is a STYLE reference only for minimal flat red/burgundy game art; replace the abstract dagger entirely with a recognizable red hawk in flight, a real bird anatomy silhouette. Single enemy sprite for a top-down vertical shooter, head and hooked beak pointing DOWN, short tail at TOP, two feathered wings spreading diagonally toward upper corners. Round small head, visible hooked ivory beak, two tiny tucked talons beside belly, each wing only three broad feather lobes. One wing has a missing outer feather, slightly asymmetrical confident pose. The bird must unmistakably read as a bird at 48 pixels, not a spaceship, symbol, jewelry, robotic bird or weapon. Very simple confident flat shapes, dark burgundy body, muted red wings and warm pale beak, one dark shadow plane, dark crisp slightly handmade outline. No gold trim, filigree, gems, gradients, glow or texture. Not pixel art. Entire bird centered on transparent square background, fills approximately 78 percent canvas height and 78 percent width. No scenery, text or extra objects.

### Version 3: simpler, with character

Input: `art/refinements/clarity/sentry-v2.png`. Output: `art/refinements/clarity/sentry-v3.png`. Built-in image generation, transparent background.

Edit this game enemy into a much simpler and characterful little spear sentry. Same minimal red/dark burgundy palette and downward orientation. Discard the ornate dagger jewelry: remove ALL gold, round rings, collars, gems, stars, holes, engraved lines, nested outlines and extra spikes. A lean battered spear-shaped flying creature/machine, with a slightly crooked downward triangular spearhead, one broad shadow facet, a single small nick in its blade edge, compact plain dark shoulder body and two short fins: one stubby squared fin and one slightly swept fin. A tiny off-center red slit in the body suggests alertness without a cartoon face. It feels wiry and scrappy through its distinctive proportions and subtle asymmetry. Intentional hand-drawn crisp slightly irregular contours, 5 or 6 large flat shapes, no tiny decorative lines or random texture. NOT a symmetrical AI emblem, ornate weapon, jewelry or glossy 3D render. No gradients, glow, scene, text or border. Single complete sprite centered on genuinely transparent square canvas, occupying about 76 percent canvas height. Minimal and readable when tiny.

### Version 2

Input: `art/sprites/enemy-pop.png`.
Output: `art/refinements/clarity/sentry-v2.png`.

Use case: precise-object-edit. Edit target: existing HUBRIS tiny enemy sprite supplied. Improve this exact enemy identity from an ambiguous decorative red symbol into a readable small airborne spear sentry in the same minimal top-down bullet-hell visual language. Preserve the vertical red spearhead silhouette, central circular crimson lens, bilateral small shoulder fins and bronze trim; ship points straight DOWN. Make a compact central armored flying body around the lens, short swept angular fins and a broad clean downward-pointing spear prow containing ONE evident firing aperture. Clear at48 pixels tall. Bold clean hand-drawn silhouette and controlled flat shadow planes, inspired by the clarity of Hades and33 Immortals, NOT pixel art; retain dark burgundy, red energy and restrained warm bronze palette of the reference. Reduce ornament, remove yellow halo, no skull or face, no intricate engraving. Only3 or4 broad facets, narrow red edge light not broad bloom. Orthographic overhead, symmetric, no perspective tilt. One isolated idle sprite, no attacks, effects, ground shadow, text, UI or background. Genuine transparent background. Square canvas; sprite fills75% canvas height and45% width, clean generous transparent margins, no cropping.
