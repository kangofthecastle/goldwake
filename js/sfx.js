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
  var killBus = null;  // shared DRY tanh saturator for the kill family (pop/small
                       // explosion) -> killTrim -> master. Rapid pops SUM through
                       // one saturator so a formation wipe soft-clips into a
                       // drum-roll crackle instead of digitally clipping to mush.
  var muted = false;
  var ready = false;

  // Kill-sound STYLE, switchable live via SFX.setKillStyle('A'|'B'|'C'). Defines
  // the whole kill family (pop / small explosion / boom / big-death) coherently.
  //   A "arcade crunch" (default) — dense noise burst + sub tick + click, saturated
  //   B "firework"                — noise crack + a spray of descending debris pings
  //   C "meaty thump"             — rounder bandpassed knock ~700Hz, minimal top end
  var killStyle = 'A';
  var lastPopRate = 0;   // last per-play pitch/rate factor used by a pop (verify)

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

    // shared dry saturation bus for the kill family. killBus (tanh, small-signal
    // gain ~2) -> killTrim 0.5 (so a single pop is level-identical to the old dry
    // path) -> master. The saturator only bites once several pops STACK, gluing
    // the sum. Dry (no reverb send) so chain-kill density stays legible.
    killBus = ctx.createWaveShaper();
    killBus.curve = CURVE; killBus.oversample = '2x';
    var killTrim = ctx.createGain(); killTrim.gain.value = 0.5;
    killBus.connect(killTrim); killTrim.connect(master);

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

  // midship boom = the kill family's heavy tier: the popcorn DNA scaled up, so it
  // reads as "the same explosion, bigger". Dispatched on killStyle; each variant
  // is rendered to a buffer at boot (re-rendered on a live style switch) and also
  // serves as its own live fallback. All keep the boom's reverb send + weight and
  // sit under the 600ms tail budget.
  function buildBoom(c, dest, t, nb) {
    if (killStyle === 'B') return buildBoomB(c, dest, t, nb);
    if (killStyle === 'C') return buildBoomC(c, dest, t, nb);
    return buildBoomA(c, dest, t, nb);
  }

  // A "arcade crunch": big sub + a 2ms click + a dense noise burst that a lowpass
  // rakes 5000->250Hz, mid knock, driven hard into the saturator (crunchy).
  function buildBoomA(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.4;
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(160, t);
    sub.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.6, t + 0.006);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    // click transient (the crunch attack)
    var cs = c.createBufferSource(); cs.buffer = nb; cs.loop = true;
    var cf = c.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.setValueAtTime(3000, t);
    var cg = c.createGain();
    cg.gain.setValueAtTime(0.4, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.007);
    cs.connect(cf); cf.connect(cg); cg.connect(out); cs.start(t); cs.stop(t + 0.02);
    // dense crunchy noise burst, lowpass raked down
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.Q.value = 0.7;
    nf.frequency.setValueAtTime(5000, t);
    nf.frequency.exponentialRampToValueAtTime(250, t + dur * 0.8);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.46, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.02);
    // mid knock (hull pitch identity)
    var kn = c.createOscillator(); kn.type = 'triangle';
    kn.frequency.setValueAtTime(300, t);
    kn.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    var kg = c.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    kn.connect(kg); kg.connect(out); kn.start(t); kn.stop(t + 0.15);
  }

  // B "firework": a deeper bandpassed crack + a shower of descending debris pings
  // over a sub.
  function buildBoomB(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.42;
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(150, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.55, t + 0.006);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    // deep crack
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.9;
    nf.frequency.setValueAtTime(1900, t);
    nf.frequency.exponentialRampToValueAtTime(500, t + 0.12);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.44, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + 0.16);
    // debris shower — descending pings, staggered
    var deb = [1400, 1050, 820, 620, 480];
    for (var i = 0; i < deb.length; i++) {
      var dt = t + 0.05 + i * 0.06;
      var f = deb[i] * (0.92 + Math.random() * 0.16);
      var o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f, dt);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, dt + 0.06);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, dt);
      g.gain.exponentialRampToValueAtTime(0.05, dt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, dt + 0.08);
      o.connect(g); g.connect(out); o.start(dt); o.stop(dt + 0.1);
    }
  }

  // C "meaty thump": a big rounded sub whump + a low bandpassed noise bloom that
  // eases in, minimal top end.
  function buildBoomC(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.45;
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(150, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.62, t + 0.008);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    // rounded low noise bloom (eases in, no top end)
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.8;
    nf.frequency.setValueAtTime(520, t);
    nf.frequency.exponentialRampToValueAtTime(180, t + dur);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.42, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.02);
    // low knock body
    var kn = c.createOscillator(); kn.type = 'triangle';
    kn.frequency.setValueAtTime(200, t);
    kn.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    var kg = c.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.2, t + 0.006);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    kn.connect(kg); kg.connect(out); kn.start(t); kn.stop(t + 0.18);
  }

  // boss big-death = the style's DNA scaled further up (longer, louder, more
  // debris/bloom). Dispatched on killStyle; buffered, under the 1.2s big budget.
  function buildExplosionBig(c, dest, t, nb) {
    if (killStyle === 'B') return buildExplosionBigB(c, dest, t, nb);
    if (killStyle === 'C') return buildExplosionBigC(c, dest, t, nb);
    return buildExplosionBigA(c, dest, t, nb);
  }

  function buildExplosionBigA(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.7;
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(220, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + dur * 0.85);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.55, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    // click transient
    var cs = c.createBufferSource(); cs.buffer = nb; cs.loop = true;
    var cf = c.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.setValueAtTime(3000, t);
    var cg = c.createGain();
    cg.gain.setValueAtTime(0.45, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.008);
    cs.connect(cf); cf.connect(cg); cg.connect(out); cs.start(t); cs.stop(t + 0.02);
    // huge crunchy noise body raked 6000->200
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.Q.value = 0.7;
    nf.frequency.setValueAtTime(6000, t);
    nf.frequency.exponentialRampToValueAtTime(200, t + dur);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.02);
    var kn = c.createOscillator(); kn.type = 'triangle';
    kn.frequency.setValueAtTime(320, t);
    kn.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    var kg = c.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    kn.connect(kg); kg.connect(out); kn.start(t); kn.stop(t + 0.16);
  }

  function buildExplosionBigB(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.7;
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(210, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + dur * 0.8);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.55, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    // deep crack
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.9;
    nf.frequency.setValueAtTime(2200, t);
    nf.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + 0.22);
    // big debris shower
    var deb = [1600, 1250, 980, 760, 590, 460];
    for (var i = 0; i < deb.length; i++) {
      var dt = t + 0.06 + i * 0.08;
      var f = deb[i] * (0.9 + Math.random() * 0.2);
      var o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f, dt);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, dt + 0.08);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, dt);
      g.gain.exponentialRampToValueAtTime(0.06, dt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, dt + 0.1);
      o.connect(g); g.connect(out); o.start(dt); o.stop(dt + 0.12);
    }
  }

  function buildExplosionBigC(c, dest, t, nb) {
    var out = sat(c); out.connect(dest);
    var dur = 0.72;
    var sub = c.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(190, t);
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    var sg = c.createGain();
    sg.gain.setValueAtTime(0.6, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + dur + 0.02);
    // huge slow low bloom
    var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.7;
    nf.frequency.setValueAtTime(560, t);
    nf.frequency.exponentialRampToValueAtTime(150, t + dur);
    var ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.02);
    var kn = c.createOscillator(); kn.type = 'triangle';
    kn.frequency.setValueAtTime(210, t);
    kn.frequency.exponentialRampToValueAtTime(64, t + 0.12);
    var kg = c.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(0.24, t + 0.006);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    kn.connect(kg); kg.connect(out); kn.start(t); kn.stop(t + 0.2);
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
  var rendered = false; // guard so we only render the FULL set once
  var renderMs = 0;     // wall time until the last boot buffer resolved
  var renderCount = 0;  // (legacy) increments per resolve; count derived from bufs
  var killRenderMs = 0; // wall time of the last kill-style re-render (verify)

  var RICH = [
    { name: 'boom',         dur: 0.5,  build: buildBoom },
    { name: 'explosionBig', dur: 0.75, build: buildExplosionBig },
    { name: 'death',        dur: 0.85, build: buildDeath },
    { name: 'vaunt',        dur: 0.6,  build: buildVaunt },
    { name: 'bossPhase',    dur: 1.2,  build: buildBossPhase }
  ];

  function tnow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // Offline-render a set of RICH jobs into `bufs`, calling `done(ms)` once all
  // resolve. Shared by the boot render (all patches) and the kill-style live
  // re-render (just boom + explosionBig). Each build reads the CURRENT killStyle.
  function renderJobs(jobs, done) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) { if (done) done(0); return; }   // live fallback covers every patch
    var sr = ctx.sampleRate, t0 = tnow(), pending = jobs.length;
    if (!pending) { if (done) done(0); return; }
    jobs.forEach(function (job) {
      try {
        var len = Math.ceil(sr * job.dur);
        var oc = new OAC(1, len, sr);
        var nb = makeNoise(oc, 1.0);
        job.build(oc, oc.destination, 0, nb);
        var p = oc.startRendering();
        var ok = function (buf) {
          bufs[job.name] = buf; bufPeak[job.name] = peakOf(buf); renderCount++;
          if (--pending === 0 && done) done(tnow() - t0);
        };
        var bad = function () { if (--pending === 0 && done) done(tnow() - t0); };
        if (p && p.then) p.then(ok, bad);
        else oc.oncomplete = function (e) { ok(e.renderedBuffer); };   // legacy form
      } catch (e) { if (--pending === 0 && done) done(tnow() - t0); }
    });
  }

  function renderAll() {
    if (rendered || !ctx) return;
    rendered = true;
    renderJobs(RICH, function (ms) { renderMs = ms; });
  }

  // Re-render ONLY the kill-family buffered patches (boom / explosionBig) for the
  // current killStyle. Guarded + async: the stale-style buffers are dropped first
  // so playRich falls back to the live builder (which reads killStyle) for the new
  // style meanwhile, then swaps to the freshly rendered buffers when they resolve.
  function rerenderKill() {
    if (!ready) return;   // pre-boot: renderAll picks up whatever killStyle is set
    var jobs = [];
    for (var i = 0; i < RICH.length; i++) {
      var nm = RICH[i].name;
      if (nm === 'boom' || nm === 'explosionBig') { jobs.push(RICH[i]); delete bufs[nm]; }
    }
    renderJobs(jobs, function (ms) { killRenderMs = ms; });
  }

  // Live kill-sound style switch. Persists in a module var (default 'A'), re-renders
  // the buffered kill patches for the new style. Returns false on an unknown style.
  SFX.setKillStyle = function (s) {
    if (s !== 'A' && s !== 'B' && s !== 'C') return false;
    if (s === killStyle && bufs['boom']) return true;
    killStyle = s;
    rerenderKill();
    return true;
  };
  SFX.getKillStyle = function () { return killStyle; };

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
  // The base-torrent player shot (god-agnostic). Kept verbatim as the FALLBACK
  // voice for SFX.shot() when no attack-god is equipped (§7 base 3-stream) or an
  // unknown god is passed — regression-preserving. The god material voices (§6)
  // live below and dispatch through SFX.shot(god).
  function shotDefault() {
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
    if (killStyle === 'B') explB(t);
    else if (killStyle === 'C') explC(t);
    else explA(t);
  };

  // small live explosion = the mid kill tier between pop and boom, styled to match
  // the family. DRY (killBus). ~0.3s tail.
  function explA(t) {
    var n = killNoise(t, 0.28);
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.Q.value = 0.7;
    nf.frequency.setValueAtTime(5000, t);
    nf.frequency.exponentialRampToValueAtTime(240, t + 0.26);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.3, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.27);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(killBus); o.start(t); o.stop(t + 0.32);
  }

  function explB(t) {
    var n = killNoise(t, 0.09);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.9;
    nf.frequency.setValueAtTime(1900, t);
    nf.frequency.exponentialRampToValueAtTime(700, t + 0.08);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.3, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(280, t);
    o.frequency.exponentialRampToValueAtTime(64, t + 0.14);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(killBus); o.start(t); o.stop(t + 0.22);
    var deb = [1300, 950, 700, 520];
    for (var i = 0; i < deb.length; i++) {
      var dt = t + 0.03 + i * 0.045;
      var f = deb[i] * (0.9 + Math.random() * 0.2);
      var po = ctx.createOscillator(); po.type = 'triangle';
      po.frequency.setValueAtTime(f, dt);
      po.frequency.exponentialRampToValueAtTime(f * 0.6, dt + 0.06);
      var pg = ctx.createGain();
      pg.gain.setValueAtTime(0.0001, dt);
      pg.gain.exponentialRampToValueAtTime(0.03, dt + 0.004);
      pg.gain.exponentialRampToValueAtTime(0.0001, dt + 0.07);
      po.connect(pg); pg.connect(killBus); po.start(dt); po.stop(dt + 0.09);
    }
  }

  function explC(t) {
    var n = killNoise(t, 0.32);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.7;
    nf.frequency.setValueAtTime(560, t);
    nf.frequency.exponentialRampToValueAtTime(170, t + 0.3);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t);
    n.g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.2);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.34, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g); g.connect(killBus); o.start(t); o.stop(t + 0.34);
  }

  // a live noise voice on the DRY kill bus, started at a RANDOM offset into the 1s
  // noise buffer so rapid pops draw different samples (rapid stacks shimmer rather
  // than phase-lock into a buzz). Returns { s, g } for filter insertion.
  function killNoise(t, dur) {
    var s = ctx.createBufferSource();
    s.buffer = noise(); s.loop = true;
    var g = ctx.createGain();
    s.connect(g); g.connect(killBus);
    s.start(t, Math.random() * 0.8); s.stop(t + dur + 0.02);
    return { s: s, g: g };
  }

  // popcorn kill: the kill-cadence filler — fires constantly. NOISE-FORWARD: a
  // crunchy compact explosion, not a laser zap. Dispatched on killStyle. Anti-
  // stacked (throttle) and DRY — routed through the shared killBus saturator so a
  // formation wipe SUMS into a drum-roll crackle instead of clipping to mush.
  // SHORT (<=180ms tail). Per-play pitch + gain jitter + random noise offset keep a
  // chain shimmering. Loudness role preserved (~0.055 peak family).
  SFX.pop = function () {
    if (!ready || muted) return;
    var t = now();
    if (t - lastPop < 0.022) return;
    lastPop = t;
    if (killStyle === 'B') popB(t);
    else if (killStyle === 'C') popC(t);
    else popA(t);
  };

  // A "arcade crunch": a 3ms click + a dense noise burst a lowpass rakes 5k->300Hz
  // over ~90ms + a tiny sub tick — a bright crunchy "pkhh".
  function popA(t) {
    var j = 1 + (Math.random() * 2 - 1) * 0.06;   // per-play gain jitter
    var p = 1 + (Math.random() * 2 - 1) * 0.06;   // per-play pitch/rate jitter
    lastPopRate = p;
    // click transient
    var c = killNoise(t, 0.004);
    var cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.setValueAtTime(3500 * p, t);
    c.s.disconnect(); c.s.connect(cf); cf.connect(c.g);
    c.g.gain.setValueAtTime(0.045 * j, t);
    c.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.004);
    // dense noise burst, lowpass raked down
    var n = killNoise(t, 0.13);
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.Q.value = 0.7;
    nf.frequency.setValueAtTime(5000 * p, t);
    nf.frequency.exponentialRampToValueAtTime(300 * p, t + 0.09);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.052 * j, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    // tiny sub tick
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150 * p, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.05);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.03 * j, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(killBus); o.start(t); o.stop(t + 0.08);
  }

  // B "firework": a short noise crack + a spray of 2-3 tiny descending debris pings
  // at randomized pitches — a sparkly percussive burst.
  function popB(t) {
    var j = 1 + (Math.random() * 2 - 1) * 0.06;
    var p = 1 + (Math.random() * 2 - 1) * 0.06;
    lastPopRate = p;
    // crack
    var n = killNoise(t, 0.05);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.0;
    nf.frequency.setValueAtTime(2200 * p, t);
    nf.frequency.exponentialRampToValueAtTime(1200 * p, t + 0.04);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.05 * j, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    // debris pings (2 or 3), quiet, randomized
    var pings = 2 + (Math.random() < 0.5 ? 0 : 1);
    var base = [1500, 1050, 760];
    for (var i = 0; i < pings; i++) {
      var dt = t + 0.008 + i * 0.028 + Math.random() * 0.012;
      var f = base[i] * (0.9 + Math.random() * 0.3) * p;
      var po = ctx.createOscillator(); po.type = 'triangle';
      po.frequency.setValueAtTime(f, dt);
      po.frequency.exponentialRampToValueAtTime(f * 0.6, dt + 0.05);
      var pg = ctx.createGain();
      pg.gain.setValueAtTime(0.0001, dt);
      pg.gain.exponentialRampToValueAtTime(0.014 * j, dt + 0.003);
      pg.gain.exponentialRampToValueAtTime(0.0001, dt + 0.05);
      po.connect(pg); pg.connect(killBus); po.start(dt); po.stop(dt + 0.06);
    }
  }

  // C "meaty thump": shorter, rounder — a bandpassed noise knock centered ~700Hz +
  // a sub tick, minimal top end — a muffled compact "whump" that stacks smoothly.
  function popC(t) {
    var j = 1 + (Math.random() * 2 - 1) * 0.06;
    var p = 1 + (Math.random() * 2 - 1) * 0.06;
    lastPopRate = p;
    var n = killNoise(t, 0.07);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.1;
    nf.frequency.setValueAtTime(720 * p, t);
    nf.frequency.exponentialRampToValueAtTime(480 * p, t + 0.06);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.055 * j, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140 * p, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.06);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.038 * j, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g); g.connect(killBus); o.start(t); o.stop(t + 0.1);
  }

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

  // The generic charged-discharge special (god-agnostic). Kept verbatim as the
  // FALLBACK for SFX.special() when no special-god is equipped. God material
  // specials (§6) dispatch through SFX.special(god) below.
  function specialDefault() {
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

  // CURSED-GOLD petrify: the player gilds into a statue. A heavy metallic "clank"
  // (descending detuned squares through a closing lowpass — the body seizing) with
  // a bright crystalline shimmer on top (the gold-leaf setting). ~0.4s, dry.
  SFX.petrify = function () {
    if (!ready || muted) return;
    var t = now();
    // seizing body: two detuned squares sweeping down through a closing filter
    var f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(240, t + 0.34);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    g.connect(master); f.connect(g);
    var freqs = [300, 302, 150];
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(freqs[i] * 1.6, t);
      o.frequency.exponentialRampToValueAtTime(freqs[i] * 0.5, t + 0.3);
      o.connect(f); o.start(t); o.stop(t + 0.44);
    }
    // gold-leaf shimmer: a bright triangle ping high up, quick decay
    var s = ctx.createOscillator(); s.type = 'triangle';
    s.frequency.setValueAtTime(1760, t);
    s.frequency.exponentialRampToValueAtTime(2640, t + 0.05);
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.045, t + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    s.connect(sg); sg.connect(master); s.start(t); s.stop(t + 0.24);
    // impact crunch: a short lowpassed noise thud on the seize
    var n = noiseVoice(t, 0.08, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.setValueAtTime(1200, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.06, t);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  };

  // ===========================================================================
  // §6 SOUND SYSTEM — material voices, per-god VOICE table, pantheon register,
  // bespoke kit-event cues, communion stings, status apply-stings.
  //
  // Axis = the material you SEE. 9 material builders → 15 gods; a pantheon adds a
  // register-pitch mult + a special-only reverb tint. A god's shot and special are
  // the SAME material at two scales (shot tiny/DRY, special louder/longer/reverb-
  // sent). No melodic motifs on shots. SFX.shot(god)/SFX.special(god) read the
  // tables; called with no arg they resolve the live god from Game.st().
  // ===========================================================================

  function gst() { return (window.Game && Game.st) ? Game.st() : null; }

  // pantheon of each god, and the PANTHEON register×/rev-send table (§6).
  var PAN_OF = {
    zeus: 'O', poseidon: 'O', artemis: 'O', aphrodite: 'O', ares: 'O',
    ra: 'K', anubis: 'K',
    loki: 'A', odin: 'A', thor: 'A', heimdall: 'A',
    wukong: 'C', guanyu: 'C', jade: 'C',
    quetz: 'F'
  };
  var PAN = {
    O: { reg: 1.10, rev: 0.06 },   // OLYMPUS
    A: { reg: 0.85, rev: 0.04 },   // ASGARD
    K: { reg: 1.00, rev: 0.10 },   // KEMET
    C: { reg: 1.08, rev: 0.14 },   // COURT
    F: { reg: 0.92, rev: 0.08 }    // FIFTH SUN
  };
  function panOf(god) { return PAN[PAN_OF[god]] || PAN.O; }

  // VOICE table: god -> { material, base f0, per-god hook mods } (§6).
  var VOICE = {
    zeus:      { mat: 'ELECTRIC', f0: 820 },
    loki:      { mat: 'ELECTRIC', f0: 820, warble: 18 },              // +18c S&H warble
    thor:      { mat: 'KINETIC',  f0: 165, doubleHit: true },         // throw + return
    poseidon:  { mat: 'KINETIC',  f0: 165, water: 1200 },             // +1.2k water
    wukong:    { mat: 'KINETIC',  f0: 165, wood: true },              // wooden knock
    guanyu:    { mat: 'BLADE',    f0: 2500 },                         // −80c/pierce (event)
    ra:        { mat: 'BEAM',     f0: 110 },                          // sustained, no per-shot
    jade:      { mat: 'BELL',     f0: 277 },
    anubis:    { mat: 'BELL',     f0: 233, dark: true },              // darker + sub gong <50%
    heimdall:  { mat: 'BELL',     f0: 330, seam: true },              // seam arp + refract shimmer
    quetz:     { mat: 'SERPENT',  f0: 180 },
    artemis:   { mat: 'BOW',      f0: 700 },
    odin:      { mat: 'BOW',      f0: 600, grain2: true },            // double grain 40ms
    aphrodite: { mat: 'CHARM',    f0: 523.25 },
    ares:      { mat: 'FLUTTER',  f0: 210 }                           // bespoke war-drum/growl
  };

  // per-material shot minInterval overrides (BEAM is exempt — sustained voice).
  var MIN_INT = { KINETIC: 0.050, BLADE: 0.050 };

  // round-robin shot pitch [0, −50c, −90c] ±4% (verbatim mix law).
  var RR_CENTS = [0, -50, -90];
  function rrPitch(f0) {
    var c = RR_CENTS[shotRR % RR_CENTS.length]; shotRR++;
    var jit = 1 + (Math.random() * 2 - 1) * 0.04;
    return f0 * Math.pow(2, c / 1200) * jit;
  }
  function cents(c) { return Math.pow(2, c / 1200); }
  function shotPeak(p) { return Math.max(0.045, Math.min(0.055, p)); }   // clamp 0.045–0.055

  // ---- 9 material SHOT builders (tiny, DRY -> master) ------------------------

  function matElectric(t, f0, v) {
    var f = v.warble ? f0 * cents((Math.random() * 2 - 1) * v.warble) : f0;   // S&H warble
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.045);
    var rg = ctx.createGain(); rg.gain.value = 0.6;              // ring-mod carrier gain
    var ring = ctx.createOscillator(); ring.type = 'sine'; ring.frequency.value = 80;
    var rd = ctx.createGain(); rd.gain.value = 0.4; ring.connect(rd); rd.connect(rg.gain);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(shotPeak(0.05), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(rg); rg.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.07); ring.start(t); ring.stop(t + 0.07);
    var n = noiseVoice(t, 0.05, master);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(2500, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.03, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  }

  var lastWarDrum = 0;
  function matKinetic(t, f0, v) {
    function hit(tt, pk) {
      var o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(38, tt + 0.06);
      var g = ctx.createGain();
      g.gain.setValueAtTime(shotPeak(pk), tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09);
      o.connect(g); g.connect(master); o.start(tt); o.stop(tt + 0.1);
      var n = noiseVoice(tt, 0.03, master);                     // lowpassed noise slap
      var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.setValueAtTime(700, tt);
      n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
      n.g.gain.setValueAtTime(0.03, tt); n.g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
      var c = noiseVoice(tt, 0.004, master);                    // 2ms click
      var cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.setValueAtTime(3000, tt);
      c.s.disconnect(); c.s.connect(cf); cf.connect(c.g);
      c.g.gain.setValueAtTime(0.03, tt); c.g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.004);
      if (v.water) {                                            // Poseidon 1.2k water ping
        var wn = noiseVoice(tt, 0.04, master);
        var wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 3;
        wf.frequency.setValueAtTime(v.water, tt);
        wf.frequency.exponentialRampToValueAtTime(v.water * 1.6, tt + 0.03);
        wn.s.disconnect(); wn.s.connect(wf); wf.connect(wn.g);
        wn.g.gain.setValueAtTime(0.02, tt); wn.g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04);
      }
      if (v.wood) {                                             // Wukong wooden knock
        var o2 = ctx.createOscillator(); o2.type = 'triangle';
        o2.frequency.setValueAtTime(800, tt);
        o2.frequency.exponentialRampToValueAtTime(500, tt + 0.02);
        var g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.03, tt); g2.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
        o2.connect(g2); g2.connect(master); o2.start(tt); o2.stop(tt + 0.04);
      }
    }
    hit(t, 0.05);
    if (v.doubleHit) hit(t + 0.09, 0.035);                      // Thor throw + return
  }

  function matBlade(t, f0, v) {
    var p = v.pierce || 0;
    var f = f0 * cents(-80 * p);                                // −80c/pierce
    var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t);
    var bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.Q.value = 5; bf.frequency.setValueAtTime(f, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(shotPeak(0.05), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(bf); bf.connect(g); g.connect(master); o.start(t); o.stop(t + 0.06);
    var n = noiseVoice(t, 0.03, master);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 6; nf.frequency.setValueAtTime(f, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.025, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  }

  // BEAM (Ra) — one sustained sine+saw through a resonant lowpass that opens the
  // longer the beam is HELD (rising-while-held). No per-shot voice: SFX.shot('ra')
  // keeps this one voice alive; a gap >0.18s resets the hold. Oscillators run for
  // the session (2 nodes) parked near-silent when idle.
  var beam = null;
  function beamKeepAlive(god) {
    var t = now();
    var p = panOf(god); var f0 = VOICE[god].f0 * p.reg;
    if (!beam) {
      var o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f0;
      var o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f0;
      var lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.Q.value = 6; lpf.frequency.value = 600;
      var g = ctx.createGain(); g.gain.value = 0.0001;
      o1.connect(lpf); o2.connect(lpf); lpf.connect(g); g.connect(master);
      o1.start(); o2.start();
      beam = { o1: o1, o2: o2, lp: lpf, g: g, hold: t, last: t };
    }
    var b = beam;
    if (t - b.last > 0.18) b.hold = t;   // gap → new hold
    b.last = t;
    var held = Math.min(2.0, t - b.hold);
    var open = 600 + (2500 - 600) * (held / 2.0);   // 600→2500Hz while held
    b.lp.frequency.cancelScheduledValues(t); b.lp.frequency.setValueAtTime(open, t);
    b.g.gain.cancelScheduledValues(t);
    b.g.gain.setValueAtTime(Math.max(0.0001, b.g.gain.value), t);
    b.g.gain.linearRampToValueAtTime(0.05, t + 0.03);            // sustain while called
    b.g.gain.setTargetAtTime(0.0001, t + 0.10, 0.06);            // release if not refreshed
  }

  function matBell(t, f0, v) {
    var mult = [1, 2.4, 3.9];
    var base = f0 * (v.dark ? 0.85 : 1);
    for (var i = 0; i < mult.length; i++) {
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(base * mult[i] * (1 + 0.005 * i), t);
      var g = ctx.createGain();
      var pk = (i === 0) ? shotPeak(0.05) : (0.05 / (i + 1)) * (v.dark ? 0.7 : 1);
      var dec = 0.13 - i * 0.03;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(pk, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dec + 0.02);
    }
  }

  function matSerpent(t, f0, v) {
    for (var i = 0; i < 2; i++) {
      var d = i ? cents(8) : cents(-8);                          // detuned ±8c
      var o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f0 * d * 1.1, t);
      o.frequency.exponentialRampToValueAtTime(f0 * d, t + 0.05);   // portamento
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(shotPeak(0.045), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.07);
    }
    var n = noiseVoice(t, 0.05, master);                        // breath ~3k
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 2; nf.frequency.setValueAtTime(3000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.018, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  }

  function matBow(t, f0, v) {
    function grain(tt) {
      var o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(f0 * 1.15, tt);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.5, tt + 0.012);   // 12ms pitch-flick
      var g = ctx.createGain();
      g.gain.setValueAtTime(shotPeak(0.05), tt);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05);
      o.connect(g); g.connect(master); o.start(tt); o.stop(tt + 0.06);
      var n = noiseVoice(tt, 0.03, master);                     // arrow-zip noise
      var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(4000, tt);
      n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
      n.g.gain.setValueAtTime(0.02, tt); n.g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
    }
    grain(t);
    if (v.grain2) grain(t + 0.04);                              // Odin double grain 40ms
  }

  function matCharm(t, f0, v) {
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * cents(300), t + 0.08);   // minor-3rd gliss
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(shotPeak(0.05), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    var trem = ctx.createOscillator(); trem.type = 'sine'; trem.frequency.value = 5;   // 5Hz tremolo
    var td = ctx.createGain(); td.gain.value = 0.015; trem.connect(td); td.connect(g.gain);
    trem.start(t); trem.stop(t + 0.13);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
    // NO noise (CHARM law).
  }

  function matFlutter(t, f0, v) {
    var st = gst();
    var stacks = (st && st.frenzy && st.frenzy.stacks) || 0;
    var frac = Math.min(1, stacks / 10);
    // WAR-DRUM bed: 70Hz thud on a cadence that tightens with heat (driven off the
    // shot cadence — beats while Ares fires; "heat audible before visible").
    if (t - lastWarDrum > (0.9 - 0.5 * frac)) { lastWarDrum = t; warDrum(t); }
    var body = f0 * (1 - 0.35 * frac);                          // FRENZY drops toward ~80Hz
    var o = ctx.createOscillator(); o.type = frac > 0.4 ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(body * 1.1, t);
    o.frequency.exponentialRampToValueAtTime(body * 0.7, t + 0.05);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(shotPeak(0.05), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.07);
    if (frac > 0.3) {                                           // FRENZY hiss
      var n = noiseVoice(t, 0.05, master);
      var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.5; nf.frequency.setValueAtTime(1200, t);
      n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
      n.g.gain.setValueAtTime(0.02 * frac, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    }
  }
  function warDrum(t) {
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.18);
  }

  var MAT_SHOT = {
    ELECTRIC: matElectric, KINETIC: matKinetic, BLADE: matBlade,
    BELL: matBell, SERPENT: matSerpent, BOW: matBow, CHARM: matCharm, FLUTTER: matFlutter
  };

  // ---- SFX.shot(god) — the shot dispatcher ----------------------------------
  // Called with no arg -> resolves G.attackGod. No/unknown god -> the base torrent
  // (shotDefault). BEAM (Ra) routes to the sustained beam, exempt from the gate.
  SFX.shot = function (god) {
    if (!ready || muted) return;
    if (god == null) { var g0 = gst(); god = g0 && g0.attackGod; }
    var v = god && VOICE[god];
    if (!v) { shotDefault(); return; }
    if (v.mat === 'BEAM') { beamKeepAlive(god); return; }
    var t = now();
    var mi = MIN_INT[v.mat] || 0.028;                           // 28ms gate; KINETIC/BLADE 50ms
    if (t - lastShot < mi) return;
    lastShot = t;
    var f0 = rrPitch(v.f0 * panOf(god).reg);
    MAT_SHOT[v.mat](t, f0, v);
  };

  // ---- 9 material SPECIAL builders (louder/longer, into out=sat->hub(rev)) ----

  // ZEUS CRACK primitive (shared by Zeus/Jade specials & the crack cues): 6ms hp
  // noise + 40Hz sub + saw 900→180 raked through a closing lowpass, tanh-sat.
  function zeusCrackInto(t, out, semi) {
    var m = cents(semi * 100 || 0);
    var n = noiseVoice(t, 0.02, out);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(3000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.4, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);
    var sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(60 * m, t); sub.frequency.exponentialRampToValueAtTime(40 * m, t + 0.1);
    var sg = ctx.createGain(); sg.gain.setValueAtTime(0.5, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + 0.27);
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(900 * m, t); o.frequency.exponentialRampToValueAtTime(180 * m, t + 0.18);
    var f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.18);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.24);
  }

  function spElectric(t, out, f0, v) { zeusCrackInto(t, out, 0); }

  function spKinetic(t, out, f0, v) {
    var sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(180, t); sub.frequency.exponentialRampToValueAtTime(36, t + 0.2);
    var sg = ctx.createGain(); sg.gain.setValueAtTime(0.55, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(t + 0.42);
    var n = noiseVoice(t, 0.25, out);
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(1200, t); nf.frequency.exponentialRampToValueAtTime(200, t + 0.25);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.35, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    if (v.water) {                                              // Poseidon rising water
      var wn = noiseVoice(t, 0.4, out);
      var wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 1.5;
      wf.frequency.setValueAtTime(300, t); wf.frequency.exponentialRampToValueAtTime(2500, t + 0.38);
      wn.s.disconnect(); wn.s.connect(wf); wf.connect(wn.g);
      wn.g.gain.setValueAtTime(0.0001, t); wn.g.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
      wn.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    }
  }

  function spBlade(t, out, f0, v) {                             // 0.5s downsweep 2.5k→600
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(2500, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.45);
    var bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.Q.value = 4;
    bf.frequency.setValueAtTime(2500, t); bf.frequency.exponentialRampToValueAtTime(600, t + 0.45);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(bf); bf.connect(g); g.connect(out); o.start(t); o.stop(t + 0.52);
    var n = noiseVoice(t, 0.45, out);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 3;
    nf.frequency.setValueAtTime(3000, t); nf.frequency.exponentialRampToValueAtTime(700, t + 0.45);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.15, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  }

  function spBeam(t, out, f0, v) {                             // Ra Solar Flare: noise flash swell
    var n = noiseVoice(t, 0.5, out);
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(1000, t); nf.frequency.exponentialRampToValueAtTime(6000, t + 0.25);
    nf.frequency.exponentialRampToValueAtTime(2000, t + 0.5);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.4, t + 0.12);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 3, t + 0.3);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.47);
  }

  function spBell(t, out, f0, v) {
    var base = f0 * (v.dark ? 0.7 : 1); var mult = [1, 2.4, 3.9, 5.4];
    for (var i = 0; i < mult.length; i++) {
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(base * mult[i] * (1 + 0.006 * i), t);
      var g = ctx.createGain(); var dec = 0.6 - i * 0.1;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12 / (i + 1), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.02);
    }
    var s = ctx.createOscillator(); s.type = 'triangle';
    s.frequency.setValueAtTime(base * 0.5, t); s.frequency.exponentialRampToValueAtTime(base * 0.25, t + 0.4);
    var sg = ctx.createGain(); sg.gain.setValueAtTime(0.4, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(sg); sg.connect(out); s.start(t); s.stop(t + 0.52);
  }

  function spSerpent(t, out, f0, v) {
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2, t + 0.4);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.47);
    var n = noiseVoice(t, 0.4, out);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 2;
    nf.frequency.setValueAtTime(2000, t); nf.frequency.exponentialRampToValueAtTime(4000, t + 0.4);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.15, t + 0.15);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  }

  function spBow(t, out, f0, v) {
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.14);
    var n = noiseVoice(t, 0.1, out);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(4000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.12, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  }

  function spCharm(t, out, f0, v) {                            // Aphrodite chime-swell
    var notes = [523.25, 784];
    for (var i = 0; i < notes.length; i++) {
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = notes[i];
      var vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 6;
      var vd = ctx.createGain(); vd.gain.value = 4; vib.connect(vd); vd.connect(o.frequency);
      vib.start(t); vib.stop(t + 0.6);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.57);
    }
  }

  function spFlutter(t, out, f0, v) {                          // Ares wraith dive + terror shudder
    var n = noiseVoice(t, 0.4, out);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.2;
    nf.frequency.setValueAtTime(1800, t); nf.frequency.exponentialRampToValueAtTime(400, t + 0.35);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.28, t + 0.05);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    var o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.35);
    var am = ctx.createOscillator(); am.type = 'sine'; am.frequency.value = 30;   // 30Hz shudder
    var ad = ctx.createGain(); ad.gain.value = 0.1; am.connect(ad);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    ad.connect(g.gain); am.start(t); am.stop(t + 0.4);
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.42);
  }

  var MAT_SPECIAL = {
    ELECTRIC: spElectric, KINETIC: spKinetic, BLADE: spBlade, BEAM: spBeam,
    BELL: spBell, SERPENT: spSerpent, BOW: spBow, CHARM: spCharm, FLUTTER: spFlutter
  };

  // ---- SFX.special(god) — the special dispatcher ----------------------------
  // 60ms de-dupe; specials live-synth through hub(revSend)/sat(); revSend from the
  // pantheon (specials only). No/unknown god -> specialDefault (regression).
  var lastSpecialT = 0;
  SFX.special = function (god) {
    if (!ready || muted) return;
    if (god == null) { var g0 = gst(); god = g0 && g0.specialGod; }
    var v = god && VOICE[god];
    if (!v) { specialDefault(); return; }
    var t = now();
    if (t - lastSpecialT < 0.06) return;                       // 60ms de-dupe
    lastSpecialT = t;
    var p = panOf(god);
    var h = hub(p.rev); var out = sat(ctx); out.connect(h);
    MAT_SPECIAL[v.mat](t, out, v.f0 * p.reg, v);
  };

  // ---- bespoke kit-event cues (§2 kit sheets) -------------------------------
  // Each layered over the base material. All guarded + missing-node safe.

  // BELL ding — generic inharmonic strike (~250ms ring). WIRED: game.js Heimdall
  // bridge-fade (SFX.bell && SFX.bell()). Optional f0 override.
  SFX.bell = function (f0) {
    if (!ready || muted) return;
    var t = now(); var base = f0 || 660; var mult = [1, 2.4, 3.9];
    for (var i = 0; i < mult.length; i++) {
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(base * mult[i] * (1 + 0.005 * i), t);
      var g = ctx.createGain(); var dec = 0.25 - i * 0.05;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06 / (i + 1), t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dec + 0.02);
    }
  };

  // Odin — stone-chisel chip on each rune carve (2ms noise tick + 1.2kHz ring).
  SFX.carveChip = function () {
    if (!ready || muted) return;
    var t = now();
    var n = noiseVoice(t, 0.006, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(3000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.05, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);
    var o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(1200, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.07);
  };

  // Odin — THE NINTH RUNE doom-toll (low bell 180Hz, ~0.6s).
  SFX.doomToll = function () {
    if (!ready || muted) return;
    var t = now(); var h = hub(0.05); var out = sat(ctx); out.connect(h);
    var mult = [1, 2.4, 3.9];
    for (var i = 0; i < mult.length; i++) {
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(180 * mult[i] * (1 + 0.006 * i), t);
      var g = ctx.createGain(); var dec = 0.6 - i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14 / (i + 1), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.02);
    }
  };

  // Loki — reverse-pickpocket LIFT (reversed-envelope bandpass pink-noise → bright
  // click on flip; detuned triangle twin-shimmer 880→1320Hz; metallic clink).
  SFX.pilferLift = function () {
    if (!ready || muted) return;
    var t = now();
    var n = noiseVoice(t, 0.16, null);                          // reversed-envelope swell
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.2; nf.frequency.setValueAtTime(1400, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.06, t + 0.14);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    var c = noiseVoice(t + 0.14, 0.006, null);                  // bright click on flip
    var cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.setValueAtTime(4000, t + 0.14);
    c.s.disconnect(); c.s.connect(cf); cf.connect(c.g);
    c.g.gain.setValueAtTime(0.05, t + 0.14); c.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.148);
    for (var i = 0; i < 2; i++) {                               // twin shimmer 880→1320
      var o = ctx.createOscillator(); o.type = 'triangle';
      var d = i ? cents(6) : cents(-6);
      o.frequency.setValueAtTime(880 * d, t + 0.1);
      o.frequency.exponentialRampToValueAtTime(1320 * d, t + 0.2);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.1); g.gain.exponentialRampToValueAtTime(0.04, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      o.connect(g); g.connect(master); o.start(t + 0.1); o.stop(t + 0.28);
    }
  };

  // Quetz — COIL quantized rising whistle 0.9k→2.4k over 6 stacks; max = hiss+90Hz
  // crush. stacks 0..6.
  SFX.coilWhistle = function (stacks) {
    if (!ready || muted) return;
    var t = now(); var s = Math.max(0, Math.min(6, stacks || 0));
    var f = 900 + (2400 - 900) * (s / 6);
    var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
    if (s >= 6) {                                               // CONSTRICT: hiss + 90Hz crush
      var n = noiseVoice(t, 0.14, null);
      var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.5; nf.frequency.setValueAtTime(3200, t);
      n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
      n.g.gain.setValueAtTime(0.04, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      var sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(90, t);
      var sg = ctx.createGain(); sg.gain.setValueAtTime(0.06, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      sub.connect(sg); sg.connect(master); sub.start(t); sub.stop(t + 0.18);
    }
  };
  // Quetz — uncoil downward slide.
  SFX.uncoil = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(2000, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.18);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.22);
  };

  // Ares — tier-up timpani + noise whoosh 400→3k; tier-down douse downsweep.
  SFX.tierUp = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.22);
    var n = noiseVoice(t, 0.16, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.9;
    nf.frequency.setValueAtTime(400, t); nf.frequency.exponentialRampToValueAtTime(3000, t + 0.14);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.06, t + 0.06);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  };
  SFX.tierDown = function () {
    if (!ready || muted) return;
    var t = now();
    var n = noiseVoice(t, 0.2, null);                           // douse downsweep
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(3000, t); nf.frequency.exponentialRampToValueAtTime(300, t + 0.18);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.06, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  };

  // Anubis — THE VERDICT: sub gong + scales-tip ring.
  SFX.verdictGong = function () {
    if (!ready || muted) return;
    var t = now(); var h = hub(0.1); var out = sat(ctx); out.connect(h);
    var mult = [1, 2.4, 3.9];
    for (var i = 0; i < mult.length; i++) {
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(120 * mult[i] * (1 + 0.006 * i), t);
      var g = ctx.createGain(); var dec = 0.55 - i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14 / (i + 1), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.02);
    }
    var tp = ctx.createOscillator(); tp.type = 'triangle';     // tip-ring
    tp.frequency.setValueAtTime(1400, t); tp.frequency.exponentialRampToValueAtTime(2100, t + 0.1);
    var tg = ctx.createGain(); tg.gain.setValueAtTime(0.0001, t); tg.gain.exponentialRampToValueAtTime(0.04, t + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    tp.connect(tg); tg.connect(out); tp.start(t); tp.stop(t + 0.22);
  };

  // Anubis — GATE OF DUAT: bell + low sand-roar.
  SFX.gateRoar = function () {
    if (!ready || muted) return;
    var t = now(); var h = hub(0.1); var out = sat(ctx); out.connect(h);
    var n = noiseVoice(t, 0.6, out);                            // sand-roar
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.Q.value = 0.7;
    nf.frequency.setValueAtTime(500, t); nf.frequency.exponentialRampToValueAtTime(180, t + 0.5);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.28, t + 0.15);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    var o = ctx.createOscillator(); o.type = 'square';         // bell over it
    o.frequency.setValueAtTime(233, t);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.32);
  };

  // Heimdall — seam telegraph rising arpeggio (3 bells, 5th + 8ve).
  SFX.seamArp = function () {
    if (!ready || muted) return;
    var t = now(); var notes = [523.25, 783.99, 1046.5];       // root, 5th, 8ve
    for (var i = 0; i < notes.length; i++) {
      (function (nn, dt) {
        var o = ctx.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(nn, dt);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, dt); g.gain.exponentialRampToValueAtTime(0.05, dt + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, dt + 0.16);
        o.connect(g); g.connect(master); o.start(dt); o.stop(dt + 0.18);
      })(notes[i], t + i * 0.11);
    }
  };
  // Heimdall — bridge-fade soft descending pair.
  SFX.bridgeFade = function () {
    if (!ready || muted) return;
    var t = now(); var notes = [783.99, 523.25];
    for (var i = 0; i < notes.length; i++) {
      (function (nn, dt) {
        var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(nn, dt);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, dt); g.gain.exponentialRampToValueAtTime(0.04, dt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, dt + 0.2);
        o.connect(g); g.connect(master); o.start(dt); o.stop(dt + 0.22);
      })(notes[i], t + i * 0.1);
    }
  };
  // Heimdall — SPECTRUM LANCE crystalline shimmer (throttled 6/s).
  var lastRefract = 0;
  SFX.refractShimmer = function () {
    if (!ready || muted) return;
    var t = now(); if (t - lastRefract < 0.16) return; lastRefract = t;
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(2600, t); o.frequency.exponentialRampToValueAtTime(3400, t + 0.06);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.11);
    var n = noiseVoice(t, 0.05, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(6000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.02, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  };

  // Guan Yu — per-pierce shing (−80c per pierce; event, brightens/drops per foe).
  SFX.blade = function (pierce) {
    if (!ready || muted) return;
    var t = now();
    matBlade(t, 2500 * panOf('guanyu').reg, { pierce: pierce || 0 });
  };

  // §2.5 — shared ULT-CAST swell + the god's §6 material accent at ×1.5.
  SFX.ultCast = function (god) {
    if (!ready || muted) return;
    var t = now(); var h = hub(0.1); var out = sat(ctx); out.connect(h);
    var n = noiseVoice(t, 0.5, out);                            // rising swell
    var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.8;
    nf.frequency.setValueAtTime(300, t); nf.frequency.exponentialRampToValueAtTime(4000, t + 0.4);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.35, t + 0.3);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    var s = ctx.createOscillator(); s.type = 'sine';
    s.frequency.setValueAtTime(80, t); s.frequency.exponentialRampToValueAtTime(160, t + 0.4);
    var sg = ctx.createGain(); sg.gain.setValueAtTime(0.4, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    s.connect(sg); sg.connect(out); s.start(t); s.stop(t + 0.52);
    if (god == null) { var g0 = gst(); god = g0 && g0.ultimateGod; }
    var v = god && VOICE[god];
    if (v && MAT_SPECIAL[v.mat]) { try { MAT_SPECIAL[v.mat](t + 0.28, out, v.f0 * panOf(god).reg, v); } catch (e) {} }
  };

  // Jade — IMPERIAL JUDGEMENT: storm-cloud rumble loop (low brown noise, throttled).
  var lastRumble = 0;
  SFX.stormRumble = function () {
    if (!ready || muted) return;
    var t = now(); if (t - lastRumble < 0.35) return; lastRumble = t;
    var n = noiseVoice(t, 0.5, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.setValueAtTime(120, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.05, t + 0.2);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  };
  // Jade — MIRROR REFLECTION pre-strike glass 'ting'.
  SFX.mirrorTing = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(3200, t); o.frequency.exponentialRampToValueAtTime(3600, t + 0.02);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.18);
  };
  // Jade — ZEUS CRACK variant per bolt (darker, −4 semitones).
  SFX.judgementCrack = function () {
    if (!ready || muted) return;
    var t = now(); var h = hub(0.14); var out = sat(ctx); out.connect(h);
    zeusCrackInto(t, out, -4);   // darker: −4 semitones (zeusCrackInto takes semitones)
  };
  // Zeus — the base ZEUS CRACK (SKYFALL). Reverb-sent through the hub.
  SFX.zeusCrack = function () {
    if (!ready || muted) return;
    var t = now(); var h = hub(0.06); var out = sat(ctx); out.connect(h);
    zeusCrackInto(t, out, 0);
  };

  // DIVINE INTERVENTION — freeze shimmer.
  SFX.freezeShimmer = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(2800, t + 0.3);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.37);
    var n = noiseVoice(t, 0.3, null);
    var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(5000, t);
    n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
    n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.03, t + 0.05);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  };

  // Thor — GIANT'S END giant boomerang whoosh (out-pass + return-pass).
  SFX.boomerang = function () {
    if (!ready || muted) return;
    var t = now(); var h = hub(0.06); var out = sat(ctx); out.connect(h);
    function whoosh(tt, up) {
      var n = noiseVoice(tt, 0.5, out);
      var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.2;
      nf.frequency.setValueAtTime(up ? 400 : 2200, tt);
      nf.frequency.exponentialRampToValueAtTime(up ? 2200 : 400, tt + 0.45);
      n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
      n.g.gain.setValueAtTime(0.0001, tt); n.g.gain.exponentialRampToValueAtTime(0.22, tt + 0.15);
      n.g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.5);
    }
    whoosh(t, true);          // out-pass rising
    whoosh(t + 1.1, false);   // return-pass falling
  };

  // §5 — owned-entity summon (rising triangle 660→990) / recall (reversed 880→440).
  SFX.summon = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(990, t + 0.14);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
  };
  SFX.recall = function () {
    if (!ready || muted) return;
    var t = now();
    var o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.16);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.22);
  };

  // §4 — status apply-stings. The two BODY-verb states (stun/terror) carry the
  // loudest contrast; the rest are quiet ticks.
  SFX.status = function (name) {
    if (!ready || muted) return;
    var t = now();
    if (name === 'stun') {                                      // frozen: bright freeze-crack
      var o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.12);
      var g = ctx.createGain(); g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.16);
      var n = noiseVoice(t, 0.05, null);
      var nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.setValueAtTime(5000, t);
      n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
      n.g.gain.setValueAtTime(0.05, t); n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    } else if (name === 'terror') {                             // dark low shudder
      var o2 = ctx.createOscillator(); o2.type = 'sawtooth';
      o2.frequency.setValueAtTime(140, t); o2.frequency.exponentialRampToValueAtTime(70, t + 0.25);
      var am = ctx.createOscillator(); am.type = 'sine'; am.frequency.value = 30;
      var ad = ctx.createGain(); ad.gain.value = 0.04; am.connect(ad);
      var g2 = ctx.createGain(); g2.gain.setValueAtTime(0.09, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      ad.connect(g2.gain); am.start(t); am.stop(t + 0.3);
      var f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 500;
      o2.connect(f2); f2.connect(g2); g2.connect(master); o2.start(t); o2.stop(t + 0.32);
    } else {                                                    // mark/weak/burn/charmed/shaken tick
      var hi = (name === 'charmed');
      var o3 = ctx.createOscillator(); o3.type = 'triangle';
      o3.frequency.setValueAtTime(hi ? 880 : 520, t);
      o3.frequency.exponentialRampToValueAtTime(hi ? 1040 : 400, t + 0.08);
      var g3 = ctx.createGain(); g3.gain.setValueAtTime(0.04, t); g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o3.connect(g3); g3.connect(master); o3.start(t); o3.stop(t + 0.11);
    }
  };

  // COMMUNION STINGS (5, on set-bonus): OLYMPUS bronze major-arp · ASGARD forge/horn
  // drone · KEMET filter-sweep-up 400→3k · COURT temple gong · FIFTH wind portamento.
  SFX.communion = function (pan) {
    if (!ready || muted) return;
    var t = now(); var h = hub(0.1); var out = sat(ctx); out.connect(h);
    var p = (pan || '').toUpperCase();
    if (p === 'OLYMPUS' || p === 'O') {
      var arp = [261.63, 329.63, 392.0, 523.25];
      for (var i = 0; i < arp.length; i++) coin(arp[i] * 2, t + i * 0.06, 0.05, out);
    } else if (p === 'ASGARD' || p === 'A') {
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7); f.connect(g); g.connect(out);
      var oa = ctx.createOscillator(); oa.type = 'sawtooth'; oa.frequency.value = 110;
      var ob = ctx.createOscillator(); ob.type = 'sawtooth'; ob.frequency.value = 165;
      oa.connect(f); ob.connect(f); oa.start(t); oa.stop(t + 0.72); ob.start(t); ob.stop(t + 0.72);
    } else if (p === 'KEMET' || p === 'K') {
      var n = noiseVoice(t, 0.6, out);
      var nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.2;
      nf.frequency.setValueAtTime(400, t); nf.frequency.exponentialRampToValueAtTime(3000, t + 0.5);
      n.s.disconnect(); n.s.connect(nf); nf.connect(n.g);
      n.g.gain.setValueAtTime(0.0001, t); n.g.gain.exponentialRampToValueAtTime(0.3, t + 0.25);
      n.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    } else if (p === 'COURT' || p === 'CELESTIAL COURT' || p === 'C') {
      var mult = [1, 2.4, 3.9];
      for (var j = 0; j < mult.length; j++) {
        var o = ctx.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(138.6 * mult[j] * (1 + 0.006 * j), t);
        var gg = ctx.createGain(); var dec = 0.7 - j * 0.15;
        gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(0.13 / (j + 1), t + 0.006);
        gg.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(gg); gg.connect(out); o.start(t); o.stop(t + dec + 0.02);
      }
    } else if (p === 'FIFTH' || p === 'FIFTH SUN' || p === 'F') {
      var o3 = ctx.createOscillator(); o3.type = 'sine';
      o3.frequency.setValueAtTime(300, t); o3.frequency.exponentialRampToValueAtTime(700, t + 0.3);
      o3.frequency.exponentialRampToValueAtTime(500, t + 0.6);
      var g3 = ctx.createGain(); g3.gain.setValueAtTime(0.0001, t); g3.gain.exponentialRampToValueAtTime(0.14, t + 0.2);
      g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o3.connect(g3); g3.connect(out); o3.start(t); o3.stop(t + 0.62);
    }
  };

  // dev/verify: list every god's voice mapping and all §6 exported cue names.
  SFX.voiceInfo = function () {
    var gods = [];
    for (var k in VOICE) if (VOICE.hasOwnProperty(k)) {
      gods.push({ god: k, mat: VOICE[k].mat, f0: VOICE[k].f0, pan: PAN_OF[k], reg: panOf(k).reg, rev: panOf(k).rev });
    }
    return { gods: gods, beamAlive: !!beam };
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
    ['petrify',      function () { SFX.petrify(); }],
    ['death',        function () { SFX.death(); }],
    // §6 material voices (shot/special per god) + bespoke kit cues.
    ['shot:zeus',    function () { SFX.shot('zeus'); }],
    ['shot:ares',    function () { SFX.shot('ares'); }],
    ['shot:guanyu',  function () { SFX.shot('guanyu'); }],
    ['shot:ra',      function () { SFX.shot('ra'); }],
    ['shot:jade',    function () { SFX.shot('jade'); }],
    ['shot:quetz',   function () { SFX.shot('quetz'); }],
    ['shot:artemis', function () { SFX.shot('artemis'); }],
    ['shot:aphrodite', function () { SFX.shot('aphrodite'); }],
    ['shot:thor',    function () { SFX.shot('thor'); }],
    ['special:zeus', function () { SFX.special('zeus'); }],
    ['special:poseidon', function () { SFX.special('poseidon'); }],
    ['special:ra',   function () { SFX.special('ra'); }],
    ['special:aphrodite', function () { SFX.special('aphrodite'); }],
    ['bell',         function () { SFX.bell(); }],
    ['carveChip',    function () { SFX.carveChip(); }],
    ['doomToll',     function () { SFX.doomToll(); }],
    ['pilferLift',   function () { SFX.pilferLift(); }],
    ['coilWhistle',  function () { SFX.coilWhistle(6); }],
    ['uncoil',       function () { SFX.uncoil(); }],
    ['tierUp',       function () { SFX.tierUp(); }],
    ['tierDown',     function () { SFX.tierDown(); }],
    ['verdictGong',  function () { SFX.verdictGong(); }],
    ['gateRoar',     function () { SFX.gateRoar(); }],
    ['seamArp',      function () { SFX.seamArp(); }],
    ['bridgeFade',   function () { SFX.bridgeFade(); }],
    ['refractShimmer', function () { SFX.refractShimmer(); }],
    ['blade',        function () { SFX.blade(2); }],
    ['ultCast',      function () { SFX.ultCast('zeus'); }],
    ['stormRumble',  function () { SFX.stormRumble(); }],
    ['mirrorTing',   function () { SFX.mirrorTing(); }],
    ['judgementCrack', function () { SFX.judgementCrack(); }],
    ['zeusCrack',    function () { SFX.zeusCrack(); }],
    ['freezeShimmer', function () { SFX.freezeShimmer(); }],
    ['boomerang',    function () { SFX.boomerang(); }],
    ['summon',       function () { SFX.summon(); }],
    ['recall',       function () { SFX.recall(); }],
    ['status:stun',  function () { SFX.status('stun'); }],
    ['status:terror', function () { SFX.status('terror'); }],
    ['status:mark',  function () { SFX.status('mark'); }],
    ['communion:O',  function () { SFX.communion('OLYMPUS'); }],
    ['communion:A',  function () { SFX.communion('ASGARD'); }],
    ['communion:K',  function () { SFX.communion('KEMET'); }],
    ['communion:C',  function () { SFX.communion('COURT'); }],
    ['communion:F',  function () { SFX.communion('FIFTH'); }]
  ];
  SFX.audition = function (name) {
    SFX.ensure(); SFX.resume();
    // audition('killA'|'killB'|'killC'): switch to that style, play its full kill
    // family (pop x3 chain -> small explosion -> boom), then restore the prior style.
    if (name === 'killA' || name === 'killB' || name === 'killC') {
      var style = name.charAt(name.length - 1);
      var prev = killStyle;
      SFX.setKillStyle(style);
      var seq = [
        ['pop',       function () { SFX.pop(); }],
        ['pop',       function () { SFX.pop(); }],
        ['pop',       function () { SFX.pop(); }],
        ['explosion', function () { SFX.explosion(false); }],
        ['boom',      function () { SFX.boom(); }]
      ];
      var qi = 0;
      (function stepKill() {
        if (qi >= seq.length) { SFX.setKillStyle(prev); return; }
        var it = seq[qi++];
        if (window.console) console.log('[SFX.audition] kill' + style + ':' + it[0]);
        it[1]();
        setTimeout(stepKill, it[0] === 'pop' ? 130 : 360);
      })();
      return true;
    }
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
    var count = 0;
    for (var j = 0; j < RICH.length; j++) if (bufs[RICH[j].name]) count++;
    return {
      started: rendered,
      count: count,
      total: RICH.length,
      renderMs: renderMs,
      killRenderMs: killRenderMs,
      killStyle: killStyle,
      lastPopRate: lastPopRate,
      buffers: list
    };
  };

})();
