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

  // ---- STORYBOOK art (art/gen/*.png) lazy loader --------------------------
  // These paintings (god portraits ~3MB each, emblems, relic icons, title +
  // shop dressing) are drawn ONLY on the 2D HUD canvas, which is never read back
  // (no getImageData/toDataURL), so a file:// cross-origin taint is harmless for
  // drawing. Too big to data-URI-embed, so they lazy-load via Image() on first
  // request and are cached; every draw site tolerates absence (text/panel shows
  // through until — or if — the image lands). getArt returns a decoded image or
  // null. Portraits/relics map by god; emblems by pantheon.
  var GOD_PORTRAIT = {
    zeus: '7-zeus', poseidon: '8-poseidon', artemis: '9-artemis', aphrodite: '10-aphrodite',
    ares: '11-ares', heimdall: '12-heimdall', ra: '13-ra', anubis: '14-anubis', loki: '15-loki',
    odin: '16-odin', thor: '17-thor', wukong: '18-wukong', guanyu: '19-guan-yu',
    jade: '20-jade-emperor', quetz: '21-quetzalcoatl'
  };
  var GOD_RELIC = {
    zeus: '30-1-eagle-feather', poseidon: '30-2-pearl-of-the-deep', artemis: '30-3-silver-fletching',
    aphrodite: '30-4-dove-token', ares: '30-5-spear-splinter', heimdall: '30-6-watchmans-eye',
    ra: '30-7-sunstone', anubis: '30-8-heart-scarab', loki: '30-9-tangled-thread',
    odin: '30-10-huginn-muninn', thor: '30-11-hammer-shard', wukong: '30-12-golden-hair',
    guanyu: '30-13-oath-tablet', jade: '30-14-imperial-seal', quetz: '30-15-plumed-crest'
  };
  var PANTHEON_EMBLEM = {
    OLYMPUS: '2-olympus', KEMET: '3-kemet', ASGARD: '4-asgard',
    'CELESTIAL COURT': '5-celestial-court', 'FIFTH SUN': '6-fifth-sun'
  };
  // 30b generic upgrade card art (SCALING/GENERIC cards carry no god portrait) —
  // keyed by the card id (SCALING/GENERIC row[0]). 30c sector-affix keyart, keyed
  // by AFFIX key, dresses the sector-intro screen.
  var GENERIC_ART = {
    atkdmg: '30b-1-attack-power', vcap: '30b-2-apex', spcharge: '30b-3-special-charge',
    life: '30b-4-extra-life', hitbox: '30b-5-focus', goldworth: '30b-6-greed'
  };
  var AFFIX_ART = {
    NIGHT_MARKET: '30c-1-night-market', GILDED: '30c-2-gilded', SWARM: '30c-3-swarm',
    DENSE_VEIL: '30c-4-dense-veil', VOLATILE: '30c-5-volatile'
  };
  // map a live affix object back to its AFFIX key (for AFFIX_ART); null for a
  // composite/labor affix whose name isn't a base key (falls back to the dim wash).
  function affixKeyOf(affix) {
    if (!affix) return null;
    for (var k in AFFIX) if (AFFIX[k] === affix || AFFIX[k].name === affix.name) return k;
    return null;
  }
  var artCache = {};   // slug -> { img, ok } ; entry present but ok=false while loading/failed
  function getArt(slug) {
    if (!slug) return null;
    var e = artCache[slug];
    if (e) return e.ok ? e.img : null;
    var img = new Image();
    e = artCache[slug] = { img: img, ok: false };
    img.onload = function () { e.ok = true; };
    img.onerror = function () { /* absent: draw sites fall back to text/panel */ };
    img.src = 'art/gen/' + slug + '.png';
    return null;
  }
  Run.getArt = getArt;
  Run.godRelic = function (g) { return GOD_RELIC[g] || null; };   // shared with the in-combat loadout HUD (game.js)

  var CAREER_GOLD_UNLOCK = 40000;

  // ---------------------------------------------------------------------
  // seeded PRNG — shared Engine.mulberry32 (single source; see engine.js)
  // ---------------------------------------------------------------------
  Run.rng = Engine.mulberry32(1);
  Run.seed = 1;
  function ri(n) { return Math.floor(Run.rng() * n); }

  // ---------------------------------------------------------------------
  // meta layer (localStorage)
  // NOTE: the storage key is legacy-named 'goldwake_meta' on purpose — the game
  // was renamed to HUBRIS (display only) and keeping the key preserves existing
  // meta progress. Do not rename it.
  // ---------------------------------------------------------------------
  // peakHubris = best HUBRIS multiplier ever reached (additive field; legacy blobs
  // without it fall back to 1.0). Key stays 'goldwake_meta' — never rename.
  Run.meta = { hi: 0, bestSector: 0, careerGold: 0, killedWarden: false, completedRun: false, peakHubris: 1, autoFire: false, lightningStyle: 'C' };
  Run.loadMeta = function () {
    try {
      var raw = localStorage.getItem('goldwake_meta');
      if (raw) {
        var m = JSON.parse(raw);
        Run.meta.hi = m.hi | 0; Run.meta.bestSector = m.bestSector | 0; Run.meta.careerGold = m.careerGold | 0;
        Run.meta.killedWarden = !!m.killedWarden; Run.meta.completedRun = !!m.completedRun;
        Run.meta.peakHubris = +m.peakHubris || 1;   // additive: legacy blob -> 1.0
        Run.meta.autoFire = !!m.autoFire;            // §9b auto-fire toggle (default OFF)
        // respect any explicit persisted pick (A/B/C); a legacy blob missing the
        // field keeps the current default ('C') rather than being forced to 'A'.
        Run.meta.lightningStyle = (m.lightningStyle === 'A' || m.lightningStyle === 'B' || m.lightningStyle === 'C') ? m.lightningStyle : Run.meta.lightningStyle;
      }
    } catch (e) {}
    if (window.GL) GL.setLightningStyle(Run.meta.lightningStyle);   // apply persisted bolt treatment
  };
  // HUBRIS multiplier from a peak step index — read the Game-side table so there's
  // a single source of truth; fall back to the linear form for a legacy/absent table.
  function hubrisMultOf(step) {
    var s = step | 0, t = Game.HUBRIS_MULT;
    if (t && t[s] != null) return t[s];
    return 1 + 0.2 * s;
  }
  function recordPeakHubris() {
    var pk = hubrisMultOf(Game.st().hubris.peak);
    if (pk > Run.meta.peakHubris) Run.meta.peakHubris = pk;
  }
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
  // legacy name: the sector-1 boss is now TALOS, but the meta field/function
  // keep their Warden-era names so saved progress survives (like the storage key)
  Run.onWardenKilled = function () { if (!Run.meta.killedWarden) { Run.meta.killedWarden = true; Run.saveMeta(); } };

  // ---------------------------------------------------------------------
  // GODS (color identity + epithet + transform text)
  // ---------------------------------------------------------------------
  var GODS = {
    zeus:      { name: 'ZEUS', epithet: 'the Stormbreaker', pantheon: 'OLYMPUS', css: '#9fd8ff', color: [0.62, 0.85, 1.0],
                 attack: 'Attacks arc chain lightning to nearby foes.',
                 special: 'SKYFALL: a bolt cracks straight down your lane and forks to nearby foes; struck foes are Stunned.' },
    poseidon:  { name: 'POSEIDON', epithet: 'Lord of Tides', pantheon: 'OLYMPUS', css: '#4fe0e0', color: [0.2, 0.82, 0.85],
                 attack: 'Attacks knock foes back; slams deal impact damage.',
                 special: 'A tidal wall sweeps up, carrying bullets off as gold.' },
    artemis:   { name: 'ARTEMIS', epithet: 'the Huntress', pantheon: 'OLYMPUS', css: '#b6ff5a', color: [0.7, 1.0, 0.3],
                 attack: 'Silver arrows brand the first foe hit as your HUNTED and home to it; hits ramp, kills chain the hunt.',
                 special: 'THE LOOSED ARROW: a piercing precise needle that Marks all it strikes; the first becomes your Hunted at full ramp.' },
    aphrodite: { name: 'APHRODITE', epithet: 'the Beguiling', pantheon: 'OLYMPUS', css: '#ff77c8', color: [1.0, 0.45, 0.8],
                 attack: 'Attacks stack Charm; +15% damage to the charm-touched and Weakened.',
                 special: 'HEARTSEEKER: a slow heart weaves to a foe — charms a minion, or Weakens a boss and melts its bullets to gold.' },
    ares:      { name: 'ARES', epithet: 'God of War', pantheon: 'OLYMPUS', css: '#ff5a6e', color: [0.95, 0.28, 0.4],
                 attack: 'WAR-HEAT: fight at the muzzle to stoke it — javelins escalate to xiphos blades, then a doru bundle + labrys.',
                 special: 'Phobos & Deimos dive-bomb foes, sowing Terror with every strike.' },
    heimdall:  { name: 'HEIMDALL', epithet: 'the Watchman', pantheon: 'ASGARD', css: '#ffe3c2', color: [1.0, 0.89, 0.76],
                 attack: 'THE BIFRÖST: a rainbow bridge lays down your lane on a beat; fire from it to loose spectrum lances. Foes on the bridge are Marked.',
                 special: 'Gjallarhorn: a blast that wounds and Marks all foes, hurling their bullets away.' },
    ra:        { name: 'RA', epithet: 'the Radiant', pantheon: 'KEMET', css: '#ffe89a', color: [1.0, 0.9, 0.55],
                 attack: 'SOLAR LENS: hold fire on ONE foe to focus the beam through 4 heat stages, up to ×2.5.',
                 special: 'Solar Flare: a screen flash that ignites every foe with Burn.' },
    anubis:    { name: 'ANUBIS', epithet: 'Weigher of Hearts', pantheon: 'KEMET', css: '#e8c46a', color: [0.9, 0.75, 0.35],
                 attack: 'THE WEIGHING: your hits load the scales on every foe; when they tip, the Verdict devours the weak for gold (bosses take a judgment burst + Weaken).',
                 special: 'GATE OF DUAT: a gate of sand opens below; the wounded are dragged toward judgment, bleeding missing health.' },
    loki:      { name: 'LOKI', epithet: 'the Trickster', pantheon: 'ASGARD', css: '#8cff5a', color: [0.55, 1.0, 0.35],
                 // PASS2: PILFER text is pre-set so a restore of the Loki ATTACK draft is already correct.
                 attack: 'PILFER — your hits pickpocket a foe (3 marks); on the third, snatch the 8 nearest enemy bullets.',
                 special: 'Shadow-Twin: a decoy that draws all aimed fire and soaks bullets.' },
    odin:      { name: 'ODIN', epithet: 'the Allfather', pantheon: 'ASGARD', css: '#cfd6e0', color: [0.8, 0.85, 0.92],
                 attack: 'NINE NIGHTS: one heavy rune-bolt; every 4th hit carves a rune into the foe, each +15% against it — forever.',
                 special: 'Gungnir: the spear that never misses, piercing foe after foe (Marks each).' },
    wukong:    { name: 'WUKONG', epithet: 'the Monkey King', pantheon: 'CELESTIAL COURT', css: '#ff6a3d', color: [1.0, 0.42, 0.24],
                 attack: 'Kills may spawn a hair-clone that mirrors your fire.',
                 special: 'Ruyi Jingu Bang: a colossal staff slams the column above you.' },
    guanyu:    { name: 'GUAN YU', epithet: 'Saint of War', pantheon: 'CELESTIAL COURT', css: '#3be089', color: [0.23, 0.88, 0.54],
                 attack: 'Shots become crescent blades that cleave, gaining power per foe pierced.',
                 special: 'Crescent Moon Sweep: a colossal blade sweeps the field, hurling foes aside.' },
    jade:      { name: 'JADE EMPEROR', epithet: 'Sovereign of Heaven', pantheon: 'CELESTIAL COURT', css: '#c99aff', color: [0.79, 0.60, 1.0],
                 attack: 'IMPERIAL EDICTS: five homing edicts fan out, seek foes, and Stun them.',
                 special: 'IMPERIAL JUDGEMENT: twin storm-clouds smite random foes with chain lightning; recast to refresh.' },
    quetz:     { name: 'QUETZALCOATL', epithet: 'the Plumed Serpent', pantheon: 'FIFTH SUN', css: '#5affc0', color: [0.35, 1.0, 0.75],
                 attack: 'Three streams braid into a plumed helix (pierces 1); hold it on ONE body to COIL it +10%/bite, up to +60%.',
                 special: 'Sky Serpent sweeps the field, eating bullets into your DIVINE INTERVENTION gauge.' },
    thor:      { name: 'THOR', epithet: 'the Thunderer', pantheon: 'ASGARD', css: '#8fb4d8', color: [0.56, 0.66, 0.82],
                 attack: 'Mjölnir: a returning hammer that smashes twice per throw.',
                 special: "Giant's Bane: a colossal hammer crushes the toughest foe." }
  };
  Run.GODS = GODS;
  var GOD_KEYS = ['zeus', 'poseidon', 'artemis', 'aphrodite', 'ares', 'heimdall', 'ra', 'anubis', 'loki', 'odin', 'wukong', 'quetz', 'thor', 'guanyu', 'jade'];

  // §7 THREE-LINE CONTRACT card copy. GODS[g].attack/.special mix identity + mechanic;
  // the card wants a terse DESC one-liner + a ▸HOW activation/stack fragment (≤12 words,
  // dropped when empty). GOD_CARD holds the per-slot split used by tAttack/tSpecial.
  var GOD_CARD = {
    zeus:      { aDesc: 'Attacks arc chain lightning between nearby foes.', aHow: 'Each hit forks to the next foe.',
                 sDesc: 'SKYFALL cracks a bolt straight down your lane.', sHow: 'Forks to nearby foes; struck are Stunned.' },
    poseidon:  { aDesc: 'Knocks foes back; slams deal impact damage.', aHow: 'Wall-slams add bonus impact.',
                 sDesc: 'A tidal wall sweeps up the whole field.', sHow: 'Carries enemy bullets off as gold.' },
    artemis:   { aDesc: 'Silver arrows brand your HUNTED and home to it.', aHow: 'Hits ramp; a kill chains the hunt on.',
                 sDesc: 'THE LOOSED ARROW — a piercing, precise needle.', sHow: 'Marks all it strikes; first becomes Hunted.' },
    aphrodite: { aDesc: 'Attacks stack Charm across the swarm.', aHow: '+15% to the charm-touched & Weakened.',
                 sDesc: 'HEARTSEEKER weaves a slow heart to a foe.', sHow: 'Charms a minion, or Weakens a boss.' },
    ares:      { aDesc: 'WAR-HEAT — fight at the muzzle to stoke it.', aHow: 'Javelins → xiphos → doru bundle + labrys.',
                 sDesc: 'Phobos & Deimos dive-bomb the field.', sHow: 'Every strike sows Terror.' },
    heimdall:  { aDesc: 'THE BIFRÖST lays a bridge down your lane.', aHow: 'Fire from it to loose spectrum lances.',
                 sDesc: 'Gjallarhorn wounds and Marks every foe.', sHow: 'Hurls their bullets away.' },
    ra:        { aDesc: 'SOLAR LENS focuses a beam on ONE held foe.', aHow: 'Holds through 4 heat stages, up to ×2.5.',
                 sDesc: 'Solar Flare flashes the screen white.', sHow: 'Ignites every foe with Burn.' },
    anubis:    { aDesc: 'THE WEIGHING loads the scales on each foe.', aHow: 'At the tip the Verdict devours the weak.',
                 sDesc: 'GATE OF DUAT opens a sand-vortex below.', sHow: 'Drags the wounded; bleeds missing health.' },
    loki:      { aDesc: 'PILFER pickpockets a foe over three marks.', aHow: 'On the third, snatch 8 nearby bullets.',
                 sDesc: 'Shadow-Twin decoy stands in for you.', sHow: 'Draws all aimed fire; soaks bullets.' },
    odin:      { aDesc: 'NINE NIGHTS — one heavy rune-bolt.', aHow: 'Every 4th hit carves a rune, +15% forever.',
                 sDesc: 'Gungnir never misses, piercing foe after foe.', sHow: 'Marks each foe it runs through.' },
    wukong:    { aDesc: 'Kills may spawn a hair-clone that fights on.', aHow: 'The clone mirrors your fire.',
                 sDesc: 'Ruyi Jingu Bang slams the column above you.', sHow: '' },
    guanyu:    { aDesc: 'Shots become crescent blades that cleave.', aHow: 'Each pierce feeds the next with power.',
                 sDesc: 'Crescent Moon Sweep clears the whole field.', sHow: 'Hurls struck foes aside.' },
    jade:      { aDesc: 'IMPERIAL EDICTS — five homing edicts fan out.', aHow: 'They seek foes and Stun them.',
                 sDesc: 'IMPERIAL JUDGEMENT smites foes with chain lightning.', sHow: 'Recast to refresh the twin storm-clouds.' },
    quetz:     { aDesc: 'Three streams braid into a plumed helix.', aHow: 'Hold ONE body to COIL +10%/bite (max +60%).',
                 sDesc: 'Sky Serpent sweeps the field of bullets.', sHow: 'Eats them into your DIVINE INTERVENTION gauge.' },
    thor:      { aDesc: 'Mjölnir returns, smashing twice per throw.', aHow: '',
                 sDesc: "Giant's Bane crushes the toughest foe.", sHow: '' }
  };

  // §7 STARLINE table — per god×slot the concrete quantity a SIGNATURE star scales.
  // starLine() prints "★★★  ×2.25 <qtyLabel> & <secondary>" from LADDER[tierOf(cur)].
  var STARLINE = {
    zeus:      { attack: { qtyLabel: 'arc damage', secondary: '+chain reach' }, special: { qtyLabel: 'bolt damage', secondary: 'wider stun' } },
    poseidon:  { attack: { qtyLabel: 'impact damage', secondary: '+knockback' }, special: { qtyLabel: 'wave damage', secondary: 'gold sweep' } },
    artemis:   { attack: { qtyLabel: 'arrow damage', secondary: 'hunt ramp' }, special: { qtyLabel: 'needle damage', secondary: 'marks' } },
    aphrodite: { attack: { qtyLabel: 'charm damage', secondary: 'Weaken' }, special: { qtyLabel: 'heart damage', secondary: 'charm dwell' } },
    ares:      { attack: { qtyLabel: 'armory damage', secondary: 'war-heat' }, special: { qtyLabel: 'Terror damage', secondary: 'dread' } },
    heimdall:  { attack: { qtyLabel: 'lance damage', secondary: 'marks' }, special: { qtyLabel: 'horn damage', secondary: '+shove' } },
    ra:        { attack: { qtyLabel: 'beam damage', secondary: 'heat stages' }, special: { qtyLabel: 'flare damage', secondary: 'Burn' } },
    anubis:    { attack: { qtyLabel: 'weigh damage', secondary: 'the scales' }, special: { qtyLabel: 'gate drain', secondary: 'bleed' } },
    loki:      { attack: { qtyLabel: 'pilfer damage', secondary: 'bullet snatch' }, special: { qtyLabel: 'decoy soak', secondary: 'draw' } },
    odin:      { attack: { qtyLabel: 'bolt damage', secondary: 'rune carve' }, special: { qtyLabel: 'Gungnir damage', secondary: 'pierce' } },
    wukong:    { attack: { qtyLabel: 'clone fire', secondary: 'spawn odds' }, special: { qtyLabel: 'staff damage', secondary: 'stun' } },
    guanyu:    { attack: { qtyLabel: 'crescent damage', secondary: 'per-pierce' }, special: { qtyLabel: 'sweep damage', secondary: 'shove' } },
    jade:      { attack: { qtyLabel: 'edict damage', secondary: 'stun' }, special: { qtyLabel: 'judgement damage', secondary: 'chain' } },
    quetz:     { attack: { qtyLabel: 'helix damage', secondary: 'coil bite' }, special: { qtyLabel: 'serpent damage', secondary: 'DI gauge' } },
    thor:      { attack: { qtyLabel: 'hammer damage', secondary: 'double-smash' }, special: { qtyLabel: "Bane damage", secondary: 'knockback' } }
  };
  var MAGSTR = { '1': '1.0', '1.5': '1.5', '2.25': '2.25', '2.9': '2.9', '3.5': '3.5' };
  function magStr(m) { return MAGSTR['' + m] || ('' + m); }
  function tierIdx(m) { return m >= 3.5 ? 4 : m >= 2.9 ? 3 : m >= 2.25 ? 2 : m >= 1.5 ? 1 : 0; }
  // ★-LINE for a transform at its CURRENT tier: "★★★  ×2.25 bolt damage & +chain".
  function starLine(god, slot, cur) {
    var mag = LADDER[tierIdx(cur)], stars = magStars(cur);
    var sl = STARLINE[god] && STARLINE[god][slot];
    if (!sl) return stars + '  ×' + magStr(mag) + ' signature';
    var s = stars + '  ×' + magStr(mag) + ' ' + sl.qtyLabel;
    if (sl.secondary) s += ' & ' + sl.secondary;
    return s;
  }
  // level card now→next ×-line: "×1.5 → ×2.25 bolt damage".
  function levelStarLine(god, slot, cur, next) {
    var sl = STARLINE[god] && STARLINE[god][slot];
    return '×' + magStr(cur) + ' → ×' + magStr(next) + ' ' + (sl ? sl.qtyLabel : 'signature');
  }

  // §2.5 ULTIMATES — god-tied C-key burst transforms. [name, DESC ▸HOW] per the §7
  // three-line contract (no ★-line: ultimates have no star levels first wave).
  var ULTS = {
    zeus:      ['OLYMPIAN STORM',        'Lightning smites every living foe at once. ▸ Instant screen-wide nuke; non-bosses are Stunned.'],
    poseidon:  ['THE DELUGE',            'A calm-water zone floods where you stand. ▸ Enemy bullets entering it die; foes inside slow.'],
    artemis:   ['THE GREAT HUNT',        'Time nearly stops; you keep flying. ▸ Foes your lane crosses take a precise arrow on resume.'],
    aphrodite: ['ADORATION',             'A heart-aura clings to you 5s. ▸ Foes that dwell inside are charmed; bosses Weaken.'],
    ares:      ['ARISTEIA',              'Pinned FRENZY and doubled volleys. ▸ Each kill extends it (cap 8s); no clear, no safety.'],
    ra:        ['NOON OF THE DUAT',      'The solar barque rides the top, tracking you. ▸ A CORONA beam pours down your lane 3s.'],
    anubis:    ['THE FINAL WEIGHING',    'Judge the whole field at once. ▸ Wounded foes are devoured, bosses bitten; the whole spared.'],
    loki:      ['DOPPELGÄNGER',          'A perfect copy fights beside you 6s. ▸ Fires your attack; casts your special once.'],
    odin:      ['ALLFATHER\'S EYE',      'Every bolt carves a rune, on any foe, 6s. ▸ Pure study; the damage comes after.'],
    thor:      ['GIANT\'S END',          'Mjölnir grows colossal and orbits you 4s. ▸ Hurls foes to the wall; smashes bullets from its arc.'],
    heimdall:  ['DAWNBREAK',             'The whole field becomes the bridge 4s. ▸ Every shot a spectrum lance; all foes Marked.'],
    wukong:    ['THE WORLD-PILLAR',      'Plant the staff as standing cover. ▸ A Stun ring, then the only wall bullets cannot cross.'],
    guanyu:    ['GREEN DRAGON ASCENDS',  'A blade-dragon trails your every move 3s. ▸ Drag it through the crowd for carving ticks.'],
    jade:      ['MANDATE OF HEAVEN',     'Freeze, gild, and fire the gold back. ▸ The default burst\'s strict upgrade: bolts + 25% gold.'],
    quetz:     ['THE FIFTH SUN RISES',   'The serpent coils around you 4s. ▸ Eats every bullet it touches into your gauge.']
  };
  Run.ULTS = ULTS;

  // passive god CHARMS — collected through a run, one per god, NOT gated on owning
  // that god: this is how gods you didn't pick still touch your run.
  var CHARMS = {
    charmZeus:      { god: 'zeus',      name: 'EAGLE FEATHER',    desc: '+12% damage to elites and bosses' },
    charmPoseidon:  { god: 'poseidon',  name: 'PEARL OF THE DEEP', desc: '+50% magnet radius' },
    charmArtemis:   { god: 'artemis',   name: 'SILVER FLETCHING', desc: '+precise damage & +15% weak-point size' },
    charmAphrodite: { god: 'aphrodite', name: 'DOVE TOKEN',       desc: 'shop prices -15%' },
    charmAres:      { god: 'ares',      name: 'SPEAR SPLINTER',   desc: '+10% attack damage' },
    charmHeimdall:  { god: 'heimdall',  name: "WATCHMAN'S EYE",   desc: '+12% damage to Marked foes' },
    charmRa:        { god: 'ra',        name: 'SUNSTONE',         desc: '+20% special recharge' },
    charmAnubis:    { god: 'anubis',    name: 'HEART SCARAB',     desc: 'death spills no gold' },
    charmLoki:      { god: 'loki',      name: 'TANGLED THREAD',   desc: '+35% graze gauge gain' },
    charmOdin:      { god: 'odin',      name: 'RAVEN QUILL',      desc: 'Huginn & Muninn fly with you, diving at foes (any attack)' },
    charmThor:      { god: 'thor',      name: 'HAMMER SHARD',     desc: '+15% special damage' },
    charmWukong:    { god: 'wukong',    name: 'GOLDEN HAIR',      desc: '+12% move speed, +15% focus speed' },
    charmQuetz:     { god: 'quetz',     name: 'PLUMED CREST',     desc: '+1.2s DIVINE INTERVENTION duration' },
    charmGuanyu:    { god: 'guanyu',    name: 'OATH TABLET',      desc: 'your multiplier survives death' },
    charmJade:      { god: 'jade',      name: 'IMPERIAL SEAL',    desc: 'DIVINE INTERVENTION bonus pays +30%' }
  };
  Run.CHARMS = CHARMS;
  var CHARM_KEYS = ['charmZeus', 'charmPoseidon', 'charmArtemis', 'charmAphrodite', 'charmAres', 'charmHeimdall', 'charmRa', 'charmAnubis', 'charmLoki', 'charmOdin', 'charmThor', 'charmWukong', 'charmQuetz', 'charmGuanyu', 'charmJade'];

  // per-god mod cards: [id, desc, slotReq]  (slotReq: attack / special / any)
  var MODS = {
    zeus: [['zeusChain', '+1 chain lightning jump', 'attack'], ['zeusCrit', 'chains crit-strike the source', 'attack'], ['zeusFork', 'chains fork to a 2nd target', 'attack'], ['zeusField', 'kills leave a static zap field', 'attack']],
    poseidon: [['poseidonBig', 'bigger knockback & impact', 'attack'], ['poseidonDrag', 'tidal wave drags gold to you', 'special'], ['poseidonSplash', 'wall-slams splash damage', 'attack'], ['poseidonForce', '+40% impulse & impact', 'attack']],
    artemis: [['artemisCrit', "HUNTER'S REACH: +2 ramp cap & +0.6 arrow homing", 'attack'], ['artemisRefund', 'a 6+ stack Hunted hit refunds special charge', 'attack'], ['artemisSpread', 'chain hops carry ALL stacks (no decay)', 'attack'], ['artemisMulti', 'DEEPER HUNT: ramp +0.18/stack (from +0.12)', 'attack']],
    aphrodite: [['aphroLong', 'charm lasts longer', 'any'], ['aphroExplode', 'charmed foes explode on expiry', 'any'], ['aphroTaunt', 'foes near a charmed ally target it', 'any'], ['aphroFast', 'charm at fewer hits', 'attack']],
    ares: [['aresDecay', 'frenzy decays half as fast', 'attack'], ['aresCharge', 'frenzy charges special 2x at 5+', 'attack'], ['aresTerror', 'terror lasts +1.5s', 'special'], ['aresSpoils', 'terror-slams drop gold', 'special']],
    heimdall: [['heimVigil', '+20% damage to Marked foes', 'any'], ['heimHorn', 'Gjallarhorn hits harder; shove 350px', 'special'], ['heimEcho', 'the horn echoes once at 50% after 1s', 'special']],
    ra: [['raRamp', 'beam ramps faster & higher', 'attack'], ['raSpread', 'burning foes spread Burn on death', 'any'], ['raSplit', 'beam splits vs swarms', 'attack'], ['raBurn', 'beam ignites its target', 'attack']],
    anubis: [['anubisHeavy', 'HEAVY HEART: foes below half tip 2× faster', 'attack'], ['anubisFeast', 'FEAST OF THE FAITHFUL: Verdict/Gate kill gold +50%', 'any'], ['anubisRefund', 'a Verdict refunds special charge', 'attack'], ['anubisShard', 'a Verdict drops a DIVINE INTERVENTION shard', 'attack']],
    // PASS2: lokiVaunt + lokiChance restored under PILFER (their Confuse-era readers are replaced).
    loki: [['lokiLong', 'decoy lasts 6 → 9s', 'special'], ['lokiBoom', 'decoy explodes: bullets → gold', 'special'], ['lokiVaunt', 'pilfered daggers charge DIVINE INTERVENTION', 'attack'], ['lokiChance', 'PICKPOCKET: Pilfer on the 2nd mark; steal 12', 'attack']],
    odin: [['odinRaven', 'odinFury: runes carve every 3rd hit (from 4th)', 'attack'], ['odinMark', 'Gungnir marks last; bonus x1.4', 'special'], ['odinRavenMark', 'odinSunder: doom-bolts splash 50% to a nearby foe', 'attack'], ['odinGungnir', 'Gungnir +50% damage & longer', 'special']],
    wukong: [['wukongClones', 'clones last 7s, cap 3', 'attack'], ['wukongStaff', 'staff wider; survivors Stunned', 'special'], ['wukongSpecial', 'clones echo your special at 25%', 'special'], ['wukongChance', 'clone spawn 20% → 35%', 'attack']],
    quetz: [['quetzBig', 'serpent larger & slower', 'special'], ['quetzGold', 'eaten bullets also pay gold', 'special'], ['quetzCircle', 'serpent circles you at the end', 'special'], ['quetzPierce', '+1 more pierce', 'attack']],
    thor: [['thorBelt', 'Megingjörð: +40% dmg, +50% knockback', 'any'], ['thorFast', 'throw cycle 1.4s → 0.9s', 'attack'], ['thorGauntlet', 'Járngreipr: catch grants +30% stream 2s', 'any'], ['thorSkymark', 'hammer hovers spinning at apex', 'attack']],
    guanyu: [['guanWide', 'crescents wider; +1 pierce', 'attack'], ['guanOath', 'Peach-Garden Oath: +30% attack damage while Focused', 'attack'], ['guanWake', 'the sweep leaves a burning arc', 'special'], ['guanSpoils', 'foes slain by the sweep pay +50% gold', 'special']],
    jade: [['jadeOften', 'IMPERIAL JUDGEMENT hurls bolts every 0.5s (from 0.8s)', 'special'], ['jadeStun', 'Stunned foes take +25% damage', 'any'], ['jadeMirror', 'MIRROR REFLECTION: bolts bank off a mirror to the strongest foe', 'special'], ['jadeTribute', 'Weakened foes pay +30% gold on death', 'any']]
  };
  Run.MODS = MODS;
  // mods that are one-shot (skip once owned); zeusChain / artemisCrit stack
  var BOOL_MODS = { zeusCrit: 1, zeusFork: 1, zeusField: 1, poseidonBig: 1, poseidonDrag: 1, poseidonSplash: 1, poseidonForce: 1,
    artemisRefund: 1, artemisSpread: 1, artemisMulti: 1, aphroLong: 1, aphroExplode: 1, aphroTaunt: 1, aphroFast: 1,
    aresDecay: 1, aresCharge: 1, aresTerror: 1, aresSpoils: 1, heimVigil: 1, heimPrism: 1, heimHorn: 1, heimEcho: 1,
    raRamp: 1, raSpread: 1, raSplit: 1, raBurn: 1, anubisHeavy: 1, anubisFeast: 1, anubisRefund: 1, anubisShard: 1,
    lokiLong: 1, lokiBoom: 1, lokiVaunt: 1, lokiChance: 1, odinRaven: 1, odinMark: 1, odinRavenMark: 1, odinGungnir: 1,
    wukongClones: 1, wukongStaff: 1, wukongSpecial: 1, wukongChance: 1, quetzBig: 1, quetzGold: 1, quetzCircle: 1, quetzPierce: 1,
    thorBelt: 1, thorFast: 1, thorGauntlet: 1, thorSkymark: 1,
    guanWide: 1, guanOath: 1, guanWake: 1, guanSpoils: 1, jadeOften: 1, jadeStun: 1, jadeMirror: 1, jadeTribute: 1 };

  // ---- transform level ladder (pom-style upgrades) --------------------
  var LADDER = [1.0, 1.5, 2.25, 2.9, 3.5];
  function nextMag(m) { var idx = m >= 3.5 ? 4 : m >= 2.9 ? 3 : m >= 2.25 ? 2 : m >= 1.5 ? 1 : 0; return LADDER[Math.min(4, idx + 1)]; }
  function magStars(m) { var t = m >= 3.5 ? 5 : m >= 2.9 ? 4 : m >= 2.25 ? 3 : m >= 1.5 ? 2 : 1; var s = ''; for (var i = 0; i < t; i++) s += '★'; return s; }

  // ---- duo boons (gated on a specific attack+special god pair) ---------
  var DUOS = {
    eclipse: { name: 'ECLIPSE', gods: ['zeus', 'ra'], desc: 'the solar beam arcs chain lightning', needSlot: { ra: 'attack' } },
    worldSerpent: { name: 'WORLD SERPENT', gods: ['poseidon', 'quetz'], desc: 'the sky serpent leaves a bullet-sweeping wake', needSlot: { quetz: 'special' } },
    deathSentence: { name: 'DEATH SENTENCE', gods: ['artemis', 'anubis'], desc: 'precise strikes execute foes below 40% and load double weight on the scales' },
    loveAndWar: { name: 'LOVE AND WAR', gods: ['aphrodite', 'ares'], desc: 'charmed allies rage; their end sows Terror' },
    doubleTrouble: { name: 'DOUBLE TROUBLE', gods: ['loki', 'wukong'], desc: 'the decoy is a firing clone', needSlot: { loki: 'special' } },
    huntersEye: { name: "HUNTER'S EYE", gods: ['odin', 'artemis'], desc: 'Marked foes always expose a weak point' },
    bloodAndFire: { name: 'BLOOD AND FIRE', gods: ['ra', 'ares'], desc: 'frenzy never fades while anything burns', needSlot: { ares: 'attack' } },
    typhoonPillar: { name: 'TYPHOON PILLAR', gods: ['poseidon', 'wukong'], desc: 'the staff sends a tidal shockwave', needSlot: { wukong: 'special' } },
    allfathersWrath: { name: "ALLFATHER'S WRATH", gods: ['zeus', 'odin'], desc: 'Gungnir chains lightning per pierce', needSlot: { odin: 'special' } },
    featheredHeart: { name: 'FEATHERED HEART', gods: ['aphrodite', 'quetz'], desc: 'the serpent charms instead of harming', needSlot: { quetz: 'special' } },
    stormfathers: { name: 'STORMFATHERS', gods: ['zeus', 'thor'], desc: 'every hammer impact cracks lightning' },
    ragnarok: { name: 'RAGNARÖK', gods: ['thor', 'loki'], desc: 'the decoy ends in a Mjölnir strike', needSlot: { loki: 'special' } },
    wildHunt: { name: 'WILD HUNT', gods: ['odin', 'ares'], desc: 'doom-bolts and raven dives savage the Terrified (×2), feeding frenzy' },
    fifthSunDawn: { name: 'FIFTH SUN DAWN', gods: ['ra', 'quetz'], desc: 'the serpent burns; eaten bullets ignite', needSlot: { quetz: 'special' } },
    havocInHeaven: { name: 'HAVOC IN HEAVEN', gods: ['wukong', 'zeus'], desc: "clones' shots chain lightning" },
    eternalDevotion: { name: 'ETERNAL DEVOTION', gods: ['anubis', 'aphrodite'], desc: 'the executed rise as charmed ghosts', needSlot: { anubis: 'attack' } },
    stormSurge: { name: 'STORM SURGE', gods: ['thor', 'poseidon'], desc: 'hammer impacts emit tidal waves' },
    swornBrothers: { name: 'SWORN BROTHERS', gods: ['guanyu', 'wukong'], desc: 'clones swing crescent blades that pierce' },
    saintOfWar: { name: 'SAINT OF WAR', gods: ['guanyu', 'jade'], desc: 'crescents Weaken every foe they cleave', needSlot: { guanyu: 'attack' } },
    twoThrones: { name: 'TWO THRONES', gods: ['zeus', 'jade'], desc: 'IMPERIAL JUDGEMENT bolts crack an extra chain of lightning', needSlot: { jade: 'special' } },
    godsOfWar: { name: 'GODS OF WAR', gods: ['ares', 'guanyu'], desc: 'crescents strike the Terrified precisely; such kills feed frenzy', needSlot: { guanyu: 'attack' } },
    peachBanquet: { name: 'PEACH BANQUET', gods: ['wukong', 'jade'], desc: 'kills within 3s of an IMPERIAL JUDGEMENT bolt drop peaches that feed the DIVINE INTERVENTION gauge', needSlot: { jade: 'special' } },
    theAllseeing: { name: 'THE ALLSEEING', gods: ['heimdall', 'odin'], desc: 'Marked foes take Gungnir and raven hits at +40%' },
    heraldOfRagnarok: { name: 'HERALD OF RAGNARÖK', gods: ['heimdall', 'thor'], desc: 'hammer impacts blast a mini horn shove' },
    falseDawn: { name: 'FALSE DAWN', gods: ['heimdall', 'loki'], desc: 'the decoy pulses a marking horn every 2s', needSlot: { loki: 'special' } }
  };
  Run.DUOS = DUOS;

  // §7 copy: [id, name, DESC, ▸HOW]. ATTACK POWER + APEX carry the exact §7 wording.
  var SCALING = [
    ['atkdmg', 'ATTACK POWER', '+15% attack damage.', 'Stacks — buffs your base stream, not signatures.'],
    ['atkrate', 'RAPID FIRE', '+10% attack rate.', 'Stacks — the whole torrent fires faster.'],
    ['spdmg', 'SIEGE ROUNDS', '+20% special damage.', 'Stacks.'],
    ['spcharge', 'RESERVE CELL', '+1 max special charge.', ''],
    ['sprecharge', 'MOMENTUM', '+20% special recharge.', 'Stacks.']
  ];
  var GENERIC = [
    ['life', 'REDUNDANCY', '+1 life.', ''],
    ['hitbox', 'PINPOINT', '-25% hitbox.', 'Once — a permanently smaller kill-dot.'],
    ['magnet', 'LODESTONE', '+60% magnet radius.', ''],
    ['goldworth', 'APPRAISAL', '+25% gold value.', ''],
    ['vdur', 'LONG INTERVENTION', '+1.5s DIVINE INTERVENTION duration.', ''],
    // §7: never "HUBRIS ceiling" (that's the x1.0-2.0 skill meter), never "x2->x3".
    ['vcap', 'APEX', 'APEX — your APOTHEOSIS multiplier climbs one step.', 'Cap ×5 → ×6 (max ×8); +0.25 each kill while golden.']
  ];

  // ---- boon template builders -----------------------------------------
  function tAttack(g, swap) { var G = GODS[g], C = GOD_CARD[g] || {}; return { kind: 'transformA', god: g, slot: 'attack', swap: !!swap, name: G.name, epithet: G.epithet, desc: C.aDesc || G.attack, how: C.aHow || '', css: G.css }; }
  function tSpecial(g, swap) { var G = GODS[g], C = GOD_CARD[g] || {}; return { kind: 'transformS', god: g, slot: 'special', swap: !!swap, name: G.name, epithet: G.epithet, desc: C.sDesc || G.special, how: C.sHow || '', css: G.css }; }
  // §2.5 — ultimate card: epithet is the ULTIMATE'S name (the god name is the card name);
  // id=god so the verify seam (Run._poolHas) can find it. No star levels, so no mag.
  function tUltimate(g, swap) { var G = GODS[g], U = ULTS[g]; return { kind: 'ultimate', god: g, id: g, slot: 'ultimate', swap: !!swap, name: G.name, epithet: U[0], desc: U[1], css: G.css }; }
  function tMod(g, id, desc) { var G = GODS[g]; return { kind: 'mod', god: g, id: id, name: G.name, epithet: G.epithet, desc: desc, css: G.css }; }
  // fix #8: fetch a [id,name,DESC,HOW] copy-row from SCALING/GENERIC by id (single source
  // of truth for both the offer pool and the forceOffer verify surface).
  function copyRow(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i][0] === id) return arr[i]; return arr[0]; }
  function tScale(id, name, desc, how) { return { kind: 'scale', id: id, name: name, epithet: 'battle upgrade', desc: desc, how: how || '', css: COL_CYAN }; }
  function tGeneric(id, name, desc, how) { return { kind: 'generic', id: id, name: name, epithet: 'battle upgrade', desc: desc, how: how || '', css: COL_CYAN }; }
  function tCharm(id) { var c = CHARMS[id], G = GODS[c.god]; return { kind: 'charm', id: id, god: c.god, name: c.name, epithet: 'charm of ' + G.name, desc: c.desc, css: G.css }; }
  function tLevel(slot, god) {
    var G = GODS[god], C = GOD_CARD[god] || {}, cur = slot === 'attack' ? Game.st().attackR : Game.st().specialR, nm = nextMag(cur);
    return { kind: slot === 'attack' ? 'levelA' : 'levelS', god: god, slot: slot, mag: nm, curMag: cur, level: true,
      name: G.name, epithet: 'LEVEL UP',
      // §7 LEVEL-UP DESC: "ODIN ATTACK ★★☆☆☆ → ★★★☆☆"; ▸HOW re-states the signature it grows.
      desc: G.name + ' ' + (slot === 'attack' ? 'ATTACK' : 'SPECIAL') + '  ' + magStars(cur) + ' → ' + magStars(nm),
      how: slot === 'attack' ? (C.aHow || '') : (C.sHow || ''), css: G.css };
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
    var charmDisc = Game.shopDiscount ? Game.shopDiscount() : 0;   // DOVE TOKEN charm (multiplicative)
    return Math.max(20, Math.round(base * (1 - disc) * (1 - charmDisc)));
  }
  function rerollPrice() { return Math.max(10, Math.round(Run.rerollCost * (Game.rerollHalf && Game.rerollHalf() ? 0.5 : 1))); } // RAVEN QUILL charm
  function finalizeBoon(t, shop) {
    var b = { kind: t.kind, god: t.god, id: t.id, slot: t.slot, swap: !!t.swap, name: t.name, epithet: t.epithet, desc: t.desc, how: t.how || '', curMag: t.curMag, css: t.css, duo: !!t.duo, mag: t.mag };
    var rar = rollRarity(shop);
    // A swap arrives at the SAME tier as the transform it replaces.
    if (b.swap) {
      var st = Game.st();
      rar = tierOfMag(b.slot === 'attack' ? st.attackR : st.specialR);
    }
    if (b.kind === 'levelA' || b.kind === 'levelS') rar = tierOfMag(b.mag); // border reflects the new tier
    if (b.duo) rar = 'epic';
    if (b.kind === 'ultimate') rar = 'epic';   // §2.5: ultimates are always epic (no star tiers)
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
    var others = GOD_KEYS.filter(function (g) { return g !== owned; });   // PASS2: Loki ATTACK restored (PILFER)
    var g = others[Math.floor(Run.rng() * others.length)];
    return slot === 'attack' ? tAttack(g, true) : tSpecial(g, true);
  }

  function modEligible(god, slotReq, st) {
    var oa = st.attackGod === god, os = st.specialGod === god;
    if (slotReq === 'attack') return oa;
    if (slotReq === 'special') return os;
    return oa || os;
  }

  // DUO GATING (owner 2026-07-19, §7): a duo is OFFERED only when the run holds ≥1
  // ADDITIONAL boon from either god of the pair beyond the two slot transforms — a star
  // level above base on their slot, a god-tied mod, or that god's charm.
  function investedIn(pair, st) {
    for (var k = 0; k < pair.length; k++) {
      var g = pair[k];
      // star level above base on this god's occupied slot
      if (st.attackGod === g && st.attackR > 1.0) return true;
      if (st.specialGod === g && st.specialR > 1.0) return true;
      // any god-tied mod (mod ids are per-god; check this god's mod table)
      var ms = MODS[g];
      for (var m = 0; m < ms.length; m++) { if (st.mods[ms[m][0]]) return true; }
      // that god's charm (charm<CapitalizedGod>)
      var cid = 'charm' + g.charAt(0).toUpperCase() + g.slice(1);
      if (st.charms[cid]) return true;
    }
    return false;
  }

  // a duo may require a god in a specific slot (needSlot: { god: 'attack'|'special' })
  function duoSlotOk(d, st) {
    if (!d.needSlot) return true;
    for (var g in d.needSlot) {
      var want = d.needSlot[g];
      if (want === 'attack' && st.attackGod !== g) return false;
      if (want === 'special' && st.specialGod !== g) return false;
    }
    return true;
  }
  // per-duo custom eligibility for hooks that a single needSlot can't express.
  // WILD HUNT fires either Odin's attack-rune doom-bolts (Odin in ATTACK) OR the
  // RAVEN QUILL charm's raven dives (charmOdin) — offer only when a live hook exists,
  // never as a near-inert duo when Odin sits purely in the SPECIAL slot with no charm.
  function duoHookOk(did, st) {
    if (did === 'wildHunt') return st.attackGod === 'odin' || !!st.charms.charmOdin;
    return true;
  }

  function candidatePool(shop) {
    var st = Game.st();
    var out = [];
    function push(t, w) { t.weight = w; out.push(t); }
    // attack / special transforms — only while the slot is empty.
    // Swaps are NOT part of the weighted pool: they'd flood it (11 gods × weight
    // per filled slot). A single swap card is rarely injected in pickDistinct.
    if (!st.attackGod) GOD_KEYS.forEach(function (g) { push(tAttack(g, false), 14); });   // PASS2: Loki ATTACK restored (PILFER)
    if (!st.specialGod) GOD_KEYS.forEach(function (g) { push(tSpecial(g, false), 12); });
    // transform LEVEL-UP (pom) cards — your own equipped god, up the ladder
    if (st.attackGod && st.attackR < 3.5) push(tLevel('attack', st.attackGod), 10);
    if (st.specialGod && st.specialR < 3.5) push(tLevel('special', st.specialGod), 10);
    // §2.5 ULTIMATES — offered only while that god holds the ATTACK or SPECIAL slot
    // (OFFER PATHING §7: the ultimate slot gates the same way). While the slot is
    // empty, offer the equipped gods' ultimates; once filled, offer the OTHER equipped
    // god's ultimate as a swap (picking it replaces the slot).
    var eqGods = [];
    if (st.attackGod) eqGods.push(st.attackGod);
    if (st.specialGod && st.specialGod !== st.attackGod) eqGods.push(st.specialGod);
    for (var ei = 0; ei < eqGods.length; ei++) {
      var ug = eqGods[ei];
      // #2 fix: ALLFATHER'S EYE carves runes only off Odin's ATTACK-stream (kind-15) bolts, so
      // offering it while Odin sits purely in SPECIAL delivers a fraction of its advertised effect.
      // Gate the Odin ultimate to an Odin ATTACK build; other ults work from either slot.
      if (ug === 'odin' && st.attackGod !== 'odin') continue;
      if (st.ultimateGod !== ug) push(tUltimate(ug, !!st.ultimateGod), 4);
    }
    // DUO boons (gated on the exact attack+special pair, one-shot). Some duos
    // additionally require a god in a SPECIFIC slot (their hook keys off that
    // god's attack- or special-slot ability), declared via needSlot.
    for (var did in DUOS) {
      if (st.duos[did]) continue;
      var d = DUOS[did], pr = d.gods;
      var pairOk = (st.attackGod === pr[0] && st.specialGod === pr[1]) || (st.attackGod === pr[1] && st.specialGod === pr[0]);
      if (pairOk && duoSlotOk(d, st) && duoHookOk(did, st) && investedIn(pr, st)) push(tDuo(did), 3);   // §7 DUO GATING: equipped + invested + live hook
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
      push(tScale(sc[0], sc[1], sc[2], sc[3]), 4);
    });
    // generics (lower weight)
    GENERIC.forEach(function (gc) {
      if (gc[0] === 'vcap' && st.up.multCap >= 8) return;
      if (gc[0] === 'hitbox' && st.up.hitboxMul < 1) return;
      if (gc[0] === 'life' && st.lives >= 6) return;
      push(tGeneric(gc[0], gc[1], gc[2], gc[3]), 3);
    });
    // passive charms (ungated; one per god per run) — the whole charm family
    // shares Hermes' old blessing mass (~5 total, declining as they're owned)
    var charmW = 5 / CHARM_KEYS.length;
    CHARM_KEYS.forEach(function (id) { if (!st.charms[id]) push(tCharm(id), charmW); });
    return out;
  }

  // verify seam: is a given card kind+id currently in the offer pool? (duo-gating check)
  Run._poolHas = function (kind, id) {
    var pool = candidatePool(false);
    for (var i = 0; i < pool.length; i++) { if (pool[i].kind === kind && pool[i].id === id) return true; }
    return false;
  };

  // Verify hook (zero cost unless called): build one finalized boon per requested kind
  // against the CURRENT Game.st() (harness equips gods/stars/duo pair first), set them
  // as the draft offers, and enter draft mode so Run.draw renders the §7 contract.
  // kinds e.g. ['transformA','duo','levelA']. Guards missing gods (skips, never throws).
  Run.forceOffer = function (kinds) {
    var st = Game.st(), out = [];
    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i], t = null;
      if (k === 'transformA') t = tAttack(st.attackGod || 'zeus', false);
      else if (k === 'transformS') t = tSpecial(st.specialGod || 'poseidon', false);
      else if (k === 'levelA') { if (st.attackGod) t = tLevel('attack', st.attackGod); }
      else if (k === 'levelS') { if (st.specialGod) t = tLevel('special', st.specialGod); }
      else if (k === 'ultimate') t = tUltimate(st.attackGod || 'zeus', false);
      else if (k === 'duo') {
        // prefer a duo whose pair matches the equipped gods, else a stable default.
        var did = null;
        for (var dk in DUOS) { var pr = DUOS[dk].gods; if ((st.attackGod === pr[0] && st.specialGod === pr[1]) || (st.attackGod === pr[1] && st.specialGod === pr[0])) { did = dk; break; } }
        t = tDuo(did || 'eclipse');
      } else if (k === 'charm') t = tCharm('charmZeus');
      // fix #8: reference the SCALING / GENERIC source rows so the verify surface renders
      // EXACTLY what the live pool renders — a later copy edit can no longer diverge.
      else if (k === 'scale') { var _sc = copyRow(SCALING, 'atkdmg'); t = tScale(_sc[0], _sc[1], _sc[2], _sc[3]); }
      else if (k === 'generic') { var _gc = copyRow(GENERIC, 'vcap'); t = tGeneric(_gc[0], _gc[1], _gc[2], _gc[3]); }
      if (t) out.push(finalizeBoon(t, false));
    }
    if (!out.length) return 0;
    Run.draftOffers = out; Run.draftSel = 0;
    Game.setMode('draft');
    return out.length;
  };

  // fix #8 verify: expose the SCALING/GENERIC source rows so the harness can prove
  // forceOffer renders EXACTLY the source copy (both now go through copyRow).
  Run._verifyCopy = function () { return { scale: copyRow(SCALING, 'atkdmg'), generic: copyRow(GENERIC, 'vcap') }; };

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
    Run.rng = Engine.mulberry32(Run.seed);
    if (window.MUSIC) MUSIC.resetTransient();   // clear apotheosis lift / pause duck leaked from a prior run (R-restart)
    Run.loop = 0;
    buildSectors();
    Run.sectorIdx = 0; Run.waveIdx = 0; Run.draftIndex = -1;
    if (window.MUSIC) MUSIC.setSeed(Run.seed);   // deterministic score per run seed
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
      var slots = slotTemplate(nWaves);            // authored difficulty arc
      var waves = [], names = [], lastName = null;
      for (var w = 0; w < slots.length; w++) {
        var pick = pickWaveRole(slots[w], si, lastName);
        waves.push(pick.fn); names.push(pick.name); lastName = pick.name;
      }
      Run.sectors.push({ affix: AFFIX[keys[si]], waves: waves, boss: bosses[si], wavesCount: slots.length, slotRoles: slots, waveNames: names });
    }
  }
  // the sector is the composition: opener → build* → feature → breather →
  // crescendo (→ boss). Length matches the current run length (4-6 waves).
  function slotTemplate(n) {
    var mids = Math.max(1, n - 3);                 // slots between opener and breather+crescendo
    var t = ['opener'];
    var builds = [];
    for (var i = 0; i < mids; i++) builds.push('build');
    builds[Math.floor(mids / 2)] = 'feature';      // one centerpiece
    t = t.concat(builds);
    t.push('breather');
    t.push('crescendo');
    return t;                                       // length === n
  }
  // RNG picks WHICH arrangement fills a slot (among those tagged for the role +
  // reachable by minSector) plus mirror/phase inside the arrangement — never
  // geometry. Falls back to any reachable wave if a role has no match.
  function pickWaveRole(role, si, avoid) {
    var full = Game.wavePool, pool = [], total = 0, i, w;
    for (i = 0; i < full.length; i++) { w = full[i]; if ((w.minSector || 0) <= si && w.roles && w.roles.indexOf(role) >= 0) pool.push(w); }
    if (pool.length === 0) { for (i = 0; i < full.length; i++) if ((full[i].minSector || 0) <= si) pool.push(full[i]); }
    for (i = 0; i < pool.length; i++) total += pool[i].weight;
    for (var tr = 0; tr < 4; tr++) {
      var r = Run.rng() * total, a = 0, chosen = pool[0];
      for (i = 0; i < pool.length; i++) { a += pool[i].weight; if (r <= a) { chosen = pool[i]; break; } }
      if (chosen.name !== avoid || pool.length === 1) return chosen;
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
    Game.setSector(si);                              // reconfigure the environment for this sector
    if (window.MUSIC) MUSIC.setSector(si);           // per-sector theme
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
    if (Run.cardTimer <= 0) { var sec = Run.sectors[Run.sectorIdx]; Game.beginWave(sec.waves[0], rankFor(Run.sectorIdx, 0, sec.wavesCount, false), sec.slotRoles[0]); }
  };
  Run.onCleared = function (kind) {
    if (kind === 'wave') {
      Run.draftIndex++;
      rollDraft(Run.draftIndex);
      if (Run.draftOffers.length === 0) { afterDraft(); return; }
      if (window.MUSIC) MUSIC.setIntensity(0);   // draft freezes combat — strip to the pad
      Game.setMode('draft');
    } else {
      // LABOR FULFILLED: bonus epic draft + gold before the usual shop/finish
      if (Run.labor.accepted) {
        Run.labor.accepted = false;   // consume
        Game.st().wallet += 300;
        rollEpicDraft();
        Run.draftThen = 'afterboss';
        if (window.MUSIC) MUSIC.setIntensity(0);   // draft freezes combat — strip to the pad (parity with the normal draft branch)
        Game.setMode('draft');
        return;
      }
      proceedAfterBoss();
    }
  };
  function proceedAfterBoss() {
    if (Run.sectorIdx < 2) { Run.meta.bestSector = Math.max(Run.meta.bestSector, Run.sectorIdx + 1); Run.saveMeta(); rollShop(); if (window.MUSIC) MUSIC.setTheme('shop'); Game.setMode('shop'); }
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
    if (Run.waveIdx < sec.waves.length) Game.beginWave(sec.waves[Run.waveIdx], rankFor(Run.sectorIdx, Run.waveIdx, sec.wavesCount, false), sec.slotRoles[Run.waveIdx]);
    else { if (window.MUSIC) MUSIC.setBossTheme(Run.sectorIdx); Game.beginBoss(sec.boss, rankFor(Run.sectorIdx, sec.wavesCount, sec.wavesCount, true)); }
  }
  function afterShop() { Run.sectorIdx++; enterSector(Run.sectorIdx); }
  function finalizeRun(win) {
    Run.meta.bestSector = Math.max(Run.meta.bestSector, 3);
    if (win) Run.meta.completedRun = true;
    Run.reportScore(Game.st().score); recordPeakHubris(); Run.saveMeta();
    Run.endT0 = perfNow();
    if (window.MUSIC) { MUSIC.stop(); MUSIC.resetTransient(); }   // victory: resolve + stop; release any lift/duck
    Game.setMode('complete');
  }
  Run.onGameOver = function () {
    Run.reportScore(Game.st().score);
    Run.meta.bestSector = Math.max(Run.meta.bestSector, Run.sectorIdx);
    recordPeakHubris(); Run.saveMeta();
    Run.endT0 = perfNow();
    if (window.MUSIC) { MUSIC.stop(); MUSIC.resetTransient(); }   // death: resolve + stop; release any lift/duck
    Game.setMode('over');
  };
  Run.toTitle = function () { Run.reportScore(Game.st().score); Run.saveMeta(); if (window.MUSIC) { MUSIC.resetTransient(); MUSIC.setTheme('title'); } Game.setMode('title'); };

  // ---------------------------------------------------------------------
  // draft
  // ---------------------------------------------------------------------
  function rollDraft(idx) {
    var st = Game.st();
    if (idx === 0) {
      // Hades opening: three ATTACK transforms from three different gods
      var gs = GOD_KEYS.slice();   // PASS2: Loki ATTACK restored (PILFER) — all gods eligible for the opening pick
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
    list.push({ kind: 'reroll', price: rerollPrice() });
    list.push({ kind: 'life', price: 700, sold: false });
    list.push({ kind: 'leave' });
    return list;
  }
  Run.updateShop = function (dt) {
    var entries = shopEntries(), n = entries.length;
    if (pressLeft()) Run.shopSel = (Run.shopSel + n - 1) % n;
    if (pressRight()) Run.shopSel = (Run.shopSel + 1) % n;
    // X leaves the shop; Esc deliberately does nothing here (it means pause in
    // combat, and an accidental Esc must never skip a shop).
    if (Engine.pressed('KeyX')) { afterShop(); return; }
    if (pressConfirm()) buyCurrent();
  };
  function buyCurrent() {
    var entries = shopEntries(), e = entries[Run.shopSel];
    if (!e) return;
    if (e.kind === 'leave') { afterShop(); return; }
    if (e.kind === 'reroll') { if (Game.spendGold(rerollPrice())) { rollShop(); Run.rerollCost += 40; SFX.graze(); } return; }
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
  // like wrap, but returns the line array (so the caller can advance the cursor).
  function wrapArr(ctx, text, maxw) {
    var words = text.split(' '), line = '', lines = [], i;
    for (i = 0; i < words.length; i++) { var t = line ? line + ' ' + words[i] : words[i]; if (ctx.measureText(t).width > maxw && line) { lines.push(line); line = words[i]; } else line = t; }
    if (line) lines.push(line);
    return lines;
  }
  // §7 CONTRACT — the three body lines for a card: DESC (one-liner) / ▸HOW (fragment,
  // dropped if empty) / ★-LINE (concrete scaled quantity at current tier). SCALING &
  // GENERIC carry no ★-line; only transforms/levels do.
  function cardTierMag(b) {
    // a fresh transform equips the god at base (mag 1.0); a swap arrives at the tier
    // of the slot it replaces (finalizeBoon mirrors the same rarity rule).
    if (b.swap) { var st = Game.st(); return b.slot === 'attack' ? st.attackR : st.specialR; }
    return 1.0;
  }
  function cardLines(b) {
    var desc = b.desc, how = b.how || '', star = '';
    if (b.kind === 'ultimate') {                          // ULTS pack "DESC ▸ HOW" in one string
      var parts = b.desc.split(' ▸ '); desc = parts[0]; if (parts[1]) how = parts[1];
    } else if (b.kind === 'transformA' || b.kind === 'transformS') {
      star = starLine(b.god, b.slot, cardTierMag(b));
    } else if (b.kind === 'levelA' || b.kind === 'levelS') {
      star = levelStarLine(b.god, b.slot, b.curMag, b.mag);   // now→next ×-line
    }
    return { desc: desc, how: how, star: star };
  }
  // §7 LEVEL rail: 1.0 · 1.5 · [2.25] · 2.9 · 3.5 with the NEXT node bracketed & lit.
  var RAIL = [1.0, 1.5, 2.25, 2.9, 3.5];
  function drawRail(ctx, cx, y, cur, next, sold) {
    var parts = [], i;
    for (i = 0; i < RAIL.length; i++) { var isNext = Math.abs(RAIL[i] - next) < 0.01; parts.push(isNext ? '[' + magStr(RAIL[i]) + ']' : magStr(RAIL[i])); }
    ctx.font = '600 16px Consolas, monospace';   // 16px: the 5-node rail fits a 306px card
    ctx.fillStyle = sold ? '#6a5a2e' : COL_GOLD;
    ctx.fillText(parts.join(' · '), cx, y);
  }
  function commas(n) { return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function kindLabel(b) {
    var s = b.kind === 'transformA' ? 'ATTACK BOON' : b.kind === 'transformS' ? 'SPECIAL BOON'
      : b.kind === 'levelA' ? 'LEVEL UP · ATK' : b.kind === 'levelS' ? 'LEVEL UP · SPC'
      : b.kind === 'duo' ? '✦ DUO ✦' : b.kind === 'ultimate' ? '◆ ULTIMATE ◆'
      : b.kind === 'mod' ? 'GOD BOON' : b.kind === 'charm' ? 'CHARM' : 'UPGRADE';
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
  // Full-field STORYBOOK dressing (title backdrop / shop backdrop) painted under
  // the menu text. Both were authored 1080×1920 with an empty dark center column
  // for exactly this. When the art is absent, fall back to the plain dim wash so
  // the screen never breaks. scrim = extra near-black over the art for contrast.
  function drawScreenArt(ctx, slug, scrim, dimWhenAbsent) {
    var img = getArt(slug);
    if (!img) { dim(ctx, dimWhenAbsent); return false; }
    var scale = Math.max(W / img.width, H / img.height);
    var dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, W / 2 - dw / 2, H / 2 - dh / 2, dw, dh);
    ctx.fillStyle = 'rgba(5,8,11,' + scrim + ')'; ctx.fillRect(0, 0, W, H);
    return true;
  }

  function drawTitle(ctx) {
    drawScreenArt(ctx, '1-hubris-title-backdrop', 0.28, 0.35);
    ctx.textAlign = 'center';
    ctx.fillStyle = COL_GOLD; ctx.font = '800 150px Consolas, monospace';
    spaced(ctx, 'HUBRIS', W / 2, H * 0.16, 30);   // 6 letters: wider tracking than the old 8-letter mark
    ctx.fillStyle = COL_CYAN; ctx.font = '500 34px Consolas, monospace';
    // textBaseline is 'top': clear the full 150px glyph block before the subtitle
    ctx.fillText('a divine-intervention bullet hell', W / 2, H * 0.16 + 160);

    var pulse = 0.5 + 0.5 * Math.sin(perfNow() * 0.005);
    ctx.globalAlpha = 0.55 + 0.45 * pulse; ctx.fillStyle = '#ffffff'; ctx.font = '700 52px Consolas, monospace';
    ctx.fillText('Z  —  START RUN', W / 2, H * 0.30); ctx.globalAlpha = 1;

    ctx.fillStyle = COL_DIM; ctx.font = '500 30px Consolas, monospace';
    var cy = H * 0.375, lines = [
      'WASD / Arrows  move          Shift  focus',
      'Shift-tap + direction  ghost dodge (i-frames)',
      'Z / Space  attack            X  SPECIAL',
      'C  DIVINE INTERVENTION       P / Esc  pause',
      'Left/Right + Z  choose boons  (or click)',
      'R  restart run    M  mute'
    ];
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], W / 2, cy + i * 42);

    ctx.fillStyle = COL_GOLD; ctx.font = '600 34px Consolas, monospace';
    ctx.fillText('HI  ' + commas(Run.meta.hi) + '     BEST SECTOR  ' + Run.meta.bestSector + '/3', W / 2, H * 0.575);
    ctx.fillStyle = COL_DIM; ctx.font = '500 26px Consolas, monospace';
    ctx.fillText('career gold  ' + commas(Run.meta.careerGold) + '     peak hubris  x' + Run.meta.peakHubris.toFixed(1), W / 2, H * 0.575 + 42);

    var un = Run.unlocks(), ux = W / 2, uy = H * 0.66;
    ctx.font = '600 28px Consolas, monospace'; ctx.fillStyle = COL_CYAN;
    ctx.fillText('— PERMANENT UNLOCKS —', ux, uy);
    var us = [
      [un.startLife, 'Talos slain', '+1 starting life'],
      [un.startGauge, 'Run completed', 'start with 25% DIVINE INTERVENTION'],
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

  // sector → tradition for the intro emblem stamp (S1 Bronze Coast/TALOS = Greek,
  // S2 River of Night/AMMIT = Kemet, S3 Gilded Court/MIDAS = Celestial Court).
  var SECTOR_PANTHEON = ['OLYMPUS', 'KEMET', 'CELESTIAL COURT'];
  function drawSectorCard(ctx) {
    var sec = Run.sectors[Run.sectorIdx];
    // 30c sector-affix keyart as the intro backdrop (scrim keeps the title/text
    // readable, same treatment as the title backdrop); plain dim wash when absent.
    var affixSlug = sec && sec.affix ? AFFIX_ART[affixKeyOf(sec.affix)] : null;
    drawScreenArt(ctx, affixSlug, 0.55, 0.5);
    // pantheon emblem stamp, large and dim, centered above the sector title
    var emb = getArt(PANTHEON_EMBLEM[SECTOR_PANTHEON[Run.sectorIdx] || 'OLYMPUS']);
    if (emb) { ctx.save(); ctx.globalAlpha = 0.5; var es = 240; ctx.drawImage(emb, W / 2 - es / 2, H * 0.20, es, es); ctx.restore(); }
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

  // STORYBOOK card art painted under the text: a god portrait (cover-fit, dimmed)
  // for god cards, or the charm's relic icon (floating in the upper band) for
  // charms. Near-black scrims keep the text zones legible. Returns true when art
  // was actually painted (so the caller can shadow its text for contrast).
  // cover-fit a portrait inside an already-clipped (sub)rect at the given alpha.
  function coverPortrait(ctx, img, rx, ry, rw, rh, alpha) {
    var scale = Math.max(rw / img.width, rh / img.height);
    var dw = img.width * scale, dh = img.height * scale;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, rx + rw / 2 - dw / 2, ry + rh / 2 - dh / 2, dw, dh);
    ctx.globalAlpha = 1;
  }
  // shared near-black scrims (overall dim + top/bottom text gradients) painted over card art.
  function cardArtScrims(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(5,8,11,0.34)'; ctx.fillRect(x, y, w, h);            // overall dim
    var gt = ctx.createLinearGradient(0, y, 0, y + h * 0.46);                  // top: kind tag + name + epithet
    gt.addColorStop(0, 'rgba(5,8,11,0.9)'); gt.addColorStop(1, 'rgba(5,8,11,0)');
    ctx.fillStyle = gt; ctx.fillRect(x, y, w, h * 0.46);
    var gb = ctx.createLinearGradient(0, y + h * 0.46, 0, y + h);              // bottom: desc + price
    gb.addColorStop(0, 'rgba(5,8,11,0)'); gb.addColorStop(1, 'rgba(5,8,11,0.95)');
    ctx.fillStyle = gb; ctx.fillRect(x, y + h * 0.46, w, h * 0.54);
  }
  function drawCardArt(ctx, x, y, w, h, b) {
    // 5c: DUO cards composite BOTH gods' portraits (split down the middle), not a blank panel.
    if (b.duo) {
      var d = DUOS[b.id];
      if (!d || !d.gods) return false;
      var i1 = getArt(GOD_PORTRAIT[d.gods[0]]), i2 = getArt(GOD_PORTRAIT[d.gods[1]]);
      if (!i1 && !i2) return false;
      ctx.save();
      roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 15); ctx.clip();
      if (i1) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w / 2, h); ctx.clip(); coverPortrait(ctx, i1, x, y, w / 2, h, 0.85); ctx.restore(); }
      if (i2) { ctx.save(); ctx.beginPath(); ctx.rect(x + w / 2, y, w / 2, h); ctx.clip(); coverPortrait(ctx, i2, x + w / 2, y, w / 2, h, 0.85); ctx.restore(); }
      // gold seam glow down the split
      var seam = ctx.createLinearGradient(x + w / 2 - 12, 0, x + w / 2 + 12, 0);
      seam.addColorStop(0, 'rgba(5,8,11,0)'); seam.addColorStop(0.5, 'rgba(255,210,120,0.35)'); seam.addColorStop(1, 'rgba(5,8,11,0)');
      ctx.fillStyle = seam; ctx.fillRect(x + w / 2 - 12, y, 24, h);
      cardArtScrims(ctx, x, y, w, h);
      ctx.restore();
      return true;
    }
    // 30b: generic upgrade card art — SCALING/GENERIC cards have no god portrait,
    // so key by the card id. coverPortrait treatment matches the god cards.
    if (!b.god && GENERIC_ART[b.id]) {
      var gimg = getArt(GENERIC_ART[b.id]);
      if (!gimg) return false;
      ctx.save();
      roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 15); ctx.clip();
      coverPortrait(ctx, gimg, x, y, w, h, 0.85);
      cardArtScrims(ctx, x, y, w, h);
      ctx.restore();
      return true;
    }
    var isCharm = b.kind === 'charm';
    var slug = isCharm ? GOD_RELIC[b.god] : (b.god ? GOD_PORTRAIT[b.god] : null);
    var img = getArt(slug);
    if (!img) return false;
    ctx.save();
    roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 15); ctx.clip();
    if (isCharm) {
      var s = Math.min(w * 0.6, h * 0.4);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(img, x + w / 2 - s / 2, y + h * 0.30, s, s);
      ctx.globalAlpha = 1;
    } else {
      coverPortrait(ctx, img, x, y, w, h, 0.85);
    }
    cardArtScrims(ctx, x, y, w, h);
    // 5b: pantheon emblem corner stamp (art/gen emblems 2-6) on god boon cards.
    var emb = (b.god && GODS[b.god]) ? getArt(PANTHEON_EMBLEM[GODS[b.god].pantheon]) : null;
    if (emb) { var es = Math.min(w, h) * 0.22; ctx.globalAlpha = 0.9; ctx.drawImage(emb, x + w - es - 12, y + 12, es, es); ctx.globalAlpha = 1; }
    ctx.restore();
    return true;
  }

  function drawCard(ctx, x, y, w, h, b, selected, price, sold) {
    var border = b.duo ? COL_GOLD : (RB[b.rarity] || RB.common);
    ctx.save();
    ctx.fillStyle = COL_PANEL; roundRect(ctx, x, y, w, h, 18); ctx.fill();
    var hasArt = drawCardArt(ctx, x, y, w, h, b);
    if (b.duo) {                                         // rainbow rim for duos
      var grd = ctx.createLinearGradient(x, y, x + w, y + h);
      grd.addColorStop(0, '#ff77c8'); grd.addColorStop(0.33, '#9fd8ff'); grd.addColorStop(0.66, '#b6ff5a'); grd.addColorStop(1, '#ffd766');
      ctx.strokeStyle = grd; ctx.lineWidth = selected ? 8 : 6; ctx.shadowColor = COL_GOLD; ctx.shadowBlur = 36;
      roundRect(ctx, x, y, w, h, 18); ctx.stroke(); ctx.shadowBlur = 0;
    } else if (b.kind === 'ultimate') {                  // §2.5: white-gold DOUBLE rim (rainbow stays duo-only)
      ctx.shadowColor = COL_GOLD; ctx.shadowBlur = selected ? 34 : 22;
      ctx.strokeStyle = COL_GOLD; ctx.lineWidth = selected ? 8 : 6;
      roundRect(ctx, x, y, w, h, 18); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;    // inner white rim
      roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 14); ctx.stroke();
    } else {
      ctx.lineWidth = selected ? 7 : 3;
      ctx.strokeStyle = selected ? '#ffffff' : border;
      if (selected) { ctx.shadowColor = border; ctx.shadowBlur = 30; }
      roundRect(ctx, x, y, w, h, 18); ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.textAlign = 'center';
    if (hasArt) { ctx.shadowColor = 'rgba(0,0,0,0.92)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1; }   // keep text legible over the painting
    // kind + rarity tag
    ctx.fillStyle = border; ctx.font = '600 22px Consolas, monospace';
    ctx.fillText(kindLabel(b) + '  ·  ' + b.rarity.toUpperCase(), x + w / 2, y + 22);
    // god / card name (shrink for long names like QUETZALCOATL)
    ctx.fillStyle = sold ? '#4a6570' : b.css;
    var nf = b.name.length > 9 ? 28 : 40;
    ctx.font = '700 ' + nf + 'px Consolas, monospace';
    var nameY = y + h * 0.30;
    spaced(ctx, b.name, x + w / 2, nameY, b.name.length > 9 ? 1 : 3);
    // §7: NAME + ★-track — a small current-tier star row under the name (transforms/levels).
    var isXform = (b.kind === 'transformA' || b.kind === 'transformS');
    var isLevel = (b.kind === 'levelA' || b.kind === 'levelS');
    var hasTrack = isXform || isLevel, panY, epiY;
    if (hasTrack) {
      ctx.fillStyle = sold ? '#6a5a2e' : COL_GOLD; ctx.font = '600 18px Consolas, monospace';
      ctx.fillText(magStars(isXform ? cardTierMag(b) : b.curMag), x + w / 2, nameY + 24);
      panY = nameY + 48; epiY = nameY + (b.god && GODS[b.god] ? 72 : 58);
    } else { panY = nameY + 34; epiY = nameY + ((b.god && GODS[b.god]) ? 60 : 44); }
    // pantheon tag line
    var pan = (b.god && GODS[b.god]) ? GODS[b.god].pantheon : '';
    if (pan) { ctx.fillStyle = sold ? '#3d545c' : b.css; ctx.font = '600 20px Consolas, monospace'; ctx.fillText('· ' + pan + ' ·', x + w / 2, panY); }
    // epithet
    ctx.fillStyle = sold ? '#3d545c' : COL_DIM; ctx.font = 'italic 500 23px Consolas, monospace';
    ctx.fillText(b.epithet, x + w / 2, epiY);
    // ---- §7 three-line contract body: DESC / ▸HOW / ★-LINE (or the LEVEL rail) ----
    var L = cardLines(b), by = epiY + 34;
    ctx.fillStyle = sold ? '#4a6570' : COL_COMMON; ctx.font = '500 25px Consolas, monospace';
    var dl = wrapArr(ctx, L.desc, w - 50);
    for (var _d = 0; _d < dl.length; _d++) { ctx.fillText(dl[_d], x + w / 2, by); by += 31; }
    if (L.how) {
      by += 3; ctx.fillStyle = sold ? '#3d545c' : COL_CYAN; ctx.font = '500 21px Consolas, monospace';
      var hl = wrapArr(ctx, '▸ ' + L.how, w - 44);
      for (var _h = 0; _h < hl.length; _h++) { ctx.fillText(hl[_h], x + w / 2, by); by += 26; }
    }
    var floorY = y + h - (price != null ? 84 : 30);       // the ★-block may not cross into the price zone / card edge
    if (isLevel) {                                        // ★-LINE now→next + the 5-node rail
      by += 8; if (by > floorY - 56) by = floorY - 56;    // clamp: anchor the block above the bottom, never clip
      ctx.fillStyle = sold ? '#7a6a3a' : COL_GOLD; ctx.font = '600 23px Consolas, monospace';
      ctx.fillText(L.star, x + w / 2, by); by += 30;
      drawRail(ctx, x + w / 2, by, b.curMag, b.mag, sold);
    } else if (L.star) {                                  // ★-LINE at current tier (transforms only)
      by += 8; ctx.fillStyle = sold ? '#7a6a3a' : COL_GOLD; ctx.font = '600 22px Consolas, monospace';
      var sl = wrapArr(ctx, L.star, w - 40);
      if (by > floorY - (sl.length - 1) * 26) by = floorY - (sl.length - 1) * 26;   // clamp: never clip the card edge
      for (var _s = 0; _s < sl.length; _s++) { ctx.fillText(sl[_s], x + w / 2, by); by += 26; }
    }
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
    drawScreenArt(ctx, '29-black-market', 0.42, 0.66);
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
      { label: 'REROLL', sub: commas(rerollPrice()) + ' g', sel: Run.shopSel === Run.shopItems.length, act: Run.shopItems.length },
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
    if (st.ultimateGod) extra.push('ULT ' + (ULTS[st.ultimateGod] ? ULTS[st.ultimateGod][0] : GODS[st.ultimateGod].name));
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
    // 1b/1c end keyart — VICTORY / GAME OVER backdrops with a heavy scrim so the
    // tally text stays readable (same treatment as the title backdrop). Dim on absent.
    drawScreenArt(ctx, win ? '1c-victory' : '1b-game-over', 0.55, 0.72);
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

    // ---- arcade run tally: line-by-line reveal, classic stagger, then the
    // final score (which already folded every multiplied gain and persists as HI).
    var tl = st.tally || { waves: 0, wipes: 0, phases: 0, untouched: 0 };
    var rows = [
      ['WAVES CLEARED', '' + (tl.waves | 0)],
      ['GRAZES', '' + (st.graze | 0)],
      ['FORMATION WIPES', '' + (tl.wipes | 0)],
      ['PHASES SEIZED', '' + (tl.phases | 0)],
      ['UNTOUCHED WAVES', '' + (tl.untouched | 0)],
      ['PEAK HUBRIS', 'x' + hubrisMultOf(st.hubris.peak).toFixed(1)]
    ];
    var elapsed = perfNow() - (Run.endT0 || 0);
    var lx = W * 0.30, rx = W * 0.70, ty = H * 0.47;
    ctx.font = '600 28px Consolas, monospace';
    for (var ti = 0; ti < rows.length; ti++) {
      if (elapsed < (ti + 1) * 220) break;   // staggered reveal
      var ry = ty + ti * 30;
      ctx.textAlign = 'left';
      ctx.fillStyle = COL_DIM; ctx.fillText(rows[ti][0], lx, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = ti === rows.length - 1 ? COL_GOLD : COL_COMMON;
      ctx.fillText(rows[ti][1], rx, ry);
    }
    ctx.textAlign = 'center';

    ctx.fillStyle = COL_DIM; ctx.font = '600 30px Consolas, monospace';
    ctx.fillText('SEED  ' + Run.seed.toString(16).toUpperCase(), W / 2, H * 0.56);
    var pulse = 0.5 + 0.5 * Math.sin(perfNow() * 0.005);
    ctx.globalAlpha = 0.5 + 0.5 * pulse; ctx.fillStyle = '#ffffff'; ctx.font = '600 38px Consolas, monospace';
    ctx.fillText(win ? 'Z — DESCEND DEEPER (endless)     Esc — title' : 'Z — retry     Esc — title', W / 2, H * 0.64);
    ctx.globalAlpha = 1;
  }
  function perfNow() { return (typeof performance !== 'undefined') ? performance.now() : Date.now(); }

})();
