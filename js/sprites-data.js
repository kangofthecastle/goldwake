// sprites-data.js — GENERATED registry of embedded sprite art (data: URIs).
// Regenerate with `art/embed-sprites.sh` after dropping PNGs into art/sprites/.
// A data: URI is same-origin everywhere — including Chrome file://, where a
// plain <img> file load taints the canvas and cannot reach the GPU — so any
// entry here always overrides its procedural atlas cell. An empty registry
// means the game renders fully procedurally (js/gl.js also probes
// art/sprites/<slot>.png directly, which covers http:// and Firefox file://).
// Slots: ship, enemy-pop, enemy-gun, enemy-mid, enemy-boss.
window.SPRITES = window.SPRITES || {};
