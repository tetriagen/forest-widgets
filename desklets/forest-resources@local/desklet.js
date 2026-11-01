const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gdk = imports.gi.Gdk;
const Pango = imports.gi.Pango;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;
const Tooltips = imports.ui.tooltips;
imports.gi.versions.Soup = '3.0';
const Soup = imports.gi.Soup;
const Slider=imports.ui.slider;
const Settings=imports.ui.settings;
const PopupMenu=imports.ui.popupMenu;
const MPRIS = 'org.mpris.MediaPlayer2.Player';
function read(path) {
    try { const [ok, bytes] = GLib.file_get_contents(path); return ok ? ByteArray.toString(bytes) : ''; }
    catch (_) { return ''; }
}
class ForestResources extends Desklet.Desklet {
    constructor(metadata,id){
        super(metadata,id);
        this.dead=false;this.previous=null;this.tick=0;this.gpuText='';this.cancel=new Gio.Cancellable();
        this.clearBackdrop();this.root=new St.BoxLayout({vertical:true,style_class:'fw-root'});
        const grid=new St.BoxLayout({vertical:true,style_class:'fw-grid'});
        this.values={}; this.bars={};this.tiles=[];
        for (const rowKeys of [['cpu','ram'],['gpu','vram']]) {
            const row=new St.BoxLayout({style_class:'fw-row'});
            for (const key of rowKeys) {
                const tile=new St.BoxLayout({vertical:true,style_class:'fw-tile'});
                this.tiles.push(tile);tile.add_child(new St.Label({text:{cpu:'CPU',ram:'RAM',gpu:'GPU',vram:'VRAM'}[key],style_class:'fw-caption'}));
                this.values[key]=new St.Label({text:'—',style_class:'fw-value'});
                tile.add_child(this.values[key]);
                tile.add_child(new St.Label({text:{cpu:'LOAD',ram:'GiB USED',gpu:'LOAD',vram:'GiB USED'}[key],style_class:'fw-unit'}));
                const track=new St.Bin({style_class:'fw-track',x_align:St.Align.START});
                this.bars[key]=new St.Widget({style_class:'fw-fill',width:0,height:3,x_align:Clutter.ActorAlign.START});
                track.set_child(this.bars[key]); tile.add_child(track); row.add_child(tile);
            }
            grid.add_child(row);
        }
        this.root.add_child(grid);this.card=grid;
        this.setContent(this.root);this.setHeader('Forest Resources');this.setupSettings();this.applySettings();
        this.sample();this.timer=Mainloop.timeout_add_seconds(3,()=>{this.sample();return !this.dead;});
    }
    on_desklet_removed(){
        this.dead=true;this.cancel.cancel();if(this.timer)Mainloop.source_remove(this.timer);
        if(this.gpuTimeout)Mainloop.source_remove(this.gpuTimeout);if(this.gpuProcess)this.gpuProcess.force_exit();
        if(this.clampTimer)Mainloop.source_remove(this.clampTimer);if(this.settings)this.settings.finalize();
    }
    setupSettings() {
        this.settings=new Settings.DeskletSettings(this,this.metadata.uuid,this.instance_id);
        this.settings.bind('font-family','fontFamily',()=>this.applySettings());
        this.settings.bind('opacity','cardOpacity',()=>this.applySettings());
        this.settings.bind('size-percent','sizePercent',()=>this.applySettings());
    }
    clearBackdrop() {
        const clear='background-color: transparent; background-gradient-start: transparent; background-gradient-end: transparent; border-image: none; border: none; box-shadow: none; padding: 0;';
        this.actor.set_style(clear); this.content.set_style(clear);
        this.content.set_style_class_name('forest-transparent');this._header.hide();
    }
    resizeContent(scale){
        const previous=this.renderScale||1;
        for(const bar of Object.values(this.bars))bar.set_width(Math.round(bar.width*scale/previous));
        this.renderScale=scale;
    }
    glassStyle(){
        const a=(this.cardOpacity||55)/100;
        return 'background-color: rgba(13,34,22,'+a+'); background-gradient-direction: vertical; background-gradient-start: rgba(66,96,76,'+(a*0.8)+'); background-gradient-end: rgba(7,23,14,'+a+'); border-color: rgba(189,228,201,0.3);';
    }
    clampPosition(){
        if(this.dead||!this.actor.mapped)return;
        let index=0;
        for(let i=0;i<global.display.get_n_monitors();i++){const m=global.display.get_monitor_geometry(i);if(this.actor.x>=m.x&&this.actor.x<m.x+m.width&&this.actor.y>=m.y&&this.actor.y<m.y+m.height){index=i;break;}}
        const m=global.display.get_monitor_geometry(index),s=1;
        const x=Math.max(m.x+12,Math.min(this.actor.x,m.x+m.width-this.actor.width*s-12));
        const y=Math.max(m.y+48,Math.min(this.actor.y,m.y+m.height-this.actor.height*s-12));
        if(this.actor.x!==Math.round(x)||this.actor.y!==Math.round(y))this.actor.set_position(Math.round(x),Math.round(y));
    }
    applySettings() {
        if(!this.root)return;
        const percent=Math.max(75,Math.min(160,Math.round((this.sizePercent||100)/5)*5));
        const scale=percent/100;this.actor.set_scale(1,1);
        if(this.sizeClass)this.root.remove_style_class_name(this.sizeClass);
        this.sizeClass='forest-size-'+percent;this.root.add_style_class_name(this.sizeClass);
        this.resizeContent(scale);
        if(this.clampTimer)Mainloop.source_remove(this.clampTimer);
        this.clampTimer=Mainloop.timeout_add(100,()=>{this.clampTimer=0;this.clampPosition();return false;});
        const families={'system':'Sans','mono':'JetBrainsMono Nerd Font','monocraft':'Monocraft','tiny5':'Tiny5','press':'Press Start 2P'};
        this.root.set_style('font-family: "'+(families[this.fontFamily]||'Sans')+'";');
        if(this.card)this.card.set_style('background-color: transparent; border: none; padding: 0;');
        for(const tile of this.tiles)tile.set_style(this.glassStyle());
        if(this.discBox)this.discBox.visible=!this.compact;
        if(this.album)this.album.visible=this.showAlbum;
        if(this.rotation){this.disc.remove_transition('forest-spin');this.rotation=null;}
        if(this.disc)this.updateRotation();
    }
    sample() {
        const first = read('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
        // guest and guest_nice are already included in user/nice.
        const total = first.slice(0,8).reduce((a,b) => a+b, 0), idle = first[3]+first[4];
        let cpu = '—';
        if (this.previous && total > this.previous.total)
            cpu = Math.round(100 * (1-(idle-this.previous.idle)/(total-this.previous.total)))+'%';
        this.previous = {total, idle};
        const mem = read('/proc/meminfo');
        const all = /MemTotal:\s+(\d+)/.exec(mem), avail = /MemAvailable:\s+(\d+)/.exec(mem);
        const used = all && avail ? ((+all[1]-avail[1])/1048576).toFixed(1)+'G' : '—';
        this.values.cpu.set_text(cpu);
        this.values.ram.set_text(used);
        this.bars.cpu.set_width(Math.round((98 * (parseFloat(cpu) || 0)/100)*(this.renderScale||1)*(global.ui_scale||1)));
        this.bars.ram.set_width(Math.round((all && avail ? 98 * (1-(+avail[1])/(+all[1])) : 0)*(this.renderScale||1)*(global.ui_scale||1)));
        if ((this.tick++ % 5) === 0) this.sampleGPU();
    }
    sampleGPU() {
        // Never run nvidia-smi against a suspended GPU or an unknown power state.
        let active = false;
        const root = Gio.File.new_for_path('/sys/class/drm');
        try {
            const en = root.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = en.next_file(null))) {
                const name = info.get_name();
                if (!/^card\d+$/.test(name)) continue;
                const base = '/sys/class/drm/'+name+'/device/';
                if (read(base+'vendor').trim() === '0x10de' && read(base+'power/runtime_status').trim() === 'active') active = true;
            }
            en.close(null);
        } catch (_) {}
        if (!active || !GLib.find_program_in_path('nvidia-smi')) { this.values.gpu.set_text('—'); this.values.vram.set_text('—'); this.bars.gpu.set_width(Math.round((0)*(this.renderScale||1)*(global.ui_scale||1))); this.bars.vram.set_width(Math.round((0)*(this.renderScale||1)*(global.ui_scale||1))); return; }
        if (this.gpuProcess) return;
        try {
            const proc = Gio.Subprocess.new(['nvidia-smi','--query-gpu=memory.used,memory.total,utilization.gpu','--format=csv,noheader,nounits'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            this.gpuProcess = proc;
            this.gpuTimeout = Mainloop.timeout_add_seconds(2, () => { this.gpuTimeout=0; proc.force_exit(); return false; });
            proc.communicate_utf8_async(null, this.cancel, (p, result) => {
                if (this.gpuTimeout) Mainloop.source_remove(this.gpuTimeout);
                this.gpuTimeout = 0; this.gpuProcess = null;
                try {
                    const [ok, out] = p.communicate_utf8_finish(result);
                    if (this.dead) return;
                    const m = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(out || '');
                    if (ok && p.get_successful() && m) {
                        this.values.vram.set_text((+m[1]/1024).toFixed(1)+'G');
                        this.values.gpu.set_text(m[3]+'%');
                        this.bars.vram.set_width(Math.round((98*(+m[1])/(+m[2] || 1))*(this.renderScale||1)*(global.ui_scale||1)));
                        this.bars.gpu.set_width(Math.round((98*(+m[3])/100)*(this.renderScale||1)*(global.ui_scale||1)));
                    } else { this.values.gpu.set_text('—'); this.values.vram.set_text('—'); }
                } catch (_) { this.gpuText = ''; }
            });
        } catch (_) { this.gpuText = ''; }
    }
}
function main(metadata,id){return new ForestResources(metadata,id);}
