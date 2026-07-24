// engine.js — fixed-timestep loop, keyboard input, object pools, collision.
// Exposes window.Engine. No modules.
(function () {
  'use strict';

  var Engine = {};
  window.Engine = Engine;

  var W = 1080, H = 1920;
  Engine.W = W;
  Engine.H = H;

  // ---- seeded PRNG (mulberry32) ---------------------------------------------
  // Single source shared by Run (run seed), MUSIC (per-composition arps), and
  // Game (background field). One algorithm so a given seed maps to a byte-
  // identical sequence everywhere. Consumers only call it at runtime (after all
  // scripts have parsed), so a later-loading file may still reference it.
  Engine.mulberry32 = function (a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---- object pool ----------------------------------------------------------
  // Free-list pool over a preallocated homogeneous array (no per-frame GC).

  function Pool(size, make) {
    this.items = new Array(size);
    this.free = new Array(size);
    this.size = size;
    for (var i = 0; i < size; i++) {
      var o = make();
      o.active = false;
      o._i = i;
      this.items[i] = o;
      this.free[i] = size - 1 - i; // fill so we pop from low indices first
    }
    this.freeTop = size; // number of free entries
  }
  Pool.prototype.alloc = function () {
    if (this.freeTop === 0) return null;
    this.freeTop--;
    var i = this.free[this.freeTop];
    var o = this.items[i];
    o.active = true;
    return o;
  };
  Pool.prototype.release = function (o) {
    if (!o.active) return;
    o.active = false;
    this.free[this.freeTop] = o._i;
    this.freeTop++;
  };
  Pool.prototype.releaseAll = function () {
    for (var i = 0; i < this.size; i++) {
      if (this.items[i].active) {
        this.items[i].active = false;
      }
      this.free[i] = this.size - 1 - i;
    }
    this.freeTop = this.size;
  };
  Pool.prototype.forEach = function (fn) {
    var it = this.items;
    for (var i = 0; i < it.length; i++) {
      if (it[i].active) fn(it[i]);
    }
  };
  Pool.prototype.count = function () { return this.size - this.freeTop; };

  Engine.Pool = Pool;

  // ---- object shapes (monomorphic, all fields present) ----------------------

  function makeBullet() {
    return {
      active: false, _i: 0,
      x: 0, y: 0,
      dir: 0, speed: 0, accel: 0,
      accel2: 0, accelSwitchT: 1e9,   // after age>switchT, accel becomes accel2
      angVel: 0,
      burstY: 0,                      // TALOS boulders: burst into shrapnel at this depth (0 = none)
      gild: false,                    // MIDAS phase I: bullet leaves a brief gilded trail
      minSpeed: -1e9, maxSpeed: 1e9,
      radius: 8, scale: 16,
      r: 1, g: 1, b: 1, a: 1,
      spr: 0,
      fam: 0, spin: 0,                // bullet-art family (0 orb..5 star) + texture-spin rate
      oriented: false,
      flash: 0, age: 0, grazed: false,
      life: 1e9,
      timeScale: 1, slowT: 0,         // bullet time-slow (horn shoves)
      lensAcc: 0,                     // GATE OF DUAT: total heading-bend already spent to this bullet (radians; capped so it never orbits)
      friendly: false, srcId: -1,     // player-faction flipped bullet (Loki PILFER, Pass 2)
      gardenerId: -1,                 // Bullet Gardener ownership
      ownerId: -1                     // emitter ownership (midship cancel-to-gold on death)
    };
  }

  function makeShot() {
    return {
      active: false, _i: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      radius: 10, damage: 1, age: 0, life: 2.5,
      r: 0.6, g: 1, b: 1, scale: 26,
      pierce: 0, homing: false, turn: 0, kind: 0,
      faction: 0, big: false, markHit: false, forceCrit: 0,
      weave: 0, phase: 0,                // Quetzalcoatl serpentine shots
      cloneShot: false,                  // Wukong clone (HAVOC IN HEAVEN)
      crescent: false,                   // Guan Yu cleaving crescent blade
      // §9a pierce-dedup: a stamp scheme. Every shot gets a unique monotonic fireId
      // (stamped in resetShotHits); an enemy it hits records e.lastHitFireId = fireId,
      // so collideShots skips a foe already bitten by THIS shot for the shot's whole
      // life. O(1), eviction-free — supersedes the old 8-slot seq ring that could
      // evict a still-overlapping foe on a high-pierce shot and let it re-hit. hitN =
      // lifetime distinct hits (the pierce budget).
      hitN: 0, fireId: 0
    };
  }

  function makeEnemy() {
    return {
      active: false, _i: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      hp: 10, maxhp: 10, radius: 34, scale: 68,
      type: 0, spr: 0,
      r: 1, g: 1, b: 1,
      t: 0, fireT: 0, fireCd: 1,
      s0: 0, s1: 0, s2: 0, s3: 0,
      p0x: 0, p0y: 0, p1x: 0, p1y: 0, p2x: 0, p2y: 0, p3x: 0, p3y: 0,
      pathT: 0, pathDur: 1,
      angle: Math.PI / 2, rot: 0,
      gold: 3, score: 100, hitFlash: 0,
      boss: false, phase: 0, name: '',
      invuln: false, dying: false, elite: false,
      // status effects (Phase 3 god boons)
      terrorT: 0, shakenT: 0,
      charmMeter: 0, charmed: false, charmT: 0,
      marked: false, markT: 0,
      weak: false, weakT: 0, ghost: false,
      burnT: 0, burnDps: 0,
      // §4 CONFUSE REMOVED (ruling 1): the freed confuse fields are renamed to
      // trickStacks/trickBudget, reserved for Loki PILFER's boss budget (Pass 2).
      // Unused this pass — kept only so the pool stays monomorphic.
      trickStacks: 0, trickBudget: 0, stunT: 0, judgeT: 0,
      // physical displacement — Thor / Guan Yu / Ares Terror (integrated after scripted movement)
      dispX: 0, dispY: 0, dispVX: 0, dispVY: 0, impactDmg: 0, slamCd: 0,
      // phase-6 archetypes
      arch: '', aura: '', link: null, gen: 0, g1: '', g2: '', shieldT: 0,
      knx: 0, kny: 0, fireHold: 0,
      // danmaku-overhaul: fire scripts + path runner (all monomorphic)
      script: null, scriptT: 0, scriptI: 0, scriptLoop: 1, poseT: 0,
      pathSegs: null, segI: 0, segT: 0, sx: 0, sy: 0,
      holdX: 0, holdY: 0,
      retreatAt: 0, didRetreat: false, seq: 0,
      // boss setlist engine (pass B): phase timer, transition breath, segment HP
      arrived: false, phaseT: 0, breathT: 0, segFloorHp: 0, segBounds: null,
      // boss-concept rework: MIDAS gold theft (hoard) + TALOS nail weak-point.
      // nailActive routes ALL direct-shot damage to the nail hitbox (body immune);
      // the nail pool is e.hp itself (the final phase's segment).
      isMidas: false, hoard: 0, hoardCount: 0,
      nailActive: false, nailR: 0, nailX: 0, nailY: 0,
      onDeath: null, onUpdate: null
    };
  }

  function makeParticle() {
    return {
      active: false, _i: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      age: 0, life: 0.5,
      size: 20, r: 1, g: 1, b: 1, a: 1,
      spr: 0, rot: 0, angVel: 0,
      drag: 1, grow: 0, kind: 0
    };
  }

  function makeGold() {
    return {
      active: false, _i: 0,
      x: 0, y: 0, vx: 0, vy: 0,
      age: 0, life: 12,
      value: 1, rot: 0, angVel: 0, scale: 22,
      homing: false, r: 1, g: 0.8, b: 0.25,
      magnet: 0, bank: 0,
      cursed: false   // MIDAS cursed gold: gilds (freezes) the player on pickup, worth 2x, magnet-immune
    };
  }

  // Pool capacities sized for the danmaku-overhaul worst case (a crest of
  // arcWall + snake + accent + rain ambience + gardener gardens, over a player
  // torrent, with layered explosions). No allocation happens in hot loops.
  Engine.bullets   = new Pool(6144, makeBullet);
  Engine.shots     = new Pool(384, makeShot);
  Engine.enemies   = new Pool(128, makeEnemy);
  Engine.particles = new Pool(3072, makeParticle);
  Engine.gold      = new Pool(512, makeGold);

  Engine.clearAllPools = function () {
    Engine.bullets.releaseAll();
    Engine.shots.releaseAll();
    Engine.enemies.releaseAll();
    Engine.particles.releaseAll();
    Engine.gold.releaseAll();
  };

  // ---- input ----------------------------------------------------------------

  var keys = {};          // code -> bool (held)
  var pressedSet = {};    // code -> bool (edge, consumed on read)
  Engine.keys = keys;

  var GAME_KEYS = {
    'ArrowUp': 1, 'ArrowDown': 1, 'ArrowLeft': 1, 'ArrowRight': 1,
    'KeyW': 1, 'KeyA': 1, 'KeyS': 1, 'KeyD': 1,
    'ShiftLeft': 1, 'ShiftRight': 1,
    'KeyZ': 1, 'KeyX': 1, 'KeyC': 1, 'Space': 1, 'KeyP': 1, 'KeyR': 1, 'KeyM': 1,
    'KeyF': 1,  // pause-menu auto-fire toggle (§9b)
    'KeyH': 1   // pause-menu enemy-health-bar toggle
  };

  var firstGesture = null; // set by Game: called once on first keydown

  Engine.onFirstGesture = function (fn) { firstGesture = fn; };

  window.addEventListener('keydown', function (e) {
    if (firstGesture) { firstGesture(); firstGesture = null; }
    if (GAME_KEYS[e.code]) e.preventDefault();
    if (!keys[e.code]) pressedSet[e.code] = true; // edge only on first
    keys[e.code] = true;
  }, { passive: false });

  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });

  window.addEventListener('blur', function () {
    for (var k in keys) keys[k] = false;
  });

  // held helpers
  Engine.down = function (code) { return !!keys[code]; };
  Engine.anyDown = function (a, b) { return !!keys[a] || !!keys[b]; };

  // edge helper (consumes)
  Engine.pressed = function (code) {
    if (pressedSet[code]) { pressedSet[code] = false; return true; }
    return false;
  };

  // convenient aggregate input read for gameplay
  Engine.readMove = function () {
    var mx = 0, my = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) mx -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) mx += 1;
    if (keys['ArrowUp'] || keys['KeyW']) my -= 1;
    if (keys['ArrowDown'] || keys['KeyS']) my += 1;
    return { x: mx, y: my };
  };
  Engine.focusHeld = function () { return !!keys['ShiftLeft'] || !!keys['ShiftRight']; };
  Engine.fireHeld = function () { return !!keys['KeyZ'] || !!keys['Space']; };

  // ---- collision helpers ----------------------------------------------------

  Engine.dist2 = function (ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  Engine.hit = function (ax, ay, ar, bx, by, br) {
    var dx = ax - bx, dy = ay - by;
    var rr = ar + br;
    return (dx * dx + dy * dy) <= rr * rr;
  };

  // ---- fixed-timestep loop --------------------------------------------------

  var DT = 1 / 60;
  Engine.DT = DT;
  Engine.time = 0;

  Engine.start = function (update, render) {
    Engine._update = update;   // headless verify: drive fixed steps deterministically
    var last = performance.now() / 1000;
    var acc = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      var t = now / 1000;
      var dt = t - last;
      last = t;
      if (dt > 0.25) dt = 0.25;   // clamp big gaps (tab unfocus) — never spiral
      acc += dt;
      var steps = 0;
      while (acc >= DT && steps < 5) {
        Engine.time += DT;
        update(DT);
        acc -= DT;
        steps++;
      }
      if (steps === 5) acc = 0;   // drop backlog if we couldn't keep up
      render(acc / DT);
      // Clear stale edge presses only if at least one logic step ran this
      // frame (so they had a chance to be consumed). On high-refresh displays
      // some frames run zero steps — preserve presses for the next step.
      if (steps > 0) { for (var k in pressedSet) pressedSet[k] = false; }
    }
    requestAnimationFrame(frame);
  };

  // Headless verify only: flush edge presses exactly as a real frame with steps>0
  // would (the game drives fixed steps itself via Game.test.step). Zero cost unless
  // called.
  Engine.flushEdges = function () { for (var k in pressedSet) pressedSet[k] = false; };

  // ---- generic pooled physics update (used by game for bullets/particles) ---
  // Kept here so pools + integration live together.

  Engine.updateBullet = function (bu, dt) {
    var scale = 1;
    if (bu.slowT > 0) { bu.slowT -= dt; scale = bu.timeScale; }
    var edt = dt * scale;                 // scaled motion (Winter Bloom)
    bu.age += dt;                         // timers run in real time
    if (bu.age >= bu.accelSwitchT) bu.accel = bu.accel2;
    bu.speed += bu.accel * edt;
    if (bu.speed < bu.minSpeed) bu.speed = bu.minSpeed;
    if (bu.speed > bu.maxSpeed) bu.speed = bu.maxSpeed;
    bu.dir += bu.angVel * edt;
    bu.x += Math.cos(bu.dir) * bu.speed * edt;
    bu.y += Math.sin(bu.dir) * bu.speed * edt;
    if (bu.flash > 0) bu.flash -= dt;
    bu.life -= dt;
  };

  Engine.updateParticle = function (p, dt) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.rot += p.angVel * dt;
    p.size += p.grow * dt;
  };

})();
