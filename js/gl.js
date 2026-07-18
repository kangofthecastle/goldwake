// gl.js — WebGL2 renderer for Goldwake.
// Exposes window.GL. Pure static, no modules. Procedural atlas, instanced
// additive sprite batcher, and a threshold+separable-gaussian bloom pipeline
// with a chromatic-offset composite (driven for the Vaunt pulse).
(function () {
  'use strict';

  var GL = {};
  window.GL = GL;

  // Logical playfield (all game math lives here). Portrait.
  GL.W = 1080;
  GL.H = 1920;

  // Sprite ids -> atlas region index.
  GL.SPR = {
    GLOW: 0,        // soft radial glow disc
    CORE: 1,        // hard bright core disc
    RING: 2,        // hollow ring
    SPARK: 3,       // small four-point spark
    STREAK: 4,      // elongated streak (shots / trails)
    GOLD: 5,        // tumbling gold shard (diamond)
    NEEDLE: 6,      // thin vertical needle (fast aimed shots)
    RINGBULLET: 7,  // thicker ring bullet
    SHIP_PLAYER: 8,
    SHIP_POP: 9,    // popcorn darter
    SHIP_GUN: 10,   // gunship
    SHIP_MID: 11,   // warden / midboss
    SHIP_BOSS: 12   // gilded sovereign
  };

  var gl = null;
  var glCanvas = null;

  // ---- shader sources -------------------------------------------------------

  var VS_SPRITE =
'#version 300 es\n' +
'layout(location=0) in vec2 a_quad;\n' +
'layout(location=1) in vec2 a_pos;\n' +
'layout(location=2) in vec2 a_scale;\n' +
'layout(location=3) in float a_rot;\n' +
'layout(location=4) in vec4 a_color;\n' +
'layout(location=5) in vec4 a_region;\n' +
'uniform vec2 u_playfield;\n' +
'out vec2 v_uv;\n' +
'out vec4 v_color;\n' +
'void main(){\n' +
'  float c = cos(a_rot), s = sin(a_rot);\n' +
'  vec2 q = a_quad * a_scale;\n' +
'  vec2 r = vec2(q.x*c - q.y*s, q.x*s + q.y*c);\n' +
'  vec2 world = a_pos + r;\n' +
'  vec2 clip = world / u_playfield * 2.0 - 1.0;\n' +
'  clip.y = -clip.y;\n' +
'  gl_Position = vec4(clip, 0.0, 1.0);\n' +
'  v_uv = a_region.xy + (a_quad + 0.5) * a_region.zw;\n' +
'  v_color = a_color;\n' +
'}\n';

  var FS_SPRITE =
'#version 300 es\n' +
'precision highp float;\n' +
'in vec2 v_uv;\n' +
'in vec4 v_color;\n' +
'uniform sampler2D u_atlas;\n' +
'out vec4 frag;\n' +
'void main(){\n' +
'  float m = texture(u_atlas, v_uv).a;\n' +
'  float a = m * v_color.a;\n' +
'  frag = vec4(v_color.rgb * a, a);\n' +  // premultiplied, additive blend ONE,ONE
'}\n';

  var VS_FULL =
'#version 300 es\n' +
'out vec2 v_uv;\n' +
'void main(){\n' +
'  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n' +
'  v_uv = p;\n' +
'  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
'}\n';

  var FS_THRESHOLD =
'#version 300 es\n' +
'precision highp float;\n' +
'in vec2 v_uv;\n' +
'uniform sampler2D u_tex;\n' +
'uniform float u_threshold;\n' +
'out vec4 frag;\n' +
'void main(){\n' +
'  vec3 c = texture(u_tex, v_uv).rgb;\n' +
'  float b = max(max(c.r, c.g), c.b);\n' +
'  float k = max(b - u_threshold, 0.0) / max(b, 0.0001);\n' +
'  frag = vec4(c * k, 1.0);\n' +
'}\n';

  var FS_BLUR =
'#version 300 es\n' +
'precision highp float;\n' +
'in vec2 v_uv;\n' +
'uniform sampler2D u_tex;\n' +
'uniform vec2 u_dir;\n' +
'out vec4 frag;\n' +
'void main(){\n' +
'  vec3 sum = texture(u_tex, v_uv).rgb * 0.227027;\n' +
'  vec2 o1 = u_dir * 1.3846153846;\n' +
'  vec2 o2 = u_dir * 3.2307692308;\n' +
'  sum += texture(u_tex, v_uv + o1).rgb * 0.3162162162;\n' +
'  sum += texture(u_tex, v_uv - o1).rgb * 0.3162162162;\n' +
'  sum += texture(u_tex, v_uv + o2).rgb * 0.0702702703;\n' +
'  sum += texture(u_tex, v_uv - o2).rgb * 0.0702702703;\n' +
'  frag = vec4(sum, 1.0);\n' +
'}\n';

  var FS_COMPOSITE =
'#version 300 es\n' +
'precision highp float;\n' +
'in vec2 v_uv;\n' +
'uniform sampler2D u_scene;\n' +
'uniform sampler2D u_bloomHalf;\n' +
'uniform sampler2D u_bloomQuarter;\n' +
'uniform float u_chroma;\n' +
'uniform float u_bloom;\n' +
'out vec4 frag;\n' +
'void main(){\n' +
'  vec2 dir = v_uv - 0.5;\n' +
'  float off = u_chroma;\n' +
'  vec3 scene;\n' +
'  scene.r = texture(u_scene, v_uv + dir*off).r;\n' +
'  scene.g = texture(u_scene, v_uv).g;\n' +
'  scene.b = texture(u_scene, v_uv - dir*off).b;\n' +
'  vec3 bloom;\n' +
'  bloom.r = texture(u_bloomHalf, v_uv + dir*off*2.0).r + texture(u_bloomQuarter, v_uv + dir*off*2.0).r;\n' +
'  bloom.g = texture(u_bloomHalf, v_uv).g + texture(u_bloomQuarter, v_uv).g;\n' +
'  bloom.b = texture(u_bloomHalf, v_uv - dir*off*2.0).b + texture(u_bloomQuarter, v_uv - dir*off*2.0).b;\n' +
'  vec3 col = scene + bloom * u_bloom;\n' +
'  col = col / (1.0 + col * 0.28);\n' +      // gentle reinhard so glow rolls off instead of hard-clipping
'  col = pow(col, vec3(0.92));\n' +          // slight lift
'  frag = vec4(col, 1.0);\n' +
'}\n';

  // ---- gl helpers -----------------------------------------------------------

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      console.error('shader compile failed:\n' + log + '\n---\n' + src);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function link(vsSrc, fsSrc) {
    var vs = compile(gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('program link failed:\n' + gl.getProgramInfoLog(p));
      gl.deleteProgram(p);
      return null;
    }
    return p;
  }

  function uniforms(p, names) {
    var out = {};
    for (var i = 0; i < names.length; i++) out[names[i]] = gl.getUniformLocation(p, names[i]);
    return out;
  }

  // ---- programs -------------------------------------------------------------

  var progSprite, uSprite;
  var progThresh, uThresh;
  var progBlur, uBlur;
  var progComp, uComp;

  // ---- procedural atlas -----------------------------------------------------

  var atlasTex = null;
  var regions = [];      // index -> [u0, v0, du, dv]
  var ATLAS_SIZE = 512;
  var CELL = 128;
  var COLS = 4;

  function cellRect(i) {
    var cx = (i % COLS) * CELL;
    var cy = ((i / COLS) | 0) * CELL;
    return { x: cx, y: cy };
  }

  function buildAtlas() {
    var cv = document.createElement('canvas');
    cv.width = ATLAS_SIZE;
    cv.height = ATLAS_SIZE;
    var c = cv.getContext('2d');
    c.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

    // Helper: draw within cell i using a local context centered at cell center,
    // with the cell treated as [-r..r] in both axes (r = half). Everything is
    // drawn white; the alpha channel carries the shape (frag reads only .a).
    function draw(i, fn) {
      var rc = cellRect(i);
      c.save();
      c.translate(rc.x + CELL / 2, rc.y + CELL / 2);
      fn(c, CELL / 2 - 2); // r = usable half-extent with 2px pad
      c.restore();
      // record region inset by ~1px in uv to avoid bilinear bleed
      var pad = 1.0;
      regions[i] = [
        (rc.x + pad) / ATLAS_SIZE,
        (rc.y + pad) / ATLAS_SIZE,
        (CELL - pad * 2) / ATLAS_SIZE,
        (CELL - pad * 2) / ATLAS_SIZE
      ];
    }

    function radial(ctx, r, stops) {
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      for (var k = 0; k < stops.length; k++) g.addColorStop(stops[k][0], stops[k][1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // GLOW: wide soft falloff.
    draw(GL.SPR.GLOW, function (ctx, r) {
      radial(ctx, r, [
        [0.0, 'rgba(255,255,255,1.0)'],
        [0.25, 'rgba(255,255,255,0.55)'],
        [0.55, 'rgba(255,255,255,0.16)'],
        [1.0, 'rgba(255,255,255,0.0)']
      ]);
    });

    // CORE: bright tight disc with a thin soft edge.
    draw(GL.SPR.CORE, function (ctx, r) {
      radial(ctx, r, [
        [0.0, 'rgba(255,255,255,1.0)'],
        [0.62, 'rgba(255,255,255,1.0)'],
        [0.78, 'rgba(255,255,255,0.7)'],
        [1.0, 'rgba(255,255,255,0.0)']
      ]);
    });

    // RING: hollow soft ring.
    draw(GL.SPR.RING, function (ctx, r) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,1.0)';
      ctx.lineWidth = r * 0.20;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = r * 0.42;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.66, 0, Math.PI * 2);
      ctx.stroke();
    });

    // RINGBULLET: thicker crisp ring with hot inner rim (enemy ring bullet).
    draw(GL.SPR.RINGBULLET, function (ctx, r) {
      radial(ctx, r, [
        [0.0, 'rgba(255,255,255,0.0)'],
        [0.45, 'rgba(255,255,255,0.0)'],
        [0.6, 'rgba(255,255,255,1.0)'],
        [0.82, 'rgba(255,255,255,1.0)'],
        [1.0, 'rgba(255,255,255,0.0)']
      ]);
    });

    // SPARK: four-point star.
    draw(GL.SPR.SPARK, function (ctx, r) {
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      for (var a = 0; a < 4; a++) {
        ctx.save();
        ctx.rotate(a * Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.16, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.16, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      // hot center
      radial(ctx, r * 0.4, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    });

    // STREAK: vertical elongated capsule (used for shots & trails, rotated).
    draw(GL.SPR.STREAK, function (ctx, r) {
      var g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0.0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,1)');
      g.addColorStop(1.0, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      var w = r * 0.34;
      roundRectPath(ctx, -w, -r, w * 2, r * 2, w);
      ctx.fill();
    });

    // NEEDLE: thinner, sharper vertical shard for fast aimed shots.
    draw(GL.SPR.NEEDLE, function (ctx, r) {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.16, r * 0.55);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.16, r * 0.55);
      ctx.closePath();
      ctx.fill();
      var g = ctx.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-r * 0.16, -r, r * 0.32, r * 2);
    });

    // GOLD: diamond shard with a bright facet.
    draw(GL.SPR.GOLD, function (ctx, r) {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.92);
      ctx.lineTo(r * 0.6, 0);
      ctx.lineTo(0, r * 0.92);
      ctx.lineTo(-r * 0.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.92);
      ctx.lineTo(r * 0.6, 0);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
    });

    // SHIP_PLAYER: sleek arrowhead pointing UP (toward cell top).
    draw(GL.SPR.SHIP_PLAYER, function (ctx, r) {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.5, r * 0.5);
      ctx.lineTo(r * 0.2, r * 0.7);
      ctx.lineTo(0, r * 0.45);
      ctx.lineTo(-r * 0.2, r * 0.7);
      ctx.lineTo(-r * 0.5, r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(-r * 0.08, -r * 0.4, r * 0.16, r * 0.9);
    });

    // SHIP_POP: small chevron darter (nose up).
    draw(GL.SPR.SHIP_POP, function (ctx, r) {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.8);
      ctx.lineTo(r * 0.7, r * 0.5);
      ctx.lineTo(0, r * 0.1);
      ctx.lineTo(-r * 0.7, r * 0.5);
      ctx.closePath();
      ctx.fill();
    });

    // SHIP_GUN: broad gunship.
    draw(GL.SPR.SHIP_GUN, function (ctx, r) {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.55);
      ctx.lineTo(r * 0.9, -r * 0.1);
      ctx.lineTo(r * 0.7, r * 0.6);
      ctx.lineTo(-r * 0.7, r * 0.6);
      ctx.lineTo(-r * 0.9, -r * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(-r * 0.5, -r * 0.1, r, r * 0.3);
    });

    // SHIP_MID: warden — layered hexagon.
    draw(GL.SPR.SHIP_MID, function (ctx, r) {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      hexPath(ctx, r * 0.92);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      hexPath(ctx, r * 0.55);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      hexPath(ctx, r * 0.24);
      ctx.fill();
    });

    // SHIP_BOSS: gilded sovereign — angular winged silhouette (nose down-ish;
    // we draw broad, boss is rotated to point toward player).
    draw(GL.SPR.SHIP_BOSS, function (ctx, r) {
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(r * 0.35, -r * 0.3);
      ctx.lineTo(r * 0.98, -r * 0.05);
      ctx.lineTo(r * 0.6, r * 0.35);
      ctx.lineTo(r * 0.32, r * 0.95);
      ctx.lineTo(-r * 0.32, r * 0.95);
      ctx.lineTo(-r * 0.6, r * 0.35);
      ctx.lineTo(-r * 0.98, -r * 0.05);
      ctx.lineTo(-r * 0.35, -r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      hexPath(ctx, r * 0.4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      hexPath(ctx, r * 0.18);
      ctx.fill();
    });

    function roundRectPath(ctx, x, y, w, h, rr) {
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
    function hexPath(ctx, r) {
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 3;
        var px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }

    // Upload.
    atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---- instanced batcher ----------------------------------------------------

  var STRIDE = 13;                 // floats per instance
  var CAP = 16384;                 // max instances between flushes
  var instData = new Float32Array(CAP * STRIDE);
  var instCount = 0;
  var quadVBO, instVBO, spriteVAO;
  var drawCallCount = 0;

  function buildBatcher() {
    var quad = new Float32Array([
      -0.5, -0.5,
       0.5, -0.5,
      -0.5,  0.5,
       0.5,  0.5
    ]);
    quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    instVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instVBO);
    gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);

    spriteVAO = gl.createVertexArray();
    gl.bindVertexArray(spriteVAO);

    // per-vertex quad
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);

    // per-instance
    var s = STRIDE * 4; // 52 bytes
    gl.bindBuffer(gl.ARRAY_BUFFER, instVBO);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, s, 0);  gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, s, 8);  gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, s, 16); gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, s, 20); gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, s, 36); gl.vertexAttribDivisor(5, 1);

    gl.bindVertexArray(null);
  }

  // Public per-instance push. All draws are additive.
  GL.draw = function (spr, x, y, sx, sy, rot, r, g, b, a) {
    if (a <= 0) return;
    if (instCount >= CAP) flushSprites();
    var reg = regions[spr];
    var o = instCount * STRIDE;
    var d = instData;
    d[o] = x; d[o + 1] = y;
    d[o + 2] = sx; d[o + 3] = sy;
    d[o + 4] = rot;
    d[o + 5] = r; d[o + 6] = g; d[o + 7] = b; d[o + 8] = a;
    d[o + 9] = reg[0]; d[o + 10] = reg[1]; d[o + 11] = reg[2]; d[o + 12] = reg[3];
    instCount++;
  };

  function flushSprites() {
    if (instCount === 0) return;
    gl.useProgram(progSprite);
    gl.uniform2f(uSprite.u_playfield, GL.W, GL.H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(uSprite.u_atlas, 0);
    gl.bindVertexArray(spriteVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, instVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData.subarray(0, instCount * STRIDE));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instCount);
    gl.bindVertexArray(null);
    drawCallCount++;
    instCount = 0;
  }

  // ---- render targets / bloom ----------------------------------------------

  var tScene, tHalfA, tHalfB, tQuartA, tQuartB;
  var vpW = 1, vpH = 1;            // full drawing-buffer size
  var lb = { x: 0, y: 0, w: 1, h: 1 }; // letterbox rect (device px)

  function makeTarget(w, h) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (!ok) console.error('FBO incomplete at', w, 'x', h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb: fb, tex: tex, w: w, h: h, ok: ok };
  }

  function disposeTarget(t) {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fb);
  }

  GL.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    var cssW = glCanvas.clientWidth || window.innerWidth;
    var cssH = glCanvas.clientHeight || window.innerHeight;
    var w = Math.max(2, Math.floor(cssW * dpr));
    var h = Math.max(2, Math.floor(cssH * dpr));
    if (w === vpW && h === vpH && tScene) return;
    vpW = w; vpH = h;
    glCanvas.width = w;
    glCanvas.height = h;

    // letterbox rect preserving 1080:1920 (9:16)
    var scale = Math.min(w / GL.W, h / GL.H);
    var rw = Math.round(GL.W * scale);
    var rh = Math.round(GL.H * scale);
    lb.x = Math.floor((w - rw) / 2);
    lb.y = Math.floor((h - rh) / 2);
    lb.w = rw; lb.h = rh;

    disposeTarget(tScene); disposeTarget(tHalfA); disposeTarget(tHalfB);
    disposeTarget(tQuartA); disposeTarget(tQuartB);
    tScene  = makeTarget(w, h);
    tHalfA  = makeTarget(Math.max(2, w >> 1), Math.max(2, h >> 1));
    tHalfB  = makeTarget(Math.max(2, w >> 1), Math.max(2, h >> 1));
    tQuartA = makeTarget(Math.max(2, w >> 2), Math.max(2, h >> 2));
    tQuartB = makeTarget(Math.max(2, w >> 2), Math.max(2, h >> 2));
  };

  GL.viewSize = function () { return { w: vpW, h: vpH }; };
  // letterbox rect in device pixels (mirror this for the 2D HUD canvas)
  GL.letterbox = function () { return { x: lb.x, y: lb.y, w: lb.w, h: lb.h }; };

  // ---- scene / composite ----------------------------------------------------

  var shakeX = 0, shakeY = 0;

  GL.setShake = function (dx, dy) { shakeX = dx; shakeY = dy; };

  GL.beginScene = function () {
    gl.bindFramebuffer(gl.FRAMEBUFFER, tScene.fb);
    gl.viewport(0, 0, vpW, vpH);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // additive glow
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    // draw game into letterboxed region; screen-shake offsets the viewport
    var ox = (shakeX / GL.W) * lb.w;
    var oy = (shakeY / GL.H) * lb.h;
    gl.viewport(lb.x + Math.round(ox), lb.y - Math.round(oy), lb.w, lb.h);
    instCount = 0;
    drawCallCount = 0;
  };

  function fullscreenPass() {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // chroma: 0..~0.02 uv offset; bloom: strength multiplier
  GL.composite = function (chroma, bloomStrength, threshold) {
    flushSprites();

    gl.disable(gl.BLEND);
    // empty VAO for fullscreen passes (attributeless)
    gl.bindVertexArray(null);

    // 1) threshold scene -> halfA
    gl.bindFramebuffer(gl.FRAMEBUFFER, tHalfA.fb);
    gl.viewport(0, 0, tHalfA.w, tHalfA.h);
    gl.useProgram(progThresh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tScene.tex);
    gl.uniform1i(uThresh.u_tex, 0);
    gl.uniform1f(uThresh.u_threshold, threshold);
    fullscreenPass();

    // 2) blur halfA -> halfB (H) -> halfA (V)
    gl.useProgram(progBlur);
    blur(tHalfA, tHalfB, 1 / tHalfA.w, 0);
    blur(tHalfB, tHalfA, 0, 1 / tHalfA.h);

    // 3) downsample halfA -> quartA (H) -> quartB (V) for a wider halo
    blur(tHalfA, tQuartA, 1 / tQuartA.w, 0);
    blur(tQuartA, tQuartB, 0, 1 / tQuartB.h);

    // 4) composite to default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, vpW, vpH);
    gl.useProgram(progComp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tScene.tex);  gl.uniform1i(uComp.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tHalfA.tex);  gl.uniform1i(uComp.u_bloomHalf, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tQuartB.tex); gl.uniform1i(uComp.u_bloomQuarter, 2);
    gl.uniform1f(uComp.u_chroma, chroma || 0);
    gl.uniform1f(uComp.u_bloom, bloomStrength);
    fullscreenPass();
    gl.activeTexture(gl.TEXTURE0);
  };

  function blur(src, dst, dx, dy) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(uBlur.u_tex, 0);
    gl.uniform2f(uBlur.u_dir, dx, dy);
    fullscreenPass();
  }

  GL.stats = function () { return { instances: instCount, drawCalls: drawCallCount }; };

  // ---- init -----------------------------------------------------------------

  GL.init = function (canvas) {
    glCanvas = canvas;
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) return false;
    GL.gl = gl;

    progSprite = link(VS_SPRITE, FS_SPRITE);
    progThresh = link(VS_FULL, FS_THRESHOLD);
    progBlur = link(VS_FULL, FS_BLUR);
    progComp = link(VS_FULL, FS_COMPOSITE);
    if (!progSprite || !progThresh || !progBlur || !progComp) return false;

    uSprite = uniforms(progSprite, ['u_playfield', 'u_atlas']);
    uThresh = uniforms(progThresh, ['u_tex', 'u_threshold']);
    uBlur = uniforms(progBlur, ['u_tex', 'u_dir']);
    uComp = uniforms(progComp, ['u_scene', 'u_bloomHalf', 'u_bloomQuarter', 'u_chroma', 'u_bloom']);

    buildAtlas();
    buildBatcher();
    GL.resize();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    return true;
  };

})();
