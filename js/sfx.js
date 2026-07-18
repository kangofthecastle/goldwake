// sfx.js — WebAudio-synthesized sound effects. No audio files.
// Exposes window.SFX. AudioContext is created lazily and resumed on first
// user gesture (autoplay policy). M toggles mute.
//
// AESTHETIC: crisp arcade / retro chip, but PRODUCTION-GRADE — not thin blips.
// Every meaningful sound is LAYERED (a fast transient the ear keys on + a tonal
// body + a sub and/or shaped noise tail), impact sounds PITCH-SWEEP down, filters
// move WITH the amplitude envelope for snap, and the impact family shares a tanh
// SATURATOR + a tiny procedural REVERB send so the heavy hits glue and sit in a
// room. The rich patches (boom / big death / gong / vaunt / death) are RENDERED
// ONCE at unlock into AudioBuffers via OfflineAudioContext — playback is then a
// cheap buffer source with per-play playbackRate variation (free variation, zero
// runtime synth cost); a live-synth fallback covers the window before they exist.
//
// MIX LAW (binding): SFX carry information over the music. The score is mid-low
// and lowpassed ~2.6kHz; SFX own the top/transient band so a kill-pop or a graze
// still reads at a 200-bullet crest. Gain-staging is tuned as a set against
// master 0.5 — this round changes TIMBRE at the round-1 peaks, not loudness.
// Constant sounds (shot, graze, and the kill-filler) are EXCLUDED from the reverb
// send so density stays dry and legible. No long tails (<=600ms except the gong
// and big death, <=1.2s).
(function () {
  'use strict';

  var SFX = {};
  window.SFX = SFX;

  var ctx = null;
  var master = null;   // master gain -> lowpass -> compressor -> destination
  var lp = null;
  var comp = null;
  var reverb = null;   // shared procedural room (convolver) -> reverbRet -> master
  var muted = false;
  var ready = false;

  // shared tanh saturation curve (context-independent Float32Array; one alloc).
  // A gentle drive fattens the impact family and soft-clips summed layers so a
  // boom/death never digitally clips even when three heavy layers stack.
  var CURVE = (function () {
    var n = 1024, c = new Float32Array(n), k = 2.0;
    for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x); }
    return c;
  })();

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

    // procedural room: a short exponentially-decaying stereo noise IR as a
    // low-mix send bus (subtle — the return sits well under the dry hits).
    try {
      var len = Math.floor(ctx.sampleRate * 0.22);
      var ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = ir.getChannelData(ch);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
      }
      reverb = ctx.createConvolver();
      reverb.buffer = ir;
      var ret = ctx.createGain();
      ret.gain.value = 0.9;   // return trim; per-sound send does the real scaling
      reverb.connect(ret); ret.connect(master);
    } catch (e) { reverb = null; }

    ready = true;
    renderAll();   // async offline render of the rich patches (non-blocking)
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

  // ---- shared helpers -------------------------------------------------------

  // small noise buffer for the LIVE context, reused (no per-play alloc).
  var noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = makeNoise(ctx, 1.0);
    return noiseBuf;
  }
  function makeNoise(c, dur) {
    var n = Math.floor(c.sampleRate * dur);
    var b = c.createBuffer(1, n, c.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // a looping noise voice in the live context.
  function noiseVoice(t, dur, dest) {
    var s = ctx.createBufferSource();
    s.buffer = noise();
    s.loop = true;
    var g = ctx.createGain();
    s.connect(g); g.connect(dest || master);
    s.start(t); s.stop(t + dur + 0.02);
    return { s: s, g: g };
  }
  // a per-context tanh saturator node.
  function sat(c) {
    var w = c.createWaveShaper();
    w.curve = CURVE; w.oversample = '2x';
    return w;
  }
  // a live routing hub: dry -> master, plus an optional reverb send tap. Live
  // impacts and buffered playback both feed one of these so the room send is
  // applied identically. Returns the node layers/buffers connect INTO.
  function hub(reverbSend) {
    var h = ctx.createGain(); h.gain.value = 1;
    h.connect(master);
    if (reverbSend && reverb) {
      var s = ctx.createGain(); s.gain.value = reverbSend;
      h.connect(s); s.connect(reverb);
    }
    return h;
  }

  // A proper arcade COIN voice: square fundamental + one-octave harmonic, a tiny
  // pitch-up flick at note onset, fast decay. Used by gold, cancelCascade and the
  // gold-sting fanfares so every "coin" in the game is the same lovely object.
  function coin(freq, t, peak, dest) {
    var o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(freq * 0.94, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.012);   // flick up
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.13);
    var h = ctx.createOscillator(); h.type = 'square';
    h.frequency.setValueAtTime(freq * 2 * 0.94, t);
    h.frequency.exponentialRampToValueAtTime(freq * 2, t + 0.012);
    var hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.exponentialRampToValueAtTime(peak * 0.4, t + 0.005);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    h.connect(hg); hg.connect(dest);
    h.start(t); h.stop(t + 0.09);
  }

  // ---- context-agnostic builders for the RICH patches -----------------------
  // Each schedules its layers on context `c` into `dest` starting at time `t`,
  // routed through a per-context saturator. `nb` is a noise buffer for `c`. The
  // SAME builder serves the OfflineAudioContext render (into a buffer) and the
  // live-synth fallback (into a live hub), so the two can never drift.

  function buildBoom(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.42;
    // kick-style sub 150 -> 40Hz (the chest thump)
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(150, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.55, t + 0.006);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    // mid tonal knock (the "hull" pitch identity)
    var kn = c.createOscillator(); kn.type = 'triangle';
    kn.frequency.setValueAtTime(300, t);
    kn.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    var kg = c.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.2, t + 0.004);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    kn.connect(kg); kg.connect(out); kn.start(t); kn.stop(t + 0.15);
    // shaped noise crack — lowpass sweeping down with the envelope
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(3000, t);
    nf.frequency.exponentialRampToValueAtTime(180, t + dur);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.34, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.02);
  }

  function buildExplosionBig(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.62;
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(220, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + dur * 0.85);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.5, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    var kn = c.createOscillator(); kn.type = 'triangle';
    kn.frequency.setValueAtTime(320, t);
    kn.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    var kg = c.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.2, t + 0.004);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    kn.connect(kg); kg.connect(out); kn.start(t); kn.stop(t + 0.16);
    // long noise tail with a downward filter sweep
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(2600, t);
    nf.frequency.exponentialRampToValueAtTime(200, t + dur);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.02);
    // descending debris pings
    var deb = [900, 650, 470];
    for (var i = 0; i < deb.length; i++) {
      var dt = t + 0.08 + i * 0.09;
      var o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(deb[i], dt);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, dt);
      g.gain.exponentialRampToValueAtTime(0.055, dt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, dt + 0.06);
      o.connect(g); g.connect(out); o.start(dt); o.stop(dt + 0.08);
    }
  }

  function buildDeath(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    // fast descending sting through a closing lowpass (the "you got hit" read)
    var o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.4);
    var f = c.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    var g = c.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.52);
    // heavy body: sub knock + noise burst (a boom under the sting)
    var dur = 0.6;
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(150, t);
    sub.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(2600, t);
    nf.frequency.exponentialRampToValueAtTime(180, t + dur);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.02);
  }

  function buildVaunt(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.52;   // under the 600ms tail budget (this is not the gong)
    // noise whoosh sweeping up then settling — the riser
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.8;
    nf.frequency.setValueAtTime(400, t);
    nf.frequency.exponentialRampToValueAtTime(6000, t + 0.34);
    nf.frequency.exponentialRampToValueAtTime(2000, t + dur);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.42, t + 0.07);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.02);
    // rising square arpeggio through an opening lowpass (the chip fanfare)
    var arp = [392, 523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var i = 0; i < arp.length; i++) {
      var tt = t + i * 0.04;
      var o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(arp[i], tt);
      var af = c.createBiquadFilter(); af.type = 'lowpass';
      af.frequency.setValueAtTime(1200 + i * 900, tt); af.Q.value = 0.7;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.07, tt + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.16);
      o.connect(af); af.connect(g); g.connect(out); o.start(tt); o.stop(tt + 0.18);
    }
    // sub thump under the lift
    var s = c.createOscillator(); s.type = 'sine';
    s.frequency.setValueAtTime(120, t);
    s.frequency.exponentialRampToValueAtTime(48, t + 0.34);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.5, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);
    s.connect(sg); sg.connect(out); s.start(t); s.stop(t + 0.48);
  }

  function buildBossPhase(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    // struck INHARMONIC partial stack (chip-flavored gong): detuned squares at
    // 1x / 2.4x / 3.9x ringing down over a long shaped decay.
    var base = 277.18;
    var mult = [1, 2.4, 3.9];
    for (var i = 0; i < mult.length; i++) {
      var o = c.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(base * mult[i] * (1 + 0.006 * i), t);
      var g = c.createGain();
      var decay = 1.15 - i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09 / (i + 1), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + decay + 0.03);
    }
    // low bloom under it
    var s = c.createOscillator(); s.type = 'triangle';
    s.frequency.setValueAtTime(130.8, t);
    s.frequency.exponentialRampToValueAtTime(65.4, t + 0.45);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.5, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    s.connect(sg); sg.connect(out); s.start(t); s.stop(t + 0.6);
    // bright transient strike (the mallet contact)
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.2;
    nf.frequency.setValueAtTime(4400, t);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + 0.18);
  }

  // ---- offline render orchestration -----------------------------------------
  // Rendered lazily at unlock (ensure). Each render is faster-than-realtime and
  // runs concurrently; playback then costs only a buffer source + a couple gains.
  var bufs = {};        // name -> AudioBuffer
  var bufPeak = {};     // name -> abs peak (verify/report)
  var lastRate = {};    // name -> last playbackRate used (verify: variation)
  var rendered = false; // guard so we only render once
  var renderMs = 0;     // wall time until the last buffer resolved
  var renderCount = 0;  // how many resolved

  var RICH = [
    { name: 'boom',         dur: 0.5,  build: buildBoom },
    { name: 'explosionBig', dur: 0.75, build: buildExplosionBig },
    { name: 'death',        dur: 0.85, build: buildDeath },
    { name: 'vaunt',        dur: 0.6,  build: buildVaunt },
    { name: 'bossPhase',    dur: 1.2,  build: buildBossPhase }
  ];

  function tnow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function renderAll() {
    if (rendered || !ctx) return;
    rendered = true;
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return;   // no offline render: live fallback covers every patch
    var sr = ctx.sampleRate;
    var t0 = tnow();
    var pending = RICH.length;
    RICH.forEach(function (job) {
      try {
        var len = Math.ceil(sr * job.dur);
        var oc = new OAC(1, len, sr);
        var nb = makeNoise(oc, 1.0);
        job.build(oc, oc.destination, 0, nb);
        var p = oc.startRendering();
        if (p && p.then) {
          p.then(function (buf) {
            bufs[job.name] = buf;
            bufPeak[job.name] = peakOf(buf);
            renderCount++;
            if (--pending === 0) renderMs = tnow() - t0;
          }, function () { if (--pending === 0) renderMs = tnow() - t0; });
        } else {
          // legacy callback form
          oc.oncomplete = function (e) {
            bufs[job.name] = e.renderedBuffer;
            bufPeak[job.name] = peakOf(e.renderedBuffer);
            renderCount++;
            if (--pending === 0) renderMs = tnow() - t0;
          };
        }
      } catch (e) { if (--pending === 0) renderMs = tnow() - t0; }
    });
  }

  function peakOf(buf) {
    var d = buf.getChannelData(0), m = 0;
    for (var i = 0; i < d.length; i++) { var a = d[i] < 0 ? -d[i] : d[i]; if (a > m) m = a; }
    return m;
  }

  // Play a rich patch: buffered source (with rate variation) if rendered, else
  // the live-synth builder. Both route through a hub carrying the reverb send.
  function playRich(name, build, rateVar, reverbSend) {
    if (!ready || muted) return;
    var t = now();
    var h = hub(reverbSend);
    var buf = bufs[name];
    if (buf) {
      var s = ctx.createBufferSource();
      s.buffer = buf;
      var rate = 1 + (Math.random() * 2 - 1) * rateVar;
      s.playbackRate.value = rate;
      lastRate[name] = rate;
      s.connect(h); s.start(t);
    } else {
      lastRate[name] = 1;
      build(ctx, h, t, noise());
    }
  }

  // throttle constantly-fired sounds so they never machine-gun the mixer
  var lastShot = 0;
  var lastGraze = 0;   // graze whisper rate-limit (grazing a wall must not machine-gun)
  var lastPop = 0;     // popcorn tick anti-stack (a formation wipe shouldn't clip)
  var shotRR = 0;      // shot round-robin pitch index (avoids a monotone drone)

  // ---- patches --------------------------------------------------------------

  // Player shot: fires constantly, so it must be TINY and unobtrusive but
  // satisfying. LAYERS: a 3ms lowpassed noise TICK (the "p" of the pew) under a
  // short square blip with a downward chirp (the "ew"). A 3-step round-robin
  // pitch + tiny per-shot jitter keeps a stream from fusing into a droning tone.
  // Excluded from the reverb send (constant sound → stays dry).
  var SHOT_PITCH = [900, 850, 810];
  SFX.shot = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastShot < 0.028) return;
    lastShot = t;
    var f0 = SHOT_PITCH[shotRR % SHOT_PITCH.length] * (1 + (Math.random() - 0.5) * 0.04); shotRR++;
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
    // noise tick transient (the attack click)
    var n = noiseVoice(t, 0.006, null);
    var tf = ctx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.setValueAtTime(3200, t);
    n.s.disconnect(); n.s.connect(tf); tf.connect(n.g);
    n.g.gain.setValueAtTime(0.03, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);
  };

  // light damage tick (enemy took a hit, or special-not-charged nudge): a crisp,
  // quiet mid blip with a hair of noise attack. Short so it never smears.
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
    var n = noiseVoice(t, 0.005, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(2000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.02, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);
  };

  // generic explosion. big=true is the RICH buffered big-death boom; the small
  // one (normal kill) stays a light live one-shot: sub thump + lowpassed noise
  // burst with a downward filter sweep. Both excluded from heavy reverb (small)
  // / subtly sent (big).
  SFX.explosion = function (big) {
    if (!ready || muted) return;
    if (big) { playRich('explosionBig', buildExplosionBig, 0.05, 0.12); return; }
    var t = now();
    var dur = 0.3;
    var n = noiseVoice(t, dur, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(1800, t);
    nf.frequency.exponentialRampToValueAtTime(200, t + dur);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.28, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(70, t + dur * 0.9);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  };

  // popcorn kill: a bright zap-pop — the kill-cadence filler. LAYERS: a tight
  // bandpassed noise BURST that sweeps down over 60ms (the "pop") + a fast square
  // zap-chirp (the "zap"). Mid/high so it reads over the music bed; anti-stacked
  // and DRY (excluded from reverb) so a formation wipe ticks cleanly.
  SFX.pop = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastPop < 0.022) return;
    lastPop = t;
    var o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1050 * (1 + (Math.random() - 0.5) * 0.05), t);
    o.frequency.exponentialRampToValueAtTime(360, t + 0.05);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.085);
    // bandpassed noise burst — sweeps down over ~60ms for the satisfying "pop"
    var n = noiseVoice(t, 0.06, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.Q.value = 1.4;
    nf.frequency.setValueAtTime(2600, t);
    nf.frequency.exponentialRampToValueAtTime(900, t + 0.06);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.05, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  };

  // midship / elite death: a deep, punchy chest-hit boom (heavier than the small
  // explosion). RICH buffered (kick sub 150→40 + mid knock + saturated noise
  // crack), rate-varied per play, subtle reverb send. ~0.42s.
  SFX.boom = function () {
    playRich('boom', buildBoom, 0.06, 0.1);
  };

  // cancel-to-gold cascade (APOTHEOSIS / boss phase). A rising arcade COIN
  // cascade — proper coin voices climbing a bright scale. Note count scales with
  // the number of bullets cancelled (a denser screen sounds like a bigger payday)
  // but is capped at 6 so it stays a short shimmer under the whoosh/gong.
  // `n` = bullets cancelled.
  SFX.cancelCascade = function (n) {
    if (!ready || muted) return;
    var t = now();
    var scale = [659.25, 783.99, 987.77, 1174.7, 1567.98, 1975.5];
    var voices = Math.max(2, Math.min(6, Math.round((n || 0) / 12)));
    for (var i = 0; i < voices; i++) {
      coin(scale[i], t + i * 0.035, 0.045, master);
    }
  };

  // gold pickup: the classic two-note arcade COIN blip (the Jamestown dopamine).
  // Two proper coin voices a fifth apart; the base pitch climbs with the combo
  // index so a rapid pickup streak arpeggios upward. Fires constantly — kept
  // lovely and DRY (no reverb) so a gold vacuum doesn't wash out.
  SFX.gold = function (combo) {
    if (!ready || muted) return;
    var t = now();
    var step = Math.min(combo || 0, 24);
    var lo = 784 * Math.pow(2, step / 32);   // climbs up to ~a 5th over a long streak
    coin(lo, t, 0.045, master);
    coin(lo * 1.5, t + 0.05, 0.065, master);
  };

  // barely-audible whisper tick. Rate-limited to ~8/s. A filtered-noise "tss"
  // reads better than a tone at whisper volume — a bandpassed noise flick in the
  // top band. The throttle returns before scheduling, so the number of scheduled
  // voices (not just the call count) is capped.
  SFX.graze = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastGraze < 0.12) return;   // ~8 grazes/s max
    lastGraze = t;
    var n = noiseVoice(t, 0.035, null);
    var nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.Q.value = 2.2;
    nf.frequency.setValueAtTime(4200, t);
    nf.frequency.exponentialRampToValueAtTime(5200, t + 0.02);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.028, t);   // a whisper under the mix, up in the top band
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  };

  // APOTHEOSIS activate: the payday's fanfare — RICH buffered rising sweep
  // (noise riser + square arp through an opening filter + sub thump), rate-varied,
  // subtle reverb send. ~0.52s.
  SFX.vaunt = function () {
    playRich('vaunt', buildVaunt, 0.03, 0.08);
  };

  SFX.vauntBonus = function () {
    if (!ready || muted) return;
    var t = now();
    var notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (var i = 0; i < notes.length; i++) {
      coin(notes[i], t + i * 0.055, 0.06, master);
    }
  };

  // player hit (lost a life): the heavy sting. RICH buffered (descending saw
  // through a closing lowpass + sub knock + saturated noise body), rate-varied,
  // reverb send. The "you got hit" read must cut through everything. ~0.6s.
  SFX.death = function () {
    playRich('death', buildDeath, 0.04, 0.12);
  };

  SFX.special = function () {
    if (!ready || muted) return;
    var t = now();
    var h = hub(0.08);
    var out = sat(ctx); out.connect(h);
    // heavy charged discharge: noise whoosh + descending square + sub thump
    var dur = 0.45;
    var n = noiseVoice(t, dur, out);
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
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.36);
    var sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(48, t + 0.3);
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.55, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    sub.connect(sg); sg.connect(out);
    sub.start(t); sub.stop(t + 0.45);
  };

  // deep kinetic bass thud (Thor): a hard sub knock + a dull noise slap + a
  // click transient, glued through the saturator, subtle reverb send.
  SFX.thud = function () {
    if (!ready || muted) return;
    var t = now();
    var h = hub(0.08);
    var out = sat(ctx); out.connect(h);
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.28);
    // dull noise slap (the body impact)
    var ns = noiseVoice(t, 0.09, out);
    var sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.setValueAtTime(700, t);
    ns.s.disconnect(); ns.s.connect(sf); sf.connect(ns.g);
    ns.g.gain.setValueAtTime(0.28, t);
    ns.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    // click transient
    var n = noiseVoice(t, 0.05, out);
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
    // top-band noise sparkle for the "shing"
    var n = noiseVoice(t, 0.03, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(6000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.03, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  };

  // boss phase-transition name-card hit: a chip-flavored "gong" — RICH buffered
  // INHARMONIC partial stack (detuned squares at 1x/2.4x/3.9x) ringing down over
  // a low bloom with a bright noise strike, rate-varied, reverb send. The longest
  // patch (~1.15s). Lands on the card, distinct from vaunt.
  SFX.bossPhase = function () {
    playRich('bossPhase', buildBossPhase, 0.04, 0.14);
  };

  // HUBRIS meter step-up: bright, short two-note rise (a rung climbed) with a
  // noise tick on the first note.
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
    var n = noiseVoice(t, 0.008, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(3000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.025, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);
  };

  // HUBRIS meter drop: dull, short descending blip (a rung lost — no despair),
  // with a soft lowpassed noise body under it.
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
    var n = noiseVoice(t, 0.06, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.setValueAtTime(600, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.04, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  };

  // Named skill event (FORMATION WIPE / UNTOUCHED / PHASE SEIZED): a bright gold
  // sting — a quick rising COIN arpeggio, tighter than vauntBonus.
  SFX.skillEvent = function () {
    if (!ready || muted) return;
    var t = now();
    var notes = [659.25, 987.77, 1318.5];
    for (var i = 0; i < notes.length; i++) {
      coin(notes[i], t + i * 0.045, 0.07, master);
    }
  };

  // UI confirm / powerup pickup: a rising square sweep (a satisfying "yes") with
  // an octave harmonic shimmer + a soft noise tick attack.
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
    // octave-up harmonic shimmer
    var h = ctx.createOscillator();
    h.type = 'square';
    h.frequency.setValueAtTime(640, t);
    h.frequency.exponentialRampToValueAtTime(1920, t + 0.16);
    var hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t);
    hg.gain.exponentialRampToValueAtTime(0.03, t + 0.02);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    h.connect(hg); hg.connect(master);
    h.start(t); h.stop(t + 0.22);
    var n = noiseVoice(t, 0.008, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(2500, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.02, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);
  };

  // ---- dev helper: audition -------------------------------------------------
  // SFX.audition()      -> plays every patch in sequence ~0.5s apart, console.log
  //                        the name as each fires (owner auditions from console).
  // SFX.audition(name)  -> plays just that patch once.
  // Zero cost unless called.
  var AUDITION = [
    ['shot',         function () { SFX.shot(); }],
    ['hit',          function () { SFX.hit(); }],
    ['pop',          function () { SFX.pop(); }],
    ['crit',         function () { SFX.crit(); }],
    ['graze',        function () { SFX.graze(); }],
    ['gold',         function () { SFX.gold(0); }],
    ['gold(combo)',  function () { SFX.gold(20); }],
    ['explosion',    function () { SFX.explosion(false); }],
    ['explosionBig', function () { SFX.explosion(true); }],
    ['boom',         function () { SFX.boom(); }],
    ['thud',         function () { SFX.thud(); }],
    ['special',      function () { SFX.special(); }],
    ['cancelCascade', function () { SFX.cancelCascade(60); }],
    ['skillEvent',   function () { SFX.skillEvent(); }],
    ['hubrisUp',     function () { SFX.hubrisUp(); }],
    ['hubrisDrop',   function () { SFX.hubrisDrop(); }],
    ['powerup',      function () { SFX.powerup(); }],
    ['vauntBonus',   function () { SFX.vauntBonus(); }],
    ['vaunt',        function () { SFX.vaunt(); }],
    ['bossPhase',    function () { SFX.bossPhase(); }],
    ['death',        function () { SFX.death(); }]
  ];
  SFX.audition = function (name) {
    SFX.ensure(); SFX.resume();
    if (name) {
      for (var i = 0; i < AUDITION.length; i++) {
        if (AUDITION[i][0] === name) {
          if (window.console) console.log('[SFX.audition] ' + name);
          AUDITION[i][1]();
          return true;
        }
      }
      if (window.console) console.log('[SFX.audition] unknown patch: ' + name +
        ' — try one of: ' + AUDITION.map(function (a) { return a[0]; }).join(', '));
      return false;
    }
    var k = 0;
    (function step() {
      if (k >= AUDITION.length) return;
      var it = AUDITION[k++];
      if (window.console) console.log('[SFX.audition] ' + it[0]);
      it[1]();
      setTimeout(step, 500);
    })();
    return true;
  };

  // ---- verify / debug surface (non-gameplay) --------------------------------
  // Reports the boot-render inventory, timings, buffer peaks, and the last
  // playbackRate used per rich patch (variation check). Zero cost unless called.
  SFX.renderInfo = function () {
    var list = [];
    for (var i = 0; i < RICH.length; i++) {
      var nm = RICH[i].name;
      list.push({
        name: nm,
        ready: !!bufs[nm],
        duration: bufs[nm] ? bufs[nm].duration : 0,
        peak: bufPeak[nm] != null ? bufPeak[nm] : 0,
        lastRate: lastRate[nm] != null ? lastRate[nm] : 0
      });
    }
    return {
      started: rendered,
      count: renderCount,
      total: RICH.length,
      renderMs: renderMs,
      buffers: list
    };
  };

})();
