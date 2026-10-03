/* Optional DOM smoke: NODE_PATH=/path/to/node_modules node reborn/ui.test.cjs */
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), {
  url: "https://hubris.test/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const w = dom.window,
  d = w.document;
let nextFrame,
  pads = [],
  game,
  clock = 0;
w.requestAnimationFrame = (fn) => {
  nextFrame = fn;
};
w.HTMLElement.prototype.scrollIntoView = function () {};
w.ResizeObserver = class {
  observe() {}
};
w.RebornSound = class {
  settings() {}
  unlock() {}
  event() {}
  tick() {}
};
w.RebornPainter = class {
  resize() {}
  render() {}
};
Object.defineProperty(w.navigator, "getGamepads", { value: () => pads });
w.eval(fs.readFileSync(path.join(__dirname, "core.js"), "utf8"));
const Original = w.Reborn.Game;
w.Reborn.Game = class extends Original {
  constructor(...args) {
    super(...args);
    game = this;
  }
  update(dt, input) {
    this.lastInput = input;
    super.update(dt, input);
  }
};
w.eval(fs.readFileSync(path.join(__dirname, "app.js"), "utf8"));
const click = (sel) => {
  const el = d.querySelector(sel);
  assert.ok(el, sel);
  el.click();
};
const tick = () => {
  clock += 17;
  nextFrame(clock);
};
const key = (code) => {
  d.activeElement.dispatchEvent(
    new w.KeyboardEvent("keydown", { code, bubbles: true, cancelable: true }),
  );
  d.activeElement.dispatchEvent(
    new w.KeyboardEvent("keyup", { code, bubbles: true }),
  );
};
const pad = {
  id: "Test standard controller",
  mapping: "standard",
  axes: [0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
};
const press = (i) => {
  pad.buttons[i] = { pressed: true, value: 1 };
  tick();
  pad.buttons[i] = { pressed: false, value: 0 };
  tick();
};
assert.equal(d.activeElement.dataset.action, "begin");
click('[data-action="settings"]');
let auto = d.querySelector("#auto");
auto.checked = false;
auto.dispatchEvent(new w.Event("input", { bubbles: true }));
assert.equal(w.localStorage.getItem("hubris.reborn.auto"), "false");
click('[data-action="title"]');
assert.match(d.querySelector("#panel").textContent, /Auto-fire off/);
click('[data-action="begin"]');
assert.equal(d.querySelectorAll("[data-god]").length, 14);
key("ArrowRight");
assert.equal(d.activeElement.dataset.god, "ares");
key("Space");
assert.equal(d.activeElement.getAttribute("aria-pressed"), "true");
click('[data-action="confirm-god"]');
click('[data-god="zeus"]');
click('[data-action="confirm-god"]');
tick();
assert.equal(game.state, "playing");
assert.equal(game.attack.id, "ares");
assert.equal(game.specialGod.id, "zeus");
assert.equal(game.lastInput.fire, false);
const idleVolley = game.volley;
for (let i = 0; i < 90; i++) tick();
assert.equal(
  game.volley,
  idleVolley,
  "manual-fire mode must not shoot while idle",
);
assert.equal(game.shots.length, 0);
pads = [pad];
tick();
pad.axes = [0.1, -0.1];
tick();
assert.equal(game.lastInput.x, 0);
assert.equal(game.lastInput.y, 0);
pad.axes = [0.6, 0];
tick();
assert.ok(game.lastInput.x > 0.5 && game.lastInput.x < 0.6);
pad.axes = [0, 0];
pad.buttons[7].pressed = true;
tick();
assert.equal(game.lastInput.fire, true);
pad.buttons[7].pressed = false;
pad.buttons[6].pressed = true;
tick();
assert.equal(game.lastInput.focus, true);
pad.buttons[6].pressed = false;
const specialBefore = game.special;
press(2);
assert.ok(game.special < specialBefore, "X must spend special charge");
game.charge = 100;
press(3);
assert.ok(game.apoth > 0, "Y must activate Apotheosis");
press(9);
assert.equal(d.querySelector("#overlay").hidden, false);
assert.match(d.querySelector("#panel").textContent, /Paused/);
press(1);
assert.equal(d.querySelector("#overlay").hidden, true);
assert.equal(game.p.dash, 0, "B resume must not dash");
press(1);
assert.ok(game.p.dash > 0, "B during combat dashes");
press(9);
assert.equal(d.querySelector("#overlay").hidden, false);
press(9);
assert.equal(d.querySelector("#overlay").hidden, true);
pads = [];
tick();
assert.equal(d.querySelector("#overlay").hidden, false);
assert.match(d.querySelector("#toast").textContent, /disconnected/);
click('[data-action="resume"]');
pad.buttons[1].pressed = true;
pads = [pad];
game.p.dash = 0;
tick();
assert.equal(game.p.dash, 0, "held reconnect button must not trigger");
pad.buttons[1].pressed = false;
tick();
// Shop must expose all six purchase paths with prices sourced from simulation.
game.wave = 6;
game.wallet = 9999;
game.draft();
tick();
assert.equal(d.querySelectorAll("[data-buy]").length, 6);
for (const el of d.querySelectorAll("[data-buy]:not(:disabled)"))
  assert.match(
    el.textContent,
    new RegExp(game.price(el.dataset.buy) + " GOLD"),
  );
let before = game.wallet,
  cost = game.price("boon");
click('[data-buy="boon"]');
assert.equal(game.wallet, before - cost);
assert.equal(d.querySelector('[data-buy="boon"]').disabled, true);
click('[data-action="leave-shop"]');
assert.equal(game.state, "playing");
assert.equal(d.querySelector("#overlay").hidden, true);
// Keyboard pause, focus confinement, and return to combat.
key("Escape");
assert.equal(d.querySelector("#overlay").hidden, false);
const controls = [
  ...d.querySelectorAll("#panel button:not(:disabled),#panel input"),
];
controls.at(-1).focus();
key("Tab");
assert.equal(d.activeElement, controls[0]);
key("Escape");
assert.equal(d.querySelector("#overlay").hidden, true);
console.log(
  "UI smoke passed: settings persistence, 14 gods, six shop cards/prices/boon purchase, keyboard menus, analog deadzone, triggers, pause/resume, disconnect/reconnect.",
);
dom.window.close();
