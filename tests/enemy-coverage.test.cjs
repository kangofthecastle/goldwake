'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gameHarness } = require('./original-game.test.cjs');
function coverageHarness() {
  const h = gameHarness(42, (source, filename) => filename === 'game.js'
    ? source.replace("  if (document.readyState === 'loading')", '  Game.coverageTest = { spawnTurret, spawnWheelShip, spawnReactor, spawnMidship, spawnFlanker, spawnRainmaker, spawnRetinueAdd, enemyDrawCell, enemySpriteName, sizeEnemy, drawEnemies };\n  if (document.readyState === \'loading\')')
    : source);
  h.Engine.enemies.releaseAll();
  return h;
}
const cases = [
  ['turret', '32-19-bell-sentry', 'spawnTurret', [540,360], 108,40],
  ['wheel', '32-20-wheel-guard', 'spawnWheelShip', [540,400,160,0,4,0],92,34],
  ['reactor', '32-21-reactor-scarab', 'spawnReactor', [540],150,58],
  ['midship', '32-22-war-barge', 'spawnMidship', [540],270,100],
  ['flanker', '32-23-flank-crossbow', 'spawnFlanker', [-1,0],116,46],
  ['rainmaker', '32-24-rain-ewer', 'spawnRainmaker', [540],120,46],
  ['rivet', '32-25-bronze-rivet', null, [],74,30],
];
for (const [arch,asset,fn,args,scale,radius] of cases) {
  test(`${arch} real spawn selects new art without changing historical collision or footprint`, () => {
    const h = coverageHarness(), { Game, Engine, context } = h;
    if (fn) Game.coverageTest[fn](...args);
    else {
      const i = Game.test.spawnDummy(540,300,1000);
      const boss = Engine.enemies.items[i];
      boss.retinueKind = 'rivet'; boss.retinueLive = 0; Game.st().boss = boss;
      Game.coverageTest.spawnRetinueAdd(boss); Engine.enemies.release(boss);
    }
    const e = Engine.enemies.items.find(x => x.active);
    assert.equal(e.arch,arch);
    const cell = 200;
    context.GL.authoredSpr = name => name === asset ? cell : -1;
    context.GL.sprFill = slot => slot === cell ? 1.8 : 1.2;
    assert.equal(Game.coverageTest.enemyDrawCell(e),cell);
    assert.equal(Game.coverageTest.enemySpriteName(e),null,'new artwork is excluded from physics sizing');
    Game.coverageTest.sizeEnemy(e);
    assert.equal(e.scale,scale); assert.equal(e.radius,radius); assert.equal(e.szComp,1);
    const draws=[];context.GL.draw=(...a)=>draws.push(a);
    Game.coverageTest.drawEnemies();
    const body=draws.find(a=>a[0]===cell&&a[8]===1);
    assert.ok(body,'authored body actually rendered');
    const drawnArea=body[3]*body[4];
    const motionArea=e.motion.sx*e.motion.sy;
    assert.ok(Math.abs(drawnArea/motionArea-(scale*1.8/1.2)**2)<1e-7,'painted footprint matches generic predecessor');
    assert.equal(e.scale,scale); assert.equal(e.radius,radius);
    context.GL.authoredSpr=()=>-1;
    assert.equal(Game.coverageTest.enemyDrawCell(e),e.spr,'missing/late texture keeps generic fallback');
    Game.coverageTest.drawEnemies();
    assert.equal(e.scale,scale); assert.equal(e.radius,radius);
  });
}
