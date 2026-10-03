/* HUBRIS: luminous combat over a quiet, continuously travelling abstract world.
   Combat shapes are authored here; local SVG scenery needs no server. */
(function () {
  "use strict";
  const { W, H, SECTORS } = Reborn,
    TAU = Math.PI * 2,
    COOL = "#5fe6ff",
    HOT = "#ff5a79";
  const ROUTES = [
    ["OPEN WATER", "BREAKWATER", "THE STRAIT", "FORGE CHANNEL", "THE GATE"],
    ["NIGHT RIVER", "THE REEDS", "SUNKEN AVENUE", "DEEP WATER", "THE SCALES"],
    ["CLOUD SEA", "JADE BRIDGE", "THE COURT", "HIGH TERRACES", "THE THRONE"],
  ];
  class Painter {
    constructor(canvas) {
      this.canvas = canvas;
      this.c = canvas.getContext("2d", { alpha: false });
      this.clock = 0;
      this.travel = 0;
      this.stage = 0;
      this.bank = 0;
      this.lastX = null;
      this.plates =
        typeof Image === "undefined"
          ? []
          : ["coast", "river", "court"].map((name) => {
              const img = new Image();
              img.src = "reborn/assets/" + name + "-minimal.svg";
              return img;
            });
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.resize();
    }
    resize() {
      const d = Math.min(devicePixelRatio || 1, 2),
        r = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.round(r.width * d);
      this.canvas.height = Math.round(r.height * d);
      this.sx = this.canvas.width / W;
      this.sy = this.canvas.height / H;
    }
    path(points, fill, stroke, width = 1) {
      const c = this.c;
      c.beginPath();
      points.forEach((p, i) => (i ? c.lineTo(...p) : c.moveTo(...p)));
      c.closePath();
      if (fill) {
        c.fillStyle = fill;
        c.fill();
      }
      if (stroke) {
        c.strokeStyle = stroke;
        c.lineWidth = width;
        c.stroke();
      }
    }
    circle(x, y, r, color, width) {
      const c = this.c;
      c.beginPath();
      c.arc(x, y, Math.max(0.1, r), 0, TAU);
      if (width) {
        c.strokeStyle = color;
        c.lineWidth = width;
        c.stroke();
      } else {
        c.fillStyle = color;
        c.fill();
      }
    }
    line(x, y, tx, ty, color, w = 1) {
      const c = this.c;
      c.strokeStyle = color;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(tx, ty);
      c.stroke();
    }
    backdrop(g, t) {
      const c = this.c,
        s = g.sector || 0,
        stage = this.stage,
        travel = this.travel;
      c.fillStyle = "#020509";
      c.fillRect(0, 0, W, H);
      const tint = ["#17414b", "#173d46", "#24394b"][s],
        density = Math.max(0.38, 1 - (g.bullets?.length || 0) / 340);
      c.save();
      c.globalAlpha = density;
      const wash = c.createRadialGradient(W / 2, 230, 15, W / 2, 280, 620);
      wash.addColorStop(0, tint + "55");
      wash.addColorStop(1, "#02050900");
      c.fillStyle = wash;
      c.fillRect(0, 0, W, H);
      // Widely spaced contours carry movement; the central firing channel stays quiet.
      for (let i = -1; i < 9; i++) {
        const y = ((i * 151 + travel * 0.38) % 1250) - 130;
        const sway = Math.sin(i * 2.13 + t * 0.12) * 18;
        if (s === 0) {
          for (const side of [-1, 1]) {
            const x = side < 0 ? 0 : W;
            c.beginPath();
            c.moveTo(x, y);
            c.bezierCurveTo(
              x + side * 48,
              y - 18,
              x + side * 95,
              y + 25,
              x + side * (135 + 18 * Math.sin(i)),
              y + 9,
            );
            c.strokeStyle = "#43869322";
            c.lineWidth = 1;
            c.stroke();
          }
        }
        if (s === 1) {
          c.beginPath();
          c.ellipse(W / 2 + sway, y, 130 + (i % 3) * 42, 15, 0, 0, Math.PI);
          c.strokeStyle = "#47878b14";
          c.lineWidth = 1;
          c.stroke();
        }
        if (s === 2) {
          this.line(0, y, 105, y - 30, "#74859e1c");
          this.line(W, y, W - 105, y - 30, "#74859e1c");
        }
      }
      // Each sector has five destinations. Geometry grows from open edges to a threshold.
      for (let i = -1; i < 6; i++) {
        const y = i * 235 + (travel % 235),
          seed = i + Math.floor(travel / 235),
          offset = stage < 1 ? 32 : 72 + stage * 7;
        for (const side of [-1, 1]) {
          c.save();
          c.translate(side < 0 ? 0 : W, y);
          c.scale(side < 0 ? 1 : -1, 1);
          if (s === 0) {
            const reach = offset + Math.sin(seed * 2.7) * 15;
            this.path(
              [
                [0, -82],
                [reach - 17, -63],
                [reach, -17],
                [reach - 24, 53],
                [0, 75],
              ],
              "#0a151c",
              "#23414b65",
            );
            if (stage > 1.1) {
              this.path(
                [
                  [17, -43],
                  [40, -43],
                  [40, 39],
                  [17, 51],
                ],
                "#0e2027",
              );
              this.line(40, -43, 40, 39, "#65b8c044");
            }
            if (stage > 2.8) {
              this.line(0, -71, reach - 17, -52, "#ff826138", 2);
              this.line(reach - 17, -52, reach - 8, -20, "#ff826120");
            }
          }
          if (s === 1) {
            if (stage < 1.8) {
              for (let j = 0; j < 4; j++) {
                const x = 18 + j * 13;
                this.line(
                  x,
                  51,
                  x + Math.sin(t * 0.5 + j) * 5,
                  -17 - j * 12,
                  "#30535766",
                  2,
                );
              }
            } else {
              this.path(
                [
                  [10, -78],
                  [52, -78],
                  [52, 76],
                  [10, 76],
                ],
                "#0b1c23",
              );
              this.line(52, -78, 52, 76, "#447c844a");
              this.line(10, -69, 52, -69, "#447c844a");
            }
          }
          if (s === 2) {
            const reach = 55 + stage * 11;
            this.path(
              [
                [0, -65],
                [reach, -92],
                [reach, 42],
                [0, 71],
              ],
              "#101b26",
              "#526b8430",
            );
            this.line(reach, -92, reach, 42, "#7e91b039");
            if (stage > 2) this.line(8, -51, reach - 12, -75, "#a798c030");
          }
          c.restore();
        }
      }
      const plate = this.plates[s];
      if (plate && plate.complete && plate.naturalWidth) {
        c.globalAlpha = density * 0.35;
        const py = ((travel * 0.55) % 1920) - 960;
        c.drawImage(plate, 0, py, W, H);
        c.globalAlpha = density;
      }
      // Landmark passes at the same world speed, never sweeps over combat as a transition.
      const bridgeY = ((travel * 0.7) % 1500) - 250;
      if (stage > 1.7 && stage < 4.8) {
        c.globalAlpha = density * 0.55;
        this.line(0, bridgeY, 143, bridgeY - 45, "#446170", 8);
        this.line(W, bridgeY, W - 143, bridgeY - 45, "#446170", 8);
        c.globalAlpha = density;
      }
      if (stage > 3.2) {
        const a = Math.min(1, (stage - 3.2) / 1.4);
        c.globalAlpha = density * a;
        this.circle(W / 2, 170, 250, "#46616d25", 1);
        this.circle(W / 2, 170, 262, "#46616d12", 1);
        for (const side of [-1, 1]) {
          this.line(W / 2 + side * 236, 0, W / 2 + side * 236, H, "#617f8920");
          this.line(
            W / 2 + side * 243,
            80,
            W / 2 + side * 243,
            260,
            "#ab71843a",
            2,
          );
        }
        c.globalAlpha = density;
      }
      const weather = stage > 2.7 ? 24 : 12;
      for (let i = 0; i < weather; i++) {
        const x = (((i * 137.73 + Math.sin(i * 32) * 95) % W) + W) % W,
          y = (i * 93.1 + travel * (s === 1 ? 0.9 : 1.35)) % H;
        c.globalAlpha = density * (0.12 + (i % 3) * 0.04);
        if (s === 1) this.line(x, y, x - 3, y + 13, "#8ebdce");
        else
          this.circle(
            x,
            y,
            i % 4 === 0 ? 1.1 : 0.6,
            s === 0 && stage > 2.8 ? "#ff9b7d" : "#9fc4de",
          );
      }
      c.restore();
    }
    sigil(x, y, r, color, index = 0) {
      const c = this.c;
      c.save();
      c.translate(x, y);
      c.rotate(index * 0.6);
      const n = 3 + (index % 3);
      const p = [];
      for (let i = 0; i < n; i++)
        p.push([Math.sin((i / n) * TAU) * r, Math.cos((i / n) * TAU) * r]);
      this.path(p, null, color, 1);
      this.circle(0, 0, 2, color);
      c.restore();
    }
    ship(x, y, t, color = COOL, ghost = false) {
      const c = this.c;
      c.save();
      c.translate(x, y);
      c.rotate(this.bank);
      if (ghost) c.globalAlpha = 0.24;
      c.shadowColor = COOL;
      c.shadowBlur = 9;
      const flame = 23 + Math.sin(t * 33) * 4;
      this.path(
        [
          [-4, 12],
          [0, flame + 16],
          [4, 12],
        ],
        "#5fe6ff35",
      );
      this.line(0, 12, 0, flame, COOL, 2);
      this.path(
        [
          [0, -24],
          [20, 17],
          [6, 11],
          [0, 15],
          [-6, 11],
          [-20, 17],
        ],
        "#09212d",
        COOL,
        1.5,
      );
      this.line(-13, 10, -5, 5, "#b2f4ff");
      this.line(13, 10, 5, 5, "#b2f4ff");
      c.shadowBlur = 0;
      this.circle(0, 0, 5, "#031017");
      this.circle(0, 0, 2.8, "#efffff");
      c.restore();
    }
    enemy(e, t, sector) {
      const c = this.c;
      c.save();
      c.translate(e.x, e.y);
      const color = ["#ff795f", "#ff6b98", "#ff9878"][sector];
      c.shadowColor = color;
      c.shadowBlur = e.hit > 0 ? 16 : 7;
      if (e.boss) {
        const breathe = 1 + Math.sin(t * 1.8) * 0.018;
        c.scale(breathe, breathe);
        if (sector === 0) {
          // TALOS: a split sentinel ring, one molten heart.
          for (const side of [-1, 1]) {
            c.save();
            c.scale(side, 1);
            this.path(
              [
                [14, -73],
                [55, -57],
                [83, -11],
                [65, 48],
                [26, 69],
                [35, 43],
                [51, 20],
                [56, -10],
                [38, -41],
                [14, -50],
              ],
              "#201019",
              color,
              2,
            );
            c.restore();
          }
          this.path(
            [
              [0, -34],
              [23, 0],
              [0, 38],
              [-23, 0],
            ],
            "#401421",
            color,
            2,
          );
          this.line(0, -18, 0, 18, "#ffdce2", 3);
        } else if (sector === 1) {
          // AMMIT: forked jaws and a suspended judgment point.
          for (const side of [-1, 1]) {
            c.save();
            c.scale(side, 1);
            this.path(
              [
                [9, -51],
                [37, -77],
                [64, -44],
                [73, 24],
                [42, 61],
                [20, 18],
                [43, 32],
                [49, -25],
                [28, -38],
              ],
              "#231022",
              color,
              2,
            );
            c.restore();
          }
          this.path(
            [
              [0, -24],
              [15, 0],
              [0, 54],
              [-15, 0],
            ],
            "#47172c",
            color,
            1.5,
          );
          this.circle(0, 0, 5, "#ffe5ef");
        } else {
          // MIDAS: a single open crown above a sharp, empty throne.
          this.path(
            [
              [-78, -60],
              [-42, -34],
              [-25, -78],
              [0, -42],
              [25, -78],
              [42, -34],
              [78, -60],
              [56, 4],
              [-56, 4],
            ],
            "#27141d",
            color,
            2,
          );
          this.path(
            [
              [-49, 19],
              [0, 76],
              [49, 19],
              [21, 25],
              [0, 48],
              [-21, 25],
            ],
            "#27141d",
            color,
            2,
          );
          this.line(-21, -10, 21, -10, "#ffe0dc", 3);
        }
        c.shadowBlur = 0;
        c.save();
        c.rotate(t * 0.09);
        c.beginPath();
        c.arc(0, 0, 100, 0.1, Math.PI - 0.1);
        c.arc(0, 0, 100, Math.PI + 0.1, TAU - 0.1);
        c.strokeStyle = color + "45";
        c.lineWidth = 1;
        c.stroke();
        c.restore();
      } else {
        c.rotate(Math.sin(e.age * 1.7) * 0.08);
        const opening = Math.max(0, 1 - (e.fire || 0) / 0.45) * 4;
        if (e.kind === 0)
          this.path(
            [
              [0, 23],
              [-21, -15],
              [0, -5],
              [21, -15],
            ],
            "#28111c",
            color,
            1.5,
          );
        if (e.kind === 1) {
          c.save();
          c.rotate(e.age * 0.35);
          this.path(
            [
              [0, -25],
              [24, 0],
              [0, 25],
              [-24, 0],
            ],
            "#251322",
            color,
            1.5,
          );
          c.restore();
          this.circle(0, 0, 6, color, 1.5);
        }
        if (e.kind === 2) {
          for (const side of [-1, 1]) {
            c.save();
            c.scale(side, 1);
            this.path(
              [
                [5 + opening, -19],
                [23 + opening, -12],
                [28 + opening, 15],
                [13 + opening, 23],
                [7 + opening, 6],
              ],
              "#2d1520",
              color,
              1.5,
            );
            c.restore();
          }
          this.line(0, -15, 0, 15, color, 3);
        }
        this.circle(0, 1, 2.5, "#ffdde4");
      }
      c.shadowBlur = 0;
      if (e.fire < 0.35 && e.fire > 0) {
        this.circle(0, e.boss ? 48 : 14, e.boss ? 17 : 8, "#ffb3bc", 1);
        this.circle(
          0,
          e.boss ? 48 : 14,
          (e.boss ? 12 : 5) * (1 - e.fire / 0.35),
          "#fff1f0",
        );
      }
      if (e.hit > 0) {
        c.globalAlpha = 0.35;
        this.circle(0, 0, e.r, "#fff0ee");
        c.globalAlpha = 1;
      }
      if (e.mark > 0) this.circle(0, 0, e.r + 8, "#aeeaff77", 1);
      c.restore();
      if (!e.boss && e.hp < e.maxhp) {
        this.line(
          e.x - 14,
          e.y - e.r - 9,
          e.x + 14,
          e.y - e.r - 9,
          "#25202c",
          2,
        );
        this.line(
          e.x - 14,
          e.y - e.r - 9,
          e.x - 14 + (28 * e.hp) / e.maxhp,
          e.y - e.r - 9,
          color,
          2,
        );
      }
    }
    projectile(s) {
      const c = this.c;
      c.save();
      c.translate(s.x, s.y);
      c.rotate(Math.atan2(s.vy, s.vx) + Math.PI / 2);
      const col = COOL;
      c.shadowColor = col;
      c.shadowBlur = 5;
      c.globalAlpha = 0.82;
      if (s.kind === "crescent") {
        const r = s.r;
        c.beginPath();
        c.arc(0, 0, r, Math.PI, TAU);
        c.quadraticCurveTo(0, -r * 0.35, -r, 0);
        c.fillStyle = col;
        c.fill();
      } else if (s.kind === "hammer") {
        c.rotate(s.age * 13);
        this.line(0, -8, 0, 17, col, 3);
        this.path(
          [
            [-10, -14],
            [10, -14],
            [10, -3],
            [-10, -3],
          ],
          "#a7edff",
        );
      } else if (s.kind === "seal") {
        c.rotate(s.age * 5);
        this.path(
          [
            [0, -s.r],
            [s.r, 0],
            [0, s.r],
            [-s.r, 0],
          ],
          "#103748",
          col,
          1.5,
        );
      } else if (s.kind === "heart") {
        this.path(
          [
            [0, 10],
            [-10, -2],
            [-6, -8],
            [0, -3],
            [6, -8],
            [10, -2],
          ],
          col,
        );
      } else if (
        s.kind === "spear" ||
        s.kind === "blade" ||
        s.kind === "arrow"
      ) {
        const r = s.r;
        this.path(
          [
            [0, -r * 2.5],
            [-r * 0.55, 0],
            [0, r],
            [r * 0.55, 0],
          ],
          col,
        );
      } else if (s.kind === "bolt") {
        this.path(
          [
            [3, -15],
            [-5, 0],
            [1, -1],
            [-2, 14],
            [6, -4],
            [1, -3],
          ],
          col,
        );
      } else {
        this.line(0, 8, 0, -10, col, s.kind === "sun" ? 6 : 3);
        this.line(0, 2, 0, -9, "#edffff", 1);
      }
      c.restore();
    }
    render(g, dt) {
      this.clock += this.reduced ? dt * 0.2 : dt;
      const t = this.clock,
        c = this.c,
        active = g.state === "playing";
      this.travel += dt * (active ? 22 : 4) * (this.reduced ? 0.25 : 1);
      const target = Math.max(0, (g.wave || 1) - 1);
      this.stage += (target - this.stage) * Math.min(1, dt * 0.35);
      if (g.p) {
        const dx = this.lastX === null ? 0 : g.p.x - this.lastX;
        this.bank +=
          (Math.max(-0.2, Math.min(0.2, dx * 0.016)) - this.bank) *
          Math.min(1, dt * 12);
        this.lastX = g.p.x;
      }
      c.setTransform(this.sx, 0, 0, this.sy, 0, 0);
      c.save();
      if (!this.reduced && g.shake > 0)
        c.translate(
          Math.sin(t * 130) * Math.min(5, g.shake),
          Math.cos(t * 173) * Math.min(3, g.shake * 0.4),
        );
      this.backdrop(g, t);
      if (g.state === "title" || g.state === "select") {
        const e = {
          x: W / 2,
          y: 340,
          boss: true,
          age: t,
          hp: 1,
          maxhp: 1,
          fire: 2,
        };
        c.save();
        c.globalAlpha = 0.6;
        this.enemy(e, t, 0);
        c.restore();
        this.ship(W / 2, 700 + Math.sin(t) * 5, t);
      } else {
        for (const r of g.rings) {
          const f = r.age / r.life;
          c.globalAlpha = (1 - f) * 0.35;
          this.circle(r.x, r.y, r.size * (1 - Math.pow(1 - f, 3)), COOL, 1.5);
        }
        c.globalAlpha = 1;
        for (const s of g.shots) this.projectile(s);
        for (const e of g.enemies) this.enemy(e, t, g.sector);
        for (const l of g.links) {
          c.globalAlpha = Math.min(0.8, l.life * 5);
          c.beginPath();
          c.moveTo(l.x, l.y);
          for (let i = 1; i < 7; i++)
            c.lineTo(
              l.x + ((l.tx - l.x) * i) / 7 + Math.sin(i * 43 + t * 70) * 8,
              l.y + ((l.ty - l.y) * i) / 7,
            );
          c.lineTo(l.tx, l.ty);
          c.strokeStyle = COOL;
          c.lineWidth = 1.5;
          c.stroke();
        }
        c.globalAlpha = 1;
        for (const f of g.particles) {
          c.globalAlpha = Math.min(0.65, f.life * 1.5);
          this.line(
            f.x,
            f.y,
            f.x - f.vx * 0.03,
            f.y - f.vy * 0.03,
            f.color,
            Math.min(2, f.size),
          );
        }
        c.globalAlpha = 1;
        for (const v of g.gold) {
          c.save();
          c.translate(v.x, v.y);
          c.scale(0.65 + Math.sin(t * 3 + v.age) * 0.25, 1);
          this.path(
            [
              [0, -5],
              [4, 0],
              [0, 5],
              [-4, 0],
            ],
            "#ffd766",
          );
          c.restore();
        }
        const p = g.p;
        if (g.attack?.id === "wukong")
          for (const side of [-1, 1])
            this.ship(p.x + side * 55, p.y + 8, t, COOL, true);
        if (p.inv <= 0 || Math.floor(t * 18) % 2 === 0) this.ship(p.x, p.y, t);
        if (g.apoth > 0)
          this.circle(p.x, p.y, 36 + Math.sin(t * 4) * 2, "#b5f1ff88", 1);
        if (g.focus) {
          this.circle(p.x, p.y, 24, "#5fe6ff38", 1);
          this.circle(p.x, p.y, 5, "#021017");
          this.circle(p.x, p.y, 2.8, "#fff");
        }
        // Danger always has the last word: saturated warm rims, crisp light cores.
        for (const b of g.bullets) {
          c.save();
          c.translate(b.x, b.y);
          c.rotate(Math.atan2(b.vy, b.vx));
          if (b.kind === 1) {
            this.path(
              [
                [-10, 0],
                [0, -5],
                [10, 0],
                [0, 5],
              ],
              HOT,
            );
            this.path(
              [
                [-5, 0],
                [0, -2],
                [5, 0],
                [0, 2],
              ],
              "#fff0f2",
            );
          } else {
            this.circle(0, 0, 6, "#ff5a7940");
            this.circle(0, 0, 4.5, HOT);
            this.circle(0, 0, 2.1, "#ffe7ed");
          }
          c.restore();
        }
        if (g.banner > 0) {
          c.globalAlpha = Math.min(1, g.banner) * 0.85;
          c.textAlign = "center";
          c.fillStyle = "#81bac9";
          c.font = "11px monospace";
          c.fillText(
            g.wave === 6
              ? "GUARDIAN"
              : `${g.sector + 1} / ${g.wave}   ${ROUTES[g.sector][Math.min(4, g.wave - 1)]}`,
            W / 2,
            370,
          );
          c.font = "500 26px sans-serif";
          c.fillStyle = "#e8f4f7";
          c.fillText(
            g.wave === 6 ? SECTORS[g.sector].boss : SECTORS[g.sector].name,
            W / 2,
            405,
          );
          c.globalAlpha = 1;
        }
      }
      c.restore();
      if (g.flash > 0 && !this.reduced) {
        c.fillStyle = `rgba(120,225,255,${Math.min(0.13, g.flash * 0.3)})`;
        c.fillRect(0, 0, W, H);
      }
    }
  }
  window.RebornPainter = Painter;
})();
