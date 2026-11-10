'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
  const nodes=[];
  function param(){return {value:0,events:[],setValueAtTime(v,t){this.events.push(['set',v,t]);},exponentialRampToValueAtTime(v,t){assert.ok(v>0);this.events.push(['exp',v,t]);}};}
  function node(kind){const n={kind,connections:[],connect(x){this.connections.push(x);},disconnect(){this.connections=[];},start(t){this.startTime=t;},stop(t){this.stopTime=t;},frequency:param(),gain:param(),Q:param()};nodes.push(n);return n;}
  const ctx={currentTime:10,sampleRate:48000,createOscillator:()=>node('osc'),createGain:()=>node('gain'),createBiquadFilter:()=>node('filter'),createWaveShaper:()=>node('sat'),createBufferSource:()=>node('noise'),createBuffer:(ch,n)=>({getChannelData:()=>new Float32Array(n)})};
  const c={addEventListener(){}};c.window=c;vm.createContext(c);
  let src=fs.readFileSync(path.join(__dirname,'../js/sfx.js'),'utf8');
  src=src.replace(/\}\)\(\);\s*$/,'SFX.testBind=function(c){ctx=c;master=c.createGain();ready=true;};\n})();');
  vm.runInContext(src,c);c.SFX.testBind(ctx);nodes.length=0;
  return {nodes,ctx,SFX:c.SFX,c};
}
test('Gjallarhorn has a low brass body, breath transient and bounded release',()=>{
  const h=fixture();h.SFX.special('heimdall');
  const tones=h.nodes.filter(n=>n.kind==='osc');
  assert.equal(tones.length,3);assert.deepEqual(tones.map(n=>n.type),['sawtooth','sawtooth','sine']);
  assert.deepEqual(tones.map(n=>n.frequency.events[1][1]),[110,110.65,55]);
  for(const n of h.nodes.filter(n=>n.kind==='osc'||n.kind==='noise'))assert.ok(n.stopTime>10&&n.stopTime<=10.97);
  assert.equal(h.nodes.filter(n=>n.kind==='noise').length,1);
  assert.ok(h.nodes.some(n=>n.kind==='filter'&&n.type==='lowpass'&&n.frequency.events.some(e=>e[1]===2300)));
  assert.ok(h.nodes.some(n=>n.kind==='sat'),'normal saturation/limiter path remains in use');
});
test('horn uses equipped-god lookup, respects mute and rapid-cast de-dupe',()=>{
  const h=fixture();h.c.Game={st:()=>({specialGod:'heimdall'})};h.SFX.special();
  const count=h.nodes.length;h.SFX.special();assert.equal(h.nodes.length,count);
  h.ctx.currentTime+=1;h.SFX.toggleMute();h.SFX.special();assert.equal(h.nodes.length,count);
  h.SFX.toggleMute();h.SFX.special();assert.ok(h.nodes.length>count);
});
test('Heimdall bridge bell remains an inharmonic bell, not the new horn',()=>{
  const h=fixture();h.SFX.bell(660);
  const tones=h.nodes.filter(n=>n.kind==='osc');assert.equal(tones.length,3);
  assert.ok(tones.every(n=>n.type==='square'));assert.equal(tones[0].frequency.events[0][1],660);
});
