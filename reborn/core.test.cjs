"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Game, GODS, W, H } = require("./core.js");
const step = 1 / 60;
function game(attack = "ares", special = "zeus") {
  const g = new Game(723);
  g.start(attack, special);
  g.events = [];
  return g;
}
function tick(g, seconds, input = { fire: false }) {
  for (let i = 0; i < Math.ceil(seconds / step); i++) {
    g.update(step, input);
    g.events = [];
  }
}
function target(g, hp = 10000, x = W / 2, y = 300) {
  const e = {
    id: g.nextId++,
    x,
    y,
    baseX: x,
    r: 30,
    hp,
    maxhp: hp,
    age: 3,
    kind: 0,
    fire: 1000,
    beat: 0,
    hit: 0,
    mark: 0,
    slow: 0,
    stun: 1000,
  };
  g.enemies.push(e);
  return e;
}
test("all fourteen god identities are unique; retry resets simulation", () => {
  assert.equal(GODS.length, 14);
  assert.equal(new Set(GODS.map((g) => g.id)).size, 14);
  const a = game(),
    b = game();
  tick(a, 4, { fire: true });
  a.slowField = 4;
  a.start("ares", "zeus");
  a.events = [];
  tick(a, 3, { fire: true });
  tick(b, 3, { fire: true });
  assert.deepEqual(a, b);
});
test("Ares reaches full strength in 1.5 seconds", () => {
  const g = game();
  tick(g, 1.51, { fire: true });
  assert.equal(g.heat, 1);
  g.shots = [];
  g.fire(true);
  assert.equal(g.shots.length, 3);
  assert.ok(g.shots[0].damage >= 24);
});
test("every attack deals damage and every special consumes exactly one charge", () => {
  for (const god of GODS) {
    const g = game(god.id, god.id);
    g.spawned = 6;
    g.p.inv = 100;
    const e = target(g);
    tick(g, 3, { fire: true, focus: true });
    assert.ok(e.hp < e.maxhp, `${god.id} attack hits`);
    g.shots = [];
    e.hp = e.maxhp;
    e.x = g.p.x;
    e.y = g.p.y - 120;
    g.special = 1;
    assert.equal(g.useSpecial(), true, god.id);
    assert.equal(g.special, 0);
    assert.equal(g.useSpecial(), false);
    tick(g, 1.5);
    assert.ok(e.hp < e.maxhp, `${god.id} special hits`);
  }
});
test("Thor hammer can hit once outbound and once returning", () => {
  const g = game("thor");
  g.spawned = 6;
  g.p.inv = 100;
  const e = target(g, 1000, W / 2, 630);
  g.fire(true);
  tick(g, 2.2);
  assert.equal(e.hp, 916);
});
test("swept shot collision catches fast projectiles", () => {
  const g = game();
  g.spawned = 6;
  const e = target(g, 100, W / 2, 400);
  g.shot(W / 2, 700, 0, -20000, { damage: 30 });
  g.update(0.034, { fire: false });
  assert.equal(e.hp, 70);
});
test("rewards cannot be repeated; draft and shop purchases are state guarded", () => {
  const g = game();
  const e = target(g, 1);
  g.hit(e, 2);
  g.kill(e);
  assert.equal(g.kills, 1);
  assert.equal(g.gold.length, 1);
  g.draft();
  const wallet = g.wallet;
  g.draft();
  assert.equal(g.wallet, wallet);
  assert.equal(g.buy("boon"), false);
  g.wave = 6;
  g.state = "playing";
  g.draft();
  g.wallet = 300;
  const rate = g.fireRate;
  assert.equal(g.buy("boon"), true);
  assert.equal(g.fireRate, rate + 0.08);
  assert.equal(g.wallet, 205);
  assert.equal(g.buy("boon"), false);
  assert.equal(g.buy("unknown"), false);
  assert.equal(g.buy("repair"), false);
  assert.equal(g.buy("power"), true);
  assert.equal(g.wallet, 65);
  assert.equal(g.buy("power"), false);
});
test("no firing grants no coins; evaded waves still last three minutes before guardian", () => {
  const g = game();
  g.p.inv = 1000;
  while (g.wave < 6 && g.elapsed < 400) {
    g.update(step, { fire: false });
    g.events = [];
    if (g.state === "draft") g.choose("tempo");
  }
  assert.equal(g.wave, 6);
  assert.ok(g.elapsed >= 185);
  assert.ok(g.elapsed < 270);
  assert.equal(g.wallet, 60);
  assert.equal(g.kills, 0);
});
function simulateRun(killFraction = 1) {
  const g = game();
  g.p.inv = 10000;
  const shops = [];
  let seen = 0;
  for (let frame = 0; frame < 100000 && g.state !== "win"; frame++) {
    g.update(step, { fire: false });
    g.events = [];
    for (const e of g.enemies) {
      if (e.hp <= 0 || e.y < 40) continue;
      if (e.boss || !e.decided) {
        e.decided = true;
        seen++;
        if (e.boss || seen % 10 < killFraction * 10) g.hit(e, 100000);
      }
    }
    if (g.state === "draft") g.choose("tempo");
    if (g.state === "shop") {
      shops.push({ earned: g.wallet, time: g.elapsed });
      assert.equal(g.buy("boon"), true);
      g.buy("power");
      g.leaveShop();
      g.p.inv = 10000;
    }
  }
  return { g, shops };
}
test("full three-region run ends, with scarce shop choices and bounded coin income", () => {
  const { g, shops } = simulateRun();
  assert.equal(g.state, "win");
  assert.equal(g.sector, 2);
  assert.equal(g.kills, 471);
  assert.equal(shops.length, 2);
  assert.equal(shops[0].earned, 283);
  assert.equal(shops[1].earned, 331);
  assert.ok(shops[0].time >= 185);
  assert.ok(g.elapsed > 560);
  assert.ok(g.wallet < 300);
  const snapshot = { score: g.score, wallet: g.wallet, elapsed: g.elapsed };
  tick(g, 10);
  assert.deepEqual(
    { score: g.score, wallet: g.wallet, elapsed: g.elapsed },
    snapshot,
  );
  const normal = simulateRun(0.7);
  assert.equal(normal.g.state, "win");
  assert.ok(normal.shops[0].earned >= 220 && normal.shops[0].earned < 250);
  console.log(
    "Economy: perfect clear shop wallets",
    shops.map((s) => s.earned),
    "70% clear shop wallets",
    normal.shops.map((s) => s.earned),
    "final wallet",
    g.wallet,
  );
});
test("death cannot transition into a clear or award posthumous wave gold", () => {
  const g = game();
  g.wave = 5;
  g.spawned = 6;
  g.waveTime = 100;
  g.clearTime = 2;
  g.p.hp = 1;
  g.p.inv = 0;
  g.bullet(g.p.x, g.p.y, 0, 0);
  g.update(step, { fire: false });
  assert.equal(g.state, "over");
  assert.equal(g.wallet, 0);
});
