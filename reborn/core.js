/* HUBRIS / REBORN — deterministic simulation, independent of DOM and audio. */
(function (root) {
  "use strict";
  const W = 720,
    H = 960,
    TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const GODS = [
    [
      "ares",
      "Ares",
      "Olympus",
      "#ff795e",
      "War blades",
      "Piercing blades. Full heat in 1.5 seconds.",
      "Blade storm",
      "A ring of blades clears nearby fire.",
    ],
    [
      "wukong",
      "Wukong",
      "Celestial Court",
      "#ffc76b",
      "Hair clones",
      "Two companions mirror your shots.",
      "Monkey court",
      "Six clones fire a sweeping volley.",
    ],
    [
      "guanyu",
      "Guan Yu",
      "Celestial Court",
      "#7de6b3",
      "Crescent blades",
      "Wide crescents cut through entire columns.",
      "Moon sweep",
      "A great crescent cuts across the field.",
    ],
    [
      "zeus",
      "Zeus",
      "Olympus",
      "#a7dfff",
      "Chain lightning",
      "Bolts jump to two nearby enemies.",
      "Skyfall",
      "Lightning strikes every enemy.",
    ],
    [
      "artemis",
      "Artemis",
      "Olympus",
      "#d7e8b7",
      "Silver arrows",
      "Fast arrows steer toward your target.",
      "The hunt",
      "A volley of heavy seeking arrows.",
    ],
    [
      "aphrodite",
      "Aphrodite",
      "Olympus",
      "#f8a6be",
      "Heartseeker",
      "Weaving hearts slow enemy fire on hit.",
      "Stillness",
      "Slow all bullets and weaken every enemy.",
    ],
    [
      "ra",
      "Ra",
      "Kemet",
      "#ffde86",
      "Solar lens",
      "A narrow solar stream builds to double damage.",
      "Solar flare",
      "Burn the field with a solar pulse.",
    ],
    [
      "anubis",
      "Anubis",
      "Kemet",
      "#c2adee",
      "Soul scales",
      "Execute ordinary foes below 25% health.",
      "Judgment",
      "Strike all foes; wounded targets take more.",
    ],
    [
      "loki",
      "Loki",
      "Asgard",
      "#a2de88",
      "Stolen fire",
      "Every third volley steals nearby bullets.",
      "Reversal",
      "Turn nearby bullets against their owners.",
    ],
    [
      "odin",
      "Odin",
      "Asgard",
      "#cbd4ef",
      "Rune spear",
      "Heavy spears mark foes for extra damage.",
      "Gungnir",
      "A giant spear pierces the entire column.",
    ],
    [
      "thor",
      "Thor",
      "Asgard",
      "#91b9ed",
      "Mjölnir",
      "Returning hammers strike twice.",
      "Thunderclap",
      "Crush enemies and clear the lower field.",
    ],
    [
      "heimdall",
      "Heimdall",
      "Asgard",
      "#f4d2ae",
      "Bifröst",
      "Five rays spread; focus gathers them.",
      "Gjallarhorn",
      "Push bullets back and expose every foe.",
    ],
    [
      "jade",
      "Jade Emperor",
      "Celestial Court",
      "#b6acf6",
      "Imperial edicts",
      "Seeking seals stun ordinary enemies.",
      "Heaven’s verdict",
      "A heavy seal seeks each enemy.",
    ],
    [
      "quetz",
      "Quetzalcoatl",
      "Fifth Sun",
      "#70d8c8",
      "Feathered serpent",
      "Three streams weave a piercing braid.",
      "Sky serpent",
      "A serpent consumes nearby fire for charge.",
    ],
  ].map(([id, name, court, color, weapon, desc, special, sdesc]) => ({
    id,
    name,
    court,
    color,
    weapon,
    desc,
    special,
    sdesc,
  }));
  const SECTORS = [
    {
      name: "The Bronze Gate",
      boss: "Talos",
      color: "#bc9770",
      sub: "A sentinel at the edge of heaven",
    },
    {
      name: "The Sunken Court",
      boss: "Ammit",
      color: "#78aaa4",
      sub: "Below the river, a heart is weighed",
    },
    {
      name: "The Gilded Throne",
      boss: "Midas",
      color: "#c3a564",
      sub: "Everything has its price",
    },
  ];
  class Game {
    constructor(seed = Date.now()) {
      this.seed = seed >>> 0;
      this.rng = this.seed || 1;
      this.state = "title";
      this.t = 0;
      this.events = [];
      this.enemies = [];
      this.shots = [];
      this.bullets = [];
      this.particles = [];
      this.rings = [];
      this.gold = [];
      this.links = [];
      this.p = { x: W / 2, y: H - 140 };
      this.sector = 0;
      this.shake = 0;
      this.flash = 0;
    }
    random() {
      let x = this.rng;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      this.rng = x >>> 0;
      return this.rng / 4294967296;
    }
    emit(type, data = {}) {
      this.events.push({ type, ...data });
    }
    start(attack, special, mode = "normal") {
      this.rng = this.seed || 1;
      this.t = 0;
      this.events = [];
      this.slowField = 0;
      this.shake = 0;
      this.flash = 0;
      this.attack = GODS.find((g) => g.id === attack) || GODS[0];
      this.specialGod = GODS.find((g) => g.id === special) || GODS[3];
      this.mode = mode;
      this.p = {
        x: W / 2,
        y: H - 140,
        hp: mode === "gentle" ? 5 : 3,
        inv: 2,
        dash: 0,
        dashTime: 0,
        dx: 0,
        dy: -1,
      };
      this.maxhp = this.p.hp;
      this.score = 0;
      this.kills = 0;
      this.grazes = 0;
      this.wallet = 0;
      this.charge = 30;
      this.special = 1;
      this.specialCap = 2;
      this.purchases = {};
      this.heat = 0;
      this.apoth = 0;
      this.mult = 1;
      this.damage = 1;
      this.fireRate = 1;
      this.recharge = 1;
      this.grazeBonus = 1;
      this.level = 1;
      this.sector = 0;
      this.wave = 0;
      this.volley = 0;
      this.fireClock = 0;
      this.elapsed = 0;
      this.nextId = 1;
      this.enemies = [];
      this.shots = [];
      this.bullets = [];
      this.gold = [];
      this.particles = [];
      this.rings = [];
      this.links = [];
      this.nextWave();
    }
    nextWave() {
      this.state = "playing";
      this.wave++;
      this.waveTime = 0;
      this.waveDuration = 34 + this.wave;
      this.spawnClock = 1.5;
      this.spawned = 0;
      this.clearTime = 0;
      this.banner = 3;
      this.p.inv = Math.max(this.p.inv, 1.2);
      this.emit("wave");
      if (this.wave === 6) this.spawnBoss();
    }
    spawnBoss() {
      let hp = [1800, 2600, 3500][this.sector];
      this.enemies.push({
        id: this.nextId++,
        boss: true,
        name: SECTORS[this.sector].boss,
        x: W / 2,
        y: -130,
        baseX: W / 2,
        r: 76,
        hp,
        maxhp: hp,
        age: 0,
        fire: 3,
        beat: 0,
        phase: 0,
        hit: 0,
        mark: 0,
        slow: 0,
        stun: 0,
      });
    }
    spawnFormation() {
      const count = 4 + Math.floor(this.wave / 2),
        kind = (this.spawned + this.sector) % 3;
      const layout = (this.spawned + this.wave + this.sector) % 4;
      for (let i = 0; i < count; i++) {
        const slot = this.spawned % 2 ? count - 1 - i : i;
        const x =
          layout === 1
            ? 155 + (slot * (W - 310)) / (count - 1)
            : 95 + (slot * (W - 190)) / (count - 1);
        const y =
          layout === 0
            ? -70 - i * 28
            : layout === 1
              ? -70 - Math.abs(i - (count - 1) / 2) * 55
              : layout === 2
                ? -70 - (i % 2) * 75
                : -70 - i * 38;
        const hp = (kind === 2 ? 75 : 42) * (1 + this.sector * 0.3);
        this.enemies.push({
          id: this.nextId++,
          x,
          y,
          baseX: x,
          r: kind === 2 ? 25 : 19,
          hp,
          maxhp: hp,
          age: -i * 0.17,
          kind,
          layout,
          fire: 1.7 + i * 0.16,
          beat: 0,
          hit: 0,
          mark: 0,
          slow: 0,
          stun: 0,
        });
      }
      this.spawned++;
    }
    particle(x, y, color, n = 12, speed = 140) {
      for (let i = 0; i < n; i++) {
        const a = this.random() * TAU,
          v = speed * (0.2 + this.random());
        this.particles.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: 0.25 + this.random() * 0.5,
          max: 0.8,
          color,
          size: 1 + this.random() * 3,
        });
      }
      if (this.particles.length > 650)
        this.particles.splice(0, this.particles.length - 650);
    }
    ring(x, y, color, size = 140) {
      this.rings.push({ x, y, color, size, age: 0, life: 0.65 });
    }
    hit(e, amount) {
      if (e.hp <= 0) return;
      const bonus = e.mark > 0 ? 1.25 : 1;
      e.hp -= amount * this.damage * bonus * (this.apoth > 0 ? 1.45 : 1);
      e.hit = 0.07;
      if (this.attack.id === "anubis" && !e.boss && e.hp < e.maxhp * 0.25)
        e.hp = 0;
      if (e.hp <= 0) this.kill(e);
    }
    kill(e) {
      if (e.rewarded) return;
      e.rewarded = true;
      e.hp = 0;
      this.kills++;
      this.score += Math.round((e.boss ? 5000 : 120) * this.mult);
      this.charge = clamp(this.charge + (e.boss ? 20 : 3), 0, 100);
      this.special = clamp(this.special + 0.035, 0, this.specialCap);
      this.particle(
        e.x,
        e.y,
        e.boss ? "#f4cf8c" : "#9dc8c1",
        e.boss ? 85 : 18,
        e.boss ? 330 : 145,
      );
      this.ring(e.x, e.y, e.boss ? "#edc681" : "#829b96", e.boss ? 420 : 75);
      this.shake = Math.max(this.shake, e.boss ? 12 : 2);
      this.emit(e.boss ? "bossKill" : "kill");
      for (let i = 0; i < (e.boss ? 12 : 1); i++)
        this.gold.push({
          x: e.x + (this.random() - 0.5) * 40,
          y: e.y,
          vx: (this.random() - 0.5) * 100,
          vy: -30 - this.random() * 120,
          age: 0,
        });
      if (e.boss) {
        this.bullets.forEach((b) => this.particle(b.x, b.y, "#e8bd79", 2, 60));
        this.bullets = [];
      }
    }
    bullet(x, y, a, speed, kind = 0) {
      if (this.bullets.length >= 750) return;
      this.bullets.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: kind === 1 ? 6 : 4.5,
        kind,
        age: 0,
        grazed: false,
      });
    }
    pattern(e) {
      const slow = this.mode === "gentle" ? 0.8 : 1;
      const speed = (110 + this.sector * 17) * slow;
      if (e.boss) {
        const phase = 1 - Math.max(0, e.hp) / e.maxhp;
        e.phase = phase > 0.66 ? 2 : phase > 0.33 ? 1 : 0;
        e.beat++;
        if (this.sector === 0) {
          const n = 18 + e.phase * 6;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + e.beat * 0.17;
            if (Math.sin(a) > 0.15 || i % 3 === 0)
              this.bullet(e.x, e.y + 25, a, speed, 0);
          }
          if (e.phase > 0)
            for (let i = -2; i <= 2; i++)
              this.bullet(
                e.x,
                e.y,
                Math.atan2(this.p.y - e.y, this.p.x - e.x) + i * 0.15,
                speed * 1.2,
                1,
              );
        } else if (this.sector === 1) {
          for (let i = 0; i < 15; i++) {
            let x = 36 + i * 46;
            if (
              Math.abs(
                x - (180 + Math.sin(e.beat * 0.65) * 100 + e.phase * 90),
              ) > 70
            )
              this.bullet(
                x,
                90,
                Math.PI / 2 + 0.12 * Math.sin(e.beat),
                speed * 0.85,
                1,
              );
          }
          for (let i = 0; i < 12; i++)
            this.bullet(
              e.x,
              e.y,
              (i / 12) * TAU - e.beat * 0.21,
              speed * 0.8,
              0,
            );
        } else {
          for (let arm = 0; arm < 4 + e.phase; arm++)
            for (let j = 0; j < 3; j++)
              this.bullet(
                e.x,
                e.y,
                (arm / (4 + e.phase)) * TAU + e.beat * 0.24 + j * 0.09,
                speed + j * 14,
                j % 2,
              );
        }
        e.fire = 1.25 - e.phase * 0.2;
      } else {
        const aim = Math.atan2(this.p.y - e.y, this.p.x - e.x);
        if (e.kind === 0) {
          for (let i = -1; i <= 1; i++)
            this.bullet(e.x, e.y, Math.PI / 2 + i * 0.32, speed);
        } else if (e.kind === 1) {
          for (let i = 0; i < 9; i++)
            this.bullet(e.x, e.y, (i / 9) * TAU + e.age * 0.15, speed * 0.82);
        } else {
          for (let i = -2; i <= 2; i++)
            this.bullet(e.x, e.y, aim + i * 0.16, speed, 1);
        }
        e.fire = 2.4 - this.sector * 0.2;
      }
    }
    shot(x, y, vx, vy, opts = {}) {
      this.shots.push({
        x,
        y,
        px: x,
        py: y,
        vx,
        vy,
        r: 5,
        damage: 10,
        life: 1.9,
        age: 0,
        pierce: 0,
        color: this.attack.color,
        kind: this.attack.id,
        hitIds: [],
        ...opts,
      });
    }
    fire(focus) {
      const p = this.p,
        g = this.attack.id;
      this.volley++;
      let cd = 0.14;
      const add = (dx, vx = 0, opts = {}) =>
        this.shot(p.x + dx, p.y - 23, vx, -650, opts);
      switch (g) {
        case "ares":
          cd = 0.17;
          for (const side of [-1, 1])
            add(side * 11, side * (focus ? 8 : 35), {
              r: 8,
              damage: 15 + this.heat * 9,
              pierce: 1,
              kind: "blade",
            });
          if (this.heat > 0.96)
            add(0, 0, { r: 10, damage: 17, pierce: 2, kind: "blade" });
          break;
        case "wukong":
          cd = 0.19;
          for (const dx of [-55, 0, 55])
            add(dx, 0, { damage: 11, kind: "staff" });
          break;
        case "guanyu":
          cd = 0.29;
          add(0, 0, {
            r: 29,
            damage: 31,
            pierce: 8,
            kind: "crescent",
            vy: -510,
          });
          break;
        case "zeus":
          cd = 0.21;
          add(0, 0, { damage: 22, r: 8, kind: "bolt" });
          break;
        case "artemis":
          cd = 0.16;
          for (const dx of [-9, 9])
            add(dx, 0, { damage: 13, homing: 5, kind: "arrow", vy: -820 });
          break;
        case "aphrodite":
          cd = 0.22;
          for (const side of [-1, 1])
            add(side * 15, side * (focus ? 8 : 45), {
              damage: 19,
              weave: side * (focus ? 0.4 : 1),
              kind: "heart",
              r: 9,
            });
          break;
        case "ra":
          cd = 0.065;
          add(0, 0, { r: 8, damage: 5 + this.heat * 5, kind: "sun", vy: -950 });
          break;
        case "anubis":
          cd = 0.24;
          for (const side of [-1, 1])
            add(side * 13, side * 10, { damage: 25, kind: "soul", r: 8 });
          break;
        case "loki":
          cd = 0.19;
          for (const side of [-1, 1])
            add(side * 12, side * 20, { damage: 17, kind: "dagger" });
          if (this.volley % 3 === 0) this.steal(95, 3);
          break;
        case "odin":
          cd = 0.36;
          add(0, 0, { r: 9, damage: 49, pierce: 3, kind: "spear" });
          break;
        case "thor":
          cd = 0.34;
          add(0, focus ? 0 : 65 * Math.sin(this.volley), {
            r: 18,
            damage: 42,
            pierce: 6,
            kind: "hammer",
            vy: -540,
            life: 2.3,
          });
          break;
        case "heimdall":
          cd = 0.24;
          for (let i = -2; i <= 2; i++)
            add(i * 6, i * (focus ? 18 : 105), {
              damage: 11,
              kind: "ray",
              color: ["#d4a8ed", "#9dbbe9", "#c4e6de", "#f0d599", "#efa99e"][
                i + 2
              ],
            });
          break;
        case "jade":
          cd = 0.3;
          for (let i = -1; i <= 1; i++)
            add(i * 18, i * 85, {
              damage: 20,
              homing: 4,
              kind: "seal",
              r: 9,
              vy: -490,
            });
          break;
        case "quetz":
          cd = 0.2;
          for (let i = -1; i <= 1; i++)
            add(i * 18, i * 25, {
              damage: 12,
              pierce: 1,
              weave: i || 1,
              kind: "feather",
              r: 7,
            });
          break;
      }
      this.fireClock = cd / this.fireRate;
      this.emit("shot", { god: g });
    }
    steal(radius, count = 100) {
      let taken = 0;
      this.bullets = this.bullets.filter((b) => {
        if (
          taken < count &&
          Math.hypot(b.x - this.p.x, b.y - this.p.y) < radius
        ) {
          taken++;
          this.shot(b.x, b.y, 0, -480, {
            damage: 22,
            homing: 5,
            color: "#a2de88",
            kind: "dagger",
          });
          return false;
        }
        return true;
      });
      return taken;
    }
    useSpecial() {
      if (this.state !== "playing" || this.special < 1) return false;
      this.special -= 1;
      this.p.inv = Math.max(this.p.inv, 0.45);
      const g = this.specialGod.id,
        c = this.specialGod.color,
        p = this.p;
      this.ring(p.x, p.y, c, 330);
      this.shake = 5;
      this.emit("special", { god: g });
      const all = (damage) =>
        this.enemies.forEach((e) => {
          this.hit(e, damage);
          this.links.push({
            x: p.x,
            y: p.y,
            tx: e.x,
            ty: e.y,
            life: 0.35,
            color: c,
          });
        });
      switch (g) {
        case "zeus":
          all(145);
          break;
        case "anubis":
          this.enemies.forEach((e) =>
            this.hit(e, 90 + (1 - e.hp / e.maxhp) * 260),
          );
          break;
        case "aphrodite":
          this.slowField = 5;
          this.enemies.forEach((e) => (e.mark = 7));
          all(65);
          break;
        case "ra":
          all(125);
          this.clearBullets(280);
          break;
        case "loki":
          this.steal(550);
          all(45);
          break;
        case "heimdall":
          this.bullets.forEach((b) => {
            b.vy = -Math.abs(b.vy);
            b.vx *= 1.5;
          });
          this.enemies.forEach((e) => (e.mark = 8));
          all(75);
          break;
        case "quetz": {
          const n = this.clearBullets(400);
          this.charge = clamp(this.charge + n * 0.65, 0, 100);
          all(85);
          break;
        }
        case "thor":
          this.bullets = this.bullets.filter((b) => b.y < H * 0.4);
          all(155);
          break;
        case "guanyu":
          this.shot(W / 2, p.y, 0, -600, {
            r: W * 0.5,
            damage: 220,
            pierce: 99,
            kind: "crescent",
            color: c,
            life: 2,
          });
          break;
        case "odin":
          this.shot(p.x, p.y, 0, -900, {
            r: 62,
            damage: 330,
            pierce: 99,
            kind: "spear",
            color: c,
            life: 2,
          });
          break;
        case "jade":
          this.enemies.forEach((e) =>
            this.shot(p.x, p.y, (e.x - p.x) * 0.6, -400, {
              r: 18,
              damage: 135,
              homing: 9,
              target: e.id,
              kind: "seal",
              color: c,
            }),
          );
          break;
        case "artemis":
          for (let i = 0; i < 12; i++)
            this.shot(p.x, p.y, (i - 5.5) * 45, -550, {
              r: 9,
              damage: 32,
              homing: 7,
              kind: "arrow",
              color: c,
            });
          break;
        case "wukong":
          for (let i = 0; i < 6; i++)
            for (let j = 0; j < 5; j++)
              this.shot(90 + i * 108, p.y + j * 18, (j - 2) * 95, -650, {
                damage: 20,
                kind: "staff",
                color: c,
              });
          break;
        case "ares":
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * TAU;
            this.shot(p.x, p.y, Math.cos(a) * 420, Math.sin(a) * 420, {
              r: 15,
              damage: 55,
              pierce: 4,
              kind: "blade",
              color: c,
            });
          }
          this.clearBullets(240);
          this.heat = 1;
          break;
      }
      return true;
    }
    clearBullets(radius) {
      let n = 0;
      this.bullets = this.bullets.filter((b) => {
        if (Math.hypot(b.x - this.p.x, b.y - this.p.y) < radius) {
          n++;
          this.particle(b.x, b.y, "#e4c98e", 2, 50);
          return false;
        }
        return true;
      });
      this.score += n * 8;
      return n;
    }
    ascend() {
      if (this.state !== "playing" || this.charge < 100 || this.apoth > 0)
        return false;
      this.charge = 0;
      this.apoth = 7;
      this.mult = 3;
      this.p.inv = 1.5;
      this.clearBullets(2000);
      this.ring(this.p.x, this.p.y, "#fff1ba", 900);
      this.shake = 8;
      this.flash = 0.2;
      this.emit("ascend");
      return true;
    }
    dash(dx, dy) {
      if (this.state !== "playing" || this.p.dash > 0) return false;
      const l = Math.hypot(dx, dy) || 1;
      this.p.dx = dx / l;
      this.p.dy = dy / l;
      this.p.dashTime = 0.16;
      this.p.dash = 0.95;
      this.p.inv = Math.max(this.p.inv, 0.24);
      this.emit("dash");
      return true;
    }
    hurt() {
      if (this.p.inv > 0 || this.state !== "playing") return;
      this.p.hp--;
      this.p.inv = 2.2;
      this.shake = 10;
      this.flash = 0.16;
      this.charge = clamp(this.charge + 15, 0, 100);
      this.clearBullets(130);
      this.particle(this.p.x, this.p.y, "#ff967d", 35, 230);
      this.emit("hurt");
      if (this.p.hp <= 0) {
        this.state = "over";
        this.emit("end");
      }
    }
    collectGold() {
      this.gold.forEach((g) => {
        if (!g.dead) {
          this.wallet++;
          this.score += 25;
        }
      });
      this.gold = [];
    }
    draft() {
      if (this.state !== "playing") return;
      this.wallet += this.wave === 6 ? 55 : 12;
      this.state = this.wave === 6 ? "shop" : "draft";
      if (this.state === "shop") {
        this.shopBought = [];
        const a = Math.floor(this.random() * GODS.length),
          b = (a + 5) % GODS.length;
        this.offers = [
          { id: "attack", god: GODS[a] },
          { id: "special", god: GODS[b] },
          { id: "boon", boon: ["tempo", "charge", "graze"][this.sector % 3] },
        ];
      }
      this.bullets = [];
      this.shots = [];
      this.collectGold();
      this.emit(this.state);
    }
    price(id) {
      return (
        {
          repair: 70,
          power: 140,
          capacity: 190,
          attack: 120,
          special: 110,
          boon: 95,
        }[id] +
        (this.purchases[id] || 0) *
          {
            repair: 20,
            power: 60,
            capacity: 80,
            attack: 35,
            special: 35,
            boon: 35,
          }[id]
      );
    }
    buy(id) {
      if (
        this.state !== "shop" ||
        !["repair", "power", "capacity", "attack", "special", "boon"].includes(
          id,
        )
      )
        return false;
      if (id === "repair" && this.p.hp >= this.maxhp) return false;
      if (id === "capacity" && this.specialCap >= 4) return false;
      if (
        ["attack", "special", "boon"].includes(id) &&
        this.shopBought.includes(id)
      )
        return false;
      const cost = this.price(id);
      if (this.wallet < cost) return false;
      this.wallet -= cost;
      this.purchases[id] = (this.purchases[id] || 0) + 1;
      if (id === "repair") this.p.hp++;
      if (id === "power") this.damage += 0.25;
      if (id === "capacity") {
        this.specialCap++;
        this.special = Math.min(this.specialCap, this.special + 1);
      }
      if (["attack", "special", "boon"].includes(id)) {
        this.shopBought.push(id);
        const offer = this.offers.find((o) => o.id === id);
        if (id === "attack") {
          if (this.attack.id === offer.god.id) this.damage += 0.2;
          else {
            this.attack = offer.god;
            this.heat = 0;
          }
        }
        if (id === "special") {
          if (this.specialGod.id === offer.god.id) this.recharge += 0.35;
          else this.specialGod = offer.god;
        }
        if (id === "boon") this.applyBoon(offer.boon);
      }
      this.emit("buy");
      return true;
    }
    leaveShop() {
      if (this.state !== "shop" || this.sector >= SECTORS.length - 1) return;
      this.sector++;
      this.wave = 0;
      this.p.hp = Math.min(this.maxhp, this.p.hp + 1);
      this.nextWave();
    }
    applyBoon(id) {
      switch (id) {
        case "power":
          this.damage += 0.12;
          break;
        case "tempo":
          this.fireRate += 0.08;
          break;
        case "charge":
          this.recharge += 0.2;
          break;
        case "graze":
          this.grazeBonus += 0.35;
          break;
        case "repair":
          this.p.hp = Math.min(this.maxhp, this.p.hp + 1);
          this.charge = clamp(this.charge + 20, 0, 100);
          break;
      }
    }
    choose(id) {
      if (
        this.state !== "draft" ||
        !["power", "tempo", "charge", "graze", "repair"].includes(id)
      )
        return;
      this.applyBoon(id);
      this.level++;
      this.nextWave();
    }
    update(dt, input = {}) {
      dt = clamp(dt, 0, 0.034);
      if (this.state !== "playing") return;
      this.t += dt;
      this.elapsed += dt;
      this.waveTime += dt;
      this.banner = Math.max(0, this.banner - dt);
      this.shake = Math.max(0, this.shake - dt * 25);
      this.flash = Math.max(0, this.flash - dt);
      this.slowField = Math.max(0, (this.slowField || 0) - dt);
      this.apoth = Math.max(0, this.apoth - dt);
      this.mult = this.apoth > 0 ? 3 : 1;
      this.special = clamp(
        this.special + dt * 0.085 * this.recharge,
        0,
        this.specialCap,
      );
      const p = this.p;
      p.inv = Math.max(0, p.inv - dt);
      p.dash = Math.max(0, p.dash - dt);
      p.dashTime = Math.max(0, p.dashTime - dt);
      let dx = input.x || 0,
        dy = input.y || 0,
        l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      if (input.dash) this.dash(dx || (!dy ? 0 : dx), dy || (!dx ? -1 : dy));
      if (p.dashTime > 0) {
        dx = p.dx;
        dy = p.dy;
        this.particle(p.x, p.y, "#b6ebe0", 2, 35);
      }
      const speed = p.dashTime > 0 ? 960 : input.focus ? 150 : 340;
      p.x = clamp(p.x + dx * speed * dt, 24, W - 24);
      p.y = clamp(p.y + dy * speed * dt, 70, H - 30);
      if (input.special) this.useSpecial();
      if (input.ascend) this.ascend();
      this.heat = clamp(
        this.heat + (input.fire === false ? -dt * 0.3 : dt / 1.5),
        0,
        1,
      );
      this.fireClock -= dt;
      if (input.fire !== false && this.fireClock <= 0) this.fire(input.focus);
      if (this.wave < 6 && this.spawned < 6) {
        this.spawnClock -= dt;
        if (this.spawnClock <= 0) {
          this.spawnFormation();
          this.spawnClock = 6.0;
        }
      }
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        e.age += dt;
        e.hit = Math.max(0, e.hit - dt);
        e.mark = Math.max(0, e.mark - dt);
        e.slow = Math.max(0, e.slow - dt);
        e.stun = Math.max(0, e.stun - dt);
        if (e.boss) {
          e.y += (170 - e.y) * dt * 1.4;
          e.x = W / 2 + Math.sin(e.age * 0.57) * (100 + e.phase * 25);
        } else if (e.stun <= 0) {
          e.y += dt * (e.age < 2 ? 115 : e.age < 8 ? 18 : 135);
          e.x =
            e.baseX +
            Math.sin(
              e.age * (e.layout === 3 ? 0.8 : 1.4) +
                (e.layout === 1 ? 0 : e.id),
            ) *
              (e.layout === 3 ? 70 : 45);
        }
        e.fire -= dt * (e.slow > 0 ? 0.5 : 1);
        if (e.fire <= 0 && e.y > 40 && e.y < H - 170 && e.stun <= 0)
          this.pattern(e);
        if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + 4) this.hurt();
      }
      for (const s of this.shots) {
        s.age += dt;
        s.life -= dt;
        s.px = s.x;
        s.py = s.y;
        if (s.homing) {
          const target = this.enemies
            .filter((e) => e.hp > 0 && (!s.target || e.id === s.target))
            .sort(
              (a, b) =>
                Math.hypot(a.x - s.x, a.y - s.y) -
                Math.hypot(b.x - s.x, b.y - s.y),
            )[0];
          if (target) {
            const a = Math.atan2(target.y - s.y, target.x - s.x),
              v = Math.hypot(s.vx, s.vy);
            s.vx += (Math.cos(a) * v - s.vx) * Math.min(1, dt * s.homing);
            s.vy += (Math.sin(a) * v - s.vy) * Math.min(1, dt * s.homing);
          }
        }
        if (s.kind === "hammer" && s.age > 0.62) {
          s.vy += dt * 1100;
          if (s.vy >= 0 && !s.returning) {
            s.returning = true;
            s.hitIds = [];
          }
        }
        if (s.weave) s.vx += Math.cos(s.age * 13) * s.weave * dt * 900;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        for (const e of this.enemies) {
          if (e.hp <= 0 || s.hitIds.includes(e.id)) continue;
          const vx = s.x - s.px,
            vy = s.y - s.py,
            den = vx * vx + vy * vy;
          const u = den
            ? clamp(((e.x - s.px) * vx + (e.y - s.py) * vy) / den, 0, 1)
            : 0;
          if (Math.hypot(s.px + u * vx - e.x, s.py + u * vy - e.y) > s.r + e.r)
            continue;
          this.hit(e, s.damage);
          s.hitIds.push(e.id);
          if (s.kind === "bolt") {
            let others = this.enemies
              .filter(
                (o) =>
                  o !== e && o.hp > 0 && Math.hypot(o.x - e.x, o.y - e.y) < 200,
              )
              .slice(0, 2);
            others.forEach((o) => {
              this.hit(o, s.damage * 0.6);
              this.links.push({
                x: e.x,
                y: e.y,
                tx: o.x,
                ty: o.y,
                life: 0.14,
                color: s.color,
              });
            });
          }
          if (s.kind === "spear") e.mark = 4;
          if (s.kind === "heart") e.slow = 2;
          if (s.kind === "seal" && !e.boss) e.stun = 0.35;
          this.particle(s.x, s.y, s.color, 3, 70);
          if (s.pierce-- <= 0) {
            s.life = 0;
            break;
          }
        }
      }
      for (const b of this.bullets) {
        b.age += dt;
        const slow = this.slowField > 0 ? 0.32 : 1;
        b.x += b.vx * dt * slow;
        b.y += b.vy * dt * slow;
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < b.r + 4) {
          this.hurt();
          b.dead = true;
        } else if (d < 29 && !b.grazed) {
          b.grazed = true;
          this.grazes++;
          this.charge = clamp(this.charge + 1.7 * this.grazeBonus, 0, 100);
          this.score += 20 * this.mult;
          this.particle(p.x, p.y, "#b7e1d5", 3, 90);
          this.emit("graze");
        }
      }
      for (const g of this.gold) {
        g.age += dt;
        g.vy += dt * 100;
        if (g.age > 0.35) {
          const a = Math.atan2(p.y - g.y, p.x - g.x);
          g.vx += (Math.cos(a) * 570 - g.vx) * dt * 5;
          g.vy += (Math.sin(a) * 570 - g.vy) * dt * 5;
        }
        g.x += g.vx * dt;
        g.y += g.vy * dt;
        if (Math.hypot(p.x - g.x, p.y - g.y) < 22) {
          g.dead = true;
          this.wallet++;
          this.score += 25 * this.mult;
          this.charge = clamp(this.charge + 0.35, 0, 100);
        }
      }
      for (const f of this.particles) {
        f.life -= dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vx *= 0.98;
        f.vy *= 0.98;
      }
      this.particles = this.particles.filter((f) => f.life > 0);
      this.rings.forEach((r) => (r.age += dt));
      this.rings = this.rings.filter((r) => r.age < r.life);
      this.links.forEach((r) => (r.life -= dt));
      this.links = this.links.filter((r) => r.life > 0);
      this.enemies = this.enemies.filter((e) => e.hp > 0 && e.y < H + 100);
      this.shots = this.shots.filter(
        (s) =>
          s.life > 0 &&
          s.y > -130 &&
          s.y < H + 150 &&
          s.x > -400 &&
          s.x < W + 400,
      );
      this.bullets = this.bullets.filter(
        (b) =>
          !b.dead && b.x > -40 && b.x < W + 40 && b.y > -60 && b.y < H + 40,
      );
      this.gold = this.gold.filter((g) => !g.dead && g.age < 8);
      if (
        this.state === "playing" &&
        this.enemies.length === 0 &&
        (this.wave === 6 ||
          (this.spawned >= 6 && this.waveTime >= this.waveDuration))
      ) {
        this.clearTime += dt;
        if (this.clearTime > 1.3) {
          if (this.wave === 6 && this.sector === 2) {
            this.wallet += 55;
            this.collectGold();
            this.state = "win";
            this.emit("end");
          } else this.draft();
        }
      } else this.clearTime = 0;
    }
  }
  const api = { Game, GODS, SECTORS, W, H, clamp };
  if (typeof module !== "undefined") module.exports = api;
  else root.Reborn = api;
})(typeof window !== "undefined" ? window : globalThis);
