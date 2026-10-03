'use strict';
// Native-Canvas production atlas audit; no GPU/browser verification.
// NODE_PATH=<bundled node_modules> node --test tests/verify-atlas-layout.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas, ImageData } = require('@napi-rs/canvas');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');

function atlasHarness() {
  const uploads = [];
  const gpu = {
    createTexture: () => ({}), bindTexture() {}, pixelStorei() {}, texParameteri() {},
    texImage2D(...args) { uploads.push({ kind: 'atlas', x: 0, y: 0, w: args[3], h: args[4], data: args[8] }); },
    texSubImage2D(...args) { uploads.push({ kind: 'cell', x: args[2], y: args[3], w: args[4], h: args[5], data: args[8] }); },
  };
  const ctx = { document: { createElement: () => createCanvas(1, 1) }, navigator: { userAgent: 'Chrome/' }, location: { protocol: 'file:' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  let source = fs.readFileSync(path.join(root, 'js/gl.js'), 'utf8');
  source = source.replace(/\}\)\(\);\s*$/, 'GL.audit = { authored, regions, cellRect, buildAtlas, loadAuthored, compositeSprite, setGpu: function(g) { gl = g; }, width: ATLAS_W, height: ATLAS_H };\n})();');
  vm.runInContext(source, ctx, { filename: 'js/gl.js' });
  const { GL } = ctx;
  GL.audit.setGpu(gpu);
  GL.audit.buildAtlas();
  GL.audit.loadAuthored(); // empty embedded registry: creates UVs without image probing
  return { GL, uploads };
}
function overlaps(a, b) { return a.x < b.x + b.size && a.x + a.size > b.x && a.y < b.y + b.size && a.y + a.size > b.y; }

test('every active atlas cell is unique, in bounds and disjoint; UVs sample its interior', () => {
  const { GL, uploads } = atlasHarness(), a = GL.audit;
  assert.equal(uploads[0].w, 2048); assert.equal(uploads[0].h, 2048);
  assert.equal(uploads[0].data.length, 2048 * 2048 * 4);
  const authoredIds = Object.values(a.authored).map(v => v.cell);
  assert.equal(new Set(authoredIds).size, authoredIds.length, 'authored definitions cannot silently overwrite each other');
  const ids = [...new Set([...Object.values(GL.SPR), ...authoredIds, ...Object.keys(a.regions).map(Number)])];
  for (const [i, id] of ids.entries()) {
    const r = a.cellRect(id), uv = a.regions[id];
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.size <= a.width && r.y + r.size <= a.height, `cell ${id} bounds`);
    assert.ok(uv, `cell ${id} has a renderable UV region`);
    assert.ok(uv[0] * a.width > r.x && uv[1] * a.height > r.y);
    assert.ok((uv[0] + uv[2]) * a.width < r.x + r.size && (uv[1] + uv[3]) * a.height < r.y + r.size);
    for (const other of ids.slice(i + 1)) assert.ok(!overlaps(r, a.cellRect(other)), `cells ${id}/${other} overlap`);
  }
  for (let id = 112; id <= 115; id++) assert.equal(a.cellRect(id).size, 512);
  for (let id = 144; id <= 150; id++) assert.equal(a.cellRect(id).size, 256);
  for (const id of ids.filter(id => !(id >= 112 && id <= 115) && !(id >= 144 && id <= 150))) assert.equal(a.cellRect(id).size, 128);
});

test('boss-sheet crops upload four independent 512px images and measure occupancy at their real resolution', () => {
  const { GL, uploads } = atlasHarness();
  const sheet = createCanvas(1024, 1024), c = sheet.getContext('2d');
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  for (let i = 0; i < 4; i++) { c.fillStyle = colors[i]; c.fillRect((i % 2) * 512 + 80, Math.floor(i / 2) * 512 + 80, 352, 352); }
  for (const [i, frame] of ['idle', 'prepare', 'release', 'recover'].entries()) {
    const cfg = GL.audit.authored[`talos-action-${frame}`];
    GL.audit.compositeSprite(cfg.cell, cfg.rot, sheet, 1, cfg.crop);
    const u = uploads.at(-1), r = GL.audit.cellRect(cfg.cell);
    assert.equal(u.w, 512); assert.equal(u.h, 512); assert.equal(u.x, r.x); assert.equal(u.y, r.y);
    assert.equal(u.data.length, 512 * 512 * 4);
    assert.deepEqual([...u.data.slice((256 * 512 + 256) * 4, (256 * 512 + 256) * 4 + 3)], expected[i], 'sheet frames must not bleed into one another');
    assert.ok(GL.sprFill(cfg.cell) > 1.3 && GL.sprFill(cfg.cell) < 1.7, 'fill uses512px, not legacy128px numerator');
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511]]) assert.equal(u.data[(y * 512 + x) * 4 + 3], 0);
  }
});

test('installed Talos sheet has nonempty transparent poses wholly inside each high-resolution cell', async () => {
  const { GL, uploads } = atlasHarness();
  const row = fs.readFileSync(path.join(root, 'art/sprite-overrides.tsv'), 'utf8').split('\n').find(s => s.startsWith('talos-action-sheet\t'));
  assert.ok(row, 'Talos sheet selected in embedded asset manifest');
  const [, file, rawScale] = row.split('\t');
  const { data, info } = await sharp(path.join(root, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const canvas = createCanvas(info.width, info.height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), info.width, info.height), 0, 0);
  for (const frame of ['idle', 'prepare', 'release', 'recover']) {
    const cfg = GL.audit.authored[`talos-action-${frame}`];
    GL.audit.compositeSprite(cfg.cell, cfg.rot, canvas, Number(rawScale || 1), cfg.crop);
    const u = uploads.at(-1);
    let opaque = 0, clear = 0, border = 0;
    for (let y = 0; y < u.h; y++) for (let x = 0; x < u.w; x++) {
      const alpha = u.data[(y * u.w + x) * 4 + 3];
      if (alpha > 24) { opaque++; if (x === 0 || y === 0 || x === u.w - 1 || y === u.h - 1) border++; }
      if (!alpha) clear++;
    }
    assert.ok(opaque > 1000 && clear > 1000, `${frame}: visible figure and transparent surround`);
    assert.equal(border, 0, `${frame}: no clipped subject at atlas boundary`);
  }
});

test('Talos draw selection follows combat poses and falls back without changing its collision body', () => {
  const { gameHarness } = require('./original-game.test.cjs');
  const { GL } = atlasHarness();
  const h = gameHarness(42, (s, file) => file === 'game.js' ? s.replace("  if (document.readyState === 'loading')", '  Game.auditDrawEnemies = drawEnemies;\n  if (document.readyState === \'loading\')') : s);
  const draws = [];
  h.context.GL.authoredSpr = GL.authoredSpr;
  h.context.GL.draw = (...args) => draws.push(args);
  h.context.GL.blendPremult = h.context.GL.blendAdditive = () => {};
  GL.audit.authored['32-11-talos'].ready = true;
  const index = h.Game.test.spawnTalos(), boss = h.Engine.enemies.items[index];
  h.Game.test.forceSize(index);
  const physical = () => JSON.stringify([boss.x, boss.y, boss.radius, boss.scale, boss.hp, boss.phase, boss.fireT, boss.poseT, boss.motionShot]);
  const before = physical();
  h.Game.auditDrawEnemies();
  assert.ok(draws.some(d => d[0] === GL.audit.authored['32-11-talos'].cell), 'unloaded sheet retains the complete static boss');
  assert.equal(physical(), before);
  for (const frame of ['idle', 'prepare', 'release', 'recover']) GL.audit.authored[`talos-action-${frame}`].ready = true;
  for (const [frame, poseT, motionShot] of [['idle', 0, 1], ['prepare', 0.2, 1], ['release', 0, 0.05], ['recover', 0, 0.2]]) {
    boss.poseT = poseT; boss.motionShot = motionShot; draws.length = 0;
    const snapshot = physical();
    h.Game.auditDrawEnemies();
    assert.ok(draws.some(d => d[0] === GL.audit.authored[`talos-action-${frame}`].cell), `draw uses ${frame} pose`);
    assert.equal(physical(), snapshot, `${frame} does not resize or advance the physical boss`);
  }
});

test('status atlas contains twelve isolated transparent drawings and six distinct flame silhouettes', () => {
  const { GL, uploads } = atlasHarness();
  const atlas = uploads[0], hashes = [];
  const { createHash } = require('node:crypto');
  const statusIds = [...Array.from({ length: 6 }, (_, i) => GL.SPR.STATUS_FIRE0 + i), GL.SPR.STATUS_HEART, GL.SPR.STATUS_FEAR, GL.SPR.STATUS_WEAK, GL.SPR.STATUS_STUN, GL.SPR.STATUS_BRACKET, GL.SPR.STATUS_TARGET];
  assert.equal(statusIds.length, 12);
  assert.equal(GL.audit.regions[139], undefined, 'retired atlas slot remains unused');
  for (const id of statusIds) {
    const r = GL.audit.cellRect(id), hash = createHash('sha256');
    let subject = 0, transparent = 0, edge = 0;
    for (let y = 0; y < r.size; y++) {
      const offset = ((r.y + y) * atlas.w + r.x) * 4;
      hash.update(atlas.data.subarray(offset, offset + r.size * 4));
      for (let x = 0; x < r.size; x++) {
        const alpha = atlas.data[offset + x * 4 + 3];
        if (alpha > 24) { subject++; if (!x || !y || x === r.size - 1 || y === r.size - 1) edge++; }
        if (!alpha) transparent++;
      }
    }
    assert.ok(subject > 50 && transparent > 500, `status cell ${id} has a visible shape and transparent surround`);
    assert.equal(edge, 0, `status cell ${id} has no edge bleed`);
    if (id < GL.SPR.STATUS_FIRE0 + 6) hashes.push(hash.digest('hex'));
  }
  assert.equal(hashes.length, 6);
  assert.equal(new Set(hashes).size, 6, 'flame animation changes actual painted pixels');
});

test('seven role-specific PNGs upload uncropped transparent figures into their dedicated 256px cells', async () => {
  const { GL, uploads } = atlasHarness();
  const manifest = new Map(fs.readFileSync(path.join(root, 'art/sprite-overrides.tsv'), 'utf8').split('\n').filter(Boolean).map(row => {
    const [slot, file, scale = '1'] = row.split('\t'); return [slot, { file, scale: Number(scale) }];
  }));
  const roles = Object.entries(GL.audit.authored).filter(([, cfg]) => cfg.cell >= 144 && cfg.cell <= 150);
  assert.equal(roles.length, 7);
  for (const [name, cfg] of roles) {
    const asset = manifest.get(name);
    assert.ok(asset, `${name} has an embedded-asset manifest selection`);
    const { data, info } = await sharp(path.join(root, asset.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const canvas = createCanvas(info.width, info.height);
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), info.width, info.height), 0, 0);
    GL.audit.compositeSprite(cfg.cell, cfg.rot, canvas, asset.scale);
    const u = uploads.at(-1), rect = GL.audit.cellRect(cfg.cell);
    assert.deepEqual([u.x, u.y, u.w, u.h], [rect.x, rect.y, 256, 256]);
    assert.equal(u.data.length, 256 * 256 * 4);
    let subject = 0, transparent = 0, paintedEdge = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const alpha = u.data[(y * 256 + x) * 4 + 3];
      if (alpha > 24) subject++;
      if (alpha === 0) transparent++;
      if (alpha > 0 && (!x || !y || x === 255 || y === 255)) paintedEdge++;
    }
    assert.ok(subject > 1000 && transparent > 1000, `${name} has a visible figure and transparent surround`);
    assert.equal(paintedEdge, 0, `${name} cannot clip even faint pixels at its atlas boundary`);
  }
});

test('Weak retains a solid pale shield and dark fracture at its actual 32-by-36 draw size', () => {
  const { GL, uploads } = atlasHarness(), atlas = uploads[0];
  const r = GL.audit.cellRect(GL.SPR.STATUS_WEAK);
  const rgba = new Uint8ClampedArray(r.size * r.size * 4);
  for (let y = 0; y < r.size; y++) {
    const start = ((r.y + y) * atlas.w + r.x) * 4;
    rgba.set(atlas.data.subarray(start, start + r.size * 4), y * r.size * 4);
  }
  const source = createCanvas(r.size, r.size);
  source.getContext('2d').putImageData(new ImageData(rgba, r.size, r.size), 0, 0);
  const rendered = createCanvas(32, 36), ctx = rendered.getContext('2d');
  ctx.drawImage(source, 1, 1, r.size - 2, r.size - 2, 0, 0, 32, 36);
  const data = ctx.getImageData(0, 0, 32, 36).data;
  let pale = 0, dark = 0, clear = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) clear++;
    if (data[i + 3] < 200) continue;
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (brightness > 170) pale++;
    if (brightness < 80) dark++;
  }
  assert.ok(pale > 100, 'shield has a substantial solid light fill');
  assert.ok(dark > 30, 'fracture and outline remain dark after normal downsampling');
  assert.ok(clear > 100, 'background remains transparent');
});
