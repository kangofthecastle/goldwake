'use strict';
// Offline native-Canvas inspection of REAL procedural atlas + game draw calls.
// No browser, WebGL context, UI screenshot, or bloom simulation is involved.
// Usage: NODE_PATH=/path/to/bundled/node_modules node tests/render-preview.cjs /tmp/goldwake-preview
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas, ImageData } = require('@napi-rs/canvas');
const sharp = require('sharp');
const { gameHarness } = require('./original-game.test.cjs');
const root = path.join(__dirname, '..');
async function main() {
const enemyOnly=process.argv.includes('--only-enemies');
const out = process.argv[2] || '/tmp/goldwake-offline-preview';
fs.mkdirSync(out, { recursive: true });
const atlasContext = { document: { createElement: () => createCanvas(1, 1) } };
atlasContext.window = atlasContext;
vm.createContext(atlasContext);
let source = fs.readFileSync(path.join(root, 'js/gl.js'), 'utf8');
source = source.replace('    atlasTex = gl.createTexture();', '    return { canvas: cv, regions: regions };\n    atlasTex = gl.createTexture();');
source = source.replace(/\}\)\(\);\s*$/, 'GL.offlineAtlas = buildAtlas; GL.offlineComposite = compositeSprite; GL.offlineSources = { authored, SPRITE_SLOTS }; GL.offlineCellRect = cellRect;\n})();');
source = source.replace('    var rc = cellRect(cell);\n    gl.bindTexture', '    var rc = cellRect(cell); return off;\n    gl.bindTexture');
vm.runInContext(source, atlasContext);
const atlas = atlasContext.GL.offlineAtlas();
vm.runInContext(fs.readFileSync(path.join(root, 'js/sprites-data.js'), 'utf8'), atlasContext);
// Match runtime sheet handling: each authored frame resolves its original
// sheet source and passes the production normalized crop to compositeSprite.
// Never split/rewrite sheet PNGs on disk or normalize each pose independently.
const decodedSources=new Map(), loadedSheetFrames=[];
const targets=[...Object.entries(atlasContext.GL.offlineSources.SPRITE_SLOTS),
  ...Object.entries(atlasContext.GL.offlineSources.authored)];
for (const [name, cfg] of targets) {
  const sourceName=cfg.sheet || name, uri=atlasContext.SPRITES[sourceName];
  if (!uri) continue; // the real draw code chooses its procedural fallback
  const id=cfg.spr ?? cfg.cell;
  let img=decodedSources.get(sourceName);
  if(!img) {
    const decoded=await sharp(Buffer.from(uri.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    img=createCanvas(decoded.info.width,decoded.info.height);
    img.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(decoded.data),decoded.info.width,decoded.info.height),0,0);
    decodedSources.set(sourceName,img);
  }
  const painted=atlasContext.GL.offlineComposite(id,cfg.rot,img,(atlasContext.SPRITE_FRAME_SCALE || {})[sourceName],cfg.crop);
  const rect=atlasContext.GL.offlineCellRect(id),x=rect.x,y=rect.y,size=rect.size||painted.width;
  const ctx=atlas.canvas.getContext('2d');ctx.clearRect(x,y,size,size);ctx.drawImage(painted,x,y);
  const pad=size/128;
  atlas.regions[id]=[(x+pad)/atlas.canvas.width,(y+pad)/atlas.canvas.height,(size-pad*2)/atlas.canvas.width,(size-pad*2)/atlas.canvas.height];
  cfg.ready=true;
  if(cfg.sheet)loadedSheetFrames.push(name);
}

const h = gameHarness(42, (s, file) => file === 'game.js' ? s.replace("  if (document.readyState === 'loading')", "  Game.offlineDraw = { drawInfantry, drawEnemies, drawShots, ANUBIS_K, makeDestinationLandmark, spawnLandmarkInfantry, makeBackground, drawEnvironmentFlow, drawEnvironmentLandmark, spawnApostate, drawBackground, drawBulletHalos, drawBulletBodies, drawPlayer, drawHurledStones, spawnDarter, spawnGunship, spawnAegis, spawnAcolyte, spawnMoth, spawnCarrier, spawnSplitter, spawnGardener, spawnTurret, spawnWheelShip, spawnReactor, spawnMidship, spawnFlanker, spawnRainmaker, drawPauseTo:function(ctx){var old=hud;hud=ctx;try{pauseOverlay();}finally{hud=old;}} };\n  if (document.readyState === 'loading')") : file === 'run.js' ? s.replace('  Run.getArt = getArt;', '  Run.offlineArt = artCache; Run.getArt = getArt;') : s);
h.context.GL.SPR = atlasContext.GL.SPR;
h.context.GL.authoredSpr = atlasContext.GL.authoredSpr;
h.context.GL.sprFill = atlasContext.GL.sprFill;
h.Game.setMode('playing');
const calls = [];
let blend = "lighter", bulletShader=false;
h.context.GL.useBulletShader=on=>{bulletShader=on;};
h.context.GL.blendPremult = () => { blend = "source-over"; };
h.context.GL.blendAdditive = () => { blend = "lighter"; };
h.context.GL.draw = (...args) => calls.push([bulletShader?'bullet:'+blend:blend, ...args]);
h.context.GL.drawRegion = (...args) => calls.push([bulletShader?'bullet:'+blend:blend, ...args]);
const tinted = new Map();
function cell(spr, r, g, b, isBullet=false) {
  const key = [spr, r, g, b, isBullet].join('/');
  if (tinted.has(key)) return tinted.get(key);
  const reg = atlas.regions[spr];
  if (!reg) throw new Error(`Missing atlas cell ${spr}`);
  const width=Math.round(reg[2]*atlas.canvas.width),height=Math.round(reg[3]*atlas.canvas.height);
  const cv=createCanvas(width,height),ctx=cv.getContext('2d');
  ctx.drawImage(atlas.canvas, reg[0] * atlas.canvas.width, reg[1] * atlas.canvas.height,
    reg[2] * atlas.canvas.width, reg[3] * atlas.canvas.height, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    if(isBullet){
      const weight=pixels.data[i]/255,value=pixels.data[i+1]/255;
      pixels.data[i]=255*(1+(r-1)*weight)*value;
      pixels.data[i+1]=255*(1+(g-1)*weight)*value;
      pixels.data[i+2]=255*(1+(b-1)*weight)*value;
    }else{pixels.data[i]*=r;pixels.data[i+1]*=g;pixels.data[i+2]*=b;}
  }
  ctx.putImageData(pixels, 0, 0); tinted.set(key, cv); return cv;
}
function composite(ctx, scale = 1) {
  for (const [mode, spr, x, y, w, ht, rot, r, g, b, a, u0 = 0, v0 = 0, u1 = 1, v1 = 1] of calls.splice(0)) {
    if (a <= 0) continue;
    ctx.save(); ctx.globalCompositeOperation = mode.replace('bullet:',''); ctx.globalAlpha = Math.min(1, a);
    ctx.translate(x * scale, y * scale); ctx.rotate(rot);
    ctx.scale(w < 0 ? -1 : 1, ht < 0 ? -1 : 1);
    const sprite=cell(spr,r,g,b,mode.startsWith('bullet:'));
    ctx.drawImage(sprite,u0*sprite.width,v0*sprite.height,(u1-u0)*sprite.width,(v1-v0)*sprite.height, -Math.abs(w) * scale / 2, -Math.abs(ht) * scale / 2, Math.abs(w) * scale, Math.abs(ht) * scale);
    ctx.restore();
  }
}
function sheet(title, columns, rows) {
  const cv = createCanvas(columns * 220, rows * 220 + 75), ctx = cv.getContext('2d');
  ctx.fillStyle = '#141720'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#e1ddd4'; ctx.font = '18px sans-serif'; ctx.fillText(title, 15, 26);
  ctx.font = '12px sans-serif'; ctx.fillStyle = '#b6b5bc';
  ctx.fillText('Real game draw calls / native Canvas / game blend switches / no bloom / 1x scale', 15, 50);
  return { cv, ctx };
}
function panel(ctx, col, row, label, draw, grounded = true) {
  const x = col * 220, y = row * 220 + 75;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#252936'; ctx.fillRect(8, 8, 204, 174);
  // A muted bank-like plane illustrates the actual additive body contrast.
  if(grounded){ctx.fillStyle = '#484342'; ctx.fillRect(12, 125, 196, 55);}
  ctx.save();ctx.beginPath();ctx.rect(8,8,204,174);ctx.clip();ctx.translate(110,95);draw();composite(ctx,1);ctx.restore();
  ctx.fillStyle = '#d6d2cb'; ctx.font = '14px sans-serif'; ctx.fillText(label, 12, 205);
  ctx.restore();
}
const lm = h.Game.offlineDraw.makeDestinationLandmark(1);
lm.y = 200; h.Game.st().bg.landmark = lm;
h.Game.offlineDraw.spawnLandmarkInfantry(lm);
const guards = h.Engine.enemies.items.filter(e => e.active && e.ground);
const infantry = sheet('Infantry pose inspection — offline render', 4, 2);
for (const [row, arch] of ['archer', 'spearman'].entries()) {
  const e = guards.find(e => e.arch === arch); e.x = 0; e.y = 0; e.ground.aim = Math.PI * 0.3;
  for (const [col, pose] of ['ready', 'prepare', 'release', 'stride'].entries()) {
    e.ground.windup = pose === 'prepare' ? (arch === 'archer' ? 0.1 : 0.13) : 0;
    e.motionShot = pose === 'release' ? 0.055 : 1; e.ground.walk = pose === 'stride' ? 0.25 : 0;
    // Pose inspection deliberately shows each sheet frame, including the
    // archer walk frame even though normal archer gameplay is stationary.
    e.ground.patrol = pose === 'stride' ? 1 : 0;
    panel(infantry.ctx, col, row, `${arch} / ${pose}`, () => { h.context.GL.blendPremult(); h.Game.offlineDraw.drawInfantry(e); h.context.GL.blendAdditive(); });
  }
}
if(!enemyOnly)fs.writeFileSync(path.join(out, 'infantry-poses.png'), infantry.cv.toBuffer('image/png'));
const kinds = [9, 7, 11, 12, 13, 14, 15, 17];
const labels=['Artemis arrow','Imperial edict','Ares javelin','Ares sword','Ares spear','Ares axe','Odin rune','Anubis ankh'];
const shots = sheet('Player projectile inspection — offline render', 4, 2);
for (let i = 0; i < kinds.length; i++) {
  h.Engine.shots.forEach(s => h.Engine.shots.release(s));
  const s = h.Engine.shots.alloc();
  Object.assign(s, { x: 0, y: 0, vx: 360, vy: -600, kind: kinds[i], age: 0.15,
    scale: 30, damage: 2, r: 0.9, g: 0.6, b: 0.3, big: false, fireId: 0 });
  panel(shots.ctx, i % 4, Math.floor(i / 4), labels[i], () => h.Game.offlineDraw.drawShots());
}
if(!enemyOnly)fs.writeFileSync(path.join(out, 'attack-poses.png'), shots.cv.toBuffer('image/png'));
h.Engine.enemies.forEach(e => h.Engine.enemies.release(e));
const enemyRoles=['hawk','gunship','moth','weaver2','aegis','acolyte','splitter','carrier','gardener','mimic','assessor','tribute','Talos','Ammit','Midas','Apostate'];
const enemies=sheet('Enemy roles — offline renderer / no GPU bloom / normalized body size 85 at 1x',4,enemyRoles.length);
for(const [row,role] of enemyRoles.entries()) {
  h.Game.st().boss=null;
  const bossKey={Talos:'warden',Ammit:'warden2',Midas:'sovereign'}[role];
  let e;
  if(bossKey) {
    h.Game.beginBoss(h.Game.bosses[bossKey],1);e=h.Game.st().boss;
  } else if(role==='Apostate') {
    h.Game.offlineDraw.spawnApostate(1);e=h.Engine.enemies.items.find(e=>e.active&&e.arch==='apostate');
  } else {
    const index=h.Game.test.spawnDummy(0,0,10000);e=h.Engine.enemies.items[index];
    e.type=role==='hawk'?1:30;e.arch=role==='hawk'?'':role;
  }
  if(!e)throw new Error(`No real actor for ${role}`);
  e.rot=Math.PI;e.szDone=false;h.Game.test.forceSize(e._i);e.x=0;e.y=0;
  e.scale=85;e.arrived=true;e.nailX=0;e.nailY=25;
  for(const [col,pose] of ['idle','prepare','release','recover'].entries()) {
    e.poseT=pose==='prepare'?0.1:0;e.motionPoseMax=.5;
    e.fireCd=e.fireCd||1.8;e.fireT=pose==='prepare'?.1:pose==='release'?e.fireCd:e.fireCd*.6;
    e.motionShot=pose==='release'?.055:pose==='recover'?.17:1;
    e.t=1+col*.2;h.Game.st().time=1+col*.2;
    if(role==='aegis')e.shieldT=pose==='release'?.8:pose==='recover'?.3:0;
    if(role==='acolyte')e.link=pose==='release'?{active:true,dying:false,x:65,y:-12,hp:50,maxhp:100}:null;
    if(role==='mimic')e.s0=col>=2?1:0;
    if(role==='Talos')e.nailActive=col>=2;
    if(role==='Midas')e.hoard=col>=2?18:0;
    panel(enemies.ctx,col,row,`${role} / ${pose}`,()=>h.Game.offlineDraw.drawEnemies(),false);
  }
  h.Engine.enemies.forEach(actor=>h.Engine.enemies.release(actor));h.Game.st().boss=null;
}
fs.writeFileSync(path.join(out,'enemy-poses.png'),enemies.cv.toBuffer('image/png'));
// Keep the full roster and two readable pages so inspection does not depend on
// a viewer shrinking a sixteen-row image below its native pixel size.
for(const [page,start] of [['enemy-common-poses.png',0],['enemy-boss-retinue-poses.png',8]]) {
  const crop=createCanvas(880,1835),c=crop.getContext('2d');
  c.drawImage(enemies.cv,0,0,880,75,0,0,880,75);
  c.drawImage(enemies.cv,0,75+start*220,880,1760,0,75,880,1760);
  fs.writeFileSync(path.join(out,page),crop.toBuffer('image/png'));
}
if(process.argv.includes('--animation')) {
  // This is a repeatable timer/pose inspection, not a live gameplay recording.
  // The real renderer sees continuous time and an explicit prepare/fire/recover
  // sequence. AI movement/collision are intentionally held outside this fixture.
  const roles=['hawk','gunship','moth','weaver2','splitter','carrier','gardener','aegis','acolyte'];
  const actors=roles.map(role=>{
    const index=h.Game.test.spawnDummy(0,0,10000),e=h.Engine.enemies.items[index];
    e.type=role==='hawk'?1:30;e.arch=role==='hawk'?'':role;e.rot=Math.PI;
    e.szDone=false;h.Game.test.forceSize(index);e.scale=85;e.x=e.y=0;return e;
  });
  const animationRows=Math.ceil(roles.length/4);
  const frames=[],frameCount=48,width=880,height=animationRows*220+75;
  for(let frame=0;frame<frameCount;frame++) {
    const time=frame/20,windup=time>=.5&&time<1,afterShot=time>=1?time-1:1;
    h.Game.st().time=time;actors.forEach(e=>e.active=false);
    const anim=sheet('Enemy motion / actual draw calls / controlled timer sequence / no GPU bloom',4,animationRows);
    for(let i=0;i<actors.length;i++) {
      const e=actors[i];e.active=true;e.t=time;e.poseT=windup?1-time:0;e.motionPoseMax=.5;
      e.motionShot=afterShot;e.fireCd=1.8;e.fireT=windup?1-time:Math.max(0,1.8-afterShot);
      e.shieldT=roles[i]==='aegis'&&time>=1?Math.max(0,.8-(time-1)):0;
      e.link=roles[i]==='acolyte'&&time>=1&&time<1.4?{active:true,dying:false,x:65,y:-12,hp:50,maxhp:100}:null;
      panel(anim.ctx,i%4,Math.floor(i/4),roles[i]+' / '+(windup?'prepare':time>=1&&time<1.4?'release':'idle'),()=>h.Game.offlineDraw.drawEnemies(),false);
      e.active=false;
    }
    frames.push(Buffer.from(anim.ctx.getImageData(0,0,width,height).data));
  }
  actors.forEach(e=>{e.active=true;h.Engine.enemies.release(e);});
  await sharp(Buffer.concat(frames),{raw:{width,height:height*frameCount,channels:4,pageHeight:height}})
    .gif({loop:0,delay:Array(frameCount).fill(50),colours:128}).toFile(path.join(out,'enemy-motion.gif'));
}

vm.runInContext(fs.readFileSync(path.join(root,'js/backdrops-data.js'),'utf8'),atlasContext);
async function backdrop(name) {
  const uri=atlasContext.BACKDROPS[name];
  const d=await sharp(Buffer.from(uri.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const cv=createCanvas(d.info.width,d.info.height);cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data),d.info.width,d.info.height),0,0);return cv;
}
const backdropImages=new Map(),gradedBackdrops=new Map();
let routeContext=null;
h.context.GL.backdropReady=name=>backdropImages.has(name);
h.context.GL.drawBackdrop=(name,cx,cy,w,ht,r,g,b,a,scroll=0,gamma=1,lift=0,repeat=false,fadeTop=0,fadeBottom=0)=>{
  if(!routeContext||!backdropImages.has(name))return;
  composite(routeContext,1); // match WebGL drawBackdrop flushing prior sprites
  const key=[name,r,g,b,gamma,lift,fadeTop,fadeBottom].join('/');let image=gradedBackdrops.get(key);
  if(!image){
    const original=backdropImages.get(name);image=createCanvas(original.width,original.height);
    const c=image.getContext('2d');c.drawImage(original,0,0);const pixels=c.getImageData(0,0,image.width,image.height);
    for(let i=0;i<pixels.data.length;i+=4)for(let channel=0;channel<3;channel++)
      pixels.data[i+channel]=255*(Math.pow(pixels.data[i+channel]/255,gamma)+lift*pixels.data[i+3]/255)*[r,g,b][channel];
    if(fadeTop||fadeBottom)for(let y=0;y<image.height;y++){
      const v=y/(image.height-1),smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
      const fade=(fadeTop?smooth(v/fadeTop):1)*(fadeBottom?smooth((1-v)/fadeBottom):1);
      for(let x=0;x<image.width;x++)pixels.data[(y*image.width+x)*4+3]*=fade;
    }
    c.putImageData(pixels,0,0);gradedBackdrops.set(key,image);
  }
  routeContext.save();routeContext.globalCompositeOperation='source-over';routeContext.globalAlpha=a;
  routeContext.drawImage(image,cx-w/2,cy-ht/2,w,ht);routeContext.restore();
};
const routes=createCanvas(990,1155), rc=routes.getContext('2d');
rc.fillStyle='#141720';rc.fillRect(0,0,990,1155);rc.fillStyle='#ddd8d0';rc.font='18px sans-serif';rc.fillText('Route geometry inspection — actual assets / offline renderer / no GPU bloom',15,27);
rc.font='12px sans-serif';rc.fillText('Actual flow and landmark shadow calls; cyan collision outlines; sky has no foot soldiers.',15,50);
for(let sector=0;sector<3;sector++) {
  const art=await backdrop(`s${sector+1}-landmark`), scene=await backdrop(`s${sector+1}-scene2`);
  backdropImages.set(`s${sector+1}-landmark`,art);
  for(let crossing=0;crossing<3;crossing++){
    const lm=h.Game.offlineDraw.makeDestinationLandmark(sector,crossing);lm.y=0;
    rc.save();rc.translate(crossing*330+5,sector*365+65);rc.beginPath();rc.rect(0,0,320,325);rc.clip();rc.scale(320/1080,320/1080);
    rc.globalAlpha=.6;rc.drawImage(scene,0,0,1080,1920);rc.globalAlpha=1;
    const bg=h.Game.offlineDraw.makeBackground(sector);bg.landmark=lm;bg.obstacles=lm.obstacles;
    bg.flowY=650;bg.dimFactor=1;bg.bright=1;h.Game.st().bg=bg;
    for(const ob of lm.obstacles){ob.originY=lm.y;ob.y=lm.y+ob.dy;}
    h.Game.offlineDraw.drawEnvironmentFlow(bg,1);composite(rc,1);
    routeContext=rc;h.Game.offlineDraw.drawEnvironmentLandmark();routeContext=null;
    rc.strokeStyle='rgba(140,222,217,.50)';rc.lineWidth=3;
    for(const ob of lm.obstacles){rc.beginPath();for(let i=0;i<ob.points.length;i++){const p=ob.points[i];if(i)rc.lineTo(p.x,p.y);else rc.moveTo(p.x,p.y);}rc.closePath();rc.stroke();}
    rc.restore();rc.fillStyle='#ddd8d0';rc.font='13px sans-serif';rc.fillText(`Sector ${sector+1}: ${lm.routeName}`,crossing*330+10,sector*365+412);
  }
}
if(!enemyOnly)fs.writeFileSync(path.join(out,'route-crossings.png'),routes.toBuffer('image/png'));
if(process.argv.includes('--scenes')) {
  for(let sector=0;sector<3;sector++) {
    // Each composition begins from an isolated, reset run. These are staged
    // readability fixtures made with real spawn/render paths, not screenshots.
    h.Game.resetRun({});h.Game.setMode('playing');h.Game.st().time=3;
    calls.length=0;blend='lighter';bulletShader=false;
    for(let scene=1;scene<=3;scene++) {
      const name=`s${sector+1}-scene${scene}`;
      if(!backdropImages.has(name))backdropImages.set(name,await backdrop(name));
    }
    const bg=h.Game.offlineDraw.makeBackground(sector),lm=h.Game.offlineDraw.makeDestinationLandmark(sector,sector===2?0:1);
    lm.y=230;bg.landmark=lm;bg.obstacles=lm.obstacles;bg.routeY=bg.sceneSpan*.82;
    bg.flowY=800;bg.dimFactor=.70;bg.bright=1;h.Game.st().bg=bg;
    for(const ob of lm.obstacles){ob.originY=lm.y;ob.y=lm.y+ob.dy;}
    h.Game.offlineDraw.spawnLandmarkInfantry(lm);
    for(const e of h.Engine.enemies.items.filter(e=>e.active&&e.ground)) {
      e.ground.aim=Math.atan2(1580-e.y,540-e.x);e.ground.windup=.15;e.motionShot=1;
    }
    const spawnAt=(spawn,x,y)=>{
      const before=new Set(h.Engine.enemies.items.filter(e=>e.active).map(e=>e.seq));spawn();
      const e=h.Engine.enemies.items.find(e=>e.active&&!before.has(e.seq));
      if(e){e.x=x;e.y=y;e.rot=Math.PI;e.t=3;e.motionShot=.18;e.poseT=0;h.Game.test.forceSize(e._i);}return e;
    };
    const api=h.Game.offlineDraw;
    if(sector===0){spawnAt(()=>api.spawnGunship(true),570,510);spawnAt(()=>api.spawnDarter(320,500,1000),310,980);spawnAt(()=>api.spawnDarter(760,500,80),765,1130);}
    if(sector===1){const tank=spawnAt(()=>api.spawnAegis(480),440,900);const healer=spawnAt(()=>api.spawnAcolyte(700),690,690);tank.hp=tank.maxhp*.6;healer.link=tank;spawnAt(()=>api.spawnMoth(300),250,1230);}
    if(sector===2){spawnAt(()=>api.spawnCarrier(1),540,530);spawnAt(()=>api.spawnSplitter(350,950,0),340,1010);spawnAt(()=>api.spawnGardener(760),765,1140);}
    h.Game.test.setPlayer(540,1630);h.Game.st().player.invuln=0;
    const P=h.context.Patterns;
    for(let row=0;row<3;row++)for(let col=0;col<7;col++){
      const x=170+col*118+Math.sin(col+row)*20,y=1050+row*150+Math.cos(col)*30;
      const b=P.bullet(x,y,Math.PI/2+(col-3)*.12,240,{fam:row===1?P.FAM.KUNAI:P.FAM.PELLET,tier:'M',color:row===1?P.ORANGE:P.CYAN});
      b.age=.5;b.flash=0;
    }
    for(let row=0;row<4;row++){
      const shot=h.Engine.shots.alloc();Object.assign(shot,{x:540+(row%2?16:-16),y:1470-row*135,vx:0,vy:-700,kind:[9,12,7][sector],age:.2,scale:24,damage:2,r:.9,g:.7,b:.4,fireId:row,big:false});
    }
    const scene=createCanvas(540,1020),ctx=scene.getContext('2d');ctx.fillStyle='#10151d';ctx.fillRect(0,0,540,1020);
    ctx.fillStyle='#ddd8d0';ctx.font='15px sans-serif';ctx.fillText(`Sector ${sector+1} / staged full-field composition`,12,22);
    ctx.font='11px sans-serif';ctx.fillText('Actual game draw calls / half scale / no WebGL bloom / no HUD',12,42);
    ctx.save();ctx.translate(0,60);ctx.scale(.5,.5);ctx.beginPath();ctx.rect(0,0,1080,1920);ctx.clip();
    routeContext=ctx;api.drawBackground();api.drawEnvironmentLandmark();routeContext=null;
    api.drawEnemies();api.drawShots();api.drawBulletHalos();
    h.context.GL.blendPremult();h.context.GL.useBulletShader(true);api.drawBulletBodies();
    h.context.GL.useBulletShader(false);h.context.GL.blendAdditive();api.drawPlayer();composite(ctx,1);ctx.restore();
    fs.writeFileSync(path.join(out,`sector-${sector+1}-composition.png`),scene.toBuffer('image/png'));
  }
}
if(process.argv.includes('--talos')) {
  const sequence=createCanvas(1080,2040),seq=sequence.getContext('2d'),talosFrames=[];
  for(const [index,pose] of ['idle','prepare','release','recover'].entries()) {
    h.Game.resetRun({});h.Game.setMode('playing');calls.length=0;blend='lighter';bulletShader=false;
    h.Game.st().time=3+index*.12;
    const bg=h.Game.offlineDraw.makeBackground(0);bg.routeY=bg.sceneSpan*.82;bg.flowY=720;
    bg.dimFactor=.62;bg.bright=1;bg.role='boss';h.Game.st().bg=bg;
    for(let scene=1;scene<=3;scene++){
      const name=`s1-scene${scene}`;if(!backdropImages.has(name))backdropImages.set(name,await backdrop(name));
    }
    h.Game.beginBoss(h.Game.bosses.warden,1);
    const boss=h.Game.st().boss;boss.x=540;boss.y=420;boss.arrived=true;boss.rot=Math.PI;
    h.Game.test.forceSize(boss._i);boss.t=3+index*.12;
    boss.poseT=pose==='prepare'?.2:0;boss.motionPoseMax=.5;
    boss.motionShot=pose==='release'?.04:pose==='recover'?.25:1;
    boss.fireCd=1.8;boss.fireT=pose==='prepare'?.2:1.8;
    h.Game.test.armNail();boss.nailX=boss.x+Math.sin(boss.t*4)*16;boss.nailY=boss.y+boss.scale*.44;
    h.Game.test.setPlayer(540,1630);h.Game.st().player.invuln=0;
    const P=h.context.Patterns;
    for(let row=0;row<3;row++)for(let col=0;col<7;col++){
      const bullet=P.bullet(185+col*115+(row%2)*18,940+row*170+Math.cos(col)*30,Math.PI/2+(col-3)*.09,240,{fam:row===1?P.FAM.KUNAI:P.FAM.PELLET,tier:'M',color:row===1?P.ORANGE:P.CYAN});
      bullet.age=.7;bullet.flash=0;
    }
    for(const [x,y] of [[300,750],[770,890]]){
      const b=P.bullet(x,y,Math.PI/2,180,{fam:P.FAM.ORB,tier:'XL',color:P.ORANGE,burstY:1250,life:12});b.age=.6;b.flash=0;
    }
    for(let row=0;row<4;row++){
      const shot=h.Engine.shots.alloc();Object.assign(shot,{x:540+(row%2?12:-12),y:1450-row*150,vx:0,vy:-700,kind:9,age:.2,scale:24,damage:2,r:.9,g:.95,b:1,fireId:row,big:false});
    }
    const page=createCanvas(540,1020),ctx=page.getContext('2d');ctx.fillStyle='#10151d';ctx.fillRect(0,0,540,1020);
    ctx.fillStyle='#ddd8d0';ctx.font='15px sans-serif';ctx.fillText(`Talos / ${pose} / actual combat dimensions`,12,22);
    ctx.font='11px sans-serif';ctx.fillText(`Native Canvas / half scale / body ${boss.scale.toFixed(1)} / nail diameter ${boss.nailR*2} / no GPU bloom`,12,42);
    ctx.save();ctx.translate(0,60);ctx.scale(.5,.5);ctx.beginPath();ctx.rect(0,0,1080,1920);ctx.clip();
    routeContext=ctx;h.Game.offlineDraw.drawBackground();routeContext=null;
    h.Game.offlineDraw.drawEnemies();h.Game.offlineDraw.drawShots();h.Game.offlineDraw.drawBulletHalos();
    h.context.GL.blendPremult();h.context.GL.useBulletShader(true);h.Game.offlineDraw.drawBulletBodies();
    h.context.GL.useBulletShader(false);h.context.GL.blendAdditive();h.Game.offlineDraw.drawHurledStones();h.Game.offlineDraw.drawPlayer();
    composite(ctx,1);ctx.restore();
    fs.writeFileSync(path.join(out,`talos-combat-${pose}.png`),page.toBuffer('image/png'));
    seq.drawImage(page,(index%2)*540,Math.floor(index/2)*1020);
    talosFrames.push(Buffer.from(ctx.getImageData(0,0,540,1020).data));
  }
  fs.writeFileSync(path.join(out,'talos-combat-sequence.png'),sequence.toBuffer('image/png'));
  // Four authored poses at their existing state windows, not interpolated art.
  await sharp(Buffer.concat(talosFrames),{raw:{width:540,height:4080,channels:4,pageHeight:1020}})
    .gif({loop:0,delay:[700,500,120,350],colours:128}).toFile(path.join(out,'talos-combat-motion.gif'));
}
  h.context.Image=class { set src(value){this.path=value;} };
  const loadRequestedArt=async()=>{
    let loaded=0;
    for(const [slug,entry] of Object.entries(h.Run.offlineArt)) {
      if(entry.ok)continue;
      const filename=path.join(root,entry.img.path || ('art/gen/'+slug+'.png'));
      if(!fs.existsSync(filename))continue;
      const d=await sharp(filename).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const cv=createCanvas(d.info.width,d.info.height);cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data),d.info.width,d.info.height),0,0);
      h.Run.offlineArt[slug]={img:cv,ok:true};loaded++;
    }
    return loaded;
  };

if(process.argv.includes('--title')) {
  const originalController=h.Engine.controllerActive;
  h.Game.setMode('title');
  for(const pad of [false,true]) {
    h.Engine.controllerActive=()=>pad;
    const full=createCanvas(1080,1920),ctx=full.getContext('2d');
    h.Run.draw(ctx);await loadRequestedArt();h.Run.draw(ctx);
    if(await loadRequestedArt())h.Run.draw(ctx);
    const name=pad?'controller':'keyboard';
    fs.writeFileSync(path.join(out,`title-${name}-native.png`),full.toBuffer('image/png'));
    const small=createCanvas(540,990),sc=small.getContext('2d');
    sc.fillStyle='#10151d';sc.fillRect(0,0,540,990);sc.fillStyle='#d5d8d8';sc.font='12px sans-serif';
    sc.fillText(`Actual Run.draw / ${name} / native Canvas / half-scale preview`,10,19);
    sc.drawImage(full,0,30,540,960);
    fs.writeFileSync(path.join(out,`title-${name}-preview.png`),small.toBuffer('image/png'));
  }
  h.Engine.controllerActive=originalController;
}
if(process.argv.includes('--menus')) {
  for(const name of ['sector','draft','shop','pause-keyboard','pause-controller']) {
    h.Run.startRun(418);h.Game.st().wallet=740;
    if(name==='draft')h.Run.onCleared('wave');
    if(name==='shop')h.Run.onCleared('boss');
    const paused=name.startsWith('pause');
    if(paused){h.Game.setMode('playing');h.Game.st().paused=true;}
    const previousController=h.Engine.controllerActive;
    h.Engine.controllerActive=()=>name==='pause-controller';
    const full=createCanvas(1080,1920),ctx=full.getContext('2d');
    const draw=()=>{
      ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#08141d';ctx.fillRect(0,0,1080,1920);ctx.textBaseline='top';
      if(paused)h.Game.offlineDraw.drawPauseTo(ctx);else h.Run.draw(ctx);
    };
    draw();await loadRequestedArt();draw();
    if(await loadRequestedArt())draw();
    fs.writeFileSync(path.join(out,`menu-${name}-native.png`),full.toBuffer('image/png'));
    const preview=createCanvas(540,990),pc=preview.getContext('2d');pc.fillStyle='#10151d';pc.fillRect(0,0,540,990);
    pc.fillStyle='#d5d8d8';pc.font='12px sans-serif';pc.fillText(`Actual ${paused?'pauseOverlay':'Run.draw'} / ${name} / native Canvas / half scale`,10,19);pc.drawImage(full,0,30,540,960);
    fs.writeFileSync(path.join(out,`menu-${name}-preview.png`),preview.toBuffer('image/png'));
    h.Engine.controllerActive=previousController;
  }
}
if(process.argv.includes('--marks')) {
  const rows=[['Hunted','artemis',[0,4,8]],['Runes','odin',[1,5,9]],['Coiled','quetz',[1,3,6]],
    ['Weighing','anubis',[.05,.40,.85]],['Seal','jade',[0,.15,.30]],['Mischief','loki',[0,1,2]],['Precision','zeus',[0,1,2]]];
  const cv=createCanvas(1080,2320),ctx=cv.getContext('2d');ctx.fillStyle='#10151d';ctx.fillRect(0,0,1080,2320);
  ctx.fillStyle='#e2ddd4';ctx.font='18px sans-serif';ctx.fillText('Combat marks / actual Game.drawEnemies + drawKitOverlays',14,26);
  ctx.font='13px sans-serif';ctx.fillText('Real spawned gunship at 1x / native Canvas / no WebGL or GPU bloom',14,49);
  for(const [row,[name,god,values]] of rows.entries())for(const [col,value] of values.entries()){
    h.Game.resetRun({});h.Game.setMode('playing');h.Game.test.setAttackGod(god);h.Game.offlineDraw.spawnGunship(true);
    const e=h.Engine.enemies.items.find(e=>e.active&&e.arch==='gunship');h.Game.test.forceSize(e._i);
    e.x=e.y=0;e.rot=Math.PI;e.motionShot=1;e.nodeState=0;e.aura=null;e.shieldT=1;h.Game.st().time=.25;
    if(name==='Hunted')Object.assign(h.Game.st().hunt,{foe:e,foeSeq:e.seq,stacks:value});
    if(name==='Runes')e.runes=value;
    if(name==='Coiled'){e.coilQ=value;e.coilT=.9;}
    if(name==='Weighing')e.scaleW=e.maxhp*h.Game.offlineDraw.ANUBIS_K*value;
    if(name==='Seal')e.sealT=value;
    if(name==='Mischief'){e.mischief=value;e.mischiefT=2.5;}
    if(name==='Precision'){e.nodeState=value;e.nodeX=0;e.nodeY=0;e.nodeHit=0;}
    ctx.save();ctx.translate(col*360,70+row*320);ctx.fillStyle='#26313a';ctx.fillRect(8,8,344,278);
    ctx.save();ctx.beginPath();ctx.rect(8,8,344,278);ctx.clip();ctx.translate(180,174);
    h.Game.offlineDraw.drawEnemies();composite(ctx,1);ctx.restore();
    const state=name==='Precision'?['inactive','armed','open'][value]:name==='Weighing'?Math.round(value*100)+'%':name==='Seal'?value+'s':value+' stacks';
    ctx.fillStyle='#e2ddd4';ctx.font='15px sans-serif';ctx.fillText(name+' / '+state,14,307);ctx.restore();
  }
  fs.writeFileSync(path.join(out,'combat-marks.png'),cv.toBuffer('image/png'));
  for(const [name,rowStart,rowCount] of [['combat-marks-stacks.png',0,4],['combat-marks-triggers.png',4,3]]){
    const page=createCanvas(1080,70+rowCount*320),pc=page.getContext('2d');pc.drawImage(cv,0,0,1080,70,0,0,1080,70);pc.drawImage(cv,0,70+rowStart*320,1080,rowCount*320,0,70,1080,rowCount*320);
    fs.writeFileSync(path.join(out,name),page.toBuffer('image/png'));
  }
}
if(process.argv.includes('--coverage')) {
  const roles=[['turret','Bronze bell',api=>api.spawnTurret(540,360)],
    ['wheel','Shield',api=>api.spawnWheelShip(540,360,160,0,4,0)],
    ['reactor','Scarab — head down',api=>api.spawnReactor(540)],
    ['midship','War barge',api=>api.spawnMidship(540)],
    ['flanker','Crossbow',api=>api.spawnFlanker(-1,0)],
    ['rainmaker','Rain ewer',api=>api.spawnRainmaker(540)],
    ['rivet','Bronze rivet',()=>{h.Game.beginBoss(h.Game.bosses.warden,1);h.Game.test.armRetinue('rivet',1);}]];
  const cv=createCanvas(1920,1120),ctx=cv.getContext('2d');
  ctx.fillStyle='#141720';ctx.fillRect(0,0,cv.width,cv.height);
  ctx.fillStyle='#e1ddd4';ctx.font='24px sans-serif';ctx.fillText('Additional enemy identities / actual spawned sizes at 1x',20,32);
  ctx.font='17px sans-serif';ctx.fillText('Real Game.drawEnemies / native Canvas / no WebGL or bloom / positioned for inspection',20,62);
  for(const [i,[role,label,spawn]] of roles.entries()){
    h.Game.resetRun({});h.Game.setMode('playing');spawn(h.Game.offlineDraw);
    const e=h.Engine.enemies.items.find(e=>e.active&&e.arch===role);
    if(!e)throw new Error('Coverage spawner failed: '+role);
    h.Game.test.forceSize(e._i);e.x=e.y=0;e.arrived=true;e.motionShot=1;e.poseT=0;
    h.Engine.enemies.forEach(other=>{if(other!==e)h.Engine.enemies.release(other);});h.Game.st().boss=null;h.Game.st().time=1;
    const x=(i%4)*480,y=90+Math.floor(i/4)*510;
    ctx.save();ctx.translate(x,y);ctx.fillStyle='#252936';ctx.fillRect(8,8,464,448);
    ctx.save();ctx.beginPath();ctx.rect(8,8,464,448);ctx.clip();ctx.translate(240,232);
    h.Game.offlineDraw.drawEnemies();composite(ctx,1);ctx.restore();
    ctx.fillStyle='#e1ddd4';ctx.font='19px sans-serif';ctx.fillText(label+' / '+role,16,480);
    ctx.font='14px sans-serif';ctx.fillStyle='#b6b5bc';ctx.fillText('Spawned body '+Math.round(e.scale)+' px; rotation '+e.rot.toFixed(2),16,502);ctx.restore();
  }
  fs.writeFileSync(path.join(out,'enemy-coverage.png'),cv.toBuffer('image/png'));
}
if(process.argv.includes('--status')) {
  const statusNames=['none','burn','marked','weak','stun','charm','terror','marked + weak','stacked + runes'];
  h.Game.resetRun({});h.Game.setMode('playing');h.Game.test.setAttackGod('odin');
  h.Game.offlineDraw.spawnGunship(true);
  const actor=h.Engine.enemies.items.find(e=>e.active&&e.arch==='gunship');
  actor.x=actor.y=0;actor.rot=Math.PI;actor.motionShot=1;h.Game.test.forceSize(actor._i);
  const applyStatus=(e,name)=>{
    e.marked=false;e.markT=0;e.weak=false;e.weakT=0;e.weakStacks=0;e.charmed=false;e.charmT=0;
    e.burnT=e.burnDps=e.stunT=e.terrorT=0;e.runes=0;
    const stacked=name==='stacked + runes';
    if(name==='marked'||name==='marked + weak'||stacked){e.marked=true;e.markT=4;}
    if(name==='weak'||name==='marked + weak'||stacked){e.weak=true;e.weakT=4;e.weakStacks=2;}
    if(name==='charm'||stacked){e.charmed=true;e.charmT=4;}
    if(name==='burn'||stacked){e.burnT=4;e.burnDps=22;}
    if(name==='stun'||stacked)e.stunT=4;
    if(name==='terror'||stacked)e.terrorT=4;
    if(stacked)e.runes=3;
  };
  const statusFrame=time=>{
    const cv=createCanvas(960,1060),ctx=cv.getContext('2d');ctx.fillStyle='#10151d';ctx.fillRect(0,0,960,1060);
    ctx.fillStyle='#e2ddd4';ctx.font='18px sans-serif';ctx.fillText('Status comparison / actual enemy and drawStatus calls / no GPU bloom',14,26);
    ctx.font='12px sans-serif';ctx.fillText(`Native Canvas / 1x / actual gunship size ${actor.scale.toFixed(1)} / time ${time.toFixed(2)}s`,14,48);
    h.Game.st().time=time;calls.length=0;blend='lighter';bulletShader=false;
    for(let i=0;i<statusNames.length;i++){
      const x=(i%3)*320,y=70+Math.floor(i/3)*330;applyStatus(actor,statusNames[i]);
      ctx.save();ctx.translate(x,y);ctx.fillStyle='#26313a';ctx.fillRect(8,8,304,290);
      ctx.save();ctx.beginPath();ctx.rect(8,8,304,290);ctx.clip();ctx.translate(160,180);
      h.Game.offlineDraw.drawEnemies();composite(ctx,1);ctx.restore();
      ctx.fillStyle='#dcd8d0';ctx.font='15px sans-serif';ctx.fillText(statusNames[i],14,319);ctx.restore();
    }
    return cv;
  };
  const still=statusFrame(.25);fs.writeFileSync(path.join(out,'status-comparison.png'),still.toBuffer('image/png'));
  const frames=[],count=24;
  for(let frame=0;frame<count;frame++)frames.push(Buffer.from(statusFrame(frame/20).getContext('2d').getImageData(0,0,960,1060).data));
  await sharp(Buffer.concat(frames),{raw:{width:960,height:1060*count,channels:4,pageHeight:1060}})
    .gif({loop:0,delay:Array(count).fill(50),colours:128}).toFile(path.join(out,'status-motion.gif'));
  // Boss fire is inspected at full production body size, not roster-normalized.
  h.Game.resetRun({});h.Game.setMode('playing');h.Game.beginBoss(h.Game.bosses.warden,1);
  const boss=h.Game.st().boss;boss.x=boss.y=0;boss.rot=Math.PI;boss.arrived=true;boss.motionShot=1;
  h.Game.test.forceSize(boss._i);h.Game.st().time=.25;
  for(const showcase of ['fire','terror']) {
  const effect=showcase==='fire'?'burn':'terror';
  const bc=createCanvas(1280,940),ctx=bc.getContext('2d');ctx.fillStyle='#10151d';ctx.fillRect(0,0,1280,940);
  ctx.fillStyle='#e2ddd4';ctx.font='18px sans-serif';ctx.fillText(`Boss ${effect} / actual Talos body ${boss.scale.toFixed(1)} / 1x / no GPU bloom`,14,28);
  for(let i=0;i<2;i++){
    applyStatus(boss,i?effect:'none');ctx.save();ctx.translate(i*640,60);ctx.fillStyle='#26313a';ctx.fillRect(10,10,620,810);
    ctx.save();ctx.beginPath();ctx.rect(10,10,620,810);ctx.clip();ctx.translate(320,350);h.Game.offlineDraw.drawEnemies();composite(ctx,1);ctx.restore();
    ctx.fillStyle='#dcd8d0';ctx.font='18px sans-serif';ctx.fillText(i?effect:'none',16,850);ctx.restore();
  }
  fs.writeFileSync(path.join(out,`status-boss-${showcase}.png`),bc.toBuffer('image/png'));
  }
}
console.log(JSON.stringify({ output: out, loadedSheetFrames, files: [...(enemyOnly ? [] : ['infantry-poses.png','attack-poses.png','route-crossings.png']), 'enemy-poses.png','enemy-common-poses.png','enemy-boss-retinue-poses.png', ...(process.argv.includes('--animation') ? ['enemy-motion.gif'] : []), ...(process.argv.includes('--scenes') ? ['sector-1-composition.png','sector-2-composition.png','sector-3-composition.png'] : []), ...(process.argv.includes('--talos') ? ['talos-combat-idle.png','talos-combat-prepare.png','talos-combat-release.png','talos-combat-recover.png','talos-combat-sequence.png','talos-combat-motion.gif'] : []), ...(process.argv.includes('--menus') ? ['sector','draft','shop','pause-keyboard','pause-controller'].flatMap(name=>[`menu-${name}-native.png`,`menu-${name}-preview.png`]) : []), ...(process.argv.includes('--marks') ? ['combat-marks.png','combat-marks-stacks.png','combat-marks-triggers.png'] : []), ...(process.argv.includes('--coverage') ? ['enemy-coverage.png'] : []), ...(process.argv.includes('--status') ? ['status-comparison.png','status-motion.gif','status-boss-fire.png','status-boss-terror.png'] : []), ...(process.argv.includes('--title') ? ['title-keyboard-native.png','title-controller-native.png','title-keyboard-preview.png','title-controller-preview.png'] : [])], limitations: 'Actual embedded selected textures and procedural atlas. No WebGL, bloom, camera or live gameplay.' }));

}
main().catch(error => { console.error(error); process.exitCode=1; });
