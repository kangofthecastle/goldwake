// music.js — procedural WebAudio score for HUBRIS. Exposes window.MUSIC.
//
// Doctrine (DANMAKU.md "Music: the level's pulse"): layered stems (pad / pulse /
// crest) driven by the wave-slot arc; per-sector themes matching pantheon
// identity, seeded deterministically off the run seed; title + per-sector boss
// themes; APOTHEOSIS opens a filter/lift; pause ducks; shop is a quiet pad
// variant. The score sits mid-low and UNDER the SFX — SFX carry information and
// are never masked. Real-time scheduling on the AudioContext clock (lookahead),
// NOT the fixed-step sim.
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
  var padGain = null, pulseGain = null, crestGain = null, shimmerGain = null;
  var padOsc = [];     // persistent drone voices

  var MASTER_LEVEL = 0.35;   // binding: music master modest, under SFX

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

  // ---- scales / themes ------------------------------------------------------
  var DORIAN = [0, 2, 3, 5, 7, 9, 10];
  var PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
  var LYDIAN = [0, 2, 4, 6, 7, 9, 11];
  var AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
  var MAJPENT = [0, 2, 4, 7, 9];

  // Per-sector identity (mode / tempo / timbre matched to pantheon):
  //  S1 TALOS  — bronze, processional: Dorian, mid tempo, soft triangles.
  //  S2 AMMIT  — Kemet, dark low reeds: Phrygian, slow, saw-through-lowpass.
  //  S3 SOVEREIGN — gilded, regal: Lydian, brighter/faster, square+triangle.
  // `intensity` is the theme's BASELINE stem level, re-applied every setTheme so a
  // section can't inherit the prior one's stack (boss 3 -> shop, or a stopped
  // score -> title). In-combat waves override it per-slot via MUSIC.setIntensity.
  //  title = pad+pulse (audible menu) · shop = quiet pad only (spec) · boss = full.
  var THEMES = {
    title:   { root: 57, scale: MAJPENT,  bpm: 72,  pad: 'sine',     bass: 'triangle', lead: 'triangle', cut: 2600, bright: 0.55, chords: [0, 4, 3, 4], intensity: 1 },
    sector0: { root: 45, scale: DORIAN,   bpm: 88,  pad: 'triangle', bass: 'sawtooth', lead: 'triangle', cut: 2400, bright: 0.55, chords: [0, 5, 3, 4], intensity: 1 },
    sector1: { root: 38, scale: PHRYGIAN, bpm: 76,  pad: 'sawtooth', bass: 'sawtooth', lead: 'sawtooth', cut: 1400, bright: 0.35, chords: [0, 1, 5, 0], intensity: 1 },
    sector2: { root: 40, scale: LYDIAN,   bpm: 100, pad: 'triangle', bass: 'sawtooth', lead: 'square',   cut: 3000, bright: 0.70, chords: [0, 3, 4, 3], intensity: 1 },
    shop:    { root: 57, scale: MAJPENT,  bpm: 66,  pad: 'sine',     bass: 'triangle', lead: 'triangle', cut: 2000, bright: 0.45, chords: [0, 3, 4, 0], intensity: 0 },
    boss0:   { root: 45, scale: AEOLIAN,  bpm: 100, pad: 'sawtooth', bass: 'sawtooth', lead: 'square',   cut: 2600, bright: 0.55, chords: [0, 5, 4, 5], boss: true, intensity: 3 },
    boss1:   { root: 38, scale: PHRYGIAN, bpm: 92,  pad: 'sawtooth', bass: 'sawtooth', lead: 'sawtooth', cut: 1700, bright: 0.40, chords: [0, 1, 0, 5], boss: true, intensity: 3 },
    boss2:   { root: 40, scale: LYDIAN,   bpm: 116, pad: 'square',   bass: 'sawtooth', lead: 'square',   cut: 3200, bright: 0.75, chords: [0, 4, 3, 4], boss: true, intensity: 3 }
  };

  // ---- deterministic PRNG (per composition; NOT Math.random) ----------------
  // Uses the shared Engine.mulberry32 (single source; see engine.js) — only ever
  // called at runtime from buildArp, by which point engine.js has parsed.
  var arp = null;            // deterministic 16-step degree pattern for the theme

  function themeHash(name) {
    var h = 0; for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return h;
  }
  function buildArp() {
    // Seeded by run seed + theme name so the same run sounds the same. Chooses
    // scale degrees only — it never invents pitch outside the mode.
    var rnd = Engine.mulberry32((wantSeed ^ themeHash(curThemeName)) >>> 0);
    var sc = curTheme.scale, n = sc.length;
    arp = new Array(16);
    for (var i = 0; i < 16; i++) {
      // favor arpeggio-ish motion; occasional rest (-1)
      if (rnd() < 0.18) { arp[i] = -1; continue; }
      arp[i] = (Math.floor(rnd() * n) + (rnd() < 0.4 ? n : 0)); // sometimes up an octave
    }
    // ensure the downbeat states the root
    arp[0] = 0;
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
    lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.5;
    bus = ctx.createGain();    bus.gain.value = 1;

    padGain = ctx.createGain();    padGain.gain.value = 0.0001;
    pulseGain = ctx.createGain();  pulseGain.gain.value = 0.0001;
    crestGain = ctx.createGain();  crestGain.gain.value = 0.0001;
    shimmerGain = ctx.createGain(); shimmerGain.gain.value = 0.0001;

    padGain.connect(bus); pulseGain.connect(bus); crestGain.connect(bus); shimmerGain.connect(bus);
    bus.connect(lp); lp.connect(duck); duck.connect(master); master.connect(ctx.destination);

    // three persistent pad drone voices (root / fifth / octave), gliding on chords
    for (var i = 0; i < 3; i++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 110 * (i + 1);
      var g = ctx.createGain(); g.gain.value = [1, 0.5, 0.32][i];
      o.connect(g); g.connect(padGain);
      try { o.start(); } catch (e) {}
      padOsc.push({ o: o, g: g });
    }

    ready = true;
    applyTheme(wantTheme, true);
    applyIntensity(wantIntensity, 0.01);
    startScheduler();
    return true;
  };

  function safeSet(param, v, t) { try { param.setTargetAtTime(v, t, 0.4); } catch (e) {} }

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
    // pad chord to theme root, filter to timbre brightness
    updatePadChord(now, immediate ? 0.02 : 1.2);
    lp.frequency.cancelScheduledValues(now);
    lp.frequency.setTargetAtTime(apoOn ? 8000 : th.cut, now, immediate ? 0.05 : 0.8);
    // set persistent pad osc timbre
    for (var i = 0; i < padOsc.length; i++) padOsc[i].o.type = th.pad;
  }

  function updatePadChord(now, glide) {
    if (!curTheme) return;
    var deg = curTheme.chords[chordIdx % curTheme.chords.length];
    var voices = [degToMidi(curTheme, deg, 0), degToMidi(curTheme, deg + 4, 0), degToMidi(curTheme, deg, 1)];
    for (var i = 0; i < padOsc.length; i++) {
      var f = mtof(voices[i]);
      padOsc[i].o.frequency.cancelScheduledValues(now);
      padOsc[i].o.frequency.setTargetAtTime(f, now, glide);
    }
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

  // level 0 pad-only (breather) · 1 pad+pulse (opener/build) · 2 mostly-full ·
  // 3 full stack (feature/crescendo/boss). Crossfade the stems (~1.5s).
  MUSIC.setIntensity = function (level) {
    wantIntensity = level;
    if (ready) applyIntensity(level, 1.5);
  };
  function applyIntensity(level, tc) {
    if (!ready) return;
    var now = ctx.currentTime;
    var pad = 0.16;
    var pulse = level >= 1 ? 0.16 : 0.0;
    var crest = level >= 3 ? 0.15 : level >= 2 ? 0.08 : 0.0;
    // Boss theme thickens the ACTIVE fight; at level 0 (breather / post-boss draft
    // freeze) it must still strip to the pad, so the override is gated to level>=1.
    if (curTheme && curTheme.boss && level >= 1) { crest = Math.min(0.2, crest + 0.03 + bossPhase * 0.012); pulse = 0.18; }
    padGain.gain.setTargetAtTime(Math.max(0.0001, pad), now, tc * 0.5);
    pulseGain.gain.setTargetAtTime(Math.max(0.0001, pulse), now, tc * 0.5);
    crestGain.gain.setTargetAtTime(Math.max(0.0001, crest), now, tc * 0.5);
  }

  // boss theme escalates a layer per phase bracket
  MUSIC.setBossPhase = function (n) {
    bossPhase = n | 0;
    if (ready) applyIntensity(wantIntensity, 1.0);
  };

  // ---- transport hooks ------------------------------------------------------
  MUSIC.duck = function (on) {
    if (!ready) return;
    duck.gain.setTargetAtTime(on ? 0.25 : 1.0, ctx.currentTime, 0.08);   // ~-12dB
  };

  // APOTHEOSIS: open the filter (lift) + a shimmer layer for the duration.
  MUSIC.apotheosis = function (on) {
    apoOn = !!on;
    if (!ready) return;
    var now = ctx.currentTime;
    var base = curTheme ? curTheme.cut : 2400;
    lp.frequency.cancelScheduledValues(now);
    lp.frequency.setTargetAtTime(on ? 8500 : base, now, on ? 0.25 : 1.2);
    shimmerGain.gain.setTargetAtTime(on ? 0.05 : 0.0001, now, on ? 0.3 : 0.8);
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
    var base = curTheme ? curTheme.cut : 2400;
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
      crest: ready ? crestGain.gain.value : 0,
      lp: ready ? lp.frequency.value : 0, duck: ready ? duck.gain.value : 1,
      arp0: arp ? arp[0] : null, arpLen: arp ? arp.length : 0
    };
  };

  // ---- voices ---------------------------------------------------------------
  function voice(type, freq, t, dur, peak, dest) {
    var o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function perc(t, freq, dur, peak, dest, type) {
    // short pitched thump for kick; noise-ish via fast pitch drop
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.35, t + dur * 0.8);
    var g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  var hatBuf = null;
  function hat(t, dur, peak, dest) {
    if (!hatBuf) {
      var n = Math.floor(ctx.sampleRate * 0.2);
      hatBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = hatBuf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    var s = ctx.createBufferSource(); s.buffer = hatBuf;
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    var g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t); s.stop(t + dur + 0.02);
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
    // advance `step` by the same count so the 16-step bar phase (chord changes,
    // MUSIC.beat()) stays aligned to real time.
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
  function scheduleStep(absStep, t) {
    if (!curTheme) return;
    var s16 = absStep % 16;
    // chord change every 2 bars (32 steps)
    if (absStep % 32 === 0) { chordIdx = Math.floor(absStep / 32); updatePadChord(t, 1.0); }
    var jit = (Math.random() - 0.5) * 0.006;   // humanization only (never notes)
    var deg = curTheme.chords[chordIdx % curTheme.chords.length];

    // PULSE stem — bassline on the 8th grid.
    if (absStep % 2 === 0) {
      var bd = (s16 % 8 === 0) ? deg : (s16 % 8 === 4 ? deg + 2 : deg + (arp[s16] < 0 ? 0 : arp[s16] % curTheme.scale.length));
      var bf = mtof(degToMidi(curTheme, bd, -1));
      voice(curTheme.bass, bf, t + jit, stepDur * 1.7, 0.5, pulseGain);
    }

    // CREST stem — kick/hat + a lead arp on 16ths.
    // kick on beats 0 & 2, backbeat hat on offbeats
    if (s16 % 8 === 0) perc(t, 120, 0.16, 0.9, crestGain, 'sine');
    if (s16 % 4 === 2) hat(t, 0.05, 0.35, crestGain);
    if (s16 % 2 === 1) hat(t + jit, 0.03, 0.18, crestGain);
    var a = arp[s16];
    if (a >= 0) {
      var lf = mtof(degToMidi(curTheme, deg + a, 1));
      voice(curTheme.lead, lf, t + jit, stepDur * 1.4, 0.4, crestGain);
    }

    // SHIMMER (apotheosis) — high sparkle on the 16ths while lifted.
    if (apoOn && s16 % 2 === 0) {
      var sa = arp[(s16 + 3) % 16]; if (sa < 0) sa = 0;   // rests aren't a pitch
      var sf = mtof(degToMidi(curTheme, deg + sa, 2));
      voice('triangle', sf, t + jit, stepDur * 1.2, 0.5, shimmerGain);
    }
  }

})();
