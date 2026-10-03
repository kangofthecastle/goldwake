'use strict';
// Real original-game simulation and run flow. GPU, audio and DOM are boundary
// stubs: these tests make no claims about rendering, sound or physical devices.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function gameHarness(seed = 42, transformSource = source => source) {
  const listeners = new Map();
  const noOp = () => {};
  const store = new Map();
  const spr = new Proxy({}, { get: (o, k) => o[k] ?? (o[k] = Object.keys(o).length) });
  const context = {
    console, performance: { now: () => 0 }, requestAnimationFrame: noOp,
    navigator: { getGamepads: () => [] },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    document: { readyState: 'loading', addEventListener: noOp, hidden: false },
    addEventListener(type, fn) { const a = listeners.get(type) || []; a.push(fn); listeners.set(type, a); },
    GL: { SPR: spr, sprFill: () => 1, authoredSpr: () => -1, setLightningStyle: noOp, setHitboxStyle: noOp },
    SFX: new Proxy({}, { get: () => noOp }),
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['engine.js', 'patterns.js', 'run.js', 'game.js']) {
    vm.runInContext(transformSource(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), file), context, { filename: file });
  }
  const { Game, Run, Engine } = context;
  // Fix cosmetic randomness as well as Run's seeded wave selection.
  vm.runInContext('Math.random = Engine.mulberry32(12345)', context);
  function press(code, action) {
    for (const fn of listeners.get('keydown') || []) fn({ code, preventDefault: noOp });
    action();
    for (const fn of listeners.get('keyup') || []) fn({ code });
    Engine.flushEdges();
  }
  Run.startRun(seed);
  return { Game, Run, Engine, press, context };
}

function enterCombat(h) {
  h.press('KeyX', () => h.Run.updateSector(0));
  h.Run.updateSector(2);
  assert.equal(h.Game.st().mode, 'playing');
}

function collectAtPlayer(h) {
  const p = h.Game.st().player;
  h.Engine.gold.forEach(g => { g.x = p.x; g.y = p.y; g.vx = g.vy = 0; });
  h.Game.test.step(1);
}

module.exports = { gameHarness };

if (require.main === module) {
test('same seed reproduces longer sector arcs and keeps all fourteen gods', () => {
  const a = gameHarness(418), b = gameHarness(418);
  assert.equal(Object.keys(a.Run.GODS).length, 14);
  assert.equal(JSON.stringify(a.Run.sectors.map(s => [s.waveNames, s.slotRoles, s.affix.name])), JSON.stringify(b.Run.sectors.map(s => [s.waveNames, s.slotRoles, s.affix.name])));
  for (const s of a.Run.sectors) {
    assert.ok(s.wavesCount >= 7 && s.wavesCount <= 9, `sector length ${s.wavesCount}`);
    assert.equal(s.slotRoles[0], 'opener');
    assert.equal(s.slotRoles.at(-1), 'crescendo');
    assert.ok(s.slotRoles.includes('feature'));
    assert.ok(s.slotRoles.includes('breather'));
  }
});

test('shop buys boons once, rejects insufficient funds and escalates every reroll', () => {
  const h = gameHarness(); const { Game, Run, press } = h;
  Run.onCleared('boss');
  assert.equal(Game.st().mode, 'shop');
  assert.equal(Run.shopItems.length, 3);
  const item = Run.shopItems[0];
  Game.st().wallet = item.price - 1;
  press('KeyZ', () => Run.updateShop(0));
  assert.equal(item.sold, false);
  assert.equal(Game.st().wallet, item.price - 1);
  Game.st().wallet = item.price;
  press('KeyZ', () => Run.updateShop(0));
  assert.equal(item.sold, true);
  assert.equal(Game.st().wallet, 0);
  Game.st().wallet = 10000;
  press('KeyZ', () => Run.updateShop(0));
  assert.equal(Game.st().wallet, 10000);
  const prices = [];
  for (let i = 0; i < 3; i++) {
    Run.shopSel = Run.shopItems.length;
    const before = Game.st().wallet;
    press('KeyZ', () => Run.updateShop(0));
    prices.push(before - Game.st().wallet);
  }
  assert.ok(prices[0] < prices[1] && prices[1] < prices[2], `reroll prices: ${prices}`);
  press('KeyX', () => Run.updateShop(0));
  assert.equal(Run.sectorIdx, 1);
  assert.equal(Game.st().mode, 'sector');
});

test('score multipliers do not multiply recovered cash; fractional shard income is retained', () => {
  const h = gameHarness(); const { Game, Run } = h;
  Game.setMode('playing');
  const st = Game.st(); st.hubris.step = 5; st.mult = 8;
  for (let i = 0; i < 4; i++) { Game.test.spawnFieldGold(st.player.x, st.player.y, 0.25, false, 0); collectAtPlayer(h); }
  assert.equal(st.wallet, 0); assert.ok(Math.abs(st.walletFraction - 0.625) < 1e-6);
  const before = { wallet: st.wallet, career: Run.meta.careerGold, score: st.score, gauge: st.vaunt.gauge };
  Game.test.spawnFieldGold(st.player.x, st.player.y, 0, false, 37);
  collectAtPlayer(h);
  assert.equal(st.wallet - before.wallet, 37);
  assert.equal(Run.meta.careerGold, before.career);
  assert.equal(st.score, before.score);
  assert.equal(st.vaunt.gauge, before.gauge);
  Game.test.spawnFieldGold(st.player.x, st.player.y, 1, false, 11);
  collectAtPlayer(h);
  assert.equal(st.wallet - before.wallet, 49); // recovered 37 + 11, plus 1 earned with carried fraction
});

test('every god can equip attack, special and ultimate and advance combat without invalid state', () => {
  const h = gameHarness(); const { Game, Run, Engine } = h;
  for (const god of Object.keys(Run.GODS)) {
    Game.resetRun({}); Game.setMode('playing');
    Game.applyBoon({ kind: 'transformA', god, rarity: 'common' });
    Game.applyBoon({ kind: 'transformS', god, rarity: 'common' });
    Game.applyBoon({ kind: 'ultimate', god });
    assert.equal(Game.st().attackGod, god); assert.equal(Game.st().specialGod, god);
    assert.equal(Game.st().ultimateGod, god);
    Game.test.spawnDummy(540, 900, 100000);
    Game.test.fireNow(false); Game.test.specialNow(); Game.test.fireC(); Game.test.step(90);
    for (const pool of [Engine.enemies, Engine.shots, Engine.bullets, Engine.gold]) {
      pool.forEach(o => { assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y), `${god}: invalid position`); });
    }
    assert.ok(Number.isFinite(Game.st().score), god);
  }
});

test('Ares reaches full frenzy in close range within two seconds and grants reposition grace', () => {
  const h = gameHarness(); const { Game } = h;
  Game.setMode('playing'); Game.test.setAttackGod('ares');
  const p = Game.st().player;
  const enemy = Game.test.spawnDummy(p.x, p.y - 200, 100000);
  Game.test.step(120);
  assert.ok(Game.test.frenzyInfo().f >= 0.99);
  Game.test.setEnemyPos(enemy, p.x, p.y - 900);
  Game.test.step(30);
  assert.ok(Game.test.frenzyInfo().f >= 0.99);
  Game.test.step(90);
  assert.ok(Game.test.frenzyInfo().f < 0.99);
});

test('first sector plays every scheduled wave with five drafts and bounded shop income', t => {
  function simulate(cancel, seed = 418, collectFraction = 1) {
    const h = gameHarness(seed); const { Game, Run, Engine } = h;
    enterCombat(h);
    const spawnFrame = new Map();
    const selectedGold = new Map();
    const allocGold = Engine.gold.alloc;
    let goldSerial = 0;
    // Observe allocation identity because pooled object references are reused.
    Engine.gold.alloc = function () { const g = allocGold.call(this); if (g) g._testGoldSerial = ++goldSerial; return g; };
    let drafts = 0, kills = 0, casts = 0, frame = 0;
    // A controlled perfect-collection fixture, not an estimate of human play:
    // enemies live 3 seconds to emit bullets, then die via the real reward path.
    // No damage taken, no optional Labor. Partial fixtures collect 60%
    // of each shard value to model missed loot without spatial sampling bias.
    for (; frame < 60 * 600 && Game.st().waveKind !== 'boss'; frame++) {
      const st = Game.st(); st.player.invuln = 10;
      if (st.mode === 'draft') {
        drafts++;
        h.press('KeyZ', () => Run.updateDraft(0));
        continue;
      }
      if (cancel && st.mode === 'playing' && st.vaunt.gauge >= 100 && !st.vaunt.active) {
        h.press('KeyC', () => Game.test.frame(Engine.DT)); casts++;
      }
      Engine.enemies.forEach(e => {
        if (!spawnFrame.has(e.seq)) spawnFrame.set(e.seq, frame);
        if (!e.dying && frame - spawnFrame.get(e.seq) >= 180) { Game.test.kill(e._i); kills++; }
      });
      Engine.gold.forEach(g => {
        if (selectedGold.get(g) !== g._testGoldSerial) {
          selectedGold.set(g, g._testGoldSerial);
          g.value *= collectFraction; g.bank *= collectFraction;
        }
        g.x = st.player.x; g.y = st.player.y; g.vx = g.vy = 0;
      });
      Game.test.frame(Engine.DT);
    }
    assert.equal(Game.st().waveKind, 'boss', 'wave flow reaches the first boss within fixture budget');
    assert.equal(Run.waveIdx, Run.sectors[0].wavesCount);
    assert.equal(drafts, 5);
    const earned = Game.st().wallet;
    assert.ok(kills > 0 && earned > 0);
    // Resolve real boss phases by crossing each HP floor through the test API.
    // Arrival, transition breaths, phase rewards and final death all still tick.
    for (let f = 0; f < 60 * 180 && Game.st().mode !== 'shop'; f++) {
      const st = Game.st(); st.player.invuln = 10;
      if (Game.test.bossArrived() && Game.test.bossBreath() <= 0) Game.test.damageBoss(1e9);
      Engine.enemies.forEach(e => { if (!e.boss && !e.dying) Game.test.kill(e._i); });
      Engine.gold.forEach(g => {
        if (selectedGold.get(g) !== g._testGoldSerial) {
          selectedGold.set(g, g._testGoldSerial);
          g.value *= collectFraction; g.bank *= collectFraction;
        }
        g.x = st.player.x; g.y = st.player.y; g.vx = g.vy = 0;
      });
      Game.test.frame(Engine.DT);
    }
    assert.equal(Game.st().mode, 'shop', 'real boss phase/death flow reaches shop');
    const prices = Run.shopItems.map(i => i.price);
    if (collectFraction === 1) assert.ok(prices.some(p => p <= Game.st().wallet), 'sector earnings can afford at least one shop boon');
    if (seed === 42 && collectFraction === 1) assert.ok(Game.st().wallet < prices.reduce((a, b) => a + b, 0), 'ordinary first sector cannot buy the entire shop');
    return { waves: Run.sectors[0].wavesCount, drafts, kills, casts, waveSeconds: Math.round(frame / 60), waveIncome: earned, shopWallet: Game.st().wallet, shopPrices: prices };
  }
  const ordinary = simulate(false), activeCancel = simulate(true);
  simulate(false, 42); // affordability and cannot-buy-the-entire-shop guard runs by default
  assert.ok(activeCancel.casts > 0, 'active scenario actually uses apotheosis');
  t.diagnostic(JSON.stringify({ fixture: 'seed 418, three-second kills, perfect collection, no damage/Labor, boss phases forced at HP floors', ordinary, activeCancel }));
  if (process.env.ECONOMY_SWEEP) {
    for (const seed of [42, 418, 2026, 9999, 123456]) {
      t.diagnostic(JSON.stringify({ seed, ordinary: simulate(false, seed), activeCancel: simulate(true, seed), partialValueCollection: simulate(false, seed, 0.6) }));
    }
  }
});

}
