// patterns.js — danmaku emitter toolkit. Exposes window.Patterns.
// Bullets carry speed/accel/angular-velocity (see Engine.updateBullet), so
// patterns just set initial conditions and let the integrator curve them.
(function () {
  'use strict';

  var P = {};
  window.Patterns = P;

  var TAU = Math.PI * 2;

  // color families (halo tint; a white core is drawn on top by game render)
  P.MAGENTA = [1.0, 0.16, 0.72];
  P.CYAN    = [0.32, 0.90, 1.0];
  P.ORANGE  = [1.0, 0.55, 0.12];
  P.LIME    = [0.62, 1.0, 0.22];
  P.GOLD    = [1.0, 0.78, 0.22];
  P.WHITE   = [1.0, 1.0, 1.0];
  P.VIOLET  = [0.65, 0.4, 1.0];

  // hue -> rgb for rainbow rings
  P.hue = function (h) {
    h = ((h % 1) + 1) % 1;
    var r = Math.abs(h * 6 - 3) - 1;
    var g = 2 - Math.abs(h * 6 - 2);
    var b = 2 - Math.abs(h * 6 - 4);
    return [clamp01(r), clamp01(g), clamp01(b)];
  };
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  P.aimAngle = function (x, y, tx, ty) { return Math.atan2(ty - y, tx - x); };

  var SHAPE_ROUND = 0, SHAPE_NEEDLE = 1, SHAPE_RING = 2;
  P.ROUND = SHAPE_ROUND; P.NEEDLE = SHAPE_NEEDLE; P.RING = SHAPE_RING;

  // global affix scalars (DENSE VEIL: count +25%, speed -15%; etc.)
  // gSpeed is applied centrally in P.bullet; gCount is applied by the
  // multi-spawn helpers (ring/fan/spray/flower/whip).
  P.gCount = 1.0;
  P.gSpeed = 1.0;
  P.setGlobal = function (countMul, speedMul) {
    P.gCount = countMul != null ? countMul : 1.0;
    P.gSpeed = speedMul != null ? speedMul : 1.0;
  };
  function scaleCount(n) {
    n = Math.round(n * P.gCount);
    return n < 1 ? 1 : n;
  }

  // Loki faction-flip (Confuse): the source enemy for the current fire burst.
  var curSource = null, bossFlip = 0;
  P.setSource = function (e) { curSource = e; };
  P.clearSource = function () { curSource = null; };
  P.consumeBossFlip = function () { var n = bossFlip; bossFlip = 0; return n; };

  // core spawn — returns bullet or null (pool exhausted / boss-flipped)
  P.bullet = function (x, y, dir, speed, o) {
    o = o || {};
    // confused boss: bullet is not spawned; it becomes a counted self-harm tick
    if (curSource && curSource.confuseT > 0 && curSource.boss) { bossFlip++; return null; }
    var b = Engine.bullets.alloc();
    if (!b) return null;
    speed = speed * P.gSpeed;
    b.x = x; b.y = y; b.dir = dir; b.speed = speed;
    b.accel = o.accel || 0;
    b.accel2 = o.accel2 || 0;
    b.accelSwitchT = (o.accelSwitchT != null) ? o.accelSwitchT : 1e9;
    b.angVel = o.angVel || 0;
    b.minSpeed = (o.minSpeed != null) ? o.minSpeed : -1e9;
    b.maxSpeed = (o.maxSpeed != null) ? o.maxSpeed : 1e9;
    var shape = o.shape || SHAPE_ROUND;
    b.shape = shape;
    b.radius = o.radius || (shape === SHAPE_NEEDLE ? 9 : shape === SHAPE_RING ? 15 : 12);
    b.scale = o.scale || b.radius;
    var col = o.color || P.CYAN;
    b.r = col[0]; b.g = col[1]; b.b = col[2]; b.a = 1;
    b.spr = shape === SHAPE_NEEDLE ? GL.SPR.NEEDLE : shape === SHAPE_RING ? GL.SPR.RINGBULLET : GL.SPR.GLOW;
    b.oriented = (shape === SHAPE_NEEDLE);
    b.flash = 0.1;
    b.age = 0;
    b.grazed = false;
    b.life = o.life || 30;
    b.timeScale = 1; b.slowT = 0; b.carried = false;
    // confused non-boss source: flip to a green friendly bullet
    if (curSource && curSource.confuseT > 0) { b.friendly = true; b.srcId = curSource._i; b.r = 0.55; b.g = 1.0; b.b = 0.35; }
    else { b.friendly = false; b.srcId = -1; }
    b.gardenerId = -1;
    return b;
  };

  // aimed single (or n-tight) shot at target
  P.aimed = function (x, y, tx, ty, speed, o) {
    var a = P.aimAngle(x, y, tx, ty);
    return P.bullet(x, y, a, speed, o);
  };

  // N-way fan centered on dir, total angular spread
  P.fan = function (x, y, dir, count, spread, speed, o) {
    count = scaleCount(count);
    var start = dir - spread / 2;
    var step = count > 1 ? spread / (count - 1) : 0;
    for (var i = 0; i < count; i++) {
      P.bullet(x, y, start + step * i, speed, o);
    }
  };

  // aimed fan (center points at target)
  P.aimedFan = function (x, y, tx, ty, count, spread, speed, o) {
    P.fan(x, y, P.aimAngle(x, y, tx, ty), count, spread, speed, o);
  };

  // full ring
  P.ring = function (x, y, count, speed, o) {
    o = o || {};
    count = scaleCount(count);
    var off = o.offset || 0;
    for (var i = 0; i < count; i++) {
      P.bullet(x, y, off + TAU * i / count, speed, o);
    }
  };

  // single spiral tick: spawns `arms` bullets evenly spaced, offset by phase.
  // caller advances phase each fire tick (phase += step).
  P.spiral = function (x, y, phase, arms, speed, o) {
    for (var i = 0; i < arms; i++) {
      P.bullet(x, y, phase + TAU * i / arms, speed, o);
    }
  };

  // flower burst: ring that flies out, decelerates to a stall, then
  // re-accelerates. Implemented via accel(<0) then accel2(>0) switch.
  P.flower = function (x, y, count, speed, o) {
    o = o || {};
    var stall = o.stall || 0.85;   // seconds until re-accel
    var decel = o.decel || (speed / stall) * 0.9; // brings it near-stop
    var reaccel = o.reaccel || 220;
    var cfg = {
      shape: o.shape || SHAPE_ROUND,
      color: o.color || P.ORANGE,
      radius: o.radius,
      accel: -decel,
      accel2: reaccel,
      accelSwitchT: stall,
      minSpeed: 6,
      maxSpeed: o.maxSpeed || (speed + reaccel * 2.4),
      life: o.life || 30,
      offset: o.offset || 0
    };
    P.ring(x, y, count, speed, cfg);
  };

  // whip / wave: a stream fired over one call as a swept fan whose bullets
  // curve (angVel), reading like a cracking whip.
  P.whip = function (x, y, dir, count, speed, o) {
    o = o || {};
    count = scaleCount(count);
    var swing = o.swing || 0.9;         // total sweep radians across the stream
    var curl = o.curl || 1.6;           // angular velocity of each bullet
    var start = dir - swing / 2;
    var step = count > 1 ? swing / (count - 1) : 0;
    for (var i = 0; i < count; i++) {
      var frac = count > 1 ? i / (count - 1) : 0;
      P.bullet(x, y, start + step * i, speed, {
        shape: o.shape || SHAPE_ROUND,
        color: o.color || P.MAGENTA,
        radius: o.radius,
        angVel: curl * (frac - 0.5) * 2,   // fan out then curl
        life: o.life || 30
      });
    }
  };

  // random spray in an arc
  P.spray = function (x, y, dir, arc, count, sMin, sMax, o) {
    o = o || {};
    count = scaleCount(count);
    for (var i = 0; i < count; i++) {
      var a = dir + (Math.random() - 0.5) * arc;
      var s = sMin + Math.random() * (sMax - sMin);
      P.bullet(x, y, a, s, {
        shape: o.shape || SHAPE_ROUND,
        color: o.color || P.LIME,
        radius: o.radius,
        life: o.life || 30
      });
    }
  };

  // curving stream — needles that arc via constant angVel
  P.curveStream = function (x, y, dir, count, spread, speed, angVel, o) {
    o = o || {};
    var start = dir - spread / 2;
    var step = count > 1 ? spread / (count - 1) : 0;
    for (var i = 0; i < count; i++) {
      P.bullet(x, y, start + step * i, speed, {
        shape: o.shape != null ? o.shape : SHAPE_NEEDLE,
        color: o.color || P.CYAN,
        radius: o.radius,
        angVel: angVel,
        life: o.life || 30
      });
    }
  };

  // double-arm counter-rotating spiral tick
  P.doubleSpiral = function (x, y, phase, speed, o) {
    o = o || {};
    var arms = o.arms || 2;
    for (var i = 0; i < arms; i++) {
      P.bullet(x, y, phase + TAU * i / arms, speed, o);
      P.bullet(x, y, -phase + TAU * i / arms + Math.PI / arms, speed, o);
    }
  };

})();
