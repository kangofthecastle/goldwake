'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gameHarness } = require('./original-game.test.cjs');

// Exercise the real actor/status/reward paths without adding production hooks.
function fixture(sector = 0, crossing = 1) {
  const h = gameHarness(42, (source, file) => file === 'game.js'
    ? source.replace("  if (document.readyState === 'loading')", "  Game.infantryTest = { makeDestinationLandmark, spawnLandmarkInfantry, infantryBankSpan, updateEnemies, detectClear };\n  if (document.readyState === 'loading')") : source);
  h.Game.setMode('playing');
  h.api = h.Game.infantryTest;
  h.lm = h.api.makeDestinationLandmark(sector, crossing);
  h.lm.y = 250;
  h.Game.st().bg.sector = sector;
  h.Game.st().bg.landmark = h.lm;
  h.Game.st().bg.obstacles = h.lm.obstacles;
  h.api.spawnLandmarkInfantry(h.lm);
  h.guards = h.Engine.enemies.items.filter(e => e.active && e.ground);
  assert.ok(h.guards.length >= 2, 'fixture must contain both infantry roles');
  return h;
}
function advance(h, frames) { for (let i = 0; i < frames; i++) h.api.updateEnemies(1 / 60); }

for (const sector of [0, 1]) {
  test(`sector ${sector + 1} infantry patrols remain on their physical bank`, () => {
    const h = fixture(sector);
    const start = new Map(h.guards.map(e => [e, e.x]));
    let moved = false;
    for (let i = 0; i < 480; i++) {
      advance(h, 1);
      for (const e of h.guards) {
        assert.ok(e.active);
        const ob = h.lm.obstacles.find(o => o.dy + o.h * 0.5 === e.ground.footY);
        const span = h.api.infantryBankSpan(ob, e.ground.footY);
        // Two banks may share a foot line: select the span containing the spawn.
        const spans = h.lm.obstacles.map(o => h.api.infantryBankSpan(o, e.ground.footY));
        assert.ok(spans.some(s => e.x >= s[0] && e.x <= s[1]), `guard left masonry: ${e.x}, ${span}`);
        assert.ok(Math.abs(e.x - e.ground.baseX) <= e.ground.patrol + 1e-8);
        if (e.arch === 'archer') assert.equal(e.x, start.get(e), 'stationary archer cannot drift');
        if (Math.abs(e.x - start.get(e)) > 8) moved = true;
        assert.ok(Math.abs(e.y + 28 - h.lm.y - e.ground.footY) < 1e-8);
      }
    }
    assert.ok(moved, 'spear infantry actually patrols');
  });
}

for (const status of ['stun', 'terror', 'charm']) {
  test(`${status} does not detach infantry from scrolling terrain`, () => {
    const h = fixture();
    const e = h.guards.find(e => e.arch === 'spearman');
    const x = e.x;
    // A distant live target prevents charm expiry during the transport check.
    h.Game.test.spawnDummy(900, 1100, 10000);
    if (status === 'charm') { e.charmed = true; e.charmT = 10; }
    else e[status === 'stun' ? 'stunT' : 'terrorT'] = 10;
    for (let i = 0; i < 60; i++) {
      h.lm.y += 1.8;
      advance(h, 1);
      assert.ok(e.active);
      assert.ok(Math.abs(e.y + 28 - h.lm.y - e.ground.footY - e.dispY) < 1e-8);
    }
    if (status !== 'terror') assert.equal(e.x, x, 'disabled/charmed infantry cannot fly toward targets');
  });
}

test('archer and spear attacks visibly prepare and commit their aim before release', () => {
  for (const arch of ['archer', 'spearman']) {
    const h = fixture();
    const e = h.guards.find(e => e.arch === arch);
    for (const other of h.guards) if (other !== e) h.Engine.enemies.release(other);
    e.ground.cooldown = 0;
    advance(h, 1);
    assert.equal(h.Engine.bullets.count(), 0);
    assert.ok(e.ground.windup >= 0.5);
    const aim = e.ground.aim;
    h.Game.test.setPlayer(40, 1700);
    advance(h, 20);
    assert.equal(h.Engine.bullets.count(), 0, 'no projectile during opening windup');
    assert.equal(e.ground.aim, aim, 'telegraphed aim cannot track a dodging player');
    advance(h, 25);
    assert.equal(h.Engine.bullets.count(), 1);
    const bullet = h.Engine.bullets.items.find(b => b.active);
    assert.ok(Math.abs(bullet.dir - aim) < 1e-8);
    assert.equal(bullet.ownerId, e.seq, 'projectile ownership must survive pooled actor identity');
  }
});

test('offscreen guards cancel prepared attacks and cannot shoot from outside the field', () => {
  for (const y of [-1500, 1800]) {
    const h = fixture();
    for (const e of h.guards) { e.ground.cooldown = 0; e.ground.windup = 0.01; }
    h.lm.y = y;
    advance(h, 90);
    assert.equal(h.Engine.bullets.count(), 0);
  }
});

test('stun and terror suppress attacks, including a pending release', () => {
  for (const field of ['stunT', 'terrorT']) {
    const h = fixture();
    for (const e of h.guards) { e[field] = 5; e.ground.windup = 0.01; }
    advance(h, 60);
    assert.equal(h.Engine.bullets.count(), 0);
  }
});

test('infantry kills reward once; terrain retirement releases without rewards', () => {
  const h = fixture();
  const e = h.guards[0], st = h.Game.st();
  const before = st.score;
  h.Game.test.kill(e._i);
  assert.ok(st.score > before);
  assert.ok(h.Engine.gold.count() > 0);
  const reward = [st.score, h.Engine.gold.count()];
  h.Game.test.kill(e._i);
  assert.deepEqual([st.score, h.Engine.gold.count()], reward);
  st.bg.landmark = null;
  advance(h, 1);
  assert.equal(h.Engine.enemies.count(), 0);
  assert.deepEqual([st.score, h.Engine.gold.count()], reward, 'retirement is not a free kill');
  const index = h.Game.test.spawnDummy(500, 500, 100);
  assert.equal(h.Engine.enemies.items[index].ground, null, 'pool reuse clears terrain ownership');
});

test('boss entry removes terrain troops and prevents fresh reinforcements', () => {
  const h = fixture();
  h.Game.beginBoss(h.Game.bosses.warden, 1);
  advance(h, 1);
  assert.equal(h.Engine.enemies.items.filter(e => e.active && e.ground).length, 0);
  const fresh = h.api.makeDestinationLandmark(1);
  h.api.spawnLandmarkInfantry(fresh);
  assert.equal(h.Engine.enemies.items.filter(e => e.active && e.ground).length, 0);
  assert.equal(h.Engine.gold.count(), 0);
});

test('surviving ground guards do not hold an otherwise completed wave open', () => {
  const h = fixture();
  assert.ok(h.guards.every(e => e.formId === 0), 'terrain troops cannot inflate a formation wipe');
  h.Game.st().waveGrace = 0;
  const before = h.Game.st().tally.waves;
  h.api.detectClear();
  assert.equal(h.Game.st().tally.waves, before + 1);
  assert.ok(h.Engine.enemies.count() > 0, 'wave clears while troops remain alive');
});


test('sky crossings cannot spawn foot soldiers and sky entry retires existing guards without loot', () => {
  const h=fixture();
  const score=h.Game.st().score;
  h.Game.st().bg.sector=2;
  advance(h,1);
  assert.equal(h.Engine.enemies.count(),0);
  assert.equal(h.Engine.gold.count(),0);
  assert.equal(h.Game.st().score,score);
  for(let crossing=0;crossing<3;crossing++) {
    const lm=h.api.makeDestinationLandmark(2,crossing);
    h.Game.st().bg.landmark=lm;
    h.api.spawnLandmarkInfantry(lm);
    assert.equal(h.Engine.enemies.count(),0);
  }
});
