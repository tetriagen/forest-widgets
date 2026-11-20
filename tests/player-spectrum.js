const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = {imports: {gi: {Gio: {}, GLib: {}}}, module: {exports: {}}};
vm.runInNewContext(fs.readFileSync('desklets/forest-player@local/spectrum.js', 'utf8'), context);
const {SpectrumAnalyzer} = context.module.exports;
function tone(hz) {
    const pcm = new Uint8Array(2048), view = new DataView(pcm.buffer);
    for (let i = 0; i < 1024; i++) view.setInt16(i * 2, Math.round(20000 * Math.sin(2 * Math.PI * hz * i / 22050)), true);
    return pcm;
}
const analyzer = new SpectrumAnalyzer();
assert.ok(analyzer.analyze(new Uint8Array(2048)).every(v => v === 0), 'Silence stays still');
const peak = [];
for (const frequency of [100, 1000, 6000]) {
    const a = new SpectrumAnalyzer();
    for (let i = 0; i < 10; i++) a.analyze(tone(frequency));
    const levels = Array.from(a.levels);
    assert.ok(levels.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
    const index = levels.indexOf(Math.max(...levels)); peak.push(index);
    const expected = Math.log(frequency / 60) / Math.log(160) * 48;
    assert.ok(Math.abs(index - expected) < 4, `Tone ${frequency} Hz maps to its frequency band`);
}
assert.ok(peak[0] < peak[1] && peak[1] < peak[2]);
for (let i = 0; i < 8; i++) analyzer.analyze(tone(1000));
const active = Math.max(...analyzer.levels);
for (let i = 0; i < 30; i++) analyzer.analyze(new Uint8Array(2048));
assert.ok(Math.max(...analyzer.levels) < active / 100, 'Release decays to silence');
console.log('PASS: silence, PCM decoding, frequency bands, bounded levels, decay');

// The pause tail must outlive capture, reach zero, and cancel cleanly on resume/removal.
let now=1000000,nextId=0,killed=0,cancelled=0;
const timers=new Map(),frames=[];
Object.assign(context.imports.gi.GLib,{
    PRIORITY_DEFAULT:0,SOURCE_REMOVE:false,SOURCE_CONTINUE:true,
    get_monotonic_time:()=>now,find_program_in_path:()=>'/usr/bin/parec',
    timeout_add:(_priority,_interval,callback)=>{timers.set(++nextId,callback);return nextId;},
    source_remove:id=>timers.delete(id),
});
Object.assign(context.imports.gi.Gio,{
    Cancellable:class{cancel(){cancelled++;}},
    SubprocessFlags:{STDOUT_PIPE:1,STDERR_SILENCE:2},
    Subprocess:{new:()=>({force_exit(){killed++;},wait_async(){},get_stdout_pipe:()=>({read_bytes_async(){}})})},
});
function advance(ms){now+=ms*1000;for(const [id,callback]of [...timers])if(!callback())timers.delete(id);}
const monitor=new context.module.exports.AudioMonitor(levels=>frames.push(Array.from(levels)),()=>{});
monitor.start();monitor.analyzer.levels.fill(.8);monitor.stop(true);
assert.equal(monitor.proc,null);assert.equal(killed,1);assert.equal(cancelled,1);
assert.equal(timers.size,1);assert.equal(monitor.analyzer.levels[0],.8,'Pause does not jump to zero');
advance(400);const first=frames.at(-1)[0];assert.ok(first>0&&first<.8);
advance(400);assert.ok(frames.at(-1)[0]>0&&frames.at(-1)[0]<first);
advance(800);assert.ok(frames.at(-1).every(x=>x===0));assert.equal(timers.size,0);assert.equal(monitor.fadeTimer,0);
monitor.analyzer.levels.fill(.7);monitor.stop(true);advance(200);monitor.start();
assert.equal(timers.size,0,'Resume cancels the pause timer');assert.ok(monitor.proc);
monitor.stop(true);assert.equal(timers.size,1);monitor.stop();
assert.equal(timers.size,0,'Removal cancels every pending frame');assert.ok(monitor.analyzer.levels.every(x=>x===0));
console.log('PASS: pause capture stops immediately, gradual tail reaches zero, resume/removal cancel timer');
