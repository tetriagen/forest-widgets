// Run with: cjs tests/player-slider.js (Cinnamon installed).
imports.gi.versions.Clutter='0';
imports.gi.versions.Cogl='0';
imports.gi.versions.CoglPango='0';
imports.searchPath.unshift('/usr/share/cinnamon/js');
const Slider=imports.ui.slider;
const Clutter=imports.gi.Clutter;
const GLib=imports.gi.GLib;
const ByteArray=imports.byteArray;
const source=ByteArray.toString(GLib.file_get_contents('desklets/forest-player@local/desklet.js')[1]);
new Function(source); // Parse the complete desklet without starting it.
const start=source.indexOf('class PlayerSlider');
const end=source.indexOf('class ForestPlayer');
const PlayerSlider=new Function('Slider','Clutter',source.slice(start,end)+';return PlayerSlider;')(Slider,Clutter);
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
// Exercise the installed Cinnamon drag implementation with a synthetic event.
const slider=Object.create(PlayerSlider.prototype);
let next=0,grabbed=false,seeks=0;
const handlers=new Map();
slider.actor={connect:(name,fn)=>{handlers.set(++next,{name,fn});return next;},disconnect:id=>handlers.delete(id)};
slider._dragging=false;
slider._moveHandle=()=>{};
slider.emit=name=>{if(name==='drag-end')seeks++;};
const device={grab:()=>{grabbed=true;},ungrab:()=>{grabbed=false;}};
const event={get_button:()=>1,get_device:()=>device,get_coords:()=>[100,10]};
assert(slider._startDragging(slider.actor,event)===Clutter.EVENT_STOP,'Press must not reach desklet DND');
assert(grabbed&&slider._dragging,'Drag starts');
slider._endDragging(slider.actor,event);
assert(!grabbed&&!slider._dragging&&handlers.size===0,'Release clears mouse grab and motion listener');
assert(seeks===1,'Release triggers one seek');
slider._startDragging(slider.actor,event);slider.cancelDrag();
assert(!grabbed&&!slider._dragging&&handlers.size===0&&seeks===1,'Removal cancels drag without seeking');
assert(slider._startDragging(slider.actor,{get_button:()=>3})===Clutter.EVENT_PROPAGATE,'Right click remains available');
print('PASS: release, one seek, cancellation, right click, full source syntax');
