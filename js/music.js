// music.js — procedural WebAudio score for HUBRIS. Exposes window.MUSIC.
//
// AESTHETIC (owner verdict): UPBEAT RETRO CHIP MUSIC. Classic chip palette —
// square/pulse leads, triangle bass, noise-burst drums, thin triangle chord
// stabs. NO continuously-gliding drones anywhere (the old pad stem's three
// forever-sliding oscillators read as a "whirr" that drowned the mix — GONE).
// Every voice articulates: fast attack, quick decay, scheduled per 16th on the
// AudioContext clock. Each sector theme carries an AUTHORED 2-bar lead hook
// (composed note sequence, not a random walk), a driving bassline locked to the
// kick, and a kick/snare/hat groove with fills.
//
// ARCHITECTURE (DANMAKU.md "Music: the level's pulse") is UNCHANGED: layered
// stems (chords / bass / drums+lead) driven by the wave-slot arc via
// setIntensity 0-3; per-sector themes seeded deterministically off the run seed;
// title + per-sector boss themes; boss themes escalate per phase; APOTHEOSIS
// opens the filter (lift) + adds a chip sparkle; pause ducks; shop is a chill
// low-key variant. The score sits mid-low and UNDER the SFX — SFX carry
// information and are never masked. Real-time lookahead scheduling on the
// AudioContext clock (NOT the fixed-step sim).
//
// Shares SFX's AudioContext (SFX.context()) so it unlocks on the same first
// gesture and never spawns a second context. Silent-safe headless: every entry
// point is a no-op until a running context exists, and nothing throws when the
// context is suspended.
(function () {
  'use strict';

  var MUSIC = {};
  window.MUSIC = MUSIC;

  // ---- graph / state --------------------------------------------------------
  var ctx = null;
  var ready = false;
  var muted = false;

  var master = null;   // -> destination; overall level (mix law: modest)
  var duck = null;     // pause duck (1 -> 0.25)
  var lp = null;       // filter for APOTHEOSIS sweep; also keeps score mid-low
  var bus = null;      // stem sum
  // Stem gains. The three stems map to the slot-arc layers:
  //   padGain    = thin triangle CHORD STABS (replaces the old gliding drone)
  //   pulseGain  = triangle BASSLINE (present even at breather level)
  //   crestGain  = DRUMS (kick/snare/hat) + the square LEAD hook
  //   shimmerGain= APOTHEOSIS sparkle
  var padGain = null, pulseGain = null, crestGain = null, shimmerGain = null;

  var MASTER_LEVEL = 0.32;   // binding: music master modest, under SFX

  // pending desired state (applied when ready)
  var wantSeed = 1;
  var wantTheme = 'title';
  var wantIntensity = 1;
  var curTheme = null;       // active theme config
  var curThemeName = '';
  var bossPhase = 0;
  var apoOn = false;

  // scheduler
  var timer = null;
  var LOOKAHEAD = 0.30;      // schedule this far ahead (s)
  var TICK_MS = 90;          // scheduler wakeup
  var stepDur = 0.15;        // seconds per 16th, from bpm
  var nextStepTime = 0;      // ctx time of the next step
  var step = 0;              // absolute 16th counter
  var chordIdx = 0;

  // ---- verify/debug taps (non-API; used only by the headless harness) -------
  var schedCount = 0;        // scheduled voices since debugClear()
  var noteLog = [];          // ordered lead-note midis since debugClear()

  // ---- scales / themes ------------------------------------------------------
  var DORIAN   = [0, 2, 3, 5, 7, 9, 10];
  var PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
  var LYDIAN   = [0, 2, 4, 6, 7, 9, 11];
  var AEOLIAN  = [0, 2, 3, 5, 7, 8, 10];
  var MAJPENT  = [0, 2, 4, 7, 9];

  var R = -1;   // rest, in a melody array

  // Per-sector identity (mode / tempo / timbre matched to pantheon). `melody` is
  // the AUTHORED 2-bar (32 x 16th) lead hook in scale-degree space — a composed
  // sequence, NOT random. Seeded variation only picks octave lifts and bar fills.
  // `intensity` is the theme's BASELINE stem level (re-applied every setTheme so a
  // section can't inherit the prior one's stack). In-combat waves override it
  // per-slot via MUSIC.setIntensity.
  //  title = mid-energy hook (lvl 2) · shop = chill low-key hook (lvl 2, softened)
  //  · boss = full stack (lvl 3).
  var THEMES = {
    title: {
      root: 57, scale: MAJPENT, bpm: 120, bass: 'triangle', lead: 'square',
      cut: 2800, chords: [0, 3, 1, 4], intensity: 2, leadOct: 1, bassOct: -1,
      melody: [0, R, 2, R, 4, R, 2, R,  4, R, 5, R, 4, R, 2, R,   3, R, 2, R, 0, R, 2, R,  4, R, R, R, 2, R, 0, R]
    },
    sector0: {   // TALOS — bronze, driving, hopeful (Dorian)
      root: 45, scale: DORIAN, bpm: 132, bass: 'triangle', lead: 'square',
      cut: 2600, chords: [0, 5, 3, 4], intensity: 1, leadOct: 2, bassOct: 0,
      melody: [0, R, 4, R, 3, R, 4, R,  5, R, 4, R, 2, R, 0, R,   0, R, 3, R, 4, R, 3, R,  2, R, 4, R, 0, R, R, R]
    },
    sector1: {   // AMMIT — Kemet, exotic/dark but upbeat (Phrygian)
      root: 38, scale: PHRYGIAN, bpm: 128, bass: 'triangle', lead: 'square',
      cut: 2200, chords: [0, 1, 5, 0], intensity: 1, leadOct: 2, bassOct: 0,
      melody: [0, R, R, 1, 3, R, 1, R,  0, R, R, R, 5, R, 3, R,   1, R, 0, R, 3, R, 5, R,  3, R, 1, R, 0, R, R, R]
    },
    sector2: {   // SOVEREIGN — gilded, regal, bright (Lydian #4)
      root: 40, scale: LYDIAN, bpm: 138, bass: 'triangle', lead: 'square',
      cut: 3200, chords: [0, 3, 4, 3], intensity: 1, leadOct: 2, bassOct: 0,
      melody: [0, R, 2, R, 4, R, 3, R,  4, R, 6, R, 4, R, 2, R,   0, R, 4, R, 6, R, 4, R,  3, R, 2, R, 0, R, R, R]
    },
    shop: {      // chill low-key chip variant — sparse hook, softened groove
      root: 57, scale: MAJPENT, bpm: 96, bass: 'triangle', lead: 'triangle',
      cut: 2000, chords: [0, 3, 4, 0], intensity: 2, leadOct: 1, bassOct: -1, chill: true,
      melody: [0, R, R, R, 4, R, R, R,  2, R, R, R, R, R, R, R,   3, R, R, R, 2, R, R, R,  0, R, R, R, R, R, R, R]
    },
    boss0: {     // menacing, driving (Aeolian / natural minor)
      root: 45, scale: AEOLIAN, bpm: 144, bass: 'triangle', lead: 'square',
      cut: 2800, chords: [0, 5, 4, 5], boss: true, intensity: 3, leadOct: 2, bassOct: 0,
      melody: [0, R, 0, R, 3, R, 2, R,  0, R, R, 4, 3, R, 2, R,   0, R, 0, R, 5, R, 4, R,  3, R, 2, R, 0, R, R, R]
    },
    boss1: {     // dark, relentless (Phrygian)
      root: 38, scale: PHRYGIAN, bpm: 140, bass: 'triangle', lead: 'square',
      cut: 2400, chords: [0, 1, 0, 5], boss: true, intensity: 3, leadOct: 2, bassOct: 0,
      melody: [0, R, 1, R, 0, R, R, 1,  3, R, 1, R, 0, R, R, R,   5, R, 4, R, 3, R, 1, R,  0, R, 1, R, 0, R, R, R]
    },
    boss2: {     // triumphant, blazing (Lydian)
      root: 40, scale: LYDIAN, bpm: 150, bass: 'triangle', lead: 'square',
      cut: 3400, chords: [0, 4, 3, 4], boss: true, intensity: 3, leadOct: 2, bassOct: 0,
      melody: [0, R, 4, R, 6, R, 4, R,  3, R, 4, R, 6, R, 4, R,   0, R, 4, R, 6, R, 5, R,  4, R, 3, R, 2, R, 0, R]
    }
  };

  // ---- deterministic PRNG (per composition; NOT Math.random) ----------------
  // Uses the shared Engine.mulberry32 (single source; see engine.js) — only ever
  // called at runtime from buildArp, by which point engine.js has parsed. Drives
  // seeded VARIATION (octave lifts / fill choice) around the authored hook, never
  // the hook itself, so the same run always sounds the same.
  var arp = null;

  function themeHash(name) {
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return h;
  }
  function buildArp() {
    var rnd = Engine.mulberry32((wantSeed ^ themeHash(curThemeName)) >>> 0);
    arp = new Array(16);
    for (var i = 0; i < 16; i++) arp[i] = rnd();   // 0..1 seeded variation bits
  }

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function degToMidi(theme, deg, oct) {
    var sc = theme.scale, n = sc.length;
    var idx = Math.floor(deg);
    var o = Math.floor(idx / n) + (oct || 0);      // floor division so negative degrees wrap cleanly
    var d = ((idx % n) + n) % n;                    // never a negative index (would give undefined -> NaN)
    return theme.root + sc[d] + 12 * o;
  }

  // ---- init -----------------------------------------------------------------
  MUSIC.init = function () {
    if (ready) return true;
    if (!window.SFX || !SFX.context) return false;
    var c = SFX.context();       // shares SFX's AudioContext (unlocks together)
    if (!c) return false;
    ctx = c;

    master = ctx.createGain(); master.gain.value = muted ? 0 : MASTER_LEVEL;
    duck = ctx.createGain();   duck.gain.value = 1;
    lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.4;
    bus = ctx.createGain();    bus.gain.value = 1;

    padGain = ctx.createGain();     padGain.gain.value = 0.0001;
    pulseGain = ctx.createGain();   pulseGain.gain.value = 0.0001;
    crestGain = ctx.createGain();   crestGain.gain.value = 0.0001;
    shimmerGain = ctx.createGain(); shimmerGain.gain.value = 0.0001;

    padGain.connect(bus); pulseGain.connect(bus); crestGain.connect(bus); shimmerGain.connect(bus);
    // The score keeps its OWN gain path (bus -> score lowpass -> pause duck -> master):
    // nothing SFX does compresses or ducks it. It terminates into SFX's shared master
    // safety limiter (not raw destination) so the summed program can't hard-clip the DAC
    // during dense hit/coin storms — the fix for the "music sounds compressed" report.
    // Falls back to destination if SFX's bus is unavailable (headless / SFX absent).
    var out = (window.SFX && SFX.masterBus && SFX.masterBus()) || ctx.destination;
    bus.connect(lp); lp.connect(duck); duck.connect(master); master.connect(out);

    // NO persistent oscillators — the score is built entirely from scheduled,
    // enveloped one-shots. Nothing sustains, nothing glides: no whirr.

    ready = true;
    applyTheme(wantTheme, true);
    applyIntensity(wantIntensity, 0.01);
    startScheduler();
    return true;
  };

  // ---- theme / stems --------------------------------------------------------
  function applyTheme(name, immediate) {
    wantTheme = name;
    if (!ready) return;
    var th = THEMES[name] || THEMES.title;
    curTheme = th; curThemeName = name;
    buildArp();
    stepDur = 60 / th.bpm / 4;
    chordIdx = 0;
    var now = ctx.currentTime;
    // filter to timbre brightness (a param ramp on a FILTER, not an oscillator —
    // this is not a drone glide; it just sets the score's mid-low ceiling)
    lp.frequency.cancelScheduledValues(now);
    lp.frequency.setTargetAtTime(apoOn ? 8500 : th.cut, now, immediate ? 0.05 : 0.6);
  }

  MUSIC.setSeed = function (seed) {
    wantSeed = (seed >>> 0) || 1;
    if (ready && curTheme) buildArp();
  };

  MUSIC.setTheme = function (name) {
    if (!THEMES[name]) name = 'title';
    if (name === curThemeName) return;
    bossPhase = 0;
    applyTheme(name, false);
    // The theme carries its own baseline stem level, so a caller can never leak
    // the prior section's intensity (boss 3 -> shop, or a MUSIC.stop()'d score
    // -> title). Combat waves override it afterward via MUSIC.setIntensity.
    var th = THEMES[name];
    MUSIC.setIntensity(th.intensity != null ? th.intensity : 1);
    if (ready) startScheduler();   // idempotent; re-arm if a prior stop left it idle
  };

  // convenience wrappers used by the run flow
  MUSIC.setSector = function (idx) { MUSIC.setTheme('sector' + idx); };
  MUSIC.setBossTheme = function (idx) { MUSIC.setTheme('boss' + idx); };   // boss theme carries intensity 3

  // level 0 breather (chords+bass, NO drums, NO lead) · 1 build (+drums) ·
  // 2 mostly-full (+lead hook) · 3 crest/boss (full + fills + counter-line).
  // Content is gated by level in scheduleStep; these gains crossfade the layers
  // in/out (~1.5s) so slot transitions never hard-cut mid-phrase.
  MUSIC.setIntensity = function (level) {
    wantIntensity = level;
    if (ready) applyIntensity(level, 1.5);
  };
  function applyIntensity(level, tc) {
    if (!ready) return;
    var now = ctx.currentTime;
    var chill = curTheme && curTheme.chill;
    var pad = 0.14;                                    // chord stabs: always present
    var pulse = 0.20;                                  // bass: present even at breather
    var crest = level >= 3 ? 0.19 : level >= 2 ? 0.16 : level >= 1 ? 0.13 : 0.0001;
    if (chill) crest *= 0.7;                           // shop groove sits back
    // Boss theme thickens the ACTIVE fight; at level 0 (breather / post-boss draft
    // freeze) it must still strip out, so the override is gated to level>=1.
    if (curTheme && curTheme.boss && level >= 1) crest = Math.min(0.22, crest + 0.02 + bossPhase * 0.008);
    padGain.gain.setTargetAtTime(Math.max(0.0001, pad), now, tc * 0.5);
    pulseGain.gain.setTargetAtTime(Math.max(0.0001, pulse), now, tc * 0.5);
    crestGain.gain.setTargetAtTime(Math.max(0.0001, crest), now, tc * 0.5);
  }

  // boss theme escalates a lead layer per phase bracket (octave + counter-line);
  // see scheduleStep. Also nudges the crest gain.
  MUSIC.setBossPhase = function (n) {
    bossPhase = n | 0;
    if (ready) applyIntensity(wantIntensity, 1.0);
  };

  // ---- transport hooks ------------------------------------------------------
  MUSIC.duck = function (on) {
    if (!ready) return;
    duck.gain.setTargetAtTime(on ? 0.25 : 1.0, ctx.currentTime, 0.08);   // ~-12dB
  };

  // APOTHEOSIS: open the filter (lift) + a chip sparkle layer for the duration.
  MUSIC.apotheosis = function (on) {
    apoOn = !!on;
    if (!ready) return;
    var now = ctx.currentTime;
    var base = curTheme ? curTheme.cut : 2600;
    lp.frequency.cancelScheduledValues(now);
    lp.frequency.setTargetAtTime(on ? 8500 : base, now, on ? 0.25 : 1.2);
    shimmerGain.gain.setTargetAtTime(on ? 0.06 : 0.0001, now, on ? 0.3 : 0.6);
  };

  MUSIC.setMuted = function (m) {
    muted = !!m;
    if (ready) master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, ctx.currentTime, 0.05);
  };
  MUSIC.isMuted = function () { return muted; };

  // resolve + silence (game over / victory): fade the whole score out.
  MUSIC.stop = function () {
    if (!ready) return;
    var now = ctx.currentTime;
    padGain.gain.setTargetAtTime(0.0001, now, 0.6);
    pulseGain.gain.setTargetAtTime(0.0001, now, 0.4);
    crestGain.gain.setTargetAtTime(0.0001, now, 0.4);
    shimmerGain.gain.setTargetAtTime(0.0001, now, 0.4);
    wantIntensity = 0;
  };

  // Clear per-run TRANSIENT state at a run boundary (start / abandon-to-title /
  // game over / victory) so the next screen never inherits a stuck apotheosis
  // lift, boss shimmer, or pause duck. Idempotent; safe before ready.
  MUSIC.resetTransient = function () {
    apoOn = false;
    bossPhase = 0;
    if (!ready) return;
    var now = ctx.currentTime;
    duck.gain.cancelScheduledValues(now);
    duck.gain.setTargetAtTime(1.0, now, 0.05);              // release any pause duck
    shimmerGain.gain.cancelScheduledValues(now);
    shimmerGain.gain.setTargetAtTime(0.0001, now, 0.2);     // kill apotheosis shimmer
    var base = curTheme ? curTheme.cut : 2600;
    lp.frequency.cancelScheduledValues(now);
    lp.frequency.setTargetAtTime(base, now, 0.2);           // drop the lift filter to the theme cut
  };

  // ---- beat clock getter (optional quantization; not wired into waves) ------
  MUSIC.beat = function () {
    if (!ready) return { bar: 0, beat: 0, step: 0, phase: 0 };
    return { bar: Math.floor(step / 16), beat: Math.floor((step % 16) / 4), step: step % 16, phase: (step % 16) / 16 };
  };

  // debug/verify surface
  MUSIC.state = function () {
    return {
      ready: ready, theme: curThemeName, intensity: wantIntensity, bossPhase: bossPhase,
      apo: apoOn, muted: muted, bpm: curTheme ? curTheme.bpm : 0,
      root: curTheme ? curTheme.root : 0, cut: curTheme ? curTheme.cut : 0,
      pad: ready ? padGain.gain.value : 0, pulse: ready ? pulseGain.gain.value : 0,
      crest: ready ? crestGain.gain.value : 0, shimmer: ready ? shimmerGain.gain.value : 0,
      lp: ready ? lp.frequency.value : 0, duck: ready ? duck.gain.value : 1,
      seed: wantSeed, scheduled: schedCount
    };
  };
  // verify-only note tap (deterministic-composition check).
  MUSIC.debugClear = function () { schedCount = 0; noteLog = []; };
  MUSIC.debugNotes = function () { return noteLog.slice(0); };
  MUSIC.debugCount = function () { return schedCount; };

  // ---- voices (all one-shot, enveloped; nothing sustains or glides) ---------
  // A single enveloped tone. Optional detune (cents) spawns a second osc for
  // chip "width". Frequency is set once (no glide) — the whirr-test invariant.
  function note(type, freq, t, dur, peak, dest, detune) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    var o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.connect(g); o.start(t); o.stop(t + dur + 0.02);
    schedCount++;
    if (detune) {
      var o2 = ctx.createOscillator();
      o2.type = type; o2.frequency.setValueAtTime(freq, t); o2.detune.setValueAtTime(detune, t);
      o2.connect(g); o2.start(t); o2.stop(t + dur + 0.02);
      schedCount++;
    }
  }
  // Kick: short pitched thump. The pitch drop is a PERCUSSION transient (<90ms),
  // not a sustained voice — it is not a drone.
  function kick(t, dest) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.07);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.16);
    schedCount++;
  }
  var noiseBuf = null;
  function noiseData() {
    if (!noiseBuf) {
      var n = Math.floor(ctx.sampleRate * 0.3);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  function snare(t, dest, peak) {
    var s = ctx.createBufferSource(); s.buffer = noiseData();
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1600;
    var g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t); s.stop(t + 0.13);
    schedCount++;
    // a little pitched body for snap
    var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(220, t);
    var og = ctx.createGain(); og.gain.setValueAtTime(peak * 0.4, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.08);
    schedCount++;
  }
  function hat(t, dur, peak, dest) {
    var s = ctx.createBufferSource(); s.buffer = noiseData();
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
    var g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t); s.stop(t + dur + 0.02);
    schedCount++;
  }

  // ---- scheduler (lookahead) ------------------------------------------------
  function startScheduler() {
    if (timer) return;
    nextStepTime = ctx.currentTime + 0.05;
    step = 0;
    timer = setInterval(tick, TICK_MS);
  }
  function tick() {
    if (!ready || !ctx) return;
    if (ctx.state !== 'running') return;      // suspended headless: schedule nothing, no throw
    var cur = ctx.currentTime;
    // Catch-up clamp: while the tab is backgrounded the setInterval throttles to
    // ~1s but the AudioContext clock keeps running, so nextStepTime falls far in
    // the past. Don't fire the whole backlog bunched — drop the missed steps but
    // advance `step` by the same count so the 16-step bar phase stays aligned.
    if (nextStepTime < cur - 0.05) {
      var missed = Math.ceil((cur - nextStepTime) / stepDur);
      step += missed;
      nextStepTime += missed * stepDur;
    }
    var horizon = cur + LOOKAHEAD;
    var guard = 0;
    while (nextStepTime < horizon && guard++ < 64) {
      scheduleStep(step, nextStepTime);
      step++;
      nextStepTime += stepDur;
    }
  }

  // driving-8ths bass rhythm + octave pops (locked to the kick)
  var BASS_OCTPOP = { 6: 1, 14: 1 };

  function scheduleStep(absStep, t) {
    if (!curTheme) return;
    var th = curTheme, sc = th.scale, sn = sc.length;
    var s16 = absStep % 16;
    var bar = Math.floor(absStep / 16);
    if (absStep % 32 === 0) chordIdx = Math.floor(absStep / 32);
    var lvl = wantIntensity;
    var chordDeg = th.chords[chordIdx % th.chords.length];
    var jit = (Math.random() - 0.5) * 0.004;   // humanization only (never notes)
    var swing = (s16 % 2 === 1) ? stepDur * 0.06 : 0;   // subtle, timing-only

    // -- CHORD STABS (pad stem) — thin triangle triad, low gain, articulated. --
    // Breather: one soft chord at the top of the bar. Otherwise short offbeat
    // stabs. This REPLACES the old gliding drone entirely.
    if (lvl <= 0) {
      if (s16 === 0) {
        var cd0 = degToMidi(th, chordDeg, 1), cd1 = degToMidi(th, chordDeg + 2, 1), cd2 = degToMidi(th, chordDeg + 4, 1);
        note('triangle', mtof(cd0), t, stepDur * 6, 0.5, padGain);
        note('triangle', mtof(cd1), t, stepDur * 6, 0.35, padGain);
        note('triangle', mtof(cd2), t, stepDur * 6, 0.28, padGain);
      }
    } else if (s16 % 4 === 2) {   // offbeat stabs
      var e0 = degToMidi(th, chordDeg, 1), e1 = degToMidi(th, chordDeg + 2, 1), e2 = degToMidi(th, chordDeg + 4, 1);
      note('triangle', mtof(e0), t + swing, stepDur * 1.6, 0.5, padGain);
      note('triangle', mtof(e1), t + swing, stepDur * 1.6, 0.34, padGain);
      note('triangle', mtof(e2), t + swing, stepDur * 1.6, 0.28, padGain);
    }

    // -- BASSLINE (pulse stem) — triangle, driving, locked to the kick. --
    // Breather thins to quarter notes; otherwise straight 8ths with octave pops.
    var bassStep = (lvl <= 0) ? (s16 % 4 === 0) : (s16 % 2 === 0);
    if (bassStep) {
      var oct = (lvl > 0 && BASS_OCTPOP[s16]) ? 1 : 0;
      var bmidi = degToMidi(th, chordDeg, th.bassOct) + 12 * oct;
      note(th.bass, mtof(bmidi), t + jit, stepDur * (lvl <= 0 ? 3.2 : 1.7), 0.55, pulseGain);
    }

    // -- DRUMS (crest stem) — level >= 1. --
    if (lvl >= 1) {
      var chill = th.chill;
      // four-on-the-floor at level>=2, half-time kick at level 1
      if (s16 === 0 || s16 === 8 || (lvl >= 2 && (s16 === 4 || s16 === 12))) {
        if (!(chill && (s16 === 4 || s16 === 12))) kick(t, crestGain);
      }
      if (lvl >= 2 && s16 === 6) kick(t, crestGain);   // extra syncopated drive
      // backbeat snare
      if ((s16 === 4 || s16 === 12) && !chill) snare(t, crestGain, 0.5);
      if (chill && s16 === 12) snare(t, crestGain, 0.3);   // shop: rim on the 3
      // hats: offbeat 8ths, 16ths at full
      if (s16 % 4 === 2) hat(t + swing, 0.03, chill ? 0.14 : 0.22, crestGain);
      if (lvl >= 3 && s16 % 2 === 1) hat(t + swing, 0.02, 0.12, crestGain);
      // fill: last bar of an 8-bar phrase — snare roll in the back half
      if ((bar % 8) === 7 && s16 >= 12) snare(t, crestGain, 0.28 + (s16 - 12) * 0.05);
    }

    // -- LEAD HOOK (crest stem) — the authored motif, level >= 2. --
    if (lvl >= 2) {
      var mo = th.melody[absStep % 32];
      if (mo >= 0) {
        // seeded octave lift: on repeats, some notes ring an octave higher
        var lift = (arp[s16] > 0.72 && (chordIdx % 2) === 1) ? 1 : 0;
        var lm = degToMidi(th, mo, th.leadOct + lift);
        note(th.lead, mtof(lm), t + swing, stepDur * 1.3, 0.42, crestGain, th.lead === 'square' ? 6 : 0);
        noteLog.push(lm);
        // boss counter-line: escalates a layer per phase bracket
        if (th.boss && lvl >= 3) {
          if (bossPhase >= 1 && s16 % 8 === 0) note(th.lead, mtof(lm + 12), t + swing, stepDur * 1.1, 0.24, crestGain);
          if (bossPhase >= 2 && s16 % 8 === 4) note(th.lead, mtof(degToMidi(th, mo + 2, th.leadOct)), t + swing, stepDur * 1.1, 0.22, crestGain);
          if (bossPhase >= 3) note(th.lead, mtof(lm + 12), t + swing, stepDur * 0.9, 0.18, crestGain);
        }
      }
    }

    // -- SHIMMER (apotheosis) — high chip sparkle on the 16ths while lifted. --
    if (apoOn && s16 % 2 === 0) {
      var mo2 = th.melody[(absStep + 4) % 32]; if (mo2 < 0) mo2 = chordDeg;
      var sf = degToMidi(th, mo2, th.leadOct + 2);
      note('square', mtof(sf), t + swing, stepDur * 1.1, 0.5, shimmerGain);
    }
  }

})();
