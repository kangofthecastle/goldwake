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

  SFX.graze = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2000, t);
    o.frequency.exponentialRampToValueAtTime(3200, t + 0.03);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.06);
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
