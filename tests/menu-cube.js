const fs=require('fs'),assert=require('assert');
const source=fs.readFileSync('extensions/graphite-cube-menu@local/extension.js','utf8');
const method=source.slice(source.indexOf('function makeFrames()'),source.indexOf('function sync()'));
const frames=Function('const SIZE=24,COUNT=360;'+method+';return makeFrames();')();
assert.equal(frames.length,360);
for(const frame of frames){assert.equal(frame.length,576);assert(frame.some(x=>x>0));for(let x=0;x<24;x++){assert.equal(frame[x],0);assert.equal(frame[23*24+x],0);}}
assert(new Set(frames.map(f=>Buffer.from(f).toString('base64'))).size>300);
console.log('PASS: 360 bounded, nonempty pixel cube frames with distinct rotation poses');
