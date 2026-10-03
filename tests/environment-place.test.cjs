'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gameHarness } = require('./original-game.test.cjs');
function placeHarness() {
  return gameHarness(42, (source, filename) => filename === 'game.js'
    ? source.replace("  if (document.readyState === 'loading')", "  Game.placeTest = { makeBackground, makeDestinationLandmark, environmentFlowLane, drawEnvironmentLandmark, drawBackground };\n  if (document.readyState === 'loading')")
    : source);
}

test('currents bend continuously around each crossing without changing its collision geometry', () => {
  const { Game } = placeHarness();
  for (let sector = 0; sector < 3; sector++) for (let crossing = 0; crossing < 3; crossing++) {
    const b = Game.placeTest.makeBackground(sector);
    const lm = Game.placeTest.makeDestinationLandmark(sector, crossing);
    b.obstacles = lm.obstacles;
    const before = JSON.stringify(lm);
    const top = Math.min(...lm.obstacles.map(o => o.y));
    const bottom = Math.max(...lm.obstacles.map(o => o.y + o.h));
    let prev = Game.placeTest.environmentFlowLane(b, top - 301);
    assert.equal(prev.left, 0); assert.equal(prev.right, 1080);
    for (let y = top - 300; y <= bottom + 301; y++) {
      const lane = Game.placeTest.environmentFlowLane(b, y);
      assert.ok(lane.width >= 270, 'ambient flow retains the route opening');
      assert.ok(lane.left >= 0 && lane.right <= 1080);
      assert.ok(Math.abs(lane.left - prev.left) < 5 && Math.abs(lane.right - prev.right) < 5, 'no sideways scenery snap');
      prev = lane;
    }
    assert.equal(JSON.stringify(lm), before, 'flow is visual only');
  }
});

test('architectural depth reuses the visible silhouette below the unchanged physical landmark', () => {
  const h = placeHarness(), { Game } = h;
  h.context.GL.backdropReady = () => true;
  for (let sector = 0; sector < 3; sector++) {
    const b = Game.placeTest.makeBackground(sector);
    b.landmark = Game.placeTest.makeDestinationLandmark(sector, 1);
    Game.st().bg = b;
    const before = JSON.stringify(b.landmark);
    const draws = [];
    h.context.GL.drawBackdrop = (...args) => draws.push(args);
    Game.placeTest.drawEnvironmentLandmark();
    assert.equal(draws.length, 2);
    const [shadow, body] = draws;
    assert.equal(shadow[0], body[0], 'shadow follows authored alpha');
    assert.equal(shadow[3], body[3]); assert.equal(shadow[4], body[4]);
    assert.ok(shadow[2] > body[2] && shadow[2] - body[2] <= 28);
    assert.ok(shadow[8] < body[8], 'shadow remains subordinate');
    assert.equal(body[1], b.landmark.x);
    assert.equal(body[2], b.landmark.y + b.landmark.h / 2);
    assert.equal(JSON.stringify(b.landmark), before);
    assert.equal(b.landmark.supportsInfantry, sector !== 2, 'no sky infantry');
  }
});


test('destination strip crossfades only shared edges without bright overlap bands', () => {
  const h = placeHarness(), { Game } = h;
  const b = Game.placeTest.makeBackground(1);
  Game.st().bg = b;
  b.routeY = b.sceneSpan;
  b.bright = 0.6; b.dimFactor = 0.8;
  h.context.GL.backdropReady = name => name.includes('-scene');
  h.context.GL.draw = () => {};
  const draws = [];
  h.context.GL.drawBackdrop = (...args) => draws.push(args);
  Game.placeTest.drawBackground();
  assert.equal(draws.length, 3, 'fixture sees all overlapping destination plates');
  const overlap = (b.scenePlateH - b.sceneSpan) / b.scenePlateH;
  for (let i = 0; i < draws.length; i++) {
    const d = draws[i];
    assert.equal(d[8], 1, 'opaque layer alpha keeps source-over weights normalized');
    assert.equal(d[13], 0, 'no exposed top fade');
    assert.equal(d[14], i === 0 ? 0 : overlap, 'only incoming lower edge feathers');
    assert.ok(Math.abs(d[5] - 0.78 * 0.6 * 0.8 * 0.9) < 1e-12, 'brightness is applied once in tint');
  }
  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  for (let route = 0; route <= 2 * b.sceneSpan; route += b.sceneSpan / 20) {
    for (let y = 0; y <= 1920; y += 24) {
      let coverage = 0;
      for (let i = 0; i < 3; i++) {
        const top = 960 + route - i * b.sceneSpan - b.scenePlateH / 2;
        const v = (y - top) / b.scenePlateH;
        if (v < 0 || v > 1) continue;
        const alpha = i === 0 ? 1 : smooth((1 - v) / overlap);
        coverage = alpha + coverage * (1 - alpha);
      }
      assert.ok(coverage > 0.999999, `no strip hole at route ${route}, y ${y}`);
    }
  }
});
