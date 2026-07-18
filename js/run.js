// run.js — roguelite structure layer. Exposes window.Run.
// Owns: seeded PRNG + run generation, sector affixes, the Hades-style god-boon
// draft + shop card UI and composition rules, the localStorage meta layer, the
// title screen, and the run-flow state machine. Drives Game; no combat sim.
(function () {
  'use strict';

  var Run = {};
  window.Run = Run;

  var W = 1080, H = 1920;
  var TAU = Math.PI * 2;

  var COL_CYAN = '#5fe6ff', COL_GOLD = '#ffd766', COL_DIM = '#6fa9b8';
  var COL_RED = '#ff5a6e', COL_PANEL = 'rgba(8,16,22,0.92)', COL_COMMON = '#bfeaf2';
  // rarity border colors
  var RB = { common: '#e8f4f7', rare: '#7fd0ff', epic: '#ffd766' };

  var CAREER_GOLD_UNLOCK = 40000;

  // ---------------------------------------------------------------------
  // seeded PRNG — mulberry32
  // ---------------------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  Run.rng = mulberry32(1);
  Run.seed = 1;
  function ri(n) { return Math.floor(Run.rng() * n); }

  // ---------------------------------------------------------------------
  // meta layer (localStorage)
  // ---------------------------------------------------------------------
  Run.meta = { hi: 0, bestSector: 0, careerGold: 0, killedWarden: false, completedRun: false };
  Run.loadMeta = function () {
    try {
      var raw = localStorage.getItem('goldwake_meta');
      if (raw) {
        var m = JSON.parse(raw);
        Run.meta.hi = m.hi | 0; Run.meta.bestSector = m.bestSector | 0; Run.meta.careerGold = m.careerGold | 0;
        Run.meta.killedWarden = !!m.killedWarden; Run.meta.completedRun = !!m.completedRun;
      }
    } catch (e) {}
  };
  Run.saveMeta = function () { try { localStorage.setItem('goldwake_meta', JSON.stringify(Run.meta)); } catch (e) {} };
  Run.unlocks = function () {
    return {
      startLife: Run.meta.killedWarden,
      startGauge: Run.meta.completedRun,
      baseDamage: Run.meta.careerGold >= CAREER_GOLD_UNLOCK
    };
  };
  Run.reportScore = function (s) { if (s > Run.meta.hi) Run.meta.hi = s; };
  Run.addCareerGold = function (n) { Run.meta.careerGold += n; };
  Run.onWardenKilled = function () { if (!Run.meta.killedWarden) { Run.meta.killedWarden = true; Run.saveMeta(); } };

  // ---------------------------------------------------------------------
  // GODS (color identity + epithet + transform text)
  // ---------------------------------------------------------------------
  var GODS = {
    zeus:      { name: 'ZEUS', epithet: 'the Stormbreaker', pantheon: 'OLYMPUS', css: '#9fd8ff', color: [0.62, 0.85, 1.0],
                 attack: 'Attacks arc chain lightning to nearby foes.',
                 special: 'Lance becomes a storm bolt; foes near its path are chained.' },
    poseidon:  { name: 'POSEIDON', epithet: 'Lord of Tides', pantheon: 'OLYMPUS', css: '#4fe0e0', color: [0.2, 0.82, 0.85],
                 attack: 'Attacks knock foes back; slams deal impact damage.',
                 special: 'A tidal wall sweeps up, carrying bullets off as gold.' },
    artemis:   { name: 'ARTEMIS', epithet: 'the Huntress', pantheon: 'OLYMPUS', css: '#b6ff5a', color: [0.7, 1.0, 0.3],
                 attack: '+18% crit chance; crits deal triple with gold pops.',
                 special: 'A guaranteed-crit arrow that Marks its victim (+25% taken).' },
    aphrodite: { name: 'APHRODITE', epithet: 'the Beguiling', pantheon: 'OLYMPUS', css: '#ff77c8', color: [1.0, 0.45, 0.8],
                 attack: 'Attacks stack Charm; charmed foes fight for you.',
                 special: 'Charm missile: charms the first foe (Weakens bosses).' },
    ares:      { name: 'ARES', epithet: 'God of War', pantheon: 'OLYMPUS', css: '#ff5a6e', color: [0.95, 0.28, 0.4],
                 attack: 'Bloodlust: kills stack battle-frenzy for +fire rate.',
                 special: 'Phobos & Deimos: twin wraiths of Terror; foes flee and take +20%.' },
    demeter:   { name: 'DEMETER', epithet: 'the Frost', pantheon: 'OLYMPUS', css: '#bfefff', color: [0.72, 0.95, 1.0],
                 attack: 'Attacks Chill: stacking slow; 10 stacks shatter.',
                 special: 'Winter Bloom: frost nova that slows all bullets on screen.' },
    ra:        { name: 'RA', epithet: 'the Radiant', pantheon: 'KEMET', css: '#ffe89a', color: [1.0, 0.9, 0.55],
                 attack: 'Streams fuse into a solar beam that ramps on a held target.',
                 special: 'Solar Flare: a screen flash that ignites every foe with Burn.' },
    anubis:    { name: 'ANUBIS', epithet: 'Weigher of Hearts', pantheon: 'KEMET', css: '#e8c46a', color: [0.9, 0.75, 0.35],
                 attack: 'Executes weakened non-boss foes for +50% gold.',
                 special: 'Hall of Judgment: a zone whose damage escalates the longer foes linger.' },
    loki:      { name: 'LOKI', epithet: 'the Trickster', pantheon: 'ASGARD', css: '#8cff5a', color: [0.55, 1.0, 0.35],
                 attack: 'Hits have a 12% chance to Confuse a foe’s aim.',
                 special: 'Shadow-Twin: a decoy that draws all aimed fire and soaks bullets.' },
    odin:      { name: 'ODIN', epithet: 'the Allfather', pantheon: 'ASGARD', css: '#cfd6e0', color: [0.8, 0.85, 0.92],
                 attack: 'Huginn & Muninn orbit and dive at the nearest foe.',
                 special: 'Gungnir: the spear that never misses, piercing foe after foe (Marks each).' },
    wukong:    { name: 'WUKONG', epithet: 'the Monkey King', pantheon: 'CELESTIAL COURT', css: '#ff6a3d', color: [1.0, 0.42, 0.24],
                 attack: 'Kills may spawn a hair-clone that mirrors your fire.',
                 special: 'Ruyi Jingu Bang: a colossal staff slams the column above you.' },
    quetz:     { name: 'QUETZALCOATL', epithet: 'the Plumed Serpent', pantheon: 'FIFTH SUN', css: '#5affc0', color: [0.35, 1.0, 0.75],
                 attack: 'Shots weave serpentine, +1 pierce, wider coverage.',
                 special: 'Sky Serpent sweeps the field, eating bullets into your vaunt gauge.' },
    thor:      { name: 'THOR', epithet: 'the Thunderer', pantheon: 'ASGARD', css: '#8fb4d8', color: [0.56, 0.66, 0.82],
                 attack: 'Mjölnir: a returning hammer that smashes twice per throw.',
                 special: "Giant's Bane: a colossal hammer crushes the toughest foe." }
  };
  Run.GODS = GODS;
  var GOD_KEYS = ['zeus', 'poseidon', 'artemis', 'aphrodite', 'ares', 'demeter', 'ra', 'anubis', 'loki', 'odin', 'wukong', 'quetz', 'thor'];

  var HERMES = { name: 'HERMES', epithet: 'the Swift', css: '#ffd766',
    desc: '+12% speed, +15% focus, +25% special recharge, +50% graze gauge' };

  // per-god mod cards: [id, desc, slotReq]  (slotReq: attack / special / any)
  var MODS = {
    zeus: [['zeusChain', '+1 chain lightning jump', 'attack'], ['zeusCrit', 'chains crit-strike the source', 'attack'], ['zeusFork', 'chains fork to a 2nd target', 'attack'], ['zeusField', 'kills leave a static zap field', 'attack']],
    poseidon: [['poseidonBig', 'bigger knockback & impact', 'attack'], ['poseidonDrag', 'tidal wave drags gold to you', 'special'], ['poseidonSplash', 'wall-slams splash damage', 'attack'], ['poseidonForce', '+40% impulse & impact', 'attack']],
    artemis: [['artemisCrit', '+8% crit chance', 'attack'], ['artemisRefund', 'crits refund special charge', 'special'], ['artemisSpread', 'marked kills spread the Mark', 'attack'], ['artemisMulti', 'crits deal x4 (from x3)', 'attack']],
    aphrodite: [['aphroLong', 'charm lasts longer', 'any'], ['aphroExplode', 'charmed foes explode on expiry', 'any'], ['aphroTaunt', 'foes near a charmed ally target it', 'any'], ['aphroFast', 'charm at fewer hits', 'attack']],
    ares: [['aresDecay', 'frenzy decays half as fast', 'attack'], ['aresCharge', 'frenzy charges special 2x at 5+', 'attack'], ['aresTerror', 'terror lasts +1.5s', 'special'], ['aresSpoils', 'terror-slams drop gold', 'special']],
    demeter: [['demeterFast', 'chill stacks faster', 'attack'], ['demeterShatter', 'bigger shatter blast', 'attack'], ['demeterAoE', 'shatter chills the whole radius', 'attack'], ['demeterSlow', 'chill slows harder', 'attack']],
    ra: [['raRamp', 'beam ramps faster & higher', 'attack'], ['raSpread', 'burning foes spread Burn on death', 'any'], ['raSplit', 'beam splits vs swarms', 'attack'], ['raBurn', 'beam ignites its target', 'attack']],
    anubis: [['anubisThresh', 'execute threshold 20% → 28%', 'attack'], ['anubisRefund', 'executes refund special charge', 'attack'], ['anubisShard', 'executes drop a vaunt shard', 'attack'], ['anubisBossDmg', 'boss weak-point +10% → +20%', 'attack']],
    loki: [['lokiLong', 'decoy lasts 6 → 9s', 'special'], ['lokiBoom', 'decoy explodes: bullets → gold', 'special'], ['lokiVaunt', 'flipped bullets feed vaunt', 'attack'], ['lokiChance', '+6% confuse chance', 'attack']],
    odin: [['odinRaven', 'ravens dive more & hit harder', 'attack'], ['odinMark', 'Gungnir marks last; bonus x1.4', 'special'], ['odinRavenMark', 'ravens Mark on hit', 'attack'], ['odinGungnir', 'Gungnir +50% damage & longer', 'special']],
    wukong: [['wukongClones', 'clones last 7s, cap 3', 'attack'], ['wukongStaff', 'staff wider; survivors Stunned', 'special'], ['wukongSpecial', 'clones echo your special at 25%', 'special'], ['wukongChance', 'clone spawn 20% → 35%', 'attack']],
    quetz: [['quetzBig', 'serpent larger & slower', 'special'], ['quetzGold', 'eaten bullets also pay gold', 'special'], ['quetzCircle', 'serpent circles you at the end', 'special'], ['quetzPierce', '+1 more pierce', 'attack']],
    thor: [['thorBelt', 'Megingjörð: +40% dmg, +50% knockback', 'any'], ['thorFast', 'throw cycle 1.4s → 0.9s', 'attack'], ['thorGauntlet', 'Járngreipr: catch grants +30% stream 2s', 'any'], ['thorSkymark', 'hammer hovers spinning at apex', 'attack']]
  };
  // mods that are one-shot (skip once owned); zeusChain / artemisCrit stack
  var BOOL_MODS = { zeusCrit: 1, zeusFork: 1, zeusField: 1, poseidonBig: 1, poseidonDrag: 1, poseidonSplash: 1, poseidonForce: 1,
    artemisRefund: 1, artemisSpread: 1, artemisMulti: 1, aphroLong: 1, aphroExplode: 1, aphroTaunt: 1, aphroFast: 1,
    aresDecay: 1, aresCharge: 1, aresTerror: 1, aresSpoils: 1, demeterFast: 1, demeterShatter: 1, demeterAoE: 1, demeterSlow: 1,
    raRamp: 1, raSpread: 1, raSplit: 1, raBurn: 1, anubisThresh: 1, anubisRefund: 1, anubisShard: 1, anubisBossDmg: 1,
    lokiLong: 1, lokiBoom: 1, lokiVaunt: 1, lokiChance: 1, odinRaven: 1, odinMark: 1, odinRavenMark: 1, odinGungnir: 1,
    wukongClones: 1, wukongStaff: 1, wukongSpecial: 1, wukongChance: 1, quetzBig: 1, quetzGold: 1, quetzCircle: 1, quetzPierce: 1,
    thorBelt: 1, thorFast: 1, thorGauntlet: 1, thorSkymark: 1 };

  // ---- transform level ladder (pom-style upgrades) --------------------
  var LADDER = [1.0, 1.5, 2.25, 2.9, 3.5];
  function nextMag(m) { var idx = m >= 3.5 ? 4 : m >= 2.9 ? 3 : m >= 2.25 ? 2 : m >= 1.5 ? 1 : 0; return LADDER[Math.min(4, idx + 1)]; }
  function magStars(m) { var t = m >= 3.5 ? 5 : m >= 2.9 ? 4 : m >= 2.25 ? 3 : m >= 1.5 ? 2 : 1; var s = ''; for (var i = 0; i < t; i++) s += '★'; return s; }

  // ---- duo boons (gated on a specific attack+special god pair) ---------
  var DUOS = {
    frozenStorm: { name: 'FROZEN STORM', gods: ['zeus', 'demeter'], desc: 'chill spreads through your lightning chains' },
    eclipse: { name: 'ECLIPSE', gods: ['zeus', 'ra'], desc: 'the solar beam arcs chain lightning' },
    worldSerpent: { name: 'WORLD SERPENT', gods: ['poseidon', 'quetz'], desc: 'the sky serpent leaves a bullet-sweeping wake' },
    deathSentence: { name: 'DEATH SENTENCE', gods: ['artemis', 'anubis'], desc: 'crits execute foes below 40%' },
    loveAndWar: { name: 'LOVE AND WAR', gods: ['aphrodite', 'ares'], desc: 'charmed allies rage; their end sows Terror' },
    doubleTrouble: { name: 'DOUBLE TROUBLE', gods: ['loki', 'wukong'], desc: 'the decoy is a firing clone' },
    huntersEye: { name: "HUNTER'S EYE", gods: ['odin', 'artemis'], desc: 'marked foes always crit' },
    permafrostTomb: { name: 'PERMAFROST TOMB', gods: ['demeter', 'anubis'], desc: 'shatter executes foes below 30%' },
    bloodAndFire: { name: 'BLOOD AND FIRE', gods: ['ra', 'ares'], desc: 'frenzy never fades while anything burns' },
    typhoonPillar: { name: 'TYPHOON PILLAR', gods: ['poseidon', 'wukong'], desc: 'the staff sends a tidal shockwave' },
    allfathersWrath: { name: "ALLFATHER'S WRATH", gods: ['zeus', 'odin'], desc: 'Gungnir chains lightning per pierce' },
    featheredHeart: { name: 'FEATHERED HEART', gods: ['aphrodite', 'quetz'], desc: 'the serpent charms instead of harming' },
    stormfathers: { name: 'STORMFATHERS', gods: ['zeus', 'thor'], desc: 'every hammer impact cracks lightning' },
    ragnarok: { name: 'RAGNARÖK', gods: ['thor', 'loki'], desc: 'the decoy ends in a Mjölnir strike' },
    wildHunt: { name: 'WILD HUNT', gods: ['odin', 'ares'], desc: 'ravens hunt the Terrified x3, feeding frenzy' },
    fifthSunDawn: { name: 'FIFTH SUN DAWN', gods: ['ra', 'quetz'], desc: 'the serpent burns; eaten bullets ignite' },
    havocInHeaven: { name: 'HAVOC IN HEAVEN', gods: ['wukong', 'zeus'], desc: "clones' shots chain lightning" },
    frozenTide: { name: 'FROZEN TIDE', gods: ['poseidon', 'demeter'], desc: 'the tide freezes into a shield wall' },
    eternalDevotion: { name: 'ETERNAL DEVOTION', gods: ['anubis', 'aphrodite'], desc: 'the executed rise as charmed ghosts' },
    stormSurge: { name: 'STORM SURGE', gods: ['thor', 'poseidon'], desc: 'hammer impacts emit tidal waves' },
    silentWinter: { name: 'SILENT WINTER', gods: ['artemis', 'demeter'], desc: 'crits shatter chilled foes instantly' }
  };
  Run.DUOS = DUOS;

  var SCALING = [
    ['atkdmg', 'ATTACK POWER', '+15% attack damage'],
    ['atkrate', 'RAPID FIRE', '+10% attack rate'],
    ['spdmg', 'SIEGE ROUNDS', '+20% special damage'],
    ['spcharge', 'RESERVE CELL', '+1 max special charge'],
    ['sprecharge', 'MOMENTUM', '+20% special recharge']
  ];
  var GENERIC = [
    ['life', 'REDUNDANCY', '+1 life'],
    ['hitbox', 'PINPOINT', '-25% hitbox (once)'],
    ['magnet', 'LODESTONE', '+60% magnet radius'],
    ['goldworth', 'APPRAISAL', '+25% gold value'],
    ['vdur', 'LONG VAUNT', '+1.5s vaunt duration'],
    ['vcap', 'APEX', '+1 multiplier cap']
  ];

  // ---- boon template builders -----------------------------------------
  function tAttack(g, swap) { var G = GODS[g]; return { kind: 'transformA', god: g, slot: 'attack', swap: !!swap, name: G.name, epithet: G.epithet, desc: G.attack, css: G.css }; }
  function tSpecial(g, swap) { var G = GODS[g]; return { kind: 'transformS', god: g, slot: 'special', swap: !!swap, name: G.name, epithet: G.epithet, desc: G.special, css: G.css }; }
  function tMod(g, id, desc) { var G = GODS[g]; return { kind: 'mod', god: g, id: id, name: G.name, epithet: G.epithet, desc: desc, css: G.css }; }
  function tScale(id, name, desc) { return { kind: 'scale', id: id, name: name, epithet: 'battle upgrade', desc: desc, css: COL_CYAN }; }
  function tGeneric(id, name, desc) { return { kind: 'generic', id: id, name: name, epithet: 'battle upgrade', desc: desc, css: COL_CYAN }; }
  function tHermes() { return { kind: 'hermes', god: 'hermes', name: HERMES.name, epithet: HERMES.epithet, desc: HERMES.desc, css: HERMES.css }; }
  function tLevel(slot, god) {
    var G = GODS[god], cur = slot === 'attack' ? Game.st().attackR : Game.st().specialR, nm = nextMag(cur);
    return { kind: slot === 'attack' ? 'levelA' : 'levelS', god: god, slot: slot, mag: nm, level: true,
      name: G.name, epithet: 'LEVEL UP', desc: G.name + ' ' + (slot === 'attack' ? 'ATTACK' : 'SPECIAL') + '  ' + magStars(cur) + ' → ' + magStars(nm), css: G.css };
  }
  function tDuo(id) { var d = DUOS[id]; return { kind: 'duo', id: id, slot: null, duo: true, name: d.name, epithet: 'DUO BOON', desc: d.desc, css: COL_GOLD }; }

  function rollRarity(shop) {
    var r = Run.rng();
    var c = shop ? 0.45 : 0.66, rr = shop ? 0.38 : 0.26;
    if (r < c) return 'common';
    if (r < c + rr) return 'rare';
    return 'epic';
  }
  function bumpRarity(r) { return r === 'common' ? 'rare' : 'epic'; }
  function priceFor(b) {
    var base = b.rarity === 'epic' ? 430 : b.rarity === 'rare' ? 260 : 140;
    if (b.kind === 'transformA' || b.kind === 'transformS') base += 120;
    var st = Game.st();
    var disc = st.aff ? st.aff.shopDiscount : 0;
    return Math.max(20, Math.round(base * (1 - disc)));
  }
  function finalizeBoon(t, shop) {
    var b = { kind: t.kind, god: t.god, id: t.id, slot: t.slot, swap: !!t.swap, name: t.name, epithet: t.epithet, desc: t.desc, css: t.css, duo: !!t.duo, mag: t.mag };
    var rar = rollRarity(shop);
    // A swap arrives at the SAME tier as the transform it replaces.
    if (b.swap) {
      var st = Game.st();
      rar = tierOfMag(b.slot === 'attack' ? st.attackR : st.specialR);
    }
    if (b.kind === 'levelA' || b.kind === 'levelS') rar = tierOfMag(b.mag); // border reflects the new tier
    if (b.duo) rar = 'epic';
    b.rarity = rar;
    if (shop) b.price = priceFor(b);
    return b;
  }
  function tierOfMag(m) { return m >= 2.25 ? 'epic' : m >= 1.5 ? 'rare' : 'common'; }

  // At most one swap offer, injected rarely (SWAP_CHANCE per draft/shop roll).
  var SWAP_CHANCE = 0.10;
  function swapTemplate() {
    var st = Game.st();
    var slots = [];
    if (st.attackGod) slots.push('attack');
    if (st.specialGod) slots.push('special');
    if (!slots.length) return null;
    var slot = slots[Math.floor(Run.rng() * slots.length)];
    var owned = slot === 'attack' ? st.attackGod : st.specialGod;
    var others = GOD_KEYS.filter(function (g) { return g !== owned; });
    var g = others[Math.floor(Run.rng() * others.length)];
    return slot === 'attack' ? tAttack(g, true) : tSpecial(g, true);
  }

  function modEligible(god, slotReq, st) {
    var oa = st.attackGod === god, os = st.specialGod === god;
    if (slotReq === 'attack') return oa;
    if (slotReq === 'special') return os;
    return oa || os;
  }

  function candidatePool(shop) {
    var st = Game.st();
    var out = [];
    function push(t, w) { t.weight = w; out.push(t); }
    // attack / special transforms — only while the slot is empty.
    // Swaps are NOT part of the weighted pool: they'd flood it (11 gods × weight
    // per filled slot). A single swap card is rarely injected in pickDistinct.
    if (!st.attackGod) GOD_KEYS.forEach(function (g) { push(tAttack(g, false), 14); });
    if (!st.specialGod) GOD_KEYS.forEach(function (g) { push(tSpecial(g, false), 12); });
    // transform LEVEL-UP (pom) cards — your own equipped god, up the ladder
    if (st.attackGod && st.attackR < 3.5) push(tLevel('attack', st.attackGod), 10);
    if (st.specialGod && st.specialR < 3.5) push(tLevel('special', st.specialGod), 10);
    // DUO boons (gated on the exact attack+special pair, one-shot)
    for (var did in DUOS) {
      if (st.duos[did]) continue;
      var pr = DUOS[did].gods;
      if ((st.attackGod === pr[0] && st.specialGod === pr[1]) || (st.attackGod === pr[1] && st.specialGod === pr[0])) push(tDuo(did), 3);
    }
    // god mods (only for owned gods, in the required slot)
    GOD_KEYS.forEach(function (g) {
      MODS[g].forEach(function (mm) {
        var id = mm[0], desc = mm[1], slotReq = mm[2];
        if (!modEligible(g, slotReq, st)) return;
        if (BOOL_MODS[id] && st.mods[id]) return;
        push(tMod(g, id, desc), 8);
      });
    });
    // scaling (weight lowered now that poms exist)
    SCALING.forEach(function (sc) {
      if (sc[0] === 'spcharge' && st.sp.max >= 5) return;
      push(tScale(sc[0], sc[1], sc[2]), 4);
    });
    // generics (lower weight)
    GENERIC.forEach(function (gc) {
      if (gc[0] === 'vcap' && st.up.multCap >= 8) return;
      if (gc[0] === 'hitbox' && st.up.hitboxMul < 1) return;
      if (gc[0] === 'life' && st.lives >= 6) return;
      push(tGeneric(gc[0], gc[1], gc[2]), 3);
    });
    // hermes
    push(tHermes(), 4);
    return out;
  }

  function wpick(list) {
    var tot = 0, i;
    for (i = 0; i < list.length; i++) tot += list[i].weight;
    var r = Run.rng() * tot, a = 0;
    for (i = 0; i < list.length; i++) { a += list[i].weight; if (r <= a) return list[i]; }
    return list[list.length - 1];
  }
  function pickDistinct(pool, n, forceKind, shop) {
    var work = pool.slice(), out = [];
    if (forceKind) {
      var f = work.filter(function (t) { return t.kind === forceKind; });
      if (f.length) { var c = wpick(f); out.push(c); work = work.filter(function (t) { return t !== c; }); }
    }
    while (out.length < n && work.length) {
      var c2 = wpick(work); out.push(c2); work = work.filter(function (t) { return t !== c2; });
    }
    // rare swap injection (never displaces a forced-kind guarantee at slot 0)
    if (!forceKind && out.length === n && Run.rng() < SWAP_CHANCE) {
      var sw = swapTemplate();
      if (sw) out[out.length - 1] = sw;
    }
    return out.map(function (t) { return finalizeBoon(t, shop); });
  }

  // ---------------------------------------------------------------------
  // affixes
  // ---------------------------------------------------------------------
  var AFFIX = {
    GILDED: { name: 'GILDED', desc: 'elites drop double gold  •  +10% enemy HP', hpMul: 1.1, eliteGoldMul: 2 },
    SWARM: { name: 'SWARM', desc: 'more popcorn, but frailer', hpMul: 0.7, popcornAdd: 2 },
    DENSE_VEIL: { name: 'DENSE VEIL', desc: 'bullets +25%, but 15% slower', countMul: 1.25, speedMul: 0.85 },
    VOLATILE: { name: 'VOLATILE', desc: 'enemies burst into sprays on death', volatile: true },
    NIGHT_MARKET: { name: 'NIGHT MARKET', desc: 'shop prices -30%', shopDiscount: 0.3 }
  };
  var AFFIX_KEYS = ['GILDED', 'SWARM', 'DENSE_VEIL', 'VOLATILE', 'NIGHT_MARKET'];
  Run.AFFIX = AFFIX;

  // ---------------------------------------------------------------------
  // run generation
  // ---------------------------------------------------------------------
  Run.newSeed = function () { return (Math.random() * 4294967296) >>> 0; };
  Run.startRun = function (seed) {
    Run.seed = seed >>> 0;
    Run.rng = mulberry32(Run.seed);
    Run.loop = 0;
    buildSectors();
    Run.sectorIdx = 0; Run.waveIdx = 0; Run.draftIndex = -1;
    var un = Run.unlocks();
    Game.resetRun({ lives: 3 + (un.startLife ? 1 : 0), gaugePct: un.startGauge ? 0.25 : 0, baseDmg: un.baseDamage ? 1.1 : 1.0 });
    enterSector(0);
  };
  function buildSectors() {
    var bosses = [Game.bosses.warden, Game.bosses.warden2, Game.bosses.sovereign];
    var keys = AFFIX_KEYS.slice();
    for (var s = keys.length - 1; s > 0; s--) { var j = ri(s + 1); var t = keys[s]; keys[s] = keys[j]; keys[j] = t; }
    Run.sectors = [];
    for (var si = 0; si < 3; si++) {
      var nWaves = 4 + ri(si === 2 ? 2 : 3);
      var waves = [], lastName = null;
      for (var w = 0; w < nWaves; w++) { var pick = pickWave(lastName, si); waves.push(pick.fn); lastName = pick.name; }
      Run.sectors.push({ affix: AFFIX[keys[si]], waves: waves, boss: bosses[si], wavesCount: nWaves });
    }
  }
  function pickWave(avoid, si) {
    var full = Game.wavePool, pool = [], total = 0, i;
    for (i = 0; i < full.length; i++) if ((full[i].minSector || 0) <= si) pool.push(full[i]);
    for (i = 0; i < pool.length; i++) total += pool[i].weight;
    for (var tr = 0; tr < 4; tr++) {
      var r = Run.rng() * total, a = 0, chosen = pool[0];
      for (i = 0; i < pool.length; i++) { a += pool[i].weight; if (r <= a) { chosen = pool[i]; break; } }
      if (chosen.name !== avoid) return chosen;
    }
    return pool[0];
  }
  function rankFor(si, wi, wavesCount, boss) {
    var r = 1 + si * 0.55 + (wavesCount ? (wi / wavesCount) * 0.35 : 0);
    if (boss) r += 0.3;
    if (si === 2) r *= 1.12;                  // phase-6 sector-3 bump
    r *= (1 + (Run.loop || 0) * 0.45);        // endless-loop steepening
    return r;
  }

  // ---------------------------------------------------------------------
  // flow state machine
  // ---------------------------------------------------------------------
  function enterSector(si) {
    var sec = Run.sectors[si];
    Game.setAffix(sec.affix);
    Run.waveIdx = 0; Run.cardTimer = 2.6;
    Run.labor = { offered: true, decided: false, accepted: false };
    Run.draftThen = 'wave';
    Game.setMode('sector');
  }
  function laborAffix(base) {
    var keys = AFFIX_KEYS.filter(function (k) { return AFFIX[k].name !== base.name; });
    var extra = AFFIX[keys[ri(keys.length)]];
    var m = {};
    m.hpMul = (base.hpMul || 1) * (extra.hpMul || 1) * 1.4;
    m.eliteGoldMul = Math.max(base.eliteGoldMul || 1, extra.eliteGoldMul || 1);
    m.countMul = (base.countMul || 1) * (extra.countMul || 1);
    m.speedMul = (base.speedMul || 1) * (extra.speedMul || 1);
    m.popcornAdd = (base.popcornAdd || 0) + (extra.popcornAdd || 0);
    m.volatile = base.volatile || extra.volatile;
    m.shopDiscount = Math.max(base.shopDiscount || 0, extra.shopDiscount || 0);
    m.name = base.name + ' + ' + extra.name;
    m.desc = base.desc + '  ·  ' + extra.desc;
    return m;
  }
  function decideLabor(accept) {
    Run.labor.decided = true; Run.labor.accepted = accept;
    if (accept) { Game.setAffix(laborAffix(Run.sectors[Run.sectorIdx].affix)); SFX.vaunt(); }
    else SFX.graze();
    Run.cardTimer = 1.4;
  }
  Run.updateSector = function (dt) {
    if (Run.labor.offered && !Run.labor.decided) {
      if (pressConfirm()) decideLabor(true);
      else if (pressCancel()) decideLabor(false);
      return;
    }
    Run.cardTimer -= dt;
    if (Run.cardTimer <= 0) { var sec = Run.sectors[Run.sectorIdx]; Game.beginWave(sec.waves[0], rankFor(Run.sectorIdx, 0, sec.wavesCount, false)); }
  };
  Run.onCleared = function (kind) {
    if (kind === 'wave') {
      Run.draftIndex++;
      rollDraft(Run.draftIndex);
      if (Run.draftOffers.length === 0) { afterDraft(); return; }
      Game.setMode('draft');
    } else {
      // LABOR FULFILLED: bonus epic draft + gold before the usual shop/finish
      if (Run.labor.accepted) {
        Run.labor.accepted = false;   // consume
        Game.st().wallet += 300;
        rollEpicDraft();
        Run.draftThen = 'afterboss';
        Game.setMode('draft');
        return;
      }
      proceedAfterBoss();
    }
  };
  function proceedAfterBoss() {
    if (Run.sectorIdx < 2) { Run.meta.bestSector = Math.max(Run.meta.bestSector, Run.sectorIdx + 1); Run.saveMeta(); rollShop(); Game.setMode('shop'); }
    else finalizeRun(true);
  }
  function rollEpicDraft() {
    var picks = pickDistinct(candidatePool(false), 3, null, false);
    for (var i = 0; i < picks.length; i++) { picks[i].rarity = 'epic'; }
    Run.draftOffers = picks; Run.draftSel = 0;
  }
  Run.grantApostateDraft = function () { rollEpicDraft(); Run.draftThen = 'resume'; Game.setMode('draft'); };
  function afterDraft() {
    if (Run.draftThen === 'resume') { Run.draftThen = 'wave'; Game.setMode('playing'); return; }
    if (Run.draftThen === 'afterboss') { Run.draftThen = 'wave'; proceedAfterBoss(); return; }
    var sec = Run.sectors[Run.sectorIdx];
    Run.waveIdx++;
    if (Run.waveIdx < sec.waves.length) Game.beginWave(sec.waves[Run.waveIdx], rankFor(Run.sectorIdx, Run.waveIdx, sec.wavesCount, false));
    else Game.beginBoss(sec.boss, rankFor(Run.sectorIdx, sec.wavesCount, sec.wavesCount, true));
  }
  function afterShop() { Run.sectorIdx++; enterSector(Run.sectorIdx); }
  function finalizeRun(win) {
    Run.meta.bestSector = Math.max(Run.meta.bestSector, 3);
    if (win) Run.meta.completedRun = true;
    Run.reportScore(Game.st().score); Run.saveMeta();
    Game.setMode('complete');
  }
  Run.onGameOver = function () {
    Run.reportScore(Game.st().score);
    Run.meta.bestSector = Math.max(Run.meta.bestSector, Run.sectorIdx);
    Run.saveMeta(); Game.setMode('over');
  };
  Run.toTitle = function () { Run.reportScore(Game.st().score); Run.saveMeta(); Game.setMode('title'); };

  // ---------------------------------------------------------------------
  // draft
  // ---------------------------------------------------------------------
  function rollDraft(idx) {
    var st = Game.st();
    if (idx === 0) {
      // Hades opening: three ATTACK transforms from three different gods
      var gs = GOD_KEYS.slice();
      for (var s = gs.length - 1; s > 0; s--) { var j = ri(s + 1); var t = gs[s]; gs[s] = gs[j]; gs[j] = t; }
      Run.draftOffers = [finalizeBoon(tAttack(gs[0], false), false), finalizeBoon(tAttack(gs[1], false), false), finalizeBoon(tAttack(gs[2], false), false)];
    } else {
      var pool = candidatePool(false);
      var forceKind = (idx === 1 && !st.specialGod) ? 'transformS' : null; // early special guarantee
      Run.draftOffers = pickDistinct(pool, 3, forceKind, false);
    }
    Run.draftSel = 0;
  }
  Run.updateDraft = function (dt) {
    var n = Run.draftOffers.length;
    if (n === 0) { afterDraft(); return; }
    if (pressLeft()) Run.draftSel = (Run.draftSel + n - 1) % n;
    if (pressRight()) Run.draftSel = (Run.draftSel + 1) % n;
    if (pressConfirm()) { var bx = Run.draftOffers[Run.draftSel]; Game.applyBoon(bx); pickupSfx(bx); afterDraft(); }
  };

  // ---------------------------------------------------------------------
  // shop
  // ---------------------------------------------------------------------
  function rollShop() {
    var picks = pickDistinct(candidatePool(true), 3, null, true);
    Run.shopItems = picks.map(function (b) { return { kind: 'up', boon: b, price: b.price, sold: false }; });
    Run.rerollCost = 60; Run.shopSel = 0;
  }
  function shopEntries() {
    var list = Run.shopItems.slice();
    list.push({ kind: 'reroll', price: Run.rerollCost });
    list.push({ kind: 'life', price: 700, sold: false });
    list.push({ kind: 'leave' });
    return list;
  }
  Run.updateShop = function (dt) {
    var entries = shopEntries(), n = entries.length;
    if (pressLeft()) Run.shopSel = (Run.shopSel + n - 1) % n;
    if (pressRight()) Run.shopSel = (Run.shopSel + 1) % n;
    if (pressCancel()) { afterShop(); return; }
    if (pressConfirm()) buyCurrent();
  };
  function buyCurrent() {
    var entries = shopEntries(), e = entries[Run.shopSel];
    if (!e) return;
    if (e.kind === 'leave') { afterShop(); return; }
    if (e.kind === 'reroll') { if (Game.spendGold(Run.rerollCost)) { rollShop(); Run.rerollCost += 40; SFX.graze(); } return; }
    if (e.kind === 'life') { if (Game.st().lives < 6 && Game.spendGold(700)) { Game.st().lives++; e.sold = true; SFX.powerup(); } return; }
    if (e.kind === 'up' && !e.sold) { if (Game.spendGold(e.price)) { Game.applyBoon(e.boon); e.sold = true; pickupSfx(e.boon); } }
  }

  // ---------------------------------------------------------------------
  // title / end input
  // ---------------------------------------------------------------------
  Run.nextLoop = function () {
    Run.loop = (Run.loop || 0) + 1;
    buildSectors();
    Run.sectorIdx = 0; Run.waveIdx = 0;
    var st = Game.st(); st.lives = Math.min(6, st.lives + 1);   // small mercy per loop
    enterSector(0);
  };
  Run.updateTitle = function (dt) { if (pressConfirm()) Run.startRun(Run.newSeed()); };
  Run.updateComplete = function (dt) { if (pressConfirm()) Run.nextLoop(); else if (pressCancel()) Run.toTitle(); };
  Run.updateOver = function (dt) { if (pressCancel()) Run.toTitle(); if (pressConfirm()) Run.startRun(Run.newSeed()); };

  function pressLeft() { return Engine.pressed('ArrowLeft') || Engine.pressed('KeyA'); }
  function pressRight() { return Engine.pressed('ArrowRight') || Engine.pressed('KeyD'); }
  function pressConfirm() { return Engine.pressed('KeyZ') || Engine.pressed('Space'); }
  function pressCancel() { return Engine.pressed('Escape') || Engine.pressed('KeyX'); }

  // ---------------------------------------------------------------------
  // mouse
  // ---------------------------------------------------------------------
  var clickRects = [];
  Run.init = function (canvas) {
    Run.loadMeta();
    canvas.addEventListener('mousedown', function (ev) {
      var mode = Game.st() ? Game.st().mode : 'title';
      var lb = GL.letterbox(), scale = lb.w / W;
      var rect = canvas.getBoundingClientRect(), dpr = canvas.width / rect.width;
      var mx = ((ev.clientX - rect.left) * dpr - lb.x) / scale;
      var my = ((ev.clientY - rect.top) * dpr - lb.y) / scale;
      if (mode === 'title') { Run.startRun(Run.newSeed()); return; }
      if (mode === 'complete') { Run.toTitle(); return; }
      if (mode === 'over') { Run.startRun(Run.newSeed()); return; }
      for (var i = 0; i < clickRects.length; i++) {
        var r = clickRects[i];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { r.action(); return; }
      }
    });
  };

  // ---------------------------------------------------------------------
  // drawing helpers
  // ---------------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) {
    if (w < 2 * r) r = w / 2; if (h < 2 * r) r = h / 2;
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function spaced(ctx, text, cx, y, sp) {
    var total = 0, i; ctx.textAlign = 'left';
    for (i = 0; i < text.length; i++) total += ctx.measureText(text[i]).width + sp;
    total -= sp; var x = cx - total / 2;
    for (i = 0; i < text.length; i++) { ctx.fillText(text[i], x, y); x += ctx.measureText(text[i]).width + sp; }
    ctx.textAlign = 'center';
  }
  function wrap(ctx, text, cx, y, maxw, lh) {
    var words = text.split(' '), line = '', lines = [], i;
    for (i = 0; i < words.length; i++) { var test = line ? line + ' ' + words[i] : words[i]; if (ctx.measureText(test).width > maxw && line) { lines.push(line); line = words[i]; } else line = test; }
    if (line) lines.push(line);
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y + i * lh);
  }
  function commas(n) { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function kindLabel(b) {
    var s = b.kind === 'transformA' ? 'ATTACK BOON' : b.kind === 'transformS' ? 'SPECIAL BOON'
      : b.kind === 'levelA' ? 'LEVEL UP · ATK' : b.kind === 'levelS' ? 'LEVEL UP · SPC'
      : b.kind === 'duo' ? '✦ DUO ✦'
      : b.kind === 'mod' ? 'GOD BOON' : b.kind === 'hermes' ? 'BLESSING' : 'UPGRADE';
    return b.swap ? 'SWAP · ' + s : s;
  }
  function pickupSfx(b) { if (b && b.duo) SFX.vauntBonus(); else SFX.powerup(); }

  // ---------------------------------------------------------------------
  // main draw dispatch
  // ---------------------------------------------------------------------
  Run.draw = function (ctx) {
    var mode = Game.st().mode;
    clickRects = [];
    if (mode === 'title') drawTitle(ctx);
    else if (mode === 'sector') drawSectorCard(ctx);
    else if (mode === 'draft') drawDraft(ctx);
    else if (mode === 'shop') drawShop(ctx);
    else if (mode === 'complete') drawEnd(ctx, true);
    else if (mode === 'over') drawEnd(ctx, false);
  };
  function dim(ctx, a) { ctx.fillStyle = 'rgba(0,0,0,' + a + ')'; ctx.fillRect(0, 0, W, H); }

  function drawTitle(ctx) {
    dim(ctx, 0.35);
    ctx.textAlign = 'center';
    ctx.fillStyle = COL_GOLD; ctx.font = '800 150px Consolas, monospace';
    spaced(ctx, 'GOLDWAKE', W / 2, H * 0.16, 16);
    ctx.fillStyle = COL_CYAN; ctx.font = '500 34px Consolas, monospace';
    ctx.fillText('a vaunt-driven bullet hell', W / 2, H * 0.16 + 70);

    var pulse = 0.5 + 0.5 * Math.sin(perfNow() * 0.005);
    ctx.globalAlpha = 0.55 + 0.45 * pulse; ctx.fillStyle = '#ffffff'; ctx.font = '700 52px Consolas, monospace';
    ctx.fillText('Z  —  START RUN', W / 2, H * 0.30); ctx.globalAlpha = 1;

    ctx.fillStyle = COL_DIM; ctx.font = '500 30px Consolas, monospace';
    var cy = H * 0.375, lines = [
      'WASD / Arrows  move          Shift  focus',
      'Z / Space  attack            X  SPECIAL',
      'C  VAUNT                     P  pause',
      'Left/Right + Z  choose boons  (or click)',
      'R  restart run    Esc  title    M  mute'
    ];
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], W / 2, cy + i * 42);

    ctx.fillStyle = COL_GOLD; ctx.font = '600 34px Consolas, monospace';
    ctx.fillText('HI  ' + commas(Run.meta.hi) + '     BEST SECTOR  ' + Run.meta.bestSector + '/3', W / 2, H * 0.575);
    ctx.fillStyle = COL_DIM; ctx.font = '500 26px Consolas, monospace';
    ctx.fillText('career gold  ' + commas(Run.meta.careerGold), W / 2, H * 0.575 + 42);

    var un = Run.unlocks(), ux = W / 2, uy = H * 0.66;
    ctx.font = '600 28px Consolas, monospace'; ctx.fillStyle = COL_CYAN;
    ctx.fillText('— PERMANENT UNLOCKS —', ux, uy);
    var us = [
      [un.startLife, 'Warden slain', '+1 starting life'],
      [un.startGauge, 'Run completed', 'start with 25% vaunt'],
      [un.baseDamage, 'Career gold ' + commas(CAREER_GOLD_UNLOCK), '+10% base damage']
    ];
    for (var k = 0; k < us.length; k++) {
      var on = us[k][0];
      ctx.fillStyle = on ? COL_GOLD : '#3a5560'; ctx.font = '600 26px Consolas, monospace';
      ctx.fillText((on ? '◆ ' : '◇ ') + us[k][2] + '  (' + us[k][1] + ')', ux, uy + 40 + k * 36);
    }

    // god roster teaser
    ctx.font = '600 22px Consolas, monospace';
    var gy = H * 0.79;
    ctx.fillStyle = COL_DIM; ctx.fillText('— OLYMPUS OFFERS —', ux, gy);
    for (var gi = 0; gi < GOD_KEYS.length; gi++) {
      var g = GODS[GOD_KEYS[gi]];
      ctx.fillStyle = g.css;
      ctx.fillText(g.name, W * 0.22 + (gi % 3) * W * 0.28, gy + 40 + ((gi / 3) | 0) * 34);
    }
  }

  function drawSectorCard(ctx) {
    dim(ctx, 0.5);
    var sec = Run.sectors[Run.sectorIdx];
    ctx.textAlign = 'center';
    ctx.fillStyle = COL_CYAN; ctx.font = '600 40px Consolas, monospace';
    ctx.fillText('SECTOR ' + (Run.sectorIdx + 1) + ' / 3', W / 2, H * 0.36);
    ctx.fillStyle = COL_GOLD; ctx.font = '800 92px Consolas, monospace';
    spaced(ctx, sec.affix.name, W / 2, H * 0.42, 12);
    ctx.fillStyle = COL_COMMON; ctx.font = '500 34px Consolas, monospace';
    ctx.fillText(sec.affix.desc, W / 2, H * 0.42 + 96);
    ctx.fillStyle = COL_DIM; ctx.font = '500 26px Consolas, monospace';
    ctx.fillText(sec.wavesCount + ' waves  •  anchor boss', W / 2, H * 0.42 + 150);
    if (Run.loop > 0) { ctx.fillStyle = COL_RED; ctx.font = '600 30px Consolas, monospace'; ctx.fillText('ENDLESS LOOP ' + (Run.loop + 1), W / 2, H * 0.42 + 190); }

    var ly = H * 0.60;
    if (Run.labor.offered && !Run.labor.decided) {
      ctx.fillStyle = COL_GOLD; ctx.font = '700 40px Consolas, monospace';
      spaced(ctx, '◆ LABOR OFFERED ◆', W / 2, ly, 4);
      ctx.fillStyle = COL_COMMON; ctx.font = '500 30px Consolas, monospace';
      ctx.fillText('+1 extra affix  &  +40% enemy HP', W / 2, ly + 48);
      ctx.fillText('reward: 3 EPIC boons + 300 gold on boss kill', W / 2, ly + 86);
      var pulse = 0.5 + 0.5 * Math.sin(perfNow() * 0.006);
      ctx.globalAlpha = 0.55 + 0.45 * pulse; ctx.fillStyle = '#ffffff'; ctx.font = '700 36px Consolas, monospace';
      ctx.fillText('Z  ACCEPT          X  DECLINE', W / 2, ly + 150); ctx.globalAlpha = 1;
      clickRects.push({ x: W * 0.16, y: ly + 122, w: W * 0.32, h: 56, action: function () { decideLabor(true); } });
      clickRects.push({ x: W * 0.52, y: ly + 122, w: W * 0.32, h: 56, action: function () { decideLabor(false); } });
    } else if (Run.labor.accepted) {
      ctx.fillStyle = COL_GOLD; ctx.font = '700 36px Consolas, monospace';
      ctx.fillText('◆ LABOR ACCEPTED — ' + Game.st().aff.name + ' ◆', W / 2, ly);
    } else if (Run.labor.decided) {
      ctx.fillStyle = COL_DIM; ctx.font = '500 30px Consolas, monospace';
      ctx.fillText('labor declined', W / 2, ly);
    }
  }

  function drawCard(ctx, x, y, w, h, b, selected, price, sold) {
    var border = b.duo ? COL_GOLD : (RB[b.rarity] || RB.common);
    ctx.save();
    ctx.fillStyle = COL_PANEL; roundRect(ctx, x, y, w, h, 18); ctx.fill();
    if (b.duo) {                                         // rainbow rim for duos
      var grd = ctx.createLinearGradient(x, y, x + w, y + h);
      grd.addColorStop(0, '#ff77c8'); grd.addColorStop(0.33, '#9fd8ff'); grd.addColorStop(0.66, '#b6ff5a'); grd.addColorStop(1, '#ffd766');
      ctx.strokeStyle = grd; ctx.lineWidth = selected ? 8 : 6; ctx.shadowColor = COL_GOLD; ctx.shadowBlur = 36;
      roundRect(ctx, x, y, w, h, 18); ctx.stroke(); ctx.shadowBlur = 0;
    } else {
      ctx.lineWidth = selected ? 7 : 3;
      ctx.strokeStyle = selected ? '#ffffff' : border;
      if (selected) { ctx.shadowColor = border; ctx.shadowBlur = 30; }
      roundRect(ctx, x, y, w, h, 18); ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.textAlign = 'center';
    // kind + rarity tag
    ctx.fillStyle = border; ctx.font = '600 22px Consolas, monospace';
    ctx.fillText(kindLabel(b) + '  ·  ' + b.rarity.toUpperCase(), x + w / 2, y + 22);
    // god / card name (shrink for long names like QUETZALCOATL)
    ctx.fillStyle = sold ? '#4a6570' : b.css;
    var nf = b.name.length > 9 ? 28 : 40;
    ctx.font = '700 ' + nf + 'px Consolas, monospace';
    spaced(ctx, b.name, x + w / 2, y + h * 0.30, b.name.length > 9 ? 1 : 3);
    // pantheon tag line
    var pan = (b.god && GODS[b.god]) ? GODS[b.god].pantheon : (b.kind === 'hermes' ? 'OLYMPUS' : '');
    if (pan) { ctx.fillStyle = sold ? '#3d545c' : b.css; ctx.font = '600 20px Consolas, monospace'; ctx.fillText('· ' + pan + ' ·', x + w / 2, y + h * 0.30 + 34); }
    // epithet
    ctx.fillStyle = sold ? '#3d545c' : COL_DIM; ctx.font = 'italic 500 23px Consolas, monospace';
    ctx.fillText(b.epithet, x + w / 2, y + h * 0.30 + (pan ? 60 : 44));
    // desc
    ctx.fillStyle = sold ? '#4a6570' : COL_COMMON; ctx.font = '500 27px Consolas, monospace';
    wrap(ctx, b.desc, x + w / 2, y + h * 0.52, w - 54, 34);
    if (price != null) {
      ctx.fillStyle = sold ? COL_RED : COL_GOLD; ctx.font = '700 36px Consolas, monospace';
      ctx.fillText(sold ? 'SOLD' : (commas(price) + ' g'), x + w / 2, y + h - 44);
    }
    ctx.restore();
  }

  function drawDraft(ctx) {
    dim(ctx, 0.62);
    ctx.textAlign = 'center';
    ctx.fillStyle = COL_CYAN; ctx.font = '700 52px Consolas, monospace';
    spaced(ctx, 'A GOD OFFERS A BOON', W / 2, H * 0.14, 6);
    ctx.fillStyle = COL_DIM; ctx.font = '500 30px Consolas, monospace';
    ctx.fillText('Left / Right   •   Z to accept', W / 2, H * 0.14 + 58);

    var n = Run.draftOffers.length, cw = 306, ch = 470, gap = 30;
    var totalW = n * cw + (n - 1) * gap, x0 = (W - totalW) / 2, y0 = H * 0.30;
    for (var i = 0; i < n; i++) {
      var x = x0 + i * (cw + gap);
      drawCard(ctx, x, y0, cw, ch, Run.draftOffers[i], i === Run.draftSel, null, false);
      clickRects.push({ x: x, y: y0, w: cw, h: ch, action: (function (idx) { return function () { Run.draftSel = idx; var bx = Run.draftOffers[idx]; Game.applyBoon(bx); pickupSfx(bx); afterDraft(); }; })(i) });
    }
    drawStacked(ctx);
  }

  function drawShop(ctx) {
    dim(ctx, 0.66);
    ctx.textAlign = 'center';
    ctx.fillStyle = COL_GOLD; ctx.font = '700 58px Consolas, monospace';
    spaced(ctx, 'BLACK MARKET', W / 2, H * 0.10, 8);
    ctx.fillStyle = COL_GOLD; ctx.font = '700 40px Consolas, monospace';
    ctx.fillText('WALLET  ' + commas(Game.st().wallet) + ' g', W / 2, H * 0.10 + 60);

    var cw = 300, ch = 440, gap = 30, totalW = 3 * cw + 2 * gap, x0 = (W - totalW) / 2, y0 = H * 0.24;
    for (var i = 0; i < Run.shopItems.length; i++) {
      var it = Run.shopItems[i], x = x0 + i * (cw + gap);
      drawCard(ctx, x, y0, cw, ch, it.boon, Run.shopSel === i, it.price, it.sold);
      clickRects.push({ x: x, y: y0, w: cw, h: ch, action: (function (k) { return function () { Run.shopSel = k; buyCurrent(); }; })(i) });
    }
    var by = y0 + ch + 54, bw = 300, bh = 96, bgap = 30, bx0 = (W - totalW) / 2;
    var btns = [
      { label: 'REROLL', sub: commas(Run.rerollCost) + ' g', sel: Run.shopSel === Run.shopItems.length, act: Run.shopItems.length },
      { label: 'EXTRA LIFE', sub: '700 g', sel: Run.shopSel === Run.shopItems.length + 1, act: Run.shopItems.length + 1 },
      { label: 'LEAVE  →', sub: 'next sector', sel: Run.shopSel === Run.shopItems.length + 2, act: Run.shopItems.length + 2 }
    ];
    for (var b = 0; b < btns.length; b++) {
      var bx = bx0 + b * (bw + bgap);
      drawButton(ctx, bx, by, bw, bh, btns[b].label, btns[b].sub, btns[b].sel);
      clickRects.push({ x: bx, y: by, w: bw, h: bh, action: (function (sel) { return function () { Run.shopSel = sel; buyCurrent(); }; })(btns[b].act) });
    }
    ctx.fillStyle = COL_DIM; ctx.font = '500 28px Consolas, monospace';
    ctx.fillText('Left / Right   •   Z buy / activate   •   X leave', W / 2, by + bh + 50);
    drawStacked(ctx);
  }
  function drawButton(ctx, x, y, w, h, label, sub, sel) {
    ctx.save();
    ctx.fillStyle = COL_PANEL; roundRect(ctx, x, y, w, h, 14); ctx.fill();
    ctx.lineWidth = sel ? 6 : 3; ctx.strokeStyle = sel ? '#ffffff' : COL_CYAN;
    if (sel) { ctx.shadowColor = COL_CYAN; ctx.shadowBlur = 24; }
    roundRect(ctx, x, y, w, h, 14); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff'; ctx.font = '700 34px Consolas, monospace'; ctx.fillText(label, x + w / 2, y + 30);
    ctx.fillStyle = COL_GOLD; ctx.font = '600 26px Consolas, monospace'; ctx.fillText(sub, x + w / 2, y + 64);
    ctx.restore();
  }

  function drawStacked(ctx) {
    var lines = Game.upgradeSummary();
    var st = Game.st();
    ctx.textAlign = 'left'; ctx.font = '500 24px Consolas, monospace';
    var extra = [];
    if (st.attackGod) extra.push('ATK ' + GODS[st.attackGod].name);
    if (st.specialGod) extra.push('SPC ' + GODS[st.specialGod].name);
    var all = extra.concat(lines);
    if (!all.length) return;
    var x = W - 300, y = H - 40 - all.length * 30;
    ctx.fillStyle = COL_DIM; ctx.fillText('LOADOUT', x, y - 34);
    for (var i = 0; i < all.length; i++) {
      ctx.fillStyle = i < extra.length ? COL_GOLD : COL_COMMON;
      ctx.fillText(all[i], x, y + i * 30);
    }
    ctx.textAlign = 'center';
  }

  function drawEnd(ctx, win) {
    dim(ctx, 0.72);
    ctx.textAlign = 'center';
    ctx.fillStyle = win ? COL_GOLD : COL_RED; ctx.font = '800 92px Consolas, monospace';
    spaced(ctx, win ? 'RUN COMPLETE' : 'GAME OVER', W / 2, H * 0.24, 12);
    var st = Game.st();
    ctx.fillStyle = COL_GOLD; ctx.font = '700 52px Consolas, monospace';
    ctx.fillText('SCORE  ' + commas(st.score), W / 2, H * 0.36);
    ctx.fillStyle = COL_CYAN; ctx.font = '600 36px Consolas, monospace';
    ctx.fillText('BEST  ' + commas(Run.meta.hi), W / 2, H * 0.36 + 56);
    ctx.fillStyle = COL_COMMON; ctx.font = '500 32px Consolas, monospace';
    ctx.fillText('reached sector ' + Math.min(3, Run.sectorIdx + 1) + '/3', W / 2, H * 0.36 + 108);
    ctx.fillText('banked this run  ' + commas(st.wallet) + ' g', W / 2, H * 0.36 + 150);
    ctx.fillStyle = COL_DIM; ctx.font = '600 30px Consolas, monospace';
    ctx.fillText('SEED  ' + Run.seed.toString(16).toUpperCase(), W / 2, H * 0.56);
    var pulse = 0.5 + 0.5 * Math.sin(perfNow() * 0.005);
    ctx.globalAlpha = 0.5 + 0.5 * pulse; ctx.fillStyle = '#ffffff'; ctx.font = '600 38px Consolas, monospace';
    ctx.fillText(win ? 'Z — DESCEND DEEPER (endless)     Esc — title' : 'Z — retry     Esc — title', W / 2, H * 0.64);
    ctx.globalAlpha = 1;
  }
  function perfNow() { return (typeof performance !== 'undefined') ? performance.now() : Date.now(); }

})();
