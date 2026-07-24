# Landmark art variants

The original densely rendered landmark WebPs remain in `art/landmarks/`.

The active `sparse-detail` set lives here:

- `sparse-detail/source/`: generated chroma-key PNGs retained for future edits.
- `sparse-detail/browser/`: transparent runtime PNGs after chroma-key removal.

The active set is selected by `landmarkVariant` in `js/gl.js`. Landmark geometry
and collision remain defined independently in `js/game.js`; swapping these
images does not change the open channel or collision volumes.
