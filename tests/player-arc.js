const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync('desklets/forest-player@local/arc-seek.js','utf8'),context);
const {fractionAt}=context.module.exports;
for(const side of ['left','right']){
 const sign=side==='right'?-1:1;
 for(const fraction of [0,0.1,0.25,0.5,0.75,0.9,1]){
  const angle=-Math.PI/2+sign*Math.PI*fraction;
  assert.ok(Math.abs(fractionAt(98*Math.cos(angle),98*Math.sin(angle),side)-fraction)<1e-8,`${side} ${fraction}`);
 }
}
// Exercise the desklet's actual event handlers without a player or desktop DND.
const source=fs.readFileSync('desklets/forest-player@local/desklet.js','utf8');
const methods=source.slice(source.indexOf('    arcPoint('),source.indexOf('    loadArt('));
const ctx={fractionAt,Clutter:{EVENT_PROPAGATE:0,EVENT_STOP:1}};
vm.runInNewContext('class Arc {'+methods+'};this.Arc=Arc;',ctx);
const d=new ctx.Arc();let grabbed=false,seeks=[],next=0;const signals=new Map();
d.appearance='radial';d.dockSide='right';d.canSeek=true;d.length=200;d.disc={width:340};
d.discBox={transform_stage_point:(x,y)=>[true,x,y],connect:(name,cb)=>{signals.set(++next,{name,cb});return next;},disconnect:id=>signals.delete(id)};
d.updateProgress=()=>{};d.seekFraction=v=>seeks.push(v);
const device={grab:()=>{grabbed=true;},ungrab:()=>{grabbed=false;}};
const event=(x,y,button=1)=>({get_coords:()=>[x,y],get_button:()=>button,get_device:()=>device});
assert.equal(d.arcPress(event(72,170)),1);assert.ok(grabbed&&d.arcDragging);
signals.get(d.arcMotionId).cb(null,event(170,268));
signals.get(d.arcReleaseId).cb();assert.deepEqual(seeks,[1]);assert.ok(!grabbed&&!d.arcDragging&&signals.size===0);
d.arcPress(event(72,170));d.cancelArcDrag();assert.equal(seeks.length,1);assert.equal(signals.size,0);assert.ok(!grabbed);
assert.equal(d.arcPress(event(72,170,3)),0);assert.equal(d.arcPress(event(160,170)),0);
console.log('PASS: arc mapping both sides, drag seek once, cancellation, DND/right click');
