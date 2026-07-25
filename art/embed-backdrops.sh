#!/bin/bash
# embed-backdrops.sh — regenerate js/backdrops-data.js for Chrome file:// play.
#
# Chromium treats local files as opaque origins, so WebGL cannot upload the
# otherwise valid environment and landmark images as textures. Data URIs are
# same-origin everywhere and let the static game retain its authored world art
# without requiring a local HTTP server.
set -e
cd "$(dirname "$0")/.."

out=js/backdrops-data.js
{
  echo "// backdrops-data.js — GENERATED active environment and landmark registry."
  echo "// Regenerate with \`art/embed-backdrops.sh\` after changing active world art."
  echo "window.BACKDROPS = window.BACKDROPS || {};"

  embed() {
    local slot="$1" path="$2" mime="$3"
    local b64
    b64=$(base64 -i "$path" | tr -d '\n')
    echo "window.BACKDROPS['$slot'] = 'data:$mime;base64,$b64';"
  }

  base=art/environment-variants/sparse-detail/browser
  embed s1-scene1 "$base/s1-01-shattered-fleet.avif" image/avif
  embed s1-scene2 "$base/s1-02-flooded-colonnade.avif" image/avif
  embed s1-scene3 "$base/s1-03-talos-forge.avif" image/avif
  embed s2-scene1 "$base/s2-01-dead-reed-delta.avif" image/avif
  embed s2-scene2 "$base/s2-02-processional-kings.avif" image/avif
  embed s2-scene3 "$base/s2-03-hall-of-scales.avif" image/avif
  embed s3-scene1 "$base/s3-01-cloud-garden.avif" image/avif
  embed s3-scene2 "$base/s3-02-jade-causeway.avif" image/avif
  embed s3-scene3 "$base/s3-03-throne-terraces.avif" image/avif

  base=art/landmark-variants/sparse-detail/browser
  embed s1-landmark "$base/s1-bronze-crossing.png" image/png
  embed s2-landmark "$base/s2-funerary-crossing.png" image/png
  embed s3-landmark "$base/s3-jade-crossing.png" image/png
} > "$out"

echo "wrote $out ($(grep -c "^window.BACKDROPS\\['" "$out" 2>/dev/null || echo 0) texture(s) embedded)"
