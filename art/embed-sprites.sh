#!/bin/bash
# embed-sprites.sh — regenerates js/sprites-data.js from art/sprites/*.png.
#
# Why: the game's canonical run mode is double-clicking index.html (file://).
# Chrome treats file:// image loads as cross-origin, so the direct PNG probe in
# js/gl.js taints the canvas there and the art silently falls back to the
# procedural sprite. Embedding each PNG as a data: URI sidesteps that — data:
# is same-origin everywhere.
#
# Usage: drop PNGs (slot-named: ship.png, enemy-pop.png, enemy-gun.png,
# enemy-mid.png, enemy-boss.png) into art/sprites/, then run:
#   bash art/embed-sprites.sh
set -e
cd "$(dirname "$0")/.."
out=js/sprites-data.js
{
  echo "// sprites-data.js — GENERATED registry of embedded sprite art (data: URIs)."
  echo "// Regenerate with \`art/embed-sprites.sh\` after dropping PNGs into art/sprites/."
  echo "// A data: URI is same-origin everywhere — including Chrome file://, where a"
  echo "// plain <img> file load taints the canvas and cannot reach the GPU — so any"
  echo "// entry here always overrides its procedural atlas cell. An empty registry"
  echo "// means the game renders fully procedurally (js/gl.js also probes"
  echo "// art/sprites/<slot>.png directly, which covers http:// and Firefox file://)."
  echo "// Slots: ship, enemy-pop, enemy-gun, enemy-mid, enemy-boss."
  echo "window.SPRITES = window.SPRITES || {};"
  shopt -s nullglob
  for f in art/sprites/*.png; do
    name=$(basename "$f" .png)
    b64=$(base64 -i "$f" | tr -d '\n')
    echo "window.SPRITES['$name'] = 'data:image/png;base64,$b64';"
  done
} > "$out"
echo "wrote $out ($(grep -c "^window.SPRITES\['" "$out" 2>/dev/null || echo 0) sprite(s) embedded)"
