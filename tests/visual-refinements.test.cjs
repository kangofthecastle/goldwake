'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gameHarness } = require('./original-game.test.cjs');

// Expose private functions only inside this VM. Production ships no new hooks.
function visualHarness() {
  const h = gameHarness(42, (source, filename) => filename === 'game.js'
    ? source.replace("  if (document.readyState === 'loading')", '  Game.visualTest = { enemyMotionPose, drawEnemies, resolveEnvironmentPlayer, updateBackground, makeDestinationLandmark, makeBackground };\n  if (document.readyState === \'loading\')')
    : source);
  h.context.GL.draw = () => {};
  h.Game.setMode('playing');
  return h;
}
function physicalEnemy(e) {
  return [e.x, e.y, e.radius, e.scale, e.hp, e.maxhp, e.rot, e.t, e.fireT, e.fireCd, e.scriptT, e.scriptI, e.segI, e.segT, e.active];
}
function snapshot(h) {
  return JSON.stringify({
    player: [h.Game.st().player.x, h.Game.st().player.y, h.Game.st().lives, h.Game.st().score],
    enemies: h.Engine.enemies.items.filter(e => e.active).map(physicalEnemy),
    bullets: h.Engine.bullets.items.filter(b => b.active).map(b => [b.x, b.y, b.dir, b.speed, b.radius, b.life]),
  });
}

test('extra enemy rendering cannot change collisions, movement, attack cadence or bullet trajectories', () => {
  const simOnly = visualHarness(), withRender = visualHarness();
  for (const h of [simOnly, withRender]) {
    for (const [arch, x] of [['gunship', 240], ['moth', 540], ['carrier', 840]]) {
      const index = h.Game.test.spawnDummy(x, 400, 10000);
      const e = h.Engine.enemies.items[index];
      e.arch = arch;
      h.Game.test.armFiringEnemy(index);
      h.Game.test.forceSize(index);
    }
  }
  let shots = 0;
  for (let frame = 0; frame < 180; frame++) {
    simOnly.Game.test.step();
    withRender.Game.test.step();
    const before = snapshot(withRender);
    withRender.Game.visualTest.drawEnemies();
    withRender.Game.visualTest.drawEnemies();
    assert.equal(snapshot(withRender), before, `render mutated combat at frame ${frame}`);
    assert.equal(snapshot(withRender), snapshot(simOnly), `render frequency affected simulation at frame ${frame}`);
    shots = Math.max(shots, withRender.Engine.bullets.count());
  }
  assert.ok(shots > 20, 'fixture actually exercises repeated enemy fire');
});

test('firing pose settles without resizing actors and stops for disabled actors', () => {
  const { Game, Engine } = visualHarness();
  const index = Game.test.spawnDummy(540, 600, 10000);
  const e = Engine.enemies.items[index];
  const before = physicalEnemy(e);
  e.motionShot = 0.055;
  const small = { ...Game.visualTest.enemyMotionPose(e, 0) };
  assert.ok(small.kick > 0.5);
  assert.equal(small.sx, 1); assert.equal(small.sy, 1);
  e.boss = true;
  const boss = { ...Game.visualTest.enemyMotionPose(e, 0) };
  assert.equal(boss.sx, 1); assert.equal(boss.sy, 1);
  assert.equal(boss.turn, 0);
  e.boss = false; e.motionShot = 0.8;
  const settled = Game.visualTest.enemyMotionPose(e, 0);
  assert.equal(settled.kick, 0);
  assert.ok(Math.abs(settled.sx - 1) <= 0.0031);
  assert.deepEqual(physicalEnemy(e), before);
  for (const quiet of ['stun', 'dying', 'mimic']) {
    e.stunT = quiet === 'stun' ? 1 : 0; e.dying = quiet === 'dying';
    e.arch = quiet === 'mimic' ? 'mimic' : ''; e.s0 = 0;
    e.motionShot = 0.055; e.poseT = 0.1; e.motionPoseMax = 0.4;
    assert.equal(JSON.stringify(Game.visualTest.enemyMotionPose(e, 1)), JSON.stringify({ sx: 1, sy: 1, turn: 0, brace: 0, kick: 0 }));
  }
});

test('recycled enemy slots cannot inherit recoil or preparation from their predecessor', () => {
  const { Game, Engine } = visualHarness();
  const old = Game.test.spawnDummy(500, 400, 10), e = Engine.enemies.items[old];
  e.motionShot = 0; e.motionPoseMax = 5; e.motion.sx = 3;
  Engine.enemies.release(e);
  const fresh = Game.test.spawnDummy(500, 400, 10);
  assert.equal(fresh, old, 'exercise actual pool reuse');
  assert.equal(Engine.enemies.items[fresh].motionShot, 1);
  assert.equal(Engine.enemies.items[fresh].motionPoseMax, 0);
  assert.equal(Engine.enemies.items[fresh].motion.sx, 1);
});

test('world route advances continuously at its own pace and only unlocks destinations in order', () => {
  const h = visualHarness(); const { Game, Run } = h;
  const b = Game.st().bg;
  const start = Game.envState().destinationTravel;
  Run.waveIdx = Run.sectors[0].wavesCount - 1;
  Game.beginWave(() => {}, 1, 'crescendo');
  assert.equal(Game.envState().destinationTravel, start, 'wave change must not teleport terrain');
  assert.equal(Game.envState().destinationIndex, 0, 'unlock must not instantly change the visible destination');
  let prev = start;
  const scenes = [Game.envState().destinationIndex];
  for (let i = 0; i < 180; i++) {
    Game.visualTest.updateBackground(0.5);
    const env = Game.envState();
    assert.ok(env.destinationTravel >= prev);
    assert.ok(env.destinationTravel - prev <= b.routeSpeed * 0.5 + 1e-8);
    assert.ok(env.destinationTravel <= env.destinationTarget);
    if (scenes.at(-1) !== env.destinationIndex) scenes.push(env.destinationIndex);
    prev = env.destinationTravel;
  }
  assert.deepEqual(scenes, [0, 1, 2]);
  assert.equal(prev, Game.envState().destinationTarget);
});

for (const sector of [1, 2]) for (const crossing of [0, 1, 2]) {
  test(`sector ${sector + 1} crossing ${crossing + 1} has a continuous safe lane and solid masonry`, () => {
    const { Game } = visualHarness();
    const lm = Game.visualTest.makeDestinationLandmark(sector, crossing);
    const st = Game.st(); st.bg.obstacles = lm.obstacles;
    for (const ob of lm.obstacles) { ob.originY = 450; ob.y = 450 + ob.dy; }
    const occupied = lm.obstacles.map(ob => [Math.max(0, ob.x), Math.min(1080, ob.x + ob.w)]).sort((a,b) => a[0]-b[0]);
    let start = 0, gaps = [];
    for (const [left,right] of occupied) { if (left > start) gaps.push([start,left]); start = Math.max(start,right); }
    if (start < 1080) gaps.push([start,1080]);
    const widest = gaps.sort((a,b) => (b[1]-b[0])-(a[1]-a[0]))[0];
    assert.ok(widest && widest[1] - widest[0] >= 270, 'whole silhouette leaves >=270px safe lane');
    const x = (widest[0] + widest[1]) / 2;
    Game.test.setPlayer(x, 1600);
    for (let step = 0; step < 145; step++) {
      const p = st.player; p.envPrevX = p.x; p.envPrevY = p.y; p.y -= 10;
      Game.visualTest.resolveEnvironmentPlayer();
    }
    assert.equal(st.player.y, 150, 'safe lane traverses entire crossing');
    assert.equal(st.player.x, x);
    // Intersect a vertical ray with actual edges, including sloping rooflines.
    let surface;
    for (const ob of lm.obstacles) {
      for (let x=60;x<1020 && !surface;x+=25) {
        const ys=[];
        for(let i=0;i<ob.points.length;i++) {
          const a=ob.points[i],b=ob.points[(i+1)%ob.points.length];
          if((a.x>x)!==(b.x>x)) ys.push(a.y+(x-a.x)*(b.y-a.y)/(b.x-a.x));
        }
        ys.sort((a,b)=>a-b);
        if(ys.length>=2 && ys[1]-ys[0]>80) surface={x,y:450+ys[0]};
      }
    }
    assert.ok(surface,'fixture has a substantial physical bank');
    const p=st.player;p.x=surface.x;p.y=surface.y-30;
    for(let i=0;i<15;i++){p.envPrevX=p.x;p.envPrevY=p.y;p.y+=4;Game.visualTest.resolveEnvironmentPlayer();}
    assert.ok(p.y<surface.y,'solid visible edge rejects entry');
  });
}

for (const [crossing, safeX] of [[0, 800], [1, 640], [2, 280]]) {
  test(`bronze crossing ${crossing + 1} has a clear passage through its complete silhouette`, () => {
    const { Game, Engine } = visualHarness();
    const lm = Game.visualTest.makeDestinationLandmark(0, crossing);
    const bg = Game.st().bg;
    bg.sector = 1; // isolate this static crossing from automatic spawning
    bg.obstacles = lm.obstacles;
    for (const ob of lm.obstacles) { ob.originY = 450; ob.y = 450 + ob.dy; }
    Game.test.setPlayer(safeX, 1200);
    Engine.keys.ArrowUp = true;
    Game.test.step(95);
    assert.ok(Game.st().player.y < 450, 'intended open-water lane must cross the whole shape');
    assert.equal(Game.st().player.x, safeX);
  });
}

test('bronze crossings reject new entry, do not shove a stationary player and allow lateral escape after scrolling overlap', () => {
  const { Game, Engine } = visualHarness();
  const lm = Game.visualTest.makeDestinationLandmark(0, 1);
  const bg = Game.st().bg; bg.sector = 1; bg.obstacles = lm.obstacles;
  const left = lm.obstacles.find(o => o.side === -1);
  for (const ob of lm.obstacles) { ob.originY = 700; ob.y = 700 + ob.dy; }
  // The upper tower occupies x~[-48,152], y~[892,979]. Entering from below
  // through its center must fail, independent of the polygon's bounding box.
  const x = (left.points[0].x + left.points[1].x) / 2;
  const top = 700 + left.points[0].y;
  Game.test.setPlayer(x, top - 25);
  Engine.keys.ArrowDown = true;
  Game.test.step(10);
  assert.ok(Game.st().player.y <= top - Game.test.playerHurtR());
  Engine.keys.ArrowDown = false;
  // Terrain has scrolled over the player at its leading face. Holding still
  // cannot alter ship position; moving toward the central channel must work
  // even while nearest-boundary distance initially stays constant.
  Game.test.setPlayer(x, top + 2);
  const start = { ...Game.test.playerPos() };
  Game.test.step(10);
  assert.deepEqual({ ...Game.test.playerPos() }, start);
  Engine.keys.ArrowRight = true;
  Game.test.step(50);
  assert.ok(Game.st().player.x > left.x + left.w + Game.test.playerHurtR(), 'player can escape to the open channel');
  assert.equal(Game.st().player.y, start.y, 'escape never snaps vertical position');
});

test('first sector presents all three crossings once in route order at steady physical scroll speed', () => {
  const { Game, Run } = visualHarness();
  Run.waveIdx = Run.sectors[0].wavesCount - 1;
  Game.beginWave(() => {}, 1, 'crescendo');
  const names = [];
  let previous = null;
  for (let frame = 0; frame < 60 * 100; frame++) {
    Game.visualTest.updateBackground(1 / 60);
    const lm = Game.st().bg.landmark;
    if (lm && lm !== previous) { names.push(lm.routeName); previous = lm; }
    if (lm) {
      const y = lm.y;
      Game.visualTest.updateBackground(1 / 60);
      if (Game.st().bg.landmark === lm) assert.ok(Math.abs(lm.y - y - lm.vy / 60) < 1e-8);
    }
  }
  assert.deepEqual(names, ['left bank', 'offset gate', 'right bank']);
  assert.equal(Game.st().bg.obstacles.length, 0, 'last crossing releases collision after leaving the field');
});

test('boss entry lets an existing crossing finish but cannot introduce another solid landmark', () => {
  for (const existing of [false, true]) {
    const { Game } = visualHarness();
    if (existing) {
      for (let i = 0; i < 4 * 60; i++) Game.visualTest.updateBackground(1 / 60);
      assert.ok(Game.st().bg.landmark, 'fixture creates the first approach crossing');
    }
    const active = Game.st().bg.landmark;
    const index = Game.st().bg.crossingIndex;
    Game.beginBoss(Game.bosses.warden, 1);
    assert.equal(Game.st().bg.landmark, active);
    for (let i = 0; i < 90 * 60; i++) {
      Game.visualTest.updateBackground(1 / 60);
      const lm = Game.st().bg.landmark;
      assert.ok(!lm || lm === active, 'a boss fight cannot spawn fresh terrain');
    }
    assert.equal(Game.st().bg.landmark, null);
    assert.equal(Game.st().bg.crossingIndex, index);
    assert.equal(Game.st().bg.obstacles.length, 0);
  }
});

for (const sector of [1, 2]) test(`sector ${sector + 1} advances three physical crossings in order without overlap`, () => {
  const { Game } = visualHarness();
  const bg = Game.visualTest.makeBackground(sector); Game.st().bg = bg;
  bg.routeTarget = bg.sceneSpan * 2;
  const names=[]; let prior=null;
  for(let i=0;i<60*115;i++) {
    const before=bg.landmark, y=before && before.y;
    Game.visualTest.updateBackground(1/60);
    const lm=bg.landmark;
    if(lm && lm!==prior){names.push(lm.routeName);prior=lm;assert.ok(!before,'no active crossing replaced');}
    if(lm && lm===before) assert.ok(Math.abs(lm.y-y-lm.vy/60)<1e-7);
  }
  assert.equal(names.length,3); assert.equal(new Set(names).size,3);
  assert.equal(bg.landmark,null);assert.equal(bg.obstacles.length,0);
  const flow=bg.flowY;Game.visualTest.updateBackground(1);assert.ok(bg.flowY>flow,'ambient flow continues after route stops');
});
