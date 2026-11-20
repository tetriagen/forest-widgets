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
