# Reference-guided infantry — October 2

Generated with the built-in image generation tool. Original PNGs are retained; selected sheets are embedded through `art/sprite-overrides.tsv`.

## References actually inspected

- [33 Immortals official small character sprite](https://thunderlotusgames.com/wp-content/uploads/2024/02/player_idle_gif_00001.png): sparse angular clothing, broad flat shapes, thin dark contour. Direct style input, not copied into the game.
- [33 Immortals official wardrobe screenshot](https://thunderlotusgames.com/wp-content/uploads/2024/02/Crossbows_Weapon_Wardrobe-1-576x324.png): weapon separation and clear equipment identity.
- [Hades combat screenshot](https://i.gzn.jp/img/2021/05/01/hades/03.png): warm distinct bodies against darker floors, readable attack posture.
- [Jamestown+ screenshot](https://image.api.playstation.com/cdn/UP2141/CUSA01008_00/FREE_CONTENTRLvtHZGXVQuNJfYMoPkC/PREVIEW_SCREENSHOT7_75471.jpg): structural depth and inhabited terrain beneath the flight path.

Only the 33 Immortals small character is a generation input; the other images inform visual review. No third-party game art is shipped.

## Archer first pass

Create an original game enemy sprite sheet. The input image is a STYLE REFERENCE from 33 Immortals: match its economical flat color shapes, angular silhouette, thin dark contour, almost empty interiors and exaggerated readable proportions. Do not copy the character. Subject: an ancient Greek foot archer, short rust-red tunic, simple bronze open helmet, dark legs, large recognizable wooden bow. Slightly hunched alert posture, skinny neck, confident angular nose, one trailing tunic corner. Five flat colors, one shadow shape per garment at most. At actual play size character is 45 pixels high, so sparse detail is essential. NO elaborate armor, gold trim, muscles, texture, hatching, gradients, decorative insignia, realistic anatomy rendering, stickers, pedestal, glow. Four same-character full-body poses on a square transparent 2x2 sprite sheet, centered in equal cells with generous clear margins and identical scale: top left idle holding bow; top right drawing bow with bent knees; bottom left releasing arrow, bow arm extended; bottom right mid-stride patrolling. Viewed from slightly above, facing screen-down/right. Each pose stays in its cell. No text or grid lines. This is production animation art, not a character concept illustration.

## Archer framing correction

Edit this exact sprite sheet; preserve the flat angular minimalist drawing and colors. Production correction only: remove the flying arrow entirely from the bottom-left release pose (the game draws its own projectile). Keep that pose's outstretched bow arm and release hand. Recenter every figure inside its own equal 2x2 cell, with feet on the same relative baseline in all cells, and identical head/body size. Bottom-right walking soldier should be same head/body size as top-left, not larger. Keep all pixels at least 40px from cell boundaries, no crossing center seams. All 4 poses must be complete, unclipped. True transparent background. No other changes.

## Spearman

Selected output: `infantry-spearman-sheet-v2.png`. The exact generation prompt
was not retained in this sidecar. The sheet uses the same flat, restrained
infantry direction with idle, preparation, release and walking poses.
