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

  // ---- bullet-art families + size/speed tiers -------------------------------
  // Six procedural families with real silhouettes (see gl.js). Size is
  // information: bigger = slower terrain, smaller = faster pressure. Tier picks
  // live in the verbs via o.fam / o.tier, never as ad-hoc radii at call sites.
  var FAM = { ORB: 0, RING: 1, KUNAI: 2, SHARD: 3, PELLET: 4, STAR: 5 };
  P.FAM = FAM;
  // named speed tiers (px/s, pre-gSpeed) — the spectrum, not two constants
  P.SPD = { crawl: 90, slow: 160, mid: 260, fast: 420, whip: 560 };

  // per-family { hitbox radius r (UNCHANGED from the old baselines), visual
  // radius R (~1.6x — the widened gap is the graze feel) }.
  var TIER = [
    { S: { r: 9, R: 20 }, M: { r: 12, R: 29 }, L: { r: 16, R: 40 }, XL: { r: 22, R: 62 } }, // ORB
    { S: { r: 11, R: 25 }, M: { r: 15, R: 34 }, L: { r: 19, R: 46 }, XL: { r: 26, R: 62 } }, // RING
    { S: { r: 7, R: 24 }, M: { r: 9, R: 32 }, L: { r: 12, R: 42 }, XL: { r: 15, R: 52 } },   // KUNAI
    { S: { r: 8, R: 21 }, M: { r: 11, R: 29 }, L: { r: 14, R: 38 }, XL: { r: 18, R: 48 } },  // SHARD
    { S: { r: 6, R: 13 }, M: { r: 8, R: 18 }, L: { r: 10, R: 24 }, XL: { r: 13, R: 32 } },   // PELLET
    { S: { r: 9, R: 22 }, M: { r: 12, R: 31 }, L: { r: 16, R: 41 }, XL: { r: 20, R: 52 } }   // STAR
  ];
  var FAM_SPR = [GL.SPR.ORB, GL.SPR.GRING, GL.SPR.KUNAI, GL.SPR.SHARD, GL.SPR.PELLET, GL.SPR.STAR];
  var FAM_SPIN = [0.55, 0.42, 0, 0, 0, 1.5];   // slow texture rotation on orb/ring, spin on star
  function shapeToFam(shape) { return shape === SHAPE_NEEDLE ? FAM.KUNAI : shape === SHAPE_RING ? FAM.RING : FAM.ORB; }

  // build the per-bullet option object for the multi-spawn verbs, merging a
  // family/tier/colour default under any explicit override the caller passed.
  function opt(o, fam, tier, col) {
    return {
      fam: (o.fam != null) ? o.fam : fam,
      tier: o.tier || tier,
      color: o.color || col,
      accel: o.accel, accel2: o.accel2, accelSwitchT: o.accelSwitchT, angVel: o.angVel,
      minSpeed: o.minSpeed, maxSpeed: o.maxSpeed, life: o.life,
      radius: o.radius, scale: o.scale, spin: o.spin,
      burstY: o.burstY, gild: o.gild
    };
  }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }

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

  // Emitter source for the current fire burst (retained infra; the Loki CONFUSE
  // faction-flip that used it was removed in ruling 1, and PILFER — Pass 2 — flips
  // already-flying bullets, not freshly emitted ones). Kept as harmless no-ops so
  // the setSource/clearSource call sites in updateEnemies need no edit.
  var curSource = null, bossFlip = 0;
  P.setSource = function (e) { curSource = e; };
  P.clearSource = function () { curSource = null; };
  P.consumeBossFlip = function () { var n = bossFlip; bossFlip = 0; return n; };

  // core spawn — returns bullet or null (pool exhausted)
  P.bullet = function (x, y, dir, speed, o) {
    o = o || {};
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
    // family = explicit o.fam, else mapped from the legacy shape so old call
    // sites (bosses/archetypes) inherit the new art + scale automatically.
    var fam = (o.fam != null) ? o.fam : shapeToFam(shape);
    b.fam = fam;
    var row = TIER[fam], tt = (row && row[o.tier]) || (row && row.M) || { r: 12, R: 29 };
    // hitbox stays at the tier / legacy radius; visual decouples up to ~1.6x.
    b.radius = (o.radius != null) ? o.radius : tt.r;
    b.scale = (o.scale != null) ? o.scale : tt.R;
    var col = o.color || P.CYAN;
    b.r = col[0]; b.g = col[1]; b.b = col[2]; b.a = 1;
    b.spr = FAM_SPR[fam];
    b.oriented = (fam === FAM.KUNAI || fam === FAM.SHARD);
    b.spin = (o.spin != null) ? o.spin : FAM_SPIN[fam];
    // boss-concept rework: reset per-alloc so pooled reuse never inherits a stale
    // boulder burst line or gilded-trail flag from the slot's prior occupant.
    b.burstY = o.burstY || 0;
    b.gild = !!o.gild;
    b.flash = 0.1;
    b.age = 0;
    b.grazed = false;
    b.life = o.life || 30;
    b.timeScale = 1; b.slowT = 0; b.carried = false;
    b.friendly = false; b.srcId = -1;   // enemy bullets are hostile (PILFER flips them later, Pass 2)
    b.gardenerId = -1;
    // emitter ownership — lets a midship cancel its own remaining pattern to
    // gold on death (never touches bullets from other emitters). Stamped with
    // the monotonic spawn seq (NOT the pool-slot _i) so a slot's next occupant
    // can't inherit / cancel a prior emitter's still-flying bullets.
    b.ownerId = curSource ? curSource.seq : -1;
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

  // =========================================================================
  // Danmaku-overhaul verbs (DANMAKU.md pattern grammar). All are one-call
  // emitters (or phase-advanced like P.spiral), respect gCount/gSpeed, honour
  // size + speed tiers, and are UNAIMED authored geometry unless noted.
  // Composition rule: a wave = 1 geometry verb + optionally 1 accent.
  // =========================================================================

  // ring with 1-3 missing lanes — the gap is the dodge; rotate `offset` across
  // successive casts so the safe lane drifts.
  P.ringGap = function (x, y, count, speed, o) {
    o = o || {};
    count = scaleCount(count);
    var gaps = o.gaps || 1, gw = o.gapWidth || 1.6, off = o.offset || 0;
    var step = TAU / count, ghalf = gw * step * 0.5;
    var cfg = opt(o, FAM.ORB, 'M', P.MAGENTA);
    for (var i = 0; i < count; i++) {
      var a = off + step * i, skip = false;
      for (var g = 0; g < gaps; g++) {
        var gc = off + (o.gapAt ? o.gapAt[g] : g * TAU / gaps);
        if (Math.abs(angDiff(a, gc)) <= ghalf) { skip = true; break; }
      }
      if (!skip) P.bullet(x, y, a, speed, cfg);
    }
  };

  // 2-4 concentric rings at stepped speeds (they interleave into a moving
  // lattice), alternating family/colour. Great for midship / boss beats.
  P.pulse = function (x, y, o) {
    o = o || {};
    var rings = o.rings || 3, count = o.count || 18;
    var base = o.speed || P.SPD.slow, sstep = o.speedStep || 66, off = o.offset || 0;
    for (var k = 0; k < rings; k++) {
      var odd = (k % 2) === 1;
      P.ring(x, y, count, base + sstep * k, {
        fam: odd ? FAM.RING : FAM.ORB, tier: odd ? 'M' : 'L',
        color: odd ? (o.colorB || P.ORANGE) : (o.colorA || P.MAGENTA),
        offset: off + k * 0.19
      });
    }
  };

  // dense arc with one visible safe lane (lane >= 3.5x hitbox by using PELLET
  // density + a wide laneWidth). dir = centre direction (Math.PI/2 = downward).
  P.arcWall = function (x, y, dir, arcWidth, count, speed, o) {
    o = o || {};
    count = scaleCount(count);
    var start = dir - arcWidth / 2, step = count > 1 ? arcWidth / (count - 1) : 0;
    var laneFrac = (o.laneAt != null) ? o.laneAt : 0, laneW = o.laneWidth || 3.0;
    var laneCenter = start + arcWidth * (laneFrac + 0.5), laneHalf = laneW * step * 0.5;
    var cfg = opt(o, FAM.PELLET, 'M', P.MAGENTA);
    for (var i = 0; i < count; i++) {
      var a = start + step * i;
      if (Math.abs(a - laneCenter) <= laneHalf) continue;
      P.bullet(x, y, a, speed, cfg);
    }
  };

  // a chain of bullets frozen into a serpentine ribbon (per-bullet lateral
  // phase offset along the travel direction) — the DU3 ribbon look. The whole
  // shape translates rigidly, so it reads as one snake at any freeze frame.
  P.snake = function (x, y, dir, len, speed, o) {
    o = o || {};
    len = scaleCount(len);            // DENSE VEIL etc. lengthen the ribbon
    var amp = o.amp || 46, freq = o.freq || 0.9, phase = o.phase || 0;
    var spacing = o.spacing || 30;
    var ax = Math.cos(dir), ay = Math.sin(dir), px = -ay, py = ax;
    var cfg = opt(o, FAM.SHARD, 'M', P.MAGENTA);
    for (var i = 0; i < len; i++) {
      var back = i * spacing, lat = amp * Math.sin(i * freq + phase);
      P.bullet(x - ax * back + px * lat, y - ay * back + py * lat, dir, speed, cfg);
    }
  };

  // two mirrored diagonal streams that cross mid-screen (flanker squadrons).
  P.crossfire = function (xL, xR, y, count, speed, o) {
    o = o || {};
    count = scaleCount(count);                // affix-densified like the siblings
    var spread = o.angle || 0.5;              // half-angle off straight-down
    var angL = Math.PI / 2 - spread, angR = Math.PI / 2 + spread;
    var spacing = o.spacing || 34;
    var cfg = opt(o, FAM.KUNAI, 'M', P.MAGENTA);
    for (var i = 0; i < count; i++) {
      var yo = y - i * spacing;
      P.bullet(xL, yo, angL, speed, cfg);
      P.bullet(xR, yo, angR, speed, cfg);
    }
  };

  // rotating spoke wheel with periodic gaps; caller advances `phase` each beat.
  P.wheel = function (x, y, phase, arms, speed, o) {
    o = o || {};
    var ge = o.gapEvery || 0;
    var cfg = opt(o, FAM.ORB, 'S', P.MAGENTA);
    for (var i = 0; i < arms; i++) {
      if (ge && (i % ge) === 0) continue;
      P.bullet(x, y, phase + TAU * i / arms, speed, cfg);
    }
  };

  // top-edge curtain whose density varies sinusoidally so the gaps drift
  // (deterministic — no random directions). Sector ambience under other verbs.
  P.rain = function (count, o) {
    o = o || {};
    count = scaleCount(count);
    var speed = o.speed || P.SPD.slow, waves = o.waves || 3, phase = o.phase || 0;
    var thr = (o.gapThresh != null) ? o.gapThresh : -0.15;
    var W = 1080;
    var cfg = opt(o, FAM.PELLET, 'S', P.MAGENTA);
    for (var i = 0; i < count; i++) {
      var fx = (i + 0.5) / count;
      if (Math.sin(fx * Math.PI * waves + phase) < thr) continue;
      P.bullet(fx * W, -20, Math.PI / 2, speed, cfg);
    }
  };

  // THE ACCENT — a tight aimed needle cluster. The windup flash is played by
  // the fire script's pose beat (the telegraph IS part of the art); this fires
  // the fast/whip cluster once the telegraph has held.
  P.burstAimed = function (x, y, tx, ty, n, o) {
    o = o || {};
    var a = P.aimAngle(x, y, tx, ty);
    var spread = o.spread || 0.16, speed = o.speed || P.SPD.whip;
    var start = a - spread / 2, step = n > 1 ? spread / (n - 1) : 0;
    var cfg = opt(o, FAM.KUNAI, 'S', o.color || [1.0, 0.85, 0.35]);
    for (var i = 0; i < n; i++) P.bullet(x, y, start + step * i, speed, cfg);
  };

})();
