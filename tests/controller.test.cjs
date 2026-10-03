const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(api = 'available') {
  const events = {}, state = { mode: 'playing', paused: false };
  let pads = [], frame;
  const window = { addEventListener(name, fn) { events[name] = fn; }, Game: { st: () => state } };
  vm.runInNewContext(fs.readFileSync('js/engine.js', 'utf8'), {
    window, navigator: api === 'missing' ? {} : { getGamepads: () => { if (api === 'restricted') throw new Error('blocked'); return pads; } }, performance: { now: () => 0 },
    requestAnimationFrame(fn) { frame = fn; }
  });
  const engine = window.Engine;
  const pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
  return { engine, state, pad, events, attach() { pads = [pad]; }, detach() { pads = []; }, frame(t) { frame(t); },
    key(code, down = true) { events[down ? 'keydown' : 'keyup']({ code, preventDefault() {} }); } };
}

test('standard controller maps movement, fire, special, focus, Apotheosis and pause', () => {
  const h = setup(); h.attach();
  h.pad.axes = [0.1, -1];
  h.pad.buttons[0].pressed = true;
  h.pad.buttons[2].pressed = true;
  h.pad.buttons[3].pressed = true;
  h.pad.buttons[4].pressed = true;
  h.pad.buttons[9].pressed = true;
  h.engine.pollGamepads();
  assert.equal(h.engine.readMove().x, 0); assert.equal(h.engine.readMove().y, -1);
  assert.equal(h.engine.fireHeld(), true); assert.equal(h.engine.focusHeld(), true);
  for (const code of ['KeyZ', 'KeyX', 'KeyC', 'KeyP', 'ArrowUp']) {
    assert.equal(h.engine.pressed(code), true, code); assert.equal(h.engine.pressed(code), false, `${code} consumed`);
  }
});

test('held fire across combat-to-menu transition cannot confirm; release and press can', () => {
  const h = setup(); h.attach(); h.pad.buttons[0].pressed = true;
  h.engine.pollGamepads(); h.engine.flushEdges(); h.state.mode = 'draft';
  h.engine.pollGamepads(); assert.equal(h.engine.pressed('KeyZ'), false);
  h.pad.buttons[0].pressed = false; h.engine.pollGamepads();
  h.pad.buttons[0].pressed = true; h.engine.pollGamepads(); assert.equal(h.engine.pressed('KeyZ'), true);
});

test('controller release/disconnect preserves simultaneous keyboard input', () => {
  const h = setup(); h.attach(); h.key('KeyZ'); h.key('ArrowLeft');
  h.pad.buttons[0].pressed = true; h.engine.pollGamepads(); h.engine.flushEdges();
  h.detach(); h.engine.pollGamepads();
  assert.equal(h.engine.fireHeld(), true); assert.equal(h.engine.readMove().x, -1);
  assert.equal(h.engine.inputInterrupted, 1);
  h.key('KeyZ', false); assert.equal(h.engine.fireHeld(), false);
});

test('blur clears keyboard and pad edges and requires controller neutral before resuming', () => {
  const h = setup(); h.attach(); h.key('KeyX'); h.pad.buttons[0].pressed = true;
  h.engine.pollGamepads(); h.events.blur();
  assert.equal(h.engine.pressed('KeyX'), false); assert.equal(h.engine.pressed('KeyZ'), false);
  assert.equal(h.engine.fireHeld(), false);
  h.events.focus(); h.engine.pollGamepads(); assert.equal(h.engine.fireHeld(), false);
  h.pad.buttons[0].pressed = false; h.engine.pollGamepads();
  h.pad.buttons[0].pressed = true; h.engine.pollGamepads(); assert.equal(h.engine.pressed('KeyZ'), true);
});

test('pause options use fresh north/shoulder presses without remapping held edges', () => {
  const h = setup(); h.attach(); h.pad.buttons[3].pressed = true; h.engine.pollGamepads(); h.engine.flushEdges();
  h.state.paused = true; h.engine.pollGamepads(); assert.equal(h.engine.pressed('KeyF'), false);
  h.pad.buttons[3].pressed = false; h.engine.pollGamepads();
  h.pad.buttons[3].pressed = true; h.pad.buttons[5].pressed = true; h.engine.pollGamepads();
  assert.equal(h.engine.pressed('KeyF'), true); assert.equal(h.engine.pressed('KeyH'), true);
});

test('animation loop polls controller and retains edges across zero-step frames', () => {
  const h = setup(); h.attach(); let confirms = 0;
  h.engine.start(() => { if (h.engine.pressed('KeyZ')) confirms++; }, () => {});
  h.pad.buttons[0].pressed = true; h.frame(5); h.pad.buttons[0].pressed = false; h.frame(10);
  assert.equal(confirms, 0); h.frame(20); assert.equal(confirms, 1);
  h.frame(100); assert.equal(confirms, 1);
});

test('dpad supports menu directions and controller back alias', () => {
  const h = setup(); h.attach(); h.pad.buttons[15].pressed = true; h.pad.buttons[1].pressed = true;
  h.engine.pollGamepads(); assert.equal(h.engine.readMove().x, 1);
  assert.equal(h.engine.pressed('ArrowRight'), true); assert.equal(h.engine.pressed('KeyX'), true);
});

test('missing or restricted API does not stop keyboard play', () => {
  for (const api of ['missing', 'restricted']) {
    const h = setup(api); h.key('ArrowRight'); h.engine.pollGamepads();
    assert.equal(h.engine.readMove().x, 1); assert.equal(h.engine.controllerActive(), false);
  }
});

for (const event of [false, true]) test(`disconnect ${event ? 'event' : 'poll'} clears inputs and suppresses held reconnect`, () => {
  const h = setup(); h.attach(); h.pad.buttons[0].pressed = true; h.pad.buttons[4].pressed = true;
  h.engine.pollGamepads();
  if (event) h.events.gamepaddisconnected({ gamepad: h.pad });
  else { h.detach(); h.engine.pollGamepads(); }
  assert.equal(h.engine.fireHeld(), false); assert.equal(h.engine.focusHeld(), false);
  assert.equal(h.engine.pressed('KeyZ'), false);
  h.attach(); h.engine.pollGamepads(); assert.equal(h.engine.pressed('KeyZ'), false);
  h.pad.buttons[0].pressed = false; h.pad.buttons[4].pressed = false; h.engine.pollGamepads();
  h.pad.buttons[0].pressed = true; h.engine.pollGamepads(); assert.equal(h.engine.pressed('KeyZ'), true);
});
