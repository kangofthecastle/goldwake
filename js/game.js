// game.js — combat / stage layer. Exposes window.Game.
// Owns the player, enemies, bosses, bullets, the Vaunt system, the SPECIAL
// weapon, the god-boon effects + enemy status system, scoring, FX and all
// in-combat HUD. Run structure (sectors/waves/drafts/shops/title) lives in
// run.js and drives this layer through the Game.* API near the bottom.
(function () {
  'use strict';

  var Game = {};
  window.Game = Game;

  var W = 1080, H = 1920;
  var TAU = Math.PI * 2;
  var UP = -Math.PI / 2;

  var glCanvas, hudCanvas, hud;
  var G = null;

  // tuning ---------------------------------------------------------------
  var PLAYER_SPEED = 620, PLAYER_FOCUS = 300;
  var PLAYER_R = 4;
  var FIRE_CD = 0.075;
  var SHOT_SPEED = 1500;
  var SHOT_DMG = 1.0;             // base attack damage (intentionally modest)
  var GAUGE_MAX = 100;
  var GOLD_GAUGE = 1.3, GRAZE_GAUGE = 0.6;
  var GRAZE_R = 26;
  var MAGNET_R = 220;
  var VAUNT_DUR = 6.0;
  var VAUNT_SHIELD = 1.2;
  var MERCY = 0.5;
  var GOLD_VALUE = 120, GRAZE_SCORE = 50;
  var VAUNT_BASE = 800;
  var BANK_PER_SHARD = 9;
  // special
  var SP_RECHARGE = 0.085;        // charges per second (passive)
  var SP_KILL = 0.11;             // charge added per kill
  var LANCE_DMG = 7.0;            // base special lance damage per tick
  // status
  var CHARM_THRESHOLD = 5, CHARM_PER_HIT = 1, CHARM_TIME = 5.0;
  // pantheon 2
  var BEAM_DPS = 48;             // Ra solar beam base DPS (parity with stream fire)
  var RAVEN_DMG = 9;             // Odin raven contact damage (parity: ravens were below-band)
  var GUNGNIR_DMG = 18;          // Odin spear per-pierce damage
  var SERPENT_DMG = 55;          // Quetzalcoatl serpent DPS
  var killGoldMul = 1;           // transient gold multiplier for execute / judgment kills
  // HUBRIS meter — a persistent stepped multiplier on ALL gold + score, composed
  // multiplicatively with the transient APOTHEOSIS burst (G.mult). Homage layer
  // (DANMAKU.md "Score as homage"): built by graze, point-blank kills, and named
  // skill events; a hit knocks it down one step (never below x1.0). Tuned so a
  // skilled sector raises ~2 steps, an average one ~1.
  var HUBRIS_MULT = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0];
  var HUBRIS_MAX = 5;                          // top step index (x2.0)
  var HUBRIS_GRAZE = 0.008;                    // step-progress per graze
  var HUBRIS_PB = 0.03, HUBRIS_PB_R = 140;     // point-blank kill: progress + radius (px)
  Game.HUBRIS_MULT = HUBRIS_MULT;              // single source of truth (run.js end-screen reads this)

  // ---------------------------------------------------------------------
  // JUICE — impact & game-feel tuning (Polish round 2). Every knob the owner
  // may want to tune by hand lives here, grouped, with units in the comment.
  // Hitstop freezes the fixed-step SIM only (updateCombat is skipped): the wall
  // clock (Engine.time) and the WebAudio music scheduler keep running, so a kill
  // reads as a heavy beat without stalling input/pause/music. Popcorn kills get
  // NO hitstop (they are the cadence); only midship/elite/boss/player-hit do.
  var JUICE = {
    // micro-hitstop, measured in fixed 1/60 s steps (sim frozen this many steps)
    hsMid: 3,          // midship / elite kill freeze (steps)  — heavy, not sticky
    hsBossPhase: 3,    // boss phase-clear freeze (steps)      — punctuates the payday
    hsBoss: 6,         // boss kill freeze (steps)             — on top of bigDeath
    hsPlayer: 4,       // player-hit freeze (steps)            — the catastrophic beat
    // screen-shake peaks (px amplitude fed to addShake; decays at ~26/s already)
    shakeSmall: 6,     // midship / elite kill      (~0.23s)
    shakeMedium: 14,   // player hit / boss phase   (~0.5s)
    shakeLong: 22,     // boss kill                 (~0.85s)
    shakeMax: 24,      // hard clamp in addShake (was 8; raised so the big tiers land)
    // popcorn scale-pop: the sprite briefly swells then vanishes (no hitstop)
    popScale: 1.15,    // peak scale multiple of the enemy sprite
    popLife: 0.10,     // s the pop sprite lives (a quick punch)
    // fire-beat "crack": a 2-frame white core at the emitter on each volley beat
    crackSize: 34,     // px (kept subtle so a crest of emitters doesn't flash-spam)
    crackLife: 0.045,  // s (~2-3 frames)
    // player-hit composite dip (uses the existing GL bloom uniform — no new pass)
    hitBloomDip: 0.5   // bloom drops to this on a player hit, then lerps back to 1.0
  };

  var UI_CYAN = '#5fe6ff', UI_GOLD = '#ffd766', UI_RED = '#ff5a6e';
  var HUBRIS_COL = '#ffc24a';    // hubris gold tint (distinct from loot UI_GOLD)
  function UI_DIM() { return '#6fa9b8'; }

  // ---------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------
  Game.boot = function () {
    glCanvas = document.getElementById('gl');
    hudCanvas = document.getElementById('hud');
    if (!GL.init(glCanvas)) {
      showMsg('<b>HUBRIS</b><br><br>This game needs <b>WebGL2</b>, which your browser or GPU did not provide.<br><br>Try a recent Chrome, Edge, or Firefox with hardware acceleration enabled.');
      return;
    }
    hud = hudCanvas.getContext('2d');
    Run.init(hudCanvas);
    Engine.onFirstGesture(function () { SFX.ensure(); if (window.MUSIC) { MUSIC.init(); MUSIC.setTheme('title'); } });
    window.addEventListener('resize', onResize);
    onResize();
    G = makeState({});
    G.mode = 'title';
    Engine.start(update, render);
  };

  function showMsg(html) { var m = document.getElementById('msg'); m.innerHTML = html; m.style.display = 'flex'; }
  function onResize() {
    GL.resize();
    var v = GL.viewSize();
    hudCanvas.width = v.w; hudCanvas.height = v.h;
  }

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------
  function makeState(opts) {
    opts = opts || {};
    Engine.clearAllPools();
    timers.length = 0;
    Patterns.setGlobal(1, 1);
    goldCombo = 0; goldComboT = 0;
    resetForms(); curFormId = 0;
    for (var h = 0; h < hazards.length; h++) hazards[h].active = false;
    return {
      mode: 'title',
      score: 0, wallet: 0,
      lives: opts.lives != null ? opts.lives : 3,
      graze: 0,
      mult: 1, multFrom: 1, multDecayT: 0,
      // HUBRIS meter: persistent stepped multiplier (step index -> HUBRIS_MULT).
      // prog = 0..1 toward the next step; peak = highest step reached this run.
      hubris: { step: 0, prog: 0, peak: 0 },
      // arcade run tally (grazes read from G.graze, peak from G.hubris.peak).
      tally: { waves: 0, wipes: 0, phases: 0, untouched: 0 },
      waveHits: 0,   // player hits taken in the current wave (for UNTOUCHED)
      skillEvtT: null, skillEvtSlot: 0,   // skillEvent anti-overlap stacking (fix #5)
      rank: 1,
      paused: false,
      time: 0,
      hitstopT: 0,   // micro-hitstop remaining (s of SIM frozen); see JUICE + update()
      player: {
        x: W / 2, y: H - 300, alive: true, invuln: 2.0, blink: 0,
        fireT: 0, respawnT: 0, dead: false, drones: [], recoil: 0, hammerT: 0, edictT: 0, volleyN: 0
      },
      vaunt: { gauge: (opts.gaugePct || 0) * GAUGE_MAX, active: false, timer: 0, duration: VAUNT_DUR, killCount: 0, mercy: 0, ready: (opts.gaugePct || 0) >= 1 },
      // special weapon
      sp: { charge: 3, max: 3, flash: 0 },
      // god boons
      attackGod: null, attackR: 1,
      specialGod: null, specialR: 1,
      communion: null,
      mods: {
        zeusChain: 0, zeusCrit: false, zeusFork: false, zeusField: false,
        poseidonBig: false, poseidonDrag: false, poseidonSplash: false, poseidonForce: false,
        artemisCrit: 0, artemisRefund: false, artemisSpread: false, artemisMulti: false,
        aphroLong: false, aphroExplode: false, aphroTaunt: false, aphroFast: false,
        aresDecay: false, aresCharge: false, aresTerror: false, aresSpoils: false,
        heimVigil: false, heimPrism: false, heimHorn: false, heimEcho: false,
        raRamp: false, raSpread: false, raSplit: false, raBurn: false,
        anubisThresh: false, anubisRefund: false, anubisShard: false, anubisBossDmg: false,
        lokiLong: false, lokiBoom: false, lokiVaunt: false, lokiChance: false,
        odinRaven: false, odinMark: false, odinRavenMark: false, odinGungnir: false,
        wukongClones: false, wukongStaff: false, wukongSpecial: false, wukongChance: false,
        quetzBig: false, quetzGold: false, quetzCircle: false, quetzPierce: false,
        thorBelt: false, thorFast: false, thorGauntlet: false, thorSkymark: false,
        guanWide: false, guanOath: false, guanWake: false, guanSpoils: false,
        jadeOften: false, jadeStun: false, jadeWrath: false, jadeTribute: false
      },
      duos: {
        eclipse: false, worldSerpent: false, deathSentence: false,
        loveAndWar: false, doubleTrouble: false, huntersEye: false,
        bloodAndFire: false, typhoonPillar: false, allfathersWrath: false, featheredHeart: false,
        stormfathers: false,
        ragnarok: false, wildHunt: false, fifthSunDawn: false, havocInHeaven: false,
        eternalDevotion: false, stormSurge: false,
        swornBrothers: false, saintOfWar: false, twoThrones: false, godsOfWar: false, peachBanquet: false,
        theAllseeing: false, heraldOfRagnarok: false, falseDawn: false
      },
      frenzy: { stacks: 0, decayT: 0 },
      thorBuff: 0,
      hammers: [],
      // god entities
      ra: { active: false, target: null, ramp: 0, tx: 0, ty0: 0, ty1: 0 },
      decoy: { active: false, x: 0, y: 0, timer: 0, absorb: 0 },
      ravens: [],
      gungnir: { active: false, x: 0, y: 0, timer: 0, tx: 0, ty: 0, ang: 0, visited: [] },
      wraiths: [],
      clones: [],
      debris: [],
      // god-special timers: Ra apotheosis surge, Gjallarhorn echo, Verdict 2nd wave + peach window
      raSurgeT: 0, hornEchoT: 0, verdict: { t: 0, mult: 0.5 }, verdictPeachT: 0,
      hermes: { speed: 0, focus: 0, recharge: 0, graze: 0 },
      charms: {},
      charmElite: 1, critBonus: 0, charmShop: 0, noSpill: false, rerollHalf: false, keepMult: false, vauntBonusMul: 1, charmMark: 0,
      // ghost dodge (Shift tap-and-release dash; a held Shift is pure focus)
      dash: { cd: 0, active: 0, dirx: 0, diry: 0, ghosts: [], shiftT: 0, pend: false, pendx: 0, pendy: 0, wasFocus: false },
      // MIDAS cursed-gold gilding: t = freeze remaining (input ignored, invuln,
      // gold-statue), graceT = post-freeze window that blocks chain-freezing.
      freeze: { t: 0, graceT: 0 },
      // scaling
      stats: { atkDmg: opts.baseDmg || 1, atkRate: 1, spDmg: 1, spRecharge: 1 },
      // retained generics
      up: { hitboxMul: 1, magnet: 0, goldWorth: 1, vdur: 0, multCap: 5 },
      aff: { name: '', desc: '', hpMul: 1, eliteGoldMul: 1, popcornAdd: 0, volatile: false, shopDiscount: 0 },
      boss: null, waveKind: 'normal', waveGrace: 0, clearT: 0, clearKind: 'wave',
      bg: makeBackground(),
      shakeX: 0, shakeY: 0, shakeMag: 0,
      chroma: 0, chromaTarget: 0, bloom: 1.0, bloomTarget: 1.0,
      flashAll: 0,
      popups: makePopups(),
      announce: { text: '', sub: '', t: 0, dur: 0 }
    };
  }

  Game.resetRun = function (opts) { G = makeState(opts); };
  Game.st = function () { return G; };
  Game.setMode = function (m) { G.mode = m; };

  // ---------------------------------------------------------------------
  // environments — the world under the fight (DANMAKU.md "Environments").
  // Three procedural parallax layers per sector: deep field (slow stars +
  // nebula tint), a structure layer (large drifting silhouettes in the sector's
  // pantheon architecture), and near-debris weather (fast sparse motes/embers).
  // All layers draw in the ADDITIVE base pass as LOW-saturation, LOW-alpha marks
  // so they never leave the #05080b dim band, never read as enemy warm/magenta,
  // and never additive-bright — an additive dim shape over pure black reads as a
  // dark silhouette, not a glow. The background dims further as live bullet
  // count rises (readability law) and is choreographed with the slot arc.
  // Painted layers drop in later via GL.drawBackdrop (slot s{n}-{layer}).
  //
  // Palettes pull from ART.md sector/pantheon tables, held dim:
  //  S1 TALOS      — bronze colonnades / temple fragments (CELESTIAL-adjacent).
  //  S2 AMMIT      — KEMET tomb architecture / colossal statuary (lapis+gold).
  //  S3 SOVEREIGN  — gilded palace lattice (gold + imperial violet).
  var SECTOR_ENV = [
    { slot: 's1',
      star: [0.42, 0.34, 0.24], starN: 70,
      neb: [[0.13, 0.085, 0.045], [0.05, 0.085, 0.10]],
      structCol: [0.115, 0.078, 0.040], structKind: 'colonnade',
      debrisCol: [0.16, 0.10, 0.05], debrisKind: 'ember' },
    { slot: 's2',
      star: [0.28, 0.30, 0.42], starN: 62,
      neb: [[0.045, 0.055, 0.125], [0.11, 0.088, 0.045]],
      structCol: [0.100, 0.086, 0.046], structKind: 'tomb',
      debrisCol: [0.13, 0.115, 0.075], debrisKind: 'dust' },
    { slot: 's3',
      star: [0.40, 0.34, 0.30], starN: 66,
      neb: [[0.095, 0.055, 0.120], [0.125, 0.100, 0.052]],
      structCol: [0.125, 0.102, 0.055], structKind: 'lattice',
      debrisCol: [0.17, 0.135, 0.070], debrisKind: 'gild' }
  ];

  var bgRng = Engine.mulberry32;   // shared seeded PRNG (single source; see engine.js)

  // Build the sub-parts of one structure unit ONCE (no per-frame alloc). Parts
  // are drawn relative to the unit origin. kind selects the architecture.
  function buildStructParts(kind, seed, scale) {
    var rng = bgRng(seed), parts = [], i;
    scale = scale || 1;
    if (kind === 'colonnade') {
      var cols = 4 + (rng() * 3 | 0), span = (520 + rng() * 260) * scale, colH = (360 + rng() * 200) * scale;
      var x0 = -span / 2, gap = span / (cols - 1);
      for (i = 0; i < cols; i++) {
        var cx = x0 + gap * i;
        parts.push({ spr: GL.SPR.STREAK, dx: cx, dy: 0, sx: 46 * scale, sy: colH, rot: 0, a: 0.9 });
        parts.push({ spr: GL.SPR.CORE, dx: cx, dy: -colH * 0.5, sx: 60 * scale, sy: 34 * scale, rot: 0, a: 0.7 }); // capital
      }
      parts.push({ spr: GL.SPR.STREAK, dx: 0, dy: -colH * 0.5 - 26 * scale, sx: span * 1.06, sy: 40 * scale, rot: Math.PI / 2, a: 0.8 }); // architrave
      parts.push({ spr: GL.SPR.STREAK, dx: 0, dy: colH * 0.5, sx: span * 1.1, sy: 46 * scale, rot: Math.PI / 2, a: 0.7 });                // stylobate
    } else if (kind === 'tomb') {
      var mw = (560 + rng() * 260) * scale, mh = (520 + rng() * 240) * scale;
      parts.push({ spr: GL.SPR.GLOW, dx: 0, dy: 0, sx: mw, sy: mh, rot: 0, a: 0.55 });                       // colossal mass
      parts.push({ spr: GL.SPR.GOLD, dx: 0, dy: -mh * 0.42, sx: mw * 0.55, sy: mh * 0.5, rot: 0, a: 0.7 });   // pediment / crown
      parts.push({ spr: GL.SPR.STREAK, dx: -mw * 0.24, dy: mh * 0.05, sx: 70 * scale, sy: mh * 0.8, rot: 0, a: 0.75 }); // pillar
      parts.push({ spr: GL.SPR.STREAK, dx: mw * 0.24, dy: mh * 0.05, sx: 70 * scale, sy: mh * 0.8, rot: 0, a: 0.75 });  // pillar
      parts.push({ spr: GL.SPR.CORE, dx: 0, dy: -mh * 0.08, sx: mw * 0.30, sy: mw * 0.30, rot: 0, a: 0.6 });  // statue head
      parts.push({ spr: GL.SPR.STREAK, dx: 0, dy: mh * 0.44, sx: mw * 1.05, sy: 54 * scale, rot: Math.PI / 2, a: 0.7 }); // base band
    } else { // lattice — gilded palace grid
      var gw = (620 + rng() * 220) * scale, gh = (520 + rng() * 200) * scale, nx = 5, ny = 5;
      for (i = 0; i < nx; i++) for (var j = 0; j < ny; j++) {
        var px = -gw / 2 + gw * i / (nx - 1), py = -gh / 2 + gh * j / (ny - 1);
        parts.push({ spr: GL.SPR.CORE, dx: px, dy: py, sx: 30 * scale, sy: 30 * scale, rot: 0, a: 0.8 });
      }
      // diagonal lattice struts
      for (i = 0; i < nx - 1; i++) {
        var lx = -gw / 2 + gw * (i + 0.5) / (nx - 1);
        parts.push({ spr: GL.SPR.STREAK, dx: lx, dy: 0, sx: 20 * scale, sy: gh * 1.02, rot: Math.PI / 6, a: 0.5 });
        parts.push({ spr: GL.SPR.STREAK, dx: lx, dy: 0, sx: 20 * scale, sy: gh * 1.02, rot: -Math.PI / 6, a: 0.5 });
      }
      parts.push({ spr: GL.SPR.RING, dx: 0, dy: 0, sx: gw * 0.5, sy: gh * 0.5, rot: 0, a: 0.6 });   // imperial seal
    }
    return parts;
  }

  function makeBackground(sector) {
    sector = sector || 0;
    var env = SECTOR_ENV[sector] || SECTOR_ENV[0];
    var seed = 0x9E37 ^ (sector * 2654435761);
    var rng = bgRng(seed);
    var stars = [], i;
    var bands = [{ sp: 22, sz: 2.6, a: 0.30 }, { sp: 46, sz: 3.8, a: 0.42 }, { sp: 80, sz: 5.2, a: 0.6 }];
    for (var l = 0; l < bands.length; l++) {
      var B = bands[l], per = Math.round(env.starN / bands.length);
      for (i = 0; i < per; i++) stars.push({ x: rng() * W, y: rng() * H, sp: B.sp, sz: B.sz * (0.6 + rng() * 0.8), a: B.a * (0.5 + rng() * 0.5), tw: rng() * TAU });
    }
    var nebula = [
      { x: W * 0.32, y: H * 0.34, r: 940, col: env.neb[0], a: 1.0, dx: 6, dy: 10 },
      { x: W * 0.70, y: H * 0.72, r: 1120, col: env.neb[1], a: 1.0, dx: -5, dy: 8 }
    ];
    // structure units spaced down the field; each carries prebuilt parts.
    var units = [], nUnits = 4;
    for (i = 0; i < nUnits; i++) {
      units.push({ x: (0.25 + rng() * 0.5) * W, y: (i / nUnits) * (H + 700) - 350, parts: buildStructParts(env.structKind, seed + i * 131, 1.0) });
    }
    // near-debris weather (fast, sparse)
    var debris = [];
    for (i = 0; i < 26; i++) debris.push({ x: rng() * W, y: rng() * H, vx: (rng() - 0.5) * 30, vy: 120 + rng() * 160, sz: 4 + rng() * 7, a: 0.3 + rng() * 0.5, tw: rng() * TAU });
    return {
      sector: sector, env: env, stars: stars, nebula: nebula, units: units, debris: debris,
      // choreography state (eased toward targets)
      structAlpha: 0, structTarget: 1, bright: 1, brightTarget: 1, scrollMul: 1, scrollTarget: 1,
      role: 'opener', dimFactor: 1,
      setpiece: { active: false, x: 0, y: 0, vy: 0, alpha: 0, parts: null },
      bossShadow: { active: false, y: 0, t: 0, alpha: 0 }
    };
  }

  // Readability law: the background loses every conflict with bullets. As live
  // enemy-bullet count crosses thresholds, scale layer alpha down (cheap).
  function bgDimFor(n) {
    if (n <= 60) return 1;
    if (n >= 220) return 0.32;
    return 1 - (n - 60) / 160 * 0.68;
  }
  Game.bgDimFor = bgDimFor;

  // Choreograph the background with the wave-slot arc. Called from beginWave/
  // beginBoss with the role already known there.
  function setBgRole(role) {
    var b = G.bg; if (!b) return;
    b.role = role;
    b.structTarget = 1;
    if (role === 'opener') { b.structAlpha = Math.min(b.structAlpha, 0.05); b.structTarget = 1; b.brightTarget = 1.0; b.scrollTarget = 1.0; }
    else if (role === 'build') { b.brightTarget = 1.0; b.scrollTarget = 1.0; }
    else if (role === 'feature') { b.brightTarget = 0.92; b.scrollTarget = 1.0; triggerSetpiece(); }
    else if (role === 'breather') { b.brightTarget = 1.28; b.scrollTarget = 0.65; }        // brightest, calmest
    else if (role === 'crescendo') { b.brightTarget = 0.68; b.scrollTarget = 1.7; }         // darken + accelerate
    else if (role === 'boss') { b.brightTarget = 0.16; b.scrollTarget = 1.3; triggerBossShadow(); }  // dim to near-black; boss arrives FROM the environment
  }
  function triggerSetpiece() {
    var b = G.bg, sp = b.setpiece;
    sp.active = true; sp.x = W * (0.32 + Math.random() * 0.36); sp.y = -640; sp.vy = 60; sp.alpha = 0;
    sp.parts = buildStructParts(b.env.structKind, (Math.random() * 1e9) | 0, 2.05); // one big set-piece crossing under the fight
  }
  function triggerBossShadow() {
    var b = G.bg, s = b.bossShadow;
    s.active = true; s.y = -520; s.t = 0; s.alpha = 0;   // a huge shadow precedes the boss's descent
  }

  function updateBackground(dt) {
    var b = G.bg, i;
    // ease choreography
    var k = Math.min(1, dt * 1.6);
    b.structAlpha += (b.structTarget - b.structAlpha) * (b.role === 'opener' ? Math.min(1, dt * 0.7) : k);
    b.bright += (b.brightTarget - b.bright) * k;
    b.scrollMul += (b.scrollTarget - b.scrollMul) * k;
    // readability dim from live bullet count
    var target = bgDimFor(Engine.bullets.count());
    b.dimFactor += (target - b.dimFactor) * Math.min(1, dt * 4);
    var sm = b.scrollMul;
    for (i = 0; i < b.stars.length; i++) {
      var s = b.stars[i];
      s.y += s.sp * sm * dt; s.tw += dt * 3;
      if (s.y > H + 10) { s.y = -10; s.x = Math.random() * W; }
    }
    for (i = 0; i < b.nebula.length; i++) {
      var n = b.nebula[i];
      n.x += n.dx * sm * dt; n.y += n.dy * sm * dt;
      if (n.x < -300) n.x = W + 300; if (n.x > W + 300) n.x = -300;
      if (n.y < -300) n.y = H + 300; if (n.y > H + 300) n.y = -300;
    }
    for (i = 0; i < b.units.length; i++) {
      var u = b.units[i];
      u.y += 40 * sm * dt;
      if (u.y > H + 420) { u.y -= (H + 700); u.x = (0.25 + Math.random() * 0.5) * W; }
    }
    for (i = 0; i < b.debris.length; i++) {
      var d = b.debris[i];
      d.x += d.vx * dt; d.y += d.vy * sm * dt; d.tw += dt * 4;
      if (d.y > H + 12) { d.y = -12; d.x = Math.random() * W; }
    }
    var sp = b.setpiece;
    if (sp.active) {
      sp.y += sp.vy * dt; sp.alpha += (1 - sp.alpha) * Math.min(1, dt * 1.2);
      if (sp.y > H + 700) sp.active = false;
    }
    var bs = b.bossShadow;
    if (bs.active) {
      bs.t += dt; bs.y += 150 * dt;
      bs.alpha = G.boss && G.boss.arrived ? Math.max(0, bs.alpha - dt * 0.8) : Math.min(1, bs.alpha + dt * 1.3);
      if (G.boss && G.boss.arrived && bs.alpha <= 0.01) bs.active = false;
    }
  }

  // Reconfigure the environment for a sector (called before its waves). Resets
  // the structure reveal so the opener eases it in.
  Game.setSector = function (idx) {
    idx = idx || 0;
    if (G) G.bg = makeBackground(idx);
  };
  Game.envState = function () {
    var b = G && G.bg; if (!b) return null;
    return {
      sector: b.sector, slot: b.env.slot, role: b.role,
      structAlpha: b.structAlpha, bright: b.bright, scrollMul: b.scrollMul, dimFactor: b.dimFactor,
      structCol: b.env.structCol.slice(), starCol: b.env.star.slice(),
      units: b.units.length, setpiece: b.setpiece.active, bossShadow: b.bossShadow.active, bossShadowY: b.bossShadow.y,
      bulletCount: Engine.bullets.count()
    };
  };

  // ---------------------------------------------------------------------
  // popups / announce / fx
  // ---------------------------------------------------------------------
  function makePopups() {
    var arr = new Array(72);
    for (var i = 0; i < 72; i++) arr[i] = { active: false, x: 0, y: 0, vy: 0, age: 0, life: 1, text: '', col: UI_GOLD, size: 30 };
    return arr;
  }
  function addPopup(x, y, text, col, size) {
    var arr = G.popups;
    for (var i = 0; i < arr.length; i++) {
      if (!arr[i].active) {
        var p = arr[i];
        p.active = true; p.x = x; p.y = y; p.vy = -80; p.age = 0; p.life = 1.1; p.text = text; p.col = col || UI_GOLD; p.size = size || 30; return;
      }
    }
  }
  function updatePopups(dt) {
    var arr = G.popups;
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i]; if (!p.active) continue;
      p.age += dt; p.y += p.vy * dt; p.vy *= 0.92;
      if (p.age >= p.life) p.active = false;
    }
  }
  function announce(text, sub, dur) { G.announce.text = text; G.announce.sub = sub || ''; G.announce.t = 0; G.announce.dur = dur || 2.6; }

  var K_SPARK = 0, K_RING = 1, K_FLASH = 2;
  function spark(x, y, col, count, spd, size) {
    for (var i = 0; i < count; i++) {
      var p = Engine.particles.alloc(); if (!p) return;
      var a = Math.random() * TAU, s = spd * (0.4 + Math.random() * 0.9);
      p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s;
      p.age = 0; p.life = 0.35 + Math.random() * 0.35;
      p.size = size || 26; p.grow = -(size || 26) * 0.6; p.drag = 0.9;
      p.r = col[0]; p.g = col[1]; p.b = col[2]; p.a = 1;
      p.spr = GL.SPR.SPARK; p.rot = a; p.angVel = (Math.random() - 0.5) * 10; p.kind = K_SPARK;
    }
  }
  function ringShock(x, y, col, size, grow, life) {
    var p = Engine.particles.alloc(); if (!p) return;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.age = 0; p.life = life || 0.5;
    p.size = size; p.grow = grow; p.drag = 1;
    p.r = col[0]; p.g = col[1]; p.b = col[2]; p.a = 1;
    p.spr = GL.SPR.RING; p.rot = 0; p.angVel = 0; p.kind = K_RING;
  }
  function flash(x, y, col, size, life) {
    var p = Engine.particles.alloc(); if (!p) return;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.age = 0; p.life = life || 0.18;
    p.size = size; p.grow = size * 1.5; p.drag = 1;
    p.r = col[0]; p.g = col[1]; p.b = col[2]; p.a = 1;
    p.spr = GL.SPR.GLOW; p.rot = 0; p.angVel = 0; p.kind = K_FLASH;
  }
  // jagged additive polyline via a trail of bright dots (chain lightning)
  function arcFx(x1, y1, x2, y2, col) {
    var seg = 6, px = x1, py = y1;
    for (var i = 1; i <= seg; i++) {
      var t = i / seg;
      var jx = (Math.random() - 0.5) * 40, jy = (Math.random() - 0.5) * 40;
      var nx = x1 + (x2 - x1) * t + (i < seg ? jx : 0);
      var ny = y1 + (y2 - y1) * t + (i < seg ? jy : 0);
      var steps = 3;
      for (var k = 0; k < steps; k++) {
        var p = Engine.particles.alloc(); if (!p) return;
        var f = k / steps;
        p.x = px + (nx - px) * f; p.y = py + (ny - py) * f;
        p.vx = 0; p.vy = 0; p.age = 0; p.life = 0.12;
        p.size = 20; p.grow = -30; p.drag = 1;
        p.r = col[0]; p.g = col[1]; p.b = col[2]; p.a = 1;
        p.spr = GL.SPR.CORE; p.rot = 0; p.angVel = 0; p.kind = K_FLASH;
      }
      px = nx; py = ny;
    }
  }
  function addShake(mag) { if (mag > G.shakeMag) G.shakeMag = Math.min(mag, JUICE.shakeMax); }

  // Micro-hitstop: freeze the SIM for `steps` fixed steps. max() so overlapping
  // kills don't stack into a long stall. Consumed in update() — never touches the
  // wall clock, the music scheduler (real-time WebAudio), or pause handling.
  function hitstop(steps) { var t = steps * Engine.DT; if (t > G.hitstopT) G.hitstopT = t; }

  // Popcorn kill flourish: a quick 1.15x scale-pop of the dead sprite (it swells
  // toward white, then vanishes). One additive particle — no hitstop, no shake.
  function popEnemy(e) {
    var p = Engine.particles.alloc(); if (!p) return;
    p.x = e.x; p.y = e.y; p.vx = 0; p.vy = 0; p.age = 0; p.life = JUICE.popLife;
    p.size = e.scale; p.grow = e.scale * (JUICE.popScale - 1) / JUICE.popLife; p.drag = 1;
    p.r = e.r + (1 - e.r) * 0.55; p.g = e.g + (1 - e.g) * 0.55; p.b = e.b + (1 - e.b) * 0.55;
    p.a = 0.9; p.spr = e.spr; p.rot = e.rot; p.angVel = 0; p.kind = K_FLASH;
  }

  // Fire-beat "crack": a brief white core at the emitter the instant a volley
  // fires (the rhythm-law downbeat). Cheap single sprite; pose beats are skipped.
  function crack(x, y) {
    var p = Engine.particles.alloc(); if (!p) return;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.age = 0; p.life = JUICE.crackLife;
    p.size = JUICE.crackSize; p.grow = JUICE.crackSize * 2; p.drag = 1;
    p.r = 1; p.g = 0.98; p.b = 0.92; p.a = 0.85;
    p.spr = GL.SPR.CORE; p.rot = 0; p.angVel = 0; p.kind = K_FLASH;
  }

  // ---------------------------------------------------------------------
  // gold + wallet
  // ---------------------------------------------------------------------
  var THEFT_SPEED = 260;   // MIDAS gold-theft drift (px/s) once gold is past the magnet
  function spawnGold(x, y, count, value, bank, life, cursed) {
    for (var i = 0; i < count; i++) {
      var g = Engine.gold.alloc(); if (!g) return;
      var a = Math.random() * TAU, s = 120 + Math.random() * 260;
      g.x = x; g.y = y; g.vx = Math.cos(a) * s; g.vy = Math.sin(a) * s - 80;
      g.age = 0; g.life = life || (11 + Math.random() * 3);
      g.value = value; g.rot = Math.random() * TAU; g.angVel = (Math.random() - 0.5) * 8;
      g.scale = 20; g.homing = false; g.magnet = 240; g.bank = bank || 0;
      g.cursed = !!cursed;   // pooled hygiene: every coin declares its curse state
      g.r = 1; g.g = 0.78; g.b = 0.24;
    }
  }
  // cursed gold is never auto-homed (deliberate walk-into pickup only), so a
  // phase-transition homeAll can't vacuum a fresh cursed coin into the player.
  function homeAllGold() { Engine.gold.forEach(function (g) { if (!g.cursed) g.homing = true; }); }
  // MIDAS is alive + fighting: uncollected loot drifts to HIM (the gold-theft loop).
  function midasFight() { var b = G.boss; return !!(b && b.isMidas && b.arrived && !b.dying); }

  function updateGold(dt) {
    var px = G.player.x, py = G.player.y;
    var vauntOn = G.vaunt.active;
    var magR = MAGNET_R * (1 + G.up.magnet);
    var thief = midasFight() ? G.boss : null;   // only steals while alive; zero cost otherwise
    Engine.gold.forEach(function (g) {
      g.age += dt; g.rot += g.angVel * dt;
      var dx = px - g.x, dy = py - g.y, d2 = dx * dx + dy * dy;
      // cursed gold ignores the magnet entirely — it must be walked into.
      var toPlayer = (g.homing || vauntOn || d2 < magR * magR) && !g.cursed;
      if (toPlayer && G.player.alive) {
        var d = Math.sqrt(d2) || 1;
        g.magnet = Math.min(g.magnet + 2600 * dt, 1900);
        g.vx = (dx / d) * g.magnet; g.vy = (dy / d) * g.magnet;
      } else if (thief && !g.cursed) {
        // GOLD THEFT: constant ~260px/s vacuum toward MIDAS (apotheosis rescues it —
        // vauntOn flips gold to toPlayer above, so cashing out beats the theft).
        var tx = thief.x - g.x, ty = thief.y - g.y, td = Math.sqrt(tx * tx + ty * ty) || 1;
        g.vx = (tx / td) * THEFT_SPEED; g.vy = (ty / td) * THEFT_SPEED;
      } else { g.vx *= 0.95; g.vy = g.vy * 0.95 + 20 * dt; }
      g.x += g.vx * dt; g.y += g.vy * dt;
      if (G.player.alive && d2 < 46 * 46) { collectGold(g); Engine.gold.release(g); return; }
      // MIDAS eats loot into his hoard (spilled back as a jackpot on death) — but
      // only gold in the DRIFT-TO-BOSS state. A coin the player is already
      // magnetizing (toPlayer: homing / vaunt / inside magnet) is theirs and can't
      // be snatched at point-blank, so the point-blank play HUBRIS rewards isn't
      // punished. Banked premium rides into the hoard alongside value (tracked
      // separately, in wallet units) so the jackpot repays full stolen worth.
      if (thief && !g.cursed && !toPlayer) {
        var bx = thief.x - g.x, by = thief.y - g.y, br = thief.radius + 30;
        if (bx * bx + by * by < br * br) { thief.hoard += g.value; thief.hoardBank += (g.bank || 0); thief.hoardCount++; flash(g.x, g.y, [1, 0.82, 0.3], 30, 0.16); Engine.gold.release(g); return; }
      }
      if (g.age >= g.life || g.y > H + 120) Engine.gold.release(g);
    });
  }
  var goldCombo = 0, goldComboT = 0;
  function collectGold(g) {
    goldCombo++; goldComboT = 0.55;
    var cm = g.cursed ? 2 : 1;   // CURSED GOLD is worth 2x — the greed temptation is real
    var gw = G.up.goldWorth * (G.communion === 'KEMET' ? 1.15 : 1);   // Rite of Two Suns
    addScore(GOLD_VALUE * g.value * cm * G.mult * gw);
    addGauge(GOLD_GAUGE * g.value * cm);
    var bank = g.bank > 0 ? g.bank : Math.round(BANK_PER_SHARD * g.value * cm * gw);
    bank = Math.round(bank * hMult());   // HUBRIS multiplies all gold earned
    G.wallet += bank;
    Run.addCareerGold(bank);
    SFX.gold(goldCombo);
    flash(g.x, g.y, g.cursed ? [1, 0.75, 0.2] : [1, 0.85, 0.4], g.cursed ? 60 : 40, g.cursed ? 0.2 : 0.14);
    if (g.cursed) gildPlayer(g.x, g.y);   // the curse bites: a golden statue, briefly
  }
  // CURSED GOLD pickup gilds the player: frozen ~0.45s (no move/fire/dodge), fully
  // invulnerable, gold-statue tint, a petrify sting — but NOT a hit (HUBRIS intact).
  // Gated so pickups mid-freeze / mid-grace can't stack or chain-freeze, and so it
  // can never fire during the death or clear sequence.
  function gildPlayer(x, y) {
    if (G.mode !== 'playing') return;
    if (!G.player.alive) return;
    if (G.freeze.t > 0 || G.freeze.graceT > 0) return;
    G.freeze.t = 0.45;
    G.player.invuln = Math.max(G.player.invuln, 0.55);   // covers the whole freeze + a sliver
    // A statue does not keep dashing: cancel any in-flight dash so it can't RESUME
    // in its old direction on unfreeze (active/dir survive the freeze early-return).
    G.dash.active = 0; G.dash.dirx = 0; G.dash.diry = 0; G.dash.pend = false;
    SFX.petrify();
    ringShock(x, y, [1, 0.8, 0.3], 70, 2600, 0.5);
    flash(G.player.x, G.player.y, [1, 0.85, 0.4], 220, 0.3);
    addShake(JUICE.shakeSmall);
  }

  // ---------------------------------------------------------------------
  // scoring / gauge / vaunt
  // ---------------------------------------------------------------------
  // HUBRIS multiplies ALL score (here) and gold (collectGold), composing with the
  // transient burst G.mult that callers already fold into n.
  function hMult() { return HUBRIS_MULT[G.hubris.step]; }
  // returns the amount actually granted (post-HUBRIS) so callers can show the
  // real number in floaties/announces instead of the pre-HUBRIS base.
  function addScore(n) { var d = Math.floor(n * hMult()); G.score += d; Run.reportScore(G.score); return d; }
  // build step-progress; carry across step boundaries, cap at the top step.
  function addHubris(amt) {
    var h = G.hubris;
    if (h.step >= HUBRIS_MAX) { h.prog = 1; return; }
    h.prog += amt;
    while (h.prog >= 1 && h.step < HUBRIS_MAX) { h.prog -= 1; h.step++; SFX.hubrisUp(); }
    if (h.step >= HUBRIS_MAX) h.prog = 1;
    if (h.step > h.peak) h.peak = h.step;
  }
  // taking a hit: drop one step (never below x1.0) and clear partial progress.
  function dropHubris() {
    var h = G.hubris;
    if (h.step > 0) { h.step--; SFX.hubrisDrop(); }
    h.prog = 0;
  }
  // named skill event: small gold popup + sting + a full step of progress. The
  // shared helper for FORMATION WIPE / UNTOUCHED / PHASE SEIZED (spellcard homage).
  // If another skill popup fired within ~1s (e.g. WIPE + UNTOUCHED on the same
  // clear frame), stack this one ~70px lower so both stay readable; the slot
  // resets per wave (beginWave) and whenever the gap exceeds 1s.
  function skillEvent(x, y, text, size) {
    if (G.skillEvtT != null && G.time - G.skillEvtT < 1.0) G.skillEvtSlot++;
    else G.skillEvtSlot = 0;
    G.skillEvtT = G.time;
    addPopup(x, y + G.skillEvtSlot * 70, text, HUBRIS_COL, size || 34);
    SFX.skillEvent();
    addHubris(1.0);
  }
  function addGauge(n) {
    if (G.vaunt.active) return;
    G.vaunt.gauge = Math.min(GAUGE_MAX, G.vaunt.gauge + n);
    if (G.vaunt.gauge >= GAUGE_MAX) G.vaunt.ready = true;
  }

  function tryVaunt() {
    var v = G.vaunt;
    if (v.active || v.gauge < GAUGE_MAX) return;
    v.active = true;
    v.duration = VAUNT_DUR + G.up.vdur + (G.communion === 'OLYMPUS' ? 2 : 0);
    v.timer = v.duration; v.killCount = 0; v.ready = false;
    G.mult = 3; G.multDecayT = 0;
    G.player.invuln = Math.max(G.player.invuln, VAUNT_SHIELD);
    cancelBulletsToGold(midasFight());   // vs MIDAS, the cancelled gold is CURSED
    ringShock(G.player.x, G.player.y, [1, 0.85, 0.35], 60, 3200, 0.6);
    ringShock(G.player.x, G.player.y, [0.4, 0.95, 1], 40, 2400, 0.45);
    flash(G.player.x, G.player.y, [1, 0.95, 0.7], 260, 0.3);
    addShake(7);
    G.chromaTarget = 0.009; G.bloomTarget = 1.9;   // POLISH: chroma capped so bullet color families survive the burst
    announce('APOTHEOSIS', '', 1.2);
    SFX.vaunt();
    if (window.MUSIC) MUSIC.apotheosis(true);   // open the filter / lift the key — the payday sounds golden
    apotheosisRider();          // god-flavor kicker keyed on the ATTACK god
  }

  // APOTHEOSIS god riders — fired once at activation, keyed on the attack god.
  // Modest numbers on purpose: the cancel + shield + multiplier jump is the
  // power; these are the flavor kicker. All scale with G.attackR. Every
  // "per foe" rider lands fully on a lone boss (VS BOSSES rule).
  function apotheosisRider() {
    var g = G.attackGod; if (!g) return;
    var R = G.attackR, p = G.player, i;
    function each(fn) { Engine.enemies.forEach(function (e) { if (!e.dying && !e.charmed) fn(e); }); }
    switch (g) {
      case 'zeus':          // lightning strikes every foe (direct, no re-chain)
        each(function (e) { arcFx(p.x, p.y, e.x, e.y, [0.7, 0.9, 1]); damageEnemy(e, 8 * G.stats.atkDmg * R, false); });
        break;
      case 'poseidon': {    // full-width tidal slam
        each(function (e) {
          damageEnemy(e, 6 * G.stats.atkDmg * R, false);
          if (!e.boss) { pushDisp(e, p.x, p.y, 650); e.impactDmg = 10 * G.stats.atkDmg * R; }
          else pushDisp(e, p.x, p.y, 200);
        });
        ringShock(p.x, p.y, [0.2, 0.8, 0.85], 80, 4200, 0.6);
        break;
      }
      case 'artemis':       // guaranteed-crit arrow per foe, each Marks
        each(function (e) { damageEnemy(e, 3 * G.stats.atkDmg * R, true); markEnemy(e); spark(e.x, e.y, [0.7, 1, 0.3], 5, 260, 20); });
        break;
      case 'aphrodite':     // charm pulse (bosses Weakened; popcorn charmed outright)
        each(function (e) {
          if (e.boss) { e.weak = true; e.weakT = 6; }
          else if (e.maxhp < 8) charmEnemy(e);
          else { e.charmMeter += 4; if (e.charmMeter >= (G.mods.aphroFast ? 3 : CHARM_THRESHOLD)) charmEnemy(e); }
        });
        break;
      case 'ares':          // terror nova + frenzy jumps to max (terrify → Shaken on bosses)
        each(function (e) { terrify(e, p.x, p.y); });
        G.frenzy.stacks = 10; G.frenzy.decayT = G.mods.aresDecay ? 3.0 : 1.5;
        break;
      case 'ra':            // ignite all + beam surges to full ramp for 4s
        each(function (e) { applyBurn(e, 20 * R, 3.0); });
        G.raSurgeT = 4;
        break;
      case 'anubis':        // judgment burst: 15% of MISSING hp (bosses capped 6% maxhp)
        each(function (e) {
          var d = e.boss ? Math.min(0.15 * (e.maxhp - e.hp), 0.06 * e.maxhp) : 0.15 * (e.maxhp - e.hp);
          flash(e.x, e.y, [1, 0.85, 0.35], 90, 0.25);
          if (d > 0) damageEnemy(e, d, false);
        });
        break;
      case 'loki':          // mass Confuse (bosses Weakened) + free decoy — pure deception, no damage by design
        each(function (e) { if (e.boss) { e.weak = true; e.weakT = 6; } else e.confuseT = Math.max(e.confuseT, 2.5); });
        shadowTwin();
        break;
      case 'odin': {        // Gungnir storm: 6 spears round-robin (all land on a lone boss)
        var list = [];
        each(function (e) { list.push(e); });
        for (i = 0; i < 6 && list.length; i++) {
          var t = list[i % list.length];
          if (t.dying) continue;
          arcFx(p.x, p.y - 30, t.x, t.y, [1, 0.9, 0.5]);
          damageEnemy(t, GUNGNIR_DMG * 0.6 * G.stats.atkDmg * R, false);
          if (!t.dying) markEnemy(t);
        }
        break;
      }
      case 'thor': {        // hammer cyclone: 3 big hammers at the 3 toughest foes
        var pool = [];
        each(function (e) { pool.push(e); });
        pool.sort(function (a, b) { return b.maxhp - a.maxhp; });
        for (i = 0; i < 3; i++) {
          var tgt = pool.length ? pool[i % pool.length] : null;
          G.hammers.push({ x: p.x + (i - 1) * 60, y: p.y - 24, state: 'out', vy: -1150, t: 0, dmg: LANCE_DMG * 1.6 * G.stats.atkDmg * R, kb: 360, big: true, spin: i * 2, hoverT: 0, hit: [], target: tgt, targetSeq: tgt ? tgt.seq : 0 });
        }
        addShake(6);
        break;
      }
      case 'wukong': {      // summon max clones + refresh timers
        var maxC = G.mods.wukongClones ? 3 : 2;
        while (G.clones.length < maxC) spawnClone();
        for (i = 0; i < G.clones.length; i++) G.clones[i].timer = G.mods.wukongClones ? 7 : 4;
        break;
      }
      case 'guanyu':        // crescent nova: ring of 8 big crescents outward
        for (i = 0; i < 8; i++) {
          var s = allocShot(); if (!s) break;
          var a = (i / 8) * TAU;
          s.x = p.x + Math.cos(a) * 30; s.y = p.y + Math.sin(a) * 30;
          s.vx = Math.cos(a) * 900; s.vy = Math.sin(a) * 900;
          s.radius = 36; s.scale = 70; s.damage = 3 * G.stats.atkDmg * R; s.age = 0; s.life = 1.6;
          s.pierce = 3; s.kind = 6; s.faction = 0; s.big = false; s.crescent = true;
          s.r = 0.30; s.g = 0.95; s.b = 0.55;
        }
        break;
      case 'jade': {        // mass Stun 1.2s (bosses take damage instead) + heavy edict on the strongest
        each(function (e) {
          if (e.boss) damageEnemy(e, 12 * G.stats.atkDmg * R, false);
          else { e.stunT = Math.max(e.stunT, 1.2); flash(e.x, e.y, [0.8, 0.6, 1], 60, 0.2); }
        });
        var strong = highestHpEnemy();
        if (strong) fireVerdictEdict(strong, true, 15 * G.stats.atkDmg * R);
        break;
      }
      case 'quetz':         // TWO sky serpents sweep simultaneously
        skySerpent(false); skySerpent(true);
        break;
      case 'heimdall':      // Gjallarhorn echo: Mark all + shove bullets back 200px
        each(function (e) { markEnemy(e); });
        shoveBullets(p.x, p.y, 200);
        ringShock(p.x, p.y, [1, 0.89, 0.76], 90, 4200, 0.6);
        break;
    }
  }
  // Displace enemy bullets caught within selRadius of a selection center
  // (cx,cy). Displacement direction is ALWAYS away from the PLAYER — never
  // toward — so a bullet lying between an off-player impact point and the
  // player can never be shoved INTO the player. selRadius <= 0 selects every
  // enemy bullet. When `up` is set the nudge is straight up (screen-safe by
  // construction) instead of the radial away-from-player push.
  function displaceBullets(cx, cy, selRadius, dist, slowT, timeScale, up) {
    var r2 = selRadius > 0 ? selRadius * selRadius : Infinity;
    var px = G.player.x, py = G.player.y;
    Engine.bullets.forEach(function (b) {
      if (b.friendly) return;
      var sx = b.x - cx, sy = b.y - cy;
      if (sx * sx + sy * sy > r2) return;
      if (up) { b.y -= dist; }
      else {
        var dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy) || 1;
        b.x += (dx / d) * dist; b.y += (dy / d) * dist;
      }
      b.slowT = slowT; b.timeScale = timeScale;
    });
  }
  // radially shove all enemy bullets away from the player — shoved, not canceled
  function shoveBullets(x, y, dist) { displaceBullets(x, y, 0, dist, 0.25, 0.5, false); }
  function updateVaunt(dt) {
    var v = G.vaunt;
    if (v.mercy > 0) v.mercy -= dt;
    if (v.active) {
      v.timer -= dt;
      v.gauge = Math.max(0, (v.timer / v.duration) * GAUGE_MAX);
      if (Math.random() < dt * 7) spawnGold(100 + Math.random() * (W - 200), -40, 1, 0.6);
      // POLISH (ART.md combat color law > juice): cap the chroma offset at ~45%
      // of the old peak AND scale it DOWN as the screen fills, so rainbow fringing
      // never breaks bullet family colors exactly when density is highest.
      var _cn = Engine.bullets.count();
      var _dens = 1 - Math.min(0.6, _cn / 260 * 0.6);
      G.chromaTarget = (0.006 + 0.004 * (0.5 + 0.5 * Math.sin(G.time * 14))) * _dens;
      G.bloomTarget = 1.9;
      if (v.timer <= 0) endVaunt();
    } else { G.chromaTarget = 0; G.bloomTarget = 1.0; }
    if (G.multDecayT > 0) {
      G.multDecayT -= dt;
      var f = Math.max(0, G.multDecayT / 2.0);
      G.mult = 1 + (G.multFrom - 1) * f;
      if (G.multDecayT <= 0) G.mult = 1;
    }
  }
  function endVaunt() {
    var v = G.vaunt; v.active = false;
    if (window.MUSIC) MUSIC.apotheosis(false);   // close the lift when the gauge drains
    var payout = v.killCount * G.mult * VAUNT_BASE * G.vauntBonusMul;   // IMPERIAL SEAL charm boosts payout
    if (payout > 0) {
      var _payGain = addScore(payout);
      addPopup(W / 2, H * 0.42, 'APOTHEOSIS BONUS  +' + commas(_payGain), UI_GOLD, 46);   // post-HUBRIS (fix #3)
      announce('APOTHEOSIS BONUS', v.killCount + ' kills  x' + G.mult.toFixed(1), 2.2);
      SFX.vauntBonus();
    }
    G.multFrom = G.mult; G.multDecayT = 2.0;
    v.mercy = MERCY;
    G.player.invuln = Math.max(G.player.invuln, v.mercy);
    v.gauge = 0; v.ready = false;
    addShake(4);
  }
  // midas=true: the cancelled attacks are HIS, so the gold spawns CURSED (converting
  // Midas' fire is the only cursed-gold source — his apotheosis + phase cancels).
  function cancelBulletsToGold(midas) {
    var val = 0.5, n = 0;
    Engine.bullets.forEach(function (b) {
      if (Engine.gold.freeTop > 0) spawnGold(b.x, b.y, 1, val, 0, 0, midas);
      flash(b.x, b.y, midas ? [1, 0.72, 0.22] : [1, 0.8, 0.3], 22, 0.12);
      Engine.bullets.release(b); n++;
    });
    // golden cascade that scales with how full the screen was (the denser the
    // crest, the bigger the payday sounds) — layered under the vaunt whoosh /
    // boss gong. Internally length-capped so it stays short + mid-band.
    if (n > 0) SFX.cancelCascade(n);
  }

  // ---------------------------------------------------------------------
  // SPECIAL weapon
  // ---------------------------------------------------------------------
  function addCharge(n) { G.sp.charge = Math.min(G.sp.max, G.sp.charge + n); }

  function updateSpecial(dt) {
    var rate = SP_RECHARGE * G.stats.spRecharge * (1 + G.hermes.recharge);
    G.sp.charge = Math.min(G.sp.max, G.sp.charge + rate * dt);
    if (G.sp.flash > 0) G.sp.flash -= dt;
    if (G.player.recoil > 0) G.player.recoil -= dt;
  }

  function doSpecial(free) {
    if (!free) {
      if (G.sp.charge < 1) { SFX.hit(); return; }
      G.sp.charge -= 1;
    }
    var p = G.player;
    p.recoil = 0.12; p.y = Math.min(H - 40, p.y + 22);
    G.sp.flash = 0.16; G.flashAll = Math.max(G.flashAll, 0.12);
    addShake(4);
    SFX.special();
    var g = G.specialGod;
    if (g === 'zeus') stormBolt();
    else if (g === 'artemis') huntArrow();
    else if (g === 'aphrodite') charmMissile();
    else if (g === 'poseidon') tidalWave();
    else if (g === 'ares') phobosDeimos();
    else if (g === 'heimdall') gjallarhorn(1);
    else if (g === 'ra') solarFlare();
    else if (g === 'anubis') judgmentOfDuat();
    else if (g === 'loki') shadowTwin();
    else if (g === 'odin') gungnirCast();
    else if (g === 'wukong') staffSlam();
    else if (g === 'quetz') skySerpent(false);
    else if (g === 'thor') giantsBane();
    else if (g === 'guanyu') crescentSweep();
    else if (g === 'jade') heavensVerdict();
    else lanceVolley();
    // wukongSpecial fork: living clones echo a small lance volley
    if (G.mods.wukongSpecial) {
      for (var i = 0; i < G.clones.length; i++) {
        var c = G.clones[i];
        lanceShot(c.x, 1, LANCE_DMG * 0.25 * G.stats.spDmg, [1, 0.5, 0.3]);
      }
    }
  }

  // The one birthplace of every player-side shot: resets the per-mode fields
  // (homing / weave / crescent / clone) so a recycled pool slot can never leak
  // a previous shot's behavior into a new one.
  function allocShot() {
    var s = Engine.shots.alloc(); if (!s) return null;
    s.homing = false; s.turn = 0;
    s.weave = 0; s.phase = 0;
    s.cloneShot = false; s.crescent = false;
    s.markHit = false; s.forceCrit = 0;
    return s;
  }

  function lanceShot(x, kind, dmg, col) {
    var s = allocShot(); if (!s) return;
    s.x = x; s.y = G.player.y - 30; s.vx = 0; s.vy = -1700;
    s.radius = 28; s.scale = 62; s.damage = dmg; s.age = 0; s.life = 0.85;
    s.r = col[0]; s.g = col[1]; s.b = col[2];
    s.pierce = 999; s.kind = kind;
    s.faction = 1; s.big = true;
    flash(x, G.player.y - 40, col, 120, 0.18);
  }
  function lanceVolley() {
    var d = LANCE_DMG * G.stats.spDmg;
    lanceShot(G.player.x, 1, d, [0.7, 1.0, 1.0]);
    lanceShot(G.player.x - 46, 1, d * 0.7, [0.6, 0.95, 1.0]);
    lanceShot(G.player.x + 46, 1, d * 0.7, [0.6, 0.95, 1.0]);
  }
  function stormBolt() {
    var d = LANCE_DMG * G.stats.spDmg * G.specialR;
    lanceShot(G.player.x, 3, d, [0.6, 0.85, 1.0]);
    lanceShot(G.player.x - 40, 3, d * 0.7, [0.7, 0.9, 1.0]);
    lanceShot(G.player.x + 40, 3, d * 0.7, [0.7, 0.9, 1.0]);
  }
  function huntArrow() {
    var s = allocShot(); if (!s) return;
    s.x = G.player.x; s.y = G.player.y - 30; s.vx = 0; s.vy = -2000;
    s.radius = 34; s.scale = 80; s.damage = LANCE_DMG * 2.2 * G.stats.spDmg * G.specialR;
    s.age = 0; s.life = 0.8; s.r = 0.7; s.g = 1.0; s.b = 0.3;
    s.pierce = 3; s.kind = 4; s.faction = 1; s.big = true; s.markHit = true; s.forceCrit = 1;
    flash(s.x, s.y, [0.7, 1, 0.3], 150, 0.2);
  }
  function charmMissile() {
    var s = allocShot(); if (!s) return;
    s.x = G.player.x; s.y = G.player.y - 30; s.vx = 0; s.vy = -1200;
    s.radius = 24; s.scale = 56; s.damage = LANCE_DMG * 1.2 * G.stats.spDmg;
    s.age = 0; s.life = 1.4; s.r = 1.0; s.g = 0.45; s.b = 0.85;
    s.pierce = 0; s.kind = 5; s.faction = 1; s.big = true;
    flash(s.x, s.y, [1, 0.5, 0.85], 120, 0.2);
  }
  function tidalWave() {
    var hz = allocHazard(); if (!hz) return;
    hz.type = 'wave'; hz.x = W / 2; hz.y = H + 60; hz.vy = -720; hz.r = 190; hz.timer = 4;
    hz.dmg = LANCE_DMG * 0.9 * G.stats.spDmg * G.specialR;
    hz.tick = 0;
  }
  // HEIMDALL — Gjallarhorn (special): wound + Mark all foes, shove their bullets.
  // The shove is distinct from apotheosis: bullets are displaced, not canceled.
  function gjallarhorn(mult) {
    var hard = G.mods.heimHorn;
    var dmg = 16 * G.stats.spDmg * G.specialR * (hard ? 1.35 : 1) * mult;
    var shove = (hard ? 350 : 220) * mult;
    ringShock(G.player.x, G.player.y, [1, 0.89, 0.76], 100, 5200, 0.7);
    flash(G.player.x, G.player.y, [1, 0.9, 0.78], 300, 0.3);
    G.flashAll = Math.max(G.flashAll, 0.2); addShake(6);
    Engine.enemies.forEach(function (e) {
      if (e.dying || e.charmed) return;
      damageEnemy(e, dmg, false);
      if (!e.dying) markEnemy(e);
    });
    shoveBullets(G.player.x, G.player.y, shove);
    if (G.mods.heimEcho && mult === 1) G.hornEchoT = 1.0;   // echoes once at 50%
  }

  // ---------------------------------------------------------------------
  // hazards (special-weapon area effects; small preallocated pool)
  // ---------------------------------------------------------------------
  var hazards = [];
  (function () { for (var i = 0; i < 8; i++) hazards.push({ active: false, type: '', x: 0, y: 0, vy: 0, r: 0, timer: 0, dur: 1, tick: 0, dmg: 0, rot: 0, halfW: 0, esc: 0, trail: null, hue: 0 }); })();
  function allocHazard() { for (var i = 0; i < hazards.length; i++) if (!hazards[i].active) { var z = hazards[i]; z.active = true; z.rot = 0; z.halfW = 0; z.esc = 0; z.trail = null; z.hue = 0; return z; } return null; }

  function updateHazards(dt) {
    var px = G.player.x, py = G.player.y;
    for (var i = 0; i < hazards.length; i++) {
      var hz = hazards[i]; if (!hz.active) continue;
      hz.timer -= dt; hz.rot += dt * 6;
      if (hz.type === 'wave') {
        hz.y += hz.vy * dt;
        // shove + damage enemies in band; carry bullets up
        Engine.enemies.forEach(function (e) {
          if (e.dying || e.charmed) return;
          if (Math.abs(e.y - hz.y) < hz.r) { e.y = Math.max(60, e.y + hz.vy * dt * 0.8); damageEnemy(e, hz.dmg * dt * 3, false); }
        });
        Engine.bullets.forEach(function (b) {
          if (b.y > hz.y - hz.r && b.y < hz.y + hz.r * 0.4) { b.y += hz.vy * dt * 0.9; b.carried = true; b.slowT = 0.2; b.timeScale = 0.5; }
        });
        if (hz.y < -hz.r) {
          // carried bullets convert to gold; drag gold to player (mod)
          Engine.bullets.forEach(function (b) {
            if (b.carried) { if (Engine.gold.freeTop > 0) { spawnGold(b.x, b.y, 1, 0.4, 0, 8); if (G.mods.poseidonDrag) homeAllGold(); } Engine.bullets.release(b); }
          });
          hz.active = false;
        }
      }
      else if (hz.type === 'staff') {
        hz.tick -= dt;
        if (hz.tick <= 0) {
          hz.tick = 0.1;
          Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (Math.abs(e.x - hz.x) < hz.halfW + e.radius * 0.5) damageEnemy(e, hz.dmg, false); });
          spark(hz.x, 300 + Math.random() * (H - 500), [1, 0.55, 0.2], 3, 300, 32);
        }
        if (hz.timer <= 0) {
          if (G.mods.wukongStaff) Engine.enemies.forEach(function (e) { if (!e.dying && !e.charmed && !e.boss && Math.abs(e.x - hz.x) < hz.halfW + e.radius * 0.5) e.stunT = 1.5; });
          hz.active = false;
        }
      }
      else if (hz.type === 'serpent') {
        var u = 1 - hz.timer / hz.dur;
        if (G.mods.quetzCircle && u > 0.82) {            // Skywalk end: circle the player
          var ca = ((u - 0.82) / 0.18) * Math.PI * 2;
          hz.x = G.player.x + Math.cos(ca) * 240; hz.y = G.player.y + Math.sin(ca) * 240;
        } else {
          // hz.esc carries the mirror sign (-1 for the apotheosis twin serpent)
          hz.x = W / 2 + Math.sin(u * Math.PI * 3) * (W * 0.40) * (hz.esc < 0 ? -1 : 1);
          hz.y = 150 + u * (H - 420);
        }
        hz.hue += dt * 0.4;
        if (!hz.trail) hz.trail = [];
        hz.trail.push(hz.x); hz.trail.push(hz.y);
        var maxPts = Math.round(hz.r * 0.9);
        while (hz.trail.length > maxPts * 2) { hz.trail.shift(); hz.trail.shift(); }
        var segR = 72 * (G.mods.quetzBig ? 1.35 : 1);
        var feathered = G.duos.featheredHeart;
        for (var ti = 0; ti < hz.trail.length; ti += 6) {
          var sx = hz.trail[ti], sy = hz.trail[ti + 1];
          Engine.enemies.forEach(function (e) {
            if (e.dying || e.charmed) return;
            var dx = e.x - sx, dy = e.y - sy;
            if (dx * dx + dy * dy < segR * segR) {
              if (feathered && !e.boss) charmEnemy(e);   // FEATHERED HEART: charm instead of damage
              else { damageEnemy(e, SERPENT_DMG * dt * G.specialR, false); if (G.duos.fifthSunDawn) applyBurn(e, 16 * G.specialR, 1.5); }  // FIFTH SUN DAWN: solar trail burns
            }
          });
        }
        var eatR = segR * (G.duos.worldSerpent ? 1.8 : 1);   // WORLD SERPENT: wider bullet-sweeping wake
        Engine.bullets.forEach(function (b) {
          var bx = b.x - hz.x, by = b.y - hz.y;
          if (bx * bx + by * by < eatR * eatR) {
            addGauge(1.2);
            if (G.mods.quetzGold && Engine.gold.freeTop > 0) spawnGold(b.x, b.y, 1, 0.3);
            if (G.duos.fifthSunDawn) { var ne = nearestEnemy(b.x, b.y); if (ne) applyBurn(ne, 16 * G.specialR, 1.5); }  // eaten bullets ignite
            spark(b.x, b.y, [0.4, 1, 0.7], 2, 160, 16);
            Engine.bullets.release(b);
          }
        });
        if (hz.timer <= 0) hz.active = false;
      }
      else if (hz.type === 'zap') {
        hz.tick -= dt;
        if (hz.tick <= 0) {
          hz.tick = 0.2;
          Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; var dx = hz.x - e.x, dy = hz.y - e.y; if (dx * dx + dy * dy < hz.r * hz.r) { damageEnemy(e, hz.dmg, false); arcFx(hz.x, hz.y, e.x, e.y, [0.7, 0.9, 1.0]); } });
        }
        if (hz.timer <= 0) hz.active = false;
      }
      else if (hz.type === 'sweep') {       // GUAN YU Crescent Moon Sweep — one heavy hit per foe, hurls non-bosses
        hz.y += hz.vy * dt;
        if (!hz.trail) hz.trail = [];
        Engine.enemies.forEach(function (e) {
          if (e.dying || e.charmed) return;
          var fe = (e.x - W / 2) / (W / 2), by = hz.y + fe * fe * 110;   // follow the drawn upward-curving blade
          if (Math.abs(e.y - by) < hz.r + e.radius * 0.5) {
            if (hz.trail.indexOf(e) < 0) {
              hz.trail.push(e);
              killGoldMul = G.mods.guanSpoils ? 1.5 : 1;
              damageEnemy(e, hz.dmg, false);
              killGoldMul = 1;
              if (!e.boss) { pushDisp(e, W / 2, hz.y + 160, 500); e.impactDmg = hz.dmg * 0.5; }
              spark(e.x, e.y, [0.3, 0.95, 0.55], 8, 400, 30);
            }
          }
        });
        if (hz.y < -hz.r - 60 || hz.timer <= 0) hz.active = false;
      }
      else if (hz.type === 'sweepwake') {   // guanWake: the sweep leaves a burning arc
        hz.tick -= dt;
        if (hz.tick <= 0) {
          hz.tick = 0.15;
          Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; var fe = (e.x - W / 2) / (W / 2), by = hz.y + fe * fe * 110; if (Math.abs(e.y - by) < 100 + e.radius * 0.5) { damageEnemy(e, hz.dmg, false); applyBurn(e, 14 * G.specialR, 1.0); } });
          spark(100 + Math.random() * (W - 200), hz.y + (Math.random() - 0.5) * 80, [1, 0.55, 0.25], 2, 180, 20);
        }
        if (hz.timer <= 0) hz.active = false;
      }
      if (hz.timer <= 0 && hz.type === 'wave') hz.active = false;
    }
  }

  function drawHazards() {
    for (var i = 0; i < hazards.length; i++) {
      var hz = hazards[i]; if (!hz.active) continue;
      if (hz.type === 'wave') {
        for (var x = 60; x < W; x += 80) {
          GL.draw(GL.SPR.GLOW, x, hz.y, 130, hz.r * 1.4, 0, 0.2, 0.75, 0.85, 0.5);
          GL.draw(GL.SPR.CORE, x, hz.y, 60, 24, 0, 0.5, 0.95, 1.0, 0.7);
        }
      }
      else if (hz.type === 'staff') {
        var pa = Math.min(1, hz.timer * 3);
        GL.draw(GL.SPR.GLOW, hz.x, H / 2, hz.halfW * 3.0, H, 0, 1, 0.55, 0.2, 0.4 * pa);
        GL.draw(GL.SPR.CORE, hz.x, H / 2, hz.halfW * 1.5, H, 0, 1, 0.8, 0.4, 0.8 * pa);
        GL.draw(GL.SPR.CORE, hz.x, H / 2, hz.halfW * 0.5, H, 0, 1, 1, 0.9, 0.9 * pa);
      }
      else if (hz.type === 'serpent' && hz.trail) {
        var segR2 = 72 * (G.mods.quetzBig ? 1.35 : 1);
        for (var ti = 0; ti < hz.trail.length; ti += 2) {
          var f = ti / Math.max(2, hz.trail.length);
          var col = Patterns.hue(hz.hue + f * 0.6);
          var sz = segR2 * (0.6 + 0.4 * f);
          GL.draw(GL.SPR.GLOW, hz.trail[ti], hz.trail[ti + 1], sz * 1.6, sz * 1.6, 0, col[0], col[1], col[2], 0.5);
          GL.draw(GL.SPR.CORE, hz.trail[ti], hz.trail[ti + 1], sz * 0.7, sz * 0.7, 0, col[0], col[1], col[2], 0.8);
        }
        // head
        GL.draw(GL.SPR.CORE, hz.x, hz.y, segR2, segR2, 0, 1, 1, 0.9, 0.9);
      }
      else if (hz.type === 'zap') {
        var za = Math.min(1, hz.timer);
        GL.draw(GL.SPR.GLOW, hz.x, hz.y, hz.r * 2.0, hz.r * 2.0, hz.rot, 0.6, 0.85, 1.0, 0.3 * za);
        GL.draw(GL.SPR.CORE, hz.x, hz.y, hz.r * 0.4, hz.r * 0.4, 0, 0.8, 0.95, 1.0, 0.6 * za);
      }
      else if (hz.type === 'sweep') {
        // colossal jade-green crescent: a full-width blade whose edges trail
        // behind the center (drawn as an arc of cells), giant kin of the attack crescent
        for (var sx2 = 40; sx2 < W; sx2 += 54) {
          var fx2 = (sx2 - W / 2) / (W / 2);
          var yo = hz.y + fx2 * fx2 * 110;             // edges lag = crescent pointing up
          GL.draw(GL.SPR.GLOW, sx2, yo, 120, hz.r * 2.2, 0, 0.3, 0.95, 0.55, 0.4);
          GL.draw(GL.SPR.STREAK, sx2, yo, 60, hz.r * 1.5, Math.PI / 2, 0.35, 1.0, 0.6, 0.9);
          GL.draw(GL.SPR.CORE, sx2, yo, 34, 26, 0, 1, 1, 1, 0.7);
        }
      }
      else if (hz.type === 'sweepwake') {
        var wa = 0.4 + 0.6 * Math.min(1, hz.timer / hz.dur);
        for (var wx2 = 60; wx2 < W; wx2 += 80) {
          var wf = (wx2 - W / 2) / (W / 2);
          var wyo = hz.y + wf * wf * 110;
          GL.draw(GL.SPR.GLOW, wx2, wyo, 130, 140, 0, 1, 0.5, 0.2, 0.22 * wa);
          GL.draw(GL.SPR.CORE, wx2, wyo, 60, 26, 0, 1, 0.65, 0.3, 0.4 * wa);
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // pantheon 2 — entities, specials, status helpers
  // ---------------------------------------------------------------------
  // RA — continuous solar beam (attack transform)
  function raBeam(dt) {
    var p = G.player, halfW = 36;
    var target = null, bestY = -1e9;
    Engine.enemies.forEach(function (e) {
      if (e.dying || e.charmed) return;
      if (e.y < p.y - 30 && Math.abs(e.x - p.x) < halfW + e.radius * 0.7) { if (e.y > bestY) { bestY = e.y; target = e; } }
    });
    var cap = 2.5 * (G.mods.raRamp ? 1.15 : 1);
    var rate = G.mods.raRamp ? 0.9 : 0.5;   // ~2s to full (faster with mod)
    if (target && target === G.ra.target) G.ra.ramp = Math.min(1, G.ra.ramp + rate * dt);
    else { G.ra.ramp = 0; G.ra.target = target; }
    if (G.raSurgeT > 0) G.ra.ramp = 1;   // apotheosis rider: beam surges at full ramp
    G.ra.active = true; G.ra.tx = p.x; G.ra.ty0 = p.y - 24; G.ra.ty1 = target ? target.y : 30;
    if (target) {
      var mult = 1 + (cap - 1) * G.ra.ramp;
      var tick = BEAM_DPS * mult * G.stats.atkDmg * dt;
      // raSplit: when a 2nd foe is in the column, split into two half beams (swarm answer)
      if (G.mods.raSplit) {
        var t2 = null, b2 = 1e18;
        Engine.enemies.forEach(function (e) { if (e.dying || e.charmed || e === target) return; if (e.y < p.y - 30 && Math.abs(e.x - p.x) < halfW + e.radius * 0.7) { var dd = Math.abs(e.x - p.x); if (dd < b2) { b2 = dd; t2 = e; } } });
        if (t2) { damageEnemy(target, tick * 0.6, false); damageEnemy(t2, tick * 0.6, false); if (G.mods.raBurn) applyBurn(t2, 18 * G.attackR, 1.5); }
        else damageEnemy(target, tick, false);
      } else damageEnemy(target, tick, false);
      if (G.mods.raBurn) applyBurn(target, 18 * G.attackR, 1.5);
      if (G.duos.eclipse && Math.random() < dt * 6) chainLightning(target, tick * 5, false); // ECLIPSE: beam arcs chains
      if (Math.random() < 0.12) SFX.shot();
      if (Math.random() < 0.4) spark(target.x, target.y, [1, 0.9, 0.5], 1, 120, 16);
    }
  }
  function drawRaBeam() {
    if (!G.ra.active) return;
    var x = G.ra.tx, cy = (G.ra.ty0 + G.ra.ty1) / 2, hh = Math.abs(G.ra.ty0 - G.ra.ty1) + 20;
    var pulse = 0.8 + 0.2 * Math.sin(G.time * 40), ramp = G.ra.ramp;
    GL.draw(GL.SPR.GLOW, x, cy, 90 + ramp * 46, hh, 0, 1, 0.85, 0.35, 0.5 * pulse);
    GL.draw(GL.SPR.CORE, x, cy, 46 + ramp * 26, hh, 0, 1, 0.92, 0.5, 0.8 * pulse);
    GL.draw(GL.SPR.CORE, x, cy, 16 + ramp * 12, hh, 0, 1, 1, 0.95, pulse);
    GL.draw(GL.SPR.GLOW, x, G.ra.ty1, 130, 130, 0, 1, 0.9, 0.5, 0.7);
  }

  function nearestEnemy(x, y) {
    var best = null, bd = 1e18;
    Engine.enemies.forEach(function (e) {
      if (e.dying || e.charmed) return;
      var dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }
  // Steering target for a homing shot: TALOS' body is immune during THE NAIL —
  // only the ankle nail hitbox drains. Homing/aimed shots must seek the nail, or
  // they clank off the immune body forever (~92px above the weak point). Non-nail
  // enemies just report their center.
  function aimTargetX(e) { return (e && e.nailActive) ? e.nailX : (e ? e.x : 0); }
  function aimTargetY(e) { return (e && e.nailActive) ? e.nailY : (e ? e.y : 0); }

  // ODIN — ravens
  function updateRavens(dt) {
    if (G.attackGod !== 'odin') { if (G.ravens.length) G.ravens.length = 0; return; }
    while (G.ravens.length < 2) G.ravens.push({ ang: G.ravens.length * Math.PI, state: 0, x: G.player.x, y: G.player.y, tx: 0, ty: 0, cd: 1.2 + G.ravens.length * 0.6 });
    var p = G.player, interval = G.mods.odinRaven ? 1.0 : 1.7;
    var dmg = RAVEN_DMG * (G.mods.odinRaven ? 1.7 : 1) * G.stats.atkDmg;
    for (var i = 0; i < G.ravens.length; i++) {
      var r = G.ravens[i]; r.ang += dt * 2.4;
      if (r.state === 0) {
        var ox = p.x + Math.cos(r.ang) * 82, oy = p.y + Math.sin(r.ang) * 82 - 26;
        r.x += (ox - r.x) * Math.min(1, dt * 10); r.y += (oy - r.y) * Math.min(1, dt * 10);
        r.cd -= dt;
        if (r.cd <= 0) { var t = (G.duos.wildHunt ? nearestTerrified(r.x, r.y) : null) || nearestEnemy(r.x, r.y); if (t) { r.state = 1; r.tx = t.x; r.ty = t.y; } else r.cd = 0.3; }
      } else if (r.state === 1) {
        var dx = r.tx - r.x, dy = r.ty - r.y, d = Math.hypot(dx, dy) || 1;
        r.x += dx / d * 720 * dt; r.y += dy / d * 720 * dt;
        var hitFlag = false;
        Engine.enemies.forEach(function (e) { if (hitFlag || e.dying || e.charmed) return; if (Engine.hit(r.x, r.y, 20, e.x, e.y, e.radius)) { damageEnemy(e, ((G.duos.wildHunt && e.terrorT > 0) ? dmg * 3 : dmg) * (G.duos.theAllseeing && e.marked ? 1.4 : 1), false); if (G.mods.odinRavenMark) markEnemy(e); hitFlag = true; } });
        if (hitFlag || d < 24) r.state = 2;
      } else {
        var dx2 = p.x - r.x, dy2 = p.y - r.y, d2 = Math.hypot(dx2, dy2) || 1;
        r.x += dx2 / d2 * 640 * dt; r.y += dy2 / d2 * 640 * dt;
        if (d2 < 70) { r.state = 0; r.cd = interval; }
      }
    }
  }
  function drawRavens() {
    for (var i = 0; i < G.ravens.length; i++) {
      var r = G.ravens[i];
      GL.draw(GL.SPR.GLOW, r.x, r.y, 46, 46, 0, 0.6, 0.62, 0.72, 0.5);
      GL.draw(GL.SPR.SHIP_POP, r.x, r.y, 34, 34, r.state === 1 ? Math.atan2(r.ty - r.y, r.tx - r.x) + Math.PI / 2 : 0, 0.78, 0.8, 0.88, 0.95);
    }
  }

  // ODIN — Gungnir (special)
  function updateGungnir(dt) {
    var g = G.gungnir; if (!g.active) return;
    g.timer -= dt;
    var target = null, bd = 1e18;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (g.visited.indexOf(e) >= 0) return; var dx = e.x - g.x, dy = e.y - g.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; target = e; } });
    if (!target || g.timer <= 0) { g.active = false; return; }
    var dx = target.x - g.x, dy = target.y - g.y, d = Math.sqrt(bd) || 1;
    g.ang = Math.atan2(dy, dx);
    g.x += dx / d * 1500 * dt; g.y += dy / d * 1500 * dt;
    spark(g.x, g.y, [1, 0.9, 0.5], 1, 80, 14);
    if (d < target.radius + 22) {
      damageEnemy(target, GUNGNIR_DMG * G.stats.spDmg * G.specialR * (G.mods.odinGungnir ? 1.5 : 1) * (G.duos.theAllseeing && target.marked ? 1.4 : 1), false); // THE ALLSEEING
      markEnemy(target);
      if (G.duos.allfathersWrath) chainLightning(target, GUNGNIR_DMG * 0.4 * G.specialR, false); // ALLFATHER'S WRATH
      g.visited.push(target);
    }
  }
  function drawGungnir() {
    if (!G.gungnir.active) return;
    var g = G.gungnir, ang = g.ang + Math.PI / 2;
    GL.draw(GL.SPR.GLOW, g.x, g.y, 60, 170, ang, 1, 0.9, 0.5, 0.6);
    GL.draw(GL.SPR.NEEDLE, g.x, g.y, 42, 190, ang, 1, 0.95, 0.6, 1);
    GL.draw(GL.SPR.CORE, g.x, g.y, 26, 26, 0, 1, 1, 0.9, 0.9);
  }
  function markEnemy(e) { e.marked = true; e.markT = G.mods.odinMark ? 10 : 6; }

  // LOKI — decoy. By design the Shadow-Twin NEVER attacks (the one sanctioned
  // exception to the damage-floor rule): its boss value is soaking pattern
  // bullets that touch it. DOUBLE TROUBLE (Wukong duo) is the sole exception
  // that arms it, as a clone.
  function updateDecoy(dt) {
    if (!G.decoy.active) return;
    G.decoy.timer -= dt;
    if (G.duos.doubleTrouble) {                          // DOUBLE TROUBLE: decoy is a firing clone
      G.decoy.fireT = (G.decoy.fireT || 0) - dt;
      if (G.decoy.fireT <= 0) { G.decoy.fireT = FIRE_CD / (G.stats.atkRate * frenzyRate()); fireStreams(G.decoy.x, G.decoy.y, false, 0.5); }
    }
    if (G.duos.falseDawn) {                              // FALSE DAWN: marking horn pulse every 2s
      G.decoy.hornT = (G.decoy.hornT || 0) - dt;
      if (G.decoy.hornT <= 0) {
        G.decoy.hornT = 2.0;
        ringShock(G.decoy.x, G.decoy.y, [1, 0.89, 0.76], 50, 2600, 0.45);
        Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; var dx = e.x - G.decoy.x, dy = e.y - G.decoy.y; if (dx * dx + dy * dy < 380 * 380) markEnemy(e); });
      }
    }
    if (G.decoy.timer <= 0) expireDecoy();
  }
  function expireDecoy() {
    if (!G.decoy.active) return;
    G.decoy.active = false;
    if (G.duos.ragnarok) ragnarokStrike(G.decoy.x, G.decoy.y);   // RAGNAROK: the trick ends in the hammer
    spark(G.decoy.x, G.decoy.y, [0.4, 1, 0.5], 14, 300, 26);
    if (G.mods.lokiBoom) {
      Engine.bullets.forEach(function (b) { var dx = b.x - G.decoy.x, dy = b.y - G.decoy.y; if (dx * dx + dy * dy < 260 * 260) { if (Engine.gold.freeTop > 0) spawnGold(b.x, b.y, 1, 0.5); Engine.bullets.release(b); } });
      flash(G.decoy.x, G.decoy.y, [0.4, 1, 0.5], 200, 0.3);
    }
  }
  function drawDecoy() {
    if (!G.decoy.active) return;
    var d = G.decoy, pulse = 0.6 + 0.4 * Math.sin(G.time * 10);
    GL.draw(GL.SPR.GLOW, d.x, d.y, 72, 72, 0, 0.4, 1, 0.5, 0.5 * pulse);
    GL.draw(GL.SPR.SHIP_PLAYER, d.x, d.y, 72, 72, 0, 0.4, 1, 0.5, 0.7);
    GL.draw(GL.SPR.RING, d.x, d.y, 92, 92, G.time * 3, 0.4, 1, 0.5, 0.6);
  }

  // WUKONG — clones
  function spawnClone() {
    var max = G.mods.wukongClones ? 3 : 2;
    if (G.clones.length >= max) return;
    var used = []; for (var j = 0; j < G.clones.length; j++) used.push(G.clones[j].offset);
    var offs = [130, -130, 210, -210], off = 130;
    for (var k = 0; k < offs.length; k++) { if (used.indexOf(offs[k]) < 0) { off = offs[k]; break; } }
    G.clones.push({ offset: off, x: G.player.x + off, y: G.player.y, timer: G.mods.wukongClones ? 7 : 4, fireT: 0 });
    flash(G.player.x + off, G.player.y, [1, 0.4, 0.2], 80, 0.2);
  }
  function updateClones(dt) {
    var p = G.player;
    for (var i = G.clones.length - 1; i >= 0; i--) {
      var c = G.clones[i]; c.timer -= dt;
      if (c.timer <= 0) { spark(c.x, c.y, [1, 0.4, 0.2], 10, 240, 24); G.clones.splice(i, 1); continue; }
      c.x = p.x + c.offset; c.y = p.y;
      if (c.x < 40) c.x = 40; if (c.x > W - 40) c.x = W - 40;
      if (Engine.fireHeld()) { c.fireT -= dt; if (c.fireT <= 0) { c.fireT = FIRE_CD / (G.stats.atkRate * frenzyRate()); fireStreams(c.x, c.y, Engine.focusHeld(), 0.45, true); } }
    }
  }
  function drawClones() {
    for (var i = 0; i < G.clones.length; i++) {
      var c = G.clones[i], a = Math.min(1, c.timer) * 0.62;
      GL.draw(GL.SPR.GLOW, c.x, c.y + 30, 46, 70, 0, 1, 0.4, 0.2, 0.4 * a);
      GL.draw(GL.SPR.SHIP_PLAYER, c.x, c.y, 68, 68, 0, 1, 0.4, 0.25, a);
      GL.draw(GL.SPR.CORE, c.x, c.y, 10, 10, 0, 1, 0.7, 0.5, a);
    }
  }

  // status helpers
  function applyBurn(e, dps, dur) { if (e.burnT < dur) e.burnT = dur; if (e.burnDps < dps) e.burnDps = dps; }
  function spreadBurn(e) { Engine.enemies.forEach(function (o) { if (o.dying || o.charmed || o === e) return; var dx = o.x - e.x, dy = o.y - e.y; if (dx * dx + dy * dy < 200 * 200) applyBurn(o, e.burnDps * 0.8, 2.5); }); }
  function anubisThreshold() { return 0.25 + (G.mods.anubisThresh ? 0.08 : 0); }   // execute line: 25% (33% with mod)
  function executeEnemy(e) {
    if (e.dying) return;
    // ETERNAL DEVOTION: the executed rise as charmed ghost allies instead of dying
    if (G.duos.eternalDevotion && !e.boss && !e.charmed) {
      creditForm(e);   // execute-conversion still counts as defeating the member (fix #1)
      e.charmed = true; e.charmMeter = 0; e.charmT = 4; e.ghost = true; e.fireHold = 0;
      flash(e.x, e.y, [0.85, 0.3, 0.7], 80, 0.3); spark(e.x, e.y, [0.85, 0.3, 0.7], 12, 280, 26);
      return;
    }
    flash(e.x, e.y, [1, 0.9, 0.4], 90, 0.3); ringShock(e.x, e.y, [1, 0.85, 0.3], 30, 2000, 0.4); spark(e.x, e.y, [1, 0.9, 0.4], 10, 300, 26);
    if (G.mods.anubisShard) addGauge(4);                  // executed foes drop a vaunt shard
    killGoldMul = 1.5; killEnemy(e, true); killGoldMul = 1;
    if (G.mods.anubisRefund) addCharge(0.12);
  }

  // pantheon-2 specials
  function solarFlare() {
    G.flashAll = Math.max(G.flashAll, 0.4); addShake(5);
    ringShock(G.player.x, G.player.y, [1, 0.95, 0.6], 100, 5000, 0.6);
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; applyBurn(e, 22 * G.stats.spDmg * G.specialR, 3.0); });
  }
  // ANUBIS — Judgment of Duat: instant strike on every foe for a share of its
  // MISSING hp (bosses: flat 5%·specialR of maxhp, capped at 15% maxhp), then
  // executes non-bosses under the execute line.
  function judgmentOfDuat() {
    var thr = anubisThreshold();
    G.flashAll = Math.max(G.flashAll, 0.25); addShake(5);
    Engine.enemies.forEach(function (e) {
      if (e.dying || e.charmed) return;
      var d = e.boss ? Math.min(0.05 * G.specialR * e.maxhp, 0.15 * e.maxhp)
                     : 0.20 * G.specialR * (e.maxhp - e.hp);
      flash(e.x, e.y, [1, 0.85, 0.35], 120, 0.3);
      ringShock(e.x, e.y, [1, 0.85, 0.3], 40, 1800, 0.4);
      if (d > 0) damageEnemy(e, d, false);
      if (!e.boss && !e.dying && e.hp < thr * e.maxhp) executeEnemy(e);
    });
  }
  function shadowTwin() {
    G.decoy.active = true; G.decoy.x = G.player.x; G.decoy.y = G.player.y; G.decoy.absorb = 0;
    G.decoy.timer = 6 * (G.mods.lokiLong ? 1.5 : 1);
    flash(G.player.x, G.player.y, [0.4, 1, 0.5], 120, 0.25);
  }
  function gungnirCast() {
    var g = G.gungnir; g.active = true; g.timer = G.mods.odinGungnir ? 6 : 4; g.x = G.player.x; g.y = G.player.y - 30; g.ang = -Math.PI / 2; g.visited = [];
  }
  function staffSlam() {
    var hz = allocHazard(); if (!hz) return;
    hz.type = 'staff'; hz.x = G.player.x; hz.halfW = 90 * (G.mods.wukongStaff ? 1.55 : 1); hz.timer = 0.8; hz.dur = 0.8; hz.tick = 0;
    hz.dmg = LANCE_DMG * 0.9 * G.stats.spDmg;
    addShake(8);
    if (G.duos.typhoonPillar) tidalWave();               // TYPHOON PILLAR: staff sends a shockwave wall
  }
  function skySerpent(mirror) {
    var hz = allocHazard(); if (!hz) return;
    hz.type = 'serpent'; hz.timer = 2.5 * (G.mods.quetzBig ? 1.3 : 1); hz.dur = hz.timer; hz.r = 16; hz.trail = []; hz.hue = 0; hz.x = W / 2; hz.y = 150;
    hz.esc = mirror ? -1 : 1;                    // mirrored path for the apotheosis twin
  }
  // GUAN YU — Crescent Moon Sweep: one colossal crescent blade sweeps the full
  // width upward from the player's line, hurling non-bosses aside.
  function crescentSweep() {
    var hz = allocHazard(); if (!hz) return;
    hz.type = 'sweep'; hz.x = W / 2; hz.y = G.player.y - 60; hz.r = 90;
    hz.vy = -(G.player.y + 140) / 0.7;           // reaches the top in ~0.7s
    hz.timer = 1.0; hz.dur = 1.0; hz.trail = [];
    hz.dmg = LANCE_DMG * 2.6 * G.stats.spDmg * G.specialR;   // ≈ old Red Hare total
    if (G.mods.guanWake) {                       // burning arc lingers at the launch line
      var wk = allocHazard();
      if (wk) { wk.type = 'sweepwake'; wk.x = W / 2; wk.y = G.player.y - 180; wk.timer = 1.5; wk.dur = 1.5; wk.tick = 0; wk.dmg = LANCE_DMG * 0.5 * G.stats.spDmg * G.specialR; }
    }
    ringShock(G.player.x, G.player.y - 80, [0.3, 0.95, 0.55], 70, 3000, 0.5);
    addShake(6);
  }
  // JADE EMPEROR — Heaven's Verdict: one homing edict per foe (cap 10), Stun
  // 1.0s; bosses are stun-immune and take +50% edict damage; the strongest foe
  // takes a double-size edict.
  function heavensVerdict() {
    if (G.verdict.t > 0) verdictVolley(G.verdict.mult);        // flush a still-pending 2nd wave before it's overwritten
    verdictVolley(1);
    if (G.mods.jadeWrath) G.verdict = { t: 0.7, mult: 0.5 };   // second wave at 50%
    G.verdictPeachT = 3;                                        // PEACH BANQUET window
    G.flashAll = Math.max(G.flashAll, 0.16); addShake(4);
  }
  function verdictVolley(mult) {
    var targets = [];
    Engine.enemies.forEach(function (e) { if (!e.dying && !e.charmed) targets.push(e); });
    targets.sort(function (a, b) { return b.maxhp - a.maxhp; });   // strongest first
    var n = Math.min(10, targets.length);
    for (var i = 0; i < n; i++) fireVerdictEdict(targets[i], i === 0, 15 * G.stats.spDmg * G.specialR * mult);
  }
  function fireVerdictEdict(target, big, dmg) {
    var s = allocShot(); if (!s) return;
    var a = Math.atan2(aimTargetY(target) - (G.player.y - 30), aimTargetX(target) - G.player.x);
    var sp = 1100;
    s.x = G.player.x; s.y = G.player.y - 30;
    s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
    s.radius = big ? 28 : 20; s.scale = big ? 66 : 46;
    s.damage = dmg * (big ? 2 : 1); s.age = 0; s.life = 2.5;
    s.r = 0.79; s.g = 0.6; s.b = 1.0;
    s.pierce = 0; s.homing = true; s.turn = 4.5; s.kind = 8;   // kind 8 = Verdict edict
    s.faction = 0; s.big = false;
    flash(s.x, s.y, [0.8, 0.6, 1], big ? 140 : 90, 0.2);
  }

  // ---------------------------------------------------------------------
  // ARES — Bloodlust (frenzy) + Phobos & Deimos (Terror wraiths)
  // ---------------------------------------------------------------------
  function addFrenzy() {
    G.frenzy.stacks = Math.min(10, G.frenzy.stacks + 1);
    G.frenzy.decayT = G.mods.aresDecay ? 3.0 : 1.5;
  }
  function anyBurning() {
    var found = false;
    Engine.enemies.forEach(function (e) { if (e.burnT > 0) found = true; });
    return found;
  }
  function updateFrenzy(dt) {
    if (G.attackGod !== 'ares' && G.frenzy.stacks === 0) return;
    // BLOOD AND FIRE duo: stacks don't decay while anything burns
    var hold = G.duos.bloodAndFire && anyBurning();
    if (!hold && G.frenzy.stacks > 0) {
      G.frenzy.decayT -= dt;
      if (G.frenzy.decayT <= 0) { G.frenzy.stacks--; G.frenzy.decayT = G.mods.aresDecay ? 3.0 : 1.5; }
    }
    // aresCharge fork: charge special ~2x faster while >= 5 stacks
    if (G.mods.aresCharge && G.frenzy.stacks >= 5) addCharge(SP_RECHARGE * G.stats.spRecharge * dt);
  }
  function frenzyRate() { return 1 + 0.06 * G.frenzy.stacks; }  // +6% fire rate per stack

  // Terror application from a passing wraith (or LOVE AND WAR duo)
  function terrify(e, fromX, fromY) {
    if (e.dying || e.charmed) return;
    if (e.boss) { e.shakenT = Math.max(e.shakenT, 1.0); pushDisp(e, fromX, fromY, 90); return; }
    var dur = 2.5 * (G.mods.aresTerror ? 1.6 : 1);
    if (e.terrorT < dur) e.terrorT = dur;
    e.impactDmg = e.maxhp * 0.2 + 30;
    pushDisp(e, fromX, fromY, 420);
    spark(e.x, e.y, [0.7, 0.05, 0.1], 4, 260, 22);
  }
  function pushDisp(e, fromX, fromY, power) {
    var dx = e.x - fromX, dy = e.y - fromY, d = Math.hypot(dx, dy) || 1;
    var mul = e.boss ? 0.15 : 1;
    e.dispVX += (dx / d) * power * mul;
    e.dispVY += (dy / d) * power * mul;
  }

  // Phobos & Deimos — twin dread-wraiths that DIVE-BOMB: each picks a target,
  // dives for real damage and inflicts Terror on impact (Shaken on bosses),
  // ~4 dives each over their lifetime.
  function phobosDeimos() {
    G.wraiths.length = 0;
    for (var i = 0; i < 2; i++) G.wraiths.push({ x: G.player.x + (i ? 70 : -70), y: G.player.y - 40, ang: i * Math.PI, dir: i === 0 ? 1 : -1, state: 0, target: null, targetSeq: 0, dives: 4, timer: 6, cd: 0.15 * i });
    ringShock(G.player.x, G.player.y, [0.7, 0.05, 0.1], 60, 2600, 0.5);
    addShake(5);
  }
  function updateWraiths(dt) {
    var diveDmg = RAVEN_DMG * 3 * G.stats.spDmg * G.specialR;   // ≈ raven-dive ballpark ×3
    for (var i = G.wraiths.length - 1; i >= 0; i--) {
      var w = G.wraiths[i];
      w.timer -= dt; w.ang += w.dir * dt * 6;
      if (w.timer <= 0 || w.dives <= 0) { spark(w.x, w.y, [0.7, 0.05, 0.1], 10, 280, 24); G.wraiths.splice(i, 1); continue; }
      if (w.state === 0) {                       // hover near the player, pick prey
        var hx = G.player.x + Math.cos(w.ang) * 110, hy = G.player.y - 40 + Math.sin(w.ang) * 60;
        w.x += (hx - w.x) * Math.min(1, dt * 8); w.y += (hy - w.y) * Math.min(1, dt * 8);
        w.cd -= dt;
        if (w.cd <= 0) { var t = nearestEnemy(w.x, w.y); if (t) { w.target = t; w.targetSeq = t.seq; w.state = 1; } else w.cd = 0.3; }
      } else {                                   // dive
        var tg = w.target;
        if (!tg || !tg.active || tg.dying || tg.charmed || tg.seq !== w.targetSeq) { w.state = 0; w.cd = 0.2; continue; }
        var dx = tg.x - w.x, dy = tg.y - w.y, d = Math.hypot(dx, dy) || 1;
        w.x += dx / d * 1150 * dt; w.y += dy / d * 1150 * dt;
        if (d < tg.radius + 26) {
          damageEnemy(tg, diveDmg, false);
          if (!tg.dying) terrify(tg, w.x, w.y);  // terrify → Shaken on bosses
          spark(w.x, w.y, [0.9, 0.1, 0.15], 8, 340, 26); addShake(3);
          w.dives--; w.state = 0; w.cd = 0.35;
        }
      }
    }
  }
  function drawWraiths() {
    for (var i = 0; i < G.wraiths.length; i++) {
      var w = G.wraiths[i], a = Math.min(1, w.timer * 2);
      GL.draw(GL.SPR.GLOW, w.x, w.y, 150, 150, w.ang, 0.55, 0.02, 0.06, 0.55 * a);
      GL.draw(GL.SPR.CORE, w.x, w.y, 40, 40, 0, 0.9, 0.1, 0.15, 0.8 * a);
      GL.draw(GL.SPR.SHIP_POP, w.x, w.y, 44, 44, w.ang + Math.PI / 2, 0.7, 0.05, 0.1, a);
    }
  }

  // ---------------------------------------------------------------------
  // shared mod / duo helpers
  // ---------------------------------------------------------------------
  function spreadMark(e) {
    var best = null, bd = 320 * 320;
    Engine.enemies.forEach(function (o) { if (o.dying || o.charmed || o === e || o.marked) return; var dx = o.x - e.x, dy = o.y - e.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = o; } });
    if (best) { best.marked = true; best.markT = G.mods.odinMark ? 10 : 6; }
  }
  function spawnZapField(x, y) {
    var hz = allocHazard(); if (!hz) return;
    hz.type = 'zap'; hz.x = x; hz.y = y; hz.r = 120; hz.timer = 1.6; hz.dur = 1.6; hz.tick = 0;
    hz.dmg = 6 * G.stats.atkDmg * G.attackR;
  }

  // ---------------------------------------------------------------------
  // THOR — Mjolnir (kinetic hammer). No lightning — that is Zeus.
  // ---------------------------------------------------------------------
  function highestHpEnemy() {
    var best = null, bm = -1;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (e.maxhp > bm) { bm = e.maxhp; best = e; } });
    return best;
  }
  function nearestTerrified(x, y) {
    var best = null, bd = 1e18;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed || e.terrorT <= 0) return; var dx = e.x - x, dy = e.y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = e; } });
    return best;
  }
  function throwHammer(big, dmg, kb) {
    var tgt = big ? highestHpEnemy() : null;
    G.hammers.push({ x: G.player.x, y: G.player.y - 24, state: 'out', vy: -1150, t: 0, dmg: dmg, kb: kb, big: big, spin: 0, hoverT: 0, hit: [], target: tgt, targetSeq: tgt ? tgt.seq : 0 });
  }
  function giantsBane() {
    var dmg = LANCE_DMG * 3.0 * G.stats.spDmg * G.specialR * (G.mods.thorBelt ? 1.4 : 1);
    throwHammer(true, dmg, 420 * (G.mods.thorBelt ? 1.5 : 1));
    addShake(6);
  }
  function hammerImpact(h, ix, iy, crunch, e) {
    addShake(h.big ? (crunch ? 7 : 3) : 2);
    ringShock(ix, iy, [0.62, 0.66, 0.78], crunch ? 120 : (h.big ? 70 : 42), crunch ? 3400 : 1700, 0.4);
    if (crunch || Math.random() < 0.5) SFX.thud();
    if (e && !e.dying) {
      damageEnemy(e, h.dmg * (crunch ? 1.6 : 1), false);
      pushDisp(e, G.player.x, G.player.y, h.kb); e.impactDmg = h.dmg * 0.5;
      if (G.duos.stormfathers) chainLightning(e, h.dmg * 0.35, false);   // STORMFATHERS
      if (G.duos.stormSurge) stormSurgeWave(ix, iy);                     // STORM SURGE
      if (G.duos.heraldOfRagnarok) miniHornShove(ix, iy);                // HERALD OF RAGNARÖK
    }
    if (crunch && h.big) {
      Engine.enemies.forEach(function (o) { if (o.dying || o.charmed || o === e) return; var dx = o.x - ix, dy = o.y - iy; if (dx * dx + dy * dy < 260 * 260) { damageEnemy(o, h.dmg * 0.6, false); pushDisp(o, ix, iy, h.kb * 1.1); o.impactDmg = h.dmg * 0.4; } });
      if (G.duos.stormSurge) stormSurgeWave(ix, iy);
    }
  }
  function hammerSweep(h) {
    var rr = h.big ? 72 : 46;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed || h.hit.indexOf(e) >= 0) return; if (Engine.hit(h.x, h.y, rr, e.x, e.y, e.radius)) { hammerImpact(h, e.x, e.y, false, e); h.hit.push(e); } });
  }
  function updateHammers(dt) {
    for (var i = G.hammers.length - 1; i >= 0; i--) {
      var h = G.hammers[i]; h.spin += dt * 16; h.t += dt;
      if (h.state === 'out') {
        if (h.big && h.target && !h.target.dying && h.target.seq === h.targetSeq) {
          var dx = h.target.x - h.x, dy = h.target.y - h.y, d = Math.hypot(dx, dy) || 1;
          h.x += dx / d * 1400 * dt; h.y += dy / d * 1400 * dt;
          if (d < h.target.radius + 44) { hammerImpact(h, h.target.x, h.target.y, true, h.target); h.state = 'return'; h.hit = []; }
        } else {
          h.y += h.vy * dt;
          var apexY = h.big ? 180 : Math.max(220, G.player.y - 780);
          if (h.y <= apexY) { if (h.big) hammerImpact(h, h.x, h.y, true, null); if (G.mods.thorSkymark && !h.big) { h.state = 'hover'; h.hoverT = 0.8; } else { h.state = 'return'; h.hit = []; } }
        }
        hammerSweep(h);
      } else if (h.state === 'hover') {
        h.hoverT -= dt; hammerSweep(h);
        if (h.hoverT <= 0) { h.state = 'return'; h.hit = []; }
      } else {
        var dx2 = G.player.x - h.x, dy2 = G.player.y - h.y, d2 = Math.hypot(dx2, dy2) || 1;
        h.x += dx2 / d2 * 1300 * dt; h.y += dy2 / d2 * 1300 * dt;
        hammerSweep(h);
        if (d2 < 46) { if (G.mods.thorGauntlet) G.thorBuff = 2.0; G.hammers.splice(i, 1); continue; }
      }
      if (h.t > 6) G.hammers.splice(i, 1);
    }
  }
  function drawHammers() {
    for (var i = 0; i < G.hammers.length; i++) {
      var h = G.hammers[i], sz = h.big ? 130 : 78;
      GL.draw(GL.SPR.GLOW, h.x, h.y, sz * 1.5, sz * 1.5, 0, 0.5, 0.6, 0.75, 0.5);
      GL.draw(GL.SPR.SHIP_MID, h.x, h.y, sz, sz, h.spin, 0.6, 0.66, 0.8, 1);
      GL.draw(GL.SPR.CORE, h.x, h.y, sz * 0.4, sz * 0.4, 0, 0.95, 0.35, 0.3, 0.7);
    }
  }
  // RAGNAROK duo — a Giant's Bane crunch at a point (70% power)
  function ragnarokStrike(x, y) {
    var h = { big: true, dmg: LANCE_DMG * 3.0 * G.stats.spDmg * G.specialR * 0.7, kb: 420 };
    ringShock(x, y, [0.6, 0.66, 0.78], 130, 3400, 0.5); addShake(7); SFX.thud();
    hammerImpact(h, x, y, true, null);
  }
  // HERALD OF RAGNARÖK duo — hammer impacts blast a localized horn shove
  function miniHornShove(ix, iy) {
    // select bullets near the impact, but shove them AWAY FROM THE PLAYER
    displaceBullets(ix, iy, 240, 130, 0.25, 0.5, false);
    ringShock(ix, iy, [1, 0.89, 0.76], 40, 2000, 0.35);
  }
  // STORM SURGE duo — mini tidal shove on hammer impacts
  function stormSurgeWave(ix, iy) {
    displaceBullets(ix, iy, 220, 60, 0.3, 0.5, true);   // tidal nudge: straight up (player-safe by design)
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; var dx = e.x - ix, dy = e.y - iy; if (dx * dx + dy * dy < 220 * 220) pushDisp(e, ix, iy, 120); });
    ringShock(ix, iy, [0.2, 0.8, 0.85], 40, 1800, 0.35);
  }

  // ---------------------------------------------------------------------
  // aim point — every enemy aimed pattern targets this (Loki decoy redirects
  // all aimed fire; Confuse reflects an enemy's aim through itself = +pi).
  // ---------------------------------------------------------------------
  var aimTX = W / 2, aimTY = H - 300;
  function refreshAim() {
    if (G.decoy.active) { aimTX = G.decoy.x; aimTY = G.decoy.y; }
    else { aimTX = G.player.x; aimTY = G.player.y; }
  }
  function tauntTarget(e) {
    if (!G.mods.aphroTaunt) return null;
    var best = null, bd = 380 * 380;
    Engine.enemies.forEach(function (o) { if (!o.charmed || o.dying) return; var dx = o.x - e.x, dy = o.y - e.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = o; } });
    return best;
  }
  function AIMX(e) { var t = tauntTarget(e); var tx = t ? t.x : aimTX; return e.confuseT > 0 ? (2 * e.x - tx) : tx; }
  function AIMY(e) { var t = tauntTarget(e); var ty = t ? t.y : aimTY; return e.confuseT > 0 ? (2 * e.y - ty) : ty; }
  Game.aimPoint = function () { return { x: aimTX, y: aimTY }; };

  // ---------------------------------------------------------------------
  // player
  // ---------------------------------------------------------------------
  function updatePlayer(dt) {
    var p = G.player;
    if (p.dead) {
      p.respawnT -= dt;
      if (p.respawnT <= 0) { p.dead = false; p.alive = true; p.x = W / 2; p.y = H - 300; p.invuln = 2.0; }
      return;
    }
    // CURSED-GOLD gild: a golden statue — no input, no fire, no dodge, invulnerable.
    // Ticks only inside updateCombat, so pause/hitstop freeze it too (no deadlock).
    if (G.freeze.t > 0) {
      G.freeze.t -= dt;
      // Keep the timers that MUST keep ticking through the freeze alive here (the
      // early return skips their usual decrements below):
      //  - invuln: gild grants ~0.55s expecting the freeze (~0.45s) to burn it down
      //    so only a ~0.1s sliver survives unfreeze — the freeze itself is the
      //    i-frame, not a bankable shield. Without this it would stack to ~1.0s.
      //  - dash.cd keeps cooling; the Shift edge state is held coherent so a tap
      //    or release WHILE gilded can't fire a ghost dodge on the first live frame.
      if (p.invuln > 0) p.invuln -= dt;
      p.invuln = Math.max(p.invuln, 0.06);   // but never drop to hittable mid-statue
      if (G.dash.cd > 0) G.dash.cd -= dt;
      G.dash.wasFocus = Engine.focusHeld();  // absorb Shift edges silently
      G.dash.pend = false; G.dash.shiftT = 0;
      if (G.freeze.t <= 0) { G.freeze.t = 0; G.freeze.graceT = 0.8; }   // grace blocks chain-freeze
      return;
    }
    if (G.freeze.graceT > 0) G.freeze.graceT -= dt;
    var mv = Engine.readMove();
    var focus = Engine.focusHeld();
    // Ghost dodge — tap-vs-hold discrimination, dash fires on RELEASE:
    // Focus engages on press exactly as before. If Shift is released in under
    // 0.15s AND a direction was held at press time, the dash fires (using the
    // direction sampled at press). Held past 0.15s = pure focus, never a dash.
    if (G.dash.cd > 0) G.dash.cd -= dt;
    if (focus && !G.dash.wasFocus) {                    // Shift press edge
      G.dash.shiftT = 0;
      if (mv.x !== 0 || mv.y !== 0) {
        var pl = Math.hypot(mv.x, mv.y) || 1;
        G.dash.pend = true; G.dash.pendx = mv.x / pl; G.dash.pendy = mv.y / pl;
      } else G.dash.pend = false;
    } else if (focus) {
      G.dash.shiftT += dt;                              // fixed-step hold timer
    }
    if (!focus && G.dash.wasFocus) {                    // Shift release edge
      if (G.dash.shiftT < 0.15 && G.dash.pend && G.dash.cd <= 0 && G.dash.active <= 0) {
        G.dash.dirx = G.dash.pendx; G.dash.diry = G.dash.pendy;
        G.dash.active = 0.14; G.dash.cd = 0.9;          // ~160px over 0.14s, 0.9s cooldown
        p.invuln = Math.max(p.invuln, 0.35);            // reuse the vaunt-shield i-frame path
        spark(p.x, p.y, [0.5, 0.95, 1.0], 8, 300, 24);
        SFX.graze();
      }
      G.dash.pend = false;
    }
    G.dash.wasFocus = focus;
    var sp = (focus ? PLAYER_FOCUS * (1 + G.hermes.focus) : PLAYER_SPEED * (1 + G.hermes.speed));
    var len = Math.hypot(mv.x, mv.y) || 1;
    p.x += (mv.x / len) * sp * dt; p.y += (mv.y / len) * sp * dt;
    if (G.dash.active > 0) {
      G.dash.active -= dt;
      var DASH_SPEED = 160 / 0.14;
      p.x += G.dash.dirx * DASH_SPEED * dt; p.y += G.dash.diry * DASH_SPEED * dt;
      G.dash.ghosts.push({ x: p.x, y: p.y, age: 0 });
    }
    for (var gi = G.dash.ghosts.length - 1; gi >= 0; gi--) { G.dash.ghosts[gi].age += dt; if (G.dash.ghosts[gi].age > 0.28) G.dash.ghosts.splice(gi, 1); }
    var m = 40;
    if (p.x < m) p.x = m; if (p.x > W - m) p.x = W - m;
    if (p.y < m) p.y = m; if (p.y > H - m) p.y = H - m;
    if (p.invuln > 0) p.invuln -= dt;
    p.blink += dt;
    // Ra replaces projectile fire with a continuous solar beam
    if (G.attackGod === 'ra') {
      if (Engine.fireHeld()) raBeam(dt);
      else { G.ra.active = false; G.ra.target = null; G.ra.ramp = 0; }
    } else {
      p.fireT -= dt;
      if (Engine.fireHeld() && p.fireT <= 0) {
        var cad = (G.attackGod === 'guanyu') ? 1.7 : 1;   // crescents: slower, heavier cadence
        p.fireT = FIRE_CD * cad / (G.stats.atkRate * frenzyRate());
        fireShots(focus); SFX.shot();
      }
    }
    if (G.thorBuff > 0) G.thorBuff -= dt;
    // Thor Mjolnir throw cycle (alongside the thinned normal stream)
    if (G.attackGod === 'thor') {
      p.hammerT -= dt;
      if (Engine.fireHeld() && p.hammerT <= 0) {
        p.hammerT = G.mods.thorFast ? 0.9 : 1.4;
        throwHammer(false, 5 * G.stats.atkDmg * G.attackR * (G.mods.thorBelt ? 1.4 : 1), 300 * (G.mods.thorBelt ? 1.5 : 1));
      }
    }
    // Jade Emperor: issue a homing imperial edict every ~3s of firing (1.5s w/ jadeOften)
    if (G.attackGod === 'jade') {
      p.edictT -= dt;
      if (Engine.fireHeld() && p.edictT <= 0) { p.edictT = G.mods.jadeOften ? 1.5 : 3.0; fireEdict(); }
    }
  }
  function fireEdict() {
    var s = allocShot(); if (!s) return;
    var target = nearestEnemy(G.player.x, G.player.y - 40);
    var a = target ? Math.atan2(aimTargetY(target) - (G.player.y - 30), aimTargetX(target) - G.player.x) : UP;
    var sp = 920;
    s.x = G.player.x; s.y = G.player.y - 30;
    s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
    s.radius = 20; s.scale = 46; s.damage = 6.0 * G.stats.atkDmg * G.attackR; s.age = 0; s.life = 2.4;
    s.r = 0.79; s.g = 0.6; s.b = 1.0;
    s.pierce = 0; s.homing = true; s.turn = 7.0; s.kind = 7;   // kind 7 = imperial edict
    s.faction = 0; s.big = false;
    flash(s.x, s.y, [0.8, 0.6, 1], 100, 0.2);
  }

  function streamAngles(n, spread) {
    var out = [];
    if (n === 1) { out.push(0); return out; }
    var step = spread / (n - 1);
    for (var i = 0; i < n; i++) out.push(-spread / 2 + step * i);
    return out;
  }
  function fireShots(focus) {
    // HEIMDALL — Bifröst Prism: every 4th volley (3rd with heimPrism) refracts
    // into a rainbow fan of piercing prism shots instead of the normal stream.
    if (G.attackGod === 'heimdall') {
      G.player.volleyN++;
      if (G.player.volleyN >= (G.mods.heimPrism ? 3 : 4)) { G.player.volleyN = 0; firePrismFan(focus); return; }
    }
    fireStreams(G.player.x, G.player.y, focus, 1, false);
  }
  function firePrismFan(focus) {
    var n = G.mods.heimPrism ? 7 : 5;
    var spread = focus ? 0.38 : 0.58;
    var dmg = 1.0 * SHOT_DMG * G.stats.atkDmg * G.attackR;   // fan total ≈ volley ×1.6 at 5 shots
    var angs = streamAngles(n, spread);
    for (var i = 0; i < n; i++) {
      var s = allocShot(); if (!s) break;
      var a = UP + angs[i];
      s.x = G.player.x + Math.cos(a) * 26; s.y = G.player.y + Math.sin(a) * 26 - 20;
      s.vx = Math.cos(a) * SHOT_SPEED; s.vy = Math.sin(a) * SHOT_SPEED;
      s.radius = 14; s.scale = 42; s.damage = dmg; s.age = 0; s.life = 1.6;
      s.pierce = 1; s.kind = 0; s.faction = 0; s.big = false;
      var col = Patterns.hue(i / n + G.time * 0.25);         // cycling rainbow tint
      s.r = col[0]; s.g = col[1]; s.b = col[2];
    }
    flash(G.player.x, G.player.y - 40, [1, 0.9, 0.78], 90, 0.15);
  }
  function fireStreams(px, py, focus, dmgScale, isClone) {
    // Guan Yu crescents: the player fires them, and clones fire mini ones under SWORN BROTHERS.
    var guan = (G.attackGod === 'guanyu') || (isClone && G.duos.swornBrothers);
    var n = focus ? 4 : 3;
    if (G.attackGod === 'thor') n = Math.max(1, n - 1);   // Mjolnir: thinned normal stream
    if (guan) n = focus ? 3 : 2;                          // fewer, broader blades
    var spread = focus ? 0.16 : 0.30;
    var quetz = (G.attackGod === 'quetz');
    if (quetz) spread += 0.16;               // Feathered Winds: wider coverage
    if (guan) spread = focus ? 0.20 : 0.34;
    var dmg = (focus ? 1.0 : 1.05) * SHOT_DMG * G.stats.atkDmg * dmgScale * (G.thorBuff > 0 ? 1.3 : 1);
    if (guan) dmg *= 1.7 * G.attackR * (isClone ? 0.55 : 1) * ((G.mods.guanOath && focus) ? 1.3 : 1);
    var ww = (guan && G.mods.guanWide) ? 1.3 : 1;         // wider crescents
    var angs = streamAngles(n, spread);
    for (var i = 0; i < angs.length; i++) {
      var s = allocShot(); if (!s) break;
      var a = UP + angs[i];
      s.x = px + Math.cos(a) * 26; s.y = py + Math.sin(a) * 26 - 20;
      var spd = SHOT_SPEED * (guan ? 0.8 : 1);
      s.vx = Math.cos(a) * spd; s.vy = Math.sin(a) * spd;
      s.radius = guan ? (isClone ? 22 : 30) * ww : 14; s.damage = dmg; s.age = 0; s.life = 1.6; s.scale = guan ? (isClone ? 40 : 56) * ww : 44;
      s.pierce = guan ? (G.mods.guanWide ? 3 : 2) : (quetz ? (G.mods.quetzPierce ? 2 : 1) : 0);
      s.kind = guan ? 6 : 0;
      s.faction = 0; s.big = false; s.cloneShot = !!isClone;
      s.crescent = guan;
      if (guan) { s.r = 0.30; s.g = 0.95; s.b = 0.55; }
      else if (quetz) { s.weave = 1; s.phase = i * 1.3 + Math.random() * 6.28; s.r = 0.4; s.g = 1.0; s.b = 0.7; }
      else { var fr = G.frenzy.stacks / 10; s.r = 0.6 + 0.4 * fr; s.g = 1.0 - 0.7 * fr; s.b = 1.0 - 0.85 * fr; }
    }
  }

  function updateShots(dt) {
    Engine.shots.forEach(function (s) {
      s.age += dt;
      if (s.homing && s.turn > 0) {                       // Jade edict homing
        var t = nearestEnemy(s.x, s.y);
        if (t) {
          var desired = Math.atan2(aimTargetY(t) - s.y, aimTargetX(t) - s.x);   // seek the nail, not the immune body
          var cur = Math.atan2(s.vy, s.vx);
          var d = desired - cur;
          while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
          var mx = s.turn * dt; if (d > mx) d = mx; if (d < -mx) d = -mx;
          var na = cur + d, spd = Math.hypot(s.vx, s.vy);
          s.vx = Math.cos(na) * spd; s.vy = Math.sin(na) * spd;
          if (Math.random() < 0.5) spark(s.x, s.y, [0.8, 0.6, 1], 1, 90, 14);
        }
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.weave) s.x += Math.sin(s.age * 16 + s.phase) * 340 * dt; // serpentine
      if (s.y < -80 || s.y > H + 60 || s.age > s.life || s.x < -80 || s.x > W + 80) Engine.shots.release(s);
    });
  }

  function playerHit() {
    var p = G.player;
    if (!p.alive || p.invuln > 0 || G.vaunt.active || G.vaunt.mercy > 0 || G.freeze.t > 0) return;
    p.alive = false; p.dead = true; p.respawnT = 1.4;
    G.lives--;
    G.waveHits++;                                         // breaks UNTOUCHED for this wave
    dropHubris();                                         // a hit knocks HUBRIS down one step + clears progress
    if (!G.keepMult) { G.mult = 1; G.multDecayT = 0; }   // OATH TABLET charm: multiplier survives death
    G.vaunt.gauge = Math.max(0, G.vaunt.gauge * 0.3);
    SFX.death(); SFX.thud();                             // death sting + kinetic body thud
    for (var i = 0; i < 3; i++) ringShock(p.x, p.y, [1, 0.5, 0.4], 40 + i * 30, 2200, 0.6);
    spark(p.x, p.y, [1, 0.7, 0.4], 40, 520, 40);
    flash(p.x, p.y, [1, 0.8, 0.7], 300, 0.4);
    // catastrophic-but-fair weight: medium shake, a white full-screen flash, a
    // brief bloom dip (the world reels), and a micro-hitstop on the impact frame.
    addShake(JUICE.shakeMedium);
    G.flashAll = Math.max(G.flashAll, 0.35);
    G.bloom = JUICE.hitBloomDip;                          // dips now; updateVaunt lerps it back
    hitstop(JUICE.hsPlayer);
    var clearR = 340;
    Engine.bullets.forEach(function (b) {
      var dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy < clearR * clearR) { flash(b.x, b.y, [1, 0.7, 0.4], 18, 0.1); Engine.bullets.release(b); }
    });
    var spill = G.noSpill ? 0 : Math.floor(G.wallet * 0.25);   // HEART SCARAB charm: no spill
    if (spill > 0) {
      G.wallet -= spill;
      var nn = 14;
      for (var k = 0; k < nn; k++) spawnGold(p.x, p.y, 1, 0.4, Math.floor(spill / nn), 4.0);
    }
    if (G.communion === 'ASGARD' && G.lives > 0) doSpecial(true);   // Twilight Oath: death answers with a free special
    if (G.lives <= 0) Run.onGameOver();
  }

  // ---------------------------------------------------------------------
  // enemies + status
  // ---------------------------------------------------------------------
  function bezier(t, a, b, c, d) { var u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; }

  var seqCounter = 0;   // monotonic spawn id — lets a persistent target ref detect pool-slot reuse
  function newEnemy(type, x, y, hp, spr, scale, radius, col, gold, score, elite) {
    var e = Engine.enemies.alloc(); if (!e) return null;
    e.seq = ++seqCounter;
    e.type = type; e.x = x; e.y = y; e.vx = 0; e.vy = 0;
    e.hp = hp * G.aff.hpMul; e.maxhp = e.hp; e.spr = spr; e.scale = scale; e.radius = radius;
    e.r = col[0]; e.g = col[1]; e.b = col[2];
    e.t = 0; e.fireT = 0; e.fireCd = 1;
    e.s0 = 0; e.s1 = 0; e.s2 = 0; e.s3 = 0;
    e.p0x = 0; e.p0y = 0; e.p1x = 0; e.p1y = 0; e.p2x = 0; e.p2y = 0; e.p3x = 0; e.p3y = 0;
    e.pathT = 0; e.pathDur = 1; e.angle = Math.PI / 2; e.rot = Math.PI;
    e.gold = gold; e.score = score; e.hitFlash = 0;
    e.boss = false; e.phase = 0; e.name = ''; e.invuln = false; e.dying = false; e.elite = !!elite;
    e.terrorT = 0; e.shakenT = 0;
    e.charmMeter = 0; e.charmed = false; e.charmT = 0;
    e.marked = false; e.markT = 0; e.weak = false; e.weakT = 0; e.ghost = false;
    e.burnT = 0; e.burnDps = 0; e.confuseT = 0; e.stunT = 0; e.confuseBudget = 0; e.judgeT = 0;
    e.dispX = 0; e.dispY = 0; e.dispVX = 0; e.dispVY = 0; e.impactDmg = 0; e.slamCd = 0;
    e.arch = ''; e.aura = ''; e.link = null; e.gen = 0; e.g1 = ''; e.g2 = ''; e.shieldT = 0;
    e.knx = 0; e.kny = 0; e.fireHold = 0;
    // danmaku-overhaul script/path state — MUST reset on pooled reuse or a fresh
    // enemy inherits stale movement (phantom retreatAt splices, poseT slows its
    // first frames, a leftover pathSegs/script from the prior occupant runs).
    e.script = null; e.scriptT = 0; e.scriptI = 0; e.scriptLoop = 1; e.poseT = 0;
    e.pathSegs = null; e.segI = 0; e.segT = 0; e.sx = 0; e.sy = 0;
    e.holdX = 0; e.holdY = 0; e.retreatAt = 0; e.didRetreat = false;
    e.arrived = false; e.phaseT = 0; e.breathT = 0; e.segFloorHp = 0; e.segBounds = null;
    // boss-concept rework: MUST reset on pooled reuse or a fresh enemy inherits the
    // prior occupant's MIDAS gold-theft flag (spawns cursed cancel gold!) or the
    // TALOS nail immunity (body would take 0 damage). This was a real leak.
    e.isMidas = false; e.hoard = 0; e.hoardBank = 0; e.hoardCount = 0;
    e.nailActive = false; e.nailR = 0; e.nailX = 0; e.nailY = 0;
    e.onDeath = null; e.onUpdate = null;
    // formation membership: stamped with the current wave's squadron id (0 = none,
    // e.g. boss waves) and counted once toward FORMATION WIPE tracking. formCounted
    // MUST reset on pooled reuse or a fresh member is treated as already-defeated.
    e.formId = curFormId; e.formCounted = false;
    if (curFormId) { var _f = findForm(curFormId); if (_f) _f.count++; }
    return e;
  }

  // ----- status effect application (from god attack hits) -----
  function applyAttackGod(e, s, dmg) {
    switch (G.attackGod) {
      case 'zeus': chainLightning(e, dmg * 0.4 * G.attackR); break;
      case 'poseidon': knockback(e, dmg); break;
      case 'aphrodite':
        if (e.boss) { e.weak = true; e.weakT = 4; }
        else { e.charmMeter += CHARM_PER_HIT; if (e.charmMeter >= (G.mods.aphroFast ? 3 : CHARM_THRESHOLD)) charmEnemy(e); }
        break;
      case 'loki': {
        var ch = 0.12 + (G.mods.lokiChance ? 0.06 : 0);
        if (e.boss) { if (Math.random() < ch * 0.5) { e.confuseT = 0.8; e.confuseBudget = e.maxhp * 0.03; } }
        else if (Math.random() < ch) e.confuseT = 2.0;
        break;
      }
      case 'anubis':
        if (!e.boss && !e.dying && e.hp < anubisThreshold() * e.maxhp) executeEnemy(e);
        break;
      // ares = Bloodlust (frenzy on kill); artemis = crit in damageEnemy;
      // aphrodite/loki damage riders live in hitEnemy; ra/odin/wukong/quetz
      // have no on-hit status.
    }
  }

  function chainLightning(origin, dmg, isStorm) {
    var jumps = 2 + G.mods.zeusChain + (isStorm ? 2 : 0);
    var col = [0.7, 0.9, 1.0];
    var fx = origin.x, fy = origin.y;
    var hitList = [origin];
    var used = 0;
    for (var j = 0; j < jumps; j++) {
      var best = zapNearest(fx, fy, hitList);
      if (!best) break;
      arcFx(fx, fy, best.x, best.y, col);
      damageEnemy(best, dmg, false);
      used++;
      hitList.push(best);
      // zeusFork: also strike a second nearby target this jump
      if (G.mods.zeusFork) {
        var fork = zapNearest(fx, fy, hitList);
        if (fork) { arcFx(fx, fy, fork.x, fork.y, col); damageEnemy(fork, dmg * 0.7, false); hitList.push(fork); }
      }
      fx = best.x; fy = best.y;
    }
    // VS BOSSES rule: unspent jumps collapse onto the origin at 50% each, so a
    // chain fired at a lone boss is never wasted.
    var unspent = jumps - used;
    if (unspent > 0 && !origin.dying) {
      arcFx(origin.x - 40, origin.y - 40, origin.x, origin.y, col);
      damageEnemy(origin, dmg * 0.5 * unspent, false);
    }
    if (G.mods.zeusCrit && !origin.dying) damageEnemy(origin, dmg * 0.6, true);
  }
  function zapNearest(fx, fy, hitList) {
    var best = null, bd = 340 * 340;
    Engine.enemies.forEach(function (e) {
      if (e.dying || e.charmed || hitList.indexOf(e) >= 0) return;
      var dx = e.x - fx, dy = e.y - fy, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }

  // Poseidon knockback: push via the displacement system (visible on scripted
  // movers) — the wall-slam / enemy-slam is resolved in integrateDisp().
  function knockback(e, dmg) {
    var force = 300 * (G.mods.poseidonBig ? 1.6 : 1) * (G.mods.poseidonForce ? 1.4 : 1);
    pushDisp(e, G.player.x, G.player.y, force);
    e.impactDmg = dmg * 1.5 * (G.mods.poseidonBig ? 1.8 : 1) * (G.mods.poseidonForce ? 1.4 : 1);
  }

  // spring-damper displacement integration + slam resolution
  function integrateDisp(e, dt) {
    if (e.slamCd > 0) e.slamCd -= dt;
    var k = 55, damp = 0.86;
    e.dispVX += (-e.dispX * k) * dt; e.dispVY += (-e.dispY * k) * dt;
    e.dispVX *= damp; e.dispVY *= damp;
    e.dispX += e.dispVX * dt; e.dispY += e.dispVY * dt;
    var cl = e.terrorT > 0 ? 480 : 150;
    var dm = Math.hypot(e.dispX, e.dispY);
    if (dm > cl) { var s = cl / dm; e.dispX *= s; e.dispY *= s; e.dispVX *= 0.4; e.dispVY *= 0.4; }
    if ((e.arch === 'aegis' || e.aura === 'bulwark') && dm > 80) e.shieldT = 1.5;   // physics spins the shield open
    if (dm > 45 && e.slamCd <= 0) {
      var wx = e.x + e.dispX, wy = e.y + e.dispY;
      if (wx < 40 || wx > W - 40 || wy < 40) { doSlam(e, wx, wy); }
      else {
        var slam = false, other = null;
        Engine.enemies.forEach(function (o) {
          if (slam || o === e || o.dying || o.charmed) return;
          var dx = (o.x + o.dispX) - wx, dy = (o.y + o.dispY) - wy;
          if (dx * dx + dy * dy < (e.radius + o.radius) * (e.radius + o.radius)) { slam = true; other = o; }
        });
        if (slam) { var d0 = e.impactDmg; doSlam(e, wx, wy); if (other && !other.dying) damageEnemy(other, d0 > 0 ? d0 : (e.maxhp * 0.1 + 20), false); }
      }
    }
  }
  function doSlam(e, wx, wy) {
    e.slamCd = 0.35;
    var dmg = e.impactDmg > 0 ? e.impactDmg : (e.maxhp * 0.1 + 20);
    spark(wx, wy, [0.3, 0.85, 0.9], 8, 380, 26);
    flash(wx, wy, [0.5, 0.95, 1.0], 60, 0.14);
    if (G.mods.aresSpoils && e.terrorT > 0 && Engine.gold.freeTop > 1) spawnGold(wx, wy, 2, 0.5); // spoils of war
    if (G.mods.poseidonSplash) Engine.enemies.forEach(function (o) { if (o.dying || o.charmed || o === e) return; var dx = o.x - wx, dy = o.y - wy; if (dx * dx + dy * dy < 150 * 150) damageEnemy(o, dmg * 0.5, false); });
    var wasTerror = e.terrorT > 0;
    damageEnemy(e, dmg, false);
    if (G.duos.wildHunt && wasTerror && e.dying) addFrenzy();   // WILD HUNT: terror-slam kills feed frenzy
  }

  function charmEnemy(e) {
    if (e.boss || e.charmed) return;
    creditForm(e);   // charming a squadron member counts as defeating it (fix #1)
    e.charmed = true; e.charmMeter = 0;
    e.charmT = CHARM_TIME * (G.mods.aphroLong ? 1.6 : 1);
    spark(e.x, e.y, [1, 0.5, 0.85], 10, 260, 28);
    flash(e.x, e.y, [1, 0.5, 0.85], 60, 0.2);
  }

  function updateStatus(e, dt) {
    // marked / weak decay
    if (e.markT > 0) { e.markT -= dt; if (e.markT <= 0) e.marked = false; }
    if (e.weakT > 0) { e.weakT -= dt; if (e.weakT <= 0) e.weak = false; }
    // Burn (DoT); Ra 'spread' handled in killEnemy on death
    if (e.burnT > 0) {
      e.burnT -= dt; e.hp -= e.burnDps * dt; clampBossHp(e);   // burn respects the spellcard floor too
      if (Math.random() < dt * 9) spark(e.x, e.y, [1, 0.5, 0.12], 1, 130, 14);
      if (e.hp <= 0) { killEnemy(e, true); return; }
    }
    if (e.confuseT > 0) e.confuseT -= dt;
    if (e.stunT > 0) e.stunT -= dt;
    // Ares terror / shaken
    if (e.terrorT > 0) e.terrorT -= dt;
    if (e.shakenT > 0) e.shakenT -= dt;
    // charm meter slow decay
    if (!e.charmed && e.charmMeter > 0) e.charmMeter = Math.max(0, e.charmMeter - dt * 0.5);
  }

  function updateCharmed(e, dt) {
    e.charmT -= dt;
    // find nearest non-charmed enemy
    var best = null, bd = 1e18;
    Engine.enemies.forEach(function (o) {
      if (o === e || o.dying || o.charmed) return;
      var dx = o.x - e.x, dy = o.y - e.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = o; }
    });
    if (best) {
      var dx = best.x - e.x, dy = best.y - e.y, d = Math.sqrt(bd) || 1;
      e.x += (dx / d) * 160 * dt; e.y += (dy / d) * 160 * dt;
      e.rot = Math.atan2(dy, dx) + Math.PI / 2;
      e.fireHold -= dt;
      if (e.fireHold <= 0) {
        e.fireHold = G.duos.loveAndWar ? 0.175 : 0.35;   // LOVE AND WAR: charmed allies fire twice as fast
        var s = allocShot();
        if (s) {
          s.x = e.x; s.y = e.y; s.vx = (dx / d) * 900; s.vy = (dy / d) * 900;
          s.radius = 12; s.scale = 26; s.damage = e.ghost ? 0.6 : 1.4; s.age = 0; s.life = 1.2;
          s.r = 1; s.g = 0.5; s.b = 0.85; s.pierce = 0; s.kind = 2; s.faction = 2; s.big = false;
        }
      }
    } else { e.y -= 60 * dt; if (e.charmT > 0.4) e.charmT = 0.4; } // no targets left — wind down so waves can clear
    if (e.charmT <= 0) expireCharm(e);
  }
  function expireCharm(e) {
    if (e.dying) return;
    e.dying = true;
    spark(e.x, e.y, [1, 0.5, 0.85], 16, 320, 30);
    ringShock(e.x, e.y, [1, 0.4, 0.8], 30, 1600, 0.5);
    if (G.mods.aphroExplode) {
      Engine.enemies.forEach(function (o) {
        if (o.dying || o.charmed || o === e) return;
        var dx = o.x - e.x, dy = o.y - e.y;
        if (dx * dx + dy * dy < 200 * 200) damageEnemy(o, e.maxhp * 0.4 + 30, false);
      });
    }
    if (G.duos.loveAndWar) {                              // expiry inflicts Terror around them
      Engine.enemies.forEach(function (o) { if (o.dying || o.charmed || o === e) return; var dx = o.x - e.x, dy = o.y - e.y; if (dx * dx + dy * dy < 240 * 240) terrify(o, e.x, e.y); });
    }
    addScore(e.score * G.mult * 0.5);
    spawnGold(e.x, e.y, e.gold, 1);
    addCharge(SP_KILL);
    Engine.enemies.release(e);
  }

  // =====================================================================
  // PATH BOOK + FIRE SCRIPTS (danmaku overhaul)
  // Every non-boss enemy runs an authored path (no straight-vy / bare-sine
  // lives) and a looping beat list; formations share a script clock with a
  // per-index phase offset — six ships firing feel like one instrument. Fire
  // is UNAIMED authored geometry with at most a sparse aimed accent (Law 1).
  // =====================================================================
  var POP_COL = [1.0, 0.42, 0.5], MID_COL = [1.0, 0.5, 0.2], TURR_COL = [0.96, 0.42, 0.7];
  var P = Patterns, DOWN = Math.PI / 2;
  function rankSpd(base) { var m = 1 + 0.10 * (G.rank - 1); if (m > 1.5) m = 1.5; return base * m; }
  // POLISH: sector escalation of bullet COUNT (complexity-first, numbers-second —
  // small per-rank additive bump so S3 crests out-mass S1 without flattening the
  // authored geometry). base + perRank*(rank-1), clamped to a generous ceiling so
  // gap/lane widths (scaled in step-units at each call site) never collapse.
  function rankCnt(base, perRank, cap) { var n = Math.round(base + (perRank || 0) * (G.rank - 1)); if (cap && n > cap) n = cap; return n < 1 ? 1 : n; }
  function clampX(x, m) { m = m || 160; return x < m ? m : x > W - m ? W - m : x; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function qbez(a, c, b, t) { var u = 1 - t; return u * u * a + 2 * u * t * c + t * t * b; }
  function muzzle(e, col) { col = col || [1, 0.6, 0.3]; flash(e.x, e.y, col, 74, 0.22); ringShock(e.x, e.y, col, 18, 900, 0.26); }

  // --- path runner ---
  function initPath(e) { e.segI = 0; e.segT = 0; e.sx = e.x; e.sy = e.y; }
  // Shared path runner. opt (optional, boss callers) = { loop, poseFactor,
  // bobRate }: loop wraps the segment list instead of auto-exiting (holds/
  // pendulums/rails cycle); poseFactor/bobRate override the popcorn defaults.
  // Popcorn callers pass no opt and get the original 0.30 / 1.6 / auto-exit
  // behavior pixel-for-pixel.
  function pathTick(e, dt, opt) {
    var segs = e.pathSegs; if (!segs || !segs.length) return;
    var loop = !!(opt && opt.loop);
    var poseF = (opt && opt.poseFactor) || 0.30;
    var bobR = (opt && opt.bobRate) || 1.6;
    if (e.segI >= segs.length) { if (loop) { e.segI = 0; e.segT = 0; e.sx = e.x; e.sy = e.y; } else return; }
    var s = segs[e.segI];
    var mdt = e.poseT > 0 ? dt * poseF : dt;      // slow into the beat, burst out of it
    e.segT += mdt;
    var dur = s.dur || 0.001, u = e.segT / dur; if (u > 1) u = 1;
    var ue = (s.k === 'orbit') ? u : easeInOut(u);
    if (s.k === 'curve') { e.x = qbez(e.sx, s.cx, s.ex, ue); e.y = qbez(e.sy, s.cy, s.ey, ue); }
    else if (s.k === 'line' || s.k === 'exit') { e.x = e.sx + (s.ex - e.sx) * ue; e.y = e.sy + (s.ey - e.sy) * ue; }
    else if (s.k === 'hold') { e.x = e.sx + (s.bob ? Math.sin(e.t * bobR) * s.bob : 0); e.y = e.sy; }
    else if (s.k === 'orbit') { var a = s.from + (s.to - s.from) * ue; e.x = s.cx + Math.cos(a) * s.rad; e.y = s.cy + Math.sin(a) * s.rad; }
    if (u >= 1) {
      if (s.k === 'exit') { killEnemy(e, false); return; }
      e.segI++; e.segT = 0; e.sx = e.x; e.sy = e.y;
      if (!loop && e.segI >= segs.length) { e.pathSegs = [{ k: 'exit', dur: 2.4, ex: e.x, ey: H + 200 }]; initPath(e); }
    }
  }
  // --- fire script ---
  function setScript(e, beats, loop, phase) {
    e.script = beats; e.scriptLoop = loop; e.scriptT = phase || 0; e.scriptI = 0;
    // strictly-less-than so a t:0 opening beat SURVIVES phase 0 (the common
    // case): it fires on the first tick (scriptTick uses <=), preserving the
    // pose slow-down + muzzle telegraph before the first volley. A formation
    // member with phase>0 still skips beats it has already passed.
    while (e.scriptI < beats.length && beats[e.scriptI].t < e.scriptT) e.scriptI++;
  }
  function scriptTick(e, dt) {
    var sc = e.script; if (!sc) { if (e.poseT > 0) e.poseT -= dt; return; }
    e.scriptT += dt;
    while (e.scriptI < sc.length && sc[e.scriptI].t <= e.scriptT) {
      var _pv = e.poseT;
      sc[e.scriptI].fn(e);
      // A beat that fired a volley (did NOT re-arm the pose windup) cracks a white
      // core at the emitter — the rhythm-law downbeat. Pose beats raise poseT, so
      // they're skipped (their muzzle flash already telegraphs).
      if (e.poseT <= _pv) crack(e.x, e.y);
      e.scriptI++;
    }
    if (e.scriptLoop > 0 && e.scriptT >= e.scriptLoop) { e.scriptT -= e.scriptLoop; e.scriptI = 0; }
    if (e.poseT > 0) e.poseT -= dt;
  }
  // retreatReturn: fall back off-pattern at an hp threshold (never RNG), return
  function triggerRetreat(e) {
    var backY = Math.max(120, e.y - 260);
    e.pathSegs.splice(e.segI, 0,
      { k: 'line', dur: 0.5, ex: e.x, ey: backY },
      { k: 'hold', dur: 0.5, ex: e.x, ey: backY, bob: 16 },
      { k: 'line', dur: 0.6, ex: e.holdX || e.x, ey: e.holdY || e.y });
    e.segT = 0; e.sx = e.x; e.sy = e.y;
  }
  function pathEnemyUpdate(e, dt) {
    e.t += dt;                        // drives hold-segment bob sway (Math.sin(e.t*…))
    if (e.retreatAt > 0 && !e.didRetreat && e.hp < e.maxhp * e.retreatAt) { e.didRetreat = true; triggerRetreat(e); }
    pathTick(e, dt);
    e.rot = Math.PI;
    scriptTick(e, dt);
  }

  // --- the 8 named paths ---
  function P_swoopHold(e, entryX, holdX, holdY, exitX) {
    e.holdX = holdX; e.holdY = holdY;
    e.pathSegs = [
      { k: 'curve', dur: 1.1, cx: entryX, cy: holdY * 0.55, ex: holdX, ey: holdY },
      { k: 'hold', dur: 1.7, ex: holdX, ey: holdY, bob: 22 },
      { k: 'curve', dur: 1.2, cx: exitX, cy: holdY + 140, ex: exitX, ey: -180 },
      { k: 'exit', dur: 0.2, ex: exitX, ey: -220 }
    ];
    initPath(e);
  }
  function P_sCurve(e, side, holdY) {
    var a = side < 0 ? 180 : W - 180, b = side < 0 ? W - 180 : 180;
    e.holdX = W / 2; e.holdY = holdY || 600;
    e.pathSegs = [
      { k: 'curve', dur: 1.4, cx: a, cy: 320, ex: W / 2, ey: 560 },
      { k: 'curve', dur: 1.4, cx: b, cy: 820, ex: side < 0 ? W - 200 : 200, ey: 1040 },
      { k: 'exit', dur: 1.5, ex: side < 0 ? 200 : W - 200, ey: H + 200 }
    ];
    initPath(e);
  }
  function P_loop(e, cx, cy, rad) {
    e.holdX = cx; e.holdY = cy;
    e.pathSegs = [
      { k: 'line', dur: 0.9, ex: cx, ey: cy - rad },
      { k: 'orbit', dur: 1.6, cx: cx, cy: cy, rad: rad, from: -DOWN, to: -DOWN + Math.PI * 2 },
      { k: 'exit', dur: 1.2, ex: cx, ey: H + 200 }
    ];
    initPath(e);
  }
  function P_pendulum(e, xA, xB, y) {
    e.holdX = (xA + xB) / 2; e.holdY = y;
    e.pathSegs = [
      { k: 'line', dur: 1.0, ex: xA, ey: y },
      { k: 'line', dur: 1.3, ex: xB, ey: y },
      { k: 'line', dur: 1.3, ex: xA, ey: y },
      { k: 'line', dur: 1.3, ex: xB, ey: y },
      { k: 'exit', dur: 1.4, ex: xB, ey: H + 200 }
    ];
    initPath(e);
  }
  function P_orbitPoint(e, cx, cy, rad, turns, from) {
    from = from || 0; e.holdX = cx; e.holdY = cy;
    e.pathSegs = [
      { k: 'line', dur: 0.9, ex: cx + Math.cos(from) * rad, ey: cy + Math.sin(from) * rad },
      { k: 'orbit', dur: 2.4 * turns, cx: cx, cy: cy, rad: rad, from: from, to: from + Math.PI * 2 * turns },
      { k: 'exit', dur: 1.2, ex: cx, ey: H + 200 }
    ];
    initPath(e);
  }
  function P_diveBrake(e, targetX, brakeY) {
    e.holdX = targetX; e.holdY = brakeY;
    e.pathSegs = [
      { k: 'line', dur: 0.55, ex: targetX, ey: brakeY },
      { k: 'hold', dur: 0.8, ex: targetX, ey: brakeY },
      { k: 'curve', dur: 1.0, cx: targetX, cy: brakeY - 120, ex: targetX, ey: -180 },
      { k: 'exit', dur: 0.2, ex: targetX, ey: -220 }
    ];
    initPath(e);
  }
  function P_flankRail(e, side, depth) {
    var edge = side < 0 ? 130 : W - 130, inX = side < 0 ? W * 0.42 : W * 0.58;
    e.holdX = inX; e.holdY = depth;
    e.pathSegs = [
      { k: 'line', dur: 1.0, ex: edge, ey: depth },
      { k: 'line', dur: 0.8, ex: inX, ey: depth },
      { k: 'hold', dur: 1.4, ex: inX, ey: depth, bob: 14 },
      { k: 'exit', dur: 1.5, ex: edge, ey: H + 200 }
    ];
    initPath(e);
  }
  function P_retreatReturn(e, holdX, holdY, thresh) {
    e.holdX = holdX; e.holdY = holdY; e.retreatAt = thresh || 0.5; e.didRetreat = false;
    e.pathSegs = [
      { k: 'curve', dur: 1.0, cx: holdX, cy: holdY * 0.5, ex: holdX, ey: holdY },
      { k: 'hold', dur: 2.8, ex: holdX, ey: holdY, bob: 20 },
      { k: 'exit', dur: 1.4, ex: holdX, ey: H + 200 }
    ];
    initPath(e);
  }

  // --- converted popcorn / turret / midship spawners ---
  // POPCORN: HP near-flat (dies to a breath of the torrent at any power).
  function spawnDarter(startX, curlX, exitX) {
    var e = newEnemy(1, startX, -120, 6, GL.SPR.SHIP_POP, 96, 30, POP_COL, 4, 500, false); if (!e) return;
    var side = startX < W / 2 ? -1 : 1;
    var holdX = clampX(side < 0 ? 320 : W - 320, 220);
    var exX = (exitX != null) ? exitX : (side < 0 ? W + 180 : -180);
    P_swoopHold(e, startX, holdX, 470, exX);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.32; muzzle(e, [1, 0.55, 0.28]); } },
      { t: 0.4, fn: function (e) { e.s1++; P.arcWall(e.x, e.y, DOWN, 1.1, 7, rankSpd(P.SPD.slow), { laneAt: ((e.s1 % 3) - 1) * 0.24, laneWidth: 2.8, fam: P.FAM.PELLET, tier: 'M', color: P.ORANGE }); } },
      { t: 1.0, fn: function (e) { e.s1++; P.arcWall(e.x, e.y, DOWN, 1.1, 7, rankSpd(P.SPD.slow), { laneAt: ((e.s1 % 3) - 1) * 0.24, laneWidth: 2.8, fam: P.FAM.PELLET, tier: 'M', color: P.ORANGE }); } }
    ], 2.0, 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  function spawnWeaver(cx, amp, phase) {
    var e = newEnemy(2, cx, -100, 6, GL.SPR.SHIP_POP, 88, 28, [1, 0.5, 0.2], 4, 700, false); if (!e) return;
    var side = cx < W / 2 ? -1 : 1;
    P_sCurve(e, side, 560);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.26; muzzle(e, [1, 0.5, 0.2]); } },
      { t: 0.4, fn: function (e) { P.fan(e.x, e.y, DOWN, 6, 1.0, rankSpd(P.SPD.mid), { fam: P.FAM.PELLET, tier: 'S', color: P.ORANGE }); } }
    ], 1.2, (phase || 0) * 0.2);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  function spawnTurret(x, targetY) {
    var e = newEnemy(3, x, -100, 14, GL.SPR.SHIP_MID, 108, 40, TURR_COL, 7, 1500, true); if (!e) return;
    var xA = clampX(x - 190, 180), xB = clampX(x + 190, 180);
    P_pendulum(e, xA, xB, targetY || 360);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.4; muzzle(e, [0.96, 0.4, 0.7]); } },
      { t: 0.5, fn: function (e) { e.s1++; P.ringGap(e.x, e.y, rankCnt(15, 6, 24), rankSpd(P.SPD.slow), { gaps: 2, gapWidth: 2.5, offset: e.s1 * 0.5, fam: P.FAM.ORB, tier: 'M', color: P.MAGENTA }); } },
      { t: 1.4, fn: function (e) { e.s0 += 0.5; P.wheel(e.x, e.y, e.s0, 11, rankSpd(P.SPD.mid), { gapEvery: 5, fam: P.FAM.ORB, tier: 'S', color: P.MAGENTA }); } }
    ], 2.4, 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  function spawnGunship(fromLeft) {
    var side = fromLeft ? -1 : 1;
    var e = newEnemy(4, fromLeft ? -140 : W + 140, 300, 34, GL.SPR.SHIP_GUN, 130, 52, [1, 0.5, 0.15], 12, 3000, true); if (!e) return;
    P_flankRail(e, side, 420);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.35; muzzle(e, [1, 0.5, 0.2]); } },
      { t: 0.5, fn: function (e) { P.arcWall(e.x, e.y, DOWN, 1.4, rankCnt(11, 5, 18), rankSpd(P.SPD.slow), { laneAt: 0, laneWidth: 3.8, fam: P.FAM.PELLET, tier: 'M', color: P.ORANGE }); } },
      { t: 1.3, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 5, { spread: 0.16, speed: rankSpd(P.SPD.fast) }); } }
    ], 2.2, 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }

  // MIDSHIP: large held enemy (270px), 2-geometry fire script + sparse accent.
  // Carries the HP budget (survives most of its arrangement on-curve); its death
  // cancels its OWN remaining pattern to gold (explicit interruption payoff).
  function spawnMidship(ax) {
    var hp = 260 * (1 + 0.55 * (G.rank - 1));
    var e = newEnemy(30, ax, -240, hp, GL.SPR.SHIP_MID, 270, 100, MID_COL, 26, 7000, true); if (!e) return;
    e.arch = 'midship';
    var xA = clampX(ax - 160, 220), xB = clampX(ax + 160, 220);
    P_pendulum(e, xA, xB, 380);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.45; muzzle(e, [1, 0.5, 0.2]); } },
      { t: 0.5, fn: function (e) { e.s0 += 0.4; var gc = rankCnt(23, 9, 34); P.ringGap(e.x, e.y, gc, rankSpd(P.SPD.slow), { gaps: 2, gapWidth: 2.9, offset: e.s0, fam: P.FAM.ORB, tier: 'L', color: P.MAGENTA });
        P.ringGap(e.x, e.y, gc, rankSpd(P.SPD.slow) + 70, { gaps: 2, gapWidth: 2.9, offset: e.s0 + 0.11, fam: P.FAM.PELLET, tier: 'S', color: P.ORANGE }); } },   // S-pellet filler threads between the anchor orbs (tier mix, same lane)
      { t: 1.4, fn: function (e) { e.s1++; P.arcWall(e.x, e.y, DOWN, 1.5, rankCnt(14, 6, 22), rankSpd(P.SPD.mid), { laneAt: ((e.s1 % 3) - 1) * 0.2, laneWidth: 4.0, fam: P.FAM.PELLET, tier: 'M', color: P.ORANGE }); } },
      { t: 2.3, fn: function (e) { e.poseT = 0.35; muzzle(e, [1, 0.85, 0.35]); } },
      { t: 2.7, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 6, { spread: 0.22, speed: rankSpd(P.SPD.fast) }); } }
    ], 3.2, 0);
    e.onUpdate = pathEnemyUpdate;
  }

  // ---- overhaul spawners wiring the remaining paths + verbs (DANMAKU.md) ----
  // LOOPER — showmanship popcorn: enters, full loop-de-loop, fires an unaimed
  // pellet fan near the loop bottom, exits. Popcorn HP (dies to a breath). PATH: loop.
  function spawnLooper(cx) {
    var e = newEnemy(1, clampX(cx, 200), -120, 6, GL.SPR.SHIP_POP, 92, 30, POP_COL, 4, 600, false); if (!e) return;
    P_loop(e, clampX(cx, 220), 460, 200);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.28; muzzle(e, [1, 0.6, 0.3]); } },
      { t: 1.6, fn: function (e) { P.fan(e.x, e.y, DOWN, 7, 1.1, rankSpd(P.SPD.mid), { fam: P.FAM.PELLET, tier: 'S', color: P.ORANGE }); } }   // ~loop bottom; unaimed (drifting popcorn law)
    ], 2.6, 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  // DIVER — aggression without aiming: fast dive at the player's FORMER x, hard
  // brake, unaimed ring burst, climb out. Popcorn HP. PATH: diveBrake.
  function spawnDiver(formerX, brakeY) {
    var e = newEnemy(1, clampX(formerX, 120), -120, 7, GL.SPR.SHIP_POP, 84, 28, [1, 0.45, 0.4], 4, 700, false); if (!e) return;
    P_diveBrake(e, clampX(formerX, 120), brakeY || 520);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.22; muzzle(e, [1, 0.5, 0.3]); } },
      { t: 0.6, fn: function (e) { e.s1++; P.ring(e.x, e.y, 11, rankSpd(P.SPD.slow), { fam: P.FAM.ORB, tier: 'S', color: P.ORANGE, offset: e.s1 * 0.31 }); } }   // unaimed burst at the brake
    ], 1.6, 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  // WHEEL SHIP — one spoke of a rotating wheel formation: N ships orbit a shared
  // center (per-index start angle + script phase), each firing wheel spokes
  // outward. PATH: orbitPoint. VERB: wheel.
  function spawnWheelShip(cx, cy, rad, idx, n, phase) {
    var from = TAU * idx / n - DOWN;
    var e = newEnemy(3, cx + Math.cos(from) * rad, cy + Math.sin(from) * rad, 12, GL.SPR.SHIP_MID, 92, 34, TURR_COL, 6, 1200, true); if (!e) return;
    P_orbitPoint(e, cx, cy, rad, 1.5, from);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.3; muzzle(e, [0.96, 0.42, 0.7]); } },
      { t: 0.5, fn: function (e) { e.s0 += 0.4; P.wheel(e.x, e.y, e.s0, 10, rankSpd(P.SPD.mid), { gapEvery: 4, fam: P.FAM.ORB, tier: 'S', color: P.MAGENTA }); } }
    ], 1.4, phase || 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  // REACTOR — an elite that reacts: holds firing a gap-ring, falls back at an hp
  // threshold, RETURNS with a denser pulse volley. PATH: retreatReturn. VERB: pulse.
  function spawnReactor(ax) {
    var hp = 130 * (1 + 0.5 * (G.rank - 1));
    var e = newEnemy(3, clampX(ax, 220), -160, hp, GL.SPR.SHIP_MID, 150, 58, [1, 0.55, 0.85], 16, 3200, true); if (!e) return;
    P_retreatReturn(e, clampX(ax, 220), 420, 0.5);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.4; muzzle(e, [1, 0.5, 0.85]); } },
      { t: 0.5, fn: function (e) { e.s0 += 0.45; P.ringGap(e.x, e.y, 18, rankSpd(P.SPD.slow), { gaps: 2, gapWidth: 2.4, offset: e.s0, fam: P.FAM.ORB, tier: 'M', color: P.MAGENTA }); } },
      { t: 1.4, fn: function (e) { if (e.didRetreat) P.pulse(e.x, e.y, { rings: 3, count: 18, speed: rankSpd(P.SPD.slow), speedStep: 60, offset: e.s0, colorA: P.MAGENTA, colorB: P.ORANGE }); } }   // the denser return volley
    ], 2.2, 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  // RIBBON — weave-through popcorn crossing the field diagonally behind the
  // fight, firing perpendicular snake ribbons. PATH: sCurve. VERB: snake. (S2+)
  function spawnRibbon(cx, side) {
    var e = newEnemy(2, cx, -100, 8, GL.SPR.SHIP_POP, 84, 28, [1, 0.5, 0.25], 5, 900, false); if (!e) return;
    P_sCurve(e, side, 520);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.24; muzzle(e, [1, 0.5, 0.25]); } },
      { t: 0.4, fn: function (e) { e.s1++; P.snake(e.x, e.y, DOWN + side * 0.6, 9, rankSpd(P.SPD.mid), { amp: 46, freq: 0.85, phase: e.s1 * 0.5, fam: P.FAM.SHARD, tier: 'M', color: P.MAGENTA }); } }
    ], 1.3, 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  // FLANKER — mirrored pair hugging the side rails, firing crossing diagonal
  // streams (syncopated by phase so the crosses breathe). PATH: flankRail. VERB:
  // crossfire. (S2+)
  function spawnFlanker(side, phase) {
    var e = newEnemy(4, side < 0 ? -140 : W + 140, 340, 30, GL.SPR.SHIP_GUN, 116, 46, [1, 0.5, 0.2], 10, 2400, true); if (!e) return;
    P_flankRail(e, side, 360);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.32; muzzle(e, [1, 0.5, 0.3]); } },
      { t: 0.5, fn: function (e) { P.crossfire(e.x, W - e.x, e.y, 6, rankSpd(P.SPD.mid), { angle: 0.42, spacing: 34, fam: P.FAM.KUNAI, tier: 'M', color: P.MAGENTA }); } }
    ], 1.7, phase || 0);
    e.onUpdate = pathEnemyUpdate; maybeAura(e);
  }
  // RAINMAKER — parks near the top and lays a drifting top-edge rain curtain as
  // sector ambience under the crescendo's other patterns. VERB: rain. (S2+)
  function spawnRainmaker(ax) {
    var e = newEnemy(3, clampX(ax, 200), -80, 40, GL.SPR.SHIP_MID, 120, 46, [1, 0.5, 0.3], 10, 1600, true); if (!e) return;
    e.holdX = clampX(ax, 200); e.holdY = 150;
    e.pathSegs = [
      { k: 'line', dur: 0.9, ex: e.holdX, ey: 150 },
      { k: 'hold', dur: 5.4, ex: e.holdX, ey: 150, bob: 30 },
      { k: 'exit', dur: 1.2, ex: e.holdX, ey: -220 }
    ];
    initPath(e);
    setScript(e, [
      { t: 0.0, fn: function (e) { e.poseT = 0.3; muzzle(e, [1, 0.55, 0.3]); } },
      { t: 0.6, fn: function (e) { e.s0 += 0.7; P.rain(24, { speed: rankSpd(P.SPD.slow), waves: 3, phase: e.s0, gapThresh: 0.1, fam: P.FAM.PELLET, tier: 'S', color: P.ORANGE }); } }
    ], 1.4, 0);
    e.onUpdate = pathEnemyUpdate;
  }
  // cancel an emitter's own in-flight bullets to gold (midship death payoff).
  // Keyed by the emitter's monotonic seq — a bullet from a PRIOR enemy that held
  // the same pool slot has a different seq and is left flying (no unearned clear).
  function cancelOwnerBullets(seq, x, y) {
    var n = 0;
    Engine.bullets.forEach(function (b) {
      if (b.ownerId === seq && !b.friendly) { if (Engine.gold.freeTop > 0) spawnGold(b.x, b.y, 1, 0.4); flash(b.x, b.y, [1, 0.85, 0.3], 20, 0.12); Engine.bullets.release(b); n++; }
    });
    if (n) { ringShock(x, y, [1, 0.9, 0.4], 70, 4200, 0.7); addShake(4); homeAllGold(); }
  }

  // ---------------------------------------------------------------------
  // phase-6 enemy archetypes + elite auras
  // ---------------------------------------------------------------------
  function applyAura(e, aura) {
    e.aura = aura;
    if (aura === 'gilded') { e.gold = Math.round(e.gold * 2); e.hp *= 1.4; e.maxhp = e.hp; }
  }
  function maybeAura(e) {
    if (!e || e.boss) return;
    var r = Math.random();
    if (r < 0.05) applyAura(e, 'gilded');
    else if (r < 0.09) applyAura(e, 'bulwark');
    else if (r < 0.13) applyAura(e, 'frenzied');
  }

  // AEGIS SHIELDBEARER — front shield; displacement spins it to expose the back
  function spawnAegis(x) {
    var e = newEnemy(20, x, -120, 70, GL.SPR.SHIP_GUN, 110, 50, [0.5, 0.8, 1.0], 8, 2200, true); if (!e) return;
    e.arch = 'aegis'; e.vy = 120; e.fireCd = 1.4; e.onUpdate = updateAegis;
  }
  function updateAegis(e, dt) {
    e.t += dt;
    if (e.y < 360) e.y += e.vy * dt; else e.x += Math.cos(e.t) * 60 * dt;
    e.rot = Math.PI;
    if (e.shieldT > 0) e.shieldT -= dt;
    e.fireT -= dt;
    if (e.fireT <= 0) { e.fireT = e.fireCd; Patterns.aimedFan(e.x, e.y, AIMX(e), AIMY(e), 3, 0.4, 280 * G.rank, { color: Patterns.CYAN, radius: 11 }); }
    if (e.t > 18) { e.y += 100 * dt; if (e.y > H + 140) killEnemy(e, false); }
  }

  // WEAVER PAIR — two drones linked by a perpendicular bullet-curtain tether
  function spawnWeaverPair() {
    var a = newEnemy(21, W * 0.3, -100, 44, GL.SPR.SHIP_POP, 66, 26, [0.6, 0.4, 1.0], 4, 1200, false);
    var b = newEnemy(21, W * 0.7, -110, 44, GL.SPR.SHIP_POP, 66, 26, [0.6, 0.4, 1.0], 4, 1200, false);
    if (!a || !b) return;
    a.arch = 'weaver2'; b.arch = 'weaver2'; a.link = b; b.link = a;
    a.s2 = 0.15; b.s2 = 0.65; a.vy = 90; b.vy = 90; a.s3 = 1; b.s3 = 0;
    a.onUpdate = updateWeaverPair; b.onUpdate = updateWeaverPair;
    a.onDeath = weaverPairDeath; b.onDeath = weaverPairDeath;
  }
  function updateWeaverPair(e, dt) {
    e.t += dt; e.y += e.vy * dt;
    e.x = W / 2 + Math.cos(e.t * 0.8 + e.s2 * 6.28) * 300 * (e.s3 ? 1 : -1);
    e.rot = Math.PI;
    if (e.s3 && e.link && e.link.active && !e.link.dying) {
      var mx = (e.x + e.link.x) / 2, my = (e.y + e.link.y) / 2;
      e.s0 += dt; e.fireT -= dt;
      if (e.fireT <= 0) {
        e.fireT = 0.5;
        var ang = Math.atan2(e.link.y - e.y, e.link.x - e.x) + Math.PI / 2;
        Patterns.bullet(mx, my, ang, 120 * G.rank, { color: Patterns.VIOLET, radius: 12 });
        Patterns.bullet(mx, my, ang + Math.PI, 120 * G.rank, { color: Patterns.VIOLET, radius: 12 });
      }
      if (e.s0 >= 10) { e.s0 = 0; Patterns.ring(mx, my, 24, 220 * G.rank, { color: Patterns.MAGENTA, radius: 12 }); }
    }
    if (e.y > H + 120) killEnemy(e, false);
  }
  function weaverPairDeath(e) { if (e.link && e.link.active) e.link.link = null; }

  // GILDED MIMIC — disguised as a gold cluster; lunges + sprays when neared
  function spawnMimic(x, y) {
    var e = newEnemy(22, x, y, 20, GL.SPR.GOLD, 40, 30, [1, 0.8, 0.3], 12, 900, false); if (!e) return;
    e.arch = 'mimic'; e.s0 = 0; e.onUpdate = updateMimic;
  }
  function updateMimic(e, dt) {
    e.t += dt;
    var dx = G.player.x - e.x, dy = G.player.y - e.y, d2 = dx * dx + dy * dy;
    if (e.s0 === 0) {
      e.x += Math.sin(e.t) * 22 * dt; e.y += 22 * dt;
      if (d2 < 200 * 200 && G.player.alive) {
        e.s0 = 1; var d = Math.sqrt(d2) || 1; e.vx = dx / d * 420; e.vy = dy / d * 420;
        e.spr = GL.SPR.SHIP_POP; e.r = 1; e.g = 0.5; e.b = 0.2; e.scale = 62; e.radius = 26;
        Patterns.spray(e.x, e.y, Patterns.aimAngle(e.x, e.y, AIMX(e), AIMY(e)), 1.2, 8, 220 * G.rank, 340 * G.rank, { color: Patterns.ORANGE, radius: 11 });
        spark(e.x, e.y, [1, 0.6, 0.2], 14, 320, 26);
      } else if (e.y > H + 100) killEnemy(e, false);
    } else {
      e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.95; e.vy *= 0.95;
      e.fireT -= dt;
      if (e.fireT <= 0) { e.fireT = 0.7; Patterns.aimedFan(e.x, e.y, AIMX(e), AIMY(e), 3, 0.4, 300 * G.rank, { color: Patterns.ORANGE, radius: 11 }); }
      if (e.y > H + 120 || e.x < -100 || e.x > W + 100) killEnemy(e, false);
    }
  }

  // SPLITTER — jelly that halves into children (3 generations)
  function spawnSplitter(x, y, gen) {
    var sc = 96 - gen * 24, hp = 34 / (gen + 1);
    var e = newEnemy(23, x, y, hp, GL.SPR.SHIP_MID, sc, sc * 0.42, [0.4, 1, 0.6], 3, 600, false); if (!e) return;
    e.arch = 'splitter'; e.gen = gen; e.vy = 100 + gen * 40; e.onUpdate = updateSplitter; e.onDeath = splitterDeath;
  }
  function updateSplitter(e, dt) {
    e.t += dt; e.y += e.vy * dt; e.x += Math.sin(e.t * 2) * 40 * dt; e.rot = Math.PI;
    e.fireT -= dt;
    if (e.fireT <= 0 && e.y > 100 && e.y < H - 400) { e.fireT = 1.4; Patterns.ring(e.x, e.y, 6 + e.gen * 2, 180 * G.rank, { color: Patterns.LIME, radius: 11 }); }
    if (e.y > H + 120) killEnemy(e, false);
  }
  function splitterDeath(e) { if (e.gen < 2) spawnLoose(function () { spawnSplitter(e.x - 32, e.y, e.gen + 1); spawnSplitter(e.x + 32, e.y, e.gen + 1); }); }   // children don't join the squadron (fix #2)

  // CHORUS ACOLYTE — heals nearest elite/boss; skitters from the player
  function spawnAcolyte(x) {
    var e = newEnemy(24, x, -100, 26, GL.SPR.SHIP_POP, 64, 28, [0.4, 1, 0.7], 5, 1400, false); if (!e) return;
    e.arch = 'acolyte'; e.vy = 120; e.onUpdate = updateAcolyte;
  }
  function updateAcolyte(e, dt) {
    e.t += dt;
    if (e.y < 300) e.y += e.vy * dt; else e.x += Math.cos(e.t) * 50 * dt;
    e.rot = Math.PI;
    var tgt = nearestHealTarget(e);
    e.link = tgt;
    if (tgt) tgt.hp = Math.min(tgt.maxhp, tgt.hp + tgt.maxhp * 0.03 * dt);
    if (e.hitFlash > 0) { var dx = e.x - G.player.x, dy = e.y - G.player.y, d = Math.hypot(dx, dy) || 1; e.dispVX += dx / d * 500 * dt; e.dispVY += dy / d * 500 * dt; }
    if (e.y > H + 120) killEnemy(e, false);
  }
  function nearestHealTarget(e) {
    var best = null, bd = 1e18;
    Engine.enemies.forEach(function (o) {
      if (o === e || o.dying || o.charmed) return;
      if (!(o.boss || o.aura === 'gilded' || o.arch === 'aegis' || o.arch === 'carrier' || o.arch === 'gardener')) return;
      if (o.hp >= o.maxhp) return;
      var dx = o.x - e.x, dy = o.y - e.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = o; }
    });
    return best;
  }

  // CARRIER HULK — spawns escorts; breaks into physics debris on death
  function spawnCarrier(rank) {
    var e = newEnemy(25, W / 2, -180, 320 * rank, GL.SPR.SHIP_GUN, 190, 88, [0.9, 0.5, 0.3], 30, 8000, true); if (!e) return;
    e.arch = 'carrier'; e.vy = 60; e.fireCd = 2.0; e.onUpdate = updateCarrier; e.onDeath = carrierDeath;
  }
  function updateCarrier(e, dt) {
    e.t += dt;
    if (e.y < 300) e.y += e.vy * dt; else e.x = W / 2 + Math.sin(e.t * 0.4) * 260;
    e.rot = Math.PI; e.fireT -= dt;
    if (e.fireT <= 0) { e.fireT = e.fireCd; spawnLoose(function () { spawnEscort(e.x, e.y); }); }   // escorts don't join the squadron (fix #2)
    if (e.t > 40) killEnemy(e, false);
  }
  function carrierDeath(e) { var n = 3 + (Math.random() < 0.5 ? 1 : 0); for (var i = 0; i < n; i++) spawnDebris(e.x, e.y, Math.random() * TAU); }
  function spawnEscort(x, y) {
    var e = newEnemy(1, x, y, 2, GL.SPR.SHIP_POP, 58, 24, [1, 0.4, 0.5], 2, 300, false); if (!e) return;
    e.vy = 230; e.fireCd = 1.0; e.onUpdate = updateEscort;
  }
  function updateEscort(e, dt) {
    e.t += dt; e.y += e.vy * dt; e.x += Math.sin(e.t * 3) * 60 * dt; e.rot = Math.PI;
    e.fireT -= dt;
    if (e.fireT <= 0 && e.y < H - 400) { e.fireT = e.fireCd; Patterns.aimed(e.x, e.y, AIMX(e), AIMY(e), 320 * G.rank, { color: Patterns.CYAN, radius: 10 }); }
    if (e.y > H + 120) killEnemy(e, false);
  }

  // BLINK MOTH — teleports between aimed bursts
  function spawnMoth(x) {
    var e = newEnemy(26, x, -100, 18, GL.SPR.SHIP_POP, 60, 26, [0.7, 0.5, 1.0], 5, 1300, false); if (!e) return;
    e.arch = 'moth'; e.s0 = 0; e.vy = 100; e.onUpdate = updateMoth;
  }
  function updateMoth(e, dt) {
    e.t += dt; e.rot = Math.PI;
    if (e.y < 250) { e.y += e.vy * dt; return; }
    e.s1 -= dt;
    if (e.s0 === 0) {
      e.fireT -= dt;
      if (e.fireT <= 0) { e.fireT = 0.3; e.s2++; Patterns.aimed(e.x, e.y, AIMX(e), AIMY(e), 360 * G.rank, { color: Patterns.VIOLET, shape: Patterns.NEEDLE, radius: 9 }); if (e.s2 >= 3) { e.s0 = 1; e.s1 = 0.45; } }
    } else if (e.s0 === 1) {
      if (e.s1 <= 0) { e.s0 = 2; e.s1 = 0.14; flash(e.x, e.y, [0.7, 0.5, 1], 80, 0.15); }
    } else {
      if (e.s1 <= 0) { e.x = 120 + Math.random() * (W - 240); e.y = 200 + Math.random() * 420; e.s0 = 0; e.s2 = 0; flash(e.x, e.y, [0.7, 0.5, 1], 90, 0.2); }
    }
    if (e.t > 30) killEnemy(e, false);
  }

  // BULLET GARDENER — extrudes a persistent bullet garden; death cancels it to gold
  function spawnGardener(x) {
    var e = newEnemy(27, x, -120, 90, GL.SPR.SHIP_MID, 100, 46, [0.6, 1, 0.5], 14, 3000, true); if (!e) return;
    e.arch = 'gardener'; e.vy = 120; e.s1 = 0; e.onUpdate = updateGardener; e.onDeath = gardenerDeath;
  }
  function updateGardener(e, dt) {
    e.t += dt;
    if (e.y < 320) e.y += e.vy * dt;
    e.rot = Math.PI;
    if (e.s1 < 150) {
      e.fireT -= dt;
      if (e.fireT <= 0) {
        e.fireT = 0.12;
        var b = Patterns.bullet(e.x, e.y, Math.random() * TAU, 60 + Math.random() * 40, { color: Patterns.LIME, radius: 12, life: 60 });
        if (b) { b.gardenerId = e._i; e.s1++; }
      }
    }
    if (e.t > 45) killEnemy(e, false);
  }
  function gardenerDeath(e) {
    var id = e._i, n = 0;
    Engine.bullets.forEach(function (b) { if (b.gardenerId === id) { if (Engine.gold.freeTop > 0) spawnGold(b.x, b.y, 1, 0.35); flash(b.x, b.y, [1, 0.85, 0.3], 20, 0.14); Engine.bullets.release(b); n++; } });
    if (n) { ringShock(e.x, e.y, [1, 0.9, 0.4], 60, 5000, 0.8); flash(e.x, e.y, [1, 0.9, 0.5], 300, 0.4); addShake(5); homeAllGold(); }
  }

  // carrier debris — short-lived player-side tumbling chunks that hurt enemies
  function spawnDebris(x, y, ang) {
    var sp = 200 + Math.random() * 220;
    G.debris.push({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, spin: 0, t: 0, hit: [], dmg: 45 });
  }
  function updateDebris(dt) {
    for (var i = G.debris.length - 1; i >= 0; i--) {
      var d = G.debris[i]; d.t += dt; d.spin += dt * 9; d.vy += 200 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      Engine.enemies.forEach(function (e) { if (e.dying || e.charmed || d.hit.indexOf(e) >= 0) return; if (Engine.hit(d.x, d.y, 30, e.x, e.y, e.radius)) { damageEnemy(e, d.dmg, false); pushDisp(e, d.x, d.y, 220); d.hit.push(e); } });
      if (d.t > 3 || d.y > H + 80 || d.x < -60 || d.x > W + 60) G.debris.splice(i, 1);
    }
  }
  function drawDebris() {
    for (var i = 0; i < G.debris.length; i++) {
      var d = G.debris[i];
      GL.draw(GL.SPR.GLOW, d.x, d.y, 60, 60, 0, 1, 0.6, 0.3, 0.4);
      GL.draw(GL.SPR.SHIP_MID, d.x, d.y, 46, 46, d.spin, 0.95, 0.55, 0.35, 0.95);
    }
  }

  // THE APOSTATE — elite wielding two gods you didn't pick (enemy-side variants)
  function unpickedGods() {
    var all = ['zeus', 'poseidon', 'artemis', 'aphrodite', 'ares', 'heimdall', 'ra', 'anubis', 'loki', 'odin', 'wukong', 'quetz', 'thor', 'guanyu', 'jade'];
    var out = []; for (var i = 0; i < all.length; i++) if (all[i] !== G.attackGod && all[i] !== G.specialGod) out.push(all[i]);
    return out;
  }
  function spawnApostate(rank) {
    var pool = unpickedGods();
    var g1 = pool[Math.floor(Math.random() * pool.length)];
    var rest = pool.filter(function (x) { return x !== g1; });
    var g2 = rest[Math.floor(Math.random() * rest.length)] || g1;
    var e = newEnemy(28, W / 2, -220, 12000 * rank, GL.SPR.SHIP_BOSS, 260, 118, [0.8, 0.3, 0.9], 70, 150000, true); if (!e) return;
    e.arch = 'apostate'; e.boss = true; e.g1 = g1; e.g2 = g2; e.name = 'THE APOSTATE'; G.boss = e;
    var gn = function (g) { return Run.GODS[g] ? Run.GODS[g].name : g; };
    announce('THE APOSTATE', 'renegade of ' + gn(g1) + ' & ' + gn(g2), 3.2);
    e.onUpdate = updateApostate; e.onDeath = apostateDeath;
  }
  function updateApostate(e, dt) {
    e.t += dt;
    if (e.y < 420) { e.y += 150 * dt; return; }
    e.x = W / 2 + Math.sin(e.t * 0.5) * 260; e.rot = Math.PI;
    e.fireT -= dt;
    if (e.fireT <= 0) { e.fireT = 1.4; apostateFire(e, (Math.floor(e.t / 3) % 2 === 0) ? e.g1 : e.g2); }
  }
  function apostateDeath(e) { G.boss = null; bigDeath(e, 80); announce('APOSTATE SILENCED', 'a boon is torn free', 2.4); Run.grantApostateDraft(); }
  function apostateFire(e, god) {
    var px = AIMX(e), py = AIMY(e), aim = Patterns.aimAngle(e.x, e.y, px, py);
    switch (god) {
      case 'zeus': Patterns.ring(e.x, e.y, 12, 200 * G.rank, { color: Patterns.CYAN, radius: 12 }); for (var i = 0; i < 6; i++) arcFx(e.x, e.y, e.x + Math.cos(i) * 130, e.y + Math.sin(i) * 130, [0.7, 0.9, 1]); break;
      case 'poseidon': Patterns.aimedFan(e.x, e.y, px, py, 3, 0.4, 150 * G.rank, { color: Patterns.CYAN, radius: 16 }); break;
      case 'artemis': Patterns.aimed(e.x, e.y, px, py, 640 * G.rank, { color: Patterns.LIME, shape: Patterns.NEEDLE, radius: 10 }); break;
      case 'aphrodite': apostateCharmYours(e); break;
      case 'ares': Patterns.spray(e.x, e.y, aim, 1.0, 8, 220 * G.rank, 340 * G.rank, { color: Patterns.ORANGE, radius: 11 }); break;
      case 'heimdall': for (var hp2 = 0; hp2 < 7; hp2++) { Patterns.bullet(e.x, e.y, aim - 0.55 + hp2 * (1.1 / 6), 330 * G.rank, { color: Patterns.hue(hp2 / 7), shape: Patterns.NEEDLE, radius: 9 }); } break; // hostile prism fan
      case 'ra': Patterns.fan(e.x, e.y, aim, 9, 0.9, 340 * G.rank, { color: Patterns.ORANGE, shape: Patterns.NEEDLE, radius: 9 }); break;
      case 'anubis': apostateStealGold(e); break;
      case 'loki': apostateDecoy(e); break;
      case 'odin': Patterns.aimed(e.x, e.y, px, py, 240 * G.rank, { color: Patterns.VIOLET, angVel: 1.4, radius: 12 }); break;
      case 'wukong': apostateClones(e); break;
      case 'quetz': Patterns.whip(e.x, e.y, Math.PI / 2, 14, 240 * G.rank, { color: Patterns.LIME, swing: 1.2, curl: 1.6, radius: 11 }); break;
      case 'thor': Patterns.bullet(e.x, e.y, aim - 0.3, 210 * G.rank, { color: Patterns.CYAN, radius: 18, angVel: 0.9, life: 6 }); break;
      case 'guanyu': Patterns.whip(e.x, e.y, aim, 12, 280 * G.rank, { color: [0.3, 0.95, 0.55], swing: 1.4, curl: 1.5, radius: 14 }); break;
      case 'jade': Patterns.aimed(e.x, e.y, px, py, 200 * G.rank, { color: Patterns.VIOLET, angVel: 1.1, radius: 14 }); Patterns.fan(e.x, e.y, aim, 5, 0.8, 170 * G.rank, { color: Patterns.VIOLET, radius: 12 }); break;
      default: Patterns.ring(e.x, e.y, 16, 200 * G.rank, { color: Patterns.MAGENTA, radius: 12 });
    }
  }
  function apostateCharmYours(e) {
    if (G.clones.length) { var c = G.clones.pop(); spark(c.x, c.y, [1, 0.4, 0.8], 12, 260, 26); }
    else if (G.ravens.length) G.ravens.pop();
    flash(e.x, e.y, [1, 0.4, 0.8], 100, 0.2);
  }
  function apostateStealGold(e) {
    var n = 0;
    Engine.gold.forEach(function (g) { if (n < 6 && g.value < 0.6 && !g.homing) { spark(g.x, g.y, [0.9, 0.7, 0.3], 3, 200, 18); Engine.gold.release(g); n++; } });
  }
  function apostateDecoy(e) {
    // fakedecoy is a summon — spawn loose so its self-destruct (killEnemy false)
    // doesn't mark the wave's squadron as escaped and block a WIPE (fix #2).
    var d = spawnLoose(function () { return newEnemy(1, 200 + Math.random() * (W - 400), 300 + Math.random() * 320, 30, GL.SPR.SHIP_PLAYER, 60, 26, [0.5, 1, 0.6], 2, 200, false); });
    if (d) { d.arch = 'fakedecoy'; d.vy = 0; d.onUpdate = function (dd, ddt) { dd.t += ddt; dd.rot = 0; if (dd.t > 4) killEnemy(dd, false); }; }
  }
  function apostateClones(e) {
    spawnLoose(function () {   // apostate clones are summons — never squadron members (fix #2)
      for (var i = 0; i < 2; i++) { var c = newEnemy(1, e.x + (i ? 120 : -120), e.y + 60, 40, GL.SPR.SHIP_POP, 60, 26, [1, 0.5, 0.3], 3, 300, false); if (c) { c.vy = 120; c.fireCd = 1.0; c.onUpdate = updateEscort; } }
    });
  }

  // ==================================================================
  // BOSS SETLIST ENGINE (pass B) — spellcard phases.
  // A boss is a list of named phases; each carries an HP segment, a movement
  // path (looped from the path book) and a looping fire script of 2-3 attacks.
  // Early phases CYCLE their attacks; mid-fight-onward phases LAYER a wide
  // unaimed geometry (rings/walls/wheels) with a single telegraphed aimed
  // accent (never two aimed at once; never area-alone). Transitions cancel the
  // whole bullet field to gold (the payday), flash a name card + sting, breathe
  // ~1s, then open the next composition. Timers tick in fixed-step update only,
  // so pause freezes the whole fight.
  // ==================================================================
  var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

  // Bosses run the shared pathTick with loop=true (wrap the segment list —
  // holds/pendulums/rails cycle) and boss pose/bob constants (0.4 / 1.4).
  var BOSS_PATH_OPT = { loop: true, poseFactor: 0.4, bobRate: 1.4 };

  // --- boss path-book presets (each describes one looped cycle) ---
  function bp_holdCenter(e, cfg) {
    e.pathSegs = [
      { k: 'line', dur: 1.0, ex: cfg.centerX, ey: cfg.holdY },
      { k: 'hold', dur: 3.4, ex: cfg.centerX, ey: cfg.holdY, bob: 30 }
    ]; initPath(e);
  }
  function bp_pendulum(e, cfg) {
    var xa = cfg.centerX - cfg.strafe, xb = cfg.centerX + cfg.strafe, y = cfg.holdY;
    e.pathSegs = [
      { k: 'line', dur: 1.7, ex: xa, ey: y },
      { k: 'hold', dur: 0.7, ex: xa, ey: y, bob: 12 },
      { k: 'line', dur: 1.7, ex: xb, ey: y },
      { k: 'hold', dur: 0.7, ex: xb, ey: y, bob: 12 }
    ]; initPath(e);
  }
  function bp_rails(e, cfg) {   // screen-edge rushes between volleys
    var l = 250, r = W - 250, y = cfg.holdY;
    e.pathSegs = [
      { k: 'hold', dur: 1.2, ex: cfg.centerX, ey: y, bob: 10 },
      { k: 'curve', dur: 1.0, cx: l, cy: y - 90, ex: l, ey: y },
      { k: 'hold', dur: 1.1, ex: l, ey: y, bob: 8 },
      { k: 'curve', dur: 1.3, cx: cfg.centerX, cy: y + 70, ex: r, ey: y },
      { k: 'hold', dur: 1.1, ex: r, ey: y, bob: 8 },
      { k: 'curve', dur: 1.0, cx: cfg.centerX, cy: y - 70, ex: cfg.centerX, ey: y }
    ]; initPath(e);
  }
  function bp_lunge(e, cfg) {   // AMMIT bite: lunge down, hold at the low point, retreat
    var y = cfg.holdY;
    e.pathSegs = [
      { k: 'hold', dur: 1.1, ex: cfg.centerX, ey: y, bob: 16 },
      { k: 'line', dur: 0.32, ex: cfg.centerX, ey: y + 300 },
      { k: 'hold', dur: 0.5, ex: cfg.centerX, ey: y + 300, bob: 6 },
      { k: 'line', dur: 0.9, ex: cfg.centerX, ey: y }
    ]; initPath(e);
  }
  function bp_orbit(e, cfg) {   // wheel phases: orbit the hold point (a moving core)
    var y = cfg.holdY, rad = 95;
    e.pathSegs = [
      { k: 'line', dur: 0.8, ex: cfg.centerX + rad, ey: y },
      { k: 'orbit', dur: 4.2, cx: cfg.centerX, cy: y, rad: rad, from: 0, to: TAU }
    ]; initPath(e);
  }

  // enter phase i: set the segment HP floor, movement and (on a transition) the
  // payday cancel + name card + sting, then breathe before the script activates.
  function bossEnterPhase(e, phases, cfg, i, transition) {
    e.phase = i; e.phaseT = 0; e.s0 = 0; e.s1 = 0; e.s2 = 0; e.s3 = 0;
    var ph = phases[i];
    e.segFloorHp = e.maxhp * (1 - e.segBounds[i]);
    // Breath is a payday moment, not a dps window: hold hp at where it stands
    // now (the previous phase's floor, or full hp on arrival) so damage during
    // the recenter/name-card is discarded. The path is initialized AFTER the
    // breath (see bossActivateScript) so its origin snapshot is the post-
    // recenter position — no horizontal snap-back on the next phase's tick.
    e.breathFloor = e.hp;
    e.script = null;                       // silent through the breath
    if (ph.onEnter) ph.onEnter(e, cfg);    // phase hook (TALOS arms the nail here)
    if (transition) {
      cancelBulletsToGold(e.isMidas); homeAllGold();   // full-field cancel to gold (CURSED vs MIDAS)
      ringShock(e.x, e.y, [1, 0.92, 0.45], 90, 3200, 0.75);
      flash(e.x, e.y, [1, 0.92, 0.6], 360, 0.45);
      addShake(JUICE.shakeMedium); SFX.bossPhase(); hitstop(JUICE.hsBossPhase);
      e.breathT = 1.0;
    } else {
      e.breathT = 0.55;                    // phase I: a brief pose after the arrival
    }
    announce(ph.name, ROMAN[i] || ('' + (i + 1)), 1.9);
    if (window.MUSIC) MUSIC.setBossPhase(i);       // boss theme escalates a layer per phase
  }
  function bossActivateScript(e, phases, cfg) {
    var ph = phases[e.phase];
    ph.path(e, cfg);                        // init path NOW: origin snapshots the post-recenter position
    setScript(e, ph.script, ph.loop, 0);
  }
  function bossTick(e, dt, phases, cfg) {
    e.t += dt; e.rot = Math.PI;
    // TALOS nail tracks the ankle and sways as he lurches (updated every frame,
    // including the transition breath, so it never renders/collides at the origin).
    if (e.nailActive) { e.nailX = e.x + Math.sin(e.t * 4) * 16; e.nailY = e.y + e.scale * 0.44; }
    if (!e.arrived) {                      // entry descent from off-screen
      e.y += 175 * dt;
      if (e.y >= cfg.holdY) { e.y = cfg.holdY; e.arrived = true; bossEnterPhase(e, phases, cfg, 0, false); }
      return;
    }
    if (e.breathT > 0) {                   // transition breath: recenter, hold, no fire
      e.breathT -= dt;
      e.x += (cfg.centerX - e.x) * Math.min(1, dt * 2.4);
      if (e.breathT <= 0) bossActivateScript(e, phases, cfg);
      return;
    }
    pathTick(e, dt, BOSS_PATH_OPT);
    scriptTick(e, dt);
    e.phaseT += dt;
    if (e.phase < phases.length - 1) {
      var timedOut = e.phaseT >= phases[e.phase].timeout;
      if (e.hp <= e.segFloorHp || timedOut) {
        if (!timedOut) { skillEvent(e.x, e.y - 40, 'PHASE SEIZED', 30); G.tally.phases++; }   // homage: beaten on damage — grants a HUBRIS step
        bossEnterPhase(e, phases, cfg, e.phase + 1, true);
      }
    }
  }
  function bossSegBounds(phases) {         // cumulative HP-segment boundaries
    var b = [], cum = 0;
    for (var i = 0; i < phases.length; i++) { cum += phases[i].hp; b.push(cum); }
    b[phases.length - 1] = 1;              // last segment always bottoms out at 0 hp
    return b;
  }
  function startBoss(e, phases, cfg) {
    e.boss = true; e.arrived = false; e.phase = 0; e.breathT = 0; e.phaseT = 0; e.breathFloor = 0;
    e.segBounds = bossSegBounds(phases);
    G.boss = e;
    e.onUpdate = function (en, dt) { bossTick(en, dt, phases, cfg); };
  }

  // -------- bosses --------
  // Sector-1 anchor: TALOS, the bronze sentinel — 5 phases. The setlist tells his
  // myth: patrol → siege stones → the burning embrace → layered rage → THE NAIL,
  // the ankle weak-point that is his one mortality (Talos died when his ichor ran
  // out of a single nail). Function + meta names keep their legacy 'warden'
  // spelling so saved unlocks survive. Tint: molten bronze, hotter/redder than
  // loot gold. Accent needles a fixed hot gold (ACC).
  function spawnWarden(rank) {
    var e = newEnemy(5, W / 2, -160, 3000 * rank, GL.SPR.SHIP_MID, 210, 92, [1.0, 0.58, 0.22], 40, 40000, true); if (!e) return;
    e.name = 'TALOS';
    announce('TALOS', 'the bronze sentinel', 2.4);
    var BRZ = [1.0, 0.5, 0.16], HOT = [1.0, 0.72, 0.28], MAG = P.MAGENTA, ACC = [1.0, 0.86, 0.4];
    var cfg = { holdY: 360, centerX: W / 2, strafe: 250 };
    function pose(col, h) { return { t: 0, fn: function (e) { e.poseT = h || 0.42; muzzle(e, col || BRZ); } }; }
    // HURLED STONES: XL boulders lobbed on ballistic arcs (angVel curls each toward
    // straight-down, accel makes them heavy) that burst into pellet shrapnel at a
    // depth line. Sparse, slow, heavy — the terrain you route boulders around.
    function hurl(e, n, col) {
      for (var i = 0; i < n; i++) {
        var f = n > 1 ? (i / (n - 1) - 0.5) : 0, ang = DOWN + f * 1.15;
        P.bullet(e.x, e.y, ang, rankSpd(P.SPD.slow) * 0.62, { fam: P.FAM.ORB, tier: 'XL', color: col, angVel: (DOWN - ang) * 0.85, accel: 70, maxSpeed: 340, burstY: 1250, life: 12 });
      }
    }
    // THE BURNING EMBRACE: heated walls close from both screen edges (rows moving
    // inward), warm-ramped HOT/BRZ, with a single moving vertical lane between.
    function embrace(e, laneCy, spd) {
      for (var yy = 150; yy < H - 130; yy += 48) {
        if (Math.abs(yy - laneCy) < 150) continue;   // the moving lane (>= 3.5x hitbox)
        var col = ((yy / 48) | 0) % 2 ? HOT : BRZ;
        P.bullet(46, yy, 0, spd, { fam: P.FAM.PELLET, tier: 'M', color: col });
        P.bullet(W - 46, yy, Math.PI, spd, { fam: P.FAM.PELLET, tier: 'M', color: col });
      }
    }
    var phases = [
      // I THE CIRCUIT — patrol: wide sweeping pulse arcs while pendulum-strafing
      // (single geometry, the Foundry Breath material adapted to a moving patrol).
      { name: 'THE CIRCUIT', hp: 0.16, timeout: 32, path: bp_pendulum, loop: 2.8, script: [
        pose(BRZ),
        { t: 0.5, fn: function (e) { e.s0 += 0.4; P.pulse(e.x, e.y, { rings: 3, count: 16, speed: rankSpd(P.SPD.slow), speedStep: 58, offset: e.s0, colorA: BRZ, colorB: HOT }); } },
        { t: 1.6, fn: function (e) { e.poseT = 0.42; muzzle(e, HOT); } },
        { t: 2.1, fn: function (e) { e.s0 += 0.4; P.pulse(e.x, e.y, { rings: 3, count: 14, speed: rankSpd(P.SPD.slow), speedStep: 64, offset: -e.s0, colorA: HOT, colorB: MAG }); } }
      ] },
      // II HURLED STONES — ballistic boulders bursting into shrapnel + a sparse aimed accent.
      { name: 'HURLED STONES', hp: 0.18, timeout: 32, path: bp_holdCenter, loop: 2.8, script: [
        pose(BRZ, 0.5),
        { t: 0.6, fn: function (e) { hurl(e, 3, BRZ); } },
        { t: 1.5, fn: function (e) { hurl(e, 4, HOT); } },
        { t: 2.1, fn: function (e) { e.poseT = 0.3; muzzle(e, ACC); } },
        { t: 2.4, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 3, { spread: 0.16, speed: rankSpd(P.SPD.whip), color: ACC }); } }
      ] },
      // III THE BURNING EMBRACE — mirrored heated walls closing from both edges with
      // a moving lane; he holds center (single geometry, area with a visible lane).
      { name: 'THE BURNING EMBRACE', hp: 0.20, timeout: 34, path: bp_holdCenter, loop: 2.6, script: [
        pose(HOT),
        { t: 0.5, fn: function (e) { e.s2++; embrace(e, cfg.holdY + Math.sin(e.s2 * 0.9) * 360, rankSpd(P.SPD.slow) * 0.72); } },
        { t: 1.5, fn: function (e) { e.poseT = 0.36; muzzle(e, BRZ); } },
        { t: 1.9, fn: function (e) { e.s2++; embrace(e, cfg.holdY + Math.sin(e.s2 * 0.9) * 360, rankSpd(P.SPD.slow) * 0.72); } }
      ] },
      // IV RAGE OF BRONZE — stones + closing walls layered + an aimed accent (the
      // mid-fight layering law: two geometries claiming area, one needle threading).
      { name: 'RAGE OF BRONZE', hp: 0.22, timeout: 36, path: bp_holdCenter, loop: 3.0, script: [
        pose(BRZ, 0.4),
        { t: 0.4, fn: function (e) { e.s2++; embrace(e, cfg.holdY + Math.sin(e.s2) * 380, rankSpd(P.SPD.slow) * 0.78); } },
        { t: 1.2, fn: function (e) { hurl(e, 4, HOT); } },
        { t: 2.0, fn: function (e) { e.poseT = 0.3; muzzle(e, ACC); } },
        { t: 2.35, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 5, { spread: 0.24, speed: rankSpd(P.SPD.whip), color: ACC }); } }
      ] },
      // V THE NAIL — his densest rage (circuit sweeps + boulders) while he lurches
      // the rails. From here TALOS' body is IMMUNE: only the glowing ankle nail (its
      // pool = this segment's HP) takes damage. onEnter arms the nail; kill it and
      // he dies through the normal warden path with an ichor spray (see onDeath).
      { name: 'THE NAIL', hp: 0.24, timeout: 44, path: bp_rails, loop: 3.0,
        onEnter: function (e) { e.nailActive = true; e.nailR = 30; e.nailX = e.x; e.nailY = e.y + e.scale * 0.44; },
        script: [
        pose(BRZ, 0.36),
        { t: 0.3, fn: function (e) { e.s0 += 0.5; P.pulse(e.x, e.y, { rings: 3, count: 18, speed: rankSpd(P.SPD.slow), speedStep: 60, offset: e.s0, colorA: BRZ, colorB: HOT }); } },
        { t: 1.0, fn: function (e) { hurl(e, 4, HOT); } },
        { t: 1.7, fn: function (e) { e.s0 += 0.5; P.pulse(e.x, e.y, { rings: 2, count: 16, speed: rankSpd(P.SPD.mid), speedStep: 62, offset: -e.s0, colorA: HOT, colorB: MAG }); } },
        { t: 2.4, fn: function (e) { e.poseT = 0.3; muzzle(e, ACC); } },
        { t: 2.7, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 5, { spread: 0.26, speed: rankSpd(P.SPD.whip), color: ACC }); } }
      ] }
    ];
    startBoss(e, phases, cfg);
    e.onDeath = function () {
      Run.onWardenKilled(); G.boss = null;
      bigDeath(e, 60);
      // ichor spray — green-gold, the divine blood running out of the pierced nail.
      var nx = e.nailX || e.x, ny = e.nailY || e.y;
      for (var i = 0; i < 4; i++) ringShock(nx, ny, [0.55, 1, 0.4], 40 + i * 44, 2200, 0.75);
      spark(nx, ny, [0.6, 1, 0.42], 70, 560, 44);
      flash(nx, ny, [0.7, 1, 0.5], 320, 0.5);
      announce('TALOS FELLED', 'the ichor runs dry', 2.0);
    };
  }
  // Sector-2 anchor: AMMIT, devourer of hearts — 6 phases following the Weighing
  // of the Heart myth: entry rite → the forty-two confessions → the scales (feather
  // vs heart) → the scales tip → the verdict → the devouring. Tint: bruised
  // magenta, with a LIME counterpoint on her opening petals (ART.md). She lunges on
  // her bite phase (The Devouring) via the path book.
  function spawnWarden2(rank) {
    var e = newEnemy(5, W / 2, -160, 5400 * rank, GL.SPR.SHIP_MID, 230, 100, [0.82, 0.28, 0.55], 60, 70000, true); if (!e) return;
    e.name = 'AMMIT';
    announce('AMMIT', 'devourer of hearts', 2.6);
    var MAG = [0.9, 0.22, 0.5], ROSE = [1.0, 0.3, 0.62], PALE = [1.0, 0.62, 0.78], LIME = P.LIME, ACC = [1.0, 0.86, 0.4];
    var cfg = { holdY: 360, centerX: W / 2, strafe: 260 };
    function pose(col, h) { return { t: 0, fn: function (e) { e.poseT = h || 0.42; muzzle(e, col || MAG); } }; }
    var phases = [
      // I THE HALL OF TWO TRUTHS — drifting rain curtains + LIME shard petals (rain;
      // the green counterpoint, held to her opening rite per ART.md).
      { name: 'THE HALL OF TWO TRUTHS', hp: 0.14, timeout: 30, path: bp_holdCenter, loop: 3.0, script: [
        pose(MAG),
        { t: 0.4, fn: function (e) { e.s0 += 0.6; P.rain(32, { speed: rankSpd(P.SPD.slow), waves: 3, phase: e.s0, gapThresh: 0.05, fam: P.FAM.PELLET, tier: 'S', color: ROSE }); } },
        { t: 1.1, fn: function (e) { e.s0 += 0.6; P.rain(32, { speed: rankSpd(P.SPD.slow), waves: 3, phase: e.s0, gapThresh: 0.05, fam: P.FAM.PELLET, tier: 'S', color: ROSE }); } },
        { t: 1.9, fn: function (e) { e.poseT = 0.4; muzzle(e, LIME); } },
        { t: 2.3, fn: function (e) { e.s1 += 0.5; P.ring(e.x, e.y, 20, rankSpd(P.SPD.slow), { fam: P.FAM.SHARD, tier: 'M', color: LIME, offset: e.s1, accel: -150, accel2: 130, accelSwitchT: 0.8, minSpeed: 8 }); } }
      ] },
      // II THE FORTY-TWO CONFESSIONS — judgment rings of LITERALLY 42 bullets each,
      // counter-rotating at stepped speeds so their interleave drifts the safe gaps.
      { name: 'THE FORTY-TWO CONFESSIONS', hp: 0.15, timeout: 32, path: bp_holdCenter, loop: 2.6, script: [
        pose(MAG),
        { t: 0.5, fn: function (e) { e.s0 += 0.14; P.ring(e.x, e.y, 42, rankSpd(P.SPD.slow), { fam: P.FAM.ORB, tier: 'M', color: MAG, offset: e.s0 }); } },
        { t: 1.5, fn: function (e) { e.poseT = 0.4; muzzle(e, ROSE); } },
        { t: 1.9, fn: function (e) { e.s0 += 0.14; P.ring(e.x, e.y, 42, rankSpd(P.SPD.slow) + 52, { fam: P.FAM.RING, tier: 'M', color: ROSE, offset: -e.s0 }); } }
      ] },
      // III THE FEATHER AND THE HEART — the scales: a LIGHT/FAST feather wall on one
      // side vs a HEAVY/SLOW heart wall on the other, alternating sides each rep.
      { name: 'THE FEATHER AND THE HEART', hp: 0.16, timeout: 32, path: bp_pendulum, loop: 2.6, script: [
        pose(MAG),
        { t: 0.4, fn: function (e) { e.s1++; var lft = e.s1 % 2; P.arcWall(e.x, e.y, DOWN, 1.5, 16, rankSpd(P.SPD.fast), { laneAt: lft ? -0.3 : 0.3, laneWidth: 4.6, fam: P.FAM.KUNAI, tier: 'S', color: PALE }); } },   // the feather
        { t: 1.1, fn: function (e) { e.poseT = 0.4; muzzle(e, ROSE); } },
        { t: 1.5, fn: function (e) { var lft = e.s1 % 2; P.arcWall(e.x, e.y, DOWN, 1.7, 26, rankSpd(P.SPD.slow), { laneAt: lft ? 0.3 : -0.3, laneWidth: 5.4, fam: P.FAM.ORB, tier: 'L', color: MAG }); } }   // the heart
      ] },
      // IV THE SCALES TIP — the balance breaks: the heart side crushes DOWN heavier
      // each rep (escalating count), the feather stays light; an aimed accent threads.
      { name: 'THE SCALES TIP', hp: 0.17, timeout: 34, path: bp_pendulum, loop: 2.8, script: [
        pose(MAG, 0.4),
        { t: 0.4, fn: function (e) { e.s2++; var heavy = Math.min(36, 22 + e.s2 * 2); P.arcWall(e.x, e.y, DOWN, 1.8, heavy, rankSpd(P.SPD.slow), { laneAt: 0.32, laneWidth: 5.2, fam: P.FAM.ORB, tier: 'L', color: MAG }); } },
        { t: 1.0, fn: function (e) { P.arcWall(e.x, e.y, DOWN, 1.3, 12, rankSpd(P.SPD.fast), { laneAt: -0.3, laneWidth: 4.4, fam: P.FAM.KUNAI, tier: 'S', color: PALE }); } },
        { t: 1.7, fn: function (e) { e.poseT = 0.32; muzzle(e, ACC); } },
        { t: 2.0, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 5, { spread: 0.22, speed: rankSpd(P.SPD.whip), color: ACC }); } }
      ] },
      // V THE VERDICT — heart-seeker aimed accents threading a pulse orb terrain (LAYER).
      { name: 'THE VERDICT', hp: 0.18, timeout: 34, path: bp_holdCenter, loop: 2.6, script: [
        pose(MAG),
        { t: 0.3, fn: function (e) { e.s0 += 0.35; P.pulse(e.x, e.y, { rings: 3, count: 22, speed: rankSpd(P.SPD.slow), speedStep: 55, offset: e.s0, colorA: MAG, colorB: ROSE }); } },
        { t: 1.0, fn: function (e) { e.s0 += 0.35; P.pulse(e.x, e.y, { rings: 2, count: 18, speed: rankSpd(P.SPD.slow), speedStep: 60, offset: -e.s0, colorA: ROSE, colorB: MAG }); } },
        { t: 1.6, fn: function (e) { e.poseT = 0.34; muzzle(e, ACC); } },
        { t: 1.95, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 6, { spread: 0.2, speed: rankSpd(P.SPD.whip), color: ACC }); } }
      ] },
      // VI THE DEVOURING — the jaws crossfire close like bites, one drifting lane
      // through them, boss lunging between (final; everything at once).
      { name: 'THE DEVOURING', hp: 0.20, timeout: 40, path: bp_lunge, loop: 2.8, script: [
        pose(MAG, 0.36),
        { t: 0.35, fn: function (e) { e.s1++; P.crossfire(200, W - 200, cfg.holdY - 40, 12, rankSpd(P.SPD.mid), { angle: (e.s1 % 2 ? 0.5 : 0.34), spacing: 32, fam: P.FAM.KUNAI, tier: 'M', color: MAG }); } },
        { t: 1.0, fn: function (e) { e.s0 += 0.5; P.ringGap(e.x, e.y, 40, rankSpd(P.SPD.slow), { gaps: 1, gapWidth: 6.0, offset: e.s0, fam: P.FAM.ORB, tier: 'L', color: ROSE }); } },   // the one drifting lane
        { t: 1.5, fn: function (e) { P.crossfire(200, W - 200, cfg.holdY - 40, 12, rankSpd(P.SPD.mid), { angle: (e.s1 % 2 ? 0.34 : 0.5), spacing: 32, fam: P.FAM.KUNAI, tier: 'M', color: ROSE }); } },
        { t: 2.1, fn: function (e) { e.poseT = 0.32; muzzle(e, ACC); } },
        { t: 2.4, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 6, { spread: 0.26, speed: rankSpd(P.SPD.whip), color: ACC }); } }
      ] }
    ];
    startBoss(e, phases, cfg);
    e.onDeath = function () { Run.onWardenKilled(); G.boss = null; bigDeath(e, 90); announce('AMMIT DEVOURED', 'the scales balance', 2.2); };
  }
  // Sector-3 anchor: MIDAS, the gilded king — the run's finale, 6 phases telling
  // his fall (the golden touch → tribute → the gilded court → the feast that turns
  // to ash → drowned in his own gold → the beggar king's last stand). The internal
  // function + Game.bosses key stay legacy-named ('sovereign' / spawnBoss) so old
  // wiring survives; everything player-facing says MIDAS. Enemy fire stays warm —
  // hot amber/rose, NOT loot-gold (a threat must never read as pickup gold, ART.md).
  // Two fight-long mechanics ride on e.isMidas: GOLD THEFT (updateGold vacuums loot
  // into his hoard, spilled as a jackpot on death) and CURSED GOLD (converting his
  // fire — apotheosis + phase cancels — spawns gilding coins).
  function spawnBoss(rank) {
    var e = newEnemy(6, W / 2, -260, 23000 * rank, GL.SPR.SHIP_BOSS, 300, 130, [1, 0.5, 0.28], 90, 200000, true); if (!e) return;
    e.name = 'MIDAS';
    e.isMidas = true; e.hoard = 0; e.hoardBank = 0; e.hoardCount = 0;
    announce('MIDAS', 'the gilded king', 3.0);
    var AMB = [1.0, 0.58, 0.2], ROSE = [1.0, 0.32, 0.55], MAG = P.MAGENTA, ACC = [1.0, 0.86, 0.4];
    var cfg = { holdY: 420, centerX: W / 2, strafe: 260 };
    function pose(col, h) { return { t: 0, fn: function (e) { e.poseT = h || 0.44; muzzle(e, col || AMB); } }; }
    var phases = [
      // I THE GOLDEN TOUCH — the lattice forms; his bullets leave brief gilded trails
      // (gild:true — updateBullets streaks a fading gold mote behind each).
      { name: 'THE GOLDEN TOUCH', hp: 0.14, timeout: 32, path: bp_holdCenter, loop: 2.8, script: [
        pose(AMB),
        { t: 0.4, fn: function (e) { e.s0 += 0.4; P.ringGap(e.x, e.y, 34, rankSpd(P.SPD.slow), { gaps: 2, gapWidth: 4.2, offset: e.s0, fam: P.FAM.ORB, tier: 'M', color: AMB, gild: true }); } },
        { t: 1.0, fn: function (e) { e.s0 += 0.4; P.ringGap(e.x, e.y, 34, rankSpd(P.SPD.slow), { gaps: 2, gapWidth: 4.2, offset: e.s0 + 0.2, fam: P.FAM.RING, tier: 'M', color: ROSE, gild: true }); } },
        { t: 1.7, fn: function (e) { e.s0 += 0.4; P.ringGap(e.x, e.y, 34, rankSpd(P.SPD.mid), { gaps: 2, gapWidth: 4.2, offset: e.s0 + 0.4, fam: P.FAM.ORB, tier: 'S', color: AMB, gild: true }); } }
      ] },
      // II THE TRIBUTE — rising walls (edict arcWalls) + gold rain, two speeds.
      { name: 'THE TRIBUTE', hp: 0.15, timeout: 32, path: bp_pendulum, loop: 2.6, script: [
        pose(AMB),
        { t: 0.4, fn: function (e) { e.s1++; P.arcWall(e.x, e.y, DOWN, 1.8, 26, rankSpd(P.SPD.slow), { laneAt: (e.s1 % 2 ? -0.26 : 0.26), laneWidth: 5.2, fam: P.FAM.PELLET, tier: 'M', color: AMB }); } },
        { t: 1.0, fn: function (e) { e.s0 += 0.7; P.rain(36, { speed: rankSpd(P.SPD.mid), waves: 4, phase: -e.s0, gapThresh: 0.02, fam: P.FAM.PELLET, tier: 'S', color: ROSE }); } }
      ] },
      // III THE GILDED COURT — the full lattice with a rotating wheel + aimed accent (LAYER).
      { name: 'THE GILDED COURT', hp: 0.16, timeout: 34, path: bp_orbit, loop: 2.4, script: [
        pose(AMB),
        { t: 0.35, fn: function (e) { e.s0 += 0.5; P.wheel(e.x, e.y, e.s0, 26, rankSpd(P.SPD.slow), { gapEvery: 6, fam: P.FAM.ORB, tier: 'M', color: AMB }); } },
        { t: 0.9, fn: function (e) { e.s0 += 0.3; P.ringGap(e.x, e.y, 34, rankSpd(P.SPD.slow) + 46, { gaps: 2, gapWidth: 4.4, offset: e.s0, fam: P.FAM.RING, tier: 'M', color: ROSE }); } },
        { t: 1.6, fn: function (e) { e.poseT = 0.34; muzzle(e, ACC); } },
        { t: 1.95, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 6, { spread: 0.2, speed: rankSpd(P.SPD.whip), color: ACC }); } }
      ] },
      // IV THE FEAST OF ASH — hungry desperation: faster, snatching aimed patterns,
      // lunging between casts (bp_lunge; two aimed-adjacent accents at speed).
      { name: 'THE FEAST OF ASH', hp: 0.17, timeout: 34, path: bp_lunge, loop: 2.6, script: [
        pose(ROSE, 0.36),
        { t: 0.35, fn: function (e) { e.s0 += 0.5; P.ringGap(e.x, e.y, 30, rankSpd(P.SPD.mid), { gaps: 2, gapWidth: 3.8, offset: e.s0, fam: P.FAM.ORB, tier: 'M', color: AMB }); } },
        { t: 1.0, fn: function (e) { e.poseT = 0.28; muzzle(e, ACC); } },
        { t: 1.25, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 5, { spread: 0.24, speed: rankSpd(P.SPD.whip), color: ACC }); } },
        { t: 1.9, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 5, { spread: 0.5, speed: rankSpd(P.SPD.fast), color: ROSE }); } }
      ] },
      // V DROWNED IN GOLD — the density crescendo: two-speed snake + full lattice +
      // rain, the wealth itself the threat (the densest screen in the game).
      { name: 'DROWNED IN GOLD', hp: 0.18, timeout: 38, path: bp_rails, loop: 3.0, script: [
        pose(AMB, 0.34),
        { t: 0.3, fn: function (e) { e.s2++; P.snake(e.x, e.y, DOWN - 0.35, 18, rankSpd(P.SPD.mid), { amp: 44, freq: 0.8, phase: e.s2 * 0.5, fam: P.FAM.SHARD, tier: 'M', color: AMB }); } },
        { t: 0.6, fn: function (e) { P.snake(e.x, e.y, DOWN + 0.35, 18, rankSpd(P.SPD.mid), { amp: 44, freq: 0.8, phase: e.s2 * 0.5 + 1.6, fam: P.FAM.SHARD, tier: 'M', color: ROSE }); } },
        { t: 1.1, fn: function (e) { e.s0 += 0.45; P.ringGap(e.x, e.y, 52, rankSpd(P.SPD.slow), { gaps: 2, gapWidth: 6.6, offset: e.s0, fam: P.FAM.ORB, tier: 'L', color: MAG });
          P.ringGap(e.x, e.y, 52, rankSpd(P.SPD.slow) + 58, { gaps: 2, gapWidth: 6.6, offset: e.s0 + 0.09, fam: P.FAM.PELLET, tier: 'S', color: AMB }); } },   // anchor orbs + full-lattice pellet filler
        { t: 1.7, fn: function (e) { e.s0 += 0.4; P.rain(30, { speed: rankSpd(P.SPD.slow), waves: 4, phase: e.s0, gapThresh: 0.04, fam: P.FAM.PELLET, tier: 'S', color: ROSE }); } },
        { t: 2.2, fn: function (e) { e.poseT = 0.3; muzzle(e, ACC); } },
        { t: 2.5, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 8, { spread: 0.3, speed: rankSpd(P.SPD.whip), color: ACC }); } }
      ] },
      // VI THE BEGGAR KING — stripped raw: fastest, sparsest-but-meanest, his final
      // stand (few bullets, whip speed, precise aimed threading — no walls to hide behind).
      { name: 'THE BEGGAR KING', hp: 0.20, timeout: 42, path: bp_rails, loop: 2.4, script: [
        pose(MAG, 0.3),
        { t: 0.3, fn: function (e) { e.s0 += 0.6; P.ringGap(e.x, e.y, 20, rankSpd(P.SPD.fast), { gaps: 1, gapWidth: 3.0, offset: e.s0, fam: P.FAM.ORB, tier: 'M', color: MAG }); } },
        { t: 0.9, fn: function (e) { e.poseT = 0.26; muzzle(e, ACC); } },
        { t: 1.15, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 3, { spread: 0.12, speed: rankSpd(P.SPD.whip) + 60, color: ACC }); } },
        { t: 1.7, fn: function (e) { P.burstAimed(e.x, e.y, AIMX(e), AIMY(e), 3, { spread: 0.12, speed: rankSpd(P.SPD.whip) + 60, color: ROSE }); } }
      ] }
    ];
    startBoss(e, phases, cfg);
    e.onDeath = function () {
      var hv = e.hoard, hb = e.hoardBank || 0; G._lastHoard = hv;   // capture before we drop the ref (test surface)
      G.boss = null;
      // GOLD THEFT payoff: the hoard ERUPTS back onto the field — a jackpot vacuum
      // reversal, the FULL stolen value spread wide for a satisfying re-collect.
      // The old flat +90 celebration coins (~1.4 each) fold into this same budget.
      // Distribute the TOTAL across a coin count capped under the pool's headroom
      // (never above freeTop) with per-coin = total/N and the remainder on the last
      // coin — so spawnGold can never return null mid-spill and silently short the
      // payout. Banked premium (wallet units) rides its own per-coin share.
      var total = hv + 126;                                   // 126 ≈ the old 90 × 1.4 bonus
      var N = Math.min(150, Engine.gold.freeTop, Math.max(24, Math.round(total * 4)));
      if (N > 0) {
        var perV = total / N, perB = Math.floor(hb / N);
        for (var j = 0; j < N; j++) {
          var last = (j === N - 1);
          spawnGold(e.x, e.y, 1, last ? (total - perV * (N - 1)) : perV, last ? (hb - perB * (N - 1)) : perB, 5.5);
        }
        if (hv > 0) addPopup(W / 2, H * 0.34, 'THE HOARD SPILLS', UI_GOLD, 40);
      }
      bigDeath(e, 160);
      announce('MIDAS UNMADE', 'the gold runs out', 3.4);
      var _clearGain = addScore(500000 * G.mult);
      addPopup(W / 2, H * 0.4, 'CLEAR BONUS  +' + commas(_clearGain), UI_GOLD, 48);   // post-HUBRIS (fix #3)
    };
  }
  function bigDeath(e, goldN) {
    spawnGold(e.x, e.y, goldN, 1.2);
    for (var i = 0; i < 6; i++) ringShock(e.x, e.y, [1, 0.7, 0.3], 60 + i * 50, 2600, 0.9);
    spark(e.x, e.y, [1, 0.85, 0.4], 80, 640, 60);
    flash(e.x, e.y, [1, 0.9, 0.6], 500, 0.6);
    SFX.explosion(true); addShake(JUICE.shakeLong); hitstop(JUICE.hsBoss); homeAllGold();
  }

  function updateEnemies(dt) {
    Engine.enemies.forEach(function (e) {
      if (e.hitFlash > 0) e.hitFlash -= dt;
      updateStatus(e, dt);
      if (e.dying) return;
      if (e.charmed) { updateCharmed(e, dt); return; }
      // strip prior displacement so scripted movement runs from a clean base
      e.x -= e.dispX; e.y -= e.dispY;
      var terrified = e.terrorT > 0 && !e.boss;
      if (!terrified && e.stunT <= 0) {                 // Stun / Terror: no move / fire
        Patterns.setSource(e);
        var fr = e.aura === 'frenzied' ? 1.3 : 1;       // FRENZIED aura
        if (e.onUpdate) e.onUpdate(e, dt * fr);
        Patterns.clearSource();
        if (e.boss && e.confuseT > 0) confuseBossSelfHarm(e); // Loki: flipped bullets self-harm
      }
      if (terrified) {                                  // continued flee acceleration
        var fx = e.x - G.player.x, fy = e.y - G.player.y, fd = Math.hypot(fx, fy) || 1;
        e.dispVX += (fx / fd) * 260 * dt; e.dispVY += (fy / fd) * 260 * dt;
      }
      integrateDisp(e, dt);
      if (!e.dying) { e.x += e.dispX; e.y += e.dispY; }
    });
  }
  function confuseBossSelfHarm(e) {
    var n = Patterns.consumeBossFlip();
    if (n <= 0) return;
    var dmg = Math.min(n * e.maxhp * 0.001, e.confuseBudget);
    if (dmg <= 0) return;
    e.confuseBudget -= dmg;
    damageEnemy(e, dmg, false);
    spark(e.x, e.y, [0.55, 1, 0.35], 3, 200, 20);
  }

  // central damage: applies Marked / Weak / crit, popups, kill.
  // Boss spellcard rule (DANMAKU.md "each spellcard gets its stage time"):
  // while a boss is on a NON-final phase its hp cannot fall below the current
  // segment floor — overkill past the floor is discarded, so one big hit
  // advances at most one phase (via the e.hp <= segFloorHp trigger in bossTick)
  // instead of skipping the setlist or one-shotting the fight. During a
  // transition breath the floor rises to breathFloor (the hp at breath start),
  // so the breath is a payday, not a dps window. On the final phase segFloorHp
  // is 0 (segBounds bottoms out at 1), so the boss dies normally. Every path
  // that reduces boss hp routes through here (damageEnemy) or the burn tick,
  // which both call this immediately after the subtraction.
  function clampBossHp(e) {
    if (!e.boss || !e.arrived) return;
    var floor = e.segFloorHp;
    if (e.breathT > 0 && e.breathFloor > floor) floor = e.breathFloor;
    if (e.hp < floor) e.hp = floor;
  }
  function damageEnemy(e, dmg, isCrit) {
    if (e.dying) return;
    var m = 1;
    if (e.marked) m *= (G.mods.odinMark ? 1.4 : 1.25) + (G.mods.heimVigil ? 0.20 : 0) + G.charmMark; // Mark (+heimVigil, +WATCHMAN'S EYE)
    if (e.weak) m *= 1.10;
    if (e.terrorT > 0) m *= 1.20;                 // Ares Terror
    if (e.shakenT > 0) m *= 1.10;                 // Ares Shaken (boss)
    if (e.stunT > 0 && G.mods.jadeStun) m *= 1.25; // Jade: Stunned foes take +25%
    if ((e.boss || e.elite) && G.charmElite > 1) m *= G.charmElite; // EAGLE FEATHER charm
    dmg *= m;
    if (isCrit) dmg *= (G.mods.artemisMulti ? 4 : 3);
    if (G.communion === 'KEMET' && hasStatus(e)) dmg *= 1.1;   // Rite of Two Suns
    e.hp -= dmg;
    clampBossHp(e);                         // spellcard floor: discard overkill on non-final phases / during breath
    e.hitFlash = isCrit ? 0.14 : 0.08;
    if (isCrit) { addPopup(e.x, e.y - 30, commas(Math.round(dmg)) + '!', UI_GOLD, 30); SFX.crit(); spark(e.x, e.y, [0.8, 1, 0.4], 5, 320, 22); }
    else if (Math.random() < 0.2) SFX.hit();
    if (e.hp <= 0) { killEnemy(e, true); return; }
    // DEATH SENTENCE duo: crits execute non-boss foes below 40%
    if (isCrit && G.duos.deathSentence && !e.boss && e.hp < 0.40 * e.maxhp) { executeEnemy(e); return; }
  }

  function killEnemy(e, reward) {
    if (e.dying) return;
    e.dying = true;
    // formation accounting: a rewarded kill credits the squadron (once, deduped);
    // a reward=false release (path exit / despawn) marks it escaped (no wipe) —
    // unless the member was already credited (e.g. charmed, then flew off).
    if (reward) creditForm(e);
    else if (e.formId && !e.formCounted) { var _ff = findForm(e.formId); if (_ff) _ff.exited = true; }
    if (reward) {
      // point-blank kill (flying closer than you need to) feeds the HUBRIS meter —
      // only off a LIVE player position (a burn/hazard kill while dead sits on a
      // stale death spot, which would grant a bogus point-blank; fix #4).
      if (G.player.alive) {
        var _pdx = e.x - G.player.x, _pdy = e.y - G.player.y;
        if (_pdx * _pdx + _pdy * _pdy <= HUBRIS_PB_R * HUBRIS_PB_R) addHubris(HUBRIS_PB);
      }
      var _gain = addScore(e.score * G.mult);
      addCharge(SP_KILL);
      var gN = e.gold * (e.elite ? G.aff.eliteGoldMul : 1) * killGoldMul * ((G.mods.jadeTribute && e.weak) ? 1.3 : 1);
      spawnGold(e.x, e.y, Math.round(gN), 1);
      if (G.duos.peachBanquet && G.verdictPeachT > 0) addGauge(4);      // PEACH BANQUET: kills within 3s of a Verdict drop peaches
      if (G.attackGod === 'wukong' && Math.random() < (G.mods.wukongChance ? 0.35 : 0.20)) spawnClone();  // Body Beyond Body
      if (G.mods.raSpread && e.burnT > 0) spreadBurn(e);
      if (G.attackGod === 'ares') addFrenzy();                              // Bloodlust
      if (G.mods.artemisSpread && e.marked) spreadMark(e);
      if (G.mods.zeusField) spawnZapField(e.x, e.y);
      ringShock(e.x, e.y, [1, 0.7, 0.4], 30, e.boss ? 2600 : 1400, 0.5);
      spark(e.x, e.y, [1, 0.7, 0.35], e.boss ? 40 : 14, 420, 32);
      flash(e.x, e.y, [1, 0.85, 0.5], e.boss ? 220 : 70, 0.22);
      // Kill-feedback tiers (JUICE): popcorn = light tick + scale-pop, no freeze
      // (it's cadence); midship/elite = deep boom + small shake + micro-hitstop;
      // boss = existing boom here, with the long shake + hsBoss added in bigDeath.
      if (e.boss) {
        SFX.explosion(true); addShake(JUICE.shakeSmall);
      } else if (e.elite || e.arch === 'midship') {
        SFX.boom(); addShake(JUICE.shakeSmall); hitstop(JUICE.hsMid);
      } else {
        SFX.pop(); popEnemy(e);
      }
      addPopup(e.x, e.y, '+' + commas(_gain), UI_GOLD, e.boss ? 40 : 24);   // show the post-HUBRIS grant (fix #3)
      if (G.aff.volatile) Patterns.aimedFan(e.x, e.y, AIMX(e), AIMY(e), 3, 0.5, 300 * G.rank, { color: Patterns.LIME, radius: 11 });
      if (G.vaunt.active) {
        G.vaunt.killCount++;
        G.mult = Math.min(effMultCap(), G.mult + 0.25);
        G.vaunt.timer = Math.min(G.vaunt.duration, G.vaunt.timer + G.vaunt.duration * 0.02);
      }
      // interruption reward: a midship's death cancels its OWN remaining pattern
      // to gold (bullets from other emitters keep flying — no free screen-clear).
      if (e.arch === 'midship') cancelOwnerBullets(e.seq, e.x, e.y);
    }
    if (e.onDeath) e.onDeath(e);
    Engine.enemies.release(e);
  }

  // ---------------------------------------------------------------------
  // bullets / collisions
  // ---------------------------------------------------------------------
  function updateBullets(dt) {
    var px = G.player.x, py = G.player.y, alive = G.player.alive;
    var shielded = G.vaunt.active || G.player.invuln > 0 || G.vaunt.mercy > 0;
    var hbR = PLAYER_R * G.up.hitboxMul;
    var dec = G.decoy;
    var flipDmg = 2.0 * G.attackR * G.stats.atkDmg;
    Engine.bullets.forEach(function (b) {
      Engine.updateBullet(b, dt);
      if (b.x < -90 || b.x > W + 90 || b.y < -90 || b.y > H + 120 || b.life <= 0) { Engine.bullets.release(b); return; }
      // TALOS HURLED STONES: an XL boulder bursts into pellet shrapnel at its depth
      // line (the shrapnel inherits the boulder's warm tint). Released after bursting.
      if (b.burstY && b.y >= b.burstY) {
        Patterns.ring(b.x, b.y, 10, 210, { fam: Patterns.FAM.PELLET, tier: 'S', color: [b.r, b.g, b.b] });
        flash(b.x, b.y, [1, 0.7, 0.3], 46, 0.2); spark(b.x, b.y, [b.r, b.g, b.b], 8, 260, 22);
        Engine.bullets.release(b); return;
      }
      // MIDAS THE GOLDEN TOUCH: gilded trail — a sparse fading gold mote behind the
      // bullet (staggered by slot + time so the particle pool never floods).
      if (b.gild && ((((G.time * 60) | 0) + b._i) & 3) === 0) flash(b.x, b.y, [1, 0.8, 0.34], 15, 0.14);
      // Loki flipped (friendly) bullets: hit enemies, ignore the player. During a
      // TALOS nail phase they may only damage the nail (the body is immune).
      if (b.friendly) {
        var hitF = false;
        Engine.enemies.forEach(function (e) {
          if (hitF || e.dying || e.charmed || e._i === b.srcId) return;
          var tx = e.nailActive ? e.nailX : e.x, ty = e.nailActive ? e.nailY : e.y, tr = e.nailActive ? e.nailR : e.radius;
          if (Engine.hit(b.x, b.y, b.radius, tx, ty, tr)) { damageEnemy(e, flipDmg, false); if (G.mods.lokiVaunt) addGauge(0.6); spark(b.x, b.y, [0.5, 1, 0.35], 3, 180, 16); hitF = true; }
        });
        if (hitF) Engine.bullets.release(b);
        return;
      }
      // Loki decoy soaks bullets — its defined value vs bosses: park the twin
      // in a pattern stream and it visibly thins it (radius sized for that)
      if (dec.active) {
        var ddx = b.x - dec.x, ddy = b.y - dec.y;
        if (ddx * ddx + ddy * ddy < 84 * 84) { spark(b.x, b.y, [0.4, 1, 0.5], 1, 120, 12); Engine.bullets.release(b); dec.absorb++; if (dec.absorb >= 80) expireDecoy(); return; }
      }
      if (!alive) return;
      var dx = b.x - px, dy = b.y - py, d2 = dx * dx + dy * dy;
      var hitR = b.radius + hbR;
      if (d2 <= hitR * hitR) { if (!shielded) playerHit(); return; }
      var gr = b.radius + GRAZE_R;
      if (!b.grazed && d2 <= gr * gr) {
        b.grazed = true; G.graze++;
        addHubris(HUBRIS_GRAZE);                    // graze feeds the HUBRIS meter (b.grazed prevents double-count)
        addGauge(GRAZE_GAUGE * (1 + G.hermes.graze));
        addScore(GRAZE_SCORE * G.mult);
        if (G.communion === 'CELESTIAL COURT') addCharge(0.01);   // Harmony of Heaven: grazes feed special charge
        spark(px + dx * 0.4, py + dy * 0.4, [0.6, 0.95, 1], 3, 220, 18);
        SFX.graze();
      }
    });
  }
  function hitEnemy(s, e) {
    var dmg = s.damage;
    // AEGIS / BULWARK front shield: blocks 80% of upward player/special fire unless spun open
    if ((e.arch === 'aegis' || e.aura === 'bulwark') && e.shieldT <= 0 && (s.faction === 0 || s.faction === 1) && s.vy < 0) {
      dmg *= 0.2; spark(s.x, s.y, [0.5, 0.85, 1.0], 2, 200, 16);
    }
    var isCrit = false;
    if (s.faction === 0 && G.attackGod === 'artemis' && Math.random() < artemisCritChance()) isCrit = true;
    if (s.faction === 0 && !isCrit && G.critBonus > 0 && Math.random() < G.critBonus) isCrit = true; // SILVER FLETCHING charm
    if (s.forceCrit) isCrit = true;
    if (G.duos.huntersEye && s.faction === 0 && e.marked) isCrit = true;   // HUNTER'S EYE: marked always crit
    if (s.crescent && G.duos.godsOfWar && e.terrorT > 0) isCrit = true;    // GODS OF WAR: crescents crit the Terrified
    // Anubis — Weigher of Hearts: +25% to any foe below half health
    // (anubisBossDmg amps the below-half bonus to +40% vs bosses)
    if (s.faction === 0 && G.attackGod === 'anubis' && e.hp < 0.5 * e.maxhp) dmg *= (e.boss && G.mods.anubisBossDmg ? 1.4 : 1.25);
    // Aphrodite: +15% to the charm-touched and the Weakened
    if (s.faction === 0 && G.attackGod === 'aphrodite' && (e.weak || e.charmMeter > 0)) dmg *= 1.15;
    // Loki: the Confused take +15% from you
    if (s.faction === 0 && G.attackGod === 'loki' && e.confuseT > 0) dmg *= 1.15;
    if (s.kind === 5) { // charm missile
      if (e.boss) { e.weak = true; e.weakT = 6; damageEnemy(e, dmg, false); }
      else { charmEnemy(e); flash(e.x, e.y, [1, 0.5, 0.85], 60, 0.2); }
      return;
    }
    if (s.kind === 7) { // Jade imperial edict — Stun the condemned
      damageEnemy(e, dmg, isCrit);
      if (!e.boss && !e.dying) { e.stunT = Math.max(e.stunT, 0.9); flash(e.x, e.y, [0.8, 0.6, 1], 70, 0.2); }
      return;
    }
    if (s.kind === 8) { // Heaven's Verdict edict — Stun 1.0s; bosses take +50% instead
      damageEnemy(e, dmg * (e.boss ? 1.5 : 1), isCrit);
      if (!e.boss && !e.dying) { e.stunT = Math.max(e.stunT, 1.0); flash(e.x, e.y, [0.8, 0.6, 1], 80, 0.2); }
      if (G.duos.twoThrones && !e.dying) chainLightning(e, dmg * 0.4, false);   // TWO THRONES: Verdict cracks chains
      return;
    }
    if (s.markHit) { e.marked = true; e.markT = 6; }
    var wasTerror = e.terrorT > 0;
    damageEnemy(e, dmg, isCrit);
    if (s.crescent) {
      s.damage *= 1.18;                                                   // crescent gains power per foe cleaved
      if (G.duos.saintOfWar && !e.dying) { e.weak = true; e.weakT = 4; }  // SAINT OF WAR: cleaves Weaken
      if (G.duos.godsOfWar && e.dying && wasTerror) addFrenzy();          // GODS OF WAR: terrified crescent-kills feed frenzy
    }
    if (isCrit && s.faction === 0 && G.mods.artemisRefund) addCharge(0.1);
    if (s.cloneShot && G.duos.havocInHeaven && !e.dying) chainLightning(e, dmg * 0.5, false); // HAVOC IN HEAVEN (no re-chain)
    if (s.faction === 0) applyAttackGod(e, s, dmg);
    else if (s.kind === 3) chainLightning(e, dmg * 0.5, true); // storm lance chains
  }
  function artemisCritChance() { return Math.min(0.6, 0.18 + 0.03 * (G.attackR - 1) + G.mods.artemisCrit); }

  function collideShots() {
    Engine.shots.forEach(function (s) {
      var maxHits = s.pierce + 1, hits = 0, done = false;
      Engine.enemies.forEach(function (e) {
        if (done || e.dying || e.charmed) return;
        // TALOS THE NAIL: the body is immune — only the small nail hitbox (his ankle
        // weak point) drains the segment. A body hit still counts against the shot's
        // pierce budget (no free pass-through) but deals 0 damage with dim feedback.
        // This is the ONLY spatial special-case; every non-shot damage source (riders,
        // hazards, chain, burn) routes to the nail pool through damageEnemy = e.hp.
        if (e.nailActive) {
          if (Engine.hit(s.x, s.y, s.radius, e.nailX, e.nailY, e.nailR)) {
            hitEnemy(s, e);
            flash(s.x, s.y, [0.6, 1, 0.55], 26, 0.1);
            hits++; if (hits >= maxHits) done = true;
          } else if (Engine.hit(s.x, s.y, s.radius, e.x, e.y, e.radius)) {
            spark(s.x, s.y, [1, 0.82, 0.4], 1, 120, 10);   // dim clank: it did nothing
            hits++; if (hits >= maxHits) done = true;
          }
          return;
        }
        if (Engine.hit(s.x, s.y, s.radius, e.x, e.y, e.radius)) {
          hitEnemy(s, e);
          flash(s.x, s.y, s.faction === 2 ? [1, 0.5, 0.85] : [0.7, 1, 1], 26, 0.1);
          hits++; if (hits >= maxHits) done = true;
        }
      });
      if (hits >= maxHits) Engine.shots.release(s);
    });
  }
  function collideBodies() {
    if (!G.player.alive) return;
    var px = G.player.x, py = G.player.y;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (Engine.hit(px, py, PLAYER_R * G.up.hitboxMul, e.x, e.y, e.radius * 0.7)) playerHit(); });
  }

  // ---------------------------------------------------------------------
  // wave timers + clear detection
  // ---------------------------------------------------------------------
  var timers = [];
  function setTimerSpawn(delay, fn) { timers.push({ t: delay, fn: fn }); }
  function updateTimers(dt) {
    for (var i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { var f = timers[i].fn; timers.splice(i, 1); f(); } }
  }

  // ---- formation registry (FORMATION WIPE homage) ----------------------
  // Each normal wave is one squadron: every enemy spawned during it is stamped
  // with the wave's formation id (newEnemy) and counted. A wipe = all members
  // killed by the player before ANY exits (killEnemy reward=false = an exit).
  // Cleared per wave; created once per wave, never per frame.
  var forms = [], formSeq = 0, curFormId = 0;
  function resetForms() { forms.length = 0; }
  function beginForm() { var id = ++formSeq; forms.push({ id: id, count: 0, killed: 0, exited: false, done: false }); return id; }
  function findForm(id) { if (!id) return null; for (var i = 0; i < forms.length; i++) if (forms[i].id === id) return forms[i]; return null; }
  // Count a live squadron member as DEFEATED exactly once, no matter how it left
  // the hostile pool — a rewarded kill OR a charm/execute conversion (the player
  // earned it either way). Deduped by e.formCounted so a later expiry/release of
  // a converted ally can't double-credit.
  function creditForm(e) { if (!e.formId || e.formCounted) return; var f = findForm(e.formId); if (f) { f.killed++; e.formCounted = true; } }
  // Run a summon/child spawn OUTSIDE the wave's authored arrangement: the spawned
  // enemy gets formId 0, so a mid-wave summon (fakedecoy, splitter child, carrier
  // escort, apostate clone) neither pads the count nor blocks a WIPE by exiting.
  function spawnLoose(fn) { var prev = curFormId; curFormId = 0; try { return fn(); } finally { curFormId = prev; } }
  // Evaluated once all spawn timers have drained (membership final): a squadron
  // of >=2 with every member player-killed and none escaped earns FORMATION WIPE.
  function checkFormWipe() {
    if (timers.length !== 0) return;              // still spawning — membership not final
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      if (f.done) continue;
      if (f.exited) { f.done = true; continue; }
      if (f.count >= 2 && f.killed >= f.count) { f.done = true; skillEvent(W / 2, H * 0.42, 'FORMATION WIPE', 40); G.tally.wipes++; }
    }
  }

  // role: the slot-arc role known at spawn (opener/build/feature/breather/
  // crescendo) — drives the background choreography and the music stem stack.
  var ROLE_INTENSITY = { opener: 1, build: 1, feature: 3, breather: 0, crescendo: 3, boss: 3 };
  Game.beginWave = function (fn, rank, role) {
    G.rank = rank; G.waveKind = 'normal'; G.waveGrace = 0.6;
    G.waveRole = role || 'build';
    setBgRole(G.waveRole);
    if (window.MUSIC) MUSIC.setIntensity(ROLE_INTENSITY[G.waveRole] != null ? ROLE_INTENSITY[G.waveRole] : 1);
    resetForms(); curFormId = beginForm(); G.waveHits = 0;
    G.skillEvtT = null; G.skillEvtSlot = 0;   // fresh skill-popup stack per wave
    // alternate the crest anchor between successive waves so a sector's waves
    // don't blur together (center → left → right → …).
    G.waveN = (G.waveN || 0) + 1;
    var ai = G.waveN % 3;
    G.anchorX = ai === 0 ? W * 0.5 : ai === 1 ? W * 0.28 : W * 0.72;
    G.anchorSide = ai === 1 ? -1 : ai === 2 ? 1 : 0;
    fn(Run.rng, rank);
    G.mode = 'playing';
  };
  Game.waveAnchor = function () { return { x: G.anchorX, side: G.anchorSide, n: G.waveN }; };
  Game.beginBoss = function (fn, rank) {
    G.rank = rank; G.waveKind = 'boss'; G.waveGrace = 0.6;
    G.waveRole = 'boss';
    setBgRole('boss');                              // dim to near-black; boss shadow precedes
    resetForms(); curFormId = 0; G.waveHits = 0;   // boss/escorts are not a squadron
    G.skillEvtT = null; G.skillEvtSlot = 0;        // fresh skill-popup stack (PHASE SEIZED)
    fn(rank);
    G.mode = 'playing';
  };

  // ---- debug/test surface (Polish round 2 verify) ----------------------
  // Zero runtime cost unless called. Lets the headless harness deterministically
  // exercise each kill tier + the player-hit path and sample the sim clock. Not
  // wired into any gameplay path.
  Game.test = {
    spawnPop: function () { var e = newEnemy(1, W / 2, 300, 999999, GL.SPR.SHIP_POP, 92, 30, POP_COL, 4, 600, false); return e ? e._i : -1; },
    spawnMid: function () { var e = newEnemy(30, W / 2, 300, 999999, GL.SPR.SHIP_MID, 270, 100, MID_COL, 26, 7000, true); if (e) e.arch = 'midship'; return e ? e._i : -1; },
    kill: function (i) { var e = Engine.enemies.items[i]; if (e && e.active && !e.dying) killEnemy(e, true); },
    hurt: function () { G.player.invuln = 0; G.vaunt.active = false; G.vaunt.mercy = 0; playerHit(); },
    hitstopT: function () { return G.hitstopT; },
    freeze: function (v) { G.hitstopT = (v == null) ? 1e9 : v; },   // headless: halt the sim for identical-state screenshots
    apotheosis: function () { G.vaunt.gauge = GAUGE_MAX; tryVaunt(); },   // headless: force the APOTHEOSIS cancel path
    setPost: function (bloom, chroma) { if (bloom != null) { G.bloom = G.bloomTarget = bloom; } if (chroma != null) { G.chroma = G.chromaTarget = chroma; } },  // headless: preview at combat bloom
    setMode: function (m) { G.mode = m; },   // headless: force render mode
    simTime: function () { return G.time; },
    shakeMag: function () { return G.shakeMag; },
    // ---- boss-concept rework verify surface (zero cost unless called) ----
    bossName: function () { return G.boss ? G.boss.name : ''; },
    bossPhase: function () { return G.boss ? G.boss.phase : -1; },
    bossHp: function () { return G.boss ? G.boss.hp : 0; },
    bossMaxHp: function () { return G.boss ? G.boss.maxhp : 0; },
    bossArrived: function () { return !!(G.boss && G.boss.arrived); },
    bossBreath: function () { return G.boss ? G.boss.breathT : 0; },
    nailActive: function () { return !!(G.boss && G.boss.nailActive); },
    nailPos: function () { return G.boss ? { x: G.boss.nailX, y: G.boss.nailY, r: G.boss.nailR } : null; },
    hoard: function () { return G.boss ? G.boss.hoard : (G._lastHoard || 0); },
    hoardCount: function () { return G.boss ? G.boss.hoardCount : 0; },
    freezeT: function () { return G.freeze.t; },
    graceT: function () { return G.freeze.graceT; },
    fieldGoldValue: function () { var s = 0; Engine.gold.forEach(function (g) { s += g.value * (g.cursed ? 2 : 1); }); return s; },
    fieldGoldCount: function () { return Engine.gold.count(); },
    cursedCount: function () { var n = 0; Engine.gold.forEach(function (g) { if (g.cursed) n++; }); return n; },
    spawnFieldGold: function (x, y, val, cursed, bank) { spawnGold(x, y, 1, val == null ? 1 : val, bank || 0, 30, cursed); },
    bulletCount: function () { return Engine.bullets.count(); },
    // drop one player-faction shot at (x,y) heading up — lets the harness fire at
    // the nail vs the body and confirm the routing (body=0, nail drains) via collideShots.
    testShot: function (x, y, dmg) {
      var s = Engine.shots.alloc(); if (!s) return;
      s.x = x; s.y = y; s.vx = 0; s.vy = -1200; s.radius = 12; s.damage = dmg || 1000; s.faction = 0;
      s.pierce = 0; s.kind = 0; s.crescent = false; s.cloneShot = false; s.markHit = false; s.forceCrit = 0; s.homing = false; s.big = false; s.age = 0; s.life = 2.5;
    },
    // hurry the boss to its next phase (sets hp to the segment floor = a damage-beat).
    advancePhase: function () { var b = G.boss; if (b && b.arrived && b.breathT <= 0) { b.hp = b.segFloorHp; b.phaseT = 9999; } },
    // ---- boss-FIX verify surface (freeze / theft / nail / jackpot / HUD) -----
    // Drive fixed combat steps DIRECTLY (bypasses the RAF wrapper's pause/hitstop
    // gating) then flush input edges like a real frame. Deterministic for headless.
    step: function (n) { n = n || 1; for (var i = 0; i < n; i++) { Engine.time += Engine.DT; updateCombat(Engine.DT); } Engine.flushEdges(); },
    spawnMidas: function () { Game.beginBoss(Game.bosses.sovereign, 1); return G.boss ? G.boss._i : -1; },
    spawnTalos: function () { Game.beginBoss(Game.bosses.warden, 1); return G.boss ? G.boss._i : -1; },
    arriveBoss: function (y) { var b = G.boss; if (b) { b.arrived = true; b.breathT = 0; if (y != null) b.y = y; } },
    armNail: function () { var b = G.boss; if (b) { b.nailActive = true; b.nailR = 30; b.nailX = b.x; b.nailY = b.y + b.scale * 0.44; } },
    fireEdict: function () { fireEdict(); },
    setPlayer: function (x, y) { G.player.x = x; G.player.y = y; },
    playerPos: function () { return { x: G.player.x, y: G.player.y }; },
    invuln: function () { return G.player.invuln; },
    setCharge: function (n) { G.sp.charge = n; },
    spCharge: function () { return G.sp.charge; },
    fillGauge: function () { G.vaunt.gauge = GAUGE_MAX; G.vaunt.ready = true; },
    vauntActive: function () { return !!G.vaunt.active; },
    setHoard: function (v, b) { if (G.boss) { G.boss.hoard = v; G.boss.hoardBank = b || 0; } },
    hoardBank: function () { return G.boss ? G.boss.hoardBank : (G._lastHoardBank || 0); },
    triggerBossDeath: function () { var b = G.boss; if (b && b.onDeath) { b.dying = true; G._lastHoardBank = b.hoardBank || 0; b.onDeath(b); } },
    freeTop: function () { return Engine.gold.freeTop; },
    fieldGoldBank: function () { var s = 0; Engine.gold.forEach(function (g) { s += (g.bank || 0); }); return s; },
    setHi: function (v) { Run.meta.hi = v; },                      // headless: fake a wide HI for the HUD collision check
    dashActive: function () { return G.dash.active; }
  };

  function detectClear() {
    if (G.mode !== 'playing') return;   // an Apostate death may have opened a draft mid-frame
    checkFormWipe();
    if (G.waveGrace > 0) G.waveGrace -= Engine.DT;
    if (G.waveKind === 'boss') {
      if (!G.boss) startClearBeat('boss');
    } else {
      if (G.waveGrace <= 0 && timers.length === 0 && Engine.enemies.count() === 0) startClearBeat('wave');
    }
  }
  function startClearBeat(kind) {
    G.tally.waves++;
    // UNTOUCHED: a normal wave cleared with zero player hits (spellcard-capture homage).
    if (kind === 'wave' && G.waveHits === 0) { skillEvent(W / 2, H * 0.42, 'UNTOUCHED', 40); G.tally.untouched++; }
    cancelBulletsToGold(false); homeAllGold();
    // drop transient special timers so a pending edict volley / Ra surge / horn
    // echo / peach window can't freeze through the draft and fire into next wave
    G.verdict.t = 0; G.raSurgeT = 0; G.hornEchoT = 0; G.verdictPeachT = 0;
    G.clearKind = kind; G.clearT = 1.1; G.mode = 'clearing';
  }

  // ---------------------------------------------------------------------
  // combat sim
  // ---------------------------------------------------------------------
  function updateCombat(dt) {
    G.time += dt;
    // CURSED-GOLD gild suppresses action inputs: a golden statue can't SPECIAL
    // (its recoil would even shove the frozen body) or APOTHEOSIS. Read the edge
    // first so it's consumed-and-discarded — a press mid-freeze can't buffer onto
    // the unfreeze frame. (updateCombat runs every step; only updatePlayer early-
    // returns on freeze, so without this the inputs fire straight through.)
    var _gilded = G.freeze.t > 0;
    if (Engine.pressed('KeyX') && !_gilded) doSpecial();
    if (Engine.pressed('KeyC') && !_gilded) tryVaunt();
    updateBackground(dt);
    updateTimers(dt);
    updateSpecial(dt);
    updateFrenzy(dt);
    updatePlayer(dt);
    updateDecoy(dt);
    refreshAim();               // decoy may redirect all aimed fire this frame
    updateShots(dt);
    updateRavens(dt);
    updateGungnir(dt);
    updateWraiths(dt);
    updateHammers(dt);
    updateDebris(dt);
    updateClones(dt);
    updateEnemies(dt);
    updateHazards(dt);
    updateBullets(dt);
    updateGold(dt);
    updateParticles(dt);
    updateVaunt(dt);
    // god-special timers
    if (G.raSurgeT > 0) G.raSurgeT -= dt;                                   // Ra apotheosis surge
    if (G.hornEchoT > 0) { G.hornEchoT -= dt; if (G.hornEchoT <= 0) gjallarhorn(0.5); }   // heimEcho
    if (G.verdict.t > 0) { G.verdict.t -= dt; if (G.verdict.t <= 0) verdictVolley(G.verdict.mult); } // jadeWrath 2nd wave
    if (G.verdictPeachT > 0) G.verdictPeachT -= dt;                         // PEACH BANQUET window
    collideShots();
    collideBodies();
    if (goldComboT > 0) { goldComboT -= dt; if (goldComboT <= 0) goldCombo = 0; }
    G.chroma += (G.chromaTarget - G.chroma) * Math.min(1, dt * 8);
    G.bloom += (G.bloomTarget - G.bloom) * Math.min(1, dt * 6);
    if (G.flashAll > 0) G.flashAll -= dt;
    if (G.shakeMag > 0) {
      G.shakeX = (Math.random() - 0.5) * 2 * G.shakeMag;
      G.shakeY = (Math.random() - 0.5) * 2 * G.shakeMag;
      G.shakeMag -= dt * 26; if (G.shakeMag < 0) G.shakeMag = 0;
    } else { G.shakeX = 0; G.shakeY = 0; }
    if (G.announce.dur < 9000) G.announce.t += dt;
    updatePopups(dt);
  }
  function updateParticles(dt) {
    Engine.particles.forEach(function (p) { Engine.updateParticle(p, dt); if (p.age >= p.life) Engine.particles.release(p); });
  }

  // ---------------------------------------------------------------------
  // main update dispatch
  // ---------------------------------------------------------------------
  function update(dt) {
    var m = G.mode;
    // M toggles the whole mix (SFX + music) — reuses the existing mute surface.
    // Consumes only KeyM; other keys' edges are untouched.
    if (Engine.pressed('KeyM')) { var mu = SFX.toggleMute(); if (window.MUSIC) MUSIC.setMuted(mu); addPopup(W / 2, 120, mu ? 'MUTED' : 'SOUND ON', UI_CYAN, 30); }
    if (Engine.pressed('KeyR')) { Run.startRun(Run.newSeed()); return; }
    // Engine.pressed CONSUMES the edge — check the mode FIRST so that in other
    // modes ('over'/'complete'/'sector') the Escape press survives for the Run
    // handlers' pressCancel() later this same tick.
    // In combat, Esc OR P pauses. From the pause overlay: Z/P/Esc resume,
    // X abandons to title. In draft/shop, Esc deliberately does nothing.
    if (m === 'playing' || m === 'clearing') {
      if (G.paused) {
        if (Engine.pressed('KeyX')) { G.paused = false; if (window.MUSIC) MUSIC.duck(false); Run.toTitle(); return; }
        if (Engine.pressed('KeyZ') || Engine.pressed('Space') || Engine.pressed('KeyP') || Engine.pressed('Escape')) { G.paused = false; if (window.MUSIC) MUSIC.duck(false); }
      } else if (Engine.pressed('Escape') || Engine.pressed('KeyP')) {
        G.paused = true; if (window.MUSIC) MUSIC.duck(true);   // pause ducks the score (not suspend)
      }
    }

    if (m === 'title') Run.updateTitle(dt);
    else if (m === 'sector') Run.updateSector(dt);
    // Micro-hitstop: while G.hitstopT is live the SIM is frozen (updateCombat is
    // skipped) but the step still runs, so the wall clock (Engine.time) and the
    // real-time music scheduler advance — the kill lands as a heavy beat. Pause is
    // handled above, so pausing during a hitstop freezes hitstopT too (it only
    // decrements in the non-paused branch) and resumes the remaining steps clean.
    else if (m === 'playing') { if (!G.paused) { if (G.hitstopT > 0) { G.hitstopT -= dt; if (G.hitstopT < 0) G.hitstopT = 0; } else { updateCombat(dt); detectClear(); } } }
    else if (m === 'clearing') { if (!G.paused) { if (G.hitstopT > 0) { G.hitstopT -= dt; if (G.hitstopT < 0) G.hitstopT = 0; } else { updateCombat(dt); G.clearT -= dt; if (G.clearT <= 0) Run.onCleared(G.clearKind); } } }
    else if (m === 'draft') Run.updateDraft(dt);
    else if (m === 'shop') Run.updateShop(dt);
    else if (m === 'complete') Run.updateComplete(dt);
    else if (m === 'over') Run.updateOver(dt);
  }

  // ---------------------------------------------------------------------
  // Game API used by run.js
  // ---------------------------------------------------------------------
  Game.setAffix = function (aff) {
    G.aff = {
      name: aff.name || '', desc: aff.desc || '',
      hpMul: aff.hpMul || 1, eliteGoldMul: aff.eliteGoldMul || 1,
      popcornAdd: aff.popcornAdd || 0, volatile: !!aff.volatile, shopDiscount: aff.shopDiscount || 0
    };
    Patterns.setGlobal(aff.countMul || 1, aff.speedMul || 1);
  };
  Game.spendGold = function (n) { if (G.wallet >= n) { G.wallet -= n; return true; } return false; };

  Game.applyBoon = function (b) {
    var mag = b.rarity === 'epic' ? 2.25 : b.rarity === 'rare' ? 1.5 : 1;
    switch (b.kind) {
      // a SWAP keeps the slot's current tier (attackR/specialR) — only the god changes
      case 'transformA': G.attackGod = b.god; if (!b.swap) G.attackR = mag; break;
      case 'transformS': G.specialGod = b.god; if (!b.swap) G.specialR = mag; break;
      case 'levelA': G.attackR = b.mag; break;   // pom: raise attack tier
      case 'levelS': G.specialR = b.mag; break;  // pom: raise special tier
      case 'duo': Game.applyDuo(b.id); break;
      case 'mod': applyMod(b.id, mag); break;
      case 'charm': applyCharm(b.id, mag); break;
      case 'scale': applyScale(b.id, mag); break;
      case 'generic': applyGeneric(b.id, mag); break;
    }
    updateCommunion();
  };
  // Pantheon Communion — attack god + special god sharing a pantheon.
  function updateCommunion() {
    var prev = G.communion;
    G.communion = null;
    var A = G.attackGod && Run.GODS[G.attackGod], S = G.specialGod && Run.GODS[G.specialGod];
    var names = { OLYMPUS: 'Accord of Olympus', ASGARD: 'Twilight Oath', KEMET: 'Rite of Two Suns', 'CELESTIAL COURT': 'Harmony of Heaven' };
    // only pantheons with a defined bonus commune (solo pantheons can't)
    if (A && S && A.pantheon === S.pantheon && names[A.pantheon]) G.communion = A.pantheon;
    if (G.communion && G.communion !== prev) {
      announce('PANTHEON COMMUNION', G.communion + ' — ' + names[G.communion], 2.6);
      G.flashAll = Math.max(G.flashAll, 0.25);
    }
  }
  function effMultCap() { return G.up.multCap + (G.communion === 'OLYMPUS' ? 1 : 0); }
  function hasStatus(e) { return e.marked || e.weak || e.charmed || e.burnT > 0 || e.confuseT > 0 || e.stunT > 0 || e.terrorT > 0 || e.shakenT > 0; }
  function applyMod(id, mag) {
    var M = G.mods;
    switch (id) {
      case 'zeusChain': M.zeusChain += Math.max(1, Math.round(mag)); break;
      case 'zeusCrit': M.zeusCrit = true; break;
      case 'zeusFork': M.zeusFork = true; break;
      case 'zeusField': M.zeusField = true; break;
      case 'poseidonBig': M.poseidonBig = true; break;
      case 'poseidonDrag': M.poseidonDrag = true; break;
      case 'poseidonSplash': M.poseidonSplash = true; break;
      case 'poseidonForce': M.poseidonForce = true; break;
      case 'artemisCrit': M.artemisCrit += 0.08 * mag; break;
      case 'artemisRefund': M.artemisRefund = true; break;
      case 'artemisSpread': M.artemisSpread = true; break;
      case 'artemisMulti': M.artemisMulti = true; break;
      case 'aphroLong': M.aphroLong = true; break;
      case 'aphroExplode': M.aphroExplode = true; break;
      case 'aphroTaunt': M.aphroTaunt = true; break;
      case 'aphroFast': M.aphroFast = true; break;
      case 'aresDecay': M.aresDecay = true; break;
      case 'aresCharge': M.aresCharge = true; break;
      case 'aresTerror': M.aresTerror = true; break;
      case 'aresSpoils': M.aresSpoils = true; break;
      case 'heimVigil': M.heimVigil = true; break;
      case 'heimPrism': M.heimPrism = true; break;
      case 'heimHorn': M.heimHorn = true; break;
      case 'heimEcho': M.heimEcho = true; break;
      case 'raRamp': M.raRamp = true; break;
      case 'raSpread': M.raSpread = true; break;
      case 'raSplit': M.raSplit = true; break;
      case 'raBurn': M.raBurn = true; break;
      case 'anubisThresh': M.anubisThresh = true; break;
      case 'anubisRefund': M.anubisRefund = true; break;
      case 'anubisShard': M.anubisShard = true; break;
      case 'anubisBossDmg': M.anubisBossDmg = true; break;
      case 'lokiLong': M.lokiLong = true; break;
      case 'lokiBoom': M.lokiBoom = true; break;
      case 'lokiVaunt': M.lokiVaunt = true; break;
      case 'lokiChance': M.lokiChance = true; break;
      case 'odinRaven': M.odinRaven = true; break;
      case 'odinMark': M.odinMark = true; break;
      case 'odinRavenMark': M.odinRavenMark = true; break;
      case 'odinGungnir': M.odinGungnir = true; break;
      case 'wukongClones': M.wukongClones = true; break;
      case 'wukongStaff': M.wukongStaff = true; break;
      case 'wukongSpecial': M.wukongSpecial = true; break;
      case 'wukongChance': M.wukongChance = true; break;
      case 'quetzBig': M.quetzBig = true; break;
      case 'quetzGold': M.quetzGold = true; break;
      case 'quetzCircle': M.quetzCircle = true; break;
      case 'quetzPierce': M.quetzPierce = true; break;
      case 'thorBelt': M.thorBelt = true; break;
      case 'thorFast': M.thorFast = true; break;
      case 'thorGauntlet': M.thorGauntlet = true; break;
      case 'thorSkymark': M.thorSkymark = true; break;
      case 'guanWide': M.guanWide = true; break;
      case 'guanOath': M.guanOath = true; break;
      case 'guanWake': M.guanWake = true; break;
      case 'guanSpoils': M.guanSpoils = true; break;
      case 'jadeOften': M.jadeOften = true; break;
      case 'jadeStun': M.jadeStun = true; break;
      case 'jadeWrath': M.jadeWrath = true; break;
      case 'jadeTribute': M.jadeTribute = true; break;
    }
  }
  Game.applyDuo = function (id) { G.duos[id] = true; };
  // passive god CHARMS — collected through the run, one per god, ungated
  function applyCharm(id, mag) {
    G.charms[id] = true;
    switch (id) {
      case 'charmZeus': G.charmElite += 0.12 * mag; break;                              // +dmg to elites & bosses
      case 'charmPoseidon': G.up.magnet += 0.5 * mag; break;                            // +magnet radius
      case 'charmArtemis': G.critBonus += 0.06 * mag; break;                            // +crit chance (all attacks)
      case 'charmAphrodite': G.charmShop += 0.15 * mag; break;                          // shop discount
      case 'charmAres': G.stats.atkDmg += 0.10 * mag; break;                            // +attack damage
      case 'charmHeimdall': G.charmMark += 0.12 * mag; break;                           // +dmg to Marked (stacks with heimVigil)
      case 'charmRa': G.stats.spRecharge += 0.20 * mag; break;                          // +special recharge
      case 'charmAnubis': G.noSpill = true; break;                                      // death spills no gold
      case 'charmLoki': G.hermes.graze += 0.35 * mag; break;                            // +graze gauge gain
      case 'charmOdin': G.rerollHalf = true; break;                                     // rerolls half price
      case 'charmThor': G.stats.spDmg += 0.15 * mag; break;                             // +special damage
      case 'charmWukong': G.hermes.speed += 0.12 * mag; G.hermes.focus += 0.15 * mag; break; // +move / focus speed
      case 'charmQuetz': G.up.vdur += 1.2 * mag; break;                                 // +apotheosis duration
      case 'charmGuanyu': G.keepMult = true; break;                                     // multiplier survives death
      case 'charmJade': G.vauntBonusMul += 0.30 * mag; break;                           // +apotheosis bonus payout
    }
  }
  Game.rerollHalf = function () { return !!(G && G.rerollHalf); };
  Game.shopDiscount = function () { return G ? G.charmShop : 0; };
  function applyScale(id, mag) {
    switch (id) {
      case 'atkdmg': G.stats.atkDmg += 0.15 * mag; break;
      case 'atkrate': G.stats.atkRate += 0.10 * mag; break;
      case 'spdmg': G.stats.spDmg += 0.20 * mag; break;
      case 'spcharge': G.sp.max = Math.min(5, G.sp.max + 1); G.sp.charge = Math.min(G.sp.max, G.sp.charge + 1); break;
      case 'sprecharge': G.stats.spRecharge += 0.20 * mag; break;
    }
  }
  function applyGeneric(id, mag) {
    switch (id) {
      case 'life': G.lives++; break;
      case 'hitbox': G.up.hitboxMul = 0.75; break;
      case 'magnet': G.up.magnet += 0.6 * mag; break;
      case 'goldworth': G.up.goldWorth += 0.25 * mag; break;
      case 'vdur': G.up.vdur += 1.5 * mag; break;
      case 'vcap': G.up.multCap = Math.min(8, G.up.multCap + 1); break;
    }
  }

  Game.hasAttackGod = function () { return !!G.attackGod; };
  Game.hasSpecialGod = function () { return !!G.specialGod; };
  Game.attackGod = function () { return G.attackGod; };
  Game.specialGod = function () { return G.specialGod; };

  Game.upgradeSummary = function () {
    var out = [];
    if (G.stats.atkDmg > 1.001) out.push('ATK x' + G.stats.atkDmg.toFixed(2));
    if (G.stats.atkRate > 1.001) out.push('RATE x' + G.stats.atkRate.toFixed(2));
    if (G.stats.spDmg > 1.001) out.push('SP.DMG x' + G.stats.spDmg.toFixed(2));
    if (G.stats.spRecharge > 1.001) out.push('SP.RCH x' + G.stats.spRecharge.toFixed(2));
    if (G.sp.max > 3) out.push('CHARGES ' + G.sp.max);
    if (G.up.goldWorth > 1.001) out.push('GOLD +' + Math.round((G.up.goldWorth - 1) * 100) + '%');
    if (G.up.magnet) out.push('MAGNET +' + Math.round(G.up.magnet * 100) + '%');
    if (G.up.vdur) out.push('APOTH +' + G.up.vdur.toFixed(1) + 's');
    if (G.up.multCap > 5) out.push('CAP x' + G.up.multCap);
    if (G.up.hitboxMul < 1) out.push('PINPOINT');
    if (Run.CHARMS) { for (var ck in G.charms) { if (G.charms[ck] && Run.CHARMS[ck]) out.push('◈ ' + Run.CHARMS[ck].name); } }
    return out;
  };

  // ---- wave pool -------------------------------------------------------
  // ---- wave pool: named, hand-tuned arrangements tagged by slot ROLE --------
  // The sector sequencer (run.js) fills an authored slot arc — opener → build*
  // → feature → breather → crescendo → boss — picking among arrangements tagged
  // for the slot's role + reachable by minSector; RNG only chooses WHICH + the
  // mirror + phase, never geometry. Anchor (left/center/right) alternates per
  // wave via G.anchorX / G.anchorSide, set in beginWave.
  Game.wavePool = [
    // ---- OPENERS — light mirrored formation, states the motif ----
    { name: 'openSwoop', weight: 10, minSector: 0, roles: ['opener'], fn: function (rng) {
        var n = 3 + G.aff.popcornAdd;
        for (var i = 0; i < n; i++) (function (i) {
          setTimerSpawn(i * 0.4, function () { spawnDarter(180 + i * 26, 0, W + 180); spawnDarter(W - 180 - i * 26, 0, -180); });
        })(i);
      } },
    { name: 'openWeave', weight: 8, minSector: 0, roles: ['opener'], fn: function (rng) {
        var n = 4 + G.aff.popcornAdd;
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.5, function () { spawnWeaver(i % 2 ? 220 : W - 220, 0, i); }); })(i);
      } },
    // loop-de-loop popcorn opener — mirrored pairs, fire at loop bottom (PATH loop)
    { name: 'openLoop', weight: 7, minSector: 0, roles: ['opener'], fn: function (rng) {
        var n = 2 + G.aff.popcornAdd;
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.6, function () { spawnLooper(300 + i * 70); spawnLooper(W - 300 - i * 70); }); })(i);
      } },
    // ---- BUILDS — standard arrangements, alternating anchors ----
    { name: 'buildDarts', weight: 9, minSector: 0, roles: ['build'], fn: function (rng) {
        var side = G.anchorSide || (rng() < 0.5 ? -1 : 1);
        var sx = side < 0 ? 240 : W - 240, n = 4 + (rng() * 2 | 0) + G.aff.popcornAdd;
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.34, function () { spawnDarter(clampX(sx + side * i * 20, 140), 0, side < 0 ? W + 180 : -180); }); })(i);
        setTimerSpawn(0.6, function () { spawnWeaver(W / 2, 0, 0); });
      } },
    { name: 'buildTurrets', weight: 8, minSector: 0, roles: ['build'], fn: function (rng) {
        var ax = G.anchorX || W / 2;
        setTimerSpawn(0.0, function () { spawnTurret(clampX(ax - 150, 180), 340); });
        setTimerSpawn(0.3, function () { spawnTurret(clampX(ax + 150, 180), 380); });
        for (var i = 0; i < 4; i++) (function (i) { setTimerSpawn(0.8 + i * 0.4, function () { spawnWeaver(220 + i * 160, 0, i); }); })(i);
      } },
    { name: 'buildPincer', weight: 8, minSector: 0, roles: ['build'], fn: function (rng) {
        var n = 3 + (rng() * 2 | 0) + G.aff.popcornAdd;
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.3, function () { spawnDarter(150 + i * 24, 0, W + 160); spawnDarter(W - 150 - i * 24, 0, -160); }); })(i);
      } },
    { name: 'buildGunships', weight: 6, minSector: 0, roles: ['build', 'feature'], fn: function (rng) {
        var mir = rng() < 0.5;
        setTimerSpawn(0, function () { spawnGunship(mir); });
        setTimerSpawn(0.4, function () { spawnGunship(!mir); });
        for (var i = 0; i < 3; i++) (function (i) { setTimerSpawn(0.8 + i * 0.4, function () { spawnDarter(220 + i * 170, 0, W + 160); }); })(i);
      } },
    { name: 'buildSplitters', weight: 6, minSector: 0, roles: ['build'], fn: function (rng) {
        var n = 3 + (rng() * 2 | 0);
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.5, function () { spawnSplitter(200 + i * (680 / Math.max(1, n - 1)), -80, 0); }); })(i);
      } },
    { name: 'buildMoths', weight: 5, minSector: 1, roles: ['build'], fn: function (rng) {
        var n = 3 + (rng() * 2 | 0);
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.5, function () { spawnMoth(180 + i * 160); }); })(i);
      } },
    // dive-brake aggressors at the player's FORMER position (PATH diveBrake)
    { name: 'buildDivers', weight: 7, minSector: 0, roles: ['build'], fn: function (rng) {
        var n = 3 + (rng() * 2 | 0) + G.aff.popcornAdd;
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.45, function () { spawnDiver(G.player.x, 460 + (i % 3) * 60); }); })(i);
      } },
    // weave-through snake ribbons — first snakes appear in S2 (VERB snake)
    { name: 'buildRibbons', weight: 6, minSector: 1, roles: ['build'], fn: function (rng) {
        var n = 3 + (rng() * 2 | 0);
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.5, function () { var s = (i % 2) ? 1 : -1; spawnRibbon(s < 0 ? 240 : W - 240, s); }); })(i);
      } },
    // mirrored flanker pair firing crossing streams — S2 combines (VERB crossfire)
    { name: 'buildCrossfire', weight: 6, minSector: 1, roles: ['build', 'feature'], fn: function (rng) {
        setTimerSpawn(0.0, function () { spawnFlanker(-1, 0); });
        setTimerSpawn(0.3, function () { spawnFlanker(1, 0.8); });
        for (var i = 0; i < 2; i++) (function (i) { setTimerSpawn(1.0 + i * 0.5, function () { spawnWeaver(W / 2, 0, i); }); })(i);
      } },
    // ---- FEATURES — midship / elite centerpiece ----
    { name: 'featureMidship', weight: 9, minSector: 0, roles: ['feature'], fn: function (rng) {
        var ax = G.anchorX || W / 2;
        setTimerSpawn(0.2, function () { spawnMidship(clampX(ax, 260)); });
        for (var i = 0; i < 4; i++) (function (i) { setTimerSpawn(1.0 + i * 0.5, function () { spawnDarter(200 + i * 170, 0, W + 160); }); })(i);
      } },
    { name: 'featureAegis', weight: 6, minSector: 0, roles: ['feature'], fn: function (rng) {
        setTimerSpawn(0, function () { spawnAegis(W * 0.35); });
        setTimerSpawn(0.4, function () { spawnAegis(W * 0.65); });
        for (var i = 0; i < 3; i++) (function (i) { setTimerSpawn(1.0 + i * 0.4, function () { spawnDarter(220 + i * 170, 0, W + 160); }); })(i);
      } },
    { name: 'featureMimic', weight: 5, minSector: 0, roles: ['feature'], fn: function (rng) {
        var n = 2 + (G.aff.eliteGoldMul > 1 ? 2 : 0);
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.6, function () { spawnMimic(160 + rng() * (W - 320), -60 - i * 40); }); })(i);
        for (var k = 0; k < 3; k++) (function (k) { setTimerSpawn(k * 0.5, function () { spawnWeaver(220 + k * 200, 0, k); }); })(k);
      } },
    { name: 'featureWeaverPairs', weight: 6, minSector: 1, roles: ['feature'], fn: function (rng) {
        setTimerSpawn(0, spawnWeaverPair);
        if (rng() < 0.6) setTimerSpawn(2.4, spawnWeaverPair);
      } },
    { name: 'featureAcolyte', weight: 5, minSector: 1, roles: ['feature'], fn: function (rng) {
        setTimerSpawn(0, function () { spawnMidship(W / 2); });
        setTimerSpawn(0.8, function () { spawnAcolyte(W * 0.3); });
        setTimerSpawn(1.0, function () { spawnAcolyte(W * 0.7); });
      } },
    { name: 'featureGarden', weight: 5, minSector: 1, roles: ['feature'], fn: function (rng) {
        setTimerSpawn(0, function () { spawnGardener(W / 2); });
        for (var i = 0; i < 4; i++) (function (i) { setTimerSpawn(0.8 + i * 0.5, function () { spawnWeaver(200 + i * 160, 0, i); }); })(i);
      } },
    // rotating wheel formation firing spokes outward (PATH orbitPoint, VERB wheel)
    { name: 'featureWheel', weight: 6, minSector: 0, roles: ['feature'], fn: function (rng) {
        var cx = clampX(G.anchorX || W / 2, 320), cy = 480, rad = 240, n = 5;
        for (var i = 0; i < n; i++) (function (i) { setTimerSpawn(i * 0.15, function () { spawnWheelShip(cx, cy, rad, i, n, i * 0.28); }); })(i);
      } },
    // reacting elite: retreats when shot, returns with a denser pulse volley
    // (PATH retreatReturn, VERB pulse). S2+ — a reactive centerpiece.
    { name: 'featureReactor', weight: 6, minSector: 1, roles: ['feature'], fn: function (rng) {
        var ax = G.anchorX || W / 2;
        setTimerSpawn(0.2, function () { spawnReactor(ax); });
        for (var i = 0; i < 3; i++) (function (i) { setTimerSpawn(1.0 + i * 0.5, function () { spawnWeaver(220 + i * 200, 0, i); }); })(i);
      } },
    // ---- BREATHERS — short, sparse, gold-heavy; the valley ----
    { name: 'breatherGold', weight: 7, minSector: 0, roles: ['breather'], fn: function (rng) {
        for (var g = 0; g < 10; g++) spawnGold(150 + rng() * (W - 300), 200 + rng() * 500, 1, 0.7);
        setTimerSpawn(0.5, function () { spawnDarter(rng() < 0.5 ? 300 : W - 300, 0, W + 160); });   // a single straggler — the valley stays sparse (density must breathe)
      } },
    { name: 'breatherStragglers', weight: 5, minSector: 1, roles: ['breather'], fn: function (rng) {
        for (var g = 0; g < 8; g++) spawnGold(180 + rng() * (W - 360), 220 + rng() * 400, 1, 0.6);
        setTimerSpawn(0.4, function () { spawnWeaver(W / 2, 0, 0); });
        setTimerSpawn(1.0, function () { spawnMoth(W / 2); });
      } },
    // ---- CRESCENDOS — densest, previews the boss's lead verb ----
    { name: 'crescendoWall', weight: 8, minSector: 0, roles: ['crescendo'], fn: function (rng) {
        var ax = G.anchorX || W / 2;
        setTimerSpawn(0.0, function () { spawnMidship(clampX(ax, 260)); });
        setTimerSpawn(0.5, function () { spawnTurret(clampX(ax - 220, 180), 320); });
        setTimerSpawn(0.7, function () { spawnTurret(clampX(ax + 220, 180), 320); });
        for (var i = 0; i < 3; i++) (function (i) { setTimerSpawn(1.2 + i * 0.35, function () { spawnDarter(160 + i * 30, 0, W + 160); spawnDarter(W - 160 - i * 30, 0, -160); }); })(i);
      } },
    { name: 'crescendoCarrier', weight: 5, minSector: 1, roles: ['crescendo'], fn: function (rng) {
        setTimerSpawn(0, function () { spawnCarrier(G.rank); });
        setTimerSpawn(0.6, function () { spawnMidship(W / 2); });
      } },
    { name: 'crescendoApostate', weight: 4, minSector: 2, roles: ['crescendo', 'feature'], fn: function (rng) {
        setTimerSpawn(0.3, function () { spawnApostate(G.rank); });
      } },
    // drifting rain curtain layered under a midship crest (VERB rain). S2+ ambience.
    { name: 'crescendoRain', weight: 5, minSector: 1, roles: ['crescendo'], fn: function (rng) {
        var ax = G.anchorX || W / 2;
        setTimerSpawn(0.0, function () { spawnRainmaker(ax); });
        setTimerSpawn(0.5, function () { spawnMidship(clampX(ax, 260)); });
        for (var i = 0; i < 2; i++) (function (i) { setTimerSpawn(1.2 + i * 0.5, function () { spawnDarter(220 + i * 200, 0, W + 160); }); })(i);
      } }
  ];
  Game.bosses = { warden: spawnWarden, warden2: spawnWarden2, sovereign: spawnBoss };

  // ---------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------
  function render() {
    if (!G) return;
    GL.setShake(G.shakeX, G.shakeY);
    GL.beginScene();
    drawBackground();
    var m = G.mode;
    if (m !== 'title') {
      // PASS A — additive base: everything the opaque bullet bodies draw over
      // (explosions included, so a bullet frozen over a white blast still reads).
      drawHazards();
      drawGold(); drawEnemies(); drawShots(); drawParticles(); drawBulletHalos();
      // PASS B — enemy-bullet opaque bodies (premultiplied-over). The bullet
      // shader recolours each cell so the baked white cores survive the family
      // tint; restore the default sprite shader immediately after.
      GL.blendPremult();
      GL.useBulletShader(true);
      drawBulletBodies();
      GL.useBulletShader(false);
      // PASS C — additive over the bullets: allies + the player (and its core
      // gem) always read on top of the danmaku.
      GL.blendAdditive();
      drawDecoy(); drawClones(); drawRavens(); drawGungnir(); drawRaBeam(); drawWraiths(); drawHammers(); drawDebris();
      drawDashGhosts();
      if (G.player.alive) drawPlayer();
      if (G.flashAll > 0) GL.draw(GL.SPR.GLOW, W / 2, H / 2, W * 2, H * 2, 0, 0.5, 0.7, 1.0, G.flashAll * 0.5);
    }
    GL.composite(G.chroma, G.bloom, 0.62);

    var lb = GL.letterbox();
    var scale = lb.w / W;
    hud.setTransform(1, 0, 0, 1, 0, 0);
    hud.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    hud.setTransform(scale, 0, 0, scale, lb.x, lb.y);
    hud.textBaseline = 'top';
    if (m === 'playing' || m === 'clearing' || m === 'draft' || m === 'shop') drawCombatHUD();
    Run.draw(hud);
    if (G.paused && (m === 'playing' || m === 'clearing')) pauseOverlay();
  }

  function drawBackground() {
    var b = G.bg, i, dim = b.dimFactor, bright = b.bright;
    var deepA = dim * Math.min(1.15, bright);         // deep field follows brightness + dim law
    var structBase = dim * bright * b.structAlpha;    // structure layer reveal + dim
    var sc = b.env.structCol, st = b.env.star;
    // DEEP FIELD — nebula tint then stars. Painted layer overrides if present.
    if (GL.backdropReady(b.env.slot + '-deep')) {
      GL.drawBackdrop(b.env.slot + '-deep', W / 2, H / 2, W, H, 1, 1, 1, deepA, (G.time * 0.006) % 1);
    } else {
      for (i = 0; i < b.nebula.length; i++) { var n = b.nebula[i]; GL.draw(GL.SPR.GLOW, n.x, n.y, n.r, n.r, 0, n.col[0], n.col[1], n.col[2], deepA); }
      for (i = 0; i < b.stars.length; i++) { var s = b.stars[i]; var tw = 0.7 + 0.3 * Math.sin(s.tw); GL.draw(GL.SPR.CORE, s.x, s.y, s.sz, s.sz, 0, st[0], st[1], st[2], s.a * tw * deepA); }
    }
    // BOSS SHADOW — huge dim looming mass that precedes the boss (arrives FROM
    // the environment). Drawn even as the layers dim to near-black for the fight.
    var bs = b.bossShadow;
    if (bs.active && bs.alpha > 0.01) {
      GL.draw(GL.SPR.GLOW, W / 2, bs.y, W * 1.5, H * 0.7, 0, 0.06, 0.04, 0.09, 0.5 * bs.alpha * dim);
      GL.draw(GL.SPR.RING, W / 2, bs.y, W * 0.9, W * 0.9, G.time * 0.4, 0.10, 0.07, 0.13, 0.45 * bs.alpha * dim);
    }
    // STRUCTURE LAYER — drifting architecture silhouettes (painted override or
    // procedural units).
    if (GL.backdropReady(b.env.slot + '-structure')) {
      GL.drawBackdrop(b.env.slot + '-structure', W / 2, H / 2, W, H, 1, 1, 1, structBase, (G.time * 0.012) % 1);
    } else if (structBase > 0.01) {
      for (i = 0; i < b.units.length; i++) drawStructUnit(b.units[i], sc, structBase);
    }
    // SET-PIECE — one big silhouette crossing under the fight on a feature wave;
    // dims further while a crest is live (dimFactor already low then).
    var sp = b.setpiece;
    if (sp.active && sp.parts) drawStructUnitAt(sp.x, sp.y, sp.parts, sc, structBase * 1.1 * sp.alpha);
    // NEAR-DEBRIS WEATHER — fast sparse motes/embers (painted override or procedural).
    var dc = b.env.debrisCol, debA = deepA * 0.9;
    if (GL.backdropReady(b.env.slot + '-debris')) {
      GL.drawBackdrop(b.env.slot + '-debris', W / 2, H / 2, W, H, 1, 1, 1, debA, (G.time * 0.03) % 1);
    } else {
      for (i = 0; i < b.debris.length; i++) { var d = b.debris[i]; var dt2 = 0.6 + 0.4 * Math.sin(d.tw); GL.draw(GL.SPR.SPARK, d.x, d.y, d.sz, d.sz, d.tw, dc[0], dc[1], dc[2], d.a * dt2 * debA); }
    }
  }
  function drawStructUnitAt(ox, oy, parts, col, alpha) {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      GL.draw(p.spr, ox + p.dx, oy + p.dy, p.sx, p.sy, p.rot, col[0], col[1], col[2], p.a * alpha);
    }
  }
  function drawStructUnit(u, col, alpha) { drawStructUnitAt(u.x, u.y, u.parts, col, alpha); }
  function drawGold() {
    Engine.gold.forEach(function (g) {
      var fade = g.age > g.life - 1.5 ? Math.max(0, (g.life - g.age) / 1.5) : 1;
      if (g.cursed) {
        // CURSED GOLD — must read at a glance vs normal loot: a brighter gilded
        // shimmer + a pulsing warm DANGER rim (the greed trap made visible).
        var cp = 0.55 + 0.45 * Math.sin(G.time * 9 + g.rot);
        GL.draw(GL.SPR.GLOW, g.x, g.y, g.scale * 2.8, g.scale * 2.8, 0, 1, 0.72, 0.2, 0.55 * fade);
        GL.draw(GL.SPR.RING, g.x, g.y, g.scale * 2.2, g.scale * 2.2, G.time * 3, 1, 0.42, 0.2, (0.45 + 0.4 * cp) * fade);   // warm danger rim
        GL.draw(GL.SPR.GOLD, g.x, g.y, g.scale * 1.15, g.scale * 1.4, g.rot, 1, 0.86, 0.34, fade);
        GL.draw(GL.SPR.CORE, g.x, g.y, g.scale * 0.55, g.scale * 0.55, 0, 1, 1, 0.85, (0.6 + 0.4 * cp) * fade);
        return;
      }
      GL.draw(GL.SPR.GLOW, g.x, g.y, g.scale * 2.2, g.scale * 2.2, 0, 1, 0.7, 0.2, 0.5 * fade);
      GL.draw(GL.SPR.GOLD, g.x, g.y, g.scale, g.scale * 1.2, g.rot, 1, 0.85, 0.35, fade);
      GL.draw(GL.SPR.GOLD, g.x, g.y, g.scale * 0.5, g.scale * 0.6, g.rot, 1, 1, 0.9, fade);
    });
  }
  function drawEnemies() {
    Engine.enemies.forEach(function (e) {
      var f = e.hitFlash > 0 ? 1 : 0;
      var er = e.r, eg = e.g, eb = e.b;
      if (e.charmed) { er = 1; eg = 0.4; eb = 0.8; }
      var r = er + (1 - er) * f, g = eg + (1 - eg) * f, bl = eb + (1 - eb) * f;
      GL.draw(GL.SPR.GLOW, e.x, e.y, e.scale * 1.5, e.scale * 1.5, 0, er, eg, eb, e.boss ? 0.5 : 0.35);
      GL.draw(e.spr, e.x, e.y, e.scale, e.scale, e.rot, r, g, bl, 1);
      if (e.boss) GL.draw(e.spr, e.x, e.y, e.scale * 0.6, e.scale * 0.6, e.rot, 1, 1, 1, 0.4 + 0.2 * Math.sin(G.time * 4));
      // TALOS THE NAIL — the glowing ankle weak point (the only thing that can be
      // hurt in the final phase): a green-gold ichor node, pulsing so it reads.
      if (e.nailActive) {
        var np = 0.6 + 0.4 * Math.sin(G.time * 8);
        GL.draw(GL.SPR.GLOW, e.nailX, e.nailY, 78, 78, 0, 0.7, 1, 0.45, 0.5 * np);
        GL.draw(GL.SPR.NEEDLE, e.nailX, e.nailY, 22, 50, 0, 1, 0.95, 0.6, 0.95);
        GL.draw(GL.SPR.CORE, e.nailX, e.nailY, 24, 24, 0, 0.7, 1, 0.5, 0.7 + 0.3 * np);
        GL.draw(GL.SPR.RING, e.nailX, e.nailY, 58, 58, G.time * 3, 0.6, 1, 0.5, 0.75);
      }
      // elite aura rings
      if (e.aura === 'gilded') GL.draw(GL.SPR.RING, e.x, e.y, e.scale * 1.7, e.scale * 1.7, G.time * 1.5, 1, 0.82, 0.3, 0.8);
      else if (e.aura === 'bulwark') GL.draw(GL.SPR.RING, e.x, e.y, e.scale * 1.7, e.scale * 1.7, 0, 0.4, 0.8, 1, 0.7);
      else if (e.aura === 'frenzied') GL.draw(GL.SPR.RING, e.x, e.y, e.scale * 1.7, e.scale * 1.7, -G.time * 3, 1, 0.3, 0.2, 0.8);
      // aegis / bulwark front shield arc (front = below; spins open when displaced)
      if ((e.arch === 'aegis' || e.aura === 'bulwark') && e.shieldT <= 0) {
        GL.draw(GL.SPR.GLOW, e.x, e.y + e.scale * 0.5, e.scale * 1.5, e.scale * 0.7, 0, 0.4, 0.8, 1.0, 0.5);
        GL.draw(GL.SPR.RING, e.x, e.y + e.scale * 0.35, e.scale * 1.6, e.scale * 1.6, 0, 0.5, 0.9, 1.0, 0.6);
      }
      // mimic disguise pulse (the tell)
      if (e.arch === 'mimic' && e.s0 === 0) { var mp = 0.5 + 0.5 * Math.sin(G.time * 6); GL.draw(GL.SPR.GLOW, e.x, e.y, e.scale * 1.7, e.scale * 1.7, 0, 1, 0.85, 0.4, 0.22 + 0.2 * mp); }
      // weaver-pair tether curtain
      if (e.arch === 'weaver2' && e.s3 && e.link && e.link.active && !e.link.dying) {
        for (var ti = 0; ti <= 8; ti++) { var tx = e.x + (e.link.x - e.x) * ti / 8, ty = e.y + (e.link.y - e.y) * ti / 8; GL.draw(GL.SPR.CORE, tx, ty, 15, 15, 0, 0.7, 0.4, 1.0, 0.55); }
      }
      // acolyte heal beam
      if (e.arch === 'acolyte' && e.link && e.link.active && !e.link.dying) {
        for (var hi = 0; hi <= 10; hi++) { var hx = e.x + (e.link.x - e.x) * hi / 10, hy = e.y + (e.link.y - e.y) * hi / 10; GL.draw(GL.SPR.CORE, hx, hy, 13, 13, 0, 0.4, 1.0, 0.6, 0.5); }
      }
      // apostate renegade aura
      if (e.arch === 'apostate') GL.draw(GL.SPR.GLOW, e.x, e.y, e.scale * 1.9, e.scale * 1.9, 0, 0.8, 0.3, 0.95, 0.32 + 0.15 * Math.sin(G.time * 5));
      // status tells
      if (e.terrorT > 0) { var tp = 0.5 + 0.5 * Math.sin(G.time * 22); GL.draw(GL.SPR.GLOW, e.x, e.y, e.scale * 1.6, e.scale * 1.6, 0, 0.6, 0.05, 0.12, 0.4 + 0.3 * tp); }
      if (e.shakenT > 0) { GL.draw(GL.SPR.RING, e.x, e.y, e.scale * 1.4, e.scale * 1.4, G.time * 8, 0.9, 0.2, 0.3, 0.6); }
      if (e.marked) { GL.draw(GL.SPR.RING, e.x, e.y, e.scale * 1.5, e.scale * 1.5, -G.time * 2, 0.8, 1.0, 0.3, 0.7); }
      if (e.weak) { GL.draw(GL.SPR.GLOW, e.x, e.y, e.scale * 1.7, e.scale * 1.7, 0, 1, 0.4, 0.8, 0.2); }
      if (e.charmed) { GL.draw(GL.SPR.GLOW, e.x, e.y, e.scale * 1.8, e.scale * 1.8, 0, 1, 0.4, 0.8, 0.35); }
      if (e.burnT > 0) { GL.draw(GL.SPR.GLOW, e.x, e.y, e.scale * 1.7, e.scale * 1.7, 0, 1, 0.45, 0.1, 0.33); }
      if (e.confuseT > 0) { GL.draw(GL.SPR.RING, e.x, e.y, e.scale * 1.4, e.scale * 1.4, G.time * 6, 0.7, 1, 0.3, 0.6); }
      if (e.stunT > 0) { GL.draw(GL.SPR.RING, e.x, e.y, e.scale * 1.6, e.scale * 1.6, -G.time * 4, 0.6, 0.9, 1, 0.7); }
    });
  }
  function drawShots() {
    Engine.shots.forEach(function (s) {
      var ang = Math.atan2(s.vy, s.vx) + Math.PI / 2;
      if (s.crescent) {
        // broad crescent blade — wide across its travel; brightens as it cleaves
        var cw = s.scale, perp = ang + Math.PI / 2;
        var pow = Math.min(1, (s.damage - 1) * 0.12);
        GL.draw(GL.SPR.GLOW, s.x, s.y, cw * 1.1, cw * 2.4, perp, s.r, s.g, s.b, 0.5 + 0.35 * pow);
        GL.draw(GL.SPR.STREAK, s.x, s.y, cw * 0.7, cw * 2.0, perp, s.r, s.g, s.b, 0.95);
        GL.draw(GL.SPR.STREAK, s.x, s.y, cw * 0.4, cw * 1.3, perp, 1, 1, 1, 0.85);
        GL.draw(GL.SPR.CORE, s.x, s.y, cw * 0.34, cw * 0.34, 0, 1, 1, 1, 0.8);
        return;
      }
      if (s.big) {
        GL.draw(GL.SPR.GLOW, s.x, s.y, s.scale * 1.4, s.scale * 3.2, ang, s.r, s.g, s.b, 0.6);
        GL.draw(GL.SPR.STREAK, s.x, s.y, s.scale * 0.9, s.scale * 3.0, ang, s.r, s.g, s.b, 0.95);
        GL.draw(GL.SPR.STREAK, s.x, s.y, s.scale * 0.45, s.scale * 2.2, ang, 1, 1, 1, 0.95);
        GL.draw(GL.SPR.CORE, s.x, s.y, s.scale * 0.6, s.scale * 0.6, 0, 1, 1, 1, 0.9);
      } else {
        GL.draw(GL.SPR.STREAK, s.x, s.y, s.scale * 0.5, s.scale * 1.7, ang, s.r * 0.7, s.g, s.b, 0.5);
        GL.draw(GL.SPR.STREAK, s.x, s.y, s.scale * 0.3, s.scale * 1.1, ang, s.r, s.g, s.b, 0.95);
        GL.draw(GL.SPR.CORE, s.x, s.y, s.scale * 0.32, s.scale * 0.32, 0, 1, 1, 1, 0.9);
      }
    });
  }
  // Enemy bullets draw in two passes. PASS A (additive): a dim family-colour
  // halo UNDER the body — glow without eating the outline. PASS B (premult):
  // the opaque glassy body whose dark #231A20 outline survives the crest.
  function drawBulletHalos() {
    // Additive under-halo, re-balanced now that the colour lives in a thick rim
    // with a baked outer fade inside the sprite. Variant A carries its glow in
    // the sprite, so the halo is a whisper (never fog); variant B has a harder
    // solid body, so it gets a modest neon corona. Muzzle flash still punches.
    var A = GL.bulletStyle !== 'B';
    var wideS = A ? 2.7 : 3.1, wideA = A ? 0.10 : 0.18;
    var tightS = A ? 1.5 : 1.8, tightA = A ? 0.16 : 0.30;
    Engine.bullets.forEach(function (b) {
      var R = b.scale, fl = b.flash > 0 ? b.flash / 0.1 : 0;
      GL.draw(GL.SPR.GLOW, b.x, b.y, R * wideS, R * wideS, 0, b.r, b.g, b.b, wideA + fl * 0.28);
      GL.draw(GL.SPR.GLOW, b.x, b.y, R * tightS, R * tightS, 0, b.r, b.g, b.b, tightA + fl * 0.32);
      if (b.slowT > 0) GL.draw(GL.SPR.RING, b.x, b.y, R * 3.2, R * 3.2, 0, 0.6, 0.9, 1.0, 0.25);
    });
  }
  function drawBulletBodies() {
    Engine.bullets.forEach(function (b) {
      var R = b.scale, fl = b.flash > 0 ? b.flash / 0.1 : 0, sc = 1 + 0.32 * fl;
      var r = b.r, g = b.g, bl = b.b;
      switch (b.fam) {
        case 1: GL.draw(GL.SPR.GRING, b.x, b.y, R * 2 * sc, R * 2 * sc, b.age * b.spin, r, g, bl, 1); break;   // ring
        case 2: GL.draw(GL.SPR.KUNAI, b.x, b.y, R * 1.28, R * 2.25, b.dir + Math.PI / 2, r, g, bl, 1); break;  // kunai
        case 3: GL.draw(GL.SPR.SHARD, b.x, b.y, R * 1.55, R * 2.0, b.dir + Math.PI / 2, r, g, bl, 1); break;   // shard
        case 4: GL.draw(GL.SPR.PELLET, b.x, b.y, R * 2 * sc, R * 2 * sc, 0, r, g, bl, 1); break;               // pellet
        case 5: GL.draw(GL.SPR.STAR, b.x, b.y, R * 2, R * 2, b.age * b.spin, r, g, bl, 1); break;              // star
        default: GL.draw(GL.SPR.ORB, b.x, b.y, R * 2 * sc, R * 2 * sc, b.age * b.spin, r, g, bl, 1);           // orb
      }
    });
  }
  function drawParticles() {
    Engine.particles.forEach(function (p) {
      var lifeF = 1 - p.age / p.life; if (lifeF < 0) lifeF = 0;
      var a = p.a * lifeF; if (p.kind === K_RING) a = p.a * lifeF * lifeF;
      GL.draw(p.spr, p.x, p.y, p.size, p.size, p.rot, p.r, p.g, p.b, a);
    });
  }
  function drawDashGhosts() {
    var arr = G.dash.ghosts;
    for (var i = 0; i < arr.length; i++) {
      var gh = arr[i], a = Math.max(0, 1 - gh.age / 0.28) * 0.5;
      GL.draw(GL.SPR.SHIP_PLAYER, gh.x, gh.y, 74, 74, 0, 0.5, 0.9, 1.0, a);
      GL.draw(GL.SPR.GLOW, gh.x, gh.y, 42, 42, 0, 0.4, 0.85, 1.0, a * 0.6);
    }
  }
  function drawPlayer() {
    var p = G.player;
    var dim = (p.invuln > 0 && Math.floor(p.blink * 20) % 2 === 0) ? 0.35 : 1;
    var kick = p.recoil > 0 ? p.recoil * 60 : 0;
    // CURSED-GOLD gild: a gold statue. Render the ship in solid gold with a
    // shimmer ring so the freeze reads at a glance (no blink; it's frozen, not hit).
    if (G.freeze.t > 0) {
      GL.draw(GL.SPR.GLOW, p.x, p.y, 120, 120, 0, 1, 0.78, 0.28, 0.55);
      GL.draw(GL.SPR.SHIP_PLAYER, p.x, p.y, 104, 104, 0, 1, 0.82, 0.32, 1);
      GL.draw(GL.SPR.SHIP_PLAYER, p.x, p.y, 62, 62, 0, 1, 0.92, 0.55, 0.9);
      GL.draw(GL.SPR.RING, p.x, p.y, 96, 96, G.time * 1.5, 1, 0.85, 0.4, 0.6 + 0.3 * Math.sin(G.time * 12));
      GL.draw(GL.SPR.CORE, p.x, p.y, 13, 13, 0, 1, 0.95, 0.7, 1);
      return;
    }
    // Ship visual ~100px (a presence). Hitbox is UNCHANGED and tiny (PLAYER_R=4)
    // — the bright core gem below is drawn separately so the player learns what
    // actually collides.
    GL.draw(GL.SPR.GLOW, p.x, p.y + 42 + kick, 78, 118 + kick * 2, 0, 0.3, 0.8, 1.0, 0.5 * dim + (p.recoil > 0 ? 0.4 : 0));
    GL.draw(GL.SPR.SHIP_PLAYER, p.x, p.y, 100, 100, 0, 0.7, 0.95, 1.0, dim);
    GL.draw(GL.SPR.SHIP_PLAYER, p.x, p.y, 62, 62, 0, 1, 1, 1, 0.8 * dim);
    GL.draw(GL.SPR.GLOW, p.x, p.y, 30, 30, 0, 1, 1, 1, 0.9 * dim);
    GL.draw(GL.SPR.CORE, p.x, p.y, 13, 13, 0, 1, 1, 1, dim);           // the hitbox gem — read this
    if (Engine.focusHeld()) GL.draw(GL.SPR.RING, p.x, p.y, 78, 78, G.time * 2, 0.6, 1, 1, G.dash.cd > 0 ? 0.4 : 0.9); // dimmer ring = dash on cooldown
  }

  // ---------------------------------------------------------------------
  // combat HUD
  // ---------------------------------------------------------------------
  function commas(n) { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function drawCombatHUD() {
    hud.fillStyle = UI_CYAN;
    hud.font = '600 46px Consolas, monospace';
    hud.textAlign = 'right';
    hud.fillText(commas(G.score), W - 34, 26);
    hud.font = '600 24px Consolas, monospace';
    hud.fillStyle = UI_DIM();
    hud.fillText('HI ' + commas(Run.meta.hi), W - 34, 82);
    hud.fillStyle = UI_GOLD;
    hud.font = '700 30px Consolas, monospace';
    hud.fillText(commas(G.wallet) + ' g', W - 34, 116);

    hud.textAlign = 'left';
    hud.font = '700 42px Consolas, monospace';
    hud.fillStyle = G.mult > 1.01 ? UI_GOLD : UI_DIM();
    hud.fillText('x' + G.mult.toFixed(G.mult >= 3 ? 1 : 2), 40, 26);
    hud.font = '600 24px Consolas, monospace';
    hud.fillStyle = UI_CYAN;
    hud.fillText('GRAZE ' + G.graze, 40, 74);
    drawHubris();

    hud.textAlign = 'center';
    hud.font = '600 26px Consolas, monospace';
    hud.fillStyle = UI_CYAN;
    var stxt = 'SECTOR ' + (Run.sectorIdx + 1) + '/3';
    if (G.aff.name) stxt += '   ·   ' + G.aff.name;
    hud.fillText(stxt, W / 2, 116);

    drawGauge();
    drawSpecialMeter();
    drawLives();
    if (G.boss) drawBossBar();
    drawLoadout();
    drawGodTags();
    drawPopups();
    drawAnnounce();
  }

  // HUBRIS meter — the persistent multiplier + a thin stepped progress bar, sat
  // under the score/graze cluster so it reads at a glance and stays out of the
  // playfield. Small footprint (Bounds, binding). Hubris-gold tint.
  function drawHubris() {
    var h = G.hubris, mult = HUBRIS_MULT[h.step];
    // Stacked BELOW the GRAZE counter with clear spacing so the label + pips no
    // longer collide with the graze cluster (score / graze / hubris read cleanly).
    var x = 40, y = 152;
    hud.textAlign = 'left';
    hud.font = '600 18px Consolas, monospace';
    hud.fillStyle = UI_DIM();
    hud.fillText('HUBRIS', x, y - 28);
    hud.font = '700 32px Consolas, monospace';
    hud.fillStyle = h.step > 0 ? HUBRIS_COL : UI_DIM();
    hud.fillText('x' + mult.toFixed(1), x, y);
    // five step pips: lit for steps gained, the next pip fills by partial progress.
    var px = x + 108, py = y - 22, pw = 24, ph = 13, gap = 6;
    for (var i = 0; i < HUBRIS_MAX; i++) {
      var sx = px + i * (pw + gap);
      hud.fillStyle = 'rgba(52,40,12,0.75)';
      roundRect(hud, sx, py, pw, ph, 3); hud.fill();
      var f = i < h.step ? 1 : (i === h.step ? h.prog : 0);
      if (f > 0) { hud.fillStyle = HUBRIS_COL; roundRect(hud, sx, py, pw * f, ph, 3); hud.fill(); }
    }
  }

  function drawGauge() {
    var x = 26, y = 300, w = 20, h = H - 620;
    var v = G.vaunt;
    var frac = v.active ? (v.timer / v.duration) : (v.gauge / GAUGE_MAX);
    hud.fillStyle = 'rgba(20,40,50,0.7)';
    roundRect(hud, x, y, w, h, 8); hud.fill();
    var fh = h * frac;
    var grd = hud.createLinearGradient(0, y + h, 0, y + h - fh);
    if (v.active) { grd.addColorStop(0, '#ffb020'); grd.addColorStop(1, '#fff0a0'); }
    else if (v.ready) { grd.addColorStop(0, '#ffd050'); grd.addColorStop(1, '#fffff0'); }
    else { grd.addColorStop(0, '#0a86b0'); grd.addColorStop(1, '#6fe6ff'); }
    hud.fillStyle = grd;
    roundRect(hud, x, y + h - fh, w, fh, 8); hud.fill();
    hud.save();
    hud.translate(x + w + 14, y + h); hud.rotate(-Math.PI / 2);
    hud.textAlign = 'left'; hud.font = '700 22px Consolas, monospace';
    if (v.active) { hud.fillStyle = UI_GOLD; hud.fillText('APOTHEOSIS', 0, 0); }
    else if (v.ready) { var pl = 0.5 + 0.5 * Math.sin(G.time * 8); hud.fillStyle = 'rgba(255,225,110,' + (0.5 + 0.5 * pl) + ')'; hud.fillText('APOTHEOSIS — C', 0, 0); }
    else { hud.fillStyle = UI_DIM(); hud.fillText('APOTHEOSIS', 0, 0); }
    hud.restore();
  }
  // special charge meter: segmented pips beside the apotheosis bar
  function drawSpecialMeter() {
    var x = 60, y = 300, w = 20, h = H - 620;
    var max = G.sp.max, charge = G.sp.charge;
    var gap = 6, segH = (h - gap * (max - 1)) / max;
    for (var i = 0; i < max; i++) {
      var sy = y + h - (i + 1) * segH - i * gap;
      var full = charge >= i + 1;
      var part = !full && charge > i ? (charge - i) : 0;
      hud.fillStyle = 'rgba(30,20,50,0.7)';
      roundRect(hud, x, sy, w, segH, 6); hud.fill();
      if (full || part > 0) {
        var gr = hud.createLinearGradient(0, sy + segH, 0, sy);
        gr.addColorStop(0, '#8a2bff'); gr.addColorStop(1, '#d89bff');
        hud.fillStyle = gr;
        var ph = full ? segH : segH * part;
        roundRect(hud, x, sy + segH - ph, w, ph, 6); hud.fill();
      }
    }
    hud.save();
    hud.translate(x + w + 14, y + h); hud.rotate(-Math.PI / 2);
    hud.textAlign = 'left'; hud.font = '700 22px Consolas, monospace';
    hud.fillStyle = G.sp.charge >= 1 ? '#d89bff' : UI_DIM();
    hud.fillText('SPECIAL — X', 0, 0);
    hud.restore();
  }
  function drawLives() {
    var y = H - 70;
    for (var i = 0; i < G.lives; i++) {
      var x = 46 + i * 56;
      hud.save(); hud.translate(x, y); hud.fillStyle = UI_CYAN;
      hud.beginPath(); hud.moveTo(0, -20); hud.lineTo(16, 16); hud.lineTo(0, 6); hud.lineTo(-16, 16); hud.closePath(); hud.fill();
      hud.restore();
    }
  }
  function drawBossBar() {
    var e = G.boss, x = 120, y = 40, w = W - 240, h = 16, by = y + 60;
    var frac = Math.max(0, e.hp / e.maxhp);
    hud.textAlign = 'center'; hud.font = '700 30px Consolas, monospace'; hud.fillStyle = UI_GOLD;
    hud.fillText(e.name, W / 2, 60);
    hud.fillStyle = 'rgba(40,10,25,0.7)'; roundRect(hud, x, by, w, h, 6); hud.fill();
    var grd = hud.createLinearGradient(x, 0, x + w, 0); grd.addColorStop(0, '#ff3b7b'); grd.addColorStop(1, '#ffd766');
    hud.fillStyle = grd; roundRect(hud, x, by, w * frac, h, 6); hud.fill();
    // segment ticks — one per spellcard boundary (remaining-hp fraction = 1 - cum),
    // plus a phase counter so the setlist reads on the bar.
    var bounds = e.segBounds;
    if (bounds) {
      hud.strokeStyle = 'rgba(6,10,14,0.85)'; hud.lineWidth = 3;
      for (var i = 0; i < bounds.length - 1; i++) {
        var tx = x + w * (1 - bounds[i]);
        hud.beginPath(); hud.moveTo(tx, by - 2); hud.lineTo(tx, by + h + 2); hud.stroke();
      }
      // PHASE counter sits at the bar's LEFT edge, BELOW it — clear of the top-right
      // HI/score block, which it used to overlap once HI grew to 7+ digits.
      hud.textAlign = 'left'; hud.font = '700 20px Consolas, monospace'; hud.fillStyle = UI_CYAN;
      hud.fillText('PHASE ' + (e.phase + 1) + '/' + bounds.length, x, by + h + 26);
    }
    // MIDAS GOLD-THEFT hoard readout — a small gold-tinted counter; the eaten loot
    // erupts back as a jackpot when he dies. Sits to the RIGHT of the PHASE counter
    // on the same below-bar row (offset clears the widest 'PHASE n/N').
    if (e.isMidas) {
      hud.textAlign = 'left'; hud.font = '700 22px Consolas, monospace';
      hud.fillStyle = e.hoardCount > 0 ? UI_GOLD : 'rgba(255,215,102,0.5)';
      hud.fillText('◆ HOARD ' + e.hoardCount, x + 220, by + h + 26);
    }
  }
  function tierStars(R) {
    var t = R >= 3.5 ? 5 : R >= 2.9 ? 4 : R >= 2.25 ? 3 : R >= 1.5 ? 2 : 1;
    var s = ''; for (var i = 0; i < t; i++) s += '★'; return s;
  }
  function drawGodTags() {
    var gods = Run.GODS;
    hud.textAlign = 'right'; hud.font = '700 24px Consolas, monospace';
    var y = 150;
    if (G.attackGod && gods[G.attackGod]) { hud.fillStyle = gods[G.attackGod].css; hud.fillText('ATK ▸ ' + gods[G.attackGod].name + ' ' + tierStars(G.attackR), W - 34, y); y += 30; }
    if (G.specialGod && gods[G.specialGod]) { hud.fillStyle = gods[G.specialGod].css; hud.fillText('SPC ▸ ' + gods[G.specialGod].name + ' ' + tierStars(G.specialR), W - 34, y); y += 30; }
    // Ares frenzy pips
    if (G.frenzy.stacks > 0) {
      hud.textAlign = 'right';
      for (var i = 0; i < 10; i++) {
        hud.fillStyle = i < G.frenzy.stacks ? '#ff4030' : 'rgba(120,40,40,0.4)';
        hud.beginPath(); hud.arc(W - 40 - i * 16, y + 6, 5, 0, Math.PI * 2); hud.fill();
      }
      y += 20;
    }
    // Pantheon Communion badge
    if (G.communion) {
      hud.textAlign = 'right'; hud.font = '700 22px Consolas, monospace';
      var cc = { OLYMPUS: '#9fd8ff', ASGARD: '#cfd6e0', KEMET: '#ffe89a' };
      hud.fillStyle = cc[G.communion] || '#ffd766';
      hud.fillText('✦ COMMUNION · ' + G.communion, W - 34, y + 8);
    }
  }
  function drawLoadout() {
    var lines = Game.upgradeSummary();
    hud.textAlign = 'right';
    var y = 244;
    hud.font = '500 22px Consolas, monospace';
    for (var i = 0; i < lines.length; i++) { hud.fillStyle = 'rgba(150,220,235,0.7)'; hud.fillText(lines[i], W - 34, y + i * 26); }
    var dy = y + lines.length * 26 + 6;
    if (Run.DUOS) {
      hud.font = '700 20px Consolas, monospace';
      for (var k in G.duos) {
        if (G.duos[k] && Run.DUOS[k]) { hud.fillStyle = '#ffd766'; hud.fillText('◆ ' + Run.DUOS[k].name, W - 34, dy); dy += 24; }
      }
    }
  }
  function drawPopups() {
    hud.textAlign = 'center'; var arr = G.popups;
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i]; if (!p.active) continue;
      hud.globalAlpha = 1 - p.age / p.life; hud.fillStyle = p.col; hud.font = '700 ' + p.size + 'px Consolas, monospace';
      hud.fillText(p.text, p.x, p.y);
    }
    hud.globalAlpha = 1;
  }
  function drawAnnounce() {
    var an = G.announce;
    if (an.dur >= 9000 || an.t >= an.dur) return;
    var f = an.t / an.dur;
    var a = f < 0.15 ? f / 0.15 : (f > 0.7 ? Math.max(0, (1 - f) / 0.3) : 1);
    hud.globalAlpha = a; hud.textAlign = 'center';
    hud.fillStyle = UI_GOLD; hud.font = '700 66px Consolas, monospace';
    drawSpaced(an.text, W / 2, H * 0.30, 10 + (1 - a) * 30);
    if (an.sub) { hud.fillStyle = UI_CYAN; hud.font = '500 30px Consolas, monospace'; hud.fillText(an.sub, W / 2, H * 0.30 + 66); }
    hud.globalAlpha = 1;
  }
  function drawSpaced(text, cx, y, spacing) {
    var total = 0, i;
    hud.textAlign = 'left';
    for (i = 0; i < text.length; i++) total += hud.measureText(text[i]).width + spacing;
    total -= spacing;
    var x = cx - total / 2;
    for (i = 0; i < text.length; i++) { hud.fillText(text[i], x, y); x += hud.measureText(text[i]).width + spacing; }
    hud.textAlign = 'center';
  }
  function pauseOverlay() {
    hud.fillStyle = 'rgba(0,0,0,0.55)'; hud.fillRect(0, 0, W, H);
    hud.textAlign = 'center'; hud.fillStyle = UI_CYAN; hud.font = '700 80px Consolas, monospace';
    drawSpaced('PAUSED', W / 2, H * 0.42, 12);
    hud.fillStyle = UI_DIM(); hud.font = '500 34px Consolas, monospace';
    hud.fillText('Z / P / Esc — resume   ·   X — abandon to title', W / 2, H * 0.42 + 90);
  }
  function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2; if (h < 2 * r) r = h / 2;
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Game.boot);
  else Game.boot();

})();
