'use strict';
// Offline framing check using the REAL production 128px compositor/alpha scan.
// NODE_PATH=<bundled node_modules> node tests/verify-art-framing.cjs [--plan|--write] [slot ...]
// Default checks current TSV metadata. --plan proposes exact-raster matches.
// --write applies those proposals only after every selected image passes.
// Originals, PNG files, unrelated TSV rows and embedded data are never changed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createCanvas, ImageData } = require('@napi-rs/canvas');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const tsvPath = path.join(root, 'art/sprite-overrides.tsv');
const allowed = new Set(['moth', 'weaver', 'aegis', 'acolyte', 'splitter', 'carrier', 'gardener', 'talos', 'ammit', 'apostate', 'midas', 'assessor', 'tribute', 'mimic'].map(n => `art/refinements/clarity/${n}-reference-v1.png`));
const args = process.argv.slice(2);
const write = args.includes('--write'), plan = write || args.includes('--plan');
assert.ok(!args.some(a => a.startsWith('--') && !['--write', '--plan'].includes(a)), 'unknown option');
const selected = new Set(args.filter(a => !a.startsWith('--')));
const requested = new Set(selected);

function compositor() {
  const context = { document: { createElement: () => createCanvas(1, 1) } };
  context.window = context;
  vm.createContext(context);
  let source = fs.readFileSync(path.join(root, 'js/gl.js'), 'utf8');
  const marker = '    var rc = cellRect(cell);\n    gl.bindTexture';
  assert.equal(source.split(marker).length - 1, 1, 'production compositor hook changed');
  source = source.replace(marker, '    return off;\n' + marker);
  source = source.replace(/\}\)\(\);\s*$/, 'GL.framingComposite = compositeSprite;\n})();');
  vm.runInContext(source, context, { filename: 'js/gl.js' });
  return context.GL;
}
function bounds(data, width, height, threshold = 24) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1, transparent = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = data[(y * width + x) * 4 + 3];
    if (alpha === 0) transparent++;
    if (alpha > threshold) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { x0, y0, x1, y1, span: Math.max(x1 - x0 + 1, y1 - y0 + 1), transparent };
}
async function decode(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const box = bounds(data, info.width, info.height);
  assert.ok(box.span > 0 && box.transparent > 0, `${file}: nonempty transparent RGBA art required`);
  assert.ok(box.x0 > 0 && box.y0 > 0 && box.x1 < info.width - 1 && box.y1 < info.height - 1, `${file}: source subject touches image edge`);
  const canvas = createCanvas(info.width, info.height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), info.width, info.height), 0, 0);
  return canvas;
}
function checkClipping(img, scale, slot) {
  // Paint beyond the atlas cell with exactly the same source scale, rotation,
  // integer-center alignment and filtering; catch pixels discarded by cropping.
  const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d');
  const sc = Math.min(124 / img.width, 124 / img.height) * scale;
  const w = img.width * sc, h = img.height * sc;
  ctx.translate(128, 128); ctx.rotate(Math.PI);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  const data = ctx.getImageData(0, 0, 256, 256).data;
  let clipped = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    if ((x < 64 || x >= 192 || y < 64 || y >= 192) && data[(y * 256 + x) * 4 + 3] > 0) clipped++;
  }
  assert.equal(clipped, 0, `${slot}: frameScale clips painted pixels at the atlas boundary`);
}
function chooseScale(render, target) {
  // Find the plateau producing the original dominant alpha span, then choose
  // its interior so float serialization cannot tip it over a raster boundary.
  let lo = 0.05, hi = 2;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (render(mid).span >= target) hi = mid; else lo = mid; }
  const lower = hi;
  lo = lower; hi = 2;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (render(mid).span > target) hi = mid; else lo = mid; }
  const scale = Number(((lower + lo) / 2).toFixed(12));
  if (render(scale).span === target) return scale;
  // Rasterization can occasionally be non-monotonic by a pixel. Search the
  // immediate transition deterministically rather than silently accepting drift.
  for (let i = 1; i <= 1000; i++) for (const sign of [-1, 1]) {
    const candidate = Number((lower + sign * i * 0.0001).toFixed(12));
    if (candidate > 0 && candidate <= 2 && render(candidate).span === target) return candidate;
  }
  throw new Error(`cannot match original ${target}px alpha span without changing framing policy`);
}
async function main() {
  const originalText = fs.readFileSync(tsvPath, 'utf8');
  const lines = originalText.split('\n');
  const GL = compositor(), reports = [];
  for (let i = 0; i < lines.length; i++) {
    const [slot, file, rawScale = '1'] = lines[i].split('\t');
    if (!allowed.has(file) || (selected.size && !selected.has(slot))) continue;
    requested.delete(slot);
    const oldImg = await decode(path.join(root, 'art/sprites', `${slot}.png`));
    const newImg = await decode(path.join(root, file));
    const render = (img, scale) => {
      const cv = GL.framingComposite(0, Math.PI, img, scale);
      const data = cv.getContext('2d').getImageData(0, 0, 128, 128).data;
      return { ...bounds(data, 128, 128), fill: GL.sprFill(0) };
    };
    const original = render(oldImg, 1);
    const scale = plan ? chooseScale(s => render(newImg, s), original.span) : Number(rawScale);
    assert.ok(Number.isFinite(scale) && scale > 0 && scale <= 2, `${slot}: invalid frameScale`);
    const replacement = render(newImg, scale);
    assert.equal(replacement.span, original.span, `${slot}: atlas occupancy differs; run --plan or --write`);
    assert.equal(replacement.fill, original.fill, `${slot}: GL.sprFill (and collision sizing) differs`);
    checkClipping(newImg, scale, slot);
    reports.push({ slot, frameScale: scale, alphaSpan: original.span, originalFill: original.fill, replacementFill: replacement.fill, clippedPixels: 0 });
    if (write) lines[i] = `${slot}\t${file}\t${scale}`;
  }
  assert.equal(requested.size, 0, `requested slots missing or outside reference asset scope: ${[...requested]}`);
  assert.ok(reports.length > 0, 'no installed reference overrides to verify');
  if (write) {
    assert.equal(fs.readFileSync(tsvPath, 'utf8'), originalText, 'TSV changed during verification; retry after asset installation');
    fs.writeFileSync(tsvPath, lines.join('\n'));
  }
  for (const report of reports) console.log(JSON.stringify(report));
  console.log(`${reports.length} reference overrides ${write ? 'normalized and verified' : plan ? 'planned and verified (no writes)' : 'verified'} with exact native-Canvas atlas occupancy; PNGs unchanged.`);
}
main().catch(err => { console.error(err.stack); process.exitCode = 1; });
