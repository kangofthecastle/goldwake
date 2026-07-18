// sfx.js — WebAudio-synthesized sound effects. No audio files.
// Exposes window.SFX. AudioContext is created lazily and resumed on first
// user gesture (autoplay policy). M toggles mute.
(function () {
  'use strict';

  var SFX = {};
  window.SFX = SFX;

  var ctx = null;
  var master = null;   // master gain -> lowpass -> compressor -> destination
  var lp = null;
  var comp = null;
  var muted = false;
  var ready = false;

  SFX.ensure = function () {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.5;

    lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000;
    lp.Q.value = 0.4;

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    master.connect(lp);
    lp.connect(comp);
    comp.connect(ctx.destination);
    ready = true;
  };

  SFX.resume = function () { if (ctx && ctx.state === 'suspended') ctx.resume(); };

  // Shared AudioContext accessor for MUSIC — ensures the context exists (same
  // lazy/unlock path as SFX) and returns it, so the score never spawns a second
  // context and unlocks on the same first gesture. Null if WebAudio is absent.
  SFX.context = function () { SFX.ensure(); return ctx; };

  SFX.toggleMute = function () {
    muted = !muted;
    if (master) master.gain.value = muted ? 0.0 : 0.5;
    return muted;
  };
  SFX.isMuted = function () { return muted; };

  function now() { return ctx.currentTime; }

  // small noise buffer, reused
  var noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    var n = ctx.sampleRate * 1.0;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function env(gain, t0, a, peak, d, sus, r, dur) {
    var g = gain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
    if (sus != null) {
      g.exponentialRampToValueAtTime(Math.max(0.0001, sus), t0 + a + d);
      g.setValueAtTime(Math.max(0.0001, sus), t0 + dur);
    }
    g.exponentialRampToValueAtTime(0.0001, t0 + dur + r);
  }

  function tone(type, freq, t0, dur, peak, dest) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
    return { o: o, g: g };
  }

  function noiseSource(t0, dur, dest) {
    var s = ctx.createBufferSource();
    s.buffer = noise();
    s.loop = true;
    var g = ctx.createGain();
    s.connect(g);
    g.connect(dest || master);
    s.start(t0);
    s.stop(t0 + dur + 0.02);
    return { s: s, g: g };
  }

  // throttle constantly-fired shot so it never machine-guns the mixer
  var lastShot = 0;
  var lastGraze = 0;   // graze whisper rate-limit (grazing a wall must not machine-gun)
  var lastPop = 0;     // popcorn tick anti-stack (a formation wipe shouldn't clip)

  SFX.shot = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastShot < 0.028) return;
    lastShot = t;
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(560, t + 0.06);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.11);
  };

  SFX.hit = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.04);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.06);
  };

  SFX.explosion = function (big) {
    if (!ready || muted) return;
    var t = now();
    var dur = big ? 0.6 : 0.32;
    // noise burst
    var n = noiseSource(t, dur, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(big ? 2600 : 1800, t);
    nf.frequency.exponentialRampToValueAtTime(200, t + dur);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(big ? 0.5 : 0.28, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // pitch-dropping sine thump
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 220 : 320, t);
    o.frequency.exponentialRampToValueAtTime(big ? 40 : 70, t + dur * 0.9);
    var g = ctx.createGain();
    g.gain.setValueAtTime(big ? 0.5 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  };

  // popcorn kill: a light, bright tick — the kill-cadence filler. Short, mid-band
  // (music sits low; SFX carry the top). Gently anti-stacked so a formation wipe
  // ticks without clipping into a wall of noise.
  SFX.pop = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastPop < 0.022) return;
    lastPop = t;
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(680, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.05);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.09);
    // tiny bandpassed noise transient — the "pop"
    var n = noiseSource(t, 0.035, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.Q.value = 0.9; nf.frequency.setValueAtTime(1900, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.055, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  };

  // midship / elite death: a deep, layered boom (heavier than SFX.explosion) —
  // lowpassed noise body + a sub thump + a mid saw crack. Kept under ~0.4s.
  SFX.boom = function () {
    if (!ready || muted) return;
    var t = now();
    var dur = 0.4;
    var n = noiseSource(t, dur, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(2400, t);
    nf.frequency.exponentialRampToValueAtTime(170, t + dur);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.36, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(46, t + dur * 0.8);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
    var o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(320, t);
    o2.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    var g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.12, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o2.connect(g2); g2.connect(master);
    o2.start(t); o2.stop(t + 0.18);
  };

  // cancel-to-gold cascade (APOTHEOSIS / boss phase). Note count scales with the
  // number of bullets cancelled — a denser screen sounds like a bigger payday —
  // but is capped at 6 so it stays a short golden shimmer layered under the
  // whoosh/gong, not a machine-gun. `n` = bullets cancelled.
  SFX.cancelCascade = function (n) {
    if (!ready || muted) return;
    var t = now();
    var scale = [523.25, 659.25, 783.99, 987.77, 1174.7, 1567.98];
    var voices = Math.max(2, Math.min(6, Math.round((n || 0) / 12)));
    for (var i = 0; i < voices; i++) {
      var tt = t + i * 0.035;
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(scale[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.055, tt + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.15);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.17);
    }
  };

  // gold pickup: rising blip; pitch climbs with combo index
  SFX.gold = function (combo) {
    if (!ready || muted) return;
    var t = now();
    var step = Math.min(combo || 0, 24);
    var base = 620 * Math.pow(2, step / 24); // up to ~1 octave
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.05);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.13);
  };

  // barely-audible whisper tick. Rate-limited to ~8/s: grazing 20 bullets in a
  // wall must not machine-gun the mixer (the throttle returns before scheduling,
  // so the number of scheduled voices — not just the call count — is capped).
  SFX.graze = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastGraze < 0.12) return;   // ~8 grazes/s max
    lastGraze = t;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(3400, t + 0.025);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.022, t);   // quieter than before — a whisper under the mix
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.05);
  };

  SFX.vaunt = function () {
    if (!ready || muted) return;
    var t = now();
    // whoosh: filtered noise sweeping up
    var dur = 0.9;
    var n = noiseSource(t, dur, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.Q.value = 0.8;
    nf.frequency.setValueAtTime(300, t);
    nf.frequency.exponentialRampToValueAtTime(5200, t + 0.5);
    nf.frequency.exponentialRampToValueAtTime(400, t + dur);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(0.5, t + 0.1);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // sub thump
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.5);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.7);
  };

  SFX.vauntBonus = function () {
    if (!ready || muted) return;
    var t = now();
    var notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var i = 0; i < notes.length; i++) {
      var tt = t + i * 0.06;
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(notes[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.09, tt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.28);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.3);
    }
  };

  SFX.death = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.7);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2000, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.7);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.85);
    SFX.explosion(true);
  };

  SFX.special = function () {
    if (!ready || muted) return;
    var t = now();
    // heavy charged discharge: noise whoosh + descending saw + sub thump
    var dur = 0.5;
    var n = noiseSource(t, dur, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(5000, t);
    nf.frequency.exponentialRampToValueAtTime(500, t + dur);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.45, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.3);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.4);
    var sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(48, t + 0.3);
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.55, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    sub.connect(sg); sg.connect(master);
    sub.start(t); sub.stop(t + 0.45);
  };

  SFX.thud = function () {
    if (!ready || muted) return;
    var t = now();
    // deep kinetic bass thud (Thor)
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.3);
    // click transient
    var n = noiseSource(t, 0.05, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass'; nf.frequency.setValueAtTime(1200, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.3, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  };

  SFX.crit = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(3600, t + 0.03);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.07);
  };

  // boss phase-transition name-card hit: a gong-like metallic sting (bright
  // struck partial over a low bloom) — lands on the card, distinct from vaunt.
  SFX.bossPhase = function () {
    if (!ready || muted) return;
    var t = now();
    // struck metallic body: two detuned partials ringing down
    var parts = [523.25, 784.0, 1174.7];
    for (var i = 0; i < parts.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(parts[i] * (1 + 0.004 * i), t);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10 / (i + 1), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 - i * 0.18);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 1.0);
    }
    // low bloom under it
    var s = ctx.createOscillator();
    s.type = 'sine';
    s.frequency.setValueAtTime(130.8, t);
    s.frequency.exponentialRampToValueAtTime(65.4, t + 0.5);
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.5, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    s.connect(sg); sg.connect(master);
    s.start(t); s.stop(t + 0.7);
    // bright transient shimmer
    var n = noiseSource(t, 0.18, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.Q.value = 1.2; nf.frequency.setValueAtTime(4200, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.18, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  };

  // HUBRIS meter step-up: bright, short two-note rise (a rung climbed).
  SFX.hubrisUp = function () {
    if (!ready || muted) return;
    var t = now();
    var notes = [880, 1318.5];
    for (var i = 0; i < notes.length; i++) {
      var tt = t + i * 0.05;
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(notes[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.07, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.14);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.16);
    }
  };

  // HUBRIS meter drop: dull, short descending blip (a rung lost — no despair).
  SFX.hubrisDrop = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(360, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.14);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.2);
  };

  // Named skill event (FORMATION WIPE / UNTOUCHED / PHASE SEIZED): a bright gold
  // sting — a quick rising arpeggio in the vauntBonus family, shorter + tighter.
  SFX.skillEvent = function () {
    if (!ready || muted) return;
    var t = now();
    var notes = [659.25, 987.77, 1318.5];
    for (var i = 0; i < notes.length; i++) {
      var tt = t + i * 0.045;
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(notes[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.08, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.2);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.22);
    }
  };

  SFX.powerup = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.26);
  };

})();
