// Local output-monitor spectrum. No microphone, network, or audio files.
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

class SpectrumAnalyzer {
    constructor() {
        this.size = 1024;
        this.rate = 22050;
        this.levels = new Float64Array(48);
        this.bands=Array.from({length:48},(_,band)=>{
            const lo=Math.max(1,Math.floor(60*Math.pow(160,band/48)*this.size/this.rate));
            const hi=Math.min(this.size/2,Math.max(lo+1,Math.ceil(60*Math.pow(160,(band+1)/48)*this.size/this.rate)));
            return [lo,hi];
        });
        this.real = new Float64Array(this.size);
        this.imag = new Float64Array(this.size);
        this.window = Float64Array.from({length: this.size}, (_, i) =>
            0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.size - 1)));
    }
    analyze(bytes) {
        const n = this.size, re = this.real, im = this.imag;
        for (let i = 0; i < n; i++) {
            let sample = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
            if (sample >= 32768) sample -= 65536;
            re[i] = sample / 32768 * this.window[i]; im[i] = 0;
        }
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
        }
        for (let length = 2; length <= n; length <<= 1) {
            const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle);
            for (let offset = 0; offset < n; offset += length) {
                let r = 1, q = 0;
                for (let j = 0; j < length / 2; j++) {
                    const a = offset + j, b = a + length / 2;
                    const br = re[b] * r - im[b] * q, bi = re[b] * q + im[b] * r;
                    re[b] = re[a] - br; im[b] = im[a] - bi;
                    re[a] += br; im[a] += bi;
                    const next = r * wr - q * wi; q = r * wi + q * wr; r = next;
                }
            }
        }
        for (let band = 0; band < this.levels.length; band++) {
            const [lo,hi]=this.bands[band];
            let peak = 0;
            for (let bin = lo; bin < hi; bin++) peak = Math.max(peak, Math.hypot(re[bin], im[bin]) * 4 / n);
            const target = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(peak, 1e-6)) + 58) / 58));
            const old = this.levels[band];
            this.levels[band] = target > old ? old + (target - old) * 0.8 : old * 0.78 + target * 0.22;
        }
        return this.levels;
    }
}

class AudioMonitor {
    constructor(onLevels, onStatus) {
        this.onLevels = onLevels; this.onStatus = onStatus;
        this.analyzer = new SpectrumAnalyzer(); this.proc = null; this.retryAt = 0;
    }
    start() {
        if (this.proc || GLib.get_monotonic_time() < this.retryAt) return;
        if (!GLib.find_program_in_path('parec')) {
            this.onStatus('Для эквалайзера установи pulseaudio-utils');
            this.retryAt = GLib.get_monotonic_time() + 30000000; return;
        }
        try {
            const proc = Gio.Subprocess.new(['parec', '--device=@DEFAULT_MONITOR@', '--raw',
                '--format=s16le', '--rate=22050', '--channels=1', '--latency-msec=60',
                '--process-time-msec=46', '--client-name=Forest Player', '--stream-name=Output visualizer'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            this.cancelFade();
            this.proc = proc; this.cancel = new Gio.Cancellable();
            const cancel = this.cancel, stream = proc.get_stdout_pipe();
            const buffer = new Uint8Array(2048); let used = 0;
            this.onStatus('Спектр системного звука');
            proc.wait_async(null, (p, result) => {
                try { p.wait_finish(result); } catch (_) {}
                if (this.proc === proc) {
                    this.retryAt = GLib.get_monotonic_time() + 10000000;
                    this.stop(); this.onStatus('Звуковой выход недоступен');
                }
            });
            const read = () => stream.read_bytes_async(buffer.length - used, GLib.PRIORITY_DEFAULT, cancel, (input, result) => {
                let data;
                try { data = input.read_bytes_finish(result).get_data(); }
                catch (_) { return; }
                if (this.proc !== proc || !data.length) return;
                buffer.set(data, used); used += data.length;
                if (used === buffer.length) { this.onLevels(this.analyzer.analyze(buffer)); used = 0; }
                read();
            });
            read();
        } catch (_) {
            this.stop(); this.retryAt = GLib.get_monotonic_time() + 10000000;
            this.onStatus('Звуковой выход недоступен');
        }
    }
    cancelFade() {
        if(this.fadeTimer){GLib.source_remove(this.fadeTimer);this.fadeTimer=0;}
    }
    stop(fade=false) {
        this.cancelFade();
        const proc = this.proc; this.proc = null;
        if (this.cancel) { this.cancel.cancel(); this.cancel = null; }
        if (proc) { try { proc.force_exit(); } catch (_) {} }
        if(fade && this.analyzer.levels.some(level=>level>0)) {
            // Stop capture immediately; animate only the last spectrum frame for 1.6 seconds.
            const initial=Float64Array.from(this.analyzer.levels),started=GLib.get_monotonic_time();
            this.fadeTimer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,16,()=>{
                const t=Math.min(1,(GLib.get_monotonic_time()-started)/1600000);
                const factor=(1-t)*(1-t);
                for(let i=0;i<initial.length;i++)this.analyzer.levels[i]=initial[i]*factor;
                this.onLevels(this.analyzer.levels);
                if(t>=1){this.fadeTimer=0;return GLib.SOURCE_REMOVE;}
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            this.analyzer.levels.fill(0); this.onLevels(this.analyzer.levels);
        }
    }
}
module.exports = {SpectrumAnalyzer, AudioMonitor};
