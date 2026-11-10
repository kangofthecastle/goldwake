'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {gameHarness} = require('./original-game.test.cjs');

function fixture() {
  const h = gameHarness(42, (s, file) => file === 'game.js' ? s.replace("  if (document.readyState === 'loading')",
    "  Game.kitArtTest = {hornPressure,drawRaBeam,drawShots,drawHazards,drawDuat,drawJudgement,drawHammers,drawKitBursts,allocShot,hazards};\n  if (document.readyState === 'loading')") : s);
  h.Game.setMode('playing'); h.calls=[]; h.blend='add';
  h.context.GL.draw=(...a)=>h.calls.push({a,blend:h.blend});
  h.context.GL.blendPremult=()=>{h.blend='over';};
  h.context.GL.blendAdditive=()=>{h.blend='add';};
  h.context.GL.authoredSpr=()=>100;
  h.api=h.Game.kitArtTest;
  return h;
}

test('Guan Yu mirrors only the special art, preserving its live sweep geometry', () => {
  const h=fixture(); h.Game.test.setSpecialGod('guanyu'); h.Game.test.specialNow(); h.Game.test.step(10);
  const before=JSON.stringify(h.api.hazards);
  h.api.drawHazards();
  const blade=h.calls.find(c=>c.a[0]===100);
  assert.ok(blade); assert.ok(blade.a[3]<0); assert.ok(blade.a[4]>0);
  assert.equal(blade.blend,'over'); assert.equal(h.blend,'add');
  assert.equal(JSON.stringify(h.api.hazards),before);
});

test('Quetzalcoatl feather tag is local to each projectile and reset on pool reuse', () => {
  const h=fixture(); h.Game.test.setAttackGod('quetz'); h.Game.test.fireNow(false);
  const shots=h.Engine.shots.items.filter(s=>s.active);
  assert.ok(shots.length); assert.ok(shots.every(s=>s.plume));
  const before=JSON.stringify(shots); h.api.drawShots(); assert.equal(JSON.stringify(shots),before);
  h.Engine.shots.forEach(s=>h.Engine.shots.release(s));
  const s=h.api.allocShot(); assert.equal(s.plume,false);
});

for (const god of ['guanyu','jade','quetz','thor','heimdall','ra','anubis']) {
  test(`${god} visual pass is deterministic, state-pure and restores blending`, () => {
    const h=fixture(); h.Game.test.setAttackGod(god); h.Game.test.setSpecialGod(god);
    h.Game.test.spawnDummy(540,900,100000);
    h.Game.test.fireNow(false); h.Game.test.specialNow(); h.Game.test.step(30);
    const snapshot=()=>JSON.stringify([h.Game.st(),h.api.hazards,h.Engine.shots.items,h.Engine.enemies.items]);
    const before=snapshot();
    const draw=()=>['drawRaBeam','drawShots','drawHazards','drawDuat','drawJudgement','drawHammers','drawKitBursts'].forEach(k=>h.api[k]());
    draw(); const first=JSON.stringify(h.calls); h.calls.length=0; draw();
    assert.equal(JSON.stringify(h.calls),first); assert.equal(snapshot(),before);
    assert.ok(h.calls.length); assert.equal(h.blend,'add');
    for(const c of h.calls) assert.ok(c.a.slice(1,11).every(Number.isFinite));
  });
}

test('horn and solar accents expire and do not survive a fresh run', () => {
  const h=fixture(); h.Game.test.setSpecialGod('heimdall'); h.Game.test.specialNow();
  assert.equal(h.Game.st().kitBursts[0].kind,'horn');
  h.Game.test.step(75); assert.equal(h.Game.st().kitBursts.length,0);
  h.Game.test.setSpecialGod('ra'); h.Game.test.specialNow();
  assert.equal(h.Game.st().kitBursts[0].kind,'solar');
  h.Game.resetRun({}); assert.equal(h.Game.st().kitBursts.length,0);
});

test('Ra beam is flat-ended at every heat tier, with unchanged endpoints and target state', () => {
  const h=fixture(),ra=h.Game.st().ra,spr=h.context.GL.SPR;
  h.Game.st().player.y=1500;
  Object.assign(ra,{active:true,tx:540,ty0:1400,ty1:700,target:null});
  for(let tier=0;tier<4;tier++) {
    ra.tier=tier;ra.ramp=tier/3;h.calls.length=0;
    const before=JSON.stringify(ra);h.api.drawRaBeam();
    assert.equal(JSON.stringify(ra),before);
    const full=h.calls.filter(c=>c.a[4]>=700);
    assert.equal(full.length,5,'mantle and core are five continuous strips');
    for(const c of full) {
      assert.equal(c.a[0],spr.FLAT_RECT,'no elongated oval or pointed mask');
      assert.equal(c.a[2],1050);assert.equal(c.a[4],700);assert.equal(c.a[5],0);
      assert.ok(c.a[7]>c.a[8],'white-gold, not the old pink/red palette');
    }
  }
});

test('Ra beam attaches to the painted nose without spilling across the hull', () => {
  const h=fixture(),g=h.Game.st(),ra=g.ra;
  g.player.y=1400;
  for(const fill of [1,1.3,1.8]) {
    h.context.GL.sprFill=()=>fill;
    const nose=g.player.y-45*fill*h.Game.test.shipDrawMul();
    for(const distance of [12,80,600]) for(const heat of [0,1/3,2/3,1]) for(let frame=0;frame<60;frame++) {
      g.time=frame/60;h.calls.length=0;
      Object.assign(ra,{active:true,tx:540,ty0:1376,ty1:nose-distance,ramp:heat,tier:Math.round(heat*3),target:{active:true,seq:1},targetSeq:1});
      const before=JSON.stringify(ra);h.api.drawRaBeam();
      assert.equal(JSON.stringify(ra),before);assert.ok(h.calls.length);
      for(const {a} of h.calls.slice(0,5)) assert.ok(Math.abs(a[2]+a[4]/2-nose)<0.000001,'beam touches the painted nose with no gap');
      for(const {a} of h.calls) {
        const bottom=a[2]+Math.abs(Math.sin(a[5]))*a[3]/2+Math.abs(Math.cos(a[5]))*a[4]/2;
        assert.ok(bottom<=nose+1.001,`beam quad overlaps hull: ${bottom} / ${nose}`);
      }
    }
    ra.ty1=nose;h.calls.length=0;h.api.drawRaBeam();
    assert.equal(h.calls.length,0,'target behind the visible muzzle must not reverse the beam');
  }
});

test('Heimdall and Ra specials no longer draw the rejected floating images', () => {
  for(const god of ['heimdall','ra']) {
    const h=fixture();h.Game.test.setSpecialGod(god);h.Game.test.specialNow();h.Game.test.step(12);
    h.api.drawKitBursts();
    if(god==='ra')assert.ok(h.calls.length>40,'solar cast is visible');
    else {assert.ok(h.calls.length>=27,'visible pressure mass accompanies refraction');assert.ok(h.api.hornPressure());}
    assert.ok(h.calls.every(c=>c.a[0]!==100),'no authored horn or sun stamp');
  }
});

test('Gjallarhorn combines visible pressure mass and refraction, without streaks or rings', () => {
  const h=fixture(),g=h.Game.st();
  g.kitBursts=[{kind:'horn',x:540,y:1400,t:0}];
  for(const age of [0.02,0.12,0.2,0.34]) {
    g.time=age;h.calls.length=0;h.api.drawKitBursts();
    assert.ok(h.calls.length>=55&&h.calls.length<=57,'pressure mass, attached curved crest and short ignition');
    assert.ok(h.calls.every(({a})=>[h.context.GL.SPR.GLOW,h.context.GL.SPR.CORE].includes(a[0])),'only soft filled volume, no line or ring geometry');
    assert.ok(h.calls.slice(0,27).every(({a})=>a[3]>=75&&a[4]>=75),'preserved broad pressure body');
    const crest=h.calls.slice(27,55);
    assert.ok(crest.every(({a})=>a[0]===h.context.GL.SPR.CORE),'filled crest rather than line segments');
    assert.ok(crest[0].a[2]>crest[13].a[2]+35&&crest[27].a[2]>crest[14].a[2]+35,'clear curved leading edge');
    assert.ok(h.calls.some(({a})=>a[9]>=0.05),'pressure remains visible without WebGL bloom');
    const before=JSON.stringify(g),pressure=h.api.hornPressure();
    assert.equal(pressure.age,age);assert.equal(pressure.x,540);assert.equal(pressure.y,1400);
    assert.equal(JSON.stringify(g),before,'pressure state is read-only');
    assert.equal(h.blend,'add');
  }
  g.time=0.4;h.calls.length=0;h.api.drawKitBursts();assert.equal(h.calls.length,55);
  assert.equal(h.api.hornPressure(),null,'visual recovery can finish after refraction');
  for(const age of [-0.01,0.46,0.8,1]) {
    g.time=age;h.calls.length=0;h.api.drawKitBursts();assert.equal(h.calls.length,0);
    assert.equal(h.api.hornPressure(),null);
  }
  h.Game.resetRun({});assert.equal(h.api.hornPressure(),null);
});

test('horn refraction is bounded, preserves the player region, and ends exactly',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),c={};c.window=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/gl.js'),'utf8'),c);
  let peak=0;
  const h={x:540,y:1422,playerX:540,playerY:1422,age:0};
  for(let frame=0;frame<24;frame++)for(let y=0;y<=1920;y+=30)for(let x=0;x<=1080;x+=30){
    h.age=frame/60;const [dx,dy,shade]=c.GL.hornRefraction(x,y,h);
    assert.ok([dx,dy,shade].every(Number.isFinite));assert.ok(Math.abs(dx)<=9&&Math.abs(dy)<=14&&shade<=0.13);
    if(Math.hypot(x-h.playerX,y-h.playerY)<=140||x===0||x===1080||y===0||y===1920)assert.equal(Math.abs(dx)+Math.abs(dy)+shade,0);
    peak=Math.max(peak,Math.abs(dy));
  }
  assert.ok(peak>1,'scene deformation is active');
  for(const age of [-1,0.38,1]){h.age=age;assert.equal(c.GL.hornRefraction(540,700,h).join(','),'0,0,0');}
});

test('Thor uses a simple flat silhouette without illustrated art or ornamental layers', () => {
  const h=fixture();h.Game.test.setSpecialGod('thor');h.Game.test.specialNow();
  const before=JSON.stringify(h.Game.st().hammers);h.api.drawHammers();
  assert.equal(h.calls.length,7,'one head, one handle and one collar');
  assert.ok(h.calls.every(c=>c.a[0]===h.context.GL.SPR.FLAT_RECT&&c.blend==='over'));
  assert.equal(JSON.stringify(h.Game.st().hammers),before);assert.equal(h.blend,'add');
});

test('Quetzalcoatl cast is a continuous two-tone silhouette, not a feathered illustration', () => {
  const h=fixture();h.Game.test.setSpecialGod('quetz');h.Game.test.specialNow();h.Game.test.step(20);
  const before=JSON.stringify(h.api.hazards);h.api.drawHazards();
  const spr=h.context.GL.SPR,allowed=new Set([spr.FLAT_RECT,spr.FLAT_DISC,spr.FLAT_TRIANGLE]);
  assert.ok(h.calls.length>20&&h.calls.length<70,'bounded ribbon and small head');
  assert.ok(h.calls.every(c=>allowed.has(c.a[0])&&c.blend==='over'));
  assert.equal(JSON.stringify(h.api.hazards),before);assert.equal(h.blend,'add');
});

test('large sweep and new cast-art cells do not overlap another live atlas region', () => {
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const c={};c.window=c;vm.createContext(c);
  let src=fs.readFileSync(path.join(__dirname,'../js/gl.js'),'utf8');
  src=src.replace(/\}\)\(\);\s*$/,'GL.kitAtlas={cellRect,authored};\n})();');
  vm.runInContext(src,c);
  const {cellRect,authored}=c.GL.kitAtlas;
  const ids=new Set([...Object.values(c.GL.SPR),...Object.values(authored).map(a=>a.cell)]);
  for(const id of [57,116,117,118]) {
    const a=cellRect(id);
    assert.equal(a.size,id===57?256:128);
    for(const other of ids) {
      if(other===id)continue;
      const b=cellRect(other);
      assert.ok(a.x+a.size<=b.x||b.x+b.size<=a.x||a.y+a.size<=b.y||b.y+b.size<=a.y,`${id} overlaps ${other}`);
    }
  }
});
