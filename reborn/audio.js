/* Original generative score: felt keys, bowed harmonics, low drums. No assets. */
(function () {
  "use strict";
  class Sound {
    constructor() {
      this.music = 0.35;
      this.effects = 0.65;
      this.muted = false;
      this.next = 0;
      this.step = 0;
      this.lastShot = 0;
      this.active = false;
      this.lastHit = 0;
      this.lastGraze = 0;
    }
    async unlock() {
      try {
        if (!this.ctx) {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          const c = this.ctx;
          this.master = c.createGain();
          this.master.gain.value = 0.7;
          const compressor = c.createDynamicsCompressor();
          compressor.threshold.value = -18;
          compressor.ratio.value = 5;
          this.master.connect(compressor);
          compressor.connect(c.destination);
          this.fx = c.createGain();
          this.song = c.createGain();
          this.fx.connect(this.master);
          this.song.connect(this.master);
          this.delay = c.createDelay(1);
          this.delay.delayTime.value = 0.375;
          this.feedback = c.createGain();
          this.feedback.gain.value = 0.23;
          this.delay.connect(this.feedback);
          this.feedback.connect(this.delay);
          this.wet = c.createGain();
          this.wet.gain.value = 0.12;
          this.delay.connect(this.wet);
          this.wet.connect(this.master);
          this.song.connect(this.delay);
          const len = c.sampleRate * 0.5;
          this.noise = c.createBuffer(1, len, c.sampleRate);
          let a = this.noise.getChannelData(0);
          for (let i = 0; i < len; i++)
            a[i] = (Math.random() * 2 - 1) * (1 - i / len);
          this.next = c.currentTime + 0.1;
          this.settings();
        }
        if (this.ctx.state === "suspended") await this.ctx.resume();
      } catch (e) {
        /* Audio is optional; gameplay remains available. */
      }
    }
    settings() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, t, 0.04);
      this.fx.gain.setTargetAtTime(this.effects, t, 0.04);
      this.song.gain.setTargetAtTime(this.music, t, 0.08);
    }
    tone(
      freq,
      time,
      duration,
      volume,
      type = "sine",
      bus = this.fx,
      end = freq,
    ) {
      if (!this.ctx || volume <= 0) return;
      const c = this.ctx,
        o = c.createOscillator(),
        g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, freq), time);
      o.frequency.exponentialRampToValueAtTime(
        Math.max(20, end),
        time + duration,
      );
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(volume, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      o.connect(g);
      g.connect(bus);
      o.start(time);
      o.stop(time + duration + 0.03);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
    }
    hiss(time, duration, vol, freq = 1800, bus = this.fx) {
      if (!this.ctx) return;
      const c = this.ctx,
        s = c.createBufferSource(),
        f = c.createBiquadFilter(),
        g = c.createGain();
      s.buffer = this.noise;
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = 0.7;
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      s.connect(f);
      f.connect(g);
      g.connect(bus);
      s.start(time);
      s.stop(time + duration);
      s.onended = () => {
        s.disconnect();
        f.disconnect();
        g.disconnect();
      };
    }
    event(e) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      if (e.type === "shot") {
        if (t - this.lastShot < 0.095) return;
        this.lastShot = t;
        const metal = ["ares", "guanyu", "thor", "odin"].includes(e.god);
        const freq =
          {
            ares: 230,
            wukong: 480,
            guanyu: 300,
            zeus: 780,
            artemis: 850,
            aphrodite: 440,
            ra: 660,
            anubis: 185,
            loki: 580,
            odin: 155,
            thor: 120,
            heimdall: 740,
            jade: 520,
            quetz: 390,
          }[e.god] || 440;
        this.tone(
          freq,
          t,
          0.08,
          0.023,
          metal ? "triangle" : "sine",
          this.fx,
          freq * 0.55,
        );
        if (metal) this.hiss(t, 0.045, 0.015, 2400);
      }
      if (e.type === "kill" && t - this.lastHit > 0.045) {
        this.lastHit = t;
        this.tone(95, t, 0.16, 0.09, "sine", this.fx, 34);
        this.hiss(t, 0.12, 0.065, 700);
      }
      if (e.type === "bossKill") {
        this.tone(70, t, 1.3, 0.3, "sine", this.fx, 26);
        this.hiss(t, 0.45, 0.18, 400);
        [220, 330, 440, 660].forEach((f, i) =>
          this.tone(f, t + i * 0.12, 1, 0.1, "sine"),
        );
      }
      if (e.type === "hurt") {
        this.hiss(t, 0.25, 0.2, 450);
        this.tone(170, t, 0.35, 0.13, "triangle", this.fx, 45);
      }
      if (e.type === "dash") {
        this.hiss(t, 0.12, 0.04, 3300);
        this.tone(360, t, 0.14, 0.04, "sine", this.fx, 720);
      }
      if (e.type === "graze" && t - this.lastGraze > 0.08) {
        this.lastGraze = t;
        this.tone(1600, t, 0.06, 0.013);
      }
      if (["special", "ascend"].includes(e.type)) {
        [110, 165, 220, 330, 440].forEach((f, i) =>
          this.tone(
            f,
            t + i * 0.028,
            e.type === "ascend" ? 1.8 : 0.7,
            0.065,
            "triangle",
          ),
        );
        this.hiss(t, 0.3, 0.1, 900);
      }
      if (["buy", "draft", "shop", "wave"].includes(e.type))
        [330, 440, 660].forEach((f, i) =>
          this.tone(f, t + i * 0.08, 0.4, 0.05),
        );
    }
    // Inharmonic upper partials give the keys a struck, felt-like attack.
    key(freq, t, volume = 0.06) {
      this.tone(freq, t, 1.45, volume, "sine", this.song);
      this.tone(freq * 2.003, t, 0.62, volume * 0.19, "sine", this.song);
      this.tone(freq * 3.01, t, 0.17, volume * 0.07, "sine", this.song);
    }
    pad(freq, t, duration, volume) {
      const c = this.ctx;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(volume, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      g.connect(this.song);
      let live = 2;
      for (const detune of [-3, 3]) {
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.detune.value = detune;
        o.connect(g);
        o.start(t);
        o.stop(t + duration + 0.03);
        o.onended = () => {
          o.disconnect();
          if (--live === 0) g.disconnect();
        };
      }
    }
    tick(game, paused) {
      if (!this.ctx || this.ctx.state !== "running") return;
      const c = this.ctx;
      if (paused) {
        this.next = c.currentTime + 0.15;
        return;
      }
      if (this.next < c.currentTime - 0.2) this.next = c.currentTime + 0.03;
      while (this.next < c.currentTime + 0.12) {
        const n = this.step++,
          beat = n % 16,
          bar = Math.floor(n / 16) % 8;
        const sector = game.sector || 0,
          combat = game.state === "playing",
          boss = combat && game.wave === 6;
        const t = this.next;
        const bpm = boss ? 104 : 88,
          step = 60 / bpm / 4;
        const roots = [
          [146.832, 130.813, 110, 130.813, 146.832, 174.614, 130.813, 110],
          [110, 103.826, 130.813, 123.471, 110, 146.832, 130.813, 103.826],
          [
            130.813, 155.563, 116.541, 103.826, 130.813, 174.614, 155.563,
            116.541,
          ],
        ];
        const root = roots[sector][bar],
          wave = game.wave || 0,
          energy = boss
            ? 1
            : combat
              ? [0, 0.25, 0.5, 0.35, 0.7, 0.9][wave] || 0.3
              : 0.12;
        if (beat === 0) {
          this.pad(root, t, step * 18, 0.025);
          this.pad(root * 1.5, t, step * 16, 0.014);
          this.pad(root * 2, t, step * 15, 0.008);
        }
        // Leave rests: the phrase breathes instead of running a constant arpeggio.
        const rhythms = [
          [0, 3, 6, 10, 14],
          [0, 5, 8, 11],
          [0, 2, 7, 10, 15],
          [0, 6, 9, 14],
        ];
        const notes = [
          [12, 7, 3, 10, 7],
          [7, 12, 14, 10, 3],
          [12, 10, 7, 3, 5],
          [7, 5, 3, 0, 7],
        ];
        const ix = rhythms[bar % 4].indexOf(beat);
        if (ix >= 0 && (combat || beat % 2 === 0))
          this.key(
            root * Math.pow(2, notes[(bar + sector) % 4][ix] / 12),
            t,
            0.035 + energy * 0.017,
          );
        if (beat === 0 || beat === 8) {
          this.tone(
            root * 0.5,
            t,
            step * 7,
            0.055 + energy * 0.035,
            "sine",
            this.song,
          );
          this.tone(root, t, 0.2, 0.013, "triangle", this.song);
        }
        if (
          combat &&
          (beat === 0 || beat === 8 || (energy > 0.6 && beat === 11))
        )
          this.tone(80, t, 0.23, 0.07 + energy * 0.045, "sine", this.song, 29);
        if (combat && (beat === 4 || beat === 12)) {
          this.hiss(t, 0.13, 0.012 + energy * 0.023, 1250, this.song);
          this.tone(150, t, 0.13, 0.018, "triangle", this.song, 100);
        }
        if (energy > 0.45 && beat % 2 === 0)
          this.hiss(t, 0.033, 0.009, 6500, this.song);
        if (boss && (beat === 7 || beat === 15)) this.key(root * 4, t, 0.025);
        this.next += step;
      }
    }
  }
  window.RebornSound = Sound;
})();
