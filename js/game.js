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
    boltsClear();
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
        fireT: 0, respawnT: 0, dead: false, drones: [], recoil: 0, hammerT: 0, volleyN: 0
      },
      vaunt: { gauge: (opts.gaugePct || 0) * GAUGE_MAX, active: false, timer: 0, duration: VAUNT_DUR, killCount: 0, mercy: 0, ready: (opts.gaugePct || 0) >= 1 },
      // special weapon
      sp: { charge: 3, max: 3, flash: 0 },
      // god boons
      attackGod: null, attackR: 1,
      specialGod: null, specialR: 1,
      // ULTIMATES (§2.5) — the C-key burst slot. ultimateGod null => DIVINE
      // INTERVENTION default (freeze->gild). Otherwise the equipped god's ultimate.
      ultimateGod: null,
      communion: null,
      mods: {
        zeusChain: 0, zeusCrit: false, zeusFork: false, zeusField: false,
        poseidonBig: false, poseidonDrag: false, poseidonSplash: false, poseidonForce: false,
        artemisCrit: 0, artemisRefund: false, artemisSpread: false, artemisMulti: false,
        aphroLong: false, aphroExplode: false, aphroTaunt: false, aphroFast: false,
        aresDecay: false, aresCharge: false, aresTerror: false, aresSpoils: false,
        heimVigil: false, heimPrism: false, heimHorn: false, heimEcho: false,
        raRamp: false, raSpread: false, raSplit: false, raBurn: false,
        anubisHeavy: false, anubisFeast: false, anubisRefund: false, anubisShard: false,
        lokiLong: false, lokiBoom: false, lokiVaunt: false, lokiChance: false,
        odinRaven: false, odinMark: false, odinRavenMark: false, odinGungnir: false,
        wukongClones: false, wukongStaff: false, wukongSpecial: false, wukongChance: false,
        quetzBig: false, quetzGold: false, quetzCircle: false, quetzPierce: false,
        thorBelt: false, thorFast: false, thorGauntlet: false, thorSkymark: false,
        guanWide: false, guanOath: false, guanWake: false, guanSpoils: false,
        jadeOften: false, jadeStun: false, jadeMirror: false, jadeTribute: false
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
      // ARES WAR-HEAT: frenzyF (0..1) is the real proximity meter; stacks = round(frenzyF*10)
      // is kept in lockstep so every existing consumer (HUD pips, frenzyRate, mods) keeps working.
      frenzy: { stacks: 0, decayT: 0, frenzyF: 0, boost: 0, pinT: 0, graceT: 0, prevTier: 0, bloom: 0 },
      thorBuff: 0,
      hammers: [],
      // ARTEMIS THE HUNT — the Hunted brand lives here (a pointer + ramp), not per-enemy,
      // so it survives target motion and chains cleanly. huntSwap/huntStray = sticky counter.
      hunt: { foe: null, foeSeq: 0, stacks: 0, stackT: 0, stray: null, straySeq: 0, swap: 0 },
      // HEIMDALL THE BIFRÖST — a drawn hazard (not a pooled entity): t = cadence clock,
      // seamT = telegraph clock, x = band's vertical-seam player-x, life = band remaining once solid.
      bifrost: { t: 0, seamT: 0, x: 0, life: 0, active: false },
      // JADE EMPEROR IMPERIAL JUDGEMENT — twin storm-clouds (owned entities, §5) that hurl
      // alternating chain-bolts at random foes; jadeMirror banks bolts to the strongest.
      judge: { active: false, timer: 0, boltT: 0, side: 0 },
      jclouds: [],
      // ANUBIS GATE OF DUAT — a sand-vortex gate at the field bottom that drags the wounded.
      duat: { active: false, x: 0, y: 0, timer: 0, dur: 0 },
      // DIVINE INTERVENTION two-beat staging — enemy bullets FREEZE this many seconds (held
      // shimmer beat) before the gild; bfMidas = the pending cursed-gild flag; bfMandate =
      // the pending JADE MANDATE flag (the gild also fires gold bolts + pays +25%).
      bfreeze: 0, bfMidas: false, bfMandate: false,
      // ULTIMATES runtime (§2.5) — G.ult holds the ONE live TIMED ultimate: god = which
      // shape is running ('' = none), t = seconds left. Instant ults (ZEUS/ANUBIS) and
      // MANDATE (JADE, which rides the default gild) leave G.ult.god ''. Entity pose fields
      // (barque / doppel / dragon head / giant hammer center) share x/y/ang/castT/trail.
      // Cleared at wave boundary (startClearBeat) + on ultimate-swap (endUltimate).
      ult: { god: '', t: 0, x: 0, y: 0, ang: 0, castT: 0, trail: null, bossT: 0, cd: 0 },
      // god entities
      ra: { active: false, target: null, targetSeq: 0, ramp: 0, hold: 0, graceT: 0, tier: 0, tx: 0, ty0: 0, ty1: 0 },
      decoy: { active: false, x: 0, y: 0, timer: 0, absorb: 0 },
      ravens: [], ravenKills: 0,
      gungnir: { active: false, x: 0, y: 0, timer: 0, tx: 0, ty: 0, ang: 0, visited: [] },
      wraiths: [],
      clones: [],
      debris: [],
      // god-special timers: Ra apotheosis surge, Gjallarhorn echo, Verdict 2nd wave + peach window
      raSurgeT: 0, hornEchoT: 0, verdictPeachT: 0,
      skyfall: { x: 0, t: 0 },   // ZEUS SKYFALL — transient column draw (~0.22s)
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
      announce: { text: '', sub: '', t: 0, dur: 0, art: '' }
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
  function announce(text, sub, dur, art) { G.announce.text = text; G.announce.sub = sub || ''; G.announce.t = 0; G.announce.dur = dur || 2.6; G.announce.art = art || ''; }

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
  // ---------------------------------------------------------------------
  // LIGHTNING — one shared bolt renderer for EVERY lightning user (Zeus chain
  // + SKYFALL forks, IMPERIAL JUDGEMENT cloud bolts, jadeMirror banked bolts,
  // duo arcs, HAVOC clone chains, OLYMPIAN STORM). Recursive midpoint-
  // displacement paths (never a uniform zigzag) with fading side-branches, a
  // two-pass draw (wide soft haze under a thin white-hot core), impact/origin
  // flashes, and a ~90-140ms flicker of 2-3 re-strikes that re-randomise the
  // path. Fully pooled — fixed Float32 buffers, no per-frame allocation. Three
  // owner-pickable styles behind GL.setLightningStyle('A'|'B'|'C'). Kept UNDER
  // the enemy-bullet bodies (drawn in render Pass A) and capped so player FX
  // never obscures danmaku (DANMAKU.md readability law).
  // ---------------------------------------------------------------------
  var BOLT_MAX = 40;         // simultaneous bolts (readability cap)
  var BOLT_PTS = 40;         // max points per leg (<=5 subdivisions -> 33)
  var BOLT_BRPTS = 12;       // max points per side-branch
  var BOLT_SEG_CAP = 640;    // hard per-frame drawn-segment cap (readability)
  var _bScrA = new Float32Array(BOLT_PTS * 2);   // midpoint-displacement scratch
  var _bScrB = new Float32Array(BOLT_PTS * 2);
  var bolts = [];
  (function initBolts() {
    for (var i = 0; i < BOLT_MAX; i++) {
      bolts.push({
        active: false, legN: 1, bank: false, sheet: false,
        ax: 0, ay: 0, jx: 0, jy: 0, bx: 0, by: 0,
        r: 0.7, g: 0.9, b: 1, r1: 1, g1: 0.85, b1: 0.4,
        coreW: 7, hazeW: 22, rough: 0.22, levels: 4, branches: 0, impact: 1,
        delay: 0, t: 0, age0: 0, strikeDur: 0.033, strikesLeft: 2, alpha: 1,
        L1n: 0, L1: new Float32Array(BOLT_PTS * 2),
        L2n: 0, L2: new Float32Array(BOLT_PTS * 2),
        brN: [0, 0], brPts: [new Float32Array(BOLT_BRPTS * 2), new Float32Array(BOLT_BRPTS * 2)],
        minX: 0, maxX: 0, minY: 0, maxY: 0
      });
    }
  })();
  // Recursive midpoint displacement A->B into dst (interleaved x,y). Displacement
  // is proportional to each segment's own length (so it halves as segments halve)
  // scaled by `rough`, decreasing naturally per subdivision level. Returns #points.
  function genPath(dst, ax, ay, bx, by, levels, rough) {
    var src = _bScrA, tmp = _bScrB, sw;
    src[0] = ax; src[1] = ay; src[2] = bx; src[3] = by;
    var n = 2, cap = dst.length >> 1;
    for (var lv = 0; lv < levels; lv++) {
      if (n * 2 - 1 > cap) break;
      var m = 0;
      for (var i = 0; i < n - 1; i++) {
        var x0 = src[i * 2], y0 = src[i * 2 + 1], x1 = src[i * 2 + 2], y1 = src[i * 2 + 3];
        tmp[m * 2] = x0; tmp[m * 2 + 1] = y0; m++;
        var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var d = (Math.random() - 0.5) * len * rough;
        tmp[m * 2] = (x0 + x1) * 0.5 - dy / len * d;
        tmp[m * 2 + 1] = (y0 + y1) * 0.5 + dx / len * d;
        m++;
      }
      tmp[m * 2] = src[(n - 1) * 2]; tmp[m * 2 + 1] = src[(n - 1) * 2 + 1]; m++;
      n = m; sw = src; src = tmp; tmp = sw;
    }
    var lim = n * 2;
    for (var k = 0; k < lim; k++) dst[k] = src[k];
    return n;
  }
  // (re-)randomise a bolt's whole path: both legs + side-branches + bounding box.
  function boltGen(b) {
    b.L1n = genPath(b.L1, b.ax, b.ay, b.legN === 2 ? b.jx : b.bx, b.legN === 2 ? b.jy : b.by, b.levels, b.rough);
    b.L2n = b.legN === 2 ? genPath(b.L2, b.jx, b.jy, b.bx, b.by, b.levels, b.rough) : 0;
    // side-branches fork off interior points of the TARGET leg, fading faster
    var tl = b.legN === 2 ? b.L2 : b.L1, tn = b.legN === 2 ? b.L2n : b.L1n;
    b.brN[0] = 0; b.brN[1] = 0;
    for (var k = 0; k < b.branches && tn > 3; k++) {
      var idx = 1 + ((Math.random() * (tn - 2)) | 0);
      var px = tl[idx * 2], py = tl[idx * 2 + 1];
      var pdx = tl[idx * 2 + 2] - tl[idx * 2 - 2], pdy = tl[idx * 2 + 3] - tl[idx * 2 - 1];
      var ang = Math.atan2(pdy, pdx) + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7);
      var blen = 40 + Math.random() * 70;
      b.brN[k] = genPath(b.brPts[k], px, py, px + Math.cos(ang) * blen, py + Math.sin(ang) * blen, 3, b.rough * 1.1);
    }
    // bounding column (variant-C sheet + readability box)
    var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, i, x, y;
    for (i = 0; i < b.L1n; i++) { x = b.L1[i * 2]; y = b.L1[i * 2 + 1]; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
    for (i = 0; i < b.L2n; i++) { x = b.L2[i * 2]; y = b.L2[i * 2 + 1]; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
    b.minX = mnx; b.maxX = mxx; b.minY = mny; b.maxY = mxy;
  }
  function applyBoltStyle(b, opts) {
    var st = GL.lightningStyle, big = opts && opts.big;
    if (st === 'B' || st === 'C') { b.levels = 5; b.rough = 0.34; b.coreW = 10; b.hazeW = 30; b.branches = 2; b.strikesLeft = 3; b.impact = 1.4; b.sheet = (st === 'C'); }
    else { b.levels = 4; b.rough = 0.22; b.coreW = 7; b.hazeW = 22; b.branches = 0; b.strikesLeft = 2; b.impact = 1.0; b.sheet = false; }
    if (big) { if (b.branches < 1) b.branches = 1; b.impact *= 1.3; b.coreW += 2; b.sheet = b.sheet || (st === 'C'); }
    b.strikeDur = (0.10 + (big ? 0.03 : 0)) / (b.strikesLeft + 1);   // ~90-140ms total across strikes
  }
  // Spawn a single-leg bolt A->B tinted `col`. opts: {big, delay}. Pooled.
  function boltSpawn(ax, ay, bx, by, col, opts) {
    var b = null;
    for (var i = 0; i < BOLT_MAX; i++) if (!bolts[i].active) { b = bolts[i]; break; }
    if (!b) return null;
    b.active = true; b.legN = 1; b.bank = false;
    b.ax = ax; b.ay = ay; b.bx = bx; b.by = by;
    b.r = col[0]; b.g = col[1]; b.b = col[2]; b.r1 = b.r; b.g1 = b.g; b.b1 = b.b;
    applyBoltStyle(b, opts);
    b.delay = (opts && opts.delay) || 0; b.t = 0; b.age0 = 0; b.alpha = 1;
    if (!b.delay) boltGen(b);
    return b;
  }
  // Two-leg banked bolt (jadeMirror): origin->bank->target with a bank-flash at
  // the join; leg1 and leg2 carry their own tints.
  function boltBanked(ax, ay, jx, jy, bx, by, col1, col2) {
    var b = boltSpawn(ax, ay, bx, by, col2, 0);
    if (!b) return null;
    b.legN = 2; b.bank = true; b.jx = jx; b.jy = jy;
    b.r1 = col1[0]; b.g1 = col1[1]; b.b1 = col1[2];
    boltGen(b);
    return b;
  }
  // Legacy entry point — every existing caller (chain lightning, SKYFALL forks,
  // duo arcs, HAVOC, boss telegraphs, hazards) routes through the bolt system.
  function arcFx(x1, y1, x2, y2, col) { boltSpawn(x1, y1, x2, y2, col, 0); }
  function updateBolts(dt) {
    for (var i = 0; i < BOLT_MAX; i++) {
      var b = bolts[i]; if (!b.active) continue;
      if (b.delay > 0) { b.delay -= dt; if (b.delay <= 0) boltGen(b); else continue; }
      b.t += dt; b.age0 += dt;
      if (b.t >= b.strikeDur) {
        if (b.strikesLeft > 0) { b.strikesLeft--; b.t = 0; b.alpha *= 0.7; boltGen(b); }   // re-strike: fresh path, decayed alpha
        else b.active = false;
      }
    }
  }
  function boltsClear() { for (var i = 0; i < BOLT_MAX; i++) bolts[i].active = false; }
  // two-pass leg draw: wide soft haze under a thin white-hot core. Returns #segs.
  function drawBoltLeg(b, arr, n, env, r, g, bb) {
    if (n < 2) return 0;
    var cw = b.coreW, hw = b.hazeW;
    var wr = r * 0.35 + 0.65, wg = g * 0.35 + 0.65, wb = bb * 0.35 + 0.65;   // white-hot core
    var segs = 0;
    for (var i = 0; i < n - 1; i++) {
      var x0 = arr[i * 2], y0 = arr[i * 2 + 1], x1 = arr[i * 2 + 2], y1 = arr[i * 2 + 3];
      var dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy); if (len < 0.5) continue;
      var mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5, rot = Math.atan2(-dx, dy);   // STREAK long axis (local +y) -> segment dir
      GL.draw(GL.SPR.STREAK, mx, my, hw, len * 1.2, rot, r, g, bb, 0.15 * env);         // soft coloured haze
      GL.draw(GL.SPR.STREAK, mx, my, cw, len * 1.05, rot, wr, wg, wb, 0.92 * env);      // thin white-hot core
      segs++;
    }
    return segs;
  }
  function drawBoltEnds(b, env) {
    var im = b.impact;
    GL.draw(GL.SPR.GLOW, b.bx, b.by, 62 * im, 62 * im, 0, b.r, b.g, b.b, 0.32 * env);   // impact haze
    GL.draw(GL.SPR.RING, b.bx, b.by, 48 * im, 48 * im, 0, b.r, b.g, b.b, 0.5 * env);    // impact ring pop
    GL.draw(GL.SPR.SPARK, b.bx, b.by, 40 * im, 40 * im, b.age0 * 8, 1, 1, 1, 0.5 * env);
    GL.draw(GL.SPR.CORE, b.bx, b.by, 15, 15, 0, 1, 1, 1, 0.9 * env);                    // white-hot impact
    GL.draw(GL.SPR.GLOW, b.ax, b.ay, 30, 30, 0, b.r1, b.g1, b.b1, 0.28 * env);          // origin muzzle glint
    GL.draw(GL.SPR.CORE, b.ax, b.ay, 11, 11, 0, b.r1, b.g1, b.b1, 0.6 * env);
    if (b.bank) {                                                                        // mirror bank-flash at the join
      GL.draw(GL.SPR.GLOW, b.jx, b.jy, 82, 82, 0, b.r1, b.g1, b.b1, 0.42 * env);
      GL.draw(GL.SPR.RING, b.jx, b.jy, 62, 62, b.age0 * 6, b.r1, b.g1, b.b1, 0.6 * env);
      GL.draw(GL.SPR.CORE, b.jx, b.jy, 20, 20, 0, 1, 0.95, 0.8, 0.85 * env);
    }
  }
  function drawBolts() {
    var drawn = 0;
    for (var i = 0; i < BOLT_MAX; i++) {
      var b = bolts[i]; if (!b.active || b.delay > 0) continue;
      var f = 1 - b.t / b.strikeDur; if (f < 0) f = 0;
      var env = b.alpha * (0.35 + 0.65 * f * f);   // per-strike flicker envelope
      if (b.sheet && b.age0 < 0.06) {              // variant C: fast column glow-sheet (~60ms)
        var sa = (1 - b.age0 / 0.06) * 0.15 * b.alpha;
        GL.draw(GL.SPR.GLOW, (b.minX + b.maxX) * 0.5, (b.minY + b.maxY) * 0.5, (b.maxX - b.minX) + 96, (b.maxY - b.minY) + 44, 0, b.r, b.g, b.b, sa);
      }
      drawn += drawBoltLeg(b, b.L1, b.L1n, env, b.r1, b.g1, b.b1);
      if (b.legN === 2) drawn += drawBoltLeg(b, b.L2, b.L2n, env, b.r, b.g, b.b);
      for (var k = 0; k < b.branches; k++) if (b.brN[k] > 1) drawn += drawBoltLeg(b, b.brPts[k], b.brN[k], env * 0.6, b.r, b.g, b.b);
      drawBoltEnds(b, env);
      if (drawn > BOLT_SEG_CAP) break;
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
    // §2.5 ULTIMATES — the C-key burst dispatches to the equipped ultimate. Every
    // non-JADE ultimate replaces the gild with its own shape (castUltimate consumes
    // the gauge). JADE's MANDATE is the default's strict UPGRADE, so it falls through
    // to the DIVINE INTERVENTION body below with the mandate flag armed.
    var ug = G.ultimateGod;
    if (ug && ug !== 'jade') { castUltimate(ug); return; }
    G.bfMandate = (ug === 'jade');   // captured for the gild flush (fires gold bolts + pays +25%)
    v.active = true;
    v.duration = VAUNT_DUR + G.up.vdur + (G.communion === 'OLYMPUS' ? 2 : 0);
    v.timer = v.duration; v.killCount = 0; v.ready = false;
    G.mult = 3; G.multDecayT = 0;
    G.player.invuln = Math.max(G.player.invuln, VAUNT_SHIELD);
    // DIVINE INTERVENTION two-beat staging (owner-ruled): all enemy bullets FREEZE in
    // place for a held shimmer beat (~0.3s), THEN gild to gold (updateCombat flushes the
    // beat via cancelBulletsToGold — identical gold/cancel math). The burst already grants
    // invuln, so the frozen bullets can't damage the player during the beat.
    G.bfreeze = 0.3; G.bfMidas = midasFight();
    if (SFX.freezeShimmer) SFX.freezeShimmer();   // Pass4: DIVINE INTERVENTION held-freeze shimmer beat
    Engine.bullets.forEach(function (b) { if (!b.friendly) { b.slowT = 0.3; b.timeScale = 0; } });
    ringShock(G.player.x, G.player.y, [1, 0.85, 0.35], 60, 3200, 0.6);
    ringShock(G.player.x, G.player.y, [0.4, 0.95, 1], 40, 2400, 0.45);
    flash(G.player.x, G.player.y, [1, 0.95, 0.7], 260, 0.3);
    addShake(7);
    G.chromaTarget = 0.009; G.bloomTarget = 1.9;   // POLISH: chroma capped so bullet color families survive the burst
    announce('DIVINE INTERVENTION', '', 1.2);
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
        G.frenzy.pinT = G.mods.aresDecay ? 3.0 : 1.5;   // pin max War-Heat for the apotheosis window (updateFrenzy honors pinT)
        break;
      case 'ra':            // ignite all + beam surges to full ramp for 4s
        each(function (e) { applyBurn(e, 20 * R, 3.0); });
        G.raSurgeT = 4;
        break;
      case 'anubis':        // THE WEIGHING: DIVINE INTERVENTION tips every foe's scales at once
        each(function (e) { anubisVerdict(e); });
        break;
      case 'loki':          // Loki rider: free decoy + boss Weaken (CONFUSE removed, ruling 1; PILFER arrives Pass 2)
        each(function (e) { if (e.boss) { e.weak = true; e.weakT = 6; } });
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
      case 'jade': {        // mass Stun 1.2s (bosses take damage instead) + an edict fan burst
        each(function (e) {
          if (e.boss) damageEnemy(e, 12 * G.stats.atkDmg * R, false);
          else { e.stunT = Math.max(e.stunT, 1.2); flash(e.x, e.y, [0.8, 0.6, 1], 60, 0.2); }
        });
        fireJadeEdicts(p.x, p.y, false, 1.5);
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
      addPopup(W / 2, H * 0.42, 'DIVINE INTERVENTION BONUS  +' + commas(_payGain), UI_GOLD, 46);   // post-HUBRIS (fix #3)
      announce('DIVINE INTERVENTION BONUS', v.killCount + ' kills  x' + G.mult.toFixed(1), 2.2);
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
  function cancelBulletsToGold(midas, mandate) {
    // JADE MANDATE OF HEAVEN (§2.5): the gild is the default's strict upgrade — each
    // converted bullet ALSO fires a gold bolt (flipDmg-class) at the nearest foe and
    // pays +25% gold. mandate is armed only for a JADE ultimate cast (never on the
    // wave-clear / MIDAS-phase cancels that share this path).
    var val = mandate ? 0.5 * 1.25 : 0.5, n = 0;
    var boltDmg = 2.0 * G.attackR * G.stats.atkDmg * 1.5;   // flipDmg-class
    // §5 fix: cap the gold-bolt burst so a dense-screen gild can't fill the 384-slot
    // shots pool and starve the player's own weapon for the bolts' ~0.9s lifetime.
    var boltsLeft = mandate ? 64 : 0;
    Engine.bullets.forEach(function (b) {
      if (Engine.gold.freeTop > 0) spawnGold(b.x, b.y, 1, val, 0, 0, midas);
      flash(b.x, b.y, midas ? [1, 0.72, 0.22] : [1, 0.8, 0.3], 22, 0.12);
      if (mandate && boltsLeft > 0) {
        var tgt = nearestEnemy(b.x, b.y);
        if (tgt) { var s = allocShot(); if (s) { var a = Math.atan2(tgt.y - b.y, tgt.x - b.x); s.x = b.x; s.y = b.y; s.vx = Math.cos(a) * 1300; s.vy = Math.sin(a) * 1300; s.radius = 12; s.scale = 30; s.damage = boltDmg; s.age = 0; s.life = 0.9; s.r = 1; s.g = 0.85; s.b = 0.4; s.pierce = 0; s.kind = 0; s.faction = 0; s.big = false; s.homing = true; s.turn = 3.0; s.mandateBolt = true; boltsLeft--; } }   // §6 fix: mandateBolt = a plain flipDmg strike, NOT a full attack-god proc
      }
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
    else if (g === 'anubis') gateOfDuat();
    else if (g === 'loki') shadowTwin();
    else if (g === 'odin') gungnirCast();
    else if (g === 'wukong') staffSlam();
    else if (g === 'quetz') skySerpent(false);
    else if (g === 'thor') giantsBane();
    else if (g === 'guanyu') crescentSweep();
    else if (g === 'jade') imperialJudgement();
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
    s.mandateBolt = false;                     // §6: recycled slot must never inherit a prior MANDATE-bolt's proc-suppression
    s.markHit = false; s.forceCrit = 0;
    s.huntHome = false; s.loosed = false; s.brandedFirst = false;
    resetShotHits(s);
    return s;
  }
  // §9a pierce-dedup reset — clear the lifetime hit budget and stamp a fresh unique
  // fireId so a recycled pool slot never inherits a prior shot's budget or identity.
  // fireIds start at 1 (++fireIdCounter), so 0 is a safe "never hit" sentinel on the
  // enemy (e.lastHitFireId). No wraparound handling needed at realistic fire rates.
  var fireIdCounter = 0;
  function resetShotHits(s) { s.hitN = 0; s.fireId = ++fireIdCounter; }
  // Stamp a counted, deduped hit: mark this exact shot on the enemy so it can never
  // re-bite it, and count the distinct hit toward the shot's lifetime pierce budget.
  function stampHit(s, e) { e.lastHitFireId = s.fireId; s.hitN++; }

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
  // ZEUS SKYFALL — instant column strike (no projectile), then a storm chain.
  function stormBolt() {
    var p = G.player;
    var colX = p.x, near = null, bd = 140 * 140;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; var dx = e.x - p.x, dy = e.y - p.y; var d = dx * dx + dy * dy; if (Math.abs(e.x - p.x) < 140 && d < bd) { bd = d; near = e; } });
    if (near) colX = near.x;
    var d = LANCE_DMG * 2.4 * G.stats.spDmg * G.specialR;
    var primary = null;
    Engine.enemies.forEach(function (e) {
      if (e.dying || e.charmed) return;
      if (Math.abs(e.x - colX) < 55) { damageEnemy(e, d, false); if (!e.boss && !e.dying) e.stunT = Math.max(e.stunT, 0.4); if (!primary) primary = e; }
    });
    if (primary && SFX.status) SFX.status('stun');   // Pass4: SKYFALL stun sting (once per cast, the canonical stun beat)
    if (primary) chainLightning(primary, LANCE_DMG * 0.5 * G.stats.spDmg * G.specialR, true);   // inherits +2 jumps, boss collapse, all zeus mods
    G.skyfall.x = colX; G.skyfall.t = 0.22;
    G.flashAll = Math.max(G.flashAll, 0.2); addShake(6);
    if (SFX.zeusCrack) SFX.zeusCrack();   // Pass4: SKYFALL column crack
    for (var i = 0; i < 6; i++) flash(colX + (Math.random() - 0.5) * 36, 100 + i * 300, [0.7, 0.85, 1], 90, 0.18);
  }
  // ARTEMIS THE LOOSED ARROW — fastest moon-silver needle; pierces everything (999),
  // always precise, Marks each pierced foe; the FIRST struck becomes the Hunted at 8.
  function huntArrow() {
    var s = allocShot(); if (!s) return;
    var t = loosedTarget();
    var a = t ? Math.atan2(aimTargetY(t) - (G.player.y - 30), aimTargetX(t) - G.player.x) : UP;
    var sp = 2600;
    s.x = G.player.x; s.y = G.player.y - 30; s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp;
    s.radius = 14; s.scale = 64; s.damage = LANCE_DMG * 2.2 * G.stats.spDmg * G.specialR;
    s.age = 0; s.life = 0.9; s.r = 0.85; s.g = 0.9; s.b = 1.0;
    s.pierce = 999; s.kind = 4; s.faction = 1; s.big = true; s.markHit = true; s.forceCrit = 1;
    s.homing = true; s.turn = 5.0; s.loosed = true; s.brandedFirst = false;
    flash(s.x, s.y, [0.85, 0.9, 1], 150, 0.2);
  }
  // LOOSED ARROW target priority: marked → lowest-HP → boss → straight up.
  function loosedTarget() {
    var best = null;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (e.marked && !best) best = e; });
    if (best) return best;
    var lo = null, lh = 1e18;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (e.hp < lh) { lh = e.hp; lo = e; } });
    return lo;
  }
  // APHRODITE HEARTSEEKER — a slow weaving heart that charms a minion, or Weakens a
  // boss (+8%/heart ×3) and sweeps its nearby bullets to gold.
  function charmMissile() {
    var s = allocShot(); if (!s) return;
    s.x = G.player.x; s.y = G.player.y - 30; s.vx = 0; s.vy = -900;
    s.radius = 24; s.scale = 56; s.damage = LANCE_DMG * 1.2 * G.stats.spDmg * G.specialR;   // §7 bug fix: *specialR
    s.age = 0; s.life = 1.8; s.r = 1.0; s.g = 0.3; s.b = 0.55;
    s.pierce = 0; s.kind = 5; s.faction = 1; s.big = true;
    s.homing = true; s.turn = 3.0; s.weave = 1; s.phase = 0;
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
  function hazardFree() { for (var i = 0; i < hazards.length; i++) if (!hazards[i].active) return true; return false; }   // #7: does a hazard slot exist right now?

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
      else if (hz.type === 'deluge') {   // POSEIDON THE DELUGE ultimate — placed calm-water zone
        // enemy bullets entering the zone DIE (no gold); foes inside are mired (slowed).
        Engine.bullets.forEach(function (b) {
          if (b.friendly) return;
          var dx = b.x - hz.x, dy = b.y - hz.y;
          if (dx * dx + dy * dy < hz.r * hz.r) { spark(b.x, b.y, [0.3, 0.85, 0.95], 1, 120, 12); Engine.bullets.release(b); }
        });
        Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; var dx = e.x - hz.x, dy = e.y - hz.y; if (dx * dx + dy * dy < hz.r * hz.r) e.mireT = 0.12; });
        if (hz.timer <= 0) hz.active = false;
      }
      else if (hz.type === 'ultpillar') {   // WUKONG THE WORLD-PILLAR ultimate — the game's only bullet-blocking obstacle
        Engine.bullets.forEach(function (b) {
          if (b.friendly) return;
          if (Math.abs(b.x - hz.x) < hz.halfW + b.radius) { spark(b.x, b.y, [1, 0.8, 0.35], 1, 140, 14); Engine.bullets.release(b); }   // pillar body blocks + kills enemy bullets that hit it
        });
        if (hz.timer <= 0) hz.active = false;
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
        var sc = authCell('33-9-ruyi-jingu-bang');   // §9 Ruyi Jingu Bang — the special's slam IS the staff
        if (sc >= 0) {
          // full staff visible, gold end-caps on screen at both edges; drawn twice so the
          // dark shaft reads solid under additive blending
          GL.draw(GL.SPR.GLOW, hz.x, H / 2, hz.halfW * 1.6, H, 0, 1, 0.8, 0.45, 0.35 * pa);
          var sfr = H * 1.06;
          GL.draw(sc, hz.x, H / 2, sfr, sfr, 0, 1, 1, 1, pa);
          GL.draw(sc, hz.x, H / 2, sfr, sfr, 0, 1, 1, 1, 0.85 * pa);
        } else {
          GL.draw(GL.SPR.GLOW, hz.x, H / 2, hz.halfW * 3.0, H, 0, 1, 0.55, 0.2, 0.4 * pa);
          GL.draw(GL.SPR.CORE, hz.x, H / 2, hz.halfW * 1.5, H, 0, 1, 0.8, 0.4, 0.8 * pa);
          GL.draw(GL.SPR.CORE, hz.x, H / 2, hz.halfW * 0.5, H, 0, 1, 1, 0.9, 0.9 * pa);
        }
      }
      else if (hz.type === 'deluge') {   // calm teal zone (placed territory)
        var da = 0.4 + 0.6 * Math.min(1, hz.timer / hz.dur), rip = 0.5 + 0.5 * Math.sin(G.time * 3);
        GL.draw(GL.SPR.GLOW, hz.x, hz.y, hz.r * 2.2, hz.r * 2.2, 0, 0.2, 0.8, 0.85, 0.22 * da);
        GL.draw(GL.SPR.RING, hz.x, hz.y, hz.r * 2, hz.r * 2, G.time, 0.3, 0.9, 0.95, 0.5 * da);
        GL.draw(GL.SPR.RING, hz.x, hz.y, hz.r * (1.2 + 0.4 * rip), hz.r * (1.2 + 0.4 * rip), -G.time * 0.8, 0.35, 0.95, 1, 0.35 * da);
      }
      else if (hz.type === 'ultpillar') {   // colossal gold staff-pillar (planted cover)
        var pa = Math.min(1, hz.timer);
        var rc = authCell('33-9-ruyi-jingu-bang');   // §9 Ruyi Jingu Bang — slammed down as a hard-edged pillar
        if (rc >= 0) {
          GL.draw(GL.SPR.GLOW, hz.x, H / 2, hz.halfW * 1.6, H, 0, 1, 0.8, 0.45, 0.4 * pa);
          var rfr = H * 1.06;   // full staff, caps on screen, drawn twice for solidity
          GL.draw(rc, hz.x, H / 2, rfr, rfr, 0, 1, 1, 1, pa);
          GL.draw(rc, hz.x, H / 2, rfr, rfr, 0, 1, 1, 1, 0.85 * pa);
        } else {
          GL.draw(GL.SPR.GLOW, hz.x, H / 2, hz.halfW * 3.0, H, 0, 1, 0.75, 0.3, 0.5 * pa);
          GL.draw(GL.SPR.CORE, hz.x, H / 2, hz.halfW * 1.6, H, 0, 1, 0.85, 0.45, 0.85 * pa);
          GL.draw(GL.SPR.CORE, hz.x, H / 2, hz.halfW * 0.5, H, 0, 1, 1, 0.9, pa);
        }
        GL.draw(GL.SPR.RING, hz.x, G.player.y, hz.halfW * 3, hz.halfW * 3, G.time * 2, 1, 0.85, 0.4, 0.5 * pa);
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
        // head — authored Sky Serpent head (§9, nose-up → rotate to travel); the
        // trailing coil above stays procedural. Procedural core on miss.
        var shc = authCell('34-5-sky-serpent-head');
        if (shc >= 0) {
          var tln = hz.trail.length;
          var shang = tln >= 4 ? Math.atan2(hz.y - hz.trail[tln - 3], hz.x - hz.trail[tln - 4]) + Math.PI / 2 : 0;
          GL.draw(GL.SPR.GLOW, hz.x, hz.y, segR2 * 1.7, segR2 * 1.7, 0, 0.35, 1, 0.75, 0.5);
          GL.draw(shc, hz.x, hz.y, segR2 * 2.1, segR2 * 2.1, shang, 1, 1, 1, 1);
        } else {
          GL.draw(GL.SPR.CORE, hz.x, hz.y, segR2, segR2, 0, 1, 1, 0.9, 0.9);
        }
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
    // THE LENS — 4 stepped heat tiers on continuous held-time on ONE target.
    // raRamp charm scales thresholds ×0.556 (reaches CORONA faster) + caps ×2.875.
    var rr = G.mods.raRamp, tscale = rr ? 0.556 : 1;
    var THR = [0, 0.60 * tscale, 1.30 * tscale, 2.00 * tscale];
    var MUL = [1.0, 1.5, 2.0, rr ? 2.875 : 2.5];
    var boss = target && target.boss;
    // seq-guarded held target: a reused pool slot is NOT the same held target, and a
    // dead held target is cleared in killEnemy (hold zeroed there — no post-boss boss-lock).
    var held = G.ra.target, heldValid = held && held.active && !held.dying && held.seq === G.ra.targetSeq;
    if (target) {
      if (heldValid && target === held) { G.ra.hold += dt; G.ra.graceT = 0.30; }   // same target: ramp
      else if (!heldValid) { G.ra.target = target; G.ra.targetSeq = target.seq; G.ra.hold += dt; G.ra.graceT = 0.30; }   // held gone: adopt fresh
      else if (G.ra.graceT > 0) { G.ra.graceT -= dt; G.ra.hold += dt; }   // a different front foe within grace: keep ramping the held target (no per-frame collapse)
      else { G.ra.target = target; G.ra.targetSeq = target.seq; G.ra.hold = Math.max(0, G.ra.hold - THR[1]); G.ra.graceT = 0.30; }   // grace lapsed: commit switch, bleed ONE tier once
    } else {
      // no target in column: BOSS LOCK holds hold monotonic only while a live boss is
      // still the held target; otherwise the grace window, then bleed ~one tier per 0.30s.
      if (G.ra.graceT > 0) G.ra.graceT -= dt;
      else if (!(heldValid && held.boss)) G.ra.hold = Math.max(0, G.ra.hold - dt * 2.2);
    }
    if (boss) G.ra.graceT = 0.30;   // boss target never decays (Ra's boss signature)
    var tier = G.ra.hold >= THR[3] ? 3 : G.ra.hold >= THR[2] ? 2 : G.ra.hold >= THR[1] ? 1 : 0;
    if (G.raSurgeT > 0) { tier = 3; G.ra.hold = Math.max(G.ra.hold, THR[3]); }   // APOTHEOSIS forces CORONA
    G.ra.tier = tier; G.ra.ramp = Math.min(1, G.ra.hold / THR[3]);
    G.ra.active = true; G.ra.tx = p.x; G.ra.ty0 = p.y - 24; G.ra.ty1 = target ? target.y : 30;
    if (target) {
      var mult = MUL[tier];
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
    // COLOR (BOONS.md §RA, owner 2026-07-19 "laser should be way more red"): the sun as a
    // FURNACE, never honey-gold — deep solar red (KINDLE) → red-orange (FLARE) → hot red-white
    // (SOLAR) → white-hot core inside a red corona (CORONA), + a rotating corona flare. A
    // sanctioned god-hue exception; the notch-glyphs below stay gold. Tier/lens math untouched.
    // KEY: keep g≈b on every layer so the hue rides the RED→pink→white line and never
    // drifts to amber/orange (g>b) — the owner's "way more red" is a furnace, not honey.
    GL.draw(GL.SPR.GLOW, x, cy, 104 + ramp * 52, hh, 0, 1, 0.08 + 0.12 * ramp, 0.05 + 0.10 * ramp, 0.62 * pulse);  // deep blood-red corona sheath (wide)
    GL.draw(GL.SPR.CORE, x, cy, 44 + ramp * 22, hh, 0, 1, 0.15 + 0.40 * ramp, 0.12 + 0.40 * ramp, 0.82 * pulse);   // deep red → red-white beam
    GL.draw(GL.SPR.CORE, x, cy, 15 + ramp * 11, hh, 0, 1, 0.45 + 0.55 * ramp, 0.42 + 0.55 * ramp, pulse);          // core climbs to white-hot
    GL.draw(GL.SPR.GLOW, x, G.ra.ty1, 130, 130, 0, 1, 0.14 + 0.18 * ramp, 0.10 + 0.16 * ramp, 0.7);                // red impact bloom
    GL.draw(GL.SPR.RING, x, G.ra.ty0, 70 + ramp * 70, 70 + ramp * 70, G.time * 3, 1, 0.22, 0.16, 0.24 + 0.40 * ramp);   // rotating red corona flare (intensifies with ramp)
    // THE LENS — 1..4 gold notch-glyphs riding the beam (occlusion-proof tier count).
    for (var ni = 0; ni <= (G.ra.tier || 0); ni++) {
      var ny = G.ra.ty0 - 40 - ni * 34;
      GL.draw(GL.SPR.GOLD, x, ny, 20, 26, 0, 1, 0.85, 0.4, 0.9);
    }
  }
  // HEIMDALL THE BIFRÖST v2 — a full-HEIGHT VERTICAL rainbow band (~32px) once solid;
  // a dotted dawn-seam tracing BOTTOM→TOP at the frozen x during the telegraph.
  function drawBifrost() {
    var bf = G.bifrost;
    if (bf.seamT > 0) {   // telegraph: dotted seam rising bottom→top
      var prog = 1 - bf.seamT / 0.5, sy = H - (H + 80) * prog;
      for (var dy = H; dy > sy; dy -= 34) GL.draw(GL.SPR.CORE, bf.x, dy, 6, 10, 0, 1, 0.95, 0.8, 0.7);
      GL.draw(GL.SPR.GLOW, bf.x, sy, 30, 60, 0, 1, 0.95, 0.85, 0.6);
      return;
    }
    if (bf.active) {
      var fade = Math.min(1, bf.life);
      for (var y = 20; y < H; y += 44) {
        var col = Patterns.hue((y / H) + G.time * 0.25);
        GL.draw(GL.SPR.GLOW, bf.x, y, 34, 60, 0, col[0], col[1], col[2], 0.5 * fade);
        GL.draw(GL.SPR.CORE, bf.x, y, 14, 30, 0, col[0], col[1], col[2], 0.85 * fade);
      }
    }
  }
  // ZEUS SKYFALL — a stacked white column full-height on colX, x-jitter/frame.
  function drawSkyfall() {
    if (G.skyfall.t <= 0) return;
    G.skyfall.t -= Engine.DT;
    var a = Math.min(1, G.skyfall.t / 0.22), x = G.skyfall.x;
    for (var i = 0; i < 14; i++) {
      var jx = x + (Math.random() - 0.5) * 36, sy = 40 + i * (H / 14);
      GL.draw(GL.SPR.GLOW, jx, sy, 70, H / 12, 0, 0.6, 0.85, 1, 0.5 * a);
      GL.draw(GL.SPR.CORE, jx, sy, 22, H / 13, 0, 0.9, 0.95, 1, 0.9 * a);
    }
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

  // ODIN — HUGINN & MUNINN. Re-anchored to a CHARM (RAVEN QUILL / G.charms.charmOdin):
  // the ravens fly with ANY attack god, not just Odin. MEMORY: +1 dive dmg / 8 kills
  // (cap +18); past 30 kills the pair dives faster (interval 1.0) in tighter pairs.
  function updateRavens(dt) {
    if (!G.charms.charmOdin) { if (G.ravens.length) G.ravens.length = 0; return; }
    while (G.ravens.length < 2) G.ravens.push({ ang: G.ravens.length * Math.PI, state: 0, x: G.player.x, y: G.player.y, tx: 0, ty: 0, cd: 1.2 + G.ravens.length * 0.6 });
    var p = G.player, memoryK = G.ravenKills;
    var interval = memoryK >= 30 ? 1.0 : 1.4;
    var memoryDmg = Math.min(18, Math.floor(memoryK / 8));   // MEMORY: +1/8 kills, cap +18
    var dmg = (12 + memoryDmg) * G.stats.atkDmg * G.attackR;
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
        Engine.enemies.forEach(function (e) { if (hitFlag || e.dying || e.charmed) return; if (Engine.hit(r.x, r.y, 20, e.x, e.y, e.radius)) { damageEnemy(e, ((G.duos.wildHunt && e.terrorT > 0) ? dmg * 3 : dmg) * (G.duos.theAllseeing && e.marked ? 1.4 : 1), false); if (!e.dying) markEnemy(e); hitFlag = true; } });   // Mark-on-dive (baseline)
        if (hitFlag || d < 24) r.state = 2;
      } else {
        var dx2 = p.x - r.x, dy2 = p.y - r.y, d2 = Math.hypot(dx2, dy2) || 1;
        r.x += dx2 / d2 * 640 * dt; r.y += dy2 / d2 * 640 * dt;
        if (d2 < 70) { r.state = 0; r.cd = interval; }
      }
    }
  }
  // ---------------------------------------------------------------------
  // §5 FACTION LAW — CYAN HEART, NOSE UP. Every player-summoned entity keeps its
  // GOD body colour and gains one unfakeable engine marker: the player's own cyan
  // hitbox gem, breathing at 3Hz (the same gem drawPlayer renders). drawOwnedGem
  // stamps it; callers draw the body nose-up (rot 0), dive states may aim at prey.
  // ---------------------------------------------------------------------
  function drawOwnedGem(x, y, alpha) {
    var breath = 0.72 + 0.28 * Math.sin(G.time * 18.85);   // 3Hz breath
    GL.draw(GL.SPR.GLOW, x, y, 30, 30, 0, 0.7, 0.95, 1, 0.55 * alpha * breath);
    GL.draw(GL.SPR.CORE, x, y, 12, 12, 0, 0.7, 0.95, 1, alpha * breath);
  }
  // Hostile mimic (Apostate) — the sanctioned deception, INVERTED marker: a RED
  // heart with a harsh 12Hz flicker + a red threat chevron (NEEDLE) overhead.
  // curd 0..1 = the decoy CURDLE (0 = still wearing the full friendly cyan costume,
  // 1 = fully curdled red); Apostate clones spawn instantly at curd 1.
  function drawMimicGem(x, y, scale, alpha, curd) {
    var hr = 0.7 + 0.3 * curd, hg = 0.95 - 0.75 * curd, hb = 1 - 0.7 * curd;   // cyan -> red as it curdles
    var flick = curd > 0.02 ? (0.55 + 0.45 * Math.sin(G.time * 75.4))          // 12Hz red flicker
                            : (0.72 + 0.28 * Math.sin(G.time * 18.85));        // 3Hz cyan breath (disguise)
    GL.draw(GL.SPR.GLOW, x, y, 30, 30, 0, hr, hg, hb, 0.5 * alpha * flick);
    GL.draw(GL.SPR.CORE, x, y, 12, 12, 0, hr, hg, hb, alpha * flick);
    if (curd > 0.05) GL.draw(GL.SPR.NEEDLE, x, y - scale * 0.85, 16, 34, Math.PI, 1, 0.2, 0.3, curd * alpha);  // threat chevron
  }

  function drawRavens() {
    var rc = authCell('34-1-huginn-muninn');   // §9 raven sprite (head-up → rotate on dive)
    for (var i = 0; i < G.ravens.length; i++) {
      var r = G.ravens[i];
      var rot = r.state === 1 ? Math.atan2(r.ty - r.y, r.tx - r.x) + Math.PI / 2 : 0;  // dive aims at prey, else nose-up
      GL.draw(GL.SPR.GLOW, r.x, r.y, 46, 46, 0, 0.16, 0.17, 0.22, 0.5);                // near-black bird body (§2 Odin)
      if (rc >= 0) GL.draw(rc, r.x, r.y, 46, 46, rot, 1, 1, 1, 1);
      else GL.draw(GL.SPR.SHIP_POP, r.x, r.y, 34, 34, rot, 0.2, 0.21, 0.28, 0.95);
      drawOwnedGem(r.x, r.y, 1);
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
    var gc = authCell('33-2-gungnir');   // §9 Gungnir spear sprite (nose-up → rotate to travel)
    // ASPECT AUDIT: the authored sprite is a SQUARE cell (the spear occupies its own tall/thin
    // fraction of that square). Drawing it non-square (was 150×220) double-stretched the spear —
    // draw square (220) so its authored proportions read true; the procedural NEEDLE fallback is a
    // genuinely thin quad, so it keeps its own 42×190 shape.
    if (gc >= 0) GL.draw(gc, g.x, g.y, 220, 220, ang, 1, 1, 1, 1);
    else GL.draw(GL.SPR.NEEDLE, g.x, g.y, 42, 190, ang, 1, 0.95, 0.6, 1);
    GL.draw(GL.SPR.CORE, g.x, g.y, 26, 26, 0, 1, 1, 0.9, 0.9);
  }
  function markEnemy(e) { if (!e.marked && SFX.status) SFX.status('mark'); e.marked = true; e.markT = G.mods.odinMark ? 10 : 6; }   // Pass4: mark sting on the unmarked→marked edge only (bifrost re-marks stay silent)

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
    GL.draw(GL.SPR.SHIP_PLAYER, d.x, d.y, 72, 72, 0, 0.4, 1, 0.5, 0.7);   // Loki green body, nose-up
    GL.draw(GL.SPR.RING, d.x, d.y, 92, 92, G.time * 3, 0.4, 1, 0.5, 0.4);
    drawOwnedGem(d.x, d.y, 1);                                            // §5 cyan heart
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
    if (SFX.summon) SFX.summon();   // Pass4: owned-entity spawn cue (hair-clone)
  }
  function updateClones(dt) {
    var p = G.player;
    for (var i = G.clones.length - 1; i >= 0; i--) {
      var c = G.clones[i]; c.timer -= dt;
      if (c.timer <= 0) { spark(c.x, c.y, [1, 0.4, 0.2], 10, 240, 24); G.clones.splice(i, 1); continue; }
      c.x = p.x + c.offset; c.y = p.y;
      if (c.x < 40) c.x = 40; if (c.x > W - 40) c.x = W - 40;
      if (wantFire()) { c.fireT -= dt; if (c.fireT <= 0) { c.fireT = FIRE_CD / (G.stats.atkRate * frenzyRate()); fireStreams(c.x, c.y, Engine.focusHeld(), 0.45, true); } }
    }
  }
  function drawClones() {
    for (var i = 0; i < G.clones.length; i++) {
      var c = G.clones[i], a = Math.min(1, c.timer) * 0.62;
      GL.draw(GL.SPR.GLOW, c.x, c.y + 30, 46, 70, 0, 1, 0.8, 0.35, 0.4 * a);   // §5 Wukong gold default
      GL.draw(GL.SPR.SHIP_PLAYER, c.x, c.y, 68, 68, 0, 1, 0.8, 0.35, a);        // gold body, nose-up
      drawOwnedGem(c.x, c.y, a);                                                // cyan heart (was gold core)
    }
  }

  // status helpers
  function applyBurn(e, dps, dur) { if (e.burnT < dur) e.burnT = dur; if (e.burnDps < dps) e.burnDps = dps; }
  function spreadBurn(e) { Engine.enemies.forEach(function (o) { if (o.dying || o.charmed || o === e) return; var dx = o.x - e.x, dy = o.y - e.y; if (dx * dx + dy * dy < 200 * 200) applyBurn(o, e.burnDps * 0.8, 2.5); }); }
  // ANUBIS THE WEIGHING — the scales tip at cumulative weight = maxhp*K. K tuned so
  // default-fire trash tips in ~2-3 hits, elites/bosses take real commitment (~8+).
  var ANUBIS_K = 0.35;
  function anubisThreshold(e) { return e.maxhp * ANUBIS_K; }
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
    if (G.mods.anubisShard) addGauge(4);                  // a Verdict drops a DIVINE INTERVENTION shard
    killGoldMul = 1.5 * (G.mods.anubisFeast ? 1.5 : 1); killEnemy(e, true); killGoldMul = 1;   // +50% (FEAST: +50% more)
    if (G.mods.anubisRefund) addCharge(0.12);
  }

  // pantheon-2 specials
  function solarFlare() {
    G.flashAll = Math.max(G.flashAll, 0.4); addShake(5);
    ringShock(G.player.x, G.player.y, [1, 0.95, 0.6], 100, 5000, 0.6);
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; applyBurn(e, 22 * G.stats.spDmg * G.specialR, 3.0); });
  }
  // ANUBIS THE WEIGHING — a hit loads the scales (scaleW += dmg dealt). At the tip:
  // non-boss/elite is devoured (execute, +50% gold); boss/elite takes a judgment burst
  // (maxhp*0.02, floored to a LANCE_DMG-scaled minimum) + 2 Weak stacks, then re-arms.
  function anubisWeighHit(e, dmg, isCrit) {
    damageEnemy(e, dmg, isCrit);
    if (e.dying) return;
    var gain = dmg * (isCrit ? 2.5 : 1);                 // precise hits deal (and thus load) more
    if (e.hp < 0.5 * e.maxhp && G.mods.anubisHeavy) gain *= 2;   // HEAVY HEART: below-half tip 2× faster
    if (isCrit && G.duos.deathSentence) gain *= 2;       // DEATH SENTENCE: precise hits load double weight
    e.scaleW += gain;
    if (e.scaleW >= anubisThreshold(e)) anubisVerdict(e);
  }
  function anubisVerdict(e) {
    if (e.dying) return;
    if (SFX.verdictGong) SFX.verdictGong();               // Pass4: the scales tip — WEIGHING verdict gong
    e.scaleW = 0;                                         // reset + re-arm
    if (!e.boss && !e.elite) {                            // THE VERDICT: devour the weak
      flash(e.x, e.y, [0.14, 0.05, 0.11], 130, 0.32);    // jackal-shadow snap
      spark(e.x, e.y, [0.9, 0.75, 0.35], 12, 320, 26); ringShock(e.x, e.y, [0.9, 0.72, 0.3], 34, 2000, 0.42);
      executeEnemy(e);                                    // +50% gold (FEAST +50% more); ETERNAL DEVOTION ghosts ride
    } else {                                              // boss/elite: judgment burst + Weaken
      var burst = Math.max(LANCE_DMG * 1.5 * G.stats.atkDmg * G.attackR, e.maxhp * 0.02 * G.attackR);   // sane floor
      flash(e.x, e.y, [1, 0.85, 0.35], 110, 0.28); ringShock(e.x, e.y, [1, 0.85, 0.3], 40, 2200, 0.45);
      damageEnemy(e, burst, false);
      if (!e.dying) { e.weakStacks = Math.min(3, (e.weakStacks || 0) + 2); e.weak = true; e.weakT = 6; }
    }
  }
  // ANUBIS — GATE OF DUAT: a sand-vortex gate tears open AT THE CAST POSITION (owner-ruled
  // 2026-07-19 option 2 — the player is free to move away, the gate stays where opened, so
  // placement is the skill). Every wounded foe (hp<max) is dragged toward it (bosses immovable)
  // and bleeds a share of its missing HP over the duration; non-boss deaths at the gate pay bonus gold.
  function gateOfDuat() {
    var d = G.duat, p = G.player;
    d.active = true; d.x = p.x; d.y = p.y; d.dur = 2.5; d.timer = 2.5;   // open at the player's position at cast
    // fresh per-cast boss cap: zero every live foe's gate-drain accumulator so a recast
    // (or a boss that survived a prior gate) gets its own min(0.05·specialR,0.15)·maxhp ceiling.
    Engine.enemies.forEach(function (e) { e.duatDmg = 0; });
    G.flashAll = Math.max(G.flashAll, 0.2); addShake(5);
    ringShock(d.x, d.y, [0.85, 0.7, 0.3], 90, 3600, 0.5);
    if (SFX.gateRoar) SFX.gateRoar();                     // Pass4: GATE OF DUAT tears open
  }
  function updateDuat(dt) {
    var d = G.duat; if (!d.active) return;
    d.timer -= dt;
    if (d.timer <= 0) { d.active = false; return; }
    var feast = G.mods.anubisFeast ? 1.5 : 1;
    Engine.enemies.forEach(function (e) {
      if (e.dying || e.charmed || e.hp >= e.maxhp) return;          // only the wounded
      var share = (e.maxhp - e.hp) * (dt / d.dur) * 0.4 * G.specialR;   // missing-HP share over the duration
      if (!e.boss) {
        var dx = d.x - e.x, dy = d.y - e.y, di = Math.hypot(dx, dy) || 1;
        var pull = Math.min(di, 300 * G.specialR * dt);             // REAL migration toward the gate (px/s, specialR-scaled)
        e.x += (dx / di) * pull; e.y += (dy / di) * pull;
        e.dispVX += (dx / di) * 140 * dt; e.dispVY += (dy / di) * 140 * dt;   // modest displacement lean for juice
        killGoldMul = (di < 170 ? 1.5 : 1) * feast;                  // deaths at the gate pay bonus gold
        if (share > 0) damageEnemy(e, share, false);                 // non-boss share stays per-frame (no cap)
        killGoldMul = 1;
      } else if (share > 0) {                                         // bosses: immovable, drain clamped per cast
        var cap = Math.min(0.05 * G.specialR, 0.15) * e.maxhp;
        var room = cap - e.duatDmg;
        if (room > 0) { var hit = Math.min(share, room); e.duatDmg += hit; damageEnemy(e, hit, false); }
      }
    });
  }
  function drawDuat() {
    var d = G.duat; if (!d.active) return;
    var t = G.time, life = Math.min(1, d.timer / 0.4);
    for (var r = 0; r < 4; r++) {
      var rr = 60 + r * 55, a = 0.5 - r * 0.09;
      GL.draw(GL.SPR.RING, d.x, d.y, rr * 2, rr * 1.1, t * (1.5 + r * 0.6), 0.85, 0.68, 0.3, a * life);   // sand vortex
    }
    GL.draw(GL.SPR.GLOW, d.x, d.y, 300, 150, 0, 0.7, 0.55, 0.22, 0.4 * life);
    for (var w = 0; w < 6; w++) {                                    // soul-wisps streaming down
      var wx = d.x + Math.cos(t * 1.2 + w * 1.05) * 80;
      GL.draw(GL.SPR.CORE, wx, d.y - ((t * 220 + w * 60) % 300), 10, 22, 0, 0.8, 0.85, 0.7, 0.5 * life);
    }
  }
  function shadowTwin() {
    G.decoy.active = true; G.decoy.x = G.player.x; G.decoy.y = G.player.y; G.decoy.absorb = 0;
    G.decoy.timer = 6 * (G.mods.lokiLong ? 1.5 : 1);
    flash(G.player.x, G.player.y, [0.4, 1, 0.5], 120, 0.25);
    if (SFX.summon) SFX.summon();   // Pass4: owned-entity spawn cue (Shadow-Twin decoy)
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
  // JADE EMPEROR — IMPERIAL JUDGEMENT (Leigong's Thunder Court). Two dark storm-clouds
  // fade in flanking the upper field (owned entities, §5: cyan heart, expire on kit-swap).
  // Every 0.8s (0.5s w/ jadeOften) an alternating cloud hurls a Zeus-style chain-bolt at
  // a RANDOM live foe (jadeMirror → the HIGHEST-HP foe). Recast refreshes the duration.
  function imperialJudgement() {
    var j = G.judge;
    j.active = true;
    j.timer = 6.0 + (G.specialR >= 2.25 ? 1.0 : 0);   // ★★★ +1s
    if (j.boltT <= 0) j.boltT = 0.8;
    if (G.jclouds.length < 2) {
      G.jclouds.length = 0;
      G.jclouds.push({ x: W * 0.22, y: H * 0.16, seed: 0.3 });
      G.jclouds.push({ x: W * 0.78, y: H * 0.16, seed: 2.1 });
    }
    flash(W * 0.22, H * 0.16, [0.5, 0.4, 0.7], 160, 0.4);
    flash(W * 0.78, H * 0.16, [0.5, 0.4, 0.7], 160, 0.4);
    G.flashAll = Math.max(G.flashAll, 0.14); addShake(4);
    if (SFX.stormRumble) SFX.stormRumble();   // Pass4: IMPERIAL JUDGEMENT storm-clouds gather
  }
  function randomLiveFoe() {
    var list = [];
    Engine.enemies.forEach(function (e) { if (!e.dying && !e.charmed) list.push(e); });
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  function updateJudgement(dt) {
    var j = G.judge; if (!j.active) return;
    j.timer -= dt;
    if (j.timer <= 0) {   // dissipate — recall the clouds (§5 fly-up + gem implode)
      for (var c = 0; c < G.jclouds.length; c++) recallFx(G.jclouds[c].x, G.jclouds[c].y);
      G.jclouds.length = 0; j.active = false; j.boltT = 0; return;
    }
    if (G.jclouds.length < 2) return;
    j.boltT -= dt;
    if (j.boltT <= 0) {
      j.boltT = G.mods.jadeOften ? 0.5 : 0.8;
      j.side ^= 1;                                     // alternate clouds
      var cloud = G.jclouds[j.side];
      var target = G.mods.jadeMirror ? highestCurHpEnemy() : randomLiveFoe();   // MIRROR REFLECTION → strongest LIVE foe (current hp)
      if (target && !target.dying) {
        var dmg = LANCE_DMG * 1.2 * G.stats.spDmg * G.specialR;
        if (G.mods.jadeMirror) {   // the zhaoyaojing hangs between the clouds; the bolt banks off it
          var mx = (G.jclouds[0].x + G.jclouds[1].x) / 2, my = (G.jclouds[0].y + G.jclouds[1].y) / 2 + 46;
          // banked bolt: cloud->mirror (gold leg) banks off the zhaoyaojing to the target (violet-white leg)
          boltBanked(cloud.x, cloud.y, mx, my, target.x, target.y, [1, 0.85, 0.4], [0.62, 0.5, 0.95]);
          flash(mx, my, [1, 0.9, 0.5], 70, 0.18);
          if (SFX.mirrorTing) SFX.mirrorTing();   // Pass4: MIRROR REFLECTION bolt banks off the zhaoyaojing
        } else arcFx(cloud.x, cloud.y, target.x, target.y, [0.62, 0.5, 0.95]);   // JUDGEMENT: darker violet-white (bolts pitched -4 semitones)
        damageEnemy(target, dmg, false);              // the AIMED foe always eats the bolt (a surrounded boss no longer gets skipped)
        chainLightning(target, dmg, true);            // full Zeus-style chain to OTHERS is the bonus (inherits +2 storm jumps)
        if (!target.boss && !target.dying) { target.stunT = Math.max(target.stunT, 0.4); flash(target.x, target.y, [0.7, 0.95, 1], 60, 0.2); }
        if (G.duos.twoThrones && !target.dying) chainLightning(target, dmg * 0.4, false);   // TWO THRONES: extra chain crack
        G.verdictPeachT = 3;                          // PEACH BANQUET: kills within 3s of a bolt feed the gauge
        addShake(2); if (SFX.judgementCrack) SFX.judgementCrack(); else (SFX.boom && SFX.boom());   // Pass4: per-bolt judgement crack
      }
    }
  }
  // §5 owned-entity draw: roiling dark puffs + gold under-flicker, cyan heart in the core.
  function drawJudgement() {
    var t = G.time, life = Math.min(1, G.judge.timer);
    var cc = authCell('34-3-thunder-court-storm-cloud');   // §9 storm-cloud sprite
    for (var i = 0; i < G.jclouds.length; i++) {
      var c = G.jclouds[i], flick = 0.5 + 0.5 * Math.sin(t * 3 + c.seed);
      GL.draw(GL.SPR.GLOW, c.x, c.y + 16, 140, 74, 0, 0.5 * flick, 0.36 * flick, 0.12, 0.5 * life);   // gold under-flicker
      if (cc >= 0) {
        GL.draw(cc, c.x, c.y, 180, 180, 0, 1, 1, 1, life);                                            // authored cumulus slab
      } else {
        for (var p = 0; p < 4; p++) {
          var pa = t * 0.6 + c.seed + p * 1.6, px = c.x + Math.cos(pa) * 36, py = c.y + Math.sin(pa) * 16;
          GL.draw(GL.SPR.GLOW, px, py, 82, 62, 0, 0.10, 0.09, 0.14, 0.7 * life);                      // dark roiling puff
          GL.draw(GL.SPR.CORE, px, py, 32, 24, 0, 0.06, 0.05, 0.09, 0.55 * life);
        }
      }
      drawOwnedGem(c.x, c.y, life);                                                                    // §5 cyan heart glint
    }
    // MIRROR REFLECTION (jadeMirror): the zhaoyaojing hangs between the two clouds,
    // the bank point the chain-bolts ricochet off. §9 disc sprite; gem stays on top.
    if (G.mods.jadeMirror && G.jclouds.length >= 2) {
      var mx = (G.jclouds[0].x + G.jclouds[1].x) / 2, my = (G.jclouds[0].y + G.jclouds[1].y) / 2 + 46;
      var mc = authCell('34-4-zhaoyaojing');
      GL.draw(GL.SPR.GLOW, mx, my, 96, 96, 0, 1, 0.9, 0.5, 0.4 * life);
      if (mc >= 0) GL.draw(mc, mx, my, 84, 84, 0, 1, 1, 1, life);
      else { GL.draw(GL.SPR.RING, mx, my, 70, 70, t, 1, 0.85, 0.45, 0.9 * life); GL.draw(GL.SPR.CORE, mx, my, 30, 30, 0, 0.7, 0.9, 1, 0.7 * life); }
      drawOwnedGem(mx, my, life);
    }
  }

  // ---------------------------------------------------------------------
  // ARES — Bloodlust (frenzy) + Phobos & Deimos (Terror wraiths)
  // ---------------------------------------------------------------------
  // ARES WAR-HEAT — proximity builds the meter. addFrenzy (kill/segment gravy) now
  // nudges the continuous meter up rather than adding a whole discrete stack.
  function addFrenzy() {
    // cross-kit gravy (GODS OF WAR / WILD HUNT terror-kills, Ares kills) grants a
    // TEMPORARY stack boost that decays on its own timer, independent of attack god —
    // so it feeds duos whose attack god isn't Ares (updateFrenzy no longer hard-zeroes it).
    G.frenzy.boost = Math.min(1, G.frenzy.boost + 0.10);   // +0.10 boost meter (decays in updateFrenzy)
    syncFrenzyStacks();
  }
  // effective meter = proximity frenzyF + cross-kit boost, clamped to 1; stacks drive all consumers.
  function syncFrenzyStacks() { G.frenzy.stacks = Math.round(Math.min(1, G.frenzy.frenzyF + G.frenzy.boost) * 10); }
  function anyBurning() {
    var found = false;
    Engine.enemies.forEach(function (e) { if (e.burnT > 0) found = true; });
    return found;
  }
  // WAR-HEAT proximity meter: stand a spear's length from a foe and the heat climbs;
  // back off past FAR (after a 0.4s grace) and it cools. Proximity ALONE builds it —
  // no trigger-hold. frenzyF (0..1) drives G.frenzy.stacks so all consumers keep working.
  var WARHEAT_CLOSE = 260, WARHEAT_FAR = 440;
  function updateFrenzy(dt) {
    if (G.frenzy.bloom > 0) G.frenzy.bloom -= dt;
    // cross-kit boost (addFrenzy) decays on its own timer regardless of attack god,
    // so GODS OF WAR / WILD HUNT terror-kills keep feeding frenzy under Guan Yu etc.
    if (G.frenzy.boost > 0) G.frenzy.boost = Math.max(0, G.frenzy.boost - 0.20 * dt);
    // #3 fix: ARISTEIA (the Ares ULTIMATE) pins War-Heat for its whole contract REGARDLESS
    // of which slot Ares holds — updateUlt keeps pinT refreshed while it lives, so a build
    // running Ares-as-special still gets the promised fire-rate/damage boost (the pinT branch
    // below honors it). Without this, the non-Ares-attack guard zeroed pinT every frame first.
    var aristeia = (G.ult.god === 'aristeia');
    if (G.attackGod !== 'ares' && !aristeia) {
      // proximity meter is Ares-only: zero frenzyF, but leave the boost (synced below) alone.
      if (G.frenzy.frenzyF !== 0) G.frenzy.frenzyF = 0;
      G.frenzy.pinT = 0;
      syncFrenzyStacks();
      return;
    }
    if (G.frenzy.pinT > 0) {   // APOTHEOSIS: pin max War-Heat for the apotheosis window
      G.frenzy.pinT -= dt; G.frenzy.frenzyF = 1; syncFrenzyStacks();
      if (G.mods.aresCharge) addCharge(SP_RECHARGE * G.stats.spRecharge * dt);
      return;
    }
    var ne = nearestEnemy(G.player.x, G.player.y);
    var dist = ne ? Math.hypot(ne.x - G.player.x, ne.y - G.player.y) : 1e9;
    var hold = G.duos.bloodAndFire && anyBurning();           // BLOOD AND FIRE: never cool while burning
    if (dist <= WARHEAT_CLOSE) { G.frenzy.frenzyF = Math.min(1, G.frenzy.frenzyF + 0.25 * dt); G.frenzy.graceT = 0.4; }
    else if (dist > WARHEAT_FAR) {
      if (G.frenzy.graceT > 0) G.frenzy.graceT -= dt;
      else if (!hold) {
        var drain = 0.18 * (G.mods.aresDecay ? 0.5 : 1) * (G.waveKind === 'boss' ? 0.5 : 1);   // aresDecay + boss-mode slow drain
        G.frenzy.frenzyF = Math.max(0, G.frenzy.frenzyF - drain * dt);
      }
    } else { G.frenzy.graceT = 0.4; }                          // between bands: hold
    syncFrenzyStacks();
    // aresCharge fork: charge special ~2x faster while >= 5 stacks
    if (G.mods.aresCharge && G.frenzy.stacks >= 5) addCharge(SP_RECHARGE * G.stats.spRecharge * dt);
  }
  function frenzyRate() { return 1 + 0.03 * G.frenzy.stacks; }  // +3%/stack (WAR-HEAT rewrite)

  // Terror application from a passing wraith (or LOVE AND WAR duo)
  function terrify(e, fromX, fromY) {
    if (e.dying || e.charmed) return;
    if (e.boss) { e.shakenT = Math.max(e.shakenT, 1.0); pushDisp(e, fromX, fromY, 90); return; }
    var dur = 2.5 * (G.mods.aresTerror ? 1.6 : 1);
    if (e.terrorT <= 0 && SFX.status) SFX.status('terror');   // Pass4: terror sting on the calm→terrified edge
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
    if (SFX.summon) SFX.summon();   // Pass4: owned-entity spawn cue (Phobos & Deimos)
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
    var wc = authCell('34-2-phobos-deimos');   // §9 dread-wraith sprite (head-up → rotate on dive)
    for (var i = 0; i < G.wraiths.length; i++) {
      var w = G.wraiths[i], a = Math.min(1, w.timer * 2);
      var rot = (w.state === 1 && w.target) ? Math.atan2(w.target.y - w.y, w.target.x - w.x) + Math.PI / 2 : 0;  // dive aims, else nose-up
      GL.draw(GL.SPR.GLOW, w.x, w.y, 150, 150, 0, 0.55, 0.02, 0.06, 0.55 * a);   // dread-red aura (§5 Ares body)
      if (wc >= 0) GL.draw(wc, w.x, w.y, 60, 60, rot, 1, 1, 1, a);
      else GL.draw(GL.SPR.SHIP_POP, w.x, w.y, 44, 44, rot, 0.7, 0.05, 0.1, a);   // dread-red body
      drawOwnedGem(w.x, w.y, a);                                                 // §5 cyan heart (was a red core = read as enemy)
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
  // ranks by CURRENT hp (bosses eligible) — jadeMirror strikes the actually-strongest
  // LIVE foe, not a near-dead big-maxhp tank.
  function highestCurHpEnemy() {
    var best = null, bm = -1;
    Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (e.hp > bm) { bm = e.hp; best = e; } });
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
    var mc = authCell('33-1-mjolnir');   // §9 Mjölnir sprite (tumbling side profile)
    for (var i = 0; i < G.hammers.length; i++) {
      var h = G.hammers[i], sz = h.big ? 130 : 78;
      GL.draw(GL.SPR.GLOW, h.x, h.y, sz * 1.5, sz * 1.5, 0, 0.5, 0.6, 0.75, 0.5);
      if (mc >= 0) GL.draw(mc, h.x, h.y, sz * 1.15, sz * 1.15, h.spin, 1, 1, 1, 1);
      else GL.draw(GL.SPR.SHIP_MID, h.x, h.y, sz, sz, h.spin, 0.6, 0.66, 0.8, 1);
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
  // §2.5 ULTIMATES — the C-key burst slot. G.ultimateGod null => the DIVINE
  // INTERVENTION default (freeze->gild, in tryVaunt). Otherwise the equipped god's
  // ultimate: at most ONE instant full-screen payload (ZEUS); everything else is
  // something placed / steered / worn / ridden / timed. The gauge is the existing
  // burst gauge; a cast consumes it (v.gauge=0) and grants a brief cast shield.
  // ---------------------------------------------------------------------
  // shared ULT-CAST swell + a per-god §6 material accent, all SFX guarded (Pass-3 stubs).
  function sfxUlt(g) {
    if (SFX.ultCast) { SFX.ultCast(g); return; }                 // Pass4: §2.5 ult swell + per-god §6 material accent (bundled)
    if (SFX.vaunt) SFX.vaunt();                                   // fallback: shared cast swell (reuse the burst swell)
    var accent = { zeus: SFX.crit, poseidon: SFX.thud, artemis: SFX.hit, aphrodite: SFX.powerup,
      ares: SFX.boom, ra: SFX.explosion, anubis: SFX.boom, loki: SFX.hit, odin: SFX.boom,
      thor: SFX.thud, heimdall: SFX.hit, wukong: SFX.thud, guanyu: SFX.boom, quetz: SFX.hit };
    var fn = accent[g]; if (fn) { try { fn(); } catch (e) {} }    // §6 material accent stub, guarded
  }
  // Enumerate live, non-charmed foes for the instant ultimates (ZEUS / ANUBIS).
  function eachFoe(fn) { Engine.enemies.forEach(function (e) { if (!e.dying && !e.charmed) fn(e); }); }

  // Dispatch a NON-default ultimate (JADE MANDATE is handled inline in tryVaunt).
  function castUltimate(g) {
    var v = G.vaunt, p = G.player, i;
    endUltimate();                                               // drop any prior live ultimate FIRST (frees its pooled hazards before the pre-check)
    // #7 fix: THE DELUGE / THE WORLD-PILLAR both place a pooled hazard. If the 8-slot pool
    // is saturated, allocHazard would return null and the cast is a silent no-op — so bail
    // BEFORE spending the gauge or firing the announce/shield, rather than eating the gauge.
    if ((g === 'poseidon' || g === 'wukong') && !hazardFree()) { SFX.hit(); return; }
    v.gauge = 0; v.ready = false;                                 // consume the burst gauge
    p.invuln = Math.max(p.invuln, 0.6);                          // brief cast-safety (most ults are close-range)
    G.flashAll = Math.max(G.flashAll, 0.16); addShake(6);
    sfxUlt(g);
    var D = G.stats.atkDmg;
    switch (g) {
      case 'zeus':      // OLYMPIAN STORM — THE one instant nuke: every live foe struck at once.
        announce('OLYMPIAN STORM', '', 1.2);
        var _sk = 0;
        eachFoe(function (e) {
          // a bolt drops from the top edge onto every foe, staggered 1-2 frames for weight
          boltSpawn(e.x + (Math.random() - 0.5) * 44, -24, e.x, e.y, [0.7, 0.9, 1], { big: true, delay: _sk * 0.028 });
          damageEnemy(e, LANCE_DMG * 4 * D, false); if (!e.boss && !e.dying) e.stunT = Math.max(e.stunT, 1.2);
          _sk++;
        });
        G.flashAll = Math.max(G.flashAll, 0.4); addShake(12);
        ringShock(p.x, p.y, [0.7, 0.85, 1], 90, 5200, 0.6);
        break;
      case 'anubis':    // THE FINAL WEIGHING — the timed verdict: wounded devoured, bosses bitten, full-HP untouched.
        announce('THE FINAL WEIGHING', '', 1.4);
        eachFoe(function (e) {
          var missing = e.maxhp - e.hp;
          if (missing <= 0) return;                              // full-health foes untouched
          if (!e.boss && !e.elite) { anubisVerdict(e); }         // wounded non-boss: devoured (execute + gold)
          else {
            var bite = Math.min(missing * 0.25, 0.2 * e.maxhp);  // boss/elite: capped judgment bite
            flash(e.x, e.y, [1, 0.85, 0.35], 110, 0.3); ringShock(e.x, e.y, [1, 0.85, 0.3], 44, 2400, 0.5);
            damageEnemy(e, bite, false);
            if (!e.dying) { e.weakStacks = Math.min(3, (e.weakStacks || 0) + 2); e.weak = true; e.weakT = 6; }
          }
        });
        break;
      case 'poseidon':  // THE DELUGE — placed territory: a calm-water zone floods where you stand.
        announce('THE DELUGE', '', 1.4);
        var dz = allocHazard();
        if (dz) { dz.type = 'deluge'; dz.x = p.x; dz.y = p.y; dz.r = 340; dz.timer = 4; dz.dur = 4; dz.tick = 0; }
        ringShock(p.x, p.y, [0.2, 0.82, 0.9], 90, 4200, 0.6);
        break;
      case 'wukong':    // THE WORLD-PILLAR — planted cover: a stun ring, then a standing bullet-blocking pillar.
        announce('THE WORLD-PILLAR', '', 1.4);
        var pl = allocHazard();
        if (pl) { pl.type = 'ultpillar'; pl.x = p.x; pl.y = p.y; pl.halfW = 90; pl.timer = 4; pl.dur = 4; pl.tick = 0; }   // #11: set y so the recall FX fires at the pillar, not a stale slot value
        ringShock(p.x, p.y, [1, 0.8, 0.35], 100, 5200, 0.7); addShake(9);
        eachFoe(function (e) { if (e.boss) { e.shakenT = Math.max(e.shakenT, 0.8); if (!e.dying) e.stunT = Math.max(e.stunT, 0.8); } else if (!e.dying) e.stunT = Math.max(e.stunT, 2.5); });
        break;
      case 'artemis':   // THE GREAT HUNT — time you move through: slow the field, tag your column, loose on resume.
        announce('THE GREAT HUNT', '', 1.4);
        G.ult.god = 'greathunt'; G.ult.t = 1.5;
        break;
      case 'aphrodite': // ADORATION — worn aura: charm foes that dwell in your heart-aura; Weaken bosses inside.
        announce('ADORATION', '', 1.4);
        G.ult.god = 'adoration'; G.ult.t = 5; G.ult.bossT = 0;
        break;
      case 'ares':      // ARISTEIA — kill contract: pinned FRENZY + doubled volleys; each kill extends it.
        announce('ARISTEIA', '', 1.4);
        G.ult.god = 'aristeia'; G.ult.t = 4; G.frenzy.pinT = Math.max(G.frenzy.pinT, 0.3);
        break;
      case 'ra':        // NOON OF THE DUAT — steered artillery: the solar barque rides the top, beam down your lane.
        announce('NOON OF THE DUAT', '', 1.4);
        G.ult.god = 'ra'; G.ult.t = 3; G.ult.x = p.x; G.ult.y = 90;
        break;
      case 'loki':      // DOPPELGÄNGER — the mirror: one owned copy fires your attack, casts your special once.
        announce('DOPPELGÄNGER', '', 1.4);
        G.ult.god = 'loki'; G.ult.t = 6; G.ult.x = p.x - 90; G.ult.y = p.y; G.ult.castT = 3; G.ult.cd = 0;
        break;
      case 'odin':      // ALLFATHER'S EYE — the study window: EVERY Odin hit carves a rune, on any foe.
        announce("ALLFATHER'S EYE", '', 1.4);
        G.ult.god = 'allfather'; G.ult.t = 6;
        break;
      case 'thor':      // GIANT'S END — the giant boomerang (orbit REPLACED, owner 2026-07-19 "too confusing").
        // Mjölnir grows colossal and is HURLED up the player's cast lane: out-pass to the top edge,
        // a brief hang, then a return-pass back down the SAME lane (~2.2s round trip). One object,
        // two readable straight passes; aimed by where you stand at cast. u.x = lane x (fixed),
        // u.y = head y (animated), u.castT = start/return y (the hand), u.ang = tumble spin.
        announce("GIANT'S END", '', 1.4);
        G.ult.god = 'thor'; G.ult.t = 2.2; G.ult.x = p.x; G.ult.y = p.y - 24; G.ult.castT = p.y - 24; G.ult.ang = 0;
        addShake(6);
        if (SFX.boomerang) SFX.boomerang();   // Pass4: colossal Mjölnir hurled up the lane
        break;
      case 'heimdall':  // DAWNBREAK — mode transform: every shot a spectrum lance, all foes continuously Marked.
        announce('DAWNBREAK', '', 1.4);
        G.ult.god = 'dawnbreak'; G.ult.t = 4;
        break;
      case 'guanyu':    // GREEN DRAGON ASCENDS — trailing blade: a blade-dragon carves everything it trails through.
        announce('GREEN DRAGON ASCENDS', '', 1.4);
        G.ult.god = 'guanyu'; G.ult.t = 3; G.ult.trail = []; G.ult.x = p.x; G.ult.y = p.y;
        break;
      case 'quetz':     // THE FIFTH SUN RISES — orbiting devourer: the serpent coils around you, eating bullets to gauge.
        announce('THE FIFTH SUN RISES', '', 1.4);
        G.ult.god = 'quetz'; G.ult.t = 4; G.ult.ang = 0;
        break;
    }
  }

  // Loose the GREAT HUNT arrows on every tagged foe (precise, LANCE_DMG*2.5), then untag.
  function resolveGreatHunt() {
    var D = G.stats.atkDmg;
    Engine.enemies.forEach(function (e) {
      if (!e.huntTag) return;
      e.huntTag = false;
      if (e.dying || e.charmed) return;
      spark(e.x, e.y, [0.85, 0.9, 1], 6, 320, 24); flash(e.x, e.y, [0.85, 0.9, 1], 90, 0.2);
      markEnemy(e); damageEnemy(e, LANCE_DMG * 2.5 * D, true);   // forceCrit-class precise arrow
    });
  }

  // Recall + clear the live TIMED ultimate (swap / wave-boundary / re-cast). DELUGE +
  // WORLD-PILLAR live as hazards and are dropped by type; per-foe tags are wiped here.
  function endUltimate() {
    var u = G.ult;
    if (u.god) {
      if (u.god === 'ra' || u.god === 'loki' || u.god === 'thor' || u.god === 'guanyu' || u.god === 'quetz') recallFx(u.x || G.player.x, u.y || G.player.y);
      if (u.god === 'greathunt') Engine.enemies.forEach(function (e) { e.huntTag = false; });
      if (u.god === 'adoration') Engine.enemies.forEach(function (e) { e.adoreT = 0; });
      u.god = ''; u.t = 0; u.trail = null; u.castT = 0; u.ang = 0; u.bossT = 0; u.cd = 0;
      u.x = 0; u.y = 0;   // #10: clear the entity position so a later ult that never sets it (THE FIFTH SUN) recalls at the player (u.x||player.x), not a stale thor/guanyu coordinate
    }
    expireKitHazards('deluge'); expireKitHazards('ultpillar');
  }

  function updateUlt(dt) {
    var u = G.ult; if (!u.god) return;
    var p = G.player, D = G.stats.atkDmg;
    u.t -= dt;
    switch (u.god) {
      case 'greathunt':   // tag every foe your column crosses during the slow (|x-player.x|<40).
        Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (Math.abs(e.x - p.x) < 40) e.huntTag = true; });
        break;
      case 'adoration':   // heart-aura r200: dwell ~0.4s charms non-bosses; bosses accrue Weak.
        // (#14: the old per-frame u.bossT accumulator was dead state — boss-weaken timing keys
        //  off per-enemy e.adoreT below, never u.bossT — so the misleading write is gone.)
        Engine.enemies.forEach(function (e) {
          if (e.dying || e.charmed) return;
          var dx = e.x - p.x, dy = e.y - p.y, inside = (dx * dx + dy * dy < 200 * 200);
          if (!inside) { if (e.adoreT > 0) e.adoreT = Math.max(0, e.adoreT - dt); return; }
          if (e.boss) {
            e.adoreT += dt;   // bosses accrue a Weak stack (cap 3) per ~0.6s dwelt inside the aura
            if (e.adoreT >= 0.6) { e.adoreT = 0; e.weakStacks = Math.min(3, (e.weakStacks || 0) + 1); e.weak = true; e.weakT = 6; flash(e.x, e.y, [1, 0.4, 0.7], 70, 0.2); }
          } else {
            e.adoreT += dt;
            if (e.adoreT >= 0.4) charmEnemy(e);
          }
        });
        break;
      case 'aristeia':    // pin FRENZY at max for the whole contract (updateFrenzy honors pinT while Ares attacks).
        G.frenzy.pinT = Math.max(G.frenzy.pinT, 0.2);
        break;
      case 'ra': {        // NOON barque rides y~90 easing toward player.x; beam column beneath it.
        u.x += (p.x - u.x) * Math.min(1, dt * 4);
        Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (e.y < H - 60 && Math.abs(e.x - u.x) < 44 + e.radius * 0.5) { damageEnemy(e, BEAM_DPS * 2.5 * D * dt, false); applyBurn(e, 18 * D, 1.5); if (Math.random() < 0.3) spark(e.x, e.y, [1, 0.9, 0.5], 1, 120, 16); } });
        break;
      }
      case 'loki': {      // DOPPELGÄNGER copy: follow at a left offset (clamped on-screen), fire your attack, cast special once ~3s.
        var dopx = Math.max(60, Math.min(W - 60, p.x - 90));
        u.x += (dopx - u.x) * Math.min(1, dt * 8); u.y += (p.y - u.y) * Math.min(1, dt * 8);
        u.cd -= dt;
        if (u.cd <= 0) { u.cd = FIRE_CD / (G.stats.atkRate * frenzyRate()); dopplerFiring = true; fireStreams(u.x, u.y, false, 1.0, true); dopplerFiring = false; }   // #4: the mirror fires the player's REAL attack (signature branches enabled via dopplerFiring)
        if (u.castT > 0) { u.castT -= dt; if (u.castT <= 0) {
          // borrow the player's coil to fire the copy's ONE special, then FULLY restore —
          // #9: doSpecial also writes p.recoil / G.sp.flash on the shared player, so save+restore
          // those too (else the real ship visibly recoils and the SPECIAL HUD flashes with no input).
          // #13: try/finally so a throw inside any special sub-cast can't strand the player at the copy's offset.
          var sx = p.x, sy = p.y, srec = p.recoil, sfl = G.sp.flash;
          p.x = u.x; p.y = u.y;
          try { doSpecial(true); } finally { p.x = sx; p.y = sy; p.recoil = srec; G.sp.flash = sfl; }
        } }
        break;
      }
      case 'allfather':   // study window — no per-frame work; odinBoltHit reads G.ult.god to carve every hit.
        break;
      case 'thor': {      // GIANT'S END — the giant boomerang: one colossal Mjölnir hurled up the cast
        // lane to the top, a brief hang, then back down the SAME lane. Damages on BOTH passes;
        // foes touched are slammed (LANCE_DMG*2) and hurled to the nearer side wall, bullets destroyed.
        u.ang += dt * 3 * TAU;                                  // fast tumble spin
        var pr = 1 - Math.max(0, u.t) / 2.2;                   // 0 at cast → 1 back in hand
        var topY = 60, startY = u.castT, outEnd = 0.42, hangEnd = 0.52;
        if (pr < outEnd) u.y = startY + (topY - startY) * (pr / outEnd);            // out-pass (down→up the lane)
        else if (pr < hangEnd) u.y = topY;                                          // brief hang at the top edge
        else u.y = topY + (startY - topY) * ((pr - hangEnd) / (1 - hangEnd));       // return-pass (up→down)
        var hitR = 72;
        Engine.enemies.forEach(function (e) {
          if (e.dying || e.charmed) return;
          var dx = e.x - u.x, dy = e.y - u.y;
          if (dx * dx + dy * dy < (hitR + e.radius) * (hitR + e.radius)) {
            damageEnemy(e, LANCE_DMG * 2 * D, false);
            if (!e.boss && !e.dying) {
              e.x = (e.x - 40 < (W - 40) - e.x) ? 40 : W - 40;   // hurl aside to the NEARER side wall
              e.stunT = Math.max(e.stunT, 0.5); spark(e.x, e.y, [0.6, 0.66, 0.8], 8, 400, 30);
            }
          }
        });
        Engine.bullets.forEach(function (b) { if (b.friendly) return; var bx = b.x - u.x, by = b.y - u.y; if (bx * bx + by * by < hitR * hitR) { flash(b.x, b.y, [0.6, 0.66, 0.8], 18, 0.1); Engine.bullets.release(b); } });
        break;
      }
      case 'dawnbreak':   // mode transform — Mark every foe continuously (spectrum lances fire from fireStreams).
        Engine.enemies.forEach(function (e) { if (!e.dying && !e.charmed) markEnemy(e); });
        break;
      case 'guanyu': {    // GREEN DRAGON — a blade-dragon trails player pos ~0.3s behind, carving BEAM-class ticks.
        if (!u.trail) u.trail = [];
        u.trail.push(p.x); u.trail.push(p.y);
        while (u.trail.length > 40) { u.trail.shift(); u.trail.shift(); }   // ~0.3s of frames at 60Hz (2 nums/frame)
        u.x = u.trail[0]; u.y = u.trail[1];   // head = oldest sample (the lag)
        // #1 fix: carve each foe AT MOST ONCE per frame. The ~7 sampled trail points coincide
        // when the player holds still, so damaging per-sample stacked up to ~7× the tuned DPS on
        // a stationary foe. Test each foe against all samples but apply one carving tick.
        Engine.enemies.forEach(function (e) {
          if (e.dying || e.charmed) return;
          var hit = false;
          for (var ti = 0; ti < u.trail.length && !hit; ti += 6) {
            var dx = e.x - u.trail[ti], dy = e.y - u.trail[ti + 1];
            if (dx * dx + dy * dy < (54 + e.radius) * (54 + e.radius)) hit = true;
          }
          if (hit) damageEnemy(e, BEAM_DPS * D * dt, false);
        });
        break;
      }
      case 'quetz': {     // THE FIFTH SUN — serpent coils around the player, eating bullets to gauge (zero damage).
        u.ang += dt * 2.2;
        var eaten = 0;
        Engine.bullets.forEach(function (b) {
          if (b.friendly) return;
          for (var k = 0; k < 5; k++) {
            var a = u.ang + k * (TAU / 5), sxq = p.x + Math.cos(a) * 150, syq = p.y + Math.sin(a) * 150;
            var bx = b.x - sxq, by = b.y - syq;
            if (bx * bx + by * by < 72 * 72) { addGauge(1.2); if (Engine.gold.freeTop > 0) spawnGold(b.x, b.y, 1, 0.25); spark(b.x, b.y, [0.4, 1, 0.7], 2, 160, 16); Engine.bullets.release(b); eaten++; break; }
          }
        });
        break;
      }
    }
    if (u.t <= 0) {
      if (u.god === 'greathunt') resolveGreatHunt();
      endUltimate();
    }
  }

  // ULTIMATE draw — the live timed-ultimate entities (pass C, after the other allies).
  function drawUlt() {
    var u = G.ult, p = G.player, t = G.time;
    if (u.god === 'ra') {   // solar barque + beam column beneath it
      var life = Math.min(1, u.t);
      for (var by = 40; by < H; by += 44) { var col = [1, 0.86, 0.4]; GL.draw(GL.SPR.GLOW, u.x, by, 80, 60, 0, col[0], col[1], col[2], 0.35 * life); GL.draw(GL.SPR.CORE, u.x, by, 22, 34, 0, 1, 0.95, 0.6, 0.55 * life); }
      GL.draw(GL.SPR.GLOW, u.x, u.y, 220, 120, 0, 1, 0.85, 0.35, 0.7 * life);
      GL.draw(GL.SPR.GOLD, u.x, u.y, 120, 70, 0, 1, 0.9, 0.4, 0.95 * life);
      GL.draw(GL.SPR.CORE, u.x, u.y, 44, 30, 0, 1, 1, 0.85, life);
    } else if (u.god === 'loki') {   // green owned copy (§5: green body, cyan heart, nose-up)
      var la = Math.min(1, u.t) * 0.8, pulse = 0.6 + 0.4 * Math.sin(t * 10);
      GL.draw(GL.SPR.GLOW, u.x, u.y, 72, 72, 0, 0.4, 1, 0.5, 0.5 * pulse * la);
      GL.draw(GL.SPR.SHIP_PLAYER, u.x, u.y, 72, 72, 0, 0.4, 1, 0.5, 0.9 * la);
      drawOwnedGem(u.x, u.y, la);
    } else if (u.god === 'thor') {   // GIANT'S END — one colossal boomerang hurled up the lane (spins)
      var mc = authCell('33-1-mjolnir');   // reuse the authored §9 Mjölnir at ult scale
      // faint lane guide the boomerang rides (cast x, from the hand up to the head)
      GL.draw(GL.SPR.GLOW, u.x, (u.y + u.castT) / 2, 60, Math.abs(u.castT - u.y) + 40, 0, 0.5, 0.6, 0.75, 0.10);
      GL.draw(GL.SPR.GLOW, u.x, u.y, 240, 240, 0, 0.5, 0.6, 0.75, 0.55);
      if (mc >= 0) GL.draw(mc, u.x, u.y, 200, 200, u.ang, 1, 1, 1, 1);   // authored Mjölnir, square aspect, spin rotation
      else { GL.draw(GL.SPR.SHIP_MID, u.x, u.y, 150, 150, u.ang, 0.6, 0.66, 0.8, 1); GL.draw(GL.SPR.CORE, u.x, u.y, 54, 54, 0, 0.95, 0.35, 0.3, 0.7); }   // procedural fallback
    } else if (u.god === 'guanyu' && u.trail) {   // jade blade-dragon along the lagged trail
      for (var gi = 0; gi < u.trail.length; gi += 2) {
        var f = gi / Math.max(2, u.trail.length), sz = 44 + f * 40;
        GL.draw(GL.SPR.GLOW, u.trail[gi], u.trail[gi + 1], sz * 1.5, sz * 1.5, 0, 0.3, 0.95, 0.55, 0.4);
        GL.draw(GL.SPR.CORE, u.trail[gi], u.trail[gi + 1], sz * 0.6, sz * 0.6, 0, 0.4, 1, 0.65, 0.7);
      }
      GL.draw(GL.SPR.STREAK, u.x, u.y, 60, 120, 0, 0.3, 1, 0.6, 0.9);   // dragon head
    } else if (u.god === 'quetz') {   // Sky Serpent coiled around the player
      var uhc = authCell('34-5-sky-serpent-head');   // §9 head rides the lead coil segment
      for (var qk = 0; qk < 5; qk++) {
        var qa = u.ang + qk * (TAU / 5), qx = p.x + Math.cos(qa) * 150, qy = p.y + Math.sin(qa) * 150;
        var qcol = Patterns.hue(t * 0.4 + qk * 0.2);
        GL.draw(GL.SPR.GLOW, qx, qy, 120, 120, 0, qcol[0], qcol[1], qcol[2], 0.5);
        if (qk === 0 && uhc >= 0) GL.draw(uhc, qx, qy, 130, 130, qa + Math.PI / 2, 1, 1, 1, 1);   // head leads the coil, tangent to the circle
        else GL.draw(GL.SPR.CORE, qx, qy, 44, 44, 0, qcol[0], qcol[1], qcol[2], 0.8);
      }
    } else if (u.god === 'adoration') {   // worn heart-aura
      var ap = 0.5 + 0.5 * Math.sin(t * 4);
      GL.draw(GL.SPR.GLOW, p.x, p.y, 420, 420, 0, 1, 0.4, 0.7, 0.28 + 0.1 * ap);
      GL.draw(GL.SPR.RING, p.x, p.y, 400, 400, t * 1.5, 1, 0.4, 0.7, 0.5);
    } else if (u.god === 'greathunt') {   // time-freeze wash + a hunt-arrow lock over every tagged foe
      GL.draw(GL.SPR.GLOW, W / 2, H / 2, W * 2, H * 2, 0, 0.6, 0.7, 1, 0.12);
      // task 5d: the authored kind-4 hunt-arrow sprite marks each foe the column has tagged
      // (the arrow that looses on resume). Nose-up sprite rotated pi to point DOWN at the foe.
      var hac = authCell('33-8-loosed-arrow');
      Engine.enemies.forEach(function (e) {
        if (!e.huntTag || e.dying || e.charmed) return;
        var ay = e.y - e.radius - 34 + Math.sin(t * 6 + e.x * 0.01) * 4;
        if (hac >= 0) GL.draw(hac, e.x, ay, 46, 46, Math.PI, 0.85, 0.9, 1, 0.9);
        else GL.draw(GL.SPR.NEEDLE, e.x, ay, 16, 40, Math.PI, 0.85, 0.9, 1, 0.9);
      });
    } else if (u.god === 'aristeia') {   // war-heat corona on the player
      GL.draw(GL.SPR.RING, p.x, p.y, 150, 150, -t * 4, 1, 0.3, 0.2, 0.6);
    }
  }

  // ---------------------------------------------------------------------
  // aim point — every enemy aimed pattern targets this (Loki decoy redirects
  // all aimed fire; returns the Loki decoy while it lives, else the player).
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
  function AIMX(e) { var t = tauntTarget(e); return t ? t.x : aimTX; }
  function AIMY(e) { var t = tauntTarget(e); return t ? t.y : aimTY; }
  Game.aimPoint = function () { return { x: aimTX, y: aimTY }; };

  // ---------------------------------------------------------------------
  // player
  // ---------------------------------------------------------------------
  // §9b AUTO-FIRE — a persisted pause-menu toggle (Run.meta.autoFire, default
  // OFF) that fires as if Z were held. It is only ever read inside updateCombat
  // (player / clone / decoy fire), which itself runs only while actively playing
  // and NOT paused / hitstopped / gilded — so auto-fire can never fire on the
  // title, in a shop, while paused, or mid-freeze. Uses the HELD read, never
  // Engine.pressed, so it leaves the edge semantics untouched.
  function wantFire() {
    // §Fire-hold law: any player-OWNED entity that fires (Wukong clones) reads
    // wantFire to decide whether to shoot, so it must fall silent exactly when the
    // player's own fire would. updatePlayer already early-returns on the gild-freeze
    // and on the death/respawn window, so gating here is a no-op for the player's
    // own fire path — but it is what actually silences the clones, whose updateClones
    // has no such early-return of its own. (Ravens/decoy auto-fire on their own
    // cadence, NOT via wantFire, so they are outside this gate by design.)
    if (G.freeze.t > 0) return false;                 // CURSED-GOLD gild: statue holds fire
    var p = G.player; if (p.dead || !p.alive) return false;   // dead/respawning: no owned fire
    return Engine.fireHeld() || !!(Run.meta && Run.meta.autoFire);
  }

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
      if (wantFire()) raBeam(dt);
      else { G.ra.active = false; G.ra.target = null; G.ra.targetSeq = 0; G.ra.ramp = 0; G.ra.hold = 0; }
    } else {
      p.fireT -= dt;
      if (wantFire() && p.fireT <= 0) {
        // ODIN NINE NIGHTS collapses to ONE heavy rune-bolt on a slow 0.14s cadence.
        var cad = (G.attackGod === 'guanyu') ? 1.7 : (G.attackGod === 'odin') ? (0.14 / FIRE_CD) : 1;
        p.fireT = FIRE_CD * cad / (G.stats.atkRate * frenzyRate());
        fireShots(focus); SFX.shot();
      }
    }
    if (G.thorBuff > 0) G.thorBuff -= dt;
    // Thor Mjolnir throw cycle (alongside the thinned normal stream)
    if (G.attackGod === 'thor') {
      p.hammerT -= dt;
      if (wantFire() && p.hammerT <= 0) {
        p.hammerT = G.mods.thorFast ? 0.9 : 1.4;
        throwHammer(false, 5 * G.stats.atkDmg * G.attackR * (G.mods.thorBelt ? 1.4 : 1), 300 * (G.mods.thorBelt ? 1.5 : 1));
      }
    }
    // JADE EMPEROR: edicts are now the attack itself (fired as a fan in fireStreams),
    // not a periodic side-shot — so no separate edict cadence here.
  }
  // JADE EMPEROR IMPERIAL EDICTS — the attack IS the fan: 5 homing scroll-talismans per
  // volley (~0.5 rad spread, ~0.28 focused). Each homes via the Jade block (kind 7) and
  // Stuns the non-boss it strikes (hitEnemy kind-7 handler). Replaces the old stream +
  // periodic single edict entirely.
  function fireJadeEdicts(px, py, focus, dmgScale) {
    var spread = focus ? 0.28 : 0.5;
    var dmg = 1.1 * SHOT_DMG * G.stats.atkDmg * G.attackR * (dmgScale || 1);
    var angs = streamAngles(5, spread);
    for (var i = 0; i < 5; i++) {
      var s = allocShot(); if (!s) break;
      var a = UP + angs[i];
      s.x = px; s.y = py - 30;
      s.vx = Math.cos(a) * 920; s.vy = Math.sin(a) * 920;
      s.radius = 18; s.scale = 44; s.damage = dmg; s.age = 0; s.life = 2.2;
      s.r = 0.79; s.g = 0.6; s.b = 1.0;
      s.pierce = 0; s.homing = true; s.turn = 5.0; s.kind = 7;
      s.faction = 0; s.big = false;
    }
    flash(px, py - 36, [0.8, 0.6, 1], 80, 0.14);
  }
  // Fire the full 5-edict JADE fan (verify/render helper; name kept for Game.test API compat).
  function fireEdict() { fireJadeEdicts(G.player.x, G.player.y, false, 1); }

  function streamAngles(n, spread) {
    var out = [];
    if (n === 1) { out.push(0); return out; }
    var step = spread / (n - 1);
    for (var i = 0; i < n; i++) out.push(-spread / 2 + step * i);
    return out;
  }
  // #4: set true only while the DOPPELGÄNGER copy fires, so fireStreams runs the player's
  // real signature-attack branches for the mirror (they are otherwise suppressed for clones).
  var dopplerFiring = false;
  function fireShots(focus) {
    // HEIMDALL fires ordinary dawn-gold streams; THE BIFRÖST band (updateBifrost)
    // refracts those shots that cross it — the every-4th-volley prism is retired.
    fireStreams(G.player.x, G.player.y, focus, 1, false);
    // ARISTEIA ultimate (§2.5): doubled volleys for the pinned-FRENZY window.
    if (G.ult.god === 'aristeia') fireStreams(G.player.x, G.player.y, focus, 1, false);
  }
  function fireStreams(px, py, focus, dmgScale, isClone) {
    // DAWNBREAK ultimate (§2.5): the whole field is the bridge — every player shot
    // becomes a spectrum lance from anywhere, overriding the equipped attack god.
    if (G.ult.god === 'dawnbreak' && !isClone) { fireSpectrumLance(px, py, dmgScale); return; }
    // #4: the DOPPELGÄNGER mirror is a clone (isClone) but must fire the player's SIGNATURE
    // attack, not the generic cyan default — so its signature branches key off (!isClone || mirror).
    var mirror = dopplerFiring, sig = !isClone || mirror;
    // Guan Yu crescents: the player fires them, and clones fire mini ones under SWORN BROTHERS.
    var guan = (G.attackGod === 'guanyu') || (isClone && G.duos.swornBrothers);
    var artemis = (G.attackGod === 'artemis') && sig;
    var ares = (G.attackGod === 'ares') && sig;
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

    // ARTEMIS THE HUNT — silver arrow-needles (kind 9). Straight until a Hunted is
    // branded, then they home to it (weak on purpose; the ramp is the skill).
    if (artemis) {
      var reach = G.mods.artemisCrit ? 0.6 : 0;           // HUNTER'S REACH re-anchor: +0.6 turn
      var admg = (focus ? 1.0 : 1.05) * SHOT_DMG * G.stats.atkDmg * G.attackR * dmgScale;
      var aangs = streamAngles(n, spread);
      for (var ai = 0; ai < aangs.length; ai++) {
        var as = allocShot(); if (!as) break;
        var aa = UP + aangs[ai];
        as.x = px + Math.cos(aa) * 26; as.y = py + Math.sin(aa) * 26 - 20;
        as.vx = Math.cos(aa) * SHOT_SPEED; as.vy = Math.sin(aa) * SHOT_SPEED;
        as.radius = 12; as.scale = 40; as.damage = admg; as.age = 0; as.life = 1.7;
        as.pierce = 1; as.kind = 9; as.faction = 0; as.big = false;
        as.homing = true; as.turn = 2.2 + reach; as.huntHome = true;
        as.r = 0.85; as.g = 0.9; as.b = 1.0;
      }
      return;
    }
    // ARES GREEK ARMORY — the shot metal escalates with WAR-HEAT (three hard tiers).
    if (ares) { fireArmory(px, py, focus, dmg * G.attackR); return; }

    // ODIN NINE NIGHTS — a single heavy steel-blue rune-bolt (n=1, no spread).
    if (G.attackGod === 'odin' && sig) {
      var ob = allocShot(); if (!ob) return;
      ob.x = px; ob.y = py - 20; ob.vx = 0; ob.vy = -SHOT_SPEED;
      ob.radius = 16; ob.scale = 52; ob.damage = 3.2 * SHOT_DMG * G.stats.atkDmg * G.attackR * dmgScale;
      ob.age = 0; ob.life = 1.6; ob.pierce = 0; ob.kind = 15; ob.faction = 0; ob.big = false;
      ob.r = 0.8; ob.g = 0.85; ob.b = 0.92;
      return;
    }

    // JADE EMPEROR — the attack IS the 5-edict fan.
    if (G.attackGod === 'jade' && sig) { fireJadeEdicts(px, py, focus, dmgScale); return; }

    // ANUBIS THE WEIGHING — amber ankh-bolts (kind 17) that load the scales on every foe.
    if (G.attackGod === 'anubis' && sig) {
      var wangs = streamAngles(n, spread);
      var wdmg = (focus ? 1.0 : 1.05) * SHOT_DMG * G.stats.atkDmg * dmgScale;   // base torrent (star-flat); scaleW rides the dealt dmg
      for (var wi = 0; wi < wangs.length; wi++) {
        var ws = allocShot(); if (!ws) break;
        var wa = UP + wangs[wi];
        ws.x = px + Math.cos(wa) * 26; ws.y = py + Math.sin(wa) * 26 - 20;
        ws.vx = Math.cos(wa) * SHOT_SPEED; ws.vy = Math.sin(wa) * SHOT_SPEED;
        ws.radius = 14; ws.scale = 44; ws.damage = wdmg; ws.age = 0; ws.life = 1.6;
        ws.pierce = 0; ws.kind = 17; ws.faction = 0; ws.big = false;
        ws.r = 1.0; ws.g = 0.72; ws.b = 0.28;   // amber ankh
      }
      return;
    }

    // HEIMDALL SPECTRUM LANCE — firing while standing INSIDE the rainbow band turns your
    // shot into a single prismatic lance (×1.6 dmg, pierce +2, no split, rainbow streak).
    if (G.attackGod === 'heimdall' && !isClone && G.bifrost.active && Math.abs(px - G.bifrost.x) < 20) {
      fireSpectrumLance(px, py, dmgScale); return;
    }

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
      else if (quetz) { s.weave = 1; s.phase = i * (TAU / 3); s.r = 0.4; s.g = 1.0; s.b = 0.7; }   // locked triple-helix (no RNG phase)
      else if (G.attackGod === 'heimdall') { s.r = 1.0; s.g = 0.92; s.b = 0.8; }                    // dawn-gold below the bridge
      else { s.r = 0.6; s.g = 1.0; s.b = 1.0; }
    }
  }
  // ARES GREEK ARMORY — javelins (akontia) → xiphos leaf-blades → doru bundle, one
  // LABRYS per volley at FRENZY. Tier is read from WAR-HEAT stacks (0..10).
  function fireArmory(px, py, focus, dmg) {
    var st = G.frenzy.stacks;
    var tier = st >= 8 ? 2 : st >= 4 ? 1 : 0;             // CALM / HEATED / FRENZY
    var n = focus ? 4 : 3;
    var baseSpread = focus ? 0.16 : 0.30;
    var spread = tier === 2 ? baseSpread * 0.33 : tier === 1 ? baseSpread * 0.8 : baseSpread;
    var scale = tier === 2 ? 44 * 1.9 : tier === 1 ? 44 * 1.5 : 44;
    var rad = tier === 2 ? 14 * 1.6 : tier === 1 ? 14 * 1.35 : 14;
    var pierce = tier === 2 ? 3 : tier === 1 ? 1 : 0;
    var kind = tier === 2 ? 13 : tier === 1 ? 12 : 11;    // doru / xiphos / akontia painters
    var col = tier === 2 ? [1.0, 0.55, 0.35] : tier === 1 ? [1.0, 0.15, 0.12] : [0.70, 0.20, 0.15];
    var angs = streamAngles(n, spread);
    for (var i = 0; i < angs.length; i++) {
      var s = allocShot(); if (!s) break;
      var a = UP + angs[i];
      // HEATED xiphos + FRENZY doru converge toward centre lane
      if (tier >= 1) a = UP + angs[i] * (tier === 2 ? 0.5 : 0.7);
      var ctr = (tier === 2 && Math.abs(angs[i]) < 0.001) ? 1.0 : (tier === 2 ? 0.85 : 1);
      s.x = px + Math.cos(a) * 26; s.y = py + Math.sin(a) * 26 - 20;
      s.vx = Math.cos(a) * SHOT_SPEED; s.vy = Math.sin(a) * SHOT_SPEED;
      s.radius = rad; s.damage = dmg; s.age = 0; s.life = 1.6; s.scale = scale * ctr;
      s.pierce = pierce; s.kind = kind; s.faction = 0; s.big = false;
      s.r = col[0]; s.g = col[1]; s.b = col[2];
    }
    if (tier === 2) {                                     // FRENZY — one whirling LABRYS per volley
      var lb = allocShot(); if (lb) {
        lb.x = px; lb.y = py - 20; lb.vx = 0; lb.vy = -SHOT_SPEED * 0.72;   // ~520px reach over its life
        lb.radius = 34; lb.scale = 74; lb.damage = dmg * 1.6; lb.age = 0; lb.life = 1.35;
        lb.pierce = 3; lb.kind = 14; lb.faction = 0; lb.big = false;
        lb.r = 0.78; lb.g = 0.12; lb.b = 0.12; lb.spin = 0;
      }
    }
    // tier-cross upward → red muzzle bloom + kindle; downward → a cooling tier-down cue
    if (tier > G.frenzy.prevTier) { flash(px, py - 30, [1, 0.3, 0.2], 130, 0.18); G.frenzy.bloom = 0.16; if (SFX.tierUp) SFX.tierUp(); else SFX.boom(); }
    else if (tier < G.frenzy.prevTier && SFX.tierDown) SFX.tierDown();
    G.frenzy.prevTier = tier;
  }

  // ================= HEIMDALL — THE BIFRÖST (v2, SPECTRUM LANCE) =================
  // Between bridges, ordinary dawn-gold streams. On a 6.0s cadence while firing: a 0.5s
  // dotted dawn-seam traces BOTTOM→TOP at the player's CURRENT x, then a full-height
  // VERTICAL rainbow band (~32px) locks at that x for 4.0s. Shots FIRED while the player
  // stands inside the band become prismatic lances (fireSpectrumLance). Foes overlapping
  // the band are Marked (bosses included). A drawn hazard (G.bifrost), never a pooled entity.
  function updateBifrost(dt) {
    var bf = G.bifrost;
    if (G.attackGod !== 'heimdall') { if (bf.active || bf.seamT > 0) { bf.active = false; bf.seamT = 0; bf.life = 0; bf.t = 0; } return; }
    if (bf.life > 0) {
      // solid VERTICAL band: Mark any foe whose hull overlaps the ~32px-wide lane.
      Engine.enemies.forEach(function (e) { if (e.dying || e.charmed) return; if (Math.abs(e.x - bf.x) < 16 + e.radius) { markEnemy(e); if (!e.markShimmer) { e.markShimmer = 1; flash(e.x, e.y, [1, 0.95, 0.85], 60, 0.2); } } else e.markShimmer = 0; });
      bf.life -= dt; if (bf.life <= 0) { bf.active = false; if (SFX.bridgeFade) SFX.bridgeFade(); else (SFX.bell && SFX.bell()); }   // Pass4: descending bridge-fade pair
      return;
    }
    if (bf.seamT > 0) {   // telegraph rising bottom→top; x frozen at seam start (rising bell arpeggio, Pass 3)
      bf.seamT -= dt;
      if (bf.seamT <= 0) { bf.active = true; bf.life = 4.0; if (SFX.seamArp) SFX.seamArp(); else (SFX.hit && SFX.hit()); }   // Pass4: band locks solid
      return;
    }
    // between bridges: count the cadence only while actually firing.
    if (wantFire()) {
      bf.t += dt;
      if (bf.t >= 6.0) { bf.t = 0; bf.seamT = 0.5; bf.x = G.player.x; if (SFX.seamArp) SFX.seamArp(); else (SFX.hit && SFX.hit()); }   // Pass4: seam telegraph rises
    }
  }
  // HEIMDALL SPECTRUM LANCE — one prismatic bolt: ×1.6 dmg, pierce +2, no split.
  function fireSpectrumLance(px, py, dmgScale) {
    var s = allocShot(); if (!s) return;
    s.x = px; s.y = py - 20; s.vx = 0; s.vy = -SHOT_SPEED;
    s.radius = 16; s.scale = 50;
    s.damage = 1.6 * SHOT_DMG * G.stats.atkDmg * G.attackR * (dmgScale || 1);   // lance = the signature (rides attackR)
    s.age = 0; s.life = 1.6; s.pierce = 2; s.kind = 18; s.faction = 0; s.big = false;
    var col = Patterns.hue(G.time * 0.5); s.r = col[0]; s.g = col[1]; s.b = col[2];
    flash(px, py - 30, [1, 0.95, 0.85], 90, 0.14);
    if (SFX.refractShimmer) SFX.refractShimmer();   // Pass4: SPECTRUM LANCE prismatic shimmer
  }

  function updateShots(dt) {
    Engine.shots.forEach(function (s) {
      s.age += dt;
      if (s.homing && s.turn > 0) {                       // Jade edict homing
        // ARTEMIS arrows steer ONLY toward the branded Hunted; with none branded
        // they fly dead straight (huntHome, no fallback) — the "straight until branded" law.
        var t = s.huntHome ? huntFoe() : s.loosed ? loosedTarget() : nearestEnemy(s.x, s.y);
        // LOOSED ARROW only re-aims at a target roughly AHEAD (forward cone) — it
        // pierces through, never U-turns back onto a foe it already passed.
        if (t && s.loosed) { var fdx = aimTargetX(t) - s.x, fdy = aimTargetY(t) - s.y; if (fdx * s.vx + fdy * s.vy <= 0) t = null; }
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
    e.lastHitFireId = 0;   // §9a pierce-dedup: reset so a recycled slot isn't "already bitten"
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
    e.marked = false; e.markT = 0; e.weak = false; e.weakT = 0; e.weakStacks = 0; e.markShimmer = 0; e.ghost = false;
    // ULTIMATES (§2.5) per-foe fields — GREAT HUNT column tag, ADORATION dwell timer,
    // THE DELUGE mire slow. Reset ONLY here on pool reuse (cleared live at wave/swap).
    e.huntTag = false; e.adoreT = 0; e.mireT = 0;
    e.burnT = 0; e.burnDps = 0; e.trickStacks = 0; e.stunT = 0; e.trickBudget = 0; e.judgeT = 0; e.sealT = 0;
    // ODIN NINE NIGHTS — carved runes (0..9) are PERMANENT for this enemy's life
    // (per-enemy knowledge; reset ONLY here on pool reuse, never by phase transitions).
    e.runes = 0; e.runeHits = 0;
    // QUETZ THE COIL — per-target coil count (0..6) + decay clock (0.9s to uncoil).
    e.coilQ = 0; e.coilT = 0;
    // ANUBIS THE WEIGHING — per-foe accrued weight on the scales (reset only here).
    e.scaleW = 0;
    // ANUBIS GATE OF DUAT — per-cast boss drain accumulator (cleared here on pool reuse
    // AND at each gateOfDuat cast, so a boss loses at most min(0.05·specialR,0.15)·maxhp/cast).
    e.duatDmg = 0;
    // LOKI MISCHIEF — pickpocket stack (0..3) + decay clock + per-foe pilfer cooldown.
    e.mischief = 0; e.mischiefT = 0; e.pilferCd = 0;
    // §3 PRECISION weak-point node: nodeState 0=none 1=telegraph 2=open; nodeT = phase clock.
    // nodeDX/nodeDY = offset from hull centre; nodeX/nodeY = tracked absolute position.
    e.nodeState = 0; e.nodeT = 0; e.nodeDX = 0; e.nodeDY = 0; e.nodeX = 0; e.nodeY = 0; e.nodeHit = 0; e.nodeCd = 2.5;
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
    // §8 boss damage-tithe accumulator (a unit = maxhp*0.025) + per-kit boss-mode
    // gates. MUST reset on pooled reuse or a recycled boss slot inherits a stale
    // tithe / retinue schedule and double-summons on the next fight.
    e.dmgTithe = 0; e.dmgTitheUnits = 0; e.wukongBossClone = false;
    // §8 retinue: on a boss, the summon schedule (kind/target/respawn cd/hue); on an
    // add, its link back to the summoning boss (seq guard) + role + vacuum share.
    e.retinueKind = ''; e.retinueTarget = 0; e.retinueRespawn = 0; e.retinueCd = 0; e.retinueCol = null;
    e.retinueSeq = 0; e.retinueRole = ''; e.retinueOff = 0; e.retVac = 0;
    // reset-ALL-fields discipline (historic #1 bug class): the add's link back to its
    // summoning boss (retLinkSeq), its stable orbit slot (retIdx), and the boss-side
    // cached live-count (retinueLive, fix #7) MUST all clear on pooled reuse.
    e.retLinkSeq = 0; e.retIdx = 0; e.retinueLive = 0;
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
      case 'loki':
        // PILFER — every landed shot +1 MISCHIEF (cap 3 / decay 2.5s). PICKPOCKET
        // (lokiChance) pilfers on the 2nd mark and steals 12 instead of 8.
        var need = G.mods.lokiChance ? 2 : 3;
        e.mischief = Math.min(need, e.mischief + 1); e.mischiefT = 2.5;
        if (e.mischief >= need && e.pilferCd <= 0) lokiPilfer(e, G.mods.lokiChance ? 12 : 8);
        break;
      // anubis = THE WEIGHING (kind-17 ankh-bolts accrue scaleW → the Verdict) in hitEnemy;
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
    // To-code: a KINETIC water-slap per landed shot so the shove is *felt*.
    spark(e.x, e.y + e.radius * 0.4, [0.4, 0.85, 0.95], 3, 220, 18);
    if (Math.random() < 0.25) SFX.thud();
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

  function charmEnemy(e, durMul) {
    if (e.boss || e.charmed) return;
    creditForm(e);   // charming a squadron member counts as defeating it (fix #1)
    e.charmed = true; e.charmMeter = 0;
    // §7 star fix #2: the HEARTSEEKER SPECIAL routes its charm DURATION through
    // specialR (durMul = G.specialR at the special call site) so a special star is
    // visible on the charm too; base-attack charms pass no durMul (star-flat torrent).
    e.charmT = CHARM_TIME * (G.mods.aphroLong ? 1.6 : 1) * (durMul || 1);
    spark(e.x, e.y, [1, 0.5, 0.85], 10, 260, 28);
    flash(e.x, e.y, [1, 0.5, 0.85], 60, 0.2);
  }

  function updateStatus(e, dt) {
    // marked / weak decay
    if (e.markT > 0) { e.markT -= dt; if (e.markT <= 0) e.marked = false; }
    if (e.weakT > 0) { e.weakT -= dt; if (e.weakT <= 0) { e.weak = false; e.weakStacks = 0; } }   // lapsed Weaken drops its stacks (no stale-stack re-hit bonus)
    // Burn (DoT); Ra 'spread' handled in killEnemy on death
    if (e.burnT > 0) {
      e.burnT -= dt; e.hp -= e.burnDps * dt; clampBossHp(e);   // burn respects the spellcard floor too
      if (Math.random() < dt * 9) spark(e.x, e.y, [1, 0.5, 0.12], 1, 130, 14);
      if (e.hp <= 0) { killEnemy(e, true); return; }
    }
    if (e.stunT > 0) e.stunT -= dt;
    if (e.mireT > 0) e.mireT -= dt;   // THE DELUGE ultimate: mire-slow ticks down (refreshed while inside)
    if (e.sealT > 0) e.sealT -= dt;   // JADE edict style-C seal-mark fade (drawn in drawKitOverlays)
    // Ares terror / shaken
    if (e.terrorT > 0) e.terrorT -= dt;
    if (e.shakenT > 0) e.shakenT -= dt;
    // charm meter slow decay
    if (!e.charmed && e.charmMeter > 0) e.charmMeter = Math.max(0, e.charmMeter - dt * 0.5);
    // QUETZ THE COIL — uncoil 0.9s after the last bite (whole coil releases at once).
    if (e.coilT > 0) { e.coilT -= dt; if (e.coilT <= 0) { if (e.coilQ > 0 && SFX.uncoil) SFX.uncoil(); e.coilQ = 0; } }   // Pass4: whole coil releases with an uncoil cue
    // LOKI MISCHIEF — pickpocket stacks decay after 2.5s; per-foe pilfer cooldown.
    if (e.mischiefT > 0) { e.mischiefT -= dt; if (e.mischiefT <= 0) e.mischief = 0; }
    if (e.pilferCd > 0) e.pilferCd -= dt;
    // §3 PRECISION weak-point node lifecycle: telegraph → open → expire; tracks the hull.
    if (e.nodeState > 0) {
      e.nodeX = e.x + e.nodeDX; e.nodeY = e.y + e.nodeDY;
      e.nodeT -= dt;
      if (e.nodeState === 1 && e.nodeT <= 0) { e.nodeState = 2; e.nodeT = 2.0; }
      else if (e.nodeState === 2 && e.nodeT <= 0) { e.nodeState = 0; }
    }
    if (e.nodeHit > 0) e.nodeHit -= dt;
    // HUNTER'S EYE re-anchor — Marked foes ALWAYS expose an open node, force-opened
    // (no telegraph delay) and CENTERED on the hull so Artemis's body-homing kind-9
    // arrows reliably clip it (an offset node the arrows steer past would defeat the duo).
    if (G.duos.huntersEye && e.marked) {
      if (e.nodeState !== 2) { e.nodeState = 2; e.nodeDX = 0; e.nodeDY = 0; e.nodeT = 2.0; e.nodeX = e.x; e.nodeY = e.y; }
      else if (e.nodeT < 0.5) { e.nodeDX = 0; e.nodeDY = 0; e.nodeT = 2.0; }   // keep it open + centered while Marked
    }
    // §3 PRECISION cadence for ELITES (bosses author nodes on spellcard beats instead):
    // a telegraphed node opens ~every 3.4s so crit lives on the add-less/elite fights.
    if (e.elite && !e.boss) { if (e.nodeCd > 0) e.nodeCd -= dt; else if (e.nodeState === 0) { openNode(e, (Math.random() - 0.5) * e.scale * 0.4, -e.scale * 0.15); e.nodeCd = 3.4; } }
    // ODIN NINE NIGHTS — carve-timing knowledge (runes never decay; nothing to tick).
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
    e.arch = 'gunship';   // #8: wire the archetype so enemyDrawCell resolves the authored '32-2-gunship' sprite (was orphaned)
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
    announce('THE APOSTATE', 'renegade of ' + gn(g1) + ' & ' + gn(g2), 3.2, '25-the-apostate');
    e.onUpdate = updateApostate; e.onDeath = apostateDeath;
  }
  function updateApostate(e, dt) {
    e.t += dt;
    if (e.y < 420) { e.y += 150 * dt; return; }
    // §8 UNIVERSAL FALLBACK: THE APOSTATE runs its own loop (not the setlist engine), so
    // it never armed a bespoke retinue nor accrued a tithe. On arrival, flag it arrived
    // (opens the damage-tithe accumulator in damageEnemy) and arm a light ESCORT retinue —
    // the generic swoop-in/one-beat/leave add — so every kill/damage-fed kit still feeds
    // against a boss with no bespoke summons.
    if (!e.arrived) { e.arrived = true; armRetinue(e, 'escort', 2, 6, [e.r, e.g, e.b]); }
    maintainRetinue(e, dt);
    e.x = W / 2 + Math.sin(e.t * 0.5) * 260; e.rot = Math.PI;
    e.fireT -= dt;
    if (e.fireT <= 0) { e.fireT = 1.4; apostateFire(e, (Math.floor(e.t / 3) % 2 === 0) ? e.g1 : e.g2); }
  }
  function apostateDeath(e) { expireRetinue(e); G.boss = null; bigDeath(e, 80); announce('APOSTATE SILENCED', 'a boon is torn free', 2.4); Run.grantApostateDraft(); }
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
    if (d) { d.arch = 'fakedecoy'; d.vy = 0; d.onUpdate = function (dd, ddt) { dd.t += ddt; dd.rot = Math.min(1, Math.max(0, (dd.t - 0.6) / 0.15)) * Math.PI; if (dd.t > 4) killEnemy(dd, false); }; }   // §5 curdle: nose swings down
  }
  function apostateClones(e) {
    spawnLoose(function () {   // apostate clones are summons — never squadron members (fix #2)
      for (var i = 0; i < 2; i++) { var c = newEnemy(1, e.x + (i ? 120 : -120), e.y + 60, 40, GL.SPR.SHIP_POP, 60, 26, [1, 0.5, 0.3], 3, 300, false); if (c) { c.vy = 120; c.fireCd = 1.0; c.arch = 'apostateclone'; c.onUpdate = updateEscort; } }   // §5 hostile mimic: instant red heart, nose-down
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
  function bossEnterPhase(e, phases, cfg, i, transition, cleared) {
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
    // §8: a real transition means the PRIOR segment was cleared — fire the bursty
    // per-kit reward-kill BEFORE expiring the old retinue and re-arming. Retinues are
    // phase-gated: the leaving phase's adds die (carry no HP, so no segment wall).
    // fix #4: the per-kit segment-clear PAYOUT (Ares War-Heat, Wukong clone, Anubis
    // gauge+coins, addCharge) fires ONLY on a real HP-depletion clear, never on a phase
    // TIMEOUT — mirroring line 3991's PHASE SEIZED / HUBRIS withholding. Surviving to
    // timeout can no longer farm the kit economy. The retinue expiry + cancel-to-gold
    // below still run on either transition (structural cleanup, not a reward).
    if (transition && cleared) bossSegmentClear(e);
    expireRetinue(e); e.retinueKind = ''; e.retinueTarget = 0; e.retinueCd = 0;
    if (ph.onEnter) ph.onEnter(e, cfg);    // phase hook (TALOS arms the nail / phase summons its retinue here)
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
    maintainRetinue(e, dt);                // §8: respawn downed adds on the refractory (phase-gated)
    e.phaseT += dt;
    if (e.phase < phases.length - 1) {
      var timedOut = e.phaseT >= phases[e.phase].timeout;
      if (e.hp <= e.segFloorHp || timedOut) {
        // The cleared-vs-timeout distinction already lives here: `!timedOut` == a real
        // HP-depletion clear. Thread that SAME flag (fix #4) into bossEnterPhase so the
        // kit payout mirrors the PHASE SEIZED / HUBRIS grant exactly — both fire only on
        // a genuine clear, neither on a survive-to-timeout.
        var seized = !timedOut;
        if (seized) { skillEvent(e.x, e.y - 40, 'PHASE SEIZED', 30); G.tally.phases++; }   // homage: beaten on damage — grants a HUBRIS step
        bossEnterPhase(e, phases, cfg, e.phase + 1, true, seized);
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

  // ==================================================================
  // §8 — BOSS SUMMONS & DAMAGE-TITHE (two independent layers).
  // ==================================================================

  // LAYER 1 — per-kit boss-mode reroute. CONTINUOUS events (one per tithe unit).
  // The BURSTY half (segment-clear) lives in bossSegmentClear below. Together they
  // keep kill/damage-fed kits alive through the long immune/wall phases of a boss.
  function bossTitheUnit(e) {
    // WUKONG: the first hit summons a clone; each subsequent unit refreshes the
    // oldest clone +1.5s (cap 7s) — a boss is enough sustained fire to hold clones.
    if (G.attackGod === 'wukong') {
      if (!e.wukongBossClone || G.clones.length === 0) { e.wukongBossClone = true; spawnClone(); }
      else { var c = G.clones[0], cap = 7; c.timer = Math.min(cap, c.timer + 1.5); }
    }
    // ZEUS FIELD (mod): a static zap field wells up beneath the boss each unit.
    if (G.mods.zeusField) spawnZapField(e.x + (Math.random() - 0.5) * 60, e.y + e.scale * 0.3);
    // UNIVERSAL: the tithe unit is worth a fraction of a kill's special charge, so a
    // long immune phase still trickles the shared on-kill economy for every kit.
    addCharge(SP_KILL * 0.25);
  }

  // LAYER 1 — BURSTY: a phase-segment cleared reads as ONE reward-kill for the kit.
  // Fires the raw on-kill path once at 1× for un-wired kill-fed kits; the named kits
  // get their §8 bonus. Called from bossEnterPhase on every transition (~5-6×/fight).
  function bossSegmentClear(e) {
    // ARES: +1 War-Heat per segment-clear (frenzy also decays 50% slower in any boss
    // fight — see updateFrenzy — so it BUILDS across the setlist).
    if (G.attackGod === 'ares' || G.specialGod === 'ares') addFrenzy();
    // WUKONG: a fresh clone rolls on the clear.
    if (G.attackGod === 'wukong') { e.wukongBossClone = true; spawnClone(); }
    // ANUBIS: the phase's final blow pays +50% segment cancel-gold (a bonus coin spray
    // over the shared transition cancel) + drops an APOTHEOSIS shard into the gauge.
    if (G.attackGod === 'anubis' || G.specialGod === 'anubis') {
      addGauge(4);
      if (Engine.gold.freeTop > 6) for (var _ag = 0; _ag < 6; _ag++) spawnGold(e.x, e.y, 1, 0.5 * 0.5, 0, 4);
    }
    // UNIVERSAL fallback: one reward-kill of the shared economy (charge) so a boss that
    // summons NO adds still feeds Jade's bolt window, Odin's raven dives, Artemis' hunt,
    // etc. once per segment.
    addCharge(SP_KILL);
  }

  // LAYER 2 — FICTION-GATED RETINUE (additive economy, phase-gated summons).
  // Shared: a pop-sized ENTITY tinted to the boss hue, tiny HP (~0.3s of default
  // fire), linked to the summoning boss by seq. HARD CAPS: max 3 concurrent, spawns
  // gated behind a per-boss refractory, and they carry NO boss HP (killEnemy(false)
  // never wipes a segment). killEnemy(reward=true) wires every kill-fed kit for free.
  var RETINUE_MAX = 3;
  // Ground-truth scan (verify surface + resync). maintainRetinue uses the cached
  // boss.retinueLive counter instead (fix #7 — no per-frame closure/scan).
  function retinueCount(boss) {
    var n = 0;
    Engine.enemies.forEach(function (e) { if (!e.dying && e.retinueSeq === boss.seq) n++; });
    return n;
  }
  // fix #3: assign a STABLE free orbit slot (lowest unused retIdx among live members),
  // not the live count — so a respawn after one add dies can't reuse the survivor's
  // index (which would collapse counter-rotating rings / stack bearers on one flank).
  function freeRetSlot(boss) {
    var used = 0;
    Engine.enemies.forEach(function (e) { if (!e.dying && e.retinueSeq === boss.seq) used |= (1 << e.retIdx); });
    for (var i = 0; i < RETINUE_MAX; i++) if (!(used & (1 << i))) return i;
    return RETINUE_MAX - 1;   // unreachable: caller gates on retinueLive < RETINUE_MAX
  }
  function expireRetinue(boss) {
    Engine.enemies.forEach(function (e) { if (!e.dying && e.retinueSeq === boss.seq) killEnemy(e, false); });
  }
  // Spawn ONE retinue add for `boss` in its current retinueKind, materializing at the
  // boss body (RING implode + GLOW pop in the boss hue) then flying to station.
  function spawnRetinueAdd(boss) {
    if (!boss.retinueKind || boss.retinueLive >= RETINUE_MAX) return null;   // fix #7: cached count, no scan
    var col = boss.retinueCol || [boss.r, boss.g, boss.b];
    var idx = freeRetSlot(boss);    // fix #3: stable free slot 0/1/2, not the live count
    var e = spawnLoose(function () { return newEnemy(1, boss.x, boss.y, 30, GL.SPR.SHIP_POP, 74, 30, col, 6, 900, false); });
    if (!e) return null;
    e.retinueSeq = boss.seq; e.retinueRole = boss.retinueKind; e.arch = boss.retinueKind;   // arch → authored sprite (assessor/tribute have art; rivet falls back to SHIP_POP)
    e.retIdx = idx;                       // stable slot for this add's life (fix #3)
    e.s0 = idx * Math.PI;                 // orbit phase / stagger
    e.s3 = (idx % 2) ? -1 : 1;            // counter-rotation sign
    e.retLinkSeq = boss.seq;
    boss.retinueLive++;                   // fix #7: cached live-count (dec in killEnemy)
    // materialize: RING implode toward the add + GLOW pop, ~0.2s spawn-tether flash.
    ringShock(boss.x, boss.y, col, 90, -2400, 0.45);   // negative grow = collapsing ring (implode)
    flash(boss.x, boss.y, col, 120, 0.32); spark(boss.x, boss.y, col, 8, 300, 26);
    if (SFX.summon) SFX.summon();
    if (boss.retinueKind === 'rivet') {
      // RIVETS (TALOS THE NAIL): orbit the immune body r180, an 8-ring/1.5s. The ONLY
      // kill/damage feed through the immune finale — so they persist & respawn.
      e.retFire = 1.5;
      e.onUpdate = function (r, dt) {
        var b = G.boss;
        if (!b || b.seq !== r.retLinkSeq) { r.y += 130 * dt; if (r.y > H + 90) killEnemy(r, false); return; }
        r.s0 += dt * 1.4 * r.s3;
        r.x = b.x + Math.cos(r.s0) * 180; r.y = b.y + Math.sin(r.s0) * 180;
        r.retFire -= dt;
        if (r.retFire <= 0) { r.retFire = 1.5; P.ring(r.x, r.y, 8, rankSpd(P.SPD.slow), { fam: P.FAM.ORB, tier: 'S', color: col }); }
      };
    } else if (boss.retinueKind === 'assessor') {
      // THE ASSESSORS (AMMIT FORTY-TWO CONFESSIONS): two counter-rotating jackal
      // emitters (orbitPoint r~110) each firing 21 (=42 together). Killed side gilds
      // to coins; the survivor keeps its lopsided 21 with a drifting gap.
      e.retFire = 0.6 + idx * 0.95;
      e.onUpdate = function (r, dt) {
        var b = G.boss;
        if (!b || b.seq !== r.retLinkSeq) { r.y += 130 * dt; if (r.y > H + 90) killEnemy(r, false); return; }
        r.s0 += dt * 1.1 * r.s3;
        r.x = b.x + Math.cos(r.s0) * 110; r.y = b.y + 40 + Math.sin(r.s0) * 110;
        r.retFire -= dt;
        if (r.retFire <= 0) { r.retFire = 1.9; P.ringGap(r.x, r.y, 21, rankSpd(P.SPD.slow), { gaps: 1, gapWidth: 3.0, offset: r.s0, fam: P.FAM.ORB, tier: 'S', color: col }); }
      };
      e.onDeath = function (r, reward) {   // killed-side shots gild to coins (kill to lighten the Confessions)
        // fix #1: only a genuine player kill gilds coins; a forced despawn (phase
        // transition / boss-death fly-off, reward=false) spends only the death puff.
        if (reward && Engine.gold.freeTop > 3) for (var k = 0; k < 4; k++) spawnGold(r.x, r.y, 1, 0.5);
        spark(r.x, r.y, [1, 0.85, 0.4], 10, 320, 26);
      };
    } else if (boss.retinueKind === 'tribute') {
      // TRIBUTE BEARERS (MIDAS THE TRIBUTE): amber bearers that vacuum a share into
      // the hoard; killing one drops 3 REAL gold AND starves the king (subtracts its
      // vacuumed share from e.hoard). Warm-amber body, never loot-gold.
      e.retinueOff = (idx === 0 ? -220 : idx === 1 ? 220 : 0);
      e.onUpdate = function (r, dt) {
        var b = G.boss;
        if (!b || b.seq !== r.retLinkSeq) { r.y += 130 * dt; if (r.y > H + 90) killEnemy(r, false); return; }
        r.t += dt;
        var tx = b.x + r.retinueOff, ty = b.y + 210 + Math.sin(r.t * 2) * 14;
        r.x += (tx - r.x) * Math.min(1, dt * 3); r.y += (ty - r.y) * Math.min(1, dt * 3);
        if (b.isMidas) { var v = 26 * dt; r.retVac += v; b.hoard += v; }   // vacuum a share into the hoard
      };
      e.onDeath = function (r, reward) {
        // fix #1 + hoard decision: BOTH the 3-gold loot AND the STARVE (hoard reclaim)
        // are KILL rewards per §8 ("killing one drops 3 real gold AND subtracts its
        // vacuumed share ... kill to STARVE the king"). On a NON-rewarded despawn (phase
        // transition to MIDAS III, or the boss-death fly-off) neither fires: the bearer's
        // vacuumed tribute STAYS in the hoard and pays out in the finale jackpot (§8
        // onDeath erupts the whole hoard), so gold is conserved — nothing vanishes. Were
        // we to reclaim on a non-kill despawn, that vacuumed gold would be subtracted from
        // the hoard yet (loot now gated) never re-spawned = silently deleted; leaving it
        // banked in the hoard is both conserving and true to the "starve = kill" fiction.
        if (reward) {
          spawnGold(r.x, r.y, 3, 1.0);                                     // 3 real gold
          // fix #5: seq-guard the GLOBAL G.boss read (mirror the onUpdate guard) so a
          // stale bearer dying while a DIFFERENT isMidas king is live can't starve the
          // wrong hoard.
          var b = G.boss;
          if (b && b.seq === r.retLinkSeq && b.isMidas) b.hoard = Math.max(0, b.hoard - r.retVac);
        }
        spark(r.x, r.y, [1, 0.75, 0.3], 12, 320, 26);
      };
    } else {
      // UNIVERSAL FALLBACK 'escort' — any boss WITHOUT a bespoke retinue (THE APOSTATE,
      // future bosses): the shared retinue shape — swoop in from the boss body, hold a
      // beat, ONE unaimed geometry beat, then exit/die. Respawned on the refractory by
      // maintainRetinue so a boss with no bespoke summons still feeds kill/damage kits.
      var sideX = (idx % 2) ? W * 0.72 : W * 0.28;
      P_swoopHold(e, boss.x, clampX(sideX, 200), 470, sideX < W / 2 ? W + 160 : -160);
      setScript(e, [
        { t: 0.2, fn: function (r) { r.poseT = 0.3; muzzle(r, col); } },
        { t: 0.9, fn: function (r) { P.ring(r.x, r.y, 12, rankSpd(P.SPD.slow), { fam: P.FAM.ORB, tier: 'S', color: col, offset: r.s0 }); } }
      ], 3.0, 0);
      e.onUpdate = pathEnemyUpdate;   // path 'exit' seg → killEnemy(false); no boss HP, never walls a segment
    }
    return e;
  }
  // Fill to target instantly (the phase-enter materialize burst).
  function fillRetinue(boss) {
    var guard = 0;
    while (boss.retinueLive < boss.retinueTarget && guard++ < RETINUE_MAX) spawnRetinueAdd(boss);   // fix #7: cached count
    boss.retinueCd = boss.retinueRespawn;
  }
  // Per-frame: respawn a downed add once the refractory elapses (phase-gated). fix #7:
  // reads the cached boss.retinueLive — no per-frame closure alloc / enemy full-scan.
  function maintainRetinue(boss, dt) {
    if (!boss.retinueKind) return;
    if (boss.retinueCd > 0) boss.retinueCd -= dt;
    if (boss.retinueLive < boss.retinueTarget && boss.retinueCd <= 0) {
      spawnRetinueAdd(boss); boss.retinueCd = boss.retinueRespawn;
    }
  }
  // A phase declares its retinue via onEnter (see the boss setlists). This arms the
  // schedule and materializes the opening pair.
  function armRetinue(boss, kind, target, respawn, col) {
    boss.retinueKind = kind; boss.retinueTarget = target; boss.retinueRespawn = respawn; boss.retinueCol = col;
    fillRetinue(boss);
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
    announce('TALOS', 'the bronze sentinel', 2.4, '22-talos');
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
        { t: 0.5, fn: function (e) { e.s0 += 0.4; P.pulse(e.x, e.y, { rings: 3, count: 16, speed: rankSpd(P.SPD.slow), speedStep: 58, offset: e.s0, colorA: BRZ, colorB: HOT }); openNode(e, 0, -e.scale * 0.2); } },   // §3 weak-point beat
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
        onEnter: function (e) { e.nailActive = true; e.nailR = 30; e.nailX = e.x; e.nailY = e.y + e.scale * 0.44; armRetinue(e, 'rivet', 2, 4, HOT); },   // §8: 2 RIVETS feed kill/damage kits through the immune finale
        script: [
        pose(BRZ, 0.36),
        { t: 0.3, fn: function (e) { e.s0 += 0.5; P.pulse(e.x, e.y, { rings: 3, count: 18, speed: rankSpd(P.SPD.slow), speedStep: 60, offset: e.s0, colorA: BRZ, colorB: HOT }); openNode(e, 0, -e.scale * 0.2); } },   // §3 weak-point beat (THE NAIL)
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
    announce('AMMIT', 'devourer of hearts', 2.6, '23-ammit');
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
        { t: 2.3, fn: function (e) { e.s1 += 0.5; P.ring(e.x, e.y, 20, rankSpd(P.SPD.slow), { fam: P.FAM.SHARD, tier: 'M', color: LIME, offset: e.s1, accel: -150, accel2: 130, accelSwitchT: 0.8, minSpeed: 8 }); openNode(e, 0, -e.scale * 0.2); } }   // §3 weak-point beat
      ] },
      // II THE FORTY-TWO CONFESSIONS — judgment rings of LITERALLY 42 bullets each,
      // counter-rotating at stepped speeds so their interleave drifts the safe gaps.
      { name: 'THE FORTY-TWO CONFESSIONS', hp: 0.15, timeout: 32, path: bp_holdCenter, loop: 2.6,
        onEnter: function (e) { armRetinue(e, 'assessor', 2, 5, MAG); },   // §8: THE ASSESSORS — two counter-rotating 21-emitters (=42)
        script: [
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
    announce('MIDAS', 'the gilded king', 3.0, '24-midas');
    var AMB = [1.0, 0.58, 0.2], ROSE = [1.0, 0.32, 0.55], MAG = P.MAGENTA, ACC = [1.0, 0.86, 0.4];
    var cfg = { holdY: 420, centerX: W / 2, strafe: 260 };
    function pose(col, h) { return { t: 0, fn: function (e) { e.poseT = h || 0.44; muzzle(e, col || AMB); } }; }
    var phases = [
      // I THE GOLDEN TOUCH — the lattice forms; his bullets leave brief gilded trails
      // (gild:true — updateBullets streaks a fading gold mote behind each).
      { name: 'THE GOLDEN TOUCH', hp: 0.14, timeout: 32, path: bp_holdCenter, loop: 2.8, script: [
        pose(AMB),
        { t: 0.4, fn: function (e) { e.s0 += 0.4; P.ringGap(e.x, e.y, 34, rankSpd(P.SPD.slow), { gaps: 2, gapWidth: 4.2, offset: e.s0, fam: P.FAM.ORB, tier: 'M', color: AMB, gild: true }); openNode(e, 0, -e.scale * 0.2); } },   // §3 weak-point beat
        { t: 1.0, fn: function (e) { e.s0 += 0.4; P.ringGap(e.x, e.y, 34, rankSpd(P.SPD.slow), { gaps: 2, gapWidth: 4.2, offset: e.s0 + 0.2, fam: P.FAM.RING, tier: 'M', color: ROSE, gild: true }); } },
        { t: 1.7, fn: function (e) { e.s0 += 0.4; P.ringGap(e.x, e.y, 34, rankSpd(P.SPD.mid), { gaps: 2, gapWidth: 4.2, offset: e.s0 + 0.4, fam: P.FAM.ORB, tier: 'S', color: AMB, gild: true }); } }
      ] },
      // II THE TRIBUTE — rising walls (edict arcWalls) + gold rain, two speeds.
      { name: 'THE TRIBUTE', hp: 0.15, timeout: 32, path: bp_pendulum, loop: 2.6,
        onEnter: function (e) { armRetinue(e, 'tribute', 2, 5, AMB); },   // §8: TRIBUTE BEARERS — kill to starve the hoard
        script: [
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
        if (e.mireT > 0 && !e.boss) fr *= 0.35;          // THE DELUGE ultimate: foes inside the calm zone are slowed
        if (e.onUpdate) e.onUpdate(e, dt * fr);
        Patterns.clearSource();
      }
      if (terrified) {                                  // continued flee acceleration
        var fx = e.x - G.player.x, fy = e.y - G.player.y, fd = Math.hypot(fx, fy) || 1;
        e.dispVX += (fx / fd) * 260 * dt; e.dispVY += (fy / fd) * 260 * dt;
      }
      integrateDisp(e, dt);
      if (!e.dying) { e.x += e.dispX; e.y += e.dispY; }
    });
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
    if (e.weak) m *= 1.10 + 0.08 * (e.weakStacks || 0);   // HEARTSEEKER Weaken stacks (+8%/heart)
    if (e.terrorT > 0) m *= 1.20;                 // Ares Terror
    if (e.shakenT > 0) m *= 1.10;                 // Ares Shaken (boss)
    if (e.stunT > 0 && G.mods.jadeStun) m *= 1.25; // Jade: Stunned foes take +25%
    if ((e.boss || e.elite) && G.charmElite > 1) m *= G.charmElite; // EAGLE FEATHER charm
    dmg *= m;
    // §3 PRECISION — RNG crit is retired. `isCrit` now means PRECISE: weak-point
    // overlap or forceCrit. ×2.5 (+critBonus from SILVER FLETCHING re-anchor).
    if (isCrit) dmg *= (2.5 + G.critBonus);
    if (G.communion === 'KEMET' && hasStatus(e)) dmg *= 1.1;   // Rite of Two Suns
    var _hpPre = e.hp;                       // snapshot BEFORE the subtraction (fix #2)
    e.hp -= dmg;
    clampBossHp(e);                         // spellcard floor: discard overkill on non-final phases / during breath
    // §8 LAYER 1 — DAMAGE-TITHE. Accrue the POST-CLAMP EFFECTIVE damage only (fix #2):
    // hp actually removed = _hpPre - e.hp. This discards overkill clampBossHp threw away
    // on a non-final phase AND is exactly 0 during the immune transition breath (hp is
    // held at breathFloor), so one massive crit can cross at most the clamped units — the
    // ~40-unit/fight budget can no longer be busted by a single overkill hit.
    if (e.boss && e.arrived) {
      var _eff = _hpPre - e.hp;
      if (_eff > 0) {
        e.dmgTithe += _eff;
        var _tu = e.maxhp * 0.025;
        while (e.dmgTithe >= _tu) { e.dmgTithe -= _tu; e.dmgTitheUnits++; bossTitheUnit(e); }
      }
    }
    e.hitFlash = isCrit ? 0.14 : 0.08;
    if (isCrit) { addPopup(e.x, e.y - 30, commas(Math.round(dmg)) + '!', UI_GOLD, 30); SFX.crit(); spark(e.x, e.y, [1, 0.9, 0.5], 5, 320, 22); if (Engine.gold.freeTop > 1) spawnGold(e.x, e.y, 1, 0.35); }
    else if (Math.random() < 0.2) SFX.hit();
    if (e.hp <= 0) { killEnemy(e, true); return; }
    // DEATH SENTENCE duo: precise strikes execute non-boss foes below 40%
    if (isCrit && G.duos.deathSentence && !e.boss && e.hp < 0.40 * e.maxhp) { executeEnemy(e); return; }
  }

  function killEnemy(e, reward) {
    if (e.dying) return;
    e.dying = true;
    // Ra LENS: a dead held target releases the beam lock — hold resets so the next
    // foe ramps from scratch (no post-boss-kill CORONA on a fresh mook).
    if (G.ra.target === e) { G.ra.target = null; G.ra.targetSeq = 0; G.ra.hold = 0; G.ra.graceT = 0; }
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
      if (G.attackGod === 'ares') addFrenzy();                              // WAR-HEAT gravy
      if (G.ult.god === 'aristeia') G.ult.t = Math.min(8, G.ult.t + 0.3);   // ARISTEIA ultimate: each kill extends the contract (cap 8s)
      // ARTEMIS THE HUNT — a Hunted kill splinters + chains the brand to the next prey.
      if (G.attackGod === 'artemis' && G.hunt.foe === e && G.hunt.foeSeq === e.seq) huntChainOnKill(e);
      if (G.charms.charmOdin) G.ravenKills++;                               // HUGINN & MUNINN MEMORY
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
    // fix #7: a dying retinue add drops the boss-side cached live-count (the inc lives in
    // spawnRetinueAdd). Guard on the seq so only the summoning boss's counter moves; a
    // post-boss-death fly-off (G.boss null / re-slotted) simply doesn't decrement a
    // stale/absent boss, which is fine — that boss is gone.
    if (e.retinueSeq && G.boss && G.boss.seq === e.retinueSeq && G.boss.retinueLive > 0) G.boss.retinueLive--;
    // fix #1: onDeath must respect the reward flag. A forced despawn (expireRetinue on a
    // phase transition, or the boss-death fly-off self-kill) passes reward=false, so a
    // retinue add's onDeath drops NO loot; only a genuine player kill (reward=true) pays.
    // Structural cleanup inside an onDeath (if any) still runs on either path.
    if (e.onDeath) e.onDeath(e, reward);
    Engine.enemies.release(e);
  }

  // ---------------------------------------------------------------------
  // bullets / collisions
  // ---------------------------------------------------------------------
  function updateBullets(dt) {
    // DIVINE INTERVENTION held beat: enemy bullets are FROZEN in place and cannot move,
    // graze, or damage — skip the whole update until the beat flushes them to gold.
    if (G.bfreeze > 0) return;
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
      // DORMANT until Pass 2 PILFER — nothing sets b.friendly=true this pass (Confuse
      // is deleted), so this branch never runs; the per-frame cost is just the boolean
      // check below. KEEP it: PILFER's bullet-snatch is its consumer next pass.
      if (b.friendly) {
        // PILFER — gentle-home (2.2 rad/s) to the nearest OTHER live enemy.
        var htgt = null, hbd = 1e18;
        Engine.enemies.forEach(function (e) { if (e.dying || e.charmed || (e._i === b.srcId && e.seq === b.srcSeq)) return; var dx = e.x - b.x, dy = e.y - b.y, d = dx * dx + dy * dy; if (d < hbd) { hbd = d; htgt = e; } });
        if (htgt) { var des = Math.atan2(htgt.y - b.y, htgt.x - b.x), dd = des - b.dir; while (dd > Math.PI) dd -= TAU; while (dd < -Math.PI) dd += TAU; var mx = 2.2 * dt; if (dd > mx) dd = mx; if (dd < -mx) dd = -mx; b.dir += dd; }
        var hitF = false;
        Engine.enemies.forEach(function (e) {
          if (hitF || e.dying || e.charmed || (e._i === b.srcId && e.seq === b.srcSeq)) return;
          var tx = e.nailActive ? e.nailX : e.x, ty = e.nailActive ? e.nailY : e.y, tr = e.nailActive ? e.nailR : e.radius;
          if (Engine.hit(b.x, b.y, b.radius, tx, ty, tr)) {
            var fd = flipDmg;
            if (e.boss) { var bud = e.trickBudget || 0; fd = Math.min(fd, bud); e.trickBudget = Math.max(0, bud - fd); }   // boss cap: 0.5% maxhp/cast
            if (fd > 0) damageEnemy(e, fd, false);
            if (G.mods.lokiVaunt) addGauge(0.6);   // pilfered daggers charge APOTHEOSIS
            spark(b.x, b.y, [0.5, 1, 0.35], 3, 180, 16); hitF = true;
          }
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
    // §3 PRECISION — RNG crit deleted. A shot is PRECISE only via weak-point
    // overlap or forceCrit (Artemis LOOSED ARROW). No dice anywhere.
    var isCrit = false;
    if (s.forceCrit) isCrit = true;
    if (s.faction === 0 && e.nodeState === 2 && Engine.hit(s.x, s.y, s.radius, e.nodeX, e.nodeY, nodeRadius(e))) {
      isCrit = true; e.nodeHit = 0.2; addGauge(1.5);   // hitting the exposed node feeds the gauge
    }
    if (s.crescent && G.duos.godsOfWar && e.terrorT > 0) isCrit = true;    // GODS OF WAR: crescents precise vs Terrified
    // Aphrodite: +15% to the charm-touched and the Weakened
    if (s.faction === 0 && G.attackGod === 'aphrodite' && (e.weak || e.charmMeter > 0)) dmg *= 1.15;
    if (s.kind === 5) { // HEARTSEEKER — charm a minion, or Weaken + gild a boss's bullets
      if (e.boss) {
        e.weakStacks = Math.min(3, (e.weakStacks || 0) + 1); e.weak = true; e.weakT = 6;
        damageEnemy(e, dmg, false);
        // sweep enemy bullets within 220px of the boss to gold
        Engine.bullets.forEach(function (b) { if (b.friendly) return; var dx = b.x - e.x, dy = b.y - e.y; if (dx * dx + dy * dy < 220 * 220) { if (Engine.gold.freeTop > 0) spawnGold(b.x, b.y, 1, 0.4); spark(b.x, b.y, [1, 0.5, 0.85], 2, 160, 16); Engine.bullets.release(b); } });
        flash(e.x, e.y, [1, 0.4, 0.7], 90, 0.25);
      } else { charmEnemy(e, G.specialR); flash(e.x, e.y, [1, 0.5, 0.85], 60, 0.2); }   // §7 fix #2: HEARTSEEKER charm duration rides specialR
      return;
    }
    // ARTEMIS THE LOOSED ARROW — the first foe struck becomes the Hunted at full ramp.
    if (s.kind === 4 && s.loosed && !s.brandedFirst && G.attackGod === 'artemis') { s.brandedFirst = true; brandHunted(e, 8 + (G.mods.artemisCrit ? 2 : 0)); }
    if (s.kind === 7) { // JADE imperial edict — Stun the non-boss it condemns
      damageEnemy(e, dmg, isCrit);
      if (!e.boss && !e.dying) { e.stunT = Math.max(e.stunT, 0.9); flash(e.x, e.y, [0.8, 0.6, 1], 70, 0.2); }
      if (GL.edictStyle === 'C' && !e.dying) {   // seal-stamp chop: stamp state now, DRAW the ring at render (drawKitOverlays)
        flash(e.x, e.y, [1, 0.85, 0.4], 90, 0.22); e.sealT = 0.3;
      }
      return;
    }
    // ANUBIS THE WEIGHING — amber ankh-bolt loads the scales; the Verdict fires at the tip.
    if (s.kind === 17 && s.faction === 0) { anubisWeighHit(e, dmg, isCrit); return; }
    if (s.markHit) { e.marked = true; e.markT = 6; }
    // ARTEMIS THE HUNT — ramp on the branded Hunted / brand-on-first-hit / sticky.
    // Returns the ramped damage; kill-chain + splinter fire from killEnemy.
    if (s.kind === 9 && s.faction === 0) dmg = artemisHuntHit(e, dmg);
    // QUETZ THE COIL — a quetz weave hit tightens the coil on THIS foe (0..6, ×1.60 max).
    if (s.weave && s.faction === 0 && G.attackGod === 'quetz') dmg = quetzCoilHit(e, dmg);
    // ODIN NINE NIGHTS — permanent per-foe runes: ×(1+0.15·runes), carve every 4th hit.
    if (s.kind === 15 && s.faction === 0) dmg = odinBoltHit(e, dmg);
    var wasTerror = e.terrorT > 0;
    damageEnemy(e, dmg, isCrit);
    if (s.crescent) {
      s.damage *= 1.18;                                                   // crescent gains power per foe cleaved
      if (SFX.blade) SFX.blade(s.hitN);                                   // Pass4: per-pierce crescent shing (pitch rises with pierce count)
      if (G.duos.saintOfWar && !e.dying) { e.weak = true; e.weakT = 4; }  // SAINT OF WAR: cleaves Weaken
      if (G.duos.godsOfWar && e.dying && wasTerror) addFrenzy();          // GODS OF WAR: terrified crescent-kills feed frenzy
    }
    if (s.cloneShot && G.duos.havocInHeaven && !e.dying) chainLightning(e, dmg * 0.5, false); // HAVOC IN HEAVEN (no re-chain)
    if (s.faction === 0 && !s.mandateBolt) applyAttackGod(e, s, dmg);   // §6: MANDATE gold bolts are a plain flipDmg strike, not a proc re-trigger
    else if (s.kind === 3) chainLightning(e, dmg * 0.5, true); // storm lance chains
  }
  // §3 PRECISION — weak-point node radius (SILVER FLETCHING re-anchor: +15% size;
  // huntersEye keeps a node open on Marked foes). Bosses read slightly bigger.
  function nodeRadius(e) { return (e.boss || e.elite ? 34 : 26) * (G.critBonus > 0 ? 1.15 : 1); }
  // Open a weak-point node on e at hull offset (dx,dy): ~0.4s pre-flash, ~2s open.
  function openNode(e, dx, dy) {
    if (e.nodeState !== 0) return;
    e.nodeState = 1; e.nodeT = 0.4; e.nodeDX = dx; e.nodeDY = dy;
  }

  // ================= ARTEMIS — THE HUNT =================
  function huntFoe() { var h = G.hunt; return (h.foe && h.foe.active && !h.foe.dying && h.foe.seq === h.foeSeq) ? h.foe : null; }
  function clearHunt() { var h = G.hunt; h.foe = null; h.foeSeq = 0; h.stacks = 0; h.stackT = 0; h.stray = null; h.straySeq = 0; h.swap = 0; }
  function brandHunted(e, stacks) {
    var h = G.hunt;
    h.foe = e; h.foeSeq = e.seq; h.stacks = Math.max(0, Math.min(8 + (G.mods.artemisCrit ? 2 : 0), stacks || 0)); h.stackT = 3.0;
    h.stray = null; h.straySeq = 0; h.swap = 0;
    flash(e.x, e.y, [0.8, 0.9, 1.0], 80, 0.22); SFX.hit();
  }
  // Called on a kind-9 arrow hit; returns ramped damage. Manages brand/ramp/sticky.
  function artemisHuntHit(e, dmg) {
    var h = G.hunt, hunted = huntFoe();
    if (!hunted) { brandHunted(e, 0); return dmg; }              // first foe hit → the Hunted at 0
    if (e === hunted) {
      var per = G.mods.artemisMulti ? 0.18 : 0.12;              // DEEPER HUNT re-anchor
      var mult = 1 + per * h.stacks;                             // ramp uses current depth
      var cap = 8 + (G.mods.artemisCrit ? 2 : 0);
      h.stacks = Math.min(cap, h.stacks + 1); h.stackT = 3.0; h.stray = null; h.swap = 0;
      if (G.mods.artemisRefund && h.stacks >= 6) addCharge(0.1); // re-anchor: 6+ stacks refund charge
      return dmg * mult;
    }
    // STICKY — a stray hit on a non-Hunted foe never re-brands; 3 consecutive on the
    // SAME other foe abandon the hunt and re-brand it at 0 (a deliberate switch).
    if (e === h.stray && e.seq === h.straySeq) h.swap++;
    else { h.stray = e; h.straySeq = e.seq; h.swap = 1; }
    if (h.swap >= 3) { SFX.graze(); brandHunted(e, 0); }         // slack-string abandon
    return dmg;
  }
  function nearestOtherEnemy(e) {
    var best = null, bd = 1e18;
    Engine.enemies.forEach(function (o) { if (o === e || o.dying || o.charmed) return; var dx = o.x - e.x, dy = o.y - e.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = o; } });
    return best;
  }
  // On a Hunted death: SPLINTER (stacks silver shards to nearby foes) + CHAIN
  // (auto-brand the nearest other foe, carrying stacks−1 — or ALL with DEEPER HUNT reach).
  function huntChainOnKill(e) {
    var st = G.hunt.stacks;
    var shardDmg = 0.4 * SHOT_DMG * G.stats.atkDmg * G.attackR;
    for (var i = 0; i < st; i++) {
      var t = nearestOtherEnemy(e); if (!t) break;
      var s = allocShot(); if (!s) break;
      var a = Math.atan2(t.y - e.y, t.x - e.x) + (Math.random() - 0.5) * 0.5;
      s.x = e.x; s.y = e.y; s.vx = Math.cos(a) * 1300; s.vy = Math.sin(a) * 1300;
      s.radius = 10; s.scale = 26; s.damage = shardDmg; s.age = 0; s.life = 0.6;
      s.r = 0.85; s.g = 0.92; s.b = 1.0; s.pierce = 0; s.kind = 10; s.faction = 0;
      s.homing = true; s.turn = 6.0; s.huntHome = false;
      spark(e.x, e.y, [0.85, 0.92, 1], 2, 260, 18);
    }
    var carry = G.mods.artemisSpread ? st : Math.max(0, st - 1);   // artemisSpread: carry ALL stacks
    var nt = nearestOtherEnemy(e);
    if (nt) brandHunted(nt, carry); else clearHunt();
  }
  function updateHunt(dt) {
    if (G.attackGod !== 'artemis') { if (G.hunt.foe) clearHunt(); return; }
    var h = G.hunt;
    if (!huntFoe()) { if (h.foe) clearHunt(); return; }
    if (h.stackT > 0) { h.stackT -= dt; if (h.stackT <= 0) h.stacks = 0; }
  }

  // ================= QUETZ — THE COIL =================
  function quetzCoilHit(e, dmg) {
    var was = e.coilQ;
    e.coilQ = Math.min(6, e.coilQ + 1); e.coilT = 0.9;
    if (e.coilQ > was && SFX.coilWhistle) SFX.coilWhistle(e.coilQ);   // Pass4 COIL cue: rising whistle only on a real tighten (never per-frame at the cap)
    return dmg * (1 + 0.10 * e.coilQ);   // ×1.60 at 6 bites
  }

  // ================= ODIN — NINE NIGHTS =================
  function odinBoltHit(e, dmg) {
    var mult = 1 + 0.15 * e.runes;                          // +135% at 9 (current knowledge)
    e.runeHits++;
    // ALLFATHER'S EYE ultimate (§2.5): every Odin hit carves a rune on ANY foe for the window.
    var every = (G.ult.god === 'allfather') ? 1 : (G.mods.odinRaven ? 3 : 4);   // odinFury re-anchor: carve every 3rd
    if (e.runeHits >= every && e.runes < 9) {
      e.runes++; e.runeHits = 0;
      spark(e.x, e.y - e.scale * 0.4, [1, 0.85, 0.4], 3, 200, 18); if (SFX.carveChip) SFX.carveChip(); else SFX.hit();   // stone-chisel chip (Pass4 rune-carve cue)
      if (e.runes === 9) { flash(e.x, e.y, [1, 0.85, 0.4], 140, 0.3); ringShock(e.x, e.y, [1, 0.85, 0.4], 40, 1800, 0.4); if (SFX.doomToll) SFX.doomToll(); else SFX.boom(); }   // the ninth: doom-toll
    }
    var out = dmg * mult;
    // THE NINTH RUNE — doom-bolts Mark (feeds Gungnir / THE ALLSEEING) + optional splash.
    if (e.runes >= 9) {
      markEnemy(e);
      if (G.mods.odinRavenMark) { var o = nearestOtherEnemy(e); if (o) { var dx = o.x - e.x, dy = o.y - e.y; if (dx * dx + dy * dy < 120 * 120) damageEnemy(o, out * 0.5, false); } }   // odinSunder
      if (G.duos.wildHunt && e.terrorT > 0) out *= 2;       // WILD HUNT: doom-bolts ×2 to Terrified
    }
    if (G.duos.theAllseeing && e.marked) out *= 1.4;        // THE ALLSEEING: +40% to Marked
    return out;
  }

  // ================= LOKI — PILFER =================
  // At the 3rd MISCHIEF mark, snatch the `count` live enemy bullets nearest the foe
  // within 240px — biased to bullets already >80px from any emitter (never a whiff,
  // never a panic-clear). Each flips friendly, reverses 180°, gently homes to its own kind.
  function lokiPilfer(foe, count) {
    foe.mischief = 0; foe.pilferCd = 1.2;
    // gather candidates within 240px, scored by distance minus an emitter-proximity bias
    var cand = [];
    Engine.bullets.forEach(function (b) {
      if (b.friendly) return;
      var dx = b.x - foe.x, dy = b.y - foe.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 240) return;
      // the score only needs whether ANY live emitter is within 80px — early-exit the
      // scan the instant one is found (avoids a full O(enemies) sweep per candidate bullet).
      var hugging = false, eit = Engine.enemies.items;
      for (var ei = 0; ei < eit.length; ei++) { var e = eit[ei]; if (!e.active || e.dying) continue; var ex = b.x - e.x, ey = b.y - e.y; if (ex * ex + ey * ey < 80 * 80) { hugging = true; break; } }
      var score = d + (hugging ? 300 : 0);   // penalise bullets still hugging an emitter
      cand.push({ b: b, s: score });
    });
    cand.sort(function (a, b) { return a.s - b.s; });
    var n = Math.min(count, cand.length);
    // boss self-harm budget: a single cast can bleed a boss for at most 0.5% maxhp.
    var boss = G.boss;
    if (boss && !boss.dying) boss.trickBudget = Math.min(boss.maxhp * 0.005, (boss.trickBudget || 0) + boss.maxhp * 0.005);   // clamp: unspent budget never exceeds ONE cast's cap (delayed daggers can't dump multiple casts)
    for (var i = 0; i < n; i++) {
      var b = cand[i].b;
      b.friendly = true; b.srcId = foe._i; b.srcSeq = foe.seq;   // stamp seq: a reused pool slot is NOT the source foe (mismatch => no exclusion)
      b.r = 0.55; b.g = 1.0; b.b = 0.35;
      b.dir += Math.PI;                              // reverse 180°
      b.flash = 0.15;
      spark(b.x, b.y, [0.55, 1, 0.35], 2, 160, 14);
      flash(b.x, b.y, [0.9, 1, 0.85], 24, 0.1);     // white pop on the flip
    }
    if (n > 0) { ringShock(foe.x, foe.y, [0.4, 1, 0.4], 40, 2400, 0.35); if (SFX.pilferLift) SFX.pilferLift(); else SFX.graze(); }   // green RING implode + LIFT voice (Pass4 PILFER cue)
  }

  // §9a HONEST PIERCE. maxHits = pierce+1 is the shot's LIFETIME cap on distinct
  // enemies (s.hitN persists across frames now). Per-enemy dedup is a stamp: the
  // shot's unique s.fireId is written to e.lastHitFireId on a counted hit, so the
  // shot bites each enemy exactly once for its whole life instead of re-hitting it
  // every overlap frame (the old ~55-DPS exploit). This is eviction-free — unlike
  // the old 8-slot seq ring, a pierce-999 shot through a dense swarm can never lose
  // a foe's record and re-hit it. Quetz weave / Guan Yu crescents still pierce &
  // cleave — just once per foe. Applies to the TALOS nail branch too.
  function collideShots() {
    Engine.shots.forEach(function (s) {
      var maxHits = s.pierce + 1;
      if (s.hitN >= maxHits) { Engine.shots.release(s); return; }
      Engine.enemies.forEach(function (e) {
        if (s.hitN >= maxHits || e.dying || e.charmed) return;
        if (e.lastHitFireId === s.fireId) return;          // this shot already bit this foe
        // TALOS THE NAIL: the body is immune — only the small nail hitbox (his
        // ankle weak point) drains the segment. A body hit still costs one pierce
        // slot (no free pass-through) but deals 0 damage with dim feedback. This
        // is the ONLY spatial special-case; every non-shot damage source (riders,
        // hazards, chain, burn) routes to the nail pool through damageEnemy = e.hp.
        if (e.nailActive) {
          if (Engine.hit(s.x, s.y, s.radius, e.nailX, e.nailY, e.nailR)) {
            hitEnemy(s, e);
            flash(s.x, s.y, [0.6, 1, 0.55], 26, 0.1);
            stampHit(s, e);
          } else if (Engine.hit(s.x, s.y, s.radius, e.x, e.y, e.radius)) {
            spark(s.x, s.y, [1, 0.82, 0.4], 1, 120, 10);   // dim clank: it did nothing
            stampHit(s, e);
          }
          return;
        }
        if (Engine.hit(s.x, s.y, s.radius, e.x, e.y, e.radius)) {
          hitEnemy(s, e);
          flash(s.x, s.y, s.faction === 2 ? [1, 0.5, 0.85] : [0.7, 1, 1], 26, 0.1);
          stampHit(s, e);
        }
      });
      if (s.hitN >= maxHits) Engine.shots.release(s);
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
      var s = allocShot(); if (!s) return;   // allocShot resets ALL per-shot flags (huntHome/loosed/weave/turn/phase/…) so a recycled slot can't leak state into the verify surface
      s.x = x; s.y = y; s.vx = 0; s.vy = -1200; s.radius = 12; s.damage = dmg || 1000; s.faction = 0;
      s.pierce = 0; s.kind = 0; s.big = false; s.age = 0; s.life = 2.5; s.grazed = false;
    },
    // §9a verify: fire a piercing shot (pierce n, weak dmg) at (x,y) going up.
    testPierceShot: function (x, y, dmg, pierce) {
      var s = allocShot(); if (!s) return;   // route through allocShot (same full reset as testShot)
      s.x = x; s.y = y; s.vx = 0; s.vy = -1200; s.radius = 14; s.damage = dmg || 5; s.faction = 0;
      s.pierce = pierce == null ? 4 : pierce; s.kind = 0; s.big = false; s.age = 0; s.life = 2.5; s.grazed = false;
    },
    shotCount: function () { return Engine.shots.count(); },
    setAutoFire: function (v) { Run.meta.autoFire = !!v; },
    autoFire: function () { return !!Run.meta.autoFire; },
    setPaused: function (v) { G.paused = !!v; },
    // run one REAL dispatch frame (respects mode/pause gating, unlike step) so
    // the harness can prove auto-fire stays silent on title/pause.
    frame: function (dt) { update(dt || Engine.DT); Engine.flushEdges(); },
    // hurry the boss to its next phase (sets hp to the segment floor = a damage-beat).
    // HP-depletion clear: drop hp to the segment floor and leave phaseT untouched (so
    // timedOut stays false → a REAL clear, seized=true → PHASE SEIZED + kit payout).
    advancePhase: function () { var b = G.boss; if (b && b.arrived && b.breathT <= 0) { b.hp = b.segFloorHp; } },
    // timeout transition: run the phase timer out WITHOUT dropping hp (fix #4 verify) —
    // timedOut=true, seized=false → transition happens but NO kit payout / no HUBRIS.
    timeoutPhase: function () { var b = G.boss; if (b && b.arrived && b.breathT <= 0) { b.phaseT = 1e9; } },
    // ---- boss-FIX verify surface (freeze / theft / nail / jackpot / HUD) -----
    // Drive fixed combat steps DIRECTLY (bypasses the RAF wrapper's pause/hitstop
    // gating) then flush input edges like a real frame. Deterministic for headless.
    step: function (n) { n = n || 1; for (var i = 0; i < n; i++) { Engine.time += Engine.DT; updateCombat(Engine.DT); } Engine.flushEdges(); },
    spawnMidas: function () { Game.beginBoss(Game.bosses.sovereign, 1); return G.boss ? G.boss._i : -1; },
    spawnTalos: function () { Game.beginBoss(Game.bosses.warden, 1); return G.boss ? G.boss._i : -1; },
    arriveBoss: function (y) { var b = G.boss; if (b) { b.arrived = true; b.breathT = 0; if (y != null) b.y = y; } },
    armNail: function () { var b = G.boss; if (b) { b.nailActive = true; b.nailR = 30; b.nailX = b.x; b.nailY = b.y + b.scale * 0.44; } },
    // §8 verify surface (zero cost unless called): damage-tithe accumulator + retinue.
    dmgTithe: function () { return G.boss ? G.boss.dmgTithe : 0; },
    // §8 verify: deal raw damage to the live boss (drives the tithe accumulator) and
    // return the units crossed; and charm a placed dummy through the aphrodite path so
    // the star-fix #2 charm-duration (rides specialR) is measurable.
    damageBoss: function (dmg) { var b = G.boss; if (b && !b.dying) damageEnemy(b, dmg || 0, false); return b ? b.dmgTitheUnits : 0; },
    charmDummyDur: function (i, sr) { var e = Engine.enemies.items[i]; if (!e || !e.active) return 0; var was = G.specialR; G.specialR = sr; charmEnemy(e, sr); G.specialR = was; return e.charmT; },
    titheUnits: function () { return G.boss ? G.boss.dmgTitheUnits : 0; },
    retinueCount: function () { return G.boss ? retinueCount(G.boss) : 0; },
    retinueLive: function () { return G.boss ? G.boss.retinueLive : -1; },   // fix #7: cached counter (must track the scan)
    retIdxList: function () { var out = []; if (!G.boss) return out; Engine.enemies.forEach(function (e) { if (!e.dying && e.retinueSeq === G.boss.seq) out.push({ i: e._i, retIdx: e.retIdx, s0: e.s0, s3: e.s3, retVac: e.retVac, retLinkSeq: e.retLinkSeq }); }); return out; },   // fix #3/#5 verify
    // fix #1 verify: sever every live add's boss-link (retLinkSeq) + drop it past the
    // bottom edge so ONE step routes it through the authentic onUpdate fly-off branch
    // (killEnemy(r,false) → onDeath(r,false)) — the same call the boss-death fly-off makes.
    orphanRetinue: function () { if (!G.boss) return 0; var n = 0; Engine.enemies.forEach(function (e) { if (!e.dying && e.retinueSeq === G.boss.seq) { e.retLinkSeq = -1; e.y = 1e6; n++; } }); return n; },
    // fix #6 verify: read a pooled slot's retinue-link fields to prove the allocator zeroes them.
    enemyRetFields: function (i) { var e = Engine.enemies.items[i]; if (!e) return null; return { retLinkSeq: e.retLinkSeq, retIdx: e.retIdx, retinueLive: e.retinueLive, retinueSeq: e.retinueSeq }; },
    // arm + materialize a named retinue off the live boss (rivet/assessor/tribute).
    armRetinue: function (kind, n, col) { var b = G.boss; if (!b) return 0; armRetinue(b, kind, n || 2, kind === 'rivet' ? 4 : 5, col || [b.r, b.g, b.b]); return retinueCount(b); },
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
    dashActive: function () { return G.dash.active; },
    // §5/§9c owned-entity + kit-swap verify surface (zero cost unless called)
    cloneCount: function () { return G.clones.length; },
    ravenCount: function () { return G.ravens.length; },
    wraithCount: function () { return G.wraiths.length; },
    decoyActive: function () { return !!G.decoy.active; },
    spawnClone: function (x) { if (x != null) G.player.x = x; spawnClone(); return G.clones.length; },
    spawnWraiths: function () { phobosDeimos(); return G.wraiths.length; },
    // spawn an Apostate DECOY mimic (arch 'fakedecoy') — wears the friendly
    // costume for 0.6s then curdles. onUpdate advances its curdle clock (e.t).
    spawnFakeDecoy: function (x, y) {
      var d = newEnemy(1, x, y, 999999, GL.SPR.SHIP_PLAYER, 60, 26, [0.5, 1, 0.6], 2, 200, false);
      if (d) { d.arch = 'fakedecoy'; d.vy = 0; d.onUpdate = function (dd, ddt) { dd.t += ddt; dd.rot = Math.min(1, Math.max(0, (dd.t - 0.6) / 0.15)) * Math.PI; }; }
      return d ? d._i : -1;
    },
    enemyAt: function (i) { var e = Engine.enemies.items[i]; return (e && e.active) ? { x: e.x, y: e.y, seq: e.seq, hp: e.hp } : null; },
    setStatus: function (i, st) {
      var e = Engine.enemies.items[i]; if (!e || !e.active) return;
      if (st.marked) { e.marked = true; e.markT = st.marked; }
      if (st.weak) { e.weak = true; e.weakT = st.weak; }
      if (st.burn) { e.burnT = st.burn; e.burnDps = 22; }
      if (st.stun) e.stunT = st.stun;
      if (st.charm) { e.charmed = true; e.charmT = st.charm; e.charmMeter = 0; }
      if (st.terror) e.terrorT = st.terror;
      if (st.shaken) e.shakenT = st.shaken;
    },
    // ---- Pass-2 kit verify surface (zero cost unless called) ----
    setAttackGod: function (g, r) { if (G.attackGod && G.attackGod !== g) expireOwned('attack'); G.attackGod = g; if (r != null) G.attackR = r; updateCommunion(); },
    setSpecialGod: function (g, r) { if (G.specialGod && G.specialGod !== g) expireOwned('special'); G.specialGod = g; if (r != null) G.specialR = r; updateCommunion(); },
    setMod: function (id) { applyMod(id, 1); },
    setCharm: function (id) { applyCharm(id, 1); },
    setDuo: function (id) { G.duos[id] = true; },
    forceClearBeat: function (kind) { startClearBeat(kind || 'wave'); },   // verify: exercise the wave-boundary state drop
    fireNow: function (focus) { fireShots(!!focus); },
    specialNow: function () { doSpecial(true); },
    huntInfo: function () { var h = G.hunt; return { foeSeq: h.foe ? h.foeSeq : 0, foeIdx: (h.foe ? h.foe._i : -1), stacks: h.stacks, swap: h.swap }; },
    frenzyInfo: function () { return { f: G.frenzy.frenzyF, boost: G.frenzy.boost, pinT: G.frenzy.pinT, stacks: G.frenzy.stacks, prevTier: G.frenzy.prevTier }; },
    setFrenzy: function (f) { G.frenzy.frenzyF = f; G.frenzy.stacks = Math.round(f * 10); },
    addFrenzy: function () { addFrenzy(); },   // cross-kit gravy hook (GODS OF WAR / WILD HUNT feed)
    enemyKit: function (i) { var e = Engine.enemies.items[i]; if (!e || !e.active) return null; return { runes: e.runes, runeHits: e.runeHits, coilQ: e.coilQ, coilT: e.coilT, mischief: e.mischief, scaleW: e.scaleW, nodeState: e.nodeState, nodeDX: e.nodeDX, nodeDY: e.nodeDY, marked: e.marked, weak: e.weak, weakStacks: e.weakStacks || 0, trickBudget: e.trickBudget || 0, hp: e.hp, maxhp: e.maxhp, sealT: e.sealT || 0, duatDmg: e.duatDmg || 0 }; },
    // set per-enemy kit state directly (verify only): runes/coilQ/mischief/weakStacks.
    setKitState: function (i, o) { var e = Engine.enemies.items[i]; if (!e || !e.active) return; if (o.runes != null) e.runes = o.runes; if (o.runeHits != null) e.runeHits = o.runeHits; if (o.coilQ != null) { e.coilQ = o.coilQ; e.coilT = 0.9; } if (o.mischief != null) { e.mischief = o.mischief; e.mischiefT = 2.5; } if (o.weakStacks != null) e.weakStacks = o.weakStacks; },
    // run one PILFER cast off enemy i (adds one cast's trickBudget to the boss, clamped).
    pilferFoe: function (i) { var e = Engine.enemies.items[i]; if (e && e.active) lokiPilfer(e, 8); },
    // place enemy i precisely (verify only) — lets the harness build deterministic Ra columns.
    setEnemyPos: function (i, x, y) { var e = Engine.enemies.items[i]; if (e && e.active) { e.x = x; e.y = y; e.vx = 0; e.vy = 0; } },
    // read a shot slot's per-shot flags (verify only) — proves testShot leaks no stale state.
    shotAt: function (i) { var s = Engine.shots.items[i]; if (!s || !s.active) return null; return { kind: s.kind, homing: !!s.homing, weave: s.weave, turn: s.turn, phase: s.phase, huntHome: !!s.huntHome, loosed: !!s.loosed }; },
    openNode: function (i) { var e = Engine.enemies.items[i]; if (e && e.active) openNode(e, 0, -e.scale * 0.2); },
    forceNodeOpen: function (i) { var e = Engine.enemies.items[i]; if (e && e.active) { e.nodeState = 2; e.nodeT = 2.0; e.nodeDX = 0; e.nodeDY = 0; e.nodeX = e.x; e.nodeY = e.y; } },
    setCoil: function (i, q) { var e = Engine.enemies.items[i]; if (e && e.active) { e.coilQ = q; e.coilT = 0.9; } },
    // one raw coil hit at the current coil level → returns the applied multiplier.
    oneCoilHit: function (i) { var e = Engine.enemies.items[i]; if (!e || !e.active) return 0; return quetzCoilHit(e, 1000) / 1000; },
    pinBoss: function (x, y) { var b = G.boss; if (b) { b.x = x; b.y = y; b.pathSegs = null; b.onUpdate = null; } },
    bifrostInfo: function () { var b = G.bifrost; return { t: b.t, seamT: b.seamT, active: b.active, life: b.life, x: b.x }; },
    setBifrostBand: function (x) { var b = G.bifrost; b.active = true; b.life = 4.0; b.seamT = 0; b.x = x == null ? G.player.x : x; },
    // JADE IMPERIAL JUDGEMENT verify surface
    castJudgement: function () { imperialJudgement(); },
    judgeInfo: function () { var j = G.judge; return { active: j.active, timer: j.timer, boltT: j.boltT, side: j.side, clouds: G.jclouds.length }; },
    // ANUBIS verify surface
    castGate: function () { gateOfDuat(); },
    duatActive: function () { return !!G.duat.active; },
    weighHit: function (i, dmg, crit) { var e = Engine.enemies.items[i]; if (e && e.active) anubisWeighHit(e, dmg, !!crit); },
    scaleW: function (i) { var e = Engine.enemies.items[i]; return (e && e.active) ? e.scaleW : 0; },
    setScaleW: function (i, v) { var e = Engine.enemies.items[i]; if (e && e.active) e.scaleW = v; },
    // DIVINE INTERVENTION freeze-beat verify surface
    bfreezeT: function () { return G.bfreeze; },
    bulletPos: function (i) { var b = Engine.bullets.items[i]; return (b && b.active) ? { x: b.x, y: b.y } : null; },
    // JADE edict close-up: spawn a hovering edict at (x,y) for a style screenshot (faction 1 = inert)
    spawnEdict: function (x, y, sc) { var s = allocShot(); if (!s) return; s.x = x; s.y = y; s.vx = 0; s.vy = -1; s.radius = 18; s.scale = sc || 44; s.damage = 0; s.age = 0; s.life = 30; s.r = 0.79; s.g = 0.6; s.b = 1.0; s.pierce = 0; s.homing = false; s.turn = 0; s.kind = 7; s.faction = 1; s.big = false; },
    setEdictStyle: function (st) { GL.setEdictStyle(st); },
    // LIGHTNING treatment switch — sets the live flag AND persists in goldwake_meta.
    setLightningStyle: function (st) { GL.setLightningStyle(st); Run.meta.lightningStyle = GL.lightningStyle; Run.saveMeta(); },
    lightningStyle: function () { return GL.lightningStyle; },
    boltCount: function () { var n = 0; for (var i = 0; i < BOLT_MAX; i++) if (bolts[i].active) n++; return n; },
    ravenKills: function () { return G.ravenKills; },
    setRavenKills: function (n) { G.ravenKills = n; },
    friendlyBulletCount: function () { var n = 0; Engine.bullets.forEach(function (b) { if (b.friendly) n++; }); return n; },
    skyfallT: function () { return G.skyfall.t; },
    raInfo: function () { return { tier: G.ra.tier, hold: G.ra.hold, active: G.ra.active }; },
    spawnBulletAt: function (x, y, dir, spd) { var b = Patterns.bullet(x, y, dir == null ? Math.PI / 2 : dir, spd == null ? 120 : spd, { fam: Patterns.FAM.ORB, tier: 'M', color: Patterns.MAGENTA }); return b ? b._i : -1; },
    // spawn a plain trash enemy (verify only) — returns its pool index.
    spawnDummy: function (x, y, hp, elite) { var e = newEnemy(1, x, y, hp || 10, GL.SPR.SHIP_POP, 80, 30, [1, 0.5, 0.3], 5, 500, !!elite); if (e) { e.vx = 0; e.vy = 0; e.onUpdate = null; e.pathSegs = null; } return e ? e._i : -1; },
    // ---- §2.5 ULTIMATES verify surface (zero cost unless called) ----
    setUltimate: function (g) { Game.setUltimate(g); },
    ultimateGod: function () { return G.ultimateGod; },
    // press C with a full gauge — dispatches to the equipped ultimate (or the default).
    fireC: function () { G.vaunt.gauge = GAUGE_MAX; G.vaunt.ready = true; tryVaunt(); },
    ultInfo: function () { var u = G.ult; return { god: u.god, t: u.t, x: u.x, y: u.y, ang: u.ang, castT: u.castT, trail: (u.trail ? u.trail.length : 0) }; },
    endUlt: function () { endUltimate(); },
    mandateArmed: function () { return !!G.bfMandate; },
    gauge: function () { return G.vaunt.gauge; },
    setHp: function (i, hp) { var e = Engine.enemies.items[i]; if (e && e.active) { e.hp = hp; if (hp > e.maxhp) e.maxhp = hp; } },
    hazTypeCount: function (type) { var n = 0; for (var i = 0; i < hazards.length; i++) if (hazards[i].active && hazards[i].type === type) n++; return n; },
    hazPos: function (type) { for (var i = 0; i < hazards.length; i++) if (hazards[i].active && hazards[i].type === type) return { x: hazards[i].x, y: hazards[i].y, r: hazards[i].r, halfW: hazards[i].halfW, timer: hazards[i].timer }; return null; },
    // per-foe ultimate state (verify only): great-hunt tag, adoration dwell, mire slow.
    enemyUlt: function (i) { var e = Engine.enemies.items[i]; if (!e || !e.active) return null; return { huntTag: !!e.huntTag, adoreT: e.adoreT || 0, mireT: e.mireT || 0, stunT: e.stunT || 0, shakenT: e.shakenT || 0, weakStacks: e.weakStacks || 0, charmed: !!e.charmed, hp: e.hp, maxhp: e.maxhp, runes: e.runes || 0 }; },
    // ---- authored-art wiring verify surface (zero cost unless called) ----
    // whether a named authored sprite (art/PROMPTS.md §8-9) has loaded into its
    // atlas cell, and the running per-name draw counter incremented every time a
    // draw site actually took the authored-sprite path (vs the procedural fallback).
    authoredReady: function (name) { return GL.authoredSpr(name) >= 0; },
    spriteDrawCount: function (name) { return spriteUse[name] || 0; },
    spriteStats: function () { var o = {}; for (var k in spriteUse) o[k] = spriteUse[k]; return o; },
    resetSpriteStats: function () { spriteUse = {}; trackSprites = true; },   // #15: enables the verify-only per-name draw counter
    // set an enemy's archetype (and boss name) so the per-archetype sprite path can
    // be exercised; s0=0 keeps a mimic in its authored gold-loot disguise.
    setArch: function (i, arch, name) { var e = Engine.enemies.items[i]; if (e && e.active) { e.arch = arch; if (name) e.name = name; if (arch === 'mimic') e.s0 = 0; } },
    // drop an inert signature player shot of `kind` for a render (labrys 14, akontia
    // 11, xiphos 12, doru 13, edict 7, loosed arrow 4) — faction 1 so it just draws.
    spawnSigShot: function (kind, x, y) {
      var s = allocShot(); if (!s) return -1;
      s.x = x; s.y = y; s.vx = 0; s.vy = -1; s.radius = 16; s.scale = 42; s.damage = 0; s.age = 0.6; s.life = 30;
      s.r = 1; s.g = 0.6; s.b = 0.35; s.pierce = 0; s.homing = false; s.turn = 0; s.kind = kind; s.faction = 1; s.big = true;
      if (kind === 4) s.loosed = true;
      return s._i;
    },
    // park a Mjölnir at (x,y) so drawHammers renders the §9 hammer sprite.
    spawnHammer: function (x, y) { G.hammers.push({ x: x, y: y, state: 'out', vy: -600, t: 0, dmg: 1, kb: 0, big: true, spin: 0.7, hoverT: 0, hit: [], target: null, targetSeq: 0 }); return G.hammers.length; }
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
    // drop transient special timers so a pending Ra surge / horn echo / peach window
    // can't freeze through the draft and fire into next wave
    G.raSurgeT = 0; G.hornEchoT = 0; G.verdictPeachT = 0;
    // owned JADE/ANUBIS entities + freeze beats must recall/dissipate too, or they hang
    // frozen across the draft (updateCombat is skipped) and resume onto the next wave's spawns.
    if (G.jclouds.length) { for (var jc = 0; jc < G.jclouds.length; jc++) recallFx(G.jclouds[jc].x, G.jclouds[jc].y); G.jclouds.length = 0; }
    G.judge.active = false; G.judge.boltT = 0;
    boltsClear();   // drop live lightning so a bolt mid-flicker can't resume onto the next wave
    if (G.duat.active) { recallFx(G.duat.x, G.duat.y); G.duat.active = false; }
    G.bfreeze = 0; G.bfMandate = false;
    if (G.bifrost.active || G.bifrost.seamT > 0) { G.bifrost.active = false; G.bifrost.seamT = 0; G.bifrost.life = 0; }
    endUltimate();   // §2.5 — drop the live timed ultimate + its DELUGE/PILLAR hazards + per-foe tags at the wave boundary
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
    updateHunt(dt);
    updateBifrost(dt);
    updatePlayer(dt);
    updateDecoy(dt);
    refreshAim();               // decoy may redirect all aimed fire this frame
    updateShots(dt);
    updateRavens(dt);
    updateGungnir(dt);
    updateWraiths(dt);
    updateJudgement(dt);        // JADE IMPERIAL JUDGEMENT storm-clouds
    updateDuat(dt);             // ANUBIS GATE OF DUAT drag + missing-HP share
    updateUlt(dt);              // §2.5 ULTIMATES — the live timed ultimate (real time; input unscaled)
    updateHammers(dt);
    updateDebris(dt);
    updateClones(dt);
    // THE GREAT HUNT ultimate slows only the FIELD (enemies + their bullets) to ~0.12;
    // the player + the ult clock above run at full dt, so you fly through frozen time.
    var edt = (G.ult.god === 'greathunt') ? dt * 0.12 : dt;
    updateEnemies(edt);
    updateHazards(dt);
    updateBullets(edt);
    updateGold(dt);
    updateParticles(dt);
    updateBolts(dt);            // shared lightning bolt renderer (flicker + re-strikes)
    updateVaunt(dt);
    // DIVINE INTERVENTION two-beat staging: flush the held freeze beat → gild to gold.
    if (G.bfreeze > 0) { G.bfreeze -= dt; if (G.bfreeze <= 0) { G.bfreeze = 0; cancelBulletsToGold(G.bfMidas, G.bfMandate); G.bfMandate = false; ringShock(G.player.x, G.player.y, [1, 0.85, 0.35], 60, 3200, 0.6); } }
    // god-special timers
    if (G.raSurgeT > 0) G.raSurgeT -= dt;                                   // Ra apotheosis surge
    if (G.hornEchoT > 0) { G.hornEchoT -= dt; if (G.hornEchoT <= 0) gjallarhorn(0.5); }   // heimEcho
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
        // §9b auto-fire is toggled on the pause menu and persisted in goldwake_meta.
        if (Engine.pressed('KeyF')) { Run.meta.autoFire = !Run.meta.autoFire; Run.saveMeta(); addPopup(W / 2, 120, Run.meta.autoFire ? 'AUTO-FIRE ON' : 'AUTO-FIRE OFF', UI_CYAN, 30); }
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

  // §5/§9c KIT-SWAP HYGIENE. Swapping the attack OR special god recalls every
  // live owned entity that kit owns — clones, ravens, decoy, wraiths, Gungnir,
  // and its live hazards (staff pillar, serpent, sweep, tidal wall, zap field) —
  // immediately. Each recall pops a cyan implosion toward the player (the GLOW
  // folding back to the gem) and releases the entity. One centralized path; kills
  // the 7s orphan-clone lie and the ravens' abrupt length=0 clear.
  function recallFx(x, y) {
    spark(x, y, [0.7, 0.95, 1], 10, 300, 24);
    var dx = G.player.x - x, dy = G.player.y - y, d = Math.hypot(dx, dy) || 1;
    flash(x + dx / d * 44, y + dy / d * 44, [0.7, 0.95, 1], 90, 0.2);
    if (SFX.recall) SFX.recall();   // Pass4: owned-entity recall cue (shared)
  }
  function expireKitHazards(type) {
    for (var i = 0; i < hazards.length; i++) { if (hazards[i].active && hazards[i].type === type) { recallFx(hazards[i].x, hazards[i].y); hazards[i].active = false; } }
  }
  function expireOwned(slot) {
    var i, c;
    if (slot === 'attack') {
      for (i = 0; i < G.clones.length; i++) { c = G.clones[i]; recallFx(c.x, c.y); }
      G.clones.length = 0;
      // NOTE: ravens are NOT recalled here — they belong to the RAVEN QUILL charm
      // (G.charms.charmOdin), not the attack slot, so an attack-god swap must not touch them.
      // Thor's in-flight Mjölnir hammers are ENTITIES, not fire-and-forget shots —
      // an unrecalled hammer orphan-flies and keeps smashing after the god is gone.
      // Recall like every other owned entity (implosion pop + immediate release).
      for (i = 0; i < G.hammers.length; i++) { c = G.hammers[i]; recallFx(c.x, c.y); }
      G.hammers.length = 0;
      G.ra.active = false; G.ra.target = null; G.ra.targetSeq = 0; G.ra.ramp = 0; G.ra.hold = 0;   // stale beam can't paint post-swap
      expireKitHazards('zap');                                  // zeusField attack-mod hazard
      // §9 hygiene — attack-kit state clears on swap: Artemis brand, WAR-HEAT, BIFRÖST band.
      clearHunt();
      G.frenzy.frenzyF = 0; G.frenzy.boost = 0; G.frenzy.pinT = 0; G.frenzy.stacks = 0; G.frenzy.prevTier = 0;
      // per-enemy player-brand state is keyed to the OLD attack god (this runs BEFORE
      // G.attackGod changes): clear it across ALL live enemies so it can't linger/redraw
      // (or be re-inherited on an Odin->X->Odin round-trip) under an unrelated kit.
      if (G.attackGod === 'odin') Engine.enemies.forEach(function (e) { e.runes = 0; e.runeHits = 0; });
      else if (G.attackGod === 'quetz') Engine.enemies.forEach(function (e) { e.coilQ = 0; e.coilT = 0; });
      else if (G.attackGod === 'loki') Engine.enemies.forEach(function (e) { e.mischief = 0; e.mischiefT = 0; e.pilferCd = 0; });
      else if (G.attackGod === 'anubis') Engine.enemies.forEach(function (e) { e.scaleW = 0; });   // THE WEIGHING scales clear (+overlay gates on attackGod)
      G.bifrost.active = false; G.bifrost.seamT = 0; G.bifrost.life = 0; G.bifrost.t = 0;
    } else {
      if (G.decoy.active) { recallFx(G.decoy.x, G.decoy.y); G.decoy.active = false; }
      for (i = 0; i < G.wraiths.length; i++) { c = G.wraiths[i]; recallFx(c.x, c.y); }
      G.wraiths.length = 0;
      if (G.gungnir.active) { recallFx(G.gungnir.x, G.gungnir.y); G.gungnir.active = false; }
      // JADE IMPERIAL JUDGEMENT clouds (§5 owned entities) + ANUBIS GATE OF DUAT recall on special swap.
      for (i = 0; i < G.jclouds.length; i++) recallFx(G.jclouds[i].x, G.jclouds[i].y);
      G.jclouds.length = 0; G.judge.active = false; G.judge.boltT = 0;
      if (G.duat.active) { recallFx(G.duat.x, G.duat.y); G.duat.active = false; }
      expireKitHazards('staff'); expireKitHazards('serpent');
      expireKitHazards('sweep'); expireKitHazards('sweepwake'); expireKitHazards('wave');
    }
  }

  Game.applyBoon = function (b) {
    var mag = b.rarity === 'epic' ? 2.25 : b.rarity === 'rare' ? 1.5 : 1;
    switch (b.kind) {
      // a SWAP keeps the slot's current tier (attackR/specialR) — only the god changes.
      // Swapping a slot's god first recalls the OLD kit's live owned entities (§5).
      case 'transformA': if (G.attackGod && G.attackGod !== b.god) expireOwned('attack'); G.attackGod = b.god; if (!b.swap) G.attackR = mag; break;
      case 'transformS': if (G.specialGod && G.specialGod !== b.god) expireOwned('special'); G.specialGod = b.god; if (!b.swap) G.specialR = mag; break;
      case 'levelA': G.attackR = b.mag; break;   // pom: raise attack tier
      case 'levelS': G.specialR = b.mag; break;  // pom: raise special tier
      case 'ultimate': Game.setUltimate(b.god); break;   // §2.5: equip / swap the C-key burst ultimate
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
      if (SFX.communion) SFX.communion(G.communion);   // Pass4: per-pantheon communion sting on set-bonus
    }
  }
  function effMultCap() { return G.up.multCap + (G.communion === 'OLYMPUS' ? 1 : 0); }
  function hasStatus(e) { return e.marked || e.weak || e.charmed || e.burnT > 0 || e.stunT > 0 || e.terrorT > 0 || e.shakenT > 0; }
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
      case 'anubisHeavy': M.anubisHeavy = true; break;
      case 'anubisFeast': M.anubisFeast = true; break;
      case 'anubisRefund': M.anubisRefund = true; break;
      case 'anubisShard': M.anubisShard = true; break;
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
      case 'jadeMirror': M.jadeMirror = true; break;
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
      case 'charmArtemis': G.critBonus += 0.35 * mag; break;                            // §3 PRECISION: +precise dmg & +15% node size
      case 'charmAphrodite': G.charmShop += 0.15 * mag; break;                          // shop discount
      case 'charmAres': G.stats.atkDmg += 0.10 * mag; break;                            // +attack damage
      case 'charmHeimdall': G.charmMark += 0.12 * mag; break;                           // +dmg to Marked (stacks with heimVigil)
      case 'charmRa': G.stats.spRecharge += 0.20 * mag; break;                          // +special recharge
      case 'charmAnubis': G.noSpill = true; break;                                      // death spills no gold
      case 'charmLoki': G.hermes.graze += 0.35 * mag; break;                            // +graze gauge gain
      case 'charmOdin': break;   // HUGINN & MUNINN — the ravens gate on G.charms.charmOdin (set above)
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
  Game.ultimateGod = function () { return G.ultimateGod; };
  // §2.5 — equip / swap the ultimate slot. A swap with a live timed ultimate recalls
  // the running one first (endUltimate mirrors expireOwnedOnSwap for the ultimate slot).
  Game.setUltimate = function (g) { if (G.ultimateGod !== g) endUltimate(); G.ultimateGod = g; };

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
      drawBifrost();          // HEIMDALL rainbow bridge / dawn-seam telegraph (drawn hazard)
      drawDuat();             // ANUBIS GATE OF DUAT sand-vortex (drawn hazard)
      drawSkyfall();          // ZEUS SKYFALL transient column
      drawGold(); drawEnemies(); drawShots(); drawParticles(); drawBolts(); drawBulletHalos();
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
      drawDecoy(); drawClones(); drawRavens(); drawGungnir(); drawRaBeam(); drawWraiths(); drawJudgement(); drawHammers(); drawUlt(); drawDebris();
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
  // ---- authored-sprite wiring (art/PROMPTS.md §8-9) -------------------------
  // Per-name draw counter (verify surface via Game.test.spriteStats) and the
  // one helper every wired draw site funnels through: returns the authored atlas
  // cell (and counts the hit) when the PNG has loaded, else -1 so the caller
  // keeps its procedural / generic-slot fallback intact.
  var spriteUse = {}, trackSprites = false;
  function authCell(name) {
    var c = GL.authoredSpr(name);
    // #15: the per-name draw counter is a verify-only aid — gated off in production so the
    // hottest draw loop (enemyDrawCell, per enemy per frame) skips the map write entirely.
    // The verify surface turns it on via Game.test.resetSpriteStats().
    if (c >= 0 && trackSprites) spriteUse[name] = (spriteUse[name] || 0) + 1;
    return c;
  }
  // enemy archetype (e.arch) -> authored sprite name. Bosses are keyed by e.name
  // in ENEMY_SPR_NAME. Retinue keys (assessor/tribute/courtier/unweighed) are
  // wired ahead of their spawns and resolve silently once those arch keys exist.
  var ENEMY_SPR_ARCH = {
    gunship: '32-2-gunship', aegis: '32-3-aegis-shieldbearer', weaver2: '32-4-weaver',
    mimic: '32-5-gilded-mimic', splitter: '32-6-splitter', acolyte: '32-7-chorus-acolyte',
    carrier: '32-8-carrier-hulk', moth: '32-9-blink-moth', gardener: '32-10-bullet-gardener',
    apostate: '32-13-the-apostate',
    assessor: '32-15-assessor', tribute: '32-16-tribute-bearer',
    courtier: '32-17-gilded-courtier', unweighed: '32-18-unweighed-heart'
  };
  var ENEMY_SPR_NAME = { 'TALOS': '32-11-talos', 'AMMIT': '32-14-ammit', 'MIDAS': '32-12-midas', 'THE APOSTATE': '32-13-the-apostate' };
  // Resolve the atlas cell an enemy should draw with: boss-name match first, then
  // archetype, then the generic slot (e.spr). The GILDED MIMIC only wears its
  // authored gold-loot disguise while dormant (e.s0 === 0); once it reveals it
  // falls back to e.spr so the hostile popcorn read survives.
  function enemyDrawCell(e) {
    if (e.arch === 'mimic' && e.s0 !== 0) return e.spr;
    var name = ENEMY_SPR_NAME[e.name] || ENEMY_SPR_ARCH[e.arch];
    if (name) { var c = authCell(name); if (c >= 0) return c; }
    return e.spr;
  }

  function drawEnemies() {
    Engine.enemies.forEach(function (e) {
      var f = e.hitFlash > 0 ? 1 : 0;
      var er = e.r, eg = e.g, eb = e.b;
      if (e.charmed) { er = 0.7; eg = 0.95; eb = 1; }   // §4 CHARMED: body recolors player-cyan (faction law)
      var r = er + (1 - er) * f, g = eg + (1 - eg) * f, bl = eb + (1 - eb) * f;
      GL.draw(GL.SPR.GLOW, e.x, e.y, e.scale * 1.5, e.scale * 1.5, 0, er, eg, eb, e.boss ? 0.5 : 0.35);
      var cell = enemyDrawCell(e);
      if (cell !== e.spr) {
        // authored sprite carries its own faction-correct colour: draw near-white
        // so it shows true, punch toward white on hit-flash, flip cyan when charmed.
        var tr = 1, tg = 1, tb = 1;
        if (e.charmed) { tr = 0.7; tg = 0.95; tb = 1; }
        else if (f) { tr = tg = tb = 1 + 0.7 * f; }
        GL.draw(cell, e.x, e.y, e.scale, e.scale, e.rot, tr, tg, tb, 1);
        if (e.boss) GL.draw(cell, e.x, e.y, e.scale * 0.6, e.scale * 0.6, e.rot, 1, 1, 1, 0.4 + 0.2 * Math.sin(G.time * 4));
      } else {
      GL.draw(e.spr, e.x, e.y, e.scale, e.scale, e.rot, r, g, bl, 1);
      if (e.boss) GL.draw(e.spr, e.x, e.y, e.scale * 0.6, e.scale * 0.6, e.rot, 1, 1, 1, 0.4 + 0.2 * Math.sin(G.time * 4));
      }
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
      // §5 Apostate hostile-mimic markers (inverted faction law)
      if (e.arch === 'fakedecoy') drawMimicGem(e.x, e.y, e.scale, 1, Math.min(1, Math.max(0, (e.t - 0.6) / 0.15)));   // 0.6s costume then curdle
      else if (e.arch === 'apostateclone') drawMimicGem(e.x, e.y, e.scale, 1, 1);                                     // instant fake
      // §4 status shape-language (zones + shapes; hue never carries a status alone)
      drawStatus(e);
      drawKitOverlays(e);   // Pass-2 player-brand overlays (Hunt chevron, runes, coil, node)
    });
  }
  // Pass-2 KIT OVERLAYS — player-brand marks drawn near the enemy loop (the Hunted
  // chevron is a player brand, NOT a status; the rune-band is Odin's meter; the coil
  // rings are Quetz's; the diamond node is §3 PRECISION). Read by shape, not hue.
  function drawKitOverlays(e) {
    var s = e.scale, t = G.time;
    // ARTEMIS — the tightening chevron bracket on the Hunted, cinching with stacks.
    if (G.hunt.foe === e && e.seq === G.hunt.foeSeq) {
      var cinch = 1 - 0.5 * (G.hunt.stacks / 8);          // brackets close inward as stacks climb
      var off = s * (0.85 * cinch), arm = s * 0.3, th = s * 0.06;
      for (var ci = 0; ci < 2; ci++) {
        var sx = ci ? 1 : -1, cx = e.x + sx * off, cy = e.y - s * 0.1;
        GL.draw(GL.SPR.STREAK, cx, cy, th, arm, sx * 0.25, 0.75, 0.9, 1.0, 0.95);        // slanted chevron arm
        GL.draw(GL.SPR.STREAK, cx, cy, th, arm, -sx * 0.25 + Math.PI, 0.75, 0.9, 1.0, 0.95);
      }
    }
    // ODIN — carved runes: small gold glyphs filling a band arced over the hull.
    if (e.runes > 0 && G.attackGod === 'odin') {
      var ignite = e.runes >= 9, gy = e.y - s * 0.75, span = s * 1.0;
      for (var ri = 0; ri < e.runes; ri++) {
        var rf = e.runes > 1 ? (ri / (e.runes - 1) - 0.5) : 0;
        var rx = e.x + rf * span, ry = gy - Math.abs(rf) * s * 0.14;   // arced band
        GL.draw(GL.SPR.SHARD, rx, ry, s * 0.11, s * 0.16, rf, 1, 0.85, 0.4, 0.95);
      }
      if (ignite) { var ip = 0.6 + 0.4 * Math.sin(t * 12); GL.draw(GL.SPR.GLOW, e.x, gy, span * 1.3, s * 0.4, 0, 1, 0.85, 0.4, 0.4 * ip); }
    }
    // QUETZ — coil rings tightening jade → hot-white; a CONSTRICT pulse-ring at max.
    if (e.coilQ > 0 && G.attackGod === 'quetz') {
      var cf = e.coilQ / 6, cr = e.radius * (1.6 - 0.6 * cf);
      var cr2 = cf, r2 = 0.4 + 0.6 * cr2, g2 = 1.0, b2 = 0.5 + 0.5 * cr2;   // jade → hot-white
      GL.draw(GL.SPR.RING, e.x, e.y, cr * 2, cr * 2, t * 2, r2, g2, b2, 0.8);
      if (e.coilQ >= 6) { var pp = (t * 2) % 1; GL.draw(GL.SPR.RING, e.x, e.y, cr * 2 * (1 + pp), cr * 2 * (1 + pp), 0, 1, 1, 1, 0.6 * (1 - pp)); }
    }
    // ANUBIS THE WEIGHING — gold scales glyph over the hull, TIPPING with accrued weight.
    if (e.scaleW > 0 && G.attackGod === 'anubis' && !e.dying) {
      var frac = Math.min(1, e.scaleW / (e.maxhp * ANUBIS_K));
      var tilt = frac * 0.5, gy = e.y - s * 0.7;                 // beam tips as the scales load
      var bx = Math.cos(tilt) * s * 0.34, by = Math.sin(tilt) * s * 0.34;
      GL.draw(GL.SPR.STREAK, e.x, gy, s * 0.06, s * 0.14, 0, 1, 0.82, 0.35, 0.9);        // fulcrum post
      GL.draw(GL.SPR.STREAK, e.x, gy, s * 0.72, s * 0.05, Math.PI / 2 + tilt, 1, 0.82, 0.35, 0.95);   // tipping beam
      GL.draw(GL.SPR.GOLD, e.x - bx, gy - by, s * 0.16, s * 0.16, 0, 1, 0.85, 0.4, 0.9);  // pan (rises)
      GL.draw(GL.SPR.GOLD, e.x + bx, gy + by, s * 0.16, s * 0.16, 0, 1, 0.85, 0.4, 0.9);  // pan (sinks with weight)
    }
    // §3 PRECISION — the weak-point node: a pulsing diamond-shard (telegraph flash → open).
    if (e.nodeState > 0) {
      var open = e.nodeState === 2, pu = 0.55 + 0.45 * Math.sin(t * (open ? 10 : 26));
      var nr = nodeRadius(e), col = e.nodeHit > 0 ? [1, 1, 0.7] : [1, 0.92, 0.5];
      GL.draw(GL.SPR.GLOW, e.nodeX, e.nodeY, nr * 2.0, nr * 2.0, 0, col[0], col[1], col[2], (open ? 0.5 : 0.3) * pu);
      GL.draw(GL.SPR.GOLD, e.nodeX, e.nodeY, nr * 1.0, nr * 1.2, t * 3, col[0], col[1], col[2], (open ? 0.95 : 0.6) * pu);
      if (open) GL.draw(GL.SPR.RING, e.nodeX, e.nodeY, nr * 2.4, nr * 2.4, -t * 2, col[0], col[1], col[2], 0.5);
    }
    // JADE edict style-C — the seal-mark ring, stamped on hit (e.sealT), drawn here at render.
    if (e.sealT > 0 && !e.dying) {
      GL.draw(GL.SPR.RING, e.x, e.y, s * 0.9, s * 0.9, 0, 1, 0.3, 0.3, 0.9 * Math.min(1, e.sealT / 0.3));
    }
    // LOKI — MISCHIEF triskele: 1/2/3 green kunai over the hull (stack = shape).
    if (e.mischief > 0 && !e.dying && G.attackGod === 'loki') {
      for (var mi = 0; mi < e.mischief; mi++) {
        var ma = t * 2 + mi * (TAU / 3), mx = e.x + Math.cos(ma) * s * 0.3, my = e.y - s * 0.55 + Math.sin(ma) * s * 0.12;
        GL.draw(GL.SPR.KUNAI, mx, my, s * 0.16, s * 0.28, ma, 0.55, 1.0, 0.35, 0.9);
      }
    }
  }
  // §4 STATUS SHAPE-LANGUAGE. Read WHERE (zone) before WHAT (shape). Four disjoint
  // zones around the enemy (offsets in e.scale): FRAME (4 corners), CROWN (over-
  // head), UNDERFOOT (below), BODY (on the hull). Same-zone collisions resolve by
  // fixed priority (marked>weak in FRAME, stun>charm in CROWN); the loser demotes
  // to a 6px CORE pip upper-right. Disjoint zones all render at once. Confuse is
  // gone (ruling 1). Each glyph carries a faint dark backing so it survives bloom.
  function darkBack(x, y, r) { GL.draw(GL.SPR.GLOW, x, y, r, r, 0, 0.02, 0.02, 0.03, 0.55); }
  function statusPip(e, col) {
    var px = e.x + e.scale * 0.6, py = e.y - e.scale * 0.6;
    darkBack(px, py, 16); GL.draw(GL.SPR.CORE, px, py, 6, 6, 0, col[0], col[1], col[2], 0.95);
  }
  function drawStatus(e) {
    var s = e.scale, t = G.time;
    var stun = e.stunT > 0, charm = e.charmed;
    var mark = e.marked, weak = e.weak;
    // ---- BODY: terror vignette / shaken cracks ----
    if (e.terrorT > 0 && !e.boss) {
      var tp = 0.5 + 0.5 * Math.sin(t * 188);                     // 30Hz contracting dark vignette
      GL.draw(GL.SPR.GLOW, e.x, e.y, s * (1.7 - 0.3 * tp), s * (1.7 - 0.3 * tp), 0, 0.25, 0.02, 0.05, 0.42 + 0.28 * tp);
    }
    if (e.shakenT > 0) {                                          // boss variant: 2 flickering STREAK cracks, no vignette
      var sf = 0.4 + 0.6 * Math.abs(Math.sin(t * 40));
      GL.draw(GL.SPR.STREAK, e.x - s * 0.18, e.y, s * 0.14, s * 1.0, 0.5, 0.9, 0.25, 0.3, sf);
      GL.draw(GL.SPR.STREAK, e.x + s * 0.2, e.y, s * 0.12, s * 0.9, -0.4, 0.9, 0.25, 0.3, sf * 0.85);
    }
    // ---- FRAME (4 corners): marked L-brackets; weak sagging lower brackets ----
    if (mark) {
      var mc = [0.95, 0.75, 0.2], off = s * 0.62, arm = s * 0.26, th = s * 0.05;
      for (var ci = 0; ci < 4; ci++) {
        var sx = (ci & 1) ? 1 : -1, sy = (ci & 2) ? 1 : -1;
        var cx = e.x + sx * off, cy = e.y + sy * off;
        GL.draw(GL.SPR.STREAK, cx, cy + sy * arm * 0.5, th, arm, 0, mc[0], mc[1], mc[2], 0.9);          // vertical arm
        GL.draw(GL.SPR.STREAK, cx + sx * arm * 0.5, cy, th, arm, Math.PI / 2, mc[0], mc[1], mc[2], 0.9); // horizontal arm
      }
    }
    if (weak) {
      if (mark) { statusPip(e, [0.6, 0.5, 0.65]); }               // demoted: marked wins the FRAME
      else {
        var wc = [0.6, 0.5, 0.65], woff = s * 0.62, warm = s * 0.24, wth = s * 0.05;
        for (var wi = 0; wi < 2; wi++) {                          // lower two corners, sagging (tilted)
          var wsx = wi ? 1 : -1, wx = e.x + wsx * woff, wy = e.y + woff;
          GL.draw(GL.SPR.STREAK, wx, wy - warm * 0.4, wth, warm, wsx * 0.35, wc[0], wc[1], wc[2], 0.85);
          GL.draw(GL.SPR.STREAK, wx + wsx * warm * 0.4, wy + wth, wth, warm, Math.PI / 2 + 0.2, wc[0], wc[1], wc[2], 0.85);
        }
        var ff = (t * 0.6) % 1;                                   // falling SHARD flakes
        GL.draw(GL.SPR.SHARD, e.x - s * 0.2, e.y + s * (0.55 + ff * 0.5), s * 0.14, s * 0.2, 0, wc[0], wc[1], wc[2], 0.7 * (1 - ff));
        GL.draw(GL.SPR.SHARD, e.x + s * 0.22, e.y + s * (0.6 + ((ff + 0.5) % 1) * 0.5), s * 0.12, s * 0.18, 0, wc[0], wc[1], wc[2], 0.7 * (1 - ((ff + 0.5) % 1)));
      }
    }
    // ---- UNDERFOOT: burn flame ticks ----
    if (e.burnT > 0) {
      var flick = 0.55 + 0.45 * Math.sin(t * 88);                 // ~14Hz
      for (var bi = 0; bi < 3; bi++) {
        var rise = ((t * 1.6 + bi * 0.33) % 1);
        var bx = e.x + (bi - 1) * s * 0.24, by = e.y + s * (0.7 + rise * 0.35);
        var cr = 1, cg = 0.85 - rise * 0.55, cb = 0.3 - rise * 0.25;   // yellow core -> red tip
        darkBack(bx, by, s * 0.24);
        GL.draw(GL.SPR.SHARD, bx, by, s * 0.16, s * 0.28, 0, cr, cg, Math.max(0.05, cb), (0.55 + 0.4 * flick) * (1 - rise * 0.5));
      }
    }
    // ---- CROWN: stun sparks (priority) or charm hearts ----
    var crownY = e.y - s * 0.82;
    if (stun) {
      for (var si = 0; si < 3; si++) {
        var a2 = t * 3 + si * (Math.PI * 2 / 3);
        var spx = e.x + Math.cos(a2) * s * 0.26, spy = crownY + Math.sin(a2) * s * 0.1;
        darkBack(spx, spy, s * 0.2);
        GL.draw(GL.SPR.SPARK, spx, spy, s * 0.26, s * 0.26, t * 4 + si, 0.7, 0.95, 1, 0.95);
      }
      if (charm) statusPip(e, [1, 0.3, 0.55]);                    // demoted: stun wins the CROWN
    } else if (charm) {
      for (var hi2 = 0; hi2 < 3; hi2++) {
        var hr = ((t * 0.8 + hi2 * 0.33) % 1);
        var hx = e.x + (hi2 - 1) * s * 0.22, hy = crownY - hr * s * 0.35;
        var ha = 0.85 * (1 - hr);
        darkBack(hx, hy, s * 0.2);
        GL.draw(GL.SPR.GLOW, hx, hy, s * 0.2, s * 0.2, 0, 1, 0.3, 0.55, ha * 0.6);
        GL.draw(GL.SPR.CORE, hx, hy, s * 0.09, s * 0.09, 0, 1, 0.4, 0.6, ha);
      }
    }
  }
  function drawShots() {
    Engine.shots.forEach(function (s) {
      var ang = Math.atan2(s.vy, s.vx) + Math.PI / 2;
      // ARTEMIS arrow-needle (kind 9): silver-white body + moon-blue rim, oriented.
      if (s.kind === 9) {
        GL.draw(GL.SPR.GLOW, s.x, s.y, s.scale * 0.55, s.scale * 1.9, ang, 0.55, 0.75, 1.0, 0.45);
        GL.draw(GL.SPR.NEEDLE, s.x, s.y, s.scale * 0.5, s.scale * 1.7, ang, 0.9, 0.95, 1.0, 0.95);
        GL.draw(GL.SPR.CORE, s.x, s.y, s.scale * 0.24, s.scale * 0.24, 0, 1, 1, 1, 0.9);
        return;
      }
      if (s.kind === 10) {   // Hunt SPLINTER shard
        GL.draw(GL.SPR.SHARD, s.x, s.y, s.scale * 0.9, s.scale * 1.5, ang, 0.85, 0.92, 1, 0.95);
        return;
      }
      // ARES GREEK ARMORY — akontia (11) / xiphos (12) / doru (13) / labrys (14).
      if (s.kind >= 11 && s.kind <= 14) { drawArmoryShot(s, ang); return; }
      // ODIN rune-bolt (15): steel-blue STREAK + NEEDLE spine, gold core once at doom.
      if (s.kind === 15) {
        GL.draw(GL.SPR.GLOW, s.x, s.y, s.scale * 0.7, s.scale * 2.0, ang, 0.6, 0.72, 0.95, 0.5);
        GL.draw(GL.SPR.STREAK, s.x, s.y, s.scale * 0.5, s.scale * 1.9, ang, 0.8, 0.85, 0.95, 0.95);
        GL.draw(GL.SPR.NEEDLE, s.x, s.y, s.scale * 0.28, s.scale * 1.4, ang, 0.95, 0.98, 1, 0.9);
        GL.draw(GL.SPR.CORE, s.x, s.y, s.scale * 0.34, s.scale * 0.34, 0, 1, 0.95, 0.85, 0.9);
        return;
      }
      // JADE EMPEROR imperial edict (kind 7) — the game's only RECTANGULAR projectile.
      if (s.kind === 7) { drawEdict(s, ang); return; }
      // ANUBIS THE WEIGHING amber ankh-bolt (kind 17).
      if (s.kind === 17) {
        GL.draw(GL.SPR.GLOW, s.x, s.y, s.scale * 0.6, s.scale * 1.7, ang, 1, 0.72, 0.28, 0.5);
        GL.draw(GL.SPR.STREAK, s.x, s.y, s.scale * 0.34, s.scale * 1.3, ang, 1, 0.72, 0.28, 0.95);
        GL.draw(GL.SPR.RING, s.x, s.y - s.scale * 0.2, s.scale * 0.34, s.scale * 0.34, 0, 1, 0.82, 0.4, 0.9);   // ankh loop
        GL.draw(GL.SPR.CORE, s.x, s.y, s.scale * 0.24, s.scale * 0.24, 0, 1, 0.95, 0.7, 0.9);
        return;
      }
      // HEIMDALL SPECTRUM LANCE (kind 18) — prismatic rainbow bolt, cycling hue.
      if (s.kind === 18) {
        var lc = Patterns.hue(G.time * 0.5 + s.y * 0.002);
        GL.draw(GL.SPR.GLOW, s.x, s.y, s.scale * 0.8, s.scale * 2.6, ang, lc[0], lc[1], lc[2], 0.55);
        GL.draw(GL.SPR.STREAK, s.x, s.y, s.scale * 0.5, s.scale * 2.4, ang, lc[0], lc[1], lc[2], 0.95);
        GL.draw(GL.SPR.CORE, s.x, s.y, s.scale * 0.4, s.scale * 0.5, 0, 1, 1, 1, 0.9);
        return;
      }
      // ARTEMIS THE LOOSED ARROW (kind 4 special) — great moon-silver arrow (§9).
      if (s.kind === 4 && s.loosed) {
        var lc = authCell('33-8-loosed-arrow');
        if (lc >= 0) {
          GL.draw(GL.SPR.GLOW, s.x, s.y, s.scale * 1.0, s.scale * 3.0, ang, 0.7, 0.85, 1.0, 0.5);
          GL.draw(lc, s.x, s.y, s.scale * 2.4, s.scale * 2.4, ang, 1, 1, 1, 1);
          return;
        }
      }
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
  // ARES GREEK ARMORY procedural silhouettes (composed from the existing atlas —
  // no new atlas cells): a slim leaf-point javelin, a waisted xiphos leaf-blade, a
  // broad-headed doru, and a mirrored twin-head labrys (unmistakable vs Guan Yu).
  function drawArmoryShot(s, ang) {
    var sc = s.scale, r = s.r, g = s.g, b = s.b, sp = s.age * 14;
    // authored Ares armory sprites (§9): akontia/xiphos/doru fly nose-first; the
    // labrys spins (radially symmetric). Soft additive glow first to seat it in
    // the bloom field, then the sprite in its own colours; procedural on miss.
    var aname = s.kind === 11 ? '33-4-akontia' : s.kind === 12 ? '33-5-xiphos' : s.kind === 13 ? '33-6-doru-bundle' : '33-3-labrys';
    var ac = authCell(aname);
    if (ac >= 0) {
      if (s.kind === 14) { GL.draw(GL.SPR.GLOW, s.x, s.y, sc * 1.5, sc * 1.5, sp, r, g, b, 0.45); GL.draw(ac, s.x, s.y, sc * 1.7, sc * 1.7, sp, 1, 1, 1, 1); }
      else { GL.draw(GL.SPR.GLOW, s.x, s.y, sc * 0.8, sc * 2.0, ang, r, g, b, 0.4); GL.draw(ac, s.x, s.y, sc * 1.9, sc * 1.9, ang, 1, 1, 1, 1); }
      return;
    }
    if (s.kind === 11) {          // akontia javelin — slim shaft + small bronze leaf point
      GL.draw(GL.SPR.STREAK, s.x, s.y, sc * 0.18, sc * 1.5, ang, r, g, b, 0.9);          // shaft
      GL.draw(GL.SPR.SHARD, s.x + Math.sin(ang) * 0 - Math.sin(ang) * sc * 0.5, s.y - Math.cos(ang) * sc * 0.5, sc * 0.34, sc * 0.5, ang, 0.9, 0.65, 0.3, 0.95);   // leaf point
    } else if (s.kind === 12) {   // xiphos — waisted leaf-blade + bronze hilt glint
      GL.draw(GL.SPR.GLOW, s.x, s.y, sc * 0.5, sc * 1.4, ang, r, g, b, 0.4);
      GL.draw(GL.SPR.SHARD, s.x, s.y - Math.cos(ang) * sc * 0.15, sc * 0.5, sc * 1.5, ang, r, g, b, 0.95);   // waisted blade
      GL.draw(GL.SPR.CORE, s.x, s.y, sc * 0.24, sc * 0.24, 0, 1, 1, 1, 0.85);
      GL.draw(GL.SPR.CORE, s.x + Math.sin(ang) * sc * 0.6, s.y + Math.cos(ang) * sc * 0.6, sc * 0.2, sc * 0.2, 0, 1, 0.75, 0.35, 0.8);   // hilt glint
    } else if (s.kind === 13) {   // doru bundle — broad bronze head
      GL.draw(GL.SPR.GLOW, s.x, s.y, sc * 0.7, sc * 1.8, ang, r, g, b, 0.5);
      GL.draw(GL.SPR.STREAK, s.x, s.y, sc * 0.3, sc * 1.7, ang, r, g, b, 0.95);
      GL.draw(GL.SPR.SHARD, s.x - Math.sin(ang) * sc * 0.6, s.y - Math.cos(ang) * sc * 0.6, sc * 0.6, sc * 0.7, ang, 0.95, 0.7, 0.35, 0.95);   // broad head
      GL.draw(GL.SPR.CORE, s.x, s.y, sc * 0.34, sc * 0.34, 0, 1, 1, 0.9, 0.85);
    } else {                      // labrys — spinning mirrored double-axe
      GL.draw(GL.SPR.GLOW, s.x, s.y, sc * 1.6, sc * 1.6, sp, 0.78, 0.12, 0.12, 0.5);
      GL.draw(GL.SPR.SHARD, s.x, s.y, sc * 0.9, sc * 0.6, sp + Math.PI / 2, 0.85, 0.15, 0.12, 0.95);   // head A
      GL.draw(GL.SPR.SHARD, s.x, s.y, sc * 0.9, sc * 0.6, sp - Math.PI / 2, 0.85, 0.15, 0.12, 0.95);   // head B (mirrored)
      GL.draw(GL.SPR.STREAK, s.x, s.y, sc * 0.16, sc * 1.1, sp, 0.9, 0.7, 0.35, 0.9);                  // bronze haft
      GL.draw(GL.SPR.CORE, s.x, s.y, sc * 0.3, sc * 0.3, 0, 1, 0.85, 0.6, 0.85);
    }
  }
  // JADE EMPEROR imperial edict — the ONE rectangular projectile in the game. Three
  // owner-pickable treatments behind GL.setEdictStyle('A'|'B'|'C'); A is the live default.
  //  A = scroll-talisman: violet tablet, gold border, red seal-dot, thin trailing script ticks.
  //  B = hanging vertical banner trailing like a ribbon.
  //  C = square imperial seal-stamp chop (stamps a glowing seal-mark on hit — see hitEnemy).
  var EV = [0.79, 0.6, 1.0], EG = [1, 0.82, 0.4];   // violet body, gold border
  function drawEdict(s, ang) {
    var sc = s.scale, style = GL.edictStyle;
    // authored §9 edict sprite (33.7 was genned for the live style-A scroll-talisman);
    // styles B/C keep their procedural treatment. Sprite is nose-up → rotate to travel.
    if (style === 'A') {
      var ec = authCell('33-7-imperial-edict');
      if (ec >= 0) {
        GL.draw(GL.SPR.GLOW, s.x, s.y, sc * 0.7, sc * 1.1, ang, EG[0], EG[1], EG[2], 0.4);
        GL.draw(ec, s.x, s.y, sc * 1.25, sc * 1.25, ang, 1, 1, 1, 1);
        return;
      }
    }
    var ux = Math.sin(ang), uy = -Math.cos(ang);    // unit vector toward travel (tablet "up")
    var rx = Math.cos(ang), ry = Math.sin(ang);      // perpendicular (tablet "right")
    if (style === 'B') {                             // hanging vertical banner + ribbon trail
      var bw = sc * 0.42, bh = sc * 1.5;
      for (var t = 5; t >= 1; t--) {                 // ribbon segments trailing downward (behind)
        var sway = Math.sin(G.time * 8 + t) * sc * 0.12;
        GL.draw(GL.SPR.CORE, s.x + sway, s.y + t * sc * 0.34, bw * 0.8, sc * 0.36, 0, EV[0], EV[1], EV[2], 0.5 - t * 0.07);
      }
      GL.draw(GL.SPR.GLOW, s.x, s.y, bw * 1.5, bh * 1.1, 0, EV[0], EV[1], EV[2], 0.4);
      GL.draw(GL.SPR.CORE, s.x, s.y, bw, bh, 0, EV[0], EV[1], EV[2], 0.95);       // banner body
      GL.draw(GL.SPR.STREAK, s.x, s.y - bh * 0.5, bw, sc * 0.1, Math.PI / 2, EG[0], EG[1], EG[2], 0.95);   // gold top rail
      GL.draw(GL.SPR.STREAK, s.x, s.y + bh * 0.5, bw, sc * 0.1, Math.PI / 2, EG[0], EG[1], EG[2], 0.95);   // gold bottom rail
      GL.draw(GL.SPR.CORE, s.x, s.y, sc * 0.16, sc * 0.16, 0, 1, 0.2, 0.25, 0.95);                          // red seal-dot
      return;
    }
    var w, h;
    if (style === 'C') { w = sc * 0.72; h = sc * 0.72; }   // square seal-stamp chop
    else { w = sc * 0.5; h = sc * 0.95; }                   // A: tall scroll-talisman
    var hw = w * 0.5, hh = h * 0.5;
    GL.draw(GL.SPR.GLOW, s.x, s.y, w * 1.2, h * 1.2, ang, EG[0], EG[1], EG[2], 0.4);      // gold rim glow (behind)
    GL.draw(GL.SPR.GLOW, s.x, s.y, w * 0.95, h * 0.98, ang, EV[0], EV[1], EV[2], 0.85);   // violet body (soft GLOW → reads violet, no white core)
    GL.draw(GL.SPR.GLOW, s.x, s.y, w * 0.6, h * 0.62, ang, EV[0], EV[1], EV[2], 0.7);      // denser violet centre
    // crisp gold edge bars sell the rectangle
    GL.draw(GL.SPR.STREAK, s.x - rx * hw, s.y - ry * hw, sc * 0.06, h, ang, EG[0], EG[1], EG[2], 0.95);   // left edge
    GL.draw(GL.SPR.STREAK, s.x + rx * hw, s.y + ry * hw, sc * 0.06, h, ang, EG[0], EG[1], EG[2], 0.95);   // right edge
    GL.draw(GL.SPR.STREAK, s.x + ux * hh, s.y + uy * hh, w, sc * 0.06, ang + Math.PI / 2, EG[0], EG[1], EG[2], 0.95);   // top edge
    GL.draw(GL.SPR.STREAK, s.x - ux * hh, s.y - uy * hh, w, sc * 0.06, ang + Math.PI / 2, EG[0], EG[1], EG[2], 0.95);   // bottom edge
    if (style === 'C') GL.draw(GL.SPR.RING, s.x, s.y, w * 0.5, h * 0.5, G.time * 2, 1, 0.2, 0.25, 0.95);   // seal chop ring
    else {
      GL.draw(GL.SPR.CORE, s.x, s.y, sc * 0.14, sc * 0.14, 0, 1, 0.2, 0.25, 0.95);       // red seal-dot
      for (var k = 1; k <= 3; k++) GL.draw(GL.SPR.CORE, s.x - ux * (hh + k * sc * 0.16), s.y - uy * (hh + k * sc * 0.16), sc * 0.05, sc * 0.05, 0, EV[0], EV[1], EV[2], 0.6 - k * 0.15);   // trailing script ticks
    }
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
    if (v.active) { hud.fillStyle = UI_GOLD; hud.fillText('DIVINE INTERVENTION', 0, 0); }
    else if (v.ready) { var pl = 0.5 + 0.5 * Math.sin(G.time * 8); hud.fillStyle = 'rgba(255,225,110,' + (0.5 + 0.5 * pl) + ')'; hud.fillText('DIVINE INTERVENTION — C', 0, 0); }
    else { hud.fillStyle = UI_DIM(); hud.fillText('DIVINE INTERVENTION', 0, 0); }
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
  var charmNameGod = null;   // '◈ <NAME>' loadout line -> god key, built once from Run.CHARMS
  function charmGodByLine(line) {
    if (!charmNameGod) { charmNameGod = {}; if (Run.CHARMS) for (var k in Run.CHARMS) charmNameGod['◈ ' + Run.CHARMS[k].name] = Run.CHARMS[k].god; }
    return charmNameGod[line] || null;
  }
  function drawLoadout() {
    var lines = Game.upgradeSummary();
    hud.textAlign = 'right';
    var y = 244;
    hud.font = '500 22px Consolas, monospace';
    for (var i = 0; i < lines.length; i++) {
      hud.fillStyle = 'rgba(150,220,235,0.7)'; hud.fillText(lines[i], W - 34, y + i * 26);
      // charm lines get their §7 relic icon stamped to the left of the text
      if (lines[i].charAt(0) === '◈' && Run.getArt && Run.godRelic) {
        var slug = Run.godRelic(charmGodByLine(lines[i]));
        var img = slug ? Run.getArt(slug) : null;
        if (img) { var tw = hud.measureText(lines[i]).width; hud.drawImage(img, W - 34 - tw - 30, y + i * 26 - 19, 24, 24); }
      }
    }
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
    // 5a: boss-intro portrait splash (art/gen 22-25) — large, screen-centered, fading with the
    // announce envelope UNDER the title text. Graceful when the painting hasn't loaded (text alone).
    if (an.art && Run.getArt) {
      var pimg = Run.getArt(an.art);
      if (pimg) {
        var ph = H * 0.5, pw = pimg.width * (ph / pimg.height);
        hud.globalAlpha = a * 0.6; hud.drawImage(pimg, W / 2 - pw / 2, H * 0.33, pw, ph); hud.globalAlpha = 1;
      }
    }
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
    hud.fillText('F — auto-fire: ' + (Run.meta.autoFire ? 'ON' : 'OFF'), W / 2, H * 0.42 + 138);
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
