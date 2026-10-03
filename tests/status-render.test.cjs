'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { gameHarness } = require('./original-game.test.cjs');

function statusHarness(boss = false) {
  const h = gameHarness(42, (source, file) => file === 'game.js'
    ? source.replace("  if (document.readyState === 'loading')", '  Game.auditStatus = drawStatus;\n  if (document.readyState === \'loading\')') : source);
  const atlas = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js/gl.js'), 'utf8'), atlas);
  Object.assign(h.context.GL.SPR, atlas.window.GL.SPR);
  const draws = [], blends = [];
  h.context.GL.draw = (...args) => draws.push(args);
  h.context.GL.blendPremult = () => blends.push('premult');
  h.context.GL.blendAdditive = () => blends.push('additive');
  const index = h.Game.test.spawnDummy(540, 700, 10000);
  const enemy = h.Engine.enemies.items[index];
  enemy.boss = boss; enemy.scale = boss ? 680 : 90;
  function render(time = 0) {
    draws.length = 0; blends.length = 0;
    h.Game.st().time = time;
    const before = JSON.stringify(enemy);
    h.Game.auditStatus(enemy);
    assert.equal(JSON.stringify(enemy), before, 'status drawing must not mutate combat state');
    return draws.map(row => [...row]);
  }
  return { ...h, enemy, draws, blends, render, spr: h.context.GL.SPR };
}

for (const boss of [false, true]) {
  test(`${boss ? 'boss' : 'normal enemy'} statuses render without glow or oversized quads and restore blending`, () => {
    const statuses = [{ burnT: 1 }, { marked: true }, { weak: true }, { stunT: 1 }, { charmed: true }, { terrorT: 1 }];
    for (const fields of [...statuses, Object.assign({}, ...statuses)]) {
      const h = statusHarness(boss);
      Object.assign(h.enemy, fields);
      const draws = h.render();
      assert.ok(draws.length, `visible feedback for ${JSON.stringify(fields)}`);
      for (const d of draws) {
        assert.notEqual(d[0], h.spr.GLOW, 'status cannot add glow discs');
        assert.ok(d[0] >= h.spr.STATUS_FIRE0 && d[0] <= h.spr.STATUS_TARGET && d[0] !== 139, 'use the status atlas, not legacy flames or FX sprites');
        assert.ok(d.slice(1).every(Number.isFinite), 'draw arguments stay finite');
        assert.ok(Math.abs(d[3]) <= 56 && Math.abs(d[4]) <= 56, 'status marker size is capped independently of boss scale');
      }
      assert.equal(h.blends[0], 'premult');
      assert.equal(h.blends.at(-1), 'additive', 'subsequent effects retain normal blend mode');
    }
  });

  test(`${boss ? 'boss' : 'normal enemy'} burn crossfades with steady coverage and fixed body roots`, () => {
    const h = statusHarness(boss); h.enemy.burnT = 5;
    const times = [0, 0.025, 0.05, 0.099999, 0.100001, 0.11, 0.23, 0.37, 0.51];
    const frames = times.map(t => h.render(t));
    const geometry = d => JSON.stringify(d.slice(1, 9));
    const originalRoots = frames[0].map(geometry);
    assert.equal(frames[0].length, boss ? 3 : 2, 'zero-mix poses need only one draw per patch');
    assert.equal(frames[2].length, boss ? 6 : 4, 'halfway transitions use two drawings per patch');
    for (const draw of frames) {
      const patches = new Map();
      for (const d of draw) {
        assert.ok(d[0] >= h.spr.STATUS_FIRE0 && d[0] < h.spr.STATUS_FIRE0 + 6);
        assert.ok(Math.abs(d[1] - h.enemy.x) < h.enemy.scale * 0.5);
        assert.ok(Math.abs(d[2] - h.enemy.y) < h.enemy.scale * 0.5, 'fire stays attached to the body');
        const key = geometry(d);
        if (!patches.has(key)) patches.set(key, []);
        patches.get(key).push(d);
      }
      assert.deepEqual([...patches.keys()], originalRoots, 'crossfading cannot move or inflate a patch');
      for (const layers of patches.values()) {
        assert.ok(layers.length === 1 || layers.length === 2);
        let coverage = 0;
        for (const d of layers) {
          assert.ok(d[9] >= 0 && d[9] <= 1);
          coverage = d[9] + coverage * (1 - d[9]);
        }
        assert.ok(Math.abs(coverage - 0.96) < 0.0001, 'source-over shared coverage stays steady through the blend');
        if (layers.length === 2) assert.equal(layers[1][0], h.spr.STATUS_FIRE0 + (layers[0][0] - h.spr.STATUS_FIRE0 + 1) % 6, 'crossfade only adjacent poses');
      }
    }
    assert.ok(new Set(frames.map(draw => draw[0][0])).size > 1, 'actual flipbook frame changes');
  });

  test(`${boss ? 'boss' : 'normal enemy'} marked and weak coexist centrally while fear stays off the target`, () => {
    const h = statusHarness(boss);
    Object.assign(h.enemy, { marked: true, weak: true, terrorT: 2 });
    const draws = h.render();
    const target = draws.find(d => d[0] === h.spr.STATUS_TARGET);
    const weak = draws.find(d => d[0] === h.spr.STATUS_WEAK);
    assert.ok(target && weak, 'both statuses remain visible');
    assert.deepEqual(target.slice(1, 5), [h.enemy.x, h.enemy.y, 48, 48]);
    assert.deepEqual(weak.slice(1, 5), [h.enemy.x, h.enemy.y, 32, 36]);
    assert.equal(draws.filter(d => d[0] === h.spr.STATUS_BRACKET).length, 4);
    const stress = draws.filter(d => d[0] === h.spr.STATUS_FEAR);
    assert.equal(stress.length, 2, 'both shoulders carry Terror so it remains readable in a crowd');
    assert.ok(stress[0][1] < h.enemy.x && stress[1][1] > h.enemy.x);
    assert.ok(stress[0][3] > 0 && stress[1][3] < 0, 'right stroke reflects the unchanged left stroke');
    assert.equal(stress[0][3], -stress[1][3]);
    assert.equal(stress[0][5], -stress[1][5], 'rotations reflect across the enemy centre');
    for (const mark of stress) {
      assert.ok(mark[2] < h.enemy.y);
      assert.ok(Math.abs(mark[3]) >= 24 && Math.abs(mark[3]) <= 30 && mark[4] >= 33);
      assert.equal(mark[9], 1);
    }
    h.enemy.weak = false;
    assert.deepEqual(h.render().find(d => d[0] === h.spr.STATUS_TARGET).slice(3, 5), [40, 40], 'target stays compact without Weak');
  });
}

test('an enemy without statuses emits no status draw calls', () => {
  const h = statusHarness();
  assert.deepEqual(h.render(), []);
});

test('fear, marked, weak, stun and charm feedback do not strobe opacity or inflate over time', () => {
  for (const fields of [{ terrorT: 5 }, { marked: true }, { weak: true }, { stunT: 5 }, { charmed: true }]) {
    const h = statusHarness(); Object.assign(h.enemy, fields);
    const initial = h.render(0).map(d => [d[0], d[3], d[4], d[9]]);
    for (const t of [0.025, 0.05, 0.10, 0.15, 0.3]) {
      assert.deepEqual(h.render(t).map(d => [d[0], d[3], d[4], d[9]]), initial, `steady dimensions and opacity for ${JSON.stringify(fields)}`);
    }
  }
});
