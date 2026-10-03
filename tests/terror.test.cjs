'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gameHarness } = require('./original-game.test.cjs');

function fixture() {
  const h = gameHarness(42, (source, file) => file === 'game.js'
    ? source.replace("  if (document.readyState === 'loading')", "  Game.terrorTest = { terrify, damageEnemy, updateEnemies, apotheosisRider, castUltimate, hasStatus };\n  if (document.readyState === 'loading')") : source);
  h.Game.setMode('playing');
  h.api = h.Game.terrorTest;
  h.enemy = boss => {
    const i = h.Game.test.spawnDummy(540, 500, 10000);
    const e = h.Engine.enemies.items[i]; e.boss = boss;
    return e;
  };
  return h;
}

test('Terror gives ordinary enemies and bosses one 20% damage modifier and refreshes without stacking', () => {
  for (const boss of [false, true]) {
    const h = fixture(), e = h.enemy(boss);
    assert.equal('shakenT' in e, false);
    h.api.terrify(e, 540, 900);
    assert.equal(e.terrorT, boss ? 1 : 2.5);
    h.api.terrify(e, 540, 900);
    assert.equal(e.terrorT, boss ? 1 : 2.5);
    assert.equal(h.api.hasStatus(e), true);
    const before = e.hp;
    h.api.damageEnemy(e, 100, false);
    assert.equal(before - e.hp, 120);
    assert.equal(h.Game.test.enemyUlt(e._i).terrorT, e.terrorT);
    assert.equal('shakenT' in h.Game.test.enemyUlt(e._i), false);
  }
});

test('Terror stops ordinary enemy scripts while bosses continue moving and firing', () => {
  for (const boss of [false, true]) {
    const h = fixture(), e = h.enemy(boss);
    let ticks = 0;
    e.onUpdate = enemy => { ticks++; enemy.x += 2; };
    h.api.terrify(e, 540, 900);
    // Isolate scripted movement from the intentionally preserved application push.
    e.dispVX = e.dispVY = 0;
    const x = e.x;
    h.api.updateEnemies(0.1);
    assert.equal(ticks, boss ? 1 : 0);
    if (boss) { assert.equal(e.x, x + 2); assert.equal(e.dispVX, 0); assert.equal(e.dispVY, 0); }
    assert.ok(Math.abs(e.terrorT - (boss ? 0.9 : 2.4)) < 1e-8);
  }
});

test('Ares nova and Wukong pillar share Terror without duplicate boss damage bonuses', () => {
  const h = fixture(), boss = h.enemy(true), ordinary = h.enemy(false);
  h.Game.test.setAttackGod('ares');
  h.api.apotheosisRider();
  assert.equal(boss.terrorT, 1);
  assert.equal(ordinary.terrorT, 2.5);
  h.api.castUltimate('wukong');
  assert.equal(boss.terrorT, 1, 'shorter pillar Terror cannot truncate an existing application');
  assert.equal(boss.stunT, 0.8, 'pillar keeps its separately authored boss stun');
  assert.equal(ordinary.stunT, 2.5);
  const hp = boss.hp;
  h.api.damageEnemy(boss, 100, false);
  assert.equal(hp - boss.hp, 120);
  boss.terrorT = boss.stunT = 0;
  h.api.castUltimate('wukong');
  assert.equal(boss.terrorT, 0.8);
});
