'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {gameHarness}=require('./original-game.test.cjs');

function harness(authored=false) {
  const h=gameHarness(42,(source,file)=>file==='game.js'?source.replace("  if (document.readyState === 'loading')","  Game.renderTest={drawShots,drawEnemies,drawShotWake};\n  if (document.readyState === 'loading')"):source);
  h.Game.setMode('playing');h.calls=[];
  h.context.GL.draw=(...args)=>h.calls.push(args);
  h.context.GL.drawRegion=(...args)=>h.calls.push(args);
  h.context.GL.blendPremult=()=>{};h.context.GL.blendAdditive=()=>{};
  if(authored)h.context.GL.authoredSpr=()=>42;
  return h;
}
function shotSnapshot(s){return JSON.stringify(s);}

test('revealed mimic keeps urn art without changing its generic reveal collision size',()=>{
  const h=harness(true),i=h.Game.test.spawnDummy(540,500,1000),e=h.Engine.enemies.items[i];
  Object.assign(e,{arch:'mimic',s0:1,spr:h.context.GL.SPR.SHIP_POP,scale:62,radius:26,szDone:false});
  h.context.GL.sprFill=()=>1.62;
  h.Game.test.forceSize(i);
  const before=JSON.stringify([e.scale,e.radius,e.x,e.y,e.hp]);
  h.Game.renderTest.drawEnemies();
  assert.ok(h.calls.some(c=>c[0]===42),'revealed creature keeps its authored vessel');
  assert.equal(JSON.stringify([e.scale,e.radius,e.x,e.y,e.hp]),before);
  assert.ok(Math.abs(e.radius/e.scale-26/62)<1e-12,'reveal retains original collider proportion');
});

test('drawRegion queues a subrectangle strictly inside the existing inset cell',()=>{
  const context={};context.window=context;vm.createContext(context);
  let src=fs.readFileSync(path.join(__dirname,'../js/gl.js'),'utf8');
  src=src.replace(/\}\)\(\);\s*$/,'GL.testRegion={regions, data:instData, count:()=>instCount};\n})();');
  vm.runInContext(src,context);
  const {GL}=context,reg=[.126,.25,.123,.062];GL.testRegion.regions[7]=reg;
  GL.drawRegion(7,40,60,20,30,.3,.9,.4,.2,1,.2,.1,.8,.9);
  assert.equal(GL.testRegion.count(),1);
  const data=GL.testRegion.data;
  for(const [index,expected] of [[9,reg[0]+reg[2]*.2],[10,reg[1]+reg[3]*.1],[11,reg[2]*.6],[12,reg[3]*.8]])assert.ok(Math.abs(data[index]-expected)<1e-7);
  assert.ok(data[9]>=reg[0]&&data[9]+data[11]<=reg[0]+reg[2]);
  assert.ok(data[10]>=reg[1]&&data[10]+data[12]<=reg[1]+reg[3]);
  GL.drawRegion(7,0,0,1,1,0,1,1,1,1,.8,0,.2,1);
  GL.drawRegion(7,0,0,1,1,0,1,1,1,0,0,0,1,1);
  GL.drawRegion(999,0,0,1,1,0,1,1,1,1,0,0,1,1);
  assert.equal(GL.testRegion.count(),1,'empty, invisible and unknown regions cannot submit');
});

for(const authored of [false,true]) test(`all player projectile drawing is state-pure with authored art ${authored?'loaded':'absent'}`,()=>{
  const h=harness(authored);
  for(const kind of [0,3,4,5,7,9,10,11,12,13,14,15,17,18]) {
    h.Engine.shots.forEach(s=>h.Engine.shots.release(s));
    const s=h.Engine.shots.alloc();
    Object.assign(s,{x:550,y:600,vx:320,vy:-640,kind,age:.15,scale:26,damage:2,r:.8,g:.6,b:.3,fireId:14,loosed:kind===4,big:false,crescent:false});
    const before=shotSnapshot(s);
    for(const style of ['A','B','C']){h.context.GL.edictStyle=style;h.Game.renderTest.drawShots();}
    assert.equal(shotSnapshot(s),before,`draw mutated projectile kind ${kind}`);
  }
  assert.ok(h.calls.length>30,'fixture draws real components');
  for(const args of h.calls) assert.ok(args.slice(1,11).every(Number.isFinite),'draw coordinates/colors stay finite');
});

test('projectile wakes remain behind their velocity and vanish at rest or birth',()=>{
  const h=harness();
  const s={x:100,y:300,vx:300,vy:-400,age:.2,scale:20};
  h.Game.renderTest.drawShotWake(s,70,.8,.5,.2,.4);
  assert.ok(h.calls.length>0);
  for(const [,x,y]of h.calls)assert.ok((x-s.x)*s.vx+(y-s.y)*s.vy<0,'wake overlaps forward flight path');
  h.calls.length=0;s.age=0;h.Game.renderTest.drawShotWake(s,70,.8,.5,.2,.4);assert.equal(h.calls.length,0);
  s.age=.2;s.vx=s.vy=0;h.Game.renderTest.drawShotWake(s,70,.8,.5,.2,.4);assert.equal(h.calls.length,0);
});

test('articulated enemy crops are bounded and cannot alter physical or attack state',()=>{
  const h=harness(true);
  for(const arch of ['','gunship','moth','weaver2','aegis','acolyte']) {
    h.Engine.enemies.forEach(e=>h.Engine.enemies.release(e));
    const i=h.Game.test.spawnDummy(540,500,1000),e=h.Engine.enemies.items[i];
    e.arch=arch;e.type=arch?30:1;h.Game.test.forceSize(i);e.poseT=.15;e.motionPoseMax=.5;
    const physical=()=>JSON.stringify([e.x,e.y,e.radius,e.scale,e.hp,e.rot,e.t,e.fireT,e.fireCd,e.scriptT,e.scriptI,e.segI,e.segT,e.active]);
    const before=physical();
    for(const time of [0,.1,.3,.8]){h.Game.st().time=time;e.motionShot=time;h.Game.renderTest.drawEnemies();assert.equal(physical(),before);}
  }
  const crops=h.calls.filter(args=>args.length===14);
  assert.ok(crops.length>20,'test exercises cropped articulation rather than whole-sprite fallback');
  for(const args of crops){const [u0,v0,u1,v1]=args.slice(10);assert.ok(u0>=0&&v0>=0&&u1<=1&&v1<=1&&u1>u0&&v1>v0,'crop spills into sibling atlas region');}
});

test('painted enemies occlude their backdrop and human figures are never cut at obsolete anatomy',()=>{
  const h=harness(true);let blend='add',events=[];
  h.context.GL.blendPremult=()=>{blend='over'};
  h.context.GL.blendAdditive=()=>{blend='add'};
  h.context.GL.draw=(...args)=>events.push({blend,args,crop:false});
  h.context.GL.drawRegion=(...args)=>events.push({blend,args,crop:true});
  for(const arch of ['moth','aegis','acolyte','weaver2','gunship']) {
    h.Engine.enemies.forEach(e=>h.Engine.enemies.release(e));events=[];
    const i=h.Game.test.spawnDummy(540,500,1000),e=h.Engine.enemies.items[i];
    e.arch=arch;e.type=30;e.aura='';e.hitFlash=0;e.shieldT=1;h.Game.test.forceSize(i);
    h.Game.renderTest.drawEnemies();
    const body=events.filter(x=>x.args[0]===42&&x.blend==='over');
    assert.ok(body.length>0,`${arch} must draw an opaque physical body`);
    if(['aegis','acolyte','weaver2'].includes(arch))assert.ok(body.every(x=>!x.crop),`${arch} must keep its full painted anatomy`);
    assert.equal(blend,'add','restore effect blend after body');
    assert.ok(!events.some(x=>x.args[0]===h.context.GL.SPR.GLOW&&x.args[1]===e.x&&x.args[2]===e.y&&x.args[3]===e.scale*1.5),'no permanent body-centered halo');
  }
});

test('human action sheets choose combat poses without changing physical state',()=>{
  const h=harness(true);let requested=[];
  h.context.GL.authoredSpr=name=>{requested.push(name);return 42;};
  for(const arch of ['aegis','acolyte']) {
    h.Engine.enemies.forEach(e=>h.Engine.enemies.release(e));
    const i=h.Game.test.spawnDummy(540,500,1000),e=h.Engine.enemies.items[i];
    e.arch=arch;e.type=30;e.aura='';e.shieldT=0;h.Game.test.forceSize(i);
    for(const [state,expected] of [
      [{motionShot:1,poseT:0,link:null},'idle'],
      [{motionShot:1,poseT:.2},'prepare'],
      [{motionShot:.04,poseT:0},'release'],
      [{motionShot:.25,poseT:0},'recover'],
      [{motionShot:1,stunT:1,poseT:.2},'idle']]) {
      Object.assign(e,state);requested=[];
      const before=JSON.stringify([e.x,e.y,e.radius,e.scale,e.hp,e.fireT,e.poseT,e.motionShot]);
      h.Game.renderTest.drawEnemies();
      assert.ok(requested.includes(`${arch}-action-${expected}`));
      assert.equal(JSON.stringify([e.x,e.y,e.radius,e.scale,e.hp,e.fireT,e.poseT,e.motionShot]),before);
    }
    e.stunT=0;e.motionShot=1;e.poseT=0;requested=[];
    if(arch==='acolyte')e.link={active:true,dying:false,x:300,y:400};
    else e.shieldT=.5;
    h.Game.renderTest.drawEnemies();
    assert.ok(requested.includes(`${arch}-action-${arch==='acolyte'?'release':'recover'}`));
  }
});

test('human sheet cells are distinct and rotate like static enemy bodies',()=>{
  const context={};context.window=context;vm.createContext(context);
  let src=fs.readFileSync(path.join(__dirname,'../js/gl.js'),'utf8');
  src=src.replace(/\}\)\(\);\s*$/,'GL.testAuthored=authored;\n})();');
  vm.runInContext(src,context);
  const slots=[];
  for(const [prefix,base]of [['aegis-action',104],['acolyte-action',108]]) {
    ['idle','prepare','release','recover'].forEach((frame,i)=>{
      const a=context.GL.testAuthored[`${prefix}-${frame}`];
      assert.equal(a.cell,base+i);assert.equal(a.rot,Math.PI);assert.equal(a.ready,false);
      assert.equal(a.sheet,`${prefix}-sheet`);assert.equal(JSON.stringify(a.crop),JSON.stringify([(i%2)*.5,Math.floor(i/2)*.5,.5,.5]));
      slots.push(a.cell);
    });
  }
  assert.equal(new Set(slots).size,8);
});

test('Talos attack poses continue during Terror and never inflate with elapsed render time',()=>{
  const h=harness(true);let names=[];
  h.context.GL.authoredSpr=name=>{names.push(name);return name.startsWith('talos-action-')?43:name==='34d-1-the-nail'?44:42;};
  const i=h.Game.test.spawnDummy(540,360,1000),e=h.Engine.enemies.items[i];
  e.name='TALOS';e.boss=true;e.type=5;e.aura='';h.Game.test.forceSize(i);
  e.nailActive=true;e.nailR=30;e.nailX=540;e.nailY=600;
  e.terrorT=2; // Boss Terror permits attacks; their visible poses must continue too.
  const scale=e.scale,radius=e.radius;
  for(const [shot,pose,frame] of [[1,0,'idle'],[1,.2,'prepare'],[.04,0,'release'],[.25,0,'recover']]) {
    e.motionShot=shot;e.poseT=pose;
    for(const time of [0,.17,.71,1.4]) {
      h.Game.st().time=time;h.calls=[];names=[];h.Game.renderTest.drawEnemies();
      assert.ok(names.includes(`talos-action-${frame}`));
      const body=h.calls.find(c=>c[0]===43),nail=h.calls.find(c=>c[0]===44);
      assert.equal(body[3],scale);assert.equal(body[4],scale);
      const sole={idle:619,prepare:621,release:581,recover:581}[frame];
      const drawnSole=body[2]+(sole/627-.5)*.82*(31/32)*scale;
      assert.ok(Math.abs(drawnSole-(e.y+scale*.44+18))<1e-7,'all poses plant feet on one fixed baseline');
      assert.equal(nail[3],60);assert.equal(nail[4],60);
      assert.equal(e.scale,scale);assert.equal(e.radius,radius);assert.equal(e.nailR,30);
    }
  }
});
