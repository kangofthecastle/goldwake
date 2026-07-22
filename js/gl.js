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

  // Enemy-bullet look: 'A' = white core -> thick colour rim (Touhou-style),
  // 'B' = solid colour core + hot centre + thick faded ring (DU3/CAVE-style).
  // Switch live from the console: GL.setBulletStyle('B'). Default A.
  GL.bulletStyle = 'A';

  // JADE EMPEROR edict silhouette (debug switch for the owner to pick from renders):
  // 'A' = scroll-talisman (violet tablet, gold border, red seal-dot) — live default;
  // 'B' = hanging vertical banner trailing like a ribbon;
  // 'C' = square imperial seal-stamp chop (stamps a glowing seal-mark on hit).
  // Drawn procedurally in game.js drawShots; this is only the style flag.
  GL.edictStyle = 'A';
  GL.setEdictStyle = function (s) { GL.edictStyle = (s === 'B' || s === 'C') ? s : 'A'; };

  // LIGHTNING treatment (owner-pickable; the shared bolt renderer in game.js reads
  // this each spawn). Persisted in goldwake_meta (see run.js), applied on load.
  //   'A' CLEAN — single elegant bolt, no branches, thin core, 2 re-strikes.
  //   'B' STORM — thicker core, 2 branches, harder displacement, 3 re-strikes.
  //   'C' SHEET — B plus a fast vertical glow-sheet flash along the bolt column.
  GL.lightningStyle = 'C';   // C = default treatment (loadMeta overrides with any persisted pick)
  GL.setLightningStyle = function (s) { GL.lightningStyle = (s === 'B' || s === 'C') ? s : 'A'; };

  // HURTBOX RIM treatment (owner-pickable; drawHurtboxRead in game.js reads this).
  // The honest kill-dot is a white-hot core in a dark punch-out well; only the RIM
  // colour changes. Persisted in goldwake_meta (see run.js), applied on load.
  //   'A' CYAN  — hot white core + crisp cyan rim (HUBRIS house family).
  //   'B' CRIMSON — hot white core + crisp magenta-red rim (Touhou convention).
  GL.hitboxStyle = 'A';
  GL.setHitboxStyle = function (s) { GL.hitboxStyle = (s === 'B') ? 'B' : 'A'; };

  // ENEMY-STATE visual language (owner 2026-07-21 ruling, now LAW): state = a SILHOUETTE
  // RIM-LIGHT in the state colour hugging the sprite's own outline + body-zone glyphs/pips.
  // NO persistent plain geometric rings/circles as state/buff indicators anywhere. The
  // audition is over — variant A is the one language (drawStateRimA in game.js drawEnemies);
  // the per-state rim colours are the only data that varies.

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
    SHIP_BOSS: 12,  // gilded sovereign
    // enemy-bullet families (opaque glassy bodies drawn in the premult pass;
    // real silhouettes with a dark #231A20 outline that survives bloom). These
    // cells store colour, not a white alpha mask: body is a mid-grey that tints
    // to the family hue, highlights are white, the outline is baked near-black.
    ORB: 13,        // glass ball: dark outline, saturated body, off-centre specular
    GRING: 14,      // hollow thick glass rim
    KUNAI: 15,      // oriented edged needle with a bright spine
    SHARD: 16,      // oriented diamond / petal
    PELLET: 17,     // small hard dot, bright rim
    STAR: 18,       // 4-point spark (slow spin)
    // lightning light-ribbon (see buildAtlas). Placed at cell 50 — well clear of
    // the authored-sprite reservation (cells 19-49) and inside the 8x8/64-cell
    // atlas. Crisp along its LENGTH, feathered only laterally, so a bolt drawn as
    // stretched segment-quads reads as one continuous jagged crack, never beads.
    BOLT: 50
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
// The atlas is stored PREMULTIPLIED (rgb already scaled by alpha). Procedural
// cells are white shapes, so t.rgb == the old alpha mask and tinting behaves
// exactly as before; authored sprite overrides contribute their own colors.
'  vec4 t = texture(u_atlas, v_uv);\n' +
'  frag = vec4(t.rgb * v_color.rgb * v_color.a, t.a * v_color.a);\n' +  // premultiplied, additive blend ONE,ONE
'}\n';

  // Enemy-bullet shader. The atlas cell is NOT a plain white mask: it encodes a
  // per-texel recolour recipe so a genuinely white core survives the family
  // tint (a single multiplicative tint could never keep white). Channels (in
  // straight-alpha, decoded here after the premultiplied upload):
  //   A = coverage (silhouette + baked outer fade)
  //   R = tint weight  W  (1 = full family colour, 0 = stay pure white)
  //   G = value        V  (1 = full bright, low = the dark #231A20-ish edge)
  // Output colour = coverage * mix(white, tint, W) * V. mix() can only travel
  // white<->tint (both bright), so V is what lets the baked dark edge exist and
  // occlude the crest behind it in the premult-over pass. Legacy white cells
  // (R==G==A) would decode to W=1,V=1 -> identical to FS_SPRITE, but bullet
  // cells are only ever drawn through THIS program, so authored ship overrides
  // (which need their own texture colours) keep using FS_SPRITE untouched.
  var FS_SPRITE_BULLET =
'#version 300 es\n' +
'precision highp float;\n' +
'in vec2 v_uv;\n' +
'in vec4 v_color;\n' +
'uniform sampler2D u_atlas;\n' +
'out vec4 frag;\n' +
'void main(){\n' +
'  vec4 t = texture(u_atlas, v_uv);\n' +
'  float cov = t.a;\n' +
'  float inv = cov > 0.0039 ? 1.0 / cov : 0.0;\n' +
'  float w = clamp(t.r * inv, 0.0, 1.0);\n' +   // straight red  = tint weight
'  float v = cov > 0.0039 ? clamp(t.g * inv, 0.0, 1.0) : 1.0;\n' + // straight green = value
'  const float WB = 1.7;\n' +                   // white-core over-brightness: pushes pure-white texels into
'  vec3 body = mix(vec3(WB), v_color.rgb, w) * v;\n' +           // HDR so they bloom hot past the reinhard tonemap;
'  frag = vec4(body * cov * v_color.a, cov * v_color.a);\n' +   // rims (w=1) keep their saturated colour. premult-over
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
  var progSpriteBullet, uSpriteBullet;
  var spriteMode = 'normal';   // 'normal' | 'bullet' — which program flushSprites binds
  var progThresh, uThresh;
  var progBlur, uBlur;
  var progComp, uComp;

  // ---- procedural atlas -----------------------------------------------------

  var atlasTex = null;
  var regions = [];      // index -> [u0, v0, du, dv]
  // Per-cell draw-size COMPENSATION (subject-fraction sizing). Procedural silhouettes
  // fill their cell edge-to-edge, but authored PNGs (compositeSprite) fit the whole
  // painted frame — glow halos and transparent margin included — into the cell, so the
  // actual creature spans only part of it and reads SMALL when drawn at the same
  // e.scale as the procedural fallback it replaces. compositeSprite measures each
  // authored cell's alpha bounding box and stores CELL/subjectSpan here (clamped) so
  // draw sites can scale the quad up until the painted subject fills what e.scale
  // intends. Default 1 (procedural cells + un-loaded authored cells: no change).
  // Draw-size ONLY — never touched by collision (hitboxes read e.radius, not this).
  var sprFill = [];      // index -> draw-size compensation factor (>= 1)
  // Atlas grown to 8x16 = 128 cells (was 8x8 = 64). Width is unchanged (8 cols x
  // 128); height is doubled to 2048 to seat the 2026-07-19 signature/glyph/field
  // batch as cells 51+. Cell PIXEL positions are untouched (cellRect derives x/y
  // from COLS/CELL only, never the atlas extent), so every existing index —
  // procedural 0-18, authored 19-49, BOLT 50 — lands on the exact same texels;
  // only the V denominator changes (y / ATLAS_H). The paste Y uses the same
  // pixel rc.y, so sampling is identical: no UV drift. U still divides by ATLAS_W.
  var ATLAS_W = 1024;   // 8 cols x 128
  var ATLAS_H = 2048;   // 16 rows x 128
  var CELL = 128;
  var COLS = 8;

  // straight-alpha ImageData -> premultiplied bytes (transparent = pure black),
  // required because the renderer blends ONE,ONE and the shader samples rgb.
  function premultiplied(imgData) {
    var d = imgData.data;
    for (var i = 0; i < d.length; i += 4) {
      var a = d[i + 3] / 255;
      d[i] = (d[i] * a) | 0; d[i + 1] = (d[i + 1] * a) | 0; d[i + 2] = (d[i + 2] * a) | 0;
    }
    return new Uint8Array(d.buffer);
  }

  function cellRect(i) {
    var cx = (i % COLS) * CELL;
    var cy = ((i / COLS) | 0) * CELL;
    return { x: cx, y: cy };
  }

  // ---- enemy-bullet family painters -----------------------------------------
  // The bullet shader (FS_SPRITE_BULLET) decodes each cell texel as:
  //   RED   = tint weight W (1 = full family colour, 0 = pure white)
  //   GREEN = value       V (1 = full bright, low = dark #231A20-ish edge)
  //   ALPHA = coverage      (silhouette + baked outer fade)
  // encode(w,v,a) returns a canvas colour that writes exactly those channels.
  // GL.bulletStyle selects: 'A' = large white core -> thick colour rim (Touhou);
  // 'B' = solid colour core + small hot centre + thick faded ring (DU3/CAVE).
  var TAUL = Math.PI * 2;
  var BINK_W = 0.20, BINK_V = 0.13;   // dark-edge recipe (faint family tint, near-black value)
  function encode(w, v, a) {
    return 'rgba(' + Math.round(w * 255) + ',' + Math.round(v * 255) + ',0,' + a + ')';
  }
  // register a family: records the region and paints the current-style cell into
  // the shared atlas canvas (called from buildAtlas via its local draw()).
  function paintBulletFamily(draw, spr, fn) {
    draw(spr, function (ctx, r) { fn(ctx, r, GL.bulletStyle); });
  }
  var BULLET_FAMILIES = null;   // spr -> painter (built lazily for runtime restyle)

  function paintOrb(ctx, r, style) {
    var br = r * 0.98;
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, br);
    if (style === 'B') {
      g.addColorStop(0.00, encode(0.14, 1, 1));      // near-white hot centre
      g.addColorStop(0.14, encode(0.14, 1, 1));
      g.addColorStop(0.28, encode(1, 1, 1));         // solid family colour
      g.addColorStop(0.76, encode(1, 1, 1));
      g.addColorStop(0.815, encode(BINK_W, BINK_V, 1)); // dark edge
      g.addColorStop(0.86, encode(1, 0.98, 0.85));   // thick faded outer ring
      g.addColorStop(1.00, encode(1, 0.95, 0));
    } else {
      g.addColorStop(0.00, encode(0, 1, 1));         // white-hot core
      g.addColorStop(0.40, encode(0, 1, 1));
      g.addColorStop(0.58, encode(1, 1, 1));         // thick family rim
      g.addColorStop(0.80, encode(1, 1, 1));
      g.addColorStop(0.845, encode(BINK_W, BINK_V, 1)); // thin dark edge
      g.addColorStop(0.89, encode(1, 1, 0.7));       // soft colour fade
      g.addColorStop(1.00, encode(1, 1, 0));
    }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, br, 0, TAUL); ctx.fill();
    // off-centre glassy specular (pure white pip)
    var sr = br * (style === 'B' ? 0.24 : 0.30), sx = -br * 0.30, sy = -br * 0.32;
    var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sg.addColorStop(0, encode(0, 1, 0.95)); sg.addColorStop(1, encode(0, 1, 0));
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAUL); ctx.fill();
  }

  function paintPellet(ctx, r, style) {
    var br = r * 0.92;
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, br);
    if (style === 'B') {
      g.addColorStop(0.00, encode(0.12, 1, 1));      // tiny hot centre
      g.addColorStop(0.42, encode(1, 1, 1));         // hard solid colour dot
      g.addColorStop(0.74, encode(1, 1, 1));
      g.addColorStop(0.80, encode(BINK_W, BINK_V, 1));
      g.addColorStop(0.85, encode(1, 0.98, 0.78));
      g.addColorStop(1.00, encode(1, 0.95, 0));
    } else {
      g.addColorStop(0.00, encode(0, 1, 1));         // white core
      g.addColorStop(0.34, encode(0, 1, 1));
      g.addColorStop(0.54, encode(1, 1, 1));         // colour rim
      g.addColorStop(0.74, encode(1, 1, 1));
      g.addColorStop(0.80, encode(BINK_W, BINK_V, 1));
      g.addColorStop(0.86, encode(1, 1, 0.68));
      g.addColorStop(1.00, encode(1, 1, 0));
    }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, br, 0, TAUL); ctx.fill();
  }

  function paintGRing(ctx, r, style) {
    var ro = r * 0.98;
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, ro);
    if (style === 'B') {
      g.addColorStop(0.00, encode(1, 1, 0));         // hollow
      g.addColorStop(0.42, encode(1, 1, 0));
      g.addColorStop(0.49, encode(0.16, 1, 0.85));   // small near-white inner highlight
      g.addColorStop(0.55, encode(1, 1, 1));         // colour body
      g.addColorStop(0.74, encode(1, 1, 1));
      g.addColorStop(0.80, encode(BINK_W, BINK_V, 1)); // dark outer edge
      g.addColorStop(0.86, encode(1, 0.98, 0.75));   // thick fade
      g.addColorStop(1.00, encode(1, 0.95, 0));
    } else {
      g.addColorStop(0.00, encode(1, 1, 0));         // hollow
      g.addColorStop(0.40, encode(1, 1, 0));
      g.addColorStop(0.47, encode(0, 1, 1));         // white-hot inner rim edge
      g.addColorStop(0.55, encode(1, 1, 1));         // thick colour ring body
      g.addColorStop(0.78, encode(1, 1, 1));
      g.addColorStop(0.835, encode(BINK_W, BINK_V, 1)); // dark outer edge
      g.addColorStop(0.89, encode(1, 1, 0.6));       // soft fade
      g.addColorStop(1.00, encode(1, 1, 0));
    }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ro, 0, TAUL); ctx.fill();
  }

  function paintKunai(ctx, r, style) {
    ctx.beginPath();                                                      // wider leaf so the colour walls read
    ctx.moveTo(0, -r * 0.96); ctx.lineTo(r * 0.44, r * 0.18); ctx.lineTo(0, r * 0.92); ctx.lineTo(-r * 0.44, r * 0.18);
    ctx.closePath();
    ctx.fillStyle = encode(1, 1, 1); ctx.fill();                          // colour edge walls
    ctx.lineJoin = 'round'; ctx.strokeStyle = encode(BINK_W, BINK_V, 1);  // dark outline
    ctx.lineWidth = r * 0.14; ctx.stroke();
    var sw = style === 'B' ? r * 0.10 : r * 0.19;                         // bright pale spine
    var wv = style === 'B' ? 0.12 : 0.0;
    var g = ctx.createLinearGradient(0, -r * 0.9, 0, r * 0.9);
    g.addColorStop(0.0, encode(wv, 1, 0));
    g.addColorStop(0.18, encode(wv, 1, style === 'B' ? 0.85 : 1));
    g.addColorStop(0.5, encode(wv, 1, style === 'B' ? 0.6 : 0.9));
    g.addColorStop(1.0, encode(wv, 1, 0));
    ctx.fillStyle = g; ctx.fillRect(-sw, -r * 0.9, sw * 2, r * 1.8);
  }

  function paintShard(ctx, r, style) {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.92); ctx.lineTo(r * 0.5, 0); ctx.lineTo(0, r * 0.92); ctx.lineTo(-r * 0.5, 0);
    ctx.closePath();
    ctx.fillStyle = encode(1, 1, 1); ctx.fill();                          // colour body
    ctx.lineJoin = 'round'; ctx.strokeStyle = encode(BINK_W, BINK_V, 1);
    ctx.lineWidth = r * 0.13; ctx.stroke();
    var fw = style === 'B' ? 0.62 : 1.0, wv = style === 'B' ? 0.14 : 0.0; // bright pale central facet
    ctx.fillStyle = encode(wv, 1, style === 'B' ? 0.9 : 1);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.62 * fw); ctx.lineTo(r * 0.17 * fw, 0); ctx.lineTo(0, r * 0.42 * fw); ctx.lineTo(-r * 0.17 * fw, 0);
    ctx.closePath(); ctx.fill();
  }

  function paintStar(ctx, r, style) {
    ctx.beginPath();
    for (var a = 0; a < 8; a++) {
      var ang = a * Math.PI / 4 - Math.PI / 2;
      var rr = (a % 2 === 0) ? r * 0.94 : r * 0.34;
      var px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
      if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = encode(1, 1, 1); ctx.fill();                          // colour points
    ctx.lineJoin = 'round'; ctx.strokeStyle = encode(BINK_W, BINK_V, 1);
    ctx.lineWidth = r * 0.10; ctx.stroke();
    var cr = style === 'B' ? r * 0.34 : r * 0.52, wv = style === 'B' ? 0.12 : 0.0; // white centre
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, cr);
    g.addColorStop(0.0, encode(wv, 1, 1));
    g.addColorStop(0.6, encode(wv, 1, style === 'B' ? 0.7 : 0.9));
    g.addColorStop(1.0, encode(wv, 1, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, cr, 0, TAUL); ctx.fill();
  }

  function buildAtlas() {
    var cv = document.createElement('canvas');
    cv.width = ATLAS_W;
    cv.height = ATLAS_H;
    var c = cv.getContext('2d');
    c.clearRect(0, 0, ATLAS_W, ATLAS_H);

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
        (rc.x + pad) / ATLAS_W,
        (rc.y + pad) / ATLAS_H,
        (CELL - pad * 2) / ATLAS_W,
        (CELL - pad * 2) / ATLAS_H
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

    // BOLT: lightning light-ribbon. Unlike STREAK (which fades to 0 at BOTH tips
    // and so reads as a discrete oval when tiled), this cell is FULL alpha along
    // its whole length (top→bottom of the cell) and feathered only ACROSS its
    // width — a bright crisp centre spine with soft wings. Drawn per path segment
    // as a quad (width→cell x, length→cell y, rotated to the segment), a run of
    // them overlaps into one seamless jagged line with no beading. See
    // drawBoltLeg. The lateral profile keeps a razor-bright core so thin widths
    // still register; alpha rides the caller.
    draw(GL.SPR.BOLT, function (ctx, r) {
      var g = ctx.createLinearGradient(-r, 0, r, 0);   // falloff across WIDTH only
      g.addColorStop(0.00, 'rgba(255,255,255,0)');
      g.addColorStop(0.20, 'rgba(255,255,255,0.02)');
      g.addColorStop(0.34, 'rgba(255,255,255,0.42)');
      g.addColorStop(0.46, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.50, 'rgba(255,255,255,1)');
      g.addColorStop(0.54, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.66, 'rgba(255,255,255,0.42)');
      g.addColorStop(0.80, 'rgba(255,255,255,0.02)');
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      // LENGTHWISE FEATHER (joint-bead fix): multiply the alpha by a LINEAR ramp over
      // the first/last BOLT_FEATHER fraction of the length. Segment quads are laid so
      // their overlap == this feather zone (drawBoltLeg/drawMiniBolt set ov = len*F/(1-F)),
      // so a ramp-DOWN tail + a ramp-UP head sum to a FLAT 1.0 across every joint — no more
      // additive doubling into periodic beads. Ramps MUST stay linear for the sum to be flat.
      // Keep this F in sync with BOLT_FEATHER in game.js.
      // CRITICAL: 'destination-in' makes the destination transparent EVERYWHERE the source
      // shape is not — on the shared atlas canvas that would erase every previously-painted
      // cell. CLIP to this cell first so the alpha-multiply is confined to the BOLT cell only.
      var F = 0.20;
      ctx.beginPath(); ctx.rect(-r, -r, r * 2, r * 2); ctx.clip();
      ctx.globalCompositeOperation = 'destination-in';
      var gy = ctx.createLinearGradient(0, -r, 0, r);   // falloff along LENGTH (y)
      gy.addColorStop(0.00, 'rgba(255,255,255,0)');
      gy.addColorStop(F,    'rgba(255,255,255,1)');
      gy.addColorStop(1 - F, 'rgba(255,255,255,1)');
      gy.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = gy;
      ctx.fillRect(-r, -r, r * 2, r * 2);
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

    // ---- enemy-bullet family cells (channel-encoded; see FS_SPRITE_BULLET) ---
    // Painted with the encode() recipe so a real white core survives the family
    // tint. Registered here (so the region + the default style-A cell land in the
    // full atlas upload); GL.setBulletStyle repaints them to style B at runtime.
    paintBulletFamily(draw, GL.SPR.ORB,    paintOrb);
    paintBulletFamily(draw, GL.SPR.GRING,  paintGRing);
    paintBulletFamily(draw, GL.SPR.KUNAI,  paintKunai);
    paintBulletFamily(draw, GL.SPR.SHARD,  paintShard);
    paintBulletFamily(draw, GL.SPR.PELLET, paintPellet);
    paintBulletFamily(draw, GL.SPR.STAR,   paintStar);

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

    // Upload premultiplied (see premultiplied(); procedural cells are white,
    // so this leaves their rendered output bit-identical to the old alpha path).
    atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ATLAS_W, ATLAS_H, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      premultiplied(c.getImageData(0, 0, ATLAS_W, ATLAS_H)));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---- authored sprite overrides (drop-in PNG art) --------------------------
  // Only the SHIP hulls are overridable. Bullets, telegraphs and FX sprites are
  // deliberately NOT mapped — ART.md forbids authored bullets, so there is no
  // slot to drop them into.
  //
  // Two channels, tried in order:
  //   1. window.SPRITES[slot]  (js/sprites-data.js, data: URIs — same-origin
  //      everywhere, including Chrome file://; regenerated by
  //      art/embed-sprites.sh)
  //   2. async probe of art/sprites/<slot>.png — works over http:// and most
  //      Firefox file://; under Chrome file:// the image taints the canvas and
  //      getImageData throws, which we catch and silently keep procedural.
  //
  // ORIENTATION: atlas ship cells are authored NOSE-UP; the engine shows
  // enemies nose-down by drawing them with rot=pi. PROMPTS.md delivers the
  // player ship nose-UP (pasted as-is, rot 0) and enemy sprites facing DOWN —
  // so enemy PNGs are rotated pi at paste time to land nose-up in the cell and
  // face down again on screen.
  var SPRITE_SLOTS = {
    'ship':       { spr: GL.SPR.SHIP_PLAYER, rot: 0 },
    'enemy-pop':  { spr: GL.SPR.SHIP_POP,    rot: Math.PI },
    'enemy-gun':  { spr: GL.SPR.SHIP_GUN,    rot: Math.PI },
    'enemy-mid':  { spr: GL.SPR.SHIP_MID,    rot: Math.PI },
    'enemy-boss': { spr: GL.SPR.SHIP_BOSS,   rot: Math.PI }
  };

  // Subject-fraction sizing (see `sprFill` above). Scan a freshly-composited CELL x
  // CELL cell's straight-alpha channel, find the painted subject's alpha bounding box
  // (ignoring near-transparent fringe so a baked outer glow/AA halo doesn't count as
  // "subject"), and store CELL/subjectSpan as the draw-size compensation for the cell.
  // Clamped so an intentional wide glow can't blow the sprite up unboundedly.
  var SPR_FILL_ALPHA = 24;    // 0..255 — alpha at/under this is fringe, not subject
  var SPR_FILL_MAX = 1.8;     // hard ceiling on the up-scale (guards glow-halo sprites)
  function measureSubjectFill(cell, data) {
    var px = data.data, minX = CELL, minY = CELL, maxX = -1, maxY = -1, x, y, i;
    for (y = 0; y < CELL; y++) {
      for (x = 0; x < CELL; x++) {
        i = (y * CELL + x) * 4 + 3;
        if (px[i] > SPR_FILL_ALPHA) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) { sprFill[cell] = 1; return; }   // empty cell — no compensation
    // Dominant span (the cell is square and drawn square at e.scale); +1 = inclusive.
    var span = Math.max(maxX - minX + 1, maxY - minY + 1);
    var comp = CELL / span;
    sprFill[cell] = comp < 1 ? 1 : (comp > SPR_FILL_MAX ? SPR_FILL_MAX : comp);
  }

  // Composite one loaded PNG into atlas cell `cell`, rotated by `rot` at paste
  // time (enemy art faces DOWN and is rotated pi to land nose-up in the cell,
  // matching the procedural nose-up convention; player-side art is pasted as-is).
  function compositeSprite(cell, rot, img) {
    // Compose on a black-cleared offscreen cell (NOT the shared atlas canvas,
    // so a tainted file:// image can never taint the procedural atlas source).
    var off = document.createElement('canvas');
    off.width = CELL; off.height = CELL;
    var oc = off.getContext('2d');
    var pad = 2, avail = CELL - pad * 2;
    var sc = Math.min(avail / img.width, avail / img.height);   // fit centered, keep aspect
    var dw = img.width * sc, dh = img.height * sc;
    oc.save();
    oc.translate(CELL / 2, CELL / 2);
    if (rot) oc.rotate(rot);
    oc.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    oc.restore();
    // getImageData throws SecurityError here if the image was cross-origin
    // (Chrome file:// probe) — caller catches and keeps the procedural cell.
    var data = oc.getImageData(0, 0, CELL, CELL);
    measureSubjectFill(cell, data);
    var rc = cellRect(cell);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rc.x, rc.y, CELL, CELL, gl.RGBA, gl.UNSIGNED_BYTE, premultiplied(data));
  }

  function applyOverride(slot, img) {
    var cfg = SPRITE_SLOTS[slot];
    compositeSprite(cfg.spr, cfg.rot, img);
    console.info('HUBRIS: authored sprite loaded for slot "' + slot + '"');
  }

  function loadOverrides() {
    var registry = (typeof window !== 'undefined' && window.SPRITES) || {};
    // Under Chrome/Chromium file:// a probed <img> is opaque-origin: it would
    // taint the canvas and getImageData would throw on every hit — so probing
    // there is pure console noise (net:: errors) with no possible success.
    // Registry (data: URIs via art/embed-sprites.sh) is the only channel then.
    // (UA sniff, not window.chrome — headless Chromium doesn't define that.)
    var isChromium = /Chrome\/|Chromium\/|HeadlessChrome/.test(navigator.userAgent);
    var canProbe = !(location.protocol === 'file:' && isChromium);
    for (var slot in SPRITE_SLOTS) {
      (function (slot) {
        var src = registry[slot] ? registry[slot]              // data: URI — always same-origin
          : (canProbe ? 'art/sprites/' + slot + '.png' : null); // file probe (http / Firefox file://)
        if (!src) return;
        var img = new Image();
        img.onload = function () {
          try { applyOverride(slot, img); } catch (e) { /* tainted / bad image: keep procedural */ }
        };
        img.onerror = function () { /* no art for this slot: keep procedural */ };
        img.src = src;
      })(slot);
    }
  }

  // ---- authored per-archetype / projectile / owned-entity sprites -----------
  // Beyond the 5 generic ship slots, the 2026-07-18 kit-art rework ships named
  // sprites for every enemy archetype, signature projectile and owned entity
  // (art/PROMPTS.md §8-9). Each claims a fresh atlas cell (cells 19+, the
  // procedural set ends at SPR.STAR=18) composited from the same registry/probe
  // channels. game.js asks GL.authoredSpr(name) for the cell index (-1 until the
  // PNG lands) and falls back to a generic slot, then procedural, when absent.
  // ORIENTATION follows the slot convention: enemy PNGs (name '32-*') face DOWN,
  // rotated pi at paste so they store nose-up and face down again on screen;
  // projectiles + owned entities ('33-*'/'34-*') are authored nose-UP (rot 0)
  // and the draw site rotates them to travel/heading, exactly like the
  // procedural silhouettes they replace.
  var AUTH_BASE = GL.SPR.STAR + 1;   // 19 — first free atlas cell after the procedural set
  var authored = {};                 // name -> { cell, rot, ready }
  // ORIGINAL batch — cells 19..49 EXACTLY (31 names). These indices are frozen:
  // cell 50 is GL.SPR.BOLT (the lightning ribbon), so nothing here may grow past 49.
  var AUTH_NAMES = [
    '32-2-gunship', '32-3-aegis-shieldbearer', '32-4-weaver', '32-5-gilded-mimic',
    '32-6-splitter', '32-7-chorus-acolyte', '32-8-carrier-hulk', '32-9-blink-moth',
    '32-10-bullet-gardener', '32-11-talos', '32-12-midas', '32-13-the-apostate',
    '32-14-ammit', '32-15-assessor', '32-16-tribute-bearer', '32-17-gilded-courtier',
    '32-18-unweighed-heart',
    '33-1-mjolnir', '33-2-gungnir', '33-3-labrys', '33-4-akontia', '33-5-xiphos',
    '33-6-doru-bundle', '33-7-imperial-edict', '33-8-loosed-arrow', '33-9-ruyi-jingu-bang',
    '34-1-huginn-muninn', '34-2-phobos-deimos', '34-3-thunder-court-storm-cloud',
    '34-4-zhaoyaojing', '34-5-sky-serpent-head'
  ];
  // 2026-07-19 DELTA batch — cells 51+ (BOLT owns 50). Signature projectiles,
  // owned-entity segments, field objects, and the glyph/flame sheets. All authored
  // nose-UP (or orientation-free glyphs) so rot 0 — the draw site rotates to travel.
  // The 8x16 atlas fits these as cells 51..88 (39 free cells remain, 89..127).
  var AUTH_NAMES2 = [
    // A — signature projectiles
    '33-10-green-dragon-crescent', '33-11-hunt-arrow', '33-12-ankh-bolt',
    '33-13-rune-bolt', '33-14-heartseeker',
    // B — owned entities / ult segments
    '34-5b-sky-serpent-body', '34-5c-sky-serpent-tail', '34-6-solar-barque',
    '34-7-green-dragon-head',
    // C — field objects (34d)
    '34d-1-the-nail', '34d-2-hurled-stone', '34d-3-the-hoard', '34d-4-gold-coin',
    '34d-5-peach-of-immortality', '34d-6-apotheosis-shard',
    // D — glyph sheets: runes (35), status marks + scales + verdict (36), flame (37)
    '35-1-rune', '35-2-rune', '35-3-rune', '35-4-rune', '35-5-rune',
    '35-6-rune', '35-7-rune', '35-8-rune', '35-9-rune',
    '36-1-scales-a', '36-2-scales-b', '36-3-scales-c', '36-4-triskele',
    '36-5-bracket', '36-6-seal', '36-7-verdict-jackal', '36-8-verdict-jackal-shut',
    '37-1-flame', '37-2-flame', '37-3-flame', '37-4-flame', '37-5-flame', '37-6-flame'
  ];
  var AUTH_DELTA_BASE = GL.SPR.BOLT + 1;   // 51 — first free cell after BOLT (50)
  (function initAuthored() {
    var i, name;
    for (i = 0; i < AUTH_NAMES.length; i++) {
      name = AUTH_NAMES[i];
      authored[name] = { cell: AUTH_BASE + i, rot: name.charAt(0) === '3' && name.charAt(1) === '2' ? Math.PI : 0, ready: false };
    }
    for (i = 0; i < AUTH_NAMES2.length; i++) {   // delta batch → cells 51+
      name = AUTH_NAMES2[i];
      authored[name] = { cell: AUTH_DELTA_BASE + i, rot: 0, ready: false };
    }
  })();

  function loadAuthored() {
    // Give every authored cell its atlas UV region (buildAtlas only records the
    // procedural cells 0..18). Same 1px inset formula so GL.draw can index them.
    for (var nm in authored) {
      var rc = cellRect(authored[nm].cell), pad = 1.0;
      regions[authored[nm].cell] = [(rc.x + pad) / ATLAS_W, (rc.y + pad) / ATLAS_H, (CELL - pad * 2) / ATLAS_W, (CELL - pad * 2) / ATLAS_H];
    }
    var registry = (typeof window !== 'undefined' && window.SPRITES) || {};
    var isChromium = /Chrome\/|Chromium\/|HeadlessChrome/.test(navigator.userAgent);
    var canProbe = !(location.protocol === 'file:' && isChromium);
    for (var name in authored) {
      (function (name) {
        var a = authored[name];
        var src = registry[name] ? registry[name]
          : (canProbe ? 'art/sprites/' + name + '.png' : null);
        if (!src) return;
        var img = new Image();
        img.onload = function () {
          try { compositeSprite(a.cell, a.rot, img); a.ready = true; }
          catch (e) { /* tainted / bad image: keep the generic/procedural fallback */ }
        };
        img.onerror = function () { /* no art for this sprite: fall back */ };
        img.src = src;
      })(name);
    }
  }

  // Atlas cell index for a named authored sprite, or -1 until (and unless) it
  // has loaded. Callers draw the returned cell with GL.draw and white tint to
  // show the sprite's own colours; -1 means fall back to a generic slot.
  GL.authoredSpr = function (name) { var a = authored[name]; return (a && a.ready) ? a.cell : -1; };

  // Draw-size compensation for a cell (subject-fraction sizing; see `sprFill`). Draw
  // authored enemy cells at e.scale * GL.sprFill(cell) so the painted subject spans
  // what e.scale intends, matching the procedural fallback's edge-to-edge fill. Returns
  // 1 for procedural / un-measured cells. VISUAL ONLY — collision never reads this.
  GL.sprFill = function (cell) { var f = sprFill[cell]; return f > 0 ? f : 1; };

  // ---- drop-in painted backdrop layers --------------------------------------
  // Same doctrine as the sprite overrides: procedural parallax ships now (drawn
  // by game.js with GL.draw), and painted layers drop in later. A layer PNG is
  // probed at art/backdrops/<sector>-<layer>.png (deep|structure|debris) or
  // supplied via window.BACKDROPS[slot] (data: URI, same-origin everywhere).
  // Under Chromium file:// the probe is skipped (an opaque-origin image would
  // throw on texImage2D) — registry only, exactly like the sprite loader.
  var VS_BACKDROP =
'#version 300 es\n' +
'layout(location=0) in vec2 a_quad;\n' +
'uniform vec4 u_rect;\n' +            // cx, cy, w, h (playfield px)
'uniform vec2 u_playfield;\n' +
'uniform vec2 u_scroll;\n' +          // uv offset (parallax)
'out vec2 v_uv;\n' +
'void main(){\n' +
'  vec2 world = u_rect.xy + a_quad * u_rect.zw;\n' +
'  vec2 clip = world / u_playfield * 2.0 - 1.0;\n' +
'  clip.y = -clip.y;\n' +
'  gl_Position = vec4(clip, 0.0, 1.0);\n' +
'  v_uv = (a_quad + 0.5) + u_scroll;\n' +
'}\n';
  var FS_BACKDROP =
'#version 300 es\n' +
'precision highp float;\n' +
'in vec2 v_uv;\n' +
'uniform sampler2D u_tex;\n' +
'uniform vec4 u_tint;\n' +
'out vec4 frag;\n' +
'void main(){\n' +
'  vec4 t = texture(u_tex, fract(v_uv));\n' +
'  frag = vec4(t.rgb * u_tint.rgb, t.a) * u_tint.a;\n' +   // premultiplied-over
'}\n';

  var progBackdrop = null, uBackdrop = null, backdropVAO = null;
  var backdrops = {};   // slot -> { tex, ready, w, h }

  function buildBackdropGL() {
    progBackdrop = link(VS_BACKDROP, FS_BACKDROP);
    if (!progBackdrop) return;
    uBackdrop = uniforms(progBackdrop, ['u_rect', 'u_playfield', 'u_scroll', 'u_tex', 'u_tint']);
    backdropVAO = gl.createVertexArray();
    gl.bindVertexArray(backdropVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);   // reuse the unit quad
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindVertexArray(null);
  }

  function makeImageTexture(img) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    // texImage2D of a cross-origin image throws (Chrome file:// probe) — caller
    // guards the probe channel so this only runs on same-origin data: URIs there.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  function loadBackdrops() {
    var registry = (typeof window !== 'undefined' && window.BACKDROPS) || {};
    var isChromium = /Chrome\/|Chromium\/|HeadlessChrome/.test(navigator.userAgent);
    var canProbe = !(location.protocol === 'file:' && isChromium);
    var sectors = ['s1', 's2', 's3'], layers = ['deep', 'structure', 'debris'];
    for (var si = 0; si < sectors.length; si++) {
      for (var li = 0; li < layers.length; li++) {
        (function (slot) {
          var src = registry[slot] ? registry[slot]
            : (canProbe ? 'art/backdrops/' + slot + '.png' : null);
          if (!src) return;
          var img = new Image();
          img.onload = function () {
            try { backdrops[slot] = { tex: makeImageTexture(img), ready: true, w: img.width, h: img.height }; }
            catch (e) { /* tainted / bad image: procedural layer stays */ }
          };
          img.onerror = function () { /* no art for this slot */ };
          img.src = src;
        })(sectors[si] + '-' + layers[li]);
      }
    }
  }

  GL.backdropReady = function (slot) { var b = backdrops[slot]; return !!(b && b.ready); };

  // Draw a painted backdrop layer as a full-field textured quad (parallax via
  // scrollY in uv units). Self-contained blend: flushes the additive batch,
  // draws premultiplied-over, then restores additive so the caller's next
  // GL.draw picks up where it left off.
  GL.drawBackdrop = function (slot, cx, cy, w, h, r, g, b, a, scrollY) {
    var bd = backdrops[slot];
    if (!bd || !bd.ready || !progBackdrop) return;
    flushSprites();
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progBackdrop);
    gl.bindVertexArray(backdropVAO);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bd.tex);
    gl.uniform1i(uBackdrop.u_tex, 0);
    gl.uniform2f(uBackdrop.u_playfield, GL.W, GL.H);
    gl.uniform4f(uBackdrop.u_rect, cx, cy, w, h);
    gl.uniform2f(uBackdrop.u_scroll, 0, scrollY || 0);
    gl.uniform4f(uBackdrop.u_tint, r, g, b, a);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.blendFunc(gl.ONE, gl.ONE);   // restore additive base pass
  };

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
    var prog = spriteMode === 'bullet' ? progSpriteBullet : progSprite;
    var u = spriteMode === 'bullet' ? uSpriteBullet : uSprite;
    gl.useProgram(prog);
    gl.uniform2f(u.u_playfield, GL.W, GL.H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(u.u_atlas, 0);
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

  // ---- blend-pass control (enemy-bullet opaque pass) ------------------------
  // The scene draws additively (ONE,ONE). Enemy bullets draw in their own pass
  // with premultiplied-over blending (ONE, ONE_MINUS_SRC_ALPHA) so their dark
  // #231A20 outlines occlude the glow behind them and survive the bloom crest.
  // Each call flushes the pending batch, then switches blend for what follows.
  GL.flush = function () { flushSprites(); };
  GL.blendPremult = function () { flushSprites(); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); };
  GL.blendAdditive = function () { flushSprites(); gl.blendFunc(gl.ONE, gl.ONE); };

  // Bind the enemy-bullet shader (channel-mix recolour) for the next batch, or
  // restore the default sprite shader. Flushes at the boundary so the pending
  // batch draws with the program it was queued under. Bullet cells are the only
  // thing drawn under the bullet shader; every other sprite keeps FS_SPRITE
  // (so authored ship overrides render their own texture colours unchanged).
  GL.useBulletShader = function (on) { flushSprites(); spriteMode = on ? 'bullet' : 'normal'; };

  // Repaint the six bullet-family cells to style 'A' or 'B' and re-upload them.
  // Safe to call at runtime (console: GL.setBulletStyle('B')); at build time the
  // cells are painted directly into the full-atlas upload instead.
  GL.setBulletStyle = function (s) {
    s = (s === 'B') ? 'B' : 'A';
    GL.bulletStyle = s;
    if (!atlasTex || !gl) return;
    if (!BULLET_FAMILIES) BULLET_FAMILIES = [
      [GL.SPR.ORB, paintOrb], [GL.SPR.GRING, paintGRing], [GL.SPR.KUNAI, paintKunai],
      [GL.SPR.SHARD, paintShard], [GL.SPR.PELLET, paintPellet], [GL.SPR.STAR, paintStar]
    ];
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (var i = 0; i < BULLET_FAMILIES.length; i++) {
      var spr = BULLET_FAMILIES[i][0], fn = BULLET_FAMILIES[i][1];
      var off = document.createElement('canvas'); off.width = CELL; off.height = CELL;
      var oc = off.getContext('2d');
      oc.translate(CELL / 2, CELL / 2);
      fn(oc, CELL / 2 - 2, s);
      var rc = cellRect(spr);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, rc.x, rc.y, CELL, CELL, gl.RGBA, gl.UNSIGNED_BYTE,
        premultiplied(oc.getImageData(0, 0, CELL, CELL)));
    }
  };

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
    progSpriteBullet = link(VS_SPRITE, FS_SPRITE_BULLET);
    progThresh = link(VS_FULL, FS_THRESHOLD);
    progBlur = link(VS_FULL, FS_BLUR);
    progComp = link(VS_FULL, FS_COMPOSITE);
    if (!progSprite || !progSpriteBullet || !progThresh || !progBlur || !progComp) return false;

    uSprite = uniforms(progSprite, ['u_playfield', 'u_atlas']);
    uSpriteBullet = uniforms(progSpriteBullet, ['u_playfield', 'u_atlas']);
    uThresh = uniforms(progThresh, ['u_tex', 'u_threshold']);
    uBlur = uniforms(progBlur, ['u_tex', 'u_dir']);
    uComp = uniforms(progComp, ['u_scene', 'u_bloomHalf', 'u_bloomQuarter', 'u_chroma', 'u_bloom']);

    buildAtlas();
    loadOverrides();   // async; the game renders the procedural cells until (and unless) art lands
    loadAuthored();    // async; per-archetype / projectile / owned-entity sprites (cells 19+)
    buildBatcher();
    buildBackdropGL();
    loadBackdrops();   // async; painted parallax layers drop in, else procedural
    GL.resize();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    return true;
  };

})();
