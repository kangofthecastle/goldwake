# Environment art variants

Every generated environment pass is retained here so a style comparison never
requires regenerating an image.

| Variant | Character |
| --- | --- |
| `flat` | The simplest clean-plane pass. |
| `high-detail` | The original dense rendered pass. |
| `storybook` | The later richly textured pass. |
| `sparse-detail` | Clean planes plus object-specific details such as wakes, seams, ripples, banners, and inlays. |

Each variant contains:

- `source/`: the original generated PNGs (and, where retained, their 1080×1920
  conversion).
- `browser/`: 1080×1920 AVIF files ready for the game.

The active set is selected by `environmentVariant` in `js/gl.js`. Change only
that string to `flat`, `high-detail`, `storybook`, or `sparse-detail`; the nine
runtime slots keep the same filenames.

The legacy files in `art/environments/` are also retained. They are the
pre-archive `storybook` browser set.
