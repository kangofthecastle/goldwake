// sfx.js — WebAudio-synthesized sound effects. No audio files.
// Exposes window.SFX. AudioContext is created lazily and resumed on first
// user gesture (autoplay policy). M toggles mute.
//
// AESTHETIC: crisp arcade / retro chip. Everything is short and mid-band with
// punchy envelopes (fast attack, quick decay) — no long tails that smear at
// bullet-hell density. MIX LAW (binding): SFX carry information over the music.
// The score is mid-low and lowpassed ~2.6kHz; SFX own the top/transient band so
// a kill-pop or a graze still reads at a 200-bullet crest. Gain-staging is tuned
// as a set (see per-patch peaks) against master 0.5 so nothing masks gameplay.
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
    lp.frequency.value = 10000;   // keep the arcade top; SFX carry the top band
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
  var shotRR = 0;      // shot round-robin pitch index (avoids a monotone drone)

  // Player shot: fires constantly, so it must be TINY and unobtrusive but
  // satisfying. A short square blip with a small downward chirp; a 3-step
  // round-robin pitch keeps a stream of shots from fusing into one droning tone.
  var SHOT_PITCH = [900, 850, 810];
  SFX.shot = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastShot < 0.028) return;
    lastShot = t;
    var f0 = SHOT_PITCH[shotRR % SHOT_PITCH.length]; shotRR++;
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + 0.05);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.08);
  };

  // light damage tick (enemy took a hit, or special-not-charged nudge): a crisp,
  // quiet mid blip. Short so it never smears under sustained fire.
  SFX.hit = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(720, t + 0.035);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.045, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.06);
  };

  SFX.explosion = function (big) {
    if (!ready || muted) return;
    var t = now();
    var dur = big ? 0.55 : 0.3;
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

  // popcorn kill: a bright zap-pop — the kill-cadence filler. A fast square
  // zap-chirp + a tight bandpassed noise transient (the "pop"). Mid/high so it
  // reads over the music bed; gently anti-stacked so a formation wipe ticks
  // cleanly instead of clipping into a wall.
  SFX.pop = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastPop < 0.022) return;
    lastPop = t;
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1050, t);
    o.frequency.exponentialRampToValueAtTime(360, t + 0.05);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.085);
    // bandpassed noise transient — the burst
    var n = noiseSource(t, 0.035, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.Q.value = 1.1; nf.frequency.setValueAtTime(2400, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.05, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  };

  // midship / elite death: a deep, punchy boom (heavier than SFX.explosion) —
  // lowpassed noise body + a sub thump + a mid crack. Kept short (~0.36s).
  SFX.boom = function () {
    if (!ready || muted) return;
    var t = now();
    var dur = 0.36;
    var n = noiseSource(t, dur, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(2400, t);
    nf.frequency.exponentialRampToValueAtTime(170, t + dur);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.34, t);
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
    o2.type = 'square';
    o2.frequency.setValueAtTime(300, t);
    o2.frequency.exponentialRampToValueAtTime(90, t + 0.1);
    var g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.12, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o2.connect(g2); g2.connect(master);
    o2.start(t); o2.stop(t + 0.16);
  };

  // cancel-to-gold cascade (APOTHEOSIS / boss phase). A rising arcade coin
  // cascade — square blips climbing a bright scale. Note count scales with the
  // number of bullets cancelled (a denser screen sounds like a bigger payday) but
  // is capped at 6 so it stays a short shimmer layered under the whoosh/gong.
  // `n` = bullets cancelled.
  SFX.cancelCascade = function (n) {
    if (!ready || muted) return;
    var t = now();
    var scale = [659.25, 783.99, 987.77, 1174.7, 1567.98, 1975.5];
    var voices = Math.max(2, Math.min(6, Math.round((n || 0) / 12)));
    for (var i = 0; i < voices; i++) {
      var tt = t + i * 0.035;
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(scale[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.05, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.13);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.15);
    }
  };

  // gold pickup: the classic two-note arcade COIN blip (the Jamestown dopamine).
  // A quick low->high square couplet; the base pitch climbs with the combo index
  // so a rapid pickup streak arpeggios upward. Short and bright.
  SFX.gold = function (combo) {
    if (!ready || muted) return;
    var t = now();
    var step = Math.min(combo || 0, 24);
    var lo = 784 * Math.pow(2, step / 32);   // B5-ish, climbs up to ~a 5th over a long streak
    var notes = [lo, lo * 1.5];              // the coin's signature interval (a fifth up)
    for (var i = 0; i < 2; i++) {
      var tt = t + i * 0.05;
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(notes[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(i === 0 ? 0.05 : 0.075, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + (i === 0 ? 0.05 : 0.1));
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.12);
    }
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
    o.frequency.setValueAtTime(2600, t);
    o.frequency.exponentialRampToValueAtTime(3500, t + 0.02);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.02, t);   // a whisper under the mix, up in the top band
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.045);
  };

  // APOTHEOSIS activate: a rising arcade sweep — a fast upward square arpeggio
  // riding a filtered-noise whoosh, with a sub thump. The payday's fanfare.
  SFX.vaunt = function () {
    if (!ready || muted) return;
    var t = now();
    var dur = 0.52;   // kept under the 600ms tail budget (this is not the gong)
    // noise whoosh sweeping up
    var n = noiseSource(t, dur, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.Q.value = 0.8;
    nf.frequency.setValueAtTime(400, t);
    nf.frequency.exponentialRampToValueAtTime(6000, t + 0.34);
    nf.frequency.exponentialRampToValueAtTime(2000, t + dur);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(0.42, t + 0.07);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // rising square arpeggio (the chip fanfare)
    var arp = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var i = 0; i < arp.length; i++) {
      var tt = t + i * 0.04;
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(arp[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.07, tt + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.16);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.18);
    }
    // sub thump
    var s = ctx.createOscillator();
    s.type = 'sine';
    s.frequency.setValueAtTime(120, t);
    s.frequency.exponentialRampToValueAtTime(48, t + 0.34);
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.5, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);
    s.connect(sg); sg.connect(master);
    s.start(t); s.stop(t + 0.48);
  };

  SFX.vauntBonus = function () {
    if (!ready || muted) return;
    var t = now();
    var notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var i = 0; i < notes.length; i++) {
      var tt = t + i * 0.055;
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(notes[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.08, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.22);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.24);
    }
  };

  // player hit (lost a life): a heavy, brief sting — a fast descending square
  // through a closing lowpass, plus the big body boom. Kept under ~0.6s.
  SFX.death = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.4);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.55);
    SFX.explosion(true);
  };

  SFX.special = function () {
    if (!ready || muted) return;
    var t = now();
    // heavy charged discharge: noise whoosh + descending square + sub thump
    var dur = 0.45;
    var n = noiseSource(t, dur, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(5000, t);
    nf.frequency.exponentialRampToValueAtTime(500, t + dur);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.45, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(560, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.28);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.36);
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
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.28);
    // click transient
    var n = noiseSource(t, 0.05, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass'; nf.frequency.setValueAtTime(1400, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.3, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  };

  SFX.crit = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(2600, t);
    o.frequency.exponentialRampToValueAtTime(3900, t + 0.028);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.065);
  };

  // boss phase-transition name-card hit: a chip-flavored "gong" — a stack of
  // detuned square partials ringing down over a low bloom, with a bright noise
  // strike. Lands on the card, distinct from vaunt. Longest patch (~0.9s).
  SFX.bossPhase = function () {
    if (!ready || muted) return;
    var t = now();
    // struck metallic body: detuned square partials ringing down
    var parts = [523.25, 784.0, 1174.7];
    for (var i = 0; i < parts.length; i++) {
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(parts[i] * (1 + 0.006 * i), t);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09 / (i + 1), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9 - i * 0.2);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.95);
    }
    // low bloom under it
    var s = ctx.createOscillator();
    s.type = 'triangle';
    s.frequency.setValueAtTime(130.8, t);
    s.frequency.exponentialRampToValueAtTime(65.4, t + 0.45);
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.5, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    s.connect(sg); sg.connect(master);
    s.start(t); s.stop(t + 0.6);
    // bright transient strike
    var n = noiseSource(t, 0.16, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.Q.value = 1.2; nf.frequency.setValueAtTime(4400, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.18, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  };

  // HUBRIS meter step-up: bright, short two-note rise (a rung climbed).
  SFX.hubrisUp = function () {
    if (!ready || muted) return;
    var t = now();
    var notes = [880, 1318.5];
    for (var i = 0; i < notes.length; i++) {
      var tt = t + i * 0.05;
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(notes[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.07, tt + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.13);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.15);
    }
  };

  // HUBRIS meter drop: dull, short descending blip (a rung lost — no despair).
  SFX.hubrisDrop = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(360, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.13);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(900, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.19);
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
      o.type = 'square';
      o.frequency.setValueAtTime(notes[i], tt);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.08, tt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.18);
      o.connect(g); g.connect(master);
      o.start(tt); o.stop(tt + 0.2);
    }
  };

  // UI confirm / powerup pickup: a rising square sweep (a satisfying "yes").
  SFX.powerup = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(960, t + 0.16);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.24);
  };

})();
