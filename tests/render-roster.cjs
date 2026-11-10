'use strict';
// Invoked by render-preview.cjs --roster. Production simulation + authored atlas;
// isolated fixtures, not a live WebGL capture. No gameplay state is persisted.
const fs = require('node:fs');
const path = require('node:path');
module.exports = async function ({h, createCanvas, sharp, composite, out, clearTint}) {
  const {Game, Run, Engine, context} = h, draw = Game.offlineDraw;
  // Capture EVERY 60 Hz simulation tick. Sampling once per four ticks aliases
  // the five-tick shot cadence: repeated volleys appear to travel backwards.
  const width=720, height=690, count=240, step=1, scale=1/3;
  const notes={
    zeus:['Hit → chain lightning.','Skyfall → damage + brief non-boss Stun.'],
    artemis:['First hit → one Mark; subsequent arrows home to it.','Piercing needle → Marks every target struck.'],
    aphrodite:['Repeated hits → Charm; bosses receive Weak.','Heart → Charm a minion, or Weak on a boss.'],
    ares:['Proximity → War Heat → stronger weapon stages.','Dive-bombers → Terror.'],
    heimdall:['Bridge contact → Marked; firing on bridge → spectrum lances.','Screen blast → Stun (1.2s) + bullet shove.'],
    ra:['Sustained beam on one foe → heat ramp. No base Burn.','Screen-wide ignition → Burn.'],
    anubis:['Hits → Weighing → Verdict. Survivors gain Weak.','Wounded targets → pull + missing-health damage.'],
    loki:['Three hit marks → Pilfer → return that foe’s bullets.','Decoy → attracts aimed fire and absorbs bullets.'],
    odin:['Repeated hits → permanent Runes → bonus damage.','Homing spear → pierces and Marks foes.'],
    wukong:['Kills may create a firing clone. Clone shown in this fixture.','Staff → column damage. No base Stun.'],
    guanyu:['Crescents → piercing hits → escalating damage.','Broad sweeping blade → damage + shove.'],
    jade:['Edicts → Weighing → Verdict. No Seal or attack Stun.','Twin clouds → lightning strikes + brief primary-target Stun.'],
    quetz:['Repeated bites on one body → Coil → bonus damage.','Serpent → consumes bullets into gauge.'],
    thor:['Returning hammer → outward and return hits. No base Stun.','Heavy hammer → damage + non-boss Stun (1.2s).']
  };
  const before=['drawHazards','drawKitBursts','drawBifrost','drawDuat','drawSkyfall','drawGold','drawEnemies','drawShots','drawParticles','drawBolts','drawBulletHalos'];
  const after=['drawHurledStones','drawDecoy','drawClones','drawRavens','drawGungnir','drawRaBeam','drawWraiths','drawJudgement','drawHammers','drawDebris','drawVerdictStamps','drawDashGhosts','drawPlayer'];
  function frame(god,slot,n){
    const cv=createCanvas(360,height),ctx=cv.getContext('2d');
    ctx.fillStyle='#0c1720';ctx.fillRect(0,0,360,height);
    ctx.strokeStyle='#1b2d37';ctx.lineWidth=1;
    for(let y=60;y<height;y+=64){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(360,y);ctx.stroke();}
    ctx.save();ctx.translate(0,38);ctx.beginPath();ctx.rect(0,0,360,640);ctx.clip();
    context.GL.blendAdditive();before.forEach(k=>draw[k]());
    context.GL.blendPremult();context.GL.useBulletShader(true);draw.drawBulletBodies();
    context.GL.useBulletShader(false);context.GL.blendAdditive();after.forEach(k=>draw[k]());
    composite(ctx,scale);ctx.restore();
    // Offline reference of the production composite's pressure refraction.
    // Resample the complete playfield (including the neutral backdrop), not sprites.
    const g=Game.st(),burst=[...g.kitBursts].reverse().find(v=>v.kind==='horn'&&g.time-v.t>=0&&g.time-v.t<0.38);
    if(burst){
      const horn={x:burst.x,y:burst.y,age:g.time-burst.t,playerX:g.player.x,playerY:g.player.y};
      const src=ctx.getImageData(0,38,360,640),dst=ctx.createImageData(360,640);
      for(let y=0;y<640;y++)for(let x=0;x<360;x++){
        const [dx,dy,shade]=context.GL.hornRefraction((x+.5)/scale,(y+.5)/scale,horn);
        const sx=Math.max(0,Math.min(359,x+dx*scale)),sy=Math.max(0,Math.min(639,y+dy*scale));
        const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(359,x0+1),y1=Math.min(639,y0+1),fx=sx-x0,fy=sy-y0;
        const at=(y*360+x)*4;
        for(let c=0;c<3;c++)dst.data[at+c]=((src.data[(y0*360+x0)*4+c]*(1-fx)+src.data[(y0*360+x1)*4+c]*fx)*(1-fy)+(src.data[(y1*360+x0)*4+c]*(1-fx)+src.data[(y1*360+x1)*4+c]*fx)*fy)*(1-shade);
        dst.data[at+3]=255;
      }
      ctx.putImageData(dst,0,38);
    }
    ctx.fillStyle='#091015';ctx.fillRect(0,0,360,38);ctx.fillRect(0,678,360,12);
    ctx.font='600 14px sans-serif';ctx.fillStyle=Run.GODS[god].css;ctx.fillText(slot==='attack'?'ATTACK · HOLD FIRE':'SPECIAL · SINGLE CAST',14,25);
    ctx.textAlign='right';ctx.fillStyle='#9aabb5';ctx.font='12px sans-serif';ctx.fillText((n*step/60).toFixed(1)+'s',345,25);
    return cv;
  }
  function targets(god,slot){
    const pts=[[540,1160],[360,1000],[720,1000],[540,770],[380,570],[700,570]];
    return pts.map(([x,y])=>{
      const hp=slot==='attack'&&(god==='jade'||god==='anubis')?190:4000;
      const e=Engine.enemies.items[Game.test.spawnDummy(x,y,hp)];
      e.hp=e.maxhp=hp;e.fireHold=99;
      if(god==='anubis'&&slot==='special')e.hp=hp*.5;
      return e;
    });
  }
  function bullets(enemies){
    for(const e of enemies){
      if(!e.active||e.dying||e.charmed||e.stunT>0||e.terrorT>0)continue;
      for(let j=-1;j<=1;j++){
        const b=Engine.bullets.alloc();if(!b)continue;
        Object.assign(b,{x:e.x+j*28,y:e.y+50,dir:Math.PI/2+j*.15,speed:170,accel:0,accel2:0,accelSwitchT:1e9,angVel:0,age:0,life:8,radius:8,scale:22,r:1,g:.35,b:.55,a:1,spr:context.GL.SPR.BULLET,fam:0,spin:0,oriented:false,flash:0,grazed:false,friendly:false,srcId:-1,ownerId:e.seq,timeScale:1,slowT:0,lensAcc:0});
      }
    }
  }
  const roster=[];
  const selected=process.env.ROSTER_GODS?new Set(process.env.ROSTER_GODS.split(',')):null;
  for(const [god,data] of Object.entries(Run.GODS)){
    if(selected&&!selected.has(god)){roster.push({god,...data,notes:notes[god]});continue;}
    const sides=[];
    for(const slot of ['attack','special']){
      Game.resetRun({});Game.setMode('playing');Engine.time=0;
      Game.test.setAttackGod(slot==='attack'?god:null,1);Game.test.setSpecialGod(slot==='special'?god:null,1);
      Game.test.setAutoFire(slot==='attack');Run.meta.enemyHealthBars=false;
      const g=Game.st();g.player.x=540;g.player.y=1400;g.player.invuln=99;
      const enemies=targets(god,slot),frames=[];
      for(let n=0;n<count;n++){
        if(slot==='special'&&n===20)Game.test.specialNow();
        if(god==='wukong'&&slot==='attack'&&n===32)draw.spawnClone();
        if((god==='loki'||god==='quetz'||god==='heimdall'||god==='anubis')&&n%48===0)bullets(enemies);
        Game.test.step(step);
        // Move the player away from Loki's stationary twin, revealing both bodies.
        if(god==='loki'&&slot==='special'&&n>24&&n<88)g.player.x+=9/4;
        frames.push(frame(god,slot,n));
      }
      sides.push(frames);
    }
    const raw=[];
    for(let n=0;n<count;n++){
      const cv=createCanvas(width,height),ctx=cv.getContext('2d');
      ctx.drawImage(sides[0][n],0,0);ctx.drawImage(sides[1][n],360,0);
      ctx.fillStyle='#64707b';ctx.fillRect(359,0,2,height);
      raw.push(Buffer.from(ctx.getImageData(0,0,width,height).data));
      if(n===(god==='heimdall'?24:god==='ra'?28:40))fs.writeFileSync(path.join(out,god+'.png'),cv.toBuffer('image/png'));
    }
    await sharp(Buffer.concat(raw),{raw:{width,height:height*count,channels:4,pageHeight:height}})
      // WebP preserves millisecond timing; GIF's centisecond timing cannot
      // reliably represent 60 fps in browsers. 17/17/16ms sums to 50ms.
      .webp({loop:0,delay:Array.from({length:count},(_,i)=>i%3===2?16:17),quality:80,effort:0})
      .toFile(path.join(out,god+'.webp'));
    roster.push({god,...data,notes:notes[god]});clearTint();console.log('Rendered '+data.name);
  }
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Goldwake · God kit review</title>
<style>*{box-sizing:border-box}body{margin:0;background:#090e13;color:#e8eee9;font:16px/1.5 system-ui,sans-serif}header,main{max-width:1500px;margin:auto;padding:32px}h1{font-size:40px;letter-spacing:-1.5px;margin:8px 0}p{color:#aab7c2;max-width:950px}small,.eyebrow{color:#83969f;font-size:12px;text-transform:uppercase;letter-spacing:2px}nav{display:flex;flex-wrap:wrap;gap:8px;margin:24px 0}nav a,button{color:#e8eee9;background:#18252f;border:1px solid #334550;padding:8px 13px;border-radius:6px;text-decoration:none;cursor:pointer}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px;padding-top:0}article{border:1px solid #2a3943;border-radius:14px;overflow:hidden;background:#101a22;scroll-margin-top:15px}article h2{margin:3px 0 18px;font-size:28px}.heading{padding:24px 24px 0}.preview{width:100%;height:auto;display:block}.captions{display:grid;grid-template-columns:1fr 1fr;gap:22px;padding:22px}.captions b{font-size:12px;letter-spacing:1px;color:#d5e1e7}.captions p{font-size:14px;margin:8px 0}.trigger{color:#e8eee9!important;border-top:1px solid #31414a;padding-top:12px}button{margin-left:10px}.note{font-size:13px}a{color:#bcddeb}@media(max-width:950px){main{grid-template-columns:1fr}header,main{padding:20px}h1{font-size:32px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}</style>
<header><div class="eyebrow">HUBRIS / GOLDWAKE · SIMPLIFIED KIT ART · OCT 13</div><h1>14 gods. 28 moves.</h1><p>Attack on the left. Special on the right. Base rank, no mods, duos, charms, or ultimates. Four-second, 60 fps loops use the current game simulation, authored art, and production draw calls.</p><p class="note">Isolated offline previews, not live gameplay recordings: neutral backdrop, stationary durable targets, and no WebGL bloom, camera shake, sound, or HUD. Heimdall includes a CPU reference of the scene-refraction effect; its button plays the production horn sound. Anubis’s special targets start wounded. Wukong’s attack fixture explicitly spawns one kill-reward clone. Enemy bullets are controlled test volleys.</p><button id="motion">Pause animations</button><nav>${roster.map(r=>`<a href="#${r.god}">${esc(r.name)}</a>`).join('')}</nav></header><main>${roster.map(r=>`<article id="${r.god}"><div class="heading"><small>${esc(r.pantheon)}</small><h2 style="color:${r.css}">${esc(r.name)}</h2></div><img class="preview" loading="lazy" src="${r.god}.webp" data-god="${r.god}" alt="${esc(r.name)} attack on the left and special on the right"><div class="captions"><section><b>ATTACK</b><p>${esc(r.attack)}</p><p class="trigger">${esc(r.notes[0])}</p></section><section><b>SPECIAL</b><p>${esc(r.special)}</p><p class="trigger">${esc(r.notes[1])}</p>${r.god==='heimdall'?'<button id="horn-audio">Play horn + animation</button>':''}</section></div></article>`).join('')}</main><script>${fs.readFileSync(path.join(__dirname,'../js/sfx.js'),'utf8').replace(/<\/script/gi,'<\\/script')}</script><script>let paused=matchMedia('(prefers-reduced-motion: reduce)').matches;function show(){document.querySelectorAll('.preview').forEach(i=>i.src=i.dataset.god+(paused?'.png':'.webp')+'?v=heimdall-clear-arc-oct13');document.querySelector('#motion').textContent=paused?'Play animations':'Pause animations';}document.querySelector('#motion').onclick=()=>{paused=!paused;show()};show();document.querySelector("#horn-audio").onclick=()=>{SFX.ensure();SFX.resume();paused=false;show();document.querySelector("#heimdall .preview").src="heimdall.webp?v="+Date.now();setTimeout(()=>SFX.special("heimdall"),340);};</script></html>`;
  fs.writeFileSync(path.join(out,'index.html'),html);
  fs.writeFileSync(path.join(out,'roster.json'),JSON.stringify(roster,null,2));
  console.log('Roster: '+path.join(out,'index.html'));
};
