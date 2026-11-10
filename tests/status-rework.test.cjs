'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gameHarness } = require('./original-game.test.cjs');

function fixture(god) {
  const h = gameHarness(42, (source, file) => file === 'game.js'
    ? source.replace("  if (document.readyState === 'loading')", '  Game.reworkTest = { hitEnemy, killEnemy, updateArtemisTarget, gjallarhorn, hammerImpact, giantsBane, throwHammer, addWeakStacks, apotheosisRider, lokiPilfer, updateBullets, anubisVerdict, drawKitOverlays, imperialJudgement, updateJudgement };\n  if (document.readyState === \'loading\')') : source);
  h.Game.setMode('playing'); h.Game.test.setAttackGod(god);
  h.api = h.Game.reworkTest;
  h.enemy = (boss = false, x = 540) => {
    const e = h.Engine.enemies.items[h.Game.test.spawnDummy(x, 500, 10000)];
    e.boss = boss; e.hp = e.maxhp = 10000; return e;
  };
  h.hit = (e, kind, damage = 10) => h.api.hitEnemy({ kind, faction: 0, damage, x: e.x, y: e.y, radius: 1, vy: -100 }, e);
  return h;
}

test('Artemis uses one persistent attack Mark, no ramp, no automatic transfer or splinters', () => {
  const h = fixture('artemis'), a = h.enemy(), b = h.enemy(false, 800);
  assert.equal('hunt' in h.Game.st(), false);
  h.hit(a, 9); assert.equal(a.marked, true); assert.equal(a.hp, 9987.5);
  h.hit(a, 9); assert.equal(a.hp, 9975, 'repeat hit has no Hunt Depth ramp');
  for (let i = 0; i < 4; i++) h.hit(b, 9);
  assert.equal(b.marked, false, 'stray hits cannot transfer the reserved mark');
  a.markT = 0.01; h.api.updateArtemisTarget(); assert.equal(a.markT, 6);
  h.api.killEnemy(a, true); assert.equal(b.marked, false);
  assert.equal(h.Engine.shots.items.filter(s => s.active).length, 0, 'no splinter shots');
  h.hit(b, 9); assert.equal(b.marked, true);
});

test('Loosed Arrow still marks every pierced foe without replacing the attack target', () => {
  const h = fixture('artemis'), a = h.enemy(), b = h.enemy(false, 800);
  h.hit(a, 9);
  h.api.hitEnemy({ kind: 4, faction: 1, loosed: true, markHit: true, forceCrit: 1, damage: 10, vy: -100 }, b);
  assert.equal(b.marked, true);
  assert.equal(h.Game.test.artemisMarkInfo().foeSeq, a.seq);
});

test('Jade edicts load Weighing instead of Stun or Seal; Verdict can reach three Weak stacks', () => {
  const h = fixture('jade'), e = h.enemy(true);
  h.context.GL.edictStyle = 'C';
  h.hit(e, 7, 100); assert.equal(e.scaleW, 100); assert.equal(e.stunT, 0); assert.equal('sealT' in e, false);
  e.scaleW = 3490; h.hit(e, 7, 10);
  assert.equal(e.scaleW, 0); assert.equal(e.weakStacks, 2);
  h.api.anubisVerdict(e); assert.equal(e.weakStacks, 3);
});

test('Aphrodite caps at two Weak stacks and cannot erase three from another source', () => {
  const h = fixture('aphrodite'), e = h.enemy(true);
  for (let i = 0; i < 5; i++) h.hit(e, 5);
  assert.equal(e.weakStacks, 2);
  h.api.addWeakStacks(e, 2, 3, 6); h.hit(e, 5);
  assert.equal(e.weakStacks, 3);
});

test('Gjallarhorn Stuns survivors instead of applying Marked', () => {
  const h = fixture('heimdall'), a = h.enemy(), b = h.enemy(true, 800);
  h.api.gjallarhorn(1);
  for (const e of [a, b]) { assert.equal(e.marked, false); assert.equal(e.stunT, 1.2); }
});

test('Thor special Stuns direct and splash survivors; base attack needs its upgrade', () => {
  const h = fixture('thor'), a = h.enemy(), b = h.enemy(false, 650), boss = h.enemy(true, 600);
  h.api.giantsBane(); let hammer = h.Game.st().hammers.at(-1);
  h.api.hammerImpact(hammer, a.x, a.y, true, a);
  assert.equal(a.stunT, 1.2); assert.equal(b.stunT, 1.2); assert.equal(boss.stunT, 0);
  a.stunT = 0;
  h.api.throwHammer(false, 10, 0); h.api.hammerImpact(h.Game.st().hammers.at(-1), a.x, a.y, false, a);
  assert.equal(a.stunT, 0);
  h.Game.applyBoon({ kind: 'mod', id: 'thorStun', mag: 1 });
  h.api.throwHammer(false, 10, 0); h.api.hammerImpact(h.Game.st().hammers.at(-1), a.x, a.y, false, a);
  assert.equal(a.stunT, 1.2);
  assert.ok(h.Run.MODS.thor.some(m => m[0] === 'thorStun'));
});

test('Loki returns only the victim’s bullets, can hit its sender, and grants no Weak rider', () => {
  const h = fixture('loki'), e = h.enemy(true), other = h.enemy(false, 800), p = h.context.Patterns;
  p.setSource(e); const b = p.bullet(e.x, e.y + 30, Math.PI / 2, 100, { radius: 8 });
  p.setSource(other); const untouched = p.bullet(e.x, e.y + 20, Math.PI / 2, 100, { radius: 8 }); p.clearSource();
  h.api.lokiPilfer(e, 8);
  assert.equal(b.friendly, true); assert.equal(untouched.friendly, false);
  b.x = e.x; b.y = e.y;
  const hp = e.hp; h.api.updateBullets(0);
  assert.ok(e.hp < hp, 'returned shot damages the same boss that emitted it');
  assert.equal(b.active, false);
  h.api.apotheosisRider(); assert.equal(e.weak, false);
});

test('retired Hunted upgrades are not offered and unrelated Imperial Seal charm remains', () => {
  const h = fixture('artemis');
  assert.ok(!h.Run.MODS.artemis.some(m => ['artemisRefund', 'artemisMulti'].includes(m[0])));
  assert.ok(h.Run.CHARMS.charmJade);
});

test('Jade uses the ordinary Verdict execution and retains special-only primary Stun', () => {
  const h = fixture('jade'), e = h.enemy();
  h.api.imperialJudgement(); h.api.updateJudgement(0.9);
  assert.equal(e.stunT, 0.4);
  e.stunT = 0; e.scaleW = 3490; h.hit(e, 7, 10);
  assert.equal(e.dying, true, 'full Weighing devours an ordinary enemy');
  assert.equal(e.scaleW, 0);
});

test('Artemis target identity cannot leak into a recycled pool slot', () => {
  const h = fixture('artemis'), e = h.enemy(); h.hit(e, 9);
  const seq = e.seq; h.Engine.enemies.release(e);
  const fresh = h.enemy(); assert.notEqual(fresh.seq, seq);
  h.api.updateArtemisTarget();
  assert.equal(h.Game.test.artemisMarkInfo().foeSeq, 0);
  assert.equal(fresh.marked, false);
  h.hit(fresh, 9); assert.equal(fresh.marked, true);
});

test('Jade rider emits Weighing edicts without the removed mass Stun', () => {
  const h = fixture('jade'), e = h.enemy(); h.api.apotheosisRider();
  assert.equal(e.stunT, 0);
  const edicts = h.Engine.shots.items.filter(s => s.active && s.kind === 7);
  assert.ok(edicts.length > 0);
  h.api.hitEnemy(edicts[0], e); assert.ok(e.scaleW > 0); assert.equal(e.stunT, 0);
});
